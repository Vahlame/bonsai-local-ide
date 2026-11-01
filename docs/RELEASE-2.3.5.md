# Bonsai Local IDE 2.3.5

**Fecha:** 1 de noviembre de 2026
**Tema:** GPT-OSS con herramientas claras, contexto automático y menos turnos rotos.

Esta release sale de una prueba end-to-end real: GPT-OSS construyó una app de
tareas, se detectaron fallos de layout y de tool calls, y se corrigieron en el
camino. No es una entrega “a ciegas”.

---

## Contexto automático

- `uiVersion 2.3.5` migra cualquier `historial >= 32768` al modo automático
  (`0`). El viejo 50/50 deja de imponerse.
- Con GPT-OSS y 65.536 tokens: **53.120 de historial / 12.288 de salida**.
- La reserva de salida automática sigue en 12k; si el archivo es mayor, se usa
  `escribir_partes`.

## Herramientas explicadas para GPT-OSS

`BonsaiChat` añade una **guía de herramientas** al system prompt de GPT-OSS con
nombre, argumentos obligatorios y ejemplo de cada tool. El modelo sigue viendo
los JSON Schema de la plantilla, pero ahora tiene una referencia compacta de
cómo se usan:

```text
- archivo: ... Ejemplo: {"ruta":"src/app.js","contenido":"..."}
- leer: ... Ejemplo: {"ruta":"src/app.js","desde":1,"hasta":80}
- buscar_codigo: ... Ejemplo: {"consulta":"TODO","ruta":"src"}
```

`buscar_codigo` acepta `ruta` opcional y filtra los resultados. Los campos
extra que no están en el schema se **ignoran** en vez de tumbar el turno; los
obligatorios y los tipos siguen validándose.

## Turnos que no se envenenan

Con `--skip-chat-parsing`, una llamada cortada llega con `finish_reason:"stop"`
y argumentos JSON truncados. Antes se guardaba en el historial y el siguiente
turno fallaba al serializarla:

```text
Failed to parse tool call arguments as JSON
```

Ahora:

- `runTurn` descarta las llamadas con JSON incompleto antes de guardarlas.
- `packCoderHistory` limpia sesiones antiguas: quita la llamada inválida y sus
  resultados huérfanos.
- El cierre busca el último `assistant` (no el último tool result) y, si quedó
  vacío, usa el resumen de acciones. Nunca deja una respuesta final en blanco.

## Prueba end-to-end de la app

GPT-OSS escribió `todo.html` y se depuró con navegador real:

| Comprobación | Resultado |
|---|---|
| Añadir 3 tareas | OK |
| Completar / desmarcar | OK |
| Filtro completadas | OK |
| Editar con doble clic + Enter | OK |
| Borrar | OK, por id estable |
| Buscar | OK |
| Persistencia tras recargar | OK |
| Contadores totales | OK |
| Sin overflow a 390 px | OK |
| Sol con hora `HH:MM:SS` | OK |
| Río animado, árboles y rosas | OK |

Capturas: [escritorio](graficos/gptoss-todo-1280.png) ·
[móvil](graficos/gptoss-todo-390.png).

## Verificación del IDE

| Prueba | Resultado |
|---|---|
| `npm test` | **48/48** |
| `npm run test:navegador` | **7/7** |
| `npm run docs:links` | **0 enlaces rotos** |
| Flujo multi-paso GPT-OSS | Correcto |

## Límite honesto

GPT-OSS sigue siendo un modelo de razonamiento: puede analizar de más antes de
actuar. La guía de herramientas, el parser Harmony y el historial saneado
reducen el problema, pero no lo convierten en un modelo de código perfecto. Si
una tarea visual exige muchos ajustes finos, conviene dividirla en pasos
pequeños y verificar cada uno.

## Actualizar

```powershell
git pull
npm run build:ui-vendor
.\scripts\crear-acceso-directo.ps1
```

El acceso directo arranca la UI 2.3.5; la migración ajusta el historial una vez.
