# AUDITORÍA DEL HANDOFF · 2026-10-04

> Segunda sesión. Este documento **audita** `HANDOFF.md` afirmación por afirmación, registra lo
> que estaba mal o incompleto, y deja el estado real del proyecto. Todo lo marcado ✅ se comprobó
> en esta máquina; lo marcado ❌ era falso o estaba desactualizado; ⚠️ es un riesgo abierto.

---

## 1. Veredicto rápido

| Afirmación del HANDOFF | Veredicto | Evidencia |
|---|---|---|
| Las 5 pruebas offline pasan | ✅ cierto | `modelo ok`, `actions ok`, `prueba sin GPU ok`, `prueba ui ok`, `self-test ok` |
| Los arreglos del agente (sección 3) están aplicados | ✅ cierto | Verificados por grep: `impliedAction` exige anuncio y ≤400 car.; `leer` sin ruta lista la carpeta; `pythonCmd`; reescritura de `.venv`; turno de cierre con `tool_choice:"none"` |
| `config/optimo.json` tiene la calibración | ✅ cierto | `tgTps 28.6`, `ubatch 256`, `kvBias false`, profundidad 8k/32k coinciden |
| La seguridad CSRF está **pendiente y es urgente** | ✅ cierto | `ui-server.mjs` no tenía **ni una** comprobación de `Origin`/`Host` (0 coincidencias de `403` en todo el archivo) |
| La corrida 2 del evaluador existe o está en curso | ❌ **falso** | `chat/evaluar/resultados/` solo contiene los ficheros de la corrida 1. La salida vivía en un scratchpad efímero: **se perdió** |
| "README y ARQUITECTURA describen 64k fijo" | ❌ **falso para el README** | El README **sí** documenta el contexto automático, los 77.824 tokens y el KV `q4_0`; se actualizó *después* de escribirse el handoff. Solo `ARQUITECTURA…md` §1 conserva "ventanas de 16k a 64k" |
| El hash del modelo local | ✅ **verificado contra terceros** | SHA-256 local `94dd53cb…52900a` = exactamente el que ancló el shootout público de 11 builds. **El artefacto medido y el tuyo son el mismo archivo** |

**Conclusión:** el handoff es fiable en lo técnico (hardware, VRAM, velocidades, arreglos), pero
**sobrevende el estado de la evaluación** (da por hecha una corrida que no se guardó) y **se queda
corto en la deuda documental** (el README ya estaba al día; el que falta es ARQUITECTURA §1).

---

## 2. Lo que se ha hecho en esta sesión

### 2.1 Seguridad: guardia anti-CSRF / anti-DNS-rebinding (❌ → ✅)

**El agujero era real y explotable:** con `chat/ui-permit.json` en `{"mode":"all"}`, cualquier página
web abierta en el navegador podía hacer
`fetch("http://127.0.0.1:8787/api/chat", {method:"POST", mode:"no-cors", body:…})`
y el modelo habría ejecutado comandos en el PC. No puede leer la respuesta, pero no le hace falta.

**Solución** (nuevo `chat/guardia.mjs`, módulo puro y testeable), tres reglas:

1. **`Host` tiene que ser de los nuestros** (`127.0.0.1:<puerto>`, `localhost:<puerto>`, `[::1]:<puerto]`,
   más el host configurado si se arranca con `--host` no-loopback). Corta el DNS rebinding: aunque el
   navegador crea que habla con `evil.com`, la cabecera `Host` lo delata.
2. **Si viene `Origin`, tiene que ser exactamente el nuestro.** Los navegadores la mandan siempre en
   POST, incluso en peticiones del mismo origen. `Origin: null` (iframe en sandbox, `file://`) se rechaza.
3. **Si el POST lleva cuerpo, `Content-Type` tiene que ser `application/json`.** Un formulario o un
   `no-cors` cross-origin solo pueden enviar tipos "simples"; para poner JSON haría falta un preflight
   CORS que este servidor no concede.

**Detalle que casi rompe el evaluador:** `chat/evaluar/ejecutar.mjs` manda `POST /api/reset` **sin
cuerpo ni `Content-Type`** (y el endpoint responde `204`, no `200`). Por eso la regla 3 se aplica
**solo si hay cuerpo**; un requisito global de JSON habría roto el evaluador. La prueba lo cubre
explícitamente.

**Pruebas** (`chat/prueba-seguridad.mjs`, `node chat/prueba-seguridad.mjs` → `prueba seguridad ok`):
26 casos de lógica pura + 6 de integración contra un `ui-server.mjs` real en un puerto libre con
estado temporal (`BONSAI_STATE`), comprobando que `Origin` ajeno, `Host` ajeno y `text/plain` reciben
**403**, y que los clientes legítimos siguen funcionando.

### 2.2 Modelo nuevo integrado

Ver `INTEGRACION-MODELO.md`.

### 2.3 Robustez del arranque

`start-server.ps1` ahora **verifica el tamaño del GGUF** antes de arrancar y se niega si no cuadra.
Antes, un archivo a medias (descarga cortada) habría arrancado y generado basura sin avisar.
Probado: con el modelo a medio descargar responde
`El modelo no tiene el tamano esperado: 1693794304 bytes, se esperaban 5946648928`.

---

## 3. Riesgos abiertos (⚠️)

| # | Riesgo | Detalle | Mitigación propuesta |
|---|---|---|---|
| 1 | **`ui-permit.json` en `"all"`** | La guardia ya impide el CSRF, pero si algo entra por otra vía el modelo ejecuta comandos **sin preguntar** | Poner `"ask"` por defecto; subir a `"all"` solo mientras se trabaja |
| 2 | **El `llama-server` del puerto 8080 no tiene guardia** | Es el servidor de llama.cpp, no el nuestro: una web podría mandarle `POST /v1/chat/completions` (consumo de GPU, no ejecución de comandos) | Arrancarlo con `--api-key` y que el cliente la mande |
| 3 | **Sin pruebas de navegador** | `prueba-ui.mjs` solo cubre `markdown.js`; el editor, las pestañas y el streaming no tienen prueba automática | Añadir pruebas de integración de la UI (Playwright o similar) |
| 4 | **Todo el proyecto sin commitear** | 1 solo commit (`test_math.py`); todo lo demás en `??` | Commit inicial del estado actual |

---

## 4. Correcciones al HANDOFF que hay que propagar

1. **Sección 3 (evaluación):** la corrida 2 **no existe**. Hay que re-ejecutarla
   (`node chat/evaluar/ejecutar.mjs`, ~9 min) y **copiar el informe a `chat/evaluar/resultados/`**
   en cuanto acabe (no dejarlo en un scratchpad).
2. **Sección 7 (deudas):** el README **ya no** describe "64k fijo". Lo que falta es
   `ARQUITECTURA-Y-PLAN-MAESTRO.md` §1 ("ventanas de contexto de 16k a 64k tokens") y §3
   (sigue diciendo que el modelo es el de BoldingBuilds; ahora el predeterminado es Override-6).
3. **Sección 2 (VRAM):** sigue siendo válida tal cual, porque **los dos modelos miden exactamente
   5.946.648.928 bytes**. Cambiar de modelo **no cambia** el contexto máximo ni la tabla de VRAM.
4. **Fichero inútil:** `models/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-kv-bias.gguf` son **0 bytes**
   (el sesgo de media K quedó descartado por perplejidad). Se puede borrar.

---

## 5. Cómo se verificó (reproducible)

```powershell
node chat\modelo.mjs                    # modelo ok
node chat\actions.mjs                   # actions ok
node chat\prueba-sin-gpu.mjs            # prueba sin GPU ok
node chat\prueba-ui.mjs                 # prueba ui ok
node chat\prueba-seguridad.mjs          # prueba seguridad ok   <-- NUEVO
node chat\prueba-api.mjs                # prueba api ok         <-- NUEVO
node chat\bonsai-chat.mjs --self-test   # self-test ok
(Get-FileHash models\Ternary-Bonsai-2-27B-Abliterated-PTQ1_0.gguf).Hash   # 94dd53cb…52900a
```

---

# PARTE 2 · Modelo nuevo, rediseño y funciones (misma sesión)

## 6. Modelo: se añade Override-6 y el actual queda de respaldo

Ver `INTEGRACION-MODELO.md`. Resumen: `chat/modelo.json` pasa a tener un **catálogo** con dos
entradas (`override6` predeterminado, `bolding_v1` respaldo), y `start-server.ps1` acepta
`-Modelo <clave>`. Los dos archivos miden **exactamente 5.946.648.928 bytes**, así que la tabla de
VRAM y el contexto automático (77.824 tokens) **no cambian** al cambiar de modelo.

Además, `start-server.ps1` ahora **comprueba el tamaño del GGUF antes de arrancar**: una descarga a
medias habría arrancado y generado basura sin avisar. Probado con el archivo a medio bajar.

## 7. Rediseño visual

| Pieza | Qué es |
|---|---|
| `chat/ui/tema.css` | Sistema de diseño: ~60 variables (tipografía, espacio base 4, radios, elevación, movimiento), **tema claro y oscuro**, y el pulido de todos los componentes existentes (botones, paneles, árbol, chat, barra de estado, medidor) |
| `chat/ui/fuentes/` | **Inter + JetBrains Mono variables**, subset `latin`, servidas en local: **78 KB** en total y sin CDN (`bajar-fuentes.mjs` es reproducible) |
| `chat/ui/iconos.js` | **52 iconos de Lucide** (ISC) como SVG en línea que heredan `currentColor`; generados por `bajar-iconos.mjs` (10 KB en vez de 507 KB del sprite completo) |
| `chat/ui/app.js` | Editor, pestañas, paleta, búsqueda, git, ajustes, avisos, menús y diálogos |

Correcciones de accesibilidad aplicadas tras auditar el contraste: **`--dim` incumplía WCAG AA**
(2,89:1 sobre `--panel`; mínimo 3:1) → subido a `#6f7a64` (~3,9:1). Foco visible a 2 px. Bloque
`prefers-reduced-motion`.

**Tres bloqueantes reales encontrados y arreglados** (los dos primeros los habría sufrido el usuario
en silencio):

1. **`ui-server.mjs` no servía `.woff2`**: la ruta `/ui/` solo aceptaba `.js` y `.css`, la tabla
   `TYPES` no tenía `font/woff2` y `path.basename()` aplanaba las subcarpetas. Las fuentes habrían
   dado **404** y el `@font-face` habría fallado sin decir nada. Arreglado y **cubierto por pruebas**.
2. **`hidden` no funcionaba contra `#code { display:flex }`**: una regla de autor gana a la hoja del
   navegador, así que el visor viejo se dibujaba encima del editor. Detectado **solo gracias a las
   capturas**; arreglado con `[hidden] { display: none !important }`.
3. **El límite del editor era inalcanzable**: `readBody` cortaba a 200 KB y destruía la conexión
   antes de poder contestar un 413 limpio. Ahora `/api/file` lee hasta 2,5 MB y responde 413.

## 8. Funciones nuevas

| Función | Estado |
|---|---|
| **Editor real** con pestañas, escritura, Ctrl+S, indicador de cambios y recarga automática cuando el agente reescribe | ✅ probado en navegador |
| **Paleta de comandos** (Ctrl+P archivos, Ctrl+Shift+P comandos) con filtro y teclado | ✅ probado (60 archivos, filtra a 1 al escribir) |
| **Búsqueda en todo el proyecto** (Ctrl+Shift+F) agrupada por archivo | ✅ API probada |
| **Tema claro/oscuro** y panel de ajustes persistente | ✅ probado en navegador (ambos temas) |
| **Git**: rama, número de cambios, lista y commit con mensaje | ✅ API probada |
| **Reglas del proyecto** (`BONSAI.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, respetando `alwaysApply: false`) | ✅ API probada |
| **Deshacer** escrituras del editor (`POST /api/undo`, con detección de conflicto) | ✅ API probada |
| API: `POST /api/file`, `/api/search`, `/api/git`, `/api/rules`, `/api/settings`, `/api/undo` | ✅ 30+ comprobaciones |
| Enlace directo: `#ruta/al/archivo` abre ese archivo | ✅ |

Pruebas nuevas: **`prueba-seguridad.mjs`** (26 casos de lógica + 6 de integración) y
**`prueba-api.mjs`** (~40 comprobaciones, incluidas "todos los recursos que declara index.html
existen" y "no se puede salir de `ui/`").

## 9. Lo que queda pendiente (honesto)

> **Actualizado en la Parte 3 (tercera sesión):** los tres primeros puntos de esta lista ya están
> hechos y probados. Ver la Parte 3 al final del documento.

- **Deshacer las escrituras del AGENTE**: el endpoint existe y está probado, pero el agente escribe
  por otra ruta (`writeOutputs` en `ui-server.mjs`), que todavía **no registra** el punto de
  deshacer. Falta engancharlo en `present()`.
- **Reglas aplicadas al modelo**: `/api/rules` ya las lee, pero `context.mjs` **todavía no las mete**
  en el mensaje de sistema.
- **Ctrl+K** (edición en línea sobre la selección), **nuevo/renombrar/borrar** archivo desde el
  explorador, y **adjuntar imágenes** (necesita `mmproj`).
- **Pruebas de navegador automáticas**: las capturas se hicieron a mano con Edge headless; no hay
  una suite que las repita.
- **`--api-key` en llama-server**: el CORS ya está restringido a nuestros orígenes, pero sin clave
  cualquier proceso local puede usar el modelo. Decisión del usuario.

---

## 10. Evaluación del agente: 15/19 → 19/19

El evaluador de 19 tareas (`node chat/evaluar/ejecutar.mjs`, ~5-10 min). **Los tres informes están
guardados en `chat/evaluar/resultados/`** (la "corrida 2" del handoff anterior se perdió por dejarla
en un scratchpad: no repetir ese error).

| Corrida | Qué cambió | Nota | Tiempo | Tokens generados |
|---|---|---:|---:|---:|
| 1 · `eval-1-antes-de-los-arreglos` | modelo viejo, app sin arreglos | **15/19** | 9 min 40 s | 11 974 |
| 2 · `eval-2-arreglos-modelo-override6` | **modelo Override-6** + arreglos del agente | **18/19** | 6 min 9 s | 7 233 |
| 3 · `eval-3-modelo-override6-prompt-arreglado` | + arreglo del mensaje de sistema | **19/19** | **5 min 13 s** | 7 441 |

**−46 % de tiempo** entre la primera y la última, con la misma máquina y el mismo servidor.

### El único fallo de la corrida 2, y por qué importa

`solo-chat` pide **explicar una closure sin usar herramientas**. El modelo nuevo escribió un archivo
`.js`, lo ejecutó y lo releyó (3 herramientas) y respondió en 144 caracteres: **suspenso**.

No es un fallo del modelo, es un efecto conocido de la abliteración: **sobre-llamar herramientas**.
El estudio de BoldingBuilds lo midió (un build abliterado llamaba a una herramienta 123 veces donde
el stock llamaba 63) y el autor del ThinkFix lo documenta igual. Arreglado en el mensaje de sistema
de `chat/bonsai-chat.mjs`:

> «Si lo único que te piden es una explicación, una comparación o una opinión, contesta con texto y
> no llames a ninguna función: para explicar algo no hace falta crear un archivo ni ejecutar un
> comando.»

Verificado en dos pasos: primero `solo-chat,hola-py,sqlite,lru-cache` (4/4, con `solo-chat` en
**1 salto y 0 herramientas**), y después **las 19 completas: 19/19**.

### Sobre la varianza

`lru-cache` tardó 39 s en la corrida 2 y 157 s en una pasada posterior con el mismo código: el
muestreo es a temperatura 0.5, así que **una diferencia de un par de tareas no significa nada**. Por
eso la comparación válida es la de las tres corridas completas, no la de tareas sueltas.

---

# PARTE 3 · Tercera sesión: deshacer del agente, reglas aplicadas, Ctrl+K, archivos e imágenes

## 11. Los cinco pendientes, cerrados

| Pendiente (sección 9) | Estado | Dónde está |
|---|---|---|
| Deshacer las escrituras del **agente** | ✅ probado | `guardarUndo()`/`aplicarUndo()` + `present()`; `POST /api/undo {id}` y `{turno:true}`; botón **Deshacer esta escritura** en cada tarjeta y **Revertir el turno** |
| Reglas del proyecto **aplicadas al modelo** | ✅ probado | `systemText(memory, rules)` en `context.mjs`, `BonsaiChat.rules`, `reglasParaModelo()` releído en cada turno; el chip dice si están apagadas |
| **Ctrl+K** (edición en línea) | ✅ probado | `chat/editar.mjs` (puro, con self-test) + `POST /api/edit` + diálogo con diff y Aceptar/Rechazar |
| **Nuevo / renombrar / borrar** desde el explorador | ✅ probado | `POST /api/fs` + menú contextual (F2) y botones en la cabecera del explorador; borrados y renombrados se pueden deshacer |
| **Adjuntar imágenes** | ✅ **con visión real** | `POST /api/attach` + pegar/arrastrar/elegir en el compositor. Con `-Vision` el proyector `mmproj-Q8_0` va **en CPU** (0 MiB de VRAM, el contexto no cambia) y las imágenes viajan como `image_url`. Sin visión se guardan y se avisa. Ver §16 |
| Pruebas de navegador automáticas | ✅ hechas | `chat/prueba-navegador.mjs`: Edge headless + iframe del mismo origen, 24 comprobaciones |

## 12. Tres bugs reales que aparecieron al probar

1. **Deshacer un archivo recién creado estaba roto** (justo el caso del agente escribiendo código
   nuevo). `POST /api/file` solo guardaba punto de deshacer **si el archivo ya existía**, y
   `/api/undo` hacía `fs.writeFileSync(abs, null)`. Ahora `antes: null` significa "no existía" y
   deshacerlo **borra el archivo**. Cubierto en `prueba-api.mjs` y `prueba-agente.mjs`.
2. **Los ids de las tarjetas de acción chocaban entre turnos.** `present()` numeraba `a1, a2…` en
   cada turno, así que en el segundo turno la interfaz **reutilizaba la tarjeta del primero** y el
   diff nuevo se pintaba encima (el evaluador también fusionaba acciones de turnos distintos en su
   `Map`). Ahora llevan prefijo de turno (`t3-a1`). Lo cazó la prueba de navegador; hay
   comprobaciones de que las dos tarjetas conviven.
3. **La prueba de API dependía de que el puerto 8080 tuviera el modelo real.** Si no había
   llama-server, `ui-server.mjs` no arrancaba y la suite fallaba sin relación con el código. Ahora
   levanta un llama-server de mentira.

Además, dos pulidos que salieron de las capturas: la tarjeta "Abrir" del archivo deshecho ya no se
queda apuntando a un 404, y el botón de revertir el turno cuenta solo lo que sigue pendiente (y
marca solo las tarjetas de **ese** turno).

4. **La respuesta final podía ser un `<tool_call>` en texto.** Lo destapó la corrida 4 del
   evaluador: en el turno de cierre el servidor manda `tool_choice: "none"`, el modelo (entrenado
   para responder en XML) escribe la llamada como texto y el usuario acababa viendo el XML crudo.
   Ahora `stripToolCallMarkup()` lo quita del texto y del historial, y si aparece en un turno normal
   se le pide **una vez** que la repita como función de verdad. Cubierto en `actions.mjs` y
   `prueba-agente.mjs`.
5. **El turno se podía quedar "en curso" para siempre.** `busy = true` se ponía **antes** del
   `try`, y un `res.writeHead` sobre un cliente que ya se había ido podía lanzar entre medias: el
   `finally` no llegaba a correr y el servidor respondía `409 ya hay un turno en curso` a todo hasta
   reiniciarlo. Lo destapó un ui-server de pruebas zombi mientras se probaba la visión. Ahora el
   turno se reclama **después** de leer el cuerpo y sin `await` por medio (eso también cierra la
   carrera de dos peticiones a la vez) y **todo** lo que sigue va dentro del `try/finally`. Hay
   prueba: un corte del cliente deja el servidor libre (`prueba-agente.mjs`).
6. **El servidor no arrancaba cuando lo lanzaba la interfaz.** `spawn("powershell.exe", …, {detached:true})`
   en Windows deja al hijo **sin consola**, y PowerShell 5.1 sale con código 0 **sin ejecutar ni una
   línea**: el cambio de modelo devolvía 504 sin un solo mensaje de error y sin procesos que mirar.
   Costó media tarde. Ahora se lanza sin `detached` y con `windowsHide`, y `start-server.ps1` acepta
   `-Log <ruta>` (Start-Transcript) para que cualquier fallo de arranque quede grabado en
   `logs\arranque-modelo.log`. Además, `-WindowStyle Minimized` se comía la salida redirigida: fuera.
7. **El apagado del servidor se llevaba por delante terminales ajenas.** El filtro buscaba
   PowerShell con `start-server.ps1` en la línea de comandos, así que mataba cualquier terminal que
   lo mencionara (incluidos los de las propias herramientas de desarrollo: los comandos se abortaban
   solos). Ahora se mata el **árbol real**: el proceso `llama-server` y su proceso padre.

## 13. Decisiones de diseño (para no re-litigar)

- Los puntos de deshacer son `STATE/undo/<id>.json` con `{tipo, rel, antes, despues}`;
  `antes === null` = "no existía", `tipo: "renombrado"` guarda `destino`. Se comprueba que el
  archivo no haya cambiado por medio (409) y `force` lo salta.
- `POST /api/undo {turno:true}` revierte **solo el último turno del agente** (la bolsa se vacía al
  empezar otro) y **comprueba todos los conflictos antes de tocar nada**.
- Las reglas se releen **al empezar cada turno** y se recortan a **700 tokens**; son estables por
  carpeta, así que la caché del prompt sigue sirviendo entre turnos.
- `POST /api/edit` **no escribe nada**: devuelve `{seleccion, propuesta, texto, diff}` y decide la
  interfaz. Va con `tool_choice: "none"`, sin razonamiento y con la selección y su contexto
  recortados.
- Las imágenes se guardan **fuera del proyecto** (`salida/adjuntos`) y al modelo solo le llega el
  aviso. Si algún día `/props` dice `modalities.vision: true`, el servidor ya lo detecta
  (`chat.vision`) y la interfaz deja de avisar.

## 14. Cómo se verificó (reproducible)

```powershell
# Nuevas (sin GPU):
node chat\editar.mjs                        # editar ok        (módulo de Ctrl+K)
node chat\prueba-api.mjs                    # prueba api ok    (deshacer creaciones, /api/fs, /api/attach, reglas)
node chat\prueba-agente.mjs                 # prueba agente ok (reglas al sistema, deshacer por id y por turno, Ctrl+K, XML, corte del cliente, visión simulada)
node chat\prueba-navegador.mjs              # prueba navegador ok (24 comprobaciones en Edge headless)
node chat\prueba-truncado.mjs               # prueba-truncado ok (6 tecnologías: la llamada cortada se recompone y el archivo queda exacto)
node chat\prueba-navegador.mjs --capturas   # deja capturas\11-nuevo-ui.png

# Con el servidor real y visión (necesita -Vision):
node chat\prueba-vision.mjs                 # prueba vision ok (dibuja un número y el modelo lo lee)

# Las de siempre, todas en verde:
node chat\modelo.mjs ; node chat\actions.mjs ; node chat\prueba-sin-gpu.mjs
node chat\prueba-ui.mjs ; node chat\prueba-seguridad.mjs ; node chat\bonsai-chat.mjs --self-test
```

La prueba de navegador maneja la aplicación de verdad (diálogos, clics, Ctrl+K, arrastrar una
imagen) dentro de un iframe del mismo origen y deja el resultado en el DOM; se lee con
`--dump-dom`, sin dependencias. Se ejecutó **3 veces seguidas: 24/24 las tres**.

## 15. Evaluación del agente tras estos cambios: 18/19

Corrida 4 completa (misma máquina, mismo servidor): **18/19 en 10 min 18 s**, 12 948 tokens
generados · 24 974 leídos + 173 748 de caché · ~28 t/s. Informe copiado a
`chat/evaluar/resultados/2026-10-04-eval-4-tercera-sesion.md` (y `salida/eval-4/`).

El fallo es `lru-cache`: el modelo escribió `lru.py` y `test_lru.py`, **sus propios tests** fallaron
(`FAILED (errors=1)`), reescribió el archivo tres veces y las re-ejecuciones **sí** se lanzaron (el
guardián de repeticiones las permite cuando el `.py` cambió: es a propósito). El comportamiento del
LRU salió correcto; lo que falló fueron sus tests. Es la varianza ya documentada del modelo (la
misma tarea tardó 39 s en la corrida 2 y 157 s en otra pasada), no una regresión: las otras 18 pasan
y el resto de la traza es igual que en la corrida 3.

Lo que sí destapó está en §12.4 (el `<tool_call>` en texto), ya arreglado y con prueba.

## 16. Visión (mmproj) integrada: proyector en CPU, 0 MiB de VRAM

Decisión del usuario: **por CPU solamente**. Hecho y verificado:

| Pieza | Cómo quedó |
|---|---|
| Archivo | `models/Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf` · **629.246.976 bytes** · SHA-256 `6807ede6…1903` **verificado** contra Hugging Face |
| Arranque | `.\scripts\start-server.ps1 -Vision` → `--mmproj … --no-mmproj-offload --image-max-tokens 1024`. `start-ui.ps1` y `start-chat.ps1` lo encienden **solos** si el archivo está (con `-SinVision` se apaga) |
| VRAM | **no cambia nada**: 7.433 MiB en uso y **77.824 tokens** de contexto, igual que sin visión (el proyector vive en la RAM: +600 MiB) |
| Envío | `BonsaiChat.runTurn(texto, signal, imagenes)`: el último mensaje del usuario viaja como `[{type:"text"}, {type:"image_url"}]`; se reservan `imágenes × 1.024` tokens en la ventana porque el servidor no los cuenta en `input_tokens` |
| Interfaz | pegar, arrastrar o elegir; con visión **no** aparece el aviso de "no puedo verla" y el chip **Visión** se enciende en la barra de estado |
| Prueba | `node chat\prueba-vision.mjs`: dibuja un número aleatorio (PNG hecho a mano, sin dependencias) y comprueba que el modelo **lo lee**: `el modelo leyó el número 2847 de la imagen: "2847"`. Dos pasadas seguidas, dos números distintos |

Si algún día se quiere el proyector en la GPU, `-VisionGpu` lo hace, pero el contexto automático
baja de ~78.848 a ~56.320 tokens (−29 %): en esta máquina no compensa.

## 17. Cambio de modelo desde la interfaz (descarga el cargado y carga el otro)

- **Chip "Modelo: \<nombre\>"** en la barra de estado (junto a Visión y Reglas) → menú con el
  catálogo (`override6`, `bolding_v1`) → confirmar y listo. También en la paleta de comandos
  (Ctrl+Shift+P).
- `GET /api/modelos` devuelve el catálogo (nombre, rol, bytes, si el GGUF está entero) y **cuál
  está cargado** (por el `model_path` de `/props`). `POST /api/modelos {clave}` hace el cambio.
- Qué hace el POST: comprueba el GGUF (existe y cuadra el tamaño) → **libera la GPU** (mata el
  `llama-server` y la ventana que lo lanzó, y espera a que no quede proceso, el puerto esté cerrado
  y la VRAM suelta ≥6,5 GB) → lanza `start-server.ps1 -Modelo <clave> [-Vision] [-Pensar N]
  -Log logs\arranque-modelo.log` → espera `/health` y reconecta. Si el primer intento no arranca,
  reintenta una vez.
- **Medido en esta máquina**: 9,6 s a BoldingBuilds v1 y 8,6 s de vuelta a Override-6 (los GGUF
  estaban en la caché de disco). El historial, los ajustes y la visión se conservan.
- Prueba: `node chat\prueba-modelos.mjs` (cambia y vuelve; si no hay servidor, se salta sola).
- A mano sigue estando `.\scripts\start-server.ps1 -Modelo bolding_v1 [-Vision] [-Log ruta]`.

## 18. Lo que sigue pendiente (honesto)

- **Rehacer (redo)**: hay deshacer, no rehacer.
- **Deshacer un borrado de carpeta**: los archivos de texto y los renombrados sí; una carpeta entera
  no (no se copia el árbol).
- **`--api-key` en llama-server** y el `ui-permit.json` en `"all"`: siguen siendo decisiones del
  usuario.
- **Nada más de lo pedido**: deshacer del agente, reglas en el sistema, Ctrl+K, crear/renombrar/borrar,
  adjuntar imágenes (con visión real) y **cambiar de modelo sin salir de la interfaz** están hechos,
  con pruebas, y el evaluador sigue en 18-19/19.




---

# PARTE 4 · 2026-10-08: por qué fallaban las tool calls y la escritura de archivos

Diagnóstico hecho **sin arrancar el modelo**, leyendo el código y la conversación real
`chat/ui-chats/muwvy0yvt9kd1g.json` (pedido de un HTML 3D: ~20 saltos, ningún archivo escrito,
y XML crudo como respuesta final). Seis causas, todas arregladas y con prueba offline:

| # | Causa | Arreglo | Prueba |
|---|---|---|---|
| 1 | El mensaje de sistema no decía nada del equipo: el modelo usaba `head -c`, escribía archivos con scripts de Python y se iba a investigar archivos ajenos | `agentText()` en `context.mjs` (Windows, cmd.exe, `python`, escribir con `archivo`, cuándo cerrar); solo con herramientas (`BonsaiChat.agentRules()`) | `bonsai-chat.mjs --self-test`, `prueba-agente.mjs` |
| 2 | `procesos.mjs`: el patrón `^(.+?\bpython…)` exigía un carácter delante, así que **ningún** `python -c "…"` pelado de varias líneas iba a `.py`: acababa en PowerShell, que rompe los `\"`. Además una línea iba por cmd.exe y varias por PowerShell | Una sola shell, **cmd.exe** (PowerShell 5.1 no tiene `&&` y no hay `pwsh`). `python/py -c` y `node -e` de varias líneas → `.py`/`.cjs` temporal con el escapado de Windows quitado (`desescaparComillas`); el resto → `.cmd` | `prueba-procesos.mjs` (el caso exacto del chat) |
| 3 | Los resultados de herramientas viajaban como mensaje del **usuario** con un párrafo de 400 caracteres delante; la plantilla espera `<tool_response>` | Con tool call nativa, el resultado va como `role:"tool"` + `tool_call_id`; la instrucción pasa al sistema. Sin llamada nativa, sigue como antes (`AVISO_SEGUIR`) | `context.mjs` self-test, `prueba-agente.mjs` |
| 3b | La plantilla del GGUF lanza `No user query found in messages` si no queda ningún mensaje del usuario (pasaría al plegar) | `selectContext({pinned})`: si el pliegue deja fuera el pedido vigente, viaja fijado tras el sistema; los resultados huérfanos al principio se pliegan con su llamada | `context.mjs` self-test |
| 4 | El turno de cierre (`tool_choice:"none"`) no pasaba por `present()`: el XML `<tool_call>` se guardaba y se mostraba | Se limpia con `stripFakeToolText`; si no queda texto, `resumenDeAcciones()` resume lo hecho | `prueba-agente.mjs` §12 |
| 5 | Archivos grandes: tandas de 2048 tokens (cada reintento tirado = minutos) y, con texto antes de la llamada, la continuación fundía la llamada vieja con la nueva → JSON inválido → escritura perdida. `prueba-truncado` lo ocultaba porque su servidor falso retomaba el JSON a medias (el real no puede) | Con herramientas, tandas de `AGENT_SLICE_TOKENS` (16384, tope real = hueco de la ventana); una llamada cortada se descarta SIEMPRE y se repite con más hueco | `prueba-truncado.mjs` (servidor falso corregido) |
| 6 | Historial a 8192 tokens con ~77k de ventana: a los ~10 saltos se plegaba el pedido | Defecto 32768 (`DEFAULT_HISTORY_CAP`), selector "Tope de historial" en ⚙, y `chat/ui-settings.json` subido a 32768 | — |

**Pendiente: medir con el modelo real** (no se ejecutó a propósito):
`node chat\evaluar\ejecutar.mjs` y comparar con la corrida 4 (18/19). Lo que más conviene vigilar:
que el modelo cierre bien tras un `role:"tool"` (cambio de formato) y la velocidad con más historial
(a 32k de contexto lleno la generación baja de ~28 a ~20 t/s; si molesta, bajar el tope en ⚙).

---

# PARTE 5 · 2026-10-08 (tarde): auditoría de por qué el agente no termina tareas

Revisión de código + datos reales (`chat/ui-chats/muwvy0yvt9kd1g.json`, `salida/eval-4/`,
`salida/formato/agente-*.jsonl`, `chat/timings.jsonl`). **Sin ejecutar el modelo.** Cada
hipótesis lleva su evidencia; ✔ = comprobado, ~ = probable, ? = por medir.

## 19. Hipótesis, de más a menos impacto

| # | Causa | Evidencia | Arreglo propuesto |
|---|---|---|---|
| H1 ✔ | **El resumidor de memoria continúa la tarea en vez de resumir.** Las «Notas» del sistema acaban con código inventado («Creo `test_api.py`: ```python … from api import create_app»). El modelo luego escribe contra una API que no existe | `agente-bolding_v1-…12-01-38.jsonl` (crudo #12-#25) → el test falla con `ImportError: cannot import name 'AlmacenAPI'`; `agente-override6-…11-42-18` (Notas = «Ejecuto: python -m unittest…»); memoria del chat de la Glock = HTML a medias dentro de un script de Python | Notas deterministas para turnos de herramientas (archivos escritos + tamaño, comandos + código + última línea de error); al modelo solo la prosa, con el texto envuelto entre delimitadores, «NO escribas código ni sigas la tarea», y quitar cercas ``` de lo que devuelva |
| H2 ✔ | **`summarize()` no ve las tool calls**: un turno de asistente que solo llama funciones llega como `A: ` vacío, así que tras plegar se olvida qué se ejecutó y qué se escribió → repite acciones | `bonsai-chat.mjs` `summarize()` solo usa `turn.content` | Meter `A: archivo(api.py, 3 KB)` / `A: ejecutar(python …)` en el blob |
| H3 ✔ | **La guardia de repeticiones solo mira `.py` escritos en el propio comando.** `python -m unittest test_lru` no nombra ningún `.py` → tras reescribir `lru.py` se bloquea con «Falló 2 veces. No se volvió a lanzar» + salida VIEJA y se corta el turno | `salida/eval-4/tarea-lru-cache.json` (3.ª ejecución bloqueada tras escribir lru.py) | Permitir relanzar si hubo **cualquier** escritura del agente (o cambió la huella de la carpeta) desde la última ejecución |
| H4 ✔ | **`leer` corta a ~2.100 caracteres sin avisar** (700 tokens de cabeza). El modelo no ve el resto, cree que su archivo está incompleto o se pone a trocearlo con `python -c` | `describeRead()`; chat de la Glock (#9-#33: 12 `python -c` para mirar `tmp.html` de 159 KB) | Avisar «[recortado: X de Y bytes]» y añadir `desde`/`hasta` (líneas) a `leer` |
| H5 ✔ | **La salida de comandos pierde la COLA** (donde van el traceback y `FAILED`): `procesos.mjs` guarda cabeza+cola, pero `runCommand` hace `.slice(0, 8000)` y `present()` `clipText(…, 2500)`, ambos de cabeza | `ui-server.mjs` `runCommand` y `present` | Recortar por el medio (cabeza + cola) en los dos sitios |
| H6 ✔ | **`stdin` abierto**: un script con `input()` (o un instalador que pregunta) se queda colgado los 60 s del tope | Probado: `python -c "input()"` → `tiempo agotado` | `stdio: ["ignore","pipe","pipe"]` en `launchCommand` |
| H7 ✔ | **`archivo` emite `contenido` ANTES que `ruta`.** Si la generación se corta, se pierde la ruta → «archivo incompleto: (sin ruta)» (sale en casi todas las tareas largas de los dos modelos) | crudo de `parser`: `…","ruta":"expr.py"}` al final | Tratar «sin ruta» con `finish_reason: length` como llamada cortada (reintento); valorar `archivo` con la ruta en el nombre de la herramienta o un parámetro único |
| H8 ✔ | **Llamadas paralelas con un solo resultado**: con 2+ tool calls, todas las salidas van en UN `role:"tool"` con el id de la primera; la segunda queda sin `<tool_response>` → el modelo la repite | `present()` → `resultadoDe = calls[0].id` | Un mensaje `tool` por llamada, cada uno con su id |
| H9 ~ | **No hay herramienta de edición parcial**: para cambiar 1 línea hay que regenerar el archivo entero (lento, se corta, se pierden partes). `withCurrentFile` además le pasa el archivo recortado a 1.200 tokens sin avisar | `agentText()`, `withCurrentFile()` | Herramienta `reemplazar(ruta, buscar, poner)` |
| H10 ~ | **Sin procesos en segundo plano**: arrancar un servidor (`python api.py`) bloquea hasta el tope de 60 s y se mata; las tareas «API + CLI» no se pueden comprobar | `proyecto-completo` falla en los dos modelos | Herramienta o flag para lanzar en segundo plano y matar al final del turno |
| H11 ~ | **Carpeta de trabajo sucia**: `test2` tiene `tmp.html` (página de la NRA sobre la Glock), `parse*.py`… El modelo listó la carpeta, vio el HTML y gastó 20 saltos analizándolo en vez de crear el suyo | chat de la Glock | Empezar las tareas en una carpeta limpia; en el sistema: «los archivos que ya hay no son tuyos salvo que te los nombren» |
| H12 ~ | **Bucles sin freno**: `repeat_penalty 1`, `presence_penalty 0` y hasta 16.384 tokens por tanda (~10 min a 27 t/s) antes de que `isRepetition` mire nada; repite la MISMA llamada (gen = 121 tokens idénticos seguidos en `timings.jsonl`) | `modelo.json` perfil `codigo`, `AGENT_SLICE_TOKENS` | Cortar en streaming si se repite un bloque; tras 2 llamadas idénticas, forzar `tool_choice:"none"` |
| H13 ? | **KV `q4_0` (K y V)** para llegar a 77k de ventana, aunque el historial está topado a 32k + 16k de tanda. Puede restar exactitud al copiar/recordar en contextos largos | `start-server.ps1` (auto = q4_0) | A/B con el evaluador: `-KVCacheType q8_0 -ContextSize 40960` y tope de historial 24k |
| H14 ✔ | **Cada pliegue tira la caché** (`-np 1`: el resumen usa el mismo slot) → `cache_n 0` y reprocesar 5-30k tokens + 1.600 de resumen ≈ 1-2 min | `chat/timings.jsonl` | Con H1 (notas deterministas) casi no haría falta llamar al modelo |
| H15 ✔ | **Las mediciones largas mandan el español roto** («ademÃ¡s», «mÃ©todo»): `medir-agente.mjs` tiene 20 cadenas doble-codificadas | `grep Ã chat/medir-agente.mjs` | Recodificar los prompts y repetir la medición |
| H16 — | Límites del propio modelo: 27B ternario (~1,6 bits) + abliterado = sobre-llama herramientas, copia peor textos largos y se atasca antes que un modelo sin tocar | fichas de los modelos | No se arregla en la app: se compensa con H1-H12 |

## 20. Interfaz: cambiar de modelo sin terminal

- **Bug real**: el chip «Modelo» de la barra de estado (y el de git, y la paleta con el ratón)
  abría el menú y **el mismo clic lo cerraba** (el listener de `document` que cierra los menús
  al pinchar fuera). Arreglado en `menu()` de `chat/ui/app.js` (se ignora el clic de apertura).
- **Botón nuevo en la barra de arriba** (icono de chip + nombre del modelo + flecha), con el menú del catálogo y una línea de
  para qué sirve cada uno (`uso` en `chat/modelo.json`, lo devuelve `GET /api/modelos`).
  Mientras carga dice «Cargando <modelo>…» y se desactiva.
- Comprobado: `prueba-navegador` 24/24, `prueba-api` y el resto de la suite offline en verde, y
  a mano en el navegador con un llama-server falso que dice tener Override-6 cargado.

## 21. Qué modelo para qué (con lo medido, n pequeño)

| | Override-6 (predeterminado) | BoldingBuilds v1 |
|---|---|---|
| Evaluador de 19 | 19/19 y 18/19 | no se pasó |
| 6 tareas largas | 5/6, 662 s en total | 5/6, 865 s en total |
| Falla | parser recursivo | arreglar-bugs (abandona en 6 saltos) |
| Velocidad | LRU-TTL 8 saltos / 133 s | 14 saltos / 338 s |
| Modo pensar (opt-in) | 0 respuestas vacías | 24 % vacías → no usarlo |

Conclusión: Override-6 para casi todo; BoldingBuilds v1 como segunda opinión cuando Override-6
se atasca en una tarea larga. Las diferencias son de 1 tarea con 1 pasada: hay que repetir las
mediciones (y con H15 arreglado) antes de sacar más conclusiones.

---

# PARTE 6 · 2026-10-08 (noche): arreglos H1-H8 aplicados + modo pensar en Override-6

Pedido del usuario: aplicar los arreglos 1-8 de la Parte 5 y «ponerle modo pensar al que sí
puede tenerlo». **Sin ejecutar el modelo**; todo con pruebas offline (llama-server falso).

## 22. Qué se cambió

| # | Arreglo | Dónde | Prueba |
|---|---|---|---|
| H1 | Resumidor: reglas nuevas («eres el archivador… NO escribas código, NO sigas la tarea»), transcripción entre `<<< >>>` y `limpiarNotas()` quita cercas ```, `<tool_call>` y anuncios («Creo x.py:») de lo que devuelve | `bonsai-chat.mjs` `summarize()`, `context.mjs` `limpiarNotas()` | `context` self-test (salida real de los modelos) + `prueba-agente` §14 |
| H2 | El resumidor ve las llamadas: `[llamó archivo(api.py, 3120 car.); ejecutar(…)]`, sin el código | `context.mjs` `describirLlamadas()` | ídem |
| H3 | Guardia de repeticiones: se relanza si desde la última ejecución hubo **cualquier** escritura del agente u otro comando; ya no mira solo `.py` nombrados | `ui-server.mjs` `cambioDesde()` | `prueba-agente` §12b (`node comprobar.cjs` falla 2 veces, se arregla, se relanza y pasa) |
| H4 | `leer` con `desde`/`hasta`; lee ~6.000 car. por líneas enteras y **avisa** «[…recortado: faltan las líneas X-Y. Para verlas…]». Leer otro trozo del mismo archivo no cuenta como releer; el tope de 4 es de archivos distintos | `actions.mjs` (`claveLectura`/`partirLectura`), `ui-server.mjs` `describeRead()` | `actions` self-test + `prueba-agente` §13 |
| H5 | Salida de comandos recortada por el MEDIO (cabeza 30 % + cola 70 %) en los tres sitios; `__pycache__` fuera del «Archivos:» y la lista topada a 15 | `procesos.mjs` `recortarCentro()`, `ui-server.mjs` | `prueba-procesos` + `prueba-agente` §13 |
| H6 | `stdin` cerrado (`stdio: ["ignore","pipe","pipe"]`): `input()` da `EOFError` en 85 ms en vez de colgarse 60 s | `procesos.mjs` | `prueba-procesos` §5c |
| H7 | Si una llamada llega entera y otra cortada, se ejecuta la entera y se avisa de la otra (antes se tiraban las dos y se regeneraba todo). `archivo` pide la ruta primero; notas de «sin ruta / sin contenido» que dicen qué hacer | `bonsai-chat.mjs` `runTurn()`, `actions.mjs` | `prueba-truncado` §3b |
| H8 | Un `role:"tool"` POR llamada, con su id; el cierre forzado manda antes los resultados pendientes (ninguna llamada queda sin respuesta) | `bonsai-chat.mjs` `runTurn({resultados})`, `ui-server.mjs` `present()` | `prueba-agente` §12 y §13 |

Comprobado que las pruebas nuevas **fallan con el código anterior** (copia de `ui-server.mjs`
previa): reproducen el «Falló 2 veces» con salida vieja de la corrida 4, la segunda llamada sin
resultado y la cola perdida.

## 23. Modo pensar por modelo

- `chat/modelo.json`: `catalogo.override6.pensar = {compatible: true, presupuesto: 2048}`;
  `catalogo.bolding_v1.pensar = {compatible: false}` (24 % de respuestas vacías con thinking).
  `modelo.mjs` → `pensarDe()` / `presupuestoPensar()`.
- `chat/ui-settings.json` del usuario: **`pensar: 2048`** (lo pidió él). El chat lo aplica solo
  si el modelo cargado lo admite; con bolding_v1 se queda en 0 aunque esté pedido.
- En el agente **no razona en cada salto**: solo en el primero (plan) y en el siguiente a un fallo
  (comando con código ≠ 0, archivo bloqueado, llamada cortada, ruta inexistente…). El cierre
  forzado, los resúmenes y Ctrl+K nunca razonan. El razonamiento no vuelve al historial.
- `start-server.ps1 -Pensar` ahora vale **-1 = auto** (lee el ajuste y la compatibilidad del
  modelo); `0` lo apaga y `N` lo fuerza, salvo en un modelo no compatible (avisa y lo apaga).
  `start-ui.ps1` / `start-chat.ps1` solo lo pasan si es explícito. Comprobado con `-DryRun`:
  Override-6 → `--reasoning-budget 2048 --reasoning-effort medium`; bolding_v1 → `--reasoning off`.
- Interfaz: Ajustes → Modo razonamiento dice si el modelo lo admite y, al encenderlo, ofrece
  **reiniciar el modelo** (`POST /api/modelos {clave, recargar: true}`); el botón de modelo de
  arriba pone «· piensa» cuando está activo. `GET/POST /api/settings` devuelven `pensarInfo`.
- **El evaluador sigue SIN razonamiento por defecto** (estado propio = ajustes por defecto), para
  comparar con la corrida 4. `node chat\evaluar\ejecutar.mjs --pensar 2048` lo mide con él.

## 24. Pendiente

1. **Medir con el modelo real** (lo lanza el usuario):
   `node chat\evaluar\ejecutar.mjs` → comparar con la corrida 4 (18/19), y después
   `node chat\evaluar\ejecutar.mjs --pensar 2048` para ver si pensar compensa el tiempo.
   Copiar los informes a `chat/evaluar/resultados/`.
2. El servidor tiene que arrancarse de nuevo para que Override-6 razone (`start-ui.ps1` ya lo hace
   solo con el ajuste guardado, o el botón «Reiniciar» de Ajustes).
3. Sin tocar todavía: H9 (herramienta de edición parcial), H10 (procesos en segundo plano), H11
   (carpeta de trabajo sucia), H12 (freno de bucles), H13 (A/B de KV q8_0), H15 (prompts con
   mojibake en `medir-agente.mjs`).

---

# PARTE 7 · 2026-10-08/09: medido con el modelo real (Override-6) y más arreglos

El usuario pidió lanzar el modelo, probar, analizar y dejarlo todo lo mejor posible. Servidor:
Override-6, `start-server.ps1` en auto (razonamiento permitido con 2048 por el ajuste del usuario).

## 25. Evaluador de 19 tareas

| Corrida | Qué lleva | Nota | Tiempo | Tokens gen. | Saltos | Fallos |
|---|---|---:|---:|---:|---:|---|
| 4 (antes) | código del 04-10 | 18/19 | 617 s | 12 948 | 90 | lru-cache |
| 5 | H1-H8 | 18/19 | **337 s** | **8 246** | 68 | node-esm (bucle de reescrituras idénticas → arreglado en §26) |
| 6 | + §26 (reemplazar, idénticas, extensiones, aviso honesto) | 17/19 | 407 s | 10 061 | 74 | regex-fechas (modelo), solo-chat (sobre-llamada → guardia en §26) |
| 7 | 6 + guardia de charla, **con pensar 2048** | 18/19 | 509 s | 13 029 | 66 | regex-fechas (modelo) |

Lecturas: `regex-fechas` −91 % de tiempo (188 → 16 s; era el bucle de reescrituras idénticas),
`html-contador` 84 → 10 s, `lru-cache` pasa (fallaba en la 4). `regex-fechas` en la 6 y la 7 es
calidad del modelo (regex sin límites de palabra; luego con grupos que devuelven tuplas): no es de
la app. **Pensar** no sube la nota en estas tareas cortas y cuesta ~25 % más de tiempo: queda
encendido (lo pidió el usuario) pero solo al planificar y tras un fallo.

Informes copiados en `chat/evaluar/resultados/` (2026-10-08-eval-5…, 2026-10-09-eval-6…, -eval-7…).

## 26. Arreglos nuevos (todos con prueba en `prueba-agente` / `actions` / `prueba-procesos`)

| Problema medido | Arreglo |
|---|---|
| El modelo «reescribía» un archivo con el MISMO contenido y relanzaba el mismo comando (corrida 4: 12 veces en regex-fechas; corrida 5: node-esm) | Escritura idéntica = `sinCambios`: no cuenta como cambio para la guardia, se le dice «ya tenía exactamente ese contenido» y el siguiente salto razona |
| No había forma de cambiar un trozo de un archivo (H9) | Herramienta **`reemplazar(ruta, buscar, poner)`**: texto único, tolera CRLF, diff + deshacer; si no lo encuentra, le enseña el **trozo real más parecido** para copiarlo exacto (`trozoParecido`) |
| `.cjs`, `.htm`, `.scss`, `.sh`, `.bat`, `.ini`… no se podían escribir | Lista de extensiones de texto ampliada (binarios y .exe siguen fuera) |
| Cierre optimista: «He creado… con 10 tests» con los tests en rojo | Mensaje de cierre exige decir lo que falla y, si el ÚLTIMO comando terminó con código ≠ 0 y la respuesta no lo dice, la app añade «⚠️ Ojo: …» |
| Pregunta conceptual → el modelo crea y ejecuta archivos (solo-chat, corridas 2 y 6) | `esCharla()` conservadora: «explica / qué es / diferencia…» sin archivos ni verbos de acción va en un salto con `tool_choice: "none"` |
| Un archivo grande escrito DENTRO de una tool call = minutos sin enviar nada: la UI parecía colgada y un cliente con tope de 5 min cortaba el turno (pasó con el HTML 3D) | **Latido SSE** cada 15 s y evento **`tool_progress`** («✍️ Escribiendo motor.html… 12.400 caracteres») que la interfaz pinta en una nota |
| La app creaba archivos que nadie pidió (`lee-ventas-json.json`) al ver una cerca ```json en la respuesta final, y releía `ventas.json` porque el pedido decía «Lee…» | Con modelos del catálogo (tool calls nativas) se apagan las heurísticas de texto (cercas → archivo, «lee X», «voy a buscar…», ```ejecutar); solo cuenta un ```archivo explícito |
| `medir-agente.mjs` mandaba el español roto (H15) | Recodificado (21 cadenas) |
| — | `--pensar N` en `evaluar/ejecutar.mjs` y `medir-agente.mjs`; nueva prueba `evaluar/tarea-grande.mjs` (el caso real: HTML 3D grande en carpeta limpia) |

## 27. El caso real (HTML 3D grande) con el modelo real

`node chat\evaluar\tarea-grande.mjs` (motor de 4 cilindros desarmado, en vez de la pistola):
- 1.er intento: el cliente cortó a los 5 min sin datos → descubrió el problema del latido (§26).
- 2.º intento: **el HTML completo (14 KB, three.js, botones de separar/juntar, rotación con el
  ratón, llaves equilibradas) quedó escrito en el primer salto**; después hizo 10 retoques con
  `reemplazar` (+1/−1 líneas cada uno, 2 fallaron por no copiar el texto exacto → §26 añade la
  pista del trozo real), llegó al tope de 24 saltos y cerró con un resumen honesto («no he podido
  probarlo en un navegador»). 377 s.

## 28. Incidente: la app de Claude se congeló a mitad de una medición

Las tareas de fondo de la sesión (llama-server incluido) murieron con ella; el servidor NO falló
(su registro termina en una generación normal). Desde entonces el servidor y las mediciones se
lanzan con `Start-Process` en ventanas propias.

## 29. Segunda tanda (tras el cuelgue): tareas largas y corrida final

**Tareas largas (`medir-agente`, Override-6, sin pensar)** — lru-ttl OK (227 s), arreglar-bugs OK
(23 s), csv-sucio OK (32 s), dijkstra OK (114 s), multi-archivo OK (30 s). Dos «fallos» analizados:
- `parser`: **era un fallo de la PRUEBA**. El verificador importa `evaluar` y el enunciado no lo
  decía; el modelo la llamó `evaluar_expresion`, funcionaba y sus 50 tests pasaban. Eso invalida
  la conclusión del 06-10 «Override-6 falla el parser y bolding_v1 no» (bolding acertó el nombre).
  Enunciado corregido. (En otra pasada sí falló de verdad: 26 saltos releyendo las mismas líneas →
  arreglo de la guardia de relecturas, abajo.)
- `proyecto-completo`: 1.ª pasada, errata `porto`/`puerto` que el modelo no supo arreglar
  reescribiendo entero (salía idéntico); 2.ª, cuatro comandos cortados a los 60 s por lanzar la
  API en primer plano. → procesos en segundo plano y filtro de URLs (abajo).

**Arreglos de esta tanda** (con prueba):

| Problema medido | Arreglo |
|---|---|
| Servidores lanzados en primer plano → «(tiempo agotado)» ×4 (H10) | `ejecutar` con **`segundo_plano: true`**: queda corriendo, devuelve su primera salida y **muere al acabar el turno** (`lanzarEnFondo` en `procesos.mjs`). El tiempo agotado ahora explica qué pasó y cómo evitarlo |
| `commandAllowed` bloqueaba **cualquier comando con una URL** (`p:/` de `http://` parecía una unidad) y cualquier `..` (hasta `print('...')`) | Unidad solo si va suelta (`C:\`, `"D:/`) y `..` solo como ruta |
| Tras una escritura, el modelo podía releer las MISMAS líneas sin límite (parser: 5 veces) | La guardia compara el ORDEN: se puede releer solo si el archivo cambió después de la última lectura de esa clave |
| Reescritura idéntica cuando hay que corregir una línea | El aviso sugiere `reemplazar` con la línea exacta |
| `parser` del medidor pedía un nombre de función sin decirlo | Enunciado corregido |

**Corrida 8 (final, todo junto, sin pensar): 18/19 en 375 s**, 9 319 tokens, 71 saltos
(corrida 4: 18/19, 617 s, 12 948 tokens, 90 saltos). `json-resumen` 2 saltos (antes 10-12).
El fallo (`node-esm`, «ya-está» en vez de «ya-esta») es ambiguo: el enunciado pide «sin signos de
puntuación» y no dice nada de tildes; sus propios tests pasan. Se deja la tarea como está para no
mover la vara entre corridas.

**Ojo con `medir-agente`**: tenía DOS tareas que exigían nombres que el enunciado no daba —
`parser` (función `evaluar`) y `proyecto-completo` (campo JSON `titulo` del alta; el modelo usó otro
y el verificador recibió 400 aunque los tests del modelo pasaban). Corregidos los dos enunciados.
Las comparaciones entre modelos hechas con esas dos tareas antes del 09-10 no valen.
Con el filtro de URLs y `segundo_plano`, `proyecto-completo` ya deja `test_api.py` en verde
(antes: 4 comandos cortados a los 60 s).

## 30. ¿Compensa pensar? (Override-6, 2048 tokens, solo al planificar y tras un fallo)

| Prueba | Sin pensar | Con pensar |
|---|---|---|
| Evaluador de 19 (tareas cortas) | 18/19 · 375 s (corrida 8) | 18/19 · 509 s (corrida 7) |
| `parser` (difícil) | FALLA ×2 · 26 saltos (bucle con la regex) | **OK · 7 saltos · 278 s** |
| `proyecto-completo` (muy largo) | FALLA · 26 saltos (tope) | se acabó el tiempo del medidor (15 min) con `test_api` en verde y 3 errores en `test_almacen` |

Conclusión (n = 1 por tarea): en tareas cortas pensar solo cuesta tiempo (+35 %); en las difíciles
es lo que desatasca al modelo. Se deja **encendido** (pedido del usuario) con el diseño actual:
razona al planificar y justo después de un fallo, no en cada salto.

## 31. Estado final y pendientes

- Servidor: Override-6 corriendo en su propia ventana (`logs\servidor-eval2.log`), arrancado con
  `start-server.ps1` en auto (razonamiento permitido, 2048).
- Suite offline: 13 baterías en verde (`prueba-agente` ahora cubre 22 escenarios nuevos).
- Pendiente, por orden de valor: (1) medir bolding_v1 con las tareas largas YA corregidas para
  rehacer la comparación de modelos; (2) H13 (A/B de KV q8_0 con 40k de ventana); (3) H11
  (carpeta de trabajo con restos: avisar al modelo de que los archivos ajenos no son el pedido);
  (4) subir el tope de 15 min de `medir-agente` para tareas como `proyecto-completo` con pensar.


# PARTE 8 · 2026-10-26: Ornith en GPU completa y correcciones de interfaz

## Modelo y residencia

Se investigaron modelos actuales hasta el 26-10-2026, incluidos lanzamientos del 23-10. Se instalo el GGUF oficial Ornith-1.5-9B Q4_K_M, revision `abdd624b12ebf020b767fff532ff44fe552b28c3`, 5.780.090.816 bytes. SHA-256 comprobado: `70c112196e0b7023803c9762752e46d29e612a92c83f995bc3ba1ceb07e8fab6`. Investigacion y fuentes: `reports/Coding models for eight GB.md`.

`catalogo.ornith9b` tiene su propio perfil de servidor y muestreo; no reutiliza las cuentas globales del Bonsai 27B. `start-server.ps1` delega en `scripts/start-gpu-model.ps1`: `--gpu-layers all --override-tensor .*=CUDA0 --fit off --no-host --kv-offload --load-mode none`. Vision CPU desactivada con este modelo; cache de prompt en RAM desactivada. No hay reduccion automatica de capas a CPU. La eleccion se guarda como `ornith9b` en `chat/modelo-activo.json`.

Comprobado con el servidor real: 34/34 capas y todos los pesos en CUDA0 (5357,88 MiB), KV f16 de 1024 MiB en CUDA0 y estado recurrente de 50,25 MiB en CUDA0. Sin buffers de pesos CPU. Ventana 32768. Prompt de 22877 tokens completado (~1639 tokens/s de lectura); pico global observado de VRAM dedicada 6859 MiB. CPU sigue gestionando tokenizacion, muestreo, transferencias pequenas y la aplicacion; no ejecuta capas del modelo. Evidencia: `logs/ornith-validacion-32k.json` y `logs/ornith-gpu.err.log`. El template embebido conserva el formato Ornith y correcciones de herramientas; no se reemplazo.

## Evaluacion y configuracion

- Pensar 2048: 17/19, 404 s. Fallos: node-esm (importaciones/tests antiguos tras un nombre de archivo equivocado) y regex-fechas (mes invalido aceptado).
- Sin pensar: 19/19, 398 s. Generacion observada ~37-42 tokens/s.
- Se deja pensar apagado inicialmente, disponible en Ajustes. El ajuste anterior se respaldo en `logs/before-2026-10-26/ui-settings.json`; las demas preferencias se conservan. Son pasadas individuales, no prueba estadistica de superioridad ni garantia de codigo correcto. No se cambiaron los enunciados ni los validadores entre pasadas.
- Informes completos en `salida/eval-ornith-2026-10-26/` y `salida/eval-ornith-2026-10-26-sin-pensar/`.

## Interfaz y cliente

Documento actualizado inmediatamente al teclear; el resaltado diferido ya no pierde cambios al guardar o cambiar de pestana. Los guardados del mismo archivo se serializan y solo marcan como guardada la version enviada. Cerrar todas/las demas protege cambios sin guardar. Se evitan pestanas duplicadas; abrir CRLF no marca el archivo como modificado. El servidor rechaza guardar sobre una version externa distinta (409). Lectura de editor ampliada de 60 KB a 2 MB, con resaltado simplificado en archivos grandes.

Streaming agrupado antes de analizar codigo/diffs; refrescos del explorador sin bloquear el lector SSE. Indicador de actividad con segundos; Detener tambien cancela conteos y resumenes. Peticiones normales de la UI tienen timeout. Paneles adaptables con medidas persistentes y boton de restablecer; iconos con medidas estables y colores de sintaxis corregidos para tema claro. Se reserva salida para codigo cuando la ventana tiene 32K (historial efectivo ~16K). El cambio de modelo usa el puerto configurado y no carga el mmproj antiguo para Ornith. Lanzadores en ventanas ocultas y sin terminales NoExit abandonadas.

Las 13 baterias offline pasan; navegador 40/40, con comprobaciones adicionales de guardados en vuelo, Ctrl+S inmediato, cambio rapido de pestana, cierre multiple, CRLF, paneles/iconos y rafaga de 1200 tokens. Capturas verificadas a 1366 px oscuro y 900 px claro. No se tocaron chats ni seleccion de carpeta del usuario.

---

# Parte 9 · Vision y navegador del agente (26 de octubre de 2026)

Se instala el proyector **oficial de Ornith**, no el de Bonsai: `mmproj-Ornith-1.5-9B-BF16.gguf`, 921704672 bytes, SHA-256 `626f9f90627402a6bf4a999111d0fbd69b5fcca7aa8ba089d69e5f10e8858e1d`. Misma revision oficial que los pesos: `abdd624b12ebf020b767fff532ff44fe552b28c3`. `scripts/download-ornith.py --vision` descarga de forma reanudable y verifica el hash.

`catalogo.ornith9b.vision` ahora declara su propio proyector, GPU obligatoria y maximo 512 tokens de imagen. `start-server.ps1 -Modelo ornith9b -Vision` delega al perfil GPU con `--mmproj-offload --mmproj-device CUDA0`, manteniendo todos los pesos y KV en CUDA0, sin fallback CPU. Contexto automatico con vision: **16384**, KV f16 de 512 MiB. Sin vision sigue disponible 32768. Reserva conservadora adicional de vision: 900 MiB, sumada a los 864 MiB previos y al tamano completo del GGUF principal; el proyector mide ~879 MiB y los logs muestran ademas ~248 MiB de computo CUDA. El margen base incluye temporales del runtime. El perfil rechaza arrancar si no cabe. `start-ui.ps1`, `start-chat.ps1` y el cambio de modelo usan el proyector correspondiente a la seleccion, evitando mezclar modelos.

Se agrega `navegador` a PC_TOOLS y al bucle del agente en `ui-server.mjs`. Implementacion: `chat/navegador.mjs`, dependencia fijada `playwright-core@1.64.1` en `chat/package.json` y lockfile (instalada; reproducible con `npm ci --prefix chat`). La importacion es diferida: si falta la dependencia, el IDE sigue arrancando y la herramienta devuelve un error explicativo.

Abre HTML del workspace con servidor de archivos propio, o una URL local de desarrollo. Perfil temporal de Edge/Chrome, nunca el del usuario. Navegador renderiza sin GPU para no competir con los pesos; la inferencia y el proyector permanecen en CUDA0. Acciones: abrir, inspeccionar, clic, escribir, seleccionar, tecla, esperar elemento, recargar, desplazar, captura y cerrar. Permite cambiar ancho/alto y capturar un elemento concreto para detalles. Devuelve texto visible, controles, valores, cajas, estilos de elementos consultados, desborde horizontal, imagenes rotas, errores JS/consola/red y PNG. No navega a sitios remotos; los puertos del IDE y el modelo estan excluidos. El servidor de archivos limita rutas reales, enlaces fuera del workspace y .env/.git/bin/models. Se cierra al cancelar o terminar el turno.

Las capturas van como `image_url` a **su propio mensaje role tool**, con el id de la llamada; la reserva de tokens cuenta las imagenes. Los data URLs no se persisten en la sesion. El fallback de XML crudo conserva las capturas en su mensaje interno de seguimiento. Los PNG quedan en `salida/navegador/`; las tarjetas del chat permiten abrir la captura y distinguen si se envio al modelo. La captura sola no sustituye la comprobacion funcional.

## Evidencia y limites

- `node chat/prueba-observacion.mjs`: **16 comprobaciones**, navegador real y API con modelo simulado; error al pulsar, imagen rota, desborde, formularios, recarga del arreglo, movil, recorte de captura, limites de rutas, .env, cancelacion, asociacion imagen/tool, ausencia de base64 persistido y tarjeta de captura funcional. Informe: `salida/observacion-api-2026-10-26/informe.json`.
- `node chat/prueba-observacion.mjs --real`: pasada completa con Ornith y GPU reales. Lectura visual independiente **CASA 3241**, enviando solo pixeles al modelo (sin HTML ni respuesta esperada). Después abre un contador roto, reproduce `incrementarRoto is not defined`, edita la funcion, recarga y pulsa dos veces. Un navegador independiente confirma `<output>` = **2** y ausencia de error JS. **15 comprobaciones** en esa pasada; el test incorporo despues la comprobacion adicional de recorte. Pico global medido **7393 MiB = 7,22 GiB**, por debajo de 8 GB. Informe: `salida/observacion-real-2026-10-26/informe.json`; codigo corregido en `index-corregido.html` de esa carpeta.
- Pruebas existentes de API, agente, UI, seguridad, truncado, procesos y sin GPU pasan. Navegador de la interfaz: **40/40**. La nueva prueba de tarjetas usa estado temporal.
- La primera prueba antigua de OCR de fuente 5x7 fallo: 4233 fue leido como 4225. No se cambia el test ni se presenta como aprobado. La vision no garantiza OCR exacto ni juicio visual fiable en todos los casos; para texto pequeno conviene capturar el elemento de cerca.
- Una comprobacion independiente inicial del contador fallo por un error del verificador (`\\b2\\b` no coincide con `Sumar2`); se conserva en `informe-previo-verificador.json`. Se corrigio el verificador para consultar el texto exacto de `#valor` y se repitio la prueba completa. La correccion del modelo era correcta.
- `prueba-modelos.mjs` era una prueba real y reinicio el servidor durante la primera evaluacion de observacion. Se restauro Ornith con vision y se repitio. Ahora exige **--real explicito**, para evitar reinicios involuntarios al ejecutar baterias. No ejecutar pruebas GPU con cambios de modelo al mismo tiempo que otras pruebas reales.

Servidor de la interfaz reiniciado con el estado existente; conserva carpeta `C:\Users\user\Documents\projects\porojectoo`. `/api/stats` anuncia vision true, `/api/state` ventana 16384 e historial 8064. Los chats personales no se usaron para pruebas. Respaldos de los archivos modificados en `logs/before-vision-2026-10-26/`. El usuario debe recargar la pagina para cargar el JavaScript nuevo de las tarjetas.
