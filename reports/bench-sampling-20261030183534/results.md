# Benchmark de muestreo - 20261030183534

Tareas: **12** · pensamiento 1024 · max_tokens 3000 · repeticiones 2 · 10 configuraciones

## Resultado global

| Config | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| T0 greedy | q8_0 | 32768 | 18/24 | 75.0% | 41.6 | 243s |
| T0.2 p.95 k20 | q8_0 | 32768 | 20/24 | 83.3% | 42.1 | 250s |
| T0.4 p.90 k40 | q8_0 | 32768 | 19/24 | 79.2% | 42.1 | 222s |
| T0.6 p.95 k20 code | q8_0 | 32768 | 20/24 | 83.3% | 42.1 | 240s |
| T0.6 p.90 k20 m.05 | q8_0 | 32768 | 21/24 | 87.5% | 42.1 | 236s |
| T0.7 p.80 k20 chat | q8_0 | 32768 | 20/24 | 83.3% | 42.1 | 247s |
| T0.8 p.95 k20 m.05 | q8_0 | 32768 | 20/24 | 83.3% | 42.1 | 228s |
| T0.6 p.95 k20 pres1.5 | q8_0 | 32768 | 20/24 | 83.3% | 41.0 | 274s |
| T0.6 p.95 k20 rep1.1 | q8_0 | 32768 | 19/24 | 79.2% | 41.0 | 264s |
| T1.0 p.95 k20 m.05 reason | q8_0 | 32768 | 20/24 | 83.3% | 42.1 | 226s |

### Parametros por configuracion

| Config | temp | top_p | top_k | min_p |
|---|---:|---:|---:|---:|
| T0 greedy | 0 | 1 | 0 | 0 |
| T0.2 p.95 k20 | 0.2 | 0.95 | 20 | 0 |
| T0.4 p.90 k40 | 0.4 | 0.9 | 40 | 0 |
| T0.6 p.95 k20 code | 0.6 | 0.95 | 20 | 0 |
| T0.6 p.90 k20 m.05 | 0.6 | 0.9 | 20 | 0.05 |
| T0.7 p.80 k20 chat | 0.7 | 0.8 | 20 | 0 |
| T0.8 p.95 k20 m.05 | 0.8 | 0.95 | 20 | 0.05 |
| T0.6 p.95 k20 pres1.5 | 0.6 | 0.95 | 20 | 0 |
| T0.6 p.95 k20 rep1.1 | 0.6 | 0.95 | 20 | 0 |
| T1.0 p.95 k20 m.05 reason | 1 | 0.95 | 20 | 0.05 |

## Por categoria

| Config | coding | reasoning | data | text | retrieval | instruction | tools |
|---|---:|---:|---:|---:|---:|---:|---:|
| T0 greedy | 60% | 100% | 100% | 0% | 100% | 100% | 100% |
| T0.2 p.95 k20 | 60% | 100% | 100% | 100% | 100% | 100% | 100% |
| T0.4 p.90 k40 | 60% | 75% | 100% | 100% | 100% | 100% | 100% |
| T0.6 p.95 k20 code | 70% | 100% | 100% | 50% | 100% | 100% | 100% |
| T0.6 p.90 k20 m.05 | 70% | 100% | 100% | 100% | 100% | 100% | 100% |
| T0.7 p.80 k20 chat | 70% | 100% | 100% | 50% | 100% | 100% | 100% |
| T0.8 p.95 k20 m.05 | 70% | 75% | 100% | 100% | 100% | 100% | 100% |
| T0.6 p.95 k20 pres1.5 | 70% | 75% | 100% | 100% | 100% | 100% | 100% |
| T0.6 p.95 k20 rep1.1 | 70% | 100% | 100% | 0% | 100% | 100% | 100% |
| T1.0 p.95 k20 m.05 reason | 70% | 100% | 100% | 50% | 100% | 100% | 100% |

## Detalle por tarea


### T0 greedy

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3173 | 41.6 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2995 | 41.8 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4070 | 41.9 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4071 | 41.4 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 27059 | 41.6 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26939 | 41.7 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2695 | 41.7 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2630 | 41.8 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 6599 | 41.8 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 6533 | 41.8 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4405 | 41.7 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4339 | 41.7 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 24966 | 41.8 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 24909 | 41.7 |
| coding_hard_calc | coding | ❌ | Assignment to constant variable. | 0 | - |
| coding_hard_calc | coding | ❌ | Assignment to constant variable. | 0 | - |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5989 | 41.8 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5931 | 41.8 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4805 | 40.7 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 2048 | 40.7 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5859 | 41.8 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5794 | 41.8 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2171 | 41.7 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 1967 | 41.8 |

### T0.2 p.95 k20

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3061 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2994 | 42.1 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3948 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3993 | 42.3 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26716 | 42.2 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26689 | 42.1 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2620 | 42.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2605 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 8515 | 42.2 |
| logic_boxes | reasoning | ✅ | <Mezcla>=Manzanas | 7584 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4461 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4390 | 42.1 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 24708 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 24667 | 42.2 |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 36014 | 42.1 |
| coding_hard_calc | coding | ❌ | fallo (2+3)*4 | 33761 | 41.9 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 6030 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 6158 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4785 | 41.1 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 2153 | 41.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5629 | 42.2 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 4798 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2208 | 42.0 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 1949 | 42.1 |

### T0.4 p.90 k40

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3206 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3103 | 42.3 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3893 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3878 | 42.3 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 27171 | 42.0 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26664 | 42.1 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 848 | 41.9 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2272 | 42.2 |
| logic_boxes | reasoning | ❌ | <Naranjas>=<Mezcla> | 13335 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 7960 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4666 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4299 | 42.1 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 10952 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 6637 | 42.2 |
| coding_hard_calc | coding | ❌ | Invalid expression | 0 | - |
| coding_hard_calc | coding | ❌ | Cannot read properties of undefined (reading 'type') | 0 | - |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 6238 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 6134 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4795 | 41.0 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 2149 | 41.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5717 | 42.3 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5778 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2146 | 42.1 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 1994 | 42.2 |

### T0.6 p.95 k20 code

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2637 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3263 | 42.3 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4418 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3901 | 42.3 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26713 | 42.2 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26610 | 42.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 944 | 41.8 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 1992 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 15774 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 4951 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4358 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4366 | 42.2 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 24749 | 42.1 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 11957 | 42.2 |
| coding_hard_calc | coding | ❌ | Cannot read properties of undefined (reading 't') | 0 | - |
| coding_hard_calc | coding | ✅ | 5/5 tests | 35214 | 42.1 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5683 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5550 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4889 | 41.0 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 2082 | 41.0 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5921 | 42.2 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 6591 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2205 | 42.1 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 1952 | 42.1 |

### T0.6 p.90 k20 m.05

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2590 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2983 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4185 | 42.1 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4023 | 42.3 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26734 | 42.1 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26664 | 42.1 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2763 | 42.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 1661 | 42.1 |
| logic_boxes | reasoning | ✅ | <Mezcla>=Manzanas | 4720 | 42.1 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 7965 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4460 | 42.1 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 5056 | 42.1 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 24727 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 23063 | 42.1 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 26928 | 42.1 |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 30286 | 42.1 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 10316 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5832 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4386 | 40.9 |
| retrieval_two_needles | retrieval | ✅ | QX-7419,ZK-2288 | 1344 | 40.9 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5920 | 42.2 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5241 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2160 | 42.1 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2116 | 42.1 |

### T0.7 p.80 k20 chat

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3062 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3198 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3990 | 42.3 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 7913 | 42.2 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26784 | 42.1 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26629 | 42.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 1608 | 42.1 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2036 | 42.3 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 15573 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 15420 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 5327 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4456 | 42.2 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 20169 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 24198 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 16275 | 42.2 |
| coding_hard_calc | coding | ❌ | Unexpected token | 0 | - |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5457 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5555 | 42.1 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4940 | 41.0 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 2152 | 41.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 4932 | 42.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 6000 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2204 | 42.1 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 1990 | 42.1 |

### T0.8 p.95 k20 m.05

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2686 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2933 | 42.3 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3937 | 42.3 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4024 | 42.3 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 25724 | 42.2 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 23095 | 42.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 1460 | 42.1 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2464 | 42.2 |
| logic_boxes | reasoning | ✅ | <Mezcla>=Manzanas | 24654 | 42.2 |
| logic_boxes | reasoning | ❌ | <Mezcla>=<Manzanas> | 8146 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4242 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4625 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 10549 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 7433 | 42.2 |
| coding_hard_calc | coding | ❌ | Cannot read properties of undefined (reading 'op') | 0 | - |
| coding_hard_calc | coding | ✅ | 5/5 tests | 36177 | 42.1 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5444 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5977 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 5312 | 40.9 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 1277 | 41.0 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5728 | 42.2 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5242 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2156 | 42.1 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 1953 | 42.1 |

### T0.6 p.95 k20 pres1.5

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 4941 | 41.1 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3084 | 41.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 7562 | 41.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4032 | 41.2 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 27471 | 41.1 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 27316 | 41.1 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2409 | 40.9 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2584 | 41.0 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 14676 | 41.1 |
| logic_boxes | reasoning | ❌ | Manzanas=Naranjas | 25163 | 41.1 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4832 | 41.1 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4737 | 41.1 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 25359 | 41.1 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 15112 | 41.2 |
| coding_hard_calc | coding | ❌ | Cannot read properties of undefined (reading 'type') | 0 | - |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 30235 | 41.1 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 11674 | 41.1 |
| coding_hard_lru | coding | ✅ | g1=1 g2=-1 g1b=-1 g3=3 g4=4 | 6217 | 41.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4967 | 40.0 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 2353 | 40.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 4724 | 41.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 4818 | 41.1 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2203 | 41.0 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2000 | 41.0 |

### T0.6 p.95 k20 rep1.1

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3361 | 41.1 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2329 | 41.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4387 | 41.1 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4113 | 41.1 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 27385 | 41.1 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 27364 | 41.1 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2588 | 41.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 3058 | 41.1 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 6969 | 41.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 5181 | 41.1 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4468 | 41.1 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4573 | 41.1 |
| text_transform_reverse | text | ❌ | ladra perro el, pero duerme gato El. | 25334 | 41.1 |
| text_transform_reverse | text | ❌ | ladra., perro, el, pero, duerme,, gato, El | 25378 | 41.1 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 32038 | 41.0 |
| coding_hard_calc | coding | ❌ | Trailing characters | 0 | - |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 12285 | 41.1 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 9674 | 41.1 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4939 | 40.1 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 2277 | 40.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 6299 | 41.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 11231 | 41.1 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 3056 | 41.0 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2000 | 41.0 |

### T1.0 p.95 k20 m.05 reason

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 5580 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2420 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4201 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4314 | 42.2 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 28415 | 42.1 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26644 | 42.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2473 | 42.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2013 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 4428 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 11233 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 5659 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4267 | 42.2 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 18312 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 6139 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 25040 | 42.1 |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 35403 | 42.1 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5909 | 42.2 |
| coding_hard_lru | coding | ❌ | this.cache.moveToKey is not a function | 12243 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4840 | 41.1 |
| retrieval_two_needles | retrieval | ✅ | QX-7419,ZK-2288 | 2517 | 41.0 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5423 | 42.2 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 3960 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2157 | 42.1 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 1949 | 42.1 |