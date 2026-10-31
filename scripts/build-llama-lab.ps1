<#
.SYNOPSIS
    Build a reproducible llama.cpp variant for the RTX 4060 lab.

.DESCRIPTION
    Uses the local fork under forks/llama.cpp-4060 (a worktree of the pinned
    v0.8.0 source). All options are passed as real CMake cache variables; the
    old scripts accidentally appended several -D flags to CMAKE_CUDA_FLAGS.
    Only llama-bench is built by default, to keep A/B iterations short.

.NOTES
    powershell -ExecutionPolicy Bypass -File scripts/build-llama-lab.ps1 -Variant lab-base
#>

param(
    [string]$Variant = "lab-base",
    [string]$Source = "",
    [switch]$Server,
    [switch]$Tests,
    [switch]$ForceMMQ,
    [switch]$ForceCublas,
    [switch]$NoGraphs,
    [switch]$LTO,
    [ValidateSet("size", "speed", "balance", "none")][string]$Compression = "size",
    [string]$ExtraCudaFlags = "",
    [switch]$Clean,
    [int]$Jobs = 8
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Get-Content -LiteralPath (Join-Path $Root 'config\inference-toolchain.local.json') -Raw | ConvertFrom-Json
if (-not $Source) { $Source = Join-Path $Root 'forks\llama.cpp-4060' }
if (-not (Test-Path -LiteralPath (Join-Path $Source 'CMakeLists.txt'))) { throw "Missing llama.cpp source at $Source" }
$Build = Join-Path $Root ("bin\builds\" + $Variant)
if ($Clean -and (Test-Path -LiteralPath $Build)) { Remove-Item -Recurse -Force -LiteralPath $Build }
New-Item -ItemType Directory -Force -Path $Build | Out-Null

$CudaFlags = "-lineinfo"
if ($ExtraCudaFlags) { $CudaFlags = "$CudaFlags $ExtraCudaFlags" }

$Config = @(
    '-S', $Source, '-B', $Build, '-G', 'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    "-DCMAKE_MAKE_PROGRAM=$($Tools.ninja)",
    "-DCUDAToolkit_ROOT=$($Tools.cudaRoot)",
    '-DCMAKE_CUDA_ARCHITECTURES=89-real',
    "-DCMAKE_CUDA_FLAGS=$CudaFlags",
    '-DGGML_CUDA=ON',
    '-DGGML_NATIVE=ON',
    '-DGGML_BACKEND_DL=OFF',
    '-DGGML_CPU_ALL_VARIANTS=OFF',
    '-DGGML_CUDA_NCCL=OFF',
    "-DGGML_CUDA_GRAPHS=$(if($NoGraphs){'OFF'}else{'ON'})",
    "-DGGML_CUDA_FORCE_MMQ=$(if($ForceMMQ){'ON'}else{'OFF'})",
    "-DGGML_CUDA_FORCE_CUBLAS=$(if($ForceCublas){'ON'}else{'OFF'})",
    '-DGGML_CUDA_FA_ALL_QUANTS=OFF',
    "-DGGML_CUDA_COMPRESSION_MODE=$Compression",
    "-DGGML_LTO=$(if($LTO){'ON'}else{'OFF'})",
    "-DLLAMA_BUILD_TESTS=$(if($Tests){'ON'}else{'OFF'})",
    '-DLLAMA_BUILD_EXAMPLES=OFF',
    "-DLLAMA_BUILD_SERVER=$(if($Server){'ON'}else{'OFF'})",
    '-DLLAMA_BUILD_UI=OFF',
    '-DLLAMA_BUILD_APP=OFF',
    '-DLLAMA_OPENSSL=OFF'
)

$VcVars = $Tools.vcvars
$Cmake = $Tools.cmake
$Cmd = "call `"$VcVars`" >nul && `"$Cmake`" " + (($Config | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' ')
Write-Host "Configure $Variant" -ForegroundColor Cyan
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $Out = & cmd.exe /d /c $Cmd 2>&1
    $configureExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $prev
}
$Out | Set-Content -LiteralPath (Join-Path $Build 'configure.log') -Encoding UTF8
if ($configureExit -ne 0) { Get-Content (Join-Path $Build 'configure.log') -Tail 60; throw "cmake configure failed" }

$Target = if ($Server -and $Tests) { 'llama-server llama-bench test-backend-ops' } elseif ($Server) { 'llama-server llama-bench' } elseif ($Tests) { 'llama-bench test-backend-ops' } else { 'llama-bench' }
$BuildCmd = "call `"$VcVars`" >nul && `"$Cmake`" --build `"$Build`" --target $Target --parallel $Jobs"
Write-Host "Build $Variant ($Target)" -ForegroundColor Cyan
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $Out = & cmd.exe /d /c $BuildCmd 2>&1
    $buildExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $prev
}
$Out | Set-Content -LiteralPath (Join-Path $Build 'build.log') -Encoding UTF8
if ($buildExit -ne 0) { Get-Content (Join-Path $Build 'build.log') -Tail 80; throw "build failed" }

$Bin = Join-Path $Build 'bin'
foreach ($Dll in @('cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll')) {
    $src = Join-Path $Tools.cudaRoot "bin\$Dll"
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $Bin $Dll) -Force }
}

$Receipt = [ordered]@{
    variant = $Variant
    source = $Source
    sourceHead = (& git -C $Source rev-parse HEAD).Trim()
    sourceDirty = @(& git -C $Source status --porcelain).Count
    build = $Build
    binary = (Join-Path $Bin 'llama-bench.exe')
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    flags = $Config
    sha256 = (Get-FileHash -LiteralPath (Join-Path $Bin 'llama-bench.exe') -Algorithm SHA256).Hash.ToLower()
}
$ReportDir = Join-Path $Root 'reports\builds'
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$Receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $ReportDir ($Variant + '.json')) -Encoding UTF8
Write-Host "OK: $($Receipt.binary)" -ForegroundColor Green
