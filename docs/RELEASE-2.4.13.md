# Bonsai Local IDE 2.4.13

**Fecha:** 2 de noviembre de 2026
**Tema:** auditoría final de seguridad y robustez de la búsqueda web.

Release de cierre sobre 2.4.12. `v2.4.12` ya está publicado y no se mueve.

## Seguridad

- **SSRF IPv6.** `descargarWeb()` solo bloqueaba rangos IPv4 privados. Ahora
  también rechaza loopback (`::1`), no especificada (`::`), unique-local
  (`fc00::/7`), link-local (`fe80::/10`) e IPv4 mapeada (`::ffff:...`) cuando
  `allowPrivate` está desactivado.
- **Metadatos de nube siempre bloqueados.** `169.254.169.254`,
  `metadata.google.internal` y `fd00:ec2::254` se rechazan incluso en el camino
  `allowPrivate` que usa SearXNG. No hay un caso legítimo para consultarlos.
- El resto de protecciones se mantiene: puertos del IDE/modelo, redirecciones,
  tamaño máximo, cancelación y contenido no confiable.

## Herramientas

- `scripts/check-ui.cjs` acepta `BONSAI_UI_TOKEN`: usa la cabecera
  `X-Bonsai-Token` para la API y el arranque `/?token=...` para la cookie. Las
  capturas funcionan también con la interfaz protegida.
- El Model Hub vuelve a `Recomendados` si `Instalados` sigue vacío, incluso si
  el primer catálogo tardó en cargar.
- El agente conserva el empujón a `buscar` cuando el usuario pide información
  actual/externa y el modelo intenta responder de memoria.

## Compatibilidad

- Sin cambios de endpoints ni del comportamiento normal en loopback.
- `v2.4.8` … `v2.4.12` quedan intactos.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Tests aislados | **56/56 OK** |
| Suites de navegador locales | **9/9 OK** |
| Smoke con catálogo vacío, 3 ejecuciones | **OK** |
| Enlaces de documentación | **0 roto(s)** |
| CI `main` y `master` | Windows · Node 22 · Python 3.12 |

## Enlaces

- [Release 2.4.12](RELEASE-2.4.12.md)
- [Búsqueda web y SearXNG](INVESTIGACION-WEB.md)
- [Seguridad](../SECURITY.md)
- [Servidor modular](../chat/server/README.md)
