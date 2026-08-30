# loom-controller — brainstorming

> Un loom (arbore de completări LLM, în tradiția Janus / cyborgiști) controlat
> în întregime dintr-un gamepad Logitech. Ollama generează local, joystick-ul
> stâng generează text, joystick-ul drept navighează prin copacul de posibilități.

## 1. Conceptul de bază

- **Loom** = interfață în care textul nu e liniar, ci un arbore: din orice punct
  poți genera N continuări alternative, le compari, alegi una, continui, revii.
- **Twist-ul nostru**: fără tastatură, fără mouse. Tot loop-ul de
  generare–explorare–selecție se face din controller, ca într-un joc.
  Textul devine ceva ce *pilotezi*, nu ceva ce scrii.
- Motor: **Ollama** (local, gratuit, streaming, are `logprobs` din 2025 —
  important, vezi §3).

## 2. Maparea controllerului

> **Decizie (Gabriel):** stick-ul stâng e „capul de scriere" — mișcarea lui
> e izomorfă cu geometria arborelui. Dreapta = adâncime, sus/jos = lățime.
> Stick-ul stâng *crește* arborele, stick-ul drept *explorează* arborele.

### Joystick stânga — „capul de scriere" (designul ales)

- **Neutru** → nu se întâmplă nimic.
- **Dreapta** → generează cuvânt după cuvânt: fiecare cuvânt = un nod copil
  nou, capul de scriere coboară în el. Ții împins → curge textul.
  (Deflexia poate controla viteza: împins ușor = un cuvânt per impuls,
  împins la maxim = flux continuu.)
- **Sus / jos** → noduri sibling: cuvinte *alternative* pe aceeași poziție.
  Truc de implementare: cerem `logprobs` cu top-k la fiecare generare, deci
  alternativele există deja local — sus/jos doar cyclează prin ele,
  **instant, fără call nou la Ollama**. Sus = alternative mai probabile,
  jos = mai improbabile (sau invers; de testat ce e intuitiv).
  Abia când împingi la dreapta dintr-un sibling ales, generarea continuă
  din acea alternativă → se naște o ramură nouă reală.
- **Stânga** → nimic (rezervat). Mersul la părinte e treaba stick-ului
  drept — vezi decizia „un singur cursor" mai jos.
- **L3 (click)** → de rezervat (poate: comite/bookmark cuvântul curent).

> **Decizie: un singur cursor (MVP).** Capul de scriere și cursorul de
> navigare sunt același lucru — ambele stick-uri mișcă același nod activ,
> dar cu roluri diferite: stângul *crește* (dreapta = cuvânt nou,
> sus/jos = alternative), dreptul *se plimbă* (inclusiv stânga = părinte).
> Fără dublură pe „stânga".
>
> *Upgrade ulterior (Varianta 2, parcat):* două cursoare separate — capul
> de scriere (stick stâng) și un cursor de explorare/camera (stick drept),
> cu R3 = „teleportează capul de scriere la cursorul de explorare".
> Util când arborele crește și vrei să recitești o ramură fără să-ți muți
> punctul de creștere. Cere două highlight-uri vizuale distincte.

Granularitatea = **cuvânt** (generăm tokeni până la graniță de whitespace),
nu chunk-uri — ăsta e un loom token-level/word-level, mai fin decât
loom-urile clasice pe paragrafe.

#### Variante vechi, păstrate ca parcare de idei
- *Pedală de accelerație:* doar axa Y = viteză de generare.
- *Temperatura pe axa X* în timp ce textul curge — ar putea reveni pe
  alt control (ex. LT analogic = temperatură?).
- *Token surfing radial:* top-k tokeni așezați radial, unghiul stick-ului
  alege — înlocuit de sus/jos prin siblings, care e același concept dar
  mapat pe geometria arborelui.

### Joystick dreapta — „navigatorul"
- Sus / jos → frate anterior / următor (siblings — completările alternative).
- Stânga → urcă la părinte.
- Dreapta → coboară în copilul „activ" (ultimul vizitat sau primul).
- R3 (click) → centrează view-ul pe nodul curent / zoom fit.

### Butoane (de negociat)
- **A** → „ramifică aici": generează N completări noi din nodul curent.
- **B** → șterge / ascunde ramura curentă (cu undo!).
- **X** → bookmark / stea pe nod (nodurile bune se pierd ușor în multivers).
- **Y** → colapsează/expandează subarborele.
- **LB / RB** → schimbă modelul Ollama (multiverse cu voci diferite —
  aceeași ramificare, modele diferite).
- **LT / RT (analogice):** LT = lungimea completării (câți tokeni per ramură),
  RT = numărul de ramuri N generate la un „branch".
- **Start** → salvează snapshot; **Select/Back** → toggle overlay cu maparea.
- **D-pad** → istoric de navigare (back/forward prin nodurile vizitate).

## 3. Arhitectură & stack

> **Decizii (Gabriel):**
> - **Web app** (Opțiunea A). Gamepad API nativ în browser.
> - **Controller: Logitech F310** — comutatorul de pe spate pe **X (XInput)**:
>   mapare standard în Gamepad API (`standard` mapping: axe 0/1 = stick stâng,
>   axe 2/3 = stick drept, butoane 0–3 = A/B/X/Y).
> - **Modele locale** (`ollama list`, Ollama 0.32.9):
>   `gemma4:e2b` (7.2 GB, modelul principal) și `gemma3:270m` (291 MB,
>   perfect pentru teste rapide de integrare).
> - ✅ **`logprobs` CONFIRMAT** (testat 2026-08-15 pe `/api/generate` cu
>   `logprobs: true, top_logprobs: 5, raw: true`): fiecare token vine cu
>   top-k alternative + logprob. Ex.: „The forest was" → „ a" cu
>   alternativele „ alive", „ silent", „ filled", „ shrouded" — exact
>   materia primă pentru siblingii instant din §2. `raw: true` merge și el.

### Opțiunea A: Web app (aleasă)
- Browserul are **Gamepad API nativ** — zero drivere, zero biblioteci native,
  Logitech-ul e văzut out of the box.
- UI: canvas/SVG pentru arbore (d3-hierarchy, sau layout propriu simplu).
- Ollama expune HTTP + streaming (`/api/generate`, `/api/chat`) pe
  `localhost:11434` → fetch direct din pagină (atenție la CORS:
  `OLLAMA_ORIGINS=*` sau un mic proxy).
- Persistență: începe cu `localStorage`/fișier JSON exportat; SQLite mai târziu.
- Plus: vizualizarea arborelui în web e teren bătătorit.

### Opțiunea B: Python desktop
- `pygame` pentru joystick (matur, cross-platform) + UI în pygame sau
  `textual`/TUI pentru arbore.
- Ollama prin biblioteca `ollama` de Python.
- Plus: totul într-un singur proces, ușor de hackuit; minus: viz de arbore
  frumoasă în pygame = muncă multă.

### Opțiunea C: Hibrid
- Backend Python (joystick + Ollama + starea arborelui) → WebSocket →
  frontend web doar pentru randare. Mai multe piese, dar separă bine
  „simularea" de „ecran". Probabil overkill pentru MVP.

### Server MCP (pentru Claude Desktop)

> **Decizie (Gabriel): transport stdio.** Serverul e un proces local pornit
> de Claude Desktop din `claude_desktop_config.json` (`command` + `args`),
> nu un Custom Connector. Motive:
> - Connectors cer URL public + OAuth (conexiunea trece prin infra Anthropic);
>   pentru un tool local, cu Ollama pe `localhost`, n-are sens.
> - HTTP local ar merge doar cu un bridge (`mcp-remote`) — complicație inutilă.
> - Config-ul Desktop deja are alte servere stdio (memory, windows-terminal),
>   deci se adaugă la fel.
>
> Rol: Claude Desktop ca „controller virtual" — aceleași operații ca stick-urile
> (pas înainte, cyclează alternative, urcă la părinte, citește calea curentă),
> expuse ca tool-uri peste același arbore. Util pentru testat motorul fără
> gamepad și pentru „co-pilot": Claude explorează ramuri, tu decizi.
>
> *De revenit:* dacă serverul MCP și web app-ul trebuie să vadă *același*
> arbore live (nu doar același JSON pe disc), motorul iese într-un proces
> separat (Opțiunea C, hibrid) și MCP-ul devine doar un client subțire al lui.

### Date
- Nod = `{ id, parent_id, text, model, params (temp, seed), created_at,
  bookmarked, collapsed }`.
- Arborele întreg = un JSON per „sesiune de loom". Format ideal: ceva
  compatibil / convertibil cu loom-urile existente (Loomsidian folosește
  JSON-ul propriu; merită o privire pentru interop).

## 4. Idei extra (parcarea de idei)

- **Rumble/vibrație** ca feedback: vibrează proporțional cu perplexitatea /
  surpriza tokenului generat. Simți când modelul „ezită". (Gamepad API are
  `vibrationActuator` în Chrome.)
- **Mod „autopilot"**: ține A apăsat → loom-ul ramifică singur breadth-first
  și tu doar navighezi prin ce a crescut.
- **Heatmap pe ramuri**: colorează muchiile după logprob mediu — vezi din
  avion care ramuri sunt „probabile" și care sunt exotice.
- **Două modele în duel**: LB/RB nu doar schimbă modelul, ci generează
  aceeași ramificare cu ambele și le pune față în față.
- **Mod prezentare/perfomance**: loom-ul pe proiector, tu cu controllerul
  wireless — text generat live ca instrument muzical.
- **Import prompt de start** din fișier / clipboard (singurul moment în care
  e permisă tastatura 🙂).

## 5. Întrebări deschise

1. ~~Suportă modelul ales `logprobs` în Ollama?~~ **DA — confirmat**, vezi §3.
   Siblingii instant din top-k sunt fezabili.
2. **Latența per cuvânt** cu `gemma4:e2b`: e destul de mică pentru „flux
   continuu" când ții stick-ul împins? (Pe `gemma3:270m` eval-ul a fost
   ~5ms/token; e2b va fi mai lent — de măsurat.) Dacă nu → pre-generăm în
   avans (lookahead pe ramura activă cât timp stick-ul e neutru).
   Atenție și la **cold start**: primul call după idle a avut ~8s load —
   ținem modelul cald cu `keep_alive`.
3. **Cuvânt vs. token pe ecran**: generăm token-level dar afișăm/nodăm la
   graniță de cuvânt — unde exact tăiem (whitespace? punctuație?).
4. **Base model vs. instruct?** Pentru loom în stil Janus, un base model
   (fără chat template, `raw: true`) e mai „multiversal"; gemma din Ollama
   e instruct — merge pentru început, dar de încercat și un base pur.
5. **Layout-ul arborelui**: orizontal obligatoriu (textul curge la dreapta,
   ca să corespundă cu stick-ul: dreapta = copii, sus/jos = frați).
   De decis doar spacing-ul și cum colapsăm ramurile moarte vizual.
6. **Deadzone & repeat-rate** pe stick-uri: cât de împins = „împins",
   la ce interval se repetă pasul (sus/jos prin siblings trebuie să se
   simtă ca un scroll bun, nu ca o mitralieră).

## 6. MVP propus (o seară–două de lucru)

1. Pagină web care detectează F310-ul (Gamepad API) și afișează starea
   stick-urilor. Verificat că maparea `standard` e activă (switch pe X).
2. Un nod rădăcină cu un prompt hardcodat (mai târziu: paste din clipboard).
3. **Stick stâng dreapta** → Ollama generează următorul cuvânt (+ top-k
   alternative din logprobs, stocate pe nod) → nod copil, capul coboară.
4. **Stick stâng sus/jos** → cyclează prin alternativele deja stocate
   (siblings instant). **Stânga** → înapoi la părinte.
5. Panou de citire: textul căii curente (rădăcină → capul de scriere),
   concatenat, cu cuvântul curent evidențiat.
6. Salvare/încărcare JSON.

Stick-ul drept (navigare liberă prin tot arborele), rumble, autopilot etc.
vin abia după ce bucla de scriere *se simte* bine în mână.

---
*Document viu — adaugă/taie cu încredere.*
