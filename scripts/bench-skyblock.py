"""Benchmark de agentes con el prompt Skyblock fase 1a.

Cambia de modelo por la API del IDE, ejecuta una tarea aislada con
`qwen38_ide_agent_task.py`, comprueba el HTML con Edge headless y guarda un
JSON incremental. No descarga modelos: usa los que ya están en models/.
"""
import argparse
import json
import pathlib
import shutil
import statistics
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(r"C:\Users\user\Documents\prject_local_AI")
BASE = "http://127.0.0.1:8787"
TASK = ROOT / "scripts" / "qwen38_ide_agent_task.py"
REPORTS = ROOT / "reports" / "2026-11-01-qwen38"
PROMPT = ROOT / "docs" / "qwen38" / "prompts" / "skyblock.md"
VENDOR = ROOT / "trabajo" / "gptoss-skyblock" / "vendor" / "three.min.js"
OUT_JSON = ROOT / "docs" / "qwen38" / "skyblock-benchmark-results.json"
SHOTS = ROOT / "docs" / "qwen38" / "skyblock-benchmark-shots"
CHECKER = ROOT / "scripts" / "check-skyblock.cjs"

# (clave, contexto, nota)
MODELS = [
    ("gpt-oss-20b", 65536, "MoE 3.6B activos"),
    ("qwen3-30b-a3b-2507", 65536, "MoE 3B activos"),
    ("qwen36-35b-a3b", 65536, "MoE 3B activos"),
    ("nemotron3-nano-30b", 65536, "MoE 3B activos"),
    ("qwen35-9b", 32768, "denso 9B"),
    ("qwen3-4b-2507", 32768, "denso 4B"),
    ("qwen38-4b-distill", 32768, "denso 4B"),
    ("gemma4-e4b", 32768, "denso 4B"),
    ("phi4-mini", 32768, "denso 3.8B"),
    ("llama32-3b", 32768, "denso 3B"),
    ("smollm3-3b", 32768, "denso 3B"),
    ("granite40-tiny", 32768, "denso 4B"),
    ("qwen25-coder-7b", 32768, "denso 7B código"),
    ("ornith9b", 32768, "denso 9B"),
    ("k2-horizon-7b-bartowski-q4-k-m", 32768, "denso 7B"),
    ("deepseek-r1-qwen7b", 32768, "denso 7B razonamiento"),
    ("qwen38-27b-perf-iq4", 32768, "control lento 27B"),
]


def api(path, body=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def wait_idle(deadline=90):
    end = time.time() + deadline
    while time.time() < end:
        try:
            state = api("/api/state", timeout=10)
            if not state.get("busy"):
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def switch_model(key, ctx):
    body = {
        "clave": key,
        "enginePreset": "CUSTOM",
        "contexto": ctx,
        "kv": "q8_0",
        "vision": False,
        "pensar": -1,
    }
    return api("/api/modelos", body, timeout=300)


def prepare_workspace(key):
    ws = ROOT / "trabajo" / "bench-skyblock" / key
    if ws.exists():
        shutil.rmtree(ws)
    (ws / "vendor").mkdir(parents=True)
    shutil.copy2(PROMPT, ws / "PROMPT-PHASE1A.md")
    shutil.copy2(VENDOR, ws / "vendor" / "three.min.js")
    return ws


def run_task(key, ws, timeout=1200):
    label = f"bench-{key}"
    report = REPORTS / f"{label}.json"
    if report.exists():
        report.unlink()
    cmd = [
        sys.executable,
        str(TASK),
        "--label", label,
        "--workspace", str(ws),
        "--prompt", PROMPT.read_text(encoding="utf-8"),
        "--timeout", str(timeout),
    ]
    started = time.time()
    try:
        proc = subprocess.run(cmd, cwd=str(TASK.parent), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout + 90)
        out, err, code = proc.stdout, proc.stderr, proc.returncode
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        err = (exc.stderr or "") if isinstance(exc.stderr, str) else ""
        code = -999
        try:
            api("/api/stop", {}, timeout=30)
        except Exception:
            pass
    wall = time.time() - started
    data = None
    if report.exists():
        try:
            data = json.loads(report.read_text(encoding="utf-8"))
        except Exception as exc:
            err += f"\nreport parse: {exc}"
    return {"label": label, "code": code, "wall_s": round(wall, 1), "stdout_tail": out[-2000:], "stderr_tail": err[-2000:], "report": data}


def summarize(key, ctx, note, run, ws):
    data = run.get("report") or {}
    turns = data.get("turns") or []
    events = turns[0].get("events", []) if turns else []
    speeds = [e for e in events if e.get("type") == "speed"]
    decodes = [float(e.get("predicted_ps") or 0) for e in speeds if e.get("predicted_ps")]
    prompts = [float(e.get("prompt_ps") or 0) for e in speeds if e.get("prompt_ps")]
    done = next((e for e in events if e.get("type") == "done"), {})
    errors = [e.get("text", "") for e in events if e.get("type") == "error"]
    actions = [e for e in events if e.get("type") == "action"]
    html = ws / "index.html"
    html_exists = html.exists()
    html_lines = html.read_text(encoding="utf-8", errors="replace").count("\n") + 1 if html_exists else 0
    html_bytes = html.stat().st_size if html_exists else 0
    check = None
    shot = None
    if html_exists:
        SHOTS.mkdir(parents=True, exist_ok=True)
        shot = SHOTS / f"{key}.png"
        try:
            proc = subprocess.run(["node", str(CHECKER), str(html), str(shot)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
            check = json.loads(proc.stdout) if proc.stdout.strip() else {"errors": [proc.stderr[-500:]]}
        except Exception as exc:
            check = {"errors": [str(exc)]}
    return {
        "modelo": key,
        "contexto": ctx,
        "nota": note,
        "wall_s": run["wall_s"],
        "helper_code": run["code"],
        "report_error": data.get("error"),
        "done": done,
        "decode_tps_med": round(statistics.median(decodes), 2) if decodes else None,
        "decode_tps_max": round(max(decodes), 2) if decodes else None,
        "prompt_tps_med": round(statistics.median(prompts), 2) if prompts else None,
        "generated_tokens": sum(int(e.get("predicted_n") or 0) for e in speeds),
        "cache_tokens": sum(int(e.get("cache_n") or 0) for e in speeds),
        "speeds": speeds,
        "actions": [{"kind": a.get("kind"), "title": a.get("title"), "state": a.get("state"), "code": a.get("code")} for a in actions],
        "errors": errors,
        "html_exists": html_exists,
        "html_lines": html_lines,
        "html_bytes": html_bytes,
        "check": check,
        "screenshot": str(shot) if shot else None,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default="")
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--out", default=str(OUT_JSON))
    args = parser.parse_args()
    wanted = {m.strip() for m in args.models.split(",") if m.strip()}
    chosen = [m for m in MODELS if not wanted or m[0] in wanted]
    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    results = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else []
    by_key = {r["modelo"]: r for r in results}
    print(f"Benchmark: {len(chosen)} modelos", flush=True)
    for key, ctx, note in chosen:
        print(f"\n=== {key} ({ctx}) ===", flush=True)
        if not wait_idle():
            print("  IDE ocupado; se omite", flush=True)
            continue
        try:
            sw = switch_model(key, ctx)
            print(f"  modelo: {sw.get('nombre')} nCtx={sw.get('nCtx')} pensar={sw.get('pensar')}", flush=True)
        except Exception as exc:
            print(f"  cambio fallido: {exc}", flush=True)
            by_key[key] = {"modelo": key, "contexto": ctx, "nota": note, "switch_error": str(exc)}
            results = list(by_key.values())
            out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
            continue
        ws = prepare_workspace(key)
        run = run_task(key, ws, timeout=args.timeout)
        row = summarize(key, ctx, note, run, ws)
        print(f"  wall={row['wall_s']}s decode={row['decode_tps_med']} tok/s html={row['html_exists']} lines={row['html_lines']} done={row['done'].get('motivo')}", flush=True)
        by_key[key] = row
        results = list(by_key.values())
        out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nGuardado: {out_path}", flush=True)


if __name__ == "__main__":
    main()
