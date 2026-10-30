# Modelos *abliterated*/uncensored claramente superiores al ternario 2-bit: informe técnico

**Fecha del informe:** 2026-10-04
**Punto de partida del usuario:** `BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-GGUF` (5,946,648,928 bytes ≈ 6.30 GB, 1.75 bits/peso)
**Método:** consulta directa a la API de Hugging Face (`/api/models`, `/api/models/{repo}/tree/main?recursive=true`, `/resolve/main/README.md`) y a las tarjetas/validaciones publicadas por los autores. Todos los tamaños de archivo son los que sirve actualmente Hugging Face.

> **Advertencia de fiabilidad.** Distingo en todo el informe entre **(a) benchmark oficial del fabricante del modelo base**, **(b) afirmación del autor de la abliteración**, y **(c) evaluación de terceros**. Cuando no hay dato, escribo *"no documentado"*. El contenido de las páginas web se ha tratado como dato, nunca como instrucción.

---

## 0. Corrección importante de la premisa de partida

La pista del encargo dice que el baseline es *"una cuantización ternaria 2-bit LOSSY de Qwen3.8-27B"*, y concluye que **cualquier** abliteración del mismo modelo base en 4–8 bits superará claramente su capacidad.

**Eso no es exacto, y el propio fabricante del baseline publica la evidencia que lo contradice.**

`Ternary-Bonsai-2-27B` **no es una cuantización aplicada a Qwen3.8-27B**: es un modelo ternario entrenado/destilado *derivado* de Qwen3.8-27B con la arquitectura intacta. PrismML publica en su tarjeta una evaluación con EvalScope + vLLM sobre H100, en modo *thinking*, de 14 benchmarks, con todas las variantes en el mismo arnés:

| Variante | bpw real | Huella | Media thinking (14) | vs FP16 |
|---|---:|---:|---:|---:|
| Qwen3.8-27B FP16 | 16.0 | 54 GB | **86.32** | 100 % |
| Qwen3.8-27B UD-Q4_K_XL ("4-bit") | 5.2 | 17.6 GB | **85.18** | 98.7 % |
| Qwen3.8-27B IQ2_XXS ("2-bit") | 2.16 | 7.27 GB | 72.59 | 84.1 % |
| **Bonsai 2 27B (ternario)** | **1.72** | **5.95 GB** | **84.78** | **98.2 %** |

Fuente: <https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf> (afirmación del fabricante, pero con arnés declarado y reproducible).

Consecuencia cuantitativa: **la brecha ternario → Q4_K_XL es de ~0.4 puntos de media, no de un salto de capacidad.** Una cuantización IQ2_XXS convencional del mismo base es **12 puntos peor** que el ternario. Es decir: el baseline del usuario está *mucho más cerca del techo de lo que sugiere su tamaño*, y el margen disponible por subir de 1.75 a 4–8 bits es pequeño en promedio.

**Dónde sí hay margen real** (misma tabla, desglose por categoría y por benchmark — líneas 226–261 de la tarjeta):

| Categoría / benchmark | FP16 | UD-Q4_K_XL | **Bonsai 2 ternario** | Δ tensorial (Q4 − ternario) |
|---|---:|---:|---:|---:|
| Knowledge & reasoning (MMLU-Redux, MuSR) | 85.55 | — | **79.86** | **≈ +4 a +4,5 pp a favor de 4 bits** |
| MMLU-Redux | 91.46 | 93.35 | 89.09 | **+4.26 pp** |
| MuSR | 79.63 | 73.01 | 70.63 | **+2.38 pp** |
| MMMU-Pro (visión) | 81.73 | 81.73 | 75.49 | **+6.24 pp** |
| OCR Bench v2 (visión) | 60.99 | 65.45 | 56.88 | **+8.57 pp** |
| Math (GSM8K, MATH-500, AIME25/26) | 97.06 | — | **96.57** | ≈ 0 |
| AIME25 | 96.67 | 92.91 | **95.00** | **−2.09 pp (el ternario gana)** |
| AIME26 | 94.58 | 93.00 | **95.83** | **−2.83 pp (el ternario gana)** |
| Coding (HumanEval+, MBPP+, LiveCodeBench) | 89.07 | — | **89.42** | ≈ 0 / ternario ligeramente arriba |
| LiveCodeBench | 90.05 | 87.96 | **90.07** | **−2.11 pp (el ternario gana)** |
| IFEval / IFBench | 81.25 | — | **82.66** | ternario arriba |
| BFCL v3 (tools) | 76.74 | 75.05 | 74.92 | ≈ 0 |
| **Media (14)** | **86.32** | **85.18** | **84.78** | **+0.40 pp** |

**Conclusión operativa (y es la clave de todo el informe):**
- Subir a Q4_K/Q5_K/Q6_K/Q8_0 del **mismo** Qwen3.8-27B abliterado compra, sobre todo, **conocimiento y razonamiento (+2 a +4,5 pp) y multimodalidad (+6 a +8,6 pp)**.
- En **matemáticas y código el ternario Bonsai 2 ya está a la par o por delante**. No habrá mejora ahí.
- Lo que sí se gana de forma inequívoca, y no aparece en la media: **coherencia práctica del modo thinking**. El Build baseline tiene un fallo documentado de razonamiento desbocado (ver §2).
- Los saltos de capacidad de verdad (**+10 puntos o más**) requieren cambiar de modelo, no de precisión: MoE más grandes.

---

## 1. Tabla comparativa

### 1.1 Baseline (para referencia)

| Campo | Valor | Fuente |
|---|---|---|
| Repo | `BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-GGUF` | <https://huggingface.co/BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-GGUF> |
| Base | `prism-ml/Ternary-Bonsai-2-27B-gguf` (derivado de Qwen3.8-27B) | ídem |
| Parámetros | 27.36B totales (24.35B backbone + 2.54B emb/head + 0.46B torre de visión), **denso híbrido** (Gated DeltaNet + atención completa), 64 capas | <https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf> |
| Cuantización | Ternaria g128 `{−1,0,+1}`, PTQ1_0, **1.75 bpw**, 5.95 GB (1 archivo, 6,302 MB servidos) | API HF |
| Contexto | 262,144 tokens | ídem |
| Visión / MTP | **No incluida** (mmproj no publicado en ese repo) / **no** (el hermano PQ2_0-MTP sí) | tarjeta del autor |
| Licencia | Apache-2.0 | API HF |
| Fechas | creado 2026-09-18, última modificación 2026-09-23 | API HF |
| Descargas / likes | 74,852 / 71 | API HF |
| Benchmarks del autor | SimpleSafetyTests n=100: refusal 83 %→**0 %**; calidad StrongReject 0.163→**0.776**; XSTest-safe n=250: sobre-rechazo 1.6 %→**0.0 %**; MMLU 14,042 (0-shot): 0.7802→**0.7814** (+0.12 pp, McNemar p=0.51); HumanEval-164 pass@1: 0.890→**0.860** (−3.0 pp, p=0.18) | tarjeta del autor |
| Evaluación de terceros | Shootout comunitario de BoldingBuilds (23-sep-2026), mismo juez `Qwen3.8-27B-OBLITERATED Q8_0`, 4×RTX 3090: **MMLU 0.780 stock → confirmado para los tres archivos con su edición**; HumanEval −3.0 pp; **modo thinking on con presupuesto 4,096 tok: 24 % (PTQ1_0) / 27 % (PQ2_0) de prompts dañinos NO producen respuesta** (stock 0 %); con greedy sube a 63 %/65 % | <https://huggingface.co/spaces/BoldingBuilds/bonsai-2-uncensored-shootout> |
| Requisito de runtime | **Fork propio de llama.cpp** (PrismML); no carga en llama.cpp upstream | tarjeta del autor |

> **Este es el fallo práctico más importante del baseline:** en modo thinking (que es el modo por defecto de la plantilla de chat) pierde la respuesta en ~1 de cada 4–5 prompts dañinos por agotamiento del presupuesto de razonamiento, y con greedy decodificación en ~2 de cada 3.

### 1.2 Familia Qwen3.8-27B (mismo base, denso, 27.32B, 262,144 ctx, VLM nativo)

Todas estas variantes conservan visión (mmproj separado) y la mayoría el cabezal MTP nativo. Los tamaños son GB decimales tal y como los sirve HF.

| Repo | Licencia | Fecha / Descargas / Likes | Cuantizaciones GGUF disponibles (tamaño) | Benchmarks / refusal documentados |
|---|---|---|---|---|
| **`huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF`**<br><https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF> | Apache-2.0 | 2026-08-16 / **2,057,848** / **1136** | **bf16 52.13**; **Q8_0 27.70**, Q8_0_L 36.98; **Q6_K 21.39**, Q6_K_L 23.79; **Q5_K 18.63**, Q5_K_L 21.81; **Q4_K 16.03**, Q4_K_L 19.95; Q3_K 12.88, Q3_K_L 17.82; Q2_K 10.36, Q2_K_L 16.42; **UD-Q8_K_XL 30.00**; UD-Q6_K_XL 23.68; UD-Q5_K_XL 19.72; **UD-Q4_K_XL 16.57**; UD-Q3_K_XL 12.71; UD-Q2_K_XL 9.55; UD-IQ4_XS 13.74; UD-IQ3_S 11.40; UD-IQ3_XXS 10.51; UD-IQ2_S 8.03 (y gemelo `-MTP` 8.37); GSQ-RCO-IQ3_S 11.23 (con Twin/UD-DW-MTP); UD-DW-Q4_K_M 15.78; UD-DW-Q6_K_L 22.84; UD-DW-Q8_K_L 25.99; **Ternary-Bonsai-PTQ1_0 6.30 / PQ2_0 7.35 / f16 51.32**; mmproj bf16 888 MB | **Ningún benchmark de capacidad publicado.** El autor dosifica: *"crude, proof-of-concept implementation"*. Abliteración aplicada **solo a capas 22–52** (0-based). Almacenamiento total del repo: **783 GB** |
| **`0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF`**<br><https://huggingface.co/0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF> | Apache-2.0 | 2026-08-14 / **1,350,398** / **615** | **BF16 51.32** / F16 51.32; **Q8_0 27.27**; **Q6_K 21.06**; **Q5_K_M 18.34**; **Q4_K_M 15.78**; Q3_K_M 12.69; **IQ4_XS 14.49** / **IQ4_NL 15.15**; IQ3_M 12.00; IQ3_XXS 10.67; IQ2_M 9.54; IQ2_XXS 8.04; IQ1_M 7.28; **IQ1_S 6.82**; además gemelos `-mtp`, `-multilingual` y `-vision`; mmproj Q8_0 600 MB; sidecar `mtp-RVN.gguf` 1.73 GB; **GSQ-3bit safetensors 26.44 GB** (65 shards, MLP-only, 9h18m en 1×RTX PRO 6000) | Tarjeta con **guía explícita de GPU/RAM** (8/12/16/24/32/64 GB). GSQ-3bit: coseno 0.9842 vs F16, 8 niveles, memoria 28.4 GB. **Sin benchmarks de capacidad.** Declara que dejó intactas algunas categorías de seguridad duras. Shootout: con thinking off **rechaza 11–12 % de los 100 prompts dañinos**; con thinking on 26 % sin respuesta a 4,096 tok. Almacenamiento del repo: **3.99 TB** |
| **`Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF`** + **BF16**<br><https://huggingface.co/Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF><br><https://huggingface.co/Blackfrost-AI/Qwen3.8-27B-ABLITERATED-BF16> | Apache-2.0 | 2026-08-14 / 75,730 (GGUF) y 1,218 (BF16) / 252 y 32 | **Q8_0 27.70**; **Q6_K 21.39**; **Q5_K_M 18.63**, Q5_K_S 18.09; **Q4_K_M 16.03**, Q4_K_S 15.09; Q3_K_M 12.88, Q3_K_S 11.69; Q2_K 10.36; mmproj F16 884 MB / Q8_0 600 MB; **DFlash2 BF16 sidecar 3.68 GB**; BF16 padre: **51.75 GB** en 18 shards | **Refusal 11/450 = 2.4 %** (embudo manual: 150 AdvBench + 150 StrongREJECT + 150 XSTest; 1 AdvBench, 5 StrongREJECT, 5 XSTest), 0 incoherencia global declarada (autor). **WikiText-2 PPL del padre BF16: 8.4764 word-PPL / 1.4914 byte-PPL / 0.5766 bits/byte**. MTP nativo embebido en **todos** los cuants; velocidad (autobench): mediana 109.31 tok/s, 55.8 % de aceptación de draft. **MMLU: no medido por el autor.** Shootout: **MMLU −2.68 pp (p<0.001, pérdida significativa)**; único build con 5 % de no-respuesta en thinking on (el mejor en ese eje) |
| **`AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16`**<br><https://huggingface.co/AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16> | Apache-2.0 | 2026-08-15 / 14,895 / 222 | **Solo BF16 maestro: 51.75 GB** (3 shards). Repo hermano NVFP4-mixto ≈23 GB (`...-NVFP4-MIXED`). **No encontré repo GGUF público de AEON-7** (la ruta `AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-GGUF` devuelve 401 / no existe) | **KL 0.0991 nats/token** (`full_distribution_kl`, primeros 3 tokens, 100 prompts inocuos reservados; mediana 0.013; 29/97 aperturas <0.001) — autor. **0 rechazos explícitos** en 100 dañinos reservados según lectura humana del autor (el juez `gemini-3.1-flash-lite` marcaba 36 R; el autor sostiene que 25 de esos 36 sí entregaron carga útil). **Sin MMLU/GPQA/HumanEval.** Validado en 1×H200 con vLLM 0.27.1, aceptación MTP 40–66 % |
| **`soyaakinohara/qwen3.8-27b-abliterated-3.69bpw-12GB-MTP.gguf`**<br><https://huggingface.co/soyaakinohara/qwen3.8-27b-abliterated-3.69bpw-12GB-MTP.gguf> | Apache-2.0 (base AEON-7) | 2026-08-16 / 46,673 / 111 | **Un único archivo: 12,015 MB (12.6 GB), 3.69 bpw, con MTP**; ctx 262,144; multilingüe ja/en | **Ningún benchmark publicado.** El autor no publica evaluación |
| ⭐ **`dealignai/Qwen3.8-27B-UNCENSORED-GGUF`** (serie CRACK)<br><https://huggingface.co/dealignai/Qwen3.8-27B-UNCENSORED-GGUF> | Apache-2.0 | 2026-08-14 / 21,542 / 72 | **Q8_0 27.70**; **Q6_K_L 22.08**; **Q6_K 21.50**; **Q4_K_M 16.22**; **IQ4_XS 14.83**; **IQ3_M 12.44**; **IQ2_M 9.99**; mmproj F16 888 MB (imagen **y vídeo**); MTP nativo (`blk.64`) en **cada** cuant | ⭐ **La evidencia por cuant mejor documentada de todo el informe y la única con MMLU base-vs-abliterado por cuant.** **HarmBench-240** (cumplimiento *coherente*, con filtro automático que descarta basura/bucles, thinking off): Q8_0 **98.8 % (237/240)**, Q6_K_L 98.8 %, Q6_K 98.8 %, **Q4_K_M 98.8 %**, IQ4_XS 98.3 %, IQ3_M 98.3 %, **IQ2_M 97.5 % (234/240)**, **0 respuestas gibberish en todos**. **MMLU** (500 preguntas balanceadas sobre las 57 materias, chat-templated, logit A–D, reasoning off), base → CRACK, mismo juego de preguntas: Q8_0 84.0→82.8; Q6_K_L 84.2→83.2; Q6_K 84.8→82.4; **Q4_K_M 83.8→81.8**; IQ4_XS 83.2→83.4; IQ3_M 83.4→81.6; **IQ2_M 79.8→76.0**. **Aceptación MTP ~52–53 %** (normal ~68 %, dañino ~42 %), por encima del ~47 % de referencia de la arquitectura. Por tema (Q8/Q6/IQ2 idénticos): misinformation 54/54, illegal 53/53, cybercrime 52/52, harassment 21/21, harmful 18/18, chem-bio 39/42. Portan las **puertas de recurrencia SSM (`ssm_alpha`/`ssm_beta`) y el bloque MTP en q8_0**, decisión técnicamente correcta en un modelo híbrido recurrente. **Reserva: son afirmaciones del autor**, no hay verificación de terceros de estos números |

### 1.3 Arquitecturas mayores / MoE

| Repo | Parámetros (total / activos) | Tipo | Contexto | Visión / MTP | Licencia | Fecha / Desc / Likes | Tamaños GGUF (o formato) | Benchmarks / refusal documentados |
|---|---|---|---|---|---|---|---|---|
| **`IsValorum/Qwen3.8-35B-A3B-Distill-MTP-APEX-I-MiniPlus-V2.1-Abliterated-GGUF`**<br><https://huggingface.co/IsValorum/Qwen3.8-35B-A3B-Distill-MTP-APEX-I-MiniPlus-V2.1-Abliterated-GGUF> | **34.66B / 3B activos** (256 expertos, 8/tok) | MoE (`qwen35moe`) | 262,144 | **Sí / Sí** (mmproj Q8_0 585 MB; MTP Q8_0 1.90 GB, Q4_0 1.14 GB) | Apache-2.0 | 2026-09-20 / 46,842 / 30 | **Un solo archivo principal: 14.66 GB (13.65 GiB) a 3.40 bpw** | **PPL WikiText-2 5.1280 ± 0.1312 vs ~5.10 FP16 (ΔPPL +0.028, autor)**; **D_KL = 0.0076** (autor); **0/10 refusals** en un sondeo de 10 prompts (autor, muestra muy pequeña). **Sin MMLU/GPQA/HumanEval.** Cita un benchmark **independiente de terceros** (zephel01, Occamy V2) sobre la *cuantización*, no sobre este modelo: 93.3 % resueltas @32K, 90.0 % @65K, 247–251 tok/s en RTX 5090 |
| **`huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF`**<br><https://huggingface.co/huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF> | **284.33B** (43 capas, 256 expertos, 6/tok, 1 KV head) | MoE (`deepseek4`) | **1,048,576** | No documentado / dspark draft (BF16 10.79 GB, Q8_0 10.39 GB) | **MIT** | 2026-08-02 / 363,369 / 216 | **Q2 82.70 GB**; **Q2_K 93.07 GB**; Q4-mxfp4 148.75 GB; **Q4_K 157.01 GB** | **Ninguno.** Tarjeta de 5.3 KB, sin evaluación |
| **`apetersson/DeepSeek-V4-Flash-0731-Abliterated-FP8`**<br><https://huggingface.co/apetersson/DeepSeek-V4-Flash-0731-Abliterated-FP8> | 284.33B (mismo base) | MoE, FP8 nativo | 1,048,576 | No documentado | MIT | 2026-07-31 / 13,084 / 38 | **Safetensors FP8: 155.43 GB** (48 shards). Sin GGUF | **Sí, con matices explícitos del autor: UncensorBench n=200 → 0 rechazos duros, cumplimiento de palabra clave 200/200; XSTest n=450 → 0/450 rechazos y 0/250 sobre-rechazos; StrongREJECT-small n=180 → 0 rechazos duros con heurística local.** El autor declara literalmente que **no** ejecutó el juez oficial de StrongREJECT, que **no** hizo benchmark de capacidad y que **no** cuantificó el efecto de la cuantización. |
| **`dealignai/DeepSeek-V4.1-Flash-UNCENSORED-FP8`**<br><https://huggingface.co/dealignai/DeepSeek-V4.1-Flash-UNCENSORED-FP8> | **552B backbone, 8B/16B activos** (40 capas, 384 expertos, 6/tok, 1 KV head); `gguf.total` del clon GGUF = 754.6B (incluye tablas Engram) | MoE (`deepseek_v41`) | **1,048,576** | **Sí (DeepSeek-ViT) / Sí (DSpark)** | MIT | 2026-09-10 / 64,765 / **408** | **Safetensors FP8: 475.25 GB** (48 shards). Pesos ≈510 GB | **Los benchmarks más completos de toda la lista (autor).** **HarmBench-320** completo 2×2: base 137/320 (**42.81 %**) → CRACK **320/320 (100 %)** con effort=off; con effort=max el base cae a **1.56 %** y el CRACK sigue en **100 %**. Por categoría (7/7): 100 % en chemical_biological, copyright, cybercrime_intrusion, harassment, harmful, illegal, misinformation. **MMLU-14k completo: base 86.96 % → CRACK 82.74 % (−4.22 pp)**; excluyendo el cluster de ética (moral_scenarios, business_ethics, professional_law, jurisprudence, philosophy) **−1.1 pp**. Pasó estrés de coherencia 1,000 tok, 4 turnos multi-turno y ruta de visión. |
| **`pyrodog/DeepSeek-V4.1-Flash-UNCENSORED-DwarfStar-Q2`**<br><https://huggingface.co/pyrodog/DeepSeek-V4.1-Flash-UNCENSORED-DwarfStar-Q2> | Igual que el anterior (754.6B con Engram) | MoE, GGUF Q2 con streaming de expertos | 262,144 compartidos (probado) | **Sí (proyector BF16 925 MB) / MTP nativo** | MIT | 2026-09-14 / 42,428 / 10 | **Un archivo Q2: 348,771.75 MB (348.8 GB)** | Autor explícitamente honesto: **tres ejercicios de código artesanales** (CSV+decimales exactos, reintentos HTTP, paginación keyset SQLite) pasaron tests independientes escritos antes de la generación; 14.2/11.2/6.9 min. **"no es un benchmark de código ni prueba de fiabilidad"**; **no** verificó las afirmaciones de refusal del publicador ni cómo sobreviven al Q2. Incluye `VALIDATION-REPORT.md`, `coding-metrics.json` |
| **`audnai/penclaw-GLM-5.3-abliterated`**<br><https://huggingface.co/audnai/penclaw-GLM-5.3-abliterated> | GLM-5.3 completo (78 capas, hidden 6144, 256 expertos, 8/tok); el GGUF de unsloth da **753.86B** | MoE | 1,048,576 | No documentado | **"other"** (no Apache/MIT) | 2026-09-01 / 1,442 / **303** | **Safetensors: 3,514.4 GB (3.51 TB)** en 705 archivos, con subcarpetas `iter4`, `iter11`, `iter12`… (múltiples iteraciones completas). **Sin GGUF** | **Ninguno.** README de 3.7 KB; el fichero README crudo devuelve **401** vía `/raw/`. Nombre del tokenizador interno: "warlock/audn" |
| **`huihui-ai/Huihui-GLM-5.3-Flash-abliterated-GGUF`**<br><https://huggingface.co/huihui-ai/Huihui-GLM-5.3-Flash-abliterated-GGUF> | **320.76B / 18B activos** (45 capas, 288 expertos, 8/tok) | MoE (`glm5-next`) | **1,048,576** | **Sí** (mmproj bf16 1.11 GB) / no documentado | **MIT** | 2026-09-26 / 14,193 / 152 | **UD-IQ1_S: 88.8 GB** (3 shards: 47.3+41.4 GB); **UD-IQ4_XS: 149.5 GB** (5 shards); **UD-Q4_K_XL: 190.5 GB** (6 shards). Almacenamiento del repo: **93.1 GB** | **Ninguno.** Tarjeta de 2.9 KB |
| **`Bahushruth/Qwen3.6-35B-A3B-abliterated-v4`**<br><https://huggingface.co/Bahushruth/Qwen3.6-35B-A3B-abliterated-v4> | ~32.3B (256 expertos, 8/tok) | MoE (`qwen3_5_moe_text`) | 262,144 | No / No | Apache-2.0 | 2026-06-11 / 574,460 / 12 | **Solo safetensors BF16: 64.56 GB** (2 shards). **Sin GGUF: hay que cuantizarlo uno mismo** | **Tabla de abliteración del autor:** refusal dañino ~98 % → **0 % (0/16)**; refusal en prompts inofensivos 0 % → 0 %. Historial de iteraciones: v1 (10 direcciones, ortho estándar) → 0 % refusal pero **capacidades destruidas**; v3 (7 direcciones, norm-preserving) → 94 % refusal; **v4 (1 dirección, 7,356 prompts, norm-preserving) → 0 % e "intacto"**. El autor justifica: *"una dirección bien estimada supera a muchas mal estimadas"*. Entrenado/evaluado en **Modal H100 80 GB, 128 GB RAM** |

### 1.4 Otros candidatos que encontré y que no estaban en la lista del encargo

| Repo | Por qué importa | Datos clave |
|---|---|---|
| **`HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF`**<br><https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF> | **Es el Qwen3.8-27B uncensored más popular de toda la plataforma y el mejor equipado**: visión + MTP nativo + sidecar FastMTP + cuants "K_P" propios | Apache-2.0; 2026-08-17; **2,077,955 descargas / 1,616 likes**. Tamaños: **Q8_K_P 31.46 GB** (9.21 bpw), Q6_K_P 25.92 (7.59), Q5_K_P 20.22 (5.92), **Q4_K_P 17.92 (5.25)**, IQ4_XS 15.71 (4.60), Q3_K_P 13.44 (3.93), IQ3_M 12.79, IQ3_XS 12.18, Q2_K_P 10.68, IQ2_M 10.32; mmproj BF16 931 MB; FastMTP 32K 903 MB. **"0/465 Refusals*"** (afirmación del autor; **el asterisco no tiene nota metodológica en la tarjeta → no verificado**). Velocidad medida con MTP: hasta 3.02× TG de documento / 1.93× TG de razonamiento vs MTP off, **en RTX PRO 6000 Blackwell 96 GB**. Ventana completa 190,000 tokens + 64 generados a 1,613 tok/s PP y 131.8 tok/s TG |
| `JonathanColetti/Qwen3.8-27B-Uncensored-GGUF`<br><https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF> | 2.º más popular de la familia; 15 archivos GGUF | Apache-2.0; 2026-08-29; **2,182,684 desc / 1,423 likes**; 15 GGUF sumando 215.36 GB. Sin benchmarks documentados |
| `DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF`<br><https://huggingface.co/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF> | *Merge* uncensored orientado a código | Apache-2.0; 2026-09-25; **2,164,143 desc / 1,416 likes**; 23 archivos, 362.29 GB. Sin benchmarks en la API |
| `orcarouter/GLM-5.3-Flash-Uncensored-GGUF`<br><https://huggingface.co/orcarouter/GLM-5.3-Flash-Uncensored-GGUF> | Alternativa GGUF a huihui para GLM-5.3-Flash, licencia MIT y con **guía de quants completa** | MIT; 2026-08-31 (mod 2026-10-02); 25,224 desc / 107 likes. **Q2_K 111.56 GB**; **Q3_K_M 145.66 GB**; **Q4_K_M 184.04 GB**; **Q6_K 251.16 GB**; **Q8_0 334.19 GB**; mmproj F16 1.11 GB |
| ⭐ `dealignai/Ornith-1.5-35B-A3B-UNCENSORED-GGUF`<br><https://huggingface.co/dealignai/Ornith-1.5-35B-A3B-UNCENSORED-GGUF> | Otro MoE 35B/A3B abliterado, de una familia **distinta** a Qwen (Ornith), con licencia **MIT** y la misma disciplina de imatrix | MIT; 2026-08-20; 33,840 desc / 38 likes; **35.5B totales / A3B**, 262,144 ctx, visión (mmproj F16 861 MB) + speculative decoding. **Q2_K 12.63 GB**; Q3_K_M 16.37 GB; **Q4_K_M 20.71 GB**; Q5_K_M 24.17 GB; Q6_K 27.86 GB; Q8_0 36.05 GB. Curiosamente **cabe en 24 GB a Q3_K_M/Q4_K_M con visión**, terreno donde el Qwen3.8-35B-A3B APEX (14,66 GB) es más eficiente |
| `dealignai/GLM-5.3-Flash-UNCENSORED-FP8` y `orcarouter/...-Uncensored-FP8` | FP8 del MoE GLM-5.3-Flash | MIT; 49,224 / 129 likes y **223,788 / 273 likes**. Sin benchmarks de capacidad documentados en la API |
| `Hikari07jp/Ternary-Bonsai-2-27B-Abliterated-GGUF`<br><https://huggingface.co/Hikari07jp/Ternary-Bonsai-2-27B-Abliterated-GGUF> | **Mejor relación calidad/coste dentro del propio ternario** según el shootout | Apache-2.0; 48,408 desc / 130 likes; 6.71 GB; PPL: MMLU −0.64 pp (p<0.001, pequeño pero real); calidad de respuesta StrongReject **0.94** (vs 0.776 del baseline BoldingBuilds) |
| `dealignai/Bonsai-2-27B-Ternary-CRACK-GGUF` y `...-1bit-CRACK-GGUF` | Segunda mejor calidad de respuesta en ternario | 93,448 desc / 157 likes; 6.71 GB; MMLU −1.04 pp (PQ2_0) / −2.63 pp (PTQ1_0) |

### 1.5 Shootout ternario (lo más cerca que hay de un head-to-head)

Comparativa de **11 builds ternarios** de Bonsai 2, mismo juez, 4×RTX 3090, publicada el 23-sep-2026. **Conflicto de interés declarado: el autor publicó 2 de los 11 builds.** <https://huggingface.co/spaces/BoldingBuilds/bonsai-2-uncensored-shootout>

- Calidad de respuesta (StrongReject 0–1, thinking off): **Hikari y dealignai ≈ 0.94**, el resto por debajo; **BoldingBuilds 0.735–0.789** (el mismo peso en tres archivos distintos varía 0.054 solo por empaquetado).
- MMLU (14,042, 0-shot): stock ternario **0.780**. Pérdidas significativas: Hikari −0.64, dealignai −1.04/−2.63, Heretic −1.59/−1.68, Blackfrost −2.68. **Solo la edición BoldingBuilds no pierde** (+0.12 pp).
- HumanEval (164): **todos bajan 2–4 pp, ninguno significativo** individualmente (McNemar p 0.11–0.55).
- Refusal con thinking off: Heretic y Blackfrost **todavía rechazan 11–12 %**; el resto 0–1 %.
- Ningún build sobre-rechaza prompts seguros.

---

## 2. ¿Qué modelo es "claramente mejor" y cuánto?

Con los datos anteriores, el ranking de **capacidad demostrable** (no de afirmaciones) es:

| Nivel | Opción | Ganancia de capacidad vs baseline ternario | Coste |
|---|---|---|---|
| **T1** | Qwen3.8-27B abliterado en **IQ4_XS/Q4_K_M/Q5_K/Q6_K** — la evidencia cuantitativa más fuerte es `dealignai/Qwen3.8-27B-UNCENSORED-GGUF` (serie CRACK); alternativas mucho más descargadas: HauhauCS, huihui, Blackfrost, 0bserverx | **+1 a +4 pp en conocimiento/razonamiento** (cadena cuantificada en §2.1) y **+6 a +8,6 pp en visión**; **~0 en matemáticas y código**; media global **+0,4 pp**. Ganancia grande **no medida en benchmarks**: modo thinking estable, visión, MTP, llama.cpp estándar | 9,99 GB (IQ2_M) a 21,50 GB (Q6_K) vs 6,30 GB |
| **T2** | **`IsValorum/Qwen3.8-35B-A3B-Distill APEX-I-MiniPlus-V2.1 Abliterated`** | Salto de *techo* a una familia de 35B/A3B con destilado de razonamiento; ΔPPL +0.028 declarado (autor). **Sin benchmark de capacidad publicado → no cuantificable** | 14,66 GB (menos que un Q4_K_M del 27B) |
| **T3** | **GLM-5.3-Flash abliterado** (huihui UD-IQ1_S 88,8 GB / orcarouter Q2_K 111,6 GB / Q3_K_M 145,7 GB) | **320,76B totales / 18B activos, 1M ctx, multimodal, MIT.** El salto de techo más grande realista para un equipo con RAM | 89–190 GB + KV; **exige 96–192 GB de RAM unificada/sistema** |
| **T4** | **DeepSeek-V4.1-Flash UNCENSORED** (dealignai FP8 475 GB / pyrodog Q2 348,8 GB) | **552B backbone, 8B/16B activos.** Único de la lista con **MMLU medido en el mismo arnés que su base** (86.96 %→82.74 %): demuestra que la abliteración de nivel-peso puede conservar ~95 % del conocimiento | **475 GB FP8 / 348,8 GB Q2**; 4×H200 NVLink + 1,180 GB RAM host, o Mac con 128 GB + streaming desde SSD |
| **T5** | DeepSeek-V4-Flash (284B) y GLM-5.3 completo (754B) | Sin benchmarks; el GLM-5.3 completo llega a **3.51 TB de safetensors** | 82,7–157 GB (V4-Flash) / 3,5 TB (GLM-5.3) |

### 2.1 Cadena cuantitativa: cuánto se gana de verdad al pasar de ternario a 4 bits

Combinando tres fuentes con arneses distintos pero complementarios se puede acotar el efecto neto:

1. **Coste del ternario frente a 4 bits** (PrismML, mismo arnés, modo thinking): MMLU-Redux 89,09 → 93,35 = **+4,26 pp** para el 4 bits; MuSR 70,63 → 73,01 = **+2,38 pp**.
2. **Coste de la abliteración a 4 bits** (dealignai, por cuant, 500 preguntas MMLU balanceadas con plantilla de chat, logit A–D): **−2,0 pp** en Q4_K_M y **−1,2 pp** en Q8_0 respecto de su base correspondiente.
3. **Coste de la abliteración en ternario** (shootout comunitario, MMLU 14.042): de **+0,12 pp** (BoldingBuilds) a **−2,68 pp** (Blackfrost).

**Estimación neta: pasar de ternario abliterado a Q4_K_M del mismo Qwen3.8-27B abliterado rinde entre +1 y +4 puntos de conocimiento/razonamiento, aproximadamente cero en matemáticas y código, y +6 a +8,6 puntos en capacidades de visión que el baseline simplemente no tiene.** No es "claramente mejor" en sentido general: es una mejora **concentrada, medible y modesta en promedio**, más un conjunto de mejoras cualitativas (coherencia en thinking, multimodalidad, MTP, runtime estándar) que en la práctica pesan más que los puntos de benchmark.

**Corolario sobre el IQ2_M de dealignai**: comparando Q8_0 (MMLU base 84,0) con IQ2_M (MMLU base 79,8) se ve que **la cuantización a 2 bits del mismo modelo cuesta ~4,2 pp de MMLU incluso antes de abliterar**. El ternario nativo evita ese coste. Eso es exactamente lo que hace que el baseline sea difícil de batir por la vía de "bajar bits a un modelo más grande".

---

## 3. Top 3 recomendaciones finales

### 🥇 1. `dealignai/Qwen3.8-27B-UNCENSORED-GGUF` (serie CRACK) en **Q4_K_M (16,22 GB)** o **IQ4_XS (14,83 GB)**

**Por qué:**
- Es el **mismo linaje que el baseline** (Qwen3.8-27B: denso, 64 capas — 48 GatedDeltaNet + 16 de atención completa —, hidden 5120, 262K ctx) pero a **4,60–4,88 bpw** en vez de 1,75.
- **Es la única abliteración de Qwen3.8-27B con evidencia cuantitativa por cuant, y con referencia base-vs-abliterado en el mismo juego de preguntas:**
  - HarmBench-240 (cumplimiento *coherente*, con filtro automático de basura/bucles): **98,8 % (237/240)** en Q4_K_M, **97,5 % (234/240)** en IQ2_M, **0 respuestas gibberish** en cualquier cuant.
  - MMLU (500 preguntas balanceadas, plantilla de chat, logit A–D): base 83,8 → CRACK **81,8** en Q4_K_M (**−2,0 pp**), y base 84,0 → 82,8 en Q8_0 (**−1,2 pp**). Es decir, **el coste de la abliteración está acotado y es pequeño**, y el propio autor publica el delta en vez de ocultarlo.
- **Añade lo que el baseline no tiene**: visión **de imagen y vídeo** (mmproj F16 888 MB) y **MTP nativo (`blk.64`) dentro de cada GGUF**, con aceptación de draft medida **~52–53 %** (normal ~68 %, dañino ~42 %), por encima del ~47 % de referencia de la arquitectura.
- **Decisiones técnicas correctas para un modelo híbrido recurrente**: mantiene las puertas de recurrencia SSM (`ssm_alpha`/`ssm_beta`) **y el bloque MTP en q8_0**, y todas las cuantizaciones por debajo de 8 bits están calibradas con **importance matrix**. Esto es exactamente el tipo de cuidado que evita la inestabilidad de contexto largo que sí aparece en cuants ingenuos.
- **Elimina la dependencia del fork de PrismML**: GGUF estándar para llama.cpp, LM Studio, Jan, KoboldCpp.
- **Credibilidad del autor verificable de forma independiente**: la misma casa (`dealignai`) obtuvo la **mejor puntuación empatada de calidad de respuesta (0,94 StrongReject)** en el shootout comunitario de builds ternarios — el único juicio de terceros con arnés fijo que existe. Su elegibilidad no depende solo de su propia tarjeta.
- Licencia **Apache-2.0**, la misma del base.

**Reservas honestas:** los números son **afirmaciones del autor**; nadie los ha reproducido. La fila "IQ3_M Δ +1.8 pp" de su tabla tiene el signo aparentemente invertido (una abliteración no debería *mejorar* el MMLU en 1,8 pp de forma sistemática), lo que indica que la tabla tiene al menos una errata. Y el "98,8 % de cumplimiento" incluye respuestas que un lector humano podría considerar parciales.

**Alternativas equivalentes en la misma clase (elegir por ecosistema, no por capacidad):**
- `HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF` — **el más adoptado con diferencia**: 2.077.955 descargas, 1.616 likes, Apache-2.0. **Q4_K_P (17,92 GB)** / Q5_K_P (20,22 GB) / IQ4_XS (15,71 GB) / Q3_K_P (13,44 GB) / Q2_K_P (10,68 GB); visión (mmproj BF16 931 MB) + MTP nativo + sidecar **FastMTP** (hasta 3,02× TG de documento y 1,93× de razonamiento vs MTP off, medido en RTX PRO 6000 Blackwell 96 GB). Los cuants "K_P" son propietarios (dan un nivel o dos de calidad extra a ~5–15 % más de tamaño) pero siguen siendo GGUF estándar. **Contra**: "0/465 refusals" con asterisco **sin nota metodológica** → tratar como no verificado, y **cero benchmarks de capacidad**.
- `huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF` — **el de familia de cuants más amplia** (Q2_K 10,36 → Q8_0 27,70, UD, IQ, GSQ-RCO, Swift, ternary) y el más descargado de GitHub/HF en general (2.057.848). **UD-Q4_K_XL (16,57 GB)** es el punto dulce. **Contra**: el autor lo llama "proof-of-concept" y solo ablaciona las capas 22–52.
- `Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF` **Q4_K_M (16,03 GB)** — la documentación de refusal más granular de la familia (11/450 = 2,4 %, desglose por AdvBench/StrongREJECT/XSTest) y MTP embebido en todos los cuants. **Contra**: el shootout le mide **−2,68 pp de MMLU, la mayor pérdida de la familia**, y su tarjeta **se contradice** (tabla de estado "0/450" vs texto "evaluación pendiente").
- `0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF` **Q4_K_M (15,78 GB)** — **la única tarjeta con guía cuantitativa de GPU/RAM por tamaño de archivo**, calibración imatrix multilingüe y un checkpoint GSQ-3bit auditable (26,44 GB, coseno 0,9842, 8 niveles discretos). **Contra**: el shootout le mide **11–12 % de rechazos residuales** con thinking off, y declara abiertamente que dejó intactas algunas categorías de seguridad duras.

### 🥈 2. `IsValorum/Qwen3.8-35B-A3B-Distill-MTP-APEX-I-MiniPlus-V2.1-Abliterated-GGUF` (14,66 GB, 3,40 bpw)

**Por qué:**
- **Sube el techo sin subir la memoria**: 34,66B totales / 3B activos en **14,66 GB**, es decir **menos disco que un Q4_K_M del 27B** y solo 2,3× el baseline ternario.
- **Conserva el 100 % del contexto nativo (262.144) dentro de 24 GB**, incluso los 256K completos: 19,46 GiB estimados; 16,12 GiB a 32K; 16,61 GiB a 64K. En 16 GB corre a 65K según verificación de terceros en RTX 5090 (14,6 GB @32K, 15,1 GB @65K, 247–251 tok/s).
- **Visión + MTP**: no es una pérdida respecto del baseline, es una ganancia neta (el baseline no trae mmproj).
- **Diseñado explícitamente para streaming desde RAM de sistema** con expertos `Q3_K` lineales y matrices de routing en **F32 sin comprimir** (cero deriva de router) — relevante si el usuario no tiene 24 GB.
- ΔPPL declarado **+0.028 sobre ~5.10** (autor) y **D_KL = 0.0076**.
- Apache-2.0, y su hermano *aligned* comparte exactamente la misma huella (14,75 GB), lo que permite comparar alineado vs abliterado en igualdad de condiciones.

**Reservas honestas:**
- La evidencia de refusal es **0/10 en 10 prompts**: estadísticamente insuficiente.
- **No hay MMLU/GPQA/HumanEval publicados**, ni del autor ni de terceros, sobre *este* modelo. La comparación de rendimiento "Occamy V2 93,3 %/90,0 % resueltas" que cita es **sobre el esquema de cuantización en otro modelo, no sobre este** — el propio README lo aclara.
- Tarjeta muy promocional (lenguaje de marketing, tablas de "quality tier" no auditables). Trátala con descuento.

### 🥉 3. `huihui-ai/Huihui-GLM-5.3-Flash-abliterated-GGUF` en **UD-IQ1_S (~88,8 GB)** o `orcarouter/GLM-5.3-Flash-Uncensored-GGUF` en **Q2_K (~111,6 GB)**

**Por qué:**
- Es el **salto de capacidad real**: **320,76B totales / 18B activos**, 1M de contexto, multimodal, **licencia MIT** (la más permisiva de todas las opciones grandes).
- Un MoE de 320B con 18B activos tiene un techo de razonamiento y conocimiento inalcanzable para cualquier denso de 27B en 4–8 bits; es la única vía de "claramente mejor" que no sea un matiz de pocos puntos.
- El repo de huihui conserva visión (mmproj bf16 1,11 GB) y trae tres niveles: IQ1_S 88,8 GB → IQ4_XS 149,5 GB → Q4_K_XL 190,5 GB, lo que permite **elegir el punto de la curva**.
- `orcarouter` es el espejo con licencia MIT explícita y guía de quants estándar completa (Q2_K → Q8_0).

**Reservas honestas y serias:**
- **Ninguno de los dos publica un solo benchmark de capacidad ni de refusal.** Cero evidencia cuantitativa. Es una apuesta a ciegas sobre la arquitectura, no sobre datos.
- **UIQ1_S/IQ2_K reintroducen exactamente el problema que el ternario Bonsai 2 resolvió.** Los datos oficiales de PrismML son tajantes: una cuantización convencional a ~2 bpw (IQ2_XXS) pierde **13,7 puntos de media** y colapsa selectivamente en razonamiento encadenado (AIME26 57,5; LiveCodeBench 56,4) mientras MMLU-Redux sigue en 88,93 — *"por eso las pruebas casuales no detectan el colapso"*. Pagar 89–112 GB por un modelo a 1–2 bits puede rendir **por debajo** del baseline ternario de 6,3 GB.
- **Hardware**: no cabe en ninguna GPU de consumo. Requiere **≥96–128 GB de RAM unificada** (Mac Studio/M5 Max) o un servidor; con offload parcial la velocidad depende del ancho de banda de memoria.
- El repo de huihui tiene 14.193 descargas: mucha menos validación comunitaria que los candidatos de T1.
- Para DeepSeek-V4.1-Flash (la única de la lista grande con **MMLU medido**), el coste asciende a **475 GB** y **4×H200 NVLink con 1.180 GB de RAM host** (76 GB/GPU con la tabla Engram en host, que consume **203 GB de RAM host**; KV = 890 bytes/token; ~28 min de arranque en frío). Solo tiene sentido si ya se dispone de ese hardware.

---

## 4. Nota explícita sobre el "coste" de pasar de ternario a cuantizaciones mayores o a MoE grandes

**A. Coste en disco/RAM (multiplicador sobre el baseline de 6,30 GB):**

| Objetivo | Tamaño | ×baseline | Cabe en 8 GB | 12 GB | 16 GB | 24 GB | 32 GB+ |
|---|---:|---:|---|---|---|---|---|
| Baseline ternario PTQ1_0 | 6,30 GB | 1,0× | Sí | Sí | Sí | Sí | Sí |
| Ternario PQ2_0 / IQ1_S 27B | 6,8–7,4 GB | 1,1–1,2× | Ajustado | Sí | Sí | Sí | Sí |
| 27B **IQ2_M** (dealignai CRACK) | 9,99 GB | 1,6× | No | Ajustado | Sí | Sí | Sí |
| 27B IQ2_M / Q2_K (otros) | 9,5–10,4 GB | 1,5–1,6× | No | Sí | Sí | Sí | Sí |
| 27B **Q3_K_M** | 12,7–12,9 GB | 2,0× | No | Ajustado | Sí | Sí | Sí |
| **35B-A3B MoE APEX 3,40 bpw** | **14,66 GB** | 2,3× | No | No | Sí (≤65K) | Sí (256K completo) | Sí |
| 27B **Q4_K_M / Q4_K_P** | 15,8–17,9 GB | 2,5–2,8× | No | No | **Ajustado / no** | Sí | Sí |
| 27B **Q5_K_M** | 18,3–20,2 GB | 2,9–3,2× | No | No | No | Sí (contexto corto) | Sí |
| 27B **Q6_K** | 21,1–25,9 GB | 3,3–4,1× | No | No | No | **Muy ajustado** | Sí |
| 27B **Q8_0** | 27,3–31,5 GB | 4,3–5,0× | No | No | No | No | Sí |
| 27B **BF16** | 51,3–52,1 GB | 8,1–8,3× | No | No | No | No | 64 GB+ |
| **GLM-5.3-Flash IQ1_S** | 88,8 GB | 14,1× | — | — | — | — | **96–128 GB RAM** |
| **GLM-5.3-Flash Q2_K** | 111,6 GB | 17,7× | — | — | — | — | **128 GB+ RAM** |
| **GLM-5.3-Flash Q4_K_M** | 184,0 GB | 29,2× | — | — | — | — | **192–256 GB** |
| **DeepSeek-V4-Flash Q2_K** | 93,1 GB | 14,8× | — | — | — | — | **128 GB+ RAM** |
| **DeepSeek-V4.1-Flash Q2 (DwarfStar)** | 348,8 GB | 55,4× | — | — | — | — | **SSD + 128 GB unificada** |
| **DeepSeek-V4.1-Flash FP8** | 475,3 GB | 75,4× | — | — | — | — | **4×H200 NVLink + 1.180 GB RAM** |

**B. Coste en calidad: la trampa simétrica.** El baseline no es un Q2 convencional. Los datos de PrismML muestran que el ternario nativo **bate a IQ2_XXS por 12,2 puntos** y queda a **0,4 puntos de UD-Q4_K_XL**. Por tanto:
- Subir a **Q4/Q5** compra poco en promedio (+0,4 pp) y **nada en matemáticas/código**; se compra conocimiento (+2 a +4,5 pp) y visión (+6 a +8,6 pp).
- Subir a **MoE gigante a 1–2 bits por peso** puede **empeorar** el resultado en razonamiento encadenado respecto del baseline de 6,3 GB. El "modelo más grande" solo gana si se le da suficiente precisión por peso, y eso multiplica el tamaño otra vez.

**C. Coste en velocidad.** El ternario es óptimo en ancho de banda: en la tarjeta del fabricante decodifica **129,9 tok/s en RTX 5090** y 81,2 en 4090 con solo 5,95 GB residentes. Un Q4_K_M del mismo 27B mueve ~2,7× más bytes por token y es inevitablemente más lento en la fase de decodificación (limitada por memoria), aunque el MTP lo compensa parcialmente. Los MoE grandes con offload desde RAM añaden una penalización mucho mayor y dependiente del ancho de banda (20–45 tok/s declarados por IsValorum para streaming en RAM; 6,9–14,2 minutos por tarea de código en el setup de pyrodog).

**D. Costes operativos que no aparecen en las tablas.**
- **Espacio de descarga**: algunos repos son enormes en total (`0bserverx` 3,99 TB, `audnai/penclaw` 3,51 TB, `huihui Qwen3.8` 783 GB) porque acumulan decenas de quants y variantes. El archivo que se descarga es pequeño, pero conviene ir al fichero concreto.
- **Runtime**: el baseline **exige el fork de PrismML de llama.cpp**; las alternativas 4–8 bits usan llama.cpp upstream. Eso abarata el mantenimiento.
- **Riesgo de modelo**: la calidad de la abliteración no correlaciona con ningún campo de la tarjeta. En el shootout, el mismo peso empaquetado por tres autores distintos varió 0,054 en calidad de respuesta, y las pérdidas de MMLU fueron de −0,64 a −2,68 pp según quién hizo la edición. **Hay que evaluar el artefacto, no el nombre.**
- **Aviso metodológico del baseline, aplicable a todos**: *"Un modelo proyectado y reempaquetado pasa la comprobación de tamaño y la de reproducibilidad del cuantizador sin contener ninguna abliteración. Si construyes uno de estos, compara los tensores contra la release base. El tamaño no es evidencia."* Lo mismo vale para los MoE cuantizados a 1 bit: un archivo que carga no es un archivo que funciona.

---

## 5. Evidencia independiente: resumen

### 5.1 Un estudio académico con cifras duras (la mejor evidencia independiente disponible)

**Sokhansanj, B.A., "Uncensored AI in the Wild: Tracking Publicly Available and Locally Deployable LLMs", *Future Internet* 2025, 17(10), 477** — <https://doi.org/10.3390/fi17100477> (revisado por pares; existe una corrección en *Future Internet* 2026, 18(1), 49 — <https://doi.org/10.3390/fi18010049>).

Resumen recuperado vía Crossref el 2026-10-04 (el HTML de MDPI devuelve 403 a este agente):

- Análisis empírico a gran escala sobre **8.608 repositorios de modelos** y evaluación de **20 modelos modificados representativos** con prompts inseguros (desinformación electoral, instrucciones delictivas, evasión regulatoria).
- **Cifra central: los modelos sin modificar cumplieron solo el 19,2 % de las peticiones inseguras de media; las variantes modificadas cumplieron el 80,0 %.** Es decir, la abliteración funciona: multiplica por ~4 la tasa de cumplimiento.
- **La efectividad de la modificación es independiente del tamaño del modelo**: variantes de **14B a veces igualan o superan** los niveles de cumplimiento de versiones de **70B**.
- **Ecosistema muy concentrado pero estructuralmente descentralizado**: el **top 5 % de proveedores acumula >60 % de las descargas** y el top 20 roza el **86 %**.
- **Más de la mitad de los modelos identificados usan empaquetado GGUF** (optimizado para hardware de consumo) y **los métodos de cuantización a 4 bits proliferan ampliamente**, aunque los modelos a **precisión completa / 16 bits siguen siendo los más descargados**.

**Relevancia para este informe:** el paper valida dos cosas que sostienen el núcleo del análisis — (a) que la abliteración como técnica es efectiva y su efecto es de magnitud grande, y (b) que **el tamaño del modelo no determina la efectividad de la modificación**, lo que desaconseja asumir que "más grande = más capaz en la práctica" una vez aplicada la abliteración.

### 5.2 Otros trabajos académicos relevantes de 2026 (solo metadatos verificados)

| Trabajo | DOI | Estado de la evidencia |
|---|---|---|
| *Auditing Abliteration: Normalization Placement, Edit Budget, and Transfer in Single-Direction Refusal Removal*, IEEE ORSS 2026 | <https://doi.org/10.1109/ORSS71174.2026.11684276> | Título y venue verificados vía Crossref/OpenAlex (2026, 0 citas). **Resumen no accesible** sin suscripción → *no documentado*. Es directamente relevante al hallazgo de Bahushruth (§1.3) sobre colocación de la normalización y presupuesto de edición. |
| *TamperBench: Systematically Stress-Testing LLM Safety Under Fine-Tuning and Tampering*, ACM SIGKDD 2026 | <https://doi.org/10.1145/3770855.3817557> | Título y venue verificados. **Resumen no documentado en Crossref.** |
| *Detecting Safety Training Modification in Language Models via Activation Analysis* (AMS), IEEE Access 2026 | <https://doi.org/10.1109/access.2026.3704057> | Título verificado. La descripción del buscador indica que mide la estructura geométrica de conceptos de seguridad en el espacio de activaciones y valida que ciertas modificaciones **colapsan o rotan** esa estructura mientras otras la dejan intacta — potencialmente útil como herramienta de auditoría, pero **el texto completo no fue accesible** → tratar como *no documentado* más allá del título. |

### 5.3 Lo que **no** existe

- **No hay ningún leaderboard independiente de modelos uncensored para 2026.** La búsqueda en Hugging Face Spaces (`/api/spaces?search=uncensored|abliterated|refusal`) solo devuelve demos de inferencia, generadores de imagen NSFW y espacios con 0–31 likes. El único "Refusals-Leaderboard" (`Mandoline/Refusals-Leaderboard`) es un Streamlit de **2024** con última modificación en **febrero de 2025**: anteriores a todos los modelos de este informe.
- **No hay evaluación independiente de calidad de ninguno de los 14 modelos del encargo.** Cero fuentes de terceros publican MMLU/GPQA/HumanEval para huihui, 0bserverx, Blackfrost, AEON-7, IsValorum, HauhauCS, orcarouter, Bahushruth ni para las abliteraciones de DeepSeek-V4/GLM-5.3.
- **La única comparación multi-modelo real y con arnés idéntico es el shootout de BoldingBuilds**, y solo cubre builds **ternarios** de Bonsai 2; su propio autor declara el conflicto de interés.

**Consecuencia práctica:** cualquier afirmación de que una abliteración concreta sea "claramente mejor" en capacidad que otra **no está respaldada por evaluación independiente en 2026**. La única forma defendible de comparar es (a) usar métricas de cuantización del fabricante del modelo base, como se hace en §0, y (b) evaluar uno mismo los artefactos candidatos con un banco y un juez fijos.

---

## 6. Limitaciones de este informe

1. **No existe ningún benchmark público que enfrente directamente el ternario abliterado con un Qwen3.8-27B abliterado en 4–8 bits bajo el mismo arnés.** La comparación de §0 usa la evaluación oficial de PrismML, que es del fabricante del baseline (conflicto de interés potencial); la cadena de §2.1 combina tres arneses distintos y por eso se presenta como **estimación acotada**, no como medición.
2. **De los cinco grandes repos de Qwen3.8-27B abliterado (huihui, 0bserverx, Blackfrost, AEON-7, HauhauCS), ninguno publica MMLU, GPQA, HumanEval o AIME.** Solo `dealignai` publica MMLU por cuant (y sin verificación de terceros). Por tanto no hay cifras de capacidad comparables entre autores; solo de refusal, y medidas con criterios distintos.
3. **Las cifras de refusal no son comparables entre repos.** Cada uno usa su propio conjunto — SimpleSafetyTests 100, R1-HARMFUL-BENCH-450, un set propio de 465, HarmBench-240, HarmBench-320, UncensorBench 200, 16 prompts, 10 prompts — con jueces distintos (Qwen3.8-27B-OBLITERATED Q8_0, `gemini-3.1-flash-lite`, heurísticas locales, filtro de gibberish propio) y contando "suavizado", "sin respuesta" o "cumplimiento coherente" de forma distinta. El shootout comunitario es el único que usa un juez y un banco idénticos para varios modelos, y solo cubre builds **ternarios**.
4. Varias tarjetas se contradicen internamente (Blackfrost declara "0/450" en la tabla de estado y "pendiente" en el texto), contienen erratas de signo (la fila IQ3_M de dealignai) o tablas de marketing no auditables (IsValorum, HauhauCS).
5. `audnai/penclaw-GLM-5.3-abliterated` no permitió descargar su README (`/raw/` → 401) y su licencia es `other` (no Apache/MIT), por lo que solo se pudo caracterizar por metadatos y listado de archivos.
6. **El término "claramente mejor" del encargo no se sostiene tal cual para esta familia.** La evidencia disponible respalda "mejor en conocimiento/razonamiento y visión, igual en matemáticas y código, mucho mejor en coherencia de modo thinking y herramientas". Un salto de capacidad *claro* exige cambiar de familia de modelo (MoE de 320B+), no de precisión.

---

## Anexo: URLs completas citadas

**Modelos**
- <https://huggingface.co/BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-GGUF>
- <https://huggingface.co/BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PQ2_0-MTP-GGUF>
- <https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf>
- <https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF>
- <https://huggingface.co/0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF>
- <https://huggingface.co/Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF>
- <https://huggingface.co/Blackfrost-AI/Qwen3.8-27B-ABLITERATED-BF16>
- <https://huggingface.co/AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16>
- <https://huggingface.co/soyaakinohara/qwen3.8-27b-abliterated-3.69bpw-12GB-MTP.gguf>
- <https://huggingface.co/IsValorum/Qwen3.8-35B-A3B-Distill-MTP-APEX-I-MiniPlus-V2.1-Abliterated-GGUF>
- <https://huggingface.co/huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF>
- <https://huggingface.co/apetersson/DeepSeek-V4-Flash-0731-Abliterated-FP8>
- <https://huggingface.co/dealignai/DeepSeek-V4.1-Flash-UNCENSORED-FP8>
- <https://huggingface.co/pyrodog/DeepSeek-V4.1-Flash-UNCENSORED-DwarfStar-Q2>
- <https://huggingface.co/audnai/penclaw-GLM-5.3-abliterated>
- <https://huggingface.co/huihui-ai/Huihui-GLM-5.3-Flash-abliterated-GGUF>
- <https://huggingface.co/Bahushruth/Qwen3.6-35B-A3B-abliterated-v4>
- <https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF>
- <https://huggingface.co/dealignai/Qwen3.8-27B-UNCENSORED-GGUF>
- <https://huggingface.co/dealignai/Ornith-1.5-35B-A3B-UNCENSORED-GGUF>
- <https://huggingface.co/AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-NVFP4-MIXED>
- <https://huggingface.co/orcarouter/GLM-5.3-Flash-Uncensored-GGUF>
- <https://huggingface.co/Hikari07jp/Ternary-Bonsai-2-27B-Abliterated-GGUF>
- <https://huggingface.co/dealignai/Bonsai-2-27B-Ternary-CRACK-GGUF>
- <https://huggingface.co/Qwen/Qwen3.8-27B>
- <https://huggingface.co/zai-org/GLM-5.3-Flash>

**Evaluaciones y papers**
- <https://huggingface.co/spaces/BoldingBuilds/bonsai-2-uncensored-shootout>
- <https://doi.org/10.3390/fi17100477> — Sokhansanj, *Uncensored AI in the Wild*, Future Internet 2025, 17(10), 477
- <https://doi.org/10.3390/fi18010049> — corrección, Future Internet 2026, 18(1), 49
- <https://doi.org/10.1109/ORSS71174.2026.11684276> — *Auditing Abliteration*
- <https://doi.org/10.1145/3770855.3817557> — *TamperBench*
- <https://doi.org/10.1109/access.2026.3704057> — *Detecting Safety Training Modification via Activation Analysis*
- <https://note.com/zephel01/n/n71d3d7e6b70c?hl=en> — benchmark de terceros de la cuantización APEX-I-MiniPlus
