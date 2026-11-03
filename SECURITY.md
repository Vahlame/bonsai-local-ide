# Seguridad

Bonsai Local IDE ejecuta un agente con acceso al proyecto, a la terminal y a un
navegador controlado. Está diseñado para uso local en `127.0.0.1`, no para exponerse a
Internet.

## Versiones soportadas

| Versión | Soporte |
| --- | --- |
| 2.5.x | Sí |
| 2.4.x | Solo correcciones críticas |
| 2.3.x y anteriores | No |

## Cómo informar de una vulnerabilidad

No publiques un fallo de seguridad en una incidencia abierta. Usa el
[aviso privado de seguridad de GitHub](https://github.com/Vahlame/bonsai-local-ide/security/advisories/new)
e incluye:

- versión y sistema operativo;
- pasos mínimos para reproducirlo;
- impacto observado (lectura/escritura fuera del proyecto, ejecución no autorizada,
  fuga de datos, bloqueo del servidor, etc.);
- logs o capturas **sin secretos ni rutas personales**.

Se acusará recibo y se coordinará la corrección y la divulgación.

## Modelo de seguridad

- La interfaz escucha en loopback por defecto y no pide autenticación en ese caso. Un
  `--host` que no sea loopback se rechaza salvo que se pase `--unsafe-lan` **y** un token
  de al menos 16 caracteres (`--token` o `BONSAI_UI_TOKEN`). Con token, la primera visita
  a `/?token=...` deja una cookie de sesión; la API también acepta `X-Bonsai-Token` o
  `Authorization: Bearer`. No expongas el IDE a Internet ni a una red no confiable.
- La API del modelo (`8080`) sigue siendo local; no la publiques fuera de la máquina.
- El agente conserva los permisos del usuario de Windows. Las comprobaciones de comandos
  no son un sandbox del sistema operativo.
- Las herramientas de archivos rechazan rutas fuera del proyecto, enlaces y junctions.
  Las escrituras usan temporales y comprobación de cambios previos.
- Una política central (`chat/rutas-sensibles.mjs`) bloquea `.env*`, `.git`, `.ssh`,
  credenciales y claves privadas en lectura, escritura, servidor estático y comandos.
  El agente no puede leerlas ni exfiltrarlas con `type`, `cat` o un one-liner.
- El borrado de archivos y carpetas se mueve a `.bonsai-papelera` y se registra como
  renombrado reversible; una carpeta con contenido exige `confirm:true` y muestra su
  número de archivos y tamaño antes de tocarla.
- Todo acceso saliente (búsqueda web, Model Hub y descargas) pasa por
  `chat/red-segura.mjs`: resuelve todas las IPs, rechaza rangos privados/reservados,
  bloquea metadatos de nube, revalida cada redirección y **conecta a la IP ya
  comprobada** (Host/SNI originales) para cerrar el DNS rebinding. MCP puede abrir
  URLs locales a propósito para probar la aplicación, pero nunca metadatos de nube.
- La UI se sirve con CSP estricta (`script-src 'self'`), `style-src 'self'` con
  atributos inline, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer` y
  `nosniff`; no hay scripts ni bloques `<style>` inline propios. xterm inyecta
  sus propias hojas de estilo y obliga a `style-src-elem 'unsafe-inline'`; los
  estilos del IDE están en `/ui/base.css` y `/ui/drawer.css`.
- El navegador MCP usa un perfil efímero, bloquea los puertos del IDE y del modelo y no
  habilita evaluación arbitraria de código.
- La memoria global y los chats se guardan en el estado local, fuera de Git. No se
  publican con el repositorio.
- Los logs pueden contener rutas y fragmentos de código: revísalos antes de compartirlos.
  El log de peticiones lentas/5xx usa `request-id`, omite la query y redacta secretos
  y rutas absolutas; `/api/health` no lee el modelo ni el disco.

## Alcance

Quedan fuera del alcance los fallos de `llama.cpp`, del modelo, de las dependencias de
npm o del navegador instalado que no tengan un impacto específico en Bonsai Local IDE.
