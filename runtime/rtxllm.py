#!/usr/bin/env python3
"""rtxllm — a tiny, honest orchestration layer for the RTX 4060 lab.

It does not reimplement an inference engine. It reads the same llama.cpp
binaries and the measured profiles produced by bench/, computes a VRAM budget,
prints the exact llama-server command, and refuses to recommend a configuration
that does not fit the measured 7.6 GiB safe budget.

Examples:
    python runtime/rtxllm.py list
    python runtime/rtxllm.py budget --model gpt-oss-20b --ctx 65536
    python runtime/rtxllm.py plan --model gpt-oss-20b --profile balanced
    python runtime/rtxllm.py command --model gpt-oss-20b --profile balanced
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "models" / "hub-catalog.json"
MEASURED = ROOT / "config" / "measured-moe-profiles.json"
PROFILES = ROOT / "profiles"
DEFAULT_SERVER = Path.home() / ".local" / "opt" / "bonsai-inference" / "build-RTX4060-Opt-sm89" / "bin" / "llama-server.exe"
MIB = 1024 * 1024
SAFE_BUDGET_MIB = 7600
CUDA_CONTEXT_MIB = 320
DENSE_BUFFER_FRACTION = 0.08


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def model_catalog() -> dict[str, Any]:
    return load_json(CATALOG).get("modelos", {})


def measured_moe() -> dict[str, Any]:
    return load_json(MEASURED).get("models", {}) if MEASURED.exists() else {}


def profile_for(key: str, name: str = "balanced") -> dict[str, Any] | None:
    path = PROFILES / f"{key}.json"
    if not path.exists():
        return None
    data = load_json(path)
    return (data.get("profiles") or {}).get(name) or data.get("recommended")


def kv_scale(kv: str) -> float:
    return {"f16": 1.0, "bf16": 1.0, "q8_0": 0.5, "q4_0": 0.25}.get(kv, 1.0)


def estimate(item: dict[str, Any], ctx: int, kv: str, prof: dict[str, Any] | None = None) -> dict[str, Any]:
    size_mib = item.get("bytes", 0) / MIB
    servidor = item.get("servidor") or {}
    moe = servidor.get("moe") or {}
    is_moe = servidor.get("tipo") == "moe-hibrido"
    kv_bytes_per_token = float(servidor.get("kvF16BytesPorToken") or 0.0) * kv_scale(kv)
    kv_mib = ctx * kv_bytes_per_token / MIB
    measured_peak = None
    measured_margin = None
    n_cpu = None
    if is_moe:
        dense_mib = float(moe.get("densosMiB") or (size_mib - float(moe.get("expertosMiB") or 0)))
        measured = measured_moe().get(item.get("clave", ""))
        n_cpu = None
        gpu_experts_mib = 0.0
        if measured and measured.get("contexts"):
            rows = sorted(measured["contexts"], key=lambda r: int(r["ctx"]))
            choice = next((r for r in rows if int(r["ctx"]) >= ctx), rows[-1])
            n_cpu = int(choice["nCpuMoe"])
            measured_peak = int(choice.get("vramPeakMiB") or 0) or None
            per_layer = float(measured.get("perLayerMiB") or 0)
            total_layers = int(measured.get("totalMoeLayers") or moe.get("capas") or 0)
            gpu_experts_mib = max(0, total_layers - n_cpu) * per_layer
        weights_mib = dense_mib + gpu_experts_mib
        buffers_mib = 620.0
    else:
        weights_mib = size_mib
        buffers_mib = max(512.0, weights_mib * DENSE_BUFFER_FRACTION)
    total = weights_mib + kv_mib + buffers_mib + CUDA_CONTEXT_MIB + 850.0
    if measured_peak:
        total = float(measured_peak)
        measured_margin = 8188 - measured_peak
    elif prof and prof.get("expected", {}).get("vram_mib") and int(prof.get("context", -1)) == int(ctx):
        total = float(prof["expected"]["vram_mib"])
        measured_margin = 8188 - int(prof["expected"]["vram_mib"])
        measured_peak = int(prof["expected"]["vram_mib"])
    return {
        "model_mib": round(size_mib, 1),
        "weights_on_gpu_mib": round(weights_mib, 1),
        "kv_mib": round(kv_mib, 1),
        "buffers_mib": round(buffers_mib, 1),
        "cuda_context_mib": CUDA_CONTEXT_MIB,
        "margin_mib": 850,
        "estimate_mib": round(weights_mib + kv_mib + buffers_mib + CUDA_CONTEXT_MIB + 850.0, 1),
        "total_mib": round(total, 1),
        "measured_peak_mib": measured_peak,
        "measured_margin_mib": measured_margin,
        "safe_budget_mib": SAFE_BUDGET_MIB,
        "safe": total <= SAFE_BUDGET_MIB,
        "n_cpu_moe": n_cpu,
        "is_moe": is_moe,
    }


def cmd_list() -> int:
    cat = model_catalog()
    print(f"{'key':28s} {'quant':10s} {'GiB':>7s} {'ctx':>8s} {'profile':>10s}")
    for key, item in sorted(cat.items()):
        if not item.get("archivo"):
            continue
        p = PROFILES / f"{key}.json"
        prof = "yes" if p.exists() else "-"
        print(f"{key:28s} {str(item.get('plan', {}).get('kv', '-')):10s} {item.get('bytes', 0)/1024**3:7.2f} "
              f"{str(item.get('plan', {}).get('contexto', '-')):>8s} {prof:>10s}")
    return 0


def cmd_budget(args: argparse.Namespace) -> int:
    cat = model_catalog()
    if args.model not in cat:
        print(f"unknown model key: {args.model}", file=sys.stderr)
        return 2
    item = cat[args.model]
    ctx = args.ctx or int((item.get("plan") or {}).get("contexto") or 16384)
    kv = args.kv or str((item.get("plan") or {}).get("kv") or "q8_0")
    prof = profile_for(args.model, "balanced")
    est = estimate(item, ctx, kv, prof)
    print(f"Model: {item.get('nombre', args.model)} ({item.get('archivo')})")
    print(f"Quant: {item.get('gguf', {}).get('arquitectura', '?')} · context {ctx} · KV {kv}")
    print()
    print(f"  weights on GPU : {est['weights_on_gpu_mib']:8.1f} MiB" + (f"  (n-cpu-moe={est['n_cpu_moe']})" if est['is_moe'] else ""))
    print(f"  KV cache (est) : {est['kv_mib']:8.1f} MiB")
    print(f"  compute buffers: {est['buffers_mib']:8.1f} MiB")
    print(f"  CUDA context   : {est['cuda_context_mib']:8.1f} MiB")
    print(f"  safety margin  : {est['margin_mib']:8.1f} MiB")
    print(f"  --------------------------------")
    if est.get("measured_peak_mib"):
        print(f"  measured peak  : {est['measured_peak_mib']:8.1f} MiB  (nvidia-smi high-water mark)")
        print(f"  free at peak   : {est['measured_margin_mib']:8.1f} MiB")
    else:
        print(f"  estimated total: {est['estimate_mib']:8.1f} MiB")
    print(f"  budget         : {est['safe_budget_mib']:8.1f} MiB")
    print()
    if est["safe"]:
        print("SAFE")
        return 0
    print("NOT SAFE")
    over = est["total_mib"] - est["safe_budget_mib"]
    print(f"Over budget by ~{over:.0f} MiB. Recommendations:")
    if kv != "q4_0":
        print("  - KV q8_0 -> q4_0 (quality cost is measurable)")
    print("  - reduce context by 4K-8K")
    if est["is_moe"]:
        print("  - increase n-cpu-moe by 1-2 layers")
    print("  - use a smaller weight quantization")
    return 1


def cmd_plan(args: argparse.Namespace) -> int:
    prof = profile_for(args.model, args.profile)
    cat = model_catalog()
    item = cat.get(args.model)
    if not item:
        print(f"unknown model key: {args.model}", file=sys.stderr)
        return 2
    if not prof:
        print(f"no profile for {args.model}/{args.profile}; generating a budget estimate instead", file=sys.stderr)
        return cmd_budget(args)
    ctx = int(prof.get("context", args.ctx or 65536))
    kv = prof.get("kv", "q8_0")
    est = estimate(item, ctx, kv, prof)
    print(f"{item.get('nombre', args.model)} / {args.profile}")
    print(f"  context={ctx}  kv={kv}  n-cpu-moe={prof.get('n_cpu_moe', '-')}  threads={prof.get('threads', '-')}  "
          f"batch={prof.get('batch', '-')}/{prof.get('ubatch', '-')}")
    exp = prof.get("expected") or {}
    print(f"  expected: decode {exp.get('decode_tok_s', '?')} tok/s · prefill {exp.get('prefill_tok_s', '?')} tok/s · "
          f"TTFT {exp.get('ttft_ms', '?')} ms · VRAM {exp.get('vram_mib', '?')} MiB")
    if est.get("measured_peak_mib"):
        print(f"  measured peak {est['measured_peak_mib']} MiB; free {est['measured_margin_mib']} MiB; budget {est['safe_budget_mib']} MiB")
    print(f"  budget: total ~{est['total_mib']} MiB / {est['safe_budget_mib']} MiB -> {'SAFE' if est['safe'] else 'NOT SAFE'}")
    return 0 if est["safe"] else 1


def build_command(item: dict[str, Any], prof: dict[str, Any], port: int) -> list[str]:
    path = ROOT / "models" / item["archivo"]
    server = str(DEFAULT_SERVER)
    kv = prof.get("kv", "q8_0")
    cmd = [
        server, "-m", str(path), "-ngl", "99", "-sm", "none", "-fa", "on",
        "-c", str(prof.get("context", 65536)), "-ctk", kv, "-ctv", kv,
        "-b", str(prof.get("batch", 1024)), "-ub", str(prof.get("ubatch", 512)),
        "-t", str(prof.get("threads", 8)), "-lm", "none",
        "--host", "127.0.0.1", "--port", str(port), "--parallel", "1",
        "--no-context-shift", "--metrics",
    ]
    if int(prof.get("n_cpu_moe", 0)) > 0:
        cmd += ["--n-cpu-moe", str(prof["n_cpu_moe"])]
    if prof.get("prompt_cache"):
        cmd += ["--cache-ram", "2048"]
    return cmd


def cmd_command(args: argparse.Namespace) -> int:
    cat = model_catalog()
    item = cat.get(args.model)
    prof = profile_for(args.model, args.profile)
    if not item or not prof:
        print(f"no model/profile: {args.model}/{args.profile}", file=sys.stderr)
        return 2
    cmd = build_command(item, prof, args.port)
    print(" ".join(f'"{x}"' if " " in x else x for x in cmd))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list")
    p.set_defaults(func=lambda a: cmd_list())

    p = sub.add_parser("budget")
    p.add_argument("--model", required=True)
    p.add_argument("--ctx", type=int, default=None)
    p.add_argument("--kv", default=None)
    p.set_defaults(func=cmd_budget)

    p = sub.add_parser("plan")
    p.add_argument("--model", required=True)
    p.add_argument("--profile", default="balanced")
    p.add_argument("--ctx", type=int, default=None)
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("command")
    p.add_argument("--model", required=True)
    p.add_argument("--profile", default="balanced")
    p.add_argument("--port", type=int, default=8080)
    p.set_defaults(func=cmd_command)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
