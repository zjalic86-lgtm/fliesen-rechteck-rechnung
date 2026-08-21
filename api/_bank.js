const BASE='https://bankaccountdata.gocardless.com/api/v2';
const SUPABASE_URL=process.env.SUPABASE_URL || 'https://xvdrcbqnyxgugbhtrxgl.supabase.co';
const SUPABASE_ANON_KEY=process.env.SUPABASE_ANON_KEY || 'sb_publishable_SI2AWx0-d_Uj7uc75jrfVw_srMJPuB-';

let tokenCache={access:'',expiresAt:0};

async function verifyUser(req){
  const auth=String(req.headers.authorization||'');
  if(!auth.startsWith('Bearer '))throw Object.assign(new Error('Nicht angemeldet.'),{status:401});
  const r=await fetch(SUPABASE_URL+'/auth/v1/user',{
    headers:{apikey:SUPABASE_ANON_KEY,Authorization:auth}
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.id)throw Object.assign(new Error('Ungültige Anmeldung.'),{status:401});
  return d;
}
async function accessToken(){
  if(tokenCache.access && Date.now()<tokenCache.expiresAt-60000)return tokenCache.access;
  const secret_id=process.env.GOCARDLESS_SECRET_ID;
  const secret_key=process.env.GOCARDLESS_SECRET_KEY;
  if(!secret_id||!secret_key)throw Object.assign(new Error('Bank Sync ist noch nicht eingerichtet. GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY fehlen in Vercel.'),{status:503});
  const r=await fetch(BASE+'/token/new/',{
    method:'POST',
    headers:{'Content-Type':'application/json','accept':'application/json'},
    body:JSON.stringify({secret_id,secret_key})
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access)throw Object.assign(new Error(d.detail||d.summary||'Bank API Anmeldung fehlgeschlagen.'),{status:r.status||502});
  tokenCache={access:d.access,expiresAt:Date.now()+(Number(d.access_expires)||86400)*1000};
  return d.access;
}
async function gc(path,options={}){
  const token=await accessToken();
  const r=await fetch(BASE+path,{
    ...options,
    headers:{accept:'application/json',Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})}
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(d.detail||d.summary||('Bank API HTTP '+r.status)),{status:r.status||502});
  return d;
}
function send(res,status,data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(data));
}
function txText(t){
  const parts=[
    t.remittanceInformationUnstructured,
    ...(Array.isArray(t.remittanceInformationUnstructuredArray)?t.remittanceInformationUnstructuredArray:[]),
    t.remittanceInformationStructured,
    ...(Array.isArray(t.remittanceInformationStructuredArray)?t.remittanceInformationStructuredArray:[]),
    t.additionalInformation,
    t.endToEndId,
    t.entryReference,
    t.debtorName
  ].filter(Boolean);
  return parts.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');
}
module.exports={BASE,verifyUser,gc,send,txText};
