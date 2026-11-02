"""Run one isolated agent task through the managed IDE and keep the SSE evidence."""
import argparse
import json
import os
import pathlib
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--label", required=True)
parser.add_argument("--workspace", required=True)
parser.add_argument("--prompt", required=True)
parser.add_argument("--followup", default="")
parser.add_argument("--timeout", type=float, default=600)
parser.add_argument("--base", default=os.environ.get("BONSAI_UI", "http://127.0.0.1:8787"))
args = parser.parse_args()
OUT = ROOT / "reports" / "2026-11-01-qwen38" / (args.label + ".json")
OUT.parent.mkdir(parents=True, exist_ok=True)
BASE = args.base.rstrip("/")
if OUT.exists():
    raise FileExistsError(OUT)


def request(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=args.timeout)


def api(path, body=None):
    with request(path, body) as response:
        return json.load(response)


def run_turn(prompt, events):
    start = time.perf_counter()
    with request("/api/chat", {"text": prompt, "modo": "agente"}) as response:
        for line in response:
            elapsed = (time.perf_counter() - start) * 1000
            if elapsed > args.timeout * 1000:
                raise TimeoutError("turn exceeded timeout")
            if not line.startswith(b"data: "):
                continue
            event = json.loads(line[6:])
            events.append({"elapsed_ms": elapsed, **event})
            if event.get("type") in ("action", "speed", "error", "done", "tool_progress"):
                print(json.dumps({"elapsed_ms": elapsed, **event}, ensure_ascii=False), flush=True)
            if event.get("type") == "done":
                break
    return (time.perf_counter() - start) * 1000


before = api("/api/chats")["active"]
workspace_before = api("/api/workspace")["root"]
workspace_expected = str(pathlib.Path(args.workspace).resolve())
api("/api/workspace", {"path": workspace_expected})
active = api("/api/chats", {"op": "new"})["active"]
report = {
    "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "scope": "One isolated agent task through the managed IDE; not a general quality benchmark.",
    "workspace": workspace_expected,
    "chat": active,
    "prompt": args.prompt,
    "followup": args.followup,
    "turns": [],
}
try:
    events = []
    wall = run_turn(args.prompt, events)
    report["turns"].append({"prompt": args.prompt, "wall_ms": wall, "events": events})
    if args.followup:
        events2 = []
        wall2 = run_turn(args.followup, events2)
        report["turns"].append({"prompt": args.followup, "wall_ms": wall2, "events": events2})
except Exception as exc:
    report["error"] = str(exc)
finally:
    try:
        api("/api/workspace", {"path": workspace_before})
        report["previous_workspace_restored"] = True
    except Exception as exc:
        report["previous_workspace_restore_error"] = str(exc)
    if before != active:
        try:
            api("/api/chats", {"op": "open", "id": before})
            report["previous_chat_restored"] = True
        except Exception as exc:
            report["previous_chat_restore_error"] = str(exc)
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({k: v for k, v in report.items() if k != "turns"}, ensure_ascii=False), flush=True)
