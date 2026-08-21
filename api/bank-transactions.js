const {verifyUser,gc,send,txText}=require('./_bank');

module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  try{
    const user=await verifyUser(req);
    const id=String(req.query&&req.query.requisition_id||'').trim();
    if(!id)return send(res,400,{error:'requisition_id fehlt.'});

    const reqData=await gc('/requisitions/'+encodeURIComponent(id)+'/');
    const ref=String(reqData.reference||'');
    if(!ref.startsWith('fr:'+user.id+':'))return send(res,403,{error:'Diese Bank-Verbindung gehört nicht zu diesem Benutzer.'});

    const accounts=Array.isArray(reqData.accounts)?reqData.accounts:[];
    const transactions=[];
    for(const accountId of accounts){
      try{
        const t=await gc('/accounts/'+encodeURIComponent(accountId)+'/transactions/');
        const booked=(t&&t.transactions&&Array.isArray(t.transactions.booked))?t.transactions.booked:[];
        for(const x of booked){
          const amount=Number(x&&x.transactionAmount&&x.transactionAmount.amount)||0;
          transactions.push({
            id:x.transactionId||x.internalTransactionId||x.entryReference||'',
            date:x.bookingDate||x.valueDate||'',
            amount,
            currency:(x.transactionAmount&&x.transactionAmount.currency)||'EUR',
            debtorName:x.debtorName||'',
            endToEndId:x.endToEndId||'',
            text:txText(x)
          });
        }
      }catch(e){
        if(e.status===429)continue;
        throw e;
      }
    }
    transactions.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    return send(res,200,{
      status:reqData.status||'',
      accounts:accounts.length,
      transactions
    });
  }catch(e){
    return send(res,e.status||500,{error:e.message||String(e)});
  }
};
