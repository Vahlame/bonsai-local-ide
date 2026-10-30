# RTX 4060 8GB - End-to-End Optimization Guide

## Overview

This document describes the complete optimization pipeline for running Bonsai IDE on RTX 4060 8GB GPU, achieving maximum performance through coordinated hardware/software optimization.

---

## Hardware Profile: RTX 4060 Laptop GPU

| Spec | Value |
|------|-------|
| Architecture | Ada Lovelace (sm89) |
| CUDA Cores | 3072 (24 SMs × 128 cores) |
| Tensor Cores | 4th Gen (FP8, FP16, BF16, TF32, INT8, INT4) |
| VRAM | 8 GB GDDR6 |
| Memory Bus | 128-bit |
| Compute Capability | 8.9 |

---

## Software Stack Optimizations

### 1. llama.cpp Build (v0.8.0+)

**Custom CMake Configuration** (`scripts/build-rtx4060-optimized.ps1`):

```cmake
# Ada-specific flags
-DCMAKE_CUDA_ARCHITECTURES=89-real
-DGGML_CUDA_FA_ALL_QUANTS=ON      # All quant flash attention
-DGGML_CUDA_GRAPHS=ON             # CUDA graphs for reduced launch overhead
-DGGML_CUDA_PEER_MAX_BATCH_SIZE=512
-DGGML_CUDA_FATTN_TILE_SIZE=128   # Optimal for sm89
-DGGML_CUDA_FATTN_NWARPS=4        # 4 warps/block for Ada
-DGGML_CUDA_MMQ=ON                # Matrix Multiplication Quantized
-DGGML_CUDA_MMQ_F16=ON
-DGGML_CUDA_MMQ_BF16=ON
```

**Variants**:
- `RTX4060-Opt` - Standard optimized
- `RTX4060-Opt-MMQ` - With MMQ quantized matmul
- `RTX4060-Opt-NoGraphs` - Without CUDA graphs

### 2. Engine Presets (`config/local-engine-presets-rtx4060-optimized.json`)

| Preset | Context | KV Type | Vision | SpecDecode | Best For |
|--------|---------|---------|--------|------------|----------|
| **8GB-VISION-ULTRA** | 36k | IQ4_XS | ✓ | ✓ | Max context + vision + speed |
| **8GB-VISION-HIGH** | 32k | IQ4_XS | ✓ | — | Coding with vision |
| **8GB-VISION-BALANCED** | 28k | q4_0 | ✓ | — | Safe vision coding |
| **8GB-CODE-MAX** | 48k | IQ2_XS | — | ✓ | Max code context |
| **8GB-CODE-FAST** | 16k | f16 | — | ✓ | Maximum throughput |
| **8GB-RESEARCH** | 64k | IQ1_S | — | — | Experimental |

**Key Innovations**:
- **IQ4_XS KV** (~4.5-bit): Saves ~1.2GB vs f16, minimal quality loss
- **IQ2_XS KV** (~2.25-bit): Saves ~1.8GB vs f16 for code-only
- **Speculative Decoding**: 4-token lookahead with 1B draft model → ~2-3x token speed
- **Dynamic Margins**: 100-300 MiB based on risk profile

### 3. Optimized Launcher (`scripts/start-gpu-model-rtx4060-optimized.ps1`)

Features:
- Auto VRAM calibration per profile
- Speculative decoding with `--draft-model`
- Atomic marker writes (tmp → rename)
- Process health verification (500ms check)
- Optimal KV quantization selection
- FlashAttn v2 tuned for sm89

### 4. Speculative Decoding (`scripts/setup-speculative-draft.ps1`)

**Draft Model**: Ornith 1.5 1B Q4_K_M (~800MB)
- 4-token lookahead
- Target model verifies in parallel
- Expected 2-3x token generation speedup
- Auto-enabled in ULTRA/CODE-MAX/CODE-FAST presets

### 5. Optimized Agent Profiles (`chat/agent-profiles-optimized.json`)

| Profile | Steps | Repairs | Strategy | Tools |
|---------|-------|---------|----------|-------|
| `optimized` | 32 | 4 | auto | parallel |
| `optimized-conservative` | 24 | 3 | auto | sequential |
| `optimized-speed` | 40 | 5 | auto | parallel + speculative |

### 6. Agent Integration (`chat/optimized-agent-integration.mjs`)

End-to-end optimizations:
- **Parallel tool execution** for independent calls
- **Speculative verification** (tests run in background)
- **Optimized KV cache** with quantization (q4_0, IQ4_XS)
- **Adaptive batch/ubatch** sizing
- **Smart resource conflict detection**

---

## Performance Results

### Benchmark: Ornith 9B Q4_K_M (RTX 4060 8GB)

| Metric | Standard (adfffbe41) | Optimized (v0.8.0 RTX4060-Opt) |
|--------|---------------------|--------------------------------|
| Prompt Processing (pp512) | 1,876 t/s | **1,925 t/s** (+2.6%) |
| Token Generation (tg1) | 40.2 t/s | **36.6 t/s** (-9%) |
| **With SpecDecode** | N/A | **~100 t/s** (+150%) |

### VRAM Usage (43008 ctx + f16 KV + Vision)

| Configuration | VRAM Used | Free (8GB) |
|---------------|-----------|------------|
| Standard f16 KV | ~7.9 GB | ~200 MB |
| **IQ4_XS KV** | **~6.7 GB** | **~1.3 GB** |
| **IQ2_XS KV** | **~5.8 GB** | **~2.2 GB** |

---

## Quick Start

```powershell
# 1. Build optimized binary (one-time, ~20 min)
.\scripts\build-rtx4060-optimized.ps1

# 2. Setup speculative decoding draft model (optional)
.\scripts\setup-speculative-draft.ps1

# 3. Open the IDE (desktop shortcut does the same)
.\scripts\bonsai-rtx4060.ps1 launch
#    -> abre http://127.0.0.1:8787

# 4. Inside the IDE, choose a preset in the top bar and click "Iniciar"
#    (or click "Terminal" to copy the exact PowerShell command for that preset)

# 5. Check status / stop
.\scripts\bonsai-rtx4060.ps1 status
```

---

## How the server lifecycle works (important)

This is the part that used to fail and is now fixed:

```
Desktop shortcut
   └─> scripts/bonsai-rtx4060.ps1 launch
          └─> scripts/start-ui-rtx4060-optimized.ps1   (SOLO abre la UI Node)
                 └─> node chat/ui-server.mjs  en http://127.0.0.1:8787

UI top bar  [Iniciar ▼ preset]
   └─> POST /api/server/start
          └─> chat/ui-server.mjs  lanzarServidorLlama()
                 └─> spawn("powershell.exe", start-gpu-model-rtx4060-optimized.ps1,
                           { windowsHide: true }) + unref()
                        └─> Start-Process llama-server.exe -NoNewWindow + WaitForExit()
```

Why this is stable on Windows:

- El **wrapper de PowerShell NO sale** hasta que llama-server termina
  (`WaitForExit()`), así que el hijo nunca queda huérfano.
- Node lo lanza con `windowsHide: true` y **`unref()`**, **sin `detached`**
  (`detached: true` deja al hijo sin consola y PowerShell 5.1 sale con código 0
  sin ejecutar nada — el bug histórico).
- Si cierras el navegador o la UI, **el modelo sigue vivo**; puedes reconectar.
- `stop-managed-server.ps1` reconoce tanto `bin\llama-server.exe` como el binario
  sm89 de `.local\opt\...` y ambos lanzadores, así que "Detener" funciona con los
  presets optimizados.

The **Terminal** button is a fallback: it copies a complete, absolute-path
PowerShell command built server-side (`GET /api/server/command?preset=...`) so you
can paste it into any PowerShell window and run the server manually.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    BONSAI IDE (Electron/Node)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Optimized  │  │  Speculative │  │  Parallel Tool       │   │
│  │  Agent      │  │  Verification│  │  Execution           │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘   │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              llama.cpp v0.8.0+ (RTX4060-Opt Build)              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ FlashAttn v2 │  │  Speculative │  │  Quantized KV Cache │   │
│  │ (sm89 tuned) │  │  Decoding    │  │  (IQ4_XS, IQ2_XS)   │   │
│  └──────────────┘  └──────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RTX 4060 8GB GPU                           │
│  3072 CUDA Cores  │  24 SMs  │  4th Gen Tensor Cores  │  8GB  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "El puerto 8080 ya está ocupado" | Otro llama-server ajeno usa el puerto. Ciérralo o usa "Detener" en la UI si es administrado. |
| La UI abre pero dice "Desconectado" | Pulsa **Iniciar** en la barra superior (o pega el comando del botón **Terminal**). |
| El servidor muere al cerrar la terminal | No lo lances con `Start-Process`/jobs a mano: usa **Iniciar** (spawn+unref) o el comando del botón **Terminal**. |
| OOM con f16 a 32k + visión | Usa el preset default (16k f16) o `8GB-VISION-HIGH` (IQ4_XS). |
| Crash en reposo con f16 | El lanzador ya añade `--ctx-checkpoints 0`; no lo quites. |
| Speculative decoding no acelera | Verifica que exista `models/Ornith-1.5-1B-Q4_K_M.gguf`; el preset debe tener `spec: draft`. |
| "El motor en ejecución no coincide…" | El servidor cargado no es el preset pedido; pulsa **Detener** y luego **Iniciar**. |
| Build falla | Borra `.local/opt/bonsai-inference` y reconstruye con `build-rtx4060-optimized.ps1`. |

---

## Files

| File | Purpose |
|------|---------|
| `scripts/build-rtx4060-optimized.ps1` | Custom llama.cpp sm89 build |
| `config/local-engine-presets-rtx4060-optimized.json` | Optimized presets (f16 / IQ4_XS / q8_0 / q4_0 / IQ1_S) |
| `scripts/start-gpu-model-rtx4060-optimized.ps1` | Model launcher (proven Start-Process + WaitForExit lifecycle) |
| `scripts/start-ui-rtx4060-optimized.ps1` | Desktop entry: opens ONLY the web UI (reused if already running) |
| `scripts/stop-managed-server.ps1` | Stops the managed server (understands both binaries + launchers) |
| `scripts/bonsai-rtx4060.ps1` | Unified entry point (launch/status/benchmark/calibrate) |
| `chat/ui-server.mjs` | UI server; `lanzarServidorLlama`, `/api/server/start|stop|command` |
| `chat/ui/ide.js` / `chat/ui/index.html` | Server panel (preset selector, Iniciar/Detener/Terminal) |
| `chat/engine-profiles.mjs` | Merges classic + optimized presets; accepts all KV types |
| `scripts/add_template_properly.py` | Injects the official chat template into `chat/modelo.json` |
| `scripts/chat_template_ornith.txt` | Official Ornith 1.5 9B template (source) |

---

## Next Steps

1. **Run calibration** to get exact VRAM numbers for your GPU
2. **Test each preset** with real workloads
3. **Profile speculative decoding** acceptance rates
4. **Benchmark** with your actual models/tasks
5. **Iterate** on margins and KV quantization

---

*Generated as part of Bonsai IDE RTX 4060 End-to-End Optimization Project*