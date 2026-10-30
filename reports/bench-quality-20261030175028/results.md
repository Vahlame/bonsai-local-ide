# Benchmark de calidad por preset - 20261030175028

Tareas: **18** · pensamiento 1024 · max_tokens 3000 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| 8GB-VISION-MAX-F16 | f16 | 43008 | 16/18 | 88.9% | 42.3 | 149s |
| 8GB-VISION-HIGH | q8_0 | 32768 | 17/18 | 94.4% | 42.1 | 146s |
| 8GB-CODE-BALANCED | q8_0 | 32768 | 16/18 | 88.9% | 42.1 | 146s |
| 8GB-VISION-BALANCED | q4_0 | 28672 | 15/18 | 83.3% | 42.1 | 157s |
| 8GB-RESEARCH | q4_0 | 65536 | 16/18 | 88.9% | 42.1 | 147s |

## Por categoria

| Preset | coding | reasoning | data | instruction | text | retrieval | spanish | tools |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 8GB-VISION-MAX-F16 | 67% | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 8GB-VISION-HIGH | 83% | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 8GB-CODE-BALANCED | 67% | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 8GB-VISION-BALANCED | 67% | 100% | 100% | 100% | 0% | 100% | 100% | 100% |
| 8GB-RESEARCH | 67% | 100% | 100% | 100% | 100% | 100% | 100% | 100% |

## Detalle por tarea


### 8GB-VISION-MAX-F16

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3000 | 42.7 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3840 | 42.7 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26555 | 42.3 |
| coding_trace | coding | ✅ | respuesta=2-6 | 3634 | 42.4 |
| reasoning_math_train | reasoning | ✅ | 12:00 | 5101 | 42.3 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2606 | 42.4 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 14834 | 42.5 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4384 | 42.5 |
| instruction_json | instruction | ✅ | {"name":"Ana Ruiz","age":34,"skills":["Python","Kubernetes","SQL"]} | 2851 | 42.6 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 9458 | 42.5 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 4465 | 41.4 |
| spanish_entities | spanish | ✅ | {"persona":"Marta Lopez","empresa":"Acme Iberia","ciudad":"Sevilla"} | 2655 | 42.5 |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 37002 | 42.4 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5864 | 42.5 |
| reasoning_multi_rates | reasoning | ✅ | 3 | 4432 | 42.5 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4618 | 41.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 4676 | 42.5 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2118 | 42.3 |

### 8GB-VISION-HIGH

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2733 | 42.1 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4057 | 42.3 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26716 | 42.2 |
| coding_trace | coding | ✅ | respuesta=2-6 | 3608 | 42.3 |
| reasoning_math_train | reasoning | ✅ | 12:00 | 3699 | 42.3 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2500 | 42.2 |
| logic_boxes | reasoning | ✅ | <Mezcla>=Manzanas | 4829 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4352 | 42.2 |
| instruction_json | instruction | ✅ | {"name":"Ana Ruiz","age":34,"skills":["Python","Kubernetes","SQL"]} | 3390 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 12616 | 42.3 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 4319 | 41.3 |
| spanish_entities | spanish | ✅ | {"persona":"Marta Lopez","empresa":"Acme Iberia","ciudad":"Sevilla"} | 2688 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 39077 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5451 | 42.3 |
| reasoning_multi_rates | reasoning | ✅ | 3 | 4142 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4923 | 41.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5677 | 42.3 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2149 | 42.1 |

### 8GB-CODE-BALANCED

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3141 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 3705 | 42.3 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26685 | 42.2 |
| coding_trace | coding | ✅ | respuesta=2-6 | 3606 | 42.3 |
| reasoning_math_train | reasoning | ✅ | 12:00 | 7752 | 42.3 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2686 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 7793 | 42.3 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4356 | 42.2 |
| instruction_json | instruction | ✅ | {"name":"Ana Ruiz","age":34,"skills":["Python","Kubernetes","SQL"]} | 3061 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 13748 | 42.3 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 3964 | 41.4 |
| spanish_entities | spanish | ✅ | {"persona":"Marta Lopez","empresa":"Acme Iberia","ciudad":"Sevilla"} | 2685 | 42.3 |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 33383 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5556 | 42.2 |
| reasoning_multi_rates | reasoning | ✅ | 3 | 4346 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4697 | 41.1 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 4680 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2151 | 42.1 |

### 8GB-VISION-BALANCED

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3307 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4080 | 42.3 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26883 | 42.2 |
| coding_trace | coding | ✅ | respuesta=2-6 | 3421 | 42.3 |
| reasoning_math_train | reasoning | ✅ | 12:00 | 4045 | 42.2 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2661 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 12619 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4453 | 42.2 |
| instruction_json | instruction | ✅ | {"name":"Ana Ruiz","age":34,"skills":["Python","Kubernetes","SQL"]} | 2921 | 42.2 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 24689 | 42.2 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 3964 | 41.3 |
| spanish_entities | spanish | ✅ | {"persona":"Marta Lopez","empresa":"Acme Iberia","ciudad":"Sevilla"} | 3360 | 42.2 |
| coding_hard_calc | coding | ❌ | Assignment to constant variable. | 0 | - |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5815 | 42.2 |
| reasoning_multi_rates | reasoning | ✅ | 3 | 2055 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419,ZK-2288 | 4662 | 40.9 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5794 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2154 | 42.1 |

### 8GB-RESEARCH

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3139 | 42.2 |
| coding_impl_balanced | coding | ✅ | 6/6 tests | 4379 | 42.2 |
| coding_debug_bsearch | coding | ✅ | 5/5 tests | 26741 | 42.2 |
| coding_trace | coding | ✅ | respuesta=2-6 | 3512 | 42.3 |
| reasoning_math_train | reasoning | ✅ | 12:00 | 3491 | 42.3 |
| reasoning_math_prob | reasoning | ✅ | 3/10 | 2495 | 42.3 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 9460 | 42.3 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4523 | 42.2 |
| instruction_json | instruction | ✅ | {"name":"Ana Ruiz","age":34,"skills":["Python","Kubernetes","SQL"]} | 3356 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 13460 | 42.3 |
| retrieval_needle | retrieval | ✅ | QX-7419 | 4149 | 41.3 |
| spanish_entities | spanish | ✅ | {"persona":"Marta Lopez","empresa":"Acme Iberia","ciudad":"Sevilla"} | 3206 | 42.3 |
| coding_hard_calc | coding | ❌ | Unexpected token | 0 | - |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5469 | 42.2 |
| reasoning_multi_rates | reasoning | ✅ | 3 | 4233 | 42.2 |
| retrieval_two_needles | retrieval | ✅ | QX-7419, ZK-2288 | 4905 | 41.0 |
| instruction_nested | instruction | ✅ | {"pedido":778,"cliente":"Ana","items":[{"producto":"Teclado","cantidad":2,"precio":25},{"producto":"Raton","cantidad":1, | 5509 | 42.2 |
| tool_call_convert | tools | ✅ | {"monto":250,"de":"USD","a":"EUR"} | 2160 | 42.2 |