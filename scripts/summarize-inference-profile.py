"""Summarize captured Nsight evidence without running a model or inferring unmeasured speedups."""
import argparse
import csv
import json
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--directory", default="reports/coder-phase2")
args = parser.parse_args()
directory = Path(args.directory).resolve()

def rows(name):
    with (directory / name).open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))

def number(value):
    try:
        return float(value.replace(",", ""))
    except (ValueError, AttributeError):
        return None

kernels = rows("original-stats_cuda_gpu_kern_sum.csv")
api = rows("original-stats_cuda_api_sum.csv")
total_gpu_ns = sum(number(row["Total Time (ns)"]) for row in kernels)
matrix_vector_ns = sum(number(row["Total Time (ns)"]) for row in kernels if "mul_mat_vec_q" in row["Name"])
counter_names = {
    "durationUs": "gpu__time_duration.sum",
    "dramThroughputPct": "gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed",
    "smThroughputPct": "sm__throughput.avg.pct_of_peak_sustained_elapsed",
    "activeWarpsPct": "sm__warps_active.avg.pct_of_peak_sustained_active",
    "registersPerThread": "launch__registers_per_thread",
}
counters = [{
    "id": int(row["ID"]), "kernel": row["Kernel Name"], "grid": row["Grid Size"],
    **{key: number(row.get(metric)) for key, metric in counter_names.items()},
} for row in rows("original-matvec-counters.csv") if row.get("ID", "").isdigit()]

connection = sqlite3.connect(f"file:{directory / 'profile-original-pg512-tg128.sqlite'}?mode=ro", uri=True)
copies = [{"kind": kind, "count": count, "bytes": size, "durationNs": duration}
          for kind, count, size, duration in connection.execute(
              "select copyKind,count(*),sum(bytes),sum(end-start) from CUPTI_ACTIVITY_KIND_MEMCPY group by copyKind")]
connection.close()
summary = {
    "workload": "Original binary; pg512/tg128 x3 including process startup/warmup. Kernel counters: six matching launches from a separate x1 run.",
    "totalGpuKernelNs": total_gpu_ns,
    "quantizedMatrixVectorPct": 100 * matrix_vector_ns / total_gpu_ns,
    "topKernels": [{"name": r["Name"], "gpuTimePct": number(r["Time (%)"]),
                    "totalNs": number(r["Total Time (ns)"]), "instances": int(r["Instances"])} for r in kernels[:8]],
    "apiCalls": [{"name": r["Name"], "count": int(r["Num Calls"]), "totalNs": number(r["Total Time (ns)"])} for r in api],
    "copies": copies, "kernelCounters": counters,
    "interpretation": [
        "Quantized matrix-vector kernels dominate this trace; the large fused Q4_K launch reports high DRAM activity relative to SM throughput, consistent with memory pressure.",
        "API synchronization time includes waiting for GPU work; it is not evidence that removing synchronization is correct or beneficial.",
        "Host-to-device totals include loading model weights. Do not attribute all transfers to token generation.",
        "cudaGraphLaunch and graph-instantiation counts document existing graph reuse, not a new optimization.",
        "Nsight replay and instrumentation alter latency. Use separate unprofiled engine and coding benchmarks for performance decisions.",
        "Counters were captured without locking clocks or flushing caches; they describe sampled launches and do not establish an absolute optimization ceiling.",
    ],
}
output = directory / "profile-summary.json"
output.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(output)
print(f"Quantized matvec GPU time: {summary['quantizedMatrixVectorPct']:.2f}%")
