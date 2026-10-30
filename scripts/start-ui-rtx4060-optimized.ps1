<#
.SYNOPSIS
    Bonsai IDE - RTX 4060 optimized UI launcher.

.DESCRIPTION
    Abre SOLO la interfaz web (Node) en http://127.0.0.1:<UiPort>. El servidor del
    modelo NO se arranca aquí: se arranca desde el botón "Iniciar" de la propia
    interfaz (o desde "Terminal" para copiar el comando). Ese botón llama a
    /api/server/start, que lanza el binario sm89 con el preset elegido usando el
    patrón spawn+unref de Node — el único que mantiene vivo el servidor en Windows
    aunque la ventana que lo lanzó desaparezca.

    Así el acceso directo del escritorio abre el IDE sin depender del ciclo de vida
    de ningún proceso de PowerShell, y el usuario elige el preset (f16, IQ4_XS…)
    dentro de la interfaz.
#>

param (
    [int]$UiPort = 8787,
    [int]$Port = 8080,
    [int]$PromptCap = 8192,
    [ValidateSet("", "8GB-VISION-MAX-F16", "8GB-VISION-DEFAULT-F16", "8GB-VISION-ULTRA-F16", "8GB-VISION-ULTRA", "8GB-VISION-HIGH", "8GB-VISION-BALANCED", "8GB-VISION-SAFE",
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
Write-Host "  Abre el IDE. Inicia el modelo con el boton 'Iniciar'." -ForegroundColor Gray
Write-Host ""

# Si la interfaz ya esta corriendo en este puerto, se reutiliza (no se abre un duplicado
# que fallaria al enlazar el puerto y se cerraria en silencio).
$yaCorriendo = $false
try {
    $estado = Invoke-RestMethod "http://127.0.0.1:$UiPort/api/state" -TimeoutSec 3
    if ($null -ne $estado) { $yaCorriendo = $true }
} catch { $yaCorriendo = $false }
if ($yaCorriendo) {
    Write-Host "La interfaz ya esta en marcha: http://127.0.0.1:$UiPort" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$UiPort" }
    exit 0
}

$SettingsPath = Join-Path $RootDir 'chat\ui-settings.json'
$SavedSettings = $null
if (Test-Path -LiteralPath $SettingsPath) {
    try { $SavedSettings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json } catch { $SavedSettings = $null }
}

# Preset por defecto: MAXIMO contexto + precision f16 + vision (43k, medido estable).
# El usuario puede cambiarlo en la UI.
if (-not $EnginePreset) {
    if ($SavedSettings -and $SavedSettings.enginePreset) { $EnginePreset = [string]$SavedSettings.enginePreset }
    if (-not $EnginePreset) { $EnginePreset = '8GB-VISION-MAX-F16' }
}

# Argumentos para node
[string[]]$NodeArgs = @("$RootDir\chat\ui-server.mjs", "--port", "$UiPort", "--llama-port", "$Port", "--prompt-cap", "$PromptCap")

if ($EnginePreset) { $NodeArgs += @("--engine-preset", $EnginePreset) }
if ($AgentProfile) { $NodeArgs += @("--agent-profile", $AgentProfile) }

$ThinkValue = $null
if ($Pensar -ge 0) { $ThinkValue = $Pensar }
elseif ($SavedSettings -and $null -ne $SavedSettings.pensar) { $ThinkValue = [int]$SavedSettings.pensar }
if ($null -ne $ThinkValue) { $NodeArgs += @("--think", "$ThinkValue") }

if (-not $NoBrowser) { $NodeArgs += "--open" }

Write-Host "Interfaz: http://127.0.0.1:$UiPort" -ForegroundColor Gray
Write-Host "Preset guardado: $EnginePreset" -ForegroundColor Cyan
Write-Host ""

# Ejecuta Node en esta consola: si el usuario cierra la ventana, se para la UI
# (el servidor del modelo, si estaba encendido, sigue vivo: lo administra /api/server).
& node @NodeArgs
exit $LASTEXITCODE