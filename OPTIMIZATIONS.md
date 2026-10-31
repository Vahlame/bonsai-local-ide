# Optimizaciones — registro A/B

Regla: **medición → hipótesis → cambio → benchmark → validación**. Un cambio
sin A/B no entra. Si la ganancia cae dentro del ruido, se dice.

Todos los porcentajes comparan el mismo modelo, prompt, KV, batch, ubatch,
hilos y binario, salvo la variable indicada.

---

## OPT-01 — Arreglar el build “optimizado” que no activaba nada

**PROBLEM:** `build-rtx4060-optimized.ps1` decía activar `FA_ALL_QUANTS`,
`GRAPHS` y `MMQ`, pero pasaba los `-D` a `CMAKE_CUDA_FLAGS`. El cache real
mostraba `FA_ALL_QUANTS=OFF`, `GRAPHS=ON` (default) y `MMQ` no existe.

**BASELINE:** `build-RTX4060-Opt-sm89` con `GGML_CUDA_FORCE_MMQ=OFF`,
`GGML_CUDA_FA_ALL_QUANTS=OFF`, `GGML_LTO=OFF`.

**BOTTLENECK:** flags falsos; no hay evidencia de que las supuestas
optimizaciones estuvieran activas.

**SOURCE:** `scripts/build-rtx4060-optimized.ps1`, `ggml/CMakeLists.txt:202`.

**CHANGE:** nuevo `scripts/build-llama-lab.ps1` con opciones CMake reales,
recibo de hashes y build reproducible. No se fuerza MMQ ni FA_ALL_QUANTS: se
miden.

**CORRECTNESS TEST:** `llama-bench --version`; hash del binario; `test-backend-ops`
en el build de laboratorio.

**PERFORMANCE:** sin cambio de rendimiento atribuible a los flags (eran
placebo). El valor está en que ahora el A/B es reproducible y el cache dice la
verdad.

**VRAM:** sin cambio. **QUALITY:** sin cambio.

---

## OPT-02 — GPT-OSS 64k: 16 → 12 capas CPU y 12 → 8 hilos

**PROBLEM:** el plan anterior usaba `--n-cpu-moe 16 --threads 12` a 64k. El
estimador analítico descontaba KV de más y dejaba ~2.5 GiB de VRAM sin usar.

**BASELINE:** 30.03 tok/s decode, 761.6 prefill, 2,021 ms TTFT, 5,691 MiB VRAM,
12 hilos, 16 CPU layers.

**BOTTLENECK:** MoE CPU-bound: 315% CPU, 22% GPU, 27 W. Cada capa de expertos
en GPU elimina trabajo de CPU; 8 hilos físicos evitan contención SMT.

**SOURCE:** `--n-cpu-moe` en `common/arg.cpp:2779`; reparto en
`tools/server/server-context.cpp`; grafo `build_moe_ffn` en
`src/llama-graph.cpp:2204`.

**CHANGE:** `config/measured-moe-profiles.json` + override en
`scripts/start-gpu-model-rtx4060-optimized.ps1`. A 64k: n-cpu-moe 12, threads 8.

**CORRECTNESS TEST:** mismo GGUF, mismo prompt, misma salida greedy; no cambia
el sampler ni los pesos. `llama-server /health` y 3 repeticiones.

**PERFORMANCE BEFORE/AFTER (2048 prompt, 256 gen):**

| Métrica | Antes | Después | Δ |
|---|---:|---:|---:|
| Decode | 30.03 tok/s | **36.8 tok/s** | **+22.7%** |
| Prefill | 761.6 tok/s | **908 tok/s** | **+19.2%** |
| TTFT | 2,021 ms | **1,707 ms** | **−15.5%** |
| VRAM pico | 5,691 MiB | 7,309 MiB | +1,618 MiB |
| RAM pico | 7,898 MiB | 6,306 MiB | −1,592 MiB |

**VRAM:** quedan 879 MiB libres (objetivo del proyecto: 850). `n-cpu-moe 11`
hace OOM. **QUALITY:** sin cambio; los expertos son los mismos, solo cambia
dónde se computan. El coding 100% (18/18 + 10/10) se mantiene.

---

## OPT-03 — Tabla de reparto seguro por contexto (GPT-OSS)

**PROBLEM:** un único `n-cpu-moe` para todos los contextos no es óptimo.

**BASELINE:** 16 CPU layers a 64k; a 32k/128k no había tabla medida.

**CHANGE:** tabla `config/measured-moe-profiles.json` con el máximo `n-cpu-moe`
que arranca y responde sin OOM:

| Contexto | n-cpu-moe | GPU layers | Decode | VRAM |
|---:|---:|---:|---:|---:|
| 32k | 11 | 13/24 | 38.65 | 7,275 MiB |
| 64k | 12 | 12/24 | 36.80 | 7,309 MiB |
| 96k | 13 | 11/24 | 34.09 | 7,373 MiB |
| 128k | 14 | 10/24 | 33.65 | 7,473 MiB |

**VALIDATION:** cada fila se cargó con llama-server y procesó 2,048 tokens +
128/256 generados. La fila siguiente (una capa menos de CPU) hace OOM. El
launcher ajusta la tabla si otra app roba VRAM (`DeltaFree`).

**QUALITY:** sin cambio.

---

## OPT-04 — Qwen3.6 35B-A3B: 22 → 19 capas CPU a 32k

**PROBLEM:** el plan usaba 22 capas CPU; sobraba VRAM.

**BASELINE:** 42.52 tok/s decode, 789 tok/s prefill, 6,647 MiB VRAM, t8.

**CHANGE:** n-cpu-moe 19 (21/40 capas GPU), threads 8.

**AFTER:** **44.79 tok/s** decode (+5.3%), 856 tok/s prefill (+8.5%), 7,409 MiB.
n-cpu-moe 18 hace OOM.

**QUALITY:** sin cambio; el coding 96% se mantiene.

---

## OPT-05 — Qwen3-30B-A3B: n-cpu-moe 29 → 26 a 32k

**PROBLEM:** el informe anterior usaba 19/48 capas GPU (n=29) y 44.3 tok/s.

**BASELINE:** 44.3 tok/s (n=29, 12 hilos).

**CHANGE:** n-cpu-moe 26 (22/48 GPU), 8 hilos.

**AFTER:** **46.61 tok/s** (+5.2%), prefill medido 848 tok/s, 7,535 MiB. n=25
OOM. Con n=26 y 12 hilos se midió 45.4/46.4 (mediana 45.9), así que la mayor
parte de la ganancia viene del reparto, no de los hilos. El prefill de 848 no
se compara con el 1,011 del informe anterior porque aquel usó un prompt más
largo; no es un A/B limpio.

**QUALITY:** sin cambio; coding 86% se mantiene.

---

## OPT-06 — MMVQ de 2 warps para Q4_K/Q5_K/Q6_K en sm_89

**PROBLEM:** `mul_mat_vec_q` es el 88% del decode denso. En sm_89 usa la tabla
genérica (4 warps para batch 1); la tabla “tuned on RTX 4090” no cubre el caso
de 24 SMs.

**BASELINE:** 4B Q4: 82.0 tok/s; Q6: 65.8; Q8: 53.0; 7B Q4: 52.2; 9B Q3: 50.5.

**BOTTLENECK:** GEMV memory-bound; con 24 SMs, 64 hilos/bloque pueden dar más
bloques residentes que 128, pero solo para K-quants con dequant complejo.

**SOURCE:** `ggml/src/ggml-cuda/mmvq.cu`, `calc_nwarps()` línea 452,
`mul_mat_vec_q` línea 622.

**CHANGE:** `forks/patches/0001-mmvq-4060-nwarps.patch`; 2 warps solo para
Q4_K/Q5_K/Q6_K y `ncols_dst=1`. Build `lab-mvq2`.

**CORRECTNESS TEST:** `test-backend-ops test -o MUL_MAT -b CUDA0 -j 4`:
**2,490/2,490 passed**. La primera versión (todos los tipos) falló un Q5_1 y se
corrigió; el alcance actual no toca Q5_1.

**PERFORMANCE:**

| Caso | 4 warps | 2 warps | Δ |
|---|---:|---:|---:|
| 4B Q4, 512+128 | 82.0 | **85.8** | **+4.6%** |
| 4B Q4, depth 4096 | 67.8 | **70.15** | **+3.5%** |
| 4B Q6 | 65.8 | 66.9 | +1.6% |
| 4B Q8 | 52.97 | 53.06 | +0.2% |
| 7B Q4 | 52.22 | 51.99 | −0.4% |
| 9B Q3 | 50.49 | 50.57 | +0.2% |
| 4B server, 2,048+256 | 73.8 | **77.0** | **+4.3%** |

**VRAM:** sin cambio (mismo modelo/KV). **QUALITY:** sin cambio; la salida
greedy coincide y los 2,490 tests pasan. El 7B pierde 0.4%, que se declara; aun
así el build es globalmente mejor para el perfil 4B, y el 7B está en el techo de
memoria. Si se prefiere cero regresión, usa `lab-control` para el 7B.

---

## OPT-07 — Q6_K como perfil de máxima calidad

**PROBLEM:** Q8_0 es el 35% más lento que Q6 para una mejora de PPL que Q6 ya
captura.

**BASELINE:** Q8_0 52.95 tok/s, PPL 11.9276, 5,665 MiB.
**CHANGE:** Q6_K 65.54 tok/s, PPL 11.9654 (+0.32%), 4,735 MiB.

**DECISIÓN:** `max_quality` usa Q6_K. Q8_0 solo si se necesita el formato de
referencia para comparar.

---

## OPT-08 — Prompt cache

**PROBLEM:** un agente de coding reenvía el mismo system prompt en cada turno.

**BASELINE:** Qwen3-4B, prefijo 3,062 tokens: TTFT 1,002.6 ms; GPT-OSS 3,033
tokens: 3,814.3 ms.

**CHANGE:** `cache_prompt=true` (ya soportado por llama-server; el perfil lo
activa con `--cache-ram 2048`).

**AFTER:** 23.3 ms (43.0×) y 72.2 ms (52.8×). **VRAM:** el KV del prefijo se
reutiliza; no hay copia extra. **QUALITY:** idéntica.

---

## OPT-09 — Backend sampling (negativo)

**HIPÓTESIS:** evitar la copia de logits y el sampler de CPU.

**RESULTADO:** 4B decode 74.2 → 75.3 (+1.5%), prefill 3,985 → 3,867 (−3.0%);
GPT-OSS decode 35.2 → 35.8 (+1.7%), prefill 918 → 897 (−2.3%). El TTFT empeora
ligeramente. **NO SE ACTIVA** por defecto; queda como experimental.

---

## OPT-10 — KV q8_0 / q4_0

**BASELINE:** f16 PPL 9.0320; q8_0 9.0004 (−0.35%, ruido); q4_0 9.2128
(+2.00%). **DECISIÓN:** q8_0 por defecto; q4_0 solo `max_context` con aviso de
calidad. El ahorro de VRAM de q8 permite más expertos en GPU (OPT-02), que es
una ganancia de velocidad real.

---

## OPT-11 — Cuantización mixta Q4 + emb/out Q8 (negativo)

**PROBLEM:** recuperar calidad en capas sensibles sin pagar Q6 completo.

**CHANGE:** `Q4_K_M` con `token_embd` y `output.weight` en Q8_0, generado desde
Q8_0 con `llama-quantize --output-tensor-type q8_0 --token-embedding-type q8_0`.

**RESULT:** PPL 12.3478 vs 12.2553 de Q4 (+0.75%, peor), decode 82.1 vs 81.9
(ruido) y prefill 4,013 vs 3,951 (ruido). Pesa lo mismo que Q4. **NO SE ADOPTA.**
Q6_K sigue siendo la opción de calidad (+0.32% PPL, 65.5 tok/s). La prueba no es
concluyente para “mixed quant” en general porque el cuerpo se requantizó desde
Q8; una prueba correcta necesita F16 + imatrix.

---

## Resumen de ganancias

| Cambio | Decode | Prefill | TTFT | VRAM | Calidad |
|---|---:|---:|---:|---:|---|
| GPT-OSS 16→12 + 8 hilos | **+22.7%** | +19.2% | −15.5% | +1.6 GiB | = |
| GPT-OSS tabla 32k/96k/128k | +8 a +29% vs 16 | +8 a +25% | −8 a −20% | +1.6 GiB | = |
| Qwen3.6 22→19 | +5.3% | +8.5% | −8% | +0.8 GiB | = |
| Qwen3-30B 29→26 | +5.2% | n/c | n/c | +1.0 GiB | = |
| MMVQ 2 warps (4B) | **+4.6%** | +0.6% | = | = | = |
| Q6_K vs Q8 | +23.8% | −13% | = | −0.9 GiB | +0.32% PPL |
| Prompt cache | = | = | **43–53×** | = | = |

Las ganancias grandes vienen de **colocación de expertos, hilos y cuantización**;
la ganancia de kernel es real pero limitada al 4B. Ese es el resultado honesto
de perfilar antes de escribir kernels.
