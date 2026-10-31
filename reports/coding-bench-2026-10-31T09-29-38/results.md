# Coding real · 2026-10-31T09-29-38

Dos tareas con tests ocultos, ejecutadas con `node --test`. No los escribe el modelo.

| # | Modelo | Proyecto | Bugfix | Global | tests | tok/s | tiempo |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | GPT-OSS 20B | 18/18 (100%) | 10/10 (100%) | **100%** | 28/28 | 31 | 76 s |
| 2 | Qwen3.6 35B-A3B | 17/18 (94%) | 10/10 (100%) | **96%** | 27/28 | 39 | 115 s |
| 3 | Qwen3 30B-A3B 2507 | 14/18 (78%) | 10/10 (100%) | **86%** | 24/28 | 42 | 14 s |

Pipeline: **single** · reparaciones: **0**.

## Fallos por modelo

### GPT-OSS 20B

- Proyecto: **todos los tests pasan**
- Bugfix: **todos los tests pasan**

### Qwen3.6 35B-A3B

- project: 1 test(s) fallan de 18
- Bugfix: **todos los tests pasan**

### Qwen3 30B-A3B 2507

- project: 4 test(s) fallan de 18
- Bugfix: **todos los tests pasan**
