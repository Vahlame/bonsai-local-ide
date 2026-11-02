"""Benchmark multi-tarea: fluidos, juego, app y Skyblock.

Cambia de modelo por la API del IDE, ejecuta cada prompt en un workspace
aislado y verifica el resultado con Edge headless. Guarda JSON incremental.
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

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8787"
TASK_HELPER = ROOT / "scripts" / "qwen38_ide_agent_task.py"
REPORTS = ROOT / "reports" / "2026-11-01-qwen38"
PROMPTS = ROOT / "docs" / "qwen38" / "prompts"
VENDOR = ROOT / "trabajo" / "gptoss-skyblock" / "vendor" / "three.min.js"
if not VENDOR.exists():
    VENDOR = ROOT / "docs" / "vendor" / "three.min.js"
CHECKER = ROOT / "scripts" / "check-task.cjs"
OUT_JSON = ROOT / "docs" / "qwen38" / "task-benchmark-results.json"
SHOTS = ROOT / "docs" / "qwen38" / "task-benchmark-shots"

MODELS = [
    ("qwen36-35b-a3b", 65536, "MoE 35B-A3B"),
    ("qwen35-9b", 32768, "denso 9B"),
    ("qwen3-30b-a3b-2507", 32768, "MoE 30B-A3B"),
    ("gpt-oss-20b", 65536, "MoE 20B"),
    ("qwen3-coder-30b-a3b", 32768, "MoE 30B-A3B código"),
    ("deepseek-coder-v2-lite", 32768, "MoE 16B-A2.4B código"),
    ("qwen3-8b", 26624, "denso 8B"),
    ("qwen3-4b-2507", 32768, "denso 4B"),
]
TASKS = [
    ("fluid", "Simulador de fluidos con física"),
    ("game", "Juego arcade jugable"),
    ("app", "App de tareas con localStorage"),
    ("skyblock", "Isla Skyblock mínima"),
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
            if not api("/api/state", timeout=10).get("busy"):
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def switch_model(key, ctx):
    body = {"clave": key, "enginePreset": "CUSTOM", "contexto": ctx, "kv": "q8_0", "vision": False, "pensar": -1}
    return api("/api/modelos", body, timeout=300)


def prompt_for(task):
    return PROMPTS / f"{task}.md"


def prepare_workspace(task, model):
    ws = ROOT / "trabajo" / "bench-tasks" / task / model
    if ws.exists():
        shutil.rmtree(ws)
    (ws / "vendor").mkdir(parents=True)
    shutil.copy2(prompt_for(task), ws / "PROMPT.md")
    if task == "skyblock":
        if not VENDOR.exists():
            raise FileNotFoundError(
                f"Falta {VENDOR}. Guarda Three.js r149 clásico como vendor/three.min.js "
                "o en docs/vendor/three.min.js."
            )
        shutil.copy2(VENDOR, ws / "vendor" / "three.min.js")
    return ws


def run_task(task, model, ws, timeout=1200):
    label = f"bench-{task}-{model}"
    report = REPORTS / f"{label}.json"
    if report.exists():
        report.unlink()
    prompt = prompt_for(task).read_text(encoding="utf-8")
    cmd = [sys.executable, str(TASK_HELPER), "--label", label, "--workspace", str(ws), "--prompt", prompt, "--timeout", str(timeout)]
    started = time.time()
    try:
        proc = subprocess.run(cmd, cwd=str(TASK_HELPER.parent), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout + 90)
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
    return {"label": label, "code": code, "wall_s": round(wall, 1), "stdout_tail": out[-1500:], "stderr_tail": err[-1500:], "report": data}


def summarize(task, model, ctx, note, run, ws):
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
    exists = html.exists()
    check = None
    shot = None
    if exists:
        SHOTS.mkdir(parents=True, exist_ok=True)
        shot = SHOTS / f"{task}-{model}.png"
        try:
            proc = subprocess.run(["node", str(CHECKER), task, str(html), str(shot)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
            check = json.loads(proc.stdout) if proc.stdout.strip() else {"ok": False, "errors": [proc.stderr[-500:]]}
        except Exception as exc:
            check = {"ok": False, "errors": [str(exc)]}
    return {
        "tarea": task,
        "modelo": model,
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
        "html_exists": exists,
        "html_bytes": html.stat().st_size if exists else 0,
        "check": check,
        "task_errors": errors,
        "actions": [{"kind": a.get("kind"), "title": a.get("title"), "state": a.get("state")} for a in actions],
        "screenshot": str(shot) if shot else None,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default="")
    parser.add_argument("--tasks", default="")
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--out", default=str(OUT_JSON))
    args = parser.parse_args()
    want_models = {m.strip() for m in args.models.split(",") if m.strip()}
    want_tasks = {t.strip() for t in args.tasks.split(",") if t.strip()}
    models = [m for m in MODELS if not want_models or m[0] in want_models]
    tasks = [t for t in TASKS if not want_tasks or t[0] in want_tasks]
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    results = json.loads(out.read_text(encoding="utf-8")) if out.exists() else []
    by_key = {(r["modelo"], r["tarea"]): r for r in results}
    print(f"Benchmark: {len(models)} modelos x {len(tasks)} tareas", flush=True)
    for model, ctx, note in models:
        print(f"\n######## {model} ({ctx}) ########", flush=True)
        if not wait_idle():
            print("  IDE ocupado; se omite el modelo", flush=True)
            continue
        try:
            sw = switch_model(model, ctx)
            print(f"  modelo: {sw.get('nombre')} nCtx={sw.get('nCtx')} pensar={sw.get('pensar')}", flush=True)
        except Exception as exc:
            print(f"  cambio fallido: {exc}", flush=True)
            for task, _ in tasks:
                by_key[(model, task)] = {"modelo": model, "tarea": task, "contexto": ctx, "nota": note, "switch_error": str(exc)}
            out.write_text(json.dumps(list(by_key.values()), ensure_ascii=False, indent=2), encoding="utf-8")
            continue
        for task, label in tasks:
            if not args.force and (model, task) in by_key and by_key[(model, task)].get("check") is not None:
                print(f"  --- {task}: ya existe, se omite ---", flush=True)
                continue
            print(f"  --- {task} ---", flush=True)
            ws = prepare_workspace(task, model)
            run = run_task(task, model, ws, timeout=args.timeout)
            row = summarize(task, model, ctx, note, run, ws)
            check = row.get("check") or {}
            print(f"    wall={row['wall_s']}s decode={row['decode_tps_med']} tok/s html={row['html_exists']} ok={check.get('ok')} done={row['done'].get('motivo')}", flush=True)
            by_key[(model, task)] = row
            out.write_text(json.dumps(list(by_key.values()), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nGuardado: {out}", flush=True)


if __name__ == "__main__":
    main()
