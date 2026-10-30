# Benchmark de calidad por preset - 20261030181448

Tareas: **2** · pensamiento 1024 · max_tokens 3000 · temperatura 0.2

## Resultado global

| Preset | KV | Ctx | Puntos | % | Gen t/s | Tiempo |
|---|---|---:|---:|---:|---:|---:|
| 8GB-VISION-HIGH | q8_0 | 32768 | 6/10 | 60.0% | 42.2 | 252s |
| 8GB-VISION-MAX-F16 | f16 | 43008 | 6/10 | 60.0% | 42.5 | 219s |

## Por categoria

| Preset | text | coding |
|---|---:|---:|
| 8GB-VISION-HIGH | 80% | 40% |
| 8GB-VISION-MAX-F16 | 100% | 20% |

## Detalle por tarea


### 8GB-VISION-HIGH

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 15809 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 24600 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 13288 | 41.2 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 17352 | 42.3 |
| text_transform_reverse | text | ❌ | ladra perro el pero duerme, gato El. | 24426 | 42.6 |
| coding_hard_calc | coding | ✅ | 5/5 tests | 21348 | 42.5 |
| coding_hard_calc | coding | ❌ | Invalid number | 0 | - |
| coding_hard_calc | coding | ❌ | fallo 2+3*4 | 36090 | 42.1 |
| coding_hard_calc | coding | ❌ | Unexpected end | 0 | - |
| coding_hard_calc | coding | ✅ | 5/5 tests | 30969 | 42.0 |

### 8GB-VISION-MAX-F16

| Tarea | Categoria | OK | Detalle | ms | t/s |
|---|---|:--:|---|---:|---:|
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 18040 | 42.4 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 10717 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 11819 | 42.3 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 15771 | 42.7 |
| text_transform_reverse | text | ✅ | ladra. perro el pero duerme, gato El | 12373 | 42.8 |
| coding_hard_calc | coding | ❌ | Unexpected token | 0 | - |
| coding_hard_calc | coding | ❌ | next is not defined | 0 | - |
| coding_hard_calc | coding | ✅ | 5/5 tests | 29690 | 42.2 |
| coding_hard_calc | coding | ❌ | Assignment to constant variable. | 0 | - |
| coding_hard_calc | coding | ❌ | next is not defined | 0 | - |