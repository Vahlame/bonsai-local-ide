# Hardware report — RTX 4060 8 GB local-inference lab

Generated: `2026-10-31T21:40:44+00:00`  
Machine: **Acer Nitro AN16-41**  
OS: **Microsoft Windows 10 Enterprise LTSC** build `19044`  
Method: WMI/CIM + `nvidia-smi` + `nvidia-smi -q` + CUDA 12.9 runtime + `winsat` + a custom CUDA 512 MiB bandwidth probe. The JSON source of truth is `machine_profile.json`.

> Values marked **measured** come from this machine. Values marked **spec** are derived from the CPU/GPU architecture and are included only for context. No number in this report is copied from a vendor benchmark.

## 1. Summary

| Item | Value |
|---|---|
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU (Ada, CC 8.9) |
| VRAM | 8188 MiB total, 7956 MiB free at inventory time |
| GPU SMs | 24 |
| GPU power limit | 80 W (default 80 W; max 140 W) |
| PCIe | Gen 4 x8 max; Gen 4 x8 current |
| Resizable BAR | True (BAR1 8192 MiB) |
| CPU | AMD Ryzen 7 7840HS w/ Radeon 780M Graphics — 8C/16T, L2 8192 KiB, L3 16384 KiB |
| SIMD | SSE4.2, AVX2, FMA, AVX-512F, AVX-512BW, AVX-512CD, AVX-512DQ, AVX-512VL |
| RAM | 15.31 GiB (2 modules, 5600 MT/s, 2 channels) |
| RAM bandwidth | 53,576.05 MB/s (winsat, measured) |
| Storage | HFS001TEJ9X125N NVMe, 953.9 GiB, 3,965.37 MB/s seq read |
| CUDA | driver 617.14 (UMD 13.4), toolkit/runtime 12.9 |

## 2. GPU: RTX 4060 Laptop 8 GB

| Property | Value | Source |
|---|---|---|
| Product | NVIDIA GeForce RTX 4060 Laptop GPU | nvidia-smi |
| Architecture | Ada | nvidia-smi -q |
| Compute capability | 8.9 (`sm_89`) | nvidia-smi |
| SMs | 24 | CUDA runtime |
| CUDA cores (spec) | 3072 (24 SM × 128) | Ada spec |
| Tensor cores (spec) | 96 (4th gen, 24 SM × 4) | Ada spec |
| VRAM | 8188 MiB | nvidia-smi |
| Memory bus | 128-bit GDDR6 | CUDA runtime |
| Memory clock | 7851 MHz | CUDA runtime |
| Theoretical VRAM BW | 251.23 GB/s | clock × bus (spec) |
| **Measured read BW** | **245.00 GB/s** | custom kernel, 512 MiB |
| Measured write BW | 243.88 GB/s | custom kernel, 512 MiB |
| Measured copy BW | 226.33 GB/s | custom kernel, 512 MiB |
| Driver | 617.14 | nvidia-smi |
| CUDA UMD | 13.4 | nvidia-smi |
| VBIOS | 95.07.2d.00.16 | nvidia-smi |
| BAR1 | 8192 MiB (used 8164 MiB) | nvidia-smi -q |
| Power limit | 80 W (max 140 W) | nvidia-smi -q |
| Temperature / T.Limit | 46 °C / None °C | nvidia-smi |
| P-state at idle | P0 | nvidia-smi |

**Bandwidth interpretation.** The measured read bandwidth is **245.00 GB/s**, or **97.5%** of the clock-derived peak. This is the hard ceiling for autoregressive decode: a Q4 model of size S GB can read its weights at most `245.00 GB/s / S` times per second. The 80 W board power limit (max 140 W) is the other relevant ceiling: prefill is compute/power-bound, decode is bandwidth-bound. A vendor performance mode that raises the power limit is a BIOS/EC setting and is **not** changed by this project.

## 3. CPU: AMD Ryzen 7 7840HS

| Property | Value |
|---|---|
| Name | AMD Ryzen 7 7840HS w/ Radeon 780M Graphics |
| Family/model | AMD64 Family 25 Model 116 Stepping 1 |
| Cores / threads | 8 / 16 |
| Max clock | 3801 MHz |
| L1 (spec) | 32 KiB I + 32 KiB D per core (Zen 4) |
| L2 | 8192 KiB total (1024 KiB per core) |
| L3 | 16384 KiB |
| SIMD confirmed by build | SSE4.2, AVX2, FMA, AVX-512F, AVX-512BW, AVX-512CD, AVX-512DQ, AVX-512VL |
| Virtualization | True |
| Power plan | Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance) |

The llama.cpp CPU backend in the optimized build was compiled with `/arch:AVX512` and `GGML_AVX512`, so the AVX-512 path is real on this machine. `winsat mem` reported **53,576.05 MB/s**; this is a system assessment, not a hand-tuned STREAM result, and is used only as an order-of-magnitude check for CPU-side MoE work.

## 4. Memory and storage

| Property | Value |
|---|---|
| Total RAM | 15.31 GiB |
| Modules | 2 × 8.0 GiB |
| Configured speed | 5600 MT/s |
| Channels | 2 |
| Free RAM at inventory | 10.69 GiB |
| Page file | 22630 MiB allocated, 2174 MiB used |
| Storage | HFS001TEJ9X125N (NVMe) |
| Free space | 241.9 GiB |
| Sequential read | 3,965.37 MB/s (winsat, measured) |

16 GiB is the main constraint for MoE offload: a 20–35 B MoE model is 11–16 GiB on disk, so the OS page cache and the model's CPU-resident experts compete with the desktop. The page file is large enough to avoid a hard OOM, but swapping during decode destroys latency; the benchmark harness records both process working set and system commit.

## 5. Software stack

| Component | Version / path |
|---|---|
| OS | Microsoft Windows 10 Enterprise LTSC 10.0.19044 build 19044 |
| Kernel | 10.0.19044 |
| Python | 3.14.7 |
| Node | v26.0.0 |
| Git | git version 2.56.0.windows.1 |
| CMake | cmake version 3.31.6-msvc6 |
| Ninja | 1.12.1 |
| MSVC | None |
| nvcc | Build cuda_12.9.r12.9/compiler.36037853_0 |
| Nsight Systems | NVIDIA Nsight Systems version 2026.3.2.313-263238521929v0 |
| Nsight Compute | NVIDIA (R) Nsight Compute Command Line Profiler
Copyright (c) 2018-2026 NVIDIA Corporation
Version 2026.3.0.0 (build 38525999) (public-release) |
| Ollama | None |
| PyTorch | not installed |
| Transformers | not installed |
| vLLM | not installed |
| ExLlamaV2 | not installed |

### llama.cpp builds found

| Build | Commit | CUDA arch | FORCE_MMQ | FA all quants | Graphs | LTO |
|---|---|---|---|---|---|---|
| `build-Auto-sm89` | `8642541b255b` | 89-real | OFF | OFF | ON | OFF |
| `build-RTX4060-Opt-sm89` | `8642541b255b` | 89-real | OFF | OFF | ON | OFF |
| `lab-base` | `8642541b255b` | 89-real | OFF | OFF | ON | OFF |

> **Audit note.** The existing `build-rtx4060-optimized.ps1` appends `-DGGML_CUDA_FA_ALL_QUANTS=ON`, `-DGGML_CUDA_GRAPHS=ON` and `-DGGML_CUDA_MMQ=OFF` to `CMAKE_CUDA_FLAGS`, not to the CMake cache. They become preprocessor definitions passed to nvcc and do **not** enable those features. Likewise, `GGML_CUDA_FATTN_TILE_SIZE` and `GGML_CUDA_FATTN_NWARPS` do not exist in this llama.cpp revision. The Phases 4–6 measurements treat this as a hypothesis to test, not as a proven optimization.

## 6. CUDA / PCIe measurements

| Transfer | Measured | Theoretical |
|---|---:|---:|
| H2D pageable | 12.97 GB/s | ~15.75 GB/s |
| H2D pinned | 13.39 GB/s | ~15.75 GB/s |
| D2H pageable | 12.26 GB/s | ~15.75 GB/s |
| D2H pinned | 13.10 GB/s | ~15.75 GB/s |
| D2D memcpy | 111.05 GB/s | 251.23 GB/s |

Pinned memory gives only ~2–3% over pageable transfers on this laptop, so a pinned staging buffer is not a major lever for model loading. The useful PCIe fact is that a full 5.4 GiB 9B model is loaded once; per-token PCIe traffic should be near zero for a fully offloaded dense model. For MoE, the CPU-resident experts are computed on the CPU, not copied per token, so the relevant interconnect is the CPU memory bus, not PCIe.

## 7. What this means for optimization

1. **Dense decode is near the memory roofline.** At 245.00 GB/s measured read bandwidth, the best possible decode rate for a model with S GB of weights is about `245.00 GB/s / S_GB` tokens/s (ideal, one pass over the weights per token). For the 9B Q4_K_M model (5.37 GiB = 5.77 GB) that ceiling is about **42.3 tok/s**; a 5% kernel gain is worth less than 2 tok/s, while a quantization that removes 20% of the bytes is worth far more. Any claim above the roofline is measurement error or a cache effect.
2. **Prefill is the place where compute/kernel work can still matter.** It is a GEMM workload and is limited by 80 W board power, tensor-core utilization and kernel selection, not by weight bandwidth.
3. **MoE is a CPU/RAM problem on this machine.** A 20–35 B MoE has 11–16 GiB of weights; 16 GiB of RAM means the page cache and the experts fight for the same pages. The `--n-cpu-moe` split and the number of CPU threads are first-order knobs.
4. **The build script's claimed flags must be audited.** Phase 5 does this with a clean CMake cache and A/B builds.

## 8. Reproduction

```powershell
python -m venv .venv
. .\.venv\Scripts\Activate.ps1
pip install psutil
python bench\inventory.py
powershell -ExecutionPolicy Bypass -File scripts\build-machine-probes.ps1
```

The inventory is deliberately read-only: it does not change clocks, power limits, BIOS, drivers, page files or GPU firmware.
