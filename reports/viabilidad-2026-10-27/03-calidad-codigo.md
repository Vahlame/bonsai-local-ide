# 03 · Calidad real del modelo local para programar

**Pregunta del usuario:** ¿puedo programar apps de verdad en local, o el modelo es demasiado inmaduro?
**Alcance:** calidad y límites de **Ornith-1.5-9B Q4_K_M** (modelo activo, `chat/modelo-activo.json`) y de la alternativa **K2-Horizon-7B Q4_K_M**, a partir de los artefactos de `reports/k2-evaluation-2026-10-27/`, del evaluador de 19 tareas (`chat/evaluar/`) y de las mediciones de KV/contexto del proyecto.
**Método:** auditoría de artefactos existentes. **No se arrancó el modelo ni se usó la GPU** (la ocupaba otro compañero); todo lo de este informe es dato ya registrado en disco o inferencia explícita sobre él.

Convención usada en todo el documento:

- **MEDIDO** = número leído de un JSON/CSV/log del proyecto (se cita el archivo).
- **INFERIDO** = razonamiento mío a partir de esos datos, sin medición directa.
- **AMBIGUO** = el artefacto no permite decidir con certeza.

---

## 0. Veredicto corto

1. **Ornith Q4 local sí sirve para programar tareas pequeñas y verificables.** En las 4 corridas completas de 19 tareas del evaluador acumula **72/76 aciertos (94,7 %)**; mediana **9–13 s por tarea**, media 18 s; **41,8 tok/s** de generación (`reports/k2-evaluation-2026-10-27/ornith-new-exploratory-16k-q8/informe.json` y `…/estado/timings.jsonl`).
2. **No es "demasiado inmaduro" para programar; sí es insuficiente como único ingeniero autónomo de una app real.** La evidencia cubre archivos sueltos de decenas de líneas y refactores de 2–4 archivos pequeños. **No cubre** apps multi-módulo, archivos de 900 funciones, contexto útil >12–16K ni tareas largas sin supervisión.
3. **K2 no demuestra ser mejor en este arnés:** 16/19, y ese 16 incluye **al menos un falso negativo confirmado del validador** (html-contador, `html-counter-diagnostic.json`). Además se le probó con 2.048 tokens de presupuesto de razonamiento cuando su fabricante recomienda **≥32.768 tokens de salida** (`REPORT.md:16`): la comparación es desfavorable por configuración, no concluyente.
4. **Los fallos reales del modelo son de borde, no catastróficos:** regex con grupos de captura, `commit()` de SQLite, colocación de archivos en subcarpetas, bucles de reescritura y llamadas de herramienta mal formadas. No se vio corrupción de archivos del usuario en 76 ejecuciones de tarea.
5. **El 19/19 histórico del proyecto NO es de Ornith.** Las corridas de `chat/evaluar/resultados/` (4–9 oct) son del modelo anterior **Ternary-Bonsai-27B Override-6** a ~28 tok/s (`INTEGRACION-MODELO.md:80-91`). El único 19/19 de Ornith es una pasada aislada sin razonamiento con 32K/F16 (`salida/eval-ornith-2026-10-26-sin-pensar/informe.md:3`).

---

## 1. Qué se midió y con qué instrumento

### 1.1 El evaluador de 19 tareas

`chat/evaluar/ejecutar.mjs` lanza una copia aislada de la app, le manda cada tarea por `/api/chat` como lo haría un usuario y **valida el resultado con código propio**: ejecuta los archivos, compara salidas, hashea los tests que no se deben tocar y revisa qué herramientas usó el agente (`chat/evaluar/tareas.mjs:1-6`). Detalles relevantes del bucle:

- Ventana de contexto del servidor de modelo y tope de prompt: `--prompt-cap 8192` (`chat/evaluar/ejecutar.mjs:226`).
- Presupuesto de razonamiento opcional: `--pensar N` escribe `{pensar:N}` en `ui-settings.json` (`ejecutar.mjs:219-223`). Las corridas nuevas usaron **2048**.
- Tiempo máximo por tarea: 8 min por defecto; las corridas de esta carpeta usaron **3 min** (`REPORT.md:56`).
- Las etiquetas de fallo (`accion-denegada`, `muchos-saltos`, `comandos-repetidos`, `tiempo-agotado`, `resultado-incorrecto`…) se derivan de **eventos de la interacción**, no del veredicto (`ejecutar.mjs:161-184`). Pueden engañar: un fallo por regex puede quedar etiquetado como "acción denegada".

### 1.2 Condiciones de cada corrida (todas MEDIDAS en los `start.json`/`informe.json`)

| ID | Modelo | Runtime | Contexto/KV | Razonamiento | Aciertos | Tiempo (suma de tareas / pared) | Tokens gen. | Fuente |
|---|---|---|---|---:|---:|---:|---:|---|
| O1 | Ornith 9B Q4_K_M | `bin` (build 10743) | 32K / F16 | 2048 | **17/19** | 342,8 s / 6 min 44 s | 13.095 | `salida/eval-ornith-2026-10-26/informe.md:3` |
| O2 | Ornith 9B Q4_K_M | `bin` (build 10743) | 32K / F16 | apagado | **19/19** | 337,4 s / 6 min 38 s | 12.345 | `salida/eval-ornith-2026-10-26-sin-pensar/informe.md:3` |
| O3 | Ornith 9B Q4_K_M | b11946 (8ca4060b7) | 16K / Q8_0 | 2048 | **18/19** | 342,2 s / 6 min 43 s | 13.449 | `…/ornith-new-exploratory-16k-q8/informe.md:3` |
| O4 | Ornith 9B Q4_K_M | `bin` (build 10743) | 16K / F16 | apagado | **18/19** (9/10 + 9/9, corrida partida) | 438,9 s | 15.096 | `…/ornith-exploratory-16k-f16` + `…/ornith-exploratory-remaining` |
| O5 | Ornith 9B Q4_K_M (semillas) | b11946 | 16K / Q8_0 | 2048 | (13/14 parciales, **excluida**) | 261,6 s | 10.290 | `REPORT.md:38`; `…/controlled-ornith-seed-1101/` |
| **K1** | **K2-Horizon-7B Q4_K_M (bartowski)** | b11946 | 16K / Q8_0 | 2048 ("high effort") | **16/19** | 428,3 s / 7 min 10 s | 14.913 | `…/k2-exploratory-16k-q8/informe.md:3`; `scratch-chat/bonsai-chat.mjs:501` |
| Histórico | **Ternary-Bonsai-27B Override-6** (modelo anterior) | `bin` | variable | variable | 15–19/19 (mediana 18) | 5–10 min | 7–13K | `chat/evaluar/resultados/2026-10-0*.md`; ~28 tok/s |

Notas de configuración: Ornith usó su `muestreo.codigo` oficial (temp 0.6, top-p 0.95, top-k 20) y `reasoning_effort: "medium"` (`chat/modelo.json`); K2 usó `reasoning_effort: "high"` y formato de tool call XML en la copia experimental (`scratch-chat/bonsai-chat.mjs:501`). El runtime viejo no soporta K2 (`k2-old-runtime.log:8`, "unknown model architecture: 'k2-horizon'").

### 1.3 Límites de la evidencia (importante para no sobreinterpretar)

- **n = 1 por condición, sin semillas** en las corridas comparativas: el propio informe lo declara (`REPORT.md:30`, `REPORT.md:38`). El muestreo es temp 0.6 (`chat/modelo.json`), así que hay varianza real: `lru-cache` tardó 56,5 s y 180 s (timeout) en dos corridas de Ornith, y 31,5 s en K2.
- **El evaluador mide el conjunto app + agente + modelo**, no el modelo aislado. Varias "mejoras" históricas de nota fueron arreglos del arnés, no del modelo (`AUDITORIA-HANDOFF.md:216-220`, `:520-535`).
- **Validadores débiles o estrictos de forma discutible:** regex de texto (`html-contador`), igualdad exacta de stdout (`paquete`), salidas con formato (`csv-stats`). Hay **al menos un falso negativo confirmado** (sección 4.3).
- **La copia scratch del evaluador no tenía `node_modules`:** la herramienta de navegador devolvía "Falta la herramienta de navegador. Ejecuta npm ci --prefix chat" (`reports/k2-evaluation-2026-10-27/k2-exploratory-16k-q8/tarea-html-contador.json`, acciones). Es un artefacto del copiado (`chat/evaluar/ejecutar.mjs:207`), no una carencia del modelo; en producción `chat/node_modules/playwright-core` sí existe.
- **Guardas de comando del IDE:** `node -e` multilínea, `del …`, `move …` y similares se denegaron ("Comando no permitido en este equipo"). Algunas tareas pierden así su vía natural de verificación.
- **Las 19 tareas son pequeñas:** en total generan ~13–15K tokens; la mayoría son archivos de decenas de líneas. El techo medible del evaluador es ~19/19 y varios modelos locales puntúan 15–19/19: **no discrimina bien la calidad** ni certifica "apps de verdad".
- **Las tareas held-out no se ejecutaron contra ningún modelo** (`REPORT.md:39`); ver sección 5.

---

## 2. Resultados medidos por modelo/condición

### 2.1 Aciertos y tiempos

| Métrica | Ornith (4 corridas completas) | K2-Horizon (K1) |
|---|---|---|
| Aciertos | 17/19 · 19/19 · 18/19 · 18/19 = **72/76 (94,7 %)** | **16/19 (84,2 %)** oficial; **17–18/19** si se corrigen falsos negativos (sección 4) |
| Tiempo mediano por tarea | **9,1–12,6 s** (O1–O3; O4 sube por el timeout de `lru-cache`) | 16,1 s |
| Tiempo medio por tarea | 17,8–18,0 s (O1–O3; O4: 23,1 s) | 22,5 s |
| Suma de las 19 tareas | 337–343 s (O4: 439 s por el timeout de `lru-cache`) | 428 s |
| Tokens generados | 12.345–15.096 | 14.913 |
| Fallos en 4 corridas | `regex-fechas` ×2, `lru-cache` ×1, `node-esm` ×1 | `sqlite`, `html-contador`, `paquete` (1 real, 1 falso negativo, 1 mixto) |

### 2.2 Velocidad y memoria (MEDIDO)

| Medida | Ornith 9B Q4 | K2-7B Q4 | Fuente |
|---|---:|---:|---|
| Generación, media ponderada de toda la suite | **41,8 tok/s** (rango 36–42) | **36,8 tok/s** (rango 30–38) | `…/ornith-new-exploratory-16k-q8/estado/timings.jsonl`; `…/k2-exploratory-16k-q8/estado/timings.jsonl` |
| Generación en contexto largo (11,5–16,3K de prompt) | 34,4 tok/s (6 tokens, poco representativo) | 30,0–32,8 tok/s | `k2-*-context.json` |
| Prefill / lectura de prompt | ~1.430–1.639 tok/s (22.877 tokens en 13,96 s) | 1.441–1.993 tok/s | `logs/ornith-validacion-32k.json`; `k2-*-context.json` |
| VRAM dedicada tras cargar 16K/Q8_0 | **5.871 MiB** post-load (de los cuales pesos 5.357,88 + KV 272; el resto son búferes de cómputo) | **6.975 MiB** | `REPORT.md:22-25`; `ornith-new-16k-q8.err.log:163,185` |
| VRAM pico con 32K/F16 (sin visión) | 6.859 MiB | — | `logs/ornith-validacion-32k.json` |
| Modelo anterior (27B Override-6) | 27–28 tok/s | — | `chat/evaluar/resultados/*.md` |

**INFERIDO:** Ornith es ~10–13 % más rápido generando y deja ~1,1 GiB más de VRAM libre en la misma configuración; K2 procesa prompts algo más rápido. En conjunto, la suite K2 tardó ~25 % más (7 min 10 s frente a 5 min 42 s de tareas).

### 2.3 Contexto máximo que cabe de verdad (MEDIDO, con matices)

| Modelo / configuración | Contexto que **arranca** | Prueba más larga respondida | Veredicto |
|---|---|---|---|
| **Ornith, KV F16, sin visión** | **32.768** (CUDA0 KV 1.024 MiB + estado recurrente 50,25 MiB) | Prompt de **22.877 tokens** prellenado correctamente (~1.639 tok/s) | Cabe 32K; recuperación de datos probada solo hasta 12K (NIAH) |
| **Ornith, KV Q8_0, con visión** | **32.768** (presupuesto conservador 7.821 MiB) | NIAH 4K y 12K: 3/3 y 3/3 | Es la configuración que elige el arranque automático |
| Ornith, KV Q8_0, 16K (corridas nuevas) | 16.384 | — | Lo usado para comparar con K2 |
| **K2 IFM Q4_K_M, KV Q8_0** | **16.384** | 11.511 tokens de prompt, respuesta correcta | 32K/Q8 y 16K/F16 **no arrancan** por KV (2.448 y 2.304 MiB) |
| K2 IFM, KV F16 | 8.192 | 5.911 tokens, correcta | 16K/F16 falla; con 4K/F16 un prompt de 2.961 tokens agotó la salida de 512 en razonamiento y devolvió contenido vacío |
| **K2 bartowski Q4_K_M, KV Q8_0** | **23.552** | 16.286 tokens, correcta; pico 7.487 MiB | 24K falla "failed to allocate compute pp buffers" |

Fuentes: `REPORT.md:22-32`, `logs/ornith-validacion-32k.json`, `docs/CALIDAD-KV-2026-10-27.md:53-56`, `:71`, `k2-*-context.json`, `k2-bartowski-24k-q8.err.log`, `k2-ifm-32k-q8*.err.log`. El modelo Ornith declara `n_ctx_train = 262144` (`ornith-new-16k-q8.err.log:76`), pero en esta GPU el techo real es 32K.

**AMBIGUO / no medido:** la calidad de recuperación en contexto largo **de Ornith solo se midió hasta 12K** (NIAH 4k/12k) y para K2 son sondas de un único dato (extraer un multiplicador), no tareas de código largas. Además, aun con 32K cargados, **el historial efectivo que el agente usa es ~16K** (`AUDITORIA-HANDOFF.md:648`) y a 16K de ventana el tope real visto en los eventos es 13.184–14.208 tokens (`tarea-paquete.json`, eventos `usage`). No hay ninguna prueba de edición en un archivo grande.

---

## 3. Las 19 tareas: pasa / no pasa y modo de fallo

Orden de columnas Ornith: **O1 (32K/F16, pensar) · O2 (32K/F16, sin pensar) · O3 (16K/Q8, pensar) · O4 (16K/F16, sin pensar)**. K1 = K2 16K/Q8. Los validadores están en `chat/evaluar/tareas.mjs` (se cita la línea de cada tarea).

| Tarea (validador) | Qué exige | Ornith O1·O2·O3·O4 | K2 K1 | Modo de fallo observado y clasificación |
|---|---|---|---|---|
| `hola-py` (`:88-98`) | script + ejecutar | ✅✅✅✅ | ✅ | — |
| `fizzbuzz` (`:99-111`) | función + unittest | ✅✅✅✅ | ✅ | — |
| `bug-ultimos` (`:112-129`) | arreglar bug sin tocar tests (hash) | ✅✅✅✅ | ✅ | O3 terminó con motivo "stalled" pero la tarea ya estaba bien: parada por atasco no equivale a fallo |
| `renombrar` (`:130-149`) | renombrar en 4 archivos | ✅✅✅✅ | ✅ | — |
| `html-contador` (`:150-168`) | HTML+JS un archivo (regex estructural) | ✅✅✅✅ | ❌ | **Falso negativo del validador** en K2: el HTML funciona (`html-counter-diagnostic.json`: 0→1→2) y la regex no reconoce `parseInt(...)+1`; además navegador no disponible en la copia scratch. Clasificación: **arnés/entorno** |
| `json-resumen` (`:169-193`) | leer datos, calcular, escribir JSON | ✅✅✅✅ | ✅ | — |
| `explicar-codigo` (`:194-208`) | explicar sin escribir archivos | ✅✅✅✅ | ✅ | — |
| `docstrings` (`:209-222`) | editar archivo sin romper comportamiento | ✅✅✅✅ | ✅ | — |
| `csv-stats` (`:223-239`) | procesar CSV y mostrar 6 datos | ✅✅✅✅ | ✅ | — |
| `lru-cache` (`:240-252`) | estructura exacta + tests propios | ✅✅✅❌ | ✅ | **Modelo/arnés** en O4: 32 saltos, 180 s (timeout), reescrituras repetidas; el comportamiento del LRU era correcto, fallaban sus propios tests. Varianza: la misma tarea pasó en 31,5–68 s en O3/K2 |
| `node-esm` (`:253-266`) | módulo ESM + `node:test` | ❌✅✅✅ | ✅ | **Modelo + entorno** en O1: nombre/ubicación de archivo equivocados y `move` denegado. En O5 (semillas, excluida) creó `ES/modulo.mjs` en una subcarpeta y el validador no lo encontró en la raíz |
| `sqlite` (`:267-282`) | crear DB, insertar 4 filas, consultar | ✅✅✅✅ | ❌ | **Modelo (K2):** el script inserta y consulta pero **no hace `con.commit()`**; al cerrar, SQLite revierte los `INSERT` y la base queda con la tabla vacía (sección 4.2) |
| `error-recuperable` (`:283-295`) | ejecutar, ver error, corregir | ✅✅✅✅ | ✅ | — |
| `paquete` (`:296-308`) | paquete + main; valida stdout exacto `ok` | ✅✅✅✅ | ❌ | **Mixto:** el paquete funciona (ops correctas, `ValueError` incluido) pero K2 duplicó el código de `main.py` dentro de `__init__.py`, cuyos `print` contaminan el stdout que el validador compara; además 2 llamadas `archivo` llegaron **sin el parámetro `contenido`** y un comando salió corrupto (`del /s好东西> nul 2>&1`). Clasificación: **modelo (diseño + tool call) y validador estricto** |
| `regex-fechas` (`:309-320`) | regex con casos límite | ❌✅❌✅ | ✅ | **Modelo:** O3 devolvió **tuplas** `('05','03','1990')` en vez de strings (usó grupos de captura con `findall`); O1 aceptó una fecha inválida `23/45/6789`. Dos bugs distintos de regex en dos corridas → debilidad real en casos límite |
| `solo-chat` (`:321-332`) | explicar sin usar herramientas | ✅✅✅✅ | ✅ | — |
| `buscar-simbolo` (`:333-354`) | localizar definición y parámetros | ✅✅✅✅ | ✅ | — |
| `editar-config` (`:355-369`) | cambiar un valor de JSON | ✅✅✅✅ | ✅ | — |
| `tres-pasos` (`:370-381`) | instrucciones en 3 pasos | ✅✅✅✅ | ✅ | — |

Totales: **Ornith 72/76 (94,7 %)**, **K2 16/19 (84,2 %)**. O5 (parcial, 14 tareas) suma 13/14 y refuerza el fallo de ubicación de `node-esm`; no se incluye en los totales porque la corrida se interrumpió (`REPORT.md:38`).

**Reparto de causas (INFERIDO sobre lo anterior):**

- Fallos **atribuibles al modelo** en Ornith: 4 de 76 (regex ×2, lru ×1, node-esm ×1) ≈ 5 % de tareas.
- Fallos **atribuibles al modelo** en K2: 1 seguro (sqlite) + 1 mixto (paquete) de 19; html-contador no es fallo del modelo.
- Fallos **del validador/entorno** confirmados o probables: html-contador (K2, confirmado), parte de paquete (K2), parte de node-esm (O1/O5: comando `move` denegado), navegador ausente en scratch.
- La conclusión de ranking no se sostiene: la diferencia Ornith–K2 (2 tareas) es del orden de la varianza y de los falsos negativos del instrumento.

---

## 4. Los fallos, uno por uno (evidencia cruda)

### 4.1 `regex-fechas` — el fallo más consistente de Ornith (modelo)

- O3: `patron.findall(texto)` con grupos → devuelve tuplas. Archivo real `…/ornith-new-exploratory-16k-q8/ws/regex-fechas/fechas.py`; el propio modelo **imprimió las tuplas en su auto-prueba y las dio por buenas** (`tarea-regex-fechas.json`, texto final: "las devuelve como una lista de tuplas"). El validador exige strings (`chat/evaluar/tareas.mjs:316`).
- O1: otra variante, aceptó `23/45/6789` porque no puso límites de palabra (`salida/eval-ornith-2026-10-26/informe.md:33-37`).
- Clasificación: **fallo del modelo** (semántica de regex y auto-verificación insuficiente), el más repetido: 2 de 4 corridas de Ornith. K2 pasó esta tarea (69,4 s, 2.556 tokens).

### 4.2 `sqlite` — K2 no hace commit (modelo)

Script generado por K2 (`reports/k2-evaluation-2026-10-27/k2-exploratory-16k-q8/ws/sqlite/inventario.py`): crea la tabla, `executemany` de 4 filas, `SELECT`, imprime el resultado esperado, `con.close()`. **No hay `con.commit()`.** El listado de acciones muestra `python inventario.py → done(0)` y la salida esperada; la comprobación posterior abre la DB, la consulta no da error y devuelve `[]` (`tarea-sqlite.json`, notas "filas: []"): la tabla existe pero está vacía.

**INFERIDO (mecanismo):** en el modo de transacciones heredado de Python, el DDL se auto-confirma y los `INSERT` quedan en una transacción que se revierte al cerrar sin `commit`. Coincide exactamente con lo observado. Es un fallo **real** del modelo, del tipo "verifica la salida en memoria pero no la persistencia". Ni Ornith ni K2 lo detectan sin una comprobación independiente: el validador lo cazó.

### 4.3 `html-contador` — falso negativo confirmado del validador (no es fallo del modelo)

- HTML de K2 (`…/k2-exploratory-16k-q8/ws/html-contador/contador.html`): `<button id="btn-sumar">Sumar</button>`, `<p id="numero">0</p>` y `numero.textContent = parseInt(numero.textContent, 10) + 1;` dentro del listener. Funciona.
- La comprobación exige una regex de incremento (`chat/evaluar/tareas.mjs:161`) que no contempla `parseInt(...)`.
- `html-counter-diagnostic.json`: DOM sintético, observado `0 → 1 → 2`, `"pass": true`, con la nota "Original suite score unchanged". `REPORT.md:30` lo reconoce: "The scorer marked K2's HTML counter as failing because its regex missed `parseInt(...) + 1`".
- Además, en la corrida K2 el modelo intentó abrir el navegador (herramienta ausente en la copia scratch) y ejecutar `node -e` (comando denegado por la guarda), y aun así cerró con una simulación en Python. **Veredicto: el 16/19 de K2 debería ser 17/19 funcional en esta tarea.**

### 4.4 `paquete` — K2: tool calls mal formadas + diseño (mixto)

Secuencia real (`tarea-paquete.json`): 3 escrituras correctas (`calculadora/ops.py`, `calculadora/__init__.py`, `main.py`) → dos acciones `deny` "archivo calculadora/__init__.py llegó sin `contenido` y no se guardó" → comando `del /s好东西> nul 2>&1; python main.py` (denegado) → `python main.py` correcto.

- `calculadora/__init__.py` **duplica** el código de `main.py` (imports + los tres `print`). Al ejecutar `main.py`, la salida sale duplicada: señal de que el `__init__` imprime al importarse.
- El validador del paquete ejecuta `python -c` y exige `a.out.trim() === "ok"` (`chat/evaluar/tareas.mjs:302-306`); los `print` del `__init__` contaminan ese stdout → "paquete mal:" con `stderr` vacío. Las aserciones funcionales (suma, resta, multiplica, divide, `ValueError`) sí se cumplen.
- Las dos llamadas `archivo` sin `contenido` son **llamadas de herramienta inválidas** (probablemente generación cortada; el propio arnés documenta ese patrón en `AUDITORIA-HANDOFF.md:422` H7). El comando con `del /s好东西` es basura de generación.
- **Veredicto:** fallo mixto; funcionalmente el paquete es correcto, pero el diseño es malo y hubo 2 tool calls inválidas de 29 escrituras (~7 %). No es un fallo catastrófico, pero sí muestra fragilidad de formato.

### 4.5 `lru-cache` — bucle de reescritura (modelo/arnés) en O4

`…/ornith-exploratory-16k-f16/tarea-lru-cache.json`: **32 saltos**, 5.610 tokens, 180 s (timeout), etiquetas `tiempo-agotado/muchos-saltos/comandos-repetidos/accion-denegada`; reescribió `lru.py` y `test_lru.py` varias veces, ejecutó tests en rojo, intentó borrar `__pycache__` (denegado), escribió un `limpiar.py`, y terminó sin arreglar sus propios tests ("comportamiento ok", "sus tests fallan: FAILED (failures=1)"). La misma tarea pasó en O3 (56,5 s, 12 saltos) y O5 (68 s), y en K2 (31,5 s). **Varianza alta en una tarea difícil**; el arnés la cortó por tiempo, no el modelo.

### 4.6 `node-esm` — ubicación/estructura equivocada (modelo + entorno)

- O1: escribió archivos con nombre `ES modulo.mjs` y luego intentó `move` (comando denegado); acabó pasando tras reescribir (`salida/eval-ornith-2026-10-26/informe.md:28-32`).
- O5 (parcial, con semillas): decidió crear una carpeta `ES/` y escribir allí `modulo.mjs` y `modulo.test.mjs`; `node --test` pasó (9/9), pero el validador busca `./modulo.mjs` en la raíz. El modelo resolvió un problema que nadie le pidió y falló el contrato de ruta.
- **Veredicto:** fallo del modelo (comprensión de la ruta exacta pedida), agravado por la guarda de comandos que impidió mover archivos.

### 4.7 Fallos del instrumento que no son del modelo

1. **Navegador ausente en la copia scratch** (todas las corridas K2/O3/O5): `browser:denied` con "Falta la herramienta de navegador" (`chat/navegador.mjs:62`). No es el modelo.
2. **Guardas de comando:** `node -e` multilínea, `del`, `move` y comandos con sintaxis rara → "Comando no permitido en este equipo". Recorta capacidades reales del agente en la evaluación.
3. **Etiquetas de fallo engañosas:** `html-contador` de K2 figura como `accion-denegada` cuando su causa es una regex; `bug-ultimos` de O3 figura "stalled" pero pasa.
4. **Validador de `paquete` por igualdad exacta de stdout:** castiga el código que imprime al importar, aunque funcione.
5. **El histórico 19/19 no es comparable:** las corridas de `chat/evaluar/resultados/` son del modelo 27B anterior (`INTEGRACION-MODELO.md:80-91`) y a ~28 tok/s; no son evidencia de Ornith.

---

## 5. Las tareas held-out y el misterioso "baseline" (aclaración)

**Qué son.** Cuatro tareas más difíciles que las 19, definidas en `reports/k2-evaluation-2026-10-27/scratch-chat/evaluar-heldout/tareas.mjs:7-10` y ancladas por hash (`heldout-hash.json`, SHA-256 `2DE4B9F0…3DABEC`):

| id | Qué exige | Baseline (fixture sin agente) | Por qué falla | ¿Ejecutada contra el modelo? |
|---|---|---|---|---|
| `multifile-python` | corregir `total_cents` (price×qty, centavos) y formato `Total: $D.CC` en 2 archivos, con asserts ocultos | `ok:false` — `AssertionError` en `total_cents(...)==370` | El fixture está puesto con el bug a propósito (suma `price+qty`) | **NO** |
| `refactor-node` | extraer `summarizeValues` sin cambiar `summary`; añadir test `node:test` | `ok:false` — "hidden behavior tests pass"; "test file false" | El comportamiento base ya es correcto (por definición de refactor); solo falta el archivo de test | **NO** |
| `tool-recovery-node` | fallar `node ./missing-script.mjs`, crearlo y volver a ejecutar con éxito | `ok:false` — `failed command index -1, later success -1, output ""` | Sin acciones del agente no hay transcripción de fallo/recuperación ni archivo | **NO** |
| `long-edit-node` | en un archivo de 900 funciones, cambiar solo `target_amber`; crear y ejecutar prueba | `ok:false` — aserción `-3 vs 3`; "all 900 functions preserved: true" | El fixture tiene la resta buggeada (`x*7-3`); nadie la editó | **NO** |

**Qué es exactamente el "baseline".** No es un modelo ni una condición de modelo: es **el fixture recién preparado, sin ninguna intervención del agente**. `heldout-selfcheck.mjs:2` hace `t.setup(d)` y luego `t.check(d, {acciones:[], texto:''})` — **no hay ninguna petición HTTP ni carga de modelo**. El script solo marca error si algún baseline pasa el validador (`rows.some(x => x.error || x.baseline.ok)`), es decir, es un **control negativo**: comprobar que los validadores rechazan un workspace sin trabajo.

**Por qué "fallan" las 4.** Porque es lo correcto: el autochequeo salió **bien** (4/4 validadores rechazan el fixture). **No son fallos del modelo y no deben citarse como "el modelo suspende las tareas held-out".** El propio `REPORT.md:39` lo dice: las definiciones "were **not run against either model**", y el grep de todo el proyecto no encuentra esos ids en ningún otro artefacto.

**Matiz honesto:** para `refactor-node`, el baseline ya pasa la parte de comportamiento (es lo esperado en un refactor) y solo falla por la ausencia de archivo de test. Es decir, ese control negativo solo demuestra la mitad de la comprobación; el evaluador no está validado para distinguir "refactor correcto sin tests" de "nada hecho". Los otros tres sí son controles negativos plenos. **Consecuencia:** no existe hoy evidencia de que Ornith ni K2 puedan con las held-out (edición en archivo de 900 funciones, refactor multiarchivo, recuperación de herramienta). Es la mayor laguna de este informe.

---

## 6. Modos de fallo típicos de un 9B Q4 en este arnés

### 6.1 Tool calls inválidas o incompletas

- **MEDIDO:** K2, 2 llamadas `archivo` con el parámetro `contenido` ausente (rechazadas por la app, `tarea-paquete.json`), y un comando corrupto `del /s好东西> nul` (denegado). ~2 de 29 escrituras y 1 de 20 comandos en la corrida.
- **MEDIDO:** el arnés conoce el patrón de truncado: `archivo` emite `contenido` antes de `ruta` y si la generación se corta se pierde la ruta (`AUDITORIA-HANDOFF.md:422` H7). Aunque está mitigado, explica llamadas incompletas en tareas largas.
- **MEDIDO (contraste):** ambos K2 respondieron bien a una llamada nativa simple con argumentos `{a:19,b:23}` y al turno posterior (`k2-*-api.json`, `toolCheck`). Un tool call nativo correcto en un caso trivial no garantiza robustez en generaciones largas.
- **MEDIDO:** el IDE declara el dialecto `xml-funcion` para el modelo (`catalogo.ornith9b.toolcalls`, `chat/modelo.json`): si el servidor no entrega `tool_calls` nativas, el IDE **parsea el XML del texto** del modelo (`chat/adaptadores.mjs:1-14`; `chat/ui-server.mjs:2554-2562`). **AMBIGUO:** no está etiquetado en los artefactos qué porcentaje de llamadas llegó por cada vía; no puedo cuantificarlo.

### 6.2 El razonamiento consume el presupuesto de salida

- **MEDIDO:** K2 con 4K de contexto y presupuesto de salida 512: prompt de 2.961 tokens → `finish_reason: "length"`, 512 tokens de salida (1.700 caracteres de razonamiento) y **contenido final vacío** (`k2-ifm-4k-f16-context.json`). Es el modo de fallo clásico de un modelo de razonamiento apretado de presupuesto.
- **MEDIDO:** K2 pide por ficha **≥32.768 tokens de salida** para su modo alto; en esta GPU se le dieron **2.048** (`REPORT.md:16`; `--pensar 2048`). La comparación está lejos de su configuración recomendada.
- **MEDIDO:** la corrida con razonamiento de Ornith no mejora la nota y a veces empeora: 17/19 y 18/19 con pensar (O1, O3) frente a 19/19 y 18/19 sin pensar (O2, O4); n=1 por celda. También hay un cierre "stalled" en `bug-ultimos` O3 (pasó igualmente).
- **INFERIDO:** en este arnés el razonamiento no compensa en tareas cortas; su coste principal es tiempo/tokens (la corrida con pensar de Ornith generó 13.095 tokens vs 12.345 sin pensar). Para tareas difíciles no hay datos con Ornith (la única prueba "difícil" con pensar es del modelo 27B anterior, `AUDITORIA-HANDOFF.md:604-614`).

### 6.3 Olvido de contexto / ventana efectiva

- **MEDIDO:** no se observó "olvido" en las tareas cortas; las pruebas de contexto largo disponibles dan: Ornith NIAH 4K y 12K **3/3 y 3/3** (`docs/CALIDAD-KV-2026-10-27.md:53-56`); K2 respondió correctamente a 11.511 / 14.236 / 15.586 / 16.286 tokens de prompt (`k2-*-context.json`).
- **MEDIDO:** la ventana efectiva del agente es menor que la del servidor: a 16K de `nCtx`, los eventos muestran `cap` ≈ 13.184–14.208 tokens; con ventana de 32K, el historial efectivo reservado es ~16K (`AUDITORIA-HANDOFF.md:648`).
- **MEDIDO:** `withCurrentFile` recorta el archivo que ve el modelo a 1.200 tokens sin avisar (`AUDITORIA-HANDOFF.md:424` H9); el editor lee hasta 2 MB y la búsqueda salta archivos >800 KB (`INFORME-SOLUCION-2026-10-27.md:49`).
- **NO MEDIDO:** no hay ninguna prueba de tarea real con >16K de contexto útil ni de edición sobre archivo grande (el held-out `long-edit-node` no se ejecutó). **Riesgo abierto, no descartado.**

### 6.4 Ediciones que rompen archivos

- **MEDIDO:** en 76 ejecuciones de tarea de Ornith no hubo corrupción de archivos del usuario. `docstrings` (editar sin romper), `renombrar` (4 archivos) y `editar-config` (JSON exacto) pasaron en las 4 corridas completas; K2 también. Hay protecciones: hash de tests que no se deben tocar, undo del agente, diff y guardado con precondición (`INFORME-SOLUCION-2026-10-27.md:47-67`; `AUDITORIA-HANDOFF.md:226-236`).
- **MEDIDO:** los problemas de edición observados son de **proceso**, no de corrupción: reescrituras repetidas del propio código/tests en `lru-cache` (32 saltos, O4) y código duplicado en `__init__.py` (K2). No se vio a ningún modelo "arreglar" el test para que pasara en las tareas validadas con hash.
- **INFERIDO:** el riesgo de romper archivos crece con el tamaño (no hay herramienta de edición parcial real en ese momento; H9 documenta el clip de 1.200 tokens) y con el bucle de reescritura; en archivos de usuario reales no está medido.

### 6.5 Dependencia de la app/arnés para suplir al modelo

No es un fallo del modelo, pero condiciona la conclusión "puedo programar en local": buena parte de la calidad observada no es solo del modelo.

- **Adaptador de tool calls:** dialecto declarado por modelo y parseado del texto si no hay nativas (`adaptadores.mjs:1-14`, `ui-server.mjs:2554-2562`).
- **Heurísticas de texto desactivadas para modelos del catálogo** (`ui-server.mjs:2568-2575`): se apagan "cercas → archivo", "lee X" y "voy a buscar…" porque con tool calls solo añadían saltos y archivos no pedidos. Es decir, la calidad de las corridas depende de que el IDE haya dejado de heurística y haya puesto un adaptador.
- **`esCharla()` + `tool_choice:"none"`** para preguntas conceptuales (`chat/ui-server.mjs:3120-3134`; `AUDITORIA-HANDOFF.md:546`): evita que el modelo cree archivos en preguntas de charla (el fallo histórico `solo-chat` de las corridas 2 y 6).
- **Aviso de cierre honesto:** si el último comando falló y la respuesta no lo dice, la app añade una advertencia (`AUDITORIA-HANDOFF.md:545`, §26).
- **Guardas de comando:** lista blanca que deniega `node -e` multilínea, `del`, `move`, etc.; varias tareas perdieron su verificación natural por esta vía.
- **Conclusión:** la "calidad" de 94,7 % de Ornith es la del **conjunto modelo + arnés + IDE**. Sin ese andamiaje, la tasa sería menor. Esto también implica que cambiar de modelo exige revisar los adaptadores (K2 necesitó una copia experimental con `reasoning_effort: high` y `tool_call_format: xml`).

---

## 7. Contraste de las afirmaciones del proyecto con los datos crudos

| Afirmación (fuente) | Dato crudo | Veredicto |
|---|---|---|
| "Ornith 18/19 en 6 min 43 s" (`REPORT.md:22-30`) | `informe.md:3` del run O3: 18/19, 342,2 s de suma de tareas y 6 min 43 de pared | **Confirmada**, pero es **una sola corrida**. En 4 corridas completas: 17, 18, 18 y 19 de 19 |
| "K2 16/19 en 7 min 10 s" (`REPORT.md:22-30`) | `informe.md:3` del run K1: 16/19, 428,3 s | Confirmada la nota oficial; **no es comparable en pureza**: incluye un falso negativo confirmado (html) y un mixto (paquete). Funcional: 17–18/19 |
| "Velocidad típica ~41–42 tok/s vs ~35–38" (`REPORT.md:26`) | 41,8 tok/s (Ornith, ponderada) y 36,8 (K2) en `timings.jsonl` | **Confirmada** |
| "El scorer marcó html-contador por la regex" (`REPORT.md:30`) | `html-counter-diagnostic.json`: 0→1→2, `pass: true` | **Confirmada**; el 16/19 oficial subestima a K2 en esa tarea |
| "El SQLite de K2 imprimió lo esperado pero no commitó los inserts" (`REPORT.md:30`) | `k2-exploratory-16k-q8/ws/sqlite/inventario.py` sin `commit`; `filas: []` en el check | **Confirmada** |
| "El fallo de Ornith fue la regex de fechas devolviendo tuplas" (`REPORT.md:30`) | O3 sí (tuplas); O1 fue otra variante (aceptó mes inválido) | **Matizable:** dos fallos de regex distintos en dos corridas |
| "Resultados 19/19 Ornith previos son históricos" (`REPORT.md:30`) | El 19/19 de Ornith en el proyecto es la pasada de `salida/eval-ornith-2026-10-26-sin-pensar/` (32K/F16, sin pensar); el 19/19 de `chat/evaluar/resultados/` es el **27B Override-6**, no Ornith (`INTEGRACION-MODELO.md:80-91`) | **Confirmada, con matiz:** no confundir los dos 19/19; el del evaluador histórico no avala a Ornith |
| "Ornith: 17/19 con pensar y 19/19 sin pensar" (`reports/Coding models for eight GB.md:42`) | `salida/eval-ornith-2026-10-26/informe.md:3` y `…-sin-pensar/informe.md:3` | **Confirmada** (n=1 por celda) |
| "32K de contexto con q8_0 ≈ f16" (`docs/CALIDAD-KV-2026-10-27.md:8-12`) | Perplejidad 7,5880 vs 7,5570 (+0,41 %); NIAH 3/3+3/3 y 2 tareas de código iguales; una pasada temp 0 | **Confirmada en esa batería**; los propios límites del doc (`:98-106`) impiden certificar diferencias <0,5 % |
| "32K de contexto cabe" (mismo doc; `AUDITORIA-HANDOFF.md:635`) | Arranque verificado y prompt de 22.877 tokens prellenado; recuperación NIAH solo hasta 12K | **Capacidad confirmada, calidad >12K no medida** |
| "Tool calling nativo verificado" (`REPORT.md:34`; `logs/ornith-validacion-32k.json`) | Llamada nativa `sumar(19,23)` correcta en los 3 artefactos; en la suite de 19 K2 produjo 2 llamadas mal formadas | **Confirmada solo para el caso trivial**; no generaliza |
| "La comparación es exploratoria y sin semillas" (`REPORT.md:30,38`) | No hay campo de semilla en los informes; O5 (semillas) quedó incompleta | **Confirmada**: no hay ranking defendible con estos datos |
| "El histórico da 19/19 y 18/19" (`AUDITORIA-HANDOFF.md:444-450`) | Esas corridas son del 27B Override-6 (temp 0.5, ~28 tok/s) | **No aplica al modelo activo**: no usar como aval de Ornith |

**Riesgo de sobreventa detectado:** el proyecto tiende a mezclar "nota del evaluador de 19" con "calidad de modelo" y "run histórico" con "modelo actual". La lectura correcta es: **Ornith está en 17–19/19 en tareas cortas, con 1–2 fallos de borde por corrida, y no existe evidencia de tareas grandes.**

---

## 8. ¿Qué puede y qué no puede hacer un 9B Q4 local con este arnés?

### 8.1 Lo que la evidencia respalda (MEDIDO)

| Tipo de tarea | Evidencia | Confianza |
|---|---|---|
| Scripts Python de una pieza + ejecutarlos | `hola-py` 5/5 (Ornith+K2), `error-recuperable` 5/5, `csv-stats` 5/5 | Alta |
| Funciones con tests (unittest / `node:test`) | `fizzbuzz` 5/5, `node-esm` 4/5 (fallo O1), `lru-cache` 4/5 (fallo O4) | Alta para lo pequeño |
| Arreglar un bug con tests en rojo sin tocar los tests | `bug-ultimos` 5/5, con hash de protección | Alta |
| Renombrar/refactorizar en 2–4 archivos pequeños | `renombrar` 5/5, `paquete` 4/5 (fallo de forma en K2), `node-esm` | Alta |
| Leer datos y escribir JSON/CSV; SQLite simple | `json-resumen` 5/5, `csv-stats` 5/5, `sqlite` 4/5 (K2 falla por commit) | Alta |
| HTML/JS interactivo en un archivo | `html-contador` 4/4 Ornith y funcional en K2 (falso negativo) | Alta |
| Explicar código, buscar símbolos, cambiar config | `explicar-codigo`, `buscar-simbolo`, `editar-config`, `solo-chat` 5/5 | Alta |
| Instrucciones de varios pasos | `tres-pasos` 5/5 | Alta |
| Editar archivo existente sin romperlo (docstrings) | `docstrings` 5/5 | Alta |
| Bucle navegador + visión (reproducir error, arreglar, verificar) | `salida/observacion-real-2026-10-26/informe.json`: lee "CASA 3241" de un canvas, reproduce y arregla un contador, verificación independiente 2 clics = 2, 15 comprobaciones | Media (una pasada) |
| Regex con casos límite | `regex-fechas`: **2/4 en Ornith**, 1/1 K2 | **Baja**: es el punto más débil medido |

### 8.2 Lo que NO está demostrado (y por tanto no se puede prometer)

| Tipo de tarea | Por qué no está demostrado |
|---|---|
| App multi-módulo real (API + CLI + persistencia + tests) | El propio proyecto documenta que `proyecto-completo` fallaba en ambos modelos por falta de procesos en segundo plano (`AUDITORIA-HANDOFF.md:425` H10); se añadió `segundo_plano` después (§29), pero **no se ha reevaluado con Ornith**. No hay ninguna tarea de este tipo en los artefactos |
| Edición en archivo grande (cientos/miles de líneas) | `long-edit-node` (900 funciones) **nunca se ejecutó**; en su lugar, el clip de 1.200 tokens de `withCurrentFile` (H9) y el tope de historial efectivo ~16K hacen esperable degradación. **No medido** |
| Contexto realmente largo (>16K útiles) | NIAH de Ornith solo hasta 12K; K2 hasta 16,3K; no hay tarea de código con contexto grande |
| Tareas autónomas largas (refactors, migraciones, debugging profundo) | Límite de 24 saltos (`catalogo.ornith9b.agente.saltos`), evaluador con 3 min/tarea, `lru-cache` ya hace timeout en una tarea mediana; el único "HTML grande" (14 KB) del historial era del modelo 27B y llegó al tope de saltos (`AUDITORIA-HANDOFF.md:552-570`) |
| Frameworks de frontend, builds, dependencias, servidores, concurrencia | Sin una sola prueba en los artefactos |
| Debugging de rendimiento/seguridad o código ambiguo | Sin pruebas; los benchmarks publicados (SWE-Verified 70,6 de Ornith; 72,4 de K2) son de los fabricantes, no de este equipo ni de este Q4 (`reports/Coding models for eight GB.md:9-17`) |
| OCR/visión fina | El propio proyecto documenta un fallo real de OCR (4233 leído como 4225 en fuente 5×7) y avisa de que la visión "no garantiza OCR exacto" (`AUDITORIA-HANDOFF.md:671`) |

**INFERIDO — dónde está el umbral:** con 42 tok/s y una ventana efectiva de ~13–16K, el punto dulce es **una unidad de trabajo por turno**: un archivo, una función, un test, un bug, un renombrado pequeño. Cada pieza que exige recordar más de ~3–4 archivos a la vez o generar >500–800 líneas de una vez cae fuera de lo medido. No es una propiedad demostrada del modelo, sino la frontera de la evidencia disponible.

---

## 9. Productividad esperada frente a un modelo en la nube

**Lo medido (este equipo, este arnés):**

- Generación: **41,8 tok/s** (Ornith) / **36,8** (K2). Por aritmética sobre eso, un archivo de 300 líneas (~2.500 tokens) tarda ~1 min de generación pura; no se midió un archivo de ese tamaño.
- Tarea pequeña típica del evaluador: **mediana 9–13 s**, media 18 s (Ornith); 16 s mediana en K2.
- Suite completa de 19 tareas pequeñas: **5 min 42 s–7 min 10 s** de tareas (más ~1 min de montaje). No hay coste por token; el coste eléctrico no se midió.
- Fiabilidad en esas 19 tareas: **72/76 (94,7 %)** en 4 corridas de Ornith; **1–2 fallos reales de 19** en K2. Con tests/verificación, la mayoría se detecta y se corrige en un reintento; sin verificación, un fallo de borde como el `commit()` de SQLite pasa desapercibido.

**Lo no medido:** **no existe ninguna comparación local-vs-nube en el proyecto.** No hay latencias, ni tasas de acierto, ni coste de un modelo en la nube en ningún artefacto. Cualquier multiplicador ("la nube es 2× mejor") sería inventado.

**INFERIDO (con base explícita):** para tareas **pequeñas y bien especificadas**, un modelo frontera en la nube no suele fallar los casos que aquí fallan (regex con grupos, commit, ruta exacta), así que la diferencia se notará sobre todo en **iteraciones necesarias** y en **tiempo humano de revisión**, no en la velocidad de tecleo. Para tareas **grandes/ambiguas**, la brecha crece porque el local ya parte de menos contexto útil y menos capacidad de planificación; los benchmarks publicados por los fabricantes (70,6/47,5 SWE-Verified/Pro para Ornith; 72,4 Verified para K2) están lejos de "app real" y no son locales (`reports/Coding models for eight GB.md:9-17`). En la práctica: el local **sí ahorra** en coste y privacidad y es usable para el día a día de piezas pequeñas; el híbrido (local para lo pequeño, nube para lo difícil, revisión humana siempre) es lo que la evidencia respalda — no sustituir el criterio humano por la nota del evaluador.

---

## 10. Veredicto final

**¿Puede programar apps de verdad en local?** Hoy, con esta evidencia: **puede construir y verificar apps/prototipos pequeños** (un archivo o unos pocos, scripts, funciones con tests, HTML/JS interactivo, parches de bugs pequeños, SQLite/JSON/CSV) con calidad sorprendentemente buena para un 9B Q4: **~95 % de las tareas cortas**, con mediana de segundos y **41,8 tok/s**. **No puede ser el único motor de una app real** (multi-módulo, archivos grandes, contexto largo, tareas autónomas largas): no es que "no pueda" por una limitación demostrada, es que **no hay ninguna evidencia de que pueda**, y los límites medidos (ventana efectiva, 24 saltos, fallos de borde, 1 timeout en una tarea mediana) apuntan a que no sin supervisión.

**¿Es demasiado inmaduro?** No como asistente de programación; **sí como ingeniero autónomo**. La distinción importa: el usuario que escribe código y verifica cada paso obtiene valor; el que espera "hazme la app" y se ausenta encontrará los fallos de borde.

**Recomendación operativa (INFERIDO):**

1. Usar **Ornith Q4 como predeterminado** (ya lo es). No cambiar a K2 con esta evidencia: es más lento en la suite, más grande en VRAM, con menos contexto útil en 8 GB y sin ventaja medida; si se quiere explorar K2, debe probarse con su presupuesto de salida real (≥32K) y en hardware con más VRAM.
2. Mantener el **razonamiento apagado** como configuración diaria (es la actual: `chat/ui-settings.json` `"pensar": 0`); las corridas con 2.048 no mejoraron y la corrida con pensamiento de Ornith falló más en las celdas disponibles. Encenderlo puntualmente para planificar o tras un fallo, como ya hace el proyecto.
3. Trabajar en **unidades pequeñas y siempre con verificación**: pedir tests, ejecutar, leer la salida. Los fallos reales (`commit`, regex, ruta) son justo los que una comprobación externa caza.
4. Reservar la nube (o al menos una segunda opinión) para **diseño de arquitectura, refactores grandes, debugging profundo y contexto largo**; y no usar las notas de 19/19/18/19 del proyecto como certificado de calidad: en su mayoría son del modelo anterior y en el mejor caso son una sola pasada.
5. Antes de afirmar "apps de verdad en local", ejecutar las **4 held-out** contra Ornith (están definidas y hasheadas) y repetir la suite con semillas y ≥3 pasadas. Hoy esa afirmación **no está medida**.

---

## 11. Trazabilidad (dónde está cada dato)

- Informe principal y condiciones: `reports/k2-evaluation-2026-10-27/REPORT.md` (modelos `:5-10`, runtime `:12-16`, medidas `:18-34`, límites `:36-41`).
- Corrida K2 16/19: `reports/k2-evaluation-2026-10-27/k2-exploratory-16k-q8/` (`informe.json`, `informe.md`, `tarea-*.json`, `estado/timings.jsonl`).
- Corridas Ornith nuevas: `…/ornith-new-exploratory-16k-q8/` (18/19) y `…/ornith-exploratory-16k-f16` + `…/ornith-exploratory-remaining` (18/19 partida).
- Ornith 32K/F16: `salida/eval-ornith-2026-10-26/` y `…-sin-pensar/`; `logs/ornith-validacion-32k.json`.
- Corrida con semillas parcial: `…/controlled-ornith-seed-1101/` (excluida de notas, `REPORT.md:38`).
- Sondas de contexto y tool calling: `k2-*-context.json`, `k2-*-api.json`, `k2-*-start.json`, `k2-*.err.log`, `html-counter-diagnostic.json`, `k2-bartowski-memory-snapshot.json`, `gpu-*.csv`.
- Held-out: `…/scratch-chat/evaluar-heldout/tareas.mjs:7-10`, `…/heldout-selfcheck.mjs:2`, `…/heldout-selfcheck/results.json`, `…/heldout-hash.json`; no ejecutadas contra modelo (`REPORT.md:39`).
- 19 tareas y validadores: `chat/evaluar/tareas.mjs`; bucle y etiquetas: `chat/evaluar/ejecutar.mjs:124-184,219-263`.
- Histórico (modelo anterior 27B): `chat/evaluar/resultados/2026-10-04…2026-10-09…`; `INTEGRACION-MODELO.md:78-91`.
- Calidad KV y contexto: `docs/CALIDAD-KV-2026-10-27.md`; `reports/Coding models for eight GB.md:38-45`; `AUDITORIA-HANDOFF.md:627-648`.
- Configuración real: `chat/modelo.json` (`catalogo.ornith9b`, `razonamiento.esfuerzo="medium"`), `chat/modelo-activo.json` (`ornith9b`), `chat/ui-settings.json` (`pensar:0`, `historial:32768`).
- Límites del IDE que condicionan la calidad: `AUDITORIA-HANDOFF.md:422-431` (H7, H9, H10, H12, H16), `:216-220` (varianza), `:520-535` (§25-27), `:604-614` (§30).
