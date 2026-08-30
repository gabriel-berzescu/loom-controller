// motor.js — procesul Node care ține arborele, vorbește cu Ollama și servește
// pagina web + WebSocket. Pornit manual: `node motor.js`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.LOOM_PORT || 7331);
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const SESSIONS = path.join(__dirname, 'sessions');
const SIBLINGS = 5;

// ---------- setări globale (din UI/MCP, nu de pe controller) ----------
const settings = {
  model: process.env.LOOM_MODEL || 'gemma4:e2b',
  temperature: 1.0,
  num_predict: 16,
  keep_alive: '30m',
};

// ---------- arborele ----------
// nod = { id, parent_id, text, model, params:{temperature,seed}, created_at, bookmarked, hidden }
let tree, active, lastVisited, sessionName;

function newTree(prompt) {
  tree = new Map();
  lastVisited = new Map();
  const root = mkNode(null, prompt, null, null);
  active = root.id;
  sessionName = null;
}
function mkNode(parent_id, text, model, params) {
  const n = {
    id: (tree.size ? Math.max(...tree.keys()) + 1 : 0),
    parent_id, text, model, params,
    created_at: new Date().toISOString(),
    bookmarked: false, hidden: false,
  };
  tree.set(n.id, n);
  return n;
}
const node = id => tree.get(id);
const children = id => [...tree.values()].filter(n => n.parent_id === id);
const visibleChildren = id => children(id).filter(n => !n.hidden);
function pathOf(id) { const a = []; for (let n = node(id); n; n = n.parent_id === null ? null : node(n.parent_id)) a.unshift(n); return a; }
const pathText = id => pathOf(id).map(n => n.text).join('');
function setActive(id) {
  active = id;
  const n = node(id);
  if (n.parent_id !== null) lastVisited.set(n.parent_id, id);
}
function activeChild(id) {
  const v = visibleChildren(id);
  if (!v.length) return null;
  return v.find(c => c.id === lastVisited.get(id)) || v[0];
}

// ---------- Ollama: un call = un cuvânt ----------
// Regula de tăiere: sari peste whitespace-ul de la început (îl păstrezi),
// oprește-te la primul whitespace de după. Cu streaming, închidem call-ul
// imediat ce apare acel whitespace.
async function generateWord(prompt, seed) {
  const ctrl = new AbortController();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST', signal: ctrl.signal,
    body: JSON.stringify({
      model: settings.model, prompt, raw: true, stream: true,
      keep_alive: settings.keep_alive,
      options: { num_predict: settings.num_predict, temperature: settings.temperature, seed },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  let acc = '', buf = '', word = null;
  const dec = new TextDecoder();
  try {
    outer: for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const j = JSON.parse(line);
        acc += j.response || '';
        const m = /^\s*\S+\s/.exec(acc);           // cuvânt complet + whitespace-ul de după
        if (m) { word = m[0].slice(0, -1); ctrl.abort(); break outer; }
        if (j.done) break outer;
      }
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }  // abort-ul nostru; închiderea stream-ului aruncă și ea AbortError
  return word ?? acc;
}

// dedup pe text.trim(), inclusiv contra siblingilor ascunși; primul sosit rămâne
function addWordNode(parent_id, text, seed) {
  if (!text.trim()) return null;
  if (children(parent_id).some(c => c.text.trim() === text.trim())) return null;
  return mkNode(parent_id, text, settings.model, { temperature: settings.temperature, seed });
}
const rndSeed = () => Math.floor(Math.random() * 2 ** 31);

let busy = false;
// stick stâng SUS: dacă are copii vizibili → intră; altfel 5 call-uri, capul intră în primul sosit
async function step() {
  const c = activeChild(active);
  if (c) { setActive(c.id); return { entered: c.id, generated: false }; }
  if (busy) return { busy: true };
  busy = true;
  try {
    const parent = active, prompt = pathText(parent);
    let entered = null;
    await Promise.all(Array.from({ length: SIBLINGS }, async () => {
      const seed = rndSeed();
      let text;
      try { text = await generateWord(prompt, seed); } catch (e) { broadcastErr(e); return; }
      const n = addWordNode(parent, text, seed);
      if (n && entered === null) { entered = n.id; setActive(n.id); }
      broadcast();
    }));
    return { entered, generated: true, duplicate: entered === null };
  } finally { busy = false; }
}
// stick stâng STÂNGA/DREAPTA: sibling vizibil; la capăt → +1 (fără wraparound)
async function sibling(dir) {
  const n = node(active);
  if (n.parent_id === null) return { root: true };
  const v = visibleChildren(n.parent_id), i = v.findIndex(x => x.id === active), j = i + dir;
  if (j >= 0 && j < v.length) { setActive(v[j].id); return { entered: v[j].id, generated: false }; }
  if (busy) return { busy: true };
  busy = true;
  try {
    const seed = rndSeed();
    const text = await generateWord(pathText(n.parent_id), seed);
    const m = addWordNode(n.parent_id, text, seed);
    if (m) setActive(m.id);
    return { entered: m?.id ?? null, generated: true, duplicate: !m };
  } finally { busy = false; }
}
// stick stâng JOS: părinte
function up() {
  const n = node(active);
  if (n.parent_id === null) return { root: true };
  setActive(n.parent_id);
  return { entered: n.parent_id };
}

// ---------- persistență ----------
fs.mkdirSync(SESSIONS, { recursive: true });
const sessionFile = name => path.join(SESSIONS, name.replace(/[^\w.-]/g, '_') + '.json');
function save(name) {
  name = name || sessionName || `loom-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  sessionName = name;
  fs.writeFileSync(sessionFile(name), JSON.stringify({ active, settings, nodes: [...tree.values()] }, null, 1));
  return name;
}
function load(name) {
  const d = JSON.parse(fs.readFileSync(sessionFile(name), 'utf8'));
  tree = new Map(d.nodes.map(n => [n.id, n]));
  lastVisited = new Map();
  Object.assign(settings, d.settings || {});
  active = d.active ?? 0;
  sessionName = name;
}
const listSessions = () => fs.readdirSync(SESSIONS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

// ---------- comenzi (aceleași pentru browser și MCP) ----------
const commands = {
  step: () => step(),
  sibling: ({ dir = 1 }) => sibling(dir > 0 ? 1 : -1),
  up: () => up(),
  goto: ({ id }) => { if (!tree.has(id)) throw new Error('nod inexistent'); setActive(id); return { entered: id }; },
  path: () => ({ text: pathText(active), nodes: pathOf(active).map(n => n.id) }),
  state: () => snapshot(),
  hide: ({ id = active, hidden = true }) => {
    const n = node(id); if (n.parent_id === null) throw new Error('rădăcina nu se ascunde');
    n.hidden = hidden;
    if (hidden && id === active) { const v = visibleChildren(n.parent_id); setActive(v.length ? v[0].id : n.parent_id); }
    return { ok: true };
  },
  bookmark: ({ id = active, bookmarked = true }) => { node(id).bookmarked = bookmarked; return { ok: true }; },
  settings: (p) => { for (const k of ['model', 'temperature', 'num_predict']) if (p[k] !== undefined) settings[k] = p[k]; return settings; },
  new: ({ prompt }) => { newTree(prompt ?? 'Once upon a time'); return { ok: true }; },
  save: ({ name }) => ({ name: save(name) }),
  load: ({ name }) => { load(name); return { ok: true }; },
  sessions: () => ({ sessions: listSessions() }),
};
function snapshot() {
  return { active, busy, settings, session: sessionName, nodes: [...tree.values()], pathText: pathText(active) };
}

// ---------- HTTP (pagina) + WebSocket ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const wss = new WebSocketServer({ server });
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
function broadcast() { const s = { type: 'state', state: snapshot() }; for (const c of wss.clients) send(c, s); }
function broadcastErr(e) { console.error(e); for (const c of wss.clients) send(c, { type: 'error', error: String(e.message || e) }); }

wss.on('connection', ws => {
  send(ws, { type: 'state', state: snapshot() });
  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const { id, cmd, ...params } = msg;
    try {
      if (!commands[cmd]) throw new Error(`comandă necunoscută: ${cmd}`);
      const result = await commands[cmd](params);
      send(ws, { type: 'result', id, cmd, result, state: snapshot() });
      broadcast();
    } catch (e) {
      send(ws, { type: 'result', id, cmd, error: String(e.message || e) });
    }
  });
});

newTree(process.env.LOOM_PROMPT || 'Once upon a time');
server.listen(PORT, () => {
  console.log(`motor loom: http://localhost:${PORT}  (ws pe același port)  model=${settings.model}`);
  // ținem modelul cald
  fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: settings.model, keep_alive: settings.keep_alive }) }).catch(() => {});
});
