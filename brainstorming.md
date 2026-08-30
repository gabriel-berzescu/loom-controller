# loom-controller

> Un loom (arbore de completări LLM, în tradiția Janus / cyborgiști) controlat
> în întregime dintr-un gamepad Logitech. Ollama generează local, joystick-ul
> stâng scrie, joystick-ul drept plimbă camera peste copacul de posibilități.

## 1. Conceptul

- **Loom** = textul nu e liniar, ci un arbore: din orice punct poți genera
  continuări alternative, le compari, alegi una, continui, revii.
- **Twist-ul nostru**: fără tastatură, fără mouse. Tot loop-ul de
  generare–explorare–selecție se face din controller, ca într-un joc.
  Textul devine ceva ce *pilotezi*, nu ceva ce scrii.
- Generare: **Ollama** (local, streaming). Cuvântul „motor" înseamnă în tot
  documentul procesul Node care ține arborele.
- Granularitate = **cuvânt**: un nod = un cuvânt. Loom token-level, mai fin
  decât loom-urile clasice pe paragrafe.

## 2. Controllerul

**Doar cele 4 axe ale celor două stick-uri.** Fără butoane, fără L3/R3.
Tot ce nu încape pe stick-uri (salvare, model, temperatură, prompt de start,
bookmark, ascundere) se face din UI-ul web sau din Claude Desktop prin MCP.

Stick-ul stâng e izomorf cu arborele, care crește de jos în sus ca o plantă:
**sus = copii, stânga/dreapta = siblingi, jos = părinte.** Există un singur
nod activ („cursorul") și doar stick-ul stâng îl mișcă. Stick-ul drept nu
atinge cursorul: e camera — face pan peste arbore ca să te uiți în jur.
Camera urmărește singură cursorul; orice mișcare a stângului o aduce înapoi
pe el.

### Stick stâng — capul de scriere

- **Neutru** → nimic.
- **Sus** → generează un cuvânt nou: un nod copil, cursorul intră în el.
  Ții împins → curge textul (deflexia = viteza: ușor = un cuvânt per impuls,
  la maxim = flux continuu).
  *Dacă nodul are deja copii vizibili*, sus **nu generează**, ci intră în
  copilul activ (ultimul vizitat sau primul).
  Alternative noi se cer explicit, cu stânga/dreapta la capătul listei;
  altfel fiecare revenire ar umple arborele cu copii neceruți.
- **Stânga / dreapta** → te muți pe un sibling (alt cuvânt, aceeași poziție).
  La fiecare pas în sus care generează, motorul face **5 siblingi deodată**
  (5 call-uri scurte în paralel; capul intră în primul sosit, restul se
  așază în ordinea sosirii), deci stânga/dreapta are din start prin ce te
  plimba. Lista **nu se învârte în cerc**: capătul e capăt, iar dacă împingi
  mai departe la capăt → se mai generează un sibling. Împingi în sus din
  siblingul ales → generarea continuă de acolo → o ramură nouă.
- **Jos** → părinte.

### Stick drept — camera

Nu mișcă cursorul, nu generează nimic. **Orice direcție** → pan peste
arbore în direcția aia (deflexia = viteza). Lași stick-ul → camera rămâne
unde ai dus-o, până la următoarea mișcare a stângului, când sare înapoi pe
cursor.

## 3. Generarea

- Un cuvânt = un call la `/api/generate` cu `raw: true`, `num_predict` 10–20,
  temperatură > 0 (setare globală, din UI/MCP). Siblingii diferă doar prin
  `seed` (salvat în nod → reproductibil).
- **Tăierea:** treci *peste* whitespace-ul de la începutul răspunsului (îl
  păstrezi în nod), oprește-te la primul whitespace de după — ce ai până
  acolo e nodul. Punctuația lipită („was,") rămâne parte din cuvânt. Dacă nu
  apare niciun whitespace, accepți ce ai. Cu streaming, motorul închide
  call-ul imediat ce apare whitespace-ul de după cuvânt.
- Nodul ține **exact ce a dat modelul**, inclusiv whitespace-ul/newline-ul
  dinainte; textul căii = nodurile lipite cap la cap (`join("")`).
- **Dedup** pe `text.trim()`: se păstrează primul sosit; dacă din 5 rămân
  mai puțin, rămân atâția, fără reîncercare. Același lucru la „+1 la capătul
  listei": dacă iese un dublu, nu apare nimic, UI-ul semnalează scurt.
  Siblingii ascunși contează la dedup.
- **Fără logprobs** — alternativele sunt toate noduri reale, fără ordine pe
  probabilitate.
- Un singur model o dată: `gemma4:e2b` (principal), `gemma3:270m` pentru
  teste rapide. Modelul se ține cald cu `keep_alive`.

## 4. Arhitectura

```
Claude Desktop ──stdio──▶ mcp-shim.js ──WS──▶ ┐
                                              ├─ motor loom (Node, pornit manual)
Browser (gamepad + UI) ─────────────WS──────▶ ┘        arborele · Ollama · JSON pe disc
```

- **Motorul** e un proces Node local, pornit manual (`node motor.js`). Deține
  arborele, vorbește cu Ollama (`localhost:11434` — browserul nu atinge Ollama
  direct), servește pagina web + WebSocket pe un port local și salvează/încarcă
  sesiunile ca JSON pe disc.
- **Shim-ul MCP** e procesul stdio lansat de Claude Desktop din
  `claude_desktop_config.json`; doar traduce tool-urile în mesaje WebSocket
  către motor. Dacă motorul nu rulează, tool-urile răspund „motorul nu e pornit".
  stdio, nu HTTP/Custom Connector: pentru un tool local e singurul canal care
  nu cere URL public, OAuth sau bridge.
- Ambii clienți văd același arbore, live — există un singur motor.
- **Tool-urile MCP** = un controller virtual: `step` (cuvânt nou), `sibling`
  (următorul/anteriorul, generând la nevoie), `up` (părinte), `path` (textul
  căii curente), `save`/`load`, prompt de start, bookmark/hide. Util ca să
  testezi motorul din Claude Desktop și pentru mod „co-pilot": Claude
  explorează ramuri, tu decizi din controller.
- **Browserul**: Gamepad API nativ. Controller **Logitech F310** cu
  comutatorul pe **X (XInput)** → mapare `standard` (axe 0/1 = stick stâng,
  axe 2/3 = stick drept).

### Date

- Nod = `{ id, parent_id, text, model, params (temp, seed), created_at,
  bookmarked, hidden }`. Siblingii = copiii aceluiași părinte, în ordinea
  creării.
- **Noduri ascunse** (`hidden`, setat din UI/MCP; undo = scoți flag-ul, nu
  se șterge nimic): pentru navigare și pentru „nodul are copii?" nu există
  (stick-urile le sar; dacă toți copiii sunt ascunși, sus generează din nou),
  dar contează la dedup.
- Arborele întreg = un JSON per sesiune, scris de motor pe disc.

## 5. UI-ul

- **Panou de citire**: textul căii curente (rădăcină → cursor), concatenat,
  cu cuvântul curent evidențiat și siblingii lui listați.
- **Arborele** desenat vertical, rădăcina jos, crește în sus (ca stick-ul
  stâng); stick-ul drept îl deplasează.
  Arborele arată cuvintele-nod stivuite; textul ca text e în panoul de citire.
- Setări din UI: model, temperatură, prompt de start (fișier/clipboard —
  singurul loc unde e permisă tastatura 🙂), salvare/încărcare, bookmark,
  ascundere.

## 6. De măsurat / de decis în timp ce construim

- **Latența per cuvânt** cu `gemma4:e2b` (pe `gemma3:270m` ~5 ms/token):
  e destul de mică pentru flux continuu? Un pas = 5 call-uri de 10–20 tokeni
  în paralel.
- **Deadzone & repeat-rate**: cât de împins = „împins", la ce interval se
  repetă pasul (stânga/dreapta trebuie să se simtă ca un scroll bun, nu ca o
  mitralieră).
- **Base vs. instruct**: gemma din Ollama e instruct; un base model pur
  (`raw: true`) e mai „multiversal".
- **Layout-ul arborelui**: spacing și cum se văd ramurile ascunse.
