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
    [ValidateSet("", "8GB-VISION-DEFAULT-F16", "8GB-VISION-ULTRA-F16", "8GB-VISION-ULTRA", "8GB-VISION-HIGH", "8GB-VISION-BALANCED", "8GB-VISION-SAFE",
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
if (-not $EnginePreset) { $EnginePreset = '8GB-VISION-DEFAULT-F16' }  # Default to MAX PRECISION f16 preset

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
    
    # Build server command line directly (bypassing launcher script for reliable detachment)
    $Catalogo = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $Item = $Catalogo.catalogo.ornith9b
    $ModelPath = Join-Path $RootDir ("models\" + $Item.archivo)
    $BinPath = Join-Path $RootDir ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe"
    if (-not (Test-Path -LiteralPath $BinPath)) { $BinPath = Join-Path $RootDir "bin\llama-server.exe" }
    
    # Use STABLE flags for f16 KV
    $UseStableFlags = ($EnginePreset -like "*F16*" -or $EnginePreset -eq "8GB-VISION-DEFAULT-F16" -or $EnginePreset -eq "8GB-VISION-ULTRA-F16" -or $EnginePreset -eq "8GB-CODE-FAST" -or $EnginePreset -eq "8GB-VISION-QUALITY")
    
    $ServerArgs = @(
        "-m", $ModelPath
        "--gpu-layers", "99"
    )
    if (-not $UseStableFlags) { $ServerArgs += "--fit", "off"; $ServerArgs += "--kv-offload" }
    $ServerArgs += "--flash-attn", "on"
    $ServerArgs += "-c", "16384"
    $ServerArgs += "-ctk", "f16"
    $ServerArgs += "-ctv", "f16"
    if (-not $UseStableFlags) { $ServerArgs += "-np", "1" }
    $ServerArgs += "-b", "512"
    $ServerArgs += "-ub", "256"
    $ServerArgs += "-t", "4"
    $ServerArgs += "--host", "127.0.0.1"
    $ServerArgs += "--port", $Port
    $ServerArgs += "--jinja"
    $ServerArgs += "--metrics"
    if (-not $UseStableFlags) { $ServerArgs += "--cache-ram", "0" }
    $ServerArgs += "-lv", "4"
    $ServerArgs += "--cors-origins", "http://127.0.0.1:$Port,http://localhost:$Port,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:8788,http://localhost:8788"
    $ServerArgs += "--temp", "0.6"
    $ServerArgs += "--top-p", "0.95"
    $ServerArgs += "--top-k", "20"
    $ServerArgs += "--min-p", "0"
    $ServerArgs += "--presence-penalty", "0"
    $ServerArgs += "--repeat-penalty", "1"
    $ServerArgs += "--spec-type", "none"
    $ServerArgs += "--no-context-shift"
    if ($UseStableFlags) { $ServerArgs += "--ctx-checkpoints", "0" }
    
    # Chat template
    $ChatTemplatePath = Join-Path $RootDir "logs\chat_template_$Port.jinja"
    if ($Item.chat_template) { $Item.chat_template | Set-Content -LiteralPath $ChatTemplatePath -Encoding UTF8 -NoNewline }
    $ServerArgs += "--chat-template-file", $ChatTemplatePath
    
    # Vision
    if ($VisionFlags.Count -gt 0) {
        $ProjectorPath = Join-Path $RootDir ("models\" + $Item.vision.archivo)
        $ServerArgs += "--mmproj", $ProjectorPath
        $ServerArgs += "--mmproj-offload"
        $ServerArgs += "--mmproj-device", "CUDA0"
        $ServerArgs += "--image-max-tokens", "512"
    }
    
    # Reasoning
    $ThinkBudget = if ($Pensar -ge 0) { $Pensar } elseif ($SavedSettings -and $null -ne $SavedSettings.pensar) { [int]$SavedSettings.pensar } else { 4096 }
    $ServerArgs += "--reasoning-budget", $ThinkBudget
    $ServerArgs += "--reasoning-format", "deepseek"
    
    # Launch server as a background job to keep it alive
    $ServerJob = Start-Job -ScriptBlock {
        param($BinPath, $Args)
        & $BinPath @Args
    } -ArgumentList $BinPath, $ServerArgs
    
    Write-Host "Servidor iniciado en background job ID: $($ServerJob.Id)" -ForegroundColor Cyan
    
    Write-Host "[2/2] Cargando modelo en GPU..." -ForegroundColor Green
    $deadline = (Get-Date).AddMinutes(5)
    $ready = $false
    $attempts = 0
    
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 10
            if ($health.StatusCode -eq 200) {
                $ready = $true
                Write-Host "Servidor listo en http://127.0.0.1:$Port" -ForegroundColor Green
                break
            }
        } catch {
            $attempts++
            if ($attempts % 10 -eq 0) { Write-Host "Esperando servidor... (intento $attempts)" -ForegroundColor Cyan }
            Start-Sleep -Seconds 2
        }
    }
    
    if (-not $ready) {
        Write-Error "Servidor no respondio en http://127.0.0.1:$Port/health"
        exit 1
    }
} else {
    Write-Host "[1/2] llama-server optimizado ya en ejecucion (reutilizado)." -ForegroundColor Yellow
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