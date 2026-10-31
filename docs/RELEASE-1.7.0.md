# Bonsai Local IDE 1.7.0 — Model Hub y plan por modelo

**Fecha:** 31-oct-2026

## Lo nuevo

### Model Hub dentro del IDE

- Botón **Modelos** en la barra superior y entrada **Catálogo de modelos…** en el
  menú del chip de modelo.
- Catálogo curado con Qwen3 4B, Qwen2.5 Coder 7B, Gemma 3 4B (visión), Llama 3.2
  3B y DeepSeek R1 Distill 7B, más un borrador Qwen3 0.6B.
- Búsqueda real en Hugging Face (API pública), inspección de repos, selección de
  cuantización y proyector de visión.
- Descarga por URL directa, importación de GGUF locales y escaneo automático de
  `models/` al arrancar.
- Descargas reanudables (`.part` + `Range`), progreso, cancelación y verificación
  SHA-256. La revisión de HF se fija al commit.
- Borrado seguro con confirmación.

### Un plan de motor distinto para cada modelo

`chat/model-plan.mjs` lee la cabecera del GGUF y calcula:

- KV real por token (K+V, por capa; soporta modelos híbridos con
  `full_attention_interval`, como Ornith/Qwen3.5).
- contexto máximo con la VRAM libre: f16 si llega al nativo, si no q8_0, si no
  q4_0; mínimo 4k.
- proyector de visión en GPU o CPU según lo que gane en contexto.
- reserva de VRAM y margen reales.

El plan se guarda en `models/hub-catalog.json`, se usa al pulsar **Usar ahora** y
al elegir **Automático** en la barra del servidor. Los modelos nuevos aparecen en
el selector sin reiniciar el IDE.

### Model Lab

```powershell
node scripts/model-lab.mjs list
node scripts/model-lab.mjs probe --model qwen3-4b-2507
node scripts/model-lab.mjs probe --all
```

Mide arranque, VRAM pico, ventana real, TTFT, tok/s, respuesta corta, JSON,
código ejecutado en un sandbox, tool-calling, retrieval a ~8k y visión. Escribe
`reports/model-lab-<fecha>/` y actualiza el registro.

### Benchmark de calidad por modelo

```powershell
node scripts/bench-model-quality.mjs --model qwen25-coder-7b
```

Usa el plan AUTO del modelo y sus muestreos recomendados. Sigue aceptando
`--presets` para comparar configuraciones concretas.

### Investigación Strata

[STRATA-Y-MEMORIA](STRATA-Y-MEMORIA.md) explica cómo Strata reparte el trabajo
entre VRAM, RAM y SSD, cómo viajan los expertos y el KV, qué es el KV streaming,
la caché adaptativa de expertos, MTP/prompt lookup y qué ideas se pueden probar
en llama.cpp con 8 GB de VRAM. Incluye una tabla honesta de lo que **no** aplica
a esta máquina.

## Verificación

- `node chat/model-plan.mjs` — parser, planes y nombres seguros.
- `node chat/prueba-model-hub.mjs` — descarga reanudable local, SHA-256,
  registro y endpoints.
- `node scripts/model-lab.mjs probe --model ornith9b` — 6/6 pruebas
  (saludo, JSON, código, tool-calling, retrieval y visión) con 110.592 tokens,
  q8_0, 7.475 MiB de VRAM pico y 6,1 s de arranque.
- `npm test` — 42/42 suites aisladas.
- `npm run test:navegador` — 5/5, incluida la apertura del Model Hub.

Evidencia completa: [reports/MODEL-HUB-2026-10-31.md](../reports/MODEL-HUB-2026-10-31.md).

### Modelos descargados y probados

| Modelo | Plan | VRAM pico | Sondas | Calidad* |
|---|---:|---:|---:|---:|
| Qwen3 4B Instruct 2507 | 57.344 / q8_0 | 7.215 MiB | 5/5 | 4/5 |
| Qwen2.5 Coder 7B | 32.768 / f16 + draft | 7.065 MiB | 5/5 | 3/5 |
| Gemma 3 4B IT | 131.072 / f16 | 5.769 MiB | 5/6 | 3/5 |
| Llama 3.2 3B | 83.968 / q8_0 | 7.345 MiB | 5/5 | 2/5 |
| DeepSeek R1 Distill 7B | 79.872 / q8_0 | 6.865 MiB | 4/5 | 3/5 |
| K2-Horizon 7B (×2) | 16–18k / q8_0 | ~6.370 MiB | 3/5 | — |

\* 5 de las 18 tareas (código, SQL, JSON anidado, tool-calling, retrieval), una
pasada. Gemma cabe a 131k porque su atención es de ventana deslizante; el plan
ahora lo tiene en cuenta. Qwen2.5 Coder emite tool calls en texto y el adaptador
`function-call`/`xml-json` las traduce. Con el draft Qwen2.5 0.5B pasa de 47,2 a
68,8–71,8 tok/s (1,46–1,52×) a cambio de 469 MiB de VRAM.

## Limitaciones

- Los GGUF partidos aún no se agrupan automáticamente.
- Los repos gated de Hugging Face requieren descarga manual + Importar.
- El plan es conservador; el Model Lab mide el pico real y actualiza el registro.
