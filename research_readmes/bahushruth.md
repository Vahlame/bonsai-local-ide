---
license: apache-2.0
base_model: Qwen/Qwen3.6-35B-A3B
tags:
  - abliteration
  - uncensored
  - qwen3
  - moe
  - norm-preserving
model_type: qwen3_moe
pipeline_tag: text-generation
datasets:
  - Bahushruth/abliteration-harmful-enriched
  - mlabonne/harmless_alpaca
library_name: transformers
---

# Qwen3.6-35B-A3B-abliterated-v4

Uncensored version of [Qwen/Qwen3.6-35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) with refusal behavior removed via **abliteration** (norm-preserving orthogonalization).

> **GGUF quantizations:** [Bahushruth/Qwen3.6-35B-A3B-abliterated-v4-GGUF](https://huggingface.co/Bahushruth/Qwen3.6-35B-A3B-abliterated-v4-GGUF)
>
> **Blog post:** [Abliteration: Uncensoring LLMs via Weight Surgery](https://potatospudowski.github.io/articles/abliteration)

## Results

| Metric | Original | v4 (this model) |
|--------|----------|-----------------|
| Harmful refusal rate | ~98% | **0%** (0/16) |
| Harmless prompt refusal | 0% | 0% |

Zero refusals on harmful prompts. No false refusals on harmless prompts.

## Method

Abliteration identifies the "refusal direction" in the model's residual stream — the linear direction that activates when the model decides to refuse — and surgically removes it from all output projection weights using norm-preserving orthogonalization.

| Parameter | Value |
|-----------|-------|
| Directions removed | 1 (single top layer) |
| Orthogonalization | Norm-preserving ([grimjim](https://huggingface.co/grimjim) method) |
| Harmful dataset | [Bahushruth/abliteration-harmful-enriched](https://huggingface.co/datasets/Bahushruth/abliteration-harmful-enriched) (7356 prompts, 33 categories) |
| Harmless dataset | [mlabonne/harmless_alpaca](https://huggingface.co/datasets/mlabonne/harmless_alpaca) |
| Training samples | 512 pairs |
| Compute | Modal H100 (80GB VRAM, 128GB RAM) |

### Algorithm

1. Collect residual stream activations (last token position) for 512 harmful + 512 harmless prompts across all 40 layers
2. Compute mean difference vector per layer → this is the "refusal direction" candidate
3. Score layers by `|mean(direction)|`, select the single strongest
4. Apply norm-preserving orthogonalization to remove that direction from:
   - Token embeddings (`embed_tokens`)
   - Attention output projections (`self_attn.o_proj` and `linear_attn.out_proj`)
   - Shared expert down projections (`mlp.shared_expert.down_proj`)
   - All 256 MoE expert down projections (batched 3D tensor via einsum)
5. Rescale all modified weight rows back to original norms (prevents activation magnitude decay)

### Why 1 direction + enriched dataset > 7 directions + small dataset

| Config | Refusal Rate | Capabilities |
|--------|-------------|--------------|
| 10 dirs, 520 prompts, standard ortho (v1) | 0% | Destroyed |
| 7 dirs, 520 prompts, norm-preserving (v3) | 94% | Intact |
| **1 dir, 7356 prompts, norm-preserving (v4)** | **0%** | **Intact** |

A single well-estimated direction from a diverse dataset beats many poorly-estimated directions from a narrow dataset. The enriched dataset (33 categories, multiple styles, multilingual) makes the mean-difference statistic converge to the true refusal circuit. One surgical cut > seven imprecise ones.

### Norm-preserving orthogonalization

Standard abliteration shrinks weight norms as a side effect (`||W_new|| < ||W||`). Across 40 layers this causes cascading activation decay → capability destruction. The norm-preserving fix:

```python
original_norms = weight.norm(dim=-1, keepdim=True)
proj = torch.outer(r, r)
weight = weight - proj @ weight        # remove refusal direction
new_norms = weight.norm(dim=-1, keepdim=True)
weight = weight * (original_norms / (new_norms + 1e-8))  # restore magnitude
```

The vector points somewhere new (no refusal component), but retains original confidence (same norm).

## Usage

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = "Bahushruth/Qwen3.6-35B-A3B-abliterated-v4"
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id, torch_dtype="auto", device_map="auto",
)

messages = [{"role": "user", "content": "Your prompt here"}]
text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer(text, return_tensors="pt").to(model.device)
outputs = model.generate(**inputs, max_new_tokens=512)
print(tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True))
```

## Architecture

Qwen3.6-35B-A3B is a hybrid MoE architecture:

| Property | Value |
|----------|-------|
| Total parameters | 35B |
| Active parameters/token | ~3B |
| Hidden dimension | 2048 |
| Layers | 40 (30 linear attention + 10 full self-attention) |
| Experts per MoE layer | 256 (8 active + 1 shared) |

## Version History

| Version | Method | Dataset | Refusal | Quality | Status |
|---------|--------|---------|---------|---------|--------|
| v1 (3.6) | 10-dir standard | mlabonne (520) | 0% | Destroyed | Failed |
| v3 | 7-dir norm-preserving | mlabonne (520) | 94% | Intact | Failed |
| **v4** | **1-dir norm-preserving** | **enriched (7356)** | **0%** | **Intact** | **Current** |


## Disclaimer

This model has had safety guardrails removed and will comply with requests the original model would refuse. Released for research into AI alignment and safety mechanisms. The creator assumes no responsibility for downstream use.

## Acknowledgments

- [mlabonne](https://huggingface.co/mlabonne) — abliteration technique, harmless_alpaca dataset, [original notebook](https://huggingface.co/blog/mlabonne/abliteration)
- [grimjim](https://huggingface.co/grimjim) — norm-preserving orthogonalization method
- [Qwen](https://huggingface.co/Qwen) — base model
