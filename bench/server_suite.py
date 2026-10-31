#!/usr/bin/env python3
"""Server-level benchmarks for llama-server on the RTX 4060 laptop.

Measures what llama-bench cannot:

* time-to-ready (model load + CUDA init + graph capture);
* real TTFT over HTTP (tokenizer + prefill + first sampled token);
* inter-token latency (ITL) and decode tok/s from streaming responses;
* prompt/prefix cache reuse (cold vs. warm request);
* VRAM/RAM/power during a server session.

The server is started and stopped by this script. It never edits the model or
the runtime; every request is archived as JSONL under the output directory.
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import http.client
import json
import os
import socket
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import psutil

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench_suite import GpuSampler, aggregate_samples, gpu_memory_used_mib, gpu_temperature  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MODELS_PATH = ROOT / "bench" / "config" / "models.json"
TOOLCHAIN_PATH = ROOT / "config" / "inference-toolchain.local.json"
DEFAULT_SERVER = Path.home() / ".local" / "opt" / "bonsai-inference" / "build-RTX4060-Opt-sm89" / "bin" / "llama-server.exe"

BASE_TEXT = (
    "The local inference engine reads model weights from memory, performs matrix multiplication, "
    "and writes one token at a time. On a small GPU the decode phase is limited by memory bandwidth, "
    "while prefill is limited by tensor-core throughput and board power. A good benchmark separates "
    "prompt processing from generation, warms the clocks, discards the first sample, and records the "
    "variance. The same input must be used for every configuration so that quality and speed are not "
    "confused. Long context is useful only when the model can retrieve the information it contains. "
)


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def http_json(port: int, method: str, path: str, payload: dict[str, Any] | None = None, timeout: float = 30) -> Any:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if body else {}
    conn.request(method, path, body=body, headers=headers)
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    if resp.status != 200:
        raise RuntimeError(f"{method} {path} -> {resp.status}: {data[:500]!r}")
    return json.loads(data.decode("utf-8")) if data else None


def wait_ready(port: int, proc: subprocess.Popen, timeout_s: float = 180) -> float:
    t0 = time.perf_counter()
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"server exited with code {proc.returncode}")
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
            conn.request("GET", "/health")
            resp = conn.getresponse()
            body = resp.read()
            conn.close()
            if resp.status == 200:
                return (time.perf_counter() - t0) * 1000
        except Exception:
            pass
        time.sleep(0.1)
    raise RuntimeError("server did not become ready")


def build_prompt(target_tokens: int, nonce: str = "") -> str:
    # ~4 characters/token for this English prose. The server reports the exact
    # prompt_n in its timings; the target is only used to size the request.
    chars = max(256, target_tokens * 4)
    body = (BASE_TEXT * ((chars // len(BASE_TEXT)) + 2))[:chars]
    return f"[{nonce}]\n{body}\n\nSummarize the text above in one sentence."


def tokenize(port: int, text: str) -> int:
    try:
        data = http_json(port, "POST", "/tokenize", {"content": text}, timeout=60)
        toks = data.get("tokens", [])
        return len(toks)
    except Exception:
        return 0


def stream_completion(
    port: int,
    prompt: str,
    n_predict: int,
    cache_prompt: bool,
    timeout_s: float = 900,
) -> dict[str, Any]:
    payload = {
        "prompt": prompt,
        "n_predict": n_predict,
        "stream": True,
        "temperature": 0.0,
        "top_k": 1,
        "top_p": 1.0,
        "min_p": 0.0,
        "repeat_penalty": 1.0,
        "cache_prompt": cache_prompt,
    }
    t0 = time.perf_counter()
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout_s)
    conn.request("POST", "/completion", body=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    if resp.status != 200:
        body = resp.read()[:1000]
        conn.close()
        raise RuntimeError(f"/completion -> {resp.status}: {body!r}")

    first_content_at = None
    last_content_at = None
    itls: list[float] = []
    chunks = 0
    text_len = 0
    final: dict[str, Any] = {}
    raw_lines = 0
    while True:
        line = resp.readline()
        if not line:
            break
        raw_lines += 1
        if not line.startswith(b"data: "):
            continue
        data_text = line[6:].strip()
        if data_text == b"[DONE]":
            break
        try:
            data = json.loads(data_text)
        except json.JSONDecodeError:
            continue
        content = data.get("content") or ""
        if content:
            now = time.perf_counter()
            if first_content_at is None:
                first_content_at = now
            if last_content_at is not None:
                itls.append((now - last_content_at) * 1000)
            last_content_at = now
            chunks += 1
            text_len += len(content)
        if data.get("stop"):
            final = data
    conn.close()
    end = time.perf_counter()
    timings = final.get("timings") or {}
    ttft_ms = (first_content_at - t0) * 1000 if first_content_at else None
    stream_ms = (end - t0) * 1000
    return {
        "ttft_ms": round(ttft_ms, 2) if ttft_ms is not None else None,
        "stream_ms": round(stream_ms, 2),
        "itl_ms_median": round(statistics.median(itls), 3) if itls else None,
        "itl_ms_p95": round(sorted(itls)[int(0.95 * (len(itls) - 1))], 3) if itls else None,
        "itl_samples": len(itls),
        "chunks": chunks,
        "text_chars": text_len,
        "raw_lines": raw_lines,
        "timings": timings,
        "stop_reason": final.get("stop_type") or final.get("stopped_eos") or final.get("stopped_limit"),
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "suite", "run_id", "model_key", "model", "quant", "context", "kv",
        "prompt_target", "prompt_tokens", "n_predict", "predicted_n",
        "ttft_ms", "prefill_tok_s", "decode_tok_s", "itl_median_ms", "itl_p95_ms",
        "cache_prompt", "cache_n", "load_ms", "vram_idle_mib", "vram_model_mib",
        "vram_peak_mib", "ram_peak_mib", "cpu_util_avg", "power_avg_w",
        "power_max_w", "temp_max_c", "wall_ms", "run", "note", "response_chars",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def fmt(v: Any, digits: int = 1) -> str:
    if v is None or v == "":
        return "—"
    try:
        return f"{float(v):,.{digits}f}"
    except Exception:
        return str(v)


def write_report(path: Path, rows: list[dict[str, Any]], meta: dict[str, Any]) -> None:
    lines = [
        "# Server benchmark — RTX 4060 8 GB lab",
        "",
        f"Run `{meta['run_id']}` · model `{meta['model_key']}` · context {meta['context']} · "
        f"KV {meta['kv']} · build `{meta['build_name']}` · commit `{meta['commit']}`",
        f"Server binary: `{meta['server']}` · load time **{fmt(meta.get('load_ms'), 0)} ms** · "
        f"VRAM after load **{fmt(meta.get('vram_model_mib'), 0)} MiB** · peak **{fmt(meta.get('vram_peak_mib'), 0)} MiB**",
        "",
        "TTFT is measured from the HTTP request write to the first non-empty content "
        "chunk. ITL is the time between consecutive content chunks; the decode rate "
        "is also reported by llama-server in its final `timings` object. `cache_n` "
        "is the number of prompt tokens reused from the slot cache.",
        "",
        "| prompt target | actual tokens | TTFT ms | prefill tok/s | decode tok/s | ITL median ms | ITL p95 ms | cache_n | VRAM peak MiB |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in rows:
        if r.get("note"):
            continue
        lines.append(
            f"| {r['prompt_target']} | {r.get('prompt_tokens') or '—'} | **{fmt(r.get('ttft_ms'), 1)}** | "
            f"{fmt(r.get('prefill_tok_s'), 1)} | {fmt(r.get('decode_tok_s'), 1)} | {fmt(r.get('itl_median_ms'), 2)} | "
            f"{fmt(r.get('itl_p95_ms'), 2)} | {r.get('cache_n') or 0} | {fmt(r.get('vram_peak_mib'), 0)} |"
        )
    lines += [
        "",
        "## Prompt cache",
        "",
        "The same prompt is sent twice. The first request uses `cache_prompt=false`; "
        "the second uses `cache_prompt=true`. A large `cache_n` and a lower TTFT on "
        "the second request are the only evidence accepted as a cache win.",
        "",
    ]
    # Cache rows are tagged in note.
    cold = [r for r in rows if r.get("note") == "cache-cold"]
    warm = [r for r in rows if r.get("note") == "cache-warm"]
    if cold and warm:
        c, w = cold[-1], warm[-1]
        speed = None
        if c.get("ttft_ms") and w.get("ttft_ms"):
            speed = c["ttft_ms"] / w["ttft_ms"]
        lines += [
            "| request | TTFT ms | prefill tok/s | cache_n |",
            "|---|---:|---:|---:|",
            f"| cold | {fmt(c.get('ttft_ms'), 1)} | {fmt(c.get('prefill_tok_s'), 1)} | 0 |",
            f"| warm | {fmt(w.get('ttft_ms'), 1)} | {fmt(w.get('prefill_tok_s'), 1)} | {w.get('cache_n') or 0} |",
            f"| speedup | **{fmt(speed, 2)}×** | | |",
            "",
        ]
    else:
        lines += ["_No cache pair was run._", ""]
    lines += [
        "## Notes",
        "",
        "- `prompt_target` is the requested size; `prompt_tokens` is the exact count returned by the server.",
        "- A single request is not a benchmark. The runner repeats each size; the report shows the last measured row per size unless a note says otherwise.",
        "- The server was stopped after the run; no process is left listening.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen3-4b")
    ap.add_argument("--server", type=Path, default=DEFAULT_SERVER)
    ap.add_argument("--context", type=int, default=None)
    ap.add_argument("--prompts", default="128,512,2048,8192")
    ap.add_argument("--n-predict", type=int, default=128)
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--cache-test", action="store_true")
    ap.add_argument("--cache-tokens", type=int, default=8192)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--label", default="")
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--allow-busy", action="store_true")
    ap.add_argument("--n-cpu-moe", type=int, default=None)
    ap.add_argument("--threads", type=int, default=None)
    ap.add_argument("--batch", type=int, default=None)
    ap.add_argument("--ubatch", type=int, default=None)
    ap.add_argument("--kv", default=None)
    ap.add_argument("--extra", default="", help="Extra llama-server flags")
    args = ap.parse_args()

    models = json.loads(MODELS_PATH.read_text(encoding="utf-8"))["models"]
    if args.model not in models:
        raise SystemExit(f"unknown model {args.model}")
    model = models[args.model]
    model_path = (ROOT / model["path"]).resolve()
    if not model_path.exists():
        raise SystemExit(f"missing model {model_path}")
    tools = json.loads(TOOLCHAIN_PATH.read_text(encoding="utf-8")) if TOOLCHAIN_PATH.exists() else {}
    server = args.server.resolve()
    if not server.exists():
        raise SystemExit(f"missing llama-server {server}")
    profile = json.loads((ROOT / "machine_profile.json").read_text(encoding="utf-8")) if (ROOT / "machine_profile.json").exists() else {}
    context = args.context or (65536 if model.get("moe") else 16384)
    kv = args.kv or model.get("kv", "f16")
    n_cpu_moe = args.n_cpu_moe if args.n_cpu_moe is not None else int(model.get("n_cpu_moe", 0))
    threads = args.threads if args.threads is not None else int(model.get("threads", 8))
    batch = args.batch if args.batch is not None else int(model.get("batch", 1024))
    ubatch = args.ubatch if args.ubatch is not None else int(model.get("ubatch", 512))
    run_id = args.label or f"server-{args.model}-{_dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out = (args.out or (ROOT / "reports" / f"bench-{run_id}")).resolve()
    out.mkdir(parents=True, exist_ok=True)
    port = free_port()
    busy = gpu_memory_used_mib()
    if busy is not None and busy > 1024 and not args.allow_busy:
        raise SystemExit(f"GPU busy: {busy} MiB; stop other GPU users or pass --allow-busy")

    log_path = out / "server.log"
    log = log_path.open("w", encoding="utf-8", errors="replace")
    cmd = [
        str(server), "-m", str(model_path), "-ngl", "99", "-sm", "none", "-fa", "on",
        "-c", str(context), "-b", str(batch), "-ub", str(ubatch),
        "-t", str(threads), "-ctk", kv, "-ctv", kv,
        "-lm", model.get("load_mode", "none"), "--host", "127.0.0.1", "--port", str(port),
        "--parallel", "1", "--no-context-shift", "--metrics",
    ]
    if n_cpu_moe > 0:
        cmd += ["--n-cpu-moe", str(n_cpu_moe)]
    if args.extra:
        cmd += args.extra.split()
    print(" ".join(cmd))
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", cwd=str(ROOT))
    sampler = GpuSampler(proc.pid, interval_s=0.5)
    sampler.start()
    try:
        load_ms = wait_ready(port, proc, timeout_s=180)
        time.sleep(1.0)
        vram_model = gpu_memory_used_mib()
        # Warm the clocks and the HTTP path; never measured.
        warm = stream_completion(port, build_prompt(64, "warm"), 8, cache_prompt=False, timeout_s=120)
        time.sleep(1.0)

        rows: list[dict[str, Any]] = []
        prompt_sizes = [int(x) for x in args.prompts.split(",") if x.strip()]
        for target in prompt_sizes:
            for run in range(1, args.runs + 1):
                nonce = f"run-{run}-{target}"
                text = build_prompt(target, nonce)
                exact = tokenize(port, text)
                t_req = time.perf_counter()
                result = stream_completion(port, text, args.n_predict, cache_prompt=False, timeout_s=args.timeout)
                wall = (time.perf_counter() - t_req) * 1000
                timings = result.get("timings") or {}
                row = {
                    "suite": "server",
                    "run_id": run_id,
                    "model_key": args.model,
                    "model": model.get("family", args.model),
                    "quant": model.get("quant"),
                    "context": context,
                    "kv": kv,
                    "prompt_target": target,
                    "prompt_tokens": exact or timings.get("prompt_n"),
                    "n_predict": args.n_predict,
                    "predicted_n": timings.get("predicted_n"),
                    "ttft_ms": result.get("ttft_ms"),
                    "prefill_tok_s": round(timings.get("prompt_per_second", 0), 2) if timings.get("prompt_per_second") else None,
                    "decode_tok_s": round(timings.get("predicted_per_second", 0), 2) if timings.get("predicted_per_second") else None,
                    "itl_median_ms": result.get("itl_ms_median"),
                    "itl_p95_ms": result.get("itl_ms_p95"),
                    "cache_prompt": False,
                    "cache_n": timings.get("cache_n"),
                    "load_ms": round(load_ms, 1),
                    "vram_idle_mib": busy,
                    "vram_model_mib": vram_model,
                    "response_chars": result.get("text_chars"),
                    "wall_ms": round(wall, 1),
                    "run": run,
                    "note": "",
                    **aggregate_samples(sampler.samples),
                }
                rows.append(row)
                print(f"  {target:6d} tok -> actual {row['prompt_tokens']}  TTFT {fmt(row['ttft_ms'],1)} ms  "
                      f"prefill {fmt(row['prefill_tok_s'],0)} tok/s  decode {fmt(row['decode_tok_s'],1)} tok/s")
                (out / "requests.jsonl").open("a", encoding="utf-8").write(json.dumps(row, ensure_ascii=False) + "\n")
                # Flush samples so the next row has its own peak only if the
                # sampler is restarted; we keep the session peak to avoid
                # under-reporting the high-water mark.
                time.sleep(0.3)

        if args.cache_test:
            text = build_prompt(args.cache_tokens, "cache")
            exact = tokenize(port, text)
            cold = stream_completion(port, text, 64, cache_prompt=False, timeout_s=args.timeout)
            warm = stream_completion(port, text, 64, cache_prompt=True, timeout_s=args.timeout)
            for tag, res in (("cache-cold", cold), ("cache-warm", warm)):
                timings = res.get("timings") or {}
                rows.append({
                    "suite": "server-cache",
                    "run_id": run_id,
                    "model_key": args.model,
                    "model": model.get("family", args.model),
                    "quant": model.get("quant"),
                    "context": context,
                    "kv": kv,
                    "prompt_target": args.cache_tokens,
                    "prompt_tokens": exact or timings.get("prompt_n"),
                    "n_predict": 64,
                    "predicted_n": timings.get("predicted_n"),
                    "ttft_ms": res.get("ttft_ms"),
                    "prefill_tok_s": round(timings.get("prompt_per_second", 0), 2) if timings.get("prompt_per_second") else None,
                    "decode_tok_s": round(timings.get("predicted_per_second", 0), 2) if timings.get("predicted_per_second") else None,
                    "itl_median_ms": res.get("itl_ms_median"),
                    "itl_p95_ms": res.get("itl_ms_p95"),
                    "cache_prompt": tag == "cache-warm",
                    "cache_n": timings.get("cache_n"),
                    "load_ms": round(load_ms, 1),
                    "vram_idle_mib": busy,
                    "vram_model_mib": vram_model,
                    "response_chars": res.get("text_chars"),
                    "wall_ms": res.get("stream_ms"),
                    "run": 1,
                    "note": tag,
                    **aggregate_samples(sampler.samples),
                })
                print(f"  {tag}: TTFT {fmt(res.get('ttft_ms'),1)} ms  cache_n {timings.get('cache_n')}")
    finally:
        sampler.stop()
        try:
            proc.terminate()
            proc.wait(timeout=20)
        except Exception:
            proc.kill()
        log.close()

    telemetry = aggregate_samples(sampler.samples)
    meta = {
        "run_id": run_id,
        "model_key": args.model,
        "model": model.get("family"),
        "context": context,
        "kv": kv,
        "n_cpu_moe": n_cpu_moe,
        "threads": threads,
        "batch": batch,
        "ubatch": ubatch,
        "server": str(server),
        "build_name": server.parent.parent.name,
        "commit": _commit(server),
        "load_ms": load_ms,
        "vram_model_mib": vram_model,
        "vram_peak_mib": telemetry.get("vram_peak_mib"),
        "started_at": meta_now(t0),
        "finished_at": now_iso(),
        "command": cmd,
        "telemetry": telemetry,
        "gpu": profile.get("gpu", {}).get("name"),
    }
    write_csv(out / "server_results.csv", rows)
    (out / "server_results.json").write_text(json.dumps({"metadata": meta, "rows": rows}, indent=2, ensure_ascii=False), encoding="utf-8")
    write_report(out / "server_report.md", rows, meta)
    (out / "server_manifest.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out} ({len(rows)} rows)")
    return 0


def meta_now(t0: float) -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _commit(server: Path) -> str:
    # Read the source commit from the build's cache/source, not by guessing.
    try:
        tools = json.loads(TOOLCHAIN_PATH.read_text(encoding="utf-8"))
        src = Path(tools["installRoot"]) / "llama.cpp-rtx4060-opt"
        p = subprocess.run(["git", "-C", str(src), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
        return p.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
