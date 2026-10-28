# Bonsai Local IDE

Entorno de desarrollo asistido por IA **100 % local** para Windows 11: chat con agente,
editor con pestañas, diffs, deshacer, git, navegador controlado y visión. Sin servicios en
la nube: el modelo corre en la GPU del equipo con `llama-server` (llama.cpp) y la interfaz
es un servidor Node propio.

## Estado actual · 27 de octubre de 2026

- **Modelo activo/recomendado:** **Ornith-1.5-9B Q4_K_M** (`ornith-ai/Ornith-1.5-9B-GGUF`),
  5.780.090.816 bytes verificados con su SHA-256. **Hasta 32.768 tokens con visión** (KV
  q8_0, ~7821 MiB de presupuesto) **o sin visión** (KV f16), con **todos los tensores y el
  proyector en CUDA0**: sin capas en CPU. El arranque automático busca la mejor combinación
  de contexto/KV que quepa, la guarda en `logs/perfil-servidor-<puerto>.json` y la reutiliza
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
- **Seguridad:** las rutas del editor/selector/navegador están confinadas a la carpeta de
  trabajo; los guardados son atómicos y dejan punto de deshacer; el navegador del agente
  solo permite el origen local elegido; el cambio de modelo solo detiene servidores
  administrados por este IDE.

## Requisitos

- **Windows 11** con PowerShell (los scripts son `.ps1`).
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

## Pruebas

```powershell
npm test                 # suites aisladas: sin GPU ni llama-server real (~85 s)
npm run test:navegador   # Edge/Chrome headless: UI, Ctrl+K, humo (~6 s)
npm run test:gpu         # necesita el modelo real arrancado (lento; opcional)
npm run test:todo        # las tres familias
node scripts/run-tests.mjs --listar   # ver qué suites hay en cada grupo
```

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
- El navegador del agente solo permite la aplicación local elegida: bloquea otros orígenes,
  redirecciones, WebSocket y workers, y usa selectores únicos para controles repetidos. No
  es un sandbox del sistema operativo y no limita la herramienta de comandos.
- El OCR de Windows se usa localmente como pista para transcribir texto de capturas; tanto
  el OCR como el modelo pueden equivocarse, así que en caso de discrepancia hay que revisar
  la imagen.
- El medidor informa si el equipo limita la potencia de la GPU muy por debajo de su límite
  habitual (se observó 10 W frente a 80 W): revisa el modo de rendimiento y la alimentación
  si vuelve a ocurrir.
