# kernels/ — probes and rejected prototypes

This directory contains **measurement tools**, not a replacement inference
engine. The profiler showed that the dense decode is already at 83–103% of the
measured memory roofline, so a custom GEMV/dequant kernel has very little room.
The only kernel-level change that survived A/B is the MMVQ launch-shape patch
in `forks/patches/`.

## bandwidth

`bandwidth.cu` measures:

- device read / write / copy bandwidth (512 MiB);
- D2D memcpy;
- H2D/D2H pageable and pinned.

Build and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-machine-probes.ps1
.\bin\probes\bandwidth.exe --size-mb 512 --json bench\results\bandwidth.json
```

Result on this machine: **245 GB/s read**, 244 GB/s write, 227 GB/s copy,
~13.3 GB/s PCIe pinned. The 9B Q4 decode at 43.4 tok/s corresponds to 250 GB/s
of model bytes, i.e. 102% of the copy/read probe (read-only can be slightly
higher). There is no 20% GEMV win hiding here.

## What was not built

- A custom fused dequant+GEMM: llama.cpp already has MMQ/MMVQ and the prefill
  path is Tensor-Core MMQ; replacing it would be a large correctness risk for a
  small ceiling.
- A fused RMSNorm+RoPE: the CUDA backend already fuses RMSNorm + mul + RoPE
  (`rms_norm_mul_rope_f32`) and it is only ~2.5% of decode.
- A GPU sampler: the profile shows the GEMV dominates; backend sampling was
  measured separately (+1.5% decode, −3% prefill, rejected).
- FlashAttention replacement: llama.cpp's `fattn-mma-f16` is 26% of prefill and
  is already the right path; no replacement was benchmarked.

The negative results are part of the engineering record. A kernel is kept only
when it beats the upstream path in repeated A/B and passes `test-backend-ops`.
