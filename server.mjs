// Agent View Chat のサーバー。127.0.0.1 だけで待ち受けて、画面（public/）と API を出す
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BgSessions } from './lib/bg.mjs';
import { cleanEnv, findGlobalClaude } from './lib/env.mjs';
import { Updater } from './lib/updater.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.AVC_DATA || path.join(ROOT, 'data');
const PORT = Number(process.env.AVC_PORT) || 4790;
fs.mkdirSync(DATA, { recursive: true });

// API の合言葉。ほかのサイトから 127.0.0.1 に送られてくる要求を断る
const TOKEN_FILE = path.join(DATA, '.token');
let TOKEN;
try {
  TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
} catch {}
if (!/^[0-9a-f]{48}$/.test(TOKEN || '')) {
  TOKEN = randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, TOKEN);
}

// ---- 設定 ----
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const downloads = path.join(os.homedir(), 'Downloads');
const DEFAULT_SETTINGS = {
  theme: 'dark', fontSize: 14, chatWidth: 'comfortable', notify: false, autoUpdate: false,
  defaults: { cwd: fs.existsSync(downloads) ? downloads : os.homedir(), model: '', mode: '', effort: '' },
  keybindings: {},
};
const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
let settings = structuredClone(DEFAULT_SETTINGS);
try {
  const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  for (const k of Object.keys(saved)) if (!SETTING_KEYS.has(k)) delete saved[k];
  settings = { ...settings, ...saved, defaults: { ...settings.defaults, ...saved.defaults }, keybindings: { ...saved.keybindings } };
} catch {}
function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 1));
}

// ~/.claude/settings.json の既定（表示用。読むだけ）
function claudeDefaults() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    return { model: s.model || '', mode: s.permissions?.defaultMode || 'default', effort: s.effortLevel || s.env?.CLAUDE_CODE_EFFORT_LEVEL || '' };
  } catch {
    return { model: '', mode: 'default', effort: '' };
  }
}

// ---- 中身 ----
const childEnv = cleanEnv();
const claude = findGlobalClaude();
const bg = new BgSessions({ claude, env: childEnv, dataDir: DATA, onlyCwd: process.env.AVC_ONLY_CWD || '' });
const updater = new Updater({ claude, env: childEnv, dataDir: DATA, getSettings: () => settings });

// ---- SSE ----
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
bg.on('change', (b) => broadcast('bg', b));
bg.on('notify', (n) => broadcast('notify', n));
updater.on('change', (u) => broadcast('update', u));
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20000).unref();

function recentDirs() {
  const seen = new Map();
  const add = (d, t) => {
    if (d && (!seen.has(d) || seen.get(d) < t)) seen.set(d, t);
  };
  for (const a of bg.raw) add(a.cwd, a.startedAt || 0);
  add(settings.defaults.cwd, 0);
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d).slice(0, 12);
}

function state() {
  return { bg: bg.state(), settings, claudeDefaults: claudeDefaults(), update: updater.state(), recentDirs: recentDirs(), dataDir: DATA, claudePath: claude };
}

function suggestDirs(prefix) {
  const p = String(prefix || '').replace(/\//g, '\\');
  if (!p) return { dirs: recentDirs(), exists: false };
  // UNC パスは、つながらないと statSync が長く固まってサーバーごと止まる
  if (p.startsWith('\\\\')) return { dirs: [], exists: false };
  let exists = false;
  try {
    exists = fs.statSync(p).isDirectory();
  } catch {}
  const dir = p.endsWith('\\') ? p : path.dirname(p);
  const base = p.endsWith('\\') ? '' : path.basename(p).toLowerCase();
  if (!path.isAbsolute(dir)) return { dirs: recentDirs().filter((d) => d.toLowerCase().includes(p.toLowerCase())), exists };
  let dirs = [];
  try {
    dirs = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('$') && d.name.toLowerCase().startsWith(base))
      .slice(0, 40).map((d) => path.join(dir, d.name));
  } catch {}
  return { dirs, exists };
}

// ---- HTTP ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const VENDOR = {
  '/vendor/preact.mjs': 'node_modules/preact/dist/preact.mjs',
  '/vendor/hooks.mjs': 'node_modules/preact/hooks/dist/hooks.mjs',
  '/vendor/htm.mjs': 'node_modules/htm/dist/htm.mjs',
  '/vendor/marked.mjs': 'node_modules/marked/lib/marked.esm.js',
  '/vendor/purify.mjs': 'node_modules/dompurify/dist/purify.es.mjs',
  '/vendor/hljs.mjs': 'node_modules/@highlightjs/cdn-assets/es/highlight.min.js',
};
const okHost = (h) => h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
const okOrigin = (o) => o === `http://127.0.0.1:${PORT}` || o === `http://localhost:${PORT}`;

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 4 << 20) {
        reject(Object.assign(new Error('大きすぎます'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('JSON が読めません'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    if (path.basename(file) === 'index.html') buf = Buffer.from(buf.toString('utf8').replace('%%TOKEN%%', TOKEN));
    send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });
const idOf = (p) => decodeURIComponent(p.id);

route('GET', '/api/state', () => state());
route('GET', '/api/bg/:id/items', async ({ p }) => ({ items: await bg.itemsOf(idOf(p)) }));
route('POST', '/api/bg', async ({ body }) => ({ id: await bg.dispatch(body) }));
route('POST', '/api/bg/:id/reply', async ({ p, body }) => bg.reply(idOf(p), body.text, { now: !!body.now }));
route('POST', '/api/bg/:id/cancel-queue', ({ p }) => (bg.cancelQueue(idOf(p)), { ok: true }));
route('POST', '/api/bg/:id/read', ({ p }) => (bg.markRead(idOf(p)), { ok: true }));
route('POST', '/api/bg/:id/watch', ({ p, body }) => (bg.watch(idOf(p), !!body.on), { ok: true }));
route('POST', '/api/bg/:id/stop', async ({ p }) => (await bg.stop(idOf(p)), { ok: true }));
route('POST', '/api/bg/:id/remove', async ({ p }) => (await bg.remove(idOf(p)), { ok: true }));
route('POST', '/api/bg/:id/terminal', async ({ p }) => (await bg.terminal(idOf(p)), { ok: true }));
route('POST', '/api/open-folder', ({ body }) => {
  if (!bg.raw.some((a) => a.cwd === body.dir)) throw Object.assign(new Error('知らないフォルダです'), { status: 400 });
  spawn('explorer.exe', [body.dir], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
});
route('GET', '/api/dirs', ({ url }) => suggestDirs(url.searchParams.get('prefix')));
route('POST', '/api/settings', ({ body }) => {
  const patch = Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => SETTING_KEYS.has(k)));
  settings = { ...settings, ...patch, defaults: { ...settings.defaults, ...patch.defaults }, keybindings: patch.keybindings ?? settings.keybindings };
  saveSettings();
  broadcast('settings', settings);
  return { ok: true, settings };
});
route('GET', '/api/update', () => updater.state());
route('POST', '/api/update/check', () => updater.check({ manual: true }));
route('POST', '/api/update/apply', () => {
  updater.apply();
  return updater.state();
});
route('POST', '/api/update/dismiss', ({ body }) => (updater.dismiss(String(body.version || '')), updater.state()));
route('POST', '/api/shutdown', () => {
  setTimeout(shutdown, 100);
  return { ok: true };
});

const server = http.createServer(async (req, res) => {
  if (!okHost(req.headers.host)) return send(res, 403, 'forbidden', 'text/plain');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  if (p === '/healthz') return send(res, 200, { ok: true, app: 'agentview-chat', claude: updater.current });
  if (!p.startsWith('/api/')) {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');
    if (VENDOR[p]) return serveFile(res, path.join(ROOT, VENDOR[p]));
    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
    return serveFile(res, file);
  }
  if ((req.headers['x-avc-token'] || url.searchParams.get('token')) !== TOKEN) return send(res, 403, { error: 'token' });
  if (req.method === 'POST') {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json only' });
    if (req.headers.origin && !okOrigin(req.headers.origin)) return send(res, 403, { error: 'origin' });
  }
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify(state())}\n\n`);
    clients.add(res);
    bg.setClients(clients.size);
    req.on('close', () => {
      clients.delete(res);
      bg.setClients(clients.size);
    });
    return;
  }
  for (const r of routes) {
    const m = r.method === req.method && r.re.exec(p);
    if (!m) continue;
    try {
      const body = req.method === 'POST' ? await readBody(req) : null;
      return send(res, 200, (await r.fn({ p: m.groups ?? {}, body, url })) ?? { ok: true });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }
  send(res, 404, { error: 'not found' });
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const res of clients) res.end();
  server.close();
  process.exit(0);
}
process.on('uncaughtException', (e) => console.error(new Date().toISOString(), 'uncaughtException', e));
process.on('unhandledRejection', (e) => console.error(new Date().toISOString(), 'unhandledRejection', e));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `ポート ${PORT} は使用中です（もう起動しているかもしれません）` : e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent View Chat: http://127.0.0.1:${PORT}  (claude: ${claude ?? '見つかりません'})`);
  updater.start();
});
