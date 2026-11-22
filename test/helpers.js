'use strict';
// Outils des tests : serveur réel sur un port libre, base SQLite temporaire, client avec cookie.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

async function startServer(overrides = {}, deps = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibz-test-'));
  const mails = [];
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'test.db')}`, authToken: '' },
    demoPayments: true,
    rateLimit: false,
    adminEmails: [],
    realtime: 'sse',
    ...overrides,
  };
  const created = await createApp(cfg, { stripe: null, mailer: { send: async (m) => mails.push(m), provider: null }, pushSender: async () => {}, ...deps });
  const server = await new Promise((resolve) => {
    const s = created.app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    ctx: created.ctx,
    mails,
    async close() {
      created.ctx.hub.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      created.ctx.db.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

function client(base) {
  let cookie = '';
  async function req(method, url, body) {
    const headers = { 'x-vibz': '1' };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined && method !== 'GET') {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [kv] = c.split(';');
      if (kv.startsWith('vibz_sid=')) cookie = kv === 'vibz_sid=' ? '' : kv;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (u) => req('GET', u),
    post: (u, b = {}) => req('POST', u, b),
    patch: (u, b = {}) => req('PATCH', u, b),
    put: (u, b = {}) => req('PUT', u, b),
    del: (u, b) => req('DELETE', u, b),
    req,
    get cookie() {
      return cookie;
    },
  };
}

let n = 0;
async function signup(base, username = `user${++n}`, extra = {}) {
  const c = client(base);
  const r = await c.post('/api/auth/signup', { username, displayName: extra.displayName || username, email: `${username}@exemple.fr`, password: 'motdepasse1', birthdate: '2000-05-12', terms: true, ...extra });
  if (r.status !== 201) throw new Error(`Inscription impossible : ${JSON.stringify(r.data)}`);
  c.user = r.data.user;
  return c;
}

// Petite « vidéo » MP4 (signature ftyp) envoyée en un morceau, puis publiée
function fakeMp4(size = 4096) {
  const buf = Buffer.alloc(size, 7);
  buf.writeUInt32BE(32, 0);
  buf.write('ftypisom', 4, 'ascii');
  return buf;
}

async function uploadVideo(c, { duration = 8, size = 4096 } = {}) {
  const buf = fakeMp4(size);
  const fd = new FormData();
  fd.append('mime', 'video/mp4');
  fd.append('size', String(buf.length));
  fd.append('duration', String(duration));
  fd.append('width', '720');
  fd.append('height', '1280');
  const open = await c.post('/api/videos', fd);
  if (open.status !== 201) throw new Error(`Ouverture impossible : ${JSON.stringify(open.data)}`);
  const res = await fetch(`${c.base || ''}`, { method: 'HEAD' }).catch(() => null);
  void res;
  return { id: open.data.id, buf };
}

async function publishVideo(base, c, body = 'Ma vidéo #test', extra = {}) {
  const buf = fakeMp4();
  const fd = new FormData();
  fd.append('mime', 'video/mp4');
  fd.append('size', String(buf.length));
  fd.append('duration', '8');
  fd.append('width', '720');
  fd.append('height', '1280');
  const open = await c.post('/api/videos', fd);
  if (open.status !== 201) throw new Error(`Ouverture impossible : ${JSON.stringify(open.data)}`);
  const put = await fetch(`${base}/api/videos/${open.data.id}/chunks/0`, { method: 'PUT', headers: { 'x-vibz': '1', cookie: c.cookie, 'content-type': 'application/octet-stream' }, body: buf });
  if (!put.ok) throw new Error(`Morceau refusé : ${await put.text()}`);
  const done = await c.post(`/api/videos/${open.data.id}/complete`, {});
  if (done.status !== 200) throw new Error(`Finalisation impossible : ${JSON.stringify(done.data)}`);
  const post = await c.post('/api/posts', { videoId: open.data.id, body, ...extra });
  if (post.status !== 201) throw new Error(`Publication impossible : ${JSON.stringify(post.data)}`);
  return post.data.post;
}

module.exports = { startServer, client, signup, publishVideo, uploadVideo, fakeMp4 };
