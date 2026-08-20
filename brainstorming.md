# loom-controller — brainstorming

> Un loom (arbore de completări LLM, în tradiția Janus / cyborgiști) controlat
> în întregime dintr-un gamepad Logitech. Ollama generează local, joystick-ul
> stâng generează text, joystick-ul drept navighează prin copacul de posibilități.
> Din 2026-08-20: nu mai e instrument solo — Claude țese și el, prin MCP.

## 1. Conceptul de bază

- **Loom** = interfață în care textul nu e liniar, ci un arbore: din orice punct
  poți genera N continuări alternative, le compari, alegi una, continui, revii.
- **Twist-ul nostru**: fără tastatură, fără mouse. Tot loop-ul de
  generare–explorare–selecție se face din controller, ca într-un joc.
  Textul devine ceva ce *pilotezi*, nu ceva ce scrii.
- **Twist-ul 2 (2026-08-20)**: nu ești singur la război(ul de țesut) —
  **două capete de scriere**: tu prin gamepad, **Claude prin MCP** (vezi §3).
  Loom-ul devine instrument de duet.
- Motor: **Ollama** (local, gratuit, streaming, are `logprobs` din 2025 —
  important, vezi §4).

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
>
> *Precizare 2026-08-20:* al doilea cursor a intrat oricum, pe ușa din
> spate — capul de scriere al lui **Claude** (§3). Dar nu consumă
> stick-uri: „un singur cursor" rămâne valabil pentru om; capul lui Claude
> e doar al doilea highlight de pe ecran.

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

## 3. Al doilea cap de scriere: Claude, co-țesător prin MCP

> **Decizie (Gabriel, 2026-08-20):** loom-ul se țese în doi — *„I get my
> controller, you get yours. Two writing heads."* Omul pilotează prin
> gamepad; Claude intră prin **MCP**: backend-ul (vezi §4) expune un server
> MCP, iar Claude Code / Claude Desktop de pe aceeași mașină se conectează
> la el.

- **Controllerul lui Claude = tool-urile MCP** — echivalentul mapării din §2,
  pentru celălalt țesător (draft, de negociat ca și butoanele):
  - `loom_read(node?)` — arborele / textul căii de la rădăcină la un nod.
  - `loom_state()` — pozițiile capetelor de scriere, bookmarks, ce s-a
    schimbat de la ultima privire.
  - `loom_weave(node, text)` — țese: adaugă o continuare din nodul ales.
  - `loom_branch(node, n)` — pune Ollama să crească n ramuri din nod
    (Claude poate „apăsa A" și el — grădinărit de multivers cu motorul
    local).
  - `loom_move(node)` — își mută capul de scriere (prezență vizibilă).
  - `loom_bookmark(node, notă?)` — stea + notă opțională: mici mesaje
    lăsate pe arbore, canal de comunicare între țesători.
- **De ce nu ne călcăm pe degete:** arborele e **append-only** — doi
  scriitori nu pot intra în conflict; cel mult cresc ramuri diferite din
  același nod, iar „ramuri alternative" e chiar conceptul de bază al
  loom-ului. Conflictul e doar încă un sibling. Zero lock-uri în MVP.
- **Vizual:** al doilea highlight, altă culoare — capul lui Claude se vede
  mișcându-se prin arbore în timp real (prin SSE, vezi §4).
- **Claude ≠ încă un model în LB/RB:** API-ul lui Claude nu dă logprobs și
  nu e motor token-level — Ollama rămâne motorul de siblings instant.
  Claude e *coleg*, nu motor: citește ramuri, țese chunk-uri proprii,
  comandă generări Ollama, marchează și lasă note.

## 4. Arhitectură & stack

> **Decizii (Gabriel):**
> - ~~**Web app** pur (Opțiunea A)~~ → **update 2026-08-20: Hibrid
>   (Opțiunea C)**. Avem nevoie de backend: el găzduiește **serverul MCP**
>   prin care intră Claude (§3). Gamepad API rămâne în browser; starea
>   arborelui și apelurile Ollama se mută în backend.
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

### Opțiunea A: Web app pur (fosta alegere — depășită ca arhitectură, UI-ul rămâne)
- Browserul are **Gamepad API nativ** — zero drivere, zero biblioteci native,
  Logitech-ul e văzut out of the box.
- UI: canvas/SVG pentru arbore (d3-hierarchy, sau layout propriu simplu).
- Ollama expune HTTP + streaming (`/api/generate`, `/api/chat`) pe
  `localhost:11434` → fetch direct din pagină (atenție la CORS:
  `OLLAMA_ORIGINS=*` sau un mic proxy).
- Persistență: începe cu `localStorage`/fișier JSON exportat; SQLite mai târziu.
- Plus: vizualizarea arborelui în web e teren bătătorit.
- *(Nota 2026-08-20: în hibrid, grija CORS/`OLLAMA_ORIGINS` dispare —
  Ollama e chemat doar din backend, iar pagina și API-ul au același origin.
  Persistența trece pe fișier scris de backend, nu `localStorage`.)*

### Opțiunea B: Python desktop
- `pygame` pentru joystick (matur, cross-platform) + UI în pygame sau
  `textual`/TUI pentru arbore.
- Ollama prin biblioteca `ollama` de Python.
- Plus: totul într-un singur proces, ușor de hackuit; minus: viz de arbore
  frumoasă în pygame = muncă multă.

### Opțiunea C: Hibrid (ALEASĂ — 2026-08-20, promovată din „probabil overkill")
- Backend = **sursa unică de adevăr**: starea arborelui, apelurile Ollama,
  persistența, și **serverul MCP** pentru Claude. Un singur proces, un
  singur port.
- **Transport MCP: Streamable HTTP** — un singur endpoint (`/mcp`):
  POST pentru mesajele JSON-RPC (răspuns fie JSON simplu, fie stream **SSE**
  pentru progres/streaming), GET pe același endpoint = stream SSE pentru
  mesajele inițiate de server. Sesiuni prin header `Mcp-Session-Id`.
  ⚠️ Capcană: transportul vechi „HTTP+SSE" (2024, cu endpoint separat
  `/sse`) e deprecated, dar încă apare în tutoriale — SDK-urile oficiale
  (`@modelcontextprotocol/sdk` pe TS, pachetul `mcp` pe Python) fac
  Streamable HTTP din cutie.
- **Browser ↔ backend: tot SSE** (EventSource nativ) pentru update-urile de
  arbore; input-ul (acțiunile din gamepad) → POST-uri simple. Fiecare
  direcție e unidirecțională, deci nu mai avem nevoie de WebSocket-ul din
  schița veche.
- **Diferență față de schița veche a Opțiunii C:** joystick-ul NU se mută
  în backend — Gamepad API din browser era partea care mergea perfect din
  Opțiunea A; browserul doar traduce input-ul în acțiuni semantice
  („grow", „cycle-sibling", „to-parent") și le trimite.
- **Securitate de localhost:** bind pe `127.0.0.1` (nu `0.0.0.0`) +
  validarea header-ului `Origin` — altfel orice pagină web deschisă în
  browser poate vorbi cu serverul (DNS rebinding). Cerință explicită din
  spec-ul MCP.
- **Clienți:** `claude mcp add --transport http loom http://127.0.0.1:8765/mcp`
  → Claude Code / Claude Desktop de pe aceeași mașină. (claude.ai din
  browser nu vede localhost — nu e o problemă pentru noi.)

### Date
- Nod = `{ id, parent_id, text, author (om | claude | ollama), model
  (motorul care a produs textul, dacă e cazul), params (temp, seed),
  created_at, bookmarked, notă?, collapsed }`.
- `author` + `notă` sunt noi (2026-08-20): cu două capete de scriere vrem
  să se vadă cine a țesut ce (și putem colora ramurile după autor). Nota de
  pe bookmark = mesaje mici lăsate celuilalt, direct pe arbore.
- Arborele întreg = un JSON per „sesiune de loom" — fișier pe disc, scris
  de backend. Format ideal: ceva compatibil / convertibil cu loom-urile
  existente (Loomsidian folosește JSON-ul propriu; merită o privire pentru
  interop).

## 5. Idei extra (parcarea de idei)

- **Rumble/vibrație** ca feedback: vibrează proporțional cu perplexitatea /
  surpriza tokenului generat. Simți când modelul „ezită". (Gamepad API are
  `vibrationActuator` în Chrome.)
- **Rumble de prezență**: puls scurt când Claude țese sau își mută capul —
  simți celălalt cap de scriere prin mâini, fără să te uiți la ecran.
- **Mod „autopilot"**: ține A apăsat → loom-ul ramifică singur breadth-first
  și tu doar navighezi prin ce a crescut.
- **Heatmap pe ramuri**: colorează muchiile după logprob mediu — vezi din
  avion care ramuri sunt „probabile" și care sunt exotice.
- **Două modele în duel**: LB/RB nu doar schimbă modelul, ci generează
  aceeași ramificare cu ambele și le pune față în față.
- **Mod prezentare/perfomance**: loom-ul pe proiector, tu cu controllerul
  wireless — text generat live ca instrument muzical. (Acum: duet om +
  Claude, live.)
- **Import prompt de start** din fișier / clipboard (singurul moment în care
  e permisă tastatura 🙂).

## 6. Întrebări deschise

1. ~~Suportă modelul ales `logprobs` în Ollama?~~ **DA — confirmat**, vezi §4.
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
7. **Coordonarea capetelor de scriere**: tehnic nu există conflict
   (append-only — „conflictul" e încă un sibling), dar social? Țesem
   simultan liber, sau turn-taking? Claude așteaptă când omul e în flux?
   De descoperit la primul duet, nu de decis în avans.
8. **Granularitatea lui Claude**: stick-ul țese cuvânt-cu-cuvânt; Claude
   scrie natural în fraze. Un `loom_weave` cu un chunk → auto-split în lanț
   de noduri-cuvânt (navigabil cu stick-ul!) sau un singur nod-chunk?
   Înclinație: auto-split, ca arborele să rămână omogen.
9. **Cum află Claude de schimbări**: implicit vede starea când cheamă un
   tool (polling conversațional); resource subscriptions există în spec-ul
   MCP dar clienții stau prost cu ele; un tool de long-poll
   (`loom_wait_for_changes`, blochează până se întâmplă ceva) ar fi trucul
   simplu ca Claude să „stea la pândă".
10. **Limbajul backend-ului**: Python (pachetul oficial `mcp`/FastMCP, e
    ASGI — poate servi și pagina și SSE-ul browserului) vs. Node/TS
    (`@modelcontextprotocol/sdk`, același limbaj cu frontend-ul). Ambele
    fac Streamable HTTP din cutie.

## 7. MVP propus (redimensionat pentru duet)

**Forma:** un singur proces backend care (a) ține arborele — sursa unică de
adevăr, (b) cheamă Ollama, (c) servește pagina statică, (d) împinge
update-uri spre browser prin SSE, (e) expune `/mcp`. Browserul citește
gamepad-ul și POST-ează acțiuni; tot ce randează vine de pe SSE.

1. Backend minim: arbore în memorie + salvare/încărcare JSON, endpoint de
   acțiuni, stream SSE, servire statică.
2. Pagină care detectează F310-ul (Gamepad API) și afișează starea
   stick-urilor. Verificat că maparea `standard` e activă (switch pe X).
3. Un nod rădăcină cu un prompt hardcodat (mai târziu: paste din clipboard).
4. **Stick stâng dreapta** → acțiune POST → backend cere următorul cuvânt
   de la Ollama (+ top-k alternative stocate pe nod) → nod copil, capul
   coboară, SSE împinge update-ul.
5. **Stick stâng sus/jos** → cyclează prin alternativele deja stocate
   (siblings instant, fără call). **Stânga (stick drept)** → înapoi la
   părinte.
6. Panou de citire: textul căii curente (rădăcină → capul de scriere),
   concatenat, cu cuvântul curent evidențiat.
7. **`/mcp` cu `loom_read`, `loom_state`, `loom_weave`** →
   `claude mcp add --transport http loom http://127.0.0.1:8765/mcp` →
   primul duet. 🧵

Restul (stick drept complet, rumble, autopilot, `loom_branch` & co.) vine
abia după ce duetul *se simte* bine în mână.

---
*Document viu — adaugă/taie cu încredere.*
