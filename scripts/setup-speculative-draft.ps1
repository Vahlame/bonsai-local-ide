<#
.SYNOPSIS
    Setup speculative decoding draft models for RTX 4060
.DESCRIPTION
    Downloads and verifies small draft models for speculative decoding.
    Recommended: Ornith 1.5 1B Q4_K_M (~0.8GB) for 4-token lookahead.
#>

param(
    [string]$ModelName = "Ornith-1.5-1B-Q4_K_M.gguf",
    [string]$ModelUrl = "https://huggingface.co/ornith-ai/Ornith-1.5-1B-GGUF/resolve/main/Ornith-1.5-1B-Q4_K_M.gguf",
    [string]$ExpectedSha256 = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$ModelsDir = Join-Path $RootDir "models"
$DestPath = Join-Path $ModelsDir $ModelName

if (Test-Path -LiteralPath $DestPath -and -not $Force) {
    Write-Host "Modelo draft ya existe: $DestPath" -ForegroundColor Green
    exit 0
}

Write-Host "Descargando modelo draft para Speculative Decoding..." -ForegroundColor Cyan
Write-Host "  Modelo: $ModelName" -ForegroundColor Gray
Write-Host "  URL: $ModelUrl" -ForegroundColor Gray
Write-Host "  Destino: $DestPath" -ForegroundColor Gray

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $ModelUrl -OutFile $DestPath -UseBasicParsing
    $ProgressPreference = 'Continue'
} catch {
    Write-Error "Error descargando modelo: $($_.Exception.Message)"
    if (Test-Path -LiteralPath $DestPath) { Remove-Item -LiteralPath $DestPath -Force -ErrorAction SilentlyContinue }
    exit 1
}

if ($ExpectedSha256) {
    $Actual = (Get-FileHash -LiteralPath $DestPath -Algorithm SHA256).Hash.ToLower()
    if ($Actual -ne $ExpectedSha256.ToLower()) {
        Write-Error "SHA256 mismatch! Esperado: $ExpectedSha256, Actual: $Actual"
        Remove-Item -LiteralPath $DestPath -Force -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Host "SHA256 verificado: $Actual" -ForegroundColor Green
}

$SizeMB = [math]::Round((Get-Item -LiteralPath $DestPath).Length / 1MB, 1)
Write-Host "Modelo draft listo: $ModelName ($SizeMB MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Para usar Speculative Decoding:" -ForegroundColor Cyan
Write-Host "  1. Asegúrate de usar preset '8GB-VISION-ULTRA', '8GB-CODE-MAX' o '8GB-CODE-FAST'" -ForegroundColor Gray
Write-Host "  2. El launcher usará automáticamente este modelo como draft (4 tokens lookahead)" -ForegroundColor Gray
Write-Host "  3. Velocidad esperada: ~2-3x tokens/seg en generación" -ForegroundColor Gray