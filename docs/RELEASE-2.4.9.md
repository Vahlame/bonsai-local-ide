# Bonsai Local IDE 2.4.9

**Fecha:** 2 de noviembre de 2026
**Tema:** patch de estabilidad del smoke de navegador en CI.

Release correctiva sobre 2.4.8. No cambia el agente ni la API; arregla el caso
real que apareció en GitHub Actions: una instalación sin modelos descargados
abría el Model Hub en la pestaña **Instalados**, que quedaba vacía, y el smoke
esperaba tarjetas. En local no se reproducía porque la máquina de desarrollo
tiene modelos instalados.

## Correcciones

- El Model Hub abre **Recomendados** la primera vez si `Instalados` está vacío.
  Sigue mostrando la pestaña normal cuando ya hay modelos locales.
- El smoke de UI comprueba el editor de memoria global con una comparación que
  no depende de mayúsculas/minúsculas.
- Se mantiene el job `browser-smoke` de GitHub Actions con Edge/Chrome del runner.

## Compatibilidad

- Sin cambios en endpoints, ajustes ni comportamiento del agente.
- El tag `v2.4.8` **no se movió**; esta es una versión patch nueva.
- Los tags anteriores siguen intactos.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Tests aislados | **56/56 OK** |
| Suites de navegador locales | **9/9 OK** |
| Smoke de UI con catálogo vacío | **OK** |
| Enlaces de documentación | **0 roto(s)** |
| CI | Windows · Node 22 · Python 3.12 · smoke de navegador |

## Enlaces

- [Release 2.4.8](RELEASE-2.4.8.md)
- [Búsqueda web y SearXNG](INVESTIGACION-WEB.md)
- [Servidor modular](../chat/server/README.md)
- [Seguridad](../SECURITY.md)
