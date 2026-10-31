# Coding real · 2026-10-31T09-44-42

Dos tareas con tests ocultos, ejecutadas con `node --test`. No los escribe el modelo.

| # | Modelo | Proyecto | Bugfix | Global | tests | tok/s | tiempo |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | Qwen3 4B Instruct 2507 | 4/9 (44%) | 5/5 (100%) | **64%** | 9/14 | 74 | 11 s |
| 2 | Qwen3.5 9B | 3/9 (33%) | 5/5 (100%) | **57%** | 8/14 | 41 | 78 s |
| 3 | Qwen2.5 Coder 7B Instruct | 2/9 (22%) | 5/5 (100%) | **49%** | 7/14 | 67 | 7 s |
| 4 | Ornith 1.5 9B | 0/9 (0%) | 5/5 (100%) | **35%** | 5/14 | 26 | 121 s |

Pipeline: **single** · reparaciones: **0**.

## Fallos por modelo

### Qwen3 4B Instruct 2507

- project: 5 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Qwen3.5 9B

- project: 6 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Qwen2.5 Coder 7B Instruct

- project: 7 test(s) fallan de 9
- Bugfix: **todos los tests pasan**

### Ornith 1.5 9B

- project: 9 test(s) fallan de 9
- Bugfix: **todos los tests pasan**
