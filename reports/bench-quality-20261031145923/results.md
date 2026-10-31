# Benchmark de calidad por preset - 20261031145923

Tareas: **5** · pensamiento 1024 · max_tokens 1200 · repeticiones 1 · temperatura 1

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 32768 | 5/5 | 100.0% | 32.5 | 63s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 100% | 100% | 100% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4823 | 33.9 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 7315 | 33.1 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 28273 | 30.5 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 9450 | 32.2 |
| tool_call_convert | tools | ✅ | nativo: {"monto":250,"de":"USD","a":"EUR"} | 2110 | 33.0 |