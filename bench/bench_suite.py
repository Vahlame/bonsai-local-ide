#!/usr/bin/env python3
"""Reproducible llama.cpp benchmark runner for the RTX 4060 8 GB lab.

The runner is intentionally a thin, explicit wrapper around llama-bench:

* every test uses a warm prompt, so GPU clocks are not measured cold;
* the first measured sample is discarded (llama-bench also does its own warmup);
* GPU/CPU telemetry is sampled while llama-bench runs;
* raw stdout/stderr, the exact command line and the binary hash are archived;
* CSV/JSON/Markdown are generated from the raw JSON, never hand-edited.

It does not modify clocks, power limits, drivers or the model files.
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import hashlib
import json
import math
import os
import re
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import psutil

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "bench" / "config" / "models.json"
TOOLCHAIN_PATH = ROOT / "config" / "inference-toolchain.local.json"
DEFAULT_BINARY = Path.home() / ".local" / "opt" / "bonsai-inference" / "build-RTX4060-Opt-sm89" / "bin" / "llama-bench.exe"

CSV_FIELDS = [
    "suite",
    "run_id",
    "model_key",
    "model",
    "model_size_gib",
    "quant",
    "backend",
    "build",
    "commit",
    "compiler_flags",
    "arch",
    "context_tokens",
    "n_depth",
    "batch",
    "ubatch",
    "threads",
    "gpu_layers",
    "n_cpu_moe",
    "kv_cache",
    "flash_attn",
    "tensor_split",
    "load_mode",
    "phase",
    "test",
    "n_prompt",
    "n_gen",
    "tok_s",
    "tok_s_reported",
    "tok_s_std",
    "tok_s_min",
    "tok_s_max",
    "ttft_ms",
    "itl_ms",
    "prefill_tok_s",
    "decode_tok_s",
    "effective_read_gbs",
    "pct_of_read_roofline",
    "vram_base_mib",
    "vram_peak_mib",
    "ram_peak_mib",
    "sys_ram_peak_gib",
    "gpu_util_avg",
    "gpu_util_max",
    "gpu_mem_util_avg",
    "cpu_util_avg",
    "cpu_util_max",
    "process_cpu_avg",
    "power_avg_w",
    "power_max_w",
    "temp_avg_c",
    "temp_max_c",
    "clock_gfx_avg_mhz",
    "clock_mem_avg_mhz",
    "pcie_gen",
    "pcie_width",
    "wall_ms",
    "load_ms_est",
    "reps",
    "samples_warm",
    "run_index",
    "note",
]


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_cmake_summary(binary: Path) -> tuple[str, str]:
    build_dir = binary.parent.parent
    cache_path = build_dir / "CMakeCache.txt"
    values: dict[str, str] = {}
    if cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line or line.startswith(("//", "#")) or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values[key.split(":", 1)[0]] = val
    arch = values.get("CMAKE_CUDA_ARCHITECTURES", "?")
    interesting = {
        k: values.get(k)
        for k in (
            "CMAKE_BUILD_TYPE",
            "CMAKE_CUDA_ARCHITECTURES",
            "CMAKE_CUDA_FLAGS",
            "CMAKE_CXX_FLAGS_RELEASE",
            "GGML_NATIVE",
            "GGML_LTO",
            "GGML_CUDA_FORCE_MMQ",
            "GGML_CUDA_FORCE_CUBLAS",
            "GGML_CUDA_FA_ALL_QUANTS",
            "GGML_CUDA_GRAPHS",
            "GGML_CUDA_COMPRESSION_MODE",
        )
        if values.get(k) is not None
    }
    return arch, json.dumps(interesting, sort_keys=True)


class GpuSampler:
    """Poll nvidia-smi and psutil while a benchmark process runs."""

    def __init__(self, pid: int, interval_s: float = 0.5):
        self.pid = pid
        self.interval_s = interval_s
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.samples: list[dict[str, Any]] = []
        self.proc = psutil.Process(pid)
        self._last_proc_cpu = None

    def _sample(self) -> dict[str, Any]:
        row: dict[str, Any] = {"t": time.time()}
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,utilization.memory,memory.used,power.draw,"
                "temperature.gpu,clocks.current.graphics,clocks.current.memory,"
                "pcie.link.gen.current,pcie.link.width.current",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            parts = [p.strip() for p in out.stdout.strip().splitlines()[0].split(",")]
            keys = [
                "gpu_util",
                "gpu_mem_util",
                "vram_mib",
                "power_w",
                "temp_c",
                "clock_gfx_mhz",
                "clock_mem_mhz",
                "pcie_gen",
                "pcie_width",
            ]
            for k, v in zip(keys, parts):
                if v in ("", "[N/A]", "N/A"):
                    continue
                try:
                    row[k] = float(v) if "." in v else int(v)
                except ValueError:
                    row[k] = v
        try:
            row["proc_rss_mib"] = self.proc.memory_info().rss / (1024 * 1024)
        except psutil.Error:
            pass
        try:
            row["proc_cpu"] = self.proc.cpu_percent(interval=None)
        except psutil.Error:
            pass
        try:
            row["cpu"] = psutil.cpu_percent(interval=None)
            vm = psutil.virtual_memory()
            row["sys_ram_used_gib"] = vm.used / (1024**3)
        except psutil.Error:
            pass
        return row

    def _loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.samples.append(self._sample())
            except Exception as exc:  # telemetry must never kill the benchmark
                self.samples.append({"t": time.time(), "error": str(exc)})
            self.stop_event.wait(self.interval_s)

    def start(self) -> None:
        psutil.cpu_percent(interval=None)
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)


def aggregate_samples(samples: list[dict[str, Any]]) -> dict[str, Any]:
    def values(key: str) -> list[float]:
        out = []
        for s in samples:
            v = s.get(key)
            if isinstance(v, (int, float)):
                out.append(float(v))
        return out

    def avg(key: str) -> float | None:
        v = values(key)
        return round(statistics.fmean(v), 2) if v else None

    def mx(key: str) -> float | None:
        v = values(key)
        return round(max(v), 2) if v else None

    def mx_int(key: str) -> int | None:
        v = values(key)
        return int(max(v)) if v else None

    # Exclude model-load/idle samples from power and temperature averages:
    # during load the GPU is not representative of decode or prefill.
    active = [s for s in samples if isinstance(s.get("gpu_util"), (int, float)) and float(s["gpu_util"]) >= 50.0]
    active_power = [float(s["power_w"]) for s in active if isinstance(s.get("power_w"), (int, float))]
    active_temp = [float(s["temp_c"]) for s in active if isinstance(s.get("temp_c"), (int, float))]

    return {
        "vram_peak_mib": mx_int("vram_mib"),
        "ram_peak_mib": mx_int("proc_rss_mib"),
        "sys_ram_peak_gib": mx("sys_ram_used_gib"),
        "gpu_util_avg": avg("gpu_util"),
        "gpu_util_max": mx("gpu_util"),
        "gpu_mem_util_avg": avg("gpu_mem_util"),
        "cpu_util_avg": avg("cpu"),
        "cpu_util_max": mx("cpu"),
        "process_cpu_avg": avg("proc_cpu"),
        "power_avg_w": round(statistics.fmean(active_power), 2) if active_power else avg("power_w"),
        "power_max_w": mx("power_w"),
        "power_active_samples": len(active_power),
        "temp_avg_c": round(statistics.fmean(active_temp), 2) if active_temp else avg("temp_c"),
        "temp_max_c": mx("temp_c"),
        "clock_gfx_avg_mhz": avg("clock_gfx_mhz"),
        "clock_mem_avg_mhz": avg("clock_mem_mhz"),
        "pcie_gen": mx_int("pcie_gen"),
        "pcie_width": mx_int("pcie_width"),
        "telemetry_samples": len(samples),
    }


def parse_llama_bench_json(stdout: str) -> list[dict[str, Any]]:
    text = stdout.strip()
    if not text:
        return []
    try:
        data = json.loads(text)
        return data if isinstance(data, list) else [data]
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def warm_stats(entry: dict[str, Any], drop_first: int = 1) -> tuple[float | None, float | None, float | None, float | None, int]:
    samples = [float(x) for x in entry.get("samples_ts", []) if isinstance(x, (int, float)) and x > 0]
    if drop_first and len(samples) > 1:
        samples = samples[drop_first:]
    if not samples:
        return None, None, None, None, 0
    return (
        round(statistics.median(samples), 3),
        round(statistics.pstdev(samples), 3) if len(samples) > 1 else 0.0,
        round(min(samples), 3),
        round(max(samples), 3),
        len(samples),
    )


def gpu_memory_used_mib() -> int | None:
    out = subprocess.run(
        ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    try:
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


def gpu_temperature() -> int | None:
    out = subprocess.run(
        ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    try:
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


def build_command(
    binary: Path,
    model: dict[str, Any],
    model_path: Path,
    prefill: list[int],
    decode: list[int],
    depth: int,
    kv: str,
    reps: int,
    batch: int,
    ubatch: int,
    threads: int,
    load_mode: str,
    n_cpu_moe: int,
    fa: str,
    extra: list[str],
) -> list[str]:
    cmd = [
        str(binary),
        "-m",
        str(model_path),
        "-ngl",
        "99",
        "-sm",
        "none",
        "-fa",
        fa,
        "-b",
        str(batch),
        "-ub",
        str(ubatch),
        "-t",
        str(threads),
        "-ctk",
        kv,
        "-ctv",
        kv,
        "-lm",
        load_mode,
        "-r",
        str(reps),
        "-o",
        "json",
    ]
    if n_cpu_moe > 0:
        cmd += ["-ncmoe", str(n_cpu_moe)]
    if prefill:
        cmd += ["-p", ",".join(str(x) for x in prefill)]
    if decode:
        cmd += ["-n", ",".join(str(x) for x in decode)]
    if depth:
        cmd += ["-d", str(depth)]
    cmd += extra
    return cmd


def run_one(
    suite: str,
    model_key: str,
    model: dict[str, Any],
    model_path: Path,
    prefill: list[int],
    decode: list[int],
    depth: int,
    kv: str,
    reps: int,
    batch: int,
    ubatch: int,
    threads: int,
    load_mode: str,
    n_cpu_moe: int,
    fa: str,
    binary: Path,
    out_raw: Path,
    run_index: int,
    idle_vram_mib: int | None,
    allow_busy: bool,
    timeout_s: int,
    extra: list[str],
    meta: dict[str, Any],
) -> list[dict[str, Any]]:
    cmd = build_command(
        binary, model, model_path, prefill, decode, depth, kv, reps,
        batch, ubatch, threads, load_mode, n_cpu_moe, fa, extra,
    )
    case_id = f"{model_key}__d{depth}__kv{kv}__r{run_index}"
    stdout_path = out_raw / f"{case_id}.stdout.txt"
    stderr_path = out_raw / f"{case_id}.stderr.txt"

    busy = gpu_memory_used_mib()
    if busy is not None and busy > 1024 and not allow_busy:
        raise RuntimeError(f"GPU busy: {busy} MiB used before {case_id}; stop other GPU users or pass --allow-busy")

    t0 = time.perf_counter()
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    sampler = GpuSampler(proc.pid, interval_s=0.5)
    sampler.start()
    try:
        stdout, stderr = proc.communicate(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, stderr = proc.communicate()
        stderr += f"\n[runner] TIMEOUT after {timeout_s}s"
    wall_ms = round((time.perf_counter() - t0) * 1000, 1)
    sampler.stop()
    stdout_path.write_text(stdout or "", encoding="utf-8")
    stderr_path.write_text(stderr or "", encoding="utf-8")
    telemetry = aggregate_samples(sampler.samples)

    rows: list[dict[str, Any]] = []
    if proc.returncode != 0:
        rows.append(
            {
                "suite": suite,
                "run_id": meta["run_id"],
                "model_key": model_key,
                "model": model.get("family", model_key),
                "model_size_gib": round(model_path.stat().st_size / 1024**3, 3),
                "quant": model.get("quant"),
                "backend": "llama.cpp CUDA",
                "build": meta["build_name"],
                "commit": meta["commit"],
                "compiler_flags": meta["compiler_flags"],
                "arch": meta["arch"],
                "phase": "error",
                "test": case_id,
                "wall_ms": wall_ms,
                "run_index": run_index,
                "note": f"exit={proc.returncode}; see {stderr_path.name}",
                **telemetry,
            }
        )
        return rows

    try:
        entries = parse_llama_bench_json(stdout)
    except Exception as exc:
        rows.append(
            {
                "suite": suite,
                "run_id": meta["run_id"],
                "model_key": model_key,
                "model": model.get("family", model_key),
                "model_size_gib": round(model_path.stat().st_size / 1024**3, 3),
                "quant": model.get("quant"),
                "backend": "llama.cpp CUDA",
                "build": meta["build_name"],
                "commit": meta["commit"],
                "compiler_flags": meta["compiler_flags"],
                "arch": meta["arch"],
                "phase": "error",
                "test": case_id,
                "wall_ms": wall_ms,
                "run_index": run_index,
                "note": f"JSON parse failed: {exc}; see {stdout_path.name}",
                **telemetry,
            }
        )
        return rows

    # The warm-up overhead is the difference between wall time and the sum of
    # measured test time. llama-bench also re-runs a warmup internally; this is
    # an estimate, not the same thing as server time-to-ready.
    measured_ms = 0.0
    for e in entries:
        measured_ms += float(e.get("avg_ns", 0)) * reps / 1e6
    load_ms_est = max(0.0, wall_ms - measured_ms)

    for e in entries:
        n_prompt = int(e.get("n_prompt", 0) or 0)
        n_gen = int(e.get("n_gen", 0) or 0)
        n_depth = int(e.get("n_depth", 0) or 0)
        phase = "prefill" if n_prompt > 0 else "decode"
        test = f"pp{n_prompt}" if phase == "prefill" else f"tg{n_gen}"
        if n_depth:
            test += f"@d{n_depth}"
        tok_s, tok_std, tok_min, tok_max, nsamples = warm_stats(e, drop_first=1)
        if tok_s is None:
            tok_s = float(e.get("avg_ts", 0) or 0)
            tok_std = float(e.get("stddev_ts", 0) or 0)
            tok_min = tok_max = tok_s
        model_size_gib = model_path.stat().st_size / 1024**3
        eff_gbs = None
        pct_roof = None
        if phase == "decode" and tok_s:
            # Weights are read once per token; KV/attention adds some traffic
            # but is not part of the model file. This is a lower-bound estimate.
            eff_gbs = round(tok_s * model_size_gib * (1024**3) / 1e9, 2)
            pct_roof = round(100 * eff_gbs / meta["measured_read_gbs"], 2) if meta.get("measured_read_gbs") else None
        row = {
            "suite": suite,
            "run_id": meta["run_id"],
            "model_key": model_key,
            "model": model.get("family", model_key),
            "model_size_gib": round(model_size_gib, 3),
            "quant": model.get("quant"),
            "backend": "llama.cpp CUDA",
            "build": meta["build_name"],
            "commit": meta["commit"],
            "compiler_flags": meta["compiler_flags"],
            "arch": meta["arch"],
            "context_tokens": n_depth + n_prompt + n_gen,
            "n_depth": n_depth,
            "batch": e.get("n_batch"),
            "ubatch": e.get("n_ubatch"),
            "threads": e.get("n_threads"),
            "gpu_layers": e.get("n_gpu_layers"),
            "n_cpu_moe": e.get("n_cpu_moe"),
            "kv_cache": f"{e.get('type_k')}-{e.get('type_v')}",
            "flash_attn": e.get("flash_attn"),
            "tensor_split": e.get("tensor_split"),
            "load_mode": e.get("load_mode"),
            "phase": phase,
            "test": test,
            "n_prompt": n_prompt,
            "n_gen": n_gen,
            "tok_s": tok_s,
            "tok_s_reported": round(float(e.get("avg_ts", 0) or 0), 3),
            "tok_s_std": tok_std,
            "tok_s_min": tok_min,
            "tok_s_max": tok_max,
            "ttft_ms": None,
            "itl_ms": round(1000.0 / tok_s, 3) if phase == "decode" and tok_s else None,
            "prefill_tok_s": tok_s if phase == "prefill" else None,
            "decode_tok_s": tok_s if phase == "decode" else None,
            "effective_read_gbs": eff_gbs,
            "pct_of_read_roofline": pct_roof,
            "vram_base_mib": idle_vram_mib,
            "wall_ms": wall_ms,
            "load_ms_est": round(load_ms_est, 1),
            "reps": reps,
            "samples_warm": nsamples,
            "run_index": run_index,
            "note": "first measured sample discarded; llama-bench warmup also active",
            **telemetry,
        }
        rows.append(row)
    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in CSV_FIELDS})


def fmt(v: Any, digits: int = 1) -> str:
    if v is None or v == "":
        return "—"
    try:
        return f"{float(v):,.{digits}f}"
    except Exception:
        return str(v)


def write_report(path: Path, rows: list[dict[str, Any]], meta: dict[str, Any]) -> None:
    ok = [r for r in rows if r.get("phase") in ("prefill", "decode")]
    errors = [r for r in rows if r.get("phase") == "error"]
    models = []
    for r in ok:
        if r["model_key"] not in models:
            models.append(r["model_key"])

    lines = [
        "# Benchmark report — RTX 4060 8 GB lab",
        "",
        f"Run: `{meta['run_id']}`  ",
        f"Suite: `{meta['suite']}`  ",
        f"Started: `{meta['started_at']}`  ",
        f"Binary: `{meta['binary']}`  ",
        f"Build: `{meta['build_name']}` · commit `{meta['commit']}`  ",
        f"GPU: {meta.get('gpu')} · driver {meta.get('driver')}  ",
        f"Measured VRAM read ceiling: **{fmt(meta.get('measured_read_gbs'), 2)} GB/s**  ",
        "",
        "Warm-up policy: llama-bench performs its own warm-up, then the runner "
        "discards the first of the measured samples. This is deliberately "
        "conservative: the first sample is the cold-clock sample. `tok_s` is "
        "the median of the remaining samples. No result is hand-edited.",
        "",
    ]
    if errors:
        lines += ["## Errors", "", "| case | note |", "|---|---|"]
        for e in errors:
            lines.append(f"| `{e.get('test')}` | {e.get('note')} |")
        lines.append("")

    for mk in models:
        mrows = [r for r in ok if r["model_key"] == mk]
        if not mrows:
            continue
        first = mrows[0]
        lines += [
            f"## {first['model']} (`{mk}`)",
            "",
            f"Quant **{first['quant']}** · {fmt(first['model_size_gib'], 2)} GiB · "
            f"CPU MoE layers **{first.get('n_cpu_moe')}** · KV **{first.get('kv_cache')}** · "
            f"threads **{first.get('threads')}** · b/ub **{first.get('batch')}/{first.get('ubatch')}**",
            "",
            "| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |",
            "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
        # One row per test, aggregating run_index if present.
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for r in mrows:
            groups.setdefault((r["phase"], r["test"]), []).append(r)
        for (phase, test), grp in sorted(groups.items(), key=lambda kv: (kv[0][0] != "prefill", kv[0][1])):
            vals = [float(g["tok_s"]) for g in grp if g.get("tok_s") is not None]
            tok = statistics.median(vals) if vals else None
            std = grp[0].get("tok_s_std")
            mn = min((g.get("tok_s_min") for g in grp if g.get("tok_s_min") is not None), default=None)
            mx = max((g.get("tok_s_max") for g in grp if g.get("tok_s_max") is not None), default=None)
            eff = statistics.median([g["effective_read_gbs"] for g in grp if g.get("effective_read_gbs") is not None]) if phase == "decode" else None
            pct = statistics.median([g["pct_of_read_roofline"] for g in grp if g.get("pct_of_read_roofline") is not None]) if phase == "decode" else None
            vram = max((g.get("vram_peak_mib") for g in grp if g.get("vram_peak_mib") is not None), default=None)
            util = max((g.get("gpu_util_max") for g in grp if g.get("gpu_util_max") is not None), default=None)
            pw = statistics.median([g["power_avg_w"] for g in grp if g.get("power_avg_w") is not None]) if any(g.get("power_avg_w") is not None for g in grp) else None
            pwm = max((g.get("power_max_w") for g in grp if g.get("power_max_w") is not None), default=None)
            temp = max((g.get("temp_max_c") for g in grp if g.get("temp_max_c") is not None), default=None)
            lines.append(
                f"| {phase} | {test} | **{fmt(tok, 2)}** | {fmt(std, 2)} | {fmt(mn, 2)} | {fmt(mx, 2)} | "
                f"{fmt(eff, 1)} | {fmt(pct, 1)} | {fmt(vram, 0)} | {fmt(util, 0)} | {fmt(pw, 1)}/{fmt(pwm, 1)} | {fmt(temp, 0)} |"
            )
        lines += [
            "",
            f"Telemetry: {mrows[0].get('telemetry_samples', '—')} samples; wall time "
            f"{fmt(mrows[0].get('wall_ms'), 0)} ms; load estimate {fmt(mrows[0].get('load_ms_est'), 0)} ms.",
            "",
        ]

    lines += [
        "## Notes and limits",
        "",
        "- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.",
        "- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.",
        "- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.",
        "- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.",
        "- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", default="core")
    ap.add_argument("--config", type=Path, default=CONFIG_PATH)
    ap.add_argument("--binary", type=Path, default=DEFAULT_BINARY)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--label", default="")
    ap.add_argument("--runs", type=int, default=None, help="Independent process runs per case")
    ap.add_argument("--reps", type=int, default=None, help="llama-bench repetitions per test")
    ap.add_argument("--model", action="append", default=None, help="Override suite model list")
    ap.add_argument("--prefill", default=None, help="Override comma-separated prefill list")
    ap.add_argument("--decode", default=None, help="Override comma-separated decode list")
    ap.add_argument("--context-depth", default=None, help="Override comma-separated depth list")
    ap.add_argument("--threads", type=int, default=None, help="Override model thread count")
    ap.add_argument("--batch", type=int, default=None)
    ap.add_argument("--ubatch", type=int, default=None)
    ap.add_argument("--kv", default=None, help="Override KV cache type")
    ap.add_argument("--n-cpu-moe", type=int, default=None, help="Override CPU MoE layer count")
    ap.add_argument("--reps-override", type=int, default=None)
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--cooldown", type=float, default=3.0)
    ap.add_argument("--max-temp", type=int, default=72)
    ap.add_argument("--allow-busy", action="store_true")
    ap.add_argument("--publish", action="store_true", help="Copy results to benchmark_results.* at repo root")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    suites = cfg["suites"]
    models_cfg = cfg["models"]
    if args.suite not in suites:
        raise SystemExit(f"Unknown suite {args.suite}; available: {', '.join(suites)}")
    suite = dict(suites[args.suite])
    if args.model:
        suite["models"] = args.model
    if args.prefill:
        suite["prefill"] = [int(x) for x in args.prefill.split(",")]
    if args.decode:
        suite["decode"] = [int(x) for x in args.decode.split(",")]
    if args.context_depth:
        suite["contexts"] = [int(x) for x in args.context_depth.split(",")]
    reps = args.reps if args.reps is not None else int(suite.get("reps", 4))
    runs = args.runs if args.runs is not None else int(suite.get("runs", 1))
    if args.reps_override:
        reps = args.reps_override

    binary = args.binary.resolve()
    if not binary.exists():
        raise SystemExit(f"llama-bench not found: {binary}")
    tools = json.loads(TOOLCHAIN_PATH.read_text(encoding="utf-8")) if TOOLCHAIN_PATH.exists() else {}
    profile = json.loads((ROOT / "machine_profile.json").read_text(encoding="utf-8")) if (ROOT / "machine_profile.json").exists() else {}
    measured_read_gbs = profile.get("measured", {}).get("cuda_bandwidth", {}).get("device_read_gbs")

    run_id = args.label or f"{args.suite}-{_dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out = (args.out or (ROOT / "reports" / f"bench-{run_id}")).resolve()
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    arch, compiler_flags = load_cmake_summary(binary)
    version_proc = subprocess.run([str(binary), "--version"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    version = (version_proc.stdout or "") + "\n" + (version_proc.stderr or "")
    commit = ""
    m = re.search(r"commit\s+([0-9a-fA-F]{7,40})", version)
    if m:
        commit = m.group(1)
    if not commit:
        for line in version.splitlines():
            if "version:" in line:
                for part in line.split():
                    if len(part) >= 7 and all(c in "0123456789abcdef" for c in part.lower()):
                        commit = part
                        break
    commit = commit or "unknown"
    meta = {
        "run_id": run_id,
        "suite": args.suite,
        "suite_config": suite,
        "binary": str(binary),
        "binary_sha256": sha256(binary),
        "build_name": binary.parent.parent.name,
        "arch": arch,
        "compiler_flags": compiler_flags,
        "commit": commit,
        "started_at": now_iso(),
        "finished_at": None,
        "argv": sys.argv,
        "gpu": profile.get("gpu", {}).get("name"),
        "driver": profile.get("gpu", {}).get("driver_version"),
        "measured_read_gbs": measured_read_gbs,
        "reps": reps,
        "runs": runs,
        "warmup_policy": "llama-bench warmup + drop first measured sample",
    }

    cases: list[dict[str, Any]] = []
    for mk in suite["models"]:
        if mk not in models_cfg:
            raise SystemExit(f"Unknown model key: {mk}")
        mc = models_cfg[mk]
        path = (ROOT / mc["path"]).resolve()
        if not path.exists():
            print(f"SKIP {mk}: missing {path}", file=sys.stderr)
            continue
        kv_list = suite.get("kv_overrides") or [args.kv or mc.get("kv", "f16")]
        # Main case at depth 0: prefill + decode together (efficient and warm).
        for kv in kv_list:
            cases.append(
                {
                    "model_key": mk,
                    "model": mc,
                    "path": path,
                    "prefill": suite.get("prefill", []),
                    "decode": suite.get("decode", []),
                    "depth": 0,
                    "kv": kv,
                    "batch": int(args.batch if args.batch is not None else mc.get("batch", 1024)),
                    "ubatch": int(args.ubatch if args.ubatch is not None else mc.get("ubatch", 512)),
                    "threads": int(args.threads if args.threads is not None else mc.get("threads", 8)),
                    "load_mode": mc.get("load_mode", "none"),
                    "n_cpu_moe": int(args.n_cpu_moe if args.n_cpu_moe is not None else mc.get("n_cpu_moe", 0)),
                }
            )
            for d in suite.get("contexts", []):
                if int(d) <= 0:
                    continue
                cases.append(
                    {
                        "model_key": mk,
                        "model": mc,
                        "path": path,
                        "prefill": [512],
                        "decode": [128],
                        "depth": int(d),
                        "kv": kv,
                        "batch": int(args.batch if args.batch is not None else mc.get("batch", 1024)),
                        "ubatch": int(args.ubatch if args.ubatch is not None else mc.get("ubatch", 512)),
                        "threads": int(args.threads if args.threads is not None else mc.get("threads", 8)),
                        "load_mode": mc.get("load_mode", "none"),
                        "n_cpu_moe": int(args.n_cpu_moe if args.n_cpu_moe is not None else mc.get("n_cpu_moe", 0)),
                    }
                )

    # Drop duplicate identical cases.
    seen = set()
    unique_cases = []
    for c in cases:
        key = (c["model_key"], tuple(c["prefill"]), tuple(c["decode"]), c["depth"], c["kv"], c["n_cpu_moe"])
        if key in seen:
            continue
        seen.add(key)
        unique_cases.append(c)
    cases = unique_cases

    print(f"Run {run_id}: {len(cases)} cases × {runs} run(s), {reps} reps")
    for c in cases:
        print(
            f"  {c['model_key']:18s} prefill={c['prefill']} decode={c['decode']} depth={c['depth']} kv={c['kv']} ncmoe={c['n_cpu_moe']}"
        )
    if args.dry_run:
        for c in cases:
            print(" ".join(build_command(binary, c["model"], c["path"], c["prefill"], c["decode"], c["depth"], c["kv"], reps, c["batch"], c["ubatch"], c["threads"], c["load_mode"], c["n_cpu_moe"], "on", [])))
        return 0

    all_rows: list[dict[str, Any]] = []
    idle = gpu_memory_used_mib()
    for ci, c in enumerate(cases, 1):
        for ri in range(1, runs + 1):
            temp = gpu_temperature()
            if temp is not None and temp > args.max_temp:
                print(f"  cooldown: {temp}°C > {args.max_temp}°C", flush=True)
                deadline = time.time() + 120
                while time.time() < deadline:
                    time.sleep(5)
                    temp = gpu_temperature()
                    if temp is not None and temp <= args.max_temp - 5:
                        break
            print(f"[{ci}/{len(cases)} run {ri}/{runs}] {c['model_key']} depth={c['depth']} kv={c['kv']}", flush=True)
            try:
                rows = run_one(
                    args.suite, c["model_key"], c["model"], c["path"],
                    c["prefill"], c["decode"], c["depth"], c["kv"], reps,
                    c["batch"], c["ubatch"], c["threads"], c["load_mode"],
                    c["n_cpu_moe"], "on", binary, raw, ri, idle,
                    args.allow_busy, args.timeout, [], meta,
                )
                all_rows.extend(rows)
                for r in rows[:3]:
                    if r.get("phase") in ("prefill", "decode"):
                        print(f"    {r['phase']:7s} {r['test']:12s} {fmt(r.get('tok_s'), 2):>9s} tok/s")
            except Exception as exc:
                print(f"    FAILED: {exc}", file=sys.stderr)
                all_rows.append(
                    {
                        "suite": args.suite,
                        "run_id": run_id,
                        "model_key": c["model_key"],
                        "model": c["model"].get("family"),
                        "quant": c["model"].get("quant"),
                        "phase": "error",
                        "test": f"{c['model_key']}@d{c['depth']}",
                        "run_index": ri,
                        "note": str(exc),
                    }
                )
            time.sleep(args.cooldown)

    meta["finished_at"] = now_iso()
    meta["row_count"] = len(all_rows)
    write_csv(out / "benchmark_results.csv", all_rows)
    (out / "benchmark_results.json").write_text(
        json.dumps({"metadata": meta, "rows": all_rows}, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    write_report(out / "benchmark_report.md", all_rows, meta)
    (out / "manifest.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    if args.publish:
        for name in ("benchmark_results.csv", "benchmark_results.json", "benchmark_report.md"):
            (ROOT / name).write_bytes((out / name).read_bytes())

    print(f"Wrote {out}")
    print(f"  {len(all_rows)} rows, {sum(1 for r in all_rows if r.get('phase') == 'error')} errors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
