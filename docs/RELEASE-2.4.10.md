# Bonsai Local IDE 2.4.10

**Fecha:** 2 de noviembre de 2026
**Tema:** patch de estabilidad del smoke de navegador en CI.

Release correctiva sobre 2.4.9. `v2.4.9` ya está publicado y no se mueve: este
patch añade el reintento del smoke y estabiliza la comprobación del editor
cuando el servidor responde 409 por un cambio externo.

## Correcciones

- El smoke de UI normaliza CRLF/LF y espera el repintado del editor antes de
  comprobar que un 409 conserva el contenido del usuario.
- GitHub Actions reintenta una vez `prueba-ui-humo.mjs` si falla por timing del
  navegador. Un fallo real sigue fallando en el segundo intento.
- El job de smoke se ejecutó verde en `main` y `master` antes de publicar.

## Compatibilidad

- Sin cambios en endpoints, ajustes ni comportamiento del agente.
- `v2.4.8` y `v2.4.9` quedan intactos; esta es una versión patch nueva.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Tests aislados | **56/56 OK** |
| Suites de navegador locales | **9/9 OK** |
| Smoke con catálogo vacío, 3 ejecuciones | **OK** |
| Enlaces de documentación | **0 roto(s)** |
| CI `main` y `master` | Windows · Node 22 · Python 3.12 · verde |

## Enlaces

- [Release 2.4.9](RELEASE-2.4.9.md)
- [Release 2.4.8](RELEASE-2.4.8.md)
- [Búsqueda web y SearXNG](INVESTIGACION-WEB.md)
- [Seguridad](../SECURITY.md)
