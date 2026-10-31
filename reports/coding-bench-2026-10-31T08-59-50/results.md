# Coding real · 2026-10-31T08-59-50

Dos tareas con tests ocultos, ejecutadas con `node --test`. No los escribe el modelo.

| # | Modelo | Proyecto | Bugfix | Global | tests | tok/s | tiempo |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | Qwen3 30B-A3B 2507 | 6/9 (67%) | 5/5 (100%) | **78%** | 11/14 | 42 | 15 s |
| 2 | GPT-OSS 20B | 9/9 (100%) | 1/5 (20%) | **72%** | 10/14 | 31 | 59 s |
| 3 | Qwen3.5 9B | 4/9 (44%) | 5/5 (100%) | **64%** | 9/14 | 41 | 24 s |
| 4 | Qwen3 4B Instruct 2507 | 4/9 (44%) | 5/5 (100%) | **64%** | 9/14 | 74 | 10 s |
| 5 | Qwen2.5 Coder 7B Instruct | 2/9 (22%) | 5/5 (100%) | **49%** | 7/14 | 70 | 7 s |
| 6 | Ornith 1.5 9B | 0/9 (0%) | 5/5 (100%) | **35%** | 5/14 | 26 | 119 s |

Pipeline: **single** · reparaciones: **0**.

## Fallos por modelo

### Qwen3 30B-A3B 2507

- project: 3 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### GPT-OSS 20B

- bugfix: 4 test(s) fallan de 5
- Proyecto: **todos los tests pasan**

### Qwen3.5 9B

- project: 5 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Qwen3 4B Instruct 2507

- project: 5 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Qwen2.5 Coder 7B Instruct

- project: 7 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Ornith 1.5 9B

- project: 9 test(s) fallan de 9
- Bugfix: **todos los tests pasan**
