#!/usr/bin/env python3
"""Perplexity/quality checks for the quantization and KV-cache matrix.

Absolute perplexity depends on the corpus, so the report only compares
configurations that saw the exact same file, context and chunk count. The
corpus is `bench/corpus/quality.txt`, assembled deterministically from the
repository's own documentation.
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench_suite import GpuSampler, aggregate_samples  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
TOOLCHAIN_PATH = ROOT / "config" / "inference-toolchain.local.json"
DEFAULT_BIN = Path.home() / ".local" / "opt" / "bonsai-inference" / "build-RTX4060-Opt-sm89" / "bin" / "llama-perplexity.exe"
CORPUS = ROOT / "bench" / "corpus" / "quality.txt"


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def run_case(binary: Path, model: Path, kv: str, ctx: int, chunks: int, threads: int, out_raw: Path) -> dict:
    cmd = [
        str(binary), "-m", str(model), "-f", str(CORPUS),
        "-c", str(ctx), "-b", "512", "-ub", "512", "-ngl", "99", "-fa", "on",
        "-t", str(threads), "--chunks", str(chunks), "--log-colors", "off",
        "-ctk", kv, "-ctv", kv,
    ]
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    sampler = GpuSampler(proc.pid, interval_s=0.5)
    sampler.start()
    stdout, _ = proc.communicate(timeout=1800)
    wall = (time.perf_counter() - t0) * 1000
    sampler.stop()
    raw = out_raw / f"{model.stem}__kv{kv}__c{ctx}.log"
    raw.write_text(stdout, encoding="utf-8")
    ppl = None
    m = re.search(r"Final estimate:\s*PPL\s*=\s*([0-9.]+)", stdout)
    if m:
        ppl = float(m.group(1))
    else:
        # Older/newer builds may print "PPL = ..." without the prefix.
        m = re.search(r"PPL\s*=\s*([0-9.]+)", stdout)
        if m:
            ppl = float(m.group(1))
    telem = aggregate_samples(sampler.samples)
    return {
        "model": model.name,
        "quant": model.stem.split("-")[-1],
        "kv": kv,
        "ctx": ctx,
        "chunks": chunks,
        "ppl": ppl,
        "wall_ms": round(wall, 1),
        "exit": proc.returncode,
        "note": "" if ppl is not None else "PPL not found in output; see raw log",
        **telem,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", type=Path, default=DEFAULT_BIN)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--chunks", type=int, default=12)
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    binary = args.binary.resolve()
    if not binary.exists():
        raise SystemExit(f"missing {binary}")
    run_id = f"quality-{_dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out = (args.out or (ROOT / "reports" / f"bench-{run_id}")).resolve()
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    chunks = 4 if args.quick else args.chunks

    cases = []
    for q in ("Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M", "Q3_K_M"):
        p = ROOT / "models" / f"Qwen3-4B-Instruct-2507-{q}.gguf"
        if p.exists():
            cases.append((p, "f16", 512, "quant"))
    q4 = ROOT / "models" / "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
    for kv in ("f16", "q8_0", "q4_0"):
        if q4.exists():
            cases.append((q4, kv, 1024, "kv"))

    rows = []
    for model, kv, ctx, purpose in cases:
        print(f"{model.name} kv={kv} ctx={ctx} chunks={chunks} purpose={purpose}")
        try:
            row = run_case(binary, model, kv, ctx, chunks, args.threads, raw)
        except Exception as exc:
            row = {"model": model.name, "kv": kv, "ctx": ctx, "chunks": chunks, "ppl": None, "note": str(exc)}
        row["purpose"] = purpose
        rows.append(row)
        print(f"  PPL={row.get('ppl')} wall={row.get('wall_ms')} ms vram={row.get('vram_peak_mib')} MiB")
    # Separate baselines: quant rows against Q8/f16@512, KV rows against Q4/f16@1024.
    bases = {
        "quant": next((r for r in rows if r.get("purpose") == "quant" and "Q8_0" in r.get("model", "") and r.get("ppl")), None),
        "kv": next((r for r in rows if r.get("purpose") == "kv" and r.get("kv") == "f16" and r.get("ppl")), None),
    }
    for r in rows:
        base = bases.get(r.get("purpose"))
        if base and r.get("ppl"):
            r["delta_ppl_pct"] = round(100 * (r["ppl"] - base["ppl"]) / base["ppl"], 3)
        else:
            r["delta_ppl_pct"] = None
    meta = {
        "run_id": run_id,
        "started_at": now_iso(),
        "corpus": str(CORPUS),
        "corpus_sha256": __import__("hashlib").sha256(CORPUS.read_bytes()).hexdigest(),
        "corpus_bytes": CORPUS.stat().st_size,
        "chunks": chunks,
        "ctx": "per-case",
        "binary": str(binary),
        "rows": rows,
    }
    fields = ["purpose", "model", "quant", "kv", "ctx", "chunks", "ppl", "delta_ppl_pct", "wall_ms", "vram_peak_mib", "power_avg_w", "temp_max_c", "exit", "note"]
    with (out / "quality_results.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})
    (out / "quality_results.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [
        "# Quality report — quantization and KV cache",
        "",
        f"Corpus: `{CORPUS.name}` ({meta['corpus_bytes']} bytes, SHA-256 `{meta['corpus_sha256'][:16]}…`) · "
        f"chunks per case: {chunks} · same text for every row.",
        "",
        "## Weight quantization (Q8_0 reference, f16 KV, 512 ctx)",
        "",
        "| weights | PPL | Δ vs Q8_0 | VRAM peak MiB |",
        "|---|---:|---:|---:|",
    ]
    for r in rows:
        if r.get("purpose") != "quant":
            continue
        lines.append(
            f"| {r.get('quant')} | {r.get('ppl') or '—'} | "
            f"{r.get('delta_ppl_pct') if r.get('delta_ppl_pct') is not None else '—'}% | "
            f"{r.get('vram_peak_mib') or '—'} |"
        )
    lines += [
        "",
        "## KV cache precision (same Q4_K_M weights, 1024 ctx)",
        "",
        "| KV | PPL | Δ vs f16 | VRAM peak MiB |",
        "|---|---:|---:|---:|",
    ]
    for r in rows:
        if r.get("purpose") != "kv":
            continue
        lines.append(
            f"| {r.get('kv')} | {r.get('ppl') or '—'} | "
            f"{r.get('delta_ppl_pct') if r.get('delta_ppl_pct') is not None else '—'}% | "
            f"{r.get('vram_peak_mib') or '—'} |"
        )
    lines += [
        "",
        "## Interpretation rules",
        "",
        "- A perplexity difference below ~0.5% is not distinguishable from corpus/sampling noise at this chunk count.",
        "- The Q4_K_M row is the official quant already present in the repository; the Q6/Q5/Q3 rows were generated locally from Q8_0 with `llama-quantize`. This is stated because the provenance differs.",
        "- KV cache quality is measured with the same weights (Q4_K_M) and a 1024-token context, against the f16 KV row at the same context. Longer contexts can amplify KV quantization error.",
        "- Perplexity is a screening test. It does not replace the project's coding/web-app/instruction suites, which are tracked separately.",
        "",
    ]
    (out / "quality_report.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
