// motor.js — procesul Node care ține arborele, vorbește cu Ollama și servește
// pagina web + WebSocket. Pornit manual: `node motor.js`.
// Arborele e unul singur; fiecare client conectat (browser, shim MCP) are
// propriul cursor, efemer (moare odată cu conexiunea).
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
  temperature: 2.0,
  top_k: 150,     // câți candidați intră în calcul (mai mare = coadă mai lungă)
  top_p: 1.0,     // nucleus sampling: taie coada după masă de probabilitate
  min_p: 0.0,     // taie candidații sub min_p × prob. celui mai probabil
  num_predict: 16,
  keep_alive: '30m',
};

// ---------- arborele ----------
// nod = { id, parent_id, text, model, params:{temperature,seed}, created_at, bookmarked, hidden }
let tree, sessionName;

function newTree(prompt) {
  tree = new Map();
  const root = mkNode(null, prompt, null, null);
  sessionName = null;
  for (const c of cursors.values()) { c.active = root.id; c.lastVisited.clear(); }
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
const rootId = () => [...tree.values()].find(n => n.parent_id === null).id;

// ---------- cursoare (unul per client) ----------
let nextCursor = 1;
const cursors = new Map(); // key -> { key, role, active, lastVisited:Map, busy }
function newCursor(role = 'anon') {
  const c = { key: nextCursor++, role, active: rootId(), lastVisited: new Map(), busy: false };
  cursors.set(c.key, c);
  return c;
}
function setActive(cur, id) {
  cur.active = id;
  const n = node(id);
  if (n.parent_id !== null) cur.lastVisited.set(n.parent_id, id);
}
function activeChild(cur, id) {
  const v = visibleChildren(id);
  if (!v.length) return null;
  return v.find(c => c.id === cur.lastVisited.get(id)) || v[0];
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
      options: { num_predict: settings.num_predict, temperature: settings.temperature,
                 top_k: settings.top_k, top_p: settings.top_p, min_p: settings.min_p, seed },
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
  return mkNode(parent_id, text, settings.model,
    { temperature: settings.temperature, top_k: settings.top_k, top_p: settings.top_p, min_p: settings.min_p, seed });
}
const rndSeed = () => Math.floor(Math.random() * 2 ** 31);

// stick stâng SUS: dacă are copii vizibili → intră; altfel 5 call-uri, capul intră în primul sosit
async function step(cur) {
  const c = activeChild(cur, cur.active);
  if (c) { setActive(cur, c.id); return { entered: c.id, generated: false }; }
  if (cur.busy) return { busy: true };
  cur.busy = true;
  try {
    const parent = cur.active, prompt = pathText(parent);
    let entered = null;
    await Promise.all(Array.from({ length: SIBLINGS }, async () => {
      const seed = rndSeed();
      let text;
      try { text = await generateWord(prompt, seed); } catch (e) { broadcastErr(e); return; }
      const n = addWordNode(parent, text, seed);
      if (n && entered === null) { entered = n.id; setActive(cur, n.id); }
      broadcast();
    }));
    return { entered, generated: true, duplicate: entered === null };
  } finally { cur.busy = false; }
}
// stick stâng STÂNGA/DREAPTA: sibling vizibil; la capăt → +1 (fără wraparound)
async function sibling(cur, dir) {
  const n = node(cur.active);
  if (n.parent_id === null) return { root: true };
  const v = visibleChildren(n.parent_id), i = v.findIndex(x => x.id === cur.active), j = i + dir;
  if (j >= 0 && j < v.length) { setActive(cur, v[j].id); return { entered: v[j].id, generated: false }; }
  if (cur.busy) return { busy: true };
  cur.busy = true;
  try {
    const seed = rndSeed();
    const text = await generateWord(pathText(n.parent_id), seed);
    const m = addWordNode(n.parent_id, text, seed);
    if (m) setActive(cur, m.id);
    return { entered: m?.id ?? null, generated: true, duplicate: !m };
  } finally { cur.busy = false; }
}
// stick stâng JOS: părinte
function up(cur) {
  const n = node(cur.active);
  if (n.parent_id === null) return { root: true };
  setActive(cur, n.parent_id);
  return { entered: n.parent_id };
}

// ---------- persistență ----------
fs.mkdirSync(SESSIONS, { recursive: true });
const sessionFile = name => path.join(SESSIONS, name.replace(/[^\w.-]/g, '_') + '.json');
function save(name) {
  name = name || sessionName || `loom-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  sessionName = name;
  fs.writeFileSync(sessionFile(name), JSON.stringify({ settings, nodes: [...tree.values()] }, null, 1));
  return name;
}
function load(name) {
  const d = JSON.parse(fs.readFileSync(sessionFile(name), 'utf8'));
  tree = new Map(d.nodes.map(n => [n.id, n]));
  Object.assign(settings, d.settings || {});
  sessionName = name;
  for (const c of cursors.values()) { c.active = rootId(); c.lastVisited.clear(); }
}
const listSessions = () => fs.readdirSync(SESSIONS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

// ---------- comenzi (aceleași pentru browser și MCP; cursorul = al apelantului) ----------
const commands = {
  hello: (p, cur) => { cur.role = String(p.role || 'anon').slice(0, 20); return { ok: true, me: cur.key }; },
  step: (p, cur) => step(cur),
  sibling: (p, cur) => sibling(cur, (p.dir ?? 1) > 0 ? 1 : -1),
  up: (p, cur) => up(cur),
  goto: (p, cur) => { if (!tree.has(p.id)) throw new Error('nod inexistent'); setActive(cur, p.id); return { entered: p.id }; },
  path: (p, cur) => ({ text: pathText(cur.active), nodes: pathOf(cur.active).map(n => n.id) }),
  state: (p, cur) => snapshot(cur),
  hide: (p, cur) => {
    const id = p.id ?? cur.active, hidden = p.hidden ?? true;
    const n = node(id); if (n.parent_id === null) throw new Error('rădăcina nu se ascunde');
    n.hidden = hidden;
    if (hidden) for (const c of cursors.values())                       // cine avea cursorul pe/din nodul ascuns e mutat afară
      if (pathOf(c.active).some(x => x.id === id)) { const v = visibleChildren(n.parent_id); setActive(c, v.length ? v[0].id : n.parent_id); }
    return { ok: true };
  },
  bookmark: (p, cur) => { node(p.id ?? cur.active).bookmarked = p.bookmarked ?? true; return { ok: true }; },
  settings: (p) => { for (const k of ['model', 'temperature', 'top_k', 'top_p', 'min_p', 'num_predict']) if (p[k] !== undefined) settings[k] = p[k]; return settings; },
  new: (p, cur) => { newTree(p.prompt ?? 'Adevărul este că'); return { ok: true }; },
  save: (p) => ({ name: save(p.name) }),
  load: (p) => { load(p.name); return { ok: true }; },
  sessions: () => ({ sessions: listSessions() }),
};
function snapshot(cur) {
  return {
    me: cur.key, active: cur.active, busy: cur.busy, pathText: pathText(cur.active),
    cursors: [...cursors.values()].map(c => ({ key: c.key, role: c.role, active: c.active })),
    settings, session: sessionName, nodes: [...tree.values()],
  };
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
const byWs = new Map(); // ws -> cursor
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
function broadcast() { for (const c of wss.clients) { const cur = byWs.get(c); if (cur) send(c, { type: 'state', state: snapshot(cur) }); } }
function broadcastErr(e) { console.error(e); for (const c of wss.clients) send(c, { type: 'error', error: String(e.message || e) }); }

wss.on('connection', ws => {
  const cur = newCursor();
  byWs.set(ws, cur);
  ws.on('close', () => { byWs.delete(ws); cursors.delete(cur.key); broadcast(); });
  send(ws, { type: 'state', state: snapshot(cur) });
  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const { id, cmd, params = {} } = msg;   // params separat, ca să nu se bată cap în cap cu id-ul de protocol
    try {
      if (!commands[cmd]) throw new Error(`comandă necunoscută: ${cmd}`);
      const result = await commands[cmd](params, cur);
      send(ws, { type: 'result', id, cmd, result, state: snapshot(cur) });
      broadcast();
    } catch (e) {
      send(ws, { type: 'result', id, cmd, error: String(e.message || e) });
    }
  });
});

newTree(process.env.LOOM_PROMPT || 'Adevărul este că');
server.listen(PORT, () => {
  console.log(`motor loom: http://localhost:${PORT}  (ws pe același port)  model=${settings.model}`);
  // ținem modelul cald
  fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: settings.model, keep_alive: settings.keep_alive }) }).catch(() => {});
});
