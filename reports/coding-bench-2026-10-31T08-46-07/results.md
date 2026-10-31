# Coding real · 2026-10-31T08-46-07

Dos tareas con tests ocultos, ejecutadas con `node --test`. No los escribe el modelo.

| # | Modelo | Proyecto | Bugfix | Global | tests | tok/s | tiempo |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | GPT-OSS 20B | 9/9 (100%) | 5/5 (100%) | **100%** | 14/14 | 30 | 64 s |
| 2 | Qwen3 30B-A3B 2507 | 7/9 (78%) | 5/5 (100%) | **86%** | 12/14 | 43 | 14 s |
| 3 | Qwen2.5 Coder 7B Instruct | 5/9 (56%) | 5/5 (100%) | **71%** | 10/14 | 73 | 6 s |
| 4 | Qwen3 4B Instruct 2507 | 4/9 (44%) | 5/5 (100%) | **64%** | 9/14 | 74 | 10 s |
| 5 | Qwen3.5 9B | 4/9 (44%) | 3/5 (60%) | **50%** | 7/14 | 41 | 35 s |
| 6 | Qwen3.6 35B-A3B | 0/9 (0%) | 5/5 (100%) | **35%** | 5/14 | 47 | 150 s |
| 7 | Ornith 1.5 9B | 3/9 (33%) | 1/5 (20%) | **29%** | 4/14 | 42 | 75 s |

Pipeline: **single** · reparaciones: **0**.

## Fallos por modelo

### GPT-OSS 20B

- Proyecto: **todos los tests pasan**
- Bugfix: **todos los tests pasan**

### Qwen3 30B-A3B 2507

- project: 2 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Qwen2.5 Coder 7B Instruct

- project: 4 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Qwen3 4B Instruct 2507

- project: 5 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Qwen3.5 9B

- project: 5 test(s) fallan de 9
- bugfix: 2 test(s) fallan de 5

### Qwen3.6 35B-A3B

- project: 9 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Ornith 1.5 9B

- project: 6 test(s) fallan de 9
- bugfix: 4 test(s) fallan de 5
