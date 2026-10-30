# HANDOFF · Bonsai (app local tipo Cursor sobre Ternary-Bonsai-2-27B)

> ⚠️ **Actualizado el 2026-10-04 (sesión 2).** Varias cosas de este documento han cambiado; lo
> verificado y corregido está en **[AUDITORIA-HANDOFF.md](AUDITORIA-HANDOFF.md)**. Resumen de lo que
> ya NO es cierto aquí abajo:
> - El modelo predeterminado es **Override-6** (no BoldingBuilds); el anterior queda con
>   `-Modelo bolding_v1`. Ver [INTEGRACION-MODELO.md](INTEGRACION-MODELO.md).
> - La **seguridad CSRF está arreglada** y con pruebas (`chat/guardia.mjs` + `prueba-seguridad.mjs`).
> - La **corrida 2 del evaluador no existe**: se perdió en un scratchpad. Hay que repetirla.
> - El **editor ya no es de solo lectura**: tiene pestañas, guardado (Ctrl+S), paleta de comandos,
>   búsqueda, git, ajustes y tema claro/oscuro.
> - El README **ya no** describe "64k fijo" (eso solo queda en `ARQUITECTURA…md` §1).
>
> Escrito el 2026-10-04 para que otra sesión (o tú) continúe sin el contexto de la conversación.
> Lee primero la sección 0; el resto es referencia. Todo lo de abajo se verificó en esta máquina, salvo lo marcado **(sin probar)**.

---

## 0. Resumen

**Qué se quiere** (palabras del usuario, resumidas): que Bonsai sea una app de modelo local **tipo Cursor IDE con todas las funciones posibles**, consciente de que el hardware es limitado (**RTX 4060 Laptop de 8 GB, 16 GB de RAM**), que **el modelo use el 100 % de la GPU**, probando la app con **muchas tareas**, midiendo los fallos y arreglándolos, y **mejorando la interfaz**.

**Reglas del usuario que no se deben romper**
- **Thinking mode APAGADO por defecto** (`--reasoning off` en el servidor, `enable_thinking:false` en el cliente). Solo opt-in explícito (`-Pensar N` / `--think N`). Está en la memoria de Claude (`thinking-mode-off-by-default`).
- Habla español; los textos de la app y de los `.ps1` van en español (los `.ps1` **sin tildes**: PowerShell 5.1 lee los scripts sin BOM como ANSI).
- No descargar nada sin pedir permiso (visión `mmproj`, drafter DSpark: ver sección 5).
- No tocar sus datos: `chat/ui-session.json`, `chat/ui-chats/`, `chat/ui-workspace.json` y la carpeta `C:\Users\user\Documents\teset` son suyos. Para probar usa `BONSAI_STATE` (sección 1).

**Estado de un vistazo**

| Área | Estado |
|---|---|
| Servidor llama.cpp (flags, VRAM, contexto automático) | ✅ hecho y medido en el servidor real |
| Calibración (`optimizar.ps1`) | ✅ ejecutada; resultados en `config/optimo.json` |
| Cliente (muestreo, timings, histéresis de plegado) | ✅ hecho, con pruebas |
| Evaluador del agente de punta a punta (19 tareas) | ✅ hecho. Corrida 1: **15/19**. Arreglos aplicados. Corrida 2: ver sección 3 |
| Interfaz: markdown + resaltado, medidor de hardware | ✅ hecho y visto en el navegador |
| Interfaz: **editor con pestañas, guardado, undo, reglas, ajustes, Ctrl+K, git, búsqueda** | ❌ **pendiente** (diseño en la sección 4) |
| **Seguridad: la UI acepta `POST` desde cualquier web (CSRF)** | ❌ **pendiente y urgente** (sección 4.3) |
| README / ARQUITECTURA | 🟡 actualizados a medias: hablan de 64k fijo; ver sección 7 |

---

## 1. Cómo arrancar, probar y no estorbar

```powershell
.\scripts\start-server.ps1                 # servidor: contexto AUTOMATICO (con 7956 MiB libres => 77824). -DryRun solo comprueba
.\scripts\start-ui.ps1                     # app en http://127.0.0.1:8787 (arranca el servidor si no está)
.\scripts\optimizar.ps1 -Plan -Todo        # calibración (ya hecha; no repetir salvo cambio de hardware)
```

**Pruebas SIN GPU** (todas deben imprimir `ok`):
```powershell
node chat\modelo.mjs            # "modelo ok"       datos del GGUF y cuentas de VRAM (puntos medidos)
node chat\actions.mjs           # "actions ok"      acciones/herramientas
node chat\bonsai-chat.mjs --self-test   # "self-test ok"   empaquetado de historial (con histéresis)
node chat\prueba-sin-gpu.mjs    # "prueba sin GPU ok"   cliente contra un llama-server FALSO
node chat\prueba-ui.mjs         # "prueba ui ok"    markdown y resaltado
```

**Evaluación con el modelo real** (necesita el servidor en el puerto 8080):
```powershell
node chat\evaluar\ejecutar.mjs                                  # las 19 tareas (~9 min)
node chat\evaluar\ejecutar.mjs --tareas hola-py,sqlite --salida C:\ruta
```
Levanta su propia copia aislada de `chat/` en el puerto **8791** con estado propio, manda cada tarea por `/api/chat` como el navegador, valida con código (ejecuta lo que escribió el modelo) y deja `informe.md/json` y un `tarea-<id>.json` por tarea con la traza. **No mandes mensajes al chat mientras corre** (el servidor tiene un solo slot).

**Aislar pruebas de la UI** (no toca los chats ni la carpeta de trabajo del usuario):
```bash
export BONSAI_STATE=<carpeta> BONSAI_SALIDA=<carpeta>
node chat/ui-server.mjs --port 8788 --llama-port 8080
curl -X POST localhost:8788/api/workspace -H "Content-Type: application/json" -d '{"path":"<carpeta de proyecto de prueba>"}'
```
Hay que **reiniciar** `ui-server.mjs` tras cambiar código del servidor (los `/ui/*.js|css` y `index.html` se leen del disco en cada petición; no hace falta). El panel Browser de Claude Code puede mostrar `index.html` como "archivo local" tras editarlo: abre una pestaña nueva con la URL.

**Procesos que dejé abiertos al escribir esto** (ciérralos si no los necesitas; el usuario quiere la GPU libre cuando no se prueba):
`llama-server` (≈7.4 GB de VRAM), una instancia de UI de pruebas en el puerto **8788** y, si sigue en marcha, la evaluación 2 (UI en el **8791**). Comprobación: `nvidia-smi` y `Get-NetTCPConnection -LocalPort 8080,8788,8791 -State Listen`.

---

## 2. Hechos medidos (no re-descubrir)

**Hardware**: RTX 4060 Laptop, 8188 MiB, 256 GB/s; **límite de potencia 80 W** (máx. 140 W), relojes ~2460 MHz bajo carga; Ryzen 7 7840HS; **15.7 GB de RAM** (suelen quedar ~3 GB libres); Windows 10 LTSC, Windows PowerShell 5.1. El "modo turbo" del PC **no cambió nada** (+~1 %, ruido): el cap de 80 W sigue.

**Modelo** (cabecera del GGUF, `qwen35.*`): 64 bloques = **16 de atención completa** (3,7,…,63) + **48 lineales (Gated DeltaNet)**; 24 cabezas Q, **4 KV, dim 256**; contexto nativo 262144; vocab 248320; plantilla con herramientas XML, `enable_thinking`, `reasoning_effort ∈ {xhigh, medium, low}` (**`high` da HTTP 500**). Binarios: PrismML llama.cpp build **10743**, CUDA 12.x (no usar 13.3: se cierra en silencio).

**Velocidad real** (llama-bench y servidor real; coinciden): generación **28.3–28.6 t/s** (no depende de `-ub` ni de hilos: límite = ancho de banda), lectura del prompt **626–649 t/s con `-ub 256`** (630 con 512, 616 con 1024). Con contexto lleno: 8k → 26.0 t/s gen / 584 lectura; 32k → 20.4 / 452. La estimación "35–45 t/s" del README viejo era imposible (techo físico ≈ 43).

**VRAM (modelo exacto en `chat/modelo.json` + `chat/modelo.mjs` + `scripts/start-server.ps1`)**: usado = pesos 5395 + estado recurrente 150 + CUDA 138 + KV(ctx, tipo) + cómputo(ctx, ub). KV q4_0 = 18 KiB/token (f16 64, q8_0 34). Cómputo = max(255, 40 + 4.5·ctx/1024) MiB (+0.302 MiB por token de `-ub` sobre 256). Medido con `nvidia-smi`: **7163 / 7253 / 7343 / 7433 / 7523 MiB** a 64k/68k/72k/76k/80k (22 MiB por 1k). **Al arrancar** se reserva dos veces la parte del cómputo que depende del contexto: pico = usado + cómputo(ctx). Con 7956 MiB libres: 81920 arranca (pico 7923), **83968 falla** (`cudaMalloc` OOM; falla limpio, no desborda a RAM). `llama-fit-params` **no sirve** para elegir contexto (demasiado conservador y sobrestima `-ub`).

**Calidad del KV** (perplejidad, 16×2048 tokens de código y docs propios): f16 1.9711 · q8_0 1.9710 · **q4_0 1.9749** (+0.004) · q4_0 + sesgo de media sin rotación 1.9756. ⇒ **q4_0 es casi gratis; el sesgo `--kv-mean-center` NO ayuda** (queda calculado en `models/*-kv-bias.gguf` pero `config/optimo.json` tiene `kvBias:false` y `start-server.ps1` lo ignora). Solo medido a 2k de contexto; a 64k+ no se midió.

**Caché de prompt del modelo híbrido**: los valores por defecto de llama.cpp **ya reutilizan el prefijo**, incluso reescribiendo el mensaje anterior (4749 de 4839 tokens en caché). No tocar `-ctxcp/-cms`; solo se limita `-cram` a ¼ de la RAM.

**Otros**: `KNOWN_ISSUES` de `prism-ml/Ternary-Bonsai-2-27B-gguf`: KV solo en parejas iguales (f16/q8_0/q4_0; mezclas y q5_x no); `ngram-*` y MTP no aceleran; "tool calls mal formadas" es limitación del modelo. El servidor corre con "Prefer No Sysmem Fallback" (falla en vez de desbordar).

**Uso de GPU en tareas de agente** (evaluador): 86–96 % de media, ≥85 % de las muestras el 85–100 % del tiempo. El tiempo muerto restante es de herramientas/HTTP. La generación ya está limitada por ancho de banda; lo único que subiría el rendimiento real es **especulación** (sección 5).

---

## 3. Evaluación del agente (la parte "probar con muchas tareas")

`chat/evaluar/tareas.mjs` (19 tareas: scripts, tests, bug, renombrar en varios archivos, HTML, JSON, CSV, LRU, node:test, sqlite, error recuperable, paquete, regex, chat sin herramientas, búsqueda en proyecto, editar JSON, 3 pasos) y `ejecutar.mjs` (runner). Informes en `chat/evaluar/resultados/`.

**Corrida 1 (código antes de los arreglos): 15/19** → `resultados/2026-10-04-eval-1-antes-de-los-arreglos.md`.
- 4 fallos: 2 defectos de **mi tarea** (corregidos: `hola-py` "exactamente: Hola, Bonsai." ambiguo por el punto; `csv-stats` esperaba 36.63 y Python imprime 36.62), 1 **modelo** (`regex-fechas`: sin límites de palabra captura `23/45/6789`), 1 **app** (`explicar-codigo`).
- Agregados que delataron fallos sistémicos de la app: **20 comandos fallidos por `.venv\Scripts\python` inexistente**; **6/18 respuestas finales vacías**; **9 llamadas `leer` sin ruta rechazadas** (la propia descripción de la función dice "sin ruta, lista la carpeta"); 24 acciones repetidas bloqueadas; media **7.2 saltos** por tarea (82 de más, ≈3.8 s cada uno); una **búsqueda web lanzada** porque la respuesta mencionaba la función `buscar` (heurística `impliedAction`).

**Arreglos aplicados** (todos con pruebas offline donde cabe):
1. `chat/actions.mjs`: `leer` sin ruta/`.` ⇒ índice de la carpeta; `impliedAction` solo si **anuncia** la acción ("Voy a buscar…", ≤400 car.).
2. `chat/bonsai-chat.mjs`: la instrucción de sistema usa `this.pythonCmd` (`python`, o `.venv\Scripts\python` solo si existe); añade "no crees archivos que no te pidan / no repitas comprobaciones / cierra con un resumen"; `toolChoice` (para cerrar sin llamar herramientas manteniendo el prompt).
3. `chat/ui-server.mjs`: reescribe `.venv\Scripts\python` inexistente a `python`; **mensaje de seguimiento nuevo** (cierra en cuanto lo pedido esté hecho y comprobado; antes empujaba a "la lectura final"); **turno de cierre** con `tool_choice:"none"` si el último turno del asistente quedó vacío; mensajes de Linux usan `chat.pythonCmd`.

**Corrida 2 (con arreglos)**: en curso al escribir esto; el archivo de salida del runner está en el scratchpad de la sesión (efímero). Primeros datos A/B: `renombrar` 31.9 s/13 saltos → **20.3 s/5 saltos**. Resultado final: ver `resultados/2026-10-04-eval-2-con-arreglos.md` si llegó a copiarse; si no, **vuelve a correr el evaluador** (9 min).

**Qué hacer después** (siguientes mejoras del agente, por orden de valor):
- Repetir cada tarea 3 veces (temperatura 0.5 ⇒ hay varianza; un 15/19 puede ser 13–17) y comparar medias antes/después de cualquier cambio.
- Tareas más duras/realistas: proyecto de 10+ archivos, bug que exige leer varios archivos, refactor con tests, tarea de 20+ saltos, instrucciones en español ambiguas, archivos grandes (>700 tokens se recortan en `describeRead`), contexto que supera el tope de historial (plegado con resumen).
- Herramienta `grep`/buscar en el código (hoy solo `indice` + `leer`; buscar un símbolo en un repo grande obliga a leer archivos enteros). Añadir al esquema `PC_TOOLS` de `actions.mjs`, a `nativeToolEffects` y a `present()` de `ui-server.mjs`.
- Probar el modo razonamiento (`-Pensar 2048`) con el evaluador **solo como experimento**: ¿mejora `lru-cache`/`regex-fechas` sin romper el resto? Verificar antes si la petición puede encenderlo con el servidor en `--reasoning off` (sin probar).

---

## 4. Interfaz

### 4.1 Cómo está hecha (para no romperla)
`chat/ui/index.html` (~2100 líneas, JS **sin framework**, dos `<script>` clásicos: los `let/const/function` de primer nivel son globales y se pueden reasignar desde otro script). Paneles: `#history`, `#files`, `#editor` (hoy **solo visor** de solo lectura: `#code` con `.nums` + `.src`), `#chat`; barra `.statusbar`. Puntos clave: `openFile(rel)`, `refreshTree()`, `applyWorkspace()`, `selectionInsideEditor()`, `paintAction()` (tarjetas de acciones/diffs), `syncLive()`+`liveSteps()` (parseo legado de bloques ``` ```ejecutar ``` ``` para modelos sin tool calls nativos; **no quitar**), `ask()` (SSE de `/api/chat`: eventos `start|token|replace|action|file|usage|speed|status|done|error`), `hiddenTurn()` oculta los mensajes que empiezan por "Sigue con lo que pedí" (**conserva ese prefijo** en cualquier mensaje interno nuevo).

### 4.2 Hecho
- `chat/ui/markdown.js` (UMD, sin DOM, **probado en Node**): markdown seguro (todo escapado; solo enlaces http/https), listas anidadas, tablas, citas, código con resaltado propio (js/ts, python, json, html con `<script>/<style>`, css, powershell/bash, sql, c-like). `index.html` lo usa vía `setBody(node, text, now)` (repinta cada 70 ms al hacer streaming; `data-raw` guarda el texto crudo para "Copiar"). Botón Copiar de cada bloque (delegado en `ide.js`).
- `chat/ui/ide.css`, `chat/ui/ide.js` (se cargan al final de `index.html`): **medidor de hardware** en la barra inferior (GPU %, sparkline 60 s, VRAM, °C, W, t/s de la última respuesta, RAM) con popover de detalle; endpoint `GET /api/gpu` (nvidia-smi cacheado 900 ms).
- `ui-server.mjs`: rutas estáticas `GET /ui/<archivo>.js|css`, `GET /api/gpu`, variables `BONSAI_STATE`/`BONSAI_SALIDA`.

### 4.3 Pendiente (en este orden)
1. **SEGURIDAD (urgente, preexistente)**: `ui-server.mjs` acepta `POST /api/chat|workspace|permit…` con cualquier `Origin`/`Host`. Una web abierta en el navegador puede mandar un `fetch(..., {mode:"no-cors"})` a `127.0.0.1:8787` y, con el permiso en "Ejecutar todo" (así está en `chat/ui-permit.json`), hacer que el modelo ejecute comandos en el PC; también DNS rebinding. Arreglo previsto al principio del manejador: rechazar (403) si `Host` no es `127.0.0.1:<puerto>|localhost:<puerto>` o si hay `Origin` y no es exactamente `http://<Host>`; exigir `Content-Type: application/json` en los `POST`. El evaluador y `curl` no mandan `Origin` ⇒ siguen funcionando. Añadir prueba (servidor falso + `fetch` con `Origin` ajeno ⇒ 403).
2. **Editor real** (hoy el panel central no edita): pestañas, edición con resaltado, guardado (Ctrl+S), indicador de cambios, recarga automática cuando el agente reescribe el archivo (hoy `refreshTree()` no recarga el abierto ⇒ el visor queda desactualizado). Diseño: `textarea` transparente sobre un `pre` resaltado en una rejilla de una sola celda (misma fuente/`tab-size`/`white-space:pre`), números de línea a la izquierda, contenedor único con scroll; sobrescribir `window.openFile` y `window.selectionInsideEditor` desde `ide.js`, y actualizar `opened`/`openedText`/`tab.textContent`; Tab/Shift+Tab, Enter con sangría, Ctrl+S. Servidor: `POST /api/file {path, content, create?}` (usar `fileInside`, bloquear `bin/models/.git`, tope ~2 MB) y `GET /api/file` con tope 400 KB + cabecera `X-Bonsai-Truncated` (hoy corta a 60 000 caracteres sin avisar: **no permitir guardar un archivo truncado**). Destello de las líneas que cambió el agente.
3. **Deshacer cambios del agente** (el equivalente al "Reject" de Cursor): en `present()` ya existe `beforeWrite`; guardar `{id, rel, before|null, after}` en `STATE/undo/…`, devolver `undo:id` en el evento `action` de escritura, botón "Deshacer" en la tarjeta y "Revertir todo el turno"; `POST /api/undo {id, force?}` (409 si el archivo cambió desde entonces).
4. **Reglas del proyecto** (compatibilidad Cursor): leer `BONSAI.md`, `AGENTS.md`, `.cursor/rules/*.mdc|md` (quitar el frontmatter; incluir las `alwaysApply` o sin frontmatter) con tope de ~700 tokens, y meterlas en el mensaje de sistema (`systemText(memory, rules)` en `context.mjs`; contarlas en `historyTokens`). Estables por carpeta ⇒ no rompen la caché. Chip "Reglas: N" en el chat.
5. **Panel de ajustes** (⚙): perfil de muestreo (`codigo`/`chat`), **razonamiento opt-in** (apagado) con presupuesto, llamadas en paralelo, tope de historial, modo de permisos. `GET/POST /api/settings` aplicados en caliente al `BonsaiChat`.
6. **Edición en línea (Ctrl+K)** sobre la selección del editor: `POST /api/edit {rel, start, end, instruccion}` ⇒ prompt acotado sin herramientas ⇒ reemplazo ⇒ diff (reutilizar `liveDiff`) con Aceptar/Rechazar.
7. **Git**: estado (`git status --porcelain`) con insignias M/A/? en el explorador, diff de un archivo, commit con mensaje sugerido por el modelo. Solo lectura salvo el commit explícito.
8. **Búsqueda en el código** (Ctrl+Shift+F) y **paleta de comandos / abrir archivo** (Ctrl+P); atajos; tema claro; regenerar/editar mensaje.
9. Nuevo-archivo/renombrar/borrar desde el explorador; adjuntar imágenes (necesita visión, sección 5).

Cada paso debe ir con prueba: lógica pura en módulos sin DOM (como `markdown.js` + `prueba-ui.mjs`) y revisión visual en una pestaña nueva del navegador (`http://127.0.0.1:8788`, viewport 1440×900).

---

## 5. Decisiones que son del usuario (no actuar sin preguntar)

- **Visión**: `Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf` de `prism-ml/Ternary-Bonsai-2-27B-gguf` (descarga; no probado con los pesos abliterados). Se serviría con `--mmproj <archivo> --no-mmproj-offload --image-max-tokens 1024`.
- **Especulación (DSpark, ~2× en generación según el fabricante)**: el fork trae `--spec-type draft-dspark` pero **no hay un drafter publicado y listo** para Bonsai 2 (los antiguos requieren conversión). Es la única vía real para subir los 28 t/s; reabrir si PrismML lo publica. No pasar por `ngram-*`/MTP (no sirven).
- **Contexto mayor de 77k**: cabe hasta ~81920 con la VRAM libre actual, pero deja ~30 MiB de margen al arrancar. El valor automático ya es prudente.
- **Modo razonamiento**: decidir si se quiere exponer en la UI (siempre apagado por defecto).

---

## 6. Mapa de archivos tocados

Nuevos: `HANDOFF.md`, `chat/modelo.json|.mjs`, `chat/prueba-sin-gpu.mjs`, `chat/prueba-ui.mjs`, `chat/ui/markdown.js|ide.js|ide.css`, `chat/evaluar/{ejecutar,tareas}.mjs` + `resultados/`, `scripts/optimizar.ps1`, `scripts/calibracion.txt`, `scripts/aider/*`, `config/optimo.json` (generado, ignorado por git), `models/*-kv-bias.gguf` (generado, sin uso).
Modificados: `chat/{bonsai-chat,context,actions,ui-server}.mjs`, `chat/ui/index.html`, `scripts/{start-server,start-ui,start-chat,start-aider,start-cursor-bridge,test-cli}.ps1`, `README.md`, `ARQUITECTURA-Y-PLAN-MAESTRO.md`, `.gitignore`.
Ajenos (de otra sesión, no tocar): `informe_abliterated_2026-10-04.md`, `research_readmes/`.
Git: el repo tiene **un solo commit** (`test_math.py`); nada de esto está commiteado.

---

## 7. Deudas y avisos

- `README.md` y `ARQUITECTURA-Y-PLAN-MAESTRO.md` aún describen "64k fijo", la fórmula de VRAM vieja y no mencionan el contexto automático, el pico de arranque, el evaluador ni la corrida de calibración: **actualizarlos** con la sección 2 de este documento.
- `chat/ui-permit.json` del usuario está en `"all"` (ejecuta comandos sin preguntar). Combinado con la falta de guard de `Origin` (4.3.1) es el mayor riesgo actual.
- El comando del agente corre con Git Bash (`ls -la` devuelve formato Unix) y Python de `uv` en el PATH (`commandEnv()` en `ui-server.mjs`).
- Si `start-server.ps1` falla al arrancar por falta de VRAM, en modo automático reintenta con 8192 tokens menos (hasta 4 veces); con contexto fijo, no.
- Las pruebas de UI solo cubren `markdown.js`; no hay pruebas de navegador.
