const {verifyUser,gc,send}=require('./_bank');

module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  try{
    await verifyUser(req);
    const country=String(req.query&&req.query.country||'AT').toUpperCase().slice(0,2);
    const data=await gc('/institutions/?country='+encodeURIComponent(country));
    const institutions=(Array.isArray(data)?data:[]).map(x=>({
      id:x.id,name:x.name,bic:x.bic||'',logo:x.logo||'',countries:x.countries||[]
    }));
    return send(res,200,{institutions});
  }catch(e){
    return send(res,e.status||500,{error:e.message||String(e)});
  }
};
