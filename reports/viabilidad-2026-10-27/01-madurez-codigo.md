# 01 · Madurez de código y fiabilidad — Bonsai Local IDE

**Fecha:** 27 de octubre de 2026, 23:2x (America/Costa_Rica)
**Auditor:** `auditor-ide` (equipo de viabilidad)
**Alcance:** calidad y confiabilidad del **código**, suites de prueba, robustez de ejecución y
reproducibilidad. **No** cubre calidad del modelo ni medidas de GPU/VRAM (otros informes del
equipo). No se modificó código, no se hizo commit y no se dejaron procesos vivos.
**Entorno medido:** Windows 11, Node v26.0.0, Python 3.14.7, GPU NVIDIA RTX 4060 Laptop
8.188 MiB (driver 617.14, detectada; las suites de GPU **no** se ejecutaron aquí), proyecto en
`C:\Users\user\Documents\prject_local_AI`.
**Método:** ejecución real de las suites (`npm test`, `npm run test:navegador`), lectura del
código, `git status/diff/log`, inspección de procesos/huérfanos y de los archivos de estado.

---

## 1. Resumen ejecutivo

**Veredicto en una línea: beta temprana usable en un solo equipo, todavía NO "usable a diario"
como IDE de referencia** (justificación completa en §7).

Lo que está bien y se comprobó:

- En un entorno limpio, **26/26 suites aisladas OK en 74,1 s** y **3/3 suites de navegador OK en
  6,4 s** (números medidos aquí, §2). Son pruebas de verdad, no humo: ~856 aserciones
  (`check(`/`assert`) repartidas en suites que suman 7.249 líneas de prueba.
- Hay ingeniería defensiva real: historial con escritura atómica + `.bak` + cuarentena de
  corruptos (`chat/historial.mjs:16-19`, `chat/almacen-json.mjs:124-145`), guardia anti-CSRF/
  DNS-rebinding (`chat/guardia.mjs:1-31,154-180`), cancelación por `AbortController` con limpieza
  de procesos de fondo en `finally` (`chat/ui-server.mjs:2409-2417,3303-3311`), cierre honesto del
  turno con motivo `completed/step_limit/stalled/cancelled/error` (`chat/ui-server.mjs:3294-3295`).
- Los 10 bugs de `AUDITORIA-BUGS-Y-REFACTORIZACION.md` **sí tienen el arreglo en el código** y, en
  general, prueba automatizada que lo cubre (§4).

Lo que duele (y es lo que impide llamarlo maduro):

1. **El repositorio no es reproducible**: 30 archivos versionados modificados y 37 entradas sin
   seguimiento; el `package.json` de la raíz, `scripts/run-tests.mjs` y 4 módulos nuevos
   (`sse.mjs`, `lecturas.mjs`, `historial.mjs`, `almacen-json.mjs`) **no están commiteados**. Un
   clon limpio de `HEAD` no puede ni ejecutar `npm test` (§6).
2. **La suite no es hermética**: un proceso huérfano de una ejecución anterior en el puerto fijo
   `8798` hizo fallar `npm test` en el estado entregado (25/26). Además, un camino de
   fallo/interrupción de las propias pruebas deja procesos hijos vivos (§2.2).
3. **El monolito sigue ahí**: `chat/ui-server.mjs` son 3.354 líneas y `main()` ocupa las líneas
   **1046-3348 (2.303 líneas, 68,7 % del archivo)**: rutas HTTP + bucle del agente + ciclo de vida
   del modelo + permisos en un solo cierre (§3).
4. **Dependencia dura de plataforma**: Windows + PowerShell + Edge/Chrome + GPU NVIDIA CUDA. Sin
   GPU el producto **no arranca en absoluto** (ni siquiera como editor sin modelo): el servidor de
   UI exige un `llama-server` vivo al arrancar (`chat/ui-server.mjs:1065` →
   `chat/bonsai-chat.mjs:447-458`; `scripts/start-server.ps1:125-126`).

Cifras clave: 34 suites registradas (26 aisladas + 5 GPU + 3 navegador); 27 ejecutadas aquí
(79 %); 26/26 aisladas OK en limpio; 29/29 de las ejecutables en verde; 74,1 s por pasada.

---

## 2. Resultados exactos de las suites

### 2.1 Comandos y resultados (medidos en esta máquina)

| # | Comando | Estado del entorno | Resultado | Tiempo (runner / pared) | Salida |
|---|---|---|---|---|---|
| A | `npm test` | **Estado entregado** (23:20) | **25/26 OK · 1 FALLO**, exit 1 | 73,6 s / 74,1 s | falla `chat/prueba-agente.mjs` (código 1, 13,1 s) |
| B | `npm test` | Entorno limpio (23:24, tras terminar los 3 huérfanos) | **26/26 OK · 0 FALLO**, exit 0 | 74,1 s / 74,4 s | `Todo en verde.` |
| C | `npm run test:navegador` | — | **3/3 OK · 0 FALLO**, exit 0 | 6,4 s / 6,8 s | `Todo en verde.` |
| D | `npm run test:gpu` | **NO ejecutado** (fuera de alcance; requiere cargar el modelo) | — | — | 5 suites pendientes de otro informe |

Comando A y B = `node scripts/run-tests.mjs` (grupo `aisladas`). El runner ejecuta cada suite en
su propio proceso Node, en secuencia, con tope por defecto de 240 s
(`scripts/run-tests.mjs:21,117-153`). Comparación con lo declarado: `INFORME-SOLUCION-2026-10-27.md:22`
dice 63,1 s y `README.md:67` dice ~36 s; lo medido aquí es **74,1 s** en las dos pasadas. La
diferencia es de carga de máquina/fixtures (ver §4), pero las dos cifras documentadas están
desactualizadas respecto a lo que tarda hoy.

### 2.2 El FALLO de la ejecución A: causa raíz (no es una regresión del chat)

Salida literal capturada:

```
▶ 23/26 chat/prueba-agente.mjs
FALLO chat/prueba-agente.mjs (código 1, 13.1 s)
FALLOS:
 - el servidor queda en segundo plano (node -e "require('http').createServer(...).listen(8798,...)" no se quedó corriendo: terminó con código 1.
node:events:487
      throw)
 - al acabar el turno el servidor se cierra
```

Cadena de causalidad comprobada:

1. `chat/prueba-agente.mjs:170-173,519-527` levanta un servidor de prueba en el **puerto fijo
   8798** y comprueba que vive durante el turno y muere al final.
2. Al iniciar la ejecución A, el puerto **ya estaba escuchando**: PID **15940**, proceso
   `node -e "require('http').createServer(...).listen(8798,...)"`, **padre muerto**, creado a las
   **22:32:43** (una ejecución anterior del proyecto, ~48 min antes de mi pasada). El hijo nuevo
   falló con `EADDRINUSE` (`node:events:487 throw`) y el viejo siguió escuchando; de ahí los dos
   `check` en rojo.
3. Había además dos huérfanos del test de procesos: PID 7480 y 22016 (`node -e
   "console.log('escuchando');setInterval(()=>fs.writeFileSync(.../fondo-sigue.txt),300)"`),
   creados a las **22:32:19** y **22:40:07**, que seguían escribiendo en
   `%TEMP%\bonsai-procesos-*\fondo-sigue.txt` a las 23:22. Es decir: **los caminos de fallo o
   interrupción de `prueba-procesos.mjs` dejan procesos hijos vivos**; no así el camino de éxito
   (tras la pasada B no quedó ningún listener ni proceso `bonsai-*`).
4. Tras terminar los 3 huérfanos con `Stop-Process`, `node chat/prueba-agente.mjs` → exit 0
   (`prueba agente ok`) y el `npm test` completo → **26/26 OK**.

**Conclusión:** el fallo es un **defecto de aislamiento de la suite** (puerto fijo + limpieza
incompleta en fallo) disparado por residuo de ejecuciones anteriores del propio proyecto, no un
fallo del agente. Pero invalida la afirmación "26/26" en el estado entregado: la suite **no es
repetible** si ya hay un huérfano, y de hecho lo había. No lo arreglé (solo escribo este informe).

### 2.3 Detalle de las 26 suites aisladas

Duración de la pasada B (entorno limpio). La columna A marca la única diferencia de la pasada A.

| # | Suite | A | B | s (B) |
|---|---|---|---|---|
| 1 | `chat/modelo.mjs` | OK | OK | 0,1 |
| 2 | `chat/bonsai-chat.mjs --self-test` | OK | OK | 0,1 |
| 3 | `chat/actions.mjs` | OK | OK | 0,1 |
| 4 | `chat/editar.mjs` | OK | OK | 0,1 |
| 5 | `chat/adaptadores.mjs` | OK | OK | 0,1 |
| 6 | `chat/prueba-ui.mjs` | OK | OK | 0,1 |
| 7 | `chat/prueba-editor.mjs` | OK | OK | 0,1 |
| 8 | `chat/prueba-contexto.mjs` | OK | OK | 0,2 |
| 9 | `chat/prueba-stream.mjs` | OK | OK | 10,5 |
| 10 | `chat/prueba-lecturas.mjs` | OK | OK | 0,1 |
| 11 | `chat/prueba-markdown-seguro.mjs` | OK | OK | 0,1 |
| 12 | `chat/prueba-navegador-rutas.mjs` | OK | OK | 0,1 |
| 13 | `chat/prueba-archivos-seguros.mjs` | OK | OK | 0,1 |
| 14 | `chat/prueba-git-seguro.mjs` | OK | OK | 3,4 |
| 15 | `chat/prueba-procesos.mjs` | OK | OK | 16,2 |
| 16 | `chat/prueba-seguridad.mjs` | OK | OK | 0,5 |
| 17 | `chat/prueba-sin-gpu.mjs` | OK | OK | 0,9 |
| 18 | `chat/prueba-truncado.mjs` | OK | OK | 1,5 |
| 19 | `chat/prueba-api.mjs` | OK | OK | 0,8 |
| 20 | `chat/prueba-agente-limites.mjs` | OK | OK | 4,7 |
| 21 | `chat/prueba-servidor-estado.mjs` | OK | OK | 0,5 |
| 22 | `chat/prueba-recuperacion-modelo.mjs` | OK | OK | 0,1 |
| 23 | **`chat/prueba-agente.mjs`** | **FALLO** | OK | 16,7 |
| 24 | `chat/prueba-servidor-administrado.mjs` | OK | OK | 12,2 |
| 25 | `chat/prueba-perfil-gpu.mjs` | OK | OK | 3,5 |
| 26 | `chat/prueba-copia-evaluacion.mjs` | OK | OK | 1,5 |

Suites de navegador (pasada C), con **Edge real headless** (no simulado):

| # | Suite | Resultado | s |
|---|---|---|---|
| 1 | `chat/prueba-navegador.mjs` | OK | 1,7 |
| 2 | `chat/prueba-navegador-aislamiento.mjs` | OK | 3,0 |
| 3 | `chat/prueba-ui-humo.mjs` | OK | 1,8 |

No ejecutadas (grupo `gpu`, 5 suites; requieren cargar el modelo real):
`chat/prueba-gpu-real.mjs`, `chat/prueba-vision.mjs`, `chat/prueba-modelos.mjs --real`,
`chat/prueba-observacion.mjs --real`, `chat/prueba-calidad-kv.mjs --real`
(`scripts/run-tests.mjs:65-71`). Ver §4.

### 2.4 Profundidad de las pruebas (no son tests de humo)

Nº de ocurrencias de aserción (`check(`/`assert`) por archivo, vía grep — cifra orientativa, no
ejecutada una a una:

| Suite | comprobaciones | Suite | comprobaciones |
|---|---|---|---|
| `prueba-api.mjs` | 101 | `prueba-servidor-administrado.mjs` | 37 |
| `prueba-agente.mjs` | 98 | `prueba-sin-gpu.mjs` | 35 |
| `prueba-editor.mjs` | 74 | `prueba-procesos.mjs` | 34 |
| `prueba-stream.mjs` | 58 | `prueba-servidor-estado.mjs` | 25 |
| `prueba-contexto.mjs` | 48 | `prueba-navegador-aislamiento.mjs` | 24 |
| `prueba-seguridad.mjs` | 51 | `prueba-markdown-seguro.mjs` | 22 |
| `prueba-navegador.mjs` | 42 | `prueba-navegador-rutas.mjs` | 15 |
| `prueba-perfil-gpu.mjs` | 55 | `prueba-lecturas.mjs` | 38 |

Total orientativo de las 23 suites contadas: **≈856 aserciones**. Comprobaciones puntuales que
verifiqué ejecutando la suite suelta: `prueba-navegador-rutas.mjs` imprime *"7 enlaces reales
probados"*, `prueba-servidor-administrado.mjs` imprime **8** líneas `OK:` (coincide con el
informe), `prueba-procesos.mjs` termina en `prueba procesos ok` (no imprime "33/33"; el informe
cita ese número, no es comprobable desde la salida de hoy).

**El estado del usuario no se tocó**, como afirma el informe: tras las 3 ejecuciones,
`chat/ui-session.json` sigue con mtime 23:07, `chat/timings.jsonl` 16:00 y
`chat/ui-chats/index.json` 16:01. Las suites usan `os.tmpdir()`/`BONSAI_STATE` (p. ej.
`chat/prueba-sin-gpu.mjs:65`) y servidores falsos en puertos efímeros.

---

## 3. Mapa de tamaño y complejidad

### 3.1 Módulos principales (líneas / bytes)

| Archivo | Líneas | Bytes | Nota |
|---|---|---|---|
| `chat/ui-server.mjs` | **3.354** | 169.430 | servidor HTTP + API + bucle del agente + modelo + permisos |
| `chat/bonsai-chat.mjs` | 1.436 | 65.066 | cliente llama-server, SSE, contexto, resúmenes |
| `chat/actions.mjs` | 1.302 | 59.195 | herramientas, heurísticas de texto, diff, `commandAllowed` |
| `chat/context.mjs` | 951 | 46.143 | estimación/packing de contexto |
| `chat/editar.mjs` | 476 | 21.726 | Ctrl+K / reemplazos |
| `chat/sse.mjs` | 376 | 14.100 | lector SSE único (usado por 5 consumidores) |
| `chat/procesos.mjs` | 377 | 15.741 | lanzamiento/vigilancia de comandos |
| `chat/navegador.mjs` | 274 | 19.569 | navegador controlado (Edge/Chrome) |
| `chat/historial.mjs` | 244 | 10.446 | índice/copias de conversaciones |
| `chat/almacen-json.mjs` | 184 | 6.933 | escritura atómica JSON |
| `chat/lecturas.mjs` | 308 | 14.123 | política de lectura del agente |
| `chat/ui/app.js` | 2.095 | 83.781 | lógica de IDE (segunda capa, reasigna globales) |
| `chat/ui/chat-core.js` | 1.763 | 70.754 | antes script inline de `index.html` |
| `chat/ui/index.html` | 687 | 28.379 | antes 2.442 líneas |
| `chat/ui/markdown.js` | 386 | 17.652 | render Markdown saneado |
| `scripts/*.ps1` | 1.340 (total) | — | 15 scripts PowerShell |
| `scripts/run-tests.mjs` | 196 | 8.201 | ejecutor de suites |

Reparto: **11.140** líneas de producto en `chat/*.mjs` (sin `prueba-*`) + **5.176** en
`chat/ui` (JS+HTML) + **814** en `chat/evaluar/` + **1.340** en scripts `.ps1`;
**7.249** líneas de suites de prueba en `chat/prueba-*.mjs` (~0,65 líneas de prueba por línea de
producto: buena ratio para un proyecto de este tamaño).

### 3.2 Monolitos y duplicación

- **`main()` de `ui-server.mjs` = 2.303 líneas (68,7 % del archivo)**. El propio código lo
  reconoce como problema de testeabilidad: *"ui-server.mjs arranca el servidor HTTP al importarse
  (main() al final del archivo), así que una prueba no puede importarlo"* (`chat/procesos.mjs:1-10`).
  La extracción de módulos (historial, lecturas, sse, almacén) mejoró el reparto, pero las rutas
  HTTP (~1.700 líneas antes del bucle) y el bucle del agente (~900 líneas) conviven en el mismo
  cierre con `let busy`, `permitMode`, `chat`, `historial`, etc.
- **Duplicación agente UI/CLI:** ya **no** hay dos bucles completos: `ui-server.mjs:1052` crea un
  único `BonsaiChat` y delega en él modelo/SSE/contexto (`chat.runTurn`, `streamSlice`,
  `packHistory`); el bucle de herramientas vive solo en el `present()` de `ui-server`
  (`chat/ui-server.mjs:1046-3348`). La duplicación del diagnóstico original ("900 líneas
  duplicadas") está **reducida**, no eliminada: el reparto de responsabilidades no está separado
  en módulos, sigue en una sola función.
- **Duplicación menor real:** `sesionValida()` existe dos veces (`chat/bonsai-chat.mjs:139` y
  `chat/historial.mjs:31`), con la misma semántica; riesgo de divergencia futura.
- **Frontend sigue con monkeypatching global:** el script extraído conserva el ámbito global a
  propósito (`chat/ui/chat-core.js:1-8`) y `app.js:625-626` reasigna `window.openFile` y
  `window.selectionInsideEditor`, funciones definidas en `chat-core.js:238,1433`. La extracción
  arregló el "archivo gigante", **no** el acoplamiento por variables globales. Hay un test de humo
  con navegador real que lo cubre parcialmente (`prueba-ui-humo.mjs`, 20 comprobaciones).
- **Heurísticas de texto:** siguen existiendo (`extractCommands/Reads/Writes/Searches` en
  `chat/actions.mjs`) pero ya son segunda opción: las `tool_calls` nativas tienen prioridad
  (`chat/ui-server.mjs:2557-2561`, `usadas = calls.length ? calls : crudas`). Coherente con el
  informe.
- **Diff sin LCS:** verificado estructuralmente (`chat/actions.mjs:1048-1067` usa
  `filasDiffLineal` con prefijo/sufijo y pila de rangos); el "100.000 líneas en ~34 ms" del
  informe **no lo re-medí**.

---

## 4. Contraste con los informes: afirmaciones verificadas vs no verificadas

### 4.1 Lo que sí se verificó

| Afirmación | Veredicto | Evidencia |
|---|---|---|
| "26 suites aisladas + 3 de navegador en verde" | **Cierto en entorno limpio** (no en el estado entregado, §2.2) | pasada B 26/26; pasada C 3/3 |
| "Los 10 bugs (BUG-01…10) resueltos" | **Cierto**: el arreglo está en el código | BUG-01 `chat/guardia.mjs:91-120,133-165`; BUG-02 `chat/navegador.mjs:174`; BUG-03 `chat/navegador.mjs:246-256` (+ test `chat/prueba-navegador-aislamiento.mjs:72-78`); BUG-04 `chat/procesos.mjs:100-133`; BUG-05 `scripts/start-gpu-model.ps1:205,219,228-230` y `scripts/stop-managed-server.ps1:83-105`; BUG-06 `chat/modelo.mjs:25,97,107,119,186,205,220`; BUG-07 `chat/ui/markdown.js:214-219,303-304`; BUG-08 `chat/ui-server.mjs:66,100-108`; BUG-09 `chat/ui-server.mjs:2952-2965`; BUG-10 sin heurísticas `pdf/ejecut` (grep vacío en `ui-server.mjs`) |
| "Un lector SSE único (`chat/sse.mjs`) para chat, medidores y evaluador" | **Cierto** | importado en `chat/bonsai-chat.mjs:34`, `chat/evaluar/ejecutar.mjs:21`, `chat/evaluar/tarea-grande.mjs:18`, `chat/medir-agente.mjs:29`, `chat/medir-formato.mjs:23`, `chat/medir-stacks.mjs:20` |
| "Historial atómico, `.bak`, corruptos apartados, índice reconstruido" | **Cierto** | `chat/historial.mjs:16-19,79-101,148-170,176-225`; `chat/almacen-json.mjs:124-145`; cubierto por `prueba-servidor-estado.mjs` (OK) |
| "`prueba-servidor-administrado.mjs` (8 casos)" | **Cierto** | la suite imprime exactamente 8 `OK:` al ejecutarla suelta |
| "`prueba-navegador-rutas.mjs` (7 enlaces reales)" | **Cierto** | salida: `prueba navegador rutas ok (7 enlaces reales probados)` |
| "El estado del usuario (`ui-session.json`, `ui-chats/`, `logs/`) no se tocó" | **Cierto** | mtimes sin cambiar tras las 3 pasadas (§2.4) |
| "Repro histórico en `salida/auditoria-codex-ornith/repro.mjs`" | **Cierto que existe** | `repro.mjs` (10.867 B) + `evidencia.json` (75.939 B); este último solo contiene **5 casos** (`limite-cuatro-archivos`, `limite-saltos`, `linea-larga`, `releer-despues-plegar`, `releer-tras-comando`) |

### 4.2 Lo que no se pudo verificar o es inexacto

| Afirmación del informe | Problema | Evidencia |
|---|---|---|
| "Hallazgos de `reporte de codex.md`: 21/21 resueltos" | **No verificable**: el documento fuente **no existe en el repositorio** | `find`/grep: no hay `reporte de codex.md`; solo `INFORME-SOLUCION-2026-10-27.md` lo menciona. La evidencia cruda disponible cubre 5 casos, no 21 |
| "GPU real: 9 OK, 32.768 tok, KV q8_0, calidad 8/8" | **No re-verificado aquí** (fuera de alcance; requiere cargar el modelo) | GPU y `bin/llama-server.exe` presentes, pero `npm run test:gpu` no se ejecutó; queda para el informe de GPU |
| "grupos `aisladas` (26), `gpu` (4) y `navegador` (3)" (`INFORME…:103`) | **Inexacto**: el grupo GPU tiene **5** suites | `scripts/run-tests.mjs:65-71` |
| "`ui-server.mjs` **baja** de 3263 a ~3350 líneas netas" (`INFORME…:94`) | **Contradictorio/impreciso**: el archivo tiene **3.354** líneas, es decir **+91 (+2,8 %)** respecto a las 3.263 de `HEAD` | `git show HEAD:chat/ui-server.mjs \| wc -l` = 3263; `wc -l` = 3354 |
| "`npm test` ≈ 63,1 s" (`INFORME…:22`) / "~36 s" (`README.md:67`) | **Desactualizado**: medido 74,1 s en dos pasadas | §2.1 |
| "`prueba-procesos.mjs` (33/33)" | No comprobable desde la salida actual (imprime `prueba procesos ok`); el archivo tiene ~34 aserciones | ejecución suelta |
| "Diff de 100.000 líneas en ~34 ms" | **No medido** en esta auditoría | estructura sí verificada (§3.2) |
| "`ui-server.mjs` desacoplado / bucle como composición" | **Parcial**: el bucle sigue dentro de `main()` (2.303 líneas); el desacople es de módulos auxiliares, no del núcleo | §3.2 |

---

## 5. Robustez y riesgos priorizados

Prioridad P1 = puede costar trabajo o datos del usuario; P2 = fricción/fallos frecuentes;
P3 = deuda que encarece el mantenimiento. "Evidencia" = ruta:línea o hecho medido.

| Prio | Riesgo | Evidencia | Impacto para programar a diario | Mitigación existente / recomendada |
|---|---|---|---|---|
| **P1** | **Repo no reproducible**: casi todo el trabajo del 27-oct está sin commitear | `git status`: 30 `M` + 37 `??`; `git diff --stat` 3.079 inserciones/2.729 borrados; `HEAD` es de las 15:07 y hay ediciones hasta las 23:07; `package.json`, `scripts/run-tests.mjs`, `sse.mjs`, `historial.mjs`, `lecturas.mjs`, `almacen-json.mjs`, `chat-core.js` sin seguimiento (§6) | Un `git clone` no reproduce el producto; no hay historial ni bisect del refactor; un fallo de disco pierde el trabajo | Commitear **ya** fuentes + tests + docs (sin `bin/`, `models/`, estado: ya ignorados). No lo hice por instrucciones |
| **P1** | **Suites no herméticas**: puerto fijo + huérfanos en rutas de fallo | `chat/prueba-agente.mjs:171` usa 8798 fijo; huérfanos medidos PIDs 15940/7480/22016 (creados 22:32–22:40, vivos a las 23:22); fallo en rojo en la pasada A (§2.2) | "En mi máquina pasa" deja de ser cierto tras un fallo interrumpido; CI imposible | Puerto efímero (`listen(0)`) o Puerto variable desde el entorno; matar el árbol del hijo en el `finally` del test; comprobar el puerto al arrancar el test y saltar/limpiar |
| **P2** | **Monolito `main()`**: 2.303 líneas en una función | `chat/ui-server.mjs:1046-3348`; el propio repo lo documenta como impedimento para tests (`chat/procesos.mjs:1-10`) | Cambios caros y arriesgados; no se puede importar el servidor en pruebas; revisión difícil | Extraer rutas HTTP y bucle del agente a módulos con interfaz explícita (el plan de `AUDITORIA…§4` sigue vigente) |
| **P2** | **Lock-in de plataforma total** | Windows+PowerShell: `scripts/start-ui.ps1:83,111`, `start-server.ps1`, `stop-managed-server.ps1`, OCR `chat/ocr.mjs:6-11`; Edge/Chrome: `chat/navegador.mjs:10-11`; GPU CUDA: `README.md:36-44`, `scripts/start-server.ps1:125-126` | No hay versión usable en Linux/macOS; sin Edge falla la herramienta de navegador y el 100 % de `test:navegador`; sin GPU **no arranca** (ni en modo solo-editor) | Documentarlo como requisito duro; si se quiere ampliar, desacoplar arranque del `.ps1` y ofrecer modo "editor sin modelo" |
| **P2** | **Sin GPU = producto inservible** | `scripts/start-server.ps1:125-126` aborta; `chat/ui-server.mjs:1065` hace `await chat.connect()` al arrancar y `chat/bonsai-chat.mjs:447-458` lanza "No hay servidor… arranca con scripts\start-chat.ps1" | El usuario no puede ni abrir la UI para editar sin modelo | Modo degradado (UI/editor/deshacer sin LLM). Hoy no existe |
| **P2** | **Recuperación ante caída del modelo**: no hay reconexión automática a media sesión | `connect()` se llama al arrancar (`ui-server.mjs:1065`) y al **cambiar de modelo** (`ui-server.mjs:2252`); no hay reintento/health-loop posterior; la única recuperación probada es el cambio de modelo (`chat/cambio-modelo.mjs`, `prueba-recuperacion-modelo.mjs`) | Si `llama-server` muere o se cuelga, el turno acaba en error visible y hay que reiniciar a mano | Health-check periódico + reconexión con backoff; al menos, botón "reconectar" en la UI |
| **P2** | **Seguridad "blanda"**: guardia CSRF sí, autenticación no; el filtro de comandos es una lista negra | `chat/guardia.mjs:154-180` (Host/Origin/Content-Type; sin token); `chat/actions.mjs:807-817` bloquea `del/move/taskkill/C:\/..`, pero permite `node -e`, `python -c`, `powershell -Command`; `README.md:129-131` admite "no es un sandbox del sistema operativo" | Con `--host 0.0.0.0` cualquier equipo de la LAN puede usar la API (leer/escribir archivos, undo) y, si el permiso es "all", ejecutar comandos; el agente puede dañar el proyecto (hay undo y git, no sandbox) | Mantener 127.0.0.1 por defecto (lo está), token si se habilita LAN, y dejar clarísimo que los comandos se ejecutan con el usuario Windows |
| **P2** | **Tool calls inválidas / basura del modelo**: bien cubierto, con restos heurísticos | `nativeToolEffects` convierte JSON truncado/sin argumentos en notas explícitas (`chat/actions.mjs:481,516-536`); `llamadasCrudas` ignora bloques cortados y deduplica (`chat/adaptadores.mjs:150-186`); cierre honesto si el último comando falló (`ui-server.mjs:3256-3274`); pero `esCharla` y la detección de "anuncia acción futura" son regex en español (`actions.mjs:672-688`, `ui-server.mjs:3207-3212`) | El agente rara vez "miente" del todo, pero los ficheros con nombres/idiomas inesperados y las respuestas largas pueden esquivar las heurísticas; la calidad final depende del modelo (fuera de alcance) | Tests ya cubren truncados; a futuro, validación por esquema JSON de argumentos y menos heurísticas |
| **P2** | **Estado**: historial robusto, pero no transaccional entre las dos copias | `chat/historial.mjs:7-19` documenta que "dos escrituras separadas no son una transacción"; se mitiga con "gana la copia válida más nueva" (`:176-225`) y aviso en `/api/state` (`ui-server.mjs:1294`). `ui-session.json` actual = 327 KB | Corte de luz entre copias puede perder el último turno (no la conversación completa); sin límite visible de crecimiento del JSON de sesión | Aceptable para un solo usuario; añadir límite/rotación y prueba de corte a mitad de guardado |
| **P2** | **Cancelación y procesos de fondo**: bien implementado, con dependencia de `taskkill` | AbortController por turno (`ui-server.mjs:2409-2417`), cierre de pestaña aborta (`:2415`), `finally` cierra navegador y mata `procesosFondo` (`:3303-3311`); `matarArbol` usa `taskkill /T` en Windows (`chat/procesos.mjs:138-160`); test `prueba-procesos.mjs` cubre cancelación/EBUSY | En Windows funciona; si `taskkill` no está disponible o el proceso se escapa (p. ej. sí ocurrió: huérfanos), queda basura | Ya hay tests; el hueco es que **las pruebas** dejaron huérfanos en un camino de fallo (§2.2) |
| **P3** | **Sin CI, sin lint, sin typecheck** | `package.json` solo tiene scripts de test; no hay `.github/`, ni eslint/tsc, ni `test:e2e`; JSDoc sin comprobador | La calidad depende de ejecutar `npm test` a mano; las erratas de tipos/JSDoc no se detectan | Workflow de CI (Node 22/26 en Windows) que corra `npm test` + `test:navegador` |
| **P3** | **Documentación con cifras desactualizadas/erróneas** | §4.2 (63,1 s vs 74,1; "gpu (4)" vs 5; "baja" a 3350) | Erosiona la confianza en el resto del informe | Corregir cifras al cerrar el trabajo; el informe de verificación debe citar el commit |
| **P3** | **Un solo turno global (busy)**: no hay concurrencia | `chat/ui-server.mjs:1069,2395-2399`; segundo mensaje recibe 409 | Aceptable para un solo usuario; con dos pestañas o el chat de terminal a la vez se rechaza | Documentado; no es un fallo para el uso previsto |

Además, dos limitaciones ya reconocidas por el propio informe y confirmadas: el lector SSE exige
línea en blanco entre eventos (`chat/sse.mjs`; formato estándar de `llama-server`) y la
comprobación `lstat`→uso de rutas es *best-effort*, no una barrera TOCTOU
(`chat/archivos-seguros.mjs:5-31`).

---

## 6. Reproducibilidad del repositorio (git)

- **4 commits** en total; los 3 últimos son de las **15:02–15:07** del 27-oct. **Todas las
  ediciones posteriores (hasta las 23:07) están sin commitear.**
- `git status` actual: **30 archivos versionados modificados** y **37 entradas sin seguimiento**
  (módulos nuevos, tests nuevos, `docs/`, informes, `package.json` de la raíz, `run-tests.mjs`,
  `chat-core.js`…).
- `git diff --stat`: **3.079 inserciones / 2.729 borrados** en archivos versionados (sin contar los
  nuevos sin seguimiento). Diferencia de tamaño entre `HEAD` y el árbol de trabajo:
  `ui-server.mjs` 3.263 → 3.354; `index.html` 2.442 → 687 (el script inline de 1.750 líneas pasó a
  `chat-core.js`, 1.763 líneas, que **no está versionado**); `bonsai-chat.mjs` 1.333 → 1.436.
- Consecuencia práctica: `git clone` del repo + `npm test` **no funciona** (el `package.json` de la
  raíz está sin seguimiento); `HEAD` contiene una versión anterior del servidor que no importa
  `sse.mjs`/`lecturas.mjs`/`historial.mjs`/`almacen-json.mjs` (módulos que tampoco existen en
  `HEAD`). El proyecto **no se puede reconstruir desde git**.
- Lo bueno: `.gitignore` excluye correctamente `bin/`, `models/`, `logs/`, `chat/ui-session.json`,
  `chat/ui-chats/`, `chat/undo/`, `salida/`, capturas y secretos (`.gitignore:1-40`), así que un
  commit de fuentes no arrastraría 30 GB de modelos ni datos del usuario.
- **Riesgo**: pérdida del trabajo del día, imposibilidad de revisar el diff del refactor, de
  `git bisect` y de que otra persona/equipo reconstruya el proyecto. Es el riesgo P1 más barato de
  mitigar (un commit) y el más caro si se materializa.

---

## 7. Veredicto

**Categoría: BETA TEMPRANA USABLE EN UN SOLO EQUIPO — no "usable a diario" todavía.**

A favor de "usable" (no es un juguete):

- El producto hace cosas reales y las pruebas lo demuestran: 29/29 suites ejecutables en verde
  (26 aisladas + 3 con Edge real), con ~856 aserciones; casos de editor con CRLF, historial
  corrupto, 413, cancelación, límites del agente, seguridad CSRF, git seguro, undo, etc.
- La ingeniería defensiva del día 27 es seria y verificable: escritura atómica con `fsync`,
  cuarentena de corruptos, cancelación que mata el árbol de procesos, cierre honesto del turno,
  guardia anti-DNS-rebinding, rate/limits, `sanitización` de Markdown.
- Los 10 bugs auditados **están arreglados en el código**, no solo en el informe.

En contra de "usable a diario" (por qué no es todavía beta cerrada / producto):

1. **No es reproducible**: el estado entregado no está en git. Sin eso no hay "producto".
2. **No es repetible en CI**: puerto fijo y huérfanos hicieron fallar la suite en el propio estado
   entregado; un usuario que ejecute los tests sin limpiar antes puede ver rojo por basura previa.
3. **El núcleo sigue siendo un monolito** (`main()` = 2.303 líneas): mantenerlo a diario y
   arreglarlo con garantías es caro; el propio repo documenta que no es testeable de otra forma.
4. **Un solo equipo**: Windows + PowerShell + Edge + GPU NVIDIA 8 GB; sin GPU el IDE no abre.
   No hay "modo editor" y no hay auth para LAN.
5. **Las 5 suites de GPU no se ejecutaron aquí** (15 % de las suites): la parte que más depende
   del modelo/arranque real no está validada por esta auditoría.

**Para quién es usable hoy:** un desarrollador solo, en esta máquina Windows+NVIDIA, que
entienda que el agente puede ejecutar comandos (permiso "ask" por defecto), que haga commits
propios con frecuencia y que no dependa de `npm test` como puerta de calidad sin limpiar el
entorno. Con eso, es una herramienta de programación local **de verdad**, sorprendentemente
completa.

**Qué le falta para "usable a diario" (orden de coste/beneficio):**

1. Commit del estado actual (fuentes+tests+docs) y un tag; después, commits pequeños.
2. Hacer herméticas las suites: puerto efímero en `prueba-agente.mjs:171`, limpieza de hijos en
   `finally` de los tests, y un chequeo de "entorno limpio" al arrancar.
3. Extraer de `main()` las rutas HTTP y el bucle del agente (aunque sea sin cambiar conducta).
4. CI mínima (Windows, Node 22+) que ejecute `npm test` + `npm run test:navegador`, y una lista de
   comprobación manual para `test:gpu`.
5. Corregir las cifras/documentos (63,1 s, "gpu (4)", "baja de 3263 a 3350") o fecharlos con el
   commit al que corresponden.
6. (Opcional, producto) modo "editor sin modelo" y token si se abre a LAN.

---

## 8. Anexos

### A. Comandos exactos usados

```powershell
cd C:\Users\user\Documents\prject_local_AI
npm test                      # pasada A: 25/26 (huérfano en 8798); pasada B (limpio): 26/26
npm run test:navegador        # 3/3 OK
node scripts/run-tests.mjs --listar   # 26 + 5 + 3 = 34 suites
node chat/prueba-agente.mjs   # suelta, tras liberar 8798: exit 0
node chat/prueba-procesos.mjs ; node chat/prueba-servidor-administrado.mjs ; node chat/prueba-navegador-rutas.mjs
git status ; git diff --stat ; git log --oneline ; git show HEAD:chat/ui-server.mjs | wc -l
```

Las salidas completas se conservaron en `%TEMP%\bonsai-audit\` (`npm-test.log`,
`npm-test-2.log`, `npm-test-navegador.log`, `exits.txt`, `exits-2.txt`).

### B. Huérfanos encontrados y terminados (para reproducir el diagnóstico)

| PID | Creado | Padre | Comando | Destino |
|---|---|---|---|---|
| 15940 | 2026-10-27 22:32:43 | muerto | `node -e "...createServer(...).listen(8798,...)"` | escuchando en 0.0.0.0:8798 |
| 7480 | 2026-10-27 22:32:19 | muerto | `node -e "...setInterval(fs.writeFileSync(%TEMP%\bonsai-procesos-0H1t4d\fondo-sigue.txt),300)"` | escribiendo cada 300 ms |
| 22016 | 2026-10-27 22:40:07 | muerto | ídem, dir `bonsai-procesos-V7AXlc` | escribiendo cada 300 ms |

Los tres eran residuo de ejecuciones del propio proyecto (22:32 y 22:40), no procesos de usuario.
Se terminaron con `Stop-Process` para poder medir la pasada B; después **no quedó ningún listener
en 8798 ni proceso `bonsai-*`**, y no se mató ningún proceso ajeno.

### C. Límites de esta auditoría

- No se ejecutaron las 5 suites de GPU (requieren cargar el modelo); todo lo relativo a calidad
  del modelo/VRAM es de otro informe. La GPU RTX 4060 y `bin/llama-server.exe` **sí** existen.
- No se midió rendimiento del diff ni latencias del agente.
- Las duraciones de las suites varían con la máquina; la de `prueba-stream.mjs` (10,5 s) y
  `prueba-procesos.mjs` (16,2 s) dominan el total.
- No se modificó ni un archivo del proyecto (solo este informe), no se hizo commit.
- La pasada A no es el "estado virgen del repo", sino el estado del entorno al empezar la
  auditoría; el fallo se explicó y se reprodujo/descartó tras limpiar.
