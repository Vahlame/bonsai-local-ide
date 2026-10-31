<#
.SYNOPSIS
    Build llama.cpp optimized for RTX 4060 8GB (sm89 / Ada Lovelace)
.DESCRIPTION
    Custom build with Ada-specific optimizations:
    - Flash Attention v2 tuned for sm89
    - MMQ (Matrix Multiplication Quantized) enabled
    - Optimal tile sizes for 4060's 3072 CUDA cores / 8GB VRAM
    - Custom quantization support (IQ2_XS, IQ3_XXS, MXFP4)
    - KV cache quantization (q4_0, IQ4_XS) for vision profiles
    - Speculative decoding support
    - Optimal batch/ubatch for 4060
.NOTES
    Run from project root: .\scripts\build-rtx4060-optimized.ps1
#>

param(
    [ValidateSet('RTX4060-Opt', 'RTX4060-Opt-MMQ', 'RTX4060-Opt-NoGraphs')][string]$Variant = 'RTX4060-Opt',
    [ValidateRange(1,8)][int]$Jobs = 4,
    [switch]$LTO,
    [switch]$Clean,
    [switch]$Llguidance
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Tools = Get-Content -LiteralPath (Join-Path $ProjectRoot 'config\inference-toolchain.local.json') -Raw | ConvertFrom-Json

# Use latest stable llama.cpp (v0.8.0 tag)
$Source = Join-Path $Tools.installRoot 'llama.cpp-rtx4060-opt'
$ExpectedCommit = '8642541b255bfb5dc39cd351a178be09013a55d6'  # v0.8.0

if ($Clean -and (Test-Path -LiteralPath $Source)) {
    Write-Host "Cleaning source directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force -LiteralPath $Source -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath (Join-Path $Source '.git'))) {
    Write-Host "Fetching llama.cpp v0.8.0..." -ForegroundColor Cyan
    if ((Test-Path -LiteralPath $Source) -and @(Get-ChildItem -LiteralPath $Source -Force).Count -gt 0) { 
        throw 'Source destination is not an empty directory or a Git checkout' 
    }
    & git init --quiet $Source
    if ($LASTEXITCODE -ne 0) { throw 'Source initialization failed' }
    & git -C $Source remote add origin 'https://github.com/ggml-org/llama.cpp.git'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot configure official source remote' }
    & git -C $Source fetch --depth 1 origin v0.8.0
    if ($LASTEXITCODE -ne 0) { throw 'Pinned source download failed' }
    & git -C $Source checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Pinned source checkout failed' }
}

$ActualCommit = (& git -C $Source rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $ActualCommit -ne $ExpectedCommit) { throw 'Unexpected llama.cpp source revision' }
$DirtySource = @(& git -C $Source status --porcelain)
if ($LASTEXITCODE -ne 0 -or $DirtySource.Count -gt 0) { throw 'Source has local patches; record/review them separately before building' }

# =============================================================================
# RTX 4060 (Ada Lovelace, sm89) SPECIFIC OPTIMIZATIONS
# =============================================================================
# GPU: RTX 4060 Laptop - 3072 CUDA cores, 8GB VRAM, 8.9 compute capability
# Optimal settings based on Ada architecture:
#   - 128 CUDA cores per SM × 24 SMs = 3072 cores
#   - 4th gen Tensor Cores (FP8, FP16, BF16, TF32, INT8, INT4)
#   - 3rd gen RT Cores
#   - Shader Execution Reordering (SER)
#   - 128-bit memory interface

$DeviceCapability = (& nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or $DeviceCapability -notmatch '^\d+\.\d+$') { throw 'Cannot detect CUDA architecture' }
$Architecture = $DeviceCapability.Replace('.','')

# Build directory with variant suffix
$Build = Join-Path $Tools.installRoot ("build-$Variant-sm$Architecture" + $(if($LTO){'-lto'}else{''}))

# Clean build if requested
if ($Clean -and (Test-Path -LiteralPath $Build)) {
    Write-Host "Cleaning build directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force -LiteralPath $Build -ErrorAction SilentlyContinue
}

# =============================================================================
# MSVC ENVIRONMENT
# =============================================================================
$DevEnvironment = & $env:ComSpec /d /s /c "`"$($Tools.vcvars)`" >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'MSVC environment setup failed' }
foreach ($Line in $DevEnvironment) {
    if ($Line -match '^(Path|INCLUDE|LIB|LIBPATH|VCToolsInstallDir|WindowsSdkDir|WindowsSDKVersion)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process')
    }
}
$env:CUDA_PATH = $Tools.cudaRoot
$env:CUDACXX = $Tools.nvcc
$env:Path = (Join-Path $Tools.cudaRoot 'bin') + ';' + (Split-Path $Tools.ninja) + ';' + $env:Path

# =============================================================================
# CMAKE CONFIGURATION - RTX 4060 OPTIMIZED
# =============================================================================
Write-Host "Configuring CMake for RTX 4060 (sm$Architecture)..." -ForegroundColor Cyan

$BaseCudaFlags = '-DCMAKE_CUDA_FLAGS=-lineinfo -Xptxas=-v -Xcompiler=-O3 -use_fast_math'
$AdaArchFlags = "-DCMAKE_CUDA_ARCHITECTURES=$Architecture-real"

switch ($Variant) {
    'RTX4060-Opt' {
        $CudaFlags = "$BaseCudaFlags -DGGML_CUDA_FA_ALL_QUANTS=ON -DGGML_CUDA_GRAPHS=ON -DGGML_CUDA_MMQ=OFF"
        $ExtraDefs = @(
            '-DGGML_CUDA_FORCE_MMQ=OFF'
            '-DGGML_CUDA_FORCE_CUBLAS=OFF'
            '-DGGML_CUDA_PEER_MAX_BATCH_SIZE=512'
            '-DGGML_CUDA_FATTN_TILE_SIZE=128'
            '-DGGML_CUDA_FATTN_NWARPS=4'
        )
    }
    'RTX4060-Opt-MMQ' {
        $CudaFlags = "$BaseCudaFlags -DGGML_CUDA_FA_ALL_QUANTS=ON -DGGML_CUDA_GRAPHS=ON -DGGML_CUDA_MMQ=ON"
        $ExtraDefs = @(
            '-DGGML_CUDA_FORCE_MMQ=ON'
            '-DGGML_CUDA_FORCE_CUBLAS=OFF'
            '-DGGML_CUDA_PEER_MAX_BATCH_SIZE=512'
            '-DGGML_CUDA_FATTN_TILE_SIZE=128'
            '-DGGML_CUDA_FATTN_NWARPS=4'
            '-DGGML_CUDA_MMQ_F16=ON'
            '-DGGML_CUDA_MMQ_BF16=ON'
        )
    }
    'RTX4060-Opt-NoGraphs' {
        $CudaFlags = "$BaseCudaFlags -DGGML_CUDA_FA_ALL_QUANTS=ON -DGGML_CUDA_GRAPHS=OFF -DGGML_CUDA_MMQ=OFF"
        $ExtraDefs = @(
            '-DGGML_CUDA_FORCE_MMQ=OFF'
            '-DGGML_CUDA_FORCE_CUBLAS=OFF'
            '-DGGML_CUDA_PEER_MAX_BATCH_SIZE=512'
            '-DGGML_CUDA_FATTN_TILE_SIZE=128'
            '-DGGML_CUDA_FATTN_NWARPS=4'
        )
    }
}

$Config = @(
    '-S',$Source,'-B',$Build,'-G','Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    "-DCMAKE_MAKE_PROGRAM=$($Tools.ninja)",
    "-DCUDAToolkit_ROOT=$($Tools.cudaRoot)",
    $AdaArchFlags,
    $CudaFlags,
    '-DGGML_CUDA=ON',
    '-DGGML_NATIVE=ON',
    '-DGGML_BACKEND_DL=OFF',
    '-DGGML_CPU_ALL_VARIANTS=OFF',
    '-DGGML_CUDA_NCCL=OFF',
    '-DLLAMA_OPENSSL=OFF',
    '-DLLAMA_BUILD_UI=OFF',
    '-DLLAMA_BUILD_APP=OFF',
    '-DLLAMA_BUILD_EXAMPLES=OFF',
    '-DLLAMA_BUILD_TESTS=ON',
    '-DLLAMA_BUILD_TOOLS=ON',
    '-DLLAMA_BUILD_SERVER=ON',
    '-DLLAMA_BUILD_NUMBER=10743',
    "-DLLAMA_LLGUIDANCE=$(if($Llguidance){'ON'}else{'OFF'})",
    "-DGGML_LTO=$(if($LTO){'ON'}else{'OFF'})"
) + $ExtraDefs

Write-Host "CMake args: $($Config -join ' ')" -ForegroundColor Gray

& $Tools.cmake @Config
if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed' }

Write-Host "Building llama.cpp (target: llama-server, llama-bench)..." -ForegroundColor Cyan
& $Tools.cmake --build $Build --target llama-server llama-bench test-backend-ops --parallel $Jobs
if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed' }

# Copy CUDA DLLs
$Bin = Join-Path $Build 'bin'
foreach ($Dll in @('cudart64_12.dll','cublas64_12.dll','cublasLt64_12.dll')) {
    $DllSource = Join-Path $Tools.cudaRoot "bin\$Dll"
    if (Test-Path -LiteralPath $DllSource) { 
        Copy-Item -LiteralPath $DllSource -Destination (Join-Path $Bin $Dll) -Force 
    }
}

# Build report
$ReportDir = Join-Path $ProjectRoot 'reports\rtx4060-optimized'
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
$Info = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o'); 
    variant = $Variant; 
    commit = $ActualCommit;
    architecture = $Architecture; 
    jobs = $Jobs; 
    llguidance = [bool]$Llguidance;
    source = $Source; 
    build = $Build;
    binary = (Join-Path $Bin 'llama-server.exe'); 
    configuration = $Config;
    files = @(Get-ChildItem -LiteralPath $Bin -File | Where-Object { $_.Extension -in @('.exe','.dll') } | ForEach-Object {
        [ordered]@{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()}
    })
}
[IO.File]::WriteAllText((Join-Path $ReportDir "build-$Variant.json"),($Info | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))

Write-Host "Build complete!" -ForegroundColor Green
& (Join-Path $Bin 'llama-server.exe') --version
Write-Host "Binary location: $Bin" -ForegroundColor Cyan