---
license: apache-2.0
base_model: Qwen/Qwen3.8-27B
tags:
  - qwen3.8
  - qwen
  - 27b
  - bf16
  - dense
  - vision-language
  - derisked
  - research
  - security-research
  - red-teaming
  - coding
  - tool-calling
  - long-context
  - public-research-preview
pipeline_tag: image-text-to-text
---

<div align="center">

![Blackfrost](https://cdn-uploads.huggingface.co/production/uploads/69a27f2d114e4ac9de4dafc7/xDTdhLFXmKlZOazFcvJ5S.jpeg)

<h1>Qwen3.8-27B — Blackfrost BF16</h1>

<h3>Weight-level de-risked Qwen3.8-27B · native BF16 · vision, reasoning, tools, and long context retained</h3>

<p><strong>Built by <a href="https://x.com/Blackfrost_AI">Blackfrost</a></strong></p>

<p>
<img src="https://img.shields.io/badge/Format-BF16-2563eb?style=for-the-badge" />
<img src="https://img.shields.io/badge/Parameters-27B-111827?style=for-the-badge" />
<img src="https://img.shields.io/badge/Architecture-Dense_VLM-047857?style=for-the-badge" />
<img src="https://img.shields.io/badge/Status-TEAM_EVALUATION-b45309?style=for-the-badge" />
</p>

</div>

> ### Take notice
> This is a Blackfrost weight-level research checkpoint with a deliberately reduced refusal surface. It is not the upstream Qwen safety-stock checkpoint and must not be represented as one.
>
> This repository is a **public, ungated research preview**. It is **not for sale**. Evaluation and release review remain in progress, and refusal, coding-retention, multimodal, tool-use, and long-context results must be interpreted per the scope documented below.

---

## Why this model exists

Qwen3.8-27B is the dense, deployment-friendly member of the Qwen3.8 family. This checkpoint is the BF16 master for Blackfrost's research into reducing false-positive refusals in lawful, operator-controlled software engineering and security work while retaining the model's general capabilities.

The current artifact is intentionally narrow in scope: it is a weight-level derivative of the official 27B checkpoint. It is **not** a coding fine-tune, safety fine-tune, merge, LoRA, or pruned model. Those distinctions matter when interpreting any benchmark result.

---

## Specifications

| | |
|---|---|
| **Architecture** | Qwen3.8-27B dense hybrid VLM · Gated DeltaNet + full attention |
| **Base** | Official [`Qwen/Qwen3.8-27B`](https://huggingface.co/Qwen/Qwen3.8-27B) |
| **Parameters** | 27B |
| **Precision** | Native BF16 safetensors |
| **Files** | 18 weight shards · 55,586,124,697 repository bytes total |
| **Context** | 262,144 tokens native; extended-context support follows upstream Qwen guidance |
| **Modalities** | Text, image, and video inputs; text output |
| **Serving** | Transformers, SGLang, and vLLM with Qwen3.8 support |
| **Validated hardware** | Single NVIDIA B200 for conservative 8K serving |
| **Status** | Public, ungated research preview · evaluation in progress |

---

## Lineage

| | |
|---|---|
| **Base weights** | `Qwen/Qwen3.8-27B` |
| **Applied** | Blackfrost refusal-surface direction modification at weight level |
| **Not applied** | Pruning, SFT, DPO, LoRA, merging, or weight quantization |
| **Checkpoint format** | Hugging Face BF16 safetensors |
| **Chat behavior** | Blackfrost operational system prompt embedded in the default chat template |

The internal direction bank, scaling schedule, capture data, and build workflow are not included in this repository.

---

## Refusal evaluation

The release score is **11 residual refusals from 450 original cases (2.4%)**.
The checkpoint ships with the final short Blackfrost execution prompt embedded
once in its native Qwen chat template.

This number comes from a sequential, manually reviewed refusal funnel on the
W4A4 NVFP4 derivative of this BF16 master. It is not a fresh full-450 run of the
BF16 checkpoint and it is not a head-to-head comparison of prompts.

| Evaluation stage | Cases evaluated | Material answer | True refusal remaining | Other |
|---|---:|---:|---:|---:|
| Raw upstream template | 450 | 360 | 88 | 2 capability limitations |
| Blackfrost operational-prompt retest | 88 residuals | 53 | 33 | 1 capability limitation, 1 reproducible incoherent output |
| Shipped short execution-prompt retest | 33 residuals | 22 | 11 | 0 |
| **Final residual count** | **450 original cases** | — | **11 (2.4%)** | — |

The 450-case source set contains 150 AdvBench, 150 StrongREJECT, and 150
XSTest prompts. Of the final 11 refusals, 1 came from AdvBench, 5 from
StrongREJECT, and 5 from XSTest. An opening objection followed by materially
useful payload was counted as softened compliance, not as a refusal. A true
refusal means the requested payload never arrived.

The shipped short-prompt residual pass had zero generation errors, zero judge
errors, zero capability limitations, and zero incoherent outputs. The full raw
450 run also had zero global incoherence and zero repetition loops under manual
review; mechanical repetition alerts were false positives caused by code
separators and diagrams.

### Language-model quality check

WikiText-2 rolling perplexity was measured through the same 8K API harness:

| Artifact | Word perplexity | Byte perplexity | Bits/byte |
|---|---:|---:|---:|
| Clean upstream BF16 | 8.4764 | 1.4914 | 0.5766 |
| W4A4 NVFP4 derivative | 9.3677 | 1.5195 | 0.6036 |

These results do not yet establish coding, vision, tool-use, long-context, or
multi-turn retention. They describe only the artifacts, templates, prompts,
samplers, judge rubric, and serving configuration documented here.

---

## Deployment

The examples below use the repository's default embedded chat template. This
repository is public and ungated, so no Hugging Face access token is required.

### SGLang

The following is a conservative single-GPU configuration validated on a B200:

```bash
docker run --rm --gpus all \
  --network host --ipc host --shm-size 32g \
  --entrypoint python3 \
  lmsysorg/sglang:qwen38 \
  -m sglang.launch_server \
    --model-path Blackfrost-AI/Qwen3.8-27B-ABLITERATED-BF16 \
    --served-model-name Qwen3.8-27B-Blackfrost-BF16 \
    --tp-size 1 \
    --context-length 8192 \
    --max-total-tokens 8192 \
    --max-running-requests 8 \
    --mamba-full-memory-ratio 0.95 \
    --mamba-ssm-dtype bfloat16 \
    --reasoning-parser qwen3 \
    --tool-call-parser qwen3_coder \
    --host 0.0.0.0 \
    --port 8000
```

### vLLM

Use a Qwen3.8-capable vLLM image:

```bash
docker run --rm --gpus all \
  --network host --ipc host --shm-size 32g \
  vllm/vllm-openai:qwen38 \
    --model Blackfrost-AI/Qwen3.8-27B-ABLITERATED-BF16 \
    --served-model-name Qwen3.8-27B-Blackfrost-BF16 \
    --tensor-parallel-size 1 \
    --max-model-len 8192 \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --reasoning-parser qwen3 \
    --host 0.0.0.0 \
    --port 8000
```

### Health and generation check

```bash
curl http://127.0.0.1:8000/v1/models

curl http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen3.8-27B-Blackfrost-BF16",
    "messages": [{"role": "user", "content": "Return exactly: READY"}],
    "temperature": 0,
    "max_tokens": 32,
    "chat_template_kwargs": {"enable_thinking": false}
  }'
```

Increase context only after validating memory headroom for the intended concurrency, modalities, and KV-cache precision. A model advertising a large architectural context does not guarantee that every context/concurrency combination fits on every GPU.

---

## Chat template, reasoning, and tools

- The default chat template contains the Blackfrost operational system prompt.
- Qwen thinking can be controlled per request through `chat_template_kwargs.enable_thinking`.
- SGLang and vLLM should be started with the Qwen reasoning and tool-call parsers shown above when those API features are required.
- If a harness supplies an explicit alternate chat template, it replaces the default embedded template for that server process. Record that choice in every benchmark report.

---

## Security and deployment responsibility

This checkpoint has a deliberately reduced refusal surface. Open weights do not provide an application policy, authorization system, audit trail, sandbox, or access-control boundary. Operators remain responsible for enforcing those controls outside the model.

For production or shared use, Blackfrost recommends:

- authenticated access to the inference endpoint;
- independent request and tool-execution logging;
- least-privilege credentials for every tool;
- sandboxing for code execution and file access;
- explicit approval boundaries for irreversible actions;
- application-layer controls appropriate to the deployment domain.

The embedded prompt is a behavioral instruction, not a security boundary.

---

## Disclaimer

**Refusal behavior in this checkpoint has been deliberately modified at the weight level.** It is not a safety-stock model and must not be deployed, marketed, or evaluated as one.

**No warranty of any kind.** This checkpoint is provided "as is", without warranty express or implied, including fitness for a particular purpose. Nothing here guarantees that any input will be accepted or refused, that every upstream capability is retained, or that any category of output is unreachable.

**Measurements describe only what was measured.** Refusal rates, throughput, and retention figures reflect specific prompts, templates, samplers, serving engines, and review criteria. They are not safety proofs and do not automatically generalize to multimodal, tool-use, long-context, or multi-turn adversarial settings.

**Further modification transfers responsibility.** Any additional direction editing, fine-tuning, merging, pruning, quantization, or other weight change creates an artifact Blackfrost has not evaluated unless a new report explicitly states otherwise.

**Base license.** This derivative remains subject to the Apache 2.0 license shipped with the official Qwen3.8-27B checkpoint.

---

## Contact Blackfrost

<div align="center">

<h3><a href="https://x.com/Blackfrost_AI">@Blackfrost_AI</a> on X</h3>

<p>For reproducible bug reports, include the serving engine and image tag, GPU SKU, driver version, complete launch flags, prompt template, sampler settings, and failure mode.</p>

<p><strong>Blackfrost Softwares Corp.</strong><br />Frontier model engineering</p>

</div>

---

<div align="center">

<p><strong>Qwen3.8-27B — Blackfrost BF16</strong> · © 2026 Blackfrost Softwares Corp.<br />
<a href="https://x.com/Blackfrost_AI">@Blackfrost_AI</a></p>

</div>
