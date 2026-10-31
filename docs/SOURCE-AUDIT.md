# Auditoría del código fuente — llama.cpp en la RTX 4060

**Upstream:** <https://github.com/ggml-org/llama.cpp>  
**Commit auditado:** `8642541b255bfb5dc39cd351a178be09013a55d6` (v0.8.0)  
**Licencia:** MIT  
**Build base:** `build-RTX4060-Opt-sm89` (`sm_89`, CUDA 12.9.1, MSVC 19.44)  
**Perfilado:** Nsight Systems 2026.3.2 + `nvidia-smi` + contadores del propio servidor.

Esta auditoría no trata llama.cpp como una caja negra. Sigue una petición desde
el HTTP hasta el kernel, y relaciona cada hotspot con un archivo, una función y
un kernel concretos. Los números de línea corresponden al commit auditado.

---

## 1. Recorrido de una petición

| Etapa | Archivo | Función | Qué hace |
|---|---|---|---|
| HTTP / OpenAI | `tools/server/server-context.cpp` | `post_completions`, `tokenize_input_prompts` | Parsea el JSON, tokeniza el prompt y crea la tarea. |
| Tokenizer | `src/llama-vocab.cpp` | `llama_tokenize` | BPE/SentencePiece; se ejecuta en CPU. |
| Slot / prompt cache | `tools/server/server-context.cpp` | `prompt_load`, `prompt_save`, `n_prompt_cached` | Reutiliza el KV de un prefijo idéntico. |
| Decode | `src/llama-context.cpp` | `llama_decode` (4647), `llama_context::decode` | Prepara el batch y construye el grafo. |
| Grafo | `src/llama-graph.cpp` | `llm_graph_context::build_*` | Añade embeddings, atención, MoE, normas y lm_head. |
| Modelo | `src/models/qwen3.cpp`, `qwen3moe.cpp`, `openai-moe.cpp` | `build_arch_graph`, `graph::graph` | Define el grafo concreto de cada arquitectura. |
| Scheduler | `ggml/src/ggml-backend.cpp` | `ggml_backend_sched_graph_compute_async` | Divide el grafo entre CPU y CUDA. |
| Dispatch CUDA | `ggml/src/ggml-cuda/ggml-cuda.cu` | `ggml_cuda_compute_forward` | Elige MMVQ, MMQ, cuBLAS o FlashAttention. |
| Kernel | `mmvq.cu`, `mmq.cu`, `fattn*.cuh`, `norm.cu`, `rope.cu` | ver §3 | Ejecuta el trabajo real. |
| Sampling | `src/llama-sampler.cpp`, `common/sampling.cpp` | `llama_sampler_sample` (896), `common_sampler_sample` (606) | Convierte logits en el siguiente token. |
| Streaming | `tools/server/server-context.cpp` | `send_partial_response` (2348) | Envía el token al cliente. |

El servidor puede usar **backend sampling** (`--backend-sampling`, experimental).
En `llama_sampler_sample` se comprueba primero `llama_get_sampled_token_ith`:
si un sampler de backend ya eligió el token, se evita la copia completa de
logits y el sampler de CPU. En esta máquina la ganancia medida fue pequeña y
con una regresión de prefill (§7).

---

## 2. Auditoría de flags de compilación

El script anterior `scripts/build-rtx4060-optimized.ps1` hacía esto:

```powershell
$BaseCudaFlags = '-DCMAKE_CUDA_FLAGS=-lineinfo -Xptxas=-v -Xcompiler=-O3 -use_fast_math'
$CudaFlags = "$BaseCudaFlags -DGGML_CUDA_FA_ALL_QUANTS=ON -DGGML_CUDA_GRAPHS=ON -DGGML_CUDA_MMQ=OFF"
```

Problemas concretos:

1. `GGML_CUDA_FA_ALL_QUANTS`, `GGML_CUDA_GRAPHS` y `GGML_CUDA_MMQ` se pasan
   como **definiciones del preprocesador a nvcc**, no como variables CMake. El
   `CMakeCache.txt` resultante muestra `GGML_CUDA_FA_ALL_QUANTS=OFF` y
   `GGML_CUDA_GRAPHS=ON` (el valor por defecto), no lo que el script pretendía.
2. `GGML_CUDA_MMQ` **no existe** en esta revisión. La opción real es
   `GGML_CUDA_FORCE_MMQ` (CMake, línea 202 de `ggml/CMakeLists.txt`), que
   fuerza MMQ en vez de cuBLAS.
3. `GGML_CUDA_FATTN_TILE_SIZE` y `GGML_CUDA_FATTN_NWARPS` **no existen** en
   esta revisión; el tamaño de tile y los warps de FlashAttention son
   parámetros de plantilla internos (`fattn-mma-f16.cuh`).
4. `-use_fast_math` ya lo añade `ggml/src/ggml-cuda/CMakeLists.txt`; repetirlo
   no cambia nada.
5. `-O3` es del compilador host (MSVC), no de nvcc; afecta sobre todo a la
   construcción del grafo y al sampler.

Conclusión: el build llamado "optimizado" era, en la práctica, el build
automático con `-O3` host y `-lineinfo`; las supuestas optimizaciones de
FlashAttention/MMQ no estaban activas. Los benchmarks de §4 se hicieron con el
binario real, no con la intención del script.

El nuevo `scripts/build-llama-lab.ps1` pasa **solo** opciones CMake reales y
escribe un recibo con el hash del binario y el estado del árbol.

---

## 3. Hot paths y kernels (perfil real)

Perfil Nsight Systems de Qwen3-4B Q4_K_M, 24 SMs, `sm_89`, 80 W. Los porcentajes
son tiempo de GPU del kernel, no tiempo de pared.

### Decode (256 tokens, 4B Q4)

| Kernel | % GPU | Fuente | Por qué |
|---|---:|---|---|
| `mul_mat_vec_q<Q4_K>` (varias formas) | **88.2%** | `ggml-cuda/mmvq.cu` | GEMV de pesos cuantizados; lee una vez cada peso por token. |
| `flash_attn_ext_vec` + combine | 2.5% | `fattn-vec.cuh`, `fattn.cu` | Atención con KV; batch 1. |
| `rms_norm_f32`, `rms_norm_mul_rope_f32` | 2.5% | `norm.cu`, `rope.cu` | Normas y RoPE fusionados por el grafo. |
| `quantize_q8_1` | 1.7% | `quantize.cu` | Cuantiza la activación a Q8_1 para `vec_dot`. |
| `mul_mat_q` (Q4_K/Q6_K) | ~4.5% | `mmq.cu` | Cola del lm_head / matrices pequeñas. |
| `k_set_rows`, `bin_bcast` | 0.6% | `cpy.cu`, `binbcast.cu` | KV y residual. |

El decode denso es **memory-bound**: 88% es GEMV y el resto atención/normas.
No hay un kernel caro que fusionar; el límite es el ancho de banda de VRAM.

### Prefill (8192 tokens, 4B Q4)

| Kernel | % GPU | Fuente | Por qué |
|---|---:|---|---|
| `mul_mat_q<Q4_K>` (dos formas) | **53.4%** | `mmq.cu` | GEMM cuantizado; usa Tensor Cores/DP4A. |
| `flash_attn_ext_f16` | **26.1%** | `fattn-mma-f16.cuh` | Atención causal; prefill largo. |
| `mul_mat_q<Q6_K>` | 8.6% | `mmq.cu` | lm_head y matrices de salida. |
| `rms_norm_mul_rope_f32` | 4.6% | `norm.cu`, `rope.cu` | Fusión ya existente en el grafo. |
| `quantize_mmq_q8_1` | 2.0% | `quantize.cu` | Prepara activaciones para MMQ. |

El prefill es **compute-bound** y está limitado por potencia (80 W) y por la
selección MMQ/FlashAttention. Es la fase donde un tile o un warp distinto puede
mover la aguja, no el decode.

### MoE (GPT-OSS-20B, 12 CPU layers, 64k)

El perfil de GPU no explica el rendimiento: el proceso usa ~315% de CPU, la GPU
~22% y solo ~27 W. Los expertos de las capas `--n-cpu-moe` se ejecutan en CPU
(`build_moe_ffn` → `mul_mat_id`), y el grafo cruza CPU↔GPU una vez por capa, no
por token. El cuello de botella es el **CPU + RAM**, no PCIe ni VRAM. Por eso
el mejor ajuste es mover capas de expertos a la GPU hasta el límite seguro y
usar 8 hilos (cores físicos), no 12/16.

Rutas relevantes:

- `src/llama-graph.cpp:2204` `build_moe_ffn`: router, top-k, `mul_mat_id`, GLU.
- `src/llama-graph.cpp:2603` `build_moe_cache_slots`: cache de expertos.
- `src/models/openai-moe.cpp:58` `build_arch_graph`: grafo concreto de GPT-OSS.
- `src/models/qwen3moe.cpp:58` y `qwen35moe.cpp`: variantes Qwen MoE.
- `ggml-cuda.cu:2092/2134`: dispatch de `mul_mat_id` a MMQ/MMVQ.

---

## 4. Qué se midió y qué no

- **Medido:** kernels CUDA de decode/prefill para 4B; VRAM, potencia, temperatura,
  utilización GPU/CPU, TTFT HTTP, ITL, cache de prompt, throughput de 15 modelos.
- **No medido con contador de hardware:** occupancy, registers, shared memory
  por kernel (Nsight Compute no se ejecutó todavía en esta fase). No se inventan.
- **No medido:** ancho de banda PCIe durante decode de un modelo denso; el
  modelo está completamente en VRAM y no hay tráfico por token. Para MoE los
  expertos se computan en CPU, no se copian por token.
- **Limitación:** el portátil tiene un límite de 80 W y un T.Limit bajo; los
  benchmarks se hicieron con enfriamiento entre casos y descartando la primera
  muestra. Aun así, la temperatura del chasis puede afectar al boost.

---

## 5. Modificaciones locales

| Cambio | Archivo | Justificación | Estado |
|---|---|---|---|
| Tabla MoE medida por contexto | `config/measured-moe-profiles.json` | El estimador analítico dejaba 2.5 GiB de VRAM sin usar en GPT-OSS 64k; la tabla se midió con llama-server. | Activo |
| `n-cpu-moe` y `threads` desde la tabla | `scripts/start-gpu-model-rtx4060-optimized.ps1` | GPT-OSS 64k: 16→12 capas CPU y 12→8 hilos = +22.7% decode. | Activo |
| Build real por CMake | `scripts/build-llama-lab.ps1` | Evita flags falsos y permite A/B reproducible. | Activo |
| MMVQ warp experiment | `forks/patches/0001-mmvq-4060-nwarps.patch` | Hipótesis: 4 warps genéricos no son óptimos en 24 SMs. | Experimental, ver §6 |

---

## 6. Experimento MMVQ (Ada, 24 SMs)

`mul_mat_vec_q` usa `calc_nwarps()` (`mmvq.cu:452`). En sm_89 cae en
`MMVQ_PARAMETERS_GENERIC`, que devuelve 4 warps para `ncols_dst=1..4`. El
perfil muestra que ese kernel es el 88% del decode, así que la hipótesis es
razonable: más warps pueden aumentar el paralelismo de memoria; menos warps
pueden reducir la presión de registros.

El parche añade una perilla de compilación (`GGML_CUDA_MMVQ_4060_NWARPS`) y se
probaron 2, 4 y 8 warps con el mismo binario base. Resultado medido:

| Warps | Qwen3-4B Q4 decode | Δ vs 4 warps | Nota |
|---:|---:|---:|---|
| 4 (upstream) | 82.0 tok/s | — | control |
| **2 (solo Q4_K/Q5_K/Q6_K)** | **85.8 tok/s** | **+4.6%** | se queda |
| 8 | 61.3 tok/s | −25% | se descarta |

Con 2 warps y `ncols_dst=1`, a profundidad 4096: 67.8 → 70.15 tok/s (+3.5%).
Q6_K: +1.6%; Q8_0 y 9B Q3: neutros; 7B Q4: −0.4% (dentro del ruido, pero se
declara). El prefill no cambia porque usa MMQ, no MMVQ. La prueba
`test-backend-ops -o MUL_MAT` pasa **2,490/2,490** casos con el build parcheado;
la primera versión, que aplicaba 2 warps a todos los tipos, falló un caso Q5_1
y se corrigió limitando el alcance a Q4_K/Q5_K/Q6_K.

**Decisión:** se conserva como build `lab-mvq2` para esta máquina. No se envía a
upstream porque el óptimo depende del número de SMs y del tipo de quant; un
`#ifdef` global no es una buena política upstream.

---

## 7. Resultados negativos que también cuentan

- **Backend sampling** (`--backend-sampling`): +1.5% decode en 4B, pero −3%
  prefill y TTFT algo peor; en GPT-OSS +1.7% decode y −2.3% prefill. No se
  activa por defecto.
- **Speculative decoding** con Qwen3-0.6B: los informes previos del proyecto
  muestran que no compensa en 8 GB; el borrador compite por VRAM y el coste de
  verificación supera la ganancia en chat real.
- **KV q4_0**: +2.0% PPL a 1k contexto; solo se usa cuando el contexto es el
  límite y el usuario acepta la degradación.
- **Q3_K_M**: +15.4% PPL; no se recomienda como perfil de calidad.
- **Ornith 9B**: no se usa para coding en este laboratorio; el usuario indicó
  que su calidad de código no es aceptable. Los perfiles de coding se centran
  en GPT-OSS-20B y Qwen3.6/30B-A3B.

---

## 8. Reproducir el perfil

```powershell
$tools = Get-Content config\inference-toolchain.local.json -Raw | ConvertFrom-Json
& $tools.nsys profile --trace=cuda,nvtx --sample=none --cpuctxsw=none `
  --cuda-graph-trace=node -o reports/profile-4b/decode `
  .local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-bench.exe `
  -m models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf -ngl 99 -fa on `
  -p 512 -n 256 -r 2 -b 1024 -ub 512 -t 8 -lm none -o json

& $tools.nsys stats --report cuda_gpu_kern_sum,cuda_api_sum --format csv `
  -o reports/profile-4b/decode-stats reports/profile-4b/decode.nsys-rep
```

Los CSV crudos están en `reports/profile-4b/`.
