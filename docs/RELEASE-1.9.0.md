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
- `scripts/catalog-report.mjs`: incluye el reparto MoE.

### Plantillas de chat

Cada modelo se prueba con su `tokenizer.chat_template`, no con un prompt
genérico. El lanzador lo pasa con `--chat-template-file`; el Model Lab y el
benchmark de calidad usan `/v1/chat/completions` con system+user. La auditoría
`chat-template-check.mjs` revisa los 31 modelos instalados.

### Corregido

- El script de parada solo reconocía `gpu-completa`: un MoE no se podía apagar
  ni cambiar desde el IDE. Ahora reconoce `moe-hibrido`.
- El IDE enviaba presets densos (`8GB-VISION-CONTEXT`) al lanzador MoE. Ahora el
  plan del modelo manda y no se pasa un preset que sobreescriba contexto/KV.
- `model-lab --all` y `model-tune --all` omitían los MoE.
- `bench-model-quality` pasaba `--chat-template-file` aunque el modelo no
  tuviera plantilla; ahora solo si existe.

## Verificación

- `npm test`: **42/42** (una pasada; `prueba-code-intelligence` puede fallar por
  un EPERM transitorio de Windows al borrar su temporal, pasa al repetirla).
- `npm run test:navegador`: **5/5**.
- `node scripts/model-plan.mjs`: incluye pruebas del reparto MoE y de
  `load-mode`.
- `node scripts/chat-template-check.mjs`: **34/34**.

## Limitaciones

- El contexto de un MoE lo fija el plan (32k por defecto). Subirlo reduce las
  capas de expertos que caben en la GPU; el lanzador lo recalcula, pero el
  ajuste global del IDE no se impone sobre el plan.
- Nemotron 3 Nano (16,85 GiB) no cabe entero en 16 GB de RAM: usará `mmap` y
  parte de los expertos vendrá del SSD. Es el caso que mide el suelo real.
- La calidad son 5 tareas deterministas, no un ranking estadístico.

