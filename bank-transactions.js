const {verifyUser,eb,send,verifyConnection,transactionText}=require('./_bank');

function isoDateDaysAgo(days){
  return new Date(Date.now()-days*86400000).toISOString().slice(0,10);
}

module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  try{
    const user=await verifyUser(req);
    const token=String(req.query&&req.query.connection_token||'').trim();
    if(!token)return send(res,400,{error:'connection_token fehlt.'});
    const conn=verifyConnection(token,user.id);

    const session=await eb('/sessions/'+encodeURIComponent(conn.sid));
    const accounts=Array.isArray(session.accounts)?session.accounts:[];
    const transactions=[];

    for(const accountId of accounts){
      let continuation='';
      let pages=0;
      do{
        const q=new URLSearchParams({
          date_from:isoDateDaysAgo(120),
          transaction_status:'BOOK'
        });
        if(continuation)q.set('continuation_key',continuation);
        const d=await eb('/accounts/'+encodeURIComponent(accountId)+'/transactions?'+q.toString());
        const rows=Array.isArray(d.transactions)?d.transactions:[];
        for(const x of rows){
          if(String(x.credit_debit_indicator||'').toUpperCase()!=='CRDT')continue;
          const amount=Number(x.transaction_amount&&x.transaction_amount.amount)||0;
          transactions.push({
            id:x.entry_reference||x.transaction_id||'',
            date:x.booking_date||x.value_date||x.transaction_date||'',
            amount,
            currency:(x.transaction_amount&&x.transaction_amount.currency)||'EUR',
            debtorName:(x.debtor&&x.debtor.name)||'',
            referenceNumber:x.reference_number||'',
            text:transactionText(x)
          });
        }
        continuation=String(d.continuation_key||'');
        pages++;
      }while(continuation && pages<5);
    }

    transactions.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    return send(res,200,{
      status:session.status||'',
      bank_name:(session.aspsp&&session.aspsp.name)||conn.bank||'',
      accounts:accounts.length,
      transactions
    });
  }catch(e){
    return send(res,e.status||500,{error:e.message||String(e)});
  }
};
