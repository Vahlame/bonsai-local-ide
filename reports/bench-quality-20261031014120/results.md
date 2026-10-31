# Benchmark de calidad por preset - 20261031014120

Tareas: **5** · pensamiento 1024 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 57344 | 4/5 | 80.0% | 72.8 | 13s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 0% | 100% | 100% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ❌ | [{"ciudad":"Barcelona","total":500},{"ciudad":"Valencia","total":300}] | 470 | 75.2 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 1823 | 58.4 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 4347 | 77.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 652 | 77.7 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 533 | 75.8 |