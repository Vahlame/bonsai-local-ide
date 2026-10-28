# Fully GPU coding models for an 8 GB RTX 4060, checked October 26, 2026

## Which model is the strongest practical candidate?

### Takeaway
Select **Ornith-1.5-9B, official Q4_K_M GGUF**, then validate native tool calls and realistic prefill on this laptop. Qwen3.5-9B is a conservative fallback; Xiaomi MiMo V2.6 Distill 9B is newer but needs an additional quantization and different template/parser verification.

### Cited Findings
- Ornith publishes SWE-bench Verified 70.6, SWE-bench Pro 47.5, and Terminal-Bench 2.1 (Terminus-2) 46.2, versus its Qwen3.5-9B baseline 53.2/31.3/21.3. These are publisher-reported source-model scores, with 128K/256K benchmark context and specialized harnesses, not measurements of Q4 on this laptop. Its card specifies reasoning plus XML tool-call parsing and precise-coding sampling temperature 0.6, top_p 0.95, top_k 20, min_p 0, presence_penalty 0, repeat_penalty 1. — [Ornith official card](https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF)
- Ornith official GGUF repository was created August 19, 2026 and last modified August 24; pinned repository revision is `abdd624b12ebf020b767fff532ff44fe552b28c3`. — [Official repository API](https://huggingface.co/api/models/ornith-ai/Ornith-1.5-9B-GGUF?blobs=true)
- Qwen's current official list includes Qwen3.8-27B, Flash-Next 180B, and 2.4T-A95B. No official small Qwen3.6/3.8 replacement was found in its published list; a large active-parameter count reduction in MoE does not make all expert weights fit this GPU. — [Qwen official models](https://huggingface.co/Qwen/models)
- `empero-ai/Qwen3.8-9B-Distill-GGUF` is a third-party distillation into the Qwen3.5-9B architecture. Its GGUF card highlights MMLU and GSM8K rather than a demonstrated coding/agent improvement. — [Publisher card](https://huggingface.co/empero-ai/Qwen3.8-9B-Distill-GGUF)
- Xiaomi's MiMo-V2.6-Distill-Qwen-9B is an SFT checkpoint on Qwen3.5-9B. Its own evaluation reports SWE Verified 61.1, SWE Pro 44.6, Terminal Bench 2.1 37.1; its baselines differ from Ornith's. It ships a MiMo chat template and recommends a MiMo reasoning parser. — [Xiaomi official card](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B/raw/main/README.md)
- Xiaomi's actual repository was created September 21 and updated September 22, 2026, so third-party October release-date claims are unreliable. — [Xiaomi repository API](https://huggingface.co/api/models/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B)
- The ggml-org MiMo repository contains a Q8_0 language model of 9,527,498,048 bytes and a vision projector, but no Q4_K_M/Q5_K_M as checked. This Q8 model alone exceeds 8 GB. — [ggml-org files API](https://huggingface.co/api/models/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF?blobs=true)
- Ministral 3 8B Instruct 2512 officially has an 8.4B language model, 0.4B vision encoder, native function calling/JSON, and 256K context. Its FP8 recommendation is 12 GB VRAM; additional quantization is needed for this laptop. — [Mistral official card](https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512/raw/main/README.md)

### Inferences
- Ornith is the most promising actionable candidate among these small models because its developer publishes agentic coding results and a directly downloadable suitable official quant. This is a selection judgment, not a proven global ranking.
- Cross-publisher benchmark numbers cannot determine a reliable Ornith-versus-MiMo winner because the Qwen baselines, harnesses, and settings differ. The IDE's local tool-call and coding evaluation should decide final activation.
- Standard 14B Q4 quants and 27B or larger models generally exhaust the 8 GB budget before practical KV/compute headroom. MoE models must be judged by total resident weights, never just active parameter counts.

### Gaps
- No controlled equal-runtime/equal-quant/equal-context Ornith versus Qwen versus MiMo coding evaluation was found. No model inference or download was performed by this researcher.

## What exact files fit and how much context is safe?

### Takeaway
Ornith Q4_K_M weighs **5,780,090,816 bytes = 5512.32 MiB**, leaving useful context and compute room within approximately 7872 MiB free VRAM. Start at 16,384 context with F16 KV; validate 32,768 context before using it as the default. Q5 is possible at shorter context but substantially narrows startup/prefill headroom.

### Cited Findings
- Official Ornith Q4_K_M: filename `Ornith-1.5-9B-Q4_K_M.gguf`; exact bytes `5780090816`; SHA256 `70c112196e0b7023803c9762752e46d29e612a92c83f995bc3ba1ceb07e8fab6`. — [Official file page](https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF/blob/abdd624b12ebf020b767fff532ff44fe552b28c3/Ornith-1.5-9B-Q4_K_M.gguf)
- Pinned Q4 download: [Ornith official Q4 GGUF](https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF/resolve/abdd624b12ebf020b767fff532ff44fe552b28c3/Ornith-1.5-9B-Q4_K_M.gguf).
- Official Ornith Q5_K_M: filename `Ornith-1.5-9B-Q5_K_M.gguf`; exact bytes `6642544576` (6334.82 MiB); SHA256 `e4d9634a3b6546a5c00a8680568fe1125f6c98c704ee51ae52ba07650fb4247d`. — [Official files API](https://huggingface.co/api/models/ornith-ai/Ornith-1.5-9B-GGUF?blobs=true)
- Ornith's Qwen3.5 architecture has 32 layers, 8 full-attention layers, 4 KV heads, head dimension 256, and 24 linear-attention layers with 32 value heads of dimension 128 and convolution kernel 4. — [Official Ornith config](https://huggingface.co/ornith-ai/Ornith-1.5-9B/raw/main/config.json)
- Qwen fallback, Unsloth revision `3885219b6810b007914f3a7950a8d1b469d598a5`: `Qwen3.5-9B-Q4_K_M.gguf`, bytes `5680522464`, SHA256 `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`; Q5_K_M bytes `6577841376`, SHA256 `dc2a39aef291f91a9116ad214058da0d86eb648743a124bd8c333787c4b9c91c`. — [Unsloth files API](https://huggingface.co/api/models/unsloth/Qwen3.5-9B-GGUF?blobs=true)
- Quantizer variants are materially different: Bartowski Qwen Q4_K_M is `6169341984` bytes, whereas Unsloth Q4_K_M above is `5680522464`; model/quant labels alone do not identify memory use. — [Bartowski files API](https://huggingface.co/api/models/bartowski/Qwen_Qwen3.5-9B-GGUF?blobs=true)

### Inferences
- Full-attention KV estimate from the official architecture: `8 layers * 4 heads * 256 dimensions * 2(K,V) * 2 bytes = 32768 bytes/token` for F16. Thus 16K requires 512 MiB and 32K requires 1024 MiB, before recurrent state and compute buffers. Q8_0 block storage gives approximately 272 MiB at 16K/544 MiB at 32K; Q4_0 approximately 144/288 MiB. Actual allocation has padding and runtime details.
- Recurrent SSM state lower estimate is `24 * 32 * 128 * 128 * 4 bytes = 48 MiB` per sequence, plus roughly 2.25 MiB convolution state. Checkpoints and implementation can add more, so do not treat 50 MiB as total recurrent runtime overhead.
- Q4 + 32K F16 KV starts near 6536 MiB for weights plus ordinary KV; about 1336 MiB remains of 7872 free for recurrent state, CUDA, graphs, compute and safety margin. With Q5 the same subtotal is about 7359 MiB, leaving only 513 MiB: too tight for a safe default. Q5 + 16K F16 subtotal is about 6847 MiB, potentially workable but requires measured peak usage.
- Prefer Q4 plus more usable context over Q5 plus a smaller window for the initial IDE deployment. There is no directly measured Q4-to-Q5 coding accuracy gain here.
- File size is a planning approximation for resident weights, not exact GPU memory allocation. Native 262K support is not a promise that 262K fits 8 GB.

### Gaps
- Exact startup, prefill, recurrent checkpoint, and decode VRAM for the downloaded Ornith artifact must be measured on this machine. This researcher deliberately did not start inference.

## How to enforce GPU residency and prove it?

### Takeaway
Explicitly place every tensor on CUDA0 and disable automatic fitting; layer count alone does not prove input embeddings stayed off CPU. Validate both load logs and representative inference. Small host buffers for tokenization, logits, scheduling and staging are normal and differ from CPU-resident model weights or CPU inference layers.

### Cited Findings
- llama.cpp documents CUDA compilation with `-DGGML_CUDA=ON`, and official release assets are available for Windows. Current release checked was v0.7.0 (October 15, 2026); existing local Prism binary's help already exposes required flags. — [Official CUDA build instructions](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md); [Official release](https://github.com/ggml-org/llama.cpp/releases/tag/v0.7.0)
- Current argument definitions support `--n-gpu-layers all`, `--override-tensor`, `--fit off`, `--no-host`, `--kv-offload`, `--flash-attn on`, `--parallel 1`, and cache type flags. `--no-host` bypasses host buffers; it is not an independent guarantee that every model tensor uses GPU. — [Official argument source](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/common/arg.cpp)
- Tensor overrides use regex search against tensor names and directly choose the specified non-CPU buffer type. `.*=CUDA0` therefore also covers token embeddings that an all-layer setting can otherwise leave on host memory. — [Official loader source](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/src/llama-model-loader.cpp)
- The model loader prints both the GPU layer count and per-backend `model buffer size`; GPU backend lists can include CPU fallback. Those logs must be checked together. — [Official model source](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/src/llama-model.cpp)
- Ornith publishes its adjusted Qwen XML chat template, which formats function/parameter tags and preserves assistant reasoning in history; it can be supplied with `--chat-template-file` if the GGUF's embedded template differs. — [Official chat template](https://huggingface.co/ornith-ai/Ornith-1.5-9B/raw/main/chat_template.jinja)

### Inferences
Recommended initial command (paths are examples; append the application's normal networking and sampling parameters):

```powershell
.\bin\llama-server.exe -m .\models\Ornith-1.5-9B-Q4_K_M.gguf `
  --n-gpu-layers all --override-tensor '.*=CUDA0' --fit off `
  --no-host --load-mode none --kv-offload --flash-attn on `
  --parallel 1 --ctx-size 16384 --cache-type-k f16 --cache-type-v f16 `
  --batch-size 512 --ubatch-size 128 --jinja --reasoning-format deepseek `
  --host 127.0.0.1 --port 8080
```

- `--load-mode none` avoids keeping the GGUF persistently memory mapped; model loading still necessarily uses transient host I/O/staging. This option is optional for full-GPU inference, but reduces ambiguity when the user asks for no CPU weight residency.
- Require the log to show all layers (typically `33/33` for 32 transformer layers plus output), a CUDA0 model buffer, CUDA0 KV and recurrent state buffers, and no positive CPU/CPU_Mapped/host **model** buffer. A small CPU output or compute buffer does not imply CPU model offload.
- Reject a startup that silently lowers GPU layers, enables CPU MoE/FFN, reports model tensors on CPU, or puts KV state on CPU. Do not use `--cpu-moe`, `--n-cpu-moe`, `--n-cpu-ffn`, `--no-kv-offload`, or CPU tensor overrides.
- Run representative long-prompt prefill followed by native structured tool calls and a small coding edit/verification task; record peak dedicated VRAM and ensure no Windows shared GPU memory spill. Only then raise context to 32K or use Q8 KV for additional headroom. Settings alone do not establish measured runtime behavior.
- The existing launcher is calibrated for a 27B Bonsai model's layer/KV/recurrent memory and CPU embeddings. Its hardcoded accounting must not be reused for the 9B architecture. In particular, selecting a different filename without changing per-model architecture memory data will give incorrect context estimates.

### Gaps
- The downloaded GGUF's embedded template has not yet been compared against the official Ornith template. Native tool-call parsing should be checked using the existing runtime before deciding to override the template.
- This research does not establish whether this machine's NVIDIA Windows driver will permit shared-memory fallback under pressure. Keep dedicated VRAM margin and verify the actual representative workload.
