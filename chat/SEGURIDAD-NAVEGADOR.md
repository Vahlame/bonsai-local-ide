# Perfiles del navegador del agente

El perfil predeterminado es **desarrollo**: mantiene WebGL, workers, service workers,
dependencias CDN, APIs y WebSocket/HMR. Permite diagnosticar JavaScript con `evaluar`
y usar aplicaciones con varios servicios. Los puertos del IDE y del modelo siguen
bloqueados. El navegador siempre usa un perfil temporal independiente del usuario.

El texto siguiente describe el perfil opcional **aislado**, activado con
`BONSAI_BROWSER_POLICY=aislado` antes de arrancar el IDE. Este perfil sirve para
pruebas que deben limitar la comunicación de la aplicación a un único origen.

En el perfil aislado, por cada acción `abrir` se permite HTTP y HTTPS únicamente al origen exacto elegido (esquema, host y puerto); al abrir un HTML del proyecto se usa el servidor temporal que lo sirve. Se comprueba también cada conexión saliente mediante un proxy local, porque las redirecciones no siempre vuelven a pasar por el filtro de solicitudes de Playwright. Las peticiones a otros puertos locales, sitios externos y otros orígenes se bloquean. Los puertos del IDE y del modelo se prohíben incluso si se eligen explícitamente.

Se bloquean las conexiones WebSocket, los service workers y los constructores WebTransport, Worker y SharedWorker; el navegador desactiva QUIC y limita WebRTC, además de deshabilitar su constructor en los documentos. El bloqueo de WebSocket incluye el mismo origen, por lo que algunas aplicaciones con recarga automática o funcionalidad en tiempo real pueden necesitar otra forma de prueba. Las aplicaciones que necesitan workers tampoco funcionan íntegramente en esta vista. Los recursos del mismo origen, como imágenes, JavaScript, CSS y las API locales de la aplicación elegida, siguen funcionando. Recursos CDN y API en otro origen requieren instalarse o simularse localmente para estas pruebas.

Esta protección reduce el riesgo de comunicaciones accidentales, **no es un sandbox del sistema operativo para código hostil**. La aplicación autorizada puede recibir datos en sus propias rutas, realizar cambios o actuar como intermediario de red; un servidor local debe considerarse de confianza y no hay aislamiento de proceso del sistema. Si se cambia el origen con una nueva acción `abrir`, se descarga la página anterior antes de autorizar el nuevo. El agente también puede ejecutar comandos en el proyecto con su herramienta de terminal, que tiene permisos distintos y no queda restringida por esta política del navegador.

Ejecuta `node chat/prueba-navegador-aislamiento.mjs` para verificar con un colector local y datos ficticios los intentos de comunicación, redirecciones, WebSocket y selectores de controles repetidos.
