# Changelog

Todos los cambios relevantes de Bonsai Local IDE se documentan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
versionado semántico.

## [1.7.0] - 2026-10-31

### Añadido

- **Model Hub**: catálogo curado, búsqueda real en Hugging Face, descarga
  reanudable con verificación SHA-256, importación de GGUF locales y borrado
  seguro. Interfaz propia en el IDE (botón **Modelos** y menú del chip).
- **Plan de motor por modelo**: `chat/model-plan.mjs` lee la cabecera GGUF
  (capas, cabezas KV, `full_attention_interval`, ventana deslizante, contexto
  nativo) y calcula contexto, KV y visión GPU/CPU con la VRAM real. Los modelos
  descargados se registran en `models/hub-catalog.json` y aparecen en el selector
  sin reiniciar.
- **Plan con ventana deslizante**: Gemma 3 4B pasa de 61k a **131k** porque solo
  5 de sus 34 capas guardan KV por token; las locales usan una ventana fija.
- **Decodificación especulativa por modelo**: Qwen2.5 Coder 7B + draft Qwen2.5
  0.5B pasa de 47,2 a 68,8–71,8 tok/s (1,46–1,52×) con +469 MiB de VRAM.
- **Tool calls de Qwen2.5 Coder**: adaptadores `function-call`, `xml-json` y
  `tools-json` para sus tres envoltorios de texto.
- **Model Lab** (`scripts/model-lab.mjs`): arranca cada modelo con su plan y mide
  arranque, VRAM pico, ventana real, TTFT, tok/s, JSON, código ejecutado,
  tool-calling, retrieval y visión.
- **Preset Automático** en la barra del servidor (`/api/server/start` con
  `AUTO`) y auto-plan al cambiar de modelo desde el selector.
- **Benchmark de calidad por modelo** (`bench-model-quality.mjs --model`), con
  el plan AUTO del modelo en vez del preset de Ornith.
- Investigación [STRATA-Y-MEMORIA](docs/STRATA-Y-MEMORIA.md): cómo reparte
  Strata GPU/RAM/SSD, KV streaming, caché de expertos, MTP y qué se puede
  aplicar a llama.cpp en 8 GB.
- Documentación [MODEL-HUB](docs/MODEL-HUB.md) y pruebas
  `chat/model-plan.mjs` + `chat/prueba-model-hub.mjs`.

### Cambiado

- El lanzador optimizado y `start-server.ps1` fusionan el registro del Hub;
  `Get-RequiredMiB` usa el KV real del GGUF cuando existe.
- El chat oculta modelos auxiliares (borradores) y los identifica con `oculto`.

## [1.6.2] - 2026-10-30

### Corregido

- **El acceso directo del escritorio no abría ninguna ventana**: llevaba
  `-NoBrowser`, que arranca la interfaz pero no abre el IDE. Ahora abre la ventana de
  aplicación sin GPU; `scripts/crear-acceso-directo.ps1` genera el acceso correcto y
  la prueba de perfiles comprueba que no vuelva a colarse ese flag.

## [1.6.1] - 2026-10-30

### Añadido

- **Ventana de aplicación sin GPU** (`scripts/open-ide.ps1`): Edge/Chrome en modo
  `--app` con rasterizado por software y perfil aislado. Verificado: 0 MiB de VRAM
  con el IDE abierto. `-Tab` para pestaña normal con los mismos flags.
- Cabecera del IDE en una sola línea a 1920×1080, selector de preset compacto y
  «Iniciar» como acción principal.
- Burbuja de usuario a la derecha, guía vertical en las respuestas y animación de
  entrada solo para mensajes nuevos; `prefers-reduced-motion` respetado.
- Barra de estado con ajuste en varias líneas y medidas de hardware que se ocultan
  en pantallas estrechas.

### Cambiado

- Tema Arena con acento verde oliva (identidad Bonsai).
- La UI deja de pintar la pestaña en una ventana de navegador con cromo cuando se
  lanza desde el acceso directo.

### Corregido

- Sin `backdrop-filter` ni blur: el IDE no pide aceleración por GPU en ningún punto.
- El texto del resumen de estado ya no se corta en el borde derecho.
- **Toasts duplicados**: `app.js` creaba un segundo contenedor `.avisos` y los avisos
  se repartían entre dos cajas; ahora todos usan `#avisos`. Esto además arreglaba la
  prueba de humo de Ctrl+K, que leía la caja vacía.

## [1.6.0] - 2026-10-30

### Añadido

- **110.592 tokens con visión y KV q8_0** en la RTX 4060: el proyector de visión
  (879 MiB) pasa a RAM con `--no-mmproj-offload`. Retrieval real a 87.433 tokens.
- Presets `8GB-VISION-MAX-Q8-100K` (por defecto), `8GB-VISION-MAX-Q4` y
  `8GB-VISION-MAX-F16`.
- Reparto de contexto automático (historial = ventana − pensamiento − respuesta) y
  compactación estructurada con tope del ~6 % de la ventana.
- Benchmark de proyecto complejo con `node --test` real y gráficas SVG nuevas
  (`context-kv`, `context-split`, `vision-projector`, `bench-sampling`,
  `bench-project`).

### Corregido

- El pensamiento ya no se come la respuesta: va dentro de la reserva de salida.
- `--prompt-cap 0` deja de limitar el historial a 8.192 tokens.
- Pruebas ajustadas al muestreo y techos medidos (40/40 en verde).

## [1.5.0] - 2026-10-30

### Cambiado

- **Preset por defecto `8GB-VISION-MAX-F16`**: 43.008 tokens con KV **f16**,
  visión y pensamiento (4096). Es el techo medido en RTX 4060 8 GB (7.481 MiB);
  45.056 falla con OOM en prefill largo.
- **Ciclo de vida robusto del servidor**: Node lanza el lanzador con
  `windowsHide` + `unref()` (sin `detached`) y el wrapper PowerShell usa
  `Start-Process -NoNewWindow` + `WaitForExit()`. El modelo sobrevive al cierre de
  la UI/navegador.
- **Panel de servidor funcional en el IDE**: selector de preset, **Iniciar**,
  **Detener** y **Terminal** (copia un comando PowerShell con rutas absolutas,
  generado en el servidor).

### Corregido

- **Presets con KV inválido**: `IQ4_XS`, `IQ2_XS` e `IQ1_S` son cuantizaciones de
  **pesos**, no de caché KV; `llama-server` salía al arrancar. Los presets
  `8GB-VISION-ULTRA` (ahora 36k q4_0), `8GB-VISION-HIGH` (32k q8_0),
  `8GB-CODE-MAX` (48k q4_0) y `8GB-RESEARCH` (64k q4_0) usan tipos válidos.
- `start-gpu-model-rtx4060-optimized.ps1` ya no sale antes de tiempo (mataba el
  modelo en Windows).
- `stop-managed-server.ps1` reconoce el binario optimizado sm89 y el lanzador
  optimizado, así que **Detener** funciona y permite reiniciar.
- La UI ya no se cae al arrancar sin modelo cargado.
- Error de sintaxis en `chat/ui/ide.js` que impedía ejecutar el panel de servidor.
- El comando del botón Terminal ya no usa `%~dp0` (inválido en PowerShell).

### Añadido

- `scripts/benchmark-rtx4060-matrix.ps1` y `scripts/probe-rtx4060-context.ps1`
  (mediciones reproducibles).
- Gráficos SVG en `docs/graficos/` (presets, techo de contexto, calidad KV).
- Guía de ciclo de vida y tuning en `docs/RTX4060_OPTIMIZATION_GUIDE.md`.

## [1.2.0] - 2026-10-30

### Añadido

- **Memoria global entre chats**: capa separada de la memoria de sesión, guardada en el
  estado local fuera de Git. Selección por relevancia léxica contra el pedido y el
  objetivo, notas fijadas siempre dentro del presupuesto y nada inyectado si no hay
  coincidencia. Presupuesto configurable por turno (0–2.000 tokens), captura automática
  conservadora de preferencias y decisiones duraderas, y editor para revisar, añadir,
  editar, fijar, borrar y vaciar notas. API `GET/POST /api/memoria`.
- **Navegador Playwright MCP aislado** (`mcp_playwright`): abre páginas HTTP/HTTPS,
  inspecciona el árbol accesible, pulsa, escribe, envía teclas, espera y consulta
  consola y red. Usa un perfil efímero por turno, bloquea los puertos del IDE y del
  modelo y no habilita evaluación arbitraria de código.
- **Control del servidor desde la interfaz**: `GET/POST /api/servidor` permite consultar,
  detener y volver a arrancar el servidor administrado sin cerrar el IDE.
- **Cancelación real del turno** (`POST /api/stop`): aborta la inferencia, las
  herramientas y los procesos del turno de forma idempotente.
- **Escritura por partes recuperable**: `estado` recupera el offset tras una interrupción
  y `cancelar` descarta las partes pendientes.
- **Diagnóstico de JavaScript inline en HTML** con `node --check`, además de la
  comprobación estructural.
- Suites nuevas para memoria global, compactación, cancelación y cierre, registros,
  Playwright MCP y pruebas reales opcionales de contexto, carga y multivisión.
- Evidencia publicable de la release en `docs/evidencia/2026-10-30/`.

### Cambiado

- **Prompt del agente** dividido en reglas generales, flujo de trabajo y uso de
  herramientas; las fases del coder distinguen conversación, edición, verificación y
  cierre. El coder recibe además `navegador`, `buscar`, `leer_web` y `mcp_playwright`.
- **Validación de lotes de herramientas**: límites por tipo de llamada, rechazo de
  escrituras conflictivas sobre el mismo archivo y límites de repetición con mensajes
  que explican cómo continuar.
- **Estado del coder** más útil y acotado: símbolos, acciones y último diff, con
  compactación por presupuesto y conservación del plan cuando cabe.
- Un archivo escrito en el turno queda marcado como inspeccionado: corregirlo ya no
  exige volver a leerlo.
- **Escrituras concurrentes** en archivos distintos con colas por ruta, temporales
  independientes y precondición contra cambios externos.
- Los diagnósticos de contexto incluyen memoria global (tokens, entradas y presupuesto)
  y detalles de compactación.
- `start-ui.ps1` propaga `KVCacheType` en perfiles `CUSTOM`, respeta el KV y la visión
  guardados y falla si la visión configurada no tiene proyector.
- Saludos breves como `hi`, `hello` o `hey` se reconocen como conversación y no activan
  una tarea sobre el proyecto.
- El runner separa **`test:gpu`** (servidor cargado) de **`test:gpu-exclusiva`**
  (calidad KV, GPU libre); `test:todo` ejecuta las cuatro familias.
- La prueba de GPU trata `CPU_Mapped` como mmap de apoyo del GGUF, no como pesos de
  cálculo; conserva el aviso de 180 MiB de VRAM y solo falla si la memoria se agota o no
  puede medirse. La prueba de visión lee dos imágenes de un dígito y mide las cuatro
  cifras como estrés informativo. El cambio de modelo sin segundo perfil GPU verifica el
  rechazo 409 sin tumbar el servidor.

### Corregido

- El botón **Detener** ya no deja el servidor generando ni `busy` bloqueado en 409.
- Tras una verificación correcta y sin escrituras nuevas, el agente cierra y pide el
  resumen en lugar de encadenar lecturas indefinidamente.
- Reescribir un archivo recién creado por el propio agente ya no se bloquea por no
  haberlo leído antes.
- Las lecturas de registros están acotadas en líneas y longitud, incluso con líneas de
  decenas de MiB, y decodifican UTF-8 entre bloques.
- Los errores de memoria de GPU se señalan como tales y dejan la tarea incompleta sin
  perder el estado guardado.
- Los diagnósticos HTML detectan scripts inline rotos que antes solo aparecían al abrir
  la página.

### Seguridad

- La memoria global rechaza secretos, vive fuera del proyecto y de Git, y nunca se
  inyecta completa.
- El navegador MCP no se conecta al perfil del usuario, no evalúa código arbitrario y
  protege los puertos del IDE y del modelo.
- Las escrituras atómicas comprueban la ruta y el contenido previo antes de sustituir.

### Pruebas

- `npm test`: **40/40** suites, 125,3 s.
- `npm run test:navegador`: **5/5** suites, 16,4 s.
- `npm run test:gpu`: **4/4** suites, 95,4 s.
- `npm run test:gpu-exclusiva`: **1/1** suite, 89,6 s.
- Calidad KV: A (32K, q8_0, visión) **8/8**; B (16K, f16, visión) 6/8; C (32K, f16,
  sin visión) 6/8. Pasada única, no medida estadística.

## [1.1.0] - 2026-10-29

### Añadido

- Prompt de sistema más claro y selección de herramientas orientada a la intención.
- Conservación y diagnóstico del contexto, presupuesto de salida y conteo mediante
  llama-server cuando está disponible.
- Escritura incremental para archivos nuevos grandes y consulta de salidas de comandos.
- Perfiles de GPU, visión, pensamiento y perfil manual de 43.008 tokens para el equipo
  probado.
- Auditoría técnica y hoja de ruta en `docs/AUDITORIA-PROFUNDA-2026-10-29.md`.

[1.2.0]: https://github.com/Vahlame/bonsai-local-ide/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Vahlame/bonsai-local-ide/releases/tag/v1.1.0
