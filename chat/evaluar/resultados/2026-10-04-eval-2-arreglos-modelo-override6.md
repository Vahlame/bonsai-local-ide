# Evaluación de Bonsai · 2026-10-04T21-35-03

**18/19 tareas correctas** en 6 min 9 s · 7233 tokens generados · 16615 leídos + 77674 de caché.

| tarea | nivel | resultado | s | saltos | acc. | t/s | GPU media | GPU ≥85 % | fallos |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| hola-py | facil | ✅ | 3.9 | 2 | 2 | 28.3 | 97 % | 100 % |  |
| fizzbuzz | facil | ✅ | 23.3 | 3 | 4 | 27.9 | 96 % | 100 % |  |
| bug-ultimos | medio | ✅ | 19.5 | 8 | 7 | 27.5 | 91 % | 95 % |  |
| renombrar | medio | ✅ | 21.3 | 5 | 7 | 27.8 | 91 % | 90 % |  |
| html-contador | facil | ✅ | 80.7 | 6 | 5 | 27.7 | 21 % | 22 % |  |
| json-resumen | medio | ✅ | 19.1 | 2 | 3 | 27.9 | 91 % | 94 % |  |
| explicar-codigo | facil | ✅ | 4.2 | 1 | 0 | 28 | 97 % | 100 % |  |
| docstrings | medio | ✅ | 12 | 3 | 2 | 27.9 | 96 % | 100 % |  |
| csv-stats | medio | ✅ | 14.5 | 2 | 3 | 27.9 | 94 % | 93 % |  |
| lru-cache | dificil | ✅ | 39.2 | 3 | 4 | 27.6 | 95 % | 100 % |  |
| node-esm | medio | ✅ | 36.1 | 5 | 5 | 27.5 | 94 % | 97 % |  |
| sqlite | medio | ✅ | 11.3 | 2 | 2 | 27.9 | 95 % | 91 % |  |
| error-recuperable | medio | ✅ | 9.6 | 5 | 4 | 27.5 | 94 % | 100 % |  |
| paquete | medio | ✅ | 16.4 | 3 | 5 | 27.7 | 96 % | 100 % |  |
| regex-fechas | medio | ✅ | 16.7 | 2 | 2 | 27.9 | 96 % | 100 % |  |
| solo-chat | facil | ❌ | 14.4 | 5 | 4 | 27.7 | 95 % | 100 % | resultado-incorrecto |
| buscar-simbolo | medio | ✅ | 10.8 | 4 | 3 | 27.8 | 86 % | 90 % |  |
| editar-config | facil | ✅ | 5.5 | 2 | 1 | 27.9 | 95 % | 100 % |  |
| tres-pasos | facil | ✅ | 9.5 | 4 | 4 | 27.9 | 95 % | 100 % |  |

## Detalle de los fallos
### solo-chat
- texto corto o sin ejemplo (144 car.)
- usó 3 herramientas sin necesidad
- pasos: write:done explica-es-closure.js → cmd:done(0) node explica-es-closure.js → read:done explica-es-closure.js → cmd:done(0) node -e "
function crearContador() {
  let count = 0;
  return function () {
    count++;

- respuesta final: Todo quedó comprobado: el script `explica-es-closure.js` existe y el ejemplo de closure funciona correctamente, mostrando `1 2 3` al ejecutarlo.