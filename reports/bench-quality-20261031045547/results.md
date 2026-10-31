# Benchmark de calidad por preset - 20261031045547

Tareas: **5** · pensamiento 0 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | f16 | 131072 | 4/5 | 80.0% | 139.2 | 11s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 0% | 100% | 100% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ❌ | [{"ciudad":"Barcelona","total":275},{"ciudad":"Madrid","total":150}] | 516 | 137.4 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 1459 | 119.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 1998 | 147.2 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 416 | 145.9 |
| tool_call_convert | tools | ✅ | nativo: {"monto":250,"de":"USD","a":"EUR"} | 330 | 146.6 |