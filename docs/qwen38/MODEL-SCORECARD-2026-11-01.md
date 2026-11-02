# Scorecard: Qwen3.6 35B-A3B en tres repeticiones

Fecha: 2026-11-01. Modelo: **Qwen3.6 35B-A3B**, 65.536 de contexto, KV
`q8_0`, 22/40 capas de expertos en CPU/RAM, 8 hilos, motor
`build-RTX4060-Opt-sm89`, pensamiento libre (`pensar=-1`).

Objetivo: medir si el mejor modelo del benchmark mantiene calidad y velocidad
al repetir las cuatro tareas, no solo en una corrida afortunada.

## Rúbrica (25 puntos por tarea)

- **Completitud (10):** `index.html` existe, el checker lo abre y no hay un
  fallo fatal.
- **Funcionalidad (10):** la tarea cumple lo pedido y el checker lo mide
  (600 partículas/HUD, juego con puntuación/controles, CRUD con persistencia,
  Three.js/canvas/órbita).
- **Visual (5):** revisión de la captura: composición, legibilidad y acabado.

El score global es la media de las cuatro tareas; 100 es perfecto.

## Repeticiones

| Tarea | Rep 1 | Rep 2 | Rep 3 | Media |
| --- | ---: | ---: | ---: | ---: |
| Fluidos | 100 | 98 | 96 | **98** |
| Juego | 95 | 88 | 98 | **94** |
| App | 95 | 85 | 96 | **92** |
| Skyblock | 90 | 72 | 68 | **77** |
| **Global** | **95** | **86** | **90** | **90** |

### Fluidos

- Las tres repeticiones pasan: 600–650 partículas, HUD, botones y estelas.
- Rep 1: 166,5 s, 37,85 tok/s. Rep 2: 259,9 s, 40,2 tok/s. Rep 3:
  200,5 s, 39,8 tok/s.
- Rep 2 dejó la simulación en pausa; el checker la reinicia y la acepta. Es
  una variación de estado, no un fallo del modelo.

### Juego

- Breakout jugable en las tres. Rep 1: 63,6 s. Rep 2: 80,7 s, canvas
  480×300 y pantalla de inicio. Rep 3: 168,9 s, 38,95 tok/s, partida en
  curso con 20 puntos y 2 vidas.
- La calidad visual es alta y estable; la duración varía porque el agente
  decide cuánto verificar.

### App

- CRUD con `localStorage` y persistencia en las tres.
- Rep 2 tiene los contadores con poco contraste; rep 3 los corrige y queda
  limpia.
- Rep 2 tuvo un `UnicodeDecodeError` del helper al imprimir emojis; la app
  estaba bien y se re-verificó. El helper se corrigió a UTF-8.

### Skyblock

- Las tres pasan Three.js/canvas/órbita, pero la composición varía:
  - Rep 1: isla centrada, título arriba, buena cámara.
  - Rep 2: título encima de la isla y cámara más cerca.
  - Rep 3: isla enorme que llena el encuadre; el título se solapa.
- Es el punto débil del prompt: el modelo cumple lo técnico, pero el encuadre
  necesita una instrucción más estricta (cámara a 15 unidades, título fuera
  del objeto).

## Velocidad

| Tarea | Rep 1 | Rep 2 | Rep 3 | Media |
| --- | ---: | ---: | ---: | ---: |
| Fluidos | 37,85 | 40,2 | 39,8 | **39,3 tok/s** |
| Juego | — | — | 38,95 | **38,95 tok/s** |
| App | 36,7 | — | 37,8 | **37,25 tok/s** |
| Skyblock | 34,9 | 37,4 | 36,0 | **36,1 tok/s** |

En las corridas donde el agente no emitió un evento `speed` final (juego/app)
se usa la última medición disponible; el muro de la tarea sigue en 60–260 s.

## Conclusión

**Qwen3.6 35B-A3B es consistente:** 12/12 verificaciones pasan, 36–40 tok/s y
una media de **90/100**. Fluidos, juego y app están a nivel de producción
local; Skyblock es el único que necesita un prompt de cámara/overlay más
estricto. No aparece el problema de 7–8 tok/s de Qwen3.8 27B.

## Evidencia

- `qwen36-rep2.json` y `qwen36-rep3.json`: repeticiones completas.
- `task-benchmark-results.json`: primera corrida y matriz de modelos.
- `task-benchmark-shots/`: capturas de la última repetición.
- `scripts/bench-tasks.py`, `scripts/check-task.cjs`,
  `scripts/qwen38_ide_agent_task.py`.
