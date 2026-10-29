# Bonsai Local IDE

**Coding con contexto selectivo:** `small-local-coder` añade Tree-sitter en CPU,
mapa selectivo, nueve herramientas con validación de schema, estado externo y
verificación/reparación automática. Se selecciona en Ajustes → Agente o con
`scripts/start-ui.ps1 -AgentProfile small-local-coder -EnginePreset 8GB-BALANCED`.
BALANCED usa texto, 34/34 capas en GPU y colocación estándar de tensores, incluyendo
un buffer CPU_Mapped. En Ajustes → Motor también están los perfiles de visión:
16k F16, 32k Q8 y **32k/36k F16 con pensamiento**. El perfil activo
`8GB-VISION-LONG` usa **36.864 tokens, KV F16 y 4.096 de presupuesto de razonamiento**,
con 2.048 adicionales para responder/editar y un mínimo de **400 MiB libres**.
La ventana incluye entrada, imágenes y salida; no son 36k de entrada más 4k aparte.
El modo Consulta permite combinar
imágenes y texto sin editar el proyecto. El modo Agente conserva la imagen durante
las ediciones y reparaciones. La selección se guarda después de cargar correctamente.
Ver [arquitectura y uso](docs/SMALL-LOCAL-CODER.md) y
[mediciones reproducibles](reports/coder-2026-10-28/RESUMEN.md).

**Abrir el IDE:** el acceso directo **Bonsai IDE** usa `scripts/launch-ide.ps1`;
también puede ejecutarse ese script directamente. Reutiliza un IDE sano y recuerda
modelo, perfil, contexto, razonamiento y tema. La UI ofrece seis temas (Grafito,
Niebla azul, Bosque, Arena, Marfil y Medianoche), pensamiento del modelo local en
un panel desplegable separado y VRAM libre real en la barra inferior. El presupuesto
de pensamiento es un máximo disponible: el modelo puede concluir antes de 4k.

**Continuación · 29 de octubre:** CUDA/Nsight instalados y utilizados; build sm89,
verificación Python/TypeScript, LSP opcional y perfiles simultáneos de código,
visión y pensamiento. El runtime original sigue activo: el build específico no
demostró una ventaja de velocidad suficiente para sustituirlo.
Ver [resultados actuales y pendientes](reports/coder-phase3/RESUMEN.md),
[auditoría de los dos prompts](reports/coder-phase3/PENDIENTES-PROMPTS.md),
[fase anterior](reports/coder-phase2/RESUMEN.md) y
[reproducción de la toolchain](docs/INFERENCE-TOOLCHAIN.md).

Entorno de desarrollo con inferencia de IA **100 % local** para Windows 10 y 11: chat con agente,
editor con pestañas, diffs, deshacer, git, navegador controlado y visión. Sin servicios en
la nube: el modelo corre en la GPU del equipo con `llama-server` (llama.cpp) y la interfaz
es un servidor Node propio.

## Perfil general histórico · 28 de octubre de 2026

- **Modelo activo/recomendado:** **Ornith-1.5-9B Q4_K_M** (`ornith-ai/Ornith-1.5-9B-GGUF`),
  5.780.090.816 bytes verificados con su SHA-256. **Perfil final: 39.936 tokens con visión,
  KV q8_0**, con **todos los tensores, KV y proyector en CUDA0**. Validado mediante el IDE
  con 28.057 tokens de texto y una imagen de 1200×528: leyó «4758» sin OCR y conservó
  al menos **426 MiB libres**. El presupuesto estimado es 7.696 MiB; no equivale al pico
  real. El arranque automático prueba primero el techo exacto, sin redondearlo a 36.864,
  guarda el perfil en `logs/perfil-servidor-<puerto>.json` y lo reutiliza
  en el siguiente arranque; recuerda el modelo elegido en `chat/modelo-activo.json`.
- **Muestreo propio del modelo:** temperatura 0.6, top-p 0.95, top-k 20. El razonamiento
  es opcional (Ajustes → Modo razonamiento) y solo se usa en modelos que lo admiten.
- **Presupuesto de contexto honesto:** Ajustes muestra los **cuatro valores reales**
  (ventana del servidor, historial solicitado, historial efectivo y reserva de salida). El
  "tope de historial" es una petición: no agranda la ventana del modelo. El estado de la
  barra inferior enseña la ventana y el historial efectivo.
- **Interfaz:** pestañas, Ctrl+S, recarga automática si el agente reescribe el archivo,
  **Ctrl+K** (edición con el modelo, diff y guardado con precondición: si el archivo cambió
  en disco responde 409 y **no pisa nada**), paleta de comandos (Ctrl+P / Ctrl+Shift+P),
  búsqueda en el proyecto (Ctrl+Shift+F), git archivo a archivo, reglas del proyecto
  (`BONSAI.md`, `AGENTS.md`, `.cursor/rules`), deshacer escrituras del agente, adjuntos e
  imágenes (con OCR local opcional), navegador headless para comprobar páginas, temas y
  paneles adaptables.
- **Panel inferior (Ctrl+`):** **terminal integrado** con stdin y comandos sin el tope de 60 s,
  **Problemas** (diagnósticos reales: JS/MJS/CJS con `node --check`, Python con `py_compile`,
  JSON, y comprobación estructural de HTML/CSS/MD), **Esquema** de símbolos del archivo e
  **ir a definición** (F12). Los procesos que el agente lanza con `segundo_plano: true`
  **ya no mueren al acabar el turno**: siguen vivos y se listan/detienen desde el panel
  (`/api/procesos`).
- **Agente más capaz:** `borrar` y `mover` (borrar/mover/renombrar con punto de deshacer),
  **plan persistente** (`plan`, checklist que se recuerda en cada turno) y
  **«Continuar solo hasta terminar»** (hasta 3 turnos internos si se agota el límite de pasos
  o el turno se atasca). El tope de pasos por turno (192 por defecto) y el tiempo máximo por
  comando (3 min) se ajustan desde Ajustes.
- **Autonomía de desarrollo:** Permisos → todo permite comandos de compilación, instalación,
  SDKs, rutas de ejecutables y gestión de los procesos de la tarea. Las herramientas de
  archivos aceptan rutas relativas o absolutas dentro del proyecto, formatos nativos y
  archivos sin extensión. `proceso leer` consulta salida y código de builds asíncronos.
- **Investigación web:** `buscar` obtiene fuentes y `leer_web` abre su texto y enlaces,
  con paginación y un buscador alternativo. El agente recibe instrucciones para contrastar
  documentación oficial y citar las fuentes leídas. La inferencia sigue siendo local;
  buscar, descargar dependencias y cargar recursos CDN requiere internet.
- **Navegador de desarrollo:** WebGL, workers, service workers, APIs y WebSocket/HMR;
  `evaluar` obtiene diagnósticos JavaScript. El perfil `aislado` conserva la restricción
  al origen elegido. Los guardados siguen siendo atómicos y recuperables; el cambio de
  modelo solo detiene servidores administrados por este IDE.

## Requisitos

- **Windows 10 o 11**, con Windows PowerShell 5.1 (los scripts son `.ps1`). El agente y
  la terminal usan `cmd.exe`; PowerShell se invoca explícitamente cuando hace falta.
- **Node.js 22 o superior** (`node --version`).
- **GPU NVIDIA** con sitio para el modelo completo en VRAM (probado en RTX 4060 Laptop
  8 GB). El arranque se niega a cargar si no cabe entero: no hay capas en CPU.
- `bin/` con `llama-server.exe` de llama.cpp con CUDA y sus DLL.
- `models/` con el GGUF del catálogo y, si se quiere visión, el `mmproj` del modelo.
- **Edge o Chrome** instalados para la herramienta `navegador` y las pruebas de navegador.
- **`playwright-core`** en `chat/` para esas mismas pruebas: `npm ci --prefix chat`
  (dependencia ya instalada en este equipo; la raíz no necesita `node_modules`).

## Arranque

```powershell
.\scripts\start-ui.ps1                              # modelo + interfaz en http://127.0.0.1:8787
.\scripts\start-server.ps1 -Modelo ornith9b -Vision # solo API OpenAI-compatible en :8080
.\scripts\start-chat.ps1                            # servidor + chat de terminal
.\scripts\start-server.ps1 -DryRun                  # comprueba VRAM y enseña el comando, sin lanzar
```

- El modelo se cambia desde el botón **Modelo** de la barra superior (o desde el chat, si
  se arrancó aparte). El cambio descarga el modelo anterior y carga el nuevo conservando el
  historial; solo toca servidores lanzados por este IDE.
- La visión se activa sola si el proyector del modelo está en `models/`; `start-ui.ps1
  -SinVision` la apaga y `start-server.ps1 -Vision` la fuerza.
- Puertos por defecto: **8080** API (`/v1`) y **8787** interfaz. La API es compatible con
  OpenAI, así que también sirve para Cursor/Aider (`scripts/start-cursor-bridge.ps1`,
  `scripts/start-aider.ps1`). Detalle de integración: [INTEGRACION-MODELO.md](INTEGRACION-MODELO.md).
- La caché anterior de 32.768 se migra al cambiar el perfil del catálogo. Los siguientes
  arranques conservan 39.936/q8_0 mientras quepa. **No aumentar el techo de visión**:
  40.960 falló con imagen grande. El techo histórico sin visión (53.248) es otro perfil.

## Pruebas

```powershell
npm test                 # suites aisladas: sin GPU ni llama-server real (~85 s)
npm run test:navegador   # Edge/Chrome headless: UI, Ctrl+K, humo (~6 s)
npm run test:gpu         # necesita el modelo real arrancado (lento; opcional)
npm run test:todo        # las tres familias
node scripts/run-tests.mjs --listar   # ver qué suites hay en cada grupo
```

Validación del perfil final, usando el servidor existente en 8080 sin reiniciarlo
ni comparar otras configuraciones:

```powershell
node chat/prueba-gpu-real.mjs --log logs/ornith-39936-final.err.log --salida logs/ornith-validacion-39936.json
node chat/prueba-vision.mjs --puerto 8080 --numero 4758 --escala 48 --texto-largo --sin-ocr --exigir --salida logs/ornith-vision-ide-39936.json
```

La segunda prueba usa adjuntos y `/api/chat` de un IDE con proyecto y estado temporales,
conserva el texto largo durante la lectura visual y exige visión activa. `--sin-ocr`
desactiva la transcripción solo en ese proceso de prueba. El grupo GPU completo también
compara perfiles y cambia modelos; no es necesario para esta validación.

- `npm test` ejecuta cada suite en su propio proceso, captura su salida y resume OK/FALLO
  (código 0/1). Incluye, entre otras: `modelo.mjs`, `actions.mjs` (diff), `editar.mjs`
  (Ctrl+K y CRLF), `prueba-editor.mjs`, `prueba-contexto.mjs`, `prueba-stream.mjs`,
  `prueba-lecturas.mjs`, `prueba-servidor-estado.mjs`, `prueba-agente-limites.mjs`,
  `prueba-agente.mjs`, `prueba-markdown-seguro.mjs`, `prueba-navegador-rutas.mjs`,
  `prueba-sin-gpu.mjs`, `prueba-api.mjs`, `prueba-seguridad.mjs`, `prueba-procesos.mjs`,
  `prueba-truncado.mjs`, `prueba-archivos-seguros.mjs`, `prueba-git-seguro.mjs`,
  `prueba-recuperacion-modelo.mjs`, `prueba-servidor-administrado.mjs`,
  `prueba-perfil-gpu.mjs` (estas dos últimas usan PowerShell en modo DryRun/aislado, sin
  arrancar el modelo), `prueba-terminal.mjs` (terminal persistente, stdin y procesos en
  segundo plano) y `prueba-diagnosticos.mjs` (diagnósticos, outline e ir a definición).
- Todas usan estado y proyecto **temporales** (`os.tmpdir()`): no tocan los chats, la
  carpeta de trabajo ni los logs del usuario. Las que levantan `ui-server` lo hacen en
  puertos libres y con un **llama-server simulado** (sin GPU).
- Sueltas también se pueden ejecutar: `node chat/editar.mjs`, `node chat/actions.mjs`,
  `node chat/prueba-ui.mjs`, `node chat/prueba-ui-humo.mjs`…
- `npm run test:gpu` no se ejecuta por defecto: `prueba-gpu-real.mjs`, `prueba-vision.mjs`,
  `prueba-modelos.mjs --real`, `prueba-observacion.mjs --real` y `prueba-calidad-kv.mjs --real`
  validan residencia CUDA, visión, cambio de modelo en caliente, navegación con el modelo real
  y la calidad del KV cuantizado (q8_0 ≈ f16; ver `docs/CALIDAD-KV-2026-10-27.md`).
- El cierre real de un `llama-server` huérfano (BUG-05) se validó una vez en esta máquina con
  `node chat/prueba-servidor-administrado.mjs --gpu`; se recomienda repetirlo tras cambiar
  los scripts de arranque. `prueba-ocr.mjs` se ejecuta aparte cuando toca tocar el OCR.

## Estructura

```text
chat/            servidor de UI, agente, contexto, herramientas y las suites de prueba
                 (terminal.mjs = terminal persistente; diagnosticos.mjs = problemas/outline)
chat/ui/         index.html + chat-core.js (script clásico), app.js, ide.js, paneles.js,
                 markdown.js, iconos.js, tema.css; fuentes e iconos locales
scripts/         arranque (start-*.ps1), calibración y run-tests.mjs (ejecutor de pruebas)
bin/             llama.cpp con CUDA (llama-server y DLL)
models/          GGUF del modelo y del proyector de visión
docs/            documentación histórica
reports/         investigación comparativa de modelos
salida/          adjuntos y artefactos de las pruebas del agente (no es la carpeta de trabajo)
```

## Documentación

- **Histórico de la etapa anterior (27B):** [docs/HISTORICO-2026-10-27-27b.md](docs/HISTORICO-2026-10-27-27b.md)
  — configuración antigua con CPU parcial; **no** representa el arranque actual.
- Arquitectura, decisiones y plan: [ARQUITECTURA-Y-PLAN-MAESTRO.md](ARQUITECTURA-Y-PLAN-MAESTRO.md).
- Cambios del 28-oct (terminal, diagnósticos, plan, procesos en segundo plano):
  [docs/CAMBIOS-2026-10-28.md](docs/CAMBIOS-2026-10-28.md).
- Auditoría de bugs y refactorización: [AUDITORIA-BUGS-Y-REFACTORIZACION.md](AUDITORIA-BUGS-Y-REFACTORIZACION.md) y [AUDITORIA-HANDOFF.md](AUDITORIA-HANDOFF.md).
- Auditoría del harness, permisos y validación del perfil final:
  [docs/HARNESS-LOCAL-2026-10-28.md](docs/HARNESS-LOCAL-2026-10-28.md).
- Seguridad del navegador del agente: [chat/SEGURIDAD-NAVEGADOR.md](chat/SEGURIDAD-NAVEGADOR.md).
- Investigación de modelos para 8 GB: [reports/Coding models for eight GB.md](reports/Coding%20models%20for%20eight%20GB.md).

## Seguridad y fiabilidad (resumen)

- Las rutas del editor, el agente y deshacer rechazan enlaces y junctions dentro del
  proyecto. Los guardados preparan una copia de recuperación y escriben un temporal junto al
  archivo para sustituirlo atómicamente. Los puntos de deshacer nuevos quedan ligados a su
  carpeta; los antiguos se conservan pero no se aplican automáticamente.
- Git muestra cada archivo y pide seleccionarlos antes de confirmar; no agrega todo el
  proyecto. `.gitignore` excluye estado local, capturas, adjuntos, credenciales y salidas de
  pruebas.
- El navegador usa un perfil efímero y protege los puertos del IDE y del modelo. En modo
  `desarrollo` permite recursos web, APIs, workers y HMR. Para pruebas limitadas a un solo
  origen configura `BONSAI_BROWSER_POLICY=aislado` antes del arranque. La ejecución local
  conserva los permisos del usuario de Windows; las comprobaciones de comandos no son
  un sandbox del sistema operativo.
- El OCR de Windows se usa localmente como pista para transcribir texto de capturas; tanto
  el OCR como el modelo pueden equivocarse, así que en caso de discrepancia hay que revisar
  la imagen.
- El medidor informa si el equipo limita la potencia de la GPU muy por debajo de su límite
  habitual (se observó 10 W frente a 80 W): revisa el modo de rendimiento y la alimentación
  si vuelve a ocurrir.
