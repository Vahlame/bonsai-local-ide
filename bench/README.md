# bench/ — reproducible measurements for this laptop

Everything here is designed for **one machine**: the RTX 4060 8 GB laptop in
`hardware_report.md`. It refuses to run when another process is using more than
1 GiB of the dGPU (unless `--allow-busy` is explicit).

## Tools

| Tool | What it does |
|---|---|
| `inventory.py` | Hardware/software inventory + CUDA bandwidth probe + winsat; writes `machine_profile.json` and `hardware_report.md`. |
| `bench_suite.py` | `llama-bench` matrix (prefill/decode/depth), telemetry, CSV/JSON/Markdown. |
| `server_suite.py` | Starts `llama-server`, measures time-to-ready, TTFT, ITL, prompt cache. |
| `quality_suite.py` | Perplexity of the Q8/Q6/Q5/Q4/Q3 matrix and KV f16/q8/q4. |
| `autotune.py` | Progressive neighbour search over n-cpu-moe/threads/KV/ubatch; writes `profiles/autotuned-*.json`. |
| `charts.py` | Regenerates the SVG charts under `docs/graficos/rtx4060-*.svg`. |
| `merge_results.py` | Normalizes the selected suites into root `benchmark_results.*`. |
| `quantize_qwen3_4b.ps1` | Rebuilds Q6/Q5/Q4/Q3 from the Q8 reference (requires the Q8 file). |
| `build-machine-probes.ps1` | Builds `kernels/bandwidth/bandwidth.cu`. |

## Quick start

```powershell
python -m venv .venv
. .\.venv\Scripts\Activate.ps1
pip install psutil

# 1. Inventory (also writes hardware_report.md / machine_profile.json)
python bench\inventory.py

# 2. Baseline
python bench\bench_suite.py --suite core --label baseline --runs 1 --publish

# 3. Server TTFT / cache
python bench\server_suite.py --model qwen3-4b --context 16384 `
  --prompts 128,512,2048,8192 --cache-test

# 4. Quality
python bench\quality_suite.py --out reports\bench-quality

# 5. Autotune (dry-run first)
python bench\autotune.py --model gpt-oss-20b --context 65536 --dry-run
python bench\autotune.py --model gpt-oss-20b --context 65536 --max-runs 4
```

## What a result row contains

`bench_suite.py` writes:

```
model, size, quant, backend, build, commit, compiler_flags, arch,
context, depth, batch, ubatch, threads, gpu_layers, n_cpu_moe, kv,
flash_attn, tensor_split, load_mode, phase, test, n_prompt, n_gen,
tok_s, reported_tok_s, std, min, max, ttft_ms, itl_ms,
prefill_tok_s, decode_tok_s, effective_read_gbs, pct_of_roofline,
vram_base, vram_peak, ram_peak, gpu_util, gpu_mem_util, cpu_util,
process_cpu, power_avg/max, temp_avg/max, clocks, pcie, wall_ms,
load_ms_estimate, reps, warm_samples, run_index, note
```

The CSV is the flat view; the JSON keeps the same rows plus metadata and the
exact command line. Raw `llama-bench` stdout/stderr is archived under `raw/`.

## Method (short)

- `llama-bench -r 4`; discard the first measured sample **and** the built-in
  warm-up. `tok_s` is the median of the remaining samples.
- GPU must be idle; between cases the runner waits for temperature to drop.
- Power averages use only samples with GPU utilization ≥ 50% (excludes model
  loading).
- MoE uses `llama-server` because `llama-bench` does not reproduce the server
  scheduling and prompt cache. TTFT is measured to the first non-empty content
  chunk over HTTP.
- `quality_suite.py` uses the same corpus and chunk count for every row.

## Files

- `config/models.json` — model matrix and suite definitions.
- `config/measured-moe-profiles.json` — measured safe MoE splits.
- `results/bandwidth.json` — CUDA probe output.
- `reports/bench-*` (repository root) — every run, raw logs, manifests.

## Limitations

- No TensorRT-LLM/vLLM/ExLlamaV2 on native Windows 10; they are not pretended.
- No hardware performance counters yet (Nsight Compute); Nsight Systems kernel
  summaries are in `reports/profile-4b/`.
- The 7B Q4 model loses 0.4% with the MMVQ 2-warp build; see
  `OPTIMIZATIONS.md`. Use the stable build if that matters.
