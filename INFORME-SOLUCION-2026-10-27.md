# Informe de resolución · Bonsai Local IDE

**Fecha:** 27 de octubre de 2026
**Proyecto:** `C:\Users\user\Documents\prject_local_AI`
**Alcance:** todos los puntos y observaciones de `reporte de codex.md` (hallazgos 1–21) y de
`AUDITORIA-BUGS-Y-REFACTORIZACION.md` (BUG-01…10 + plan de simplificación), más mejoras
detectadas durante el trabajo.

---

## 1. Resumen ejecutivo

| Conjunto | Total | Resueltos | Evidencia |
| --- | --- | --- | --- |
| Hallazgos de `reporte de codex.md` | 21 | 21 | 26 suites aisladas + 3 de navegador en verde |
| Bugs de `AUDITORIA-BUGS-Y-REFACTORIZACION.md` | 10 | 10 | idem + `prueba-servidor-administrado --gpu` real |
| Refactorizaciones del plan de simplificación | 6 | 6 | módulos nuevos y `npm test` |
| Mejoras adicionales detectadas | varias | aplicadas | ver §5 |

**Verificación al cierre (esta máquina):**

- `npm test` → **26/26 OK · 0 FALLO · 63,1 s** (sin GPU, sin llama-server real).
- `npm run test:navegador` → **3/3 OK · 5,6 s** (Edge headless: UI, aislamiento y humo).
- GPU real: `node chat/prueba-servidor-administrado.mjs --gpu` → **9 OK**, incluido el cierre
  del `llama-server` huérfano con el wrapper muerto (BUG-05) y liberación de la VRAM.
- Perfil automático con visión en GPU real: arranca **32768 tokens / KV q8_0 / visión**
  (antes se quedaba en 16384/f16), `/props` lo confirma, se detiene limpio y libera la VRAM
  (ver §4.6).
- **Calidad del KV medida en GPU real** (`chat/prueba-calidad-kv.mjs --real`): q8_0 a 32K
  saca **8/8** (NIAH 4k y 12k + tareas de código) igual que f16 a 32K, con una perplejidad
  de **7,5880 frente a 7,5570** (+0,41%). q4_0: +0,89%. Detalle y método en
  [docs/CALIDAD-KV-2026-10-27.md](docs/CALIDAD-KV-2026-10-27.md).
- El estado del usuario (`chat/ui-session.json`, `chat/ui-chats/`, `logs/`) **no se tocó**:
  todas las pruebas usan `os.tmpdir()`, `BONSAI_STATE`/`BONSAI_SALIDA` y puertos libres.

Se mantiene el repro histórico `salida/auditoria-codex-ornith/repro.mjs` como evidencia de los
fallos originales: sus aserciones comprueban el comportamiento ROTO y por eso ya no se cumplen.
Las conductas deseadas están convertidas en pruebas en `chat/` (ver §7).

---

## 2. Hallazgos del reporte de Codex

| # | Estado | Solución aplicada | Prueba que lo cubre |
| --- | --- | --- | --- |
| 1 | ✅ | Lector SSE único `chat/sse.mjs`: fragmentos, CRLF/LF/CR, comentarios, `data:` multilínea, UTF-8 partido, resto sin salto, `[DONE]`; error tipado con texto parcial ante cierre prematuro o JSON inválido. `streamSlice` y los scripts de medición/evaluador lo reutilizan. | `prueba-stream.mjs` |
| 2 | ✅ | Historial en `chat/historial.mjs`: escritura atómica (temp+fsync+rename) con `.bak`; corruptos apartados `.corrupto-<fecha>` (nunca se borran); índice reconstruido desde los archivos; gana la copia válida más nueva; el fallo de archivado se muestra en `/api/state` (`historial.error`) y se reintenta. | `prueba-servidor-estado.mjs` |
| 3 | ✅ | `navegador.mjs` valida la ruta REAL componente a componente (también tras resolver `index.html`): un enlace interno a `.git`, `.env*`, `node_modules`, `models` o `bin` devuelve 404; públicos normales siguen sirviéndose. | `prueba-navegador-rutas.mjs` (7 enlaces reales) |
| 4 | ✅ | `stat` ANTES de leer: editor (2 MB), guardado (compara solo ≤2 MB), búsqueda (salta >800 KB), reglas, adjuntos y lecturas del agente. Archivos grandes se recorren por streaming (`chat/lecturas.mjs`). | `prueba-servidor-estado.mjs`, `prueba-lecturas.mjs` |
| 5 | ✅ | `readBody` devuelve un error tipado y el servidor responde **413 limpio** (Content-Length y `transfer-encoding: chunked`), cerrando después. Sin reset de conexión. | `prueba-servidor-estado.mjs` (ambos modos) |
| 6 | ✅ | `leerReglas()` usa la política compartida `fileInside` (rechaza enlaces en cualquier componente) y limita bytes antes de leer; `.cursor/rules` enlazado fuera no se recorre. | `prueba-servidor-estado.mjs` + `prueba-seguridad.mjs` |
| 7 | ✅ | Documentado el modelo de amenaza en `archivos-seguros.mjs`: lstat→uso es *best-effort* frente a procesos locales concurrentes; no se vende como barrera TOCTOU. `rutaSegura` rechaza enlaces y su semántica tiene pruebas. | `prueba-archivos-seguros.mjs` |
| 8 | ✅ | `/api/edit` devuelve `base` (texto exacto leído) y el rango real; la UI guarda con `before: base`, compara pestaña/proyecto antes/después de esperar y del preview; un 409 conserva los cambios del usuario y no sobrescribe. | `prueba-editor.mjs`, `prueba-ui-humo.mjs`, `prueba-servidor-estado.mjs` |
| 9 | ✅ | Ctrl+K aplica por **offsets de carácter exactos**: solo se sustituye lo que el modelo vio; el sufijo no enviado de una línea gigante y las líneas no enviadas se conservan. Devuelve rango real, `seleccion` y `lineasAplicadas`. | `prueba-editor.mjs` |
| 10 | ✅ | Respuesta vacía/solo espacios lanza `ErrorEdicion` (`status 422`) y **no borra**; el borrado exige el centinela `BORRAR` y una confirmación adicional en la UI. | `prueba-editor.mjs`, `prueba-servidor-estado.mjs` |
| 11 | ✅ | Finales CRLF/LF/mixtos y salto final conservados (offsets + terminador de la propia selección); reemplazos multilínea usan el estilo del archivo. | `prueba-editor.mjs` |
| 12 | ✅ | `procesos.mjs` guarda cabeza Y cola desde el primer bloque y usa `TextDecoder` incremental (UTF-8 partido entre bloques). | `prueba-procesos.mjs` (33/33) |
| 13 | ✅ | Eliminado el cierre global por 4 archivos. Una tarea de 6+ archivos puede leer, escribir y verificar. Ya no hay `stopFollow` por lecturas. | `prueba-agente-limites.mjs` (6 archivos) |
| 14 | ✅ | Caché de lecturas por versión del archivo (`mtime+size`): releer tras plegar devuelve el contenido; si un comando/editor cambió el archivo, se lee la versión nueva. No se bloquea por «ya leído». | `prueba-agente-limites.mjs` (plegado y tras comando) |
| 15 | ✅ | Tandas de saltos con tope global, detección de atasco por falta de progreso y motivo explícito en el evento `done` (`completed / step_limit / stalled / cancelled / error`). Un turno límite/atascado se cierra con aviso honesto y no como promesa futura. | `prueba-agente-limites.mjs` (3 escenarios) |
| 16 | ✅ | Presupuesto honesto: `faseSalto` (plan/lectura/escritura/final/charla) + reserva adaptativa; a 16K el historial efectivo sube de 8064 a 13184/14208 en lectura/plan. `/api/state` expone `{ventana, solicitado, efectivo, reservaSalida}` y la UI muestra los 4 valores. | `prueba-contexto.mjs`, `prueba-ui-humo.mjs` |
| 17 | ✅ | Arranque auto busca la mejor combinación contexto/KV (pasos de 4096; f16>q8_0>q4_0), con techo de visión en `modelo.json` (32768), guarda el perfil en `logs/perfil-servidor-<puerto>.json` y lo reutiliza si sigue cabiendo. GPU completa siempre. | `prueba-perfil-gpu.mjs`, `prueba-servidor-administrado.mjs`, dry-run real, prueba de carga real |
| 18 | ✅ | Pliegue por grupos completos llamada+resultados; el ancla `tool` se convierte en nota explícita identificada si su llamada se pliega; salida de emergencia de `packHistory` sin huérfanos; red de seguridad para historiales viejos. | `prueba-contexto.mjs` |
| 19 | ✅ | Las lecturas informan del rango exacto: si el rango pedido se entregó completo no se invita a seguir; si se recorta por presupuesto se dice qué falta y el siguiente rango. Acepta `ruta:linea:c<ini>-<fin>` para columnas. | `prueba-lecturas.mjs`, `prueba-agente.mjs` |
| 20 | ✅ | Una línea gigante se corta con aviso explícito («se cortó a N de M caracteres») y un pie con la sintaxis exacta para pedir el resto; nunca se presenta como lectura completa. | `prueba-lecturas.mjs`, `prueba-agente-limites.mjs` |
| 21 | ✅ | `fallbackNotes` reserva espacio para fallos/verificaciones recientes y turnos nuevos antes de recortar notas viejas; un error reciente ya no desaparece. | `prueba-contexto.mjs` |

---

## 3. Bugs de `AUDITORIA-BUGS-Y-REFACTORIZACION.md`

| ID | Estado | Solución | Prueba |
| --- | --- | --- | --- |
| BUG-01 | ✅ | `guardia.mjs`: bind comodín acepta las IPs de las interfaces y el hostname de la máquina (mismo puerto); `Origin` http/https del mismo host:puerto; «null», hosts/orígenes ajenos y puerto distinto siguen 403. No se acepta un dominio arbitrario (evita reabrir DNS rebinding). | `prueba-seguridad.mjs` |
| BUG-02 | ✅ | `viewportSize() ?? {width:1280,height:800}`. | `prueba-navegador-aislamiento.mjs` |
| BUG-03 | ✅ | Mensajes distintos para selector inexistente / oculto / demasiado grande. | `prueba-navegador-aislamiento.mjs` |
| BUG-04 | ✅ | Borrado de temporales tolerante a `EBUSY/EPERM` (retries, reintentos async con timers `unref`), nunca rompe el resultado ni deja unhandled rejection. | `prueba-procesos.mjs` |
| BUG-05 | ✅ | El marcador guarda el **PID real** de `llama-server.exe` (`Start-Process -PassThru`) además del wrapper; `stop-managed-server.ps1` cierra un huérfano si el ejecutable y `--port`/`-m` coinciden, borra el marcador y no toca servidores ajenos; compatible con marcadores antiguos. | `prueba-servidor-administrado.mjs` (8 casos) y `--gpu` real |
| BUG-06 | ✅ | `modelo.mjs` acepta la clave del catálogo y usa SU arquitectura (Ornith: 8 capas de atención completa); `estimarVramModeloMiB` con pesos del catálogo + reservas; optional chaining en `perfilAgente`/`pensarDe`. Tabla del informe verificada (7789/8045/8301/7821/7565 MiB) y calibración histórica intacta. | `modelo.mjs`, `prueba-perfil-gpu.mjs` |
| BUG-07 | ✅ | `markdown.js`: `safeUrl` solo http/https y rechaza entidades de comilla; `RegExp` de cierre de fence precompilada fuera del `while`. | `prueba-markdown-seguro.mjs` |
| BUG-08 | ✅ | `podarUndo` diferido con `setImmediate` cada 16 escrituras: ya no hace `readdir`+`stat` de hasta 400 JSON en la ruta crítica de cada guardado. | `prueba-api.mjs` (deshacer) |
| BUG-09 | ✅ | Eliminados el tope duro de 4 lecturas y el bloqueo permanente tras 2 fallos de comando: se informa y el modelo puede corregir y reintentar; el control real es el progreso. | `prueba-agente-limites.mjs`, `prueba-agente.mjs` |
| BUG-10 | ✅ | Eliminada la auto-ejecución de `.py` por la palabra «pdf»/«ejecut»; solo actúan las `tool_calls` (o las heurísticas cuando el modelo no tiene herramientas). | `prueba-agente.mjs` |

---

## 4. Simplificación y mejoras

1. **Módulos extraídos de `ui-server.mjs`** (la auditoría pedía separar responsabilidades):
   - `chat/sse.mjs` — lector/parser SSE único; lo usan `bonsai-chat.mjs`, los medidores y el evaluador.
   - `chat/almacen-json.mjs` — escritura atómica con `fsync`, copia `.bak`, apartado de corruptos.
   - `chat/lecturas.mjs` — política de lectura para el agente: `stat` previo, streaming, rangos, líneas gigantes.
   - `chat/historial.mjs` — índice, copia de trabajo/archivada, recuperación y política de verdad.
   - `ui-server.mjs` baja de 3263 a ~3350 líneas **netas** pese a todo el código nuevo de los
     hallazgos; las rutas HTTP y el bucle del agente quedan como composición.
2. **Tool calling**: las `tool_calls` nativas tienen prioridad; las heurísticas de texto solo
   actúan cuando el modelo no tiene dialecto declarado. Sin dobles ejecuciones ni archivos no pedidos.
3. **Diff sin LCS**: `unifiedDiff` sustituye la matriz O(N×M) por prefijo/sufijo + anclas
   *patience* con histograma y pilas; mismo formato, 100.000 líneas en ~34 ms.
4. **Frontend**: el script inline de `index.html` (1750 líneas) se extrajo byte a byte a
   `chat/ui/chat-core.js` (script clásico, mismo orden y ámbito); los monkeypatches necesarios
   de `app.js` quedan cubiertos por el test de humo con navegador real.
5. **Pruebas**: `package.json` raíz + `scripts/run-tests.mjs` con grupos `aisladas` (26),
   `gpu` (4) y `navegador` (3); resumen OK/FALLO y código de salida 0/1. `README.md` reescrito
   como guía actual corta; histórico en `docs/HISTORICO-2026-10-27-27b.md`.
6. **Perfil GPU**: búsqueda de la mejor combinación en vez de techo fijo; persistencia y
   reutilización del perfil; DryRun determinista para probar sin GPU (`-FreeMiBOverride`).

### 4.6 Comportamiento nuevo del arranque (verificado en GPU real)

- Con ~7.900 MiB libres y visión, el auto elige **32768 tokens / KV q8_0** (presupuesto
  conservador 7821 MiB); antes se quedaba en 16384/f16. Sin visión elige 32768/f16.
- **Carga real verificada** (`start-server.ps1 -ManagedByIDE -Vision`, puerto 8099):
  `/health` OK, `/props` → `n_ctx = 32768`, `vision = true`; el marcador quedó con
  `contexto=32768`, `kv=q8_0`, `vision=true` y `pidServidor` real; al parar se cerró el
  servidor, se borró el marcador y la VRAM volvió a quedar libre (sin procesos `llama-*`).
- El perfil queda en `logs/perfil-servidor-<puerto>.json` y el siguiente arranque lo reutiliza
  si sigue cabiendo; si no, re-busca y reescribe.
- Todos los tensores, KV y proyector van a CUDA0; si no cabe, error claro (nunca CPU).

---

## 5. Otras mejoras aplicadas durante el trabajo

- `readChatIndex` reconstruye el índice desde los archivos si `index.json` está corrupto.
- `/api/state` incluye `presupuesto` e `historial.error` (la UI avisa si el archivado falla).
- El evento `done` del agente lleva `motivo`, `saltos` e `incompleto`.
- El cierre forzado del agente es un mensaje interno reconocible (no se pinta como usuario y no
  se confunde con el pedido al resumir).
- Lecturas con caché por versión: recuperar evidencia plegada ya no está prohibido.
- `prueba-agente.mjs` actualizado a la conducta nueva (relectura con caché y cierre honesto).
- `.gitignore` ya cubría estado/secretos; no se añadieron dependencias.

---

## 6. Cómo verificar (comandos)

```powershell
cd C:\Users\user\Documents\prject_local_AI
npm test                 # 26 suites aisladas (~63 s): todo debe decir "Todo en verde"
npm run test:navegador   # 3 suites con Edge headless (~6 s)
npm run test:gpu         # opcional: requiere modelo real cargado (lento)
node chat/prueba-calidad-kv.mjs --real   # comparativa de calidad q8_0/f16/q4_0 (~8-10 min)

# Pruebas puntuales de los hallazgos más delicados:
node chat/prueba-agente-limites.mjs      # 13, 14, 15, 20
node chat/prueba-lecturas.mjs            # 4, 19, 20
node chat/prueba-servidor-estado.mjs     # 2, 4, 5, 6, 8, 16
node chat/prueba-contexto.mjs            # 16, 18, 21
node chat/prueba-stream.mjs              # 1
node chat/prueba-editor.mjs              # 8, 9, 10, 11
node chat/prueba-servidor-administrado.mjs --gpu   # BUG-05 real (arranca y para el modelo)
```

---

## 7. Límites y riesgos que quedan (honestos)

- **Calidad del KV**: medida con la batería NIAH + perplejidad + tareas de código de
  [docs/CALIDAD-KV-2026-10-27.md](docs/CALIDAD-KV-2026-10-27.md): q8_0 a 32K es equivalente
  a f16 a 32K en esas pruebas (+0,41% de perplejidad, mismos aciertos). Es una sola pasada a
  `temperature: 0`; descarta degradaciones grandes, no certifica diferencias menores del 0,5%
  ni el comportamiento en tareas muy distintas. `prueba-modelos.mjs --real` sigue siendo el
  único test que reinicia el modelo en caliente.
- **SSE**: el lector nuevo exige una línea en blanco entre eventos (formato SSE estándar y lo
  que envía `llama-server`); un servidor no conforme sería rechazado como JSON inválido.
- **Guardia**: un túnel/proxy inverso que reenvíe un HOSTNAME PÚBLICO distinto del de la máquina
  sigue bloqueado a propósito; si se necesita, habría que añadir una allowlist explícita.
- **TOCTOU local**: la comprobación lstat→uso es *best-effort*; un proceso local concurrente
  puede ganar la carrera. Está documentado en `archivos-seguros.mjs`.
- **Evaluador**: `evaluar/ejecutar.mjs` y `tarea-grande.mjs` solo se verificaron por sintaxis y
  revisión porque necesitan modelo real; los smoke de medición sí pasan con servidor falso.
- **Repro histórico**: `salida/auditoria-codex-ornith/repro.mjs` sigue comprobando el
  comportamiento antiguo (roto por diseño); no debe usarse como suite de regresión.
- **UI**: `/api/state` se pide al abrir Ajustes/arrancar; con conversaciones enormes puede
  tardar un poco (no va en bucle).
- Los archivos `.lock` de herramientas pueden aparecer de forma transitoria en `chat/` y
  `scripts/`; no forman parte del producto y se pueden borrar.

---

## 8. Archivos principales tocados

- **Nuevos**: `chat/sse.mjs`, `chat/almacen-json.mjs`, `chat/lecturas.mjs`, `chat/historial.mjs`,
  `chat/prueba-stream.mjs`, `chat/prueba-contexto.mjs`, `chat/prueba-lecturas.mjs`,
  `chat/prueba-agente-limites.mjs`, `chat/prueba-servidor-estado.mjs`, `chat/prueba-editor.mjs`,
  `chat/prueba-markdown-seguro.mjs`, `chat/prueba-navegador-rutas.mjs`, `chat/prueba-perfil-gpu.mjs`,
  `chat/prueba-ui-humo.mjs`, `chat/prueba-calidad-kv.mjs` (GPU real), `chat/ui/chat-core.js`,
  `package.json`, `scripts/run-tests.mjs`, `docs/HISTORICO-2026-10-27-27b.md`,
  `docs/CALIDAD-KV-2026-10-27.md`.
- **Modificados**: `chat/ui-server.mjs`, `chat/bonsai-chat.mjs`, `chat/context.mjs`,
  `chat/editar.mjs`, `chat/actions.mjs`, `chat/procesos.mjs`, `chat/navegador.mjs`,
  `chat/guardia.mjs`, `chat/modelo.mjs`, `chat/modelo.json`, `chat/archivos-seguros.mjs`,
  `chat/ui/app.js`, `chat/ui/index.html`, `chat/ui/markdown.js`, `chat/evaluar/copia-app.mjs`,
  `chat/medir-agente.mjs`, `chat/medir-formato.mjs`, `chat/medir-stacks.mjs`,
  `chat/evaluar/ejecutar.mjs`, `chat/evaluar/tarea-grande.mjs`, `scripts/start-gpu-model.ps1`,
  `scripts/stop-managed-server.ps1`, `scripts/start-ui.ps1`, `README.md` y varias suites
  existentes (expectativas actualizadas a la conducta corregida).
