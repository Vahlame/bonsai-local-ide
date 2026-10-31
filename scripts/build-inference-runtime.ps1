param(
    [ValidateSet('Auto','MMQ','CUBLAS','NoGraphs')][string]$Variant = 'Auto',
    [ValidateRange(1,8)][int]$Jobs = 2,
    [switch]$LTO,
    [switch]$Llguidance
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Tools = Get-Content -LiteralPath (Join-Path $ProjectRoot 'config\inference-toolchain.local.json') -Raw | ConvertFrom-Json
$Source = Join-Path $Tools.installRoot 'llama.cpp-adfffbe41'
$ExpectedCommit = 'adfffbe41b2cabcd51fff326ab045662265062bb'
if (-not (Test-Path -LiteralPath (Join-Path $Source '.git'))) {
    if ((Test-Path -LiteralPath $Source) -and @(Get-ChildItem -LiteralPath $Source -Force).Count -gt 0) { throw 'Source destination is not an empty directory or a Git checkout' }
    & git init --quiet $Source
    if ($LASTEXITCODE -ne 0) { throw 'Source initialization failed' }
    & git -C $Source remote add origin 'https://github.com/ggml-org/llama.cpp.git'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot configure official source remote' }
    & git -C $Source fetch --depth 1 origin $ExpectedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Pinned source download failed' }
    & git -C $Source checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Pinned source checkout failed' }
}
$ActualCommit = (& git -C $Source rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $ActualCommit -ne $ExpectedCommit) { throw 'Unexpected llama.cpp source revision' }
$DirtySource = @(& git -C $Source status --porcelain)
if ($LASTEXITCODE -ne 0 -or $DirtySource.Count -gt 0) { throw 'Source has local patches; record/review them separately before building' }
$DeviceCapability = (& nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or $DeviceCapability -notmatch '^\d+\.\d+$') { throw 'Cannot detect CUDA architecture' }
$Architecture = $DeviceCapability.Replace('.','')
$Build = Join-Path $Tools.installRoot ("build-$Variant-sm$Architecture" + $(if($LTO){'-lto'}else{''}))

# Import the existing MSVC developer environment without printing environment variables.
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
$Config = @('-S',$Source,'-B',$Build,'-G','Ninja',
    '-DCMAKE_BUILD_TYPE=Release',"-DCMAKE_MAKE_PROGRAM=$($Tools.ninja)",
    "-DCUDAToolkit_ROOT=$($Tools.cudaRoot)","-DCMAKE_CUDA_ARCHITECTURES=$Architecture-real",
    '-DGGML_CUDA=ON','-DGGML_NATIVE=ON','-DGGML_BACKEND_DL=OFF','-DGGML_CPU_ALL_VARIANTS=OFF',
    '-DGGML_CUDA_NCCL=OFF','-DGGML_CUDA_FA_ALL_QUANTS=OFF','-DCMAKE_CUDA_FLAGS=-lineinfo',
    '-DLLAMA_OPENSSL=OFF','-DLLAMA_BUILD_UI=OFF','-DLLAMA_BUILD_APP=OFF',
    '-DLLAMA_BUILD_EXAMPLES=OFF','-DLLAMA_BUILD_TESTS=ON','-DLLAMA_BUILD_TOOLS=ON',
    '-DLLAMA_BUILD_SERVER=ON','-DLLAMA_BUILD_NUMBER=10743',
    "-DGGML_CUDA_FORCE_MMQ=$(if($Variant -eq 'MMQ'){'ON'}else{'OFF'})",
    "-DGGML_CUDA_FORCE_CUBLAS=$(if($Variant -eq 'CUBLAS'){'ON'}else{'OFF'})",
    "-DGGML_CUDA_GRAPHS=$(if($Variant -eq 'NoGraphs'){'OFF'}else{'ON'})",
    "-DLLAMA_LLGUIDANCE=$(if($Llguidance){'ON'}else{'OFF'})",
    "-DGGML_LTO=$(if($LTO){'ON'}else{'OFF'})")
& $Tools.cmake @Config
if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed' }
& $Tools.cmake --build $Build --target llama-server llama-bench test-backend-ops --parallel $Jobs
if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed' }
$Bin = Join-Path $Build 'bin'
foreach ($Dll in @('cudart64_12.dll','cublas64_12.dll','cublasLt64_12.dll')) {
    $DllSource = Join-Path $Tools.cudaRoot "bin\$Dll"
    if (Test-Path -LiteralPath $DllSource) { Copy-Item -LiteralPath $DllSource -Destination (Join-Path $Bin $Dll) -Force }
}
$ReportDir = Join-Path $ProjectRoot 'reports\coder-phase2'
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
$Info = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o'); variant = $Variant; commit = $ActualCommit;
    architecture = $Architecture; jobs = $Jobs; llguidance = [bool]$Llguidance; source = $Source; build = $Build;
    binary = (Join-Path $Bin 'llama-server.exe'); configuration = $Config;
    files = @(Get-ChildItem -LiteralPath $Bin -File | Where-Object { $_.Extension -in @('.exe','.dll') } | ForEach-Object {
        [ordered]@{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()}
    })
}
[IO.File]::WriteAllText((Join-Path $ReportDir "build-$Variant.json"),($Info | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
& (Join-Path $Bin 'llama-server.exe') --version
Write-Host "Built separate runtime: $Bin"
