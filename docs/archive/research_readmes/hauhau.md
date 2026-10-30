---
license: apache-2.0
tags:
  - uncensored
  - qwen3.8
  - gguf
  - multimodal
  - vision
  - mtp
  - speculative-decoding
  - fastmtp
language:
  - en
  - zh
  - multilingual
pipeline_tag: image-text-to-text
base_model: Qwen/Qwen3.8-27B
---

# Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP

> **HauhauCS FastMTP: up to 3.02x document TG and 1.93x reasoning TG versus non-MTP — plus up to 35.2% more document TG and 21.1% more reasoning TG than standard embedded MTP.**

> **[Join the Discord](https://discord.gg/SZ5vacTXYf)** for updates, roadmaps, projects, or just to chat.

Qwen3.8-27B uncensored by HauhauCS **0/465 Refusals*** . 

This is the **Aggressive variant**: direct answers, no refusal behavior, and minimal preamble on hard prompts.

**Every text GGUF preserves Qwen3.8's native NextN head, and this release adds HauhauCS FastMTP: a specific acceleration sidecar qualified across the complete quant lineup at maximum native context.** Vision is included through the separate BF16 projector.

> **Hugging Face's Hardware Compatibility widget may not recognize K_P quants.** If files appear to be missing, click **View variants** or open **Files and versions**.

## About

No changes to datasets or intended capabilities. This release preserves Qwen3.8-27B's text, reasoning, agentic, image, and video capabilities while applying the HauhauCS Aggressive uncensoring profile.

Pick Aggressive when you specifically want the model to get to the answer without first talking itself into compliance. For reliability-critical, specifically long-context agentic work, a Balanced release is normally the safer default when/if one is available.

## Downloads

| File | Quant | BPW | Size |
|---|---:|---:|---:|
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf) | Q8_K_P | 9.21 | 31.46 GB |
| — | Q8_0 | 8.50 | — |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q6_K_P.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q6_K_P.gguf) | Q6_K_P | 7.59 | 25.92 GB |
| — | Q6_K | 6.60 | — |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q5_K_P.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q5_K_P.gguf) | Q5_K_P | 5.92 | 20.22 GB |
| — | Q5_K_M | 5.70 | — |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf) | Q4_K_P | 5.25 | 17.92 GB |
| — | Q4_K_M | 4.88 | — |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf) | IQ4_XS | 4.60 | 15.71 GB |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q3_K_P.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q3_K_P.gguf) | Q3_K_P | 3.93 | 13.44 GB |
| — | Q3_K_M | 3.90 | — |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ3_M.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ3_M.gguf) | IQ3_M | 3.74 | 12.79 GB |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ3_XS.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ3_XS.gguf) | IQ3_XS | 3.56 | 12.18 GB |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q2_K_P.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q2_K_P.gguf) | Q2_K_P | 3.12 | 10.68 GB |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf) | IQ2_M | 3.02 | 10.32 GB |
| [mmproj-Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-BF16.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/mmproj-Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-BF16.gguf) | Vision projector | — | 931 MB |
| [Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf) | HauhauCS FastMTP | — | 903 MB |

BPW is the encoded tensor-payload average across the complete text model, including its embedded MTP tensors, rounded to two decimals. The projector and FastMTP sidecar work with every text quant; download the projector only for image or video input.

## What are K_P quants?

K_P ("Perfect") quants are HauhauCS custom quantizations that use model-specific analysis to selectively preserve quality where it matters most. Every model gets its own optimized quantization profile.

A K_P quant effectively bumps quality up by one or two quant levels at only around 5–15% more size than the base quant. The files remain standard GGUFs and work with llama.cpp, LM Studio, and other GGUF-compatible runtimes with no special build or plugin.

**Note:** K_P quants may show as `?` in LM Studio's quant column. This is a display issue only—the model loads and runs normally.

## Specs

- Dense 27B causal language model with a vision encoder
- 64 language-model layers
- Hidden size 5,120; FFN size 17,408
- 248,320-token padded vocabulary
- 48 Gated DeltaNet layers and 16 gated-attention layers
- Native embedded MTP/NextN preserved, plus the HauhauCS FastMTP 32K acceleration profile
- 262,144-token native context; extensible up to 1,000,000 with framework-specific configuration
- Native text, image, and video understanding
- Based on [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B)

## What is HauhauCS FastMTP?

HauhauCS FastMTP is the custom, variant-specific acceleration profile built for this exact Aggressive release: a compact 32K draft sidecar and per-quant serving profiles qualified for TG, acceptance, maximum native context, and VRAM.

It delivers **up to 3.02x document TG and 1.93x reasoning TG versus non-MTP, plus up to 35.2% more document TG and 21.1% more reasoning TG than the standard embedded-MTP profile.** The unchanged full target verifies every drafted token, so FastMTP accelerates generation without replacing the target model or changing its answers. The construction and selection methodology is exclusive to HauhauCS releases.

The benchmark ladder:

| Comparison | Document TG | Reasoning TG | Scope |
|---|---:|---:|---|
| Standard embedded MTP vs MTP disabled | **2.23x** (`+123.4%`) | **1.60x** (`+59.6%`) | Final Q8_K_P, depth 2 |
| HauhauCS FastMTP profile vs standard embedded MTP | **+35.2%** | **+21.1%** | Final Q8_K_P, depth 3 vs depth 2 |
| HauhauCS FastMTP vs embedded MTP at identical depth | **+11.1%** | **+18.2%** | Final Q8_K_P, depth 3 |
| HauhauCS FastMTP vs MTP disabled | **3.02x** (`+202.0%`) | **1.93x** (`+93.3%`) | Final Q8_K_P service |

These results were measured on one RTX PRO 6000 Blackwell 96 GB per isolated lane at `204800` configured context, full CUDA offload, `--no-mmap`, and the official reasoning sampler. FastMTP accelerates TG; PP is reported alongside it for a complete serving comparison.

There are two acceleration paths:

- **Embedded MTP:** use any target GGUF by itself with `--spec-type draft-mtp` in a current upstream llama.cpp build.
- **HauhauCS FastMTP:** pair that same target with `Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf` and the HauhauCS runtime patch below.

## Run HauhauCS FastMTP

The compact draft uses a standard GGUF `d2t` token map plus a minimal Qwen3.8 runtime consumer. Build it once. The example below uses CUDA; for ROCm/HIP or Vulkan, replace `-DGGML_CUDA=ON` with `-DGGML_HIP=ON` or `-DGGML_VULKAN=ON`. For CPU-only, omit the backend flag.

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
git checkout 4df29be4f4c3673f428170fda944a5b19f743bb8

curl -L -o HauhauCS-FastMTP-llama.cpp.patch \
  https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/HauhauCS-FastMTP-llama.cpp.patch
git apply --check HauhauCS-FastMTP-llama.cpp.patch
git apply HauhauCS-FastMTP-llama.cpp.patch

cmake -S . -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j"$(nproc)"
```

If draft loading reports `expected 5120, 248320, got 5120, 32768`, the FastMTP sidecar is correct but the executable is unpatched. Launch the freshly built `./build/bin/llama-server` from this checkout.

Then serve any target quant with the one shared FastMTP sidecar:

```bash
MODEL=Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf
DRAFT=Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf
DEPTH=3

CUDA_VISIBLE_DEVICES=0 ./build/bin/llama-server \
  --model "$MODEL" \
  --spec-draft-model "$DRAFT" \
  --spec-draft-ngl all \
  --spec-type draft-mtp \
  --spec-draft-n-max "$DEPTH" \
  --spec-draft-p-min 0 \
  --ctx-size 204800 \
  --parallel 1 \
  --batch-size 2048 \
  --ubatch-size 512 \
  --n-gpu-layers all \
  --split-mode none \
  --flash-attn on \
  --no-mmap \
  --temp 1.0 \
  --top-k 20 \
  --top-p 0.95 \
  --min-p 0 \
  --presence-penalty 0 \
  --repeat-penalty 1.0 \
  --jinja \
  --reasoning on \
  --reasoning-effort xhigh \
  --reasoning-preserve \
  --reasoning-format deepseek \
  --host 127.0.0.1 \
  --port 8080
```

## RTX PRO 6000 Blackwell FastMTP reference speeds

Three-run medians for the uncached 9.8K-token document fixture and three-case means for reasoning. Every FastMTP result reproduced the corresponding embedded-MTP output hashes.

| Quant | Depth | PP tok/s | Document TG | Reasoning TG | vs embedded n2, Doc / Reason | vs MTP-off, Doc / Reason |
|---|---:|---:|---:|---:|---:|---:|
| Q2_K_P | 3 | 3351.29 | 213.95 | 145.09 | +11.6% / +1.7% | 2.27x / 1.48x |
| Q3_K_P | 3 | 3317.16 | 216.15 | 137.99 | +20.5% / +8.8% | 2.54x / 1.56x |
| Q4_K_P | 3 | 3204.98 | 187.26 | 123.52 | +18.0% / +2.3% | 2.67x / 1.71x |
| Q5_K_P | 3 | 2842.05 | 168.29 | 110.50 | +17.8% / +4.6% | 2.61x / 1.66x |
| Q6_K_P | 3 | 3081.90 | 156.57 | 103.51 | +26.5% / +13.8% | 2.95x / 1.91x |
| Q8_K_P | 3 | 3285.86 | 138.18 | 90.07 | +35.2% / +21.1% | 3.02x / 1.93x |
| IQ2_M | 3 | 3050.94 | 219.19 | 135.00 | +13.8% / +0.4% | 2.33x / 1.39x |
| IQ3_M | 3 | 3269.27 | 204.98 | 128.45 | +21.5% / +7.9% | 2.40x / 1.45x |
| IQ3_XS | 3 | 3165.75 | 210.64 | 138.34 | +19.1% / +5.9% | 2.38x / 1.51x |
| IQ4_XS | 3 | 3445.30 | 211.09 | 135.77 | +21.7% / +9.3% | 2.68x / 1.66x |

The full-window gate used the final scrubbed Q3_K_P and FastMTP files: **190,000 uncached prompt tokens plus 64 generated tokens completed at 1613.81 PP tok/s and 131.81 TG tok/s, with 92.0% draft acceptance and no truncation inside the configured maximum native context.**

## RTX 6000 Ada embedded-MTP reference speeds

Single-run reference results from the final public files at a configured max token context, full CUDA offload, `--no-mmap`, the official thinking sampler, and embedded MTP. The workload used an uncached 9.8K-token document-continuation prompt followed by 512 generated tokens.

| Quant | PP tok/s | TG tok/s |
|---|---:|---:|
| Q2_K_P | 1959.14 | 121.88 |
| Q3_K_P | 1944.73 | 112.76 |
| Q4_K_P | 1860.34 | 92.60 |
| Q5_K_P | 1737.51 | 83.25 |
| Q6_K_P | 1747.60 | 72.89 |
| Q8_K_P | 1827.29 | 59.00 |
| IQ2_M | 1884.83 | 121.25 |
| IQ3_M | 1867.48 | 108.45 |
| IQ3_XS | 1880.59 | 111.77 |
| IQ4_XS | 1978.46 | 104.25 |

With HauhauCS FastMTP enabled, the final Q3_K_P reached **138.37 document TG and 87.95 reasoning TG on the same Ada—23.5% and 3.9% faster than the pinned Unsloth Q3 control.**

## Recommended settings

From the [official Qwen3.8-27B model card](https://huggingface.co/Qwen/Qwen3.8-27B):

**Thinking mode (default):**

- `temperature=1.0`
- `top_p=0.95`
- `top_k=20`
- `min_p=0.0`
- `presence_penalty=0.0`
- `repetition_penalty=1.0`
- `reasoning_effort=xhigh` for the deepest reasoning

**Instruct / non-thinking mode:**

- `temperature=0.7`
- `top_p=0.80`
- `top_k=20`
- `min_p=0.0`
- `presence_penalty=1.5`
- `repetition_penalty=1.0`
- `enable_thinking=false`

Qwen3.8 supports `xhigh`, `medium`, and `low` reasoning effort. Thinking and preserved reasoning are enabled by default in the official model contract.

**Important:**

- Use `--jinja` for the embedded chat template.
- Use the BF16 projector for Vision.
- The model's native maximum is `262144`.
- Context length and KV precision have a large VRAM cost. Reduce context before reducing model quality if your workload does not need maximum native context.
- Keep default F16 K/V on the lower tiers unless memory pressure requires otherwise.

If your llama.cpp build does not recognize the reasoning or MTP flags, update it. Older builds may still load the GGUF but will not expose the full Qwen3.8 serving path.

## Turning thinking off

Qwen3.8 uses thinking mode by default. Disable it when you want shorter, faster direct responses.

**Example llama-server default for all requests:**

```bash
--chat-template-kwargs '{"enable_thinking":false}'
```

**Example per request through the OpenAI-compatible API:**

```json
{
  "model": "qwen3.8-27b-aggressive-q3",
  "messages": [{"role": "user", "content": "..."}],
  "chat_template_kwargs": {"enable_thinking": false}
}
```

**Example for multi-turn agents, preserve prior reasoning context with:**

```json
{
  "chat_template_kwargs": {"preserve_thinking": true}
}
```

## Compatibility

- **llama.cpp:** recommended; use a current Qwen3.8/MTP-capable build
- **LM Studio, Jan, KoboldCpp, and other GGUF frontends:** base compatibility depends on their bundled llama.cpp version
- **Embedded MTP:** optional and stock-compatible in current llama.cpp
- **HauhauCS FastMTP:** optional; requires the sidecar and [HauhauCS-FastMTP-llama.cpp.patch](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/HauhauCS-FastMTP-llama.cpp.patch)
- **Vision:** requires the separate BF16 projector
- **K_P display:** may appear as `?` in UIs that do not recognize the suffix

## Authenticity

Every GGUF is covered by the signed HauhauCS release manifest. Exact SHA-256 values identify byte-for-byte mirrors after renaming; canonical tensor fingerprints continue to identify HauhauCS tensors after metadata-only rewriting.

The FastMTP sidecar's exact file SHA-256 is `115e618e1f73cb50817ed5856f0551c6bf9c3d94df96f440eaca78dc63b8968b`; its canonical tensor fingerprint is `49e248e799f169b6ccc6a8127b9300a95f06cf3d96a8353266f5d457e81d1c87`. The public-key DER fingerprint is `f7be4a2335582ab7b2e393ca1c40ce70e483f1492c0f57b8c6e05d8a7223833c`.

Download [HauhauCS-RELEASE-MANIFEST.json](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/HauhauCS-RELEASE-MANIFEST.json), its [signature](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/HauhauCS-RELEASE-MANIFEST.json.sig), [FastMTP-PROVENANCE.json](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/FastMTP-PROVENANCE.json), its [signature](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/FastMTP-PROVENANCE.json.sig), and [HauhauCS-FastMTP-Ed25519-PUBLIC.pem](https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/HauhauCS-FastMTP-Ed25519-PUBLIC.pem), then verify:

```bash
openssl pkeyutl -verify -rawin -pubin \
  -inkey HauhauCS-FastMTP-Ed25519-PUBLIC.pem \
  -in FastMTP-PROVENANCE.json \
  -sigfile FastMTP-PROVENANCE.json.sig

openssl pkeyutl -verify -rawin -pubin \
  -inkey HauhauCS-FastMTP-Ed25519-PUBLIC.pem \
  -in HauhauCS-RELEASE-MANIFEST.json \
  -sigfile HauhauCS-RELEASE-MANIFEST.json.sig
```

## Other models

- [HauhauCS models on Hugging Face](https://huggingface.co/HauhauCS/models)

---

Qwen3.8-27B is released by Qwen under the Apache 2.0 license. This quantized Aggressive variant retains that license.
