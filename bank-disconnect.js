const {verifyUser,eb,send,verifyConnection}=require('./_bank');

module.exports=async function(req,res){
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  try{
    const user=await verifyUser(req);
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const token=String(body.connection_token||'').trim();
    if(!token)return send(res,400,{error:'connection_token fehlt.'});
    const conn=verifyConnection(token,user.id);
    try{
      await eb('/sessions/'+encodeURIComponent(conn.sid),{method:'DELETE'});
    }catch(e){
      if(e.status!==404)throw e;
    }
    return send(res,200,{ok:true});
  }catch(e){
    return send(res,e.status||500,{error:e.message||String(e)});
  }
};
