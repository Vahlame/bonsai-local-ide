#!/usr/bin/env python3
"""Merge the selected benchmark suites into the repository-level results.

The per-suite reports remain the source of truth. This script only normalizes
their rows into one CSV/JSON/Markdown so a reader can compare phases without
opening ten directories.
"""

from __future__ import annotations

import csv
import datetime as _dt
import json
import statistics
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"

BENCH_SUITES = [
    "bench-baseline-20261031",
    "bench-quant-20261031",
    "bench-ab-control-4b",
    "bench-ab-mvq2-scoped-4b",
    "bench-ab-control-4b-d4k",
    "bench-ab-mvq2-4b-d4k",
    "bench-ab-mvq8-4b",
    "bench-ab-control-q6",
    "bench-ab-mvq2-q6",
    "bench-ab-control-q8",
    "bench-ab-mvq2-q8",
    "bench-ab-control-7b",
    "bench-ab-mvq2-7b",
    "bench-ab-control-qwen35-9b",
    "bench-ab-mvq2-qwen35-9b",
]
SERVER_SUITES = [
    "bench-server-qwen3-4b",
    "bench-server-gpt-oss",
    "bench-server-4b-mvq2-scoped",
    "bench-moe32k-n11-t8",
    "bench-moe64k-n12-t8-r3",
    "bench-moe64k-ncmoe-13",
    "bench-moe64k-ncmoe-14",
    "bench-moe64k-ncmoe-15",
    "bench-moe64k-ncmoe-16",
    "bench-moe64k-ncmoe-17",
    "bench-moe64k-ncmoe-12",
    "bench-moe64k-ncmoe-12-bs",
    "bench-moe96k-ncmoe-13",
    "bench-moe128k-n14-t8",
    "bench-moe64k-ncmoe12-t8",
    "bench-moe64k-ncmoe12-t10",
    "bench-moe64k-ncmoe12-t12",
    "bench-moe64k-ncmoe12-t14",
    "bench-moe64k-ncmoe12-t16",
    "bench-qwen36-32k-n19-t8",
    "bench-qwen36-32k-n20-t8",
    "bench-qwen36-32k-n22-t8",
    "bench-qwen36-64k-n21-t8",
    "bench-qwen3-30b-32k-n26-t8",
    "bench-qwen3-30b-32k-n26-t12",
]
QUALITY_SUITES = ["bench-quality-20261031-v2"]

FIELDS = [
    "suite", "model", "quant", "context", "phase", "test", "tok_s",
    "ttft_ms", "prefill_tok_s", "decode_tok_s", "ppl", "delta_ppl_pct",
    "vram_peak_mib", "ram_peak_mib", "power_avg_w", "temp_max_c",
    "n_cpu_moe", "threads", "kv", "source", "note",
]


def add_bench(rows: list[dict[str, Any]], name: str) -> None:
    p = REPORTS / name / "benchmark_results.json"
    if not p.exists():
        return
    data = json.loads(p.read_text(encoding="utf-8"))
    for r in data.get("rows", []):
        if r.get("phase") not in ("prefill", "decode"):
            continue
        rows.append({
            "suite": name.replace("bench-", ""),
            "model": r.get("model_key") or r.get("model"),
            "quant": r.get("quant") or "",
            "context": r.get("context_tokens") or "",
            "phase": r.get("phase"),
            "test": r.get("test"),
            "tok_s": r.get("tok_s"),
            "ttft_ms": r.get("ttft_ms"),
            "prefill_tok_s": r.get("prefill_tok_s"),
            "decode_tok_s": r.get("decode_tok_s"),
            "ppl": "",
            "delta_ppl_pct": "",
            "vram_peak_mib": r.get("vram_peak_mib"),
            "ram_peak_mib": r.get("ram_peak_mib"),
            "power_avg_w": r.get("power_avg_w"),
            "temp_max_c": r.get("temp_max_c"),
            "n_cpu_moe": r.get("n_cpu_moe"),
            "threads": r.get("threads"),
            "kv": r.get("kv_cache"),
            "source": name,
            "note": r.get("note") or "",
        })


def add_server(rows: list[dict[str, Any]], name: str) -> None:
    p = REPORTS / name / "server_results.json"
    if not p.exists():
        return
    data = json.loads(p.read_text(encoding="utf-8"))
    meta = data.get("metadata") or {}
    for r in data.get("rows", []):
        if r.get("note") in ("cache-cold", "cache-warm"):
            phase = r["note"]
            test = "prompt-cache"
        else:
            phase = "server"
            test = f"prompt-{r.get('prompt_target')}"
        rows.append({
            "suite": name.replace("bench-", ""),
            "model": r.get("model_key"),
            "quant": r.get("quant") or "",
            "context": r.get("context") or meta.get("context") or "",
            "phase": phase,
            "test": test,
            "tok_s": r.get("decode_tok_s"),
            "ttft_ms": r.get("ttft_ms"),
            "prefill_tok_s": r.get("prefill_tok_s"),
            "decode_tok_s": r.get("decode_tok_s"),
            "ppl": "",
            "delta_ppl_pct": "",
            "vram_peak_mib": r.get("vram_peak_mib") or meta.get("vram_peak_mib"),
            "ram_peak_mib": r.get("ram_peak_mib"),
            "power_avg_w": r.get("power_avg_w"),
            "temp_max_c": r.get("temp_max_c"),
            "n_cpu_moe": r.get("n_cpu_moe") if r.get("n_cpu_moe") is not None else meta.get("n_cpu_moe"),
            "threads": r.get("threads") if r.get("threads") is not None else meta.get("threads"),
            "kv": r.get("kv") or meta.get("kv"),
            "source": name,
            "note": r.get("note") or "",
        })


def add_quality(rows: list[dict[str, Any]], name: str) -> None:
    p = REPORTS / name / "quality_results.json"
    if not p.exists():
        return
    data = json.loads(p.read_text(encoding="utf-8"))
    for r in data.get("rows", []):
        rows.append({
            "suite": name.replace("bench-", ""),
            "model": r.get("model"),
            "quant": r.get("quant"),
            "context": r.get("ctx"),
            "phase": "quality",
            "test": f"ppl-{r.get('purpose')}",
            "tok_s": "",
            "ttft_ms": "",
            "prefill_tok_s": "",
            "decode_tok_s": "",
            "ppl": r.get("ppl"),
            "delta_ppl_pct": r.get("delta_ppl_pct"),
            "vram_peak_mib": r.get("vram_peak_mib"),
            "ram_peak_mib": "",
            "power_avg_w": r.get("power_avg_w"),
            "temp_max_c": r.get("temp_max_c"),
            "n_cpu_moe": "",
            "threads": "",
            "kv": r.get("kv"),
            "source": name,
            "note": r.get("note") or "",
        })


def read_file(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def fmt(v: Any, digits: int = 1) -> str:
    if v in (None, "", "None"):
        return "-"
    try:
        return f"{float(v):,.{digits}f}"
    except Exception:
        return str(v)


def main() -> int:
    rows: list[dict[str, Any]] = []
    for n in BENCH_SUITES:
        add_bench(rows, n)
    for n in SERVER_SUITES:
        add_server(rows, n)
    for n in QUALITY_SUITES:
        add_quality(rows, n)
    rows.sort(key=lambda r: (str(r["suite"]), str(r["model"]), str(r["phase"]), str(r["test"])))

    out_csv = ROOT / "benchmark_results.csv"
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FIELDS})

    meta = {
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "machine": "Acer Nitro AN16-41 / RTX 4060 Laptop 8 GB / Ryzen 7 7840HS / 16 GB",
        "runtime": "llama.cpp 8642541 (v0.8.0), CUDA 12.9.1",
        "sources": BENCH_SUITES + SERVER_SUITES + QUALITY_SUITES,
        "row_count": len(rows),
        "notes": [
            "Each source directory keeps its raw logs and manifest.",
            "tok_s is the median of warm samples; see BENCHMARKS.md for the method.",
            "PPL rows are from bench-quality-20261031-v2 and are comparable only within that corpus/context.",
        ],
    }
    (ROOT / "benchmark_results.json").write_text(json.dumps({"metadata": meta, "rows": rows}, indent=2, ensure_ascii=False), encoding="utf-8")

    # Report tables from the same normalized rows.
    def pick(suite_prefix: str, phase: str, test: str | None = None) -> list[dict[str, Any]]:
        out = [r for r in rows if str(r["suite"]).startswith(suite_prefix) and r["phase"] == phase]
        if test:
            out = [r for r in out if r["test"] == test]
        return out

    lines = [
        "# Resultados maestros — RTX 4060 8 GB",
        "",
        f"Generado: `{meta['generated_at']}` · {len(rows)} filas de {len(meta['sources'])} suites.",
        "",
        "Los datos crudos viven en `reports/bench-*`; este archivo solo los normaliza.",
        "Metodología y límites: [BENCHMARKS.md](BENCHMARKS.md).",
        "",
        "## Baseline",
        "",
        "| Modelo | Quant | Prefill 2048 | Decode 128 | VRAM pico | Fuente |",
        "|---|---|---:|---:|---:|---|",
    ]
    for r in pick("baseline-20261031", "prefill", "pp2048"):
        dec = next((x for x in pick("baseline-20261031", "decode", "tg128") if x["model"] == r["model"]), None)
        lines.append(f"| {r['model']} | {r['quant']} | {fmt(r['tok_s'], 0)} | {fmt(dec and dec['tok_s'])} | {fmt(r['vram_peak_mib'], 0)} | `{r['source']}` |")

    lines += [
        "",
        "## Cuantización (Qwen3-4B)",
        "",
        "| Quant | Decode 128 | PPL | Δ PPL | Fuente |",
        "|---|---:|---:|---:|---|",
    ]
    for r in pick("quant-20261031", "decode", "tg128"):
        q = next((x for x in pick("quality-20261031-v2", "quality") if x["quant"] == r["quant"] and str(x["context"]) == "512"), None)
        lines.append(f"| {r['quant']} | {fmt(r['tok_s'])} | {fmt(q and q['ppl'], 4)} | {fmt(q and q['delta_ppl_pct'], 2)}% | `{r['source']}` |")

    lines += [
        "",
        "## MoE de coding",
        "",
        "| Suite | Modelo | Ctx | n-cpu-moe | Hilos | Decode | Prefill | VRAM |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    moe_groups: dict[tuple, list[dict[str, Any]]] = {}
    for r in rows:
        if r["phase"] == "server" and str(r["suite"]).startswith(("moe", "qwen36", "qwen3-30b")):
            key = (r["suite"], r["model"], r["context"], r["n_cpu_moe"], r["threads"])
            moe_groups.setdefault(key, []).append(r)
    for key, grp in sorted(moe_groups.items(), key=lambda kv: (str(kv[0][1]), int(kv[0][2] or 0), int(kv[0][3] or 0))):
        suite, model, ctx, ncmoe, threads = key
        dec = statistics.median([float(x["decode_tok_s"]) for x in grp if x["decode_tok_s"] not in ("", None)])
        pre = statistics.median([float(x["prefill_tok_s"]) for x in grp if x["prefill_tok_s"] not in ("", None)])
        vram = max([int(float(x["vram_peak_mib"])) for x in grp if x["vram_peak_mib"] not in ("", None)], default=0)
        lines.append(f"| `{suite}` | {model} | {ctx} | {ncmoe} | {threads} | {dec:.2f} | {pre:.0f} | {vram:,} |")

    lines += [
        "",
        "## Prompt cache",
        "",
        "| Suite | Fase | TTFT | Fuente |",
        "|---|---|---:|---|",
    ]
    for r in rows:
        if r["phase"] in ("cache-cold", "cache-warm"):
            lines.append(f"| `{r['suite']}` | {r['phase']} | {fmt(r['ttft_ms'], 1)} ms | `{r['source']}` |")

    lines += [
        "",
        "## MMVQ A/B (Qwen3-4B Q4_K_M)",
        "",
        "| Suite | Fase | Test | tok/s | Fuente |",
        "|---|---|---|---:|---|",
    ]
    for r in rows:
        if str(r["suite"]).startswith("ab-") and r["phase"] in ("prefill", "decode"):
            lines.append(f"| `{r['suite']}` | {r['phase']} | {r['test']} | {fmt(r['tok_s'], 2)} | `{r['source']}` |")

    lines += [
        "",
        "## Cómo regenerar",
        "",
        "```powershell",
        "python bench\\merge_results.py",
        "python bench\\charts.py",
        "```",
        "",
    ]
    (ROOT / "benchmark_report.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote benchmark_results.csv/json and benchmark_report.md ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
