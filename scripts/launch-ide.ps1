# Desktop entry: reuses our healthy IDE, otherwise starts it with saved settings.
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$TaskRoot = Split-Path -Parent $PSScriptRoot
$TaskLog = Join-Path $TaskRoot 'logs\ide-launcher.log'
New-Item -ItemType Directory -Path (Split-Path -Parent $TaskLog) -Force | Out-Null
try {
    Start-Transcript -Path $TaskLog -Append -Force | Out-Null
    $UiListener = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
    if ($UiListener.Count -gt 0) {
        $UiOwner = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $UiListener[0].OwningProcess)
        $ExpectedUi = Join-Path $TaskRoot 'chat\ui-server.mjs'
        if (-not $UiOwner -or [string]$UiOwner.CommandLine -notlike ("*" + $ExpectedUi + "*")) { throw 'El puerto 8787 pertenece a otra aplicacion.' }
        $UiState = Invoke-RestMethod 'http://127.0.0.1:8787/api/state' -TimeoutSec 5
        if (-not $UiState.nCtx) { throw 'El IDE no informa de un modelo cargado.' }
        if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8787' }
        exit 0
    }
    $SavedSettings = $null
    $SettingsPath = Join-Path $TaskRoot 'chat\ui-settings.json'
    if (Test-Path -LiteralPath $SettingsPath) { $SavedSettings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    $LaunchProfile = if ($SavedSettings.enginePreset) { [string]$SavedSettings.enginePreset } else { '8GB-VISION-LONG' }
    $AgentMode = if ($SavedSettings.agentePerfil) { [string]$SavedSettings.agentePerfil } else { 'small-local-coder' }
    $Thinking = if ($null -ne $SavedSettings.pensar) { [int]$SavedSettings.pensar } else { 4096 }
    & (Join-Path $PSScriptRoot 'start-ui.ps1') -EnginePreset $LaunchProfile -AgentProfile $AgentMode -Pensar $Thinking -NoBrowser:$NoBrowser
    if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar el IDE (codigo $LASTEXITCODE). Revisa $TaskLog" }
} catch {
    Write-Output $_.Exception.Message
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Bonsai IDE', 'OK', 'Error') | Out-Null
    exit 1
} finally { try { Stop-Transcript | Out-Null } catch {} }
