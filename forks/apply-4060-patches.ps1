<#
.SYNOPSIS
    Apply or reset the local llama.cpp RTX 4060 lab patches.

.DESCRIPTION
    Resets the fork's mmvq.cu to the pinned upstream revision, installs the
    experimental MMVQ config header with the requested warp count, and applies
    the patch. After changing the header, `cmake --build` only needs to rebuild
    the mmvq.cu object and relink llama-bench.

.NOTES
    powershell -ExecutionPolicy Bypass -File forks/apply-4060-patches.ps1 -Nwarps 8
    powershell -ExecutionPolicy Bypass -File forks/apply-4060-patches.ps1 -Reset
#>

param(
    [ValidateSet(0, 2, 4, 8)][int]$Nwarps = 0,
    [switch]$Reset
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Fork = Join-Path $Root 'forks\llama.cpp-4060'
$Patch = Join-Path $Root 'forks\patches\0001-mmvq-4060-nwarps.patch'
$HeaderSrc = Join-Path $Root 'forks\patches\mmvq-4060-config.h'
$HeaderDst = Join-Path $Fork 'ggml\src\ggml-cuda\mmvq-4060-config.h'
if (-not (Test-Path -LiteralPath (Join-Path $Fork 'CMakeLists.txt'))) { throw "Missing fork: $Fork" }

& git -C $Fork checkout -- ggml/src/ggml-cuda/mmvq.cu
if (Test-Path -LiteralPath $HeaderDst) { Remove-Item -LiteralPath $HeaderDst -Force }
if ($Reset) {
    Write-Host "Fork reset to pinned mmvq.cu" -ForegroundColor Green
    exit 0
}

Copy-Item -LiteralPath $HeaderSrc -Destination $HeaderDst -Force
$content = Get-Content -LiteralPath $HeaderDst -Raw
$content = $content -replace '#define GGML_CUDA_MMVQ_4060_NWARPS 0', "#define GGML_CUDA_MMVQ_4060_NWARPS $Nwarps"
[IO.File]::WriteAllText($HeaderDst, $content, [Text.UTF8Encoding]::new($false))

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & git -C $Fork apply --check $Patch 2>&1 | Out-Host
    $check = $LASTEXITCODE
    if ($check -eq 0) { & git -C $Fork apply $Patch 2>&1 | Out-Host; $apply = $LASTEXITCODE } else { $apply = $check }
} finally {
    $ErrorActionPreference = $prev
}
if ($apply -ne 0) { throw "Patch failed (git apply exit $apply)" }
Write-Host "Applied MMVQ patch with GGML_CUDA_MMVQ_4060_NWARPS=$Nwarps" -ForegroundColor Green
