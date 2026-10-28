# Informe de viabilidad · Bonsai Local IDE

**Fecha:** 27 de octubre de 2026 · **Máquina:** DESKTOP-SCTPQ4D (Windows 11, Ryzen 7 7840HS, 16 GB RAM, RTX 4060 Laptop 8 GB)
**Proyecto:** `C:\Users\user\Documents\prject_local_AI` · **Modelo activo:** Ornith-1.5-9B Q4_K_M + visión
**Método:** análisis en equipo (4 frentes en paralelo) + medición real en esta GPU esa misma noche.
**Encargos:** madurez del código (medido), calidad del modelo (artefactos + corridas), brechas de producto (lectura de código) y GPU real (arranque, VRAM, tok/s, agente de punta a punta).

---

## 0. Respuesta directa

**1) ¿Se puede usar el proyecto para codear apps en local?** — **Sí, pero con un alcance muy concreto:** sirve para tareas pequeñas y medianas (1–4 archivos, con verificación) y para construir prototipos desde el chat. **No es todavía un IDE de uso diario** para un proyecto serio: no tiene autocompletado, ni diagnósticos/LSP, ni terminal integrado, ni test runner, y el repositorio no es reproducible tal como está.

**2) ¿Es demasiado inmaduro / qué le falta?** — **No es un juguete.** Tiene ingeniería defensiva real (escritura atómica con `fsync`, undo, guardas de seguridad, 856 aserciones en 7.249 líneas de pruebas, agente que se autocorrige). Lo que le falta es la capa de "herramienta diaria" y el cierre de producto: **commits/CI, suites herméticas, autocompletado/LSP, terminal, test runner y portabilidad**. Estimación de los propios análisis: **~2–3 semanas de trabajo P0** para uso personal serio, **~2–3 meses** para producto distribuible.

**3) ¿Podré codear con mi GPU en mi PC o definitivamente no puedo?** — **Sí puedes. No estás en el escenario "no puedo".** Medido esa misma noche en tu RTX 4060 de 8 GB:

| Medida real | Resultado |
|---|---|
| Modelo completo en GPU | **34/34 capas + proyector de visión en CUDA0**, `graph splits = 1` (nada en CPU) |
| VRAM ocupada | **7.339 MiB de 8.188** (89,6 %); quedan **618 MiB** (pico 7.387 durante inferencia) |
| Generación | **40,5–41,5 tok/s estables** (500 tokens seguidos en 12,1 s) |
| Lectura de contexto (prefill) | **≈1.700 tok/s**: 3.375 tokens en 1,94 s; 11.823 tokens en 6,90 s |
| Latencia al primer token | **0,13–0,40 s** en prompts cortos |
| Contexto máximo fiable | **32.768 tokens** con KV q8_0 + visión (historial efectivo de la UI: 16.256) |
| Visión | Funciona (describió una captura en 2,23 s, 41 tok/s) |
| Flujo real `start-ui.ps1` | Modelo + interfaz en ~10 s, `:8787` responde 200, chat SSE en 1,52 s, parada limpia (VRAM vuelve a 0) |
| Agente de punta a punta | **3/3 tareas correctas en 62 s** (fizzbuzz con autocorrección, HTML verificado en navegador real, SQLite validado contra la base de datos) |

**El límite no es la GPU para este proyecto: es el tamaño de modelo que cabe.** Con este perfil (32K + visión) el margen es de **618 MiB**, o sea **+0,6 GB de pesos como máximo (GGUF ~6,4 GB)**. Un 13–14B Q4 no cabe; si no cabe, el arranque se niega con un error claro en vez de tirar de CPU.

---

## 1. Qué es el proyecto

Un IDE de escritorio-servidor, 100 % local, que no depende de la nube: un servidor Node propio sirve una interfaz web (explorador, editor con pestañas, chat/agente, git por archivos, búsqueda, navegador headless, visión/OCR) y habla con `llama.cpp` (`bin/llama-server.exe`) en `127.0.0.1:8080`. La UI va en `127.0.0.1:8787` y la API es compatible con OpenAI, así que también sirve para **Cursor y Aider** (`scripts/start-cursor-bridge.ps1`, `scripts/start-aider.ps1`).

![Interfaz del IDE](capturas/ui-2026-10-26-1366-oscuro.png)

Tamaño real: ~3.354 líneas en `chat/ui-server.mjs`, ~951 en `chat/context.mjs`, ~1.302 en `chat/actions.mjs`, UI vanilla ~3.860 líneas, **cero dependencias npm en la raíz** y una sola en `chat/` (`playwright-core`, importada de forma perezosa).

---

## 2. La GPU: por qué sí puedes (evidencia medida)

Prueba hecha el 27-oct entre 23:19 y 23:35 con el perfil recordado (32.768 / KV q8_0 / visión), arrancando `bin\llama-server.exe` con el comando que genera `start-server.ps1 -DryRun -Vision` y midiendo contra `/v1/chat/completions` y `nvidia-smi`.

### 2.1 Cabe entero, sin capas en CPU

```
load_tensors: offloaded 34/34 layers to GPU
load_tensors:        CUDA0 model buffer size =  5357.88 MiB
llama_kv_cache:      CUDA0 KV buffer size =   544.00 MiB   (32768 celdas, K q8_0 272 + V q8_0 272)
llama_memory_recurrent: CUDA0 RS buffer size = 50.25 MiB
sched_reserve:       CUDA0 compute buffer size = 248.10 MiB
clip_ctx: CLIP using CUDA0 backend            (mmproj BF16, 878.99 MiB)
graph splits = 1
```

Ningún tensor en CPU, ningún *fallback* silencioso, ningún OOM en toda la sesión.

### 2.2 Desglose de VRAM (nvidia-smi)

| Componente | MiB |
|---|---:|
| Pesos del modelo en CUDA0 (34/34 capas) | 5.357,88 |
| KV cache q8_0 a 32.768 | 544,00 |
| Estado recurrente Gated DeltaNet (32 capas) | 50,25 |
| Compute buffers CUDA0 (con visión y prefill) | 248,10 |
| Proyector de visión BF16 en CUDA0 | 878,99 |
| Contexto CUDA + driver + escritorio | ≈260 |
| **Total en reposo** | **7.339** (de 8.188) |
| **Libre** | **618** |

### 2.3 Velocidad

| Prueba | Resultado |
|---|---|
| Generación de código, 400 tokens, dos veces | 41,15 y 41,14 tok/s |
| Generación sostenida, 500 tokens | 41,13 tok/s (12,1 s) |
| Prefill 3.375 tokens | 1.742 tok/s (1,94 s) |
| Prefill 11.823 tokens | 1.714 tok/s (6,90 s) |
| TTFT (streaming) | 0,133 s / 0,255 s / 0,404 s (prompts de 90 / 303 / 559 tok) |
| GPU en carga | 74–94 %, 2.400–2.655 MHz, 66 °C máx, sin throttling apreciable |

Referencia práctica: un turno de agente de 500–1.000 tokens generados tarda **12–25 s**; una respuesta corta, 2–3 s.

### 2.4 Contexto y flujo de usuario

- **32.768 tokens** es el techo fiable con visión (q8_0). Sin visión, el perfil automático es 32.768 / KV f16 (presupuesto 7.401 MiB). Visión + f16 no cabe y el script se niega a arrancar.
- La interfaz reparte así: **ventana 32.768 · historial efectivo 16.256 · reserva de salida 16.512**. Es decir, en el chat tienes ~16K de contexto útil, no 32K.
- `start-ui.ps1`: interfaz lista en ~10 s, `GET /` 200, `/api/state` y `/api/stats` correctos, chat SSE "hola" en 1,52 s, `stop-managed-server.ps1` cierra y deja la VRAM en 0.
- Visión real: describió correctamente una captura de la propia UI (518 tokens de prompt, 41 tok/s, 2,23 s).

### 2.5 Límite de hardware

| Escenario | Qué pasa |
|---|---|
| Modelo actual (9B Q4 + 32K + visión) | Cabe con 618 MiB de margen |
| GGUF mayor | Hasta **~6,4 GB** de archivo sin recortar; +0,6 GB (11 %) de margen |
| Quitar visión | Libera ~1 GB (permitiría ~+1 GB de pesos) |
| KV q4_0 o bajar a 16K | Libera 272 MiB cada cambio |
| Un 13–14B Q4_K_M | **No cabe** con este perfil |
| Otra app usando GPU (juego, vídeo, navegador con aceleración) | El IDE **no arranca** (se niega en vez de usar CPU) |
| GPU limitada por energía (caso observado: 10 W en vez de 80 W) | Cae a **1,7 tok/s** y el flujo muere; revisar modo rendimiento/alimentación |

---

## 3. La calidad del modelo: qué puede y qué no

El proyecto tiene un evaluador propio de 19 tareas que manda pedidos al IDE como lo haría un usuario y **valida el resultado con código** (ejecuta archivos, compara salidas, usa el navegador). Resultados acumulados:

| Corrida | Modelo / ajuste | Aciertos | Velocidad |
|---|---|---|---|
| O1 | Ornith Q4 · 32K/F16 · pensar 2.048 | 17/19 | 41,8 tok/s |
| O2 | Ornith Q4 · 32K/F16 · sin pensar | **19/19** | ~40 tok/s |
| O3 | Ornith Q4 · 16K/Q8 · pensar | 18/19 | 41,8 tok/s |
| O4 | Ornith Q4 · 16K/F16 · sin pensar | 18/19 (corrida partida) | ~40 tok/s |
| K2 | K2-Horizon-7B · 16K/Q8 · "high effort" | 16/19* | 36,8 tok/s |
| Histórico | Ternary-Bonsai-27B Override-6 (etapa anterior) | 15–19/19 | ~28 tok/s |

\* El 16/19 de K2 incluye **al menos un falso negativo confirmado** del validador (`html-contador` funciona; la regex no reconocía `parseInt(...) + 1`: `html-counter-diagnostic.json`). Además se le dio un presupuesto de razonamiento de 2.048 tokens cuando su ficha pide ≥32.768 de salida: la comparación no es concluyente y **no hay motivo para cambiar de modelo**.

**Total Ornith: 72/76 (94,7 %)**, mediana 9–13 s por tarea. Y un dato importante: el 19/19 de `chat/evaluar/resultados/` que se cita en los documentos es del **27B anterior**, no de Ornith; el 19/19 de Ornith es una pasada aislada sin razonamiento (`salida/eval-ornith-2026-10-26-sin-pensar/`).

**Lo que el modelo hace bien (medido):** scripts Python con tests, funciones con asserts, arreglar bugs con tests en rojo, renombrar/empaquetar 2–4 archivos pequeños, JSON/CSV/SQLite simple, HTML/JS de un archivo, explicar/editar configuración, pasos múltiples, y un caso real de navegador+visión (leyó "CASA 3241" de una captura, arregló un contador y verificó el resultado).

**Lo que no está demostrado:** apps multi-módulo reales (API + CLI + fondo), archivos gigantes, contexto útil >12–16K, refactors largos sin supervisión, frameworks/builds, depuración profunda. El evaluador de 19 tareas es el **techo del arnés**, no del modelo: tres modelos locales puntúan 15–19/19, así que no discrimina bien.

**Modos de fallo reales vistos:** regex con grupos de captura (devolvía tuplas y aceptaba `23/45/6789`), `commit()` ausente en SQLite, colocar archivos en subcarpetas equivocadas, bucles de reescritura con timeout, y tool calls mal formadas (2 de 29 escrituras). No se vio corrupción de archivos del usuario en 76 ejecuciones.

**Conclusión honesta:** no es demasiado inmaduro para programar; **sí es insuficiente como único "ingeniero autónomo" de una app real**. Con tests y verificación, las unidades pequeñas salen (~95 %); sin supervisión, el riesgo de "código que parece bien y no funciona" es alto.

---

## 4. ¿Es inmaduro el proyecto? Radiografía de madurez

### 4.1 Lo que está bien (no es un juguete)

| Área | Evidencia |
|---|---|
| Pruebas | **26/26 suites aisladas OK · 74,1 s** y **3/3 de navegador OK · 6,4 s** (Edge real, medido). ~856 aserciones en 7.249 líneas de suites. |
| Ingeniería defensiva | Escritura atómica (temp + `fsync` + rename), cuarentena de historiales corruptos, cancelación que mata el árbol de procesos, cierre honesto del turno (`completed/step_limit/stalled/cancelled/error`), guarda anti-CSRF/DNS-rebinding, Markdown saneado. |
| Los 10 bugs de la auditoría | Arreglados **en el código y con prueba**, no solo en el informe (historial atómico, CSRF, SSE único, límites de lectura, cierre de `llama-server` huérfano, etc.). |
| Producto | Guardado con precondición 409 (no pisa cambios ajenos), undo por escritura y "revertir turno", Ctrl+K con diff Aceptar/Rechazar, reglas `BONSAI.md`/`AGENTS.md`/`.cursor/rules`, git por archivos, navegador headless solo local, cambio de modelo con rollback. |
| Agente | Se autocorrige (vio un test en rojo y lo arregló), verifica con el navegador real, y el servidor reutilizó **28.832 tokens de caché** en una corrida: eso es lo que hace viable un bucle de muchos pasos. |

### 4.2 Lo que lo delata como beta temprana

| Problema | Evidencia medida |
|---|---|
| **No es reproducible** | `git status` (antes de este informe): **30 archivos modificados + ~37–38 sin seguimiento**. Sin commitear: `package.json` raíz, `run-tests.mjs`, `sse/historial/lecturas/almacen-json`, `chat/ui/chat-core.js`. Un `git clone` limpio **no puede ni ejecutar `npm test`**. |
| **Suites no herméticas** | La primera pasada dio **25/26**: el puerto fijo 8798 estaba ocupado por huérfanos (PID 15940) de una corrida anterior del propio proyecto. Tras matar 3 huérfanos: 26/26. El "todo en verde" no era reproducible en el estado entregado. |
| **Monolito** | `main()` de `chat/ui-server.mjs` ocupa **2.303 de 3.354 líneas (68 %)**; el frontend conserva *monkeypatching* global (`app.js`). |
| **Cifras de los informes** | "63,1 s" → medido 74,1 s; "grupo gpu (4)" → son 5; "21/21 hallazgos de `reporte de codex.md`" no es verificable (ese documento no está en el repo). |
| **Un solo equipo** | Dependencia dura de **Windows + PowerShell + Edge + GPU NVIDIA 8 GB**. Sin GPU el IDE no abre (no hay "modo editor"). |
| **Documentación desactualizada** | `ARQUITECTURA-Y-PLAN-MAESTRO.md` describe la etapa del 27B (77K de contexto, 28 tok/s) como si fuera actual; el README describe Ornith 9B. |
| **Estado del repo** | 4 commits en total; `HEAD` es de las 15:07 y hay ediciones hasta las 23:07. |

### 4.3 Veredicto de madurez

| Dimensión | Nota | Comentario |
|---|---:|---|
| Ingeniería / robustez | **8/10** | Seria y con pruebas; muy por encima de un prototipo de fin de semana |
| Utilidad real hoy | **6,5/10** | Cumple en tareas acotadas; duele en flujos largos |
| Madurez como producto | **3/10** | Sin autocompletado/LSP/terminal/test runner, instalador ni CI |
| Reproducibilidad | **3/10** | El árbol actual no está en git; las suites dependen de limpieza manual |
| **Categoría** | **Beta temprana usable en un solo equipo** — no "usable a diario" todavía | |

---

## 5. Tu caso real: qué pasó con `finadmin`

Esto no es teoría. La sesión guardada del IDE (`chat/ui-session.json`) contiene **197 turnos** (11 mensajes tuyos reales, 91 acciones del agente y 91 resultados de herramientas) intentando construir una app de administración financiera (`finadmin`). Lo que muestra:

1. **El IDE cerró el turno a la fuerza 4 veces** por límite de pasos/atasco (mensajes internos "Sigue con lo que pedí…", que no se pintan en el chat).
2. Tus mensajes reflejan el problema: peticiones de **dejar de leer archivos y avanzar** ("sigues leyendo sin hacer nada", "continúa", "usa tu inteligencia y contexto para no leer tanto").
3. **El resultado no funciona.** El artefacto quedó en ~900 líneas (frontend + servidor Express/SQLite + un `install-nativo.js` de 184 líneas) y al probarlo ahora:
   - `server/src/server.js` **no compila**: `SyntaxError: Unexpected reserved word` (un `await import(...)` dentro de una función que no es `async`, línea 20).
   - **Dependencias sin instalar** (`node_modules` vacío) y **sin `package.json` en la raíz** de la app.
   - El agente se enrocó en **parchear MSVC/node-gyp para compilar `better-sqlite3`** (161 menciones) en vez de usar **`node:sqlite`, que ya viene dentro de Node 26** (0 menciones; verificado: `DatabaseSync` disponible). Ese es el patrón típico de un 9B: solución barata disponible y aun así elige la costosa.
4. Conclusión del caso: el agente **produce código con aspecto correcto pero no verificado**, y la app no se termina sin que tú revises y ejecutes. Es exactamente la diferencia entre "asistente útil" e "ingeniero autónomo".

---

## 6. Lo que le falta (priorizado)

| # | Brecha | ¿Bloquea? | Trabajo estimado |
|---|---|---|---|
| 1 | **Autocompletado inline/FIM y LSP** (el editor es un `<textarea>` con resaltado; no hay diagnósticos ni ir a definición) | Sí para uso diario | 2–3 semanas |
| 2 | **Terminal integrado y comandos largos** (`ejecutar` corta a 60 s y mata servidores al cerrar turno: `npm install`, builds, watch no caben) | Sí para apps reales | 5–10 días |
| 3 | **Reproducibilidad**: commit del árbol actual, CI (Windows/Node 22+), suites herméticas (puerto efímero, limpieza en `finally`) | Sí para confiar en él | 3–5 días |
| 4 | **Test runner / depuración integrados** y bucle "tests hasta verde" con mapeo error→línea | Alto impacto | 1–2 semanas |
| 5 | **Portabilidad**: instalador, `stop-ui.ps1`, rutas relativas, versionar/ignorar `bin` (1,2 GB) y `models` (29 GB) con instrucciones | Sí para otro PC | 1–2 semanas |
| 6 | **Agente**: 96 pasos/turno, sin RAG/repo-map ni plan persistente; no puede borrar/mover/renombrar (bloqueado por `commandAllowed`) ni buscar en el código (`buscar` es DuckDuckGo) | Alto impacto | 3–5 días los dos últimos |
| 7 | **Contexto útil 16K** y sin índice semántico del proyecto | Limitante en proyectos grandes | 1 semana+ |

---

## 7. Riesgos que deberías conocer

1. **Permiso del agente en `"all"`** (`chat/ui-permit.json`): ejecuta comandos **sin preguntar**. Para trabajar en proyectos reales, ponlo en modo "ask".
2. **Sin autenticación**: si abres el IDE a la LAN, cualquiera de la red puede usarlo. El guardia solo valida `Host`/`Origin` (anti-CSRF/DNS-rebinding), no es login.
3. **Casi toda la VRAM**: 618 MiB libres. Con juego/vídeo/navegador acelerado abierto, el IDE no arranca (falla claro, pero falla). Cierra apps que usen GPU.
4. **Rendimiento puede hundirse**: ya se observó la GPU limitada a 10 W (en vez de 80 W) → 1,7 tok/s. Revisa modo de rendimiento y alimentación.
5. **Informes con cifras incorrectas**: los documentos del 27-oct citan 63,1 s (real 74,1 s) y "21/21" no verificable. No tomes sus cifras como auditoría independiente.
6. **Git**: el estado actual (que funciona) **no está commiteado**. Un `git checkout .` o un `git clean` te lo borraría. Haz un commit ya.
7. **`bin/` y `models/` no están en el repo** (1,2 GB + 29 GB): sin instrucciones, otro PC no arranca. Y hay ~12,5 GB de modelos antiguos del 27B que ya no usa el lanzador.

---

## 8. Veredicto y recomendaciones

### Veredicto

- **Tu GPU: sí sirve.** 8 GB es suficiente para este proyecto y su modelo actual, con 41 tok/s y 32K de contexto (16K efectivos de chat). No es el cuello de botella. El cuello es el **tamaño máximo de modelo** (no cabe un 13–14B) y la **calidad de un 9B** en tareas largas.
- **El proyecto: prototipo avanzado con ingeniería seria, en beta temprana.** Puede codear apps pequeñas y medianas contigo supervisando, y de hecho resuelve tareas reales solo (3/3 esta noche, 19/19 en una corrida). Todavía **no** es tu IDE principal.
- **"¿Demasiado inmaduro?"** No para usarlo hoy con expectativas correctas; sí para delegarle una app entera sin revisar (tu `finadmin` es la prueba).

### Cómo sacarle partido ya (sin esperar a que madure)

1. **Commit del estado actual** (y luego commits pequeños). Es lo primero, y cuesta 2 minutos.
2. **Úsalo como agente local de tareas acotadas**: "escribe esta función y sus tests", "arregla este test en rojo", "conviérteme este CSV", "hazme esta página de un archivo y compruébala". Con contexto pequeño y verificación, acierta ~95 %.
3. **Para el día a día de edición, conecta Cursor o Aider a su API local** (`start-cursor-bridge.ps1` / `start-aider.ps1`): te quedas con el autocompletado/LSP de Cursor y usas el 9B local para lo demás, sin nube.
4. **Verifica siempre lo que genera**: ejecuta, prueba, lee el diff. El modelo no distingue "parece que funciona" de "funciona".
5. **No lo abras a la LAN** y baja el permiso del agente a "ask" si vas a trabajar en proyectos con datos.
6. **Mantén el contexto por debajo de ~16K** y usa reglas de proyecto (`BONSAI.md`/`AGENTS.md`) para no depender del historial.
7. Si en algún momento el rendimiento cae a ~1,7 tok/s, **mira el modo de energía de la GPU** antes que el software.

### Si quieres que sea tu IDE de verdad

Orden mínimo (estimaciones de los análisis): **commit + CI + suites herméticas (3–5 días)** → **terminal con PTY y comandos largos + borrar/mover/renombrar + búsqueda de código en el agente (1–2 semanas)** → **autocompletado/FIM y LSP (2–3 semanas)** → **instalador y portabilidad (1–2 semanas)**. En total, **~2–3 meses** para algo distribuible.

---

## 9. Anexos (evidencia detallada)

- [01 · Madurez de código](reports/viabilidad-2026-10-27/01-madurez-codigo.md) — suites ejecutadas, monolitos, repo, bugs verificados.
- [02 · GPU real](reports/viabilidad-2026-10-27/02-gpu-rendimiento.md) — VRAM, tok/s, prefill, TTFT, arranque, agente 3/3, límites y comandos.
- [03 · Calidad del modelo](reports/viabilidad-2026-10-27/03-calidad-codigo.md) — 72/76 en 19 tareas, K2, modos de fallo, contexto.
- [04 · Brechas de producto](reports/viabilidad-2026-10-27/04-brechas.md) — mapa de capacidades, tabla de brechas, portabilidad, costes.
- [Evaluación del agente de esta noche](reports/viabilidad-2026-10-27/eval-agente/informe.md) — 3/3 tareas, artefactos y tiempos.
- [Informe histórico 19/19 de Ornith](salida/eval-ornith-2026-10-26-sin-pensar/informe.md) — la corrida sin razonamiento.
- [Calidad del KV q8_0 vs f16](docs/CALIDAD-KV-2026-10-27.md) — +0,41 % de perplejidad, misma recuperación.
- [Investigación de modelos para 8 GB](reports/Coding%20models%20for%20eight%20GB.md) — por qué Ornith y no K2.

## 10. Actualización (28-oct-2026): brechas cerradas

Tras este informe se implementaron y probaron las cuatro brechas señaladas en §6:

| Brecha del informe | Estado |
|---|---|
| El agente no podía borrar/mover/renombrar | **Resuelto**: herramientas `borrar` y `mover`, con punto de deshacer |
| 96 pasos/turno, sin plan persistente ni «continuar hasta terminar» | **Resuelto**: tope configurable (192 por defecto), `plan` persistente y continuación automática (hasta 3 turnos internos) |
| Sin terminal, comandos de 60 s, sin stdin, procesos que morían al acabar el turno | **Resuelto**: panel Terminal con shell persistente y stdin, sin tope; procesos en segundo plano que sobreviven al turno y se listan/detienen |
| Sin LSP/diagnósticos/esquema/ir a definición | **Resuelto con motor propio**: panel Problemas (JS/Python/JSON/HTML/CSS/MD), Esquema de símbolos e ir a definición (F12) |

Verificación: `npm test` **28/28 OK** (84,5 s), `npm run test:navegador` **3/3 OK**,
`node chat/prueba-terminal.mjs` **10/10**, `node chat/prueba-diagnosticos.mjs` **105 checks**,
y el evaluador real `node-esm` (que antes fallaba) pasa **1/1 en 107 s con el modelo en GPU**.
Detalle, límites y archivos: [docs/CAMBIOS-2026-10-28.md](docs/CAMBIOS-2026-10-28.md).

**Método y limpieza:** durante el análisis se arrancó y paró el modelo real, se ejecutaron las suites (con un primer fallo por huérfanos del propio proyecto, documentado) y se restauró el estado de la UI desde copia. Al cierre: `nvidia-smi` → 0 MiB, sin `llama-server`, puertos 8080/8787/8791 libres. No se modificó código del proyecto ni se hizo commit.
