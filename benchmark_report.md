# Resultados maestros — RTX 4060 8 GB

Generado: `2026-10-31T21:31:24+00:00` · 187 filas de 41 suites.

Los datos crudos viven en `reports/bench-*`; este archivo solo los normaliza.
Metodología y límites: [BENCHMARKS.md](BENCHMARKS.md).

## Baseline

| Modelo | Quant | Prefill 2048 | Decode 128 | VRAM pico | Fuente |
|---|---|---:|---:|---:|---|
| gpt-oss-20b | MXFP4 | 912 | 26.2 | 5,145 | `bench-baseline-20261031` |
| ornith9b | Q4_K_M | 2,213 | 43.4 | 5,763 | `bench-baseline-20261031` |
| qwen25-coder-7b | Q4_K_M | 2,564 | 52.1 | 5,065 | `bench-baseline-20261031` |
| qwen3-4b | Q4_K_M | 4,017 | 81.9 | 3,963 | `bench-baseline-20261031` |

## Cuantización (Qwen3-4B)

| Quant | Decode 128 | PPL | Δ PPL | Fuente |
|---|---:|---:|---:|---|
| Q3_K_M | 90.8 | 13.7688 | 15.44% | `bench-quant-20261031` |
| Q4_K_M | 81.9 | 12.2553 | 2.75% | `bench-quant-20261031` |
| Q5_K_M | 71.5 | 12.1321 | 1.72% | `bench-quant-20261031` |
| Q6_K | 65.5 | 11.9654 | 0.32% | `bench-quant-20261031` |
| Q8_0 | 52.9 | 11.9276 | 0.00% | `bench-quant-20261031` |

## MoE de coding

| Suite | Modelo | Ctx | n-cpu-moe | Hilos | Decode | Prefill | VRAM |
|---|---|---:|---:|---:|---:|---:|---:|
| `moe32k-n11-t8` | gpt-oss-20b | 32768 | 11 | 8 | 38.66 | 960 | 7,275 |
| `moe64k-n12-t8-r3` | gpt-oss-20b | 65536 | 12 | 8 | 36.76 | 908 | 7,309 |
| `moe64k-ncmoe-12` | gpt-oss-20b | 65536 | 12 | 12 | 35.19 | 918 | 7,309 |
| `moe64k-ncmoe-12-bs` | gpt-oss-20b | 65536 | 12 | 12 | 35.81 | 894 | 7,331 |
| `moe64k-ncmoe12-t10` | gpt-oss-20b | 65536 | 12 | 10 | 36.41 | 915 | 7,309 |
| `moe64k-ncmoe12-t12` | gpt-oss-20b | 65536 | 12 | 12 | 35.30 | 917 | 7,309 |
| `moe64k-ncmoe12-t14` | gpt-oss-20b | 65536 | 12 | 14 | 34.60 | 912 | 7,309 |
| `moe64k-ncmoe12-t16` | gpt-oss-20b | 65536 | 12 | 16 | 32.37 | 914 | 7,309 |
| `moe64k-ncmoe12-t8` | gpt-oss-20b | 65536 | 12 | 8 | 36.67 | 911 | 7,309 |
| `moe64k-ncmoe-13` | gpt-oss-20b | 65536 | 13 | 12 | 33.92 | 863 | 6,905 |
| `moe64k-ncmoe-14` | gpt-oss-20b | 65536 | 14 | 12 | 32.16 | 827 | 6,501 |
| `moe64k-ncmoe-15` | gpt-oss-20b | 65536 | 15 | 12 | 30.31 | 796 | 6,097 |
| `moe64k-ncmoe-16` | gpt-oss-20b | 65536 | 16 | 12 | 30.03 | 762 | 5,691 |
| `moe64k-ncmoe-17` | gpt-oss-20b | 65536 | 17 | 12 | 28.86 | 674 | 5,287 |
| `moe96k-ncmoe-13` | gpt-oss-20b | 98304 | 13 | 12 | 34.09 | 849 | 7,373 |
| `moe128k-n14-t8` | gpt-oss-20b | 131072 | 14 | 8 | 33.64 | 823 | 7,473 |
| `qwen3-30b-32k-n26-t12` | qwen3-30b | 32768 | 26 | 12 | 45.88 | 864 | 7,535 |
| `qwen3-30b-32k-n26-t8` | qwen3-30b | 32768 | 26 | 8 | 46.61 | 848 | 7,535 |
| `qwen36-32k-n19-t8` | qwen36-35b | 32768 | 19 | 8 | 44.79 | 856 | 7,409 |
| `qwen36-32k-n20-t8` | qwen36-35b | 32768 | 20 | 8 | 44.37 | 831 | 7,163 |
| `qwen36-32k-n22-t8` | qwen36-35b | 32768 | 22 | 8 | 42.52 | 789 | 6,671 |
| `qwen36-64k-n21-t8` | qwen36-35b | 65536 | 21 | 8 | 43.92 | 814 | 7,327 |

## Prompt cache

| Suite | Fase | TTFT | Fuente |
|---|---|---:|---|
| `server-gpt-oss` | cache-cold | 3,814.3 ms | `bench-server-gpt-oss` |
| `server-gpt-oss` | cache-warm | 72.2 ms | `bench-server-gpt-oss` |
| `server-qwen3-4b` | cache-cold | 1,002.6 ms | `bench-server-qwen3-4b` |
| `server-qwen3-4b` | cache-warm | 23.3 ms | `bench-server-qwen3-4b` |

## MMVQ A/B (Qwen3-4B Q4_K_M)

| Suite | Fase | Test | tok/s | Fuente |
|---|---|---|---:|---|
| `ab-control-4b` | decode | tg128 | 81.99 | `bench-ab-control-4b` |
| `ab-control-4b` | decode | tg128 | 82.06 | `bench-ab-control-4b` |
| `ab-control-4b` | decode | tg256 | 81.98 | `bench-ab-control-4b` |
| `ab-control-4b` | decode | tg256 | 81.98 | `bench-ab-control-4b` |
| `ab-control-4b` | prefill | pp2048 | 4,034.13 | `bench-ab-control-4b` |
| `ab-control-4b` | prefill | pp2048 | 4,001.32 | `bench-ab-control-4b` |
| `ab-control-4b` | prefill | pp512 | 4,236.23 | `bench-ab-control-4b` |
| `ab-control-4b` | prefill | pp512 | 4,218.92 | `bench-ab-control-4b` |
| `ab-control-4b-d4k` | decode | tg128 | 82.01 | `bench-ab-control-4b-d4k` |
| `ab-control-4b-d4k` | decode | tg128 | 81.90 | `bench-ab-control-4b-d4k` |
| `ab-control-4b-d4k` | decode | tg128@d4096 | 67.77 | `bench-ab-control-4b-d4k` |
| `ab-control-4b-d4k` | decode | tg128@d4096 | 67.81 | `bench-ab-control-4b-d4k` |
| `ab-control-4b-d4k` | prefill | pp512 | 4,212.19 | `bench-ab-control-4b-d4k` |
| `ab-control-4b-d4k` | prefill | pp512 | 4,221.70 | `bench-ab-control-4b-d4k` |
| `ab-control-4b-d4k` | prefill | pp512@d4096 | 3,245.49 | `bench-ab-control-4b-d4k` |
| `ab-control-4b-d4k` | prefill | pp512@d4096 | 3,243.18 | `bench-ab-control-4b-d4k` |
| `ab-control-7b` | decode | tg128 | 52.21 | `bench-ab-control-7b` |
| `ab-control-7b` | decode | tg128 | 52.23 | `bench-ab-control-7b` |
| `ab-control-7b` | prefill | pp512 | 2,649.35 | `bench-ab-control-7b` |
| `ab-control-7b` | prefill | pp512 | 2,638.28 | `bench-ab-control-7b` |
| `ab-control-q6` | decode | tg128 | 65.86 | `bench-ab-control-q6` |
| `ab-control-q6` | decode | tg128 | 65.70 | `bench-ab-control-q6` |
| `ab-control-q6` | prefill | pp512 | 3,846.77 | `bench-ab-control-q6` |
| `ab-control-q6` | prefill | pp512 | 3,847.05 | `bench-ab-control-q6` |
| `ab-control-q8` | decode | tg128 | 52.98 | `bench-ab-control-q8` |
| `ab-control-q8` | decode | tg128 | 52.96 | `bench-ab-control-q8` |
| `ab-control-q8` | prefill | pp512 | 4,434.23 | `bench-ab-control-q8` |
| `ab-control-q8` | prefill | pp512 | 4,453.38 | `bench-ab-control-q8` |
| `ab-control-qwen35-9b` | decode | tg128 | 50.62 | `bench-ab-control-qwen35-9b` |
| `ab-control-qwen35-9b` | decode | tg128 | 50.35 | `bench-ab-control-qwen35-9b` |
| `ab-control-qwen35-9b` | prefill | pp512 | 2,146.47 | `bench-ab-control-qwen35-9b` |
| `ab-control-qwen35-9b` | prefill | pp512 | 2,139.31 | `bench-ab-control-qwen35-9b` |
| `ab-mvq2-4b-d4k` | decode | tg128 | 85.52 | `bench-ab-mvq2-4b-d4k` |
| `ab-mvq2-4b-d4k` | decode | tg128 | 85.56 | `bench-ab-mvq2-4b-d4k` |
| `ab-mvq2-4b-d4k` | decode | tg128@d4096 | 70.15 | `bench-ab-mvq2-4b-d4k` |
| `ab-mvq2-4b-d4k` | decode | tg128@d4096 | 70.17 | `bench-ab-mvq2-4b-d4k` |
| `ab-mvq2-4b-d4k` | prefill | pp512 | 4,206.63 | `bench-ab-mvq2-4b-d4k` |
| `ab-mvq2-4b-d4k` | prefill | pp512 | 4,225.62 | `bench-ab-mvq2-4b-d4k` |
| `ab-mvq2-4b-d4k` | prefill | pp512@d4096 | 3,267.28 | `bench-ab-mvq2-4b-d4k` |
| `ab-mvq2-4b-d4k` | prefill | pp512@d4096 | 3,267.93 | `bench-ab-mvq2-4b-d4k` |
| `ab-mvq2-7b` | decode | tg128 | 51.98 | `bench-ab-mvq2-7b` |
| `ab-mvq2-7b` | decode | tg128 | 52.00 | `bench-ab-mvq2-7b` |
| `ab-mvq2-7b` | prefill | pp512 | 2,634.03 | `bench-ab-mvq2-7b` |
| `ab-mvq2-7b` | prefill | pp512 | 2,636.30 | `bench-ab-mvq2-7b` |
| `ab-mvq2-q6` | decode | tg128 | 66.89 | `bench-ab-mvq2-q6` |
| `ab-mvq2-q6` | decode | tg128 | 66.86 | `bench-ab-mvq2-q6` |
| `ab-mvq2-q6` | prefill | pp512 | 3,832.35 | `bench-ab-mvq2-q6` |
| `ab-mvq2-q6` | prefill | pp512 | 3,828.85 | `bench-ab-mvq2-q6` |
| `ab-mvq2-q8` | decode | tg128 | 53.07 | `bench-ab-mvq2-q8` |
| `ab-mvq2-q8` | decode | tg128 | 53.06 | `bench-ab-mvq2-q8` |
| `ab-mvq2-q8` | prefill | pp512 | 4,460.33 | `bench-ab-mvq2-q8` |
| `ab-mvq2-q8` | prefill | pp512 | 4,454.12 | `bench-ab-mvq2-q8` |
| `ab-mvq2-qwen35-9b` | decode | tg128 | 50.58 | `bench-ab-mvq2-qwen35-9b` |
| `ab-mvq2-qwen35-9b` | decode | tg128 | 50.55 | `bench-ab-mvq2-qwen35-9b` |
| `ab-mvq2-qwen35-9b` | prefill | pp512 | 2,128.71 | `bench-ab-mvq2-qwen35-9b` |
| `ab-mvq2-qwen35-9b` | prefill | pp512 | 2,128.21 | `bench-ab-mvq2-qwen35-9b` |
| `ab-mvq2-scoped-4b` | decode | tg128 | 85.86 | `bench-ab-mvq2-scoped-4b` |
| `ab-mvq2-scoped-4b` | decode | tg128 | 85.67 | `bench-ab-mvq2-scoped-4b` |
| `ab-mvq2-scoped-4b` | decode | tg256 | 85.70 | `bench-ab-mvq2-scoped-4b` |
| `ab-mvq2-scoped-4b` | decode | tg256 | 85.68 | `bench-ab-mvq2-scoped-4b` |
| `ab-mvq2-scoped-4b` | prefill | pp2048 | 4,030.92 | `bench-ab-mvq2-scoped-4b` |
| `ab-mvq2-scoped-4b` | prefill | pp2048 | 4,003.85 | `bench-ab-mvq2-scoped-4b` |
| `ab-mvq2-scoped-4b` | prefill | pp512 | 4,266.65 | `bench-ab-mvq2-scoped-4b` |
| `ab-mvq2-scoped-4b` | prefill | pp512 | 4,239.88 | `bench-ab-mvq2-scoped-4b` |
| `ab-mvq8-4b` | decode | tg128 | 61.29 | `bench-ab-mvq8-4b` |
| `ab-mvq8-4b` | decode | tg128 | 61.31 | `bench-ab-mvq8-4b` |
| `ab-mvq8-4b` | decode | tg256 | 61.26 | `bench-ab-mvq8-4b` |
| `ab-mvq8-4b` | decode | tg256 | 61.30 | `bench-ab-mvq8-4b` |
| `ab-mvq8-4b` | prefill | pp2048 | 3,996.33 | `bench-ab-mvq8-4b` |
| `ab-mvq8-4b` | prefill | pp2048 | 3,977.93 | `bench-ab-mvq8-4b` |
| `ab-mvq8-4b` | prefill | pp512 | 4,202.90 | `bench-ab-mvq8-4b` |
| `ab-mvq8-4b` | prefill | pp512 | 4,207.97 | `bench-ab-mvq8-4b` |

## Cómo regenerar

```powershell
python bench\merge_results.py
python bench\charts.py
```
