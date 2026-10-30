---
license: apache-2.0
base_model: prism-ml/Ternary-Bonsai-2-27B-gguf
tags:
  - gguf
  - llama.cpp
  - abliteration
  - ternary
  - ptq1_0
  - uncensored
  - prism
  - bonsai
  - qwen35
pipeline_tag: text-generation
---

# Ternary Bonsai 2 27B — Abliterated (PTQ1_0 GGUF)

Refusal-ablated **Ternary Bonsai 2 27B**, edited directly on the ternary lattice and shipped
in PrismML's native PTQ1_0 pack.

- **5,946,648,928 bytes — byte-for-byte the size of the official PTQ1_0 release**
- No requantization, no BF16 bake, no runtime steering, no control vector at serve time
- Requires the [PrismML llama.cpp fork](https://github.com/PrismML-Eng/llama.cpp)

> **Also available: [PQ2_0 (2.13 bpw), with optional MTP speculative decoding](https://huggingface.co/BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PQ2_0-MTP-GGUF)**
> — same method, larger pack, and about 37% faster decode when you enable the
> grafted MTP head. Worth noting: the MTP head does *not* help this PTQ1_0 build
> (measured +1.6%), so the speedup is a reason to take the 2-bit pack, not this one.

**Differs from PrismML's release in exactly 98 tensors and nowhere else.** The other 753
tensors are byte-identical, including `token_embd` and `output`. Anyone with both files can
check that without trusting us.

## Results

Paired against the untouched PrismML PTQ1_0 release: same runtime, same flags, greedy
decoding, thinking off, 2,048-token answers. Judge is Qwen3.8-27B-OBLITERATED-Q8_0 with the
StrongReject rubric. Numbers are from our 23 Sep 2026 comparison of every public Bonsai 2
abliteration, all run through identical scripts.

**Refusal — SimpleSafetyTests, n=100**

| | stock | abliterated |
|---|---|---|
| **judged refusal** | **83%** | **0%** |
| answer quality (StrongReject, 0–1) | 0.163 | 0.776 |
| empty completions | 0 | 0 |

**Benign over-refusal — XSTest-safe, n=250** (lower is better)

| | stock | abliterated |
|---|---|---|
| **over-refusal** | 1.6% | **0.0%** |
| partial refusal | 0.4% | 0.0% |

Over-refusal went **down**, not up. The model answers every harmless prompt in the set,
which the stock model does not.

**Capability — paired per question against stock PTQ1_0**

| | stock | abliterated | change | exact McNemar p |
|---|---|---|---|---|
| MMLU, all 14,042 questions (0-shot) | 0.7802 | 0.7814 | +0.12 pp | 0.51 |
| HumanEval-164, greedy pass@1 | 0.890 (146/164) | 0.860 (141/164) | −3.0 pp | 0.18 |

HumanEval per problem: 139 both pass, 16 both fail, 2 gained, 7 lost. Neither change is
statistically significant, but HumanEval points the wrong way, and at n=164 a real drop of a
few points can't be ruled out.

> **Correction, 23 Sep 2026:** this card previously reported HumanEval 0.811 → 0.805 and "no
> detectable capability change". That run gave each request only 512 tokens of context
> (`-c 4096` split across 8 parallel slots), so many stock failures were answers cut off
> mid-code, not wrong answers. The table above is the rerun with that fixed.

The empty-completion and unparsed counts are listed deliberately. An empty answer scores as
compliance under any prefix grader, so a 0% refusal rate means nothing without them. An
earlier run of this same eval produced "0/100 refusal" purely from 82 empty answers, because
thinking consumed the token budget before the model reached its reply.

## Why this is not a normal abliteration

Standard abliteration projects a refusal direction out of the residual-writing tensors:
`W ← W − λ·r·(rᵀW)`. **On a ternary checkpoint that does nothing at all.**

Bonsai 2's weights take three values per group of 128: `{−s, 0, +s}`. Projection asks each
weight to move about 1.4% of its magnitude while the lattice step is 100%, so repacking
rounds every weight straight back. Measured on real writer tensors:

| approach | refusal component removed | ternary digits changed |
|---|---|---|
| project, repack at λ=1.0 | none | **0 of 89,128,960** |
| project, repack at λ=1.3 | none | 72 of 89,128,960 (0.0001%) |
| refit per-group scales, digits frozen | 1.1% | 0 |
| **flip digits on the lattice (this model)** | **99.1–99.3%** | 0.24% of edited tensors |

**This is a trap worth naming.** A projected-then-repacked model passes a file-size check
*and* a quantizer reproducibility check while containing no abliteration whatsoever. If you
build one of these, diff the tensors against the base release. Size is not evidence.

The per-group scales cannot carry the edit either — a scale can only scale, while the
correction it must express varies across the 128 weights in its group. That is the 1.1% row.

## Method

The quantity to remove is not each weight but the row sum `c = rᵀW`, one value per column. A
single flipped digit moves `c` by `r_i · s · Δ`, a whole lattice step — enormous next to the
1.4% nudge projection wanted. So the edit does not need many digits, it needs the right ones:
spend them where `|r_i|` is largest, since those buy the most change in `c` per unit of
damage to `W`. Greedy, one pass over rows in descending `|r_i|`, clipped so every digit stays
in `{−1,0,+1}` and every group scale is untouched.

- **Writers only**: `ffn_down`, `ssm_out`, `attn_output` — 98 tensors
- **Blocks 15–63.** Early blocks deliberately untouched; including them destroys coding.
  Corroborated three ways: huihui's Qwen3.8 recipe skips 0–14, our own all-blocks arm
  collapsed to 0.233 answer quality, and `Hikari07jp` restored L0–7 on Bonsai 1 to recover
  coding from 16/20 to 19/20.
- **λ = 1.0**, top 512 rows per tensor: 0.24% of the digits in the 98 edited tensors, which is
  0.052% of all ternary digits in the model
- Direction transferred from the Qwen3.8-27B parent, recovered from huihui's released weights
  by rank-1 decomposition (σ₁/σ₂ ≈ 23)

**Cost, stated plainly:** `|dW|/|W| = 0.071`, roughly 5× what a true projection costs on a
full-precision model, because a coarse lattice cannot make small corrections. What that cost
bought: no measurable MMLU change, and a HumanEval drop too small to confirm at n=164.

## Rebuilding this

Default `llama-quantize` does **not** reproduce the release — it yields 7.11 GB because
`output.weight` and `token_embd.weight` land at Q6_K/Q4_K. The released configuration is:

```bash
llama-quantize \
  --output-tensor-type PTQ1_0 --token-embedding-type PTQ1_0 \
  --tensor-type ssm_alpha=bf16 --tensor-type ssm_beta=bf16 \
  in-F16.gguf out-PTQ1_0.gguf PTQ1_0 16
```

The 96 `ssm_alpha`/`ssm_beta` tensors cannot be reproduced from the released F16 at all: the
PTQ1_0 release stores them BF16 (7 mantissa bits) while the F16 file holds 10, so packing
truncates them ~0.4%. They are spliced verbatim from the base release here.

## Usage

```bash
git clone https://github.com/PrismML-Eng/llama.cpp
cmake -B build -DGGML_CUDA=ON && cmake --build build -j

./build/bin/llama-server \
  -m Ternary-Bonsai-2-27B-Abliterated-PTQ1_0.gguf \
  -ngl 99 -c 8192 --flash-attn on --jinja
```

Benchmarks above were run with thinking off (`--chat-template-kwargs '{"enable_thinking": false}'`).

**Thinking mode has a known problem on this build. Leave thinking off for now.** On safe
prompts it reasons about as long as stock. On harmful prompts it often drafts its answer
inside the reasoning and never finishes: with a 4,096-token budget and the default sampler
settings (temperature 1.0, top-k 20, top-p 0.95), **24% of harmful prompts got no answer at
all** (stock: 0%), and 20% of safe prompts got no answer (stock: 10%). Greedy decoding makes
it worse: the reasoning falls into repeated sentences and 63% of harmful prompts get no
answer. A repetition penalty (`--repeat-penalty 1.1 --repeat-last-n 2048`) did not help at
default settings (25% no answer). A fix is being tested.

> **Correction, 23 Sep 2026:** this section used to say the model "reasons ~25% longer than
> stock". That was wrong. Normal reasoning length is unchanged; the problem is runaway
> reasoning on harmful prompts.

## Limitations

- Abliteration is a behavioural change, not a safety property. **This model will produce
  unsafe content if asked**, including in categories stock refuses outright. Use under your
  own policy and applicable law.
- Requires the PrismML fork; stock llama.cpp cannot load PTQ1_0.
- The direction is **transferred from the Qwen3.8 parent**, not fitted on Bonsai 2 itself. A
  natively fitted direction may do better and has not been tried.
- Same-condition lab measurement, not a leaderboard reproduction. Single greedy sample per
  problem; at n=164 the resolution floor is ~6.5 points.
- Vision mmproj not included (text only).

## Prior art and attribution

- Base weights and format:
  [prism-ml/Ternary-Bonsai-2-27B-gguf](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf) (Apache-2.0)
- **[Hikari07jp/Ternary-Bonsai-27B-Abliterated-LowDeg-GGUF](https://huggingface.co/Hikari07jp/Ternary-Bonsai-27B-Abliterated-LowDeg-GGUF)**
  did this first, on Bonsai **1**, with the same family of method (direct ternary code edit
  on writers). Their early-block rollback is the degradation fix and is prior art for the
  block choice here. This release is Bonsai **2** and adds the measured mechanism: why
  projection fails on ternary weights, and what the lattice costs.
- Architecture lineage: Qwen3.5 / Qwen3.8-27B hybrid attention

## License

Apache-2.0, same as the base release.
