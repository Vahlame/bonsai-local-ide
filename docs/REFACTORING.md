# Refactorización y desmonolitización

Este documento es la fuente de verdad del trabajo de limpieza. La regla es simple:
**primero se descompone el monolito Node.js sin cambiar de tecnología; después se
decide, componente por componente, si merece la pena un sidecar en Rust.**

## 1. Principios

1. **Sin cambios de comportamiento en cada extracción.** Mover código no es
   reescribirlo. Los contratos HTTP, SSE y de herramientas se mantienen.
2. **Dependencias explícitas.** Un módulo recibe lo que necesita por parámetro o
   por un objeto de contexto; no lee variables globales de `ui-server.mjs`.
3. **Una responsabilidad por módulo.** Estado, E/S, validación y presentación no
   viven en el mismo archivo.
4. **Cada fase se verifica.** `npm run audit` + suites aisladas + la suite
   específica del área tocada. Nada se da por terminado sin pruebas.
5. **Borrar código muerto con evidencia.** Un módulo solo se elimina si no lo
   importa nadie, no es punto de entrada y no está documentado como API pública.

## 2. Punto de partida (2026-11-02)

| Archivo | Líneas | Problema |
|---|---:|---|
| `chat/bonsai-chat.mjs` | 1898 | Cliente, sesión, prompt, compactación y streaming en una clase |
| `chat/diagnosticos.mjs` | 1748 | Diagnóstico y símbolos de 6 lenguajes en un archivo |
| `chat/server/agent-loop.mjs` | 1503 | Turno completo: petición, SSE, herramientas y cierre |
| `chat/model-hub.mjs` | 1099 | Catálogo, escaneo, descargas y trabajos |
| `chat/ui-server.mjs` | 1066 | Composition root + servicios + estado mutable |
| `chat/context.mjs` | 922 | Reglas, presupuesto y selección de contexto |
| `chat/actions.mjs` | 879 | Esquemas, parser y efectos de herramientas |
| `chat/coder-harness.mjs` | 850 | Harness, verificación y tareas del coder |
| `chat/model-plan.mjs` | 842 | Planificación de modelos y perfiles |

## 3. Arquitectura objetivo

```
chat/
  ui-server.mjs                 # solo composición y arranque
  server/
    services/                   # estado y casos de uso sin HTTP
      settings.mjs
      workspace.mjs
      commands.mjs
      history.mjs
      rules.mjs
      git.mjs
      permissions.mjs
      project-search.mjs
      symbol-index.mjs
      stats.mjs
      launcher.mjs
      folder-picker.mjs
      background-processes.mjs
      output-log.mjs
    security-headers.mjs        # CSP y cabeceras de la UI
    observability.mjs           # request-id, /api/health y log estructurado
    contracts.mjs               # Zod, validación y OpenAPI
    routes/                     # adaptadores HTTP finos
    agent/                      # turno del agente, SSE y ejecución de herramientas
  core/                         # motor de chat, contexto, acciones (sin HTTP)
  red-segura.mjs                # política SSRF única (DNS, IPs, redirecciones)
  ui/                           # navegador
```

Regla de dependencias: `routes -> services -> core`. `ui-server.mjs` conoce a
todos y nadie importa `ui-server.mjs`.

## 4. Fases

### Fase 0 · Auditoría y red de seguridad (hecha)

- [x] `scripts/audit-code.mjs`: imports rotos, huérfanos, archivos > 500 líneas,
      deuda marcada y `.bak` versionados.
- [x] `npm run audit` y `npm run audit:strict`.
- [x] Documento de arquitectura y fases.
- [x] Línea base de pruebas: `actions`, `modelo`, `tool-registry`,
      `server-workspace`, `server-text`, `api`, `servidor-estado`.

### Fase 1 · Composition root del servidor (hecha)

Extraer de `ui-server.mjs` sin cambiar el contrato de `routeContext`:

- [x] `services/settings.mjs`: ajustes, migración de versión, aplicación al chat.
- [x] `services/workspace.mjs`: carpeta activa, persistencia y payload.
- [x] `services/commands.mjs`: entorno de comandos, Python y `runCommand`.
- [x] `services/history.mjs`: archivado, carga, creación y borrado de chats.
- [x] `services/rules.mjs`: reglas de proyecto.
- [x] `services/git.mjs`: ejecución de git con errores distinguibles.
- [x] `services/permissions.mjs`: modo de permisos y espera de autorización.
- [x] `services/project-search.mjs`: búsqueda acotada en el proyecto.
- [x] `services/symbol-index.mjs`: índice de símbolos con caché.
- [x] `services/stats.mjs`: métricas de `/api/state`.
- [x] `services/launcher.mjs`: comando reproducible de llama-server.
- [x] `services/folder-picker.mjs`: selector nativo de carpeta.
- [x] `services/background-processes.mjs`: procesos vivos/terminados.
- [x] `services/output-log.mjs`: registro acotado de salidas del agente.
- [x] `ui-server.mjs` por debajo de 500 líneas (414).
- [x] Pruebas nuevas: `chat/prueba-servicios-servidor.mjs` (34 comprobaciones).

### Fase 2 · Turno del agente (hecha)

- [x] Separar parseo/validación de la petición (`agent/request.mjs`).
- [x] Separar helpers de contexto y prompt (`agent/helpers.mjs`, `agent/prompt.mjs`).
- [x] Separar sesión SSE, latido y cancelación (`agent/sse-session.mjs`).
- [x] Separar filas de acción (`agent/action-rows.mjs`).
- [x] Separar ejecución de herramientas (`agent/present.mjs`, `agent/verify.mjs`).
- [x] `agent-loop.mjs` por debajo de 500 líneas (455).

### Fase 3 · Motor de chat (hecha)

- [x] `session-store.mjs`: carga, validación, metadatos y guardado atómico de la sesión.
- [x] `llama-client.mjs`: transporte HTTP, `ApiError`, conexión y conteo de prompt.
- [x] `prompting.mjs`: razonamiento, muestreo y campos de herramientas.
- [x] `compaction.mjs`: resumen, notas de respaldo y empaquetado legacy/coder.
- [x] `context/prompts.mjs`: textos de sistema, `agentText`, descripción de llamadas y limpieza de notas.
- [x] `context/budget.mjs`: presupuesto y recorte por tokens.
- [x] `context/history.mjs`: selección, plegado y anclas del historial.
- [x] `actions/*`: texto, edición, diff, efectos y archivos separados.
- [x] `bonsai-chat.mjs` de 1963 a ~1100 líneas; `context.mjs` a ~330; `actions.mjs` a ~219.

### Fase 4 · Herramientas de desarrollo (hecha)

- [x] `diagnosticos.mjs` dividido en `diagnostics/analysis.mjs` y `diagnostics/symbols.mjs` (fachada de 78 líneas).
- [x] `model-hub.mjs` dividido en `common`, `store`, `remote`, `downloads` y `jobs` (fachada de 8 líneas).
- [x] `coder-harness.mjs` dividido en `coder/contracts.mjs` y `coder/task.mjs` (fachada de 3 líneas).
- [x] `model-plan.mjs` dividido en `model-plan/gguf.mjs` y `model-plan/planner.mjs` (fachada de 16 líneas).

### Fase 5 · Interfaz (parcial)

- [x] `ui/format.mjs`: formateadores puros compartidos por `app.js` y `hub.js`
      (tokens, bytes, ETA, KV y texto de plan).
- [x] `chat-core.js` dividido en siete scripts clásicos: estado/render, live,
      acciones, chat/cola, entrada/adjuntos, turno/paneles y arranque.
- [x] `ui/app-git.mjs`: chip, menú, selección de archivos y lista de cambios.
- [x] `ui/app-search.mjs`: búsqueda en todo el proyecto (Ctrl+Shift+F).
- [x] `ui/app-rules.mjs`: visor y chip de reglas del proyecto.
- [ ] `app.js` por dominios restantes (editor, ajustes, memoria, Ctrl+K).
- [ ] Eliminar duplicación entre scripts clásicos y módulos ES.

La UI se deja para el final a propósito: `index.html` carga scripts clásicos que
comparten `let`/`const`/`function` globales. Partirla sin un arnés de navegador
estable sería más arriesgado que útil. `prueba-ui-humo` y `prueba-editor` siguen
en verde tras la extracción de `format.mjs`.

### Fase 6 · Código muerto (hecha)

- [x] Eliminado `chat/optimized-agent-integration.mjs` (sin importadores).
- [x] Eliminado `chat/agent-profiles-optimized.json` (sin importadores).
- [x] Documentación actualizada para no referenciar módulos borrados.
- [x] Auditoría automática de huérfanos e imports rotos.

### Fase 7 · Seguridad y rendimiento (hecha en lo crítico)

- [x] Política SSRF única en `chat/red-segura.mjs`: DNS con todas las IPs,
      rangos privados/reservados, metadatos de nube y redirecciones manuales.
- [x] Integración en investigación, Model Hub (cabeceras y descargas) y MCP.
- [x] `fetchFijado` conecta a la IP comprobada y conserva Host/SNI: rebinding
      cerrado entre la resolución y la conexión.
- [x] CSP estricta y cabeceras globales (`server/security-headers.mjs`); scripts
      inline movidos a `ui/theme-boot.js` y `ui/stats-boot.js`.
- [x] Caché de stats con TTL e invalidación; índice de símbolos en worker con
      caché; ETag/304 en `/api/file` y en el polling del editor.
- [x] `snapshotFiles` omite carpetas pesadas y enlaces; caché con `fs.watch` para
      el snapshot previo a comandos; poda de trabajos del Hub; rotación de
      `timings`/`raw-stream`.
- [x] Terminal por SSE (`/api/terminal/stream`) con `Last-Event-ID` y heartbeat.
- [x] `/api/health`, `X-Request-Id` y log JSON de peticiones lentas/5xx con
      redacción de secretos y rutas (`server/observability.mjs`).
- [x] Zod + `/api/openapi.json` para los endpoints de escritura críticos.
- [x] `reports/`: solo resúmenes curados en Git; crudos locales ignorados.
- [x] axe-core en la suite de navegador y `npm run check:syntax` en CI.
- [x] `npm run check:reports` impide que vuelvan las ejecuciones crudas a Git.
- [x] CI ejecuta `npm run audit`, `check:syntax`, `check:reports` y las 10 suites
      de navegador.

Pendiente de esta fase: snapshot posterior incremental, sondeos de git/modelos
bajo demanda, contrato Zod para el resto de rutas y lint/typecheck/cobertura.

## 5. Migración a Rust (decisión posterior a la Fase 1)

No se reescribe la app en Rust. Se migran solo componentes con una frontera
clara y una ganancia medible. Candidatos, en orden:

1. **Índice de workspace y búsqueda de texto** (`project-search`, `symbol-index`):
   CPU puro, sin estado de UI, contrato JSON simple. Sidecar o N-API.
2. **Almacén de sesiones/historial** (`history`, `almacen-json`): escritura
   atómica, validación y recuperación ante corrupción.
3. **Escaneo y hash de modelos** (`model-hub`): I/O intensivo y verificable.
4. **Diagnósticos**: solo si se integra un parser maduro (tree-sitter/rust-analyzer).

Criterios para migrar: contrato estable, pruebas diferenciales Node↔Rust,
medición antes/después y posibilidad de volver atrás con una variable de entorno.
La UI y el bucle del agente se quedan en Node hasta que exista una razón medida.

## 6. Puertas de calidad

```powershell
npm run audit          # estructura
npm run audit:strict   # además falla por huérfanos o archivos > 500 líneas
npm test               # suites aisladas (sin GPU)
node scripts/run-tests.mjs navegador   # suites de navegador
```

Cada fase debe dejar el árbol de trabajo con `npm run audit` sin imports rotos y
con las suites del área en verde.

## 7. Estado tras esta pasada (2026-11-02)

| Área | Antes | Ahora |
|---|---:|---:|
| `ui-server.mjs` | 1066 | 414 |
| `agent-loop.mjs` | 1509 | 455 |
| `bonsai-chat.mjs` | 1963 | ~1140 |
| `context.mjs` | 982 | ~330 |
| `actions.mjs` | 910 | ~219 |
| `diagnosticos.mjs` | 1822 | 78 (fachada) |
| `model-hub.mjs` | 1145 | 8 (fachada) |
| `coder-harness.mjs` | 857 | 3 (fachada) |
| `model-plan.mjs` | 881 | 16 (fachada) |
| `chat/ui/chat-core.js` | 1998 | 425 + 6 scripts clásicos (todos < 600) |

Módulos grandes que quedan, por orden de riesgo:

1. `chat/ui/app.js` (Fase 5, estado global de la UI; `chat-core` ya está dividido).
2. `chat/diagnostics/analysis.mjs` (diagnósticos por lenguaje).
3. `chat/bonsai-chat.mjs` (`streamSlice`/`runTurn`).
4. `chat/server/agent/present.mjs` (ejecución de herramientas del turno).
5. `chat/coder/task.mjs` (máquina de estados del coder).

Ninguno es un import roto ni código muerto: son los siguientes cortes naturales.
