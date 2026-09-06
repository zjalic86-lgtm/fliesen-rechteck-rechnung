// FR Rechnung V129 - secure iPhone/iPad sync via Supabase Storage.
// Requires existing Vercel env vars: SUPABASE_URL and SUPABASE_SECRET_KEY.

const BUCKET = 'fr-rechnung-sync';

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function safeId(v) {
  const s = String(v || '');
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(s)) return '';
  return s;
}

function folderFor(kind) {
  const map = {
    'doc-file': 'documents',
    'doc-meta': 'document-meta',
    'doc-deleted': 'document-deleted',
    'regie': 'regie',
    'regie-deleted': 'regie-deleted'
  };
  return map[kind] || '';
}

function extFor(kind) {
  return kind === 'doc-file' ? '.bin' : '.json';
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function adminHeaders(secret, extra = {}) {
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    ...extra
  };
}

async function getUser(url, secret, req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: secret,
      Authorization: auth
    }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

async function ensureBucket(url, secret) {
  const base = `${url}/storage/v1`;
  let r = await fetch(`${base}/bucket/${encodeURIComponent(BUCKET)}`, {
    headers: adminHeaders(secret)
  });
  if (r.ok) return;
  if (r.status !== 404 && r.status !== 400) {
    const t = await r.text().catch(() => '');
    throw new Error(`Storage bucket check failed: ${r.status} ${t}`);
  }

  r = await fetch(`${base}/bucket`, {
    method: 'POST',
    headers: adminHeaders(secret, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: 52428800
    })
  });
  if (!r.ok && r.status !== 409) {
    const t = await r.text().catch(() => '');
    throw new Error(`Storage bucket create failed: ${r.status} ${t}`);
  }
}

async function listIds(url, secret, userId, kind) {
  const folder = folderFor(kind);
  const prefix = `${userId}/${folder}`;
  const r = await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(BUCKET)}`, {
    method: 'POST',
    headers: adminHeaders(secret, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      prefix,
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Storage list failed: ${r.status} ${t}`);
  }
  const rows = await r.json();
  const ext = extFor(kind);
  return (Array.isArray(rows) ? rows : [])
    .map(x => String(x && x.name || ''))
    .filter(Boolean)
    .map(name => name.endsWith(ext) ? name.slice(0, -ext.length) : name)
    .filter(safeId);
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function removeObject(url, secret, path) {
  const r = await fetch(`${url}/storage/v1/object/${encodeURIComponent(BUCKET)}`, {
    method: 'DELETE',
    headers: adminHeaders(secret, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: [path] })
  });
  if (!r.ok && r.status !== 404) {
    const t = await r.text().catch(() => '');
    throw new Error(`Storage delete failed: ${r.status} ${t}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return json(res, 500, { error: 'Server Cloud-Konfiguration fehlt.' });

  try {
    const user = await getUser(url, secret, req);
    if (!user) return json(res, 401, { error: 'Bitte erneut per E-Mail anmelden.' });

    await ensureBucket(url, secret);

    const action = String(req.query.action || '');
    const kind = String(req.query.kind || '');
    const folder = folderFor(kind);
    if (!folder) return json(res, 400, { error: 'Ungültiger Sync-Typ.' });

    if (action === 'list') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
      const ids = await listIds(url, secret, user.id, kind);
      return json(res, 200, { ids });
    }

    const id = safeId(req.query.id);
    if (!id) return json(res, 400, { error: 'Ungültige Dokument-ID.' });

    const path = `${user.id}/${folder}/${id}${extFor(kind)}`;
    const encoded = encodePath(path);
    const storageBase = `${url}/storage/v1`;

    if (req.method === 'GET') {
      const r = await fetch(`${storageBase}/object/authenticated/${encodeURIComponent(BUCKET)}/${encoded}`, {
        headers: adminHeaders(secret)
      });
      if (r.status === 404) return json(res, 404, { error: 'Nicht gefunden.' });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`Storage download failed: ${r.status} ${t}`);
      }
      const ab = await r.arrayBuffer();
      res.status(200);
      res.setHeader('Content-Type', r.headers.get('content-type') || (kind === 'doc-file' ? 'application/octet-stream' : 'application/json'));
      res.end(Buffer.from(ab));
      return;
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.length) return json(res, 400, { error: 'Leere Datei.' });
      const contentType = kind === 'doc-file'
        ? String(req.headers['content-type'] || 'application/octet-stream')
        : 'application/json';
      const r = await fetch(`${storageBase}/object/${encodeURIComponent(BUCKET)}/${encoded}`, {
        method: 'POST',
        headers: adminHeaders(secret, {
          'Content-Type': contentType,
          'x-upsert': 'true'
        }),
        body
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`Storage upload failed: ${r.status} ${t}`);
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      await removeObject(url, secret, path);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed.' });
  } catch (e) {
    console.error('fr-sync', e);
    return json(res, 500, { error: e && e.message ? e.message : 'Cloud Sync Fehler.' });
  }
};
