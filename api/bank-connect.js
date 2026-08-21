const crypto=require('crypto');
const {verifyUser,gc,send}=require('./_bank');

module.exports=async function(req,res){
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  try{
    const user=await verifyUser(req);
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const institution_id=String(body.institution_id||'').trim();
    const redirect=String(body.redirect||'').trim();
    if(!institution_id||!redirect)return send(res,400,{error:'Bank und Redirect fehlen.'});
    if(!/^https:\/\//i.test(redirect))return send(res,400,{error:'Redirect muss HTTPS sein.'});

    const data=await gc('/requisitions/',{
      method:'POST',
      body:JSON.stringify({
        redirect,
        institution_id,
        reference:'fr:'+user.id+':'+crypto.randomUUID(),
        user_language:'DE'
      })
    });
    return send(res,200,{requisition_id:data.id,link:data.link,status:data.status||'CR'});
  }catch(e){
    return send(res,e.status||500,{error:e.message||String(e)});
  }
};
