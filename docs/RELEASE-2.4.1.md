# Bonsai Local IDE 2.4.1

**Fecha:** 1 de noviembre de 2026
**Tema:** auditoría completa, CI, portabilidad y cierre de deuda técnica.

Esta es una release de **calidad**, no de features. Se revisó el árbol
versionado completo, se corrigieron rutas no portables y BOM, se añadió CI y
se dejó una auditoría reproducible. La release 2.4.0 sigue siendo la referencia
funcional; 2.4.1 la deja presentable para revisión externa.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Archivos Node (`chat`, `scripts`, `bench`, `runtime`) | **168/168** sintaxis |
| Scripts PowerShell | **32/32** parseo |
| Scripts Python | **28/28** compilación |
| JSON | **618/618** |
| SVG | **55/55** XML |
| Documentación | **69 documentos, 190 enlaces, 0 roto(s)** |
| Pruebas aisladas | **51/51 OK** |
| UI real | **0 errores de consola**, `IA lista`, Hub y Ajustes |
| Modelo real | Qwen3.6, 22 capas de expertos en CPU, visión CPU, `-1` |
| Secretos | solo claves ficticias en tests; sin `.env` versionado |
| Tamaño versionado | ~57 MB |

Detalle: [AUDIT-2026-11-01](AUDIT-2026-11-01.md).

## Correcciones

- **BOM** eliminado de `bench/results/quantize-qwen3-4b.json` y de los dos
  informes `reports/builds/lab-*.json`.
- **Rutas portables** en `bench-tasks.py`, `bench-skyblock.py`,
  `make-bench-svgs.py`, `check-ui.cjs`, `check-task.cjs` y
  `check-skyblock.cjs`; nuevo helper `scripts/lib/playwright.cjs`.
- **OOM de UI/visión**: el reparto conservador del plan (22 capas de expertos
  en CPU para Qwen3.6) evita que el navegador y los buffers de compute agoten
  la VRAM.
- **`-1` sin límite / `-2` automático**: propagación correcta en
  `start-server.ps1`, `start-ui.ps1` y `start-chat.ps1`; `pensar=0` se respeta
  y los modelos sin razonamiento no reciben `--reasoning-budget`.
- **Medidor de contexto**: `/api/state` usa la ventana actual, no la del modelo
  anterior.
- **Diálogo de inicio**: actualiza `ventana` al cargar el modelo.
- **UTF-8 del helper**: stdout/stderr y subprocess en UTF-8; se acabaron los
  fallos con emojis.
- **Checker de fluidos**: reinicia una simulación pausada y acepta el HUD; el
  404 de favicon ya no cuenta como error.
- **Reserva de pensamiento**: se eliminó la suma duplicada en `sliceCap` y el
  test expresa el invariante correcto (`max_tokens >= 2048 + presupuesto`).

## CI

`.github/workflows/ci.yml` ejecuta en Windows:

1. Node 22 y Python 3.12.
2. `npm ci --prefix chat`.
3. `node scripts/check-doc-links.mjs`.
4. `node scripts/run-tests.mjs`.

La UI real (`check-ui.cjs`) y las pruebas GPU quedan fuera de CI porque
necesitan un modelo cargado; se documentan en `CONTRIBUTING.md`.

## Compatibilidad

- Windows 10/11, Node ≥ 22, GPU CUDA (RTX 4060 8 GB probada).
- Los GGUF, binarios de llama.cpp y vendors de demos no se versionan.
- Los informes históricos conservan rutas y cifras de esta máquina; son
  evidencia, no plantillas de configuración.
- El perfil `qwen38-27b-perf-iq4` y su GGUF original se conservan para rollback.

## Enlaces

- [Auditoría completa](AUDIT-2026-11-01.md)
- [Benchmark de tareas](qwen38/TASK-BENCHMARK-2026-11-01.md)
- [Scorecard de Qwen3.6](qwen38/MODEL-SCORECARD-2026-11-01.md)
- [Contribuir](../CONTRIBUTING.md)
- [Arquitectura](../ARCHITECTURE.md)
