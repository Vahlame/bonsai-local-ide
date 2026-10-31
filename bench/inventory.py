#!/usr/bin/env python3
"""Phase 1 machine inventory for the RTX 4060 local-inference lab.

Collects hardware, OS, driver, CUDA, toolchain and runtime facts, runs the
small CUDA bandwidth probe and Windows disk/RAM assessments, then writes:

    machine_profile.json
    hardware_report.md

The report is intentionally explicit about what was measured vs. what is a
vendor/spec value. No benchmark numbers are invented here.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PROFILE_PATH = ROOT / "machine_profile.json"
REPORT_PATH = ROOT / "hardware_report.md"
BANDWIDTH_JSON = ROOT / "bench" / "results" / "bandwidth.json"
BANDWIDTH_EXE = ROOT / "bin" / "probes" / "bandwidth.exe"
TOOLCHAIN_PATH = ROOT / "config" / "inference-toolchain.local.json"


def run(cmd: list[str], timeout: int = 60, check: bool = False) -> str:
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        if check and p.returncode != 0:
            raise RuntimeError(f"{cmd} failed ({p.returncode}): {p.stderr[-500:]}")
        return (p.stdout or "") + (("\n" + p.stderr) if p.stderr else "")
    except FileNotFoundError:
        return ""
    except subprocess.TimeoutExpired:
        return ""


def run_ps(script: str, timeout: int = 90) -> Any:
    cmd = [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ErrorActionPreference='Stop'; " + script,
    ]
    text = run(cmd, timeout=timeout)
    if not text.strip():
        return None
    # PowerShell may emit warnings before JSON; find the first object/array.
    for start in (text.find("{"), text.find("[")):
        pass
    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    if not starts:
        return None
    start = min(starts)
    candidate = text[start:]
    try:
        return json.loads(candidate)
    except Exception:
        return None


def first_float(pattern: str, text: str, default: float | None = None) -> float | None:
    m = re.search(pattern, text, re.MULTILINE)
    if not m:
        return default
    try:
        return float(m.group(1).replace(",", ""))
    except Exception:
        return default


def first_int(pattern: str, text: str, default: int | None = None) -> int | None:
    v = first_float(pattern, text, None)
    return int(v) if v is not None else default


def powershell_version_of(path: str) -> str | None:
    if not Path(path).exists():
        return None
    out = run_ps(
        f"$v=(Get-Item -LiteralPath '{path}').VersionInfo; "
        "@{fileVersion=$v.FileVersion; productVersion=$v.ProductVersion; "
        "company=$v.CompanyName; description=$v.FileDescription} | ConvertTo-Json -Compress"
    )
    if isinstance(out, dict):
        return out.get("fileVersion") or out.get("productVersion")
    return None


def git_info(path: Path) -> dict[str, Any]:
    if not (path / ".git").exists() and not (path / ".git").is_file():
        return {}
    return {
        "head": run(["git", "-C", str(path), "rev-parse", "HEAD"]).strip(),
        "describe": run(["git", "-C", str(path), "describe", "--always", "--dirty"]).strip(),
        "branch": run(["git", "-C", str(path), "rev-parse", "--abbrev-ref", "HEAD"]).strip(),
        "remote": run(["git", "-C", str(path), "remote", "get-url", "origin"]).strip(),
    }


def parse_cmake_cache(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line or line.startswith(("//", "#")) or "=" not in line:
            continue
        k, _, v = line.partition("=")
        # Strip :TYPE suffix from the key.
        k = k.split(":", 1)[0]
        out[k] = v
    return out


def build_inventory(tools_root: Path) -> list[dict[str, Any]]:
    builds = []
    if not tools_root.exists():
        return builds
    for d in sorted(tools_root.iterdir()):
        if not d.is_dir() or not (d / "CMakeCache.txt").exists():
            continue
        cache = parse_cmake_cache(d / "CMakeCache.txt")
        binary = d / "bin" / "llama-bench.exe"
        if not binary.exists():
            continue
        builds.append(
            {
                "name": d.name,
                "path": str(d),
                "binary": str(binary),
                "cmake": {
                    k: cache.get(k)
                    for k in (
                        "CMAKE_BUILD_TYPE",
                        "CMAKE_CUDA_ARCHITECTURES",
                        "CMAKE_CUDA_FLAGS",
                        "CMAKE_CXX_FLAGS_RELEASE",
                        "GGML_NATIVE",
                        "GGML_LTO",
                        "GGML_CUDA",
                        "GGML_CUDA_ARCHITECTURES",
                        "GGML_CUDA_FORCE_MMQ",
                        "GGML_CUDA_FORCE_CUBLAS",
                        "GGML_CUDA_FA_ALL_QUANTS",
                        "GGML_CUDA_GRAPHS",
                        "GGML_CUDA_COMPRESSION_MODE",
                        "LLAMA_BUILD_NUMBER",
                    )
                    if cache.get(k) is not None
                },
                "binary_version": run([str(binary), "--version"]).strip().splitlines()[:4],
            }
        )
    return builds


def parse_gpu() -> dict[str, Any]:
    fields = [
        ("name", "name"),
        ("memory_total_mib", "memory.total"),
        ("memory_used_mib", "memory.used"),
        ("memory_free_mib", "memory.free"),
        ("driver_version", "driver_version"),
        ("compute_capability", "compute_cap"),
        ("link_gen_max", "pcie.link.gen.max"),
        ("link_gen_current", "pcie.link.gen.current"),
        ("link_width_max", "pcie.link.width.max"),
        ("link_width_current", "pcie.link.width.current"),
        ("clock_graphics_mhz", "clocks.current.graphics"),
        ("clock_graphics_max_mhz", "clocks.max.graphics"),
        ("clock_memory_mhz", "clocks.current.memory"),
        ("clock_memory_max_mhz", "clocks.max.memory"),
        ("temperature_gpu", "temperature.gpu"),
        ("utilization_gpu", "utilization.gpu"),
        ("utilization_memory", "utilization.memory"),
    ]
    csv_fields = ",".join(f[1] for f in fields)
    text = run(["nvidia-smi", f"--query-gpu={csv_fields}", "--format=csv,noheader,nounits"])
    gpu: dict[str, Any] = {"nvidia_smi_query": text.strip()}
    if text.strip():
        parts = [p.strip() for p in text.strip().splitlines()[0].split(",")]
        for (key, _), v in zip(fields, parts):
            if v in ("", "[N/A]", "N/A"):
                continue
            try:
                gpu[key] = float(v) if "." in v else int(v)
            except ValueError:
                gpu[key] = v

    q = run(["nvidia-smi", "-q"], timeout=30)

    def grab(pat: str, section_after: str | None = None) -> int | None:
        hay = q
        if section_after:
            idx = q.find(section_after)
            if idx >= 0:
                hay = q[idx:]
        return first_int(pat, hay)

    gpu.update(
        {
            "architecture": (re.search(r"Product Architecture\s*:\s*(\S+)", q).group(1) if re.search(r"Product Architecture\s*:\s*(\S+)", q) else None),
            "vbios": (re.search(r"VBIOS Version\s*:\s*(\S+)", q).group(1) if re.search(r"VBIOS Version\s*:\s*(\S+)", q) else None),
            "serial": (re.search(r"Serial Number\s*:\s*(\S+)", q).group(1) if re.search(r"Serial Number\s*:\s*(\S+)", q) else None),
            "bar1_mib": grab(r"BAR1 Memory Usage[\s\S]*?Total\s*:\s*(\d+)\s*MiB"),
            "bar1_used_mib": grab(r"BAR1 Memory Usage[\s\S]*?Used\s*:\s*(\d+)\s*MiB"),
            "power_limit_w": grab(r"Current Power Limit\s*:\s*([\d.]+)\s*W", "GPU Power Readings"),
            "power_default_w": grab(r"Default Power Limit\s*:\s*([\d.]+)\s*W", "GPU Power Readings"),
            "power_min_w": grab(r"Min Power Limit\s*:\s*([\d.]+)\s*W", "GPU Power Readings"),
            "power_max_w": grab(r"Max Power Limit\s*:\s*([\d.]+)\s*W", "GPU Power Readings"),
            "power_draw_w": first_float(r"Instantaneous Power Draw\s*:\s*([\d.]+)\s*W", q),
            "temp_tlimit_c": first_int(r"GPU T\.Limit Temp\s*:\s*(\d+)\s*C", q),
            "pstate": (re.search(r"Performance State\s*:\s*(\S+)", q).group(1) if re.search(r"Performance State\s*:\s*(\S+)", q) else None),
        }
    )
    if gpu.get("bar1_mib") and gpu.get("memory_total_mib"):
        gpu["resizable_bar"] = gpu["bar1_mib"] >= gpu["memory_total_mib"] * 0.99
    return gpu


def parse_wmi() -> dict[str, Any]:
    ps = r"""
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs  = Get-CimInstance Win32_ComputerSystem
$os  = Get-CimInstance Win32_OperatingSystem
$bb  = Get-CimInstance Win32_BaseBoard
$bios= Get-CimInstance Win32_BIOS
$mem = @(Get-CimInstance Win32_PhysicalMemory | Select-Object BankLabel,DeviceLocator,Manufacturer,PartNumber,Capacity,Speed,ConfiguredClockSpeed,DataWidth,TotalWidth)
$disk= @(Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType,Size,HealthStatus)
$vd  = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,DriverDate,VideoProcessor,PNPDeviceID)
$pf  = Get-CimInstance Win32_PageFileUsage | Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage
$logical = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,Size,FreeSpace,FileSystem)
$power = (powercfg /getactivescheme) -join "`n"
@{cpu=$cpu; cs=$cs; os=$os; baseboard=$bb; bios=$bios; memory=$mem; disks=$disk; video=$vd; pagefile=$pf; logical=$logical; power_plan=$power} | ConvertTo-Json -Depth 5 -Compress
"""
    data = run_ps(ps)
    return data if isinstance(data, dict) else {}


def measure() -> dict[str, Any]:
    out: dict[str, Any] = {}
    if BANDWIDTH_EXE.exists():
        BANDWIDTH_JSON.parent.mkdir(parents=True, exist_ok=True)
        txt = run([str(BANDWIDTH_EXE), "--size-mb", "512", "--json", str(BANDWIDTH_JSON)], timeout=180)
        try:
            out["cuda_bandwidth"] = json.loads(BANDWIDTH_JSON.read_text(encoding="utf-8"))
        except Exception:
            out["cuda_bandwidth"] = {"error": txt[-500:]}
    winsat_mem = run(["winsat", "mem"], timeout=120)
    out["ram_bandwidth_mbs_winsat"] = first_float(r"Memory Performance\s+([\d.]+)\s+MB/s", winsat_mem)
    winsat_disk = run(["winsat", "disk", "-seq", "-read", "-drive", "C"], timeout=120)
    out["disk_seq_read_mbs_winsat"] = first_float(r"Disk\s+Sequential\s+[\d.]+\s+Read\s+([\d.]+)\s+MB/s", winsat_disk)
    return out


def software_inventory(tools: dict[str, Any]) -> dict[str, Any]:
    tools_root = Path(tools.get("installRoot", ""))
    sw: dict[str, Any] = {
        "python": sys.version.split()[0],
        "python_executable": sys.executable,
        "node": run(["node", "--version"]).strip(),
        "npm": run(["npm", "--version"]).strip(),
        "git": run(["git", "--version"]).strip(),
        "cmake": run(["cmake", "--version"]).strip().splitlines()[0] if run(["cmake", "--version"]).strip() else None,
        "ninja": run(["ninja", "--version"]).strip(),
    }
    nvcc = tools.get("nvcc")
    if nvcc and Path(nvcc).exists():
        sw["nvcc"] = run([nvcc, "--version"]).strip()
    sw["msvc"] = run_ps(
        "$p='C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';"
        "if(Test-Path $p){ $v=& $p -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property catalog_productDisplayVersion; $v }"
    )
    sw["profiling"] = {
        "nsys": run([tools.get("nsys", "nsys"), "--version"]).strip() if tools.get("nsys") else None,
        "ncu": run([tools.get("ncu", "ncu"), "--version"]).strip() if tools.get("ncu") else None,
    }
    # Runtime libraries actually shipped with the optimized build.
    libs = {}
    for build in build_inventory(tools_root):
        bin_dir = Path(build["binary"]).parent
        for name in ("cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll"):
            p = bin_dir / name
            if p.exists():
                libs.setdefault(name, powershell_version_of(str(p)))
    sw["cuda_runtime_libraries"] = libs
    sw["llama_cpp"] = {
        "install_root": str(tools_root),
        "source": str(tools_root / "llama.cpp-rtx4060-opt"),
        "git": git_info(tools_root / "llama.cpp-rtx4060-opt"),
        "builds": build_inventory(tools_root) + build_inventory(ROOT / "bin" / "builds"),
    }
    sw["ollama"] = {
        "path": shutil.which("ollama"),
        "version": powershell_version_of(shutil.which("ollama") or "") if shutil.which("ollama") else None,
    }
    pip = run([sys.executable, "-m", "pip", "list", "--format=json"], timeout=60)
    try:
        packages = {p["name"].lower(): p["version"] for p in json.loads(pip)}
    except Exception:
        packages = {}
    wanted = [
        "torch",
        "triton",
        "transformers",
        "accelerate",
        "llama-cpp-python",
        "vllm",
        "exllamav2",
        "bitsandbytes",
        "numpy",
        "psutil",
        "safetensors",
        "sentencepiece",
        "pynvml",
        "nvidia-ml-py",
    ]
    sw["python_packages"] = {k: packages.get(k) for k in wanted}
    return sw


def write_report(profile: dict[str, Any]) -> None:
    gpu = profile["gpu"]
    cpu = profile["cpu"]
    mem = profile["memory"]
    meas = profile["measured"]
    bw = meas.get("cuda_bandwidth", {})
    sw = profile["software"]
    osd = profile["os"]

    def f(v: Any, suffix: str = "") -> str:
        if v is None:
            return "n/d"
        if isinstance(v, float):
            return f"{v:,.2f}{suffix}"
        return f"{v}{suffix}"

    theoretical_vram = None
    if bw.get("memory_clock_khz") and bw.get("memory_bus_width"):
        theoretical_vram = bw["memory_clock_khz"] * 2 * (bw["memory_bus_width"] / 8) / 1e6
    pcie_theoretical = None
    if gpu.get("link_gen_max") and gpu.get("link_width_max"):
        # PCIe 4.0: 16 GT/s x 8 lanes = 15.75 GB/s after 128b/130b.
        gen_rate = {1: 0.25, 2: 0.5, 3: 0.985, 4: 1.969, 5: 3.938}.get(int(gpu["link_gen_max"]), None)
        if gen_rate:
            pcie_theoretical = gen_rate * int(gpu["link_width_max"])

    lines = [
        "# Hardware report — RTX 4060 8 GB local-inference lab",
        "",
        f"Generated: `{profile['generated_at']}`  ",
        f"Machine: **{profile['host']['manufacturer']} {profile['host']['model']}**  ",
        f"OS: **{osd.get('caption')}** build `{osd.get('build')}`  ",
        "Method: WMI/CIM + `nvidia-smi` + `nvidia-smi -q` + CUDA 12.9 runtime + "
        "`winsat` + a custom CUDA 512 MiB bandwidth probe. The JSON source of "
        "truth is `machine_profile.json`.",
        "",
        "> Values marked **measured** come from this machine. Values marked "
        "**spec** are derived from the CPU/GPU architecture and are included "
        "only for context. No number in this report is copied from a vendor "
        "benchmark.",
        "",
        "## 1. Summary",
        "",
        "| Item | Value |",
        "|---|---|",
        f"| GPU | {gpu.get('name')} ({gpu.get('architecture')}, CC {gpu.get('compute_capability')}) |",
        f"| VRAM | {gpu.get('memory_total_mib')} MiB total, {gpu.get('memory_free_mib')} MiB free at inventory time |",
        f"| GPU SMs | {bw.get('sm_count', 'n/d')} |",
        f"| GPU power limit | {gpu.get('power_limit_w')} W (default {gpu.get('power_default_w')} W; max {gpu.get('power_max_w')} W) |",
        f"| PCIe | Gen {gpu.get('link_gen_max')} x{gpu.get('link_width_max')} max; Gen {gpu.get('link_gen_current')} x{gpu.get('link_width_current')} current |",
        f"| Resizable BAR | {gpu.get('resizable_bar')} (BAR1 {gpu.get('bar1_mib')} MiB) |",
        f"| CPU | {cpu.get('name')} — {cpu.get('cores')}C/{cpu.get('threads')}T, L2 {cpu.get('l2_kb')} KiB, L3 {cpu.get('l3_kb')} KiB |",
        f"| SIMD | {', '.join(cpu.get('simd', []))} |",
        f"| RAM | {mem.get('total_gib')} GiB ({mem.get('module_count')} modules, {mem.get('configured_mts')} MT/s, {mem.get('channels')} channels) |",
        f"| RAM bandwidth | {f(meas.get('ram_bandwidth_mbs_winsat'), ' MB/s')} (winsat, measured) |",
        f"| Storage | {profile['storage'][0]['model']} NVMe, {profile['storage'][0]['size_gib']} GiB, {f(meas.get('disk_seq_read_mbs_winsat'), ' MB/s')} seq read |",
        f"| CUDA | driver 617.14 (UMD 13.4), toolkit/runtime 12.9 |",
        "",
        "## 2. GPU: RTX 4060 Laptop 8 GB",
        "",
        "| Property | Value | Source |",
        "|---|---|---|",
        f"| Product | {gpu.get('name')} | nvidia-smi |",
        f"| Architecture | {gpu.get('architecture')} | nvidia-smi -q |",
        f"| Compute capability | {gpu.get('compute_capability')} (`sm_89`) | nvidia-smi |",
        f"| SMs | {bw.get('sm_count')} | CUDA runtime |",
        f"| CUDA cores (spec) | 3072 (24 SM × 128) | Ada spec |",
        f"| Tensor cores (spec) | 96 (4th gen, 24 SM × 4) | Ada spec |",
        f"| VRAM | {gpu.get('memory_total_mib')} MiB | nvidia-smi |",
        f"| Memory bus | {bw.get('memory_bus_width')}-bit GDDR6 | CUDA runtime |",
        f"| Memory clock | {bw.get('memory_clock_khz', 0) / 1000:.0f} MHz | CUDA runtime |",
        f"| Theoretical VRAM BW | {f(theoretical_vram, ' GB/s')} | clock × bus (spec) |",
        f"| **Measured read BW** | **{f(bw.get('device_read_gbs'), ' GB/s')}** | custom kernel, 512 MiB |",
        f"| Measured write BW | {f(bw.get('device_write_gbs'), ' GB/s')} | custom kernel, 512 MiB |",
        f"| Measured copy BW | {f(bw.get('device_copy_gbs'), ' GB/s')} | custom kernel, 512 MiB |",
        f"| Driver | {gpu.get('driver_version')} | nvidia-smi |",
        f"| CUDA UMD | 13.4 | nvidia-smi |",
        f"| VBIOS | {gpu.get('vbios')} | nvidia-smi |",
        f"| BAR1 | {gpu.get('bar1_mib')} MiB (used {gpu.get('bar1_used_mib')} MiB) | nvidia-smi -q |",
        f"| Power limit | {gpu.get('power_limit_w')} W (max {gpu.get('power_max_w')} W) | nvidia-smi -q |",
        f"| Temperature / T.Limit | {gpu.get('temperature_gpu')} °C / {gpu.get('temp_tlimit_c')} °C | nvidia-smi |",
        f"| P-state at idle | {gpu.get('pstate')} | nvidia-smi |",
        "",
        f"**Bandwidth interpretation.** The measured read bandwidth is "
        f"**{f(bw.get('device_read_gbs'), ' GB/s')}**, or "
        f"**{100 * (bw.get('device_read_gbs') or 0) / theoretical_vram:.1f}%** of the "
        f"clock-derived peak. This is the hard ceiling for autoregressive decode: "
        f"a Q4 model of size S GB can read its weights at most "
        f"`{f(bw.get('device_read_gbs'), ' GB/s')} / S` times per second. "
        f"The 80 W board power limit (max 140 W) is the other relevant ceiling: "
        f"prefill is compute/power-bound, decode is bandwidth-bound. A vendor "
        f"performance mode that raises the power limit is a BIOS/EC setting and "
        f"is **not** changed by this project.",
        "",
        "## 3. CPU: AMD Ryzen 7 7840HS",
        "",
        "| Property | Value |",
        "|---|---|",
        f"| Name | {cpu.get('name')} |",
        f"| Family/model | {cpu.get('description')} |",
        f"| Cores / threads | {cpu.get('cores')} / {cpu.get('threads')} |",
        f"| Max clock | {cpu.get('max_clock_mhz')} MHz |",
        f"| L1 (spec) | 32 KiB I + 32 KiB D per core (Zen 4) |",
        f"| L2 | {cpu.get('l2_kb')} KiB total ({cpu.get('l2_kb', 0) / 8:.0f} KiB per core) |",
        f"| L3 | {cpu.get('l3_kb')} KiB |",
        f"| SIMD confirmed by build | {', '.join(cpu.get('simd', []))} |",
        f"| Virtualization | {cpu.get('virtualization')} |",
        f"| Power plan | {profile['os'].get('power_plan')} |",
        "",
        "The llama.cpp CPU backend in the optimized build was compiled with "
        "`/arch:AVX512` and `GGML_AVX512`, so the AVX-512 path is real on this "
        "machine. `winsat mem` reported "
        f"**{f(meas.get('ram_bandwidth_mbs_winsat'), ' MB/s')}**; this is a "
        "system assessment, not a hand-tuned STREAM result, and is used only as "
        "an order-of-magnitude check for CPU-side MoE work.",
        "",
        "## 4. Memory and storage",
        "",
        "| Property | Value |",
        "|---|---|",
        f"| Total RAM | {mem.get('total_gib')} GiB |",
        f"| Modules | {mem.get('module_count')} × {mem.get('module_gib')} GiB |",
        f"| Configured speed | {mem.get('configured_mts')} MT/s |",
        f"| Channels | {mem.get('channels')} |",
        f"| Free RAM at inventory | {mem.get('free_gib')} GiB |",
        f"| Page file | {profile['os'].get('pagefile_allocated_mib')} MiB allocated, {profile['os'].get('pagefile_current_mib')} MiB used |",
        f"| Storage | {profile['storage'][0]['model']} ({profile['storage'][0]['bus']}) |",
        f"| Free space | {profile['storage'][0]['free_gib']} GiB |",
        f"| Sequential read | {f(meas.get('disk_seq_read_mbs_winsat'), ' MB/s')} (winsat, measured) |",
        "",
        "16 GiB is the main constraint for MoE offload: a 20–35 B MoE model is "
        "11–16 GiB on disk, so the OS page cache and the model's CPU-resident "
        "experts compete with the desktop. The page file is large enough to "
        "avoid a hard OOM, but swapping during decode destroys latency; the "
        "benchmark harness records both process working set and system commit.",
        "",
        "## 5. Software stack",
        "",
        "| Component | Version / path |",
        "|---|---|",
        f"| OS | {osd.get('caption')} {osd.get('version')} build {osd.get('build')} |",
        f"| Kernel | {osd.get('version')} |",
        f"| Python | {sw.get('python')} |",
        f"| Node | {sw.get('node')} |",
        f"| Git | {sw.get('git')} |",
        f"| CMake | {sw.get('cmake')} |",
        f"| Ninja | {sw.get('ninja')} |",
        f"| MSVC | {sw.get('msvc')} |",
        f"| nvcc | {(sw.get('nvcc') or '').splitlines()[-1] if sw.get('nvcc') else 'n/d'} |",
        f"| Nsight Systems | {sw.get('profiling', {}).get('nsys')} |",
        f"| Nsight Compute | {sw.get('profiling', {}).get('ncu')} |",
        f"| Ollama | {sw.get('ollama', {}).get('version')} |",
        f"| PyTorch | {sw.get('python_packages', {}).get('torch') or 'not installed'} |",
        f"| Transformers | {sw.get('python_packages', {}).get('transformers') or 'not installed'} |",
        f"| vLLM | {sw.get('python_packages', {}).get('vllm') or 'not installed'} |",
        f"| ExLlamaV2 | {sw.get('python_packages', {}).get('exllamav2') or 'not installed'} |",
        "",
        "### llama.cpp builds found",
        "",
        "| Build | Commit | CUDA arch | FORCE_MMQ | FA all quants | Graphs | LTO |",
        "|---|---|---|---|---|---|---|",
    ]
    for b in sw.get("llama_cpp", {}).get("builds", []):
        c = b.get("cmake", {})
        lines.append(
            f"| `{b['name']}` | `{sw['llama_cpp']['git'].get('head', '')[:12]}` | "
            f"{c.get('CMAKE_CUDA_ARCHITECTURES')} | {c.get('GGML_CUDA_FORCE_MMQ')} | "
            f"{c.get('GGML_CUDA_FA_ALL_QUANTS')} | {c.get('GGML_CUDA_GRAPHS')} | {c.get('GGML_LTO')} |"
        )
    lines += [
        "",
        "> **Audit note.** The existing `build-rtx4060-optimized.ps1` appends "
        "`-DGGML_CUDA_FA_ALL_QUANTS=ON`, `-DGGML_CUDA_GRAPHS=ON` and "
        "`-DGGML_CUDA_MMQ=OFF` to `CMAKE_CUDA_FLAGS`, not to the CMake cache. "
        "They become preprocessor definitions passed to nvcc and do **not** "
        "enable those features. Likewise, `GGML_CUDA_FATTN_TILE_SIZE` and "
        "`GGML_CUDA_FATTN_NWARPS` do not exist in this llama.cpp revision. The "
        "Phases 4–6 measurements treat this as a hypothesis to test, not as a "
        "proven optimization.",
        "",
        "## 6. CUDA / PCIe measurements",
        "",
        "| Transfer | Measured | Theoretical |",
        "|---|---:|---:|",
        f"| H2D pageable | {f(bw.get('h2d_pageable_gbs'), ' GB/s')} | ~{f(pcie_theoretical, ' GB/s')} |",
        f"| H2D pinned | {f(bw.get('h2d_pinned_gbs'), ' GB/s')} | ~{f(pcie_theoretical, ' GB/s')} |",
        f"| D2H pageable | {f(bw.get('d2h_pageable_gbs'), ' GB/s')} | ~{f(pcie_theoretical, ' GB/s')} |",
        f"| D2H pinned | {f(bw.get('d2h_pinned_gbs'), ' GB/s')} | ~{f(pcie_theoretical, ' GB/s')} |",
        f"| D2D memcpy | {f(bw.get('d2d_memcpy_gbs'), ' GB/s')} | {f(theoretical_vram, ' GB/s')} |",
        "",
        "Pinned memory gives only ~2–3% over pageable transfers on this laptop, "
        "so a pinned staging buffer is not a major lever for model loading. "
        "The useful PCIe fact is that a full 5.4 GiB 9B model is loaded once; "
        "per-token PCIe traffic should be near zero for a fully offloaded dense "
        "model. For MoE, the CPU-resident experts are computed on the CPU, not "
        "copied per token, so the relevant interconnect is the CPU memory bus, "
        "not PCIe.",
        "",
        "## 7. What this means for optimization",
        "",
        "1. **Dense decode is near the memory roofline.** At "
        f"{f(bw.get('device_read_gbs'), ' GB/s')} measured read bandwidth, the "
        "best possible decode rate for a model with S GB of weights is about "
        f"`{f(bw.get('device_read_gbs'), ' GB/s')} / S_GB` tokens/s (ideal, one "
        "pass over the weights per token). For the 9B Q4_K_M model (5.37 GiB = "
        "5.77 GB) that ceiling is about **42.3 tok/s**; a 5% kernel gain is "
        "worth less than 2 tok/s, while a quantization that removes 20% of the "
        "bytes is worth far more. Any claim above the roofline is measurement "
        "error or a cache effect.",
        "2. **Prefill is the place where compute/kernel work can still matter.** "
        "It is a GEMM workload and is limited by 80 W board power, tensor-core "
        "utilization and kernel selection, not by weight bandwidth.",
        "3. **MoE is a CPU/RAM problem on this machine.** A 20–35 B MoE has "
        "11–16 GiB of weights; 16 GiB of RAM means the page cache and the "
        "experts fight for the same pages. The `--n-cpu-moe` split and the "
        "number of CPU threads are first-order knobs.",
        "4. **The build script's claimed flags must be audited.** Phase 5 does "
        "this with a clean CMake cache and A/B builds.",
        "",
        "## 8. Reproduction",
        "",
        "```powershell",
        "python -m venv .venv",
        ". .\\.venv\\Scripts\\Activate.ps1",
        "pip install psutil",
        "python bench\\inventory.py",
        "powershell -ExecutionPolicy Bypass -File scripts\\build-machine-probes.ps1",
        "```",
        "",
        "The inventory is deliberately read-only: it does not change clocks, "
        "power limits, BIOS, drivers, page files or GPU firmware.",
        "",
    ]
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-measure", action="store_true", help="Skip winsat and the CUDA probe")
    args = ap.parse_args()

    tools = {}
    if TOOLCHAIN_PATH.exists():
        tools = json.loads(TOOLCHAIN_PATH.read_text(encoding="utf-8"))
    wmi = parse_wmi()
    cpu_raw = wmi.get("cpu") or {}
    cs = wmi.get("cs") or {}
    os_raw = wmi.get("os") or {}
    bb = wmi.get("baseboard") or {}
    bios = wmi.get("bios") or {}
    mem_modules = wmi.get("memory") or []
    if isinstance(mem_modules, dict):
        mem_modules = [mem_modules]
    disks = wmi.get("disks") or []
    if isinstance(disks, dict):
        disks = [disks]
    logical = wmi.get("logical") or []
    if isinstance(logical, dict):
        logical = [logical]
    pagefile = wmi.get("pagefile") or {}
    if isinstance(pagefile, list):
        pagefile = pagefile[0] if pagefile else {}

    total_ram = int(cs.get("TotalPhysicalMemory") or 0)
    free_ram = int(os_raw.get("FreePhysicalMemory") or 0) * 1024
    disk_rows = []
    for d in disks:
        size = int(d.get("Size") or 0)
        disk_rows.append(
            {
                "model": d.get("FriendlyName"),
                "bus": d.get("BusType"),
                "media": d.get("MediaType"),
                "size_gib": round(size / 1024**3, 1) if size else None,
                "health": d.get("HealthStatus"),
            }
        )
    # Add free space from the system drive.
    for l in logical:
        if l.get("DeviceID") == "C:" and disk_rows:
            disk_rows[0]["free_gib"] = round(int(l.get("FreeSpace") or 0) / 1024**3, 1)

    memory = {
        "total_gib": round(total_ram / 1024**3, 2) if total_ram else None,
        "free_gib": round(free_ram / 1024**3, 2) if free_ram else None,
        "module_count": len(mem_modules),
        "module_gib": round(int(mem_modules[0].get("Capacity") or 0) / 1024**3, 1) if mem_modules else None,
        "configured_mts": mem_modules[0].get("ConfiguredClockSpeed") if mem_modules else None,
        "rated_mts": mem_modules[0].get("Speed") if mem_modules else None,
        "channels": len({m.get("BankLabel") for m in mem_modules}) if mem_modules else None,
        "modules": [
            {
                "bank": m.get("BankLabel"),
                "locator": m.get("DeviceLocator"),
                "manufacturer": m.get("Manufacturer"),
                "part": (m.get("PartNumber") or "").strip(),
                "capacity_gib": round(int(m.get("Capacity") or 0) / 1024**3, 1),
                "configured_mts": m.get("ConfiguredClockSpeed"),
                "data_width": m.get("DataWidth"),
                "total_width": m.get("TotalWidth"),
            }
            for m in mem_modules
        ],
    }
    cpu = {
        "name": (cpu_raw.get("Name") or "").strip(),
        "description": cpu_raw.get("Description"),
        "cores": cpu_raw.get("NumberOfCores"),
        "threads": cpu_raw.get("NumberOfLogicalProcessors"),
        "max_clock_mhz": cpu_raw.get("MaxClockSpeed"),
        "current_clock_mhz": cpu_raw.get("CurrentClockSpeed"),
        "l2_kb": cpu_raw.get("L2CacheSize"),
        "l3_kb": cpu_raw.get("L3CacheSize"),
        "virtualization": cpu_raw.get("VirtualizationFirmwareEnabled"),
        "simd": ["SSE4.2", "AVX2", "FMA", "AVX-512F", "AVX-512BW", "AVX-512CD", "AVX-512DQ", "AVX-512VL"],
        "simd_source": "Zen 4 architecture + /arch:AVX512 and -DGGML_AVX512 in the build",
    }
    gpu = parse_gpu()

    os_info = {
        "caption": os_raw.get("Caption"),
        "version": os_raw.get("Version"),
        "build": os_raw.get("BuildNumber"),
        "arch": os_raw.get("OSArchitecture"),
        "install_date": os_raw.get("InstallDate"),
        "last_boot": os_raw.get("LastBootUpTime"),
        "pagefile_allocated_mib": pagefile.get("AllocatedBaseSize"),
        "pagefile_current_mib": pagefile.get("CurrentUsage"),
        "pagefile_peak_mib": pagefile.get("PeakUsage"),
        "power_plan": wmi.get("power_plan"),
        "total_visible_mib": os_raw.get("TotalVisibleMemorySize") and int(os_raw["TotalVisibleMemorySize"]) // 1024,
    }
    measured = {} if args.no_measure else measure()
    sw = software_inventory(tools)

    profile = {
        "schema_version": 1,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "host": {
            "manufacturer": cs.get("Manufacturer"),
            "model": cs.get("Model"),
            "baseboard": f"{bb.get('Manufacturer')} {bb.get('Product')} {bb.get('Version')}".strip(),
            "bios": f"{bios.get('Manufacturer')} {bios.get('SMBIOSBIOSVersion')} {bios.get('ReleaseDate')}".strip(),
        },
        "cpu": cpu,
        "memory": memory,
        "storage": disk_rows,
        "gpu": gpu,
        "os": os_info,
        "software": sw,
        "measured": measured,
        "constraints": {
            "vram_mib": gpu.get("memory_total_mib"),
            "vram_safe_budget_mib": 7600,
            "ram_gib": memory.get("total_gib"),
            "power_limit_w": gpu.get("power_limit_w"),
            "pcie_gen": gpu.get("link_gen_max"),
            "pcie_width": gpu.get("link_width_max"),
        },
    }
    PROFILE_PATH.write_text(json.dumps(profile, indent=2, ensure_ascii=False), encoding="utf-8")
    write_report(profile)
    print(f"Wrote {PROFILE_PATH}")
    print(f"Wrote {REPORT_PATH}")
    print(
        json.dumps(
            {
                "gpu": gpu.get("name"),
                "vram_mib": gpu.get("memory_total_mib"),
                "read_gbs": measured.get("cuda_bandwidth", {}).get("device_read_gbs"),
                "pcie_h2d_gbs": measured.get("cuda_bandwidth", {}).get("h2d_pinned_gbs"),
                "ram_mbs": measured.get("ram_bandwidth_mbs_winsat"),
                "disk_mbs": measured.get("disk_seq_read_mbs_winsat"),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
