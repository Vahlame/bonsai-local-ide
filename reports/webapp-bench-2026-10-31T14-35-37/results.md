# Web app real · 2026-10-31T14-35-37

Taskboard full-stack (Node ESM, sin dependencias): API CRUD + stats + UI. Tests ocultos de API y Playwright.

| # | Modelo | Global | API | UI | Reps | tok/s | Tiempo |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | **GPT-OSS 20B** | **100%** | 8/8 | 3/3 | 1 | 27 | 150 s |
| 2 | **Qwen3.6 35B-A3B** | **91%** | 7/8 | 3/3 | 1 | 44 | 140 s |

![Web app benchmark](../docs/graficos/bench-webapp.svg)

## Detalle

### GPT-OSS 20B

- run 1: API 8/8, UI 3/3, 100%, 149.6 s, captura `reports\webapp-bench-2026-10-31T14-35-37\gpt-oss-20b\run1\screenshot.png`

### Qwen3.6 35B-A3B

- run 1: API 7/8, UI 3/3, 91%, 140.4 s, captura `reports\webapp-bench-2026-10-31T14-35-37\qwen36-35b-a3b\run1\screenshot.png`
