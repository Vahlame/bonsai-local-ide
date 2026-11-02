# Bonsai Local IDE 2.4.7

**Fecha:** 2 de noviembre de 2026
**Tema:** primer corte modular del servidor, sin cambios de comportamiento.

Release de arquitectura sobre 2.4.6. No cambia el agente ni la UI: saca del
antiguo `ui-server.mjs` las piezas que no necesitan su estado global y deja una
frontera clara para seguir reduciendo el archivo.

## Qué se extrajo

| Módulo | Responsabilidad |
| --- | --- |
| `chat/server/http.mjs` | argumentos de arranque, lectura acotada del cuerpo, MIME y resolución de rutas |
| `chat/server/catalog.mjs` | catálogo de modelos, GGUF entero, recomendación y elección guardada |
| `chat/server/gpu.mjs` | lectura cacheada de nvidia-smi y RAM |
| `chat/server/browser.mjs` | abrir Edge/Chrome en modo aplicación sin GPU |
| `chat/server/undo.mjs` | puntos de deshacer, poda y conflictos de escritura/renombrado |

`ui-server.mjs` queda como composition root del router, el bucle del agente y el
estado compartido. La siguiente extracción segura está documentada en
`chat/server/README.md`: handlers con un objeto de contexto explícito y luego el
bucle del agente.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `ui-server.mjs` | 4.504 → **4.115 líneas** |
| Tests aislados | **51/51 OK** |
| Suites de navegador | **9/9 OK** |
| UI real con Qwen3.6 | **0 errores de consola**, 32768, `pensar: -1` |
| Copia aislada de evaluación | arranca con los módulos nuevos |
| Enlaces de documentación | **0 roto(s)** |
| CI | Windows · Node 22 · Python 3.12 · **verde** |

## Compatibilidad

- Windows 10/11, Node ≥ 22, GPU CUDA (RTX 4060 8 GB probada).
- Sin cambios en el protocolo HTTP, la API ni los ajustes.
- `v2.4.2` … `v2.4.6` quedan como releases anteriores; no se movieron sus tags.

## Enlaces

- [Release 2.4.6](RELEASE-2.4.6.md)
- [Servidor modular](../chat/server/README.md)
- [Auditoría completa](AUDIT-2026-11-01.md)
- [Contribuir](../CONTRIBUTING.md)
