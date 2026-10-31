# Coding real · 2026-10-31T09-10-47

Dos tareas con tests ocultos, ejecutadas con `node --test`. No los escribe el modelo.

| # | Modelo | Proyecto | Bugfix | Global | tests | tok/s | tiempo |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | GPT-OSS 20B | 27/27 (100%) | 11/15 (73%) | **91%** | 38/42 | 30 | 48 s |
| 2 | Qwen3.6 35B-A3B | 15/27 (56%) | 15/15 (100%) | **71%** | 30/42 | 40 | 69 s |

Pipeline: **single** · reparaciones: **0**.

## Fallos por modelo

### GPT-OSS 20B

- bugfix: 4 test(s) fallan de 15
- Proyecto: **todos los tests pasan**

### Qwen3.6 35B-A3B

- project: 12 test(s) fallan de 27
- Bugfix: **todos los tests pasan**
