# Benchmark de calidad por preset - 20261031080231

Tareas: **5** · pensamiento 1024 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 32768 | 4/5 | 80.0% | 34.4 | 105s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 100% | 100% | 0% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 29660 | 21.9 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 15831 | 38.5 |
| coding_hard_calc | coding | ❌ | Unexpected end of input | 0 | - |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 11122 | 37.8 |
| tool_call_convert | tools | ✅ | nativo: {"monto":250,"de":"USD","a":"EUR"} | 4404 | 39.4 |