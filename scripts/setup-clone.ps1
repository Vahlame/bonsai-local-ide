<#
.SYNOPSIS
    Prepara un clon de Bonsai IDE y abre la interfaz.

.DESCRIPTION
    Comprueba Node, instala las dependencias de la UI y busca un runtime de
    llama.cpp. Con -BuildRuntime descarga la toolchain y compila el build
    optimizado para la GPU detectada. Si no hay modelos, la propia interfaz
    ofrece el Model Hub al arrancar.

.EXAMPLE
    .\scripts\setup-clone.ps1
    .\scripts\setup-clone.ps1 -BuildRuntime
    .\scripts\setup-clone.ps1 -NoLaunch
#>
param(
    [switch]$BuildRuntime,
    [switch]$NoLaunch,
    [switch]$SkipDeps
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

function Paso([string]$texto) {
    Write-Host "`n== $texto ==" -ForegroundColor Cyan
}
function Bien([string]$texto) {
    Write-Host "[ok] $texto" -ForegroundColor Green
}
function Aviso([string]$texto) {
    Write-Host "[!] $texto" -ForegroundColor Yellow
}

Paso "Node.js"
try {
    $version = (& node --version).Trim()
} catch {
    throw "Node.js no esta instalado. Instala Node 22 o superior: https://nodejs.org/"
}
$mayor = [int](($version.TrimStart("v").Split("."))[0])
if ($mayor -lt 22) { throw "Se necesita Node.js 22 o superior (encontrado $version)." }
Bien "Node $version"

Paso "Dependencias de la interfaz"
if ($SkipDeps) {
    Aviso "Se omiten las dependencias por -SkipDeps."
} elseif (Test-Path -LiteralPath (Join-Path $Root "chat\node_modules")) {
    Bien "chat\node_modules ya existe."
} else {
    & npm ci --prefix chat
    if ($LASTEXITCODE -ne 0) { throw "npm ci fallo. Revisa la conexion o ejecuta npm ci --prefix chat a mano." }
    Bien "Dependencias instaladas en chat\node_modules."
}

Paso "Runtime de llama.cpp"
function Buscar-Runtime {
    $candidatos = @(
        (Join-Path $Root ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe"),
        (Join-Path $env:USERPROFILE ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe"),
        (Join-Path $Root "bin\llama-server.exe")
    )
    foreach ($candidato in $candidatos) {
        if (Test-Path -LiteralPath $candidato) { return $candidato }
    }
    return ""
}

$runtime = Buscar-Runtime
if (-not $runtime -and $BuildRuntime) {
    Paso "Toolchain CUDA"
    if (-not (Test-Path -LiteralPath (Join-Path $Root "config\inference-toolchain.local.json"))) {
        & node scripts/install-inference-tools.mjs --threads 12
        if ($LASTEXITCODE -ne 0) { throw "La instalacion de la toolchain fallo." }
    } else {
        Bien "config\inference-toolchain.local.json ya existe."
    }
    Paso "Compilando llama.cpp (puede tardar ~20 min)"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\build-rtx4060-optimized.ps1")
    if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo. Revisa docs\RTX4060_OPTIMIZATION_GUIDE.md." }
    $runtime = Buscar-Runtime
}

if ($runtime) {
    Bien $runtime
} else {
    Aviso "No hay llama-server.exe en bin\ ni en .local\opt\bonsai-inference\."
    Write-Host "  Opcion A (recomendada): .\scripts\setup-clone.ps1 -BuildRuntime" -ForegroundColor Gray
    Write-Host "  Opcion B: copia un build CUDA de llama.cpp en bin\ (llama-server.exe + DLLs)." -ForegroundColor Gray
    Write-Host "  La interfaz se abrira igual: puedes descargar modelos, pero sin runtime no habra inferencia." -ForegroundColor Gray
}

Paso "Modelos"
$modelosDir = Join-Path $Root "models"
$ggufs = @(Get-ChildItem -LiteralPath $modelosDir -Filter "*.gguf" -File -ErrorAction SilentlyContinue)
if ($ggufs.Count -eq 0) {
    Aviso "Todavia no hay GGUF en models\."
    Write-Host "  Al abrir, la UI pregunta que modelo cargar y ofrece el Model Hub para descargar" -ForegroundColor Gray
    Write-Host "  el catalogo curado o importar un archivo local." -ForegroundColor Gray
} else {
    Bien "$($ggufs.Count) archivo(s) GGUF en models\."
}

if ($NoLaunch) {
    Write-Host "`nListo. Abre el IDE con: .\scripts\bonsai-rtx4060.ps1 launch" -ForegroundColor Cyan
    exit 0
}

Paso "Abriendo el IDE"
& (Join-Path $PSScriptRoot "bonsai-rtx4060.ps1") launch
exit $LASTEXITCODE
