# Coding real · 2026-10-31T08-33-44

Dos tareas con tests ocultos, ejecutadas con `node --test`. No los escribe el modelo.

| # | Modelo | Proyecto | Bugfix | Global | tests | tok/s | tiempo |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | GPT-OSS 20B | 9/9 (100%) | 5/5 (100%) | **100%** | 14/14 | 30 | 109 s |
| 2 | Qwen3 4B Instruct 2507 | 4/5 (80%) | 5/5 (100%) | **87%** | 9/10 | 77 | 10 s |
| 3 | Qwen2.5 Coder 7B Instruct | 5/9 (56%) | 5/5 (100%) | **71%** | 10/14 | 72 | 6 s |
| 4 | Ornith 1.5 9B | 0/0 (0%) | 5/5 (100%) | **35%** | 5/5 | 42 | 64 s |
| 5 | Qwen3.5 9B | 0/0 (0%) | 3/5 (60%) | **21%** | 3/5 | 42 | 167 s |

Pipeline: **single** · reparaciones: **0**.

## Fallos por modelo

### GPT-OSS 20B

- Proyecto: **todos los tests pasan**
- Bugfix: **todos los tests pasan**

### Qwen3 4B Instruct 2507

- project: 1 test(s) fallan de 5
- Bugfix: **todos los tests pasan**

### Qwen2.5 Coder 7B Instruct

- project: 4 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Ornith 1.5 9B

- Bugfix: **todos los tests pasan**

### Qwen3.5 9B

- bugfix: 2 test(s) fallan de 5
