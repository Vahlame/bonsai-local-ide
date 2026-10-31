# Benchmark de calidad por preset - 20261031045505

Tareas: **5** · pensamiento 1024 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | f16 | 131072 | 4/5 | 80.0% | 70.0 | 34s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 100% | 100% | 0% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 2481 | 71.0 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 2286 | 68.5 |
| coding_hard_calc | coding | ❌ | Unexpected end of input | 0 | - |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 3757 | 70.4 |
| tool_call_convert | tools | ✅ | nativo: {"monto":250,"de":"USD","a":"EUR"} | 1603 | 70.3 |