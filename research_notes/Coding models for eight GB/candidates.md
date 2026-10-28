# Coding and agent models for an eight GB GPU

## Which publicly available model is the strongest practical choice on October 26, 2026?

### Takeaway
Choose the official **Ornith-1.5-9B Q4_K_M** as the first model to test in Bonsai. This is a practical recommendation from the retrieved primary sources, not a claim that its headline benchmark score will hold for a quantized model at 16K–32K context. The newer MiMo 9B and FrogNano releases do not establish a stronger overall agent-coding choice; the latest K2 Horizon is competitive but has a materially larger KV cache.

### Cited Findings
- Ornith-1.5-9B is a dense Qwen3.5-derived reasoning model. Its publisher reports SWE-bench Verified **70.6**, Pro **47.5**, and Terminal-Bench 2.1 Terminus-2 **46.2**. The same comparison lists Qwen3.5-9B at 53.2, 31.3, and 21.3. These are publisher results, not independent replications. Its card calls for the modified Ornith chat template, separates thinking from answer, and supports OpenAI-style tool calls. Coding sampling is temperature 0.6, top_p 0.95, top_k 20, min_p 0, presence penalty 0, repetition penalty 1. It recommends llama.cpp deployment. — [Official model card](https://huggingface.co/ornith-ai/Ornith-1.5-9B)
- Ornith's public source repository was created August 18 and official GGUF repository August 19, 2026. The GGUF was updated August 24. MIT license. Repository-creation time establishes availability by the research date, but is not necessarily an announced release date. — [Official model API](https://huggingface.co/api/models/ornith-ai/Ornith-1.5-9B?blobs=true), [official GGUF API](https://huggingface.co/api/models/ornith-ai/Ornith-1.5-9B-GGUF?blobs=true)
- XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B was created September 21, 2026, uses Qwen3_5ForConditionalGeneration and is MIT licensed. Its official evaluations show SWE Verified **61.1**, Pro **44.6**, Terminal-Bench 2.1 **37.1**, and Toolathlon **35.2**. — [Official model card](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B), [official API](https://huggingface.co/api/models/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B?blobs=true)
- IFM released K2 Horizon on **September 3, 2026**. The latest source model card reports the 7B anti-doom-loop stage improved SWE Verified from 69.2 to **72.4**, Terminal-Bench 2.1 from 39.7 to **44.6**, and BFCL v4 from 62.3 to **67.0**. These run at 256K context with different scaffolds from Ornith. — [Official release](https://ifm.ai/blog/k2/), [official source model](https://huggingface.co/IFM/K2-Horizon-7B)
- K2's official GGUF card still lists SWE Verified **70.6** and Terminal-Bench **39.1**, and explicitly says quantized models have only been evaluated on non-agent tasks. It requires llama.cpp **b11454 or later** for mainline architecture support. Thus old claims that it always requires a fork are stale. — [Official GGUF card](https://huggingface.co/IFM/K2-Horizon-7B-GGUF)
- microsoft/FrogNano-4B-2609 gives release date **September 22, 2026**. Its Qwen3.5-4B-based, text-only coding specialization reports Avg@3 single-attempt success **61.5 SWE Verified**, **37.6 Pro**, **31.1 Terminal-Bench 2.0**, in the five-tool Leaf harness at ~131K context and up to 8,192 tokens per turn. It notes Python-heavy data and harness sensitivity. Metadata says MIT while the body says Apache 2.0; resolve the license before redistribution. — [Official model card](https://huggingface.co/microsoft/FrogNano-4B-2609)
- Snowflake's **October 23, 2026** Arctic-SWE primary release reports 4B **65.0 / 38.3** and 9B **65.7 / 39.6** on SWE Verified / Pro. This is newer, but its headline scores do not displace Ornith for the requested quality-first choice. — [Official Snowflake engineering release](https://www.snowflake.com/en/blog/engineering/arctic-swe-agentic-rl/)
- IBM Granite 4.2 8B was released **August 25, 2026**, Apache 2.0, dense, with SWE Verified **47.67**, Pro **19.11**, Terminal-Bench 2.1 **20.56**, and LiveCodeBench v6 **73.24**. — [Official model card](https://huggingface.co/ibm-granite/granite-4.2-8b)
- Google's Gemma 4 12B is an Apache-2.0 dense unified multimodal model, released June 3 according to Google's developer guide. Google positions local dedicated GPU deployment at **16 GB VRAM**. It is not the first choice for an 8 GB quality-plus-context requirement. — [Official Google guide](https://developers.googleblog.com/gemma-4-12b-the-developer-guide/), [official weights](https://huggingface.co/google/gemma-4-12B-it)
- Ai2 SERA-14B reports **41.7% ± 0.5 SWE Verified at 32K**, SERA-8B **31.7% ± 0.9**, Apache 2.0. Larger parameter count alone does not establish a better practical candidate. — [Official SERA card](https://huggingface.co/allenai/SERA-14B)
- The official Qwen release inventory lists small Qwen3.5 models released March 2, followed by larger Qwen3.6 and Qwen3.8 families; official Qwen3-Coder inventory does not list an 8B release. No official Qwen3.8-9B was verified; community names using that label must not be described as official. — [Qwen official release inventory](https://github.com/QwenLM/Qwen3.8/blob/main/README.md), [Qwen official coder inventory](https://github.com/QwenLM/Qwen3-Coder/blob/main/README.md)

### Inferences
- Ornith is the best-supported first download here: strong agent-specific evidence, a first-party GGUF, an existing supported Qwen3.5 backend, and hybrid cache memory. K2 deserves a later comparison if desired; a 1.8-point difference in SWE across scaffolds cannot establish it as a universal winner.
- The selection is date-aware: primary releases as recent as October 23 were considered. Newness does not imply better quality, runtime compatibility, or GPU fit.

### Gaps
- No primary source establishes an absolute best model across every Bonsai task. Published scaffolds, output budgets, task splits, quantization and contexts differ.
- Headline Ornith agent numbers have no cited Q4_K_M 16K/32K reproduction. Local fit, native tool calls, multi-turn reasoning and edit reliability must be measured by the root agent.
- K2 source and GGUF cards disagree on headline numbers; whether the pinned GGUF contains the latest anti-doom-loop merged weights was not verified.

## What is the real memory budget without CPU offload?

### Takeaway
An 8 GB card must fit weights, KV cache, recurrent state, compute buffers and display use. Prefer a 9B hybrid model at Q4_K_M over squeezing a 14B+ model or confusing MoE active parameters with total model storage.

### Cited Findings
- Ornith config gives **32 layers**, **full_attention_interval 4**, **4 KV heads**, **256 head dimension**, max positions **262144**, and one MTP layer; architecture is Qwen3_5ForConditionalGeneration. — [Official Ornith config](https://huggingface.co/ornith-ai/Ornith-1.5-9B/blob/main/config.json)
- MiMo 9B has the same full-attention layer/head geometry. — [Official MiMo config](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B/blob/main/config.json)
- K2-Horizon-7B config has **36 layers**, **8 KV heads**, **128 head dimension**, no sliding window, max positions **524288**, and architecture K2HorizonForCausalLM. Its GGUF card describes a 7B-core model; Hub counts ~9B including embeddings. — [Official K2 config](https://huggingface.co/IFM/K2-Horizon-7B/blob/main/config.json), [official GGUF card](https://huggingface.co/IFM/K2-Horizon-7B-GGUF)
- Qwen3-Coder-Next has **80B total / 3B active** parameters; low active count reduces computation, not total stored weight residency. — [Official model card](https://huggingface.co/Qwen/Qwen3-Coder-Next)

### Inferences
- Ornith's eight full-attention layers need an estimated **512 MiB FP16 KV at 16,384 tokens**, **1 GiB at 32,768**, before recurrent state/graph buffers: layers × tokens × KV heads × head dimension × K/V × 2 bytes. This is calculated from the cited config, not measured allocation.
- K2's full-attention cache is **2.25 GiB at 16,384 FP16 tokens**, **4.5 GiB at 32,768**, before graph buffers. Quantized cache may help but adds another local quality/compatibility variable.
- Ornith Q4 file is **5.383 GiB**. At 16K its rough weight+FP16 full-attention KV sum is **5.883 GiB**; headroom remains for graph/recurrent allocations. At 32K the rough sum is **6.383 GiB**. Q5 is **6.186 GiB**, making 32K much tighter. Start Q4 and prove GPU residency from logs before attempting Q5.
- No-offload enforcement should include all supported layers, output tensors, KV and backend operations; do not treat a model merely starting as proof. Inspect CPU/host buffers, GPU logs and NVIDIA shared-memory spill. CPU tokenization/HTTP handling is outside the model-inference tensor residency requirement.
- Text-only inference does not require loading a separate multimodal projector. Adding vision later consumes additional GPU headroom.

### Gaps
- These calculations cannot predict exact CUDA graph/recurrent/state allocation, KV padding, concurrent sequences or Windows driver residency. Root must use the installed runtime and actual GPU.

## Which exact downloadable files and revisions should be used?

### Takeaway
Use the official Ornith Q4_K_M pinned to the verified commit and SHA-256. Other files below are comparison artifacts, not instructions to download them all.

### Cited Findings
- **Recommended:** repository `ornith-ai/Ornith-1.5-9B-GGUF`, commit `abdd624b12ebf020b767fff532ff44fe552b28c3`, file `Ornith-1.5-9B-Q4_K_M.gguf`, **5,780,090,816 bytes**, SHA-256 `70c112196e0b7023803c9762752e46d29e612a92c83f995bc3ba1ceb07e8fab6`. — [Official file](https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF/blob/abdd624b12ebf020b767fff532ff44fe552b28c3/Ornith-1.5-9B-Q4_K_M.gguf), [machine-readable official API](https://huggingface.co/api/models/ornith-ai/Ornith-1.5-9B-GGUF?blobs=true)
- Optional Ornith Q5_K_M in the same repository: **6,642,544,576 bytes**, SHA-256 `e4d9634a3b6546a5c00a8680568fe1125f6c98c704ee51ae52ba07650fb4247d`. — [Official GGUF API](https://huggingface.co/api/models/ornith-ai/Ornith-1.5-9B-GGUF?blobs=true)
- MiMo comparison: repository `bartowski/MiMo-V2.6-Distill-Qwen-9B-GGUF`, commit `4371da10c84fb26da3592d4cf312d24aa82b7b65`, file `MiMo-V2.6-Distill-Qwen-9B-Q4_K_M.gguf`, **5,841,049,120 bytes**, SHA-256 `4bca6f18c73f72270c7a20c2ea2bea581de8246e318714277120369d34048c81`. This is a third-party quant of the official MIT model. — [Quant repository](https://huggingface.co/bartowski/MiMo-V2.6-Distill-Qwen-9B-GGUF), [file API](https://huggingface.co/api/models/bartowski/MiMo-V2.6-Distill-Qwen-9B-GGUF?blobs=true)
- ggml-org's MiMo repository contains only Q8_0 (9,527,498,048 bytes) and a separate projector, so it is not the desired all-GPU 8 GB download. — [ggml-org file API](https://huggingface.co/api/models/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF?blobs=true)
- K2 comparison: repository `IFM/K2-Horizon-7B-GGUF`, commit `7a75dbda05e3d440351543131ff3f7fa5687e879`, file `K2-Horizon-7B-Q4_K_M.gguf`, **5,592,217,984 bytes**, SHA-256 `eb89c15a0ae9712be2ee462bf43802de14200f20f93b73da6eb68c2ebdd28e4e`. Apache-2.0. — [Official GGUF API](https://huggingface.co/api/models/IFM/K2-Horizon-7B-GGUF?blobs=true)
- FrogNano quants exist at `bartowski/FrogNano-4B-2609-GGUF`; no exact alternative file hash was fetched because no fallback download was needed. — [Quant repository](https://huggingface.co/bartowski/FrogNano-4B-2609-GGUF)

### Inferences
- Verify the downloaded SHA before configuring the default. Keep the embedded Ornith chat template rather than substituting a generic Qwen template; tool-call correctness is an essential part of this decision.

### Gaps
- No model weights were downloaded and no app files modified by this research subagent. The root agent owns download, residency checks and integration.
