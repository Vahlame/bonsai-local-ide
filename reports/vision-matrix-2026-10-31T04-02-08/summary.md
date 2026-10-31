# Matriz de visión · 2026-10-31T04-02-08

Mismo modelo, mismo prompt y mismo plan de KV. «Sin visión» arranca sin `--mmproj`: sirve para medir cuánto contexto/VRAM cuesta el proyector y si el modelo sigue siendo útil como texto.

| Modelo | Contexto con visión | Contexto sin visión | Δ contexto | VRAM con | VRAM sin | Visión |
|---|---:|---:|---:|---:|---:|:--:|
| minicpm-v47-1b | 131072 | 131072 | +0 | 2305 MiB | 2305 MiB | sí |

## minicpm-v47-1b

- Con visión: 5/5 pruebas
- Sin visión: 4/4 pruebas
