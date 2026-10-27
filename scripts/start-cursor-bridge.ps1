# ==============================================================================
# Script de Puente para Cursor IDE (Servidor Local + Tunel Cloudflare)
# Captura y COPIA AUTOMATICAMENTE la URL al portapapeles de Windows
# ==============================================================================

param (
    [string]$ContextSize = "auto",   # auto = la VRAM libre; o un numero de tokens
    [int]$Port = 8080
)

$RootDir = Split-Path -Parent $PSScriptRoot
$Cloudflared = Join-Path $RootDir "bin\cloudflared.exe"
$UrlFile = Join-Path $RootDir "URL-CURSOR.txt"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Iniciando Puente Local AI para Cursor IDE (RTX 4060)   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 0. El binario del tunel: era el UNICO lanzador que no lo comprobaba y, si faltaba, el
#    error saltaba DESPUES de haber cargado 5,9 GB de modelo en la GPU.
if (-not (Test-Path $Cloudflared)) {
    Write-Error "No esta bin\cloudflared.exe. Descargalo de https://github.com/cloudflare/cloudflared/releases y guardalo en bin\."
    exit 1
}

# 1. Iniciar llama-server si no esta corriendo
$serverState = & "$RootDir\scripts\stop-managed-server.ps1" -Port $Port -CheckOnly
if ($serverState -eq "empty") {
    # Comprobacion previa a la vista: si la VRAM no alcanza, el servidor minimizado fallaria sin que se vea
    & "$RootDir\scripts\start-server.ps1" -ContextSize $ContextSize -Port $Port -DryRun
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "[1/2] Iniciando llama-server (Contexto: $ContextSize tokens)..." -ForegroundColor Green
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$RootDir\scripts\start-server.ps1`" -ManagedByIDE -ContextSize $ContextSize -Port $Port" -WindowStyle Hidden
} else {
    Write-Host "[1/2] llama-server ya se encuentra en ejecucion." -ForegroundColor Yellow
}

# Espera REAL a que el servidor conteste (antes eran 4 s fijos y el modelo tarda mas: se
# anunciaba la URL mientras las peticiones de Cursor fallaban).
Write-Host "Esperando a que el modelo cargue..." -ForegroundColor Gray
$finSalud = (Get-Date).AddMinutes(3)
$listo = $false
while ((Get-Date) -lt $finSalud) {
    try {
        $salud = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3
        if ($salud.StatusCode -eq 200) { $listo = $true; break }
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $listo) {
    Write-Error "El servidor no respondio en http://127.0.0.1:$Port/health. No se crea el tunel."
    exit 1
}

# 2. Iniciar el tunel Cloudflare y capturar la URL
Write-Host "[2/2] Creando tunel seguro Cloudflare..." -ForegroundColor Green
Write-Host "Generando tu URL segura..." -ForegroundColor Gray

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $Cloudflared
$processInfo.Arguments = "tunnel --url http://127.0.0.1:$Port"
$processInfo.RedirectStandardError = $true
# stdout NO se redirige: si se redirige y nadie lo drena, el WaitForExit() se queda
# bloqueado para siempre (el interbloqueo clasico de .NET con los dos pipes llenos).
$processInfo.RedirectStandardOutput = $false
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $false

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $processInfo
$proc.Start() | Out-Null

$tunnelUrl = $null
$finUrl = (Get-Date).AddSeconds(60)

# Lectura con deadline de verdad: ReadLine() a secas bloquea y la ventana se quedaba en
# "Generando tu URL segura..." para siempre si cloudflared no imprimia nada.
while (-not $proc.HasExited -and (Get-Date) -lt $finUrl -and -not $tunnelUrl) {
    if (-not $script:pendienteLectura) { $script:pendienteLectura = $proc.StandardError.ReadLineAsync() }
    if (-not $script:pendienteLectura.Wait(1500)) { continue }
    $line = $script:pendienteLectura.Result
    $script:pendienteLectura = $null
    if (-not $line) { continue }
    if ($line -match "(https://[a-zA-Z0-9-]+\.trycloudflare\.com)") {
        $tunnelUrl = $matches[1] + "/v1"

        # Guardar en archivo
        Set-Content -Path $UrlFile -Value $tunnelUrl -Force

        # Copiar directo al portapapeles
        try {
            Set-Clipboard -Value $tunnelUrl
            $copied = $true
        } catch {
            $copied = $false
        }

        Write-Host ""
        Write-Host "######################################################################" -ForegroundColor Green
        Write-Host "  ¡URL GENERADA CON EXITO!" -ForegroundColor Green
        Write-Host "######################################################################" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Tu URL para Cursor es:" -ForegroundColor White
        Write-Host "  $tunnelUrl" -ForegroundColor Cyan -BackgroundColor Black
        Write-Host ""
        if ($copied) {
            Write-Host "  [+] YA ESTA COPIADA EN TU PORTAPAPELES. Solo presiona Ctrl + V en Cursor." -ForegroundColor Yellow
        }
        Write-Host "  [+] Tambien guardada en: $UrlFile" -ForegroundColor Gray
        Write-Host ""
        Write-Host "######################################################################" -ForegroundColor Green
        Write-Host "Manten esta ventana abierta mientras programes en Cursor." -ForegroundColor Gray
        Write-Host "Presiona CTRL+C cuando termines tu sesion de trabajo." -ForegroundColor Gray
        Write-Host "######################################################################" -ForegroundColor Green
        Write-Host ""
    }
}

if (-not $tunnelUrl) {
    Write-Error "Cloudflare no devolvio ninguna URL en 60 s. Revisa la red, el DNS o el firewall. No queda ningun tunel abierto."
    try { if (-not $proc.HasExited) { $proc.Kill() } } catch { }
    exit 1
}

# Continuar mostrando logs o esperando
$proc.WaitForExit()
