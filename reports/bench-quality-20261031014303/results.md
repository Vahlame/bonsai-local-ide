# Benchmark de calidad por preset - 20261031014303

Tareas: **5** · pensamiento 0 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | f16 | 131072 | 3/5 | 60.0% | 73.7 | 20s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 0% | 100% | 100% | 100% | 0% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ❌ | [{"ciudad":"Barcelona","total":275},{"ciudad":"Valencia","total":300},{"ciudad": | 589 | 76.0 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 1110 | 60.7 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 7647 | 76.8 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 1425 | 77.8 |
| tool_call_convert | tools | ❌ | sin tool_call | 419 | 77.2 |