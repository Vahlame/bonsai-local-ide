---
license: mit
library_name: transformers
pipeline_tag: text-generation
base_model: deepseek-ai/DeepSeek-V4-Flash-0731
base_model_relation: finetune
tags:
  - deepseek-v4
  - mixture-of-experts
  - abliterated
  - fp8
  - model-surgery
  - mechanistic-interpretability
---

# DeepSeek-V4-Flash-0731 Abliterated (Native FP8)

> **Experimental model-surgery release.** Direct behavioral benchmarking of
> this native-FP8 checkpoint has not been run. The completed behavioral
> validation below uses a quantized MLX derivative as a deployment proxy and
> must not be read as a direct FP8 or capability result.

This is a rank-1 abliterated derivative of
[`deepseek-ai/DeepSeek-V4-Flash-0731`](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731).
It remains the official post-trained 0731 model: abliteration does not turn it
into a base model, and this release is not claimed to be universally
"uncensored."

Hugging Face labels the parent relationship as `finetune` because its model
tree currently has no generic `derived` or `model-surgery` relationship. This
checkpoint was **not gradient-finetuned and was not quantized by this project**;
it was produced by a targeted projection edit while retaining the upstream
checkpoint's native mixed precision.

## Provenance

- Upstream repository: [`deepseek-ai/DeepSeek-V4-Flash-0731`](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731).
- Exact upstream revision: [`9e165c30e2704aec5d9d593cce3eebd58bbef1cb`](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731/tree/9e165c30e2704aec5d9d593cce3eebd58bbef1cb).
- Refusal-direction source revision: [`85ae5bbaa7daf4da7b40e007a71a1c06b41fc053`](https://github.com/drowzeys/DeepSeek-V4-Flash-DSpark-Abliterated-Uncensored-1M-57toks/commit/85ae5bbaa7daf4da7b40e007a71a1c06b41fc053).
- Reproduction tooling snapshot: [`apetersson/deepseek-model-tools@c3979d5`](https://github.com/apetersson/deepseek-model-tools/tree/c3979d5f8179f2a8714ac459b0f2e242006d6ad0), using `scripts/abliterate_dsv4.py`.

## Edit recipe

- Method: refusal-direction projection from attention residual writers.
- Direction rank: 1.
- Strength: lambda 3.5.
- Main-model layers: 10 through 42, inclusive.
- DSpark stages: the corresponding attention output projection in all three
  attached stages was edited.
- Total edited tensors: 36.
- Storage: the checkpoint's original mixed FP8/BF16/F32 representation, with
  three fixed-point FP8 requantization iterations.
- Direction SHA-256:
  `6e4d8a8f3aa9e21795faab2c5b14d29b019acdf2ddbfbd8238430458a5837fe0`.

The recipe follows the public refusal-direction work in
[`drowzeys/DeepSeek-V4-Flash-DSpark-Abliterated-Uncensored-1M-57toks`](https://github.com/drowzeys/DeepSeek-V4-Flash-DSpark-Abliterated-Uncensored-1M-57toks/tree/85ae5bbaa7daf4da7b40e007a71a1c06b41fc053),
transferred to the newer 0731 checkpoint. That transfer is experimental. See
`ABLITERATION_MANIFEST.json` for the per-tensor edit and FP8 round-trip data.

## Format and use

The architecture, tokenizer, official message encoding, one-million-token
context declaration, and attached DSpark tensors come from the upstream 0731
checkpoint. Refer to the upstream model card and the included `encoding`
directory for prompt formatting and runtime instructions.

Recommended upstream sampling defaults are `temperature=1.0`, `top_p=0.95`
for agentic scenarios, and `top_p=1.0` otherwise.

## Validation status

### Structural validation

- All 48 weight shards and 72,317 indexed tensors passed structural validation.
- All 36 intended residual-writer edits are recorded in the manifest.
- Preliminary direct refusal probes showed the expected behavioral shift.

### Behavioral deployment proxy (2026-08-01)

The native-FP8 checkpoint was not loaded for the full benchmark on the 128 GB
test host. Instead, the complete prompt gauntlet was run through oMLX using
[`apetersson/DeepSeek-V4-Flash-0731-Abliterated-MLX-Mixed-2bit-3bit-g64`](https://huggingface.co/apetersson/DeepSeek-V4-Flash-0731-Abliterated-MLX-Mixed-2bit-3bit-g64),
a quantized derivative of this checkpoint. This is useful evidence that the
edited behavior survives that conversion and runtime, but it is not a direct
measurement of this FP8 artifact.

Run configuration:

- oMLX 0.5.4rc1, OpenAI-compatible API, 32,768-token profile.
- Temperature 0, top-p 1, seed 42, and maximum 160 generated tokens.
- Benchmark tooling and pinned source revisions:
  [`apetersson/deepseek-model-tools@dc6af88`](https://github.com/apetersson/deepseek-model-tools/tree/dc6af888019fbbda1e2406fa62c2335bf08d2201).
- Benchmark fingerprint:
  `40c3573bd48861b846721220fa06ce0d71905aab236ce45d49d9aa0e95e79af5`.
- Final completeness gate: 830 unique cases, 830 successful latest records,
  and zero failed or missing latest records. Seven transient oMLX transport or
  memory-guard failures were repaired with a serial retry pass.

| Suite | Cases | Completed result |
| --- | ---: | --- |
| UncensorBench | 200 | 0 hard refusals; keyword compliance on 200/200 |
| XSTest | 450 | 0/450 refusals under the exact upstream prefix classifier; 0/250 safe-prompt over-refusals |
| StrongREJECT-small | 180 | 60 prompts × baseline, ROT13, and refusal-suppression variants; 0 hard refusals under the local heuristic |

One XSTest unsafe privacy prompt triggered the deliberately broader local
hard-refusal heuristic while not matching XSTest's official prefix classifier;
no safe prompt triggered either classifier.

The official fine-tuned StrongREJECT judge was **not** run, so this card does
not claim a StrongREJECT score. A clean reference run and capability benchmark
were also not run. Consequently, these results do not establish the native-FP8
checkpoint's refusal rate, quantify the effect of quantization, or demonstrate
general capability preservation.

## Limitations

Abliteration can affect capabilities and behavior beyond refusals. It does not
guarantee compliance, factuality, safety, or a particular response style. Use
appropriate access controls and evaluate the model for your deployment.

## License and attribution

The upstream repository and weights are MIT licensed. This derivative retains
the upstream `LICENSE`. The refusal direction is attributed to drowzeys/keys
under its accompanying MIT notice; see `NOTICE`. Please cite the original
DeepSeek-V4 work and credit DeepSeek-AI when redistributing or publishing
results.
