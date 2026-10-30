# Benchmark de muestreo - 20261030191657

Tareas: **6** · pensamiento 1024 · max_tokens 3000 · repeticiones 5 · 3 configuraciones

## Resultado global

| Config | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| T0.2 p.95 k20 | q8_0 | 32768 | 19/30 | 63.3% | 42.0 | 383s |
| T0.6 p.95 k20 code | q8_0 | 32768 | 21/30 | 70.0% | 42.2 | 371s |
| T0.6 p.90 k20 m.05 | q8_0 | 32768 | 22/30 | 73.3% | 42.2 | 375s |

### Parametros por configuracion

| Config | temp | top_p | top_k | min_p |
|---|---:|---:|---:|---:|
| T0.2 p.95 k20 | 0.2 | 0.95 | 20 | 0 |
| T0.6 p.95 k20 code | 0.6 | 0.95 | 20 | 0 |
| T0.6 p.90 k20 m.05 | 0.6 | 0.9 | 20 | 0.05 |

## Por categoria

| Config | coding | reasoning | data | text |
|---|---:|---:|---:|---:|
| T0.2 p.95 k20 | 47% | 100% | 100% | 40% |
| T0.6 p.95 k20 code | 60% | 60% | 100% | 80% |
| T0.6 p.90 k20 m.05 | 60% | 80% | 100% | 80% |

## Detalle por tarea


### T0.2 p.95 k20

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3120 | 42.1 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3007 | 41.9 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3018 | 41.9 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3166 | 42.0 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3000 | 42.0 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 9053 | 42.0 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 11002 | 41.9 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 7439 | 41.9 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 5391 | 41.9 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 16133 | 41.9 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4487 | 41.9 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4413 | 41.9 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4417 | 41.9 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4275 | 42.3 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4362 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 15244 | 41.9 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 9554 | 42.1 |
| text_transform_reverse | text | ❌ | ladra perro, el pero el gato El. | 24770 | 41.9 |
| text_transform_reverse | text | ❌ | ladra perro, el pero duerme gato. El | 24775 | 42.1 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 24695 | 42.1 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 34502 | 42.0 |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 37537 | 42.0 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 28847 | 41.9 |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 26752 | 42.1 |
| coding_hard_calc | coding | ❌ | Maximum call stack size exceeded | 0 | - |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 6024 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 10110 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5474 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5495 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5520 | 42.2 |

### T0.6 p.95 k20 code

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3208 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3193 | 42.3 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3147 | 42.3 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2985 | 42.3 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3079 | 42.2 |
| logic_boxes | reasoning | ❌ | <Mezcla>=<Manzanas> | 7097 | 42.3 |
| logic_boxes | reasoning | ❌ | Manzanas=Naranjas | 9285 | 42.2 |
| logic_boxes | reasoning | ✅ | <Mezcla>=Manzanas | 23719 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 7907 | 42.3 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 8315 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4928 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4106 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4387 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4625 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4834 | 42.0 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 24740 | 42.1 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 21411 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 7409 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 10802 | 42.2 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 24646 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 24838 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 34197 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 38739 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 32226 | 42.2 |
| coding_hard_calc | coding | ❌ | Unexpected token | 0 | - |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5219 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5727 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 6085 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5419 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5119 | 42.2 |

### T0.6 p.90 k20 m.05

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3347 | 42.2 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2981 | 42.3 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3189 | 42.3 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 3171 | 42.3 |
| coding_impl_chunk | coding | ✅ | 3/3 tests | 2887 | 42.3 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 6715 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 9186 | 42.3 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 9284 | 42.2 |
| logic_boxes | reasoning | ✅ | Mezcla=Manzanas | 14631 | 42.2 |
| logic_boxes | reasoning | ❌ | <Mezcla>=<Manzanas> | 15944 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4142 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4407 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 3706 | 42.1 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 3795 | 42.2 |
| data_sql_result | data | ✅ | [{"ciudad":"Valencia","total":300},{"ciudad":"Barcelona","total":275}] | 4362 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 22341 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 12747 | 42.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 6847 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 18230 | 42.2 |
| text_transform_reverse | text | ❌ | ladra. perro el pero duerme, gato El. | 24650 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 24874 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 26303 | 42.2 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 33221 | 42.2 |
| coding_hard_calc | coding | ❌ | fallo 10/2-3 | 36896 | 42.1 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 37557 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5744 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 10845 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 6106 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 5376 | 42.2 |
| coding_hard_lru | coding | ❌ | g1=undefined g2=-1 g1b=-1 g3=undefined g4=undefined | 11127 | 42.2 |