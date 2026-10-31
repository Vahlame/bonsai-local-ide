# Matriz de visión · 2026-10-31T06-48-49

Mismo modelo, mismo prompt y mismo plan de KV. «Sin visión» arranca sin `--mmproj`: sirve para medir cuánto contexto/VRAM cuesta el proyector y si el modelo sigue siendo útil como texto.

| Modelo | Contexto con visión | Contexto sin visión | Δ contexto | VRAM con | VRAM sin | Visión |
|---|---:|---:|---:|---:|---:|:--:|
| qwen36-35b-a3b | 32768 | 32768 | +0 | 6835 MiB | 6835 MiB | sí |

## qwen36-35b-a3b

- Con visión: 5/5 pruebas
- Sin visión: 4/4 pruebas
