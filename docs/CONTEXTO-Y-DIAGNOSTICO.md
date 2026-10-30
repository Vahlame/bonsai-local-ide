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
El ajuste solicitado de historial es 28.672 tokens y la salida del perfil de
programación reserva inicialmente 14.336. El margen de 128 y las imágenes se
descuentan de la misma ventana, así que el historial efectivo es menor cuando
corresponde. Las herramientas también ocupan entrada; el pensamiento está incluido
en la salida. Una petición excepcional puede reducir la reserva de salida y el
diagnóstico muestra el valor real.
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

La verificación final de la suite usó 43.008/F16/visión/pensamiento 4.096. Con un
prefill de 30.205 tokens, la VRAM libre mínima fue 476 MiB en una pasada y 62 MiB en
otra con más carga externa; el objetivo de aviso de 180 MiB se conserva y la prueba
avisa sin ocultar la cifra. El log confirma 34/34 capas en GPU, KV en CUDA0 y
545,62 MiB de `CPU_Mapped`, que es el mmap de apoyo del GGUF y no un offload de
cómputo. El límite real sigue siendo el margen, no la colocación de capas.

La lectura visual de varias cifras con el fixture bitmap no es fiable: una sonda con
el modelo real midió 5/21 aciertos en cadenas de 3–5 caracteres y 6/6 en un solo
dígito a escala 24. La suite lee dos imágenes de un dígito en sesiones separadas y
registra las cuatro cifras como estrés informativo. `prueba-observacion` cubre la
lectura de una palabra y cuatro dígitos con texto Arial renderizado en un navegador.
Ninguna de estas pruebas demuestra OCR general ni visión perfecta.

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

## Continuidad y compactación

Cuando el historial supera su presupuesto efectivo, el perfil general resume grupos
completos de mensajes; si el resumen falla o queda vacío, devuelve el error y restaura
la memoria y el índice anteriores. La solicitud actual no se recorta para hacerla caber.
El perfil de programación conserva el objetivo y el estado de la tarea y sustituye
grupos antiguos por extractos acotados con su procedencia; las afirmaciones del
asistente no se consideran verificadas. Los originales permanecen en la sesión local.
Los extractos pueden perder detalles, y en presupuestos extremos pueden omitirse;
el diagnóstico muestra grupos omitidos y si se eliminó la memoria extractiva.
El contexto inicial de archivos se actualiza si cambia su versión en disco; el agente
debe leer los fragmentos que no se hayan incluido. En el perfil general la caché de
lecturas dura un turno y comprueba fecha de modificación, cambio y tamaño.

El diagnóstico de Ajustes indica el conteo disponible, la reserva estimada de imágenes,
antes y después de compactar, duración y costo informado del resumen cuando el backend
lo suministra. El pensamiento es parte de la generación, no una reserva adicional.
Al pedir explícitamente «continúa» se incluye la tarea anterior y su estado guardado;
el agente debe comprobar efectos inciertos antes de repetirlos. Esto no garantiza
recuperación exacta de una operación interrumpida a mitad de ejecución.

El historial y el estado permanecen locales y excluidos de Git. Las sesiones se
escriben con reemplazo atómico y respaldo. La memoria extractiva se reconstruye del
historial, sin crear otra base de datos ni limpieza automática; elimina desde el IDE
los chats que ya no necesites y, para borrar todos sus restos locales, revisa también
los respaldos, trazas y registros en el directorio de estado. Los archivos originales
pueden contener código privado y no se eliminan solo por compactar.

## Memoria global entre chats

Es una capa aparte de la memoria de la sesión: no sustituye el historial ni el resumen
extractivo. Guarda preferencias, convenciones y decisiones estables que el usuario
querrá recuperar en otra conversación. El archivo es `memoria-global.json` dentro de
`BONSAI_STATE` (por defecto `chat/`), está excluido de Git y nunca se escribe en el
proyecto del usuario. Usa escritura atómica con `.bak`; si el archivo está corrupto se
aparta como `.corrupto-<fecha>` y se intenta el respaldo, igual que el resto del estado.

No se inyecta entera. Al empezar cada turno se puntúan las notas por coincidencia de
palabras y etiquetas contra el pedido y el objetivo de la tarea; solo viajan las
relevantes, más las fijadas, dentro de un presupuesto explícito. Sin coincidencia no se
envía nada (salvo fijadas). El presupuesto por defecto es 480 tokens, configurable
entre 0 y 2000 en Ajustes; 0 desactiva la inyección. El bloque va en el mensaje de
sistema después de las reglas del proyecto y antes de las notas de la sesión, con una
cabecera que lo declara dato recordado y no instrucción nueva. El diagnóstico muestra
tokens, número de notas y presupuesto usados en la última petición.

La captura automática es conservadora: solo considera frases del pedido con señales
de preferencia o decisión duradera, únicamente tras un turno completado o verificado,
y rechaza secretos y órdenes transitorias. Aun así es una heurística y puede fallar;
todas las notas quedan visibles en Ajustes → Memoria entre chats, donde se pueden
añadir, editar, fijar, borrar o vaciar, y probar qué se inyectaría con un pedido
concreto. También se exponen en `GET/POST /api/memoria`. La memoria no se reescribe
sola: una nota obsoleta sigue ahí hasta que se edita o se borra. Los chats nuevos no
heredan el historial de otro chat, solo estas notas seleccionadas.

El agente de programación admite varias llamadas por respuesta. Las escrituras y
reemplazos en archivos diferentes usan E/S asíncrona concurrente; los que afectan al mismo
archivo se ordenan. Antes de publicar cada cambio se comprueba que el contenido no
haya cambiado externamente. Esta comprobación reduce conflictos normales, pero no
constituye una barrera contra carreras de un proceso local adversario. Las escrituras
incrementales ofrecen `estado` y `cancelar` para recuperar o descartar partes.

La verificación automática del perfil de código comprueba sintaxis, tipos y tests
focalizados. En HTML revisa además las etiquetas y ejecuta `node --check` sobre cada
`<script>` inline ejecutable, con la línea real del documento; los scripts con `src`,
los JSON de plantilla y otros tipos no se ejecutan ni se marcan. Esto detecta scripts
rotos, pero no demuestra el comportamiento visual: para eso hace falta abrir la página
con `navegador` o `mcp_playwright` y comprobar el resultado.

`mcp_playwright` usa el servidor oficial Playwright MCP con navegador Edge aislado;
el agente puede navegar HTTP/HTTPS, inspeccionar, interactuar y consultar consola o
red. Los snapshots temporales se borran al finalizar el turno. Para un HTML sin
servidor, `navegador` sigue disponible. El bloqueo de puertos de MCP no es un
aislamiento de red completo ni cubre necesariamente todas las redirecciones; no se
conecta al perfil de navegador del usuario.

Los resultados de las pruebas locales se encuentran en `logs/audit-benchmark-*.json`,
`logs/audit-vision-*.json` y `logs/audit-coder-final/`; esos archivos son locales y
no forman parte del código versionado.
