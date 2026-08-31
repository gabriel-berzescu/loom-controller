# spec.md — loom-controller

## 1. Rezumat

Un **loom** — arbore de completări LLM, în tradiția Janus / cyborgiști —
pilotat în întregime dintr-un **gamepad Logitech F310**. Ollama generează
local, cuvânt cu cuvânt; joystick-ul stâng scrie (navighează și generează),
joystick-ul drept plimbă camera peste arborele de posibilități. Claude Desktop
se poate conecta prin MCP ca al doilea explorator, cu propriul cursor peste
același arbore.

## 2. Obiective și non-obiective

**Obiective**

- Tot loop-ul generare–explorare–selecție se face de pe controller: textul e
  ceva ce *pilotezi*, nu ceva ce scrii.
- Granularitate **cuvânt**: un nod = un cuvânt. Mai fin decât loom-urile
  clasice pe paragrafe.
- Generare 100% locală (Ollama), fără servicii externe.
- Claude ca **co-weaver**: explorează ramuri în paralel prin MCP, omul decide
  de pe controller.

**Non-obiective**

- Fără logprobs / ordonare pe probabilitate — alternativele sunt toate noduri
  reale, egale.
- Fără ștergere de noduri — doar ascundere (`hidden`), reversibilă.
- Fără autentificare / multi-user peste rețea — totul e localhost.
- Un singur model încărcat o dată; fără comparații side-by-side între modele.

## 3. Experiența utilizatorului

### 3.1 Controllerul (F310, comutator pe X → mapare XInput `standard`)

Doar cele 4 axe ale stick-urilor, plus o singură excepție de butoane
(**Y = zoom in, A = zoom out**). Restul operațiilor (salvare, model,
temperatură, prompt de start, bookmark, ascundere) se fac din UI sau din
Claude prin MCP.

**Stick stâng — capul de scriere.** Izomorf cu arborele, care crește de jos
în sus ca o plantă:

| Direcție | Efect |
|---|---|
| Sus | Dacă nodul are copii vizibili → intră în **copilul activ** (ultimul vizitat, altfel primul). Dacă nu → generează **5 siblingi deodată** (5 call-uri Ollama în paralel), cursorul intră în primul sosit. |
| Stânga / dreapta | Sibling anterior / următor. **Fără wraparound**: la capătul listei, încă un împins generează un sibling nou (+1). |
| Jos | Părinte. |

Deflexia = viteza: repeat-rate-ul scade de la 650 ms (abia împins) la 170 ms
(la maxim); deadzone 0.62. Cât timp un pas e „în zbor" (călătorie la Ollama),
nu se trimite altul.

**Stick drept — camera.** Nu atinge cursorul, nu generează nimic: pan peste
arbore, deflexia = viteza (deadzone 0.15). Camera revine singură pe cursor la
următoarea mișcare a stick-ului stâng. Zoom între 0.25× și 3× din Y/A.

**Tastatură (fallback, fără gamepad):** `W A S D` = stick stâng,
săgeți = pan, `+`/`−` = zoom, `H` = ascunde, `B` = bookmark.

### 3.2 UI-ul web (`http://localhost:7331`)

- **Arborele**, desenat vertical: rădăcina jos, crește în sus (ca stick-ul
  stâng). Nodul activ portocaliu, calea curentă conturată, nodurile ascunse
  șterse și transparente, bookmark-urile cu ★. Cursorul lui Claude — contur
  verde punctat; butonul „→ Claude" îți sare cursorul la al lui. Click pe
  orice nod = `goto`. Cât se generează, apar 3 noduri fantomă „…".
- **Panoul de citire**: textul căii (rădăcină → cursor) concatenat, cuvântul
  curent evidențiat; sub el, siblingii nodului activ, clicabili.
- **Setări** (header): model, temperature, top_k, top_p, min_p, num_predict.
- **Acțiuni din UI**: ascunde, bookmark, salvează, încarcă sesiune, arbore
  nou cu prompt de start (singurul loc unde e permisă tastatura 🙂).

## 4. Arhitectura

```
Claude Desktop ──stdio──▶ mcp-shim.js ──WS──▶ ┐
                                              ├─ motor.js (Node, pornit manual)
Browser (gamepad + UI) ─────────────WS──────▶ ┘    arborele · Ollama · JSON pe disc
```

- **`motor.js`** — singura sursă de adevăr. Ține arborele în memorie, vorbește
  cu Ollama (`localhost:11434`; browserul nu atinge Ollama direct), servește
  `public/` pe HTTP și WebSocket pe același port (**7331**), salvează sesiuni
  ca JSON în `sessions/`. Pornit manual: `node motor.js`.
- **`mcp-shim.js`** — server MCP stdio subțire, lansat de Claude Desktop din
  `claude_desktop_config.json` (serverul `loom`). Doar traduce tool-urile în
  mesaje WebSocket către motor; dacă motorul nu rulează, tool-urile răspund
  „motorul nu e pornit". *De ce stdio și nu HTTP/Custom Connector:* pentru un
  tool local e singurul canal fără URL public, OAuth sau bridge.
- **`public/index.html`** — un singur fișier: UI + Gamepad API + client WS.

**Cursoare:** fiecare conexiune WS primește un cursor propriu, **efemer**
(moare cu conexiunea), peste același arbore partajat. Cursorul ține
`lastVisited` per nod-părinte, ca „sus" să reintre în copilul din care ai
venit. Toți clienții văd starea live prin broadcast după fiecare comandă.

## 5. Modelul de date

```
nod = { id, parent_id, text, model,
        params: { temperature, top_k, top_p, min_p, seed },
        created_at, bookmarked, hidden }
```

- `id` incremental; rădăcina are `parent_id: null` și `text` = promptul de start.
- Siblingii = copiii aceluiași părinte, **în ordinea creării** (a sosirii).
- `text` = **exact ce a dat modelul**, inclusiv whitespace-ul/newline-ul
  dinaintea cuvântului; textul căii = nodurile lipite cap la cap (`join("")`).
- **`hidden`** (setat din UI/MCP; undo = scoți flag-ul, nimic nu se șterge):
  pentru navigare nodul nu există — stick-urile îl sar, iar dacă toți copiii
  sunt ascunși, „sus" generează din nou. Ascunderea unui nod mută afară orice
  cursor aflat pe/sub el. Contează totuși la dedup.
- Sesiune = `{ settings, nodes: [...] }`, un JSON per sesiune pe disc.

## 6. Generarea

- Un cuvânt = un call `POST /api/generate` cu `raw: true`, `stream: true`,
  promptul = textul căii până la părinte. Siblingii diferă doar prin `seed`
  (salvat în nod → reproductibil).
- **Regula de tăiere:** sari peste whitespace-ul de la începutul răspunsului
  (îl păstrezi în nod), oprește-te la primul whitespace de după — regex
  `^\s*\S+\s` pe textul acumulat. Punctuația lipită („was,") rămâne în cuvânt.
  Cu streaming, call-ul se **abortează** imediat ce apare whitespace-ul de
  după cuvânt — nu aștepți `num_predict` tokeni. Dacă nu apare niciun
  whitespace, accepți ce s-a acumulat.
- **Dedup** pe `text.trim()` contra tuturor copiilor părintelui (inclusiv
  ascunși): primul sosit rămâne; dacă din 5 rămân mai puțini, atâția sunt,
  fără reîncercare. La „+1 la capăt", un dublu = nimic nou, UI-ul arată
  scurt „dublu — nimic nou".
- Setări globale (implicit): `model gemma4:e2b` (teste: `gemma3:270m`),
  `temperature 1.0`, `top_k 40`, `top_p 0.9`, `min_p 0.0`, `num_predict 16`,
  `keep_alive 30m` (modelul se ține cald, inclusiv cu un ping la pornire).

## 7. Protocolul WebSocket

Cerere: `{ id, cmd, params }` → răspuns `{ type:'result', id, cmd, result?, error?, state }`,
apoi broadcast `{ type:'state', state }` către toți clienții (fiecare cu
snapshot-ul din perspectiva cursorului lui). Erorile Ollama se difuzează ca
`{ type:'error', error }`.

Comenzi: `hello` (declari rolul: `human` / `claude`), `step`, `sibling {dir}`,
`up`, `goto {id}`, `path`, `state`, `hide {id?, hidden?}`,
`bookmark {id?, bookmarked?}`, `settings {…}`, `new {prompt}`, `save {name?}`,
`load {name}`, `sessions`. Aceleași comenzi pentru browser și MCP — tool-urile
MCP sunt literalmente un controller virtual.

## 8. Tool-urile MCP

`step`, `sibling`, `up`, `goto`, `follow_human` (sari la cursorul omului),
`path`, `tree`, `hide`, `bookmark`, `settings`, `new`, `save`, `load`,
`sessions`.

Fiecare răspuns de mișcare îi spune lui Claude: calea curentă, nodul activ cu
siblingii și copiii lui, și **unde e cursorul omului** — deci mod „co-pilot"
fără polling. Timeout per call: 120 s.

## 9. Configurare

| Variabilă | Implicit | Rol |
|---|---|---|
| `LOOM_PORT` | `7331` | portul motorului (HTTP + WS) |
| `LOOM_MODEL` | `gemma4:e2b` | modelul Ollama |
| `LOOM_PROMPT` | `Once upon a time` | rădăcina arborelui inițial |
| `OLLAMA_HOST` | `http://localhost:11434` | unde e Ollama |
| `LOOM_WS` | `ws://localhost:7331` | (shim) unde e motorul |

Dependențe: `ws`, `@modelcontextprotocol/sdk`, `zod`. Fără framework, fără
bundler, fără DB.

## 10. De măsurat / de decis în timp ce construim

- **Latența per cuvânt** cu `gemma4:e2b` (pe `gemma3:270m` ~5 ms/token): e
  destul de mică pentru flux continuu? Un pas = 5 call-uri scurte în paralel.
- **Deadzone & repeat-rate** (acum 0.62 / 170–650 ms): stânga/dreapta trebuie
  să se simtă ca un scroll bun, nu ca o mitralieră.
- **Base vs. instruct**: gemma din Ollama e instruct; un base model pur
  (`raw: true`) ar fi mai „multiversal".
- **Layout-ul arborelui** la arbori mari: spacing-ul și vizibilitatea
  ramurilor ascunse.
