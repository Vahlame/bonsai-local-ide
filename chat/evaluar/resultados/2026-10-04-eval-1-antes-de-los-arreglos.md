# Evaluación de Bonsai · 2026-10-04T20-53-20

**15/19 tareas correctas** en 9 min 40 s · 11974 tokens generados · 25731 leídos + 222179 de caché.

| tarea | nivel | resultado | s | saltos | acc. | t/s | GPU media | GPU ≥85 % | fallos |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| hola-py | facil | ❌ | 8.4 | 4 | 4 | 28 | 94 % | 100 % | resultado-incorrecto |
| fizzbuzz | facil | ✅ | 37.7 | 7 | 12 | 27.6 | 95 % | 100 % |  |
| bug-ultimos | medio | ✅ | 16.8 | 7 | 8 | 27.7 | 86 % | 88 % |  |
| renombrar | medio | ✅ | 31.9 | 13 | 13 | 27.6 | 93 % | 94 % |  |
| html-contador | facil | ✅ | 63 | 10 | 10 | 27.2 | 93 % | 94 % |  |
| json-resumen | medio | ✅ | 50.1 | 11 | 12 | 27.4 | 91 % | 92 % |  |
| explicar-codigo | facil | ❌ | 28.5 | 7 | 7 | 27.7 | 90 % | 93 % | accion-denegada, ultimo-comando-fallo |
| docstrings | medio | ✅ | 30.6 | 9 | 9 | 27.8 | 96 % | 100 % |  |
| csv-stats | medio | ❌ | 20.7 | 7 | 7 | 27.5 | 94 % | 95 % | accion-denegada |
| lru-cache | dificil | ✅ | 65.9 | 10 | 14 | 27.3 | 93 % | 91 % |  |
| node-esm | medio | ✅ | 31.8 | 4 | 4 | 27.6 | 95 % | 97 % |  |
| sqlite | medio | ✅ | 24 | 6 | 6 | 27.6 | 90 % | 91 % |  |
| error-recuperable | medio | ✅ | 20.6 | 11 | 11 | 27.5 | 94 % | 85 % |  |
| paquete | medio | ✅ | 22.8 | 8 | 12 | 27.5 | 92 % | 91 % |  |
| regex-fechas | medio | ❌ | 14.3 | 3 | 3 | 27.8 | 95 % | 93 % | resultado-incorrecto |
| solo-chat | facil | ✅ | 7.9 | 1 | 0 | 28 | 96 % | 100 % |  |
| buscar-simbolo | medio | ✅ | 8.8 | 3 | 2 | 27.6 | 94 % | 88 % |  |
| editar-config | facil | ✅ | 23.6 | 11 | 11 | 27.5 | 92 % | 96 % |  |
| tres-pasos | facil | ✅ | 11.8 | 5 | 5 | 27.9 | 95 % | 100 % |  |

## Detalle de los fallos
### hola-py
- salida: "Hola, Bonsai."
- pasos: write:done hola.py → cmd:done(0) python hola.py → cmd:done(0) python hola.py → read:done hola.py
- respuesta final: Todo está verificado:  - **hola.py** existe y su contenido es exactamente `print("Hola, Bonsai.")`. - **Ejecución** de `python hola.py` (código 0) produce la salida exacta:  ``` Hola, Bonsai. ```  El pedido quedó cumplido: archivo creado, ejecutado para comprobar y verificado.
### explicar-codigo
- explicación correcta
- escribió archivos sin que se pidiera
- pasos: search:done implementa una búsqueda binaria sobre una lista ordenada, dividiendo el intervalo de búsqu → deny:denied leer llegó sin ruta → read:done algoritmo.py → write:done test_busqueda.py → cmd:done(1) .venv\Scripts\python test_busqueda.py → cmd:done(1) .venv\Scripts\python.exe test_busqueda.py → cmd:done(1) python test_busqueda.py
- respuesta final: La función `buscar` implementa una búsqueda binaria sobre una lista ordenada, dividiendo el intervalo de búsqueda a la mitad en cada iteración. Si no encuentra el objetivo, devuelve -1; si lo encuentra, devuelve su índice. Su complejidad temporal es O(log n) y su complejidad espacial es O(1), ya que
### csv-stats
- falta en la salida: media
- código 0
- pasos: write:done stats.py → cmd:done(0) python stats.py → read:done stats.py → deny:denied leer llegó sin ruta → read:done datos.csv → read:done stats.py → cmd:done(0) python stats.py
- respuesta final: Todo está completo:  - **stats.py** creado y verificado. - **datos.csv** leído y correcto. - **Ejecución de `python stats.py`** realizada con código 0 y salida:  ``` Edad media: 36.62 Edad mínima: 23 Edad máxima: 52 Personas por ciudad: Bilbao: 2 Madrid: 4 Sevilla: 2 ```  El script lee `datos.csv`, 
### regex-fechas
- >
    assert r == ['05/03/1990', '12/11/2015', '01/01/2030'], r
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: ['05/03/1990', '12/11/2015', '01/01/2030', '23/45/6789']

- pasos: write:done fechas.py → cmd:done(0) python fechas.py → read:done fechas.py
- respuesta final: Todo está cumplido:  - `fechas.py` contiene `extraer_fechas(texto)` que devuelve las fechas en formato `dd/mm/aaaa` en orden. - Se probó ejecutando el archivo: la salida es `['05/03/2024', '31/12/2024', '07/09/2025']`, que es correcto (descarta `1/01/2023` por no tener dos dígitos en el día). - Se v