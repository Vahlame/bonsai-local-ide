# ==============================================================================
# Script de Arranque para Aider (Programacion Continua sin Cursor y Cero Basura)
# Conecta 100% local a http://127.0.0.1:8080/v1 sin tuneles ni internet
# ==============================================================================

param (
    [string]$ContextSize = "auto",   # auto = la VRAM libre; o un numero de tokens
    [int]$Port = 8080,
    [int]$MapTokens = 2048   # mapa del repo (Aider usa 1024 por defecto); con 64k de ventana sobra sitio
)

$RootDir = Split-Path -Parent $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Iniciando Aider AI Pair Programmer (RTX 4060 Local)    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verificar si llama-server esta corriendo
$serverState = & "$RootDir\scripts\stop-managed-server.ps1" -Port $Port -CheckOnly
if ($serverState -eq "empty") {
    # Comprobacion previa a la vista: si la VRAM no alcanza, el servidor minimizado fallaria sin que se vea
    & "$RootDir\scripts\start-server.ps1" -ContextSize $ContextSize -Port $Port -DryRun
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "[1/2] Iniciando llama-server en segundo plano (Contexto: $ContextSize)..." -ForegroundColor Green
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$RootDir\scripts\start-server.ps1`" -ManagedByIDE -ContextSize $ContextSize -Port $Port" -WindowStyle Hidden
} else {
    Write-Host "[1/2] Servidor llama-server detectado y activo." -ForegroundColor Green
}

# Esperar a que el modelo termine de cargar (antes eran 5 s fijos y el modelo tarda mas)
Write-Host "Esperando a que el modelo cargue en la GPU..." -ForegroundColor Gray
$deadline = (Get-Date).AddMinutes(3)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3
        if ($health.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ready) {
    Write-Error "El servidor no respondio en http://127.0.0.1:$Port/health"
    exit 1
}

# 2. Inicializar repositorio git EN LA CARPETA DEL PROYECTO. Antes miraba/creaba ".git" en la
#    carpeta ACTUAL: lanzado desde otro sitio creaba un repo ahi y Aider, con --auto-commits,
#    commiteaba en el proyecto equivocado.
if (-not (Test-Path (Join-Path $RootDir ".git"))) {
    Write-Host "Inicializando repositorio git local para control de versiones..." -ForegroundColor Gray
    git -C $RootDir init | Out-Null
}

Write-Host "[2/2] Lanzando Aider con 100% de contexto limpio..." -ForegroundColor Green
Write-Host "----------------------------------------------------------" -ForegroundColor Gray
Write-Host "  - Modelo: Ternary-Bonsai-2-27B (RTX 4060)" -ForegroundColor White
Write-Host "  - Conexion: 100% Directa a http://127.0.0.1:$Port/v1 (Sin tuneles)" -ForegroundColor White
Write-Host "  - Sobrecarga de herramientas/plugins: 0 TOKENS (Completamente limpio)" -ForegroundColor Green
Write-Host "  - Ventana declarada a Aider: 65536 tokens, mapa del repo: $MapTokens" -ForegroundColor Green
# La ventana REAL la decide la VRAM al arrancar el servidor (-ContextSize auto), no el 65536
# que declara scripts\aider\model-metadata.json. Aider presupuesta historial y mapa contra ese
# numero, asi que si no coincide se dice en vez de dejar que una peticion grande sea rechazada.
try {
    $props = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/props" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    $ventanaReal = [int]$props.default_generation_settings.n_ctx
    if ($ventanaReal -gt 0 -and $ventanaReal -ne 65536) {
        Write-Host "  - OJO: el servidor tiene $ventanaReal tokens de ventana, no 65536. Con prompts largos Aider puede pasarse." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  - No se pudo leer la ventana real del servidor (/props)." -ForegroundColor DarkGray
}
Write-Host "----------------------------------------------------------" -ForegroundColor Gray
Write-Host "Tip: Usa '/add archivo.py' para indicarle que archivo editar." -ForegroundColor Yellow
Write-Host "Tip: Usa '/exit' para salir cuando termines." -ForegroundColor Yellow
Write-Host ""

# Ejecutar Aider via uv
& uv tool run --python 3.12 --from aider-chat aider `
    --openai-api-base "http://127.0.0.1:$Port/v1" `
    --openai-api-key "none" `
    --model "openai/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0" `
    --model-metadata-file "$RootDir\scripts\aider\model-metadata.json" `
    --model-settings-file "$RootDir\scripts\aider\model-settings.yml" `
    --map-tokens $MapTokens `
    --no-show-model-warnings `
    --no-check-update `
    --auto-commits
if ($LASTEXITCODE -ne 0) {
    Write-Error "Aider termino con codigo $LASTEXITCODE"
    exit $LASTEXITCODE
}
