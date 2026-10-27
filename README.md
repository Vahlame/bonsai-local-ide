# Bonsai IDE local

## Seguridad y fiabilidad · 27 de octubre de 2026

- Las rutas del editor, el agente y deshacer rechazan enlaces y junctions dentro del proyecto. Los guardados preparan una copia de recuperacion, escriben un temporal junto al archivo y lo sustituyen atomicamente. Los puntos de deshacer nuevos quedan ligados a su carpeta; los antiguos, sin esa identidad, se conservan pero no se aplican automaticamente.
- Git muestra cada archivo y pide seleccionarlos antes de confirmar; no agrega todo el proyecto. `.gitignore` excluye el estado local, capturas, adjuntos, formatos habituales de credenciales y salidas de pruebas. Los cambios ya preparados que no se elijan no entran en el commit.
- El navegador del agente permite solo la aplicacion local elegida. Bloquea otros origenes, redirecciones, WebSocket y workers, y usa selectores unicos para controles repetidos. Esto limita las pruebas de aplicaciones que usan CDN, API de otro origen, WebSocket o workers. Detalles: [seguridad del navegador](chat/SEGURIDAD-NAVEGADOR.md). La politica no es un sandbox del sistema operativo y no limita la herramienta de comandos.
- El cambio de modelo solo detiene servidores identificados como administrados por este IDE. Si falla el nuevo arranque, intenta recuperar el servidor anterior y su configuracion; no cierra servidores ajenos. Los modelos que usan CPU estan bloqueados para respetar la GPU completa.
- El OCR de Windows se usa localmente como pista para transcribir texto de capturas y adjuntos. El OCR es una operacion auxiliar de Windows que usa CPU; los pesos, el contexto y el proyector de Ornith siguen en la GPU. Tanto el OCR como el modelo pueden equivocarse: en caso de discrepancia hay que revisar la imagen.
- El medidor informa cuando el equipo limita la potencia de la GPU muy por debajo de su limite habitual. En las pruebas del 27 de octubre el limite efectivo fue de **10 W** frente a **80 W** habituales, lo que redujo mucho la velocidad; revisa el modo de rendimiento y la alimentacion del equipo si vuelve a ocurrir.

Pruebas aisladas disponibles: `node chat/prueba-archivos-seguros.mjs`, `node chat/prueba-navegador-aislamiento.mjs`, `node chat/prueba-git-seguro.mjs`, `node chat/prueba-recuperacion-modelo.mjs`, `node chat/prueba-ocr.mjs` y las pruebas generales del IDE. El OCR leyo los casos 3438 y 2372 en capturas y el modelo tambien los respondio correctamente al recibir esa pista; son ejemplos controlados, no una garantia general de vision.

## Actualizacion del 26 de octubre de 2026

Modelo recomendado para programar en esta RTX 4060 de 8 GB: **Ornith-1.5-9B Q4_K_M**, del repositorio oficial `ornith-ai/Ornith-1.5-9B-GGUF`.

- Archivo de **5.780.090.816 bytes**, verificado con el SHA-256 publicado.
- **16.384 tokens con visión activa**, o **32.768 sin visión**, KV **f16**. Todos los tensores del modelo, KV y estado recurrente en **CUDA0**: sin capas ni expertos en CPU. El runtime usa CPU para tokenizar, muestrear y gestionar la aplicacion.
- Verificado sin visión: **34/34 capas** en GPU; sin buffer de pesos en CPU. Prompt de 22.877 tokens completado; pico observado **6.859 MiB**. Con el proyector oficial propio de Ornith en GPU: contexto 16K y pico **7.393 MiB** durante pruebas de capturas y corrección de un bug.
- Muestreo propio del modelo: temperatura 0.6, top-p 0.95, top-k 20. Razonamiento apagado inicialmente: **19/19** tareas en la pasada sin pensar, frente a **17/19** con 2048 tokens. Se puede activar en Ajustes; una sola pasada por modo no garantiza esos resultados en otras tareas.
- Corregidos guardados rapidos y en vuelo, cambios de pestana que perdian texto, cierre multiple sin aviso, lectura de archivos de hasta 2 MB, cancelacion de peticiones y repintado excesivo durante streaming. Distribucion adaptable, boton para restablecer paneles e iconos con medidas estables.

El arranque recuerda el modelo seleccionado en `chat/modelo-activo.json`. Tambien se puede elegir desde el boton Modelo.

Visión y navegador: se instaló el proyector oficial `mmproj-Ornith-1.5-9B-BF16.gguf`, de 921.704.672 bytes y SHA-256 verificado. `start-ui.ps1` activa la visión si encuentra el proyector del modelo elegido. Ornith carga el proyector en CUDA0, nunca en CPU. El perfil se niega a arrancar si no cabe en la VRAM comprobada. El máximo de imagen es 512 tokens; para revisar iconos o texto pequeño, la herramienta `navegador` permite capturar un elemento de cerca.

La herramienta abre HTML del proyecto o un servidor local en un perfil Edge/Chrome temporal. Puede pulsar, escribir, seleccionar, usar teclas, desplazarse, cambiar el ancho, leer consola/red y comprobar la disposición. Cada acción devuelve datos reales y una captura al modelo; las capturas también se pueden abrir en las tarjetas del chat. El navegador y los servidores del agente terminan al acabar el turno. Para proyectos Node con servidor propio, usa `ejecutar` con `segundo_plano: true` y después `navegador` con su URL local. No controla las pestañas personales ni el escritorio.

Dependencia de navegador (ya instalada aquí): `npm ci --prefix chat`. Requiere Edge o Chrome instalado. Pruebas: `node chat/prueba-observacion.mjs` (navegador y API con modelo simulado); `node chat/prueba-observacion.mjs --real` (modelo real, usa el servidor existente, no cambia de modelo). Evidencia: `salida/observacion-real-2026-10-26/informe.json`. La prueba visual independiente envía solo píxeles, sin el HTML ni el texto esperado. El modelo leyó `CASA 3241` y corrigió un contador averiado, comprobado con dos clics por un verificador independiente. Son pruebas pequeñas, no garantía de autonomía en aplicaciones complejas. Una prueba anterior de dígitos con fuente de mapa de bits falló: la visión puede confundir texto.

```powershell
.\scripts\start-ui.ps1
# Arranque explicito del nuevo modelo, sin abrir la interfaz:
.\scripts\start-server.ps1 -Modelo ornith9b
# Con vision, proyector propio en GPU, contexto automatico hasta 16K:
.\scripts\start-server.ps1 -Modelo ornith9b -Vision
```

Investigacion y limites de los benchmarks: [Coding models for eight GB](reports/Coding%20models%20for%20eight%20GB.md). Evidencia local: `logs/ornith-validacion-32k.json`. La evaluacion completa queda en `salida/eval-ornith-2026-10-26/`.

Los perfiles Bonsai de 27B anteriores quedan en el catálogo como referencia, pero no se pueden iniciar: usan CPU y no cumplen el requisito de GPU completa. Los GGUF sueltos tampoco se arrancan sin un perfil verificado. Ornith usa su propio perfil `servidor` en `chat/modelo.json` y `scripts/start-gpu-model.ps1`.

El IDE solo detiene servidores lanzados por esta instalación y verificados en el puerto configurado. Si el puerto pertenece a otro proceso, o el servidor se inició manualmente, hay que cerrarlo manualmente antes de cambiar de modelo. Si el nuevo arranque falla, intenta recuperar el servidor anterior con su contexto, tipo de caché, visión y razonamiento, conservando la selección guardada. Si la recuperación falla, informa ambos errores. Cuando falta el registro de configuración de un servidor de una versión anterior, el IDE no lo detiene y solicita un reinicio manual. Pruebas aisladas: `node chat/prueba-servidor-administrado.mjs` y `node chat/prueba-recuperacion-modelo.mjs`; agrega `--gpu` a la primera para comprobar el arranque y parada reales en un puerto temporal.

**La documentación siguiente es histórica**: describe la configuración anterior de Bonsai de 27B, incluida ejecución parcial en CPU, y no representa el arranque actual.

---

# Local AI Engine: Ternary-Bonsai-2-27B en NVIDIA RTX 4060 (8GB VRAM)

Despliegue local de alto rendimiento del modelo de lenguaje de 27 mil millones de parámetros **Ternary-Bonsai-2-27B-Abliterated-PTQ1_0**, adaptado a medida para la GPU **NVIDIA GeForce RTX 4060 Laptop (8GB VRAM)** y procesador **AMD Ryzen 7 7840HS**, orientado a desarrollo de software y programación.

---

## 🚀 Arquitectura y Tecnologías Clave

- **Modelo:** `Override-6/Ternary-Bonsai-2-27B-abliterated-gguf` (~5.54 GiB) **predeterminado**, con el anterior (`BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-GGUF`) como **respaldo**: `.\scripts\start-server.ps1 -Modelo bolding_v1`. Los dos miden exactamente lo mismo, así que cambiar de modelo no toca la VRAM ni el contexto. Motivos y comparativa: [INTEGRACION-MODELO.md](INTEGRACION-MODELO.md). Híbrido: 48 capas lineales (Gated DeltaNet) y 16 de atención completa, contexto nativo de 262 144 tokens (datos leídos del propio GGUF).
- **Motor de Inferencia:** `PrismML-Eng/llama.cpp` (con kernels CUDA para la Transformada Rápida de Walsh-Hadamard `FWHT`).
- **Atención:** Flash Attention habilitado (`--flash-attn on`).
- **Contexto y VRAM:** **contexto automático**: `start-server.ps1` usa la mayor ventana que arranca con la VRAM libre de ese momento (con ~7.9 GB libres, **77,824 tokens** con KV `q4_0`, unos 7.4 GB en uso) y reintenta con menos si falla al cargar. La cuenta (`chat/modelo.json`, calibrada con `nvidia-smi` en el servidor real) reproduce lo medido; `-ContextSize 65536` fija un valor y con ventanas menores elige el KV más preciso (`auto`: 32k → `q8_0`, 16k → `f16`). Si no cabe, **se niega a arrancar** en vez de fallar a medias. Medido: el KV `q4_0` solo cuesta +0.004 de perplejidad frente a `f16`.
- **Muestreo del fabricante:** perfil `codigo` (`temp 0.5 · top_p 0.85 · top_k 20 · min_p 0`, docs de PrismML) fijado en el servidor y en cada petición del chat. El GGUF trae por defecto el muestreo del modo thinking, que no sirve sin razonamiento.
- **Modo razonamiento (thinking) por modelo:** solo lo usa **Override-6** (`catalogo.override6.pensar` en `chat/modelo.json`: el autor midió 0 respuestas vacías). **BoldingBuilds v1 nunca razona** (deja sin respuesta el 24 % de los prompts con thinking). Se enciende en *Ajustes → Modo razonamiento* (o `-Pensar N`); `start-server.ps1` lee ese ajuste por su cuenta (`-Pensar -1` = auto). El agente razona al planificar y tras un fallo, no en cada paso, y el razonamiento nunca vuelve al historial.
- **Caché de prompt:** medido con el servidor real, los valores por defecto de llama.cpp ya reutilizan el prefijo entre turnos (4,749 de 4,839 tokens en caché); solo se limita `-cram` a ¼ de la RAM. El chat anota en `chat/timings.jsonl` cuánto reutiliza y la interfaz lo muestra.
- **Velocidad medida:** **28 t/s** de generación (límite = ancho de banda: ~5.9 GB por token, techo 43 t/s), **~630 t/s** leyendo el prompt con `-ub 256`; con 32k de contexto lleno, 20 t/s. Ni `-ub`, ni los hilos, ni el "modo turbo" del PC (la GPU sigue en 80 W) lo cambian.
- **Interfaz:** respuestas en markdown con código resaltado y medidor de hardware en vivo (GPU %, VRAM, °C, W, t/s, RAM). Estado detallado y plan: [AUDITORIA-HANDOFF.md](AUDITORIA-HANDOFF.md).
- **Editor y herramientas (nuevo):** editor de verdad con **pestañas**, escritura, **Ctrl+S** e indicador de cambios; recarga sola el archivo cuando el agente lo reescribe. **Paleta de comandos** (Ctrl+P archivos, Ctrl+Shift+P comandos), **búsqueda en todo el proyecto** (Ctrl+Shift+F), **tema claro/oscuro**, ajustes persistentes, **git** (rama, cambios y commit) y **reglas de proyecto** (`BONSAI.md`, `AGENTS.md`, `.cursor/rules`). Iconos Lucide y tipografías Inter + JetBrains Mono **servidos en local** (78 KB, sin CDN).
- **Agente y edición (tercera sesión):** **deshacer las escrituras del agente** (botón en cada tarjeta de diff y "revertir el turno" entero), **Ctrl+K** para editar la selección con el modelo (propone un diff y se acepta o se rechaza), **crear / renombrar / borrar** archivos y carpetas desde el explorador (con deshacer en archivos y renombrados) y **adjuntar imágenes**. Las reglas del proyecto ahora **entran de verdad en el mensaje de sistema**.
- **Visión (mmproj):** con `-Vision` —o sola, si el proyector está descargado— el servidor carga `Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf` (600 MiB) **en la CPU**, así que **no gasta VRAM y el contexto no baja** (+600 MiB de RAM y la codificación de cada imagen). Las imágenes adjuntas (pegadas, arrastradas o del disco) viajan como `image_url` y el modelo **las ve de verdad**: `node chat\prueba-vision.mjs` dibuja un número aleatorio y comprueba que lo lee. Sin proyector se guardan en `salida/adjuntos` y la interfaz avisa de que el modelo no puede verlas.
- **Cambiar de modelo sin salir de la app:** chip **Modelo** en la barra de estado (junto a Visión y Reglas) → eliges `Override-6` o `BoldingBuilds v1` → la app **descarga el que está en la GPU y carga el otro** (≈9 s con el GGUF en caché) conservando el historial. También está en la paleta de comandos. A mano: `.\scripts\start-server.ps1 -Modelo bolding_v1`. El chip **se ve siempre** (aunque falle la petición) y se refresca cada 15 s; la elección se guarda en `chat/modelo-activo.json` y **el arranque siguiente usa ese modelo** en vez del predeterminado del catálogo (un `-Modelo` explícito manda solo para ese arranque).
- **Tool calls a medida de cada modelo:** el dialecto con el que el modelo **escribe** su llamada cuando el servidor no la parsea se declara por modelo en `chat/modelo.json` (`catalogo.<clave>.toolcalls`) y lo traduce `chat/adaptadores.mjs` a la misma forma que las llamadas nativas, así que el agente tiene **un solo camino**. `xml-funcion` es la plantilla Qwen (`<tool_call><function=…><parameter=…>`), verificada con la salida cruda de Override-6; un modelo sin dialecto declarado se queda con el camino nativo y las heurísticas de siempre.

---

## 📂 Estructura del Proyecto

```text
prject local AI/
├── bin/                   # Binarios de PrismML llama.cpp y librerías CUDA (cublas, cudart, ggml-cuda)
├── models/                # Archivos GGUF (Ternary-Bonsai-2-27B-Abliterated-PTQ1_0.gguf)
├── chat/                  # Cliente propio (Node): terminal y navegador
│   ├── modelo.json        # Datos del modelo, catálogo y muestreo (fuente única, la leen JS y PowerShell)
│   ├── modelo.mjs         # Cuentas de VRAM y perfiles de muestreo
│   ├── adaptadores.mjs    # Dialecto de tool calls de cada modelo (se declara en modelo.json)
│   ├── procesos.mjs       # Lanza y vigila los comandos del agente: timeout, cancelación y árbol
│   ├── guardia.mjs        # Guardia anti-CSRF / anti-DNS-rebinding del servidor local
│   ├── prueba-sin-gpu.mjs # Prueba el cliente contra un servidor falso
│   ├── prueba-ui.mjs      # Pruebas del markdown y el resaltado de la interfaz
│   ├── prueba-seguridad.mjs # 32 casos: Origin/Host/Content-Type y archivos estáticos
│   ├── prueba-api.mjs     # Guardar, deshacer, buscar, reglas, ajustes, git, archivos y adjuntos
│   ├── prueba-agente.mjs  # Agente de punta a punta con llama-server falso: reglas, deshacer, Ctrl+K
│   ├── prueba-navegador.mjs # Edge/Chrome headless: editor, explorador, Ctrl+K, deshacer e imágenes
│   ├── prueba-vision.mjs  # Con -Vision: dibuja un número y comprueba que el modelo lo lee
│   ├── prueba-modelos.mjs # Cambio de modelo en caliente (descarga uno y carga el otro)
│   ├── prueba-procesos.mjs # Un comando colgado o cancelado no deja hijos vivos (árbol, timeout, abort)
│   ├── prueba-truncado.mjs # Una tool call cortada a medias (archivo grande) se recompone y se escribe
│   ├── editar.mjs         # Edición en línea (Ctrl+K): prompt acotado, reemplazo y pruebas
│   ├── ui/                # index.html + tema.css, ide.css, ide.js, app.js, iconos.js, markdown.js
│   │   ├── fuentes/       # Inter + JetBrains Mono (.woff2 locales) y su descargador
│   │   └── iconos/        # Descargador del set de iconos de Lucide
│   └── evaluar/           # Evaluador del agente: 19 tareas con el modelo real (node chat/evaluar/ejecutar.mjs)
├── scripts/
│   ├── start-server.ps1   # Servidor API local compatible con OpenAI (comprueba la VRAM antes)
│   ├── start-ui.ps1       # Servidor + chat en el navegador
│   ├── start-chat.ps1     # Servidor + chat en la terminal
│   ├── start-aider.ps1    # Servidor + Aider (ajustes en scripts/aider/)
│   ├── crear-icono.py     # Genera recursos/bonsai-ide.ico (necesita Pillow)
│   ├── crear-acceso-directo.ps1  # Crea el acceso directo "Bonsai IDE" del escritorio
│   ├── optimizar.ps1      # Calibración única con la GPU libre
│   └── test-cli.ps1       # Benchmark directo de inferencia en consola
├── recursos/
│   └── bonsai-ide.ico     # Icono del acceso directo (multi-tamaño)
└── README.md
```

---

## ⚡ Cómo Usar

### 1. Iniciar el Servidor API Local

Abre PowerShell en esta carpeta y ejecuta:
```powershell
.\scripts\start-server.ps1
```

Opciones avanzadas:
```powershell
# Solo comprobar la VRAM y ver el comando exacto, sin lanzar nada:
.\scripts\start-server.ps1 -DryRun

# Contexto fijo (el KV se ajusta solo: 32k -> q8_0, 16k -> f16); por defecto es "auto":
.\scripts\start-server.ps1 -ContextSize 32768

# Otro puerto, o liberar la VRAM tras 10 min sin uso:
.\scripts\start-server.ps1 -Port 11434 -DormirSeg 600

# Razonamiento: por defecto sigue el ajuste de la interfaz (solo Override-6 lo admite).
.\scripts\start-server.ps1 -Pensar 2048   # forzarlo con tope de 2048 tokens
.\scripts\start-server.ps1 -Pensar 0      # forzarlo apagado
```

Una vez iniciado, el servidor expone:
- **API OpenAI Compatible:** `http://127.0.0.1:8080/v1`
- **Web UI de llama.cpp:** `http://127.0.0.1:8080`

### 2. Chat propio (navegador o terminal)

```powershell
.\scripts\start-ui.ps1      # http://127.0.0.1:8787, con archivos, comandos y búsqueda
.\scripts\start-chat.ps1    # terminal; /vel muestra velocidad y caché de la última petición
```
Ambos arrancan el servidor si no está abierto (con la comprobación de VRAM a la vista) y aceptan `-Pensar N` (sin él, el del ajuste de la interfaz). El modelo se cambia desde el botón de la barra de arriba (nombre del modelo ▾). Cada petición deja una línea en `chat/timings.jsonl` (`cache_n` = tokens del prompt reutilizados, `prompt_n` = reprocesados).

### 3. Probar sin usar la GPU

```powershell
node chat\modelo.mjs                  # datos y cuentas del modelo (--tabla <MiB libres> imprime la tabla de VRAM)
node chat\bonsai-chat.mjs --self-test # empaquetado del historial
node chat\prueba-sin-gpu.mjs          # el cliente contra un llama-server falso
```

### 4. Calibrar con la GPU libre (una vez)

```powershell
.\scripts\optimizar.ps1 -Plan -Todo   # ver los comandos sin ejecutar nada
.\scripts\optimizar.ps1 -Todo         # ~10-15 min: -ub/-t más rápidos, sesgo del KV q4_0 y perplejidad f16/q8_0/q4_0
```
Se niega a correr si hay un `llama-server` abierto o la GPU no tiene VRAM libre. El resultado queda en `config/optimo.json` y lo usa `start-server.ps1`.

### 5. Benchmark de velocidad en consola

```powershell
.\scripts\test-cli.ps1
```

---

## 💻 Integración con Cursor IDE

Para utilizar este modelo como tu copiloto de código dentro de Cursor:

1. Abre **Cursor**.
2. Ve a **Settings** (`Ctrl + ,`) $\rightarrow$ pestaña **Models**.
3. En la sección **OpenAI API Key**:
   - Introduce cualquier texto falso (ejemplo: `local-key`).
4. Haz clic en **Override OpenAI Base URL**:
   - Introduce: `http://127.0.0.1:8080/v1` (o la URL de `.\scripts\start-cursor-bridge.ps1`).
5. En la lista de modelos, desactiva los modelos por defecto y añade un modelo personalizado con el nombre:
   `Ternary-Bonsai-2-27B-Abliterated-PTQ1_0` (o `bonsai-27b`).
6. ¡Listo! Todo el chat, autocompletado y edición en Cursor se procesará 100% en tu RTX 4060 sin salir de tu ordenador. Cursor usa el muestreo del servidor, que ya va fijado en `start-server.ps1`.

---

## ⚙️ Ajuste Crítico del Driver NVIDIA (Prevención de Lag)

Para asegurar que Windows nunca ralentice el modelo pasando memoria a la RAM del sistema:

1. Abre el **Panel de Control de NVIDIA** (`nvidia control panel`).
2. Ve a **Configuración 3D** $\rightarrow$ **Controlar la configuración 3D**.
3. Busca el parámetro: **CUDA - Sysmem Fallback Policy** (Política de reserva de memoria del sistema).
4. Cámbialo a: **`Prefer No Sysmem Fallback`** (Preferir no usar reserva de memoria del sistema).
5. Pulsa **Aplicar**.

---

Detalle técnico, fuentes y lista de pendientes: [ARQUITECTURA-Y-PLAN-MAESTRO.md](ARQUITECTURA-Y-PLAN-MAESTRO.md).
