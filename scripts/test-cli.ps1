# ==============================================================================
# Script de Prueba y Benchmark de Velocidad (tokens/segundo) via CLI
# ==============================================================================

param (
    [string]$Prompt = "Escribe una funcion en Python que implemente un algoritmo de ordenamiento rapido (Quicksort) optimizado con explicacion breve.",
    [int]$MaxTokens = 512
)

$RootDir = Split-Path -Parent $PSScriptRoot
$BinPath = Join-Path $RootDir "bin\llama-cli.exe"
# El modelo lo dice chat\modelo.json (fuente unica, la misma que usa start-server.ps1): antes
# este script medía SIEMPRE el GGUF de respaldo aunque la app sirviera otro.
$M = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ModelPath = Join-Path $RootDir ("models\" + $M.modelo.archivo)

if (-not (Test-Path $BinPath)) {
    Write-Error "No se encontro bin\llama-cli.exe en: $BinPath"
    exit 1
}
if (-not (Test-Path $ModelPath)) {
    Write-Error "No se encontro el modelo GGUF en: $ModelPath"
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Benchmark de Inferencia Ternary-Bonsai-2-27B en RTX 4060 " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Modelo: $($M.modelo.archivo)" -ForegroundColor Gray
Write-Host "Prompt de prueba: '$Prompt'" -ForegroundColor Gray
Write-Host "Max tokens a generar: $MaxTokens" -ForegroundColor Gray
Write-Host ""

# --jinja: con la plantilla del propio GGUF, igual que el servidor (start-server.ps1). Sin
# esto, llama.cpp avisa de que solo soporta las plantillas mas comunes y lo que se mide puede
# no ser lo que sirve la app. -st responde una vez y termina; al final imprime los tokens/s.
# Sin razonamiento y con el muestreo que recomienda PrismML (chat\modelo.json, perfil codigo).
& $BinPath `
    -m $ModelPath `
    -ngl 99 `
    -c 4096 `
    --flash-attn on `
    --jinja `
    --reasoning off `
    -n $MaxTokens `
    --temp 0.5 --top-p 0.85 --top-k 20 --min-p 0 `
    -st `
    -p $Prompt
if ($LASTEXITCODE -ne 0) {
    Write-Error "llama-cli termino con codigo ${LASTEXITCODE}. El benchmark no es valido."
    exit $LASTEXITCODE
}
