# Mixed quantization experiment (Q4 body + Q8 embeddings/output)

**Date:** 2026-10-31  
**Source:** Qwen3-4B-Instruct-2507-Q8_0.gguf  
**Command:**

```powershell
llama-quantize --allow-requantize `
  models\Qwen3-4B-Instruct-2507-Q8_0.gguf `
  models\Qwen3-4B-Instruct-2507-Q4_K_M-embQ8-outQ8.gguf `
  Q4_K_M 8 --output-tensor-type q8_0 --token-embedding-type q8_0
```

**Result:**

| Metric | Official Q4_K_M | Mixed Q4 + emb/out Q8 | Q6_K |
|---|---:|---:|---:|
| Size | 2.33 GiB | 2.33 GiB | 3.08 GiB |
| PPL (512 ctx) | 12.2553 | **12.3478** | 11.9654 |
| Decode 128 | 81.9 tok/s | 82.1 tok/s | 65.5 tok/s |
| Prefill 2048 | 3,951 tok/s | 4,013 tok/s | 3,651 tok/s |

The mixed file is **worse** in PPL than the official Q4 and gives no speed or
size benefit. Rejected.

Caveat: the body was quantized from Q8_0, not F16. A fair mixed-quant test
needs an F16 source and an imatrix. The raw PPL log is `perplexity.log`; the
clean throughput run is `throughput-clean/`.
