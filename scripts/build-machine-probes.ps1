<#
.SYNOPSIS
    Build the machine-specific CUDA probes (bandwidth, cache, later kernels).

.DESCRIPTION
    Uses the CUDA toolkit + MSVC Build Tools already installed on this machine.
    The output stays under bin/probes/ (git-ignored) and the exact command line
    is written next to the binary for reproducibility.

.NOTES
    Run from the repository root:
        powershell -ExecutionPolicy Bypass -File scripts/build-machine-probes.ps1
#>

param(
    [string]$CudaRoot = "",
    [string]$Architecture = "sm_89",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ToolsPath = Join-Path $Root 'config\inference-toolchain.local.json'
if (-not (Test-Path -LiteralPath $ToolsPath)) { throw "Missing $ToolsPath. Run scripts/install-inference-tools.mjs first." }
$Tools = Get-Content -LiteralPath $ToolsPath -Raw | ConvertFrom-Json
if (-not $CudaRoot) { $CudaRoot = $Tools.cudaRoot }
$Nvcc = Join-Path $CudaRoot 'bin\nvcc.exe'
if (-not (Test-Path -LiteralPath $Nvcc)) { throw "nvcc not found at $Nvcc" }
$VcVars = $Tools.vcvars
if (-not (Test-Path -LiteralPath $VcVars)) { throw "vcvars64.bat not found at $VcVars" }

$OutDir = Join-Path $Root 'bin\probes'
if ($Clean -and (Test-Path -LiteralPath $OutDir)) { Remove-Item -Recurse -Force -LiteralPath $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Source = Join-Path $Root 'kernels\bandwidth\bandwidth.cu'
$Binary = Join-Path $OutDir 'bandwidth.exe'
$Log = Join-Path $OutDir 'build-bandwidth.log'
$Cmd = "`"$VcVars`" >nul && `"$Nvcc`" -O3 -lineinfo -arch=$Architecture -o `"$Binary`" `"$Source`""

Write-Host "Building $Source -> $Binary" -ForegroundColor Cyan
$Output = & $env:ComSpec /d /s /c $Cmd 2>&1
$Output | Set-Content -LiteralPath $Log -Encoding UTF8
if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath $Log -Tail 60
    throw "CUDA probe build failed"
}

# Record exactly what produced the binary.
@(
    "source=$Source"
    "binary=$Binary"
    "nvcc=$Nvcc"
    "arch=$Architecture"
    "command=$Cmd"
    "builtAt=$((Get-Date).ToUniversalTime().ToString('o'))"
    "sha256=$((Get-FileHash -LiteralPath $Binary -Algorithm SHA256).Hash.ToLower())"
) | Set-Content -LiteralPath (Join-Path $OutDir 'bandwidth.build.txt') -Encoding UTF8

Write-Host "OK: $Binary" -ForegroundColor Green
