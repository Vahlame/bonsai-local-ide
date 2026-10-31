# Bonsai Local IDE 2.2.0 - laboratorio de rendimiento

**Fecha:** 31-oct-2026  
**Tag:** `v2.2.0`  
**Base:** 2.1.0. No cambia la UI de forma obligatoria; cambia el motor, los
perfiles y la evidencia.

## La idea

2.1 fue una capa de producto (editor, terminal, búsqueda). 2.2 es una capa de
**ingeniería de rendimiento**: medir la RTX 4060 real, encontrar dónde se pierde
tiempo y cambiar solo lo que se demuestra. El resultado principal no fue un
kernel nuevo: fue **usar la VRAM que el plan anterior dejaba libre**.

## Números medidos

| Cambio | Antes | Después | Ganancia |
|---|---:|---:|---:|
| GPT-OSS-20B 64k decode | 30,0 tok/s | **36,8 tok/s** | **+22,7%** |
| GPT-OSS-20B 64k prefill | 762 tok/s | **908 tok/s** | **+19,2%** |
| GPT-OSS-20B 64k TTFT | 2.021 ms | **1.707 ms** | **−15,5%** |
| GPT-OSS prompt cache | 3.814 ms | **72 ms** | **52,8×** |
| Qwen3.6-35B-A3B 32k | 42,5 tok/s | **44,8 tok/s** | +5,3% |
| Qwen3-30B-A3B 32k | 44,3 tok/s | **46,6 tok/s** | +5,2% |
| Qwen3-4B servidor | 73,8 tok/s | **77,0 tok/s** | +4,3% |

El precio en VRAM de GPT-OSS es +1.618 MiB; quedan **879 MiB** libres, el margen
que el proyecto ya exigía. `n-cpu-moe 11` a 64k hace OOM.

## Qué se cambió

1. **Reparto MoE medido por contexto.** GPT-OSS 64k: 16 → 12 capas CPU; 32k: 11;
   96k: 13; 128k: 14. Qwen3.6 32k: 22 → 19. Qwen3-30B 32k: 29 → 26.
2. **8 hilos físicos** en MoE en vez de 12/16. En GPT-OSS 64k: 34,4 → 36,8
   tok/s; 16 hilos bajan a 32,4.
3. **Build de laboratorio** `lab-mvq2`: MMVQ a 2 warps solo para Q4_K/Q5_K/Q6_K
   y batch 1. Qwen3-4B: 82,0 → 85,8 tok/s; servidor 73,8 → 77,0. Neutro en 9B,
   −0,4% en 7B (declarado). `test-backend-ops`: 2.490/2.490 MUL_MAT.
4. **Auditoría del build anterior.** Los flags `FA_ALL_QUANTS`, `GRAPHS` y `MMQ`
   del script anterior no activaban nada; `GGML_CUDA_MMQ` no existe. El nuevo
   `scripts/build-llama-lab.ps1` usa variables CMake reales.
5. **Perfiles y presupuesto.** `profiles/*.json`, `runtime/rtxllm.py`,
   `config/measured-moe-profiles.json`.
6. **Documentación y gráficos.** `BENCHMARKS.md`, `OPTIMIZATIONS.md`,
   `QUANTIZATION.md`, `TUNING.md`, `docs/SOURCE-AUDIT.md`, `HARDWARE.md`,
   `ARCHITECTURE.md`, SVG en `docs/graficos/rtx4060-*.svg`.

## Lo que NO se hizo

- No se cambió el power limit de 80 W (el máximo de 140 W es una decisión
  térmica/BIOS que el proyecto no ejecuta).
- No se usó vLLM/TensorRT-LLM/ExLlamaV2 en Windows nativo: no son viables aquí.
- No se copiaron kernels propietarios de NVIDIA.
- No se forzó FlashAttention ni CUTLASS sin A/B.
- No se mantuvo el parche MMVQ de 8 warps: era un 25% más lento.
- No se activó backend sampling: +1,5% decode pero −3% prefill.

## Verificación

- `npm test`: **45/45 suites, 0 fallos** (129,5 s).
- `npm run docs:links`: **26 documentos, 129 enlaces, 0 rotos**.
- `test-backend-ops test -o MUL_MAT -b CUDA0 -j 4`: **2.490/2.490 OK**.
- GPT-OSS 64k: 3 repeticiones independientes, 36,53/36,76/36,91 tok/s.
- Qwen3.6 32k: 44,79 tok/s; n-cpu-moe 18 OOM.
- Qwen3-30B 32k: 46,61 tok/s; n-cpu-moe 25 OOM.
- Qwen3-4B 16k: TTFT 43,8–114,5 ms para 116–401 tokens; 1.848 ms para 6.115.
- Prompt cache: 43,0× (4B) y 52,8× (GPT-OSS), medido con `cache_n` > 3.000.
- Evidencia: `reports/test-backend-ops-mvq2-scoped.log`,
  `reports/RELEASE-2.2.0/verification.md` y los `reports/bench-*`.

## Reproducir

```powershell
# 1. Inventario
python -m venv .venv
. .\.venv\Scripts\Activate.ps1
pip install psutil
python bench\inventory.py

# 2. Baseline
python bench\bench_suite.py --suite core --label baseline --runs 1 --publish

# 3. MoE (GPT-OSS)
python bench\server_suite.py --model gpt-oss-20b --context 65536 --prompts 2048 --n-predict 256 --runs 3 --n-cpu-moe 12 --threads 8

# 4. Build MMVQ + test de correctitud
powershell -ExecutionPolicy Bypass -File forks\apply-4060-patches.ps1 -Nwarps 2
powershell -ExecutionPolicy Bypass -File scripts\build-llama-lab.ps1 -Variant lab-base -Server -Tests -Jobs 8
.\bin\builds\lab-base\bin\test-backend-ops.exe test -o MUL_MAT -b CUDA0 -j 4

# 5. Gráficos y resultados maestros
python bench\merge_results.py
python bench\charts.py
```

## Archivos nuevos

```
bench/
  inventory.py  bench_suite.py  server_suite.py  quality_suite.py
  autotune.py  charts.py  merge_results.py  quantize_qwen3_4b.ps1
config/measured-moe-profiles.json
profiles/*.json
runtime/rtxllm.py
scripts/build-llama-lab.ps1  scripts/build-machine-probes.ps1
forks/README.md  forks/apply-4060-patches.ps1  forks/patches/*
kernels/bandwidth/bandwidth.cu
BENCHMARKS.md  OPTIMIZATIONS.md  QUANTIZATION.md  TUNING.md
ARCHITECTURE.md  HARDWARE.md  docs/SOURCE-AUDIT.md
```

## Limitaciones conocidas

- El parche MMVQ pierde 0,4% en Qwen2.5-Coder-7B. Si se necesita cero regresión,
  usar el build estable (`lab-control`) para el 7B.
- El 4B es el único denso con margen de kernel (84% del roofline). 7B/9B están
  al 100%; no hay milagro posible ahí.
- Qwen3.6 no se validó a 128k; la tabla se queda en 64k.
- La temperatura del chasis y el modo performance del portátil pueden mover los
  números; se mide con la máquina en el estado encontrado.
