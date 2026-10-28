---
license: mit
base_model:
- dealignai/DeepSeek-V4.1-Flash-UNCENSORED-FP8
base_model_relation: quantized
pipeline_tag: text-generation
tags:
- gguf
- dwarfstar
- deepseek-v4.1
- quantized
- q2
- apple-silicon
- abliterated
- vision
- multimodal
---

# DeepSeek V4.1 Flash UNCENSORED — DwarfStar Q2 bootstrap

This is a community conversion of [dealignAI's DeepSeek-V4.1-Flash-UNCENSORED-FP8](https://huggingface.co/dealignai/DeepSeek-V4.1-Flash-UNCENSORED-FP8) into the Q2 GGUF format that [DwarfStar](https://github.com/antirez/ds4) uses.

**Why we're sharing it.** To save other people the trouble. We downloaded the source checkpoint, converted it on an Apple M5 Max MacBook Pro with 128 GB of unified memory, checked that the result worked, and hooked it up to OpenCode. If you want the same setup, you can download this file instead of pulling the roughly 510 GB source and spending several hours converting it yourself. This is an independent community effort, not an official release from DeepSeek, dealignAI, or DwarfStar.

## Who did what

- **DeepSeek AI** built the original [DeepSeek-V4.1-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) model and its architecture.
- **dealignAI** produced the abliterated checkpoint. Their model card credits **[@dealignai](https://x.com/dealignai) and [Jordan Schenck / @jordanschenck](https://x.com/jordanschenck)**. The abliteration is entirely their work. We didn't do it and don't take credit for it.
- **Salvatore Sanfilippo (antirez) and the DwarfStar contributors** wrote the inference engine, the V4.1 converter, the quantization code, and the validation tools we used. DwarfStar in turn builds on **llama.cpp and the GGML authors**, whose copyright notices are kept in `LICENSE-DwarfStar`.
- **pyrodog** ran the conversion, packaged it, did the local testing described below, and uploaded it, with help from OpenAI Codex. No training, fine-tuning, merging, or additional abliteration was done. The language weights are quantized from the source checkpoint; the optional vision tensors are copied unchanged in BF16.

## What you're getting

| Item | Value |
| --- | --- |
| File | `DeepSeek-V4.1-Flash-UNCENSORED-Q2-bootstrap.gguf` |
| Exact size | 365,713,686,528 bytes (about 340.6 GiB) |
| Runtime | DwarfStar with DeepSeek V4.1 support |
| Calibration | Weight-energy bootstrap; **no activation imatrix** |
| Tested on | Apple M5 Max, 128 GB unified memory, internal SSD |
| Modality | Text in, text out; optional image input with the [vision sidecar](#optional-vision-september-26-2026); tool calling tested via OpenCode |

**This is not a normal GGUF.** It uses DwarfStar's own tensor layout, so don't expect it to load in llama.cpp, Ollama, LM Studio, or any other GGUF runtime. The language converter excludes vision and DSpark speculative-decoding draft weights. This language file alone remains text-only. The optional vision sidecar below adds image input; DSpark weights are still not included.

The main weights take up about 151.8 GiB, which is more than the 128 GB of RAM on our test machine, so DwarfStar has to stream them from the SSD. Another roughly 188.8 GiB of native Engram tables stay on disk permanently. Put the file on a fast local SSD or it will be painfully slow.

## How this file was produced

1. We downloaded the public dealignAI safetensors checkpoint at revision **`d61c59ea5e514e25d305b5850e8a432f7a9969f2`**. That checkpoint was the direct input to the converter. We did not start from antirez's stock Q2 GGUF.
2. We checked all 48 safetensors files against the SHA-256 hashes in the pinned Hugging Face file manifest.
3. We ran DwarfStar at revision **`a04f46fa423e45712c8c7e430eff422479f314a3`**, using `gguf-tools/deepseek41_quantize.py` with the Q2 recipe, six conversion workers, and resumable output.
4. We changed exactly two metadata strings in the converter: the model's display name and its source URL, so the output correctly identifies itself as the dealignAI derivative. The patch is included. No runtime or quantization logic was touched for the original text release. The optional vision setup below includes a separate, narrowly scoped runtime compatibility patch.
5. We ran `deepseek41_validate_gguf.py --payload` against the pinned source, then did a short Metal inference test and a read-tool round trip through OpenCode.

The Q2 recipe uses IQ2_XXS for the routed gate/up experts, Q2_K for the routed down experts, Q8_0 for attention, shared experts, and output, and F16/F32 for the tensors the recipe designates. Native Engram rows and scales are packed without loss. Note that this is **not** the activation-calibrated recipe instance behind the published stock V4.1 Q2. We make no claim that quality matches it.

Provenance files included: `provenance.json`, `source-sha256.json`, `converter-metadata.patch`, and `SHA256SUMS`.

## Download and run

Install the Hugging Face CLI however you like, then:

```sh
hf download pyrodog/DeepSeek-V4.1-Flash-UNCENSORED-DwarfStar-Q2 \
  DeepSeek-V4.1-Flash-UNCENSORED-Q2-bootstrap.gguf SHA256SUMS \
  --local-dir ./model
cd model
shasum -a 256 -c SHA256SUMS
cd ..

git clone https://github.com/antirez/ds4.git
cd ds4
git checkout a04f46fa423e45712c8c7e430eff422479f314a3
make -j6
./ds4 -m ../model/DeepSeek-V4.1-Flash-UNCENSORED-Q2-bootstrap.gguf \
  --metal --ssd-streaming --ctx 100000
```

### Text-only API server — current configuration (September 26, 2026)

Run from the pinned `ds4` checkout above. These settings match our active server: Metal, SSD streaming, 100,000 context tokens, loopback port 8000, and an 8,192 MiB disk KV cache. Expert-cache sizing stays automatic: no `--ssd-streaming-cache-experts` override. These are our current launch settings, not a claim that every option is DwarfStar's built-in default. Stop an existing server on port 8000 before starting either mode.

```sh
./ds4-server -m ../model/DeepSeek-V4.1-Flash-UNCENSORED-Q2-bootstrap.gguf \
  --metal --ssd-streaming --ctx 100000 \
  --host 127.0.0.1 --port 8000 \
  --kv-disk-dir ./server-kv --kv-disk-space-mb 8192
```

Point your client at `http://127.0.0.1:8000/v1` with model ID `deepseek-v4.1-flash`. Our current OpenCode 2.0.18 settings are temperature 1.0, `reasoningEffort: "max"`, context 100,000, and output ceiling 16,384. See the [OpenCode v2 configuration in VISION.md](VISION.md#opencode-v2); for text-only use, advertise only `"text"` input. Maximum reasoning is a client request setting, not a server launch flag. Other sampling values remain at DwarfStar's defaults unless the client overrides them.

Input and output share the 100,000-token context budget; the output ceiling is not extra context. Earlier 262K context/output settings and the 97.37 GiB planned-memory figure below belong to the dated September 15 tests, not the current launch commands. The included `opencode-dwarfstar.ts` hook is historical OpenCode v1 material and must not be installed in v2.

## Optional vision (September 26, 2026)

Vision is now available as a separate **970,555,584-byte (about 926 MiB)** download: [`DeepSeek-V4.1-Flash-UNCENSORED-Vision-BF16.gguf`](DeepSeek-V4.1-Flash-UNCENSORED-Vision-BF16.gguf). Keep the original Q2 language file; no replacement or reconversion of that file is required.

We copied all **266 vision encoder, aligner/projector, and image-embedding tensors** from the same pinned **dealignAI abliterated checkpoint**, preserving every BF16 payload byte. This is not a vision file substituted from the stock model. All 266 payloads, shapes, types, metadata, and offsets passed validation.

**Use the patched runtime described in [VISION.md](VISION.md).** The pinned DwarfStar build otherwise rejects the abliterated source-revision metadata. The included patch accepts this exact source URL and revision while retaining its architecture and tensor checks. Vision is tested on Metal with SSD streaming; other backends are not validated for this artifact.

After the optional download and build steps in [VISION.md](VISION.md), run from the `ds4-vision` directory:

```sh
./ds4-server -m ../model/DeepSeek-V4.1-Flash-UNCENSORED-Q2-bootstrap.gguf \
  --vision ../model/DeepSeek-V4.1-Flash-UNCENSORED-Vision-BF16.gguf \
  --metal --ssd-streaming --ctx 100000 \
  --host 127.0.0.1 --port 8000 \
  --kv-disk-dir ./server-kv --kv-disk-space-mb 8192
```

Stop an existing server before starting this command on the same port. Omitting `--vision` keeps text-only operation available with this runtime. Both API commands use the same settings; only the vision command adds `--vision` and requires the patched runtime. The text download and checksum are unchanged.

The vision setup passed a direct API check and an **OpenCode 2.0.18 image-attachment check with max reasoning**, identifying two colored shapes and reading a four-character code. These are smoke tests, not a vision/OCR benchmark or a guarantee that the source model's behavior survives language quantization. See [VISION.md](VISION.md) for checksums, reproduction, the v2 configuration example, and limitations. The earlier `opencode-dwarfstar.ts` hook is for v1 and should not be installed in v2.

The September 26 vision checks used 100,000 context tokens and a 16,384-token OpenCode output ceiling. The dated 262K results below describe earlier text-only runs; they are not measurements of this vision setup. Max reasoning remains available.

## What we actually tested

- The five converter fixture tests in the DwarfStar repo passed.
- Every source file hash matched.
- The artifact audit passed its 1,046-tensor layout and payload checks. That covers all non-expert tensors, a selection of experts, and a sample of Engram rows. It did not compare every expert or every Engram row.
- A short 4,096-context Metal run answered `17 × 23 = 391` correctly and wrote a coherent Spanish sentence about backups. That run generated **11.87 tokens per second**.
- OpenCode successfully called `read` on a small test file, got the result back, and returned the expected marker. A follow-up turn reused 10,316 cached tokens.

These are basic "does it turn on" checks, not a coding benchmark or a real quality evaluation. Speed will vary with cache state, context length, memory pressure, and workload. We have **not** independently verified the source publisher's refusal-removal claims, reproduced their evaluations, or checked how well those properties survive Q2 quantization. "UNCENSORED" in the name just identifies which upstream checkpoint this came from. It's not a promise from us about how the model behaves.

## Additional local validation (September 14, 2026)

We subsequently ran a larger source-payload audit: all 1,046 entries passed, including all 924 non-expert payloads, 960 additional expert payloads, and 2,060 sampled Engram rows. Expert and Engram coverage remains sampled, not exhaustive. Six public download byte ranges also matched the local artifact; Hugging Face reported the expected full-file size and SHA-256.

Three small daily-coding exercises through OpenCode passed independent checks: CSV import validation and exact decimal money, HTTP retries and backoff, and tenant-safe SQLite keyset pagination. The independent tests were written before generation and were not shown to the model. The model also wrote and ran its own tests. We did not repair its generated code. One initial attempt was invalid because unattended OpenCode rejected approval prompts; the scored runs used local automatic approval.

End-to-end times were approximately 14.2, 11.2, and 6.9 minutes respectively. These include reasoning and tools, with the first two runs overlapping some validation I/O. This is stronger evidence than a startup smoke test, but three handcrafted exercises are not a coding benchmark or proof of production reliability. At that point we still hadn't tested anything close to the full context window; the follow-up section below adds controlled long-input tests. We still have no comparison against the stock Q2 or the FP8 source, no repeated-seed evaluation, and no independent confirmation of the refusal-removal behavior.

See the [full validation report](VALIDATION-REPORT.md) for methods, evidence, and limitations.

## Historical hardware, RAM and settings (September 15, 2026)

At the time of these September 15 measurements, we ran: the original bootstrap Q2 published here, on an Apple M5 Max with 128 GB of unified memory, with the GGUF and the disk KV cache on the internal SSD, Metal on, SSD streaming on, and 262,144 shared context tokens. We let DwarfStar pick the expert cache size itself by leaving out `--ssd-streaming-cache-experts`. Automatic expert-cache sizing is still used in the current commands, but their context is now 100,000. The numbers below apply only to the historical 262K server.

| DwarfStar memory budget at 262K context | Earlier explicit `32gb` cache | Automatic cache in this test |
| --- | ---: | ---: |
| Expert-cache target including prefill reserve | 32.00 GiB | 77.62 GiB |
| Dynamic expert cache | 24.88 GiB | 70.51 GiB |
| Routed-prefill reserve | 7.12 GiB | 7.12 GiB |
| Total planned model, cache, KV and buffers | 51.74 GiB | 97.37 GiB |

These are the budgets DwarfStar reports it *plans* to use. They are not measurements of resident RAM or of what the whole system is using. Actual residency shifts as pages get touched, and macOS, other apps, and filesystem caching all need memory too. The 340.6 GiB file is never fully loaded into RAM, and the Engram tables stay on disk. Automatic sizing chose these values on our machine; yours may land elsewhere. Memory pressure looked normal when we sampled it, but swap activity went up, especially with the bigger cache, so don't expect a zero-swap setup. If you want the smaller budget back, add `--ssd-streaming-cache-experts 32gb`.

We ran four alternating trials (32/auto/32/auto). Mean time to first response went from 30.23 to 29.38 seconds, and mean follow-up time from 28.23 to 22.08 seconds, which works out to 21.8% less time on the follow-up and 12.0% less on the whole exchange. The generated text was identical either way. Keep in mind this was one short SQLite coding exchange, two runs per setting, with OS caches not flushed, and the follow-ups were deliberately allowed to hit the 256-token cap. Your day-to-day projects may not see the same speedup. A bigger cache only changes which weights stay in memory; it doesn't change precision.

In this September 15 configuration, OpenCode used provider `ds4`, model `deepseek-v4.1-flash`, endpoint `http://127.0.0.1:8000/v1`, temperature 1.0, and top-p 0.95. Client context and output ceiling were both 262,144 and shared the server's context. Reasoning was left at its default in that historical configuration. There's an optional `nothink` model variant that sets `reasoningEffort` to `none`; we confirmed it works with a real read-tool round trip. Our throwaway automated coding runs let the model take local tool actions, but that's a choice of how we ran the harness, not something the model needs. The disk KV store has an 8,192 MiB budget. On September 15, after restarting the service, OpenCode once again read a local marker file and returned its exact contents; the follow-up reused 9,937 cached tokens.

### About the Hugging Face hardware panel

The tested setup above is the real compatibility evidence for this release. Hugging Face's [hardware panel](https://huggingface.co/docs/hub/hardware) tries to estimate compatibility against whatever hardware you've saved in your profile, but it doesn't recognize this file's `Q2-bootstrap` variant name. That's because DwarfStar Q2 is a mix of formats (IQ2_XXS, Q2_K, Q8_0, F16/F32, plus native Engram data), not one standard quantization type. We're keeping the original filename and checksum rather than renaming the file just to make the panel happy. Nobody has validated a Hub compatibility estimate for this streaming layout. The parameter count shown for the GGUF is not a RAM requirement; go by the measured runtime budgets and disk requirements above.

## Calibration comparison and long-context follow-up

We wanted to know whether a properly calibrated Q2 would beat the bootstrap one. So we collected an experimental activation imatrix, using the bootstrap Q2 itself, on 128 seeded coding prompts derived from upstream material (86,384 tokens; 20,732,160 routes). That covered 45,636 of the 46,080 expert payload slices (99.04%); the rest fall back to the converter's default. Collection took about 87 minutes. We then built a second Q2 from the same pinned dealignAI source, ran it through the same 1,046-entry source-payload audit (with sampled expert and Engram coverage), and recorded its SHA-256. This experimental file is **not** the one you download here.

| Matched direct-API coding exercise | Published bootstrap | Experimental calibrated Q2 |
| --- | --- | --- |
| CSV import and decimal money | FAIL | FAIL |
| HTTP retries and backoff | PASS | PASS |
| Tenant-safe SQLite pagination | PASS | PASS |

Both ran with temperature 0, top-p 0.95, seed 42, thinking off, 32K context, fresh disk KV caches, and a 2,048-token output cap. The independent tests were never shown to the model, and we didn't fix its code. These were one-shot answers with no tools, which is why the CSV task failed here but passed in the earlier OpenCode runs, where the agent could iterate. The two results don't contradict each other. The bootstrap ran from the internal drive and the candidate from an external one, so the timings can't tell you anything about calibration.

**Bottom line: this small comparison showed no coding improvement, so the original bootstrap Q2 stays published and in use.** That doesn't mean calibration never helps, and it says nothing about how our build compares to the stock DwarfStar Q2. We also ran five short continuation checks against the unmodified official model; the metrics were mixed, and they're supporting evidence at best, not proof of day-to-day coding quality.

On a separate track, we pushed the published bootstrap (with automatic caching) through a controlled SQLite task at 32,337, 65,105, 130,641, and 245,331 input tokens. Every output passed the existing independent functional tests once we stripped the Markdown fences, though all four ignored the instruction not to use fences. A follow-up at 245,588 input tokens reused 245,500 cached tokens and returned the correct event ID in 8.76 seconds. The inputs had real DwarfStar source code sitting between the task and the final instruction. This was a controlled test, not a natural long-running OpenCode session, and we still haven't tested whether the cache restores correctly near the limit after a restart. Memory pressure stayed normal when sampled; system swap ended at about 6.6 GiB.

See [the follow-up evidence](validation/followup-20260915/README.md) for methods, recorded results, and limitations. The model download and its checksum are unchanged.

## Reproducing the conversion

See `REPRODUCE.md`. You'll need roughly 876 GB of free space for the source plus the output, before caches and headroom. We kept the source on an external Samsung SSD and wrote the output to the internal SSD. Both source verification and the converter need the original checkpoint on disk.

## License

The base model and the dealignAI checkpoint are MIT-licensed. The original DeepSeek license is included as `LICENSE`, and DwarfStar's MIT notice with its upstream acknowledgements is included as `LICENSE-DwarfStar`. If you redistribute this file, keep the upstream credits and notices intact.
