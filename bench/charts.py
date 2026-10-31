#!/usr/bin/env python3
"""Generate the SVG charts used by the README and performance docs.

No plotting dependency: the SVGs are written directly so the repository can
regenerate them on a clean Windows machine with only Python.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "graficos"
OUT.mkdir(parents=True, exist_ok=True)

INK = "#17212b"
MUTED = "#5b6773"
GRID = "#dfe5ea"
BG = "#ffffff"
GREEN = "#2f7d32"
BLUE = "#2563eb"
ORANGE = "#d97706"
RED = "#c2410c"
PURPLE = "#7c3aed"


def esc(s: Any) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def svg_start(w: int, h: int, title: str) -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{esc(title)}">',
        f'<rect width="{w}" height="{h}" fill="{BG}"/>',
        f'<text x="24" y="34" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" fill="{INK}">{esc(title)}</text>',
    ]


def text(x: float, y: float, s: Any, size: int = 12, color: str = INK, anchor: str = "start", weight: str = "400") -> str:
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="Segoe UI, Arial, sans-serif" font-size="{size}" '
            f'font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{esc(s)}</text>')


def line(x1: float, y1: float, x2: float, y2: float, color: str = GRID, width: float = 1.0) -> str:
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" stroke-width="{width}"/>'


def rect(x: float, y: float, w: float, h: float, color: str, rx: float = 3) -> str:
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{color}" rx="{rx}"/>'


def legend(x: float, y: float, items: list[tuple[str, str]]) -> list[str]:
    out = []
    for i, (label, color) in enumerate(items):
        yy = y + i * 20
        out.append(rect(x, yy - 9, 12, 12, color, 2))
        out.append(text(x + 18, yy + 2, label, 12, MUTED))
    return out


def save(name: str, body: list[str]) -> None:
    body.append("</svg>")
    (OUT / name).write_text("\n".join(body), encoding="utf-8")
    print(f"Wrote {name}")


def load_results(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("rows", [])


def server_point(report: str) -> dict[str, Any] | None:
    p = ROOT / report / "server_results.json"
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    rows = data.get("rows", [])
    if not rows:
        return None
    # The last measured row is the steady-state one for these sweeps.
    valid = [r for r in rows if not r.get("note")]
    return valid[-1] if valid else rows[-1]


def chart_throughput() -> None:
    rows = load_results(ROOT / "reports" / "bench-baseline-20261031" / "benchmark_results.json")
    if not rows:
        return
    models = []
    for r in rows:
        if r["model_key"] not in models:
            models.append(r["model_key"])
    prefill = {}
    decode = {}
    for mk in models:
        p = [r for r in rows if r["model_key"] == mk and r["phase"] == "prefill" and r["test"] == "pp2048"]
        d = [r for r in rows if r["model_key"] == mk and r["phase"] == "decode" and r["test"] == "tg128"]
        prefill[mk] = max((float(x["tok_s"]) for x in p), default=0)
        decode[mk] = max((float(x["tok_s"]) for x in d), default=0)

    w, h = 1100, 560
    body = svg_start(w, h, "RTX 4060 8 GB: prefill and decode by model")
    body += [text(24, 58, "llama.cpp 8642541 · RTX 4060 Laptop 80 W · 244 GB/s measured read ceiling · 2048-token prompt / 128-token decode", 12, MUTED)]
    # Two panels.
    panels = [
        (70, 300, "Prefill 2048 tok/s", GREEN),
        (620, 300, "Decode 128 tok/s", BLUE),
    ]
    for px, pw, label, color in panels:
        body.append(text(px, 100, label, 14, INK, weight="700"))
        body.append(line(px, 470, px + pw, 470, INK, 1.2))
        body.append(line(px, 110, px, 470, INK, 1.2))
        vals = prefill if "Prefill" in label else decode
        vmax = max(vals.values()) * 1.18 if vals else 1
        for i in range(5):
            v = vmax * i / 4
            y = 470 - (v / vmax) * 340
            body.append(line(px, y, px + pw, y, GRID, 0.8))
            body.append(text(px - 10, y + 4, f"{v:,.0f}", 10, MUTED, "end"))
        n = len(models)
        gap = pw / max(1, n)
        bw = gap * 0.58
        for i, mk in enumerate(models):
            v = vals.get(mk, 0)
            bh = (v / vmax) * 340
            x = px + gap * (i + 0.21)
            body.append(rect(x, 470 - bh, bw, bh, color, 4))
            body.append(text(x + bw / 2, 470 - bh - 8, f"{v:,.0f}", 11, INK, "middle", "700"))
            short = mk.replace("qwen25-coder-7b", "Qwen2.5\nCoder 7B").replace("qwen3-4b", "Qwen3 4B").replace("gpt-oss-20b", "GPT-OSS\n20B MoE")
            for j, part in enumerate(short.split("\n")):
                body.append(text(x + bw / 2, 490 + j * 14, part, 10, MUTED, "middle"))
    body += [text(24, 535, "GPT-OSS-20B uses 12 CPU MoE layers at 64k; its decode is CPU-bound, not bandwidth-bound. Dense models are near the memory roofline.", 11, MUTED)]
    save("rtx4060-throughput.svg", body)


def chart_roofline() -> None:
    rows = load_results(ROOT / "reports" / "bench-baseline-20261031" / "benchmark_results.json")
    pts = []
    for r in rows:
        if r["phase"] == "decode" and r["test"] == "tg128":
            pts.append((r["model_key"], float(r["model_size_gib"]), float(r["tok_s"]), r.get("pct_of_read_roofline")))
    if not pts:
        return
    w, h = 980, 560
    body = svg_start(w, h, "Decode roofline: model bytes vs tokens/s")
    body += [text(24, 58, "Lower bound: one full read of the weights per token. Measured device read bandwidth = 244.2 GB/s.", 12, MUTED)]
    x0, y0, x1, y1 = 90, 480, 900, 100
    body.append(line(x0, y0, x1, y0, INK, 1.2))
    body.append(line(x0, y0, x0, y1, INK, 1.2))
    max_gb = 13.0
    max_tps = 90.0
    for i in range(6):
        gb = max_gb * i / 5
        x = x0 + (gb / max_gb) * (x1 - x0)
        body.append(line(x, y0, x, y1, GRID, 0.8))
        body.append(text(x, y0 + 18, f"{gb:.0f}", 10, MUTED, "middle"))
    for i in range(6):
        t = max_tps * i / 5
        y = y0 - (t / max_tps) * (y0 - y1)
        body.append(line(x0, y, x1, y, GRID, 0.8))
        body.append(text(x0 - 12, y + 4, f"{t:.0f}", 10, MUTED, "end"))
    # Roofline: bytes decimal = GiB * 1.073741824, tps = 244.2 / bytes.
    line_pts = []
    for i in range(0, 121):
        gb = max_gb * i / 120
        t = 244.206 / (gb * 1.073741824) if gb else max_tps
        if t <= max_tps:
            line_pts.append((x0 + (gb / max_gb) * (x1 - x0), y0 - (t / max_tps) * (y0 - y1)))
    if line_pts:
        d = "M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in line_pts)
        body.append(f'<path d="{d}" fill="none" stroke="{ORANGE}" stroke-width="2.2" stroke-dasharray="7 4"/>')
    colors = [GREEN, BLUE, PURPLE, RED]
    for i, (mk, gb, tps, pct) in enumerate(pts):
        x = x0 + (gb / max_gb) * (x1 - x0)
        y = y0 - (tps / max_tps) * (y0 - y1)
        body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="{colors[i % len(colors)]}" stroke="{BG}" stroke-width="2"/>')
        body.append(text(x + 10, y - 10, f"{mk} · {tps:.1f} tok/s ({pct:.0f}%)", 11, INK, weight="600"))
    body += [text(24, 525, "Orange dashed line = 244.2 / S_GB. The 7B and 9B Q4 models sit at 100–103% of the measured copy/read ceiling (within run-to-run error).", 11, MUTED)]
    body += [text(24, 543, "GPT-OSS-20B is above the dense roofline because only 3.6B of its 20.9B parameters are active per token and its CPU-resident experts are not streamed from VRAM.", 11, MUTED)]
    save("rtx4060-roofline.svg", body)


def chart_quant() -> None:
    rows = load_results(ROOT / "reports" / "bench-quant-20261031" / "benchmark_results.json")
    q = {}
    for r in rows:
        if r["phase"] == "decode" and r["test"] == "tg128":
            q[r["model_key"]] = (r["quant"], float(r["model_size_gib"]), float(r["tok_s"]))
    order = ["qwen3-4b-q8", "qwen3-4b-q6", "qwen3-4b-q5", "qwen3-4b-q4", "qwen3-4b-q3"]
    vals = [q[k] for k in order if k in q]
    if not vals:
        return
    # Pull PPL deltas from the quality report JSON.
    ppl = {}
    qpath = ROOT / "reports" / "bench-quality-20261031-v2" / "quality_results.json"
    if qpath.exists():
        for r in json.loads(qpath.read_text(encoding="utf-8"))["rows"]:
            if r.get("purpose") == "quant" and r.get("quant"):
                ppl[r["quant"]] = r.get("delta_ppl_pct")
    w, h = 1050, 560
    body = svg_start(w, h, "Qwen3-4B: quantization speed vs quality")
    body += [text(24, 58, "Same model, same chat corpus. Decode = 128 tokens after a 512-token prompt. PPL = 12 chunks on bench/corpus/quality.txt.", 12, MUTED)]
    # Left: decode bars; right: PPL delta bars.
    x0, y0 = 80, 470
    pw = 460
    vmax = max(v[2] for v in vals) * 1.2
    body.append(text(x0, 100, "Decode tok/s", 14, INK, weight="700"))
    body.append(line(x0, y0, x0 + pw, y0, INK, 1.2))
    body.append(line(x0, 110, x0, y0, INK, 1.2))
    gap = pw / len(vals)
    for i, (quant, gb, tps) in enumerate(vals):
        bh = (tps / vmax) * 340
        x = x0 + gap * (i + 0.18)
        body.append(rect(x, y0 - bh, gap * 0.64, bh, GREEN, 4))
        body.append(text(x + gap * 0.32, y0 - bh - 8, f"{tps:.1f}", 12, INK, "middle", "700"))
        body.append(text(x + gap * 0.32, y0 + 18, quant, 10, MUTED, "middle"))
        body.append(text(x + gap * 0.32, y0 + 33, f"{gb:.2f} GiB", 10, MUTED, "middle"))
    # Right: PPL delta.
    rx0 = 620
    body.append(text(rx0, 100, "Perplexity delta vs Q8_0", 14, INK, weight="700"))
    body.append(line(rx0, 470, rx0 + 380, 470, INK, 1.2))
    body.append(line(rx0, 110, rx0, 470, INK, 1.2))
    dmax = max([abs(v) for v in ppl.values() if v is not None] + [1.0]) * 1.2
    for i, (quant, gb, tps) in enumerate(vals):
        delta = ppl.get(quant)
        if delta is None:
            continue
        bh = (abs(delta) / dmax) * 300
        x = rx0 + 30 + i * 64
        color = RED if delta > 5 else (ORANGE if delta > 1 else GREEN)
        body.append(rect(x, 470 - bh, 40, bh, color, 4))
        body.append(text(x + 20, 470 - bh - 7, f"{delta:+.2f}%", 10, INK, "middle", "700"))
        body.append(text(x + 20, 490, quant.replace("Q", "Q"), 10, MUTED, "middle"))
    body += [text(24, 525, "Q6_K is the quality-first choice (+0.32% PPL, 65.5 tok/s). Q4_K_M is the balanced choice (+2.75%, 81.9 tok/s).", 11, MUTED)]
    body += [text(24, 543, "Q3_K_M costs +15.4% PPL for 90.8 tok/s; this is a speed-only profile, not a quality recommendation.", 11, MUTED)]
    save("rtx4060-quant.svg", body)


def chart_moe_context() -> None:
    reports = [
        (32768, "reports/bench-moe32k-n11-t8"),
        (65536, "reports/bench-moe64k-n12-t8-r3"),
        (98304, "reports/bench-moe96k-ncmoe-13"),
        (131072, "reports/bench-moe128k-n14-t8"),
    ]
    pts = []
    for ctx, rep in reports:
        r = server_point(rep)
        if r:
            pts.append((ctx, float(r["decode_tok_s"]), float(r["prefill_tok_s"]), r.get("n_cpu_moe")))
    base = server_point("reports/bench-moe64k-ncmoe-16")
    if not pts:
        return
    w, h = 1000, 560
    body = svg_start(w, h, "GPT-OSS-20B: measured safe split by context")
    body += [text(24, 58, "Each point is the largest n-cpu-moe that survived a 2048-token prompt + 128/256 generated tokens. Threads=8.", 12, MUTED)]
    x0, y0, x1, y1 = 90, 470, 900, 110
    body.append(line(x0, y0, x1, y0, INK, 1.2))
    body.append(line(x0, y0, x0, y1, INK, 1.2))
    max_ctx = 131072
    max_tps = 40.0
    for i in range(5):
        ctx = max_ctx * i / 4
        x = x0 + (ctx / max_ctx) * (x1 - x0)
        body.append(line(x, y0, x, y1, GRID, 0.8))
        body.append(text(x, y0 + 18, f"{ctx//1024}k", 10, MUTED, "middle"))
    for i in range(5):
        t = max_tps * i / 4
        y = y0 - (t / max_tps) * (y0 - y1)
        body.append(line(x0, y, x1, y, GRID, 0.8))
        body.append(text(x0 - 12, y + 4, f"{t:.0f}", 10, MUTED, "end"))
    for series, color, label in [
        ([(p[0], p[1]) for p in pts], BLUE, "decode tok/s"),
        ([(p[0], p[2]) for p in pts], GREEN, "prefill tok/s (÷ 30)"),
    ]:
        vals = [(x0 + (ctx / max_ctx) * (x1 - x0), y0 - ((t / 30 if label.startswith("prefill") else t) / max_tps) * (y0 - y1)) for ctx, t in series]
        d = "M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in vals)
        body.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="3"/>')
        for (ctx, t), (x, y) in zip(series, vals):
            body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="{color}" stroke="{BG}" stroke-width="2"/>')
            body.append(text(x + 8, y - 8, f"{t:.1f}", 10, color, weight="700"))
    if base:
        xb = x0 + (65536 / max_ctx) * (x1 - x0)
        yb = y0 - (float(base["decode_tok_s"]) / max_tps) * (y0 - y1)
        body.append(f'<circle cx="{xb:.1f}" cy="{yb:.1f}" r="7" fill="none" stroke="{RED}" stroke-width="2.5"/>')
        body.append(text(xb + 12, yb + 18, f"old 16 CPU layers · {float(base['decode_tok_s']):.1f} tok/s", 11, RED, weight="700"))
    body += legend(700, 95, [("decode", BLUE), ("prefill / 30", GREEN), ("old plan", RED)])
    body += [text(24, 520, "The old 64k plan left ~2.5 GiB of VRAM unused. Moving four expert layers to the GPU raised decode from 30.0 to 36.8 tok/s (+22.7%).", 11, MUTED)]
    save("rtx4060-moe-context.svg", body)


def chart_cache() -> None:
    q = server_point("reports/bench-server-qwen3-4b")
    g = server_point("reports/bench-server-gpt-oss")
    # Read the cache rows directly.
    def cache_vals(rep: str) -> tuple[float, float] | None:
        p = ROOT / rep / "server_results.json"
        if not p.exists():
            return None
        rows = json.loads(p.read_text(encoding="utf-8"))["rows"]
        cold = next((r for r in rows if r.get("note") == "cache-cold"), None)
        warm = next((r for r in rows if r.get("note") == "cache-warm"), None)
        if cold and warm and cold.get("ttft_ms") and warm.get("ttft_ms"):
            return float(cold["ttft_ms"]), float(warm["ttft_ms"])
        return None
    cases = [("Qwen3-4B · 3062-token prefix", cache_vals("reports/bench-server-qwen3-4b")),
             ("GPT-OSS-20B · 3033-token prefix", cache_vals("reports/bench-server-gpt-oss"))]
    cases = [(n, v) for n, v in cases if v]
    if not cases:
        return
    w, h = 900, 480
    body = svg_start(w, h, "Prompt cache: TTFT cold vs warm")
    body += [text(24, 58, "Same prompt twice; cache_prompt=false then true. Chat systems send a large fixed system prompt on every turn.", 12, MUTED)]
    x0, y0 = 80, 380
    body.append(line(x0, y0, 820, y0, INK, 1.2))
    maxv = max(max(v) for _, v in cases) * 1.2
    for i, (name, (cold, warm)) in enumerate(cases):
        x = x0 + 90 + i * 340
        for j, (v, color, label) in enumerate([(cold, RED, "cold"), (warm, GREEN, "warm")]):
            bh = (v / maxv) * 250
            body.append(rect(x + j * 80, y0 - bh, 62, bh, color, 4))
            body.append(text(x + j * 80 + 31, y0 - bh - 8, f"{v:,.0f} ms", 12, INK, "middle", "700"))
            body.append(text(x + j * 80 + 31, y0 + 18, label, 10, MUTED, "middle"))
        body.append(text(x + 70, y0 + 48, name, 11, INK, "middle", "600"))
    body += [text(24, 445, "Measured speedups: Qwen3-4B 43×; GPT-OSS-20B 53×. This is the largest TTFT lever for coding agents, RAG and repeated system prompts.", 11, MUTED)]
    save("rtx4060-cache.svg", body)


def chart_moe_sweep() -> None:
    sweep = []
    for n in (12, 13, 14, 15, 16, 17):
        r = server_point(f"reports/bench-moe64k-ncmoe-{n}")
        if r:
            sweep.append((n, float(r["decode_tok_s"]), float(r["prefill_tok_s"])))
    if not sweep:
        return
    threads = []
    for t in (8, 10, 12, 14, 16):
        r = server_point(f"reports/bench-moe64k-ncmoe12-t{t}")
        if r:
            threads.append((t, float(r["decode_tok_s"])))
    w, h = 1050, 560
    body = svg_start(w, h, "GPT-OSS-20B at 64k: n-cpu-moe and threads")
    body += [text(24, 58, "Left: n-cpu-moe 12–17 (threads=8). Right: threads at n-cpu-moe=12. VRAM peak at n=12 is 7309 MiB; n=11 OOMs.", 12, MUTED)]
    # Left panel.
    x0, y0, pw = 80, 460, 520
    body.append(text(x0, 100, "decode tok/s vs CPU MoE layers", 14, INK, weight="700"))
    body.append(line(x0, y0, x0 + pw, y0, INK, 1.2))
    body.append(line(x0, 110, x0, y0, INK, 1.2))
    vmax = 40
    for i in range(5):
        t = vmax * i / 4
        y = y0 - (t / vmax) * 330
        body.append(line(x0, y, x0 + pw, y, GRID, 0.8))
        body.append(text(x0 - 10, y + 4, f"{t:.0f}", 10, MUTED, "end"))
    pts = []
    for i, (n, dec, pre) in enumerate(sweep):
        x = x0 + 50 + i * 80
        bh = (dec / vmax) * 330
        color = GREEN if n == 12 else BLUE
        body.append(rect(x - 24, y0 - bh, 48, bh, color, 4))
        body.append(text(x, y0 - bh - 8, f"{dec:.1f}", 11, INK, "middle", "700"))
        body.append(text(x, y0 + 18, str(n), 10, MUTED, "middle"))
        pts.append((n, dec))
    # Right panel.
    rx = 660
    body.append(text(rx, 100, "decode tok/s vs server threads", 14, INK, weight="700"))
    body.append(line(rx, y0, rx + 340, y0, INK, 1.2))
    body.append(line(rx, 110, rx, y0, INK, 1.2))
    for i, (t, dec) in enumerate(threads):
        x = rx + 30 + i * 60
        bh = (dec / vmax) * 330
        color = GREEN if t == 8 else PURPLE
        body.append(rect(x, y0 - bh, 38, bh, color, 4))
        body.append(text(x + 19, y0 - bh - 8, f"{dec:.1f}", 10, INK, "middle", "700"))
        body.append(text(x + 19, y0 + 18, str(t), 10, MUTED, "middle"))
    body += [text(24, 520, "The best measured combination is n-cpu-moe=12 with 8 threads: 36.8 tok/s decode and 908 tok/s prefill, versus 30.0 / 762 for the old 16-layer, 12-thread plan.", 11, MUTED)]
    save("rtx4060-moe-sweep.svg", body)


def main() -> int:
    chart_throughput()
    chart_roofline()
    chart_quant()
    chart_moe_context()
    chart_cache()
    chart_moe_sweep()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
