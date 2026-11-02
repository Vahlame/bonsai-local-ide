# Bonsai Local IDE 2.4.12

**Fecha:** 2 de noviembre de 2026
**Tema:** patch final de estabilidad del smoke de navegador.

Release correctiva sobre 2.4.11. `v2.4.11` ya está publicado y no se mueve.

El smoke abría el editor de memoria global y comprobaba su texto de inmediato.
El diálogo se pinta antes de que termine `/api/memoria`, así que en un runner
lento el resumen con “presupuesto” todavía no estaba. Ahora la prueba espera a
que llegue el resumen antes de comprobarlo.

## Compatibilidad

- Sin cambios en el producto ni en la API.
- `v2.4.8` … `v2.4.11` quedan intactos.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Tests aislados | **56/56 OK** |
| Suites de navegador locales | **9/9 OK** |
| Smoke con catálogo vacío, 3 ejecuciones | **OK** |
| Enlaces de documentación | **0 roto(s)** |
| CI `main` y `master` | Windows · Node 22 · Python 3.12 |

## Enlaces

- [Release 2.4.11](RELEASE-2.4.11.md)
- [Release 2.4.10](RELEASE-2.4.10.md)
- [Búsqueda web y SearXNG](INVESTIGACION-WEB.md)
- [Seguridad](../SECURITY.md)
