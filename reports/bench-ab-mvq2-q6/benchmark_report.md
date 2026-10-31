# Benchmark report — RTX 4060 8 GB lab

Run: `ab-mvq2-q6`  
Suite: `core`  
Started: `2026-10-31T21:12:24+00:00`  
Binary: `C:\Users\user\Documents\prject_local_AI\bin\builds\lab-mvq2\bin\llama-bench.exe`  
Build: `lab-mvq2` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **244.21 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen3 (`qwen3-4b-q6`)

Quant **Q6_K** · 3.08 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp512 | **3,830.60** | 7.45 | 3,820.02 | 3,842.59 | — | — | 3,647 | 99 | 75.1/80.1 | 70 |
| decode | tg128 | **66.87** | 0.04 | 66.79 | 66.90 | 221.1 | 90.5 | 3,647 | 99 | 75.1/80.1 | 70 |

Telemetry: 18 samples; wall time 9,720 ms; load estimate 1,523 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
