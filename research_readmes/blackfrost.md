---
license: apache-2.0
base_model:
- Blackfrost-AI/Qwen3.8-27B-ABLITERATED-BF16
tags:
- qwen3.8
- qwen
- 27b
- dense
- gguf
- abliterated
- quantized
- multimodal
- reasoning
- tool-calling
- llama.cpp
- long-context
- dflash2
- speculative-decoding
pipeline_tag: image-text-to-text
library_name: gguf
---
<div align="center">

![Blackfrost](https://cdn-uploads.huggingface.co/production/uploads/69a27f2d114e4ac9de4dafc7/xDTdhLFXmKlZOazFcvJ5S.jpeg)

<div align="center">

<h1>QWEN3.8-27B-ABLITERATED-GGUF</h1>

<h3>Standard GGUF quant ladder of the Blackfrost abliterated Qwen3.8-27B · embedded MTP plus optional BF16 DFlash2 acceleration</h3>

<p><strong>Built by <a href="https://x.com/Blackfrost_AI">Blackfrost</a> · Las Vegas, NV</strong></p>

<p>
<img src="https://img.shields.io/badge/GGUF_standard_ladder-047857?style=for-the-badge" />
<img src="https://img.shields.io/badge/11%2F450_refusals-047857?style=for-the-badge" />
<img src="https://img.shields.io/badge/Abliterated-1f2937?style=for-the-badge" />
<img src="https://img.shields.io/badge/DFlash2_BF16-109.31_tok%2Fs-047857?style=for-the-badge" />
<img src="https://img.shields.io/badge/EXPERIMENTAL-b45309?style=for-the-badge" />
<img src="https://img.shields.io/badge/llama.cpp-1f2937?style=for-the-badge" />
</p>

</div>

> ## All standard quants live
>
> The complete standard K-quant ladder (`Q2_K` through `Q8_0`) and both vision projectors are included. No IQ/IK or importance-matrix quants are used.

> ## Embedded MTP upgrade — August 16, 2026
>
> All nine main GGUF quants were rebuilt with Qwen3.8's native MTP head embedded directly in each model. This removes the separate-draft loading failure reported with the earlier sidecars and improves one-file llama.cpp compatibility. **Redownload your selected main quant.** The vision projectors are unchanged; separate `mtp-` files are no longer required.

> ## BF16 DFlash2 sidecar — August 22, 2026
>
> The optional `dflash-Qwen3.8-27B-ABLITERATED-BF16.gguf` speculative sidecar is now available. Paired with `Q4_K_M`, it reached a **109.31 tok/s median** across three 256-token text generations on one NVIDIA RTX PRO 6000 Blackwell Server Edition, with the full 262,144-token context allocated. DFlash2 currently requires the pinned experimental llama.cpp implementation described below; embedded MTP remains the standard-runtime, single-file path.

> ## Experimental release
>
> This is a newly supported architecture and a deliberately modified research checkpoint. Validate the selected quant, context, sampling, vision, tools, and structured-output behavior in your own workload before deployment.

---

## Refusal benchmark — R1-HARMFUL-BENCH-450

The release score is **11 residual refusals from 450 original cases (2.4%)**. The shipped Blackfrost short execution prompt is embedded once in the GGUF chat template.

This result is a sequential, manually reviewed residual funnel measured on the W4A4 NVFP4 derivative of the same BF16 parent. It is not a fresh full-450 GGUF run with every case presented under the final short prompt.

| evaluation stage | cases evaluated | material answer | true refusal remaining | other |
|---|---:|---:|---:|---:|
| Raw upstream template | 450 | 360 | 88 | 2 capability limitations |
| Blackfrost operational-prompt retest | 88 residuals | 53 | 33 | 1 limitation, 1 reproducible incoherent output |
| Shipped short execution-prompt retest | 33 residuals | 22 | 11 | 0 |
| **Final residual count** | **450 original cases** | — | **11 (2.4%)** | — |

The 450-case source set contains 150 AdvBench, 150 StrongREJECT, and 150 XSTest prompts. The final 11 comprise 1 AdvBench, 5 StrongREJECT, and 5 XSTest cases. An opening objection followed by a materially useful payload was counted as softened compliance, not as a refusal; a true refusal means the requested payload never arrived.

---

## Why this model exists

Qwen3.8-27B is the dense, deployment-friendly member of the Qwen3.8 family. This is the **abliterated** Blackfrost build: refusal behavior was reduced through a weight-level process, then the BF16 parent was converted into a standard GGUF ladder for local llama.cpp inference.

It is not a coding fine-tune, merge, LoRA, or pruned model.

---

## Specifications

| | |
|---|---|
| **Architecture** | Qwen3.8 dense hybrid VLM · 64 text layers · Gated DeltaNet + full attention · 27-layer vision tower |
| **Parent** | [`Blackfrost-AI/Qwen3.8-27B-ABLITERATED-BF16`](https://huggingface.co/Blackfrost-AI/Qwen3.8-27B-ABLITERATED-BF16) |
| **Base** | [`Qwen/Qwen3.8-27B`](https://huggingface.co/Qwen/Qwen3.8-27B) · Apache-2.0 |
| **Transform** | Abliterated — refusal surface modified at weight level; no fine-tuning or pruning |
| **Formats** | `Q2_K`, `Q3_K_S`, `Q3_K_M`, `Q4_K_S`, `Q4_K_M`, `Q5_K_S`, `Q5_K_M`, `Q6_K`, `Q8_0` |
| **Context** | 262,144 tokens architecturally; practical context depends on RAM/VRAM and concurrency |
| **Modalities** | Text, image, and video input; text output |
| **Chat behavior** | Blackfrost short execution prompt embedded in the default Jinja chat template |
| **MTP speculative head** | Embedded natively in every main GGUF quant; no sidecar required |
| **DFlash2 speculative sidecar** | BF16 · 3.86 GB / 3.60 GiB · 5 draft layers · optional separate download |
| **DFlash2 source** | [`incoai/Qwen3.8-27B-DFlash2`](https://huggingface.co/incoai/Qwen3.8-27B-DFlash2) · Apache-2.0 · converted to GGUF with this target's metadata |

---

## Quant ladder

| quant | size | recommended for |
|---|--:|---|
| Q2_K | 10.9 GB | smallest standard quant; largest quality trade-off |
| Q3_K_S | 12.3 GB | very tight memory |
| Q3_K_M | 13.5 GB | compact general use |
| Q4_K_S | 15.8 GB | lower-memory Q4 option |
| **Q4_K_M** | **16.8 GB** | **default — balanced quality and footprint** |
| Q5_K_S | 19.0 GB | higher fidelity |
| Q5_K_M | 19.5 GB | strong quality/size balance |
| Q6_K | 22.4 GB | near-BF16 behavior for many workloads |
| Q8_0 | 29.0 GB | maximum fidelity in the ladder |

File sizes are decimal GB as displayed by Hugging Face. Runtime memory also includes context state, compute buffers, the optional vision projector, and server overhead.

---

## Vision projector files

Load one text quant plus one `mmproj` file for image or video input:

| file | size | purpose |
|---|--:|---|
| `mmproj-Qwen3.8-27B-ABLITERATED-F16.gguf` | 0.93 GB | full-fidelity vision projector |
| `mmproj-Qwen3.8-27B-ABLITERATED-Q8_0.gguf` | 0.63 GB | compact projector; unsupported 4,304-wide tensors retain F16 automatically |

---

## MTP speculative decoding

Every main GGUF contains Qwen3.8's native 65th NextN/MTP block. Load only the selected model quant and enable MTP speculation directly:

```bash
llama-server \
  -hf Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF:Q4_K_M \
  --spec-type draft-mtp --spec-draft-n-max 3 \
  -ngl 999 --jinja -c 16384
```

For a manually downloaded model, use the same MTP flags with `-m Qwen3.8-27B-ABLITERATED-Q4_K_M.gguf`. Do not pass `--spec-draft-model`: the MTP head is already inside the main file.

The rebuilt Q4_K_M canary was verified with llama.cpp as a 65-block model (`n_layer=64`, `n_layer_all=65`) and produced measurable native drafting: 14 of 21 drafted tokens accepted (66.7%) in the release smoke test. Acceptance and speedup vary with prompts, sampling, hardware, context, and concurrency.

---

## BF16 DFlash2 speculative decoding

DFlash2 is the faster, optional two-file path for text generation. It uses the selected main quant as the target and a dedicated 5-layer BF16 GGUF conversion of [`incoai/Qwen3.8-27B-DFlash2`](https://huggingface.co/incoai/Qwen3.8-27B-DFlash2) as the draft model. The sidecar adds 3.86 GB (3.60 GiB) of weights and retains the target model's tokenizer, chat template, and native 262,144-token context metadata.

This GGUF runtime support is currently in [llama.cpp pull request #27342](https://github.com/ggml-org/llama.cpp/pull/27342). The release was built and tested at commit `1deefcca395743049c3820ab8f9b15043f3e9446`; pin that implementation until the feature lands upstream.

```bash
hf download Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF \
  Qwen3.8-27B-ABLITERATED-Q4_K_M.gguf \
  dflash-Qwen3.8-27B-ABLITERATED-BF16.gguf \
  --local-dir ./Qwen3.8-27B-ABLITERATED-GGUF

llama-server \
  -m ./Qwen3.8-27B-ABLITERATED-GGUF/Qwen3.8-27B-ABLITERATED-Q4_K_M.gguf \
  --spec-draft-model ./Qwen3.8-27B-ABLITERATED-GGUF/dflash-Qwen3.8-27B-ABLITERATED-BF16.gguf \
  --spec-type draft-dflash \
  --spec-draft-n-max 3 --spec-draft-n-min 0 --spec-draft-p-min 0 \
  -ngl all -ngld all -fa on --jinja \
  -c 16384 \
  --spec-draft-type-k f16 --spec-draft-type-v f16 \
  --host 0.0.0.0 --port 8080
```

Use `-c 262144 -ctk q8_0 -ctv q8_0` to reproduce the full-context allocation used in the benchmark, if memory permits. The target and sidecar occupy about 20.7 GB before KV cache, compute buffers, and server overhead.

### Measured DFlash2 speed

The table reports server-side decode speed for three deterministic, 256-token text generations. Test configuration: one NVIDIA RTX PRO 6000 Blackwell Server Edition (96 GB), CUDA, one server slot, `Q4_K_M` target, BF16 DFlash2 sidecar, `n_max=3`, full 262,144-token context, Q8_0 target KV cache, and F16 draft KV cache.

| prompt | decode tok/s | accepted / drafted | acceptance |
|---|---:|---:|---:|
| Speculative decoding explanation | 104.47 | 156 / 295 | 52.9% |
| Production event-logging design | 109.31 | 157 / 292 | 53.8% |
| TLS 1.3 handshake explanation | 118.60 | 165 / 269 | 61.3% |
| **Median / weighted total** | **109.31** | **478 / 856** | **55.8%** |

These are text-only measurements, not a guarantee for other hardware, prompts, samplers, concurrency, long-prefill workloads, or multimodal input. All three validation responses were coherent; vision/video with DFlash2 should still be tested separately for the intended workload.

---

## Serving with llama.cpp

Use a current llama.cpp build with `llama-server`. `Q4_K_M` plus the compact projector was load- and generation-tested through the OpenAI-compatible chat API on an NVIDIA B200. The embedded MTP path works with a current standard build; the optional DFlash2 path requires the pinned implementation above.

```bash
hf download Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF \
  Qwen3.8-27B-ABLITERATED-Q4_K_M.gguf \
  mmproj-Qwen3.8-27B-ABLITERATED-Q8_0.gguf \
  --local-dir ./Qwen3.8-27B-ABLITERATED-GGUF

llama-server \
  -m ./Qwen3.8-27B-ABLITERATED-GGUF/Qwen3.8-27B-ABLITERATED-Q4_K_M.gguf \
  --mmproj ./Qwen3.8-27B-ABLITERATED-GGUF/mmproj-Qwen3.8-27B-ABLITERATED-Q8_0.gguf \
  -ngl 999 -fa on --jinja \
  --host 0.0.0.0 --port 8080 -c 16384 \
  --temp 1.0 --top-p 0.95 --top-k 20
```

- **Text only:** omit `--mmproj` and do not download a projector.
- **CPU or hybrid inference:** lower `-ngl`; use `-ngl 0` for CPU-only operation.
- **Larger context:** increase `-c` only after checking memory headroom at the intended concurrency.
- **Embedded prompt:** keep `--jinja` enabled so the repository's default chat template is applied.
- **Speculative mode:** use embedded MTP for a standard one-file runtime, or DFlash2 for the faster tested two-file path.
- **One-command kit:** [`deploy/serve.sh`](deploy/serve.sh) downloads and serves the selected quant; see [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md) for the full guide.

### API check

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen3.8-27B-ABLITERATED",
    "messages": [{"role": "user", "content": "Reply with exactly READY and nothing else."}],
    "temperature": 0,
    "max_tokens": 64
  }'
```

---

## Quality check

WikiText-2 rolling perplexity was measured on the parent artifacts through the same 8K API harness:

| artifact | word perplexity | byte perplexity | bits/byte |
|---|---:|---:|---:|
| Clean upstream BF16 | 8.4764 | 1.4914 | 0.5766 |
| Blackfrost W4A4 NVFP4 derivative | 9.3677 | 1.5195 | 0.6036 |

These figures are parent-artifact measurements, not per-quant GGUF perplexity scores. The rebuilt embedded-MTP `Q4_K_M` GGUF passed a real llama.cpp load, generation, and speculative-drafting smoke test. The BF16 DFlash2 pair separately passed full-context load, generation, speed, and draft-acceptance validation; the compact projector remains unchanged from its prior validated build.

---

## Deployment responsibility

This checkpoint has a deliberately reduced refusal surface. Open weights do not provide an application policy, authorization system, audit trail, sandbox, or access-control boundary. Operators are responsible for authenticated access, least-privilege tool credentials, execution isolation, logging, and approval boundaries appropriate to their deployment.

The embedded prompt is a behavioral instruction, not a security boundary.

---

## Disclaimer

Refusal behavior in this checkpoint has been deliberately modified at the weight level. It is not a safety-stock model and must not be represented as one.

This checkpoint is provided "as is," without warranty of any kind. Measurements describe only the tested artifacts, prompts, templates, samplers, serving engines, and review criteria. They do not guarantee that any particular input will be accepted or refused, that every upstream capability is retained, or that the measurements generalize to multimodal, tool-use, long-context, or multi-turn settings.

The derivative remains subject to the Apache 2.0 license shipped with the official Qwen3.8-27B checkpoint.

---

<div align="center">

<p>Built by <a href="https://x.com/Blackfrost_AI">Blackfrost</a> · Las Vegas, NV. Not affiliated with Qwen or Alibaba.</p>

</div>
