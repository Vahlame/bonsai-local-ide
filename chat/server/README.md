# Servidor del IDE: módulos extraídos

Este directorio empieza a separar del antiguo `ui-server.mjs` las piezas que no
necesitan el estado global del servidor. La regla es que un módulo reciba sus
dependencias y no lea variables de otro archivo.

| Módulo | Responsabilidad |
| --- | --- |
| `http.mjs` | argumentos de arranque, lectura acotada del cuerpo, MIME y resolución de rutas |
| `catalog.mjs` | catálogo de modelos, existencia del GGUF, recomendación y elección guardada |
| `gpu.mjs` | lectura cacheada de nvidia-smi/RAM |
| `browser.mjs` | abrir Edge/Chrome en modo aplicación sin GPU |
| `undo.mjs` | puntos de deshacer, poda y conflictos de escritura/renombrado |
| `workspace.mjs` | listado/índice del proyecto, adjuntos, instantáneas y rutas canónicas |
| `text.mjs` | títulos, recortes, anuncios y resumen de acciones |
| `agent-loop.mjs` | bucle del agente de `/api/chat` y coordinación de herramientas |
| `routes/*.mjs` | handlers HTTP por grupo con el contexto del servidor explícito |

## Frontera actual

`ui-server.mjs` es el **composition root**: crea el estado mutable, arma el
objeto `routeContext` y delega en `server/routes/index.mjs`. Los grupos de rutas
no leen variables de `ui-server`; reciben `routeContext` con getters/setters
para carpeta activa, turno, permisos y ciclo de vida del modelo.

`agent-loop.mjs` recibe ese mismo contexto y conserva exactamente el
comportamiento anterior del agente. Las tools legacy siguen detrás de
`legacy-tool-parser.mjs`; su retirada se hará con métricas y fecha, no de golpe.

## Regla para nuevas piezas

- Sin imports circulares.
- Sin estado global nuevo: pasar una función o un objeto de contexto.
- Los módulos puros se prueban desde los tests existentes; los que tocan disco
  reciben rutas y no `process.cwd()`.
- `chat/evaluar/copia-app.mjs` debe incluir cualquier módulo nuevo del servidor.
