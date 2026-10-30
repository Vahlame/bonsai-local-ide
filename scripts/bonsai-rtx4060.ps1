<#
.SYNOPSIS
    Bonsai IDE - RTX 4060 Optimized Launcher (Unified)
.DESCRIPTION
    Single entry point for all optimized features:
    - RTX 4060 tuned binary
    - Optimized engine presets with speculative decoding
    - Auto VRAM calibration
    - Speculative decoding draft model setup
    - Optimized agent profiles
#>

param(
    [ValidateSet("launch", "calibrate", "setup-draft", "benchmark", "status")][string]$Action = "launch",
    [int]$UiPort = 8787,
    [int]$Port = 8080,
    [string]$EnginePreset = "",
    [ValidateSet("", "optimized", "optimized-conservative", "optimized-speed")][string]$AgentProfile = "optimized",
    [int]$Pensar = -1,
    [switch]$SinVision,
    [switch]$NoBrowser,
    [switch]$ForceRecalibrate
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

# El binario optimizado puede estar en el proyecto o en el perfil del usuario.
function Get-OptBinary {
    $cands = @(
        (Join-Path $RootDir ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin"),
        (Join-Path $env:USERPROFILE ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin")
    )
    foreach ($c in $cands) { if (Test-Path -LiteralPath (Join-Path $c "llama-server.exe")) { return $c } }
    return ""
}

function Show-Banner {
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Bonsai IDE - RTX 4060 8GB Optimized (llama.cpp v0.8.0+)    " -ForegroundColor Cyan
    Write-Host "  End-to-end optimized pipeline for maximum performance       " -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
}

function Check-Prerequisites {
    # Check optimized binary exists
    $OptBinDir = Get-OptBinary
    if (-not $OptBinDir) {
        Write-Warning "Binario optimizado no encontrado. Ejecuta: .\scripts\build-rtx4060-optimized.ps1"
        return $false
    }
    
    # Check draft model for speculative decoding
    $DraftModel = Join-Path $RootDir "models\Ornith-1.5-1B-Q4_K_M.gguf"
    if (-not (Test-Path -LiteralPath $DraftModel)) {
        Write-Warning "Modelo draft para Speculative Decoding no encontrado."
        Write-Host "  Ejecuta: .\scripts\setup-speculative-draft.ps1" -ForegroundColor Gray
    }
    
    return $true
}

switch ($Action) {
    "launch" {
        Show-Banner
        Check-Prerequisites
        & "$RootDir\scripts\start-ui-rtx4060-optimized.ps1" -UiPort $UiPort -Port $Port -EnginePreset $EnginePreset -AgentProfile $AgentProfile -Pensar $Pensar -SinVision:$SinVision -NoBrowser:$NoBrowser
    }
    "calibrate" {
        Show-Banner
        Check-Prerequisites
        & "$RootDir\scripts\calibrate-rtx4060-profiles.ps1" -ForceRecalibrate:$ForceRecalibrate
    }
    "setup-draft" {
        Show-Banner
        & "$RootDir\scripts\setup-speculative-draft.ps1"
    }
    "benchmark" {
        Show-Banner
        $OptBinDir = Get-OptBinary
        if (-not $OptBinDir) { throw "Binario optimizado no encontrado" }
        $OptBin = Join-Path $OptBinDir "llama-bench.exe"
        
        $Model = Join-Path $RootDir "models\Ornith-1.5-9B-Q4_K_M.gguf"
        Write-Host "Ejecutando benchmark RTX 4060 optimizado..." -ForegroundColor Cyan
        & $OptBin -m $Model -ngl 99 -b 512 -ub 128 -n 1 -r 5 -p 512 -n 128 -o md
    }
    "status" {
        Show-Banner
        Write-Host "`nEstado del sistema:" -ForegroundColor Cyan
        
        # Binary status
        $OptBinDir = Get-OptBinary
        $OptBin = if ($OptBinDir) { Join-Path $OptBinDir "llama-server.exe" } else { "" }
        $StdBin = Join-Path $RootDir "bin\llama-server.exe"
        Write-Host "  Binario optimizado: $(if ($OptBin -and (Test-Path $OptBin)) { '[OK] ' + $OptBin } else { '[FAIL] No encontrado' })" -ForegroundColor $(if ($OptBin -and (Test-Path $OptBin)) { 'Green' } else { 'Red' })
        Write-Host "  Binario estándar:   $(if (Test-Path $StdBin) { '[OK] ' + $StdBin } else { '[FAIL] No encontrado' })" -ForegroundColor $(if (Test-Path $StdBin) { 'Green' } else { 'Red' })
        
        # Draft model
        $Draft = Join-Path $RootDir "models\Ornith-1.5-1B-Q4_K_M.gguf"
        Write-Host "  Modelo draft:       $(if (Test-Path $Draft) { '[OK] ' + (Get-Item $Draft).Length/1MB.ToString('F1') + ' MB' } else { '[FAIL] No encontrado' })" -ForegroundColor $(if (Test-Path $Draft) { 'Green' } else { 'Yellow' })
        
        # Presets
        $PresetsPath = Join-Path $RootDir "config\local-engine-presets-rtx4060-optimized.json"
        $CalibratedPath = Join-Path $RootDir "config\local-engine-presets-rtx4060-calibrated.json"
        Write-Host "  Presets optimizados: $(if (Test-Path $PresetsPath) { '[OK] ' + $PresetsPath } else { '[FAIL] No encontrado' })" -ForegroundColor $(if (Test-Path $PresetsPath) { 'Green' } else { 'Red' })
        Write-Host "  Presets calibrados:  $(if (Test-Path $CalibratedPath) { '[OK] ' + $CalibratedPath } else { '[SKIP] No calibrado aun' })" -ForegroundColor $(if (Test-Path $CalibratedPath) { 'Green' } else { 'Yellow' })
        
        # GPU
        $Gpu = nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits
        Write-Host "  GPU: $($Gpu.Trim())" -ForegroundColor Gray
        
        # Server status
        try {
            $Health = Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -TimeoutSec 3 -UseBasicParsing
            Write-Host "  llama-server:       [OK] Corriendo en puerto 8080" -ForegroundColor Green
        } catch {
            Write-Host "  llama-server:       [FAIL] No responde" -ForegroundColor Red
        }
    }
    default { throw "Accion desconocida: $Action" }
}