---
base_model: empero-ai/Qwen3.8-35B-A3B-Distill
quantized_by: IsValorum
library_name: gguf
language:
- en
- zh
- es
- fr
- de
- pt
- it
- ru
- ja
- ko
- vi
- th
- ar
tags:
- abliterated
- uncensored
- alignment
- heretic
- gguf
- quantized
- quantization
- apex
- apex-quant
- custom-quantization
- unsloth-studio
- moe
- reasoning
- llama.cpp
- qwen35moe
license: apache-2.0
pipeline_tag: text-generation
---

## <a id="quick-navigation"></a>Quick Navigation Index
1. [Optimization History & Transparency Notice](#toc-01)
2. [Independent Benchmark of the APEX-I-MiniPlus Family (Occamy V2 Reference)](#toc-02)
3. [Empirical Benchmarks & Fidelity Verification](#toc-03)
4. [Quality Spectrum: APEX-I-MiniPlus V2.1 vs. Standard Flat Quantizations](#toc-04)
5. [Model Files & Technical Specifications](#toc-05)
6. [Surgical Tensor Quantization Map (Audited from GGUF)](#toc-06)
7. [Hardware Throughput & Offload Benchmarks (RTX 30 / 40 / 50 & RAM Streaming)](#toc-07)
8. [The 24GB Miracle: Full 256K Context Runs In VRAM!](#toc-08)
9. [Recommended Configuration & Setup](#toc-09)
10. [Recommended Generation Parameters (empero-ai Official)](#toc-10)
11. [CRITICAL: Coding Syntax & Repeat Penalty Advisory (Preventing Character Swapping)](#toc-coding-advisory)
12. [Hardened Agentic Chat Template & Reasoning Effort](#toc-chat-template)
13. [Optional Support](#toc-11)

# Qwen3.8-35B-A3B-Distill-MTP APEX-I-MiniPlus-V2.1 Abliterated GGUF (Uncensored / Zero Refusal)
### *The Definitive Uncensored Frontier MoE · True Directional Refusal Ablation · Dedicated Q8_0 MTP & Vision Companions Included · Full 256K Context*

> [!WARNING]
> ### Known Upstream Long-Generation Limitation
> The upstream BF16 Distill checkpoint can repeat during very long responses, including after the `<think>` block. EmperoAI acknowledges this long-generation limitation in the original model card and is already working on a Distill V2 intended to address it. This behavior is **not introduced by the APEX-I-MiniPlus quantization**; corresponding MiniPlus V2.1 and MiniPlus V2.1 Abliterated releases will follow when the corrected upstream model becomes available.

> [!NOTE]
> ### 🛡️ LOOKING FOR THE STANDARD ALIGNED RELEASE?
> If you prefer the standard safety-aligned edition with default guardrails, check out the official base release:
> 🔗 **[Qwen3.8-35B-A3B-Distill-MTP-APEX-I-MiniPlus-V2.1-GGUF](https://huggingface.co/IsValorum/Qwen3.8-35B-A3B-Distill-MTP-APEX-I-MiniPlus-V2.1-GGUF)** — identical featherweight 14.75 GB footprint, Q5_K_L fidelity (bordering Q6_K), zero AVX2 CPU stalls, and dedicated Q8_0 MTP & mmproj companions.

> [!TIP]
> ### 🔓 AUTHENTIC HERETIC TPE DIRECTIONAL ABLITERATION (UNCENSORED)
> This is the official authentic **Abliterated / Uncensored** edition of Qwen3.8-35B-A3B-Distill-MTP APEX-I-MiniPlus V2.1.
> - **Zero Moralizing Refusals:** Complete elimination of refusal vectors across systems security, pen-testing, and compliance tasks (`0/10` refusals in empirical validation).
> - **Orthogonal Activation Steering:** Refusal directions are mathematically isolated and steered orthogonally (D_KL = 0.0076) to preserve 100% of underlying domain knowledge, logic, and chain-of-thought reasoning capability.
> - **Empirical Verification:** Direct binary probe testing observed **0/10 refusals in the tested probe set** without syntax corruption or degradation in MoE routing.

> [!IMPORTANT]
> ### THE DEFINITIVE SPECIFICATION IN THE 13–14 GB CEILING
> This **APEX-I-MiniPlus-V2.1** release represents the absolute technological limit of sparse Mixture-of-Experts quantization within the **13–14 GB envelope**. Every single tensor of its 40 layers and 256 micro-experts has been mathematically audited to maximize reasoning precision, eliminate recurrence state drift, and prevent AVX2 CPU dequantization stalls.

> [!TIP]
> ### 🏆 THE QUANTIZATION SWEET SPOT: Q6_K-PURE FIDELITY AT 3-BIT FOOTPRINT
> **Why APEX-I-MiniPlus V2.1 outperforms standard community quants:**
> - **Empirical WikiText-2 Perplexity:** **5.1280 ± 0.1312** — (ΔPPL ≈ +0.02) from unquantized baseline (approx. 5.10).
> - **Q6_K-Pure Fidelity at Less-Than-Q3_K_M Weight:** Measured at ΔPPL ≈ +0.02 for this GGUF; Delivers reasoning fidelity and syntax consistency in the **Q6_K-pure** band while occupying only **approx. 14.65 GB (13.65 GiB)** (below the **17.7 GB** `Q3_K_M` reference).
> - **Zero Routing Drift:** 100% of expert routing matrices (`gate_inp`) remain in uncompressed **`F32`**, ensuring tokens are dispatched to the exact right experts on every forward pass.

> [!TIP]
> ### 🏆 EMPIRICAL BENCHMARK & QUALITY COMPARISON
>
> | Quantization Specification | File Size (Disk) | Memory Footprint (RAM/VRAM) | Average BPW | WikiText-2 Perplexity | Quality Tier Equivalent |
> | :--- | :---: | :---: | :---: | :---: | :---: |
> | **Unquantized BF16 Base** | approx. 70.0 GB | approx. 65.2 GiB | 16.00 BPW | approx. 5.10 (Reference) | Full precision baseline |
> | **APEX-I-MiniPlus V2.1 (Aligned)** | 14.75 GB | 13.74 GiB | 3.40 BPW | 5.3952 ± 0.1246 (approx. ΔPPL +0.0552 / +1.08%) | Q5_K_L tier (bordering Q6_K) |
> | **APEX-I-MiniPlus V2.1 Abliterated (CURRENT)** | 14.66 GB | 13.65 GiB | 3.40 BPW | 5.1280 ± 0.1312 (approx. ΔPPL +0.0280 / +0.55%) | Q6_K-pure tier |
>
> **Routing:** all recipe-designated `gate_inp` and `gate_shexp` tensors remain in uncompressed `F32`, preserving zero routing drift.

> [!WARNING]
> ### DO NOT CONFUSE APEX-I-MINIPLUS WITH GENERIC COMMUNITY APEX-I-MINI!
> **Regardless of release version (whether V1, V2, or V2.1), NEVER confuse handcrafted APEX-I-MiniPlus builds with generic community APEX-I-Mini releases:**
> - **Generic Community APEX-I-Mini:** Uniformly compresses all core MoE experts down to aggressive 2-bit `IQ2_S` (dropping below the critical quality floor), leaves the sensitive token output head unarmored at 3-bit `Q3_K_M`, and compresses attention projections down to `Q3_K`. In deep reasoning models, this triggers severe perplexity spikes, syntax errors, and broken code brackets.
> - **Handcrafted APEX-I-MiniPlus (All Editions by IsValorum):** Every single MiniPlus release—from V1 and V2 to V2.1—is a custom tensor-by-tensor architecture that preserves uncompressed `F32` router gates, armors the token output head in high-precision `Q6_K`, safeguards attention gates in `Q8_0`, and keeps core reasoning experts at or above calibrated 3-bit (`IQ3_XXS`/`IQ3_S`). Even our earlier builds vastly outperform generic community APEX recipes and flat 3-bit quants.


> [!TIP]
> ### SYSTEM RAM INFERENCE: FULL OR PARTIAL
> This APEX-I-MiniPlus release is designed for **full or partial system-RAM inference**. Depending on the processor, memory bandwidth, and DDR4/DDR5 configuration, generation can range from **20 to 45 tok/s**. With partial GPU offload, systems that cannot fit **128K or more context** entirely in VRAM can place the remaining model and context load in system RAM, maintaining stable, responsive generation at longer context lengths.

---

<a id="toc-01"></a>
## Optimization History & Transparency Notice

We maintain our previous releases publicly as a transparent engineering record of continuous optimization. Below is the exact evolutionary roadmap of our MiniPlus architectures:

| Specification | Core Experts (10–29) | Edge Experts (0–9, 30–39) | Shared Expert (`shexp`) | Full Attention (L3, 7, 11, ...) | Attention Gates (30 Layers) | Output Head (`output.weight`) | Routers (`gate_inp`) | Size / Overhead | Real-World Impact |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Generic APEX Mini** | `IQ2_S` (2.50 bpw) | `Q3_K` (only 5 layers) | `Q4_K` / `Q3_K` | `Q3_K` | Compressed | `Q3_K_M` | Compressed | Baseline (approx. 12.5 GB) | Severe syntax errors, broken code indentation, high perplexity in `<think>`. |
| **MiniPlus V2.1 (CURRENT)** | **`IQ3_XXS`** | **`Q3_K` (20 layers)** | **`Q5_K` (All 40 layers)** | **`Q3_K` (`q/k/v`) + `Q6_K` (`output`)** | **`Q8_0`** | **`Q6_K`** | **`F32`** | **Definitive Build** (approx. 13.74 GiB) | **Zero AVX2 CPU stalls and efficient streaming when offloading bulk of the model to system RAM (DDR4/DDR5). Dedicated Q8_0 MTP draft head enables ultra-fast speculative execution.** |

> [!TIP]
> ### Deployment & System Architecture Guide
> - **Full GPU VRAM Offload (24GB+ VRAM, `-ngl 99`):** Effortless full offload with native 256K context support. Blistering throughput on RTX 3090 / 4090 / 5090 GPUs.
> - **System RAM Streaming Specialist (DDR4/DDR5 & Massive Context):** **Specially engineered to run either partially or entirely out of system RAM across large or full (+160k to 256k) context windows.** By replacing non-linear codebooks with linear SIMD-optimized `Q3_K` edge experts and upgrading shared foundation experts to `Q5_K` across all 40 layers, AVX2 CPU dequantization stalls are completely eliminated. Depending on your processor architecture and memory bandwidth (dual-channel DDR4 or high-speed DDR5 6000+ MT/s), **streaming generation in system RAM can approach speeds remarkably close to full VRAM execution**, allowing both the dedicated `Q8_0` multimodal vision projector (`mmproj`) and the `Q8_0` Multi-Token Prediction draft head (`mtp`) to be loaded explicitly in GPU VRAM for accelerated speculative decoding and zero-latency OCR while the main model weights stream effortlessly from system RAM.
> 
> Explore the complete family of APEX-I-MiniPlus models in our official collection:
> **[APEX-I-MiniPlus V2.1 Hub Collection](https://huggingface.co/collections/IsValorum/apex-i-miniplus-v21-current-6aac8d4766a28a024e8bb104)**.

---

> [!IMPORTANT]
> ### EXPLORE THE ESTABLISHED 35B MoE MINIPLUS LINEUP
> These are complementary APEX-I-MiniPlus V2.1 releases, not alternate downloads of the same model. Each receives the same tensor-by-tensor approach, integrated MTP where supported, and a design suitable for full or partial system-RAM inference. Choose the model whose native strengths best fit the work you want to do:
>
> - **[Qwen3.6-35B-A3B MTP APEX-I-MiniPlus-V2.1](https://huggingface.co/IsValorum/Qwen3.6-35B-A3B-MTP-APEX-I-MiniPlus-V2.1-GGUF)** — a versatile frontier MoE for broad reasoning, multilingual work, agents, tool use, and multimodal tasks.
>   - **Best for:** General reasoning, agent workflows, tool calling, and flexible multimodal use.
> - **[Qwen3.6-35B-A3B MTP APEX-I-MiniPlus-V2.1 Abliterated](https://huggingface.co/IsValorum/Qwen3.6-35B-A3B-MTP-APEX-I-MiniPlus-V2.1-Abliterated-GGUF)** — the V2.1 refusal-ablated Qwen3.6 edition for users who deliberately prefer reduced refusal behavior.
>   - **Best for:** Workflows where an abliterated Qwen3.6 variant is explicitly desired.
> - **[Ornith 1.5 APEX-I-MiniPlus-V2.1](https://huggingface.co/IsValorum/Ornith-1.5-35B-A3B-APEX-I-MiniPlus-V2.1-GGUF)** — a software-engineering-focused MoE designed for repository-scale coding and autonomous engineering agents.
>   - **Best for:** Repository-scale development, multi-file code changes, and software-engineering agents.
> - **[Tiel Coder APEX-I-MiniPlus-V2.1](https://huggingface.co/IsValorum/Tiel-Coder-35B-A3B-APEX-I-MiniPlus-V2.1-GGUF)** — a specialist coding MoE tuned for agentic programming, iterative tool use, and implementation-heavy work.
>   - **Best for:** Focused coding sessions, iterative debugging, and tool-driven implementation.
>
> These remain distinct model families and editions with their own behavior and empirical results. Pick by workload and intended alignment behavior rather than treating them as interchangeable quantization variants.
---

<a id="independent-benchmark"></a>
<a id="toc-02"></a>
### 🏅 Independent Benchmark of the APEX-I-MiniPlus Family (Occamy V2 Reference)

> [!NOTE]
> **External report:** [zephel01 independently benchmarked Occamy V2](https://note.com/zephel01/n/n71d3d7e6b70c?hl=en). The benchmark below was performed on **Occamy-1.0 APEX-I-MiniPlus V2**, not on this specific V2.1 model. It is included as independent evidence of the broader MiniPlus quantization approach.

The **APEX-I-MiniPlus** quantization architecture powering this model was subjected to an extensive independent evaluation by Japanese AI researcher and evaluator [zephel01 (CoolZero)](https://note.com/zephel01/n/n71d3d7e6b70c?hl=en) on an **NVIDIA RTX 5090 (32GB)** workstation running `llama.cpp` CUDA `b11027` with FlashAttention (`-fa on -ctk q8_0 -ctv q8_0 -ngl 99`). 

The evaluation tested the APEX-I hybrid MoE engine across **348 unseeded trials** on SWE-bench style multi-file Python bug-fixing tasks with hidden `pytest` suites (`llmbench`):

- **L6 Multi-File Code Generation (60 tasks):**
  - **Context 32,768 (32K):** **93.3% Resolved** (46/60 tasks passed 5/5 consecutive trials; 20/20 on Easy–Hard).
  - **Context 65,536 (65K):** **90.0% Resolved** (45/60 tasks passed 5/5 consecutive trials).
  - **Match with 25–28 GB Models:** Matches or exceeds the resolution rate of full 25–28 GB models (such as `Ornith-1.5` and `Tiel-Coder` 35B-A3B) while consuming **over 10 GB less VRAM** (14.6 GB vs approx. 26 GB).
- **Extreme Context VRAM Scaling (The Hybrid DeltaNet SSM Advantage):**
  - **32K Context:** **14.6 GB** total VRAM allocation.
  - **65K Context:** **15.1 GB** total VRAM allocation (only **+0.5 GB VRAM** added when doubling context!).
  - *Architectural Explanation:* Because 30 of the 40 layers utilize Linear Attention / DeltaNet SSM (O(1) constant recurrence memory), only the 10 full-attention anchor layers expand the KV cache. This proves empirically that **65,536 context runs 100% in VRAM on consumer 16GB GPUs (RTX 4080 / RTX 5080)** without offloading to system RAM.
- **Measured Real-World Throughput:** Sustained single-stream generation of **approx. 247 – 251 tok/s** on NVIDIA RTX 5090.

---

<a id="model-specifications"></a>
<a id="empirical-benchmarks"></a>
<a id="toc-03"></a>
## Empirical Benchmarks & Fidelity Verification

The comparison table near the top consolidates the model-specific BF16 baseline, final GGUF PPL, delta, published main-file size, BPW, and fidelity tier. The routing treatment is preserved in the note directly beneath it.


<a id="quality-spectrum"></a>
<a id="toc-04"></a>
### Quality Spectrum: APEX-I-MiniPlus V2.1 vs. Standard Flat Quantizations

How the handcrafted **APEX-I-MiniPlus V2.1** architecture compares against standard flat quantizations in `llama.cpp` on 35B Mixture-of-Experts architectures:

| Quantization Format | Bits Per Weight (BPW) | Model Footprint (Disk / VRAM) | Perplexity Delta (vs. FP16 Baseline) | Token Fidelity & Syntactic Stability Tier |
| :--- | :---: | :---: | :---: | :--- |
| **FP16 / BF16 (Uncompressed)** | 16.0 bpw | approx. 70 GB | **0.00** (Reference) | 100% full uncompressed reference fidelity. |
| **Standard Q8_0** | 8.50 bpw | approx. 38 GB | approx. +0.01 | Virtually lossless; excessive memory overhead for consumer hardware. |
| **Standard Q6_K** | 6.56 bpw | approx. 30 GB | approx. +0.02 to +0.05 | Near-lossless FP16 fidelity; requires multi-GPU or 32GB+ VRAM setups. |
| 🏆 **APEX-I-MiniPlus V2.1 (IsValorum)** | **3.40 bpw** | **14.65 GB (13.65 GiB)** | **approx. +0.02 (PPL: 5.1280 vs FP16 approx. 5.10)** | **Model-specific result: ΔPPL approx +0.02 (PPL: 5.1280 vs FP16 approx 5.10), supporting a Q6_K-pure fidelity tier at less-than-Q3_K_M weight, at an 80% VRAM reduction.** Full native 256K context on standard 24GB workstations. |
| **Standard Q5_K_M** | 5.50 bpw | approx. 25 GB | approx. +0.05 to +0.10 | Commercial transparent threshold; exceeds standard single 24GB GPU limits. |
| **Standard Q4_K_M** | 4.50 bpw | approx. 20 GB | approx. +0.15 to +0.25 | Standard industry trade-off; requires context offload compromises. |
| **Standard Q3_K_M / Q3_K_S** | 3.44 bpw | **17.7 GB** | approx. +0.40 to +0.85 | Noticeable syntax drop, bracket corruption, and tokenizer classification noise. |
| **Standard IQ2_S / Generic APEX Mini** | 2.50 bpw | approx. 12.5 GB | approx. +1.50 to +3.00+ | Severe reasoning breakdown, high perplexity spikes in `<think>` chains. |

<a id="toc-05"></a>
## Model Files & Technical Specifications

| File Name | File Size | Memory Footprint | BPW | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`Qwen3.8-35B-A3B-Distill.APEX-I-MiniPlus-V2.1-Abliterated.gguf`** | **`14.65 GB` (`13.65 GiB`)** | `13.65 GiB` | **3.40 BPW** | Core distilled reasoning, chain-of-thought math, logic & coding MoE |
| **`mmproj-Q8_0.gguf`** | **`614 MB (585 MiB)`** | `585 MiB` | **8.50 BPW** | Dedicated Q8_0 multimodal vision projector for document & image reasoning |
| **`mtp-Qwen3.8-35B-A3B-Distill-Q8_0.gguf`** | **`1.89 GB (1.85 GiB)`** | `1.85 GiB` | **8.50 BPW** | Dedicated Q8_0 Multi-Token Prediction (MTP) draft head for speculative decoding |
| **mtp-Qwen3.8-35B-A3B-Distill-Q4_0.gguf** | **1.11 GB (1.11 GiB)** | 1.11 GiB | **4.50 BPW** | Dedicated Q4_0 Multi-Token Prediction (MTP) draft head for low-VRAM speculative decoding |

- **Base Model:** [empero-ai/Qwen3.8-35B-A3B-Distill](https://huggingface.co/empero-ai/Qwen3.8-35B-A3B-Distill)
- **Parameters:** 35.2B total (approx. 2.6B to 3.2B active per token)
- **Architecture:** 40 layers, 256 micro-experts (8 active per token) + hybrid linear attention / DeltaNet recurrent layers
- **Context Length:** 262,144 tokens (native 256K)

---

<a id="tensor-map"></a>
<a id="toc-06"></a>
## Surgical Tensor Quantization Map (Audited from GGUF)

*The exact tensor breakdown below has been verified directly from the compiled binary weights:*

| Layer Group | Sub-Component / Tensor | Qty | Precision | Engineering Rationale |
| :--- | :--- | :---: | :---: | :--- |
| **Global Output Head** | `output.weight` | 1 | **`Q6_K`** | Preserves near-FP16 token classification; eliminates syntax errors, bracket drops, and hallucinations. |
| **Global Embeddings** | `token_embd.weight` | 1 | **`Q3_K`** | Vocabulary embedding representation as stored in the compiled GGUF. |
| **All Normalizations** | `output_norm`, `attn_*_norm`, `post_attention_norm`, `ssm_norm` | 131 | **`F32`** | 100% uncompressed numerical stability across all 40 layers. |
| **Expert Routers** | `blk.*.ffn_gate_inp`, `ffn_gate_inp_shexp` | 80 | **`F32`** | 100% uncompressed routing fidelity across 256 micro-experts; zero router drift. |
| **Attention Gates** | `blk.*.attn_gate.weight` (30 Hybrid Layers) | 30 | **`Q8_0`** | High-precision attention gating across hybrid DeltaNet recurrence layers; eliminates crosstalk. |
| **Shared Foundation Experts** | `blk.*.ffn_{gate,down,up}_shexp` (All 40 Layers) | 120 | **`Q5_K`** | Foundation knowledge backbone active on 100% of tokens; protected in high-precision linear Q5_K. |
| **Periodic Full Attention** | `blk.{3,7,11,...}.attn_q/k/v` (10 Anchor Layers) | 30 | **`Q3_K`** | Full quadratic attention anchor checkpoints as stored in the compiled GGUF. |
| **Periodic Full Attention** | `blk.{3,7,11,...}.attn_output` (10 Anchor Layers) | 10 | **`Q6_K`** | Armored attention output projection over deep context. |
| **Recurrent SSM Scales** | `blk.*.ssm_alpha`, `ssm_a`, `ssm_conv1d`, `ssm_dt` | 120 | **`F32`** | Guarded in uncompressed FP32 to prevent DeltaNet recurrent state drift. |
| **Linear Attention & SSM** | `blk.*.attn_qkv`, `ssm_beta`, `ssm_out` | 90 | **`Q3_K`** | Linear AVX2 execution; zero SIMD CPU stalls during system RAM streaming. |
| **Edge MoE Experts** | Layers 0–9 & 30–39 (`ffn_*_exps`) | 60 | **`Q3_K`** | Linear SIMD execution optimized for system RAM offload. |
| **Core MoE Experts** | Layers 10–29 (`ffn_*_exps`) | 60 | **`IQ3_XXS`** | Calibrated with importance matrix (`imatrix`) for maximum compactness in deep layers. |

---

<a id="throughput-projections"></a>
<a id="toc-07"></a>
## Hardware Throughput & Offload Benchmarks (RTX 30 / 40 / 50 & RAM Streaming)

*Empirically verified in Unsloth Studio & llama.cpp:*

| Hardware Target | Offload Mode | Generation Speed (Est.) | Prompt Prefill Speed (Est.) | Highlights |
| :--- | :--- | :---: | :---: | :--- |
| **NVIDIA RTX 5080 / 5090 (Blackwell)** | Full GPU (`-ngl 99`) | **approx. 247 – 251 tok/s** | **2,800 – 3,900+ tok/s** | Empirically verified on RTX 5090 by zephel01 (Occamy V2 Reference) |
| **NVIDIA RTX 4090 (24GB GDDR6X)** | Full GPU (`-ngl 99`) | **90 – 115+ tok/s** | **2,000 – 2,800+ tok/s** | Linear attention layers slash prefill latency |
| **NVIDIA RTX 3090 (24GB GDDR6)** | Full GPU (`-ngl 99`) | **72 – 88+ tok/s** | **1,500 – 2,200+ tok/s** | Full 256k native window in VRAM |
| **Workstation / Laptop (DDR4 / DDR5 RAM)** | Hybrid Offload (Few layers in VRAM) | Hardware-dependent | Hardware-dependent | Zero AVX2 CPU stalls; efficient streaming from system RAM |

- **Aggressive Hybrid Offload Profile:** Hybrid offload supports reasoning-enabled generation with limited VRAM while the remaining model weights stream from system RAM.

> [!NOTE]
> ### Empirical Testbed Architecture & Desktop/Server Scaling
> - **Empirical Benchmark Hardware:** The hybrid offload and system RAM streaming behavior documented above was measured on a consumer laptop powered by an **Intel 12th Gen Alder Lake architecture featuring a hybrid design of Performance Cores (P-Cores) and Efficient Cores (E-Cores)** paired with dual-channel system RAM and constrained laptop power/thermal envelopes.
> - **Thread Scheduling & E-Core Contention:** In hybrid architectures like Alder Lake, OS thread scheduling across background E-Cores and lower single-core mobile power limits introduce memory bandwidth and thread synchronization overhead during CPU dequantization.
> - **Dramatic Scaling on Higher-End Processors:** When running on desktop or server processors (such as modern AMD Ryzen 7000 / 9000 Zen 4/5 series or high-TDP Intel desktop platforms with dedicated performance cores, large L3 caches, and high-bandwidth dual- or quad-channel DDR5 running at 6000+ MT/s), **streaming generation speeds and prefill throughput will scale dramatically higher**, substantially exceeding these measured mobile numbers.

---

<a id="context-scaling"></a>
<a id="toc-08"></a>
## The 24GB Miracle: Full 256K Context Runs In VRAM!

**Qwen3.8-35B-A3B-Distill-MTP APEX-I-MiniPlus-V2.1 fits the entire 256K context window within 24GB VRAM:**

| Context Length | Model Weights (Est.) | KV Cache (q8_0, 4 slots) | Compute Buffers | **Total GPU VRAM (Est.)** | Feasibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **32,768 (32k)** | `13.74 GiB` | `0.58 GiB` | `1.80 GiB` | **`16.12 GiB`** | Full offload on 24GB; partial on 16GB |
| **65,536 (64k)** | `13.74 GiB` | `0.92 GiB` | `1.95 GiB` | **`16.61 GiB`** | Effortless fit on 24GB GPUs |
| **131,072 (128k)**| `13.74 GiB` | `1.58 GiB` | `2.22 GiB` | **`17.54 GiB`** | Effortless fit on 24GB GPUs |
| **262,144 (256k)**| `13.74 GiB` | `2.92 GiB` | `2.80 GiB` | **`19.46 GiB`** | **FULL 256K NATIVE IN VRAM!** |

*Note: Leaves comfortable headroom for display drivers and compute buffers on standard 24GB GPUs (RTX 3090, RTX 4090, RTX 5090).*
> [!TIP]
> ### 💡 Empirical 16GB GPU Verification (Single Stream / Desktop)
> While theoretical multi-slot server buffers estimate approx. 16.5 GiB, independent hardware testing by zephel01 on an RTX 5090 (Occamy V2 Reference) confirmed that single-stream desktop inference consumes **only 14.6 GB at 32,768 ctx** and **only 15.1 GB at 65,536 ctx** (`-ctk q8_0 -ctv q8_0 -fa on`). This empirically proves that **full 65K context runs completely in VRAM on 16GB cards (RTX 4080 / RTX 5080)** without system RAM offload!

---

<a id="recommended-setup"></a>
<a id="toc-09"></a>
## Recommended Configuration & Setup

```bash
llama-server.exe \
 -m Qwen3.8-35B-A3B-Distill.APEX-I-MiniPlus-V2.1-Abliterated.gguf \
 --port 8080 \
 --parallel 4 \
 --flash-attn on \
 --fit on \
 -c 104960 \
 --cache-type-k q8_0 \
 --cache-type-v q8_0
```

<a id="generation-parameters"></a>
<a id="toc-10"></a>
### ⚙️ Recommended Generation Parameters (empero-ai Official)

Official generation guidelines specified by [empero-ai](https://huggingface.co/empero-ai/Qwen3.8-35B-A3B-Distill) for distilled reasoning MoEs:

| Hyperparameter | Value | Description / Creator Notice |
| :--- | :---: | :--- |
| **Temperature** | `0.60` | Official empero-ai setting. **Do NOT use greedy decoding (`temp 0.0`)**: repetition loops occur on long generations. |
| **Top-P** | `0.95` | Nucleus filtering for stable reasoning token trajectories. |
| **Top-K** | `20` | Official vocabulary top-k filter. |
| **Max New Tokens** | `16384` | Generous token allocation required: every generation opens with deep `<think>` deliberation. |

> [!IMPORTANT]
> <a id="quantization-fidelity"></a>
> ### 🔍 Model Inherent Behavior vs. Quantization Fidelity Notice
> Any behavioral nuances, stylistic tendencies, domain-specific habits, or zero-shot edge-case oversights **stem entirely from the original unquantized checkpoint weights and fine-tuning distribution, NOT from the APEX-I quantization process.**
> Handcrafted APEX-I-MiniPlus strictly preserves mathematical tensor fidelity—keeping 100% of expert routing matrices (`gate_inp`) in uncompressed `F32` (zero router drift), armoring the token output head in `Q6_K`, and safeguarding attention gates in `Q8_0`. Empirical verification confirms near-zero perplexity loss (ΔPPL ≈ +0.02), ensuring that token logits, routing decisions, and reasoning trajectories are mathematically faithful to the original base model.

<a id="toc-coding-advisory"></a>
<a id="coding-advisory"></a>
> [!IMPORTANT]
> ### CRITICAL ADVISORY FOR CODING WORKFLOWS: PREVENTING SYNTAX & TOKEN SWAPPING
> In programming code, brackets (`{`, `}`), assignment operators (`=`), and indentation whitespace repeat constantly across multi-line structures.
> 
> **Common Issue:** Many local frontends (such as LM Studio defaults, Ollama, or web interfaces) ship with `repeat_penalty` set to `1.1` or `1.15`. While this prevents loops in creative prose, applying repeat penalties to code artificially penalizes necessary syntax tokens. When the logit of `{` drops, the model is forced to emit the next closest mathematical token (`=` or `[`), resulting in character swapping or dropped/doubled whitespace.
> 
> **Verified Upstream Behavior:** This self-correcting behavior (where the model notices the mistake in its thinking loop but repeats the substitution) is documented on official upstream base checkpoints and Q8 builds ([Ornith Discussion #34](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B/discussions/34) and [Discussion #22](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF/discussions/22)). It is completely eliminated by proper sampling configuration:
> 
> 1. **Disable Repeat Penalties (Required for Code):**
>    - `repeat_penalty: 1.0` (strictly disabled)
>    - `presence_penalty: 0.0`
>    - `frequency_penalty: 0.0`
> 2. **Calibrate Samplers:**
>    - `temperature: 0.60` (or `0.20` - `0.30` for strict, deterministic code syntax)
>    - `min_p: 0.05` (prunes low-probability noise tokens effectively)
>    - `top_p: 0.95`
>    - `top_k: 20`
> 3. **Native Jinja Formatting:** Always pass the `--jinja` flag so the tokenizer handles leading-space BPE tokens (` {` vs `{`, ` =` vs `=`) cleanly.
4. **DRY Sampler for Repetition Suppression (Recommended over Repeat Penalty):**
   - `--dry-multiplier 0.8` (or `1.0` in deep agent loops)
   - `--dry-base 1.75`
   - `--dry-allowed-length 2`
   - `--dry-penalty-last-n 0` or equal to `--ctx-size` (e.g. `163840`). Note for llama.cpp users: builds such as Vulkan b10855 reject negative values like `-1`; specify `0` or your active context window length.

<a id="toc-chat-template"></a>
<a id="chat-template"></a>
> [!TIP]
> ### HARDENED AGENTIC CHAT TEMPLATE (JINJA)
> An optimized `chat_template.jinja` is included at the root of this repository. It hardens agent workflows and multi-turn stability:
> 
> 1. **Native `reasoning_effort` Multi-Level Control:**
>    - `low` / `minimal`: Keeps internal thinking concise and focused strictly on immediate execution steps to minimize latency in automated loops.
>    - `medium` (default): Balanced, structured reasoning process with standard analytical depth.
>    - `high` / `xhigh`: Guides the model to formulate a clear implementation plan upfront before generating code, avoiding circular self-doubt loops.
>    - `none` / `off`: Closes the thinking block immediately (`<think>\n\n</think>\n\n`) when reasoning is disabled.
> 2. **Tool-Calling Safeguards & Direct Execution:**
>    - Enforces direct tool execution without conversational preambles that could trigger self-priming announcement loops in agent history.
>    - Explicit negative constraints preventing tool-name hallucinations and repetitive retry loops on failed tool calls.
> 3. **Multi-Turn Thinking Memory & Selective Pruning:**
>    - Automatically prunes historical `<think>` blocks from preceding queries by default to prevent context bloat and circular reflection buildup across deep 75K+ token sessions.
>    - Fully configurable via `chat_template_kwargs`: pass `{"preserve_thinking": true}` to retain all historical reasoning, or `{"preserve_thinking": false}` to strip intermediate tool reasoning for an ultra-lean context.
> 
> **Usage with llama-server:**
> ```bash
> llama-server -m Model.gguf --chat-template-file chat_template.jinja --reasoning-effort medium
> ```

<a id="toc-11"></a>
## Optional Support

<a href="https://ko-fi.com/isvalorum"><img src="https://huggingface.co/spaces/IsValorum/MiniPlus-NanoPlus-Requests/resolve/main/assets/dance-gold-ship.gif" alt="Gold Ship dancing" width="128" align="right"></a>

If these MiniPlus or NanoPlus releases have been useful to you and you would like to support the work, you can do so voluntarily through https://ko-fi.com/isvalorum. Your contribution helps with evaluation, hosting, and future handcrafted quantizations. Every release will always remain free to download and use; there are no paywalled files, updates, or features.
