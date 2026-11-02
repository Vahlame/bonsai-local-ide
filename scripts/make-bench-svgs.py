"""Genera los SVG del benchmark de modelos y del motor MoE."""
from pathlib import Path

OUT = Path(r"C:\Users\user\Documents\prject_local_AI\docs\graficos")
FONT = "Segoe UI, Arial, sans-serif"
INK = "#17212b"
MUTED = "#5b6773"
GRID = "#dfe5ea"
GREEN = "#2f7d32"
ORANGE = "#d97706"
RED = "#b91c1c"
BLUE = "#2563eb"
GRAY = "#94a3b8"


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=12, weight=400, color=INK, anchor="start"):
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" '
            f'font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{esc(s)}</text>')


def svg(width, height, body, label):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="{esc(label)}">\n'
            f'<rect width="{width}" height="{height}" fill="#ffffff"/>\n' + body + "\n</svg>\n")


def speed_chart():
    data = [
        ("Qwen3.5 9B · denso", 45.9, GREEN),
        ("Qwen3 8B · denso", 39.35, GREEN),
        ("Qwen3.6 35B-A3B · MoE", 34.9, GREEN),
        ("GPT-OSS 20B · MoE", 33.3, GREEN),
        ("Qwen3 30B-A3B 2507 · MoE", 29.15, ORANGE),
        ("Qwen3-Coder 30B-A3B · MoE", 17.65, ORANGE),
        ("DeepSeek-Coder-V2-Lite · MoE", 10.5, RED),
        ("Qwen3.8 27B · híbrido", 7.2, RED),
    ]
    W, H = 1000, 560
    left, right, top = 300, 90, 100
    maxv = 50
    plot_w = W - left - right
    bar_h = 34
    gap = 14
    b = [text(24, 34, "Skyblock fase 1a: velocidad de generación", 20, 700),
         text(24, 58, "RTX 4060 8 GB · pensamiento libre · motor optimizado · mismo prompt", 12, 400, MUTED)]
    for tick in range(0, maxv + 1, 10):
        x = left + plot_w * tick / maxv
        b.append(f'<line x1="{x}" y1="{top - 10}" x2="{x}" y2="{top + len(data)*(bar_h+gap)}" stroke="{GRID}" stroke-width="0.8"/>')
        b.append(text(x, top + len(data)*(bar_h+gap) + 22, str(tick), 10, 400, MUTED, "middle"))
    target = left + plot_w * 9 / maxv
    b.append(f'<line x1="{target}" y1="{top - 10}" x2="{target}" y2="{top + len(data)*(bar_h+gap)}" stroke="{RED}" stroke-width="1.4" stroke-dasharray="5 4"/>')
    b.append(text(target + 6, top - 16, "objetivo > 9 tok/s", 10, 700, RED))
    for i, (name, value, color) in enumerate(data):
        y = top + i * (bar_h + gap)
        b.append(text(left - 14, y + 22, name, 12, 600, INK, "end"))
        w = max(2, plot_w * value / maxv)
        b.append(f'<rect x="{left}" y="{y}" width="{w:.1f}" height="{bar_h}" fill="{color}" rx="5"/>')
        b.append(text(left + w + 8, y + 22, f"{value:.1f} tok/s", 12, 700, INK))
    b.append(text(24, H - 18, "Fuente: docs/qwen38/task-benchmark-results.json · GPT-OSS usa la medición de fluido (33,3 tok/s).", 10, 400, MUTED))
    return svg(W, H, "\n".join(b), "Skyblock benchmark decode speed by model")


def matrix():
    models = [
        ("Qwen3.6 35B-A3B", [98, 94, 92, 77]),
        ("Qwen3 30B-A3B 2507", [85, 90, 90, 85]),
        ("Qwen3-Coder 30B-A3B", [95, 90, 90, 80]),
        ("Qwen3.5 9B", [55, 85, 80, 80]),
        ("GPT-OSS 20B", [45, 20, 75, 25]),
        ("Qwen3 8B", [10, 60, 55, 45]),
        ("DeepSeek-Coder-V2-Lite", [0, 0, 0, 0]),
    ]
    tasks = ["Fluidos", "Juego", "App", "Skyblock"]
    W, H = 1000, 560
    left, top = 250, 130
    cw, ch = 150, 46
    b = [text(24, 34, "Puntuación por tarea (0–100)", 20, 700),
         text(24, 58, "Completitud + funcionalidad medida + revisión visual de la captura", 12, 400, MUTED)]
    for j, t in enumerate(tasks):
        b.append(text(left + j * cw + cw / 2, top - 16, t, 12, 700, INK, "middle"))
    for i, (name, scores) in enumerate(models):
        y = top + i * ch
        b.append(text(left - 14, y + 28, name, 12, 600, INK, "end"))
        for j, score in enumerate(scores):
            x = left + j * cw
            if score >= 80:
                fill = "#d9f0dc"
                stroke = GREEN
            elif score >= 50:
                fill = "#fff1d6"
                stroke = ORANGE
            elif score > 0:
                fill = "#fde2e2"
                stroke = RED
            else:
                fill = "#eceff3"
                stroke = GRAY
            b.append(f'<rect x="{x + 4}" y="{y + 4}" width="{cw - 8}" height="{ch - 8}" fill="{fill}" stroke="{stroke}" stroke-width="1.2" rx="6"/>')
            b.append(text(x + cw / 2, y + 31, f"{score}", 14, 700, stroke, "middle"))
    b.append(text(24, H - 22, "0 = sin HTML o sin función · 50–79 = funciona con carencias · 80–100 = correcto y revisado.", 10, 400, MUTED))
    return svg(W, H, "\n".join(b), "Benchmark task score matrix")


def best_score():
    rows = [("Fluidos", 98), ("Juego", 94), ("App", 92), ("Skyblock", 77), ("Global", 90)]
    W, H = 900, 460
    left, right, top = 230, 80, 120
    plot_w = W - left - right
    b = [text(24, 34, "Qwen3.6 35B-A3B · scorecard", 20, 700),
         text(24, 58, "Mejor equilibrio calidad/velocidad: 35–40 tok/s con expertos en CPU", 12, 400, MUTED)]
    for i, (name, score) in enumerate(rows):
        y = top + i * 62
        b.append(text(left - 14, y + 25, name, 13, 600, INK, "end"))
        b.append(f'<rect x="{left}" y="{y}" width="{plot_w}" height="28" fill="#eef1f5" rx="6"/>')
        w = plot_w * score / 100
        color = GREEN if score >= 90 else BLUE if score >= 80 else ORANGE
        b.append(f'<rect x="{left}" y="{y}" width="{w:.1f}" height="28" fill="{color}" rx="6"/>')
        b.append(text(left + w + 10, y + 20, f"{score}/100", 13, 700, INK))
    b.append(text(24, H - 24, "Scorecard basado en las cuatro tareas del benchmark; las repeticiones miden consistencia.", 10, 400, MUTED))
    return svg(W, H, "\n".join(b), "Qwen3.6 35B-A3B scorecard")


def moe_diagram():
    W, H = 1000, 560
    b = [text(24, 34, "Offload MoE: GPU para atención, CPU/RAM para expertos", 20, 700),
         text(24, 58, "GPT-OSS 20B · Qwen3.6 35B-A3B · Qwen3-Coder 30B-A3B · RTX 4060 8 GB + 16 GB RAM", 12, 400, MUTED)]
    b.append(f'<rect x="60" y="110" width="390" height="350" fill="#f4f8f4" stroke="{GREEN}" stroke-width="2" rx="12"/>')
    b.append(text(80, 142, "GPU · 8 GB VRAM", 16, 700, GREEN))
    for i, (label, sub) in enumerate([
        ("Atención + capas densas", "siempre en GPU"),
        ("KV cache q8_0", "32K / 64K de contexto"),
        ("Expertos calientes", "12/24 · 22/40 · 12/48 capas"),
        ("FlashAttention + CUDA graphs", "batch 1024 · ubatch 512"),
    ]):
        y = 180 + i * 64
        b.append(f'<rect x="82" y="{y}" width="346" height="48" fill="#ffffff" stroke="#cfe3d2" rx="7"/>')
        b.append(text(96, y + 20, label, 12, 700, INK))
        b.append(text(96, y + 36, sub, 10, 400, MUTED))
    b.append(f'<rect x="550" y="110" width="390" height="350" fill="#fff8ec" stroke="{ORANGE}" stroke-width="2" rx="12"/>')
    b.append(text(570, 142, "CPU + RAM · 16 GB", 16, 700, ORANGE))
    for i, (label, sub) in enumerate([
        ("Expertos fríos", "--n-cpu-moe 12 / 22 / 36"),
        ("Carga", "none si caben; mmap si no"),
        ("Hilos", "8 hilos físicos medidos"),
        ("Resultado", "se combinan en la GPU"),
    ]):
        y = 180 + i * 64
        b.append(f'<rect x="572" y="{y}" width="346" height="48" fill="#ffffff" stroke="#f0dcc0" rx="7"/>')
        b.append(text(586, y + 20, label, 12, 700, INK))
        b.append(text(586, y + 36, sub, 10, 400, MUTED))
    b.append(f'<line x1="450" y1="250" x2="550" y2="250" stroke="{BLUE}" stroke-width="2.4" marker-end="url(#arrow)"/>')
    b.append(f'<line x1="550" y1="330" x2="450" y2="330" stroke="{BLUE}" stroke-width="2.4" marker-end="url(#arrow)"/>')
    b.append(f'<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="{BLUE}"/></marker></defs>')
    b.append(text(500, 238, "token", 10, 700, BLUE, "middle"))
    b.append(text(500, 322, "expertos", 10, 700, BLUE, "middle"))
    b.append(text(24, H - 28, "La VRAM se llena con las últimas capas de expertos; las primeras viven en RAM. Así el modelo grande no se queda en 7 tok/s.", 10, 400, MUTED))
    return svg(W, H, "\n".join(b), "MoE offload diagram")


def pipeline():
    W, H = 1000, 380
    boxes = [
        ("Prompt", "4 tareas"),
        ("Model switch", "API + lifecycle"),
        ("Agente", "tools + workspace"),
        ("HTML", "index.html"),
        ("Checker", "Edge headless"),
        ("Score", "JSON + captura"),
    ]
    b = [text(24, 34, "Pipeline del benchmark", 20, 700),
         text(24, 58, "Aislamiento por modelo y tarea · pensamiento libre · verificación real en navegador", 12, 400, MUTED)]
    bw, bh, gap = 138, 92, 22
    x0 = 30
    for i, (title, sub) in enumerate(boxes):
        x = x0 + i * (bw + gap)
        color = [GREEN, BLUE, ORANGE, GREEN, BLUE, GREEN][i]
        b.append(f'<rect x="{x}" y="130" width="{bw}" height="{bh}" fill="#ffffff" stroke="{color}" stroke-width="2" rx="10"/>')
        b.append(text(x + bw / 2, 166, title, 14, 700, INK, "middle"))
        b.append(text(x + bw / 2, 190, sub, 10, 400, MUTED, "middle"))
        if i < len(boxes) - 1:
            b.append(f'<line x1="{x + bw}" y1="176" x2="{x + bw + gap}" y2="176" stroke="{GRAY}" stroke-width="2" marker-end="url(#arrow2)"/>')
    b.append('<defs><marker id="arrow2" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#94a3b8"/></marker></defs>')
    b.append(text(24, 300, "Cada tarea escribe en trabajo/bench-tasks/<tarea>/<modelo>/ y se evalúa sin ejecutar código del modelo fuera del navegador.", 10, 400, MUTED))
    return svg(W, H, "\n".join(b), "Benchmark pipeline")


def engine_stack():
    W, H = 1000, 520
    rows = [
        ("Pensamiento libre", "--reasoning-budget -1 · effort high/xhigh", GREEN),
        ("Offload MoE", "--n-cpu-moe 12/22/36 · load-mode none/mmap", ORANGE),
        ("KV + atención", "q8_0 · 32K/64K · flash-attn · batch 1024/512", BLUE),
        ("Hilos", "8 hilos físicos · no 12", GREEN),
        ("Caché", "--cache-ram 0 · --ctx-checkpoints 0 · --no-context-shift", BLUE),
        ("Harmony / GPT-OSS", "--skip-chat-parsing · parser propio", ORANGE),
    ]
    b = [text(24, 34, "Optimizaciones del motor aplicadas al benchmark", 20, 700),
         text(24, 58, "El mismo stack para todos los modelos; lo que cambia es el perfil del modelo", 12, 400, MUTED)]
    for i, (title, sub, color) in enumerate(rows):
        y = 100 + i * 62
        b.append(f'<rect x="30" y="{y}" width="940" height="48" fill="#ffffff" stroke="{color}" stroke-width="1.6" rx="8"/>')
        b.append(text(50, y + 20, title, 13, 700, color))
        b.append(text(50, y + 37, sub, 11, 400, MUTED))
    b.append(text(24, H - 22, "Resultado: Qwen3.6 35B-A3B a 35–40 tok/s; Qwen3.5 9B a 45–46; Qwen3.8 27B sigue en 7,2.", 10, 400, MUTED))
    return svg(W, H, "\n".join(b), "Engine optimizations stack")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "bench-model-speed.svg": speed_chart(),
        "bench-task-matrix.svg": matrix(),
        "bench-best-score.svg": best_score(),
        "moe-offload.svg": moe_diagram(),
        "benchmark-pipeline.svg": pipeline(),
        "engine-optimizations.svg": engine_stack(),
    }
    for name, content in files.items():
        (OUT / name).write_text(content, encoding="utf-8")
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
