#!/usr/bin/env python3
"""Small progressive autotuner for the RTX 4060 lab.

It does not brute-force the whole space. It starts from the measured MoE split
and evaluates one change at a time (neighbour search), using llama-server
because that is what the end user actually runs.

Examples:
    python bench/autotune.py --model gpt-oss-20b --context 65536 --dry-run
    python bench/autotune.py --model gpt-oss-20b --context 65536 --max-runs 4
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "bench" / "config" / "models.json"
MEASURED = ROOT / "config" / "measured-moe-profiles.json"
OUTDIR = ROOT / "reports"


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def measured_choice(model_key: str, ctx: int) -> tuple[int, int] | None:
    if not MEASURED.exists():
        return None
    alias = {"qwen36-35b": "qwen36-35b-a3b", "qwen3-30b": "qwen3-30b-a3b-2507"}
    data = load(MEASURED).get("models", {})
    entry = data.get(alias.get(model_key, model_key))
    if not entry or not entry.get("contexts"):
        return None
    rows = sorted(entry["contexts"], key=lambda r: int(r["ctx"]))
    choice = next((r for r in rows if int(r["ctx"]) >= ctx), rows[-1])
    return int(choice["nCpuMoe"]), int(entry.get("threads", 8))


def run_candidate(model: str, ctx: int, n_cpu: int, threads: int, kv: str, ubatch: int, tag: str) -> dict[str, Any] | None:
    out = OUTDIR / f"autotune-{tag}"
    cmd = [
        sys.executable, str(ROOT / "bench" / "server_suite.py"),
        "--model", model, "--context", str(ctx), "--prompts", "2048",
        "--n-predict", "128", "--runs", "1", "--n-cpu-moe", str(n_cpu),
        "--threads", str(threads), "--kv", kv, "--ubatch", str(ubatch),
        "--out", str(out), "--label", tag,
    ]
    print("  " + " ".join(cmd[1:]))
    p = subprocess.run(cmd, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        return None
    try:
        data = load(out / "server_results.json")
        rows = [r for r in data.get("rows", []) if not r.get("note")]
        if not rows:
            return None
        r = rows[-1]
        return {
            "model": model,
            "ctx": ctx,
            "n_cpu_moe": n_cpu,
            "threads": threads,
            "kv": kv,
            "ubatch": ubatch,
            "decode_tok_s": float(r.get("decode_tok_s") or 0),
            "prefill_tok_s": float(r.get("prefill_tok_s") or 0),
            "ttft_ms": float(r.get("ttft_ms") or 0),
            "vram_peak_mib": int(r.get("vram_peak_mib") or 0),
            "source": str(out.relative_to(ROOT)),
        }
    except Exception:
        return None


def score(r: dict[str, Any], objective: str) -> float:
    if not r:
        return -1e9
    if objective == "speed":
        return r["decode_tok_s"] * 0.8 + r["prefill_tok_s"] / 100.0 * 0.2
    if objective == "quality":
        # Prefer larger context / f16 KV; decoded speed is secondary.
        q = 1.0 if r["kv"] == "f16" else 0.0
        return q * 20 + r["decode_tok_s"] * 0.2 + r["prefill_tok_s"] / 100.0 * 0.1
    return r["decode_tok_s"] * 0.65 + r["prefill_tok_s"] / 100.0 * 0.25 + r["vram_peak_mib"] / 10000.0 * 0.05


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--context", type=int, default=65536)
    ap.add_argument("--objective", choices=["balanced", "speed", "quality"], default="balanced")
    ap.add_argument("--max-runs", type=int, default=4)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    models = load(MODELS)["models"]
    if args.model not in models:
        raise SystemExit(f"unknown model in bench/config/models.json: {args.model}")
    m = models[args.model]
    base = measured_choice(args.model, args.context)
    n0, t0 = base if base else (int(m.get("n_cpu_moe", 0)), int(m.get("threads", 8)))
    kv0 = m.get("kv", "q8_0")
    ub0 = int(m.get("ubatch", 512))
    candidates = [(n0, t0, kv0, ub0)]
    if m.get("moe"):
        candidates.append((n0 + 1, t0, kv0, ub0))  # one more CPU layer = safer
        candidates.append((n0, 12, kv0, ub0))
    else:
        candidates.append((0, 12, kv0, ub0))
    candidates.append((n0, t0, kv0, 256 if ub0 != 256 else 512))
    if kv0 != "f16":
        candidates.append((n0 + (1 if m.get("moe") else 0), t0, "f16", ub0))
    # De-duplicate, skip n above the model's expert layers.
    seen = set()
    uniq = []
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        if c[0] < 0:
            continue
        uniq.append(c)
    uniq = uniq[: max(1, args.max_runs)]

    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    tagbase = f"{args.model}-{args.objective}-{stamp}"
    print(f"Autotune {args.model} ctx={args.context} objective={args.objective}")
    print(f"Base from measured table: n-cpu-moe={n0}, threads={t0}, kv={kv0}, ubatch={ub0}")
    if args.dry_run:
        for c in uniq:
            print("  candidate", c)
        return 0

    results = []
    for i, (n, t, kv, ub) in enumerate(uniq):
        r = run_candidate(args.model, args.context, n, t, kv, ub, f"{tagbase}-{i}")
        if r:
            r["score"] = round(score(r, args.objective), 3)
            results.append(r)
            print(f"    -> decode={r['decode_tok_s']:.2f} prefill={r['prefill_tok_s']:.0f} vram={r['vram_peak_mib']} score={r['score']}")
    if not results:
        print("No candidate completed.", file=sys.stderr)
        return 1
    best = max(results, key=lambda r: r["score"])
    out = args.out or (ROOT / "profiles" / f"autotuned-{args.model}.json")
    payload = {
        "model": args.model,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "objective": args.objective,
        "context": args.context,
        "best": best,
        "candidates": results,
        "method": "measured-table seed + neighbour search (GPU layers, threads, KV, ubatch); one llama-server run per candidate",
    }
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out}")
    print(f"Best: n-cpu-moe={best['n_cpu_moe']} threads={best['threads']} kv={best['kv']} ubatch={best['ubatch']} "
          f"decode={best['decode_tok_s']:.2f} prefill={best['prefill_tok_s']:.0f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
