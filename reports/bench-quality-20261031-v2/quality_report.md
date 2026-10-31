# Quality report — quantization and KV cache

Corpus: `quality.txt` (107605 bytes, SHA-256 `3f037c1de6a506cb…`) · chunks per case: 12 · same text for every row.

## Weight quantization (Q8_0 reference, f16 KV, 512 ctx)

| weights | PPL | Δ vs Q8_0 | VRAM peak MiB |
|---|---:|---:|---:|
| Q8_0 | 11.9276 | 0.0% | 4577 |
| Q6_K | 11.9654 | 0.317% | 3647 |
| Q5_K_M | 12.1321 | 1.715% | 3249 |
| Q4_K_M | 12.2553 | 2.747% | 2875 |
| Q3_K_M | 13.7688 | 15.436% | 2475 |

## KV cache precision (same Q4_K_M weights, 1024 ctx)

| KV | PPL | Δ vs f16 | VRAM peak MiB |
|---|---:|---:|---:|
| f16 | 9.032 | 0.0% | 2957 |
| q8_0 | 9.0004 | -0.35% | 2897 |
| q4_0 | 9.2128 | 2.002% | 2861 |

## Interpretation rules

- A perplexity difference below ~0.5% is not distinguishable from corpus/sampling noise at this chunk count.
- The Q4_K_M row is the official quant already present in the repository; the Q6/Q5/Q3 rows were generated locally from Q8_0 with `llama-quantize`. This is stated because the provenance differs.
- KV cache quality is measured with the same weights (Q4_K_M) and a 1024-token context, against the f16 KV row at the same context. Longer contexts can amplify KV quantization error.
- Perplexity is a screening test. It does not replace the project's coding/web-app/instruction suites, which are tracked separately.
