# Benchmark de calidad por preset - 20261031045308

Tareas: **5** · pensamiento 0 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | q8_0 | 22528 | 4/5 | 80.0% | 58.4 | 55s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 100% | 100% | 0% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 10580 | 59.1 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 1553 | 52.8 |
| coding_hard_calc | coding | ❌ | Unexpected end of input | 0 | - |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 10222 | 60.9 |
| tool_call_convert | tools | ✅ | nativo: {"a":"EUR","de":"USD","monto":250} | 1659 | 60.9 |