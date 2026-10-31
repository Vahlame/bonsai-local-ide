# Benchmark de calidad por preset - 20261031014850

Tareas: **5** · pensamiento 0 · max_tokens 1200 · repeticiones 1 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| AUTO | f16 | 32768 | 3/5 | 60.0% | 49.8 | 20s |

## Por categoria

| Preset | data | retrieval | coding | instruction | tools |
|---|---:|---:|---:|---:|---:|
| AUTO | 0% | 100% | 0% | 100% | 100% |

## Detalle por tarea


### AUTO

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| data_sql_result | data | ❌ | [{"ciudad":"Madrid","total":150},{"ciudad":"Valencia","total":300}] | 727 | 50.3 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 2431 | 46.0 |
| coding_hard_calc | coding | ❌ | fallo 10/2-3 | 8243 | 50.9 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 1838 | 51.1 |
| tool_call_convert | tools | ✅ | texto: {"monto":250,"de":"USD","a":"EUR"} | 906 | 50.6 |