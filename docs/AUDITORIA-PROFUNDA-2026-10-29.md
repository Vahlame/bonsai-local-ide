# Auditoría técnica y plan de continuidad · 29 de octubre de 2026

Este documento es un encargo ejecutable para la próxima sesión. Describe el código y las mediciones disponibles al preparar la versión 1.1.0; distingue observaciones de hipótesis y pendientes. No reemplaza una prueba real bajo carga. Prioridad: **correctitud, contexto, herramientas, edición, estabilidad de GPU, visión, velocidad y simplicidad**.

## Condiciones que deben conservarse

- El usuario eligió **43.008 tokens**, KV **F16**, visión con proyector BF16 y pensamiento disponible. Es una selección manual de esta máquina, no un valor reproducido por Git ni una garantía de estabilidad. El techo automático de visión del catálogo es 39.936. No forzar cuantización de KV, desactivar visión o pensamiento, ni restaurar una reserva fija de 400 MiB para aparentar estabilidad.
- Los ajustes, sesiones, modelos, ejecutables y logs locales están excluidos de Git. La fuente de la release **no contiene pesos, proyector ni runtime CUDA**, ni configura por sí misma la máquina del usuario. Revisar los requisitos del README.
- El agente debe responder saludos y consultas conceptuales sin explorar el proyecto; usar herramientas cuando la petición lo requiera. Mantener el system prompt breve y el pensamiento adaptable, respetando la preferencia del usuario de tenerlo disponible en modelos compatibles.
- El workspace no es un sandbox de seguridad: la shell hereda los permisos del usuario. Mantener controles para operaciones destructivas/externas, protección ante escrituras concurrentes y rutas fuera del proyecto; evitar obstáculos arbitrarios a cambios legítimos.
- No alterar silenciosamente el contexto o modelo elegidos. Avisar cuando un límite o un error obligue a degradar una petición; conservar los avances y la información necesaria para reanudar.

## Mapa real de ejecución

`scripts/launch-ide.ps1` / `start-ui.ps1` → [servidor de UI](../chat/ui-server.mjs) y [frontend](../chat/ui/app.js) → [agente](../chat/bonsai-chat.mjs) y [harness](../chat/coder-harness.mjs) → `llama-server` de llama.cpp → GGUF y, para visión, `mmproj`. El servidor responde por HTTP/SSE; hay un solo servidor de inferencia administrado y una ranura en la configuración evaluada. Consultar `/props` y el estado efectivo, no inferir la configuración a partir del selector de la UI. El catálogo está en [modelo.json](../chat/modelo.json), los presets en [local-engine-presets.json](../config/local-engine-presets.json) y el presupuesto en [bonsai-chat.mjs](../chat/bonsai-chat.mjs).

El perfil evaluado es Ornith-1.5-9B Q4_K_M (archivo GGUF de aproximadamente 5,78 GB), RTX 4060 Laptop de 8.188 MiB y proyector BF16 de aproximadamente 922 MB. La ubicación real de pesos, KV, proyector y buffers depende del runtime y los argumentos. No hay aquí una medición desglosada suficientemente fiable de **todos** los buffers: obtenerla antes de afirmar cuánto ocupa cada componente.

## Resultados medidos y límites

| Configuración / carga | Resultado observado | Interpretación |
| --- | --- | --- |
| 39.936, F16, visión; 27.702 tokens y una imagen | Procesó la petición; mínimo muestreado de 546 MiB libres | Prueba puntual, no garantiza estabilidad con otra imagen o sesión. |
| 40.960, F16, visión | Tres entradas de ~38.483 tokens; en otra serie ~33.491 con pensamiento habilitado. Se observaron mínimos de ~502 y ~297 MiB respectivamente | Condiciones distintas; el muestreo no asegura capturar el pico instantáneo. |
| 41.984, F16, visión; ~39.507 tokens | Una prueba pasó, mínimo ~470 MiB | Una pasada no demuestra estabilidad. |
| 43.008, F16, visión; ~40.531 tokens | Tres peticiones pasaron; dos repeticiones llegaron a 106 MiB libres | Elección explícita del usuario con riesgo alto de OOM bajo cargas diferentes. No se ejercitó una generación de 4.096 tokens completos de pensamiento. |
| 44.032 / 45.056 | Error CUDA de memoria / error de asignación de recursos CUBLAS | No establecer estos valores como estables; los picos reales pueden superar los muestreados. |

En una medición corta a 39.936 se observaron ~1.530–1.681 tokens/s al procesar prompts de 512–2.048 tokens y ~42 tokens/s de generación; con contexto muy largo, ~31–35 tokens/s. No son comparables sin fijar prompt, salida, temperatura, energía y carga de GPU. La visión leyó correctamente una imagen de control y leyó otra de cuatro cifras de forma incompleta. Los logs originales son privados/locales y no acompañan la release; [contexto y diagnóstico](CONTEXTO-Y-DIAGNOSTICO.md) recoge otras condiciones y límites.

## P0: estabilidad, integridad y contexto

### 1. Probar y recuperar OOM sin perder trabajo

**Evidencia:** 43.008 con imágenes llegó a 106 MiB libres; 44.032 falló. El chequeo transitorio de imagen de 64 MiB y los cálculos de arranque no demuestran que un prompt largo, visión y una salida larga quepan juntos. El valor de GPU libre muestreado puede no coincidir con el pico de asignación. El reinicio y la recuperación del modelo no equivalen a una recuperación demostrada de una tarea en curso.

**Implementar:** construir pruebas con presupuesto real, 1–varias imágenes y tamaños variados, prompt al 50/80/95 % y generaciones progresivas, incluida una salida extensa con pensamiento. Tomar VRAM usada/libre, tiempo de primer token, procesamiento, generación, errores, temperatura/potencia si son accesibles y perfiles de proceso. Confirmar explícitamente las asignaciones para pesos, KV, proyector y buffers en logs de llama.cpp. Ensayar varias ejecuciones y cargas externas controladas. Añadir señales claras de presión, OOM y pérdida de conexión, y recuperación de tarea que no repita escrituras ni comandos; una eventual reducción de contexto debe comunicarse y respetar el ajuste elegido. **No definir otro margen fijo sin evidencia.**

**Aceptación:** el IDE identifica el fallo, conserva objetivo, cambios y estado, muestra qué ocurrió y ofrece una vía para continuar. Registrar la combinación concreta que pasó; si 43.008 no sobrevive, decirlo sin presentarlo como estable.

### 2. Memoria real durante tareas prolongadas

**Evidencia:** `packCoderHistory()` conserva grupos mientras caben, pero al llegar al límite elimina primero conversaciones anteriores y luego grupos antiguos; puede recortar un resultado y retirar mapa/contexto. Guarda estado de tarea, pero eso **no garantiza una compactación semántica completa**. El modo general usa otra estrategia y `MEMORY_CAP_TOKENS = 2000` en [context.mjs](../chat/context.mjs): puede resumir y limitar notas. La sesión persistida no implica que todo siga dentro de cada petición. Una ventana de 43.008 comparte entrada, definiciones de tools, imagen y generación; no son 43k de historial más salida. El pensamiento generado consume salida/contexto, no una segunda ventana.

**Implementar:** unificar el contrato observable de ambos caminos; conservar objetivo, restricciones, decisiones, rutas/símbolos, cambios, errores, próximos pasos y estado de ejecución como estructura compacta actualizable. Referenciar contenido recuperable y evitar relecturas si no cambió, invalidando cachés al editar. Compactar por prioridad y grupos coherentes assistant/tool, con detalle de qué se omitió y por qué. No resumir ciegamente todo a 2k ni sustituir instrucciones recientes. Definir protocolo de reanudación después de reinicio.

**Aceptación:** pruebas de tareas multivuelta que atraviesen compactaciones y fallos de resumen, con archivos modificados, errores y llamadas; comprobar hechos críticos en peticiones posteriores y ausencia de respuestas de herramientas huérfanas. Medir tasas de relectura y memoria retenida.

### 3. Conteo y diagnóstico de extremo a extremo

**Evidencia:** se intenta `/v1/chat/completions/input_tokens`, con alternativas de plantilla/tokenización y una estimación de respaldo; los componentes del diagnóstico son estimaciones y las imágenes tienen reserva. La reserva de salida, el margen de 128 tokens, el tope solicitado y las imágenes son conceptos diferentes. Las cifras pueden variar según fase y capacidades reales del servidor.

**Implementar:** verificar con el runtime empaquetado que el conteo incluya plantilla, roles, herramientas y tokens multimodales; contrastar con `usage` real. Añadir identificador de petición, conteo/método exacto o estimado, entrada total y desglose no aditivo, imagen real o reserva, límite efectivo, margen, salida solicitada/real, razonamiento cuando el backend lo informe, descarte por grupo, motivo, tiempos, velocidad y VRAM. Señalar explícitamente cualquier fallback de tokenizador o ventana. Evitar almacenar texto privado innecesario en trazas; habilitar exportación controlada y limpieza.

**Aceptación:** pruebas de límites para español/código/JSON, tool calls, imágenes y errores de endpoint; no sobrepasar la ventana ni presentar estimaciones como conteos exactos. La UI debe mostrar datos de la última petición correcta y del fallo.

## P1: agente y herramientas

### 4. Intención, system prompt y evaluación funcional

**Evidencia:** el prompt principal es breve y `esCharla()` usa heurísticas; no es un clasificador completo. `small-local-coder` tiene fases y 14 herramientas, incluida planificación, pero no dispone directamente de las herramientas generales de investigación web. La heurística de verificación no prueba por sí sola que se cumplieron todos los requisitos. El perfil admite hasta 400 pasos y reparaciones limitadas; un límite alto no garantiza progreso.

**Implementar:** crear corpus de saludos, preguntas conceptuales, investigación, preguntas del repo, ediciones, errores, imágenes y solicitudes mixtas. Medir acciones innecesarias, omisiones y cumplimiento. Resolver rutas sin rediseñar el agente como una cadena de clasificadores frágiles; habilitar investigación cuando la tarea la necesita, con permisos existentes. Añadir detección basada en argumentos normalizados y efectos reales para lecturas/búsquedas/comandos repetidos, sin bloquear reintentos justificados después de cambios. Verificar requisitos del usuario contra diff y resultados relevantes, con una sola batería de pruebas adecuada en vez de ejecuciones redundantes.

**Aceptación:** «hola» no llama herramientas; una pregunta sobre archivos sí puede leerlos; editar modifica y verifica; las llamadas repetidas sin evidencia se detienen con una explicación útil. Medir resultados con el modelo real además de mocks.

### 5. Edición grande y durabilidad

**Evidencia:** [escritura incremental](../chat/escritura-incremental.mjs) permite archivos nuevos por offset UTF-8 y publicación final sin sobrescritura, con límite anunciado de 1,5 MB. Los archivos existentes usan reemplazo por coincidencia única. No hay un mecanismo general equivalente a aplicar un diff unificado con resolución de conflictos; los staging y logs pueden quedar en disco después de interrupciones.

**Implementar:** soporte de cambios localizados verificables por rango o patch y precondición de contenido/versión, sin perder cambios externos. Reanudar o cancelar escrituras incompletas, mostrar byte/offset, evitar duplicación en reintentos y definir limpieza explícita con TTL configurable. Ensayar Unicode, archivos extensos, interrupción en cada fase, destino que aparece y cambios concurrentes. Mantener atomicidad y recuperación para operaciones grandes; anunciar límites antes de generar datos.

**Aceptación:** crear un archivo de 100k caracteres por partes, reanudar tras interrupción y editar un archivo grande sin reescribirlo por completo; pruebas de conflicto y de rutas seguras pasan en Windows.

### 6. Terminal, procesos y salida

**Evidencia:** las salidas se almacenan hasta 64 MiB y `consultar_salida` permite recuperar secciones. [ui-server.mjs](../chat/ui-server.mjs) escribe fragmentos de forma síncrona; leer una salida grande puede presionar memoria y bloquear el bucle de eventos. El estado de los procesos depende del ciclo de vida del servidor. Registros y escrituras pendientes pueden contener código privado.

**Implementar:** paginación/búsqueda de logs mediante streaming e índices de byte, escritura con backpressure y manejo visible de error de disco; conservar exit code, timeout, señal y estado parcial. Distinguir proceso vivo, terminado, cancelado, colgado y servidor reiniciado. Añadir caducidad y eliminación controlada para registros, sin perder un proceso activo.

**Aceptación:** tests con salida de muchas líneas y 64 MiB, Unicode, fallo de disco, cancelación y proceso prolongado; la UI sigue respondiendo y muestra truncamiento real.

### 7. Schemas y errores del modelo

**Evidencia:** el coder usa esquemas estrictos y validación en [coder-harness.mjs](../chat/coder-harness.mjs). Las herramientas nativas dependen de que el modelo reproduzca JSON y argumentos correctamente; la recuperación y sus límites deben medirse con el modelo real.

**Implementar:** medir tokens de definiciones y tasa de fallos por herramienta. Normalizar solo errores inequívocos y seguros (por ejemplo, tipos o campos conocidos) sin adivinar rutas ni contenidos; devolver error accionable y permitir reparación limitada. Probar llamadas incompletas y lotes parcialmente válidos sin duplicar efectos. Mantener pocas herramientas con descripciones concretas.

**Aceptación:** tests de JSON incompleto, argumentos desconocidos, rutas inválidas y repetición tras fallo; las operaciones válidas se realizan una vez y los errores quedan visibles.

## P1: visión y capacidades por modelo

**Evidencia:** el envío depende de capacidades y proyector configurados; la serialización y los límites de imágenes están en `ui-server.mjs` y `bonsai-chat.mjs`. Las imágenes de una tarea pueden mantenerse en memoria, pero no debe asumirse persistencia de sus bytes tras reinicio. La prueba actual de cuatro cifras no demuestra comprensión visual general. El catálogo fija `imageMaxTokens: 512`; el runtime emitió un aviso de Qwen-VL sobre 1.024 tokens mínimos para tareas de grounding. Esto requiere verificar su aplicabilidad a este modelo, no afirmar que toda visión esté rota.

**Implementar:** consultar `/props` y metadata real, validar compatibilidad GGUF/mmproj, plantilla y capacidades efectivas. Probar imagen única y múltiple, formatos/tamaños, OCR opcional, referencias espaciales, interfaz y lectura de código, también en contexto lleno. Comparar 512 frente a 1.024 o más tokens de imagen y medir VRAM/precisión. Si no cabe o falta soporte, informar antes de mandar; nunca descartar una imagen silenciosamente. Definir persistencia optativa y segura de adjuntos, incluyendo su eliminación.

**Aceptación:** tests integrados verifican que los bytes llegan al modelo compatible, que se informa de adjuntos omitidos y que un modelo solo texto los rechaza claramente. Publicar métricas por tipo de tarea sin sobreinterpretar aciertos puntuales.

## P2: rendimiento y capacidades del modelo

**Evidencia:** presets, catálogo, opciones de UI, parámetros de arranque y estado local se superponen. El perfil seleccionado no necesariamente equivale al perfil realmente cargado; varias cifras históricas de documentación describen configuraciones anteriores. Los presets permiten visión, pero solo si existe soporte y proyector. Existen vías alternativas y límites diferentes entre agentes.

**Implementar:** centralizar metadata/capacidades con procedencia (`/props`, GGUF, configuración explícita, desconocido), versión y validación; evitar afirmar tools, visión, pensamiento, context window o max output por nombre exclusivamente. Mostrar valor solicitado y efectivo por cada parámetro y su origen. Medir batch/ubatch, Flash Attention y cache de prompt con un benchmark reproducible; evaluar cualquier configuración alternativa como opción explícita, sin cambiar las preferencias del usuario. Comparar resultados con y sin saturación de RAM/VRAM y con carga térmica sostenida. No inferir máxima estabilidad de una cifra de VRAM ocupada.

**Aceptación:** diagnóstico reproducible en frío y caliente, rendimiento p50/p95 y calidad para el mismo corpus, con versión de llama.cpp y modelo, contexto, KV y proyector. Los fallbacks se registran con motivo y se muestran al usuario.

## P2: IDE, UI y experiencia

**Evidencia:** UI y servidor contienen flujos extensos y límites distribuidos; la interfaz expone perfil, contexto y diagnósticos, pero hay que verificar accesibilidad, claridad de unidades y persistencia en reinicio. Los binarios, pesos y ajustes locales no forman parte del repositorio.

**Implementar:** revisar estados de carga, error, cancelación, conectividad, instalación y actualización; mostrar diferencias entre ventana del servidor, historial pedido, entrada real, salida y pensamiento. Mostrar progreso de escritura y procesos largos sin congelar la UI. Probar teclado, foco, lectores de pantalla, escalado Windows, temas y paneles pequeños. Comprobar conflictos de guardado, pestañas grandes, archivos externos, Git y diagnósticos en proyectos reales. Reducir responsabilidades del servidor por módulos solo cuando mejore pruebas y coherencia; evitar una reescritura cosmética.

**Aceptación:** prueba de navegador de recorrido completo más pruebas manuales con pantalla pequeña y teclado. Una instalación limpia tiene instrucciones reproducibles para runtime, modelo, proyector y primer arranque, y errores útiles cuando faltan.

## Seguridad, privacidad y publicación

Revisar symlinks/junctions y condiciones de carrera en [archivos-seguros.mjs](../chat/archivos-seguros.mjs); las comprobaciones de ruta no aíslan la shell. Definir qué operaciones requieren permiso, proteger procesos ajenos y destinos fuera del workspace y probar conflictos de archivos. Las trazas, capturas, resultados de herramientas y staging pueden incluir datos sensibles: mantenerlos fuera de Git, minimizar retención y ofrecer limpieza. Comprobar el contenido preparado con `git diff --cached` y búsqueda de secretos antes de publicar. No subir modelos, binarios, sesiones ni credenciales por accidente.

## Orden de ejecución recomendado para la próxima sesión

1. Confirmar estado y preferencias reales de la máquina, versión del servidor y capacidad libre; no cambiar la configuración del usuario sin comunicarlo. Reproducir un fallo/contexto largo y conservar datos de prueba sanitizados.
2. Implementar y probar recuperación de OOM y de sesión; instrumentar el conteo de tokens y la memoria antes de optimizar.
3. Corregir retención/compactación y añadir evaluación de intención y edición sobre proyectos medianos/grandes; verificar resultados y evitar relecturas.
4. Mejorar escritura, terminal y tool calling con pruebas de interrupción y de seguridad reales; verificar privacidad de artefactos.
5. Validar visión y capacidades por modelo, y después medir variantes de parámetros bajo carga sostenida con valores comparables.
6. Completar UI/accesibilidad, instalación y distribución; documentar mediciones, limitaciones y los cambios efectivos, sin afirmar validaciones no ejecutadas.

Pruebas base: `npm test` y `npm run test:navegador`. `npm run test:gpu` requiere modelo/servidor reales y puede utilizar mucha VRAM: comprobar sus requisitos y coordinarlo con cualquier tarea activa. Para rendimiento usar los scripts de benchmark y conservar configuración, logs sanitizados y artefactos de cada corrida. Las pruebas con mocks no sustituyen las de modelo real.
