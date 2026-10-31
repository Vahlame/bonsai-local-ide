# Benchmark report — RTX 4060 8 GB lab

Run: `ab-nographs-4b`  
Suite: `core`  
Started: `2026-10-31T21:59:17+00:00`  
Binary: `C:\Users\user\Documents\prject_local_AI\bin\builds\lab-nographs\bin\llama-bench.exe`  
Build: `lab-nographs` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **245.00 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen3 (`qwen3-4b`)

Quant **Q4_K_M** · 2.33 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp2048 | **4,016.11** | 6.91 | 3,996.55 | 4,036.63 | — | — | 3,085 | 100 | 77.7/79.9 | 70 |
| prefill | pp512 | **4,179.30** | 7.64 | 4,172.81 | 4,197.55 | — | — | 3,085 | 100 | 77.7/79.9 | 70 |
| decode | tg128 | **73.20** | 0.02 | 72.32 | 73.64 | 182.8 | 74.6 | 3,085 | 100 | 77.7/79.9 | 70 |
| decode | tg256 | **73.23** | 0.08 | 72.61 | 73.68 | 182.9 | 74.6 | 3,085 | 100 | 77.7/79.9 | 70 |

Telemetry: 48 samples; wall time 25,369 ms; load estimate 2,002 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
