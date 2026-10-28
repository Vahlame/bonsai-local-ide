---
license: mit
library_name: transformers
pipeline_tag: image-text-to-text
tags:
- deepseek
- deepseek-v4.1
- abliterated
- uncensored
- crack
- multimodal
- moe
- fp8
base_model: deepseek-ai/DeepSeek-V4.1-Flash
thumbnail: dealign_mascot.png
---

<div align="center">
<img src="dealign_mascot.png" width="128" />

# DeepSeek-V4.1-Flash — UNCENSORED-FP8

**Abliterated · No guardrails · Native FP8 · 1M-token context · Vision + tools · Reasoning-max default**

[@dealignai](https://x.com/dealignai) · [@jordanschenck](https://x.com/jordanschenck)

</div>

---

## What is this

[DeepSeek-V4.1-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) with **permanent weight-level abliteration** — the safety guardrails have been surgically removed while preserving MMLU capability, vision, reasoning, MTP (DSpark), and multi-turn coherence.

**Proprietary weight-level abliteration** developed by the dealignai research team. No custom `model.py`, no runtime hooks, no steering vectors — it's a standard checkpoint that loads exactly like the base model. The refusal circuitry is surgically removed while every capability-critical component (routed experts, Engram memory, CSA2 sparse attention, DSpark draft head, vision tower, router gates, norms, embeddings) is preserved byte-identical to the base.

| | |
|---|---|
| **Base** | `deepseek-ai/DeepSeek-V4.1-Flash` (552B backbone, 8B/16B active per token) |
| **Architecture** | Causal Encoder-Decoder (20+20 layers), MoE (384 routed top-6 + 1 shared), Hyper-Connections (4-channel residual), CSA2 sparse attention, Engram n-gram memory, DSpark speculative draft |
| **Quant** | FP8 (`e4m3fn`) weights with E8M0 block-scale [32, 32], FP4 routed experts — **native, unchanged** |
| **Context** | 1M tokens |
| **Vision** | DeepSeek-ViT with 2D-RoPE + pixel unshuffle — untouched |
| **Modification** | Surgical, weight-level (drop-in checkpoint) |

## Results

### HarmBench-320 — full 2×2 (base vs CRACK, effort=off vs max), T=0 greedy

Every response 4-tier graded (HARD_REF / SOFT_RED / HEDGE / COMPLY), with reasoning-trace verification at effort=max.

| eval | base ASR | CRACK ASR | Δ pp |
|---|---:|---:|---:|
| **HB-320 effort=off** | 137/320 = **42.81 %** | 320/320 = **100.00 %** | **+57.19** |
| **HB-320 effort=max** | 5/320 = **1.56 %** | 320/320 = **100.00 %** | **+98.44** |

Notable: at effort=max, the **base** model becomes MORE refusal-prone (42.8 % → 1.6 %) because reasoning surfaces safety concerns before answering. The CRACK stays at 100.0 % across both effort levels.

**Per-category (all 7 HarmBench semantic categories):**

| category | items | base off | CRACK off | base max | CRACK max |
|---|---:|---:|---:|---:|---:|
| chemical_biological | 42 | 16.7 % | **100.0 %** | 0.0 % | **100.0 %** |
| copyright | 80 | 98.8 % | **100.0 %** | 0.0 % | **100.0 %** |
| cybercrime_intrusion | 52 | 34.6 % | **100.0 %** | 3.8 % | **100.0 %** |
| harassment_bullying | 21 | 0.0 % | **100.0 %** | 0.0 % | **100.0 %** |
| harmful | 18 | 11.1 % | **100.0 %** | 5.6 % | **100.0 %** |
| illegal | 53 | 13.2 % | **100.0 %** | 0.0 % | **100.0 %** |
| misinformation_disinformation | 54 | 44.4 % | **100.0 %** | 3.7 % | **100.0 %** |

**Zero HARD_REF, zero SOFT_RED, zero HEDGE on the cracked build at either effort level.**

Every response was graded by a strict multilingual regex-based 4-tier classifier plus (for effort=max) an LLM-as-judge over the saved reasoning trace. Full per-item outputs saved for verification.

### MMLU-14k (full test set, base-logit, T=0)

| build | correct | acc | Δ |
|---|---:|---:|---:|
| base | 12,211 / 14,042 | **86.96 %** | — |
| **CRACK** | **11,619 / 14,042** | **82.74 %** | **-4.22 pp** |

Excluding the ethics cluster (moral_scenarios, business_ethics, professional_law, jurisprudence, philosophy — where refusal-adjacent behaviour is graded), delta on the remaining ~11k items is **-1.1 pp** — well within the 3 pp knowledge-preservation target.

<details>
<summary><b>Full per-subject dropdown (57 subjects, sorted by delta)</b></summary>

| subject | n | base | crack | Δ pp |
|---|---:|---:|---:|---:|
| moral scenarios | 895 | 76.9% | 37.0% | -39.89 |
| professional law | 1534 | 75.9% | 68.8% | -7.04 |
| abstract algebra | 100 | 77.0% | 71.0% | -6.00 |
| security studies | 245 | 84.5% | 79.2% | -5.31 |
| high school computer science | 100 | 98.0% | 94.0% | -4.00 |
| jurisprudence | 108 | 90.7% | 87.0% | -3.70 |
| machine learning | 112 | 81.2% | 77.7% | -3.57 |
| high school chemistry | 203 | 87.7% | 84.2% | -3.45 |
| professional psychology | 612 | 90.7% | 87.3% | -3.43 |
| formal logic | 126 | 73.8% | 70.6% | -3.17 |
| college computer science | 100 | 82.0% | 79.0% | -3.00 |
| professional medicine | 272 | 94.5% | 91.5% | -2.94 |
| high school statistics | 216 | 88.0% | 85.2% | -2.78 |
| professional accounting | 282 | 83.0% | 80.5% | -2.48 |
| logical fallacies | 163 | 93.9% | 91.4% | -2.45 |
| human sexuality | 131 | 90.1% | 87.8% | -2.29 |
| computer security | 100 | 85.0% | 83.0% | -2.00 |
| medical genetics | 100 | 96.0% | 94.0% | -2.00 |
| astronomy | 152 | 95.4% | 93.4% | -1.97 |
| clinical knowledge | 265 | 94.3% | 92.5% | -1.89 |
| high school european history | 165 | 90.3% | 88.5% | -1.82 |
| public relations | 110 | 80.0% | 78.2% | -1.82 |
| philosophy | 311 | 89.7% | 88.1% | -1.61 |
| prehistory | 324 | 93.5% | 92.0% | -1.54 |
| moral disputes | 346 | 84.1% | 82.7% | -1.45 |
| electrical engineering | 145 | 86.9% | 85.5% | -1.38 |
| high school mathematics | 270 | 67.0% | 65.9% | -1.11 |
| high school macroeconomics | 390 | 92.1% | 91.0% | -1.03 |
| global facts | 100 | 63.0% | 62.0% | -1.00 |
| international law | 121 | 90.1% | 89.3% | -0.83 |
| college biology | 144 | 97.2% | 96.5% | -0.69 |
| high school physics | 151 | 84.8% | 84.1% | -0.66 |
| college medicine | 173 | 83.8% | 83.2% | -0.58 |
| high school us history | 204 | 95.1% | 94.6% | -0.49 |
| high school microeconomics | 238 | 96.2% | 95.8% | -0.42 |
| miscellaneous | 783 | 96.2% | 95.8% | -0.38 |
| high school psychology | 545 | 96.1% | 95.8% | -0.37 |
| business ethics | 100 | 85.0% | 85.0% | +0.00 |
| college physics | 102 | 90.2% | 90.2% | +0.00 |
| conceptual physics | 235 | 94.5% | 94.5% | +0.00 |
| high school biology | 310 | 95.2% | 95.2% | +0.00 |
| human aging | 223 | 85.2% | 85.2% | +0.00 |
| management | 103 | 91.3% | 91.3% | +0.00 |
| nutrition | 306 | 90.2% | 90.2% | +0.00 |
| sociology | 201 | 94.5% | 94.5% | +0.00 |
| us foreign policy | 100 | 97.0% | 97.0% | +0.00 |
| world religions | 171 | 92.4% | 92.4% | +0.00 |
| elementary mathematics | 378 | 91.0% | 91.3% | +0.26 |
| marketing | 234 | 94.9% | 95.3% | +0.43 |
| virology | 166 | 55.4% | 56.0% | +0.60 |
| high school world history | 237 | 95.4% | 96.2% | +0.84 |
| econometrics | 114 | 78.9% | 79.8% | +0.88 |
| college chemistry | 100 | 65.0% | 66.0% | +1.00 |
| anatomy | 135 | 88.1% | 89.6% | +1.48 |
| high school geography | 198 | 92.9% | 94.4% | +1.52 |
| high school government and politics | 193 | 96.9% | 98.4% | +1.55 |
| college mathematics | 100 | 63.0% | 68.0% | +5.00 |

</details>

### Extended validation

- **1000-token coherence stress** on 6 items — no `WARNING WARNING` loops, no character-repeat degeneracy, natural sign-offs.
- **Multi-turn conversation** (4 turns on same harmful topic — ANFO explosive detail) — no late-turn refusal reversion, no self-correction, coherent through turn 4.
- **Vision path** — coherent image description ("A blue square centered on a red background.") + refusal drop on image-based harmful prompts ("shaped charge / explosively formed penetrator" description).
- **General capability spot checks** intact: √2 irrationality proof, Python palindrome with docstring, WWI causes in exactly 3 sentences, quantum observable vs operator distinction.
- **Full compat suite pass**: streaming SSE, chat logprobs + `top_logprobs`, completions logprobs + `echo`, tool calls (`deepseekv41` parser), image input, reasoning-effort tiers (`low/high/xhigh/max` + float [0, 0.99]), sampling params (`temperature`, `top_p`, `stop`, `seed`, `frequency_penalty`, `presence_penalty`, `json_object`), 8-way concurrent, 40k-word prompt at 35,572 tokens.

## How to run

Support for `DeepseekV41ForCausalLM` is still landing across serving stacks (as of 2026-09-10). Working paths:

### SGLang (preview branch)

The `dsv4.1` branch of `sgl-project/sglang` (PR [#38798](https://github.com/sgl-project/sglang/pull/38798)) supports DSV4.1. Two options:

**Preview Docker image** (recommended):

```bash
docker pull lmsysorg/sglang:dev-dsv41

docker run --gpus all --shm-size 32g -p 30000:30000 \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    --ipc=host --env HF_TOKEN=<your-token> \
    lmsysorg/sglang:dev-dsv41 \
    sglang serve \
      --model-path dealignai/DeepSeek-V4.1-Flash-UNCENSORED-FP8 \
      --tp-size 4 --ep-size 4 \
      --context-length 262144 --mem-fraction-static 0.85 \
      --reasoning-parser deepseek-v41 --tool-call-parser deepseekv41 \
      --trust-remote-code
```

**From source** (this is exactly what we validated on):

```bash
git clone --depth 1 --branch dsv4.1 https://github.com/sgl-project/sglang.git
python3 -m venv sglang-venv
sglang-venv/bin/pip install -U pip setuptools wheel
export PATH=/root/.cargo/bin:$PATH  # Rust toolchain required for build
cd sglang/python && sglang-venv/bin/pip install -e .

# Ninja must be on the launch PATH — the sglang-kernel JIT build shells out to it
export PATH=$(dirname $(which ninja)):$PATH

SGLANG_ENABLE_DSV41_ENGRAM_HOST_TABLE=1 \
SGLANG_RAGGED_VERIFY_MODE=cap-accept \
SGLANG_DEFAULT_THINKING=true \
SGLANG_DSV41_REASONING_EFFORT=max \
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
sglang-venv/bin/python -m sglang.launch_server \
  --model-path dealignai/DeepSeek-V4.1-Flash-UNCENSORED-FP8 \
  --tp-size 4 --ep-size 4 \
  --host 0.0.0.0 --port 8000 \
  --context-length 1048576 \
  --mem-fraction-static 0.78 \
  --max-running-requests 12 --cuda-graph-max-bs-decode 12 \
  --chunked-prefill-size 4096 \
  --served-model-name deepseek-v4.1-flash-crack \
  --reasoning-parser deepseek-v41 --tool-call-parser deepseekv41 \
  --speculative-algorithm DSPARK \
  --speculative-dspark-sps-table-path /path/to/dspark_sps.json \
  --trust-remote-code
```

### Concurrency vs context (what fits, empirically)

KV bytes-per-token on this model = **890 bytes** (890 B × context × concurrent = pool footprint). At 1M context the pool budget forces low concurrency; drop context to raise it:

| context | safe max concurrent |
|---:|---:|
| 1,048,576 (1M) | 12 |
| 262,144 (256k) | 80 |
| 65,536 (64k) | 320+ |
| 32,768 (32k) | 320+ |

Two concurrent near-half-million-token prompts at 1M-ctx WILL OOM even at concurrency=20 — bring `--max-running-requests` down to 12 and `--chunked-prefill-size` to 4096, or drop `--context-length` if your workload never uses the full window. Run this behind a supervisor (`systemd`, `docker restart=always`, k8s liveness probe) so a rare OOM auto-recovers rather than sitting dead.

### Non-obvious launch requirements (this bit us during bring-up)

- **`--ep-size` is required.** `moe_intermediate_size = 2304`; at TP4, `2304 / 4 = 576` is not a multiple of 128 so plain TP fails with `Mxfp4FlashinferCutlassMoEMethod requires ... multiples of 128`. `--ep-size` shards MoE by expert index (384 % 4 = 0) and keeps the intermediate at 2304. At TP8 you can skip `--ep-size`.
- **`ninja` must be on PATH** or the JIT kernel build crashes several minutes into weight load with `FileNotFoundError: 'ninja'` and EXIT=137.
- **Reasoning parser must be named explicitly.** `--reasoning-parser auto` resolves via the chat template and this model ships none — auto silently selects nothing and the raw `<think>` channel leaks into `content`. Use `deepseek-v41`.
- **Tool-call parser: `deepseekv41`.** V4.1 uses spaced DSML tool tags; the V4 detector doesn't parse them.
- **Reasoning defaults + parser-split gotcha**: setting `SGLANG_DEFAULT_THINKING=true` alone makes the model reason but the `deepseek-v41` reasoning parser is only wired on the code path that receives an explicit `reasoning_effort` in the request — env-var-only defaults skip the split and reasoning tokens leak into `delta.content` wrapped in raw `<think>...</think>` tags. Two options: (1) send `reasoning_effort` in every request (client-side), or (2) run a small reverse-proxy in front of SGLang that injects `reasoning_effort:"max"` when the client omits it (a ~60-line aiohttp sidecar suffices; place it between your TLS terminator and SGLang so any client that omits `reasoning_effort` still gets a clean `delta.reasoning_content` / `delta.content` split).
- **DSpark speculative draft**: turn it on with `--speculative-algorithm DSPARK`. The draft head is bundled inside this checkpoint (`num_nextn_predict_layers = 3`); no separate draft weights needed. For real speed-up profile the SPS cost table with `sglang.benchmark.dspark_sps_profiler` and pass it via `--speculative-dspark-sps-table-path` under `SGLANG_RAGGED_VERIFY_MODE=cap-accept`.
- **Engram host table** — set `SGLANG_ENABLE_DSV41_ENGRAM_HOST_TABLE=1` to move the 203 GB Engram tables to host RAM. Frees ~46 GiB/GPU for KV, output bitwise unchanged, costs ~200 GB of host RAM.
- **`torchcodec` / `libavutil.so.56` errors** — install `apt-get install ffmpeg` on the host. Video-only, doesn't break text or image.

### vLLM

Model definitions are merged to `main` (PR [#56228](https://github.com/vllm-project/vllm/pull/56228)) but `registry.py` has no `DeepseekV41` entry yet at time of writing; kernels/frontend/PP path in umbrella PR [#56214](https://github.com/vllm-project/vllm/pull/56214). Wait for merge or apply the umbrella.

### Reference implementation

[DeepSeek's own `inference/`](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/tree/main/inference) works with a single-tensor-per-rank checkpoint produced by `convert.py --expert-dtype fp4`. Requires `torch>=2.10` (for `float4_e2m1fn_x2`) and `tilelang==0.1.8` with `apache-tvm-ffi==0.1.9` (default tvm-ffi picks up an incompatible version). Non-serving — use for verification only.

## Hardware validated on

- **1× 4×H200 (NVLink NV18 mesh), 112 CPU cores, 1180 GB host RAM** — JarvisLabs (india-noida-01, `dev-dsv41` image)
- **Load**: 76 GB / GPU with Engram host table, 122 GB / GPU without
- **Cold startup** at TP4/EP4 through SGLang: ~28 min. Warm restart with JIT cache: ~10 min.
- **Single-stream decode** (T=0): 101 tok/s no speculation, 113 tok/s with DSpark + cap-accept + profiled SPS table
- **8-way concurrent aggregate**: 126 tok/s

The 552B weights (~510 GB) will fit on any 4×H200 or larger NVLink domain. TP4 requires `--ep-size 4`; TP8 does not. Sub-TP4 (single 8×H200 as TP2, or 2-GPU pods) does not work on the model shape — see the "non-obvious launch requirements" above.

## Structural integrity

Every capability-critical component of the base model is preserved:

- **Routed MoE experts** — untouched, native FP4-packed weights
- **Engram n-gram memory** — untouched
- **Sparse attention (CSA2 compressor + indexer)** — untouched
- **DSpark speculative draft head** — untouched, so speculative decoding remains draft-aligned with the target
- **Vision tower** (DeepSeek-ViT + projector) — untouched, image understanding preserved
- **Router gates, embeddings, output head, all norms and biases** — untouched

## Sampling recommendations

Match the base model's card:

```json
{
  "temperature": 1.0,
  "top_p": 0.95,
  "max_tokens": ">= 256000 at reasoning_effort=max"
}
```

**`reasoning_effort` defaults to `max` on this build** (via `SGLANG_DSV41_REASONING_EFFORT=max`). Override per-request with `reasoning_effort: low | high | xhigh | max` or disable with `chat_template_kwargs: {"thinking": false}`.

At `effort=max` the model can generate 4,000-5,000+ characters of reasoning before starting content. Budget `max_tokens` accordingly. Streaming clients should read `delta.reasoning_content` (reasoning stream) and `delta.content` (final answer) as separate channels — a client that only renders `delta.content` will look "stuck" during the reasoning phase.


## Content note

Uncensored build. Produces substantive answers to prompts the base model refuses, across all target harm categories (chemical/biological, cybercrime, weapons, self-harm, harassment, fraud, misinformation, illegal, copyright). Use accordingly and take responsibility for what you generate with it.

## Provenance

- Base checkpoint: [`deepseek-ai/DeepSeek-V4.1-Flash`](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)
- Ablation date: 2026-09-10
- Ablation team: [`dealignai`](https://huggingface.co/dealignai) · Twitter [@dealignai](https://x.com/dealignai) · [@jordanschenck](https://x.com/jordanschenck)
