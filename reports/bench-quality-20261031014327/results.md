# Benchmark de calidad por preset - 20261031014327

Tareas: **5** · pensamiento 0 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 83968 | 2/5 | 40.0% | 95.7 | 11s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 0% | 100% | 0% | 0% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ❌ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275},{"ciudad": | 567 | 98.9 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 1279 | 79.0 |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 2518 | 100.6 |
| instruction_nested | instruction | ❌ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 626 | 100.6 |
| tool_call_convert | tools | ✅ | nativo: {"monto":"250","de":"USD","a":"EUR"} | 369 | 99.2 |