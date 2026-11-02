# Changelog

Todos los cambios relevantes de Bonsai Local IDE se documentan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
versionado semántico.

## [2.4.12] - 2026-11-02

### Corregido

- **Espera del resumen de memoria global en el smoke.** El diálogo se abre antes
  de que responda `/api/memoria`; en CI el texto con “presupuesto” llegaba
  después. La prueba espera el resumen antes de comprobarlo.
- `v2.4.11` no se movió; este patch deja el CI estable en `main` y `master`.

## [2.4.11] - 2026-11-02

### Corregido

- **Invariante correcto del 409 en el smoke.** Si el editor no tenía cambios
  sin guardar, recargar el contenido externo es correcto; la prueba ya no exige
  conservar el texto viejo. Verifica que el disco no se pisa y que la propuesta
  de Ctrl+K nunca se aplica sobre el cambio externo.
- `v2.4.10` no se movió; este patch deja el CI estable en `main` y `master`.

## [2.4.10] - 2026-11-02

### Corregido

- **Smoke de navegador estable en CI.** El check del 409 normaliza CRLF/LF y
  espera al repintado de CodeMirror. GitHub Actions reintenta una vez el smoke
  si falla por timing; un fallo real sigue fallando.
- `v2.4.9` no se movió; este patch deja el CI de `main` y `master` verde.

## [2.4.9] - 2026-11-02

### Corregido

- **Smoke de navegador en CI.** En GitHub no hay modelos instalados y el Model
  Hub abría la pestaña `Instalados` vacía; ahora, si esa pestaña está vacía la
  primera vez, abre `Recomendados`. El smoke vuelve a encontrar tarjetas.
- La comprobación del editor de memoria global no depende de mayúsculas.
- `v2.4.8` no se movió: este patch corrige el CI publicado y deja una versión
  nueva para los usuarios.

## [2.4.8] - 2026-11-02

### Arquitectura

- `ui-server.mjs` baja de 4.115 a 1.055 líneas. El bucle de `/api/chat` vive en
  `chat/server/agent-loop.mjs` y los handlers HTTP en `chat/server/routes/`
  (`static`, `files`, `git`, `models`, `settings`, `chat`) con un `routeContext`
  explícito.
- `workspace.mjs` y `text.mjs` separan operaciones de carpeta y texto; los
  módulos no leen variables globales de `ui-server.mjs`.
- La UI estrena `core/dom.mjs`, `core/api.mjs`, `core/state.mjs`,
  `editor/text.mjs` y `workspace/paths.mjs`. `app.js`, `hub.js` y `paneles.js`
  son módulos ES; el diseño y los flujos no cambian.

### Tools

- `chat/tool-registry.mjs` es la fuente única de esquemas, validación,
  descripción, permisos y despacho de efectos para `PC_TOOLS` y `CODER_TOOLS`.
- `tool-schemas.mjs` deriva Zod del JSON Schema del registro.
- Se elimina la copia fantasma de `buscar_texto`; no existe una segunda tool
  solo para que un test compare dos copias.

### Parser legacy

- El parseo de tools escritas como texto se concentra en
  `chat/legacy-tool-parser.mjs`.
- Se añaden métricas en `GET /api/stats`, el flag
  `BONSAI_LEGACY_TOOL_PARSER=0` y fecha de retirada **2027-06-30**.

### Búsqueda web

- `buscar` puede usar una instancia propia de
  [SearXNG](https://github.com/searxng/searxng) mediante
  `BONSAI_SEARXNG_URL`, antes de los fallbacks DuckDuckGo/Bing.
- SearXNG no es una dependencia obligatoria; si no está configurado o falla, se
  conserva el camino anterior.
- Si un pedido de información actual/externa intenta responderse de memoria, el
  agente envía un único aviso para usar `buscar` y `leer_web`; no entra en bucle.
- Guía y límites de seguridad: `docs/INVESTIGACION-WEB.md`.

### Seguridad

- Un `--host` que no sea loopback exige `--unsafe-lan` y un token de al menos
  16 caracteres (`--token` o `BONSAI_UI_TOKEN`).
- El arranque con `/?token=...` deja cookie `HttpOnly` y redirige a `/`; la API
  acepta `X-Bonsai-Token` y `Authorization: Bearer`.
- `start-ui.ps1` acepta `-UnsafeLan` y `-Token`.

### CI y pruebas

- Nuevo job de smoke de navegador en GitHub Actions.
- `prueba-lanzador.mjs` crea y verifica un acceso directo real en `%TEMP%`.
- Nuevas suites: `prueba-server-workspace`, `prueba-server-text`,
  `prueba-tool-registry`, `prueba-legacy-tool-parser` y `prueba-lan-auth`.
- Total: 56/56 tests aislados y 9/9 de navegador.

## [2.4.7] - 2026-11-02

### Arquitectura

- Primer corte modular de `ui-server.mjs`: se extraen `server/http.mjs`
  (argumentos, cuerpo, MIME y rutas), `server/catalog.mjs` (catálogo y elección
  de modelo), `server/gpu.mjs`, `server/browser.mjs` y `server/undo.mjs`.
- `ui-server.mjs` baja de 4.504 a 4.115 líneas y deja de mezclar esas políticas
  con el router.
- `chat/server/README.md` documenta las fronteras actuales y la siguiente
  extracción segura: handlers con contexto explícito y bucle del agente.
- `copia-app.mjs` incluye los nuevos módulos para que la copia de evaluación
  siga arrancando aislada.

## [2.4.6] - 2026-11-02

### Corregido

- **Medidor de contexto del perfil de código.** `reportUsage` ahora lee la
  memoria extractiva y los grupos descartados de `contextDiagnostics` en lugar
  de `session.memory`/`session.folded` (que el perfil `small-local-coder` no
  usa). La barra muestra `memoria N extractiva` y `grupos plegados N`; antes
  enseñaba `memoria 0` con un prompt que ya llevaba miles de tokens de extractos.
- **Primer turno más directo.** `AGENT_WORKFLOW` y la fase `PLAN` indican que,
  si el usuario pide un plan, propuesta o preguntas antes de implementar, el
  agente responda primero sin inspeccionar archivos por rutina. Además,
  `pideAclaraciones()` desactiva las herramientas solo en el primer salto de
  ese pedido (`tool_choice: none`): la respuesta inicial no empieza con un
  `indice`/`leer` innecesario.
- **Documentación de seguridad.** `SECURITY.md` ya no declara soporte de 1.2.x;
  la tabla refleja la línea 2.4.x.
- **Marketing del README.** «El mejor» pasa a una descripción defendible:
  inferencia local sin API cloud, con búsquedas web y descargas del Hub
  opcionales.
- **Compactación documentada.** `CONTEXTO-Y-DIAGNOSTICO.md` explica que el
  perfil de código usa memoria extractiva por petición, no `session.memory`.

## [2.4.5] - 2026-11-02

### Corregido

- **Sin resumen fantasma.** Si el modelo ya entregó una respuesta útil (por
  ejemplo un plan con preguntas), el servidor ya no lanza el turno de cierre
  que sustituía esa respuesta por «Resumen del trabajo realizado». Solo se
  fuerza el cierre cuando el assistant quedó vacío o solo anunció una acción.
- **Verificación solo con trabajo real.** Un plan que termina preguntando algo
  ya no dispara la verificación automática: antes fallaba sin cambios, marcaba
  `unresolved_verification` y encadenaba el resumen.
- **La UI no auto-continúa con respuesta visible.** «Continuar solo hasta
  terminar» solo encola otro turno si el assistant no dejó texto; si hay una
  respuesta, el usuario puede contestar a sus preguntas.
- **Detección de anuncios más estricta.** «Hecho. Ahora calcula…» ya no se
  confunde con «Voy a…»; solo cuenta un inicio de acción futuro y nunca una
  respuesta con `?`.
- Regresión en `prueba-agente-limites` (caso 21: leer → plan con preguntas).

## [2.4.4] - 2026-11-02

### Corregido

- **Cabecera sin solapes.** El grupo `Preguntar / Ejecutar todo` desbordaba
  hacia la izquierda sobre `Navegación / Editor` cuando la columna flexible
  medía menos que su contenido. `justify-self: start` lo deja después del grupo
  de paneles y la cabecera compacta se activa hasta 1500 px (antes 1360), así
  que a 1440/1366 tampoco se desbordan las acciones por la derecha.
- **Contexto en la barra inferior.** El chip `contexto 32K · hist. 26K` pasa
  del grupo de acciones al `statusbar`: sigue visible a 1440/1366 sin robar
  ancho a la cabecera y el test de humo vuelve a encontrarlo.
- **Diálogo de inicio actualizado.** Ordenaba por los benchmarks antiguos de
  coding/web app y marcaba GPT-OSS como recomendado. Ahora usa
  `modeloRecomendado` y `benchmarkTareas`: Qwen3.6 35B-A3B sale primero con
  **90/100 tareas** y GPT-OSS muestra **41/100**. También se distingue
  `% proyecto` de `% web app`.
- **Regresión de datos.** `chat/modelo.mjs` comprueba que Qwen3.6 es el
  recomendado y que el benchmark de tareas lo pone por delante de GPT-OSS.

## [2.4.3] - 2026-11-02

### Corregido

- El acceso directo del escritorio vuelve a abrir la UI. `ui-server.mjs` acepta
  `--think -1` (razonamiento sin límite); antes el lanzador pasaba `-1` y Node
  abortaba con el error de presupuesto de tokens antes de escuchar en 8787.
- La ventana de Edge también vuelve a abrirse: `openBrowser()` ya no usa
  PowerShell `detached` + `stdio: "ignore"`, que fallaba en silencio en Windows.
- Regresión de `--think -1` cubierta por `chat/prueba-servidor-estado.mjs`
  (check 17); el arranque real del `.lnk` se verificó con UI y Edge abiertos.

### Documentación

- Aclarado que **Qwen3.6 35B-A3B (MoE)** es el modelo principal y la
  recomendación actual. GPT-OSS 20B queda como alternativa Harmony; se
  corrigieron las guías que aún lo presentaban como agente principal.

## [2.4.2] - 2026-11-01

### CI y portabilidad

- `start-gpu-model.ps1 -DryRun` ya no exige los GGUF ni el proyector: calcula el
  plan y la linea de comandos en un clon limpio. El arranque real sigue
  verificando presencia y tamano exactos.
- `chat/prueba-api.mjs` valida que el catalogo refleje el disco (bytes y
  `existe`) sin exigir que los modelos esten instalados.
- GitHub Actions usa `checkout@v7`, `setup-node@v7` y `setup-python@v7`; se
  elimina el aviso de Node 20.
- Verificacion con los GGUF de Ornith y su proyector ausentes: 51/51 tests
  aislados, 9/9 suites de navegador y `-DryRun` en verde.
- `scripts/check-ui.cjs` deriva el nombre de las capturas de la version real de
  la UI (`ui-2.4.2-*.png`); README y auditoria apuntan a las nuevas.

## [2.4.1] - 2026-11-01

### Calidad

- Auditoría completa: 168 archivos Node, 32 PowerShell, 28 Python, 618 JSON y
  55 SVG; 51/51 tests, 0 enlaces rotos y 0 errores de consola en la UI.
- BOM eliminado de tres JSON generados.
- Rutas portables en los scripts de benchmark y checkers; helper
  `scripts/lib/playwright.cjs`.
- CI de Windows con Node 22 y Python 3.12: enlaces, tests y `npm ci`.
- OOM de UI/visión corregido con el reparto conservador del plan (22 capas de
  expertos en CPU para Qwen3.6).
- `-1` es sin límite y `-2` automático; `pensar=0` se respeta y los modelos sin
  razonamiento no reciben presupuesto.
- Medidor de contexto y etiqueta `ventana` actualizados al cambiar de modelo.
- Helper de benchmark en UTF-8; checker de fluidos pausados y favicon.
- Reserva de pensamiento sin doble suma en `sliceCap`.
- Nuevos `CONTRIBUTING.md`, `docs/AUDIT-2026-11-01.md` y
  `docs/RELEASE-2.4.1.md`.

## [2.4.0] - 2026-11-01

### Benchmark de modelos y tareas (2026-11-01)

#### Añadido

- Matriz reproducible de **7 modelos × 4 tareas** (fluidos, juego, app CRUD y
  Skyblock), con prompts, workspaces aislados, checkers de Edge headless y
  capturas.
- **Qwen3.6 35B-A3B**: 90/100 en tres repeticiones y 36–40 tok/s. Fluidos 98,
  juego 94, app 92 y Skyblock 77. Qwen3.5 9B llega a 45–46 tok/s; Qwen3-Coder
  30B-A3B se queda en 17–22 tok/s; Qwen3.8 27B sigue en 7,2.
- Descargas y registro de `qwen3-coder-30b-a3b`, `deepseek-coder-v2-lite` y
  `qwen3-8b` con `fast-download.mjs` a ~10,3 MiB/s.
- Gráficos `bench-model-speed`, `bench-task-matrix`, `bench-best-score`,
  `moe-offload`, `benchmark-pipeline` y `engine-optimizations`.
- `scripts/bench-tasks.py`, `scripts/check-task.cjs`, `scripts/check-ui.cjs`,
  `scripts/make-bench-svgs.py` y el helper UTF-8
  `scripts/qwen38_ide_agent_task.py`.

#### Corregido

- El lanzador no delegaba los modelos `moe-hibrido`; GPT-OSS se rechazaba como
  “sin perfil de GPU completa”.
- El perfil de GPT-OSS pedía el binario `optimized-sm89` en una ruta
  inexistente; se usa `optimized-sm89-user`.
- El catálogo de GPT-OSS apuntaba a un GGUF que no existe.
- `configurationFromMarker()` rechazaba `pensar=-1`.
- `start-server.ps1` trataba `-1` como automático; ahora `-2` es automático y
  `-1` es sin límite. La UI y los lanzadores propagan el valor.
- Al cargar desde la UI con visión se usa el reparto conservador del plan
  (Qwen3.6: 22 capas de expertos en CPU) para evitar OOM con el navegador.
- El helper de benchmark usaba cp1252 y se caía con emojis; ahora es UTF-8.
- El checker de fluidos acepta simulaciones pausadas y el 404 de favicon ya no
  cuenta como error.
- El medidor de la UI conservaba la ventana del modelo anterior; `/api/state`
  usa la ventana actual.
- El diálogo de inicio actualiza la etiqueta `ventana` al cargar.

### UI/UX

- `scripts/check-ui.cjs` verifica la UI real: 0 errores de consola, 44 tarjetas
  en el Hub, diálogo de inicio, Hub y Ajustes, estado `IA lista` y ventana
  actualizada.
- Capturas en `docs/graficos/ui-2.4.0-main.png`, `ui-2.4.0-hub.png` y
  `ui-2.4.0-settings.png`.


### Qwen3.8-27B (2026-11-01)

#### Añadido

- Perfil `qwen38-27b-perf-iq4` con IQ4_XS mixto, MTP 2, `--cache-ram 512`,
  `--cache-recurrent-prefix` y `LLAMA_MMAP_TRIM_GPU=1`. El perfil y el GGUF
  originales se conservan para rollback.
- Checkpoints recurrentes en límites de mensaje y ancla estable del primer
  mensaje. El segundo paso de agente reutiliza 6508 tokens; un follow-up nuevo
  reutiliza 4551; un prefijo de 25K reutiliza 24.997.
- Pensamiento libre para Qwen3.8: `--reasoning-budget -1`,
  `thinking_budget_tokens: -1`, esfuerzo `xhigh` y opción
  **Sin límite (Qwen3.8)** en Ajustes. El tope total de salida del turno sigue
  aplicándose.
- Tool calling nativo validado en dos turnos reales: lecturas paralelas, fallo
  de test, edición dirigida, UTF-8 y recuperación de una denegación de política.
- Gráfico `docs/graficos/qwen38-cache.svg` y sección Qwen3.8 en el README.

#### Corregido

- `launch-ide.ps1` acepta los presets optimizados y arranca modelos
  `gpu-parcial`; una segunda apertura no duplica el servidor.
- Un turno cancelado se reporta como `cancelled`/`incompleto`, no `completed`.
- El ajuste de razonamiento del usuario manda sobre el preset del motor y se
  guarda el valor efectivo.

### Cambiado

- Registro único `config/llama-binaries.json`, consumido por lanzadores, parada y Node.
- Ciclo de vida extraído a `chat/lifecycle/`: estado, mutex, start/stop/restart/close,
  limpieza de arranques fallidos y rollback. Alias HTTP anteriores conservados.
- Un controlador de UI y un polling para Iniciar, Detener y Cerrar IDE e IA.
- Explorador e Historial comparten una barra lateral con pestañas; editor central,
  chat adaptable y divisores finos ajustables con ratón o teclado.
- Doce temas con galería, iconos por acción/archivo y animaciones que respetan
  la preferencia de movimiento reducido; editor y terminal siguen el tema.

### Corregido

- La parada confirma PIDs, puerto, marcador y VRAM; dos stop simultáneos comparten resultado.
- El cierre rechazado conserva el IDE y muestra el error. El cierre HTTP tiene timeout y
  termina conexiones SSE/keep-alive después de enviar la respuesta.
- Los scripts ofrecen JSON sin mensajes mezclados y validan `binId` y ejecutable real.
- GPT-OSS reconoce el destinatario Harmony antes o después del canal, muestra progreso
  durante la generación y recupera llamadas truncadas sin ejecutar JSON parcial.
- Las herramientas desconocidas muestran los nombres válidos; el resumen final usa
  instrucciones de cierre y omite los esquemas de herramientas.
- La verificación aporta las API reales de Node al reparar imports y comprueba HTML
  y recursos HTTP en apps nativas detectables con `startServer(port)`.
- Un 404 estático devuelve al modelo la causa comprobada de una base `new URL`
  sin barra final; las sondas sueltas como `testRoot.js` no se confunden con suites.

### Añadido

- Regresiones aisladas y de navegador; E2E GPU con wrapper huérfano, paradas concurrentes,
  arranque fallido, rollback y evidencia de VRAM.
- [Contrato del ciclo de vida](docs/LIFECYCLE.md) y [notas del candidato 2.4.0](docs/RELEASE-2.4.0.md).

## [2.3.6] - 2026-11-01

### Añadido

- Prueba end-to-end real del ciclo de vida (`scripts/e2e-lifecycle.mjs`):
  **Detener** cierra `llama-server` y deja viva la UI; **Cerrar IDE e IA**
  cierra modelo y UI, sin marcador.
- Prompt de refactor 2.4 en `docs/PROMPT-REFACTOR-2.4.md` para modularizar el
  ciclo de vida y unificar el control del servidor.

### Corregido

- **Detener dejaba el modelo vivo**: el lanzador optimizado usa
  `bin\builds\lab-server-mvq2\bin\llama-server.exe`, pero el script de parada no
  lo reconocía y respondía “puerto no administrado”. Ahora el binario está en la
  lista y el cierre espera a que mueran los PIDs, cierre el puerto, termine el
  wrapper y borra el marcador. Si algo sigue vivo, falla en vez de mentir.
- **Cerrar IDE e IA lanzaba `TypeError`**: `app.js` usaba `#servidor-toggle`,
  que no existe en el HTML. El controlador es null-safe, cierra el servidor Node
  e intenta cerrar la ventana.
- El botón **Cerrar IDE e IA** sigue visible a 1280 px (antes se ocultaba por
  una media query) y vuelve a estar disponible si el cierre falla.
- Prueba de regresión que verifica que todos los binarios que puede elegir el
  lanzador están aceptados por `stop-managed-server.ps1`.

## [2.3.5] - 2026-11-01

### Añadido

- **Guía de herramientas para GPT-OSS** en el system prompt: nombre,
  argumentos obligatorios y ejemplo de cada tool.
- `buscar_codigo` acepta `ruta` opcional y filtra los resultados.
- `BonsaiChat` descarta las llamadas con `arguments` JSON truncados antes de
  guardarlas y `packCoderHistory` limpia las sesiones antiguas (llamada inválida
  y resultados huérfanos).
- Prueba end-to-end de la app `todo.html` con navegador real: 12/12.

### Cambiado

- Los campos extra que no están en el schema se ignoran en vez de bloquear la
  llamada; los obligatorios y los tipos siguen validándose.
- El cierre del turno usa el último `assistant` y cae al resumen de acciones si
  quedó vacío. Nunca deja la respuesta final en blanco.
- `uiVersion 2.3.5` migra cualquier `historial >= 32768` a automático.

### Corregido

- El error `Failed to parse tool call arguments as JSON` ya no envenena el
  siguiente turno.
- El layout de la app de prueba: sol fuera de la tarjeta, río animado, rosas y
  overflow cero a 390 px.

## [2.3.4] - 2026-11-01

### Cambiado

- **Presupuesto de contexto automático real.** `historial: 0` vuelve a ser el
  default; la migración `uiVersion 2.3.4` convierte el viejo `32768` en `0`.
  GPT-OSS 64k pasa de 32.768/32.768 a **53.120 de historial / 12.288 de salida**.
- **Menos restricciones para GPT-OSS.** Se retira la regla «una tool call por
  respuesta» del `TOOL_WORKFLOW`; el parser Harmony ya soporta varias llamadas.
  Las independientes pueden ir juntas y las dependientes esperan el resultado.
- La reserva automática de salida baja de 18k a 12k para dejar más contexto útil.

### Corregido

- El ajuste viejo `historial=32768` ya no fuerza una división 50/50 de la
  ventana.
- El prompt deja de estar condicionado por el parser PEG que ya no se usa.

## [2.3.3] - 2026-11-01

### Añadido

- **Parser Harmony propio** (`chat/harmony.mjs`): separa `analysis`, `final` y
  `commentary to=functions.NOMBRE` del Harmony crudo, incluidas varias tool
  calls. Self-test incluido.
- GPT-OSS arranca con **`--skip-chat-parsing`** en los lanzadores y en el
  comando que muestra la UI. El parser PEG de llama.cpp deja de intervenir.

### Cambiado

- `BonsaiChat` bufferiza la salida de GPT-OSS con skip, la parsea al final y
  convierte los canales en tool calls nativas. No se muestran los marcadores
  `<|channel|>` y el análisis no contamina la respuesta final.
- `chat/evaluar/copia-app.mjs` incluye `harmony.mjs`.

### Corregido

- El 500 `peg-native` desaparece del camino normal de GPT-OSS. El reintento de
  2.3.2 queda como red de seguridad si el servidor se arranca sin el flag.
- La respuesta final tras una tool call ya no queda vacía ni muestra el
  monólogo interno.

## [2.3.2] - 2026-11-01

### Corregido

- **El turno ya no muere con `peg-native`.** Si llama.cpp rechaza la salida
  nativa, `BonsaiChat` reintenta una vez sin `tools` nativas: inyecta el catálogo
  en el system prompt y pide un objeto JSON puro. El fallback `gpt-oss-json` lo
  convierte y el agente continúa con la misma tool call.
- El reintento está limitado a GPT-OSS, no oculta errores de otros modelos y no
  se ejecuta sobre continuaciones ya empezadas (`continue_final_message`).
- El test `prueba-gpt-oss-tools` cubre el 500 de `peg-native`, comprueba que el
  reintento no envía `tools` y que el JSON devuelto se ejecuta.

## [2.3.1] - 2026-11-01

### Añadido

- **GPT-OSS como agente principal**: plantilla Harmony del GGUF, tool calls
  nativas y `reasoning_effort` en vez de `enable_thinking`.
- **Fallback `gpt-oss-json`** en `chat/adaptadores.mjs` para cuando el parser
  PEG de llama.cpp deja la llamada como JSON en `content` (varias llamadas o
  texto delante). Solo acepta JSON puro, quita `functions.` y pasa por
  `nativeToolEffects`.
- **Salida cruda opcional**: `BONSAI_RAW_STREAM=1` guarda cada evento SSE en
  `<estado>/raw-stream.jsonl` (o en la ruta indicada) con `content`,
  `reasoning_content`, `tool_calls`, `finish_reason` y errores.
- Pruebas `chat/prueba-gpt-oss-tools.mjs` y `chat/prueba-coder-archivos.mjs`.

### Cambiado

- **Una tool call por respuesta** en `TOOL_WORKFLOW`, para evitar el fallo
  `peg-native` de llama.cpp con varias llamadas.
- **Verificación del coder**: `noteWritten` añade el archivo a `touched` y
  `changed()` lo incluye aunque no esté en el índice de código (`.txt`, `.env`,
  assets). Antes decía «no se modificó ningún archivo» y dejaba la tarea como
  incompleta.
- **Cierre del turno**: el resumen final conserva el razonamiento activo y se
  pide también cuando el último mensaje es un resultado de tool o el assistant
  cerró con `content` vacío. GPT-OSS sin canal de análisis volcaba su monólogo
  interno en `content`; ahora el cierre es una respuesta limpia.
- **Catálogo GPT-OSS**: `pensar.nivel` pasa de `high` a `medium`; `high` dispara
  respuestas de 18k tokens y el propio autor documenta HTTP 500.
- **Lanzador**: `--agent-profile` se usa de verdad; `optimized*` se mapea a
  `small-local-coder` y el default del acceso directo es ese perfil.

### Corregido

- `Peg-native` ya no deja el turno como respuesta vacía: se propaga como error
  y el fallback JSON recupera las llamadas que el servidor dejó en `content`.
- El prompt de `VERIFY` ya no da por terminada la tarea tras comprobar solo
  sintaxis: exige que existan los archivos pedidos y que pasen los tests.
- El acceso directo y el lanzador dejan de arrancar con el perfil legacy cuando
  no hay ajustes guardados.

## [2.3.0] - 2026-10-31

### Añadido

- **Diff/merge moderno** con `@codemirror/merge` (`unifiedMergeView`) en Ctrl+K:
  líneas añadidas/borradas, gutter y números reales. Selector nuevo
  `.diff-cm`; el `<pre>` queda solo como fallback.
- **Paleta de sintaxis propia** para CodeMirror, pensada para fondo oscuro, y
  ajuste de línea para que los documentos largos se lean sin scroll horizontal.
- **API de automatización** `window.bonsaiEditorCommand` con `getText`,
  `replaceAll`, `select` y `focus`, además de `window.bonsaiEditor()`.
- **Capa visual 2.3**: barra de dos filas, tema `slate` por defecto, estado vacío
  con atajos, explorador más alto, ajustes con cabecera fija y pie pegajoso.
- **Capturas de referencia** en `docs/graficos/ui-2.3-*.png` (1280, 1440, 1600,
  ajustes, diff y estado vacío).
- Documentos [RELEASE-2.3.0](docs/RELEASE-2.3.0.md) y
  [TOOL-CALLING](docs/TOOL-CALLING.md).

### Cambiado

- **CodeMirror 6 es el único editor.** Se retiró el editor clásico
  (`textarea` transparente + `pre` resaltado), sus listeners y el ajuste
  opt-in. El bundle local sigue siendo obligatorio y se reconstruye con
  `npm run build:ui-vendor`.
- **Migración de ajustes** a `uiVersion: "2.3.0"`: tema `slate` y
  `editorModerno: true` una sola vez; el resto de preferencias se conserva.
- **Lanzador con `AUTO` por defecto.** El plan por modelo elige contexto, KV y
  reparto MoE. Un preset guardado distinto de `AUTO`/`CUSTOM` ya no se impone.
- El banner del lanzador y las comprobaciones previas se limpian: sin draft de
  Ornith y sin pasos obsoletos.
- El acceso directo del escritorio abre la UI 2.3 en Edge/Chrome app mode, sin
  GPU para el navegador.

### Eliminado

- Editor clásico y su camino paralelo de resaltado/guardado.
- Checkbox **Editor moderno** de Ajustes y la lógica de fallback asociada.
- Chequeo del modelo draft de Ornith en `scripts/bonsai-rtx4060.ps1`.

### Corregido

- `chat/prueba-copia-evaluacion.mjs` fallaba porque la copia aislada no incluía
  `chat/legacy-tool-parser.mjs`; ahora el módulo se copia y el test lo verifica.
- Contraste de Markdown/HTML en el editor oscuro y alineación de los atajos del
  estado vacío.
- Cabecera a 1280 px: se ocultan chips secundarios y el permiso de comandos para
  que la fila del servidor no se parta en dos líneas.

## [2.2.0] - 2026-10-31

### Añadido

- **Laboratorio de rendimiento reproducible**: `bench/` con inventario de
  hardware, baseline `llama-bench`, benchmark de servidor (TTFT/ITL), calidad
  PPL, autotuner progresivo, merge de resultados y gráficos SVG.
- **Perfiles medidos**: GPT-OSS-20B 64k (12 capas CPU, 8 hilos), Qwen3.6-35B-A3B
  32k (19 capas), Qwen3-30B-A3B 32k (26 capas) y Qwen3-4B.
- **Build de laboratorio**: `scripts/build-llama-lab.ps1` con CMake real,
  `test-backend-ops` y hashes de binario.
- **Especialización MMVQ sm_89**: parche opcional de 2 warps para Q4_K/Q5_K/Q6_K
  en batch 1; +4,6% en Qwen3-4B, 2.490/2.490 tests MUL_MAT.
- **Presupuesto de VRAM**: `runtime/rtxllm.py budget|plan|command`.
- Documentos `HARDWARE.md`, `BENCHMARKS.md`, `OPTIMIZATIONS.md`,
  `QUANTIZATION.md`, `TUNING.md`, `ARCHITECTURE.md`, `docs/SOURCE-AUDIT.md`.

### Cambiado

- Lanzador MoE: usa la tabla medida por contexto y 8 hilos; GPT-OSS-20B 64k
  pasa de 30,0 a **36,8 tok/s** (+22,7%).
- Launcher: prefiere el build de laboratorio `lab-server-mvq2`, luego el build
  estable externo y por último `bin\`.
- Qwen3.6-35B-A3B 32k: 42,5 -> **44,8 tok/s**; Qwen3-30B-A3B 32k: 44,3 ->
  **46,6 tok/s**; Qwen3-4B servidor: 73,8 -> **77,0 tok/s**.
- README y página principal con los números medidos, gráficos y límites.

### Corregido

- Auditoría del build anterior: `GGML_CUDA_FA_ALL_QUANTS`, `GRAPHS` y `MMQ` se
  pasaban a `CMAKE_CUDA_FLAGS` y no activaban nada; `GGML_CUDA_MMQ` no existe en
  esta revisión. El nuevo script usa opciones CMake reales.
- Ornith 9B queda marcado como **no recomendado para coding**; los perfiles de
  coding se centran en GPT-OSS-20B y Qwen3.6/30B-A3B.

## [2.1.0] - 2026-10-31

### Añadido

- **Editor CodeMirror 6 opt-in**: bundle local de ~907 KB, lenguajes JS/TS/TSX,
  Python, JSON, HTML, CSS, Markdown, Rust, Go, Java y C/C++; undo/redo,
  multi-cursor, búsqueda, plegado, autocompletado y Ctrl+K/Ctrl+S integrados.
  Se activa en Ajustes → Editor moderno y el editor clásico queda como fallback.
- **Terminal xterm + ConPTY**: `@xterm/xterm` 6, `@xterm/addon-fit`,
  `@xterm/addon-web-links` y `node-pty` 1.1 opcional. Colores, resize y TUI;
  fallback automático a tuberías y `<pre>` si el módulo nativo no está.
  `BONSAI_PTY=0` fuerza el modo clásico.
- **Búsqueda con ripgrep**: `/api/search` usa `@vscode/ripgrep` (MIT), respeta
  `.gitignore`, limita a 800 KB por archivo y conserva el fallback Node.
- **Búsqueda estructural**: `@ast-grep/napi` y la herramienta
  `buscar_estructural` para patrones AST con metavariables en JS/TS/TSX/HTML/CSS.
- **Contratos Zod 4**: schemas de las tools nuevas, validación y generación de
  JSON Schema reproducible (`chat/tool-schemas.mjs`).
- **llguidance opcional**: flags `-Llguidance` en los builds CUDA, script
  `npm run build:llguidance` y guía `docs/LLGUIDANCE.md`.
- Bundles locales `chat/ui/vendor/editor.js`, `terminal.js` y `xterm.css`, más
  script `npm run build:ui-vendor`.

### Cambiado

- `/api/search` devuelve `motor` y usa ripgrep cuando está disponible.
- El terminal informa `pty: true/false` y acepta `accion: "resize"`.
- Ajustes persiste `editorModerno: false` por defecto.
- `npm test` sube a **45 suites aisladas**; navegador a **7 suites**.
- Versión **2.1.0**.

### Seguridad

- ripgrep no lee archivos de más de 800 KB y respeta `.gitignore`; ast-grep usa
  la lista de archivos del proyecto, que omite `node_modules`, `.git`, modelos y
  artefactos.
- `npm audit`: **0 vulnerabilidades**.
- Sin CDN: CodeMirror y xterm se sirven desde `chat/ui/vendor/`.

## [2.0.0] - 2026-10-31

### Añadido

- **Visión optimizada con `sharp`**: `chat/imagenes.mjs` corrige EXIF, limita el
  lado mayor a 1600 px, aplana transparencia, convierte a JPEG 4:4:4 y conserva
  el original si el procesado falla. Tope de 8 MB por imagen y 12 MB de body
  base64.
- **Investigación limpia**: `@mozilla/readability` + `turndown` + `linkedom`
  extraen el artículo y lo pasan a Markdown GFM. El extractor regex histórico
  queda como *fallback*; la guardia SSRF no cambia.
- **Model Hub con identidad**: logos SVG locales de Qwen, Meta/Llama, Mistral,
  DeepSeek, OpenAI, Gemma, NVIDIA, IBM, Hugging Face, Liquid, Zhipu, Kimi y
  otros, servidos desde `chat/ui/iconos/modelos/`.
- **Notificación nativa opt-in** al terminar un turno largo con la ventana
  oculta; el permiso solo se pide al activar el ajuste.
- **Portada 2.0**: evolución, modelos y novedades en tres SVG nuevos
  (`evolucion-2.0.svg`, `modelos-2.0.svg`, `novedades-2.0.svg`).
- **Auditoría de dependencias** en `docs/DEPENDENCIAS-2.0.md`, con alternativas
  evaluadas, licencias y cadena de suministro.
- Suite `chat/prueba-imagenes.mjs` para resize, JPEG, fallback y tope total.

### Cambiado

- Versión **2.0.0**; README, badges, tabla de releases y documentación
  actualizados.
- Dependencias nuevas fijadas con versión exacta:
  `sharp`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`,
  `linkedom` y `@lobehub/icons-static-svg`.
- `npm test` incorpora la suite de imágenes (43 suites aisladas).

### Corregido

- `extraerPagina` ya no depende solo de regex: si Readability no encuentra un
  artículo claro, vuelve al extractor anterior en vez de devolver texto vacío.
- Las imágenes que `sharp` no puede abrir se envían tal cual, en lugar de
  perderse silenciosamente.

### Seguridad

- `npm audit`: **0 vulnerabilidades**.
- Readability/Turndown no habilitan HTML crudo ni scripts; el contenido web
  sigue siendo dato no confiable.
- Los logos son SVG estáticos y locales; no hay CDN ni telemetría.

## [1.9.0] - 2026-10-31

### Añadido

- **Perfil `moe-hibrido`**: lee la tabla de tensores del GGUF, separa expertos de
  pesos densos y reparte las capas de expertos entre VRAM y RAM
  (`--n-cpu-moe N`). Contexto 32k y KV q8_0 por defecto.
- **`--load-mode none` cuando los expertos de CPU caben en RAM** y `mmap` cuando
  no. Medido en Qwen3.6-35B-A3B: 42,5 vs 16,9 tok/s de generación.
- **4 MoE nuevos**: Qwen3.6-35B-A3B (visión), Qwen3-30B-A3B-2507, GPT-OSS-20B
  y Nemotron 3 Nano 30B-A3B.
- **12 hilos + batch 1024/512** por defecto en MoE y prioridad de memoria sin
  EcoQoS (`win-optimize-process.ps1`).
- `scripts/moe-bench.mjs`, `precargar-gguf.mjs`, `win-cache.ps1` y
  `scripts/chat-template-check.mjs` (34/34 plantillas válidas).
- **Benchmark de coding real** (`bench-coding.mjs`): proyecto multifichero y
  bugfix con tests ocultos, ranking y gráficos. GPT-OSS-20B 100 %, Qwen3.6-35B
  96 %, Qwen3-30B 86 %.
- **Perfil `chat/coder-profile-moe.json`** opt-in (`BONSAI_CODER_CONFIG`) para el
  agente: sin snippets, cross-file 133,6 → 43,1 s y failing-test 66,6 → 28,9 s
  con GPT-OSS, manteniendo PASS.
- **Benchmark de web app real** (`bench-webapp.mjs`): Taskboard full-stack con
  API y UI Playwright. GPT-OSS-20B 100 % (8/8 + 3/3), Qwen3.6 91 %, Qwen3-30B
  55 %; capturas y SVG.
- **GPT-OSS afinado**: Harmony, muestreo oficial, `--reasoning-effort high`,
  64k por defecto y 128k máximo; aguja de 61k correcta. Selector de contexto
  32/64/96/128k en el Hub y esfuerzo en Ajustes.
- **Hub rediseñado**: resumen recomendado, KPIs de coding/web app, chips de
  capacidades, tarjetas coherentes y orden por relevancia.
- **Primer arranque guiado**: si la IA está apagada, la UI pregunta qué modelo
  cargar; sin GGUF explica el camino y abre el Model Hub. Se puede desactivar en
  Ajustes. Incluye `scripts/setup-clone.ps1` y la guía `docs/PRIMER-ARRANQUE.md`.
- **Tuning del motor** (`ENGINE-2026-10-31.md`): ngram, draft, batch, KV,
  prioridad, afinidad y clocks medidos. Base: `none` + 12 hilos + 1024/512;
  3 capas extra de expertos = +4,7 %.
- **Descarga por rangos en paralelo** (`fast-download.mjs`).

### Corregido

- El script de parada no reconocía `moe-hibrido`: el IDE no podía apagar/cambiar
  un MoE.
- El IDE enviaba presets densos al lanzador MoE; ahora manda el plan del modelo.
- `model-lab --all` y `model-tune --all` omitían los MoE.
- `bench-model-quality` pasaba `--chat-template-file` aunque no existiera.

## [1.8.0] - 2026-10-31

### Añadido

- **Catálogo online “Descubrir”**: consulta en vivo los GGUF con más tracción en
  Hugging Face, con botón de actualización y apertura de repo/cuantización.
- **25 modelos curados instalados** (14 con visión) y **26 utilizables** con
  Ornith: Qwen3.5 4B/9B, Qwen3.8 4B, Qwen3-VL 2B/4B/8B, Qwen2.5-VL 3B,
  Gemma 4 E4B, Nemotron 3.5 Bolt E4B, MiniCPM-V 4.7 1B, LFM3 1.7B/2B/Omni,
  SmolVLM2, SmolLM3, Granite 4.0, Phi-4 Mini, Spark X2.6 y los anteriores.
- **Pruebas con y sin visión** de todos los modelos multimodales y tabla de
  contexto/VRAM/tiempo por imagen.
- `scripts/catalog-report.mjs` y `scripts/vision-matrix.mjs`.

### Corregido

- Proyectores homónimos con prefijo por modelo (Gemma 3/4, Qwen3.5).
- Detección de visión conservadora: Spark ya no hereda el proyector de Qwen3-VL.
- Registro concurrente entre descargas, Model Lab y tuning.
- Ornith vuelve a `-ub 256` (512 no cabe a 110k).
- Model Lab espera a que la VRAM se libere de verdad entre modelos.

## [1.7.0] - 2026-10-31

### Añadido

- **Model Hub**: catálogo curado, búsqueda real en Hugging Face, descarga
  reanudable con verificación SHA-256, importación de GGUF locales y borrado
  seguro. Interfaz propia en el IDE (botón **Modelos** y menú del chip).
- **Plan de motor por modelo**: `chat/model-plan.mjs` lee la cabecera GGUF
  (capas, cabezas KV, `full_attention_interval`, ventana deslizante, contexto
  nativo) y calcula contexto, KV y visión GPU/CPU con la VRAM real. Los modelos
  descargados se registran en `models/hub-catalog.json` y aparecen en el selector
  sin reiniciar.
- **Plan con ventana deslizante**: Gemma 3 4B pasa de 61k a **131k** porque solo
  5 de sus 34 capas guardan KV por token; las locales usan una ventana fija.
- **Decodificación especulativa por modelo**: Qwen2.5 Coder 7B + draft Qwen2.5
  0.5B pasa de 47,2 a 68,8–71,8 tok/s (1,46–1,52×) con +469 MiB de VRAM.
- **Tool calls de Qwen2.5 Coder**: adaptadores `function-call`, `xml-json` y
  `tools-json` para sus tres envoltorios de texto.
- **Model Lab** (`scripts/model-lab.mjs`): arranca cada modelo con su plan y mide
  arranque, VRAM pico, ventana real, TTFT, tok/s, JSON, código ejecutado,
  tool-calling, retrieval y visión.
- **Preset Automático** en la barra del servidor (`/api/server/start` con
  `AUTO`) y auto-plan al cambiar de modelo desde el selector.
- **Benchmark de calidad por modelo** (`bench-model-quality.mjs --model`), con
  el plan AUTO del modelo en vez del preset de Ornith.
- Investigación [STRATA-Y-MEMORIA](docs/STRATA-Y-MEMORIA.md): cómo reparte
  Strata GPU/RAM/SSD, KV streaming, caché de expertos, MTP y qué se puede
  aplicar a llama.cpp en 8 GB.
- Documentación [MODEL-HUB](docs/MODEL-HUB.md) y pruebas
  `chat/model-plan.mjs` + `chat/prueba-model-hub.mjs`.

### Cambiado

- El lanzador optimizado y `start-server.ps1` fusionan el registro del Hub;
  `Get-RequiredMiB` usa el KV real del GGUF cuando existe.
- El chat oculta modelos auxiliares (borradores) y los identifica con `oculto`.

## [1.6.2] - 2026-10-30

### Corregido

- **El acceso directo del escritorio no abría ninguna ventana**: llevaba
  `-NoBrowser`, que arranca la interfaz pero no abre el IDE. Ahora abre la ventana de
  aplicación sin GPU; `scripts/crear-acceso-directo.ps1` genera el acceso correcto y
  la prueba de perfiles comprueba que no vuelva a colarse ese flag.

## [1.6.1] - 2026-10-30

### Añadido

- **Ventana de aplicación sin GPU** (`scripts/open-ide.ps1`): Edge/Chrome en modo
  `--app` con rasterizado por software y perfil aislado. Verificado: 0 MiB de VRAM
  con el IDE abierto. `-Tab` para pestaña normal con los mismos flags.
- Cabecera del IDE en una sola línea a 1920×1080, selector de preset compacto y
  «Iniciar» como acción principal.
- Burbuja de usuario a la derecha, guía vertical en las respuestas y animación de
  entrada solo para mensajes nuevos; `prefers-reduced-motion` respetado.
- Barra de estado con ajuste en varias líneas y medidas de hardware que se ocultan
  en pantallas estrechas.

### Cambiado

- Tema Arena con acento verde oliva (identidad Bonsai).
- La UI deja de pintar la pestaña en una ventana de navegador con cromo cuando se
  lanza desde el acceso directo.

### Corregido

- Sin `backdrop-filter` ni blur: el IDE no pide aceleración por GPU en ningún punto.
- El texto del resumen de estado ya no se corta en el borde derecho.
- **Toasts duplicados**: `app.js` creaba un segundo contenedor `.avisos` y los avisos
  se repartían entre dos cajas; ahora todos usan `#avisos`. Esto además arreglaba la
  prueba de humo de Ctrl+K, que leía la caja vacía.

## [1.6.0] - 2026-10-30

### Añadido

- **110.592 tokens con visión y KV q8_0** en la RTX 4060: el proyector de visión
  (879 MiB) pasa a RAM con `--no-mmproj-offload`. Retrieval real a 87.433 tokens.
- Presets `8GB-VISION-MAX-Q8-100K` (por defecto), `8GB-VISION-MAX-Q4` y
  `8GB-VISION-MAX-F16`.
- Reparto de contexto automático (historial = ventana − pensamiento − respuesta) y
  compactación estructurada con tope del ~6 % de la ventana.
- Benchmark de proyecto complejo con `node --test` real y gráficas SVG nuevas
  (`context-kv`, `context-split`, `vision-projector`, `bench-sampling`,
  `bench-project`).

### Corregido

- El pensamiento ya no se come la respuesta: va dentro de la reserva de salida.
- `--prompt-cap 0` deja de limitar el historial a 8.192 tokens.
- Pruebas ajustadas al muestreo y techos medidos (40/40 en verde).

## [1.5.0] - 2026-10-30

### Cambiado

- **Preset por defecto `8GB-VISION-MAX-F16`**: 43.008 tokens con KV **f16**,
  visión y pensamiento (4096). Es el techo medido en RTX 4060 8 GB (7.481 MiB);
  45.056 falla con OOM en prefill largo.
- **Ciclo de vida robusto del servidor**: Node lanza el lanzador con
  `windowsHide` + `unref()` (sin `detached`) y el wrapper PowerShell usa
  `Start-Process -NoNewWindow` + `WaitForExit()`. El modelo sobrevive al cierre de
  la UI/navegador.
- **Panel de servidor funcional en el IDE**: selector de preset, **Iniciar**,
  **Detener** y **Terminal** (copia un comando PowerShell con rutas absolutas,
  generado en el servidor).

### Corregido

- **Presets con KV inválido**: `IQ4_XS`, `IQ2_XS` e `IQ1_S` son cuantizaciones de
  **pesos**, no de caché KV; `llama-server` salía al arrancar. Los presets
  `8GB-VISION-ULTRA` (ahora 36k q4_0), `8GB-VISION-HIGH` (32k q8_0),
  `8GB-CODE-MAX` (48k q4_0) y `8GB-RESEARCH` (64k q4_0) usan tipos válidos.
- `start-gpu-model-rtx4060-optimized.ps1` ya no sale antes de tiempo (mataba el
  modelo en Windows).
- `stop-managed-server.ps1` reconoce el binario optimizado sm89 y el lanzador
  optimizado, así que **Detener** funciona y permite reiniciar.
- La UI ya no se cae al arrancar sin modelo cargado.
- Error de sintaxis en `chat/ui/ide.js` que impedía ejecutar el panel de servidor.
- El comando del botón Terminal ya no usa `%~dp0` (inválido en PowerShell).

### Añadido

- `scripts/benchmark-rtx4060-matrix.ps1` y `scripts/probe-rtx4060-context.ps1`
  (mediciones reproducibles).
- Gráficos SVG en `docs/graficos/` (presets, techo de contexto, calidad KV).
- Guía de ciclo de vida y tuning en `docs/RTX4060_OPTIMIZATION_GUIDE.md`.

## [1.2.0] - 2026-10-30

### Añadido

- **Memoria global entre chats**: capa separada de la memoria de sesión, guardada en el
  estado local fuera de Git. Selección por relevancia léxica contra el pedido y el
  objetivo, notas fijadas siempre dentro del presupuesto y nada inyectado si no hay
  coincidencia. Presupuesto configurable por turno (0–2.000 tokens), captura automática
  conservadora de preferencias y decisiones duraderas, y editor para revisar, añadir,
  editar, fijar, borrar y vaciar notas. API `GET/POST /api/memoria`.
- **Navegador Playwright MCP aislado** (`mcp_playwright`): abre páginas HTTP/HTTPS,
  inspecciona el árbol accesible, pulsa, escribe, envía teclas, espera y consulta
  consola y red. Usa un perfil efímero por turno, bloquea los puertos del IDE y del
  modelo y no habilita evaluación arbitraria de código.
- **Control del servidor desde la interfaz**: `GET/POST /api/servidor` permite consultar,
  detener y volver a arrancar el servidor administrado sin cerrar el IDE.
- **Cancelación real del turno** (`POST /api/stop`): aborta la inferencia, las
  herramientas y los procesos del turno de forma idempotente.
- **Escritura por partes recuperable**: `estado` recupera el offset tras una interrupción
  y `cancelar` descarta las partes pendientes.
- **Diagnóstico de JavaScript inline en HTML** con `node --check`, además de la
  comprobación estructural.
- Suites nuevas para memoria global, compactación, cancelación y cierre, registros,
  Playwright MCP y pruebas reales opcionales de contexto, carga y multivisión.
- Evidencia publicable de la release en `docs/evidencia/2026-10-30/`.

### Cambiado

- **Prompt del agente** dividido en reglas generales, flujo de trabajo y uso de
  herramientas; las fases del coder distinguen conversación, edición, verificación y
  cierre. El coder recibe además `navegador`, `buscar`, `leer_web` y `mcp_playwright`.
- **Validación de lotes de herramientas**: límites por tipo de llamada, rechazo de
  escrituras conflictivas sobre el mismo archivo y límites de repetición con mensajes
  que explican cómo continuar.
- **Estado del coder** más útil y acotado: símbolos, acciones y último diff, con
  compactación por presupuesto y conservación del plan cuando cabe.
- Un archivo escrito en el turno queda marcado como inspeccionado: corregirlo ya no
  exige volver a leerlo.
- **Escrituras concurrentes** en archivos distintos con colas por ruta, temporales
  independientes y precondición contra cambios externos.
- Los diagnósticos de contexto incluyen memoria global (tokens, entradas y presupuesto)
  y detalles de compactación.
- `start-ui.ps1` propaga `KVCacheType` en perfiles `CUSTOM`, respeta el KV y la visión
  guardados y falla si la visión configurada no tiene proyector.
- Saludos breves como `hi`, `hello` o `hey` se reconocen como conversación y no activan
  una tarea sobre el proyecto.
- El runner separa **`test:gpu`** (servidor cargado) de **`test:gpu-exclusiva`**
  (calidad KV, GPU libre); `test:todo` ejecuta las cuatro familias.
- La prueba de GPU trata `CPU_Mapped` como mmap de apoyo del GGUF, no como pesos de
  cálculo; conserva el aviso de 180 MiB de VRAM y solo falla si la memoria se agota o no
  puede medirse. La prueba de visión lee dos imágenes de un dígito y mide las cuatro
  cifras como estrés informativo. El cambio de modelo sin segundo perfil GPU verifica el
  rechazo 409 sin tumbar el servidor.

### Corregido

- El botón **Detener** ya no deja el servidor generando ni `busy` bloqueado en 409.
- Tras una verificación correcta y sin escrituras nuevas, el agente cierra y pide el
  resumen en lugar de encadenar lecturas indefinidamente.
- Reescribir un archivo recién creado por el propio agente ya no se bloquea por no
  haberlo leído antes.
- Las lecturas de registros están acotadas en líneas y longitud, incluso con líneas de
  decenas de MiB, y decodifican UTF-8 entre bloques.
- Los errores de memoria de GPU se señalan como tales y dejan la tarea incompleta sin
  perder el estado guardado.
- Los diagnósticos HTML detectan scripts inline rotos que antes solo aparecían al abrir
  la página.

### Seguridad

- La memoria global rechaza secretos, vive fuera del proyecto y de Git, y nunca se
  inyecta completa.
- El navegador MCP no se conecta al perfil del usuario, no evalúa código arbitrario y
  protege los puertos del IDE y del modelo.
- Las escrituras atómicas comprueban la ruta y el contenido previo antes de sustituir.

### Pruebas

- `npm test`: **40/40** suites, 125,3 s.
- `npm run test:navegador`: **5/5** suites, 16,4 s.
- `npm run test:gpu`: **4/4** suites, 95,4 s.
- `npm run test:gpu-exclusiva`: **1/1** suite, 89,6 s.
- Calidad KV: A (32K, q8_0, visión) **8/8**; B (16K, f16, visión) 6/8; C (32K, f16,
  sin visión) 6/8. Pasada única, no medida estadística.

## [1.1.0] - 2026-10-29

### Añadido

- Prompt de sistema más claro y selección de herramientas orientada a la intención.
- Conservación y diagnóstico del contexto, presupuesto de salida y conteo mediante
  llama-server cuando está disponible.
- Escritura incremental para archivos nuevos grandes y consulta de salidas de comandos.
- Perfiles de GPU, visión, pensamiento y perfil manual de 43.008 tokens para el equipo
  probado.
- Auditoría técnica y hoja de ruta en `docs/AUDITORIA-PROFUNDA-2026-10-29.md`.

[1.2.0]: https://github.com/Vahlame/bonsai-local-ide/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Vahlame/bonsai-local-ide/releases/tag/v1.1.0
[2.2.0]: https://github.com/Vahlame/bonsai-local-ide/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/Vahlame/bonsai-local-ide/releases/tag/v2.1.0
