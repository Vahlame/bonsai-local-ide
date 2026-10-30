<#
.SYNOPSIS
    RTX 4060 8GB Optimized UI Launcher
.DESCRIPTION
    Uses optimized presets, speculative decoding, and RTX 4060 tuned binary.
#>

param (
    [int]$UiPort = 8787,
    [int]$Port = 8080,
    [int]$PromptCap = 8192,
    [ValidateSet("", "8GB-VISION-ULTRA-F16", "8GB-VISION-ULTRA", "8GB-VISION-HIGH", "8GB-VISION-BALANCED", "8GB-VISION-SAFE",
                 "8GB-CODE-MAX", "8GB-CODE-HIGH", "8GB-CODE-BALANCED", "8GB-CODE-FAST",
                 "8GB-RESEARCH", "8GB-VISION-QUALITY", "CUSTOM")][string]$EnginePreset = "",
    [ValidateSet("", "legacy", "small-local-coder", "optimized")][string]$AgentProfile = "optimized",
    [int]$Pensar = -1,
    [switch]$SinVision,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Bonsai IDE - RTX 4060 Optimized (llama.cpp v0.8.0+)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$SettingsPath = Join-Path $RootDir 'chat\ui-settings.json'
$SavedSettings = $null
if (Test-Path -LiteralPath $SettingsPath) {
    try { $SavedSettings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json } catch { $SavedSettings = $null }
}

# Use optimized preset if not specified
if (-not $EnginePreset -and $SavedSettings -and $SavedSettings.enginePreset) {
    $EnginePreset = [string]$SavedSettings.enginePreset
}
if (-not $EnginePreset) { $EnginePreset = '8GB-VISION-ULTRA-F16' }  # Default to MAX PRECISION f16 preset

$VisionFlags = @()
if (-not $SinVision) { $VisionFlags += '-Vision' }

$PensarArgs = ""
if ($Pensar -ge 0) { $PensarArgs = " -Pensar $Pensar" }
elseif ($SavedSettings -and $null -ne $SavedSettings.pensar) { $PensarArgs = " -Pensar $([int]$SavedSettings.pensar)" }

$EngineArgs = ""
if ($EnginePreset) { $EngineArgs = " -EnginePreset $EnginePreset" }

# Check if server is already running and compatible
$serverState = & "$RootDir\scripts\stop-managed-server.ps1" -Port $Port -CheckOnly
$CurrentMarker = $null
$reuse = $false

if ($serverState -eq 'managed') {
    $MarkerPath = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
    if (Test-Path -LiteralPath $MarkerPath) {
        $CurrentMarker = Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Json
        
        # Check compatibility with new optimized presets
        $Incompatible = $false
        if ($EnginePreset -ne $CurrentMarker.enginePreset) { $Incompatible = $true }
        if ($Pensar -ge 0 -and $CurrentMarker.pensar -ne $Pensar) { $Incompatible = $true }
        if ($CurrentMarker.vision -ne ($VisionFlags.Count -gt 0)) { $Incompatible = $true }
        if ($CurrentMarker.llamaVersion -notlike "*0.8.0*") { $Incompatible = $true }  # Require v0.8.0+
        
        if ($Incompatible) {
            Write-Host "Servidor existente incompatible con preset optimizado. Reiniciando..." -ForegroundColor Yellow
            & "$RootDir\scripts\stop-managed-server.ps1" -Port $Port
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener el servidor anterior.' }
            $serverState = 'empty'
        } else {
            $reuse = $true
        }
    }
}

if ($serverState -eq "empty" -or -not $reuse) {
    Write-Host "[1/2] Iniciando llama-server optimizado (preset: $EnginePreset)..." -ForegroundColor Green
    
    # Dry-run first to validate VRAM
    $DryRunParams = @{
        Modelo = "ornith9b"
        ContextSize = "auto"
        KVCacheType = "auto"
        Port = $Port
        Vision = $VisionFlags.Count -gt 0
        EnginePreset = $EnginePreset
        DryRun = $true
    }
    if ($Pensar -ge 0) { $DryRunParams.Pensar = $Pensar }
    elseif ($SavedSettings -and $null -ne $SavedSettings.pensar) { $DryRunParams.Pensar = [int]$SavedSettings.pensar }
    & "$RootDir\scripts\start-gpu-model-rtx4060-optimized.ps1" @DryRunParams
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    
    # Launch with optimized script - build argument list for Start-Process
    $LaunchArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", "$RootDir\scripts\start-gpu-model-rtx4060-optimized.ps1",
        "-Modelo", "ornith9b",
        "-ManagedByIDE",
        "-Port", $Port,
        "-EnginePreset", $EnginePreset,
        "-Log", "$RootDir\logs\arranque-modelo.log"
    )
    if ($Pensar -ge 0) { $LaunchArgs += "-Pensar", $Pensar }
    elseif ($SavedSettings -and $null -ne $SavedSettings.pensar) { $LaunchArgs += "-Pensar", [int]$SavedSettings.pensar }
    if ($VisionFlags.Count -gt 0) { $LaunchArgs += "-Vision" }
    $Launcher = Start-Process -FilePath "powershell.exe" -ArgumentList $LaunchArgs -PassThru -WindowStyle Hidden
    
    Write-Host "[2/2] Cargando modelo en GPU (launcher PID $($Launcher.Id))..." -ForegroundColor Green
    $deadline = (Get-Date).AddMinutes(3)
    $ready = $false
    
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Id $Launcher.Id -ErrorAction SilentlyContinue)) {
            Write-Error "El lanzador murió (PID $($Launcher.Id)). Revisa $RootDir\logs\arranque-modelo.log"
            exit 1
        }
        try {
            $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3
            if ($health.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    
    if (-not $ready) {
        $launcherVivo = $null -ne (Get-Process -Id $Launcher.Id -ErrorAction SilentlyContinue)
        Write-Error "Servidor no respondió en http://127.0.0.1:$Port/health (launcher: $launcherVivo)"
        exit 1
    }
} else {
    Write-Host "[1/2] llama-server optimizado ya en ejecución (reutilizado)." -ForegroundColor Yellow
}

# Launch UI
Write-Host "Abriendo http://127.0.0.1:$UiPort" -ForegroundColor Gray
Write-Host "Preset activo: $EnginePreset" -ForegroundColor Cyan
Write-Host ""

[string[]]$UiEngineArgs = @()
if ($EnginePreset) { $UiEngineArgs = @('--engine-preset', $EnginePreset) }
[string[]]$BrowserArgs = @()
if (-not $NoBrowser) { $BrowserArgs = @('--open') }

$ThinkArgs = @()
if ($Pensar -ge 0) { $ThinkArgs = @('--think', $Pensar) }
elseif ($SavedSettings -and $null -ne $SavedSettings.pensar) { $ThinkArgs = @('--think', [int]$SavedSettings.pensar) }

$AgentArgs = @()
if ($AgentProfile) { $AgentArgs = @('--agent-profile', $AgentProfile) }

& node $RootDir\chat\ui-server.mjs --port $UiPort --llama-port $Port --prompt-cap $PromptCap @ThinkArgs @UiEngineArgs @AgentArgs @BrowserArgs
exit $LASTEXITCODE