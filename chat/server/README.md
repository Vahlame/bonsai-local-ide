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

## Lo que sigue en `ui-server.mjs`

El archivo sigue siendo el **composition root** y aún contiene:

- el router HTTP y los handlers que dependen de `chat`, `workspaceRoot`,
  `busy`, `permitMode` y del ciclo de vida del modelo;
- el bucle del agente y la coordinación de herramientas;
- la selección de contexto específica de la UI.

La siguiente extracción segura es mover esos handlers a `server/routes/` con un
objeto de contexto explícito (`chat`, `workspace`, `lifecycle`, `permit`), y
después separar `server/agent-loop.mjs` del arranque HTTP. No se hace de golpe
porque cada handler comparte estado mutable y las pruebas de agente/visión
dependen de ese contrato.

## Regla para nuevas piezas

- Sin imports circulares.
- Sin estado global nuevo: pasar una función o un objeto de contexto.
- Los módulos puros se prueban desde los tests existentes; los que tocan disco
  reciben rutas y no `process.cwd()`.
- `chat/evaluar/copia-app.mjs` debe incluir cualquier módulo nuevo del servidor.
