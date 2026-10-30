## Bonsai IDE v1.4.0 — RTX 4060 Optimized

End-to-end optimization for the **RTX 4060 8 GB** (Ada Lovelace, sm89) plus the
official Ornith 1.5 9B chat template and a fully working in-IDE server panel.

### Highlights

- **llama.cpp v0.8.0 sm89 build** — FlashAttention v2, CUDA graphs,
  FATTN tile 128 / 4 warps, `GGML_CUDA_FA_ALL_QUANTS=ON`.
- **Official Ornith 1.5 9B chat template** in `chat/modelo.json` (vision + tools +
  reasoning), injected safely with `json.dump` and passed via `--chat-template-file`.
- **f16 / IQ4_XS / q8_0 / q4_0 / IQ1_S presets** with auto VRAM calibration.
- **Working server panel** in the IDE top bar: preset selector, **Iniciar**,
  **Detener**, and **Terminal** (copies a complete absolute-path PowerShell command).
- **Robust Windows lifecycle**: `spawn(windowsHide)` + `unref()` in Node and
  `Start-Process -NoNewWindow` + `WaitForExit()` in PowerShell. The model keeps
  running after the browser/UI exits.
- `stop-managed-server.ps1` now understands **both** binaries (`bin\` and the sm89
  build) and **both** launchers.

### Fixed in this release

| Problem | Fix |
|---|---|
| Server died when the launcher exited | Wrapper now blocks on `WaitForExit()` |
| "Detener" refused to stop the optimized server | Stop script accepts sm89 binary + optimized launcher |
| UI crashed at startup with no model running | Tolerate unloaded model; start from the button |
| Server panel never ran (JS syntax error) | Closed the IIFE; panel now works |
| Terminal command used `%~dp0` (invalid in PowerShell) | Command built server-side with absolute paths |

### Presets

| Preset | Context | KV | Vision |
|---|---:|---|:--:|
| `8GB-VISION-DEFAULT-F16` | 16,384 | f16 | ✅ |
| `8GB-VISION-ULTRA-F16` | 32,768 | f16 | ✅ |
| `8GB-VISION-ULTRA` | 36,864 | IQ4_XS | ✅ |
| `8GB-VISION-HIGH` | 32,768 | IQ4_XS | ✅ |
| `8GB-VISION-BALANCED` | 28,672 | q4_0 | ✅ |
| `8GB-VISION-SAFE` | 24,576 | q4_0 | ✅ |
| `8GB-CODE-MAX` | 49,152 | IQ2_XS | — |
| `8GB-CODE-BALANCED` | 32,768 | q8_0 | — |
| `8GB-CODE-FAST` | 16,384 | f16 | — |
| `8GB-RESEARCH` | 65,536 | IQ1_S | — |

### Quality evidence

- KV quality A/B/C measured on 2026-10-30 (see `docs/evidencia/2026-10-30/`).
  Config **A (32K · q8_0 · vision)** passed 8/8 checks.

### Verification

- `npm test` — **40/40** suites green.
- Start → chat completion → stop leaves **0** leftover processes.
- Model survives UI/browser exit.

### Quick start

```powershell
.\scripts\bonsai-rtx4060.ps1 launch
# opens http://127.0.0.1:8787 — pick a preset and click "Iniciar"
```

See `docs/RTX4060_OPTIMIZATION_GUIDE.md` for the full guide.
