# Release 2.2.0 verification

Date: 2026-10-31  
Machine: Acer Nitro AN16-41, RTX 4060 Laptop 8 GB, Ryzen 7 7840HS

| Check | Result | Evidence |
|---|---|---|
| Project suites | **45/45 OK, 0 fail** (129.5 s) | `npm test` |
| Documentation links | **26 docs, 129 links, 0 broken** | `npm run docs:links` |
| CUDA MUL_MAT correctness | **2,490/2,490 OK** | `reports/test-backend-ops-mvq2-scoped.log` |
| CUDA Graphs A/B | 82.0 vs 73.2 tok/s (ON/OFF) | `reports/bench-ab-nographs-4b` |
| GPT-OSS-20B 64k decode | 36.53 / 36.76 / 36.91 tok/s | `reports/bench-moe64k-n12-t8-r3` |
| GPT-OSS-20B 64k prefill | 898–909 tok/s | same |
| Qwen3.6-35B-A3B 32k | 44.79 tok/s, 7409 MiB | `reports/bench-qwen36-32k-n19-t8` |
| Qwen3-30B-A3B 32k | 46.61 tok/s, 7535 MiB | `reports/bench-qwen3-30b-32k-n26-t8` |
| Qwen3-4B server (mvq2) | 77.0 tok/s, TTFT 432 ms | `reports/bench-server-4b-mvq2-scoped` |
| Prompt cache 4B | 43.0× | `reports/bench-server-qwen3-4b` |
| Prompt cache GPT-OSS | 52.8× | `reports/bench-server-gpt-oss` |
| Hard flags audit | `FA_ALL_QUANTS=OFF`, no `GGML_CUDA_MMQ` option | `hardware_report.md`, `docs/SOURCE-AUDIT.md` |
| Build data | `lab-mvq2` from fork 8642541 | `reports/builds/lab-base.json` |

## Notes

- The project suites do not load the 11 GB model; they validate the IDE/runtime
  contracts. The GPU evidence is in the `reports/bench-*` directories.
- `test-backend-ops` ran against the patched `ggml-cuda.dll` with the 2-warp
  K-quant override.
- The corrected build script and the fork are local; the release does not ship
  binaries or model weights.
