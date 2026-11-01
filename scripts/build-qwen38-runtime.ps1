<#
.SYNOPSIS
    Construye un runtime llama.cpp con soporte para Qwen3.8 (qwen3_5 + DeltaNet + MTP).

.DESCRIPTION
    El build histórico del proyecto está fijado a v0.8.0 (commit 8642541, build
    10743). Los GGUF de Qwen3.8 se generaron con b10896 y necesitan una versión
    posterior: DeltaNet en CUDA se corrigió a partir de b10450 y el muestreo MTP
    (`--spec-type draft-mtp`) vive en master.

    Este script compila una copia limpia de llama.cpp master en un directorio
    aparte, con CUDA para sm_89. No toca el build optimizado existente ni el
    binario de `bin/`, así que se puede volver atrás borrando el build nuevo.

.NOTES
    Requiere la toolchain registrada en config/inference-toolchain.local.json
    (nvcc, MSVC, ninja y cmake). Salida:
    .local/opt/bonsai-inference/build-Qwen38-sm89/bin/llama-server.exe
#>
param(
    [string]$Source = "",
    [string]$Build = "",
    [ValidateRange(1, 8)][int]$Jobs = 8,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Tools = Get-Content -LiteralPath (Join-Path $ProjectRoot 'config\inference-toolchain.local.json') -Raw | ConvertFrom-Json

if (-not $Source) { $Source = Join-Path $Tools.installRoot 'llama.cpp-qwen38' }
if (-not (Test-Path -LiteralPath (Join-Path $Source '.git'))) {
    throw "Falta el checkout de llama.cpp master en $Source"
}

$Capability = (& nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or $Capability -notmatch '^\d+\.\d+$') { throw 'No se pudo detectar la arquitectura CUDA' }
$Architecture = $Capability.Replace('.', '')
if (-not $Build) { $Build = Join-Path $Tools.installRoot "build-Qwen38-sm$Architecture" }

if ($Clean -and (Test-Path -LiteralPath $Build)) {
    Remove-Item -Recurse -Force -LiteralPath $Build
}

$Commit = (& git -C $Source rev-parse --short HEAD).Trim()
Write-Host "llama.cpp master @ $Commit -> $Build" -ForegroundColor Cyan

# Entorno MSVC
$DevEnvironment = & $env:ComSpec /d /s /c "`"$($Tools.vcvars)`" >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar MSVC' }
foreach ($Line in $DevEnvironment) {
    if ($Line -match '^(Path|INCLUDE|LIB|LIBPATH|VCToolsInstallDir|WindowsSdkDir|WindowsSDKVersion)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
$env:CUDA_PATH = $Tools.cudaRoot
$env:CUDACXX = $Tools.nvcc
$env:Path = (Join-Path $Tools.cudaRoot 'bin') + ';' + (Split-Path $Tools.ninja) + ';' + $env:Path

$Config = @(
    '-S', $Source, '-B', $Build, '-G', 'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    "-DCMAKE_MAKE_PROGRAM=$($Tools.ninja)",
    "-DCUDAToolkit_ROOT=$($Tools.cudaRoot)",
    "-DCMAKE_CUDA_ARCHITECTURES=$Architecture-real",
    '-DCMAKE_CUDA_FLAGS=-Xcompiler=-O3 -use_fast_math',
    '-DGGML_CUDA=ON',
    '-DGGML_CUDA_FA_ALL_QUANTS=ON',
    '-DGGML_CUDA_GRAPHS=ON',
    '-DGGML_NATIVE=ON',
    '-DGGML_BACKEND_DL=OFF',
    '-DGGML_CPU_ALL_VARIANTS=OFF',
    '-DGGML_CUDA_NCCL=OFF',
    '-DLLAMA_OPENSSL=OFF',
    '-DLLAMA_BUILD_UI=OFF',
    '-DLLAMA_BUILD_APP=OFF',
    '-DLLAMA_BUILD_EXAMPLES=OFF',
    '-DLLAMA_BUILD_TESTS=OFF',
    '-DLLAMA_BUILD_TOOLS=ON',
    '-DLLAMA_BUILD_SERVER=ON',
    '-DGGML_LTO=OFF'
)

& $Tools.cmake @Config
if ($LASTEXITCODE -ne 0) { throw 'Falló la configuración de CMake' }

& $Tools.cmake --build $Build --target llama-server llama-bench llama-cli --parallel $Jobs
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación' }

$Bin = Join-Path $Build 'bin'
foreach ($Dll in @('cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll')) {
    $From = Join-Path $Tools.cudaRoot "bin\$Dll"
    if (Test-Path -LiteralPath $From) { Copy-Item -LiteralPath $From -Destination (Join-Path $Bin $Dll) -Force }
}

& (Join-Path $Bin 'llama-server.exe') --version
Write-Host "Listo: $Bin" -ForegroundColor Green
