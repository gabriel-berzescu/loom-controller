// mcp-shim.js — server MCP (stdio) subțire, lansat de Claude Desktop.
// Traduce tool-urile în mesaje WebSocket către motor. Dacă motorul nu rulează,
// tool-urile răspund „motorul nu e pornit".
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const URL = process.env.LOOM_WS || 'ws://localhost:7331';

let ws = null, nextId = 1;
const pending = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve(ws);
    const s = new WebSocket(URL);
    s.onopen = () => { ws = s; s.send(JSON.stringify({ id: 0, cmd: 'hello', params: { role: 'claude' } })); resolve(s); };
    s.onerror = () => reject(new Error('motorul nu e pornit (node motor.js)'));
    s.onclose = () => { if (ws === s) ws = null; };
    s.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === 'result' && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(m.error)) : res(m);
      }
    };
  });
}
async function call(cmd, params = {}) {
  const s = await connect();
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    s.send(JSON.stringify({ id, cmd, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')); } }, 120000);
  });
}

const text = t => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
// răspuns standard după o mișcare: calea + siblingii nodului activ
function describe(state, extra = {}) {
  const act = state.nodes.find(n => n.id === state.active);
  const sibs = act.parent_id === null ? [] : state.nodes.filter(n => n.parent_id === act.parent_id);
  const hc = state.cursors?.find(c => c.role === 'human');
  const human = hc && state.nodes.find(n => n.id === hc.active);
  return text({
    ...extra,
    human: human ? { id: human.id, text: human.text } : 'neconectat',   // cursorul omului (are propriul cursor, separat de al tău)
    active: { id: act.id, text: act.text },
    siblings: sibs.map(n => ({ id: n.id, text: n.text, hidden: n.hidden || undefined, bookmarked: n.bookmarked || undefined })),
    children: state.nodes.filter(n => n.parent_id === act.id).map(n => ({ id: n.id, text: n.text, hidden: n.hidden || undefined })),
    path: state.pathText,
  });
}
const wrap = fn => async (args) => {
  try { return await fn(args ?? {}); } catch (e) { return { isError: true, ...text(e.message) }; }
};

const server = new McpServer({ name: 'loom-controller', version: '0.1.0' });

server.tool('step', 'Stick stâng SUS: un cuvânt înainte. Dacă nodul activ are copii vizibili, intră în copilul activ; altfel generează 5 siblingi (5 call-uri Ollama) și intră în primul sosit.', {},
  wrap(async () => { const r = await call('step'); return describe(r.state, r.result); }));
server.tool('sibling', 'Stick stâng STÂNGA/DREAPTA: sari pe siblingul anterior (dir=-1) sau următor (dir=1). La capătul listei generează unul nou (fără wraparound).',
  { dir: z.number().int().default(1) },
  wrap(async ({ dir }) => { const r = await call('sibling', { dir }); return describe(r.state, r.result); }));
server.tool('up', 'Stick stâng JOS: coboară la părinte.', {},
  wrap(async () => { const r = await call('up'); return describe(r.state, r.result); }));
server.tool('goto', 'Mută cursorul pe un nod după id (ce nu poate stick-ul: sări oriunde).', { id: z.number().int() },
  wrap(async ({ id }) => { const r = await call('goto', { id }); return describe(r.state); }));
server.tool('follow_human', 'Sari cu cursorul tău pe nodul unde e cursorul omului.', {},
  wrap(async () => {
    const st = (await call('state')).result;
    const hc = st.cursors.find(c => c.role === 'human');
    if (!hc) throw new Error('niciun browser conectat');
    const r = await call('goto', { id: hc.active });
    return describe(r.state);
  }));
server.tool('path', 'Textul căii curente (rădăcină → cursor), plus siblingii și copiii nodului activ.', {},
  wrap(async () => { const r = await call('state'); return describe(r.state); }));
server.tool('tree', 'Tot arborele, ca listă de noduri {id, parent_id, text, hidden, bookmarked}.', {},
  wrap(async () => { const r = await call('state'); return text({ active: r.state.active, nodes: r.state.nodes.map(({ id, parent_id, text, hidden, bookmarked }) => ({ id, parent_id, text, hidden: hidden || undefined, bookmarked: bookmarked || undefined })) }); }));
server.tool('hide', 'Ascunde (sau arată) un nod și subarborele lui. Nu șterge nimic; nodurile ascunse nu contează la navigare, dar contează la dedup.',
  { id: z.number().int().optional(), hidden: z.boolean().default(true) },
  wrap(async (a) => { const r = await call('hide', a); return describe(r.state); }));
server.tool('bookmark', 'Pune / scoate o stea pe un nod.', { id: z.number().int().optional(), bookmarked: z.boolean().default(true) },
  wrap(async (a) => { const r = await call('bookmark', a); return describe(r.state); }));
server.tool('settings', 'Citește sau schimbă model / temperature / top_k / top_p / min_p / num_predict (setări globale). Pentru evantaie mai variate: temperature 1.3–1.7 cu min_p 0.03–0.1 (și top_p 1) lărgește coada dar taie delirul; top_k mic (3–5) o îngustează.',
  { model: z.string().optional(), temperature: z.number().optional(), top_k: z.number().int().optional(), top_p: z.number().optional(), min_p: z.number().optional(), num_predict: z.number().int().optional() },
  wrap(async (a) => text((await call('settings', a)).result)));
server.tool('new', 'Arbore nou cu promptul de start dat (rădăcina).', { prompt: z.string() },
  wrap(async ({ prompt }) => { const r = await call('new', { prompt }); return describe(r.state); }));
server.tool('save', 'Salvează sesiunea ca JSON pe disc (în sessions/).', { name: z.string().optional() },
  wrap(async (a) => text((await call('save', a)).result)));
server.tool('load', 'Încarcă o sesiune salvată.', { name: z.string() },
  wrap(async (a) => { const r = await call('load', a); return describe(r.state); }));
server.tool('sessions', 'Listează sesiunile salvate.', {},
  wrap(async () => text((await call('sessions')).result)));

await server.connect(new StdioServerTransport());
