# Bonsai Local IDE 2.4.11

**Fecha:** 2 de noviembre de 2026
**Tema:** corrección del invariante del smoke de 409.

Release correctiva sobre 2.4.10. `v2.4.10` ya está publicado y no se mueve.

El smoke comprobaba que, tras un 409, el editor conservara el texto del usuario.
Eso no siempre es el contrato correcto: si el editor **no tenía cambios sin
guardar**, el vigilante puede recargar el contenido externo. Lo que nunca puede
pasar es que se aplique la propuesta del Ctrl+K sobre el archivo que cambió en
disco. La prueba ahora verifica ese invariante real:

- el disco conserva el contenido externo;
- el editor queda en la versión del usuario o en la versión externa recargada;
- nunca aparece la propuesta `ALFA` aplicada.

## Compatibilidad

- Sin cambios en el producto ni en la API.
- `v2.4.8`, `v2.4.9` y `v2.4.10` quedan intactos.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Tests aislados | **56/56 OK** |
| Suites de navegador locales | **9/9 OK** |
| Smoke con catálogo vacío, 3 ejecuciones | **OK** |
| Enlaces de documentación | **0 roto(s)** |
| CI `main` y `master` | Windows · Node 22 · Python 3.12 |

## Enlaces

- [Release 2.4.10](RELEASE-2.4.10.md)
- [Release 2.4.9](RELEASE-2.4.9.md)
- [Búsqueda web y SearXNG](INVESTIGACION-WEB.md)
- [Seguridad](../SECURITY.md)
