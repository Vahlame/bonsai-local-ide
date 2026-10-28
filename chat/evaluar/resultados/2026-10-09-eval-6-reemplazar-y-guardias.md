# Evaluación de Bonsai · 2026-10-08T23-44-43

**17/19 tareas correctas** en 7 min 47 s · 10061 tokens generados · 14648 leídos + 127075 de caché · razonamiento apagado.

| tarea | nivel | resultado | s | saltos | acc. | t/s | GPU media | GPU ≥85 % | fallos |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| hola-py | facil | ✅ | 6.1 | 2 | 2 | 27.8 | 97 % | 100 % |  |
| fizzbuzz | facil | ✅ | 26.9 | 3 | 4 | 27.7 | 96 % | 100 % |  |
| bug-ultimos | medio | ✅ | 15.1 | 4 | 3 | 27.8 | 95 % | 93 % |  |
| renombrar | medio | ✅ | 25.7 | 5 | 9 | 27.6 | 91 % | 88 % |  |
| html-contador | facil | ✅ | 9.5 | 2 | 1 | 27.8 | 96 % | 100 % |  |
| json-resumen | medio | ✅ | 36.4 | 10 | 10 | 27.4 | 93 % | 94 % |  |
| explicar-codigo | facil | ✅ | 3.8 | 1 | 0 | 27.6 | 97 % | 100 % |  |
| docstrings | medio | ✅ | 10 | 2 | 1 | 27.8 | 96 % | 100 % |  |
| csv-stats | medio | ✅ | 18.4 | 2 | 3 | 27.6 | 96 % | 100 % |  |
| lru-cache | dificil | ✅ | 75.4 | 5 | 7 | 27.2 | 95 % | 99 % |  |
| node-esm | medio | ✅ | 70 | 9 | 11 | 26.9 | 93 % | 94 % |  |
| sqlite | medio | ✅ | 12.6 | 2 | 2 | 27.7 | 95 % | 100 % |  |
| error-recuperable | medio | ✅ | 9.3 | 4 | 3 | 27.6 | 95 % | 100 % |  |
| paquete | medio | ✅ | 18.1 | 5 | 8 | 27.5 | 94 % | 100 % |  |
| regex-fechas | medio | ❌ | 16.4 | 2 | 2 | 27.8 | 92 % | 94 % | resultado-incorrecto |
| solo-chat | facil | ❌ | 24.4 | 5 | 4 | 27.6 | 95 % | 100 % | resultado-incorrecto |
| buscar-simbolo | medio | ✅ | 9.8 | 3 | 2 | 27.7 | 90 % | 89 % |  |
| editar-config | facil | ✅ | 12 | 5 | 4 | 27.6 | 95 % | 100 % |  |
| tres-pasos | facil | ✅ | 6.6 | 3 | 3 | 27.7 | 92 % | 83 % |  |

## Detalle de los fallos
### regex-fechas
- >
    assert r == ['05/03/1990', '12/11/2015', '01/01/2030'], r
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: ['05/03/1990', '12/11/2015', '01/01/2030', '23/45/6789']

- pasos: write:done fechas.py → cmd:done(0) python fechas.py
- respuesta final: Listo. `fechas.py` tiene la función `extraer_fechas(texto)` que usa `re.findall(r"\d{2}/\d{2}/\d{4}", texto)` para devolver las fechas en formato `dd/mm/aaaa` en el orden en que aparecen.  Al ejecutarlo, el ejemplo confirma que funciona correctamente:  ``` Texto: La reunión es el 15/03/2025 y el inf
### solo-chat
- texto corto o sin ejemplo (281 car.)
- usó 3 herramientas sin necesidad
- pasos: write:done explica-es-closure.js → read:done explica-es-closure.js → cmd:done(1) python -c "import sys; sys.path.insert(0,'.'); exec(open('explica-es-closure.js','r',encod → cmd:done(0) node explica-es-closure.js
- respuesta final: El ejemplo está guardado en `explica-es-closure.js` y ejecutado con `node`. La salida es:  ``` 1 2 3 ```  Confirma que la closure funciona: cada llamada a `contar()` recuerda el valor anterior de `contador` y lo incrementa, aunque `crearContador()` ya haya terminado de ejecutarse.