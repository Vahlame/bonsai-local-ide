# Bonsai Local IDE 1.9.0 — MoE híbrido: 35B en 8 GB de VRAM

**Fecha:** 31-oct-2026

## Lo nuevo

### Perfil `moe-hibrido`

El plan de motor ya no asume que todo el GGUF cabe en la VRAM. Para un MoE:

- lee la **tabla de tensores** del GGUF y separa los expertos
  (`blk.N.ffn_*_exps.weight`) de los pesos densos;
- mete en VRAM los densos + KV y las **últimas capas de expertos** que caben;
- deja el resto en RAM con `--n-cpu-moe N`;
- usa **32k de contexto y KV q8_0** por defecto, para no sacrificar expertos;
- manda el proyector de visión a CPU si así entran más capas;
- elige `--load-mode none` si los expertos de CPU caben en RAM; si no, `mmap`.

El reparto se recalcula en cada arranque con la ventana real. El lanzador aplica
12 hilos y batch 1024/512 (medidos) y sube la prioridad de memoria del proceso,
desactivando EcoQoS en portátiles.

### Resultado principal: Qwen3.6-35B-A3B

| Métrica | Valor |
|---|---:|
| Generación (128 tok, frío) | **42,5 tok/s** |
| Prompt (6.271 tok) | **818 tok/s** |
| VRAM pico | 6.853 MiB |
| RAM del proceso | 6.546 MiB |
| Contexto | 32.768 tok · q8_0 |
| Expertos en GPU | 18/40 (4.542 MiB) |
| Visión | 5/5, imagen ~8 s |
| Calidad (5 tareas) | 4/5 |

`--load-mode none` frente a `--load-mode mmap`: **42,5 vs 16,9 tok/s** de
generación y **818 vs 389 tok/s** de prompt. No es un truco de cuantización: es
el mismo GGUF y el mismo reparto; cambia cómo se cargan los pesos.

### Modelos MoE añadidos

| Modelo | Carga | Generación | Chat | Prompt | Calidad |
|---|---|---:|---:|---:|---:|
| Qwen3.6-35B-A3B | none | 42,5 tok/s | 46,1 tok/s | 818 tok/s | 4/5 |
| Qwen3-30B-A3B 2507 | none | 44,2 tok/s | 44,9 tok/s | 1.009 tok/s | 4/5 |
| GPT-OSS-20B | none | 32,6 tok/s | 32,8 tok/s | 972 tok/s | **5/5** |
| Nemotron 3 Nano 30B | mmap | 29,9 tok/s | 25,7 tok/s | 402 tok/s | 4/5 |

Los detalles, el caso `none` de Nemotron (40 tok/s pero 11,5 GiB de RAM) y la
metodología están en [reports/MOE-2026-10-31.md](../reports/MOE-2026-10-31.md).

### Coding real con tests ocultos

`bench-coding.mjs` mide dos tareas de proyecto: un `PriorityQueue` + `Scheduler`
multifichero desde cero (9 tests ocultos) y un bugfix de carrito (5 tests), con
`node --test` real. El modelo no escribe los tests.

| Modelo | Global | Proyecto | Bugfix | Reps |
|---|---:|---:|---:|---:|
| GPT-OSS-20B | **100 %** | 18/18 | 10/10 | 2 |
| Qwen3.6-35B-A3B | 96 % | 17/18 | 10/10 | 2 |
| Qwen3-30B-A3B 2507 | 86 % | 14/18 | 10/10 | 2 |
| Qwen3 4B 2507 | 64 % | 4/9 | 5/5 | 1 |
| Qwen3.5 9B | 57 % | 3/9 | 5/5 | 1 |
| Qwen2.5 Coder 7B | 49 % | 2/9 | 5/5 | 1 |
| Ornith 1.5 9B | 35 % | 0/9 | 5/5 | 1 |

**Recomendación:** GPT-OSS-20B para un proyecto complicado desde cero;
Qwen3.6-35B-A3B para bugfix/código guiado; Qwen3-30B-A3B si manda la velocidad.

Hallazgos de pipeline: quitar cercas markdown, normalizar rutas sin `src/`,
timeout por test con `taskkill /T`, denominador fijo y continuación cuando
`finish=length`. Informe: [reports/CODING-2026-10-31.md](../reports/CODING-2026-10-31.md).

En el agente real del IDE, GPT-OSS pasó 3/3 tareas. El perfil opt-in
`chat/coder-profile-moe.json` reduce `cross-file` de 133,6 s a 43,1 s y
`failing-test` de 66,6 s a 28,9 s:
[reports/CODER-PIPELINE-2026-10-31.md](../reports/CODER-PIPELINE-2026-10-31.md).

### Web app real

Taskboard full-stack con API y UI probada en navegador:

| Modelo | Global | API | UI |
|---|---:|---:|---:|
| GPT-OSS-20B | **100 %** | 8/8 | 3/3 |
| Qwen3.6-35B-A3B | 91 % | 7/8 | 3/3 |
| Qwen3-30B-A3B 2507 | 55 % | 4/8 | 2/3 |

Informe y capturas: [reports/WEBAPP-2026-10-31.md](../reports/WEBAPP-2026-10-31.md).

### Tuning del motor

`ngram-simple` sube la generación cruda a 71,6 tok/s pero deja el chat en 44,5;
el draft Qwen3 0.6B no compensa; 3 capas más de expertos en GPU dan +4,7 %
(46,4 tok/s) y 4 producen OOM. La base sigue siendo `--load-mode none` + 12
hilos + batch 1024/512:
[reports/ENGINE-2026-10-31.md](../reports/ENGINE-2026-10-31.md).

### Herramientas nuevas

- `scripts/moe-bench.mjs`: banco de MoE con reparto, carga, hilos, batch,
  precarga, VRAM/RAM y tok/s; incluye una pasada real por
  `/v1/chat/completions` con la plantilla del modelo.
- `scripts/precargar-gguf.mjs`: calienta solo las capas de expertos que se
  quedan en RAM.
- `scripts/win-cache.ps1`: purga la standby list para medir en frío.
- `scripts/win-optimize-process.ps1`: prioridad de memoria y EcoQoS.
- `scripts/fast-download.mjs`: descarga por rangos en paralelo (el CDN de HF
  limita cada conexión a ~1,5 MB/s).
- `scripts/chat-template-check.mjs`: audita la plantilla de **todos** los GGUF
  instalados; 34/34 con plantilla válida.
- `scripts/bench-coding.mjs` y `scripts/coding-report.mjs`: proyecto multifichero
  y bugfix con tests ocultos, ranking y gráficos.
- `scripts/coder-pipeline-report.mjs` y `chat/coder-profile-moe.json`: ablaciones
  del agente real y perfil rápido opt-in para MoE.
- `scripts/bench-webapp.mjs` y `scripts/webapp-report.mjs`: web app full-stack
  con API y UI Playwright, capturas y ranking.
- `scripts/engine-report.mjs`: matriz de tuning de tok/s y latencias.
- `scripts/catalog-report.mjs`: incluye el reparto MoE.

### Plantillas de chat

Cada modelo se prueba con su `tokenizer.chat_template`, no con un prompt
genérico. El lanzador lo pasa con `--chat-template-file`; el Model Lab y el
benchmark de calidad usan `/v1/chat/completions` con system+user. La auditoría
`chat-template-check.mjs` revisa los 34 modelos instalados.

### Corregido

- El script de parada solo reconocía `gpu-completa`: un MoE no se podía apagar
  ni cambiar desde el IDE. Ahora reconoce `moe-hibrido`.
- El IDE enviaba presets densos (`8GB-VISION-CONTEXT`) al lanzador MoE. Ahora el
  plan del modelo manda y no se pasa un preset que sobreescriba contexto/KV.
- `model-lab --all` y `model-tune --all` omitían los MoE.
- `bench-model-quality` pasaba `--chat-template-file` aunque el modelo no
  tuviera plantilla; ahora solo si existe.

### GPT-OSS: perfil afinado

GPT-OSS-20B queda como modelo principal para coding/web app:

- **Harmony** con `--jinja` y plantilla del GGUF; tool-calling y razonamiento
  verificados.
- **Muestreo oficial** (`temp 1.0`, `top_p 1.0`, `top_k 0`, `min_p 0.01`) por
  modelo, no el 0.6/0.9 genérico.
- **64k por defecto** y **128k máximo**, con selector en el Hub que recalcula
  `--n-cpu-moe`; 128k+q4 opcional.
- **61.070 tokens** de contexto con aguja correcta (`QX-7419`) y 777 tok/s de
  prefill.
- **Esfuerzo de razonamiento** configurable (automático/high por defecto).
- **18/18 + 10/10** en coding, **8/8 + 3/3** en web app, **3/3** en el agente.
- Hub rediseñado: resumen “Recomendado para coding”, KPIs, chips de capacidades y
  botones 32k/64k/96k/128k.

Detalle: [reports/GPTOSS-2026-10-31.md](../reports/GPTOSS-2026-10-31.md).

### Primer arranque y clones limpios

- **La UI pregunta qué modelo cargar** cuando la IA está apagada. El recomendado
  aparece primero, con sus benchmarks y contexto; se carga con el plan automático.
- **Sin modelos**, el diálogo explica que el IDE funciona sin IA y abre el
  **Model Hub** para descargar o importar un GGUF.
- **«Ahora no»** deja el IDE usable; **Ajustes → Preguntar modelo al iniciar**
  permite desactivar la pregunta.
- **`scripts/setup-clone.ps1`**: valida Node, instala `chat/node_modules`, busca
  el runtime y, con `-BuildRuntime`, instala la toolchain y compila llama.cpp.
- **`docs/PRIMER-ARRANQUE.md`** y el SVG `docs/graficos/primer-arranque.svg`
  documentan el camino desde `git clone` hasta el primer chat.
- Los pesos, `bin/`, `.local/` y `node_modules/` siguen fuera de Git: el
  repositorio es el IDE, no un disco de modelos.

## Verificación

- `npm test`: **42/42** (una pasada; `prueba-code-intelligence` puede fallar por
  un EPERM transitorio de Windows al borrar su temporal, pasa al repetirla).
- `npm run test:navegador`: **6/6** (incluye primer arranque sin modelos).
- `node scripts/model-plan.mjs`: incluye pruebas del reparto MoE y de
  `load-mode`.
- `node scripts/chat-template-check.mjs`: **34/34**.
- `node scripts/bench-coding.mjs --models gpt-oss-20b,qwen36-35b-a3b,qwen3-30b-a3b-2507 --reps 2`: 100 %, 96 % y 86 %.
- `node scripts/coding-report.mjs`: genera el informe y los SVG de coding.
- `node scripts/bench-webapp.mjs --models gpt-oss-20b,qwen36-35b-a3b,qwen3-30b-a3b-2507`: 100 %, 91 % y 55 %.
- `node scripts/engine-report.mjs`: matriz de tuning y SVG de tok/s.

## Limitaciones

- El contexto de un MoE lo fija el plan (32k por defecto). Subirlo reduce las
  capas de expertos que caben en la GPU; el lanzador lo recalcula, pero el
  ajuste global del IDE no se impone sobre el plan.
- Nemotron 3 Nano (16,85 GiB) no cabe entero en 16 GB de RAM: usará `mmap` y
  parte de los expertos vendrá del SSD. Es el caso que mide el suelo real.
- La calidad son 5 tareas deterministas, no un ranking estadístico.
