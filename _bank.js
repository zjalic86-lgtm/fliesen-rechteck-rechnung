const crypto=require('crypto');

const BASE='https://api.enablebanking.com';
const SUPABASE_URL=process.env.SUPABASE_URL || 'https://xvdrcbqnyxgugbhtrxgl.supabase.co';
const SUPABASE_ANON_KEY=process.env.SUPABASE_ANON_KEY || 'sb_publishable_SI2AWx0-d_Uj7uc75jrfVw_srMJPuB-';

function configured(){
  return !!(process.env.ENABLEBANKING_APP_ID && process.env.ENABLEBANKING_PRIVATE_KEY);
}
function privateKey(){
  let k=String(process.env.ENABLEBANKING_PRIVATE_KEY||'').trim();
  if(!k)throw Object.assign(new Error('ENABLEBANKING_PRIVATE_KEY fehlt in Vercel.'),{status:503});
  if(k.includes('\\n') && !k.includes('\n'))k=k.replace(/\\n/g,'\n');
  return k;
}
function appId(){
  const id=String(process.env.ENABLEBANKING_APP_ID||'').trim();
  if(!id)throw Object.assign(new Error('ENABLEBANKING_APP_ID fehlt in Vercel.'),{status:503});
  return id;
}
function b64url(input){
  return Buffer.from(input).toString('base64url');
}
function jwt(){
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({typ:'JWT',alg:'RS256',kid:appId()}));
  const body=b64url(JSON.stringify({
    iss:'enablebanking.com',
    aud:'api.enablebanking.com',
    iat:now,
    exp:now+3600
  }));
  const data=header+'.'+body;
  const sig=crypto.sign('RSA-SHA256',Buffer.from(data),privateKey()).toString('base64url');
  return data+'.'+sig;
}
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
async function eb(path,options={}){
  if(!configured())throw Object.assign(new Error('Enable Banking ist noch nicht vollständig eingerichtet.'),{status:503});
  const r=await fetch(BASE+path,{
    ...options,
    headers:{
      accept:'application/json',
      Authorization:'Bearer '+jwt(),
      ...(options.body?{'Content-Type':'application/json'}:{}),
      ...(options.headers||{})
    }
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok){
    const msg=d.error_description||d.detail||d.message||d.error||('Enable Banking HTTP '+r.status);
    throw Object.assign(new Error(typeof msg==='string'?msg:JSON.stringify(msg)),{status:r.status||502});
  }
  return d;
}
function send(res,status,data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(data));
}
function encodeInstitution(x){
  return Buffer.from(JSON.stringify({
    country:String(x.country||'').toUpperCase(),
    name:String(x.name||''),
    max:Number(x.maximum_consent_validity||86400)
  })).toString('base64url');
}
function decodeInstitution(v){
  try{
    const x=JSON.parse(Buffer.from(String(v||''),'base64url').toString('utf8'));
    if(!x.country||!x.name)throw new Error('bad');
    return {country:String(x.country).toUpperCase(),name:String(x.name),max:Number(x.max||86400)};
  }catch(e){
    throw Object.assign(new Error('Ungültige Bank-Auswahl.'),{status:400});
  }
}
function connectionSecret(){
  return crypto.createHash('sha256').update(privateKey()).digest();
}
function signConnection(userId,sessionId,bankName){
  const payload={
    uid:String(userId),
    sid:String(sessionId),
    bank:String(bankName||''),
    exp:Math.floor(Date.now()/1000)+180*24*3600
  };
  const p=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s=crypto.createHmac('sha256',connectionSecret()).update(p).digest('base64url');
  return p+'.'+s;
}
function verifyConnection(token,userId){
  const parts=String(token||'').split('.');
  if(parts.length!==2)throw Object.assign(new Error('Ungültige Bank-Verbindung.'),{status:401});
  const [p,s]=parts;
  const expected=crypto.createHmac('sha256',connectionSecret()).update(p).digest('base64url');
  const a=Buffer.from(s),b=Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b))throw Object.assign(new Error('Ungültige Bank-Verbindung.'),{status:401});
  let d;
  try{d=JSON.parse(Buffer.from(p,'base64url').toString('utf8'))}catch(e){throw Object.assign(new Error('Ungültige Bank-Verbindung.'),{status:401})}
  if(String(d.uid)!==String(userId))throw Object.assign(new Error('Diese Bank-Verbindung gehört nicht zu diesem Benutzer.'),{status:403});
  if(Number(d.exp||0)<Math.floor(Date.now()/1000))throw Object.assign(new Error('Bank-Verbindung ist abgelaufen.'),{status:401});
  return d;
}
function transactionText(t){
  const parts=[
    ...(Array.isArray(t.remittance_information)?t.remittance_information:[]),
    t.reference_number,
    t.entry_reference,
    t.note,
    t.debtor&&t.debtor.name,
    t.creditor&&t.creditor.name
  ].filter(Boolean);
  return parts.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');
}
module.exports={
  BASE,configured,verifyUser,eb,send,encodeInstitution,decodeInstitution,
  signConnection,verifyConnection,transactionText
};
