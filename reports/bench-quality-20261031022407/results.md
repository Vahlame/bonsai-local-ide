# Benchmark de calidad por preset - 20261031022407

Tareas: **5** · pensamiento 1024 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 79872 | 3/5 | 60.0% | 48.9 | 62s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 100% | 100% | 0% | 100% | 0% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4111 | 50.2 |
| retrieval_needle | retrieval | ✅ | 

QX-7419 | 11405 | 45.1 |
| coding_hard_calc | coding | ❌ | Unexpected end of input | 0 | - |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 11994 | 50.0 |
| tool_call_convert | tools | ❌ | sin tool_call | 4873 | 50.3 |