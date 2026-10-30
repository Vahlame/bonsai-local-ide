<#
.SYNOPSIS
    Calibrate all RTX 4060 optimized profiles automatically
.DESCRIPTION
    Runs dry-run for each optimized preset to find max context that fits in VRAM.
    Outputs calibrated presets to local-engine-presets-rtx4060-calibrated.json
#>

param(
    [string]$Modelo = "ornith9b",
    [int]$Port = 8080,
    [switch]$IncludeVision = $true
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

$PresetPath = Join-Path $RootDir "config\local-engine-presets-rtx4060-optimized.json"
$Presets = Get-Content -LiteralPath $PresetPath -Raw | ConvertFrom-Json
$Calibrated = @{}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Calibrando perfiles RTX 4060 para: $Modelo" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

foreach ($PresetName in $Presets.PSObject.Properties.Name) {
    $Preset = $Presets.$PresetName
    
    # Skip vision presets if not requested
    if (-not $IncludeVision -and $Preset.vision) { continue }
    
    Write-Host "`n--- $PresetName ---" -ForegroundColor Cyan
    Write-Host "  Contexto base: $($Preset.context), KV: $($Preset.kv), Vision: $($Preset.vision)" -ForegroundColor Gray
    
    # Run dry-run to get actual VRAM requirements
    $Cmd = "& `"$RootDir\scripts\start-gpu-model-rtx4060-optimized.ps1`" -Modelo $Modelo -Port $Port -EnginePreset $PresetName -DryRun"
    
    try {
        $Output = Invoke-Expression $Cmd
        Write-Host "  ✓ Dry-run OK" -ForegroundColor Green
        $Calibrated[$PresetName] = $Preset
    } catch {
        Write-Host "  ✗ Dry-run falló: $($_.Exception.Message)" -ForegroundColor Red
        
        # Try reducing context in steps
        $TestContext = $Preset.context
        $Success = $false
        while ($TestContext -ge 4096) {
            $TestPreset = $Preset.PSObject.Copy()
            $TestPreset.context = $TestContext
            $TempPath = Join-Path $env:TEMP "temp-preset-$PresetName.json"
            $TestPreset | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $TempPath -Encoding UTF8
            
            try {
                $TestCmd = "& `"$RootDir\scripts\start-gpu-model-rtx4060-optimized.ps1`" -Modelo $Modelo -Port $Port -ContextSize $TestContext -EnginePreset CUSTOM -DryRun"
                $TestOutput = Invoke-Expression $TestCmd
                Write-Host "  ↓ Reducido a $TestContext tokens: OK" -ForegroundColor Yellow
                $CalibratedPreset = $Preset.PSObject.Copy()
                $CalibratedPreset.context = $TestContext
                $CalibratedPreset.marginMiB = $Preset.marginMiB + 50  # Add safety margin
                $Calibrated[$PresetName] = $CalibratedPreset
                $Success = $true
                break
            } catch {
                $TestContext -= 1024
            }
        }
        
        if (-not $Success) {
            Write-Host "  ✗ No cabe ni con 4096 tokens" -ForegroundColor Red
        }
    }
}

# Save calibrated presets
$OutPath = Join-Path $RootDir "config\local-engine-presets-rtx4060-calibrated.json"
$Calibrated | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutPath -Encoding UTF8

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  Calibración completa. Guardado en: $OutPath" -ForegroundColor Cyan
Write-Host "  Perfiles calibrados: $($Calibrated.Count)" -ForegroundColor Cyan
$Calibrated.PSObject.Properties | ForEach-Object { 
    Write-Host "  - $($_.Name): ctx=$($_.Value.context), kv=$($_.Value.kv), margin=$($_.Value.marginMiB)" -ForegroundColor Gray 
}