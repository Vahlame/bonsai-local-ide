<#
.SYNOPSIS
    Abre el IDE en una ventana de aplicacion (sin barra de direcciones) y SIN GPU.

.DESCRIPTION
    El IDE es una pagina web servida por chat/ui-server.mjs. Abrirla en el navegador
    normal gasta GPU y compite por VRAM con llama-server. Este lanzador abre Edge/Chrome
    en modo aplicacion con rasterizado por software, de modo que la NVIDIA queda
    entera para el modelo.

    - Ventana propia: --app=URL, sin pestañas ni barra de direcciones.
    - Sin GPU: --disable-gpu, --disable-gpu-compositing, --disable-accelerated-2d-canvas
      y --disable-gpu-rasterization. Todo se pinta en CPU.
    - Perfil aislado: --user-data-dir en logs\ui-app-profile (no toca tu navegador).
    - 1920x1080: arranca maximizado; la interfaz es responsive hasta 980 px.

.PARAMETER Port
    Puerto de la interfaz (por defecto 8787).

.PARAMETER Tab
    Abre una pestaña normal en vez de una ventana de aplicacion (sigue sin GPU).

.PARAMETER AllowGpu
    Escape hatch: permite aceleracion por GPU. No recomendado con el modelo cargado.

.EXAMPLE
    .\scripts\open-ide.ps1
    .\scripts\open-ide.ps1 -Port 8788 -Tab
#>
param(
    [int]$Port = 8787,
    [switch]$Tab,
    [switch]$AllowGpu
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$url = "http://127.0.0.1:$Port"

function Get-Chromium {
    $cands = @(
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )
    foreach ($c in $cands) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    return ""
}

$exe = Get-Chromium
if (-not $exe) {
    # Sin Edge/Chrome: se abre el navegador por defecto. La UI sigue siendo la misma.
    Start-Process $url
    Write-Host "Navegador por defecto: $url" -ForegroundColor Yellow
    exit 0
}

# Perfil propio: no comparte cookies, sesiones ni extensiones con el navegador del usuario.
$profileDir = Join-Path $RootDir "logs\ui-app-profile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$flags = @(
    "--user-data-dir=$profileDir",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--start-maximized",
    "--window-size=1600,1000"
)

if (-not $AllowGpu) {
    # Rasterizado por software: cero VRAM de la NVIDIA para el IDE.
    $flags += @(
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu-rasterization",
        "--disable-zero-copy"
    )
}

$target = if ($Tab) { $url } else { "--app=$url" }
# La UI puede avisar de que corre en CPU (sin GPU) leyendo este parametro.
if (-not $AllowGpu) {
    $sep = if ($Tab) { "&" } else { "?" }
    $target = "$target$($sep)uicpu=1"
}
$flags += $target

$argumentLine = ($flags | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
$p = Start-Process -FilePath $exe -ArgumentList $argumentLine -PassThru
Write-Host "IDE abierto en $($exe | Split-Path -Leaf) (ventana $(if ($Tab) { 'pestana' } else { 'aplicacion' }), $(if ($AllowGpu) { 'GPU permitida' } else { 'CPU: sin GPU' }))" -ForegroundColor Green
Write-Host "  $url" -ForegroundColor Gray
