# Bonsai Local IDE 2.1.0 — segunda capa

**Fecha:** 31-oct-2026  
**Tag:** `v2.1.0`  
**Base:** 2.0.0 (precisión local) sin cambios de motor.

## La idea

2.0 mejoró lo que rodea al modelo: visión, investigación y Hub. 2.1 ataca las
dos piezas que más se notaban al trabajar —**editor y terminal**— y añade
búsqueda de código y contratos de herramientas. Todo sigue siendo local; el
motor llama.cpp no cambia.

## Lo nuevo

### Editor CodeMirror 6 (opt-in)

- Bundle local de CodeMirror 6 + lenguajes JS/TS/TSX, Python, JSON, HTML, CSS,
  Markdown, Rust, Go, Java y C/C++.
- Undo/redo real, multi-cursor, búsqueda, plegado, autocompletado y
  Ctrl+K/Ctrl+S integrados con el resto del IDE.
- Se activa en **Ajustes → Editor moderno (CodeMirror)**. El editor clásico
  sigue siendo el camino por defecto y el *fallback* si el bundle no está.
- El bundle se sirve desde `chat/ui/vendor/editor.js`; no hay CDN.

### Terminal xterm + ConPTY

- `@xterm/xterm` 6 + `addon-fit` + `addon-web-links` para colores, resize,
  enlaces y scrollback.
- `node-pty` 1.1 opcional para un PTY de verdad (programas TUI, Ctrl+C real).
- Si `node-pty` no está o falla, el panel cae a tuberías y a un `<pre>` sin
  romper el turno. `BONSAI_PTY=0` fuerza el modo clásico.
- Nuevo `accion: "resize"` en `/api/terminal` para que el PTY siga al panel.

### Búsqueda de código

- `Ctrl+Shift+F` usa **ripgrep** (`@vscode/ripgrep`), respeta `.gitignore` y
  limita a **800 KB por archivo**.
- El agente gana `buscar_estructural`: **ast-grep** con metavariables
  (`console.log($$$ARGS)`) en JS/TS/TSX/HTML/CSS.
- Endpoint nuevo: `GET /api/search/estructural?q=...&lang=ts`.
- Si ripgrep o ast-grep no están, hay fallback claro; el IDE no depende de
  ellos para arrancar.

### Contratos y llguidance

- **Zod 4** define los argumentos de las tools nuevas, los valida y genera JSON
  Schema reproducible (`chat/tool-schemas.mjs`).
- **llguidance** es una opción de compilación, no una dependencia npm:
  `npm run build:llguidance` compila llama.cpp con `LLAMA_LLGUIDANCE=ON`.
  Requiere Rust/cargo y el commit de llama.cpp debe incluir el soporte.
- Si no se compila, todo sigue funcionando con GBNF/JSON Schema normal.

## Novedades de calidad

- `npm test` → **45/45** suites aisladas.
- `npm run test:navegador` → **7/7**.
- `npm audit --prefix chat` → **0 vulnerabilidades**.
- Bundles locales verificados por `prueba-editor-moderno.mjs`; búsqueda por
  `prueba-code-search.mjs`; schemas por `prueba-tool-schemas.mjs`.

## Actualizar desde 2.0.0

```powershell
git pull
npm ci --prefix chat
.\scripts\bonsai-rtx4060.ps1 launch
```

No hace falta borrar `models/`, `chat/ui-settings.json` ni `chat/ui-chats/`.
El editor moderno empieza **apagado**; actívalo en Ajustes cuando quieras.

## Limitaciones honestas

- CodeMirror es opt-in: se probó con Ctrl+K, guardado y montaje de xterm, pero
  el editor clásico sigue siendo el más rodado.
- `node-pty` es un módulo nativo. En Windows necesita MSVC/ConPTY; si falla, el
  terminal funciona en modo tuberías.
- ast-grep cubre JS/TS/TSX/HTML/CSS; para Python/Rust/Go/Java se usa ripgrep.
- llguidance requiere Rust y un build aparte; no se activa por defecto.

## Enlaces

- [README](../README.md)
- [CHANGELOG](../CHANGELOG.md)
- [DEPENDENCIAS-2.0](DEPENDENCIAS-2.0.md)
- [LLGUIDANCE](LLGUIDANCE.md)
- [Novedades 2.1](graficos/novedades-2.1.svg)
