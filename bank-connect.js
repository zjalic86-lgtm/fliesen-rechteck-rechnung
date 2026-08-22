const crypto=require('crypto');
const {verifyUser,eb,send,decodeInstitution}=require('./_bank');

module.exports=async function(req,res){
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  try{
    const user=await verifyUser(req);
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const institutionId=String(body.institution_id||'').trim();
    const redirect=String(body.redirect||'').trim();
    if(!institutionId||!redirect)return send(res,400,{error:'Bank und Redirect fehlen.'});
    if(!/^https:\/\//i.test(redirect))return send(res,400,{error:'Redirect muss HTTPS sein.'});

    const bank=decodeInstitution(institutionId);
    const maxSec=Math.max(3600,Number(bank.max||86400));
    const desired=Math.min(maxSec,90*24*3600);
    const validUntil=new Date(Date.now()+Math.max(3600,desired-60)*1000).toISOString();
    const state='fr:'+user.id+':'+crypto.randomUUID();

    const data=await eb('/auth',{
      method:'POST',
      body:JSON.stringify({
        access:{
          balances:true,
          transactions:true,
          valid_until:validUntil
        },
        aspsp:{name:bank.name,country:bank.country},
        state,
        redirect_url:redirect,
        psu_type:'business',
        language:'de'
      })
    });
    return send(res,200,{
      link:data.url,
      authorization_id:data.authorization_id||'',
      state,
      bank_name:bank.name
    });
  }catch(e){
    return send(res,e.status||500,{error:e.message||String(e)});
  }
};
