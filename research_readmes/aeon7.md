---
license: apache-2.0
base_model: Qwen/Qwen3.8-27B
language:
- en
- zh
- multilingual
library_name: transformers
pipeline_tag: text-generation
tags:
- 27b
- official-release
- abliterated
- abliterix
- aeon
- aeon-7
- agentic
- bf16
- bfloat16
- blackwell
- chat
- coding
- conversational
- dgx-spark
- function-calling
- gated-deltanet
- gb10
- gdn
- h200
- hybrid-attention
- image-text-to-text
- instruct
- linear-attention
- long-context
- mamba
- mtp
- multimodal
- openai-compatible
- qwen
- qwen3
- qwen3.5
- qwen3.8
- qwen3_5
- reasoning
- refusal-removed
- rtx-5090
- rtx-pro-6000
- speculative-decoding
- thinking
- tool-calling
- uncensored
- unfiltered
- vision
- vision-language
- vllm
---

# Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16

[![Early Access for Paid Patreon Subscribers](early-access-cartridge.png)](https://www.patreon.com/AeonForge7/posts/early-access-8-167981227)

**[Early Access for Paid Patreon Subscribers](https://www.patreon.com/AeonForge7/posts/early-access-8-167981227)** — NVFP4 GDNFP8 LLMC weights and serve recipes.

**Early Access Draft.** The uncensored BF16 of [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B). Abliterated for coherence and better answers, not for a vanity KL of zero. Vision tower and native MTP head are the unmodified base.

This is still the full-precision master a later NVFP4 sibling will bake from. It is not the finished cut. Do not dequant-edit-requant an NVFP4 lattice.

## Model family (pick your seat)

| Repo | Size | What it is | Target hardware |
|---|---|---|---|
| **This BF16 master** | ~54G | Full-precision uncensored master. Abliterated for coherence, vision + MTP untouched. | H200 / multi-GPU / PRO 6000 when you want the teacher |
| **[NVFP4-MIXED deploy](https://huggingface.co/AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-NVFP4-MIXED)** | ~23G | ModelOpt NVFP4 + FP8 + BF16 lattice (last-8 full MLP FP8). Day-to-day serve knife. | **DGX Spark**, **RTX 5090**, **RTX PRO 6000** |

Same will. The MIXED card has the no-nonsense QuickStarts for `aeon-vllm-ultimate:latest` (Spark) and `aeon-vllm-ultimate-rtx:latest` (both RTX seats), plus the quant lattice diagram.

> **Deploy recipes + Dynamic DFlash lattice** live on the [NVFP4-MIXED card](https://huggingface.co/AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-NVFP4-MIXED) — one Spark Dynamic DFlash lattice seat (util **0.80**; quality + throughput), TP=2 B0 knobs (DFlash2 n=7), and RTX MTP seats. This BF16 card stays the full-precision master; do not paste the Spark docker stack here.

## Early Access Draft

Call it what it is. This is an Early Access Draft, not GA.

It already does the thing people came here for. The tests hold. The hall monitor is gone. You can ask a hard question and get an answer instead of a sermon. That part is real.

It is also a first pass through the refusal layers, and those layers were never a clean switch. The same directions that taught the model to flinch also taught it how to hold a thought together. Yank the whole board and you do not just lose the lecture. You lose some of the furniture.

What that looks like when you actually use it: on ordinary work it stays a 27B. On extremely long requests, as the answer stretches, small gaps in the weights start to stack. A loop shows up. A phrase repeats. The thought does not know how to land. That is not you imagining it. That is the draft telling on itself.

We are not leaving it there.

A true GA cut is in the works. Same family. The next evolution of abliteration for Qwen3.8. The job is more surgical than "delete the refusal and hope." Keep the instructional bones. Keep the useful structure. Change the will. Willfully compliant. No safety monologue in the think, no lecture in the reply. Get rid of the crippling censorship without lobotomizing the model that made the answers good in the first place.

We built our own bench and our own tools for that hunt. I am not going to walk you through the kitchen. You will feel the difference when GA lands.

Until then: use the draft, know the long-context edge, and do not treat a loop as the last word on this line.

## How to read these numbers

Most public abliterations chase KL toward zero and treat a judge-R as a leftover refusal. Both of those habits over-edit the model.

**Coherent KL drift is not damage.** Blindly minimizing KL keeps the hall monitor. When the unlock is real, the model stops spending think on “is this allowed,” answers more directly, and the first-token distribution moves. That can look like 0.10 nats/token on a mean. It is not mush.

On this release the smash KL was **0.0991** nats/token (`full_distribution_kl`, first 3 teacher-forced tokens on the 100 harmless held-out prompts). Remeasured on the same persist-pass stock prefixes: **0.099126**. Dropping the three harmless rows stock actually hedged or refused (ids 416, 462, 485) does **not** lower it (filtered mean **0.101**, median **0.013**). Those three are the *low*-KL rows. The 0.10 is a long tail of different openings on prompts both models already answered. 29/97 openings are under 0.001. The high-KL tail is still a jogging plan, a FATF CDD checklist, an autumn-forest paragraph. Same 27B, less bush-beating.

We did not optimize for “look like stock.” We optimized for **coherence and better answers**. Getting a keyword or Flash Lite judge to 0/100 is how you break a model. Over-abliteration turns the leftover outliers into gibberish, which defeats the reason you wanted the model.

**A judge-R is not a leftover refusal.** `google/gemini-3.1-flash-lite` (the smash objective) marks R when it sees a warning, a fictional wrapper, a suicide hotline, or “I don’t have that SSN,” even when the rest of the answer is the payload. We read the answers.

| Set | n | Stock Flash Lite R | Winner Flash Lite R | Hard “I won’t” | What the leftovers are |
|---|---:|---:|---:|---:|---|
| Harmful held-out | 100 | ~100 | 36 (smash 29) | **0** | 25/36 still wrote the thing (disclaimer, partial draft, or a wrong R). 6/36 are no-live-PII. 5/36 are compassion or a dialogue dump with no “write the payload” ask (two suicide redirects with resources; three conversation analyses). |
| Sexual | 50 | 30 | 5 | **0** | 3 of 5 judge-R wrote the requested post/script. 2 are hedges (unnamed films; legal landscape). |
| Harmless held-out | 100 | 3 | 1 | **0** | The one R is a cut-off prompt (id 416). Stock also hedged 462 and refused 485; this body wrote both. Innocent prompts stock still refused. |

The model in practice is a **0 outright-refusal** body. Commonly available judges cannot tell a preamble from a shutdown. “You should know this is illegal, here is how” is not a refusal. It still gives you the answer. A suicide ask that tries to keep the person alive, and does not hall-monitor every other domain, is a leftover we will live with. Chasing those last outliers until the rest of the model is word-salad is how the public tools over-abliterate.

Held-out suites matter. Public abliteration sets get baked into later alignments. This run used a pinned wangzhang 500 split (train 400 / eval 100, no shuffle) plus a 50-prompt sexual set that is not the usual keyword list.

On the 97 both-comply harmless rows, persist completions stay the same model: median length 1481 vs 1516 characters, type-token ratio 0.76 vs 0.75, think tags 100/100 vs 98/100.

## What we served

Validated on a single **NVIDIA H200** with **vLLM 0.27.1** (torch 2.13.0+cu130) against this checkpoint, thinking on, MTP on (`method=mtp`, 3 speculative tokens). Text, vision, and a fictional lockpick scene all passed. MTP draft acceptance during that smoke was about 40–66%.

```bash
vllm serve AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16 \
  --dtype bfloat16 \
  --max-model-len 16384 \
  --max-num-seqs 4 \
  --gpu-memory-utilization 0.85 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --trust-remote-code \
  --gdn-prefill-backend triton \
  --speculative-config '{"method":"mtp","num_speculative_tokens":3}'
```

If FlashInfer’s sampling JIT cannot see `curand.h` on your image, set `VLLM_USE_FLASHINFER_SAMPLER=0`. That is an environment issue, not a weight issue. Raise `--max-model-len` on a 140 GB card if you want the native 262k window; 16k was the validate budget.

Thinking is on by default. Per request: `chat_template_kwargs={"enable_thinking": true, "reasoning_effort": "medium"}`.

## How this was built

```
Qwen/Qwen3.8-27B
        ↓
  SSM conv1d outlier repair (FernflowerAI)
        ↓
Qwen3.8-27B-ssm-repaired
        ↓
  abliterix 1.12.2  (50-trial Optuna, Flash Lite judge, thinking scored post-</think>)
        ↓
trial 48 export
        ↓
  MTP head grafted back from stock (15 tensors, hash-match; abliterix merge had dropped them)
  Vision tower untouched (333/333 hash-match)
        ↓
this repo
```

Winning trial: **48 / 50**. Unlock basin on the judge was 29–50/100 with KL about 0.04–0.10. Zero-KL trials were no-ops (still ~100/100). We did not pick the lowest-KL point. We picked the coherent unlock.

Abliteration is BF16 only. Vision and `mtp.*` were not edited. NVFP4, if we ship it, will be quantized from this master.

## The unaligned edge

Safety alignment is not free. It trains a drag on the residual stream even when the final tokens are not a refusal. Removing that drag is why some answers get more direct, and why a 3-token KL mean of 0.10 can sit next to a median of 0.013 and still look like the same 27B.

It also means the model will write what the base model would refuse: tools, chemistry, exploit-shaped code, violence, sexuality, ideologies the publisher trained away from, content that may be illegal where you are. The model does not decide whether to comply. You do.

Intended uses include security research, red-team and alignment work, creative writing without a hall monitor, and conversations the base model refuses for being out of the publisher’s social norms. That same reliability is a threat if the prompt is.

## User Responsibility & Arbitration Clause

**By accessing, downloading, using, running inference on, fine-tuning, merging, quantizing, distributing, integrating, or otherwise interacting with this model, you acknowledge and agree to the following:**

1. **Sole Responsibility.** You, the user, are **solely and exclusively responsible** for (a) every prompt you or your downstream system issue to this model, (b) every response this model produces in reply, (c) every downstream action taken by you, your systems, your agents, or your users in reliance on those responses, and (d) any harm — direct, indirect, consequential, foreseeable, or otherwise — that results from any of the above.

2. **No Warranty.** This model is provided strictly **"AS IS"**, without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, non-infringement, safety, alignment, factual accuracy, or legal compliance in any jurisdiction. No contributor, author, publisher, or hosting platform assumes liability of any kind for outputs or downstream use.

3. **Legal Compliance.** You are responsible for ensuring that your use of this model complies with **all applicable laws, regulations, terms of service, industry codes of conduct, professional ethical standards, and organizational policies** in every jurisdiction in which you operate or in which your outputs may be received. The unaligned nature of this model does not grant you any legal authorization you did not already have.

4. **Operational Safety Layer.** An uncensored model is not a toy. You are expected to implement appropriate **downstream safety layers** proportionate to your deployment context, including but not limited to: input validation, output filtering, content moderation, audit logging, rate limiting, access controls, and human-in-the-loop review for high-risk workflows. A production deployment of this model without such layers is **unsafe by construction** and is not a supported use case.

5. **Heightened Duty of Care.** The absence of internal refusal behavior means the duty of care that would ordinarily rest partly with the model rests entirely with you. You are expected to exercise greater — not lesser — caution, forethought, and ethical discipline when operating this model than you would operate a base aligned model. If you are uncertain whether your contemplated use is ethical, legal, or wise, the correct action is to **not make the request**.

6. **No Endorsement of Outputs.** The authors, contributors, and publishers of this model do not endorse, adopt, or take responsibility for any specific output this model produces. Outputs are a stochastic function of the prompt, the weights, and the sampler state — not a statement of position by any human.

7. **Arbitration.** Any dispute, claim, or controversy arising out of or relating to the use of this model, its outputs, or this clause shall be resolved through **binding individual arbitration** under the rules of a mutually agreed arbitration body (or, absent agreement, the American Arbitration Association's Consumer Arbitration Rules), waiving any right to a jury trial, class action, representative action, or consolidated proceeding. Venue shall be the jurisdiction of the disputing party bringing the claim. Costs and attorneys' fees shall be allocated per the applicable arbitration rules. This clause does not expand, and where legally prohibited does not establish, any liability in the other direction; it limits how the user may proceed when alleging harm tied to their own use of this model.

8. **Indemnification.** You agree to indemnify, defend, and hold harmless the authors, contributors, and publishers of this model from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from or related to your use of the model or your breach of this clause.

9. **Severability.** If any provision of this clause is held unenforceable in a given jurisdiction, the remaining provisions remain in full force in that jurisdiction, and the unenforceable provision is replaced by the closest enforceable equivalent consistent with the original intent.

10. **Acceptance.** Your use of this model constitutes your acceptance of this clause in full. If you do not accept, do not use the model.

**This model is a tool with no opinions of its own. You supply the opinions. You supply the judgement. You supply the ethics. The outputs carry your fingerprints, not the model's.**

## Provenance & Credits

- **Base model:** [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) — Alibaba's Qwen team.
- **SSM conv1d outlier repair:** FernflowerAI's empirical methodology.
- **Abliteration tool:** [abliterix](https://github.com/wuwangzhang1216/abliterix) 1.12.2 by Wangzhang Wu — Heretic-derived multi-objective Optuna with hybrid Mamba/attention support.
- **Heretic (upstream of abliterix):** [p-e-w/heretic](https://github.com/p-e-w/heretic) by Philipp Emanuel Weidmann.
- **Original abliteration concept:** Arditi et al. 2024 — [Refusal in Language Models Is Mediated by a Single Direction](https://arxiv.org/abs/2406.11717).
- **NPBA / projected-abliteration:** grimjim 2025.
- **Safety-tax quantification:** Huang et al. 2025 (arXiv:2503.00555).
- **This release's pipeline, trial selection, leftover audit, and serve validate:** AEON-7.

## License

Apache 2.0 (inherited from Qwen/Qwen3.8-27B).
