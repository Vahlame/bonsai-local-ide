# Evaluación de Bonsai · 2026-10-08T23-38-29

**18/19 tareas correctas** en 6 min 38 s · 8246 tokens generados · 14206 leídos + 115794 de caché · razonamiento apagado.

| tarea | nivel | resultado | s | saltos | acc. | t/s | GPU media | GPU ≥85 % | fallos |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| hola-py | facil | ✅ | 5.4 | 2 | 2 | 28 | 96 % | 100 % |  |
| fizzbuzz | facil | ✅ | 26.6 | 3 | 4 | 28 | 94 % | 96 % |  |
| bug-ultimos | medio | ✅ | 15.9 | 6 | 6 | 28 | 92 % | 87 % |  |
| renombrar | medio | ✅ | 23.7 | 5 | 8 | 28 | 91 % | 91 % |  |
| html-contador | facil | ✅ | 9.9 | 2 | 1 | 28.1 | 89 % | 89 % |  |
| json-resumen | medio | ✅ | 21.6 | 6 | 6 | 27.8 | 93 % | 95 % |  |
| explicar-codigo | facil | ✅ | 5.5 | 1 | 0 | 28.1 | 96 % | 100 % |  |
| docstrings | medio | ✅ | 10 | 2 | 1 | 28.1 | 91 % | 89 % |  |
| csv-stats | medio | ✅ | 15 | 2 | 3 | 28 | 97 % | 100 % |  |
| lru-cache | dificil | ✅ | 49.1 | 3 | 4 | 27.8 | 95 % | 98 % |  |
| node-esm | medio | ❌ | 60.2 | 12 | 12 | 27 | 93 % | 92 % | comandos-repetidos |
| sqlite | medio | ✅ | 10.7 | 2 | 2 | 28.1 | 97 % | 100 % |  |
| error-recuperable | medio | ✅ | 11.7 | 6 | 5 | 27.9 | 92 % | 91 % |  |
| paquete | medio | ✅ | 20.9 | 4 | 6 | 27.6 | 95 % | 100 % |  |
| regex-fechas | medio | ✅ | 16.5 | 2 | 2 | 27.8 | 95 % | 100 % |  |
| solo-chat | facil | ✅ | 12.5 | 1 | 0 | 27.8 | 96 % | 100 % |  |
| buscar-simbolo | medio | ✅ | 9.7 | 4 | 3 | 27.6 | 84 % | 78 % |  |
| editar-config | facil | ✅ | 5.6 | 2 | 1 | 27.8 | 96 % | 100 % |  |
| tres-pasos | facil | ✅ | 6.5 | 3 | 3 | 27.7 | 90 % | 83 % |  |

## Detalle de los fallos
### node-esm
- mal [["Ya, está.","ya-está"]]
- node --test falla
- pasos: write:done modulo.mjs → write:done modulo.test.mjs → cmd:done(1) node --test → write:done modulo.mjs → cmd:done(1) node --test → write:done modulo.mjs → cmd:done(1) node --test → cmd:done(0) node -e "console.log('a'.replace(/[^a-z0-9à-ñ ]/g, ''))" → cmd:done(0) node -e "console.log('ñ'.charCodeAt(0))" → cmd:done(0) node -e "console.log('ñ'.replace(/[^a-z0-9à-ñ ]/g, ''))" → cmd:done(0) node -e "console.log('ñ'.replace(/[^a-z0-9à-ñ ]/g, ''))" → cmd:done(0) node -e "console.log('ñ'.replace(/[^a-z0-9à-ñ ]/g, ''))"
- respuesta final: He creado `modulo.mjs` con la función `slugify(texto)` que convierte texto a minúsculas, elimina signos de puntuación y reemplaza espacios por guiones, eliminando guiones iniciales y finales. También he creado `modulo.test.mjs` con 10 tests usando `node:test` que cubren:  - Texto simple - Texto con 