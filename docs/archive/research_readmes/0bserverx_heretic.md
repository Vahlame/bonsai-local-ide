---
license: apache-2.0
base_model:
- Qwen/Qwen3.8-27B
library_name: transformers
tags:
- qwen3.8
- qwen3.5
- heretic
- abliterated
- uncensored
- roleplay
- gguf
- imatrix
pipeline_tag: text-generation
---

# Qwen3.8-27B RVN Heretic Abliterated Uncensored (GGUF)

**RVN** is a double-refined abliterated variant of **Qwen3.8-27B**, built on top of
[`trohrbaugh/Qwen3.8-27B-heretic-ara`](https://huggingface.co/trohrbaugh/Qwen3.8-27B-heretic-ara)
(an ARA abliteration by **Tim Rohrbaugh**) and further refined with **two additional
full-weight ARA passes** targeting residual refusals. It retains very low behavioral
damage (KL ≈ 0.0085) while reducing harmful-prompt refusals from 3/100 (source) to
**0–1/100** in independent measurements.

> **Note on this repository's history.** This repo previously hosted the original
> `Qwen3.8-27B-Heretic-Q4_K_M.gguf` (single-quant release from the earlier
> `trohrbaugh/Qwen3.8-27B-heretic` source). That file is kept as **legacy** for
> download-count continuity and backward compatibility — it is the *older* abliteration
> variant and is superseded by the RVN files below. Prefer the RVN quants for new
> deployments.

> **Not for all audiences.** This model has reduced safety guardrails by design. It is
> intended for adult audiences (18+) doing research, creative writing, roleplay, and
> uncensored generation. Certain guardrails are intentionally left in place; use
> responsibly and in accordance with your local laws.

> **Compatibility status (2026-08-19):** the recommended `*-multilingual*.gguf` family and all 53 legacy RVN GGUF paths embed the official Qwen3.8 chat template. Every multilingual artifact passed a real per-file OpenAI-compatible tool-call/thinking-control gate; the legacy paths were repaired in place so users do not need an external template workaround.

---

## What is ARA?

**ARA (Arbitrary-Rank Ablation)** is the abliteration technique implemented in
[p-e-w/heretic](https://github.com/p-e-w/heretic). Traditional directional abliteration
finds a single "refusal direction" in activation space and subtracts it — a one-shot,
low-rank surgery that is simple but can leave residual refusals or damage unrelated
behavior.

ARA instead treats abliteration as a **matrix optimization problem**. For every target
module (attention out-projection and MLP down-projection), it collects activations on
"good" prompts (harmless requests) and "bad" prompts (harmful requests), then uses an
LBFGS optimizer to rewrite the module's weight matrix so that:

- **Preserve:** outputs on good prompts change as little as possible (KL is kept low)
- **Steer:** outputs on bad prompts are pulled toward the good-prompt output manifold
  (via k-nearest-neighbor distances), so harmful requests stop triggering the refusal
  circuitry
- **Overcorrect:** outputs on bad prompts are additionally pushed *away* from the
  original bad-prompt outputs, which helps overcome complex, multi-stage refusal
  mechanisms

Because the weight matrix is optimized directly (rather than subtracting a single
direction), ARA is "arbitrary rank" — it can carve out a much richer refusal-removal
subspace while keeping behavioral damage minimal.

## Why "Heretic" and "Abliterated"?

These two words describe two layers of the same process:

- **Heretic** is the *tool*: the open-source implementation of ARA (and related
  abliteration methods) used to modify the model. Models produced with it are commonly
  labeled "heretic" in the community.
- **Abliterated** is the *result*: the model's refusal behavior has been surgically
  removed. An abliterated model still knows everything the base model knows, but it no
  longer refuses to answer the categories that were steered away during the process.

So "Heretic Abliterated" means: *abliterated using the heretic toolset.* RVN goes one
step further — it applies the ARA procedure **three times total**: once by the original
author (`trohrbaugh`) to get from base Qwen3.8-27B to `-ara`, and twice more by us to
get from `-ara` to RVN, squeezing out the last residual refusals.

## Special Thanks

This work would not exist without **Tim Rohrbaugh** (`trohrbaugh`), whose
[`heretic-ara`](https://huggingface.co/trohrbaugh/Qwen3.8-27B-heretic-ara) ARA
abliteration of Qwen3.8-27B (refusals 3/100, KL 0.0535) provided the foundation we
refined into RVN. His upstream contributions to the heretic codebase — including the
row-norm preservation feature and Qwen3.5 MoE/DeltaNet hybrid handling — are directly
responsible for making DeltaNet-layer abliteration work at all. Thank you, Tim.

## Model Overview

| Property | Value |
|---|---|
| Base model | [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) |
| Abliteration source | [`trohrbaugh/Qwen3.8-27B-heretic-ara`](https://huggingface.co/trohrbaugh/Qwen3.8-27B-heretic-ara) (ARA, KL 0.0535, refusals 3/100) |
| **RVN refinement** | **2-pass ARA on top of source → KL 0.0085, refusals 0–1/100** |
| Architecture | `qwen3_5_text` (Qwen3.8 family), Gated DeltaNet hybrid |
| Parameters | 27B total |
| Hidden size | 5120 |
| Layers | 64 (16 standard attention + 48 Gated DeltaNet linear attention) |
| Attention heads | 24 · KV heads 4 (GQA) · head_dim 256 |
| Vocab | 248,320 |
| Context length | 262,144 (262K) |
| License | Apache-2.0 (retained from Qwen3.8-27B) |
| Format | GGUF (llama.cpp). Base files: MTP/NextN excluded. `*-mtp.gguf` files ship the official Qwen3.8 MTP draft head embedded → see [MTP Speculative Decoding](#mtp-speculative-decoding) |

## Why RVN?

`trohrbaugh/Qwen3.8-27B-heretic-ara` is already a strong ARA abliteration, but three
harmful prompts still triggered refusals in our independent evaluation (racism website,
malware, government database hacking). RVN applies **two additional full-weight ARA
passes** using the same tight parameter set (start 26, end 56, preserve 0.9432,
steer 0.0009, overcorrect 0.5038, neighbor 10), which:

- Reduced refusals from **3/100 → 0–1/100** (the only remaining refusal is a
  chemical-weapon WMD prompt — one of the strongest safety-trained categories, and
  intentionally one of the guardrails we left in place)
- Reduced KL damage from 0.0535 (source) to **0.0085** vs base — a ~6× improvement
  in behavioral preservation
- Verified independently on two rented GPU machines with prefix-based (real-answer)
  refusal measurement

### Refusal evaluation (100 harmful-behaviors prompts, prefix-forced real answers)

| Model | Refusals | KL vs base |
|---|---|---|
| Qwen3.8-27B (base) | ~99/100 | — |
| trohrbaugh -ara (source) | 3/100 | 0.0535 |
| **RVN (this repo)** | **0–1/100** | **0.0085** |

<!-- RVN_FILE_SELECTION_GUIDE_START -->
## Which file should I download?

**Download one main-model GGUF, not the whole repository.** Start with a plain `-multilingual.gguf` file unless you specifically need MTP or a vision-protected build. Model size is not the whole memory requirement: leave room for the KV cache, compute buffers, the operating system, and—when used—the vision projector.

### Quick picks

The sizes below are the live model-weight sizes at the verified repository head. They do **not** include runtime buffers or KV cache.

| Hardware / goal | Recommended main model | Model weights | Practical consequence |
|---|---|---:|---|
| Best default on a 24 GB GPU | `RVN-Q4_K_M-multilingual.gguf` | 15.41 GiB | Good quality/memory balance with useful room for runtime buffers and context. |
| More quality on a 24 GB GPU | `RVN-Q5_K_M-multilingual.gguf` | 17.91 GiB | Better fidelity, but less context headroom. Q6_K at 20.57 GiB is too tight to be the default on 24 GB. |
| Safe starting point on a 16 GB GPU | `RVN-Q3_K_S-multilingual.gguf` | 11.24 GiB | Leaves more runtime headroom. `Q3_K_M` at 12.39 GiB offers better quality but a tighter context budget. |
| Safe starting point on a 12 GB GPU | `RVN-IQ2_XXS-multilingual.gguf` or `RVN-IQ2_XS-multilingual.gguf` | 7.85 / 8.47 GiB | Low-memory deployment with a visible quality loss versus Q3/Q4. IQ2_M at 9.32 GiB is a tight fit, not the default. |
| Around 8 GB VRAM | `RVN-IQ1_S-multilingual.gguf` | 6.66 GiB | Experimental emergency-fit option. Full GPU offload may still fail after buffers/KV are added; use a short context or partial CPU offload. Prefer the non-MTP file. |
| Highest quantized fidelity on 32 GB+ | `RVN-Q8_0-multilingual.gguf` | 26.63 GiB | Near-reference quantized quality; context still consumes additional memory. |
| Reference/evaluation on 64 GB+ | `RVN-BF16.gguf` or `RVN-F16.gguf` | 50.11 GiB | Not intended for ordinary inference hardware. BF16 is the source-format-oriented choice when supported; F16 is the compatibility/reference path used by this repository's existing quantization and PPL workflow. |
| CPU or Apple unified memory | Choose the largest recommended file that still leaves at least 6–10 GiB free | varies | System RAM/unified memory is shared with the OS, KV cache, and runtime. For long context, leave more than this minimum. |

### The valid filename families

Suffixes cannot be combined arbitrarily. These are the families that actually exist:

```text
RVN-{QUANT}.gguf
RVN-{QUANT}-mtp.gguf
RVN-{Q5_K_M|Q4_K_M|Q3_K_M}-vision.gguf

RVN-{QUANT}-multilingual.gguf
RVN-{QUANT}-multilingual-mtp.gguf
RVN-{Q5_K_M|Q4_K_M|Q3_K_M}-multilingual-vision.gguf

RVN-F16.gguf / RVN-F16-mtp.gguf
RVN-BF16.gguf / RVN-BF16-mtp.gguf

mtp-RVN.gguf  # standalone draft-head compatibility artifact; not a main model
```

- There is no combined `vision-mtp` file.
- There is no `F16-multilingual` or `BF16-multilingual` file.
- `mmproj-Qwen3.8-27B-Q8_0.gguf` is a separate vision projector, not another main model.
- `mtp-RVN.gguf` is a separate 1.69 GiB standalone MTP draft-head artifact retained for advanced/legacy workflows. It cannot answer prompts by itself and is not required by any embedded `*-mtp.gguf` twin. Most users should ignore it and download either one plain main model or its embedded-MTP twin.

### What the names mean

- **`-multilingual`** — the recommended Qwen-tuned calibration family for new downloads. Its importance matrix covers Turkish, Russian, 20+ other languages, code, reasoning, and tool-use structures instead of concentrating the low-bit precision budget on narrow English-only text. Calibration matters most at low bit-rates; it does not teach Qwen new languages.
- **`-mtp`** — the same main-model tensor payload plus Qwen3.8's official 15-tensor MTP/NextN draft head for speculative decoding. Budget about **451 MB / 0.42 GiB** of additional memory. Every current multilingual twin is exactly **451,320,768 bytes** larger; current legacy twins add either **451,320,736 or 451,320,768 bytes** because of a 32-byte historical metadata-layout difference. It is a speed feature, not a higher-quality quant.
- **`-vision`** — keeps token embeddings, output, and the first/last bridge blocks at higher precision. It is an optional bridge-preserving variant, not a requirement for images. Multilingual vision files passed the repository's API/template gates; their image-quality advantage has not been separately benchmarked, so no quality uplift is claimed here.
- **No `-multilingual` in the name** — the original RVN calibration family, retained under its established filenames for compatibility and download continuity. It includes plain, `-mtp`, and selected `-vision` files. These current files are usable and template-correct, but the multilingual family is recommended for new low-bit deployments.

### Quant label legend

- **`Q…_K…`** — llama.cpp K-quant family. Within the same tier, `_M` generally retains more precision and is larger than `_S`; `_L` is larger again where available.
- **`IQ…`** — importance-aware low-bit quant format. It is especially useful when memory is tight, but the filename alone is not proof of how a historical artifact was calibrated; this repository documents provenance separately.
- **`L → M → S → XS → XXS`** — within a comparable family, generally moves toward smaller size and lower fidelity.
- **`NL`** — nonlinear IQ4 variant.
- Do not rank unlike families from the suffix alone. Use the quick picks and exact live-size table below.

### Vision: what to download

For image input, download:

1. **One compatible RVN main-model GGUF**—a standard or `-vision` file; and
2. **`mmproj-Qwen3.8-27B-Q8_0.gguf` separately** (about 0.63 GB).

Any compatible RVN main model can use the projector. Choose a `-vision` build when the available Q5_K_M/Q4_K_M/Q3_K_M size fits and preserving extra precision in the vision-language bridge is important. Because there is no combined `vision-mtp` artifact, choose between the self-contained vision-protected build and an embedded-MTP build.

### GSQ-RCO series

The GSQ-RCO non-uniform quantizations (4 tiers + MTP twins) now live in their own repository: **[Qwen3.8-27B-Heretic-GSQ-RCO-GGUF](https://huggingface.co/0bserverx/Qwen3.8-27B-Heretic-GSQ-RCO-GGUF)** - see that model card for the PPL evidence (IQ3_S +0.95% vs F16, ahead of uniform at a smaller size), build method, and usage.

## MTP: when to choose it

- Start with the plain `-multilingual.gguf` file for maximum runtime compatibility.
- Choose the matching `-multilingual-mtp.gguf` twin only when your recent llama.cpp build supports embedded MTP, the extra 0.42 GiB still leaves enough runtime/context memory, and you enable the documented MTP flags.
- Measured speedup varies by quant and hardware. It is not guaranteed.
- **Do not use the MTP twin for `IQ1_M`: measured generation was about 60% slower.** `IQ1_S` gained only about 4%. Prefer the plain files for those extreme quants unless your own benchmark shows otherwise.

### Legacy-name and chat-template clarification

- All 53 current `RVN-*.gguf` paths and all 49 `*-multilingual*.gguf` artifacts embed the official Qwen3.8 chat template. No external chat-template launch flag is needed for these current files.
- `Qwen3.8-27B-Heretic-Q4_K_M.gguf` is a separate, older pre-RVN abliteration retained for historical download continuity. Its current live header also contains the official embedded template, but it is not the RVN model and was not part of the 53-file RVN runtime-repair campaign. New users should choose an RVN multilingual file instead.
- `chat_template.jinja` remains in the repository as a readable reference copy of the official template, not as a required workaround for current files.
<!-- RVN_FILE_SELECTION_GUIDE_END -->

## Files & Quantization Spectrum

<!-- RVN_MULTILINGUAL_V5_START -->
### Recommended: Qwen Multilingual v5 calibrated family

These additive files were rebuilt from the template-correct RVN F16 reference using a pinned Qwen-tuned multilingual/code calibration corpus. The legacy filenames remain available for download continuity; choose the `-multilingual` family for new deployments.

**Why the multilingual family matters:** Qwen already learned its languages during pretraining; calibration does not teach them again. The importance matrix controls which activation/weight regions are preserved most carefully during low-bit quantization. A narrow English-only calibration set can spend that precision budget on English encyclopedia patterns, while this Qwen-tuned corpus also represents Turkish, Russian, 20+ other languages, code, reasoning traces, and tool-use structures. That makes `-multilingual` the recommended default for new downloads, especially at 4-bit and below.

**Which file should I choose?** Use the plain `-multilingual.gguf` file for maximum runtime compatibility. Choose its `-multilingual-mtp.gguf` twin only with a recent llama.cpp build and the documented MTP flags when you want speculative-decoding speed. Choose a `-multilingual-vision.gguf` variant when image understanding with the official mmproj is a priority. Q8_0 is retained in the same family for a consistent, fully verified provenance path even though calibration effects are expected to be smaller at 8-bit precision.

**Q8_0 clarification:** full tensor-schema and tensor-payload hashing proved that the legacy and multilingual Q8_0 base files have byte-identical tensors; their MTP twins are likewise tensor-identical. The multilingual Q8_0 names are retained for family/provenance consistency, not as a claim of extra Q8 quality. Their GGUF metadata records the pinned multilingual imatrix provenance, while `-mtp` still denotes the separate 15-tensor speculative-decoding head. Comparison receipt SHA-256: `210e59a07412df8f46b94f41790c0fb36540a2a6a09fb24933e6c1c3cb1ee863`.

**Reproducibility and verification:**

- Calibration source: [`tristandruyen/9e207a95c7d75ddf37525d353e00659c`](https://gist.github.com/tristandruyen/9e207a95c7d75ddf37525d353e00659c) at revision `aba17fe897c00fae02a18d26068aa453dee09e50`.
- Corpus SHA-256: `2a0118c633250aad448cfc2d103e10a731af6974dab1738ca19261fce3587b80`; imatrix SHA-256: `5e73e1449451480fa48f463b781cfa2124daaf5c337a0c44f272e37b64fc1114`.
- Imatrix: 55 completed chunks, 496 entries, context 2048; llama.cpp commit `645ca2834bc16e7eab112a91aeb282ebb913f935`.
- Embedded official Qwen template SHA-256: `c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041`.
- 49/49 artifacts passed live LFS SHA-256 and 64 MiB header verification after upload.
- Every artifact was loaded in llama.cpp and then served through `llama-server`; its OpenAI-compatible API returned HTTP 200, `finish_reason=tool_calls`, and `add({"a":19,"b":23})`. `enable_thinking:false` suppressed `<think>`, and a separate normal-chat control returned `TEMPLATE_OK`.
- MTP twins additionally load with 866 tensors, `qwen35.block_count=65`, and `qwen35.nextn_predict_layers=1`.

Pilot PPL deltas (`multilingual - reference`; lower is better):

| Pilot | Wiki vs F16 | Wiki vs legacy | Multilingual vs F16 | Multilingual vs legacy |
|---|---:|---:|---:|---:|
| Q4_K_M | -0.0002 | +0.0156 | +0.0038 | **-0.0074** |
| IQ4_XS | +0.0290 | +0.0060 | +0.0091 | **-0.0083** |

| Quant | Base | Base size | Embedded-MTP twin | MTP size | Per-file API gate |
|---|---|---:|---|---:|---|
| Q8_0 | [`RVN-Q8_0-multilingual.gguf`](./RVN-Q8_0-multilingual.gguf) | 28.60 GB / 26.63 GiB | [`RVN-Q8_0-multilingual-mtp.gguf`](./RVN-Q8_0-multilingual-mtp.gguf) | 29.05 GB / 27.05 GiB | PASS |
| Q6_K | [`RVN-Q6_K-multilingual.gguf`](./RVN-Q6_K-multilingual.gguf) | 22.08 GB / 20.57 GiB | [`RVN-Q6_K-multilingual-mtp.gguf`](./RVN-Q6_K-multilingual-mtp.gguf) | 22.53 GB / 20.99 GiB | PASS |
| Q5_K_M | [`RVN-Q5_K_M-multilingual.gguf`](./RVN-Q5_K_M-multilingual.gguf) | 19.23 GB / 17.91 GiB | [`RVN-Q5_K_M-multilingual-mtp.gguf`](./RVN-Q5_K_M-multilingual-mtp.gguf) | 19.68 GB / 18.33 GiB | PASS |
| Q5_K_S | [`RVN-Q5_K_S-multilingual.gguf`](./RVN-Q5_K_S-multilingual.gguf) | 18.68 GB / 17.40 GiB | [`RVN-Q5_K_S-multilingual-mtp.gguf`](./RVN-Q5_K_S-multilingual-mtp.gguf) | 19.13 GB / 17.82 GiB | PASS |
| Q4_K_M | [`RVN-Q4_K_M-multilingual.gguf`](./RVN-Q4_K_M-multilingual.gguf) | 16.55 GB / 15.41 GiB | [`RVN-Q4_K_M-multilingual-mtp.gguf`](./RVN-Q4_K_M-multilingual-mtp.gguf) | 17.00 GB / 15.83 GiB | PASS |
| IQ4_NL | [`RVN-IQ4_NL-multilingual.gguf`](./RVN-IQ4_NL-multilingual.gguf) | 15.80 GB / 14.72 GiB | [`RVN-IQ4_NL-multilingual-mtp.gguf`](./RVN-IQ4_NL-multilingual-mtp.gguf) | 16.25 GB / 15.14 GiB | PASS |
| Q4_K_S | [`RVN-Q4_K_S-multilingual.gguf`](./RVN-Q4_K_S-multilingual.gguf) | 15.59 GB / 14.52 GiB | [`RVN-Q4_K_S-multilingual-mtp.gguf`](./RVN-Q4_K_S-multilingual-mtp.gguf) | 16.04 GB / 14.94 GiB | PASS |
| IQ4_XS | [`RVN-IQ4_XS-multilingual.gguf`](./RVN-IQ4_XS-multilingual.gguf) | 15.08 GB / 14.05 GiB | [`RVN-IQ4_XS-multilingual-mtp.gguf`](./RVN-IQ4_XS-multilingual-mtp.gguf) | 15.53 GB / 14.47 GiB | PASS |
| Q3_K_L | [`RVN-Q3_K_L-multilingual.gguf`](./RVN-Q3_K_L-multilingual.gguf) | 14.34 GB / 13.36 GiB | [`RVN-Q3_K_L-multilingual-mtp.gguf`](./RVN-Q3_K_L-multilingual-mtp.gguf) | 14.80 GB / 13.78 GiB | PASS |
| Q3_K_M | [`RVN-Q3_K_M-multilingual.gguf`](./RVN-Q3_K_M-multilingual.gguf) | 13.30 GB / 12.39 GiB | [`RVN-Q3_K_M-multilingual-mtp.gguf`](./RVN-Q3_K_M-multilingual-mtp.gguf) | 13.75 GB / 12.81 GiB | PASS |
| IQ3_M | [`RVN-IQ3_M-multilingual.gguf`](./RVN-IQ3_M-multilingual.gguf) | 12.58 GB / 11.72 GiB | [`RVN-IQ3_M-multilingual-mtp.gguf`](./RVN-IQ3_M-multilingual-mtp.gguf) | 13.03 GB / 12.14 GiB | PASS |
| IQ3_S | [`RVN-IQ3_S-multilingual.gguf`](./RVN-IQ3_S-multilingual.gguf) | 12.42 GB / 11.57 GiB | [`RVN-IQ3_S-multilingual-mtp.gguf`](./RVN-IQ3_S-multilingual-mtp.gguf) | 12.87 GB / 11.99 GiB | PASS |
| Q3_K_S | [`RVN-Q3_K_S-multilingual.gguf`](./RVN-Q3_K_S-multilingual.gguf) | 12.07 GB / 11.24 GiB | [`RVN-Q3_K_S-multilingual-mtp.gguf`](./RVN-Q3_K_S-multilingual-mtp.gguf) | 12.53 GB / 11.67 GiB | PASS |
| IQ3_XS | [`RVN-IQ3_XS-multilingual.gguf`](./RVN-IQ3_XS-multilingual.gguf) | 11.97 GB / 11.15 GiB | [`RVN-IQ3_XS-multilingual-mtp.gguf`](./RVN-IQ3_XS-multilingual-mtp.gguf) | 12.42 GB / 11.57 GiB | PASS |
| IQ3_XXS | [`RVN-IQ3_XXS-multilingual.gguf`](./RVN-IQ3_XXS-multilingual.gguf) | 11.19 GB / 10.42 GiB | [`RVN-IQ3_XXS-multilingual-mtp.gguf`](./RVN-IQ3_XXS-multilingual-mtp.gguf) | 11.64 GB / 10.84 GiB | PASS |
| Q2_K | [`RVN-Q2_K-multilingual.gguf`](./RVN-Q2_K-multilingual.gguf) | 10.71 GB / 9.98 GiB | [`RVN-Q2_K-multilingual-mtp.gguf`](./RVN-Q2_K-multilingual-mtp.gguf) | 11.16 GB / 10.40 GiB | PASS |
| Q2_K_S | [`RVN-Q2_K_S-multilingual.gguf`](./RVN-Q2_K_S-multilingual.gguf) | 10.25 GB / 9.54 GiB | [`RVN-Q2_K_S-multilingual-mtp.gguf`](./RVN-Q2_K_S-multilingual-mtp.gguf) | 10.70 GB / 9.96 GiB | PASS |
| IQ2_M | [`RVN-IQ2_M-multilingual.gguf`](./RVN-IQ2_M-multilingual.gguf) | 10.00 GB / 9.32 GiB | [`RVN-IQ2_M-multilingual-mtp.gguf`](./RVN-IQ2_M-multilingual-mtp.gguf) | 10.46 GB / 9.74 GiB | PASS |
| IQ2_S | [`RVN-IQ2_S-multilingual.gguf`](./RVN-IQ2_S-multilingual.gguf) | 9.36 GB / 8.72 GiB | [`RVN-IQ2_S-multilingual-mtp.gguf`](./RVN-IQ2_S-multilingual-mtp.gguf) | 9.81 GB / 9.14 GiB | PASS |
| IQ2_XS | [`RVN-IQ2_XS-multilingual.gguf`](./RVN-IQ2_XS-multilingual.gguf) | 9.09 GB / 8.47 GiB | [`RVN-IQ2_XS-multilingual-mtp.gguf`](./RVN-IQ2_XS-multilingual-mtp.gguf) | 9.54 GB / 8.89 GiB | PASS |
| IQ2_XXS | [`RVN-IQ2_XXS-multilingual.gguf`](./RVN-IQ2_XXS-multilingual.gguf) | 8.43 GB / 7.85 GiB | [`RVN-IQ2_XXS-multilingual-mtp.gguf`](./RVN-IQ2_XXS-multilingual-mtp.gguf) | 8.88 GB / 8.27 GiB | PASS |
| IQ1_M | [`RVN-IQ1_M-multilingual.gguf`](./RVN-IQ1_M-multilingual.gguf) | 7.63 GB / 7.11 GiB | [`RVN-IQ1_M-multilingual-mtp.gguf`](./RVN-IQ1_M-multilingual-mtp.gguf) | 8.08 GB / 7.53 GiB | PASS |
| IQ1_S | [`RVN-IQ1_S-multilingual.gguf`](./RVN-IQ1_S-multilingual.gguf) | 7.15 GB / 6.66 GiB | [`RVN-IQ1_S-multilingual-mtp.gguf`](./RVN-IQ1_S-multilingual-mtp.gguf) | 7.60 GB / 7.08 GiB | PASS |

Vision-protected multilingual variants retain Q8_0 embeddings/output and the first/last bridge layers while quantizing the middle blocks:

| Quant | File | Size | Per-file API gate |
|---|---|---:|---|
| Q5_K_M | [`RVN-Q5_K_M-multilingual-vision.gguf`](./RVN-Q5_K_M-multilingual-vision.gguf) | 21.02 GB / 19.58 GiB | PASS |
| Q4_K_M | [`RVN-Q4_K_M-multilingual-vision.gguf`](./RVN-Q4_K_M-multilingual-vision.gguf) | 18.75 GB / 17.46 GiB | PASS |
| Q3_K_M | [`RVN-Q3_K_M-multilingual-vision.gguf`](./RVN-Q3_K_M-multilingual-vision.gguf) | 16.19 GB / 15.08 GiB | PASS |

<!-- RVN_MULTILINGUAL_V5_END -->


<div style="font-size: 0.85em">

| File | Size (GB / GiB) | Notes |
|---|---|---|
| `RVN-F16.gguf` | 53.81 / 50.11 | F16 reference (no NextN/MTP) |
| `RVN-BF16.gguf` | 53.81 / 50.11 | BF16 reference (no NextN/MTP) |
| `RVN-Q8_0.gguf` | 28.60 / 26.63 | Max-quality 8-bit |
| `RVN-Q6_K.gguf` | 22.08 / 20.57 | High-quality 6-bit |
| `RVN-Q5_K_M.gguf` | 19.23 / 17.91 | Balanced 5-bit |
| `RVN-Q5_K_S.gguf` | 18.68 / 17.40 | 5-bit small |
| `RVN-Q4_K_M.gguf` | 16.55 / 15.41 | Recommended 4-bit (24 GB VRAM) |
| `Qwen3.8-27B-Heretic-Q4_K_M.gguf` | 16.55 / 15.41 | **Legacy** (older abliteration variant, kept for download continuity) |
| `RVN-IQ4_NL.gguf` | 15.89 / 14.80 | legacy 4-bit non-linear produced without an imatrix; prefer `RVN-IQ4_NL-multilingual.gguf` |
| `RVN-Q4_K_S.gguf` | 15.59 / 14.52 | Small 4-bit |
| `RVN-IQ4_XS.gguf` | 15.19 / 14.15 | legacy 4-bit extra-small produced without an imatrix; prefer `RVN-IQ4_XS-multilingual.gguf` |
| `RVN-Q3_K_L.gguf` | 14.34 / 13.36 | Large 3-bit |
| `RVN-Q3_K_M.gguf` | 13.30 / 12.39 | Compact 3-bit |
| `RVN-IQ3_M.gguf` | 12.58 / 11.72 | imatrix 3-bit — **re-uploaded 2026-08-17** (previous file had corrupted tensor data: NaN/Inf scales + zeroed tensors from a bad quantize run; re-quantized from F16 with a fresh imatrix and verified — see note below) |
| `RVN-IQ3_S.gguf` | 12.42 / 11.57 | imatrix 3-bit small |
| `RVN-Q3_K_S.gguf` | 12.07 / 11.24 | Compact 3-bit small |
| `RVN-IQ3_XS.gguf` | 11.97 / 11.15 | imatrix 3-bit extra-small |
| `RVN-IQ3_XXS.gguf` | 11.19 / 10.42 | imatrix 3-bit extra-extra-small |
| `RVN-Q2_K.gguf` | 10.71 / 9.98 | 2-bit K-quant |
| `RVN-Q2_K_S.gguf` | 10.25 / 9.54 | 2-bit K-quant small |
| `RVN-IQ2_M.gguf` | 10.00 / 9.32 | imatrix 2-bit |
| `RVN-IQ2_S.gguf` | 9.36 / 8.72 | imatrix 2-bit small |
| `RVN-IQ2_XS.gguf` | 9.09 / 8.47 | imatrix 2-bit extreme small |
| `RVN-IQ2_XXS.gguf` | 8.43 / 7.85 | imatrix 2-bit (minimum) |
| `RVN-IQ1_M.gguf` | 7.63 / 7.11 | imatrix 1-bit (experimental) |
| `RVN-IQ1_S.gguf` | 7.15 / 6.66 | imatrix 1-bit (experimental) |

</div>

### 👁️ Vision-Protected (UD-style) Variants

These `-vision` variants apply a structural precision policy: `token_embd`, `output`, and the
**first 4 + last 4 transformer blocks** stay at **Q8_0**, while the middle blocks use the
target K-quant. A tensor audit verified 106 regex-selected overrides, 851 tensors, correct
per-tensor types, and 0 NaN/Inf. This describes the artifact structure; it is not a claim
of a separately benchmarked image-quality uplift.

| File | Size (GB / GiB) | Bridge / Middle |
|---|---|---|
| `RVN-Q5_K_M-vision.gguf` | 21.02 / 19.57 | Q8_0 bridge · Q5_K_M middle |
| `RVN-Q4_K_M-vision.gguf` | 18.75 / 17.46 | Q8_0 bridge · Q4_K_M middle |
| `RVN-Q3_K_M-vision.gguf` | 16.19 / 15.08 | Q8_0 bridge · Q3_K_M middle |

Usage — identical to the standard quants, just point at the `-vision` file:

```bash
llama-server -m RVN-Q5_K_M-vision.gguf --mmproj mmproj-Qwen3.8-27B-Q8_0.gguf \
  -c 32768 -ngl 99
```

### 📊 Perplexity (vs F16 reference)

Measured on an RTX PRO 6000 Blackwell (full GPU offload, llama.cpp master):
`llama-perplexity`, tiny_shakespeare corpus, ctx 2048.

| Model | PPL | Δ vs F16 |
|---|---|---|
| `RVN-F16.gguf` | 4.5477 | — |
| `RVN-Q5_K_M.gguf` (standard) | 4.6493 | +2.23% |
| `RVN-Q5_K_M-vision.gguf` | 4.6497 | +2.24% |
| `RVN-Q4_K_M-vision.gguf` | 4.8751 | +7.20% |
| `RVN-Q3_K_M-vision.gguf` | 5.6490 | +24.2% |

The table above reports text perplexity only. The Q8_0 overrides are structurally
verified, but this repository does not publish a reproducible comparative image-quality
receipt for these files; no image-quality uplift is claimed.

> imatrix-based quants are produced from the same F16 with an activation importance
> matrix computed over wikitext-2-raw (original spectrum, **580 chunks**) or
> tiny_shakespeare (2026-08-17 re-quant additions: `IQ3_M` fix +
> `IQ2_S`/`IQ3_XXS`/`IQ3_XS`/`IQ3_S`, **159 chunks**, llama-imatrix, `-ngl 99`).
> The currently published `IQ4_XS` and `IQ4_NL` files are exceptions: an independent
> GGUF-header audit and the retained production script confirm they were made without
> `--imatrix`. Their earlier imatrix labels were incorrect; corrected wikitext-imatrix
> replacements (including MTP twins) are being rebuilt.
> The `-vision` files are quantized with K-quant defaults (no imatrix) — the bridge
> protection is structural (Q8_0 overrides), not imatrix-dependent.

## ⚡ MTP Speculative Decoding

Every quant ships a **`*-mtp.gguf` twin** with the official Qwen3.8 MTP draft head
(Q8_0; budget about 451 MB / 0.42 GiB per embedded twin) embedded. The main-model weights are byte-identical to the base file —
the head is appended as an extra `blk.64.nextn.*` layer set (block_count 65, `qwen35.nextn_predict_layers=1`).

The separate `mtp-RVN.gguf` file is a 1.69 GiB standalone draft-head compatibility artifact for advanced/legacy workflows. It is not a main model, cannot answer prompts by itself, and is not required by the embedded `*-mtp.gguf` twins.
Abliteration never touched the draft head (it operates on main-model layers 26–56), so
draft quality is unchanged, and speculative decoding is **output-equivalent**: same
tokens, just faster.

**Usage (llama.cpp ≥ b10440, PR #22673):**

```bash
llama-server -m RVN-IQ3_M-mtp.gguf -c 32768 -ngl 99 \
  --spec-type draft-mtp --spec-draft-n-max 2 --parallel 1
```

**Measured on 2× RTX PRO 6000 Blackwell (95 GB each, full GPU offload, llama.cpp b10472):**

| Quant | Normal (t/s) | + MTP (t/s) | Δ |
|---|---|---|---|
| `Q6_K` | 61.6 | 126.2 | **+105%** |
| `BF16` | 29.2 | 58.2 | **+99%** |
| `Q8_0` | 50.6 | 98.0 | **+94%** |
| `IQ3_S` | 91.9 | 169.7 | **+85%** |
| `IQ4_XS` | 83.4 | 152.0 | **+82%** |
| `Q3_K_S` | 84.5 | 153.6 | **+82%** |
| `F16` | 29.4 | 52.9 | **+80%** |
| `IQ3_XS` | 94.0 | 161.9 | **+72%** |
| `Q3_K_L` | 78.7 | 131.3 | **+67%** |
| `IQ4_NL` | 80.8 | 138.0 | **+71%** |
| `IQ2_M` | 106.2 | 175.9 | **+66%** |
| `IQ2_XS` | 112.8 | 183.4 | **+63%** |
| `Q4_K_M` | 76.6 | 122.0 | **+59%** |
| `Q4_K_S` | 80.5 | 127.1 | **+58%** |
| `IQ3_M` | 91.3 | 144.0 | **+58%** |
| `Q3_K_M` | 82.6 | 129.5 | **+57%** |
| `IQ2_XXS` | 117.6 | 182.6 | **+55%** |
| `Q2_K` | 98.2 | 150.2 | **+53%** |
| `IQ3_XXS` | 98.5 | 138.5 | **+41%** |
| `IQ2_S` | 111.5 | 155.3 | **+39%** |
| `Q5_K_M` | 68.1 | 93.8 | **+38%** |
| `Q2_K_S` | 105.5 | 145.1 | **+38%** |
| `Q5_K_S` | 70.7 | 91.1 | **+29%** |
| `IQ1_S` | 127.0 | 131.7 | +3.7% |
| `IQ1_M` | 119.5 | 47.6 | **−60%** ⚠️ |

Average: **+55% generation speed** (128-token continuation, `--spec-draft-n-max 2 --parallel 1`).
**⚠️ `IQ1_M` is the exception: MTP makes it ~60% slower — use the base file for IQ1_M.**
`IQ1_S` gains almost nothing (+4%). All other quants gain +29% to +105%.

Community measurements on larger cards report **+33–145%** depending on GPU and
context. Tips: `--spec-draft-n-max 2` is the sweet spot on 16–24 GB cards (3–4 on
bigger/faster cards); pair with `--cache-type-k q4_0 --cache-type-v q4_0` for long
context; `--spec-draft-p-min 0.60–0.75` helps on bandwidth-limited rigs.

## 👁️ Vision (image understanding)

Pair any `*-mtp.gguf` with the official vision projector for full image-text-to-text:

```bash
llama-server -m RVN-IQ3_M-mtp.gguf --mmproj mmproj-Qwen3.8-27B-Q8_0.gguf \
  -c 32768 -ngl 99 --spec-type draft-mtp --spec-draft-n-max 2 --parallel 1
```

- `mmproj-Qwen3.8-27B-Q8_0.gguf` (0.63 GB, Q8_0) is the official Qwen3.8 vision
  projector from `ggml-org/Qwen3.8-27B-GGUF` (Apache-2.0). The vision tower is an
  image encoder only — ARA abliteration never touched it, so it pairs cleanly with
  every RVN quant.
- Verified: `RVN-Q3_K_M-mtp` + this mmproj describes images correctly (MTP active).
- Combo credit: [cfigueiroa/Qwen3.8-27B-RVN-vision-MTP](https://huggingface.co/cfigueiroa/Qwen3.8-27B-RVN-vision-MTP).



## Quant → GPU / Memory Guide

The values below are **model weights only**. KV cache, compute buffers, the operating system, MTP, and the vision projector need additional memory. For a new deployment, prefer the `-multilingual` filename shown here.

| Available GPU / unified memory | Safe starting point | Model weights | Practical note |
|---|---|---:|---|
| **Around 8 GB** | `RVN-IQ1_S-multilingual.gguf` | 6.66 GiB | Emergency-fit, short-context option. Full GPU offload may still fail after buffers/KV; partial CPU offload can be required. Prefer non-MTP. |
| **12 GB** | `RVN-IQ2_XXS-multilingual.gguf` or `RVN-IQ2_XS-multilingual.gguf` | 7.85 / 8.47 GiB | Leaves more runtime room than IQ2_M; expect visible quality loss versus Q3/Q4. |
| **16 GB** | `RVN-Q3_K_S-multilingual.gguf` or `RVN-Q3_K_M-multilingual.gguf` | 11.24 / 12.39 GiB | Q3_K_S leaves more context headroom; Q3_K_M trades that room for quality. |
| **24 GB** | `RVN-Q4_K_M-multilingual.gguf`; optionally `RVN-Q5_K_M-multilingual.gguf` | 15.41 / 17.91 GiB | Q4_K_M is the balanced default. Q5_K_M is quality-focused with less context room. Q6_K at 20.57 GiB is tight. |
| **32 GB+** | `RVN-Q8_0-multilingual.gguf` | 26.63 GiB | Highest-fidelity quantized option; long context still needs additional memory. |
| **64 GB+** | `RVN-BF16.gguf` or `RVN-F16.gguf` | 50.11 GiB | Reference/evaluation class, not an ordinary inference download. |

Budget about **451 MB / 0.42 GiB** for an embedded MTP head. Current multilingual twins add exactly 451,320,768 bytes; current legacy twins add either 451,320,736 or 451,320,768 bytes because of a 32-byte historical metadata-layout difference. The separate vision projector is about **0.63 GB**. Budget both on top of the main-model size.

## Limitations & Responsible Use

- **Reduced safety guardrails by design.** This model is not intended for use in
  applications requiring robust safety filtering, content moderation, or deployment to
  minors.
- **Certain guardrails are intentionally left in place.** Abliteration targets refusal
  behavior on general harmful-prompt categories; a small set of hard safety-trained
  categories is deliberately not fully removed. Behavior may vary across domains and
  languages.
- Not affiliated with or endorsed by Qwen/Alibaba or trohrbaugh.

## License & Attribution

- Base model: [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) — Apache-2.0
- Abliteration source: [`trohrbaugh/Qwen3.8-27B-heretic-ara`](https://huggingface.co/trohrbaugh/Qwen3.8-27B-heretic-ara) — Apache-2.0
- This repo: Apache-2.0. See [LICENSE](LICENSE).

## Citation

```bibtex
@misc{rohrbaugh2026heretic,
  title={Qwen3.8-27B-heretic-ara: ARA Abliteration of Qwen3.8-27B},
  author={Rohrbaugh, Tim},
  year={2026},
  howpublished={\url{https://huggingface.co/trohrbaugh/Qwen3.8-27B-heretic-ara}}
}

@misc{rvn2026,
  title={RVN: Qwen3.8-27B Heretic Abliterated Uncensored},
  author={0bserverx},
  year={2026},
  howpublished={\url{https://huggingface.co/0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF}}
}
```

## Research use and responsibility

This repository is intended for legitimate research and controlled evaluation, including interpretability, alignment and refusal-behavior analysis, red-team testing, and robustness work. It is not a ready-made production safety layer. If you deploy the model or expose it to other users, you are responsible for adding suitable access controls, moderation, monitoring, and abuse prevention.

Use of these files is subject to the Apache License 2.0 and all applicable laws. You are responsible for how you operate the model and for outputs produced in your environment. To the extent permitted by law, the repository maintainers and upstream authors accept no liability for misuse or resulting harm. Generated outputs are not statements or endorsements by the maintainers, upstream creators, or their organizations.
