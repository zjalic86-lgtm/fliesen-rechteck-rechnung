const {verifyUser,eb,send,signConnection}=require('./_bank');

module.exports=async function(req,res){
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  try{
    const user=await verifyUser(req);
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const code=String(body.code||'').trim();
    const state=String(body.state||'').trim();
    if(!code)return send(res,400,{error:'Authorization code fehlt.'});
    if(!state.startsWith('fr:'+user.id+':'))return send(res,403,{error:'Ungültiger Bank-State für diesen Benutzer.'});

    const data=await eb('/sessions',{
      method:'POST',
      body:JSON.stringify({code})
    });
    if(!data.session_id)return send(res,502,{error:'Enable Banking hat keine Session-ID geliefert.'});
    const bankName=(data.aspsp&&data.aspsp.name)||'';
    const connectionToken=signConnection(user.id,data.session_id,bankName);
    return send(res,200,{
      connection_token:connectionToken,
      bank_name:bankName,
      accounts:Array.isArray(data.accounts)?data.accounts.length:0
    });
  }catch(e){
    return send(res,e.status||500,{error:e.message||String(e)});
  }
};
