# Extended validation — September 14, 2026

Status: **complete**. Supporting checks and fixtures are published in [validation/](validation/).

The published artifact is available at [Hugging Face](https://huggingface.co/pyrodog/DeepSeek-V4.1-Flash-UNCENSORED-DwarfStar-Q2). This report tests the exact Q2 bootstrap artifact, not the FP8 source or a stock Q2 model.

## Artifact and download verification

- Exact local size: **365,713,686,528 bytes**.
- SHA-256: `3fc64cd3705aa8d5a94358d723f5e0e48016d044630ac158aaf4aa2d0f2b2618`.
- Upload completed at 07:32:01 UTC−06:00. Hugging Face's LFS size and SHA-256 matched, and the release documents matched the approved local package.
- Six unauthenticated HTTP range downloads, each 65,536 bytes, matched local bytes at the beginning, interior offsets, and end. This is not a full second download. See [public-download.json](validation/public-download.json).
- Expanded source audit: **1,046/1,046 layout and payload entries passed**; process exit 0. Source checkpoint revision `d61c59ea5e514e25d305b5850e8a432f7a9969f2`, DwarfStar revision `a04f46fa423e45712c8c7e430eff422479f314a3`.
- All **924 non-expert payloads** were re-encoded and compared. **960 expert payloads** (8 per expert tensor across 120 tensors) were checked; none overlap the original audit's 360 expert samples. There are 46,080 total expert payloads, so this remains sampled coverage.
- **2,060 Engram rows** were checked across two tensors, including fixed boundary rows and 1,024 seeded random rows per tensor. There are 768,022,850 total rows, so this is a very small sample.
- Fixed sample seed: 20260914 plus layer or row count. Full coverage numbers: [coverage.json](validation/coverage.json); audit log: [payload-audit.log](validation/payload-audit.log).

This checks conformity to the converter's recipe. It does not establish that the recipe itself preserves the source model's quality, or compare with an independent quantizer.

## Daily coding exercises

Three small, handcrafted repository tasks run through OpenCode with the local model. These are representative exercises, not a benchmark suite or a production-repository evaluation. One scored attempt per task; no human repair of generated implementation code.

| Task | Independent checks | End-to-end time | Tool calls | Largest reported step token total |
| --- | --- | --- | --- | --- |
| csv_import | PASS | 14.22 min | 8 | 17,385 |
| http_retry | PASS | 11.24 min | 11 | 15,869 |
| sqlite_pagination | PASS | 6.91 min | 8 | 12,968 |

Tasks cover:

1. **CSV import:** UTF-8 BOM, trimmed headers and fields, string IDs, exact Decimal money, blank rows, bad quantities, nonfinite/negative prices, and field/line diagnostics.
2. **HTTP retry:** response classification, exponential backoff, numeric Retry-After, no final sleep, attempt limits, network exceptions, and preserving the original error.
3. **SQLite pagination:** parameterized tenant filtering, quoted IDs, stable ordering across equal timestamps, exclusive cursors, and limit validation.

The independent tests were written before model generation and inserted into each project only after its model run ended. All three suites failed against the original broken fixtures. Model-written tests are additional evidence, not the acceptance oracle. Prompts, starting files and independent tests are in [cases.json](validation/cases.json); baseline and acceptance logs are separate. Temporary directory prefixes in published baseline logs are redacted; test outcomes are unchanged. Generated projects are published under [validation/projects/](validation/projects/).

The first unattended attempt was blocked by OpenCode's normal approval prompts and is retained locally under `permission-blocked-attempt/`. It is an invalid harness attempt, not a scored model-quality failure. The scored run allowed local shell/edit actions in disposable directories. No source changes were made to the model, runtime, or quantization code. The separate expanded auditor changed sampling only.

## Runtime and limitations

Apple M5 Max, 128 GB unified memory. DwarfStar Metal SSD streaming; 32 GiB expert-cache target; 262,144 shared context; OpenCode 1.18.30; temperature 1.0, top-p 0.95. Output cap remains 262,144, bounded by remaining context. No explicit reasoning variant override. Timings include reasoning, generation, tool calls, and client/server overhead. CSV and part of HTTP overlapped the source audit; the upload overlapped early testing. These are not isolated throughput measurements.

The active GGUF and KV storage were on the internal SSD. The Samsung held the source checkpoint. After the Samsung returned, the source audit completed; the already-running server generated responses without a restart. This **does not test recovery after unplugging the drive containing an active model**.

The completed runs exercised actual tool execution and context reuse. No full 256K conversation, long output limit, vision, DSpark, repeated-seed stability, stock-Q2/FP8 comparison, or refusal-removal evaluation was performed. Small fixture success does not establish production coding reliability. The multi-minute task times are a material usability limitation.

## Reproduction

Run the provided scripts from the original workspace root with the matching DwarfStar checkout in `work/ds4` and Python dependencies in `work/venv`. [run_extended_validation.py](validation/run_extended_validation.py) creates disposable projects and invokes the already-configured local OpenCode provider. [cases.json](validation/cases.json) also supports porting the fixtures to another harness. Do not run that script over an existing result directory without first preserving it.

[extended_payload_audit.py](validation/extended_payload_audit.py) expects the matching converter modules beside it under `ds4/gguf-tools`; the executed copy was under `work/`. Supply `--hf`, `--gguf`, `--source-revision`, and `--payload` as recorded in the methodology. [check_public_download.py](validation/check_public_download.py) checks the immutable published artifact commit. Local raw transcripts contain local paths and are retained for review, not automatically published.


# September 15 follow-up

The earlier sections describe the September 14 OpenCode agent runs with the explicit 32 GiB expert-cache target. Subsequent automatic-cache, long-input and calibration checks are separate experiments.

## Current hardware, RAM and settings (September 15, 2026)

Our current daily setup uses the original bootstrap Q2 distributed here, Apple M5 Max with 128 GB unified memory, an internal SSD for the GGUF and disk KV cache, Metal, SSD streaming, and 262,144 shared context tokens. We now let DwarfStar size the expert cache automatically by omitting `--ssd-streaming-cache-experts`. The commands above reflect this change. The 32K CLI example is a smaller-context starting point; the measurements below are for the 262K server.

| DwarfStar memory budget at 262K context | Earlier explicit `32gb` cache | Current automatic cache |
| --- | ---: | ---: |
| Expert-cache target including prefill reserve | 32.00 GiB | 77.62 GiB |
| Dynamic expert cache | 24.88 GiB | 70.51 GiB |
| Routed-prefill reserve | 7.12 GiB | 7.12 GiB |
| Total planned model, cache, KV and buffers | 51.74 GiB | 97.37 GiB |

These are runtime-reported planned budgets, not constant resident RAM measurements or whole-system usage. Memory residency changes as pages are touched; macOS, other applications and filesystem caching also need memory. The 340.6 GiB file is not loaded entirely into RAM. Native Engram tables stay on disk. Automatic sizing selected these values on our machine; other machines may differ. Sampled memory pressure was normal, but swap activity increased, particularly with the larger cache. This is not a zero-swap configuration. To reproduce the earlier smaller budget, add `--ssd-streaming-cache-experts 32gb`.

In four alternating trials (32/auto/32/auto), mean initial response time changed from 30.23 to 29.38 seconds, and mean follow-up time from 28.23 to 22.08 seconds: 21.8% less elapsed time for the follow-up and 12.0% for the whole exchange. Corresponding text was identical. This was one short SQLite coding exchange, two observations per setting, with OS caches not flushed. Follow-ups intentionally reached the 256-token cap. These results do not promise the same speedup in daily projects. More cache changes weight residency, not quantization precision.

OpenCode uses provider `ds4`, model `deepseek-v4.1-flash`, endpoint `http://127.0.0.1:8000/v1`, temperature 1.0 and top-p 0.95. Client context and output ceiling are both 262,144, sharing the same server context. Default reasoning is unchanged. An optional model variant `nothink` sets `reasoningEffort` to `none`; it was checked with a real read-tool round trip. Our disposable automated coding runs allowed local tool actions; this is a harness choice, not a model requirement. Disk KV storage has an 8,192 MiB budget. On September 15, after restarting the service, OpenCode again read a local marker file and returned its exact contents; the follow-up reused 9,937 cached tokens.

### About the Hugging Face hardware panel

The tested configuration above is the compatibility evidence for this release. Hugging Face's [hardware panel](https://huggingface.co/docs/hub/hardware) estimates compatibility against the viewer's saved hardware. It currently does not recognize this file's `Q2-bootstrap` variant name. DwarfStar Q2 is a mixed recipe (IQ2_XXS, Q2_K, Q8_0, F16/F32 and native Engram data), not a single standard quantization type. We retain the original filename and checksum rather than relabeling it just to satisfy detection. No Hub compatibility estimate for this DwarfStar streaming layout has been validated here. The displayed GGUF parameter count is not a RAM requirement; use the measured runtime budgets and disk requirements above.

## Calibration comparison and long-context follow-up

We collected an experimental activation imatrix using the original bootstrap Q2 on 128 seeded, upstream-derived coding prompts (86,384 tokens; 20,732,160 routes). Coverage reached 45,636 of 46,080 expert payload slices (99.04%); unobserved slices use the converter's fallback. Collection took about 87 minutes. We then rebuilt a separate Q2 from the same pinned dealignAI source, passed the 1,046-entry source-payload audit (sampled expert/Engram coverage), and computed its SHA-256. This experimental file is not the published download.

| Matched direct-API coding exercise | Published bootstrap | Experimental calibrated Q2 |
| --- | --- | --- |
| CSV import and decimal money | FAIL | FAIL |
| HTTP retries and backoff | PASS | PASS |
| Tenant-safe SQLite pagination | PASS | PASS |

Both used temperature 0, top-p 0.95, seed 42, thinking disabled, 32K context, fresh disk KV caches and a 2,048-token output cap. Independent tests were not shown to the model, and generated implementation code was not repaired. These were single-response exercises, unlike the earlier OpenCode agent runs, which could use tools and iterate and passed all three. There is no contradiction between those outcomes. The bootstrap ran from internal storage and the candidate from external storage, so their timings cannot isolate a calibration effect.

**We found no demonstrated coding gain in this small comparison and kept the original bootstrap Q2 active and published.** This does not prove calibration never helps, nor compare our derivative against the stock DwarfStar Q2. Five short continuation checks against the unmodified official model produced mixed metrics and are supplementary evidence, not daily-coding quality proof.

Separately, the published bootstrap with automatic caching passed a controlled SQLite task at 32,337, 65,105, 130,641 and 245,331 input tokens. Each output passed the existing independent functional tests after removing Markdown fences; all four violated the no-fences formatting instruction. A follow-up at 245,588 input tokens reused 245,500 cached tokens and returned the correct event ID in 8.76 seconds. Inputs contained real DwarfStar source between the task and final instruction. This was not a natural long-running OpenCode session. Near-limit cache restoration after a restart remains untested. Sampled memory pressure stayed normal; final system swap was approximately 6.6 GiB.

See [the follow-up evidence](validation/followup-20260915/README.md) for methods, recorded results and limitations. The model download and its checksum are unchanged.

