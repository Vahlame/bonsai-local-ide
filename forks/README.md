# Local forks

This directory holds local, machine-specific forks used by the RTX 4060 lab.
Each fork is a Git worktree of a pinned upstream revision; the upstream source
is not copied into this repository's history.

| Fork | Upstream | Pinned commit | License | Purpose |
|---|---|---|---|---|
| `llama.cpp-4060` | https://github.com/ggml-org/llama.cpp | `8642541b255bfb5dc39cd351a178be09013a55d6` (v0.8.0) | MIT | Ada/sm89 experiments: MMVQ launch-shape tuning, build-flag audit |

## Rules

1. Every experiment starts from the pinned commit with a clean worktree.
2. Patches live in `forks/patches/` and are applied with
   `git apply` (or `git -C forks/llama.cpp-4060 apply ...`).
3. A patch is kept only if it passes `test-backend-ops` (or an equivalent
   correctness test) and wins a repeated A/B benchmark. Negative results are
   documented and the patch is not merged.
4. No proprietary NVIDIA code is copied or modified. Only public CUDA,
   cuBLAS and CUTLASS interfaces are used.

## Current patches

| Patch | Hypothesis | Status |
|---|---|---|
| `0001-mmvq-4060-nwarps.patch` | The generic MMVQ launch shape (4 warps at batch 1) is not optimal for a 24-SM Ada part; test 2/8 warps. | Experimental; not enabled unless it wins. |

## Reproduce

```powershell
git -C "$env:USERPROFILE\.local\opt\bonsai-inference\llama.cpp-rtx4060-opt" worktree add `
  "$PWD\forks\llama.cpp-4060" -b rtx4060-lab
git -C forks\llama.cpp-4060 apply forks\patches\0001-mmvq-4060-nwarps.patch
powershell -ExecutionPolicy Bypass -File scripts\build-llama-lab.ps1 -Variant lab-base
```
