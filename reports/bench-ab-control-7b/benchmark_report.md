# Benchmark report — RTX 4060 8 GB lab

Run: `ab-control-7b`  
Suite: `core`  
Started: `2026-10-31T21:14:04+00:00`  
Binary: `C:\Users\user\Documents\prject_local_AI\bin\builds\lab-control\bin\llama-bench.exe`  
Build: `lab-control` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **244.21 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen2.5 Coder (`qwen25-coder-7b`)

Quant **Q4_K_M** · 4.36 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp512 | **2,643.82** | 5.96 | 2,629.76 | 2,657.93 | — | — | 4,637 | 100 | 78.6/80.2 | 69 |
| decode | tg128 | **52.22** | 0.01 | 52.19 | 52.24 | 244.6 | 100.1 | 4,637 | 100 | 78.6/80.2 | 69 |

Telemetry: 25 samples; wall time 13,454 ms; load estimate 2,865 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
