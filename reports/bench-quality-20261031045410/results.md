# Benchmark de calidad por preset - 20261031045410

Tareas: **5** · pensamiento 1024 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 36864 | 5/5 | 100.0% | 76.0 | 36s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 100% | 100% | 100% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 5069 | 77.4 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 1516 | 67.3 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 12726 | 77.8 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 6747 | 78.5 |
| tool_call_convert | tools | ✅ | nativo: {"a":"EUR","de":"USD","monto":250} | 1634 | 79.0 |