# Evaluación de Bonsai · 2026-10-05T02-38-49

**18/19 tareas correctas** en 10 min 18 s · 12948 tokens generados · 24974 leídos + 173748 de caché.

| tarea | nivel | resultado | s | saltos | acc. | t/s | GPU media | GPU ≥85 % | fallos |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| hola-py | facil | ✅ | 5.6 | 2 | 2 | 28.1 | 73 % | 60 % |  |
| fizzbuzz | facil | ✅ | 31.9 | 3 | 4 | 28 | 96 % | 100 % |  |
| bug-ultimos | medio | ✅ | 19.6 | 7 | 7 | 27.8 | 91 % | 89 % |  |
| renombrar | medio | ✅ | 22.5 | 5 | 7 | 27.8 | 87 % | 86 % |  |
| html-contador | facil | ✅ | 84.1 | 7 | 6 | 27.7 | 27 % | 28 % |  |
| json-resumen | medio | ✅ | 30.7 | 6 | 6 | 27.7 | 96 % | 100 % |  |
| explicar-codigo | facil | ✅ | 4.4 | 1 | 0 | 27.9 | 98 % | 100 % |  |
| docstrings | medio | ✅ | 14.2 | 3 | 2 | 27.9 | 96 % | 100 % |  |
| csv-stats | medio | ✅ | 17.7 | 2 | 3 | 27.9 | 95 % | 100 % |  |
| lru-cache | dificil | ❌ | 76.9 | 8 | 12 | 27.3 | 95 % | 97 % | comandos-repetidos, ultimo-comando-fallo |
| node-esm | medio | ✅ | 50.7 | 5 | 5 | 27.4 | 96 % | 100 % |  |
| sqlite | medio | ✅ | 11.4 | 2 | 2 | 27.8 | 95 % | 100 % |  |
| error-recuperable | medio | ✅ | 9.8 | 5 | 4 | 27.7 | 94 % | 100 % |  |
| paquete | medio | ✅ | 16.9 | 3 | 5 | 27.7 | 92 % | 94 % |  |
| regex-fechas | medio | ✅ | 188 | 20 | 36 | 26.9 | 94 % | 97 % |  |
| solo-chat | facil | ✅ | 7 | 1 | 0 | 27.9 | 95 % | 100 % |  |
| buscar-simbolo | medio | ✅ | 10.5 | 4 | 3 | 27.7 | 96 % | 100 % |  |
| editar-config | facil | ✅ | 7.7 | 3 | 2 | 27.7 | 97 % | 100 % |  |
| tres-pasos | facil | ✅ | 7.6 | 3 | 3 | 27.8 | 90 % | 86 % |  |

## Detalle de los fallos
### lru-cache
- comportamiento ok
- sus tests fallan: 

----------------------------------------------------------------------
Ran 7 tests in 0.001s

FAILED (errors=1)

- pasos: index:done carpeta → cmd:done(0) python -c "import sys; print(sys.version)" → write:done lru.py → write:done test_lru.py → cmd:done(0) python lru.py → cmd:done(1) python -m unittest test_lru -v → write:done lru.py → cmd:done(0) python lru.py → cmd:done(1) python -m unittest test_lru -v → write:done lru.py → cmd:done(0) python lru.py → cmd:done(1) python -m unittest test_lru -v
- respuesta final: <tool_call> <function=ejecutar> <parameter=comando> python -m unittest test_lru -v </parameter> </function> </tool_call>