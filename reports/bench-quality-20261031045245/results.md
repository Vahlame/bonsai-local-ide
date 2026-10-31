# Benchmark de calidad por preset - 20261031045245

Tareas: **5** · pensamiento 0 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 57344 | 4/5 | 80.0% | 73.0 | 17s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 0% | 100% | 100% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ❌ | [{"ciudad":"Barcelona","total":500},{"ciudad":"Madrid","total":150}] | 445 | 75.7 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 1811 | 59.4 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 6543 | 76.7 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 1171 | 77.6 |
| tool_call_convert | tools | ✅ | nativo: {"monto":250,"de":"USD","a":"EUR"} | 551 | 75.7 |