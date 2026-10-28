# 04 · Brechas de producto: ¿puede el Bonsai Local IDE usarse para codear apps a diario?

**Viabilidad 2026-10-27 · compañero `brechas-producto` (equipo task-4)**
Proyecto: `C:\Users\user\Documents\prject_local_AI` · Bonsai Local IDE (Windows 11, RTX 4060 8 GB)

> **Veredicto corto:** no es un juguete, pero tampoco es todavía "tu IDE". Es un **prototipo
> avanzado con ingeniería seria** (34 suites, guardado atómico, undo, agente fiable en tareas
> pequeñas) que **hoy sirve para construir apps pequeñas y medianas** desde el chat, pero al que
> le faltan las piezas que convierten un editor en una herramienta diaria: **autocompletado
> inline/FIM, LSP/diagnósticos, terminal integrado, test runner y empaquetado**. Para uso personal
> serio: **~3-5 semanas de trabajo P0/P1**; para llevarlo a otra máquina sin dolor: **+1-2 semanas**;
> para producto distribuible: **+2-3 meses**.

---

## 0. Alcance, método y límites de este informe

Todo lo que sigue sale de leer el árbol de trabajo (no de la documentación sola: hay documentación
desactualizada, ver §6.2). Herramientas: `read`/`grep`/`glob` sobre el código, `git status/log/diff`,
`du`, `wc`, `node scripts/run-tests.mjs --listar`, y las corridas de evaluación ya registradas en
`salida/`.

**No he hecho** (por disciplina de equipo): arrancar la GPU ni el modelo (los ocupa otro
compañero), ejecutar `npm test` (no interferir con la evaluación en curso) ni tocar código. Las
cifras de suites y evaluaciones que cito son las **registradas en este repo**, no medidas por mí.
Único archivo escrito: este.

---

## 1. Mapa de capacidades actuales

El código es un servidor Node propio (~3 350 líneas `chat/ui-server.mjs`, ~1 436 `chat/bonsai-chat.mjs`,
~1 302 `chat/actions.mjs`, ~951 `chat/context.mjs`, UI vanilla ~3 860 líneas JS) con **cero
dependencias npm en la raíz** y **una sola en `chat/`** (`playwright-core` para el navegador del
agente, importada de forma perezosa: `chat/navegador.mjs:61-62`). No hay bundler ni build: la UI se
sirve tal cual.

### 1.1 · Existe y está probado (lo que ya funciona)

| Área | Capacidad real | Evidencia |
|---|---|---|
| Chat/agente | Streaming SSE con latido cada 15 s, cancelación, turnos en cola, historial persistente atómico con `.bak` y recuperación de corruptos | `chat/ui-server.mjs:2381-3300`; `chat/sse.mjs`; `chat/historial.mjs`; `chat/bonsai-chat.mjs:544+` |
| Herramientas del agente | 7 herramientas nativas: `navegador`, `ejecutar`, `buscar` (web), `leer`, `indice`, `reemplazar`, `archivo`. Tool calls nativas + fallback por texto para modelos sin soporte | `chat/actions.mjs:300-393`; `chat/adaptadores.mjs` |
| Bucle del agente | Hasta **96 pasos por turno** en tandas de 4×`agente.saltos` (24 para Ornith = tandas de 24), detección de atasco por falta de progreso, estados de cierre honestos (`completed/step_limit/stalled/cancelled/error`), deduplicación de lecturas y de comandos ya ejecutados | `chat/ui-server.mjs:3143-3230, 2921-3060`; `chat/prueba-agente-limites.mjs`; `chat/prueba-agente.mjs` (702 líneas) |
| Escritura de archivos | `archivo` (reemplazo completo) y `reemplazar` (texto exacto único, con pista del trozo más parecido si falla), diff por tarjeta, **punto de deshacer por escritura** y "revertir el turno" | `chat/actions.mjs:382-392, 648-660`; `chat/ui-server.mjs:57-108, 1872-1918` |
| Editor | Pestañas reales, Ctrl+S, recarga automática si el agente reescribe, Ctrl+K con **diff y Aceptar/Rechazar**, guardado atómico con **precondición 409** (no pisa cambios ajenos), deshacer por escritura, límite 2 MB, CRLF/LF conservados | `chat/ui/app.js:306-500, 1511-1760`; `chat/editar.mjs:1-60`; `chat/ui-server.mjs:1796-1876, 2010-2102` |
| Navegación de proyecto | Quick open Ctrl+P, comandos Ctrl+Shift+P, búsqueda de texto Ctrl+Shift+F con límites (>800 KB salta), operaciones de archivo nuevas/renombrar/borrar con undo | `chat/ui/app.js:680-700, 841+`; `chat/ui-server.mjs:1401-1470, 1918-2008` |
| Contexto | Reglas de proyecto `BONSAI.md`, `AGENTS.md`, `.cursorrules`, `.cursor/rules/*.mdc` (700 tokens máx), plegado de historial con notas deterministas (2 000 tokens), presupuesto de contexto honesto (ventana, solicitado, efectivo, reserva) en `/api/state` y barra inferior | `chat/context.mjs:10-140`; `chat/ui-server.mjs:1489-1545`; `chat/ui/index.html:655-662` |
| Modelo | Catálogo con SHA-256, cambio de modelo en caliente con **recuperación del anterior si falla**, visión si está el `mmproj`, razonamiento opt-in, perfil automático de contexto/KV en `logs/perfil-servidor-<puerto>.json` | `chat/modelo.json`; `chat/modelo.mjs`; `chat/cambio-modelo.mjs`; `/api/modelos` en `chat/ui-server.mjs:2204-2290` |
| Navegador del agente | Edge/Chrome headless con perfil efímero, **solo orígenes locales**, consola/errores de red, capturas, controles con selector, cierre al acabar el turno | `chat/navegador.mjs`; `chat/SEGURIDAD-NAVEGADOR.md` |
| Visión/OCR | Imágenes como adjuntos, capturas al modelo si hay visión, OCR local vía WinRT (sin red) | `chat/ui-server.mjs:2406-2460`; `chat/ocr.mjs`; `scripts/ocr-winrt.ps1` |
| Git | Estado + rama + último commit y **commit por archivos elegidos** (no `git add .`) con guardas de rutas | `chat/git-seguro.mjs`; `chat/ui-server.mjs:2149-2204`; `chat/ui/app.js:893-980` |
| Seguridad | Confinamiento de rutas, carpetas protegidas (`bin/models/.git/node_modules/logs`), escritura atómica, guardia anti-CSRF/DNS-rebinding, `commandAllowed` (bloquea rutas absolutas, `..`, del/rm/move/ren/format/reg delete), navegador solo local | `chat/archivos-seguros.mjs`; `chat/guardia.mjs`; `chat/actions.mjs:807-818` |
| API OpenAI-compatible | `llama-server` en `:8080/v1` y lanzadores para **Cursor** (túnel Cloudflare) y **Aider** (con git propio) | `scripts/start-cursor-bridge.ps1`; `scripts/start-aider.ps1`; `INTEGRACION-MODELO.md` |
| Pruebas | **26 suites aisladas + 3 de navegador + 5 de GPU**; `npm test` no necesita GPU (llama-server simulado en puertos libres, estado en `os.tmpdir()`); evaluador de 19 tareas; banco de tareas largas | `scripts/run-tests.mjs`; `chat/evaluar/`; `chat/medir-agente.mjs` |
| Evidencia de uso real | Evaluador **19/19 con el modelo actual sin pensar** (6 min 38 s, 40 t/s); corrida global registrada **26/26 + 3/3 en verde** | `salida/eval-ornith-2026-10-26-sin-pensar/informe.md:1-3`; `INFORME-SOLUCION-2026-10-27.md` §1 |

### 1.2 · Existe pero es limitado (no confundir con "hecho")

| Área | Límite real |
|---|---|
| Autocompletado | **No existe** ni FIM ni ghost text ni tab. El editor es un `<textarea>` transparente encima de una capa HTML resaltada (`chat/ui/app.js:325-336, 468`). "ghost" en el CSS son botones fantasma, no sugerencias. |
| LSP/diagnósticos | **No existe** cliente LSP, ni panel de problemas, ni ir a definición, ni outline de símbolos. Solo resaltado léxico propio hecho a mano (js/py/html/css/json y familia C: `chat/ui/markdown.js:22-71`). |
| Terminal | **No hay panel de terminal** en la UI (`chat/ui/index.html:576-687`). Solo el agente puede `ejecutar`, con tope de **60 s** (`chat/procesos.mjs:25`), sin stdin, salida recortada (cabeza+cola ~1 600/3 000 car.) y procesos en segundo plano **que mueren al final del turno** (`chat/procesos.mjs:237+`; `chat/ui-server.mjs:2987-3000`). |
| Búsqueda de código | La UI tiene búsqueda de texto (`/api/search`), pero el **agente no tiene** herramienta de búsqueda en el proyecto: `buscar` es búsqueda web (scraping de DuckDuckGo, `chat/ui-server.mjs:782-800`). Para mirar código usa `leer`/`indice` o `findstr` vía `ejecutar`. |
| Procesos de proyecto | Servidores y watch-modes se matan al cerrar el turno. Builds/instalaciones >60 s se cortan. |
| Cambio de modelo | El selector funciona, pero **solo `ornith9b` tiene perfil `gpu-completa`**; `override6`/`bolding_v1` están marcados "historico (CPU)" y el servidor se niega (`chat/modelo.json:20-90`; `scripts/start-server.ps1:126-128`). GGUFs sueltos en `models/` fuera del catálogo no arrancan. No hay descarga desde la UI (script Python manual, pinneado por SHA). |
| Contexto profundo | Sin embeddings, sin índice semántico, sin repo-map automático: el modelo ve reglas (700 tok) + notas (2 000 tok) + lo que pida con `leer`/`indice`. Ventana efectiva 32 768 tokens con visión. |
| Agente multarchivo largo | 96 pasos/turno y sin plan persistente ni "continúa hasta terminar" entre turnos. El propio banco extremo a extremo (`proyecto-completo`: 5 archivos, API+CLI+tests) falló o agotó el tope en las corridas documentadas (`AUDITORIA-HANDOFF.md` §25/§30). |
| Escrituras del agente | Se **auto-aplican**; la tarjeta muestra el diff y un botón Deshacer, pero no hay "Aceptar/Rechazar" previo (solo Ctrl+K lo tiene). Sin staging ni preview antes de escribir. |
| Git | Solo commit de archivos elegidos. Sin push/pull/branch/merge, sin diff por hunk, sin stash. El agente puede usar `git` por comandos, pero no hay herramienta ni vista de diff histórica. |
| Borrar/mover/renombrar (agente) | No hay herramientas; `commandAllowed` bloquea `del/rm/move/ren` (`chat/actions.mjs:807-818`). La UI sí lo permite (`/api/fs`). Esto ya hizo fallar una tarea del propio evaluador (`node-esm`, intentó `move`; ver `salida/eval-ornith-2026-10-26/informe.md:17,28-31`). |
| Sin GPU / GPU pequeña | Se niega a cargar sin GPU completa: "No se usa CPU como respaldo" (`scripts/start-gpu-model.ps1:140-164`; README:38-39). La UI **no arranca** si el modelo no responde (`chat/ui-server.mjs:1065 await chat.connect()`): no hay modo "solo editor". |
| Red/multiusuario | Bind 127.0.0.1 por defecto; existe `--host` con guardia anti-CSRF/DNS (`chat/guardia.mjs`), pero **sin autenticación**, con un único turno global (`busy`) y estado local por máquina. Con permiso "Ejecutar todo" (`chat/ui-permit.json` está en `"mode":"all"`), cualquiera que llegue a la UI puede correr comandos. El túnel Cloudflare del lanzador de Cursor expone el `/v1` del modelo a Internet (`scripts/start-cursor-bridge.ps1`; `URL-CURSOR.txt`). |
| Instalación/actualización | No hay instalador, updater, versión ni firma. `bin/` (1,2 GB) y `models/` (29 GB) **no están versionados**. El árbol actual son **30 archivos modificados + 36 sin seguimiento**, y `HEAD` no reproduce el estado actual (ver §3). |

---

## 2. Tabla de brechas (ordenada por impacto en un flujo real de apps)

Leyenda: **¿Bloquea?** → *Sí* = impide trabajar en serio; *Parcial* = se puede con workaround incómodo; *No* = mejora.
**Trabajo** = días-persona de 1 dev que ya conoce el código, sin contar tuning de VRAM ni pruebas en máquinas ajenas.

| # | Brecha | Estado actual (evidencia) | ¿Bloquea? | Workaround hoy | Trabajo | Prioridad |
|---|---|---|---|---|---|---|
| **B1** | Autocompletado inline / FIM / tab | No existe. Editor = textarea resaltado (`chat/ui/app.js:325-336`) | **Parcial** (para "codear con IA a diario", sí) | Escribir a mano + chat; usar Cursor/Aider contra `:8080/v1` (`scripts/start-cursor-bridge.ps1`, `start-aider.ps1`) | 8-15 d (+ VRAM: 9B ocupa ~6,6 GB; haría falta modelo FIM pequeño ~1 GB o recargar) | P1 |
| **B2** | LSP, diagnósticos, ir a definición, outline | No existe (sin cliente LSP ni panel de problemas en `chat/ui/`) | **Sí** para apps serias | Ejecutar linter/tsc por el agente o en consola externa y leer la salida | 15-30 d con editor nuevo; 5-10 d solo con panel de "problemas" (lint/tests parseados) | P2 (panel: P1) |
| **B3** | Terminal integrado y comandos/builds largos | No hay terminal. `ejecutar` corta a 60 s y mata servidores al final del turno (`chat/procesos.mjs:25,237`; `chat/ui-server.mjs:3014`) | **Parcial** (instala/compila poco: sí bloquea) | Consola PowerShell externa; `segundo_plano` dentro del turno | 5-10 d (PTY + panel + streaming) | P0 |
| **B4** | Contexto/RAG del proyecto | Reglas + notas + lectura bajo demanda; ventana 32k; sin embeddings/repo-map (`chat/context.mjs:108-116`) | **Parcial** (apps >20-30 archivos) | Sesiones cortas, `BONSAI.md` con arquitectura, trocear tareas | 1-2 d búsqueda de código para el agente; 10-20 d índice semántico | P1 |
| **B5** | Agente multarchivo de largo recorrido | 96 pasos/turno, sin plan persistente ni reanudación; atasco se declara por tanda (`chat/ui-server.mjs:3143-3220`) | **Parcial** (apps medianas sí) | Trocear en turnos y commitear por hitos | 5-10 d (plan/todo + continuación automática) | P1 |
| **B6** | Depuración y auto-corrección con tests | Sin debugger, sin test runner en UI, sin mapeo error→línea. El agente ejecuta tests y corrige por prompt (funciona en tareas del eval) | **Parcial** | Consola externa + agente; revisar salidas | 5-10 d (panel tests + bucle "hasta verde") | P1 |
| **B7** | Instalación/portabilidad a otra máquina | Solo Windows 11 + NVIDIA 8 GB + Node≥22 + Edge/Chrome + `bin/` (1,2 GB) + `models/` (29 GB); sin instalador/updater/firma. Repo actual no reproducible (§3) | **Sí** para terceros / backup | Copiar la carpeta entera (31 GB) y rezar por el driver; `download-ornith.py` para el GGUF | 3-5 d release zip + bootstrap + doc; 10-20 d instalador/updater firmado | P0 (para otros) |
| **B8** | Fallback sin GPU / GPU pequeña | Se niega a cargar sin GPU completa; UI no arranca sin modelo | **Parcial** (en esta máquina: si la GPU está ocupada, no hay IDE) | Esperar/liberar VRAM; otro backend (Aider/Ollama) | 2-5 d permitir CPU/parcial + modo degradado; 5-10 d perfil modelo pequeño | P2 |
| **B9** | Multi-modelo y descargas | Catálogo de 3, solo 1 usable; sin descarga UI; 22 GB de `models/` sin usar (K2 + 27B) | No | Editar `chat/modelo.json` a mano; script Python | 3-5 d selector+descarga UI; 1-2 d limpieza/doc | P2 |
| **B10** | Actualizaciones/empaquetado/firma | No existe | No (personal) | `git pull` manual | 10-20 d | P3 |
| **B11** | Red/multiusuario | Sin auth; 1 turno global; estado por máquina; túnel público opcional | No (1 usuario) / **Sí** (equipo) | No compartir; no usar el túnel | 10-20 d (auth+sesiones) | P3 |
| **B12** | Git de equipo | Solo commit de archivos elegidos; sin push/pull/branch/diff por hunk | **Parcial** | Consola externa | 5-10 d | P2 |
| **B13** | Escrituras del agente sin aprobación previa | Auto-aplicadas + undo/tarjeta (`chat/ui-server.mjs:2660-2680`); no hay staging | Parcial (confianza) | Revisar tarjetas y "revertir turno" | 3-5 d | P1 |
| **B14** | Borrar/mover/renombrar para el agente | Sin herramientas y `commandAllowed` bloquea move/ren/del (`chat/actions.mjs:807-818`) | Parcial | Reescribir archivo nuevo + borrar a mano | 2-3 d | P0 |
| **B15** | Búsqueda de código para el agente | `buscar` es web; proyecto solo en UI (`/api/search`) | Parcial | `findstr` vía `ejecutar` | 1-2 d | P0 |
| **B16** | Documentación y coherencia | README al día (modelo Ornith); `INTEGRACION-MODELO.md` habla del 27B como activo; README dice "~36 s" y el informe 63,1 s; `URL-CURSOR.txt` con túnel público sin ignorar en `.gitignore` | No | Leer README + INFORME | 1-2 d | P2 |
| **B17** | Editor más allá de FIM/LSP | Sin multicursor, plegado, autoindent, lint, formato, extensiones; 2 MB por archivo (`chat/ui-server.mjs:1810-1826, 2027-2032`) | Parcial | Editor externo | 10-20 d migrar a CodeMirror 6 (habilita B1/B2) | P2 |
| **B18** | Rendimiento/hardware | 34-42 t/s con GPU al 95 %; si el equipo limita la GPU a 10 W (observado y avisado en README:135-136) cae a **1,7 t/s** y el flujo muere | Parcial | Revisar modo rendimiento/alimentación; `--threads`, KV más ligero | — (hardware) | — |

---

## 3. El repositorio, las dependencias y la reconstrucción en otro PC

### 3.1 · Estado real del repositorio (verificado el 2026-10-27)

```
$ git log --oneline -1
5b436d4 Completar limpieza y registro de errores de evaluación
$ git status --porcelain | wc -l
66        # 30 archivos modificados + 36 sin seguimiento
$ git diff --stat | tail -1
30 files changed, 3079 insertions(+), 2729 deletions(-)
$ git ls-files | wc -l
79        # solo 79 archivos versionados; .git = 16 MB
```

Lo importante no es el número: es **qué** está sin versionar. Entre los `??` hay piezas
imprescindibles del árbol actual:

- `chat/ui/chat-core.js` (1 763 líneas) — el núcleo de la UI que `chat/ui/index.html:664` carga.
  En `HEAD` ese código estaba **inline** dentro de `index.html` (`git show HEAD:chat/ui/index.html`
  → `<script>` en línea hasta la línea ~2420). Es decir: **`HEAD` arranca una versión vieja distinta
  de la actual**.
- `package.json` de la raíz (scripts `npm test`, `engines: node>=22`).
- `scripts/run-tests.mjs` (el ejecutor de suites que documenta el README).
- `chat/historial.mjs`, `chat/lecturas.mjs`, `chat/sse.mjs`, `chat/almacen-json.mjs` y 12 suites
  nuevas, documentación completa (`docs/`, `INFORME-SOLUCION-2026-10-27.md`,
  `AUDITORIA-HANDOFF.md`, `ARQUITECTURA-Y-PLAN-MAESTRO.md`, `INTEGRACION-MODELO.md`).

**Conclusión:** hoy el proyecto **solo existe completo en esta carpeta**. Un `git clone` da un IDE
más viejo y **sin** `package.json` ni el hilo conductor de pruebas. Si este disco muere, se pierden
las mejoras de las últimas semanas (o hay que reconstruirlas de los `.md`). Es el punto más frágil
del proyecto y el más barato de arreglar (commit + tag).

### 3.2 · `.gitignore` y peso (lo que no está en el repo, y por qué)

`.gitignore` excluye a propósito: `bin/`, `models/`, `node_modules/`, `logs/`, `chat/undo/`,
`chat/ui-chats/`, `salida/`, `capturas/`, `trabajo/`, `*.gguf`, estado local
(`ui-session.json`, `ui-workspace.json`, `ui-settings.json`, `ui-permit.json`), credenciales y
`.aider*`. Está **bien pensado**: el repo pesa 16 MB en vez de 31 GB.

Lo que ocupa el disco (verificado con `du`):

| Ruta | Tamaño | ¿Versionado? | Contenido |
|---|---:|---|---|
| `bin/` | **1,2 GB** | No | llama.cpp CUDA (80+ EXE/DLL, `ggml-cuda.dll` 563 MB, cuBLAS 573 MB) + `cloudflared.exe` 55 MB |
| `models/` | **29 GB** | No | 6 GGUF: Ornith 9B 5,78 GB + `mmproj` 0,92 GB (los necesarios) + 27B ternario ×2 (11,9 GB) + K2-Horizon 7B ×2 (11,4 GB) **sin usar** |
| `chat/node_modules/` | 14 MB | No | solo `playwright-core@1.64.1` |
| `.git` | 16 MB | — | 79 archivos versionados |
| **Total proyecto** | **31 GB** | — | esencial para funcionar: ~7,9 GB (código + bin + Ornith + mmproj) |

Punto importante para el usuario: el brief decía "~17 GB"; el peso real de `models/` es **29 GB**
porque arrastra modelos de pruebas anteriores. Se pueden liberar ~22 GB sin perder nada operativo
(dejando `Ornith-1.5-9B-Q4_K_M.gguf` y `mmproj-*.gguf`), **siempre que no se estén usando para la
evaluación en curso**.

### 3.3 · Dependencias reales

- Raíz: **ninguna** (no hay `node_modules` en la raíz; `package.json` solo tiene scripts).
- `chat/`: **una** dependencia, `playwright-core@1.64.1` (fijada en `chat/package-lock.json` con
  integrity SHA). Se usa solo para la herramienta `navegador` y las pruebas de navegador; si falta,
  el error es explícito (`chat/navegador.mjs:61-62`). El navegador usa el **Edge/Chrome instalado**
  (no descarga Chromium), lo que es bueno para offline.
- Sistema: Node ≥22 (aquí v26.0.0, npm 11.12.1), PowerShell, NVIDIA driver, Edge/Chrome, y
  opcionalmente Python (script de descarga del modelo y OCR de Windows).

### 3.4 · Pasos para reconstruir en otro PC (mismo perfil de hardware)

1. Windows 11 + driver NVIDIA + **Node ≥22** + Edge o Chrome + PowerShell.
2. Copiar/clonar el proyecto. **Hoy no basta `git clone`**: hay que copiar el árbol de trabajo
   completo (o hacer antes un commit, que es lo que recomiendo).
3. `bin/`: conseguir un build **Windows + CUDA de llama.cpp** con `llama-server.exe` y sus DLL
   (el README no dice versión ni procedencia). Copiar `bin/` entero desde esta máquina es lo
   único reproducible hoy. Nada verifica su integridad.
4. `models/`: `python scripts/download-ornith.py` (5,78 GB, reanudable, **verifica SHA-256** contra
   el publicado) y `python scripts/download-ornith.py --vision` (0,92 GB). Alternativa: copiar los
   dos `.gguf` a mano.
5. `npm ci --prefix chat` (instala `playwright-core`; requiere Internet).
6. `.\scripts\start-ui.ps1` (o `start-server.ps1` para solo API, `start-chat.ps1` para chat de
   terminal). El lanzador comprueba VRAM, elige contexto/KV, arranca `llama-server` y abre
   `http://127.0.0.1:8787`.
7. Elegir carpeta de trabajo con el botón **Carpeta** (la actual guardada es
   `C:\Users\user\Desktop\web app money administartion`, en `chat/ui-workspace.json`, ignorado por git).
8. Opcional: `.\scripts\crear-acceso-directo.ps1` para el icono de escritorio.

### 3.5 · Puntos frágiles de esa instalación

- **`bin/` sin manifiesto ni SHA**: build de llama.cpp del 25-sep, DLL de CUDA 12, sin versión
  declarada. Si NVIDIA/driver/Windows cambia, no hay forma documentada de volver a un build que
  funcionaba. Es la mayor deuda de reproducibilidad.
- **VRAM calibrada a mano para 8 GB**: `scripts/start-gpu-model.ps1:140-164` y la tabla de
  `chat/modelo.json` (sección `vram`) están medidas para RTX 4060 Laptop. Otra GPU exige re-calibrar
  con `-DryRun`; el script se niega si no cabe ("No se usa CPU como respaldo").
- **Rutas de navegador hardcodeadas** en `chat/navegador.mjs:10`
  (`C:/Program Files/.../msedge.exe`) con override `BONSAI_BROWSER`; si Edge está en otra ruta o no
  está, la herramienta `navegador` falla (el resto del IDE sigue).
- **OCR solo Windows**: `scripts/ocr-winrt.ps1` necesita el paquete de idioma OCR de Windows;
  `chat/ocr.mjs:8` devuelve error claro en otros sistemas.
- **PowerShell + ExecutionPolicy**: los accesos directos lanzan con `-ExecutionPolicy Bypass`
  (`scripts/crear-acceso-directo.ps1`); a mano puede hacer falta ajustar la política.
- **cmd.exe, no bash**: el agente recibe instrucciones de Windows (`chat/context.mjs:23-32`) y los
  comandos bloquean `/home`, `bash`, `tail` (con reintento automático a `python`); el sistema no es
  portable a Linux/macOS sin trabajo (PowerShell, `taskkill`, rutas, OCR).
- **Estado y rutas absolutas**: sesión/workspace/undo guardan rutas de esta máquina. Copiar el
  proyecto a otra ruta funciona (el workspace cae al directorio del IDE si no hay), pero el estado
  local no se migra. `chat/ui-permit.json` recuerda `"mode":"all"` (ejecutar sin preguntar): en un
  equipo nuevo conviene empezar en "Preguntar".
- **Sin red de seguridad de instalación**: si `llama-server` no arranca o se cae, la UI no arranca
  (`chat/ui-server.mjs:1065`). No hay diagnóstico integrado más allá de `logs/` y `-DryRun`.

### 3.6 · Qué implica no versionar `bin/` y `models/`

Es la decisión correcta para el repo (no meter 31 GB en git), pero **falta la otra mitad**: un
manifiesto con versión/SHA del build de llama.cpp y un script de provisión (como ya existe para el
modelo). Tal como está, el proyecto **no es reconstruible por un tercero** ni auditable: solo es
copiable. Para el usuario esto significa: (1) backup = copiar 7,9 GB esenciales (o 31 GB si no se
limpia); (2) migrar a otro PC = copiar `bin/` + `models/` a mano; (3) si se comparte el código, el
otro no puede levantarlo sin pedirle a alguien el binario.

---

## 4. Orden por impacto y mínimo imprescindible

### 4.1 · Top 5 que bloquean un flujo diario de apps

1. **El editor no asiste: no hay autocompletado/FIM ni diagnósticos/LSP.** Todo pasa por chat;
   para escribir código de verdad se depende del agente o de otro editor. Es la brecha
   conceptual más grande (y la que más diferencia a Cursor/VS Code + Copilot).
2. **No hay terminal integrado ni comandos largos.** `npm install`, `vite build`, servidores de
   desarrollo y `watch` no caben en 60 s y mueren al acabar el turno. Sin esto, "codear apps" obliga
   a alternar con una consola externa constantemente.
3. **Contexto y agente acotados:** 32k de ventana, 96 pasos por turno, sin RAG ni plan persistente.
   Da para apps de 1-2 archivos (19/19 en el evaluador) y se queda corto en cuanto hay 10-20
   archivos o una tarea de varias horas.
4. **Sin depuración ni test runner integrados.** El agente ejecuta tests y a veces corrige, pero no
   hay panel que ejecute la suite, mapee fallos a líneas ni verifique "hasta verde". Para apps
   serias, el bucle de corrección queda a medias.
5. **Portabilidad y estado del repo sin cerrar:** 31 GB no versionados, `HEAD` no reproducible,
   sin instalador/updater. Hoy el IDE es de una sola máquina y una sola persona de facto.

(Mención aparte, porque es el riesgo silencioso: el agente **escribe sin aprobación previa** y, con
permiso `all`, ejecuta comandos; el undo y las guardias lo hacen manejable, pero para trabajo serio
hay que confiar en el agente o revisar tarjeta a tarjeta.)

### 4.2 · Hoja de ruta mínima (coste orientativo, 1 dev)

**P0 — "usable sin fricción en esta máquina" (≈2-3 semanas)**
1. Commit + tag del árbol actual, arreglar `.gitignore` (`URL-CURSOR.txt`), README de instalación
   real con versión de llama.cpp y SHA. — 2 d
2. Comandos largos: subir el tope, streaming de salida en vivo y procesos en segundo plano con
   salida y parada explícita (mini-terminal en el panel del chat). — 5-7 d
3. Herramientas del agente: borrar/mover/renombrar + búsqueda en el proyecto. — 3-5 d
4. Aprobación previa de escrituras del agente (staging con diff, "aplicar todo" opcional). — 3-5 d

**P1 — "cómodo para proyectos medianos" (≈3-5 semanas más)**
5. Panel de problemas/tests: ejecutar `npm test`/lint/tsc desde la UI, parsear fallos y anclar el
   bucle del agente a la suite. — 8-12 d
6. Plan/todo persistente y reanudación de tareas largas. — 5-10 d
7. Búsqueda de código/index ligero para el agente (primero grep estructurado; RAG después). — 5-15 d
8. Git de equipo (pull/push/branch, diff por hunk). — 5-10 d

**P2 — "paridad funcional con un IDE asistido" (≈6-10 semanas más)**
9. Migrar el editor a CodeMirror 6/Monaco (base para todo lo demás). — 10-20 d
10. FIM/autocompletado (requiere modelo FIM pequeño y gestionar VRAM) e integración LSP. — 20-40 d
11. Instalador/actualizador firmado y provisión de `bin/`+`models/`. — 10-20 d
12. Fallback CPU/GPU pequeña y multiusuario con auth (solo si se quiere compartir). — 15-30 d

**Total para un IDE serio de uso personal: ~2-3 meses de 1 dev.** Para producto distribuible:
~4-6 meses y, con 8 GB de VRAM, con un techo de calidad de modelo que no se arregla con código.

### 4.3 · Lo que NO hace falta para empezar

No hace falta RAG, multiusuario, instalador firmado, auto-update ni LSP completo para **usar hoy**
el IDE en un proyecto propio pequeño/mediano. Con P0 (≈2 semanas) el flujo deja de doler; P1 lo
hace cómodo. El orden importa: sin commit y sin comandos largos, el resto es decoración.

---

## 5. Veredicto

**Clasificación: prototipo avanzado con calidad de ingeniería — herramienta personal usable hoy,
producto no.**

- **No es un juguete.** Es código real, con decisiones de ingeniería que muchos "productos" no
  tienen: escritura atómica con precondición, undo por escritura y por turno, guardia CSRF/DNS,
  confinamiento de rutas, detección de atascos, cierres honestos, 34 suites (26/26 + 3/3 en verde
  según `INFORME-SOLUCION-2026-10-27.md`), evaluador propio de 19 tareas con **19/19** en la última
  corrida con el modelo actual (`salida/eval-ornith-2026-10-26-sin-pensar/informe.md`), y medición
  de todo lo medible (VRAM, KV, tokens/s, calidad de KV). Hay incluso un banco de tareas largas y
  una auditoría de 21 hallazgos + 10 bugs resueltos.
- **No es (aún) un producto.** Le faltan las capas de "IDE": editor asistido (FIM/LSP), terminal,
  test runner/depuración, instalación reproducible y multiusuario. Y el estado del repo no refleja
  el estado real: hoy es un proyecto de una sola máquina.
- **Para qué sirve hoy, de verdad:** construir apps pequeñas o medianas (una API + CLI + tests, una
  página web con su JS, scripts de datos, refactors guiados) hablando con el agente, revisando
  diffs y commiteando por hitos; y como **backend OpenAI local** para Cursor/Aider si se prefiere
  un IDE maduro con el modelo local. En ese segundo papel, el proyecto ya entrega valor hoy.
- **Para qué no sirve hoy:** un proyecto grande con muchas dependencias y builds largos, trabajo en
  equipo, o alguien que espere la experiencia "tab-tab-tab" de Cursor dentro de esta UI.
- **Notas orientativas:** madurez como producto 3/10; utilidad real hoy para un dev solo 6,5/10;
  calidad de ingeniería 8/10. **Juguete: no. IDE de diario: todavía no. Asistente local con editor,
  sí — con ~2-3 semanas de trabajo P0 se convierte en una herramienta que no da ganas de cerrar.**

**Riesgo a vigilar:** el rendimiento depende del estado del equipo. Con la GPU al 95 % rinde
34-42 t/s (usable); cuando el equipo limita la GPU a 10 W (caso ya observado y documentado en
README:135-136; en `logs/proyecto-validacion-2026-10-27.err.log` hay una corrida a **1,71 t/s**)
la experiencia se vuelve inservible. Antes de invertir en producto, conviene estabilizar eso.

---

## 6. Anexo · evidencias, cifras y discrepancias

### 6.1 · Verificado por mí en esta sesión

- `wc -l`: 52 `.mjs` en `chat/`, ~24 000 líneas entre servidor, agente, UI y suites.
- 18 rutas `/api/*` distintas + estáticos (26 comparaciones `url.pathname ===`): chat, file, fs,
  undo, edit, attach, search, git, modelos, rules, settings, chats, reset, permit, workspace, state,
  stats, gpu.
- 7 herramientas del agente (`chat/actions.mjs:300-393`).
- 34 suites listadas por `node scripts/run-tests.mjs --listar` (26 aisladas + 5 GPU + 3 navegador).
- `git`: 79 archivos versionados, 30 modificados + 36 sin seguimiento, `HEAD` = 5b436d4.
- `du`: `bin/` 1,2 GB; `models/` 29 GB (6 GGUF); `chat/node_modules` 14 MB; `.git` 16 MB; total 31 GB.
- Dependencias: solo `playwright-core@1.64.1` (lock con integridad); raíz sin deps.
- Permiso actual de comandos: `chat/ui-permit.json` → `"mode":"all"`; ajustes:
  `{"tema":"dark","perfil":"codigo","pensar":0,"reglas":true,"historial":32768}`.
- Modelo activo en `logs/perfil-servidor-8080.json`: `ornith9b`, contexto 32768, KV q8_0, visión.
- Corridas registradas: 19/19 sin pensar (6 min 38 s) y 17/19 con pensar 2048 (6 min 44 s)
  (`salida/eval-ornith-2026-10-26*/informe.md`); suite global 26/26 + 3/3
  (`INFORME-SOLUCION-2026-10-27.md` §1).

### 6.2 · Discrepancias documentales detectadas

| Dónde | Qué dice | Realidad |
|---|---|---|
| `INTEGRACION-MODELO.md` | Presenta **Override-6 (27B)** como modelo activo y "pendiente: nada" | El modelo activo es **Ornith 9B**; el doc es histórico (4-oct) y no lo aclara |
| `README.md:67` | "npm test … (~36 s)" | `INFORME-SOLUCION-2026-10-27.md`: **63,1 s** para 26/26; el tiempo depende del equipo |
| Brief del usuario | `models/` ~17 GB | **29 GB** (arrastra K2 y 27B de pruebas) |
| `AUDITORIA-HANDOFF.md` §24 | Pendientes H9/H10/H12/H13 "sin tocar" | H9 (`reemplazar`) y H10 (`segundo_plano`) ya están implementados; el doc no se actualizó |
| Raíz del proyecto | `URL-CURSOR.txt` (y `.cursor/`) sin seguimiento y **no ignorados** | Un túnel Cloudflare público puede acabar commiteado; no hay `.gitignore` para él |

### 6.3 · Lo que NO he podido verificar

- Rendimiento y estabilidad en uso real continuado (no arranqué la GPU: la ocupa otro compañero).
- `npm test` actual (cito la corrida documentada; no la repetí para no competir con la evaluación
  en curso).
- Instalación en una máquina limpia (solo inferida del código y los scripts).
- Calidad del modelo para código (la audita otro compañero; aquí solo uso las cifras del evaluador
  ya registradas).
