# ==============================================================================
# Interfaz de chat local (navegador). No es la terminal.
# Si el modelo crea un archivo, queda en la carpeta salida.
# El contexto y el KV son automaticos: start-server.ps1 busca la mejor combinacion
# que quepa en la VRAM (techo exacto calibrado y luego bloques inferiores) y recuerda
# el perfil en logs\perfil-servidor-PORT.json. NO se fija 16K.
# La vision se activa sola si el proyector del modelo activo esta descargado.
# ==============================================================================

param (
    [string]$ContextSize = "auto",   # auto = el mejor perfil de contexto/KV que quepa; o un numero de tokens
    [int]$Port = 8080,
    [int]$UiPort = 8787,
    [int]$PromptCap = 8192,
    [ValidateSet("auto", "f16", "q8_0", "q4_0")][string]$KVCacheType = "auto",
    [int]$Pensar = -1,            # -1 = auto (ajuste "Modo razonamiento" de la interfaz, solo si el modelo lo admite). 0 = apagado. N>0 = tope de N tokens
    [ValidateSet("", "legacy", "small-local-coder")][string]$AgentProfile = "",
    [ValidateSet("", "8GB-SAFE", "8GB-BALANCED", "8GB-MAX-SPEED", "8GB-CONTEXT", "8GB-VISION", "8GB-VISION-CONTEXT", "8GB-VISION-QUALITY", "8GB-VISION-LONG", "CUSTOM")][string]$EnginePreset = "",
    [switch]$SinVision,           # por defecto la vision se enciende sola si el proyector esta descargado
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$SettingsPath = Join-Path $RootDir 'chat\ui-settings.json'
$SavedSettings = $null
if (Test-Path -LiteralPath $SettingsPath) {
    try { $SavedSettings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json } catch { $SavedSettings = $null }
}
# Un preset guardado "CUSTOM" no tiene ficha en local-engine-presets.json: la ventana y el
# historial los fijo el usuario en la interfaz y viven en ui-settings.json.
if (-not $EnginePreset -and $SavedSettings -and $SavedSettings.enginePreset) {
    $SavedPreset = [string]$SavedSettings.enginePreset
    if ($SavedPreset -eq 'CUSTOM') {
        $EnginePreset = 'CUSTOM'
    } else {
        $KnownPresets = Get-Content (Join-Path $RootDir 'config\local-engine-presets.json') -Raw | ConvertFrom-Json
        if (-not $KnownPresets.PSObject.Properties[$SavedPreset]) { throw 'El perfil de motor guardado no existe' }
        $EnginePreset = [string]$SavedPreset
    }
}
$SavedContext = 0
$SavedHistorial = 0
if ($SavedSettings) {
    [void][int]::TryParse([string]$SavedSettings.coderContextTokens, [ref]$SavedContext)
    [void][int]::TryParse([string]$SavedSettings.historial, [ref]$SavedHistorial)
}
if ($EnginePreset -eq 'CUSTOM' -and -not $PSBoundParameters.ContainsKey('KVCacheType')) {
    $KVCacheType = if ($SavedSettings -and $SavedSettings.engineKv -in @('f16','q8_0','q4_0')) { [string]$SavedSettings.engineKv } else { 'f16' }
}
if ($EnginePreset -eq 'CUSTOM' -and -not $PSBoundParameters.ContainsKey('SinVision') -and $SavedSettings -and $SavedSettings.engineVision -eq $false) { $SinVision = $true }
if ($SavedContext -lt 4096 -or $SavedContext -gt 65536) { $SavedContext = 0 }
if ($SavedHistorial -lt 512) { $SavedHistorial = 0 }
if ($EnginePreset -eq 'CUSTOM' -and $ContextSize -eq 'auto' -and $SavedContext -gt 0) {
    # El servidor tiene que arrancar con la misma ventana que el perfil personalizado.
    $ContextSize = [string]$SavedContext
}
if ($AgentProfile) { $env:BONSAI_AGENT_PROFILE = $AgentProfile }
if ($EnginePreset -and $EnginePreset -ne 'CUSTOM' -and -not $PSBoundParameters.ContainsKey('SinVision')) {
    $SinVision = -not [bool](Get-Content (Join-Path $RootDir 'config\local-engine-presets.json') -Raw | ConvertFrom-Json).$EnginePreset.vision
}
if ($EnginePreset -and $AgentProfile -eq 'small-local-coder') {
    if ($EnginePreset -eq 'CUSTOM') {
        $CoderContext = if ($SavedContext -gt 0) { $SavedContext } else { 16384 }
        $ExplicitContext = 0
        if ($ContextSize -ne 'auto' -and [int]::TryParse([string]$ContextSize, [ref]$ExplicitContext) -and $ExplicitContext -ge 4096) { $CoderContext = $ExplicitContext }
    } else {
        $CoderContext = [int]((Get-Content (Join-Path $RootDir 'config\local-engine-presets.json') -Raw | ConvertFrom-Json).$EnginePreset.context)
    }
    $CoderOptions = if ($env:BONSAI_CODER_OPTIONS) { $env:BONSAI_CODER_OPTIONS | ConvertFrom-Json } else { [pscustomobject]@{} }
    $CoderOptions | Add-Member -NotePropertyName contextTokens -NotePropertyValue $CoderContext -Force
    $env:BONSAI_CODER_OPTIONS = $CoderOptions | ConvertTo-Json -Compress
    if (-not $PSBoundParameters.ContainsKey('PromptCap')) {
        $PromptCap = if ($EnginePreset -eq 'CUSTOM' -and $SavedHistorial -gt 0) { [Math]::Min($SavedHistorial, $CoderContext) } else { $CoderContext }
    }
}
$Server = Join-Path $RootDir "chat\ui-server.mjs"

# Vision: usa el proyector del modelo activo y solo se activa si esta descargado. El techo
# de contexto de vision (catalogo.<clave>.vision.contexto) lo aplica start-server.ps1 al
# buscar el perfil automatico; aqui no se fija ningun contexto.
$VisionFlags = @()
if (-not $SinVision) {
    $modelData = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $activePath = Join-Path $RootDir "chat\modelo-activo.json"
    $activeKey = [string]$modelData.modeloPredeterminado
    if (Test-Path $activePath) {
        try {
            $guardada = [string](Get-Content $activePath -Raw | ConvertFrom-Json).clave
            $filaGuardada = if ($guardada) { $modelData.catalogo.$guardada } else { $null }
            if ($filaGuardada -and $filaGuardada.archivo -and (Test-Path (Join-Path $RootDir ("models\" + $filaGuardada.archivo)))) { $activeKey = $guardada }
        } catch { }
    }
    $visionConfig = $modelData.catalogo.$activeKey.vision
    if (-not $visionConfig -or $visionConfig -eq $false) { $visionConfig = $null }
    $mmproj = [string]$visionConfig.archivo
    if ($mmproj -and (Test-Path (Join-Path $RootDir ("models\" + $mmproj)))) { $VisionFlags = @("-Vision") }
}
if ($EnginePreset -eq 'CUSTOM' -and -not $SinVision -and $SavedSettings -and $SavedSettings.engineVision -eq $true -and $VisionFlags.Count -eq 0) {
    throw 'La vision guardada requiere el proyector del modelo. No se arrancara sin vision.'
}
$VisionArgs = if ($VisionFlags.Count -gt 0) { " " + ($VisionFlags -join " ") } else { "" }
if ($SinVision) { $VisionArgs = ' -SinVision' }
$PensarArgs = if ($Pensar -ge 0) { " -Pensar $Pensar" } else { "" }
$EngineArgs = if ($EnginePreset) { " -EnginePreset $EnginePreset" } else { "" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "No esta node en el PATH."
    exit 1
}
if (-not (Test-Path $Server)) {
    Write-Error "No esta la interfaz en: $Server"
    exit 1
}

$ThinkArgs = if ($Pensar -ge 0) { @("--think", "$Pensar") } else { @() }

try { chcp 65001 > $null } catch { }

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Bonsai en el navegador (RTX 4060)                      " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$serverState = & "$RootDir\scripts\stop-managed-server.ps1" -Port $Port -CheckOnly
if ($serverState -eq 'managed' -and $EnginePreset) {
    $CurrentMarker = Get-Content -LiteralPath (Join-Path $RootDir "logs\servidor-administrado-$Port.json") -Raw | ConvertFrom-Json
    $IncompatibleCustom = $EnginePreset -eq 'CUSTOM' -and (($ContextSize -ne 'auto' -and [int]$CurrentMarker.contexto -ne [int]$ContextSize) -or ($KVCacheType -ne 'auto' -and $CurrentMarker.kv -ne $KVCacheType) -or ([bool]$CurrentMarker.vision -ne ($VisionFlags.Count -gt 0)))
    if ($CurrentMarker.enginePreset -ne $EnginePreset -or ($Pensar -ge 0 -and $CurrentMarker.pensar -ne $Pensar) -or $IncompatibleCustom) {
        & "$RootDir\scripts\stop-managed-server.ps1" -Port $Port
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener el servidor administrado anterior.' }
        $serverState = 'empty'
    }
}
if ($serverState -eq "empty") {
    # Comprobacion previa a la vista: si la VRAM no alcanza, el servidor minimizado fallaria sin que se vea.
    # OJO: @VisionFlags es splatting de ARRAY y pasa los elementos como POSICIONALES: `-Vision`
    # acababa siendo el valor de `-HostIP` (verificado en PowerShell 5.1), así que la
    # precomprobacion de VRAM medía una configuración distinta de la que luego se lanza.
    & "$RootDir\scripts\start-server.ps1" -ContextSize $ContextSize -KVCacheType $KVCacheType -Port $Port -Pensar $Pensar -DryRun -Vision:($VisionFlags.Count -gt 0) -EnginePreset $EnginePreset
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    # El DryRun acaba de persistir el perfil elegido: se muestra para que el usuario sepa que
    # contexto/KV se va a cargar (y que no se vuelve en silencio a 16K/f16).
    if ($ContextSize -eq "auto" -and -not $EnginePreset) {
        $perfilPath = Join-Path $RootDir "logs\perfil-servidor-$Port.json"
        if (Test-Path $perfilPath) {
            try {
                $perfil = Get-Content $perfilPath -Raw | ConvertFrom-Json
                Write-Host "Perfil de arranque: contexto $($perfil.contexto) | KV $($perfil.kv) | vision $($perfil.vision)" -ForegroundColor Gray
            } catch { }
        }
    }
    Write-Host "[1/2] Iniciando llama-server (contexto: $ContextSize)..." -ForegroundColor Green
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$RootDir\scripts\start-server.ps1`" -ManagedByIDE -ContextSize $ContextSize -KVCacheType $KVCacheType -Port $Port$PensarArgs$VisionArgs$EngineArgs -Log `"$RootDir\logs\arranque-modelo.log`"" -WindowStyle Hidden
} else {
    Write-Host "[1/2] llama-server ya esta en ejecucion." -ForegroundColor Yellow
}

Write-Host "[2/2] Esperando a que el modelo cargue en la GPU..." -ForegroundColor Green
$deadline = (Get-Date).AddMinutes(3)
$ready = $false
while ((Get-Date) -lt $deadline) {
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
    Write-Error "El servidor no respondio en http://127.0.0.1:$Port/health"
    exit 1
}

Write-Host "Abriendo http://127.0.0.1:$UiPort" -ForegroundColor Gray
Write-Host "Los archivos que pidas se guardan en la carpeta salida." -ForegroundColor Gray
Write-Host ""

# Keep arrays even for a single value: PowerShell 5.1 splats a scalar string
# character by character into native commands ("--open" became "-", "-", "o", ...).
[string[]]$UiEngineArgs = @()
if ($EnginePreset) { $UiEngineArgs = @('--engine-preset', $EnginePreset) }
[string[]]$BrowserArgs = @()
if (-not $NoBrowser) { $BrowserArgs = @('--open') }
& node $Server --port $UiPort --llama-port $Port --prompt-cap $PromptCap @ThinkArgs @UiEngineArgs @BrowserArgs
exit $LASTEXITCODE
