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
- Generare: **Ollama** (local, gratuit, streaming). *(Cuvântul „motor" e
  rezervat în restul documentului pentru procesul Node care ține arborele.)*

## 2. Maparea controllerului

> **Decizie (Gabriel):** stick-ul stâng e „capul de scriere" — mișcarea lui
> e izomorfă cu geometria arborelui. **Sus = adâncime (copii), stânga/dreapta
> = lățime (siblingi), jos = părinte.** Arborele crește de jos în sus, ca o
> plantă. Stick-ul stâng *crește* arborele, stick-ul drept *explorează* arborele
> (aceeași geometrie pe ambele; „jos = părinte" e executat doar de dreptul,
> vezi „un singur cursor").
> *(2026-08-30: rotit cu 90° trigonometric față de varianta inițială, care
> avea dreapta = copii, sus/jos = siblingi, stânga = părinte.)*

> **Decizie (Gabriel, 2026-08-30): fără logprobs.** Toate alternativele sunt
> noduri reale, generate fiecare cu un call scurt la Ollama
> (`num_predict` ≈ 10–20, cât să nu taie cuvântul; motorul taie textul după
> primul cuvânt complet). Fără ierarhie probabil/improbabil — ordinea
> siblingilor e ordinea în care au sosit răspunsurile. Simplu, și fiecare nod
> e ceva ce poți continua direct.

### Joystick stânga — „capul de scriere" (designul ales)

- **Neutru** → nu se întâmplă nimic.
- **Sus** → generează cuvânt după cuvânt: fiecare cuvânt = un nod copil
  nou, capul de scriere urcă în el. Ții împins → curge textul.
  (Deflexia poate controla viteza: împins ușor = un cuvânt per impuls,
  împins la maxim = flux continuu.)
  *Dacă nodul are deja copii* (te-ai întors pe o ramură veche), sus **nu
  generează**, ci intră în copilul activ (ultimul vizitat sau primul) —
  exact ca stick-ul drept. Alternative noi se cer explicit, cu
  stânga/dreapta la capătul listei. Altfel fiecare revenire ar umple
  arborele cu copii de care nu ai cerut.
- **Stânga / dreapta** → te muți pe un sibling (alt cuvânt, aceeași
  poziție). *La fiecare* pas în sus motorul generează **5 siblingi deodată**
  (5 call-uri scurte în paralel, aceeași temperatură (setare globală, > 0),
  doar `seed`-ul diferă per sibling; dedup pe cuvinte identice — dacă rămân mai puțin de 5, rămân
  atâția, fără reîncercare), iar capul intră în primul sosit, ca să nu
  aștepți restul. Ordinea siblingilor = ordinea sosirii răspunsurilor. Deci stânga/dreapta are din start prin ce cycla.
  Ajungi la capătul listei și împingi în continuare → se mai generează unul.
  Împingi în sus din siblingul ales → generarea continuă de acolo → s-a
  născut o ramură nouă.
- **Jos** → nimic (rezervat). Mersul la părinte e treaba stick-ului
  drept — vezi decizia „un singur cursor" mai jos.
  *Excepție temporară, în MVP:* cât timp stick-ul drept nu e încă legat,
  jos = coboară la părinte, ca să poți reveni. Se scoate când intră dreptul.
- **L3 (click)** → nimic. Fără click-uri pe stick-uri (vezi decizia „doar axele").

> **Decizie: un singur cursor (MVP).** Capul de scriere și cursorul de
> navigare sunt același lucru — ambele stick-uri mișcă același nod activ,
> dar cu roluri diferite: stângul *crește* (sus = cuvânt nou,
> stânga/dreapta = siblingi, generând la nevoie), dreptul *se plimbă*
> (inclusiv jos = părinte, stânga/dreapta = doar prin siblingii existenți).
> Fără dublură pe „jos".
>
> *Upgrade ulterior (Varianta 2, parcat):* două cursoare separate — capul
> de scriere (stick stâng) și un cursor de explorare/camera (stick drept),
> cu „teleportează capul de scriere la cursorul de explorare" — fără click
> pe stick, deci de găsit un gest din axe (ex. ambele stick-uri împinse în
> aceeași direcție).
> Util când arborele crește și vrei să recitești o ramură fără să-ți muți
> punctul de creștere. Cere două highlight-uri vizuale distincte.
> Camera urmărește cursorul de explorare, deci centrarea rămâne automată.

Granularitatea = **cuvânt** (cerem 10–20 de tokeni și tăiem la prima graniță
de whitespace),
nu chunk-uri — ăsta e un loom token-level/word-level, mai fin decât
loom-urile clasice pe paragrafe.

#### Variante vechi, păstrate ca parcare de idei
- *Pedală de accelerație:* doar axa Y = viteză de generare.
- *Temperatura pe axa X* în timp ce textul curge — axa X e luată de
  siblingi, iar butoane nu vrem; temperatura rămâne o setare din UI/MCP,
  nu de pe controller.
- *Token surfing radial:* top-k tokeni așezați radial, unghiul stick-ului
  alege — înlocuit de stânga/dreapta prin siblingi, care e același concept
  dar mapat pe geometria arborelui.
- *Candidați din `logprobs`:* alternativele instant din `top_logprobs`,
  fără call nou. Testat că Ollama le dă (2026-08-15), dar renunțat: sunt pe
  primul token, nu pe cuvânt, și complică modelul (noduri virtuale vs. reale).
  5 call-uri scurte fac același lucru mai curat.

### Joystick dreapta — „navigatorul"
- Stânga / dreapta → frate anterior / următor (doar prin ce există; nu generează).
- Jos → coboară la părinte.
- Sus → urcă în copilul „activ" (ultimul vizitat sau primul).
- R3 (click) → nimic. Camera urmărește automat nodul activ, deci nu e
  nevoie de „centrează".

> **Decizie (Gabriel, 2026-08-30): cât mai puține butoane — ideal doar cele
> două stick-uri.** Tot ce e mai jos e *parcat*: idei de butoane, nu mapare.
> Ce nu încape pe stick-uri (salvare, schimbat modelul, temperatură) se face
> din UI-ul web sau din Claude Desktop prin MCP, nu de pe controller.
> Nici L3/R3: **doar cele 4 axe.** Camera urmărește singură nodul activ.

### Butoane (parcate — nu fac parte din design)
- **A** → „ramifică aici": generează N completări noi din nodul curent.
  Nu contrazice „un cuvânt = un nod": fiecare completare e un *lanț* de
  noduri-cuvânt (o ramură de lungime L), iar A le crește pe toate N deodată.
  Diferența față de stick-ul stâng stânga/dreapta: acolo compari *un cuvânt*,
  aici compari *fraze întregi*. Fiecare lanț vine dintr-un singur call lung
  (`num_predict` ≈ L cuvinte), spart apoi în noduri-cuvânt; nodurile din lanț
  **nu** primesc automat cei 5 siblingi — aceia apar doar dacă ceri explicit
  (stânga/dreapta la capătul listei), ca la orice ramură revizitată.
- **B** → ascunde ramura curentă (soft-delete: flag `hidden` pe nod, deci
  undo = scoți flag-ul; nu ștergem nimic din JSON).
- **X** → bookmark / stea pe nod (nodurile bune se pierd ușor în multivers).
- **Y** → colapsează/expandează subarborele.
- **LB / RB** → schimbă modelul Ollama (multiverse cu voci diferite —
  aceeași ramificare, modele diferite).
- **LT / RT (analogice):** LT = lungimea L a completării (câte cuvinte per
  ramură), RT = numărul de ramuri N generate la un „branch".
- **Start** → salvează snapshot; **Select/Back** → toggle overlay cu maparea.
- **D-pad** → istoric de navigare (back/forward prin nodurile vizitate).

## 3. Arhitectură & stack

> **Decizii (Gabriel):**
> - **Web UI + motor separat** (Opțiunea A+C, vezi mai jos). Gamepad API
>   nativ în browser; arborele și Ollama stau într-un proces Node local.
> - **Controller: Logitech F310** — comutatorul de pe spate pe **X (XInput)**:
>   mapare standard în Gamepad API (`standard` mapping: axe 0/1 = stick stâng,
>   axe 2/3 = stick drept, butoane 0–3 = A/B/X/Y).
> - **Modele locale** (`ollama list`, Ollama 0.32.9):
>   `gemma4:e2b` (7.2 GB, modelul principal) și `gemma3:270m` (291 MB,
>   perfect pentru teste rapide de integrare).
> - **Generarea unui cuvânt** = un call la `/api/generate` cu `raw: true`,
>   `num_predict` 10–20, temperatură > 0; motorul taie răspunsul după primul
>   cuvânt complet (primul whitespace după text non-alb; whitespace-ul de
>   dinainte rămâne în nod). Siblingii = același
>   call de 5 ori, fiecare cu alt `seed` (salvat în nod → reproductibil).
>   Testat 2026-08-15 că `raw: true` merge.

### Arhitectura aleasă: motor + două fețe

```
Claude Desktop ──stdio──▶ mcp-shim.js ──WS──▶ ┐
                                              ├─ motor loom (Node, pornit de Gabriel)
Browser (gamepad + UI) ─────────────WS──────▶ ┘        arborele · Ollama · JSON pe disc
```

- **Motorul** e un proces Node local, **pornit manual de Gabriel**
  (`node motor.js`). El deține arborele, vorbește cu Ollama
  (`localhost:11434`, deci fără CORS — browserul nu atinge Ollama direct),
  servește pagina web + WebSocket pe un port local și salvează/încarcă
  sesiunile ca JSON pe disc.
- **Serverul MCP** e un *shim* subțire: procesul stdio pe care îl lansează
  Claude Desktop din `claude_desktop_config.json` (ca la memory,
  windows-terminal), care doar traduce tool-urile în mesaje WebSocket către
  motor. Dacă motorul nu rulează, tool-urile răspund „motorul nu e pornit".
- Ambii clienți (Claude, browserul) văd același arbore, live, pentru că
  există un singur motor.

### De ce stdio și nu HTTP / Custom Connector

- Custom Connectors în Claude Desktop cer URL public + OAuth (conexiunea trece
  prin infra Anthropic) — absurd pentru un tool local cu Ollama pe localhost.
- HTTP local ar merge doar printr-un bridge (`mcp-remote`) — complicație inutilă.
- stdio nu constrânge UI-ul cu nimic: e doar canalul Claude ↔ motor.

### Rolul serverului MCP

Claude Desktop ca **„controller virtual"**: aceleași operații ca stick-urile
(pas înainte, sari pe siblingi, coboară la părinte, citește calea curentă,
ramifică — ultimul după MVP, vezi §6), expuse ca tool-uri peste același arbore. Util pentru:
- testat motorul *înainte* să existe vreun UI sau gamepad;
- mod „co-pilot": Claude explorează ramuri, tu decizi din controller.

### Opțiuni considerate

- **A: Web app pur** (respinsă ca atare, absorbită în A+C) — browserul ar fi
  chemat Ollama direct (ar fi cerut `OLLAMA_ORIGINS=*`) și ar fi persistat în
  `localStorage`. Ambele dispar odată ce există motorul.
- **B: Python desktop** (respinsă) — `pygame` pentru joystick + UI în
  pygame/TUI. Totul într-un proces, dar viz de arbore frumoasă în pygame =
  muncă multă, și n-ar avea cum să fie și server MCP pentru Desktop decât cu
  încă un proces.
- **C: Hibrid** — backend care ține starea → WebSocket → frontend web doar
  pentru randare. Părea overkill pentru MVP, dar serverul MCP *e* exact acest
  backend, deci vine gratis. De aici A+C.

### Date
- Nod = `{ id, parent_id, text, model, params (temp, seed),
  created_at, bookmarked, collapsed, hidden }`. Siblingii = copiii aceluiași părinte,
  în ordinea creării.
- Arborele întreg = un JSON per „sesiune de loom", scris de motor pe disc.
  Format ideal: ceva compatibil / convertibil cu loom-urile existente
  (Loomsidian folosește JSON-ul propriu; merită o privire pentru interop).

## 4. Idei extra (parcarea de idei)

- **Rumble/vibrație** ca feedback: vibrează proporțional cu perplexitatea /
  surpriza tokenului generat. Simți când modelul „ezită". (Gamepad API are
  `vibrationActuator` în Chrome.) *Notă:* decizia „fără logprobs" e despre
  cum facem siblingii; nu ne oprește să cerem `logprobs` ca **metadata** pe
  nodul generat (Ollama le dă) — de asta depind și rumble-ul, și heatmap-ul.
- **Mod „autopilot"**: ține A apăsat → loom-ul ramifică singur breadth-first
  și tu doar navighezi prin ce a crescut.
- **Heatmap pe ramuri**: colorează muchiile după logprob mediu (vezi nota de
  la rumble) — vezi din avion care ramuri sunt „probabile" și care sunt exotice.
- **Două modele în duel**: LB/RB nu doar schimbă modelul, ci generează
  aceeași ramificare cu ambele și le pune față în față.
- **Mod prezentare/perfomance**: loom-ul pe proiector, tu cu controllerul
  wireless — text generat live ca instrument muzical.
- **Import prompt de start** din fișier / clipboard (singurul moment în care
  e permisă tastatura 🙂). Sau din Claude Desktop, prin tool-ul MCP.

## 5. Întrebări deschise

1. ~~Suportă modelul ales `logprobs` în Ollama?~~ Da, dar nu le mai folosim
   (vezi §2, „variante vechi").
2. **Latența per cuvânt** cu `gemma4:e2b`: e destul de mică pentru „flux
   continuu" când ții stick-ul împins? (Pe `gemma3:270m` eval-ul a fost
   ~5ms/token; e2b va fi mai lent — de măsurat.) Cu 5 siblingi per pas,
   costul unui pas e ~5 call-uri de 10–20 tokeni — probabil ok, dar de
   măsurat; cele 5 pot rula în paralel. Dacă nu → pre-generăm în avans
   (lookahead pe ramura activă cât timp stick-ul e neutru).
   Atenție și la **cold start**: primul call după idle a avut ~8s load —
   ținem modelul cald cu `keep_alive`.
3. ~~**Cuvânt vs. token pe ecran**: unde exact tăiem?~~ Rezolvat — regula
   de tăiere din motor: ia răspunsul, treci *peste* whitespace-ul de la
   început (îl păstrezi în nod, vezi §5.6), oprește-te la primul whitespace
   de după — ce ai până acolo e nodul.
   Dacă în 10–20 de tokeni nu apare niciun whitespace (cuvânt lung, URL),
   accepți ce ai. Punctuația lipită („was,") rămâne parte din cuvânt.
4. **Base model vs. instruct?** Pentru loom în stil Janus, un base model
   (fără chat template, `raw: true`) e mai „multiversal"; gemma din Ollama
   e instruct — merge pentru început, dar de încercat și un base pur.
5. **Layout-ul arborelui**: vertical, rădăcina jos, crește în sus (ca să
   corespundă cu stick-ul: sus = copii, stânga/dreapta = frați, jos = părinte).
   Efect secundar de rezolvat: textul unui nod e orizontal, dar calea curge
   vertical — panoul de citire (§6.5) e cel care arată textul ca text; arborele
   arată doar cuvintele-nod stivuite. De decis spacing-ul și cum colapsăm
   ramurile moarte vizual.
6. ~~**Whitespace-ul din nod**~~ Decis (Gabriel, 2026-08-30): nodul ține
   **exact ce a dat modelul**, inclusiv whitespace-ul/newline-ul dinainte;
   calea = nodurile lipite cap la cap (`join("")`). Dedup-ul și eticheta din
   arbore folosesc `text.trim()`.
7. ~~**Cei „5 siblingi"**~~ Decis: **exact 5**, constantă fixă. (Nu mai există
   RT/N — vezi decizia „doar stick-urile".)
8. **Deadzone & repeat-rate** pe stick-uri: cât de împins = „împins",
   la ce interval se repetă pasul (stânga/dreapta prin siblingi trebuie să se
   simtă ca un scroll bun, nu ca o mitralieră).

## 6. MVP propus (o seară–două de lucru)

1. **Motorul** (Node, pornit manual): arbore în memorie + un nod rădăcină cu
   prompt hardcodat (mai târziu: din clipboard sau din Claude), generare
   cuvânt-cu-cuvânt cu tăiere după primul cuvânt, 5 siblingi per pas,
   WebSocket local, salvare/încărcare JSON.
2. **Shim MCP (stdio)** care vorbește cu motorul: `step` (cuvânt nou),
   `sibling` (următorul/anteriorul, generând la nevoie), `up` (părinte),
   `path` (textul căii curente), `save`/`load`. Legat în
   `claude_desktop_config.json` → **bucla de scriere se testează din
   Claude Desktop, fără UI și fără gamepad.**
3. Pagină web servită de motor, care detectează F310-ul (Gamepad API) și
   afișează starea stick-urilor. Verificat că maparea `standard` e activă
   (switch pe X).
4. **Stick stâng sus** → `step`; **stânga/dreapta** → `sibling`; **jos** → `up`
   (temporar, până intră stick-ul drept — vezi §2).
5. Panou de citire: textul căii curente (rădăcină → capul de scriere),
   concatenat, cu cuvântul curent evidențiat și siblingii lui listați.
6. Arborele desenat vertical, de jos în sus (poate fi rudimentar la început).

Stick-ul drept (navigare liberă prin tot arborele), rumble, autopilot etc.
vin abia după ce bucla de scriere *se simte* bine în mână.

---
*Document viu — adaugă/taie cu încredere.*

*Revizie de coerență (Claude, 2026-08-30): rezolvat conflictul „stânga" pe
stick-ul stâng (MVP vs. final); A vs. un-cuvânt-un-nod; R3 în Varianta 2; scos
CORS/localStorage odată cu motorul; Opțiunea C absorbită în arhitectura aleasă;
MVP reordonat cu motorul și MCP-ul primele. Apoi, decizii Gabriel în aceeași zi:
motorul pornit manual (MCP = shim), fără logprobs — siblingi reali din 5 call-uri
scurte, fără ordine pe probabilitate; stick-urile rotite 90° trigonometric
(sus = copii, stânga/dreapta = siblingi, jos = părinte), arborele crește în sus.*

*Revizie 2 (Claude, 2026-08-30): sus pe stick-ul stâng într-un nod cu copii
existenți intră în copilul activ, nu generează; „5 siblingi" e la fiecare pas,
în paralel, cu seed per sibling, fără reîncercare la dedup; L3 nu mai dublează
bookmark-ul de pe X; temperatura nu mai concurează cu LT (rămâne setare);
§5.3 marcat rezolvat.*

*Revizie 3 (Claude, 2026-08-30): „motor" = doar procesul Node (Ollama = generare);
siblingii diferă doar prin seed, temperatura e globală, ordinea = ordinea sosirii;
lanțurile de la A vin dintr-un call lung și nu primesc automat 5 siblingi; B =
ascunde (flag `hidden`), nu șterge; rumble/heatmap pot cere logprobs ca metadata;
`branch` în MCP abia după MVP; două întrebări noi în §5 (whitespace în nod, 5 vs. N).*

*Revizie 4 (decizii Gabriel, 2026-08-30): whitespace-ul dinaintea cuvântului
rămâne în nod, calea se lipește cu `""`; exact 5 siblingi, constantă; **doar
cele două stick-uri, fără L3/R3** — toate butoanele sunt parcate, camera urmărește
automat nodul activ, restul se face din UI/MCP.*
