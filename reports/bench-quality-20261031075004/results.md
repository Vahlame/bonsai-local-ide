# Benchmark de calidad por preset - 20261031075004

Tareas: **5** · pensamiento 0 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 32768 | 4/5 | 80.0% | 40.1 | 26s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 0% | 100% | 100% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ❌ | [{"ciudad":"Barcelona","total":275},{"ciudad":"Valencia","total":300},{"ciudad": | 1618 | 45.5 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 5109 | 36.5 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 6962 | 39.7 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 1633 | 39.3 |
| tool_call_convert | tools | ✅ | nativo: {"monto":250,"de":"USD","a":"EUR"} | 1468 | 39.6 |