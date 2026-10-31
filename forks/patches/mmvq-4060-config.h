#pragma once
// RTX 4060 / sm89 lab prototype.
//
// 0  = upstream behavior (generic table: 4 warps for ncols_dst 1..4)
// 2, 8 = experimental warp counts for the batch-1 decode GEMV.
//
// This header is deliberately separate from mmvq.cu so changing only this
// value recompiles one CUDA translation unit instead of the whole backend.
#ifndef GGML_CUDA_MMVQ_4060_NWARPS
#define GGML_CUDA_MMVQ_4060_NWARPS 0
#endif
