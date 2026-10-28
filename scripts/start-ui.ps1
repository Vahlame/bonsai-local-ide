# ==============================================================================
# Interfaz de chat local (navegador). No es la terminal.
# Si el modelo crea un archivo, queda en la carpeta salida.
# El contexto y el KV son automaticos: start-server.ps1 busca la mejor combinacion
# que quepa en la VRAM (pasos de 4096; con vision usa el techo de vision) y recuerda
# el perfil en logs\perfil-servidor-PORT.json. NO se fija 16K.
# La vision se activa sola si el proyector del modelo activo esta descargado.
# ==============================================================================

param (
    [string]$ContextSize = "auto",   # auto = el mejor perfil de contexto/KV que quepa; o un numero de tokens
    [int]$Port = 8080,
    [int]$UiPort = 8787,
    [int]$PromptCap = 8192,
    [int]$Pensar = -1,            # -1 = auto (ajuste "Modo razonamiento" de la interfaz, solo si el modelo lo admite). 0 = apagado. N>0 = tope de N tokens
    [switch]$SinVision            # por defecto la vision se enciende sola si el proyector esta descargado
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
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
$VisionArgs = if ($VisionFlags.Count -gt 0) { " " + ($VisionFlags -join " ") } else { "" }
$PensarArgs = if ($Pensar -ge 0) { " -Pensar $Pensar" } else { "" }

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
if ($serverState -eq "empty") {
    # Comprobacion previa a la vista: si la VRAM no alcanza, el servidor minimizado fallaria sin que se vea.
    # OJO: @VisionFlags es splatting de ARRAY y pasa los elementos como POSICIONALES: `-Vision`
    # acababa siendo el valor de `-HostIP` (verificado en PowerShell 5.1), así que la
    # precomprobacion de VRAM medía una configuración distinta de la que luego se lanza.
    & "$RootDir\scripts\start-server.ps1" -ContextSize $ContextSize -Port $Port -Pensar $Pensar -DryRun -Vision:($VisionFlags.Count -gt 0)
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    # El DryRun acaba de persistir el perfil elegido: se muestra para que el usuario sepa que
    # contexto/KV se va a cargar (y que no se vuelve en silencio a 16K/f16).
    if ($ContextSize -eq "auto") {
        $perfilPath = Join-Path $RootDir "logs\perfil-servidor-$Port.json"
        if (Test-Path $perfilPath) {
            try {
                $perfil = Get-Content $perfilPath -Raw | ConvertFrom-Json
                Write-Host "Perfil de arranque: contexto $($perfil.contexto) | KV $($perfil.kv) | vision $($perfil.vision)" -ForegroundColor Gray
            } catch { }
        }
    }
    Write-Host "[1/2] Iniciando llama-server (contexto: $ContextSize)..." -ForegroundColor Green
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$RootDir\scripts\start-server.ps1`" -ManagedByIDE -ContextSize $ContextSize -Port $Port$PensarArgs$VisionArgs -Log `"$RootDir\logs\arranque-modelo.log`"" -WindowStyle Hidden
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

& node $Server --port $UiPort --llama-port $Port --prompt-cap $PromptCap @ThinkArgs --open
exit $LASTEXITCODE
