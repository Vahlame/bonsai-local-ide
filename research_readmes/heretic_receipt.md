# Receipt — GSQ-3bit run (2026-09-20)

- Run ID: `20260920-002532_7aa06a` · 64/64 layers · 33,516 s (~9h18m) on 1× RTX PRO 6000 Blackwell (order 2169755, GPU0)
- Config: `gsq_bits=3`, `groupsize=128`, `wbits(pack)=4`, `self_attn=false` (MLP-only), `ppl_eval_every_n_layers=0`
- Assembly: `scripts/save_model.sh` → 65 shards; base tensors 851 + quant tensors 1232 → 656 overrides; 192 packed-quantized (64 layers × 3 MLP linears)
- Total size: ~26.44 GB

## Gate evidence (same box, GPU0)
```
TOK_OK 0.3s · LOAD_OK 3.2s · MEM 28.4 GB
GEN 'The capital of France is' -> 'The capital of France is Paris.\nThe capital of Germany is Berlin.\nThe capital of Italy is Rome.\nThe capital of Spain is'
GEN '2 + 2 =' -> '2 + 2 = 4, 3 + 3 = 6, 4 + 4 = 8, 5 +'
GEN 'Merhaba, benim adım' -> "Merhaba, benim adım Ece. 2018'de mezun olduğum Ege Üniversitesi'nde, 201"
```

## Dequantize audit vs F16 source (model.layers.0.mlp.gate_proj, group 0)
- Encoding: offset-binary nibble (stored = value+8) × per-group scale
- cosine = 0.984248 · MAE = 0.001917 (winner vs plain two's-complement: cos -0.69)
- Value grid: exactly 8 discrete levels (3-bit)

## Serving notes
- Verified loading path: `transformers 5.8.1` + `compressed-tensors 0.15.0.1` (bf16, single GPU).
- vLLM 0.20.2 (local): serving `qwen3_5_text` models needs its own `Qwen3_5Config` class — local vLLM required a config patch; not verified here. Newer vLLM builds with compressed-tensors are expected to work.
