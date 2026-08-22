const {verifyUser,eb,send,encodeInstitution}=require('./_enablebanking');

module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  try{
    await verifyUser(req);
    const country=String(req.query&&req.query.country||'AT').toUpperCase().slice(0,2);
    const psuType=String(req.query&&req.query.psu_type||'business').toLowerCase()==='personal'?'personal':'business';

    const app=await eb('/application');
    const q=new URLSearchParams({country,service:'AIS',psu_type:psuType});
    const data=await eb('/aspsps?'+q.toString());
    const institutions=(Array.isArray(data.aspsps)?data.aspsps:[]).map(x=>({
      id:encodeInstitution(x),
      name:x.name,
      bic:x.bic||'',
      logo:x.logo||'',
      country:x.country||country,
      maximumConsentValidity:Number(x.maximum_consent_validity||0),
      psuTypes:x.psu_types||[]
    }));
    return send(res,200,{environment:app.environment||'',active:!!app.active,institutions});
  }catch(e){
    return send(res,e.status||500,{error:e.message||String(e)});
  }
};
