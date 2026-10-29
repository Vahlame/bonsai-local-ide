# Contexto y diagnóstico del agente

El modelo local usa `llama-server` de llama.cpp. La ventana cargada se consulta en
`/props`; entrada, imágenes y generación comparten esa ventana. El pensamiento se
genera dentro de la respuesta y su presupuesto no es una segunda ventana. El IDE
solicita pensamiento en las generaciones nuevas de modelos compatibles; la
continuación de una respuesta ya comenzada conserva su plantilla sin abrir otro
bloque de pensamiento.

El perfil personalizado local quedó configurado por petición del usuario en 43.008 tokens, KV F16, visión
y hasta 4.096 tokens de pensamiento según la tarea. La ventana reservada para
salida y el historial efectivo dependen del ajuste y de la petición. No se
prometen 18k de historial y 18k de salida para todas las imágenes y herramientas.
Los perfiles no añaden la antigua reserva obligatoria de 400 MiB; la estimación
de arranque aún incluye buffers y proyector. La comprobación de imágenes usa un
margen transitorio de 64 MiB cuando aplica, basado en mediciones previas.

En esta RTX 4060 Laptop se probó 39.936/F16 con proyector: una petición de
27.702 tokens de texto y una imagen fue procesada, y la imagen de control se leyó
correctamente. El mínimo observado fue 546 MiB libres. En un benchmark corto,
la generación rondó 42 tokens/s y el procesamiento de 512–2.048 tokens de prompt
1.530–1.681 tokens/s. Es una medición puntual, no una garantía contra OOM con
otras imágenes, cargas o aplicaciones. Otra imagen de control de cuatro cifras se
leyó incompleta, por lo que no debe asumirse visión perfecta.

También se probó 43.008/F16 con visión y 40.531 tokens de entrada: tres cargas
pasaron, pero en las repeticiones el mínimo observado llegó a solo 106 MiB libres.
Con 44.032 hubo un error CUDA de memoria. Por eso 43.008 es una selección manual
con margen limitado, no el techo automático conservador ni una garantía de
estabilidad; el pensamiento de 4.096 tokens completos no se ejercitó en esa prueba.

En Ajustes → presupuesto de contexto, «Diagnóstico de la última petición» muestra
la ventana, salida, tokens contados o estimados, método de conteo, herramientas,
resultados, imágenes, compactación, tiempos y VRAM. También está disponible como
`contextDiagnostics` en `/api/state`; las trazas del perfil de código se guardan
en `chat/agent-traces/` o en el directorio `BONSAI_STATE`. Los componentes
marcados como estimación no son conteos exactos del chat template.

Para archivos nuevos grandes, `escribir_partes` devuelve un id y el offset en
bytes UTF-8 que debe usarse para continuar o finalizar. Los fragmentos pendientes
se guardan fuera del proyecto; la publicación final es atómica y no sobrescribe
un archivo aparecido durante la operación. El límite actual de archivo es 1,5 MB,
anunciado al iniciar. Para archivos existentes se usa `reemplazar` con una
coincidencia única. Las salidas de comandos tienen un id para `consultar_salida`;
se guardan hasta 64 MiB y se marca si se alcanza ese límite.

Los resultados de las pruebas locales se encuentran en `logs/audit-benchmark-*.json`,
`logs/audit-vision-*.json` y `logs/audit-coder-final/`; esos archivos son locales y
no forman parte del código versionado.
