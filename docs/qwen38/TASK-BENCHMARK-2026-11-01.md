# Benchmark multi-tarea: fluidos, juego, app y Skyblock

Fecha: 2026-11-01. Hardware: RTX 4060 Laptop 8 GB, Ryzen 7 7840HS, 16 GB
RAM. Motor: `build-RTX4060-Opt-sm89`, MoE con expertos en CPU, KV q8_0,
pensamiento libre (`pensar=-1`) y el prompt correspondiente en cada tarea.

## Método

Cada modelo se carga con la API del IDE y ejecuta cuatro tareas aisladas:

1. **Fluidos**: simulador de 600 partículas con gravedad, ratón, botones y HUD.
2. **Juego**: Breakout/Snake jugable con teclado, puntuación y vidas.
3. **App**: tareas CRUD con `localStorage`, filtros y persistencia.
4. **Skyblock**: isla mínima de 120 líneas.

El checker abre el HTML con Edge headless, sirve el workspace por HTTP (para
`localStorage`), captura errores de consola y guarda una imagen. Para la app
añade una tarea, recarga y comprueba que persiste; para el juego pulsa
Espacio/flechas; para fluidos mide frames y lee el HUD. Los 404 de favicon se
ignoran; una simulación pausada se acepta si su HUD tiene valores válidos.

## Resultados

| Modelo | Skyblock tok/s | Fluidos | Juego | App |
| --- | ---: | --- | --- | --- |
| Qwen3.6 35B-A3B | 34,9 | OK · 166,5 s · 37,85 tok/s | OK · 63,6 s | OK · 162,1 s · 36,7 tok/s |
| Qwen3.5 9B | 45,9 | fallo HUD · 103,3 s · 45,8 tok/s | OK · 128,9 s · 45,0 tok/s | OK · 67,5 s |
| Qwen3 30B-A3B 2507 | 29,15 | OK · 107,0 s · 35,5 tok/s | OK · 128,9 s · 31,6 tok/s | OK · 132,8 s · 28,9 tok/s |
| GPT-OSS 20B | — | OK checker · 286,8 s · 33,6 tok/s | timeout 1.200 s · canvas negro | app funciona en captura; no registrada |
| Qwen3-Coder 30B-A3B | 17,65 | OK · 378,9 s · 22,35 tok/s | OK · 360,4 s · 20,95 tok/s | OK · 304,7 s · 17,7 tok/s |
| DeepSeek-Coder-V2-Lite | 10,5 | sin HTML · 147,6 s · 10,3 tok/s | sin HTML · 52,6 s · 12,2 tok/s | sin HTML · 123,2 s · 11,0 tok/s |
| Qwen3 8B | 39,35 | fallo HUD · 40,1 s · 40,15 tok/s | OK · 94,2 s · 38,95 tok/s | OK · 92,5 s · 39,1 tok/s |
| Qwen3.8 27B (control) | 7,2 | — | — | — |

Capturas en `docs/qwen38/task-benchmark-shots/`. Resultado crudo en
`docs/qwen38/task-benchmark-results.json`.

### Qwen3.6 35B-A3B: tres repeticiones

El mejor modelo se repitió tres veces con las mismas cuatro tareas:

| Tarea | Rep 1 | Rep 2 | Rep 3 | Media |
| --- | ---: | ---: | ---: | ---: |
| Fluidos | 100 | 98 | 96 | **98** |
| Juego | 95 | 88 | 98 | **94** |
| App | 95 | 85 | 96 | **92** |
| Skyblock | 90 | 72 | 68 | **77** |
| **Global** | **95** | **86** | **90** | **90** |

12/12 verificaciones pasan. La velocidad se mantiene en **36–40 tok/s**.
Fluidos, juego y app son estables; Skyblock varía en cámara/overlay (rep 2 y 3
acercan demasiado la isla). Detalle:
[MODEL-SCORECARD-2026-11-01](MODEL-SCORECARD-2026-11-01.md).

## Revisión visual

### Qwen3.6 35B-A3B — mejor equilibrio

- **Fluidos**: 600 partículas con estelas, brillo, gravedad y botones; HUD
  correcto. Es el mejor del lote.
- **Juego**: Breakout colorido, puntuación 20, vidas 2, nivel 1; responde a
  Espacio/flechas.
- **App**: “Mis Tareas”, tema oscuro, filtros, contador, edición y borrado;
  la tarea de prueba persiste.
- **Skyblock**: isla plana, cielo cálido, overlay centrado y sin errores.

### Qwen3.5 9B — el más rápido

- **Fluidos**: partículas con estelas, pero el HUD marca `Particulas: 0` y
  `FPS: 0`; el checker lo rechaza. La física parece un campo de partículas,
  no un fluido.
- **Juego** y **app**: correctos y rápidos (45 tok/s).
- **Skyblock**: isla plana y limpia, cielo azul oscuro.

### Qwen3 30B-A3B 2507 — alternativa sólida

- **Fluidos**: 600 partículas de colores, HUD FPS 58 y partículas 600; más
  “partículas” que fluido, pero funcional.
- **Juego**: Breakout con puntuación 320 y vidas 2.
- **App**: CRUD claro con filtros y persistencia.
- **Skyblock**: isla plana y limpia.

### GPT-OSS 20B — variable

- **Fluidos**: las 600 partículas colapsan en una línea horizontal; HUD
  correcto, física pobre.
- **Juego**: canvas negro, “Game Over”, sin render útil; además agotó
  1.200 s.
- **App**: la captura muestra una app CRUD funcional, aunque la tarea se
  canceló antes de registrar el cierre.
- **Skyblock**: en la fase 1a anterior hizo una losa vertical; en el benchmark
  el HTML quedó sin isla visible y con un error de `addEventListener`.

### Qwen3-Coder 30B-A3B — especialista, más lento

- **Fluidos**: 600 partículas con estelas, HUD 127 FPS; visualmente bueno.
  El agente dejó la simulación en pausa y el checker la acepta ahora.
- **Juego**: Breakout con puntuación 100 y vidas 2.
- **App**: CRUD limpio y funcional.
- **Skyblock**: HTML correcto, pero el turno terminó `stalled` tras 709,9 s;
  el archivo existe y el checker pasa.
- **Velocidad**: 17-22 tok/s. Es el más lento de los MoE útiles, pero sigue
  por encima de los 8 tok/s de Qwen3.8.

### DeepSeek-Coder-V2-Lite — no usable en este setup

- No creó `index.html` en ninguna de las cuatro tareas (`html=False`).
- 10-12 tok/s; por debajo del objetivo y sin artefacto que revisar.

### Qwen3 8B — rápido pero básico

- **Fluidos**: pantalla negra, FPS 0, partículas 0; falla.
- **Juego**: Breakout funcional pero muy plano; el texto “Juego pausado” se
  solapa con “Vidas: 3”.
- **App**: CRUD funcional, sin estilos; cumple lo mínimo.
- **Skyblock**: isla minúscula y cámara demasiado lejos; funciona, pero la
  calidad es baja.
- **Velocidad**: 39-40 tok/s. Buen comodín para tareas simples.

## Conclusión

**Qwen3.6 35B-A3B es la recomendación principal.** Es el único que hace las
cuatro tareas con buena calidad visual y a 35-40 tok/s; en tres repeticiones
mantiene **90/100** y 12/12 verificaciones. **Qwen3 30B-A3B 2507**
es la alternativa si se quiere otro reparto de VRAM/RAM. **Qwen3.5 9B** es el
más rápido (45-46 tok/s) para juego/app/Skyblock, pero su fluido no cumple.
**Qwen3-Coder 30B-A3B** es el especialista de código, a costa de 17-22 tok/s.
**Qwen3 8B** sirve para tareas simples a 39-40 tok/s. **DeepSeek-Coder-V2-Lite**
no produjo archivos y **GPT-OSS 20B** fue variable en tareas visuales.
**Qwen3.8 27B** confirma el problema: 7,2 tok/s.

La respuesta al objetivo original es sí: hay modelos que crean proyectos a
35-46 tok/s incluso con expertos en CPU. No hace falta quedarse en los 8 tok/s
de Qwen3.8.

## Correcciones externas aplicadas

- `start-server.ps1` no delegaba los modelos `moe-hibrido` al lanzador
  optimizado; GPT-OSS se rechazaba como “sin perfil de GPU completa”.
- El perfil de GPT-OSS pedía `optimized-sm89`, una ruta relativa inexistente;
  se usa `optimized-sm89-user` (`%USERPROFILE%`).
- `configurationFromMarker()` rechazaba `pensar=-1`; impedía cambiar de modelo
  con pensamiento libre.
- El catálogo de GPT-OSS apuntaba a `gpt-oss-20b-MXFP4.gguf`, que no existe.
- El checker ignoraba una simulación pausada y contaba el 404 de favicon como
  error; ambos corregidos.
- Qwen3-30B-A3B necesita 32K, no 64K, para caber con su tabla medida.

## Artefactos

- `scripts/bench-tasks.py`: matriz multi-modelo/multi-tarea.
- `scripts/check-task.cjs`: verificación Edge headless.
- `trabajo/bench-tasks/prompts/`: fluid, game y app.
- `docs/qwen38/task-benchmark-results.json`: resultados crudos.
- `docs/qwen38/task-benchmark-shots/`: capturas.
- `models/qwen3-coder-30b-a3b-...gguf`, `models/deepseek-coder-v2-lite-...gguf`,
  `models/qwen3-8b-...gguf`: descargas nuevas.
