# loom-controller

Loom pilotat din gamepad. Spec-ul complet: `brainstorming.md` (+ `brainstorming.html`, cu simulator).

## Pornire

```
npm install                # o singură dată
node motor.js              # motorul: http://localhost:7331 (model implicit gemma4:e2b)
LOOM_MODEL=gemma3:270m node motor.js   # sau cu modelul mic, pentru teste
```

Deschide http://localhost:7331 în Chrome, conectează F310-ul (switch pe **X**).
Stick stâng: sus = cuvânt, stânga/dreapta = siblingi, jos = părinte. Stick drept = pan.
Tastatură (fallback): `W A S D` / săgeți / `H` ascunde / `B` bookmark.

## Claude Desktop (MCP)

`mcp-shim.js` e legat în `claude_desktop_config.json` ca serverul `loom`. Tool-uri:
`step`, `sibling`, `up`, `goto`, `path`, `tree`, `hide`, `bookmark`, `settings`, `new`, `save`, `load`, `sessions`.
Motorul trebuie să ruleze; altfel tool-urile răspund „motorul nu e pornit".

## Fișiere

- `motor.js` — arborele, Ollama, HTTP + WebSocket, JSON în `sessions/`
- `mcp-shim.js` — MCP stdio → WebSocket
- `public/index.html` — UI-ul web + Gamepad API
