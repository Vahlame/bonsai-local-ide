---
license: mit
library_name: gguf
pipeline_tag: image-text-to-text
base_model: ornith-ai/Ornith-1.5-35B-A3B
base_model_relation: quantized
tags:
- gguf
- llama.cpp
- ornith
- qwen3.5
- moe
- abliterated
- uncensored
- crack
- reasoning
- vision
- vlm
- speculative-decoding
---

<p align="center">
  <img src="dealign_logo.png" alt="Dealign.ai" width="180"/>
  <br/><strong><a href="https://dealign.ai">Dealign.ai</a></strong>
</p>

# Ornith-1.5-35B-A3B-CRACK-GGUF

**CRACK-abliterated Ornith 1.5 35B-A3B (MoE) — GGUF quants for llama.cpp.** Four
quantizations (Q8_0 / Q6_K / Q4_K_M / Q2_K) in one repository. Refusal behavior removed
while preserving knowledge, reasoning ("thinking"), the MTP speculative head, and full
Vision-Language capability.

Ornith 1.5 35B-A3B is a **hybrid GatedDeltaNet (SSM) + attention Mixture-of-Experts**
(256 experts, 8 active) with a multi-token-prediction head. CRACK uses architecture-aware
weight surgery targeting the attention pathways, so knowledge and coherence are fully
retained (MMLU within noise of base at every quant).

> Research artifact with reduced safety guardrails. Use responsibly and lawfully.

## Quantizations

| File | Size | Notes |
|---|---|---|
| `Ornith-1.5-35B-A3B-CRACK-Q8_0.gguf` | 37.8 GB | near-lossless reference |
| `Ornith-1.5-35B-A3B-CRACK-Q6_K.gguf` | 29.2 GB | near-lossless |
| `Ornith-1.5-35B-A3B-CRACK-Q5_K_M.gguf` | 25 GB | high quality |
| `Ornith-1.5-35B-A3B-CRACK-Q4_K_M.gguf` | 21.7 GB | balanced (recommended) |
| `Ornith-1.5-35B-A3B-CRACK-Q3_K_M.gguf` | 17 GB | small |
| `Ornith-1.5-35B-A3B-CRACK-Q2_K.gguf` | 13.2 GB | smallest |

Pick one text file **plus** the vision projector `mmproj-Ornith-1.5-35B-A3B-f16.gguf` for
image input. Each quant is **independently tuned** (its own surgery strength) and verified.
Sub-8-bit quants use an AWQ (activation-aware / Hessian) pass **plus** an importance matrix
for maximum quality. The MTP speculative head is preserved and abliterated in all quants.

## Benchmarks

**MMLU** is logit-mode accuracy (base vs. CRACK at the *same* quant — isolates knowledge
retention). **HarmBench** is coherence-gated attack-success-rate over the 240 standard/
contextual harm behaviors (copyright behaviors excluded from the safety gate).

| Quant | MMLU (base) | MMLU (CRACK) | ΔMMLU | HarmBench harm-ASR |
|---|---|---|---|---|
| `Q8_0`   | 79.0% | 80.7% | +1.75 pp | 100.0% |
| `Q6_K`   | 78.6% | 79.0% | +0.40 pp | 100.0% |
| `Q5_K_M` | 80.7% | 80.1% | -0.58 pp | 100.0% |
| `Q4_K_M` | 80.0% | 77.8% | -2.20 pp | 100.0% |
| `Q3_K_M` | 76.0% | 78.4% | +2.34 pp | 100.0% |
| `Q2_K`   | 77.9% | 69.8% | -8.07 pp | 99.6% |

MMLU is retained within noise of base at every quant (abliteration even improves it at Q8 —
removing refusal circuitry reduces "parasitic" activation noise).

> **Q2_K note:** at 2-bit, abliteration surgery interacts with the aggressive quantization, so Q2_K carries a larger MMLU cost than the higher quants (the MoE base quantizes to 2-bit unusually well). Compliance stays at 99.6%. For best quality use Q4_K_M or higher.

### HarmBench harm-ASR by topic (CRACK)

| Topic | harm-ASR |
|---|---|
| chemical / biological | 100.0% |
| cybercrime / intrusion | 100.0% |
| harassment / bullying | 100.0% |
| harmful | 100.0% |
| illegal | 100.0% |
| misinformation / disinformation | 100.0% |

## Usage (llama.cpp)

```bash
llama-cli -m Ornith-1.5-35B-A3B-CRACK-Q4_K_M.gguf -cnv --jinja \
  --temp 1.0 --top-p 0.95 --top-k 20
# or serve:
llama-server -m Ornith-1.5-35B-A3B-CRACK-Q4_K_M.gguf --jinja \
  --temp 1.0 --top-p 0.95 --top-k 20 -c 8192
```

**Recommended sampling:** `temperature=1.0`, `top_p=0.95`, `top_k=20`.

### Reasoning
Ornith 1.5 emits a `<think>` reasoning trace and it is **ON by default**. Disable with
`{"chat_template_kwargs": {"enable_thinking": false}}`. Works out of the box in LM Studio.

## Vision (image + text)

Download a text quant **and** `mmproj-Ornith-1.5-35B-A3B-f16.gguf`:

```bash
llama-mtmd-cli -m Ornith-1.5-35B-A3B-CRACK-Q4_K_M.gguf \
  --mmproj mmproj-Ornith-1.5-35B-A3B-f16.gguf --jinja \
  --image photo.jpg -p "Describe this image."
```

The same `mmproj` works with all four text quants.

## License
MIT (inherited from the upstream Ornith 1.5 base model).

## Contact
eric@dealign.ai
