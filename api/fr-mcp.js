import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Keep this resource stable: it is the OAuth token audience, not a request Host header.
export const ORIGIN = 'https://fliesen-rechteck-rechnung.vercel.app';
export const RESOURCE = ORIGIN + '/api/fr-mcp';
export const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const SCOPE = 'regiestunden:write';
const VERSION = '1.0.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26'];
const COOKIE = '__Host-fr-mcp-csrf';
const OAUTH = [{ type: 'oauth2', scopes: [SCOPE] }];
const random = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
const challengeFor = value => createHash('sha256').update(value).digest('base64url');
const endpoint = route => RESOURCE + '?route=' + route;
const challenge = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="${SCOPE}"`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const opaque = /^[A-Za-z0-9_-]{43}$/;
const string = (max, description) => ({ type: 'string', maxLength: max, description });

export const inputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    request_id: { type: 'string', format: 'uuid', description: 'Neue UUID pro Beleg; bei Wiederholung exakt dieselbe UUID und dieselben Daten verwenden.' },
    document_type: { type: 'string', enum: ['Regiestunden'] },
    name: string(300, 'Name des Kunden oder Ansprechpartners; alternativ Baustelle oder Adresse.'),
    chef_name: string(300, 'Optionaler Ansprechpartner. Kein Pflichtfeld.'),
    baustelle: string(500, 'Bezeichnung der Baustelle'),
    baustelle_adresse: string(700, 'Adresse der Baustelle'),
    datum: { type: 'string', format: 'date', description: 'Arbeitstag als YYYY-MM-DD. Nicht erfinden.' },
    arbeit_beschreibung_1: string(4000, 'Durchgeführte Arbeit, Position 1'),
    stunden_1: { type: 'number', minimum: 0, maximum: 1000000 },
    arbeit_beschreibung_2: string(4000, 'Optionale zweite Arbeit'),
    stunden_2: { type: 'number', minimum: 0, maximum: 1000000 },
    gesamt_stunden: { type: 'number', minimum: 0, maximum: 2000000 },
    stunden_preis: { type: 'number', minimum: 0, maximum: 1000000, description: 'Optional; nur auf ausdrücklichen Wunsch ergänzen.' },
    bemerkung: string(4000, 'Optionale Bemerkung')
  },
  required: ['request_id', 'datum', 'arbeit_beschreibung_1', 'stunden_1'],
  anyOf: [{ required: ['name'] }, { required: ['baustelle'] }, { required: ['baustelle_adresse'] }, { required: ['chef_name'] }]
};
export const TOOLS = [
  {
    name: 'fr_send_regiestunden', title: 'Regiestunden an FR senden',
    description: 'Sendet ausdrücklich beauftragte Regiestunden in den vorhandenen ChatGPT-Import der FR-App. Name oder Baustelle/Adresse genügt. Ein Beleg, maximal zwei Positionen. Rückgabe queued bedeutet zum Abruf bereit; noch keine Unterschrift oder endgültige Rechnung. Bei unklarer Antwort nur mit identischer request_id und identischen Daten wiederholen.',
    inputSchema, securitySchemes: OAUTH, _meta: { securitySchemes: OAUTH },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'fr_regiestunden_status', title: 'FR-Verbindung prüfen',
    description: 'Prüft Anmeldung und Verbindung zur FR-Datenbank ohne einen Beleg anzulegen. Dies ist kein Nachweis eines bereits übertragenen Belegs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    securitySchemes: OAUTH, _meta: { securitySchemes: OAUTH },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
];

class PublicError extends Error {
  constructor(status, code, message = code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new PublicError(status, code, message); };
const same = (a, b) => timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const textField = (value, max = 1000) => typeof value === 'string' && value.length <= max;
function single(values, key, max = 1000) {
  const v = values[key];
  if (!textField(v, max)) fail(400, 'invalid_request');
  return v;
}
function json(res, status, value) { return res.status(status).json(value); }
function empty(res, status) { return res.status(status).end(); }
function body(req) {
  let value = req.body;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    if (value.length > 24000) fail(413, 'payload_too_large');
    if (String(req.headers?.['content-type']).startsWith('application/x-www-form-urlencoded')) {
      const pairs = new URLSearchParams(value); value = {};
      for (const [k, v] of pairs) { if (Object.hasOwn(value, k)) fail(400, 'invalid_request'); value[k] = v; }
    } else { try { value = JSON.parse(value); } catch { fail(400, 'invalid_json'); } }
  }
  if (!object(value) || JSON.stringify(value).length > 24000) fail(400, 'invalid_request');
  return value;
}

export function validateDocument(args) {
  if (!object(args)) fail(400, 'invalid_arguments');
  if (Object.keys(args).some(k => !Object.hasOwn(inputSchema.properties, k))) fail(400, 'unknown_field');
  if (!uuid.test(args.request_id || '')) fail(400, 'invalid_request_id');
  if (args.document_type !== undefined && args.document_type !== 'Regiestunden') fail(400, 'invalid_document_type');
  const d = { document_type: 'Regiestunden' };
  for (const k of ['name','chef_name','baustelle','baustelle_adresse','datum','arbeit_beschreibung_1','arbeit_beschreibung_2','bemerkung']) {
    if (args[k] !== undefined) {
      if (!textField(args[k], inputSchema.properties[k].maxLength || 10)) fail(400, 'invalid_text', `Ungültiger Text: ${k}`);
      d[k] = args[k].trim();
    }
  }
  if (![d.name,d.chef_name,d.baustelle,d.baustelle_adresse].some(Boolean)) fail(400, 'missing_name_or_site', 'Name, Baustelle oder Adresse fehlt.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.datum || '') || !Number.isFinite(Date.parse(d.datum)) || new Date(d.datum).toISOString().slice(0,10) !== d.datum) fail(400, 'invalid_date', 'Datum als gültigen Arbeitstag YYYY-MM-DD angeben.');
  for (const k of ['stunden_1','stunden_2','gesamt_stunden','stunden_preis']) {
    if (args[k] !== undefined) {
      if (typeof args[k] !== 'number' || !Number.isFinite(args[k]) || args[k] < 0 || args[k] > inputSchema.properties[k].maximum) fail(400, 'invalid_hours', `Ungültige Zahl: ${k}`);
      d[k] = args[k];
    }
  }
  if (!d.arbeit_beschreibung_1 || d.stunden_1 === undefined) fail(400, 'missing_first_work', 'Beschreibung und Stunden der ersten Arbeit fehlen.');
  if (Boolean(d.arbeit_beschreibung_2) !== (d.stunden_2 !== undefined)) fail(400, 'incomplete_second_work', 'Beschreibung und Stunden der zweiten Arbeit zusammen angeben.');
  const total = d.stunden_1 + (d.stunden_2 || 0);
  if (d.gesamt_stunden !== undefined && Math.abs(d.gesamt_stunden - total) > 0.000001) fail(400, 'total_mismatch', 'Gesamtstunden stimmen nicht mit den Positionen überein.');
  d.gesamt_stunden = total; d.hours = total;
  if (d.name || d.chef_name) d.customer_name = d.name || d.chef_name;
  return { requestId: args.request_id.toLowerCase(), document: d };
}

function page(res, status, context, notice = '') {
  const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  return res.status(status).send(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FR mit ChatGPT verbinden</title><style>body{font:18px system-ui;background:#f4f4f5;color:#222;margin:0;padding:24px}main{max-width:460px;margin:6vh auto;background:white;padding:28px;border-radius:20px}h1{font-size:28px}p{line-height:1.5}label{display:block;font-weight:650;margin:24px 0 10px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:16px;border-radius:12px}input{border:1px solid #aaa}button{background:#b9362e;color:white;border:0;margin-top:18px;font-weight:700}.hint{color:#555;font-size:16px}.error{color:#a02020}</style><main><h1>FR Rechnung verbinden</h1><p>ChatGPT darf Regiestunden an den ChatGPT-Import dieser FR-App senden.</p><p class="hint">Rechnung und Angebot bleiben unverändert. Die Freigabe gilt 30 Tage.</p>${notice ? `<p role="alert" class="error">${esc(notice)}</p>` : ''}<form action="${endpoint('authorize')}" method="post"><input type="hidden" name="context" value="${esc(context)}"><label for="key">FR Import-Schlüssel</label><input id="key" name="import_key" type="password" required maxlength="4096" autocomplete="off"><p class="hint">Den gespeicherten Schlüssel findest du in der FR-App unter Einstellungen → ChatGPT Import. Hier wird kein E-Mail-Passwort benötigt.</p><button name="decision" value="allow">Regiestunden verbinden</button><button name="decision" value="deny" formnovalidate>Abbrechen</button></form><p class="hint" lang="sr">Unesi FR import ključ samo ovde. ChatGPT ga neće dobiti. Zatim pritisni Regiestunden verbinden.</p></main></html>`);
}

export function createHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const importKey = String(env.FR_IMPORT_TOKEN || '').trim();
  const keyVersion = hash(importKey);
  const database = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const secret = env.SUPABASE_SECRET_KEY;
  function configured() { if (!importKey || !/^https:\/\//.test(database) || !secret) fail(503, 'FR_MCP_NOT_CONFIGURED'); }
  async function db(path, method = 'POST', data) {
    configured();
    let response;
    try {
      response = await fetchImpl(database + '/rest/v1/' + path, {
        method, headers: { apikey: secret, Authorization: 'Bearer ' + secret, 'Content-Type':'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(8000)
      });
    } catch { fail(503, 'FR_DATABASE_UNAVAILABLE'); }
    if (!response.ok) fail(503, 'FR_DATABASE_UNAVAILABLE');
    const raw = await response.text();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { fail(503, 'FR_DATABASE_UNAVAILABLE'); }
  }
  const rpc = (name, data) => db('rpc/' + name, 'POST', data);
  async function limit(req, area, perIp, globalLimit, seconds) {
    // Vercel's trusted header is only a hint; the independent global bucket bounds attempts too.
    const ip = String(req.headers?.['x-vercel-forwarded-for'] || 'unknown').split(',')[0].trim().slice(0,100);
    const a = await rpc('fr_mcp_rate', { p_bucket: area + ':all', p_limit: globalLimit, p_seconds: seconds });
    const b = await rpc('fr_mcp_rate', { p_bucket: area + ':' + hash(ip), p_limit: perIp, p_seconds: seconds });
    if (!a || !b) fail(429, 'rate_limited', 'Zu viele Versuche. Bitte später erneut verbinden.');
  }
  async function tokenRow(token, kind) {
    if (!opaque.test(token)) fail(400, 'invalid_request');
    const rows = await db('fr_mcp_tokens?token_hash=eq.' + hash(token) + '&kind=eq.' + kind + '&select=data,consumed,expires_at', 'GET');
    if (!rows?.length || rows[0].consumed || Date.parse(rows[0].expires_at) <= Date.now()) fail(400, 'expired_request', 'Verbindungsanfrage abgelaufen. Bitte in ChatGPT erneut starten.');
    return rows[0];
  }
  function bearerHash(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers?.authorization || '');
    return match ? hash(match[1]) : null;
  }
  const access = tokenHash => tokenHash ? rpc('fr_mcp_access', { p_hash:tokenHash, p_resource:RESOURCE, p_key_version:keyVersion }) : false;
  function redirect(res, data, values) {
    // Never redirect to request-supplied locations not validated during registration.
    if (data.redirect_uri !== CALLBACK) fail(400, 'invalid_redirect_uri');
    const target = new URL(data.redirect_uri);
    for (const [k,v] of Object.entries({ ...values, state:data.state, iss:ORIGIN })) target.searchParams.set(k,v);
    res.setHeader('Location', target.toString()); return empty(res,303);
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Vary','Origin');
    try {
      const origin = req.headers?.origin;
      if (origin && ![ORIGIN,'https://chatgpt.com','https://chat.openai.com'].includes(origin)) fail(403,'origin_not_allowed');
      if (origin) res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, MCP-Protocol-Version');
      res.setHeader('Access-Control-Expose-Headers','WWW-Authenticate');
      if (req.method === 'OPTIONS') return empty(res,204);
      const route = req.query?.route || '';
      if (!textField(route,40)) fail(400,'invalid_request');
      if (route === 'resource-metadata' && req.method === 'GET') return json(res,200,{
        resource:RESOURCE, authorization_servers:[ORIGIN], scopes_supported:[SCOPE], bearer_methods_supported:['header'], resource_name:'FR Regiestunden'
      });
      if (route === 'oauth-metadata' && req.method === 'GET') return json(res,200,{
        issuer:ORIGIN, authorization_endpoint:endpoint('authorize'), token_endpoint:endpoint('token'),
        registration_endpoint:endpoint('register'), revocation_endpoint:endpoint('revoke'),
        authorization_response_iss_parameter_supported:true, response_types_supported:['code'],
        grant_types_supported:['authorization_code','refresh_token'], token_endpoint_auth_methods_supported:['none'],
        revocation_endpoint_auth_methods_supported:['none'], code_challenge_methods_supported:['S256'], scopes_supported:[SCOPE]
      });
      if (route === 'health' && req.method === 'GET') {
        configured(); return json(res,200,{ok:true,bridge_version:VERSION,authentication:'oauth2-pkce',scope:SCOPE});
      }
      if (route === 'register' && req.method === 'POST') {
        const b=body(req);
        if (!Array.isArray(b.redirect_uris) || b.redirect_uris.length !== 1 || b.redirect_uris[0] !== CALLBACK) fail(400,'invalid_redirect_uri');
        if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== 'none') fail(400,'invalid_client_metadata');
        if (b.grant_types && (!Array.isArray(b.grant_types) || b.grant_types.some(x=>!['authorization_code','refresh_token'].includes(x)))) fail(400,'invalid_client_metadata');
        if (b.response_types && (!Array.isArray(b.response_types) || b.response_types.length !== 1 || b.response_types[0] !== 'code')) fail(400,'invalid_client_metadata');
        if (b.scope && b.scope !== SCOPE) fail(400,'invalid_scope');
        await limit(req,'register',20,100,3600);
        const id=random(); await db('fr_mcp_clients','POST',{id,redirect_uri:CALLBACK});
        return json(res,201,{client_id:id,client_id_issued_at:Math.floor(Date.now()/1000),redirect_uris:[CALLBACK],
          token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:SCOPE});
      }
      if (route === 'authorize' && req.method === 'GET') {
        const q=req.query;
        const client=single(q,'client_id');
        if (!opaque.test(client) || q.redirect_uri !== CALLBACK || q.response_type !== 'code'
          || q.code_challenge_method !== 'S256' || !opaque.test(q.code_challenge || '') || q.resource !== RESOURCE
          || (q.scope !== undefined && q.scope !== SCOPE)) fail(400,'invalid_request');
        const state=single(q,'state',2000);
        await limit(req,'authorize_page',30,200,900);
        const clients=await db('fr_mcp_clients?id=eq.'+client+'&select=redirect_uri','GET');
        if (clients?.[0]?.redirect_uri !== CALLBACK) fail(400,'invalid_client');
        const context=random(), csrf=random();
        await db('fr_mcp_tokens','POST',{token_hash:hash(context),kind:'context',expires_at:new Date(Date.now()+600000).toISOString(),
          data:{client_id:client,redirect_uri:CALLBACK,resource:RESOURCE,scope:SCOPE,code_challenge:q.code_challenge,state,csrf:hash(csrf)}});
        res.setHeader('Set-Cookie',`${COOKIE}=${csrf}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`);
        return page(res,200,context);
      }
      if (route === 'authorize' && req.method === 'POST') {
        if (origin && ![ORIGIN,'https://chatgpt.com','https://chat.openai.com'].includes(origin)) fail(403,'origin_not_allowed');
        const b=body(req), context=single(b,'context');
        const row=await tokenRow(context,'context');
        const cookies=String(req.headers.cookie || '').split(';').map(x=>x.trim());
        const csrf=cookies.find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1) || '';
        if (!opaque.test(csrf) || !same(hash(csrf),row.data.csrf)) fail(403,'invalid_csrf');
        if (b.decision === 'deny') {
          await db('fr_mcp_tokens?token_hash=eq.'+hash(context),'PATCH',{consumed:true});
          res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
          return redirect(res,row.data,{error:'access_denied'});
        }
        if (b.decision !== 'allow') fail(400,'invalid_request');
        await limit(req,'login',10,50,900);
        const supplied=single(b,'import_key',4096).trim();
        if (!same(supplied,importKey)) return page(res,401,context,'Import-Schlüssel stimmt nicht. Bitte den Schlüssel aus der FR-App verwenden.');
        const code=random();
        const grant=await rpc('fr_mcp_authorize',{p_context:hash(context),p_csrf:hash(csrf),p_code:hash(code),p_key_version:keyVersion});
        if (!grant) fail(400,'expired_request');
        res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
        return redirect(res,grant,{code});
      }
      if (route === 'token' && req.method === 'POST') {
        const b=body(req); await limit(req,'token',100,1000,900);
        const client=single(b,'client_id');
        if (!opaque.test(client) || b.resource !== RESOURCE) fail(400,'invalid_grant');
        if (b.scope !== undefined && b.scope !== SCOPE) fail(400,'invalid_scope');
        let kind,raw,pkce='';
        if (b.grant_type === 'authorization_code') {
          kind='code'; raw=single(b,'code'); const verifier=single(b,'code_verifier',128);
          if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || b.redirect_uri !== CALLBACK) fail(400,'invalid_grant');
          pkce=challengeFor(verifier);
        } else if (b.grant_type === 'refresh_token') { kind='refresh'; raw=single(b,'refresh_token'); }
        else fail(400,'unsupported_grant_type');
        if (!opaque.test(raw)) fail(400,'invalid_grant');
        const accessToken=random(),refresh=random();
        const accepted=await rpc('fr_mcp_exchange',{p_hash:hash(raw),p_kind:kind,p_client:client,p_resource:RESOURCE,
          p_redirect:kind==='code'?CALLBACK:'',p_challenge:pkce,p_key_version:keyVersion,p_access:hash(accessToken),p_refresh:hash(refresh)});
        if (!accepted) fail(400,'invalid_grant');
        return json(res,200,{access_token:accessToken,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:SCOPE});
      }
      if (route === 'revoke' && req.method === 'POST') {
        const b=body(req); await limit(req,'revoke',30,200,900);
        if (opaque.test(b.token || '') && opaque.test(b.client_id || '')) await rpc('fr_mcp_revoke',{p_hash:hash(b.token),p_client:b.client_id});
        return json(res,200,{});
      }
      if (route) fail(404,'not_found');
      if (req.method !== 'POST') { res.setHeader('Allow','POST, OPTIONS'); return empty(res,405); }
      const protocol=req.headers['mcp-protocol-version'];
      if (protocol && !PROTOCOLS.includes(protocol)) fail(400,'unsupported_protocol');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415,'json_required');
      if (!String(req.headers.accept || '').includes('application/json')) fail(406,'json_accept_required');
      const m=body(req);
      if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') fail(400,'invalid_rpc');
      const hasId=Object.hasOwn(m,'id');
      if (hasId && !(typeof m.id === 'string' || (typeof m.id === 'number' && Number.isSafeInteger(m.id)))) fail(400,'invalid_rpc_id');
      if (!hasId) {
        if (['notifications/initialized','notifications/cancelled'].includes(m.method)) return empty(res,202);
        fail(400,'unsupported_notification');
      }
      const reply=result=>json(res,200,{jsonrpc:'2.0',id:m.id,result});
      const rpcError=(code,message)=>json(res,200,{jsonrpc:'2.0',id:m.id,error:{code,message}});
      if (m.method === 'initialize') return reply({protocolVersion:PROTOCOLS.includes(m.params?.protocolVersion)?m.params.protocolVersion:PROTOCOLS[0],
        capabilities:{tools:{listChanged:false}},serverInfo:{name:'fr-regiestunden',version:VERSION},
        instructions:'Send only explicitly requested Regiestunden. A queued receipt is not a signed or finalized document. Keep request_id identical when retrying.'});
      if (m.method === 'ping') return reply({});
      if (m.method === 'tools/list') return reply({tools:TOOLS});
      if (m.method !== 'tools/call') return rpcError(-32601,'Method not found');
      if (!TOOLS.some(t=>t.name===m.params?.name)) return rpcError(-32602,'Unknown tool');
      const tokenHash=bearerHash(req);
      if (!await access(tokenHash)) {
        res.setHeader('WWW-Authenticate',challenge);
        return json(res,401,{jsonrpc:'2.0',id:m.id,error:{code:-32001,message:'FR-Anmeldung erforderlich.'}});
      }
      if (m.params.name === 'fr_regiestunden_status') {
        if (m.params.arguments && (!object(m.params.arguments) || Object.keys(m.params.arguments).length)) return rpcError(-32602,'No arguments expected');
        return reply({content:[{type:'text',text:'FR-Verbindung geprüft. Es wurde kein Beleg angelegt.'}],structuredContent:{ok:true,authenticated:true,bridge_version:VERSION}});
      }
      try {
        const {requestId,document}=validateDocument(m.params.arguments);
        const result=await rpc('fr_mcp_enqueue',{p_hash:tokenHash,p_resource:RESOURCE,p_key_version:keyVersion,p_request_id:requestId,p_document:document});
        if (!result?.ok) fail(400,result?.error || 'import_failed');
        return reply({content:[{type:'text',text:`Regiestunden zum Abruf in FR bereit. Import-ID ${result.import_id}. In der FR-App bei Bedarf ChatGPT Import abrufen drücken.`}],
          structuredContent:{ok:true,status:'queued',request_id:requestId,import_id:result.import_id,duplicate:result.duplicate,document_type:'Regiestunden'}});
      } catch (e) {
        const message=e instanceof PublicError && e.status < 500 ? e.message : 'FR-Import nicht bestätigt. Bei Wiederholung dieselbe request_id und dieselben Daten verwenden.';
        return reply({isError:true,content:[{type:'text',text:message}]});
      }
    } catch (e) {
      if (e instanceof PublicError) return json(res,e.status,{error:e.code,error_description:e.message});
      return json(res,500,{error:'server_error',error_description:'FR-Verbindung nicht bestätigt. Bitte später erneut prüfen.'});
    }
  };
}

export default createHandler();
