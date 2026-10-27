# Modelos con todos los tensores y KV en CUDA. Nunca reduce las capas a CPU.
param (
    [Parameter(Mandatory=$true)][string]$Modelo,
    [string]$ContextSize = "auto",
    [int]$Port = 8080,
    [string]$HostIP = "127.0.0.1",
    [ValidateSet("auto", "f16", "q8_0", "q4_0")][string]$KVCacheType = "auto",
    [int]$Pensar = 0,
    [int]$DormirSeg = 0,
    [switch]$Vision,
    [switch]$DryRun,
    [switch]$ManagedByIDE
)
$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$Catalogo = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Item = $Catalogo.catalogo.$Modelo
if (-not $Item -or $Item.servidor.tipo -ne "gpu-completa") { throw "Modelo sin perfil de GPU completa: $Modelo" }
$ModelPath = Join-Path $RootDir ("models\" + $Item.archivo)
$BinPath = Join-Path $RootDir "bin\llama-server.exe"
if (-not (Test-Path -LiteralPath $ModelPath)) { throw "Falta el modelo: $ModelPath" }
if ((Get-Item -LiteralPath $ModelPath).Length -ne [int64]$Item.bytes) { throw "El modelo no tiene el tamano verificado; descarga incompleta." }
if (-not $DryRun -and @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) { throw "El puerto $Port ya esta ocupado. No se modifican servidores ajenos." }
$FreeOutput = & nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits
if ($LASTEXITCODE -ne 0) { throw "No se pudo comprobar la VRAM libre. No se arranca sin verificar la GPU." }
$FreeMiB = [int](@($FreeOutput)[0].Trim())
$GpuProfile = $Item.servidor
$VisionProfile = if ($Vision) { $Item.vision } else { $null }
$VisionMiB = 0
if ($Vision) {
    if (-not $VisionProfile.archivo -or -not $VisionProfile.offload) { throw "Este perfil solo admite vision con proyector propio en GPU." }
    $ProjectorPath = Join-Path $RootDir ("models\" + $VisionProfile.archivo)
    if (-not (Test-Path -LiteralPath $ProjectorPath) -or (Get-Item -LiteralPath $ProjectorPath).Length -ne [int64]$VisionProfile.bytes) { throw "Falta el proyector de vision verificado: $ProjectorPath" }
    $VisionMiB = [int]$VisionProfile.reservaMiB
}
$KvType = if ($KVCacheType -eq "auto") { "f16" } else { $KVCacheType }
$ElementBytes = [double]$Catalogo.kv.bytesPorElemento.$KvType
$WeightsMiB = [math]::Ceiling([int64]$Item.bytes / 1MB)
function Get-RequiredMiB([int]$ContextTokens) {
    $CacheBytes = $ContextTokens * [double]$GpuProfile.capasAtencionCompleta * $GpuProfile.cabezasKV * $GpuProfile.dimCabeza * 2 * $ElementBytes
    return $WeightsMiB + [math]::Ceiling($CacheBytes / 1MB) + [int]$GpuProfile.reservaMiB + $VisionMiB
}
$ContextTokens = if ($ContextSize -eq "auto") { [int]$GpuProfile.contexto } else { [int]$ContextSize }
if ($Vision -and $ContextSize -eq "auto") { $ContextTokens = [math]::Min($ContextTokens, [int]$VisionProfile.contexto) }
if ($ContextTokens -lt 4096 -or $ContextTokens -gt [int]$GpuProfile.contexto) { throw "Contexto admitido: 4096 a $($GpuProfile.contexto) tokens." }
if ($ContextSize -eq "auto") {
    while ($ContextTokens -gt 8192 -and (Get-RequiredMiB $ContextTokens) -gt $FreeMiB) { $ContextTokens = [int]($ContextTokens / 2) }
}
$RequiredMiB = Get-RequiredMiB $ContextTokens
if ($RequiredMiB -gt $FreeMiB) { throw "No cabe todo en GPU: hacen falta ~$RequiredMiB MiB y hay $FreeMiB MiB libres. No se usa CPU como respaldo." }
$SampleProfile = if ($Pensar -gt 0) { "razonar" } else { "codigo" }
$Sampling = $Item.muestreo.$SampleProfile
$Invariant = [Globalization.CultureInfo]::InvariantCulture
function NumberText($Value) { return ([double]$Value).ToString($Invariant) }
$ServerArgs = @(
    "-m", $ModelPath,
    "--gpu-layers", "all", "--override-tensor", ".*=CUDA0", "--fit", "off",
    "--no-host", "--kv-offload", "--load-mode", "none", "--flash-attn", "on",
    "-c", "$ContextTokens", "-ctk", $KvType, "-ctv", $KvType,
    "-np", "1", "-b", "512", "-ub", "$($GpuProfile.ubatch)", "-t", "4",
    "--host", $HostIP, "--port", "$Port", "--jinja", "--metrics", "--cache-ram", "0", "-lv", "4",
    "--cors-origins", "http://127.0.0.1:$Port,http://localhost:$Port,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:8788,http://localhost:8788",
    "--temp", (NumberText $Sampling.temperature), "--top-p", (NumberText $Sampling.top_p),
    "--top-k", "$($Sampling.top_k)", "--min-p", (NumberText $Sampling.min_p),
    "--presence-penalty", (NumberText $Sampling.presence_penalty), "--repeat-penalty", (NumberText $Sampling.repeat_penalty)
)
if ($Pensar -gt 0) { $ServerArgs += @("--reasoning-budget", "$Pensar", "--reasoning-format", "deepseek") }
else { $ServerArgs += @("--reasoning", "off") }
if ($Vision) { $ServerArgs += @("--mmproj", $ProjectorPath, "--mmproj-offload", "--mmproj-device", "CUDA0", "--image-max-tokens", "$($VisionProfile.imageMaxTokens)") }
if ($DormirSeg -gt 0) { $ServerArgs += @("--sleep-idle-seconds", "$DormirSeg") }
Remove-Item Env:GGML_CUDA_ENABLE_UNIFIED_MEMORY -ErrorAction SilentlyContinue
Remove-Item Env:LLAMA_ATTN_ROT_DISABLE -ErrorAction SilentlyContinue
Write-Host "Modelo: $($Item.nombre) | GPU completa | contexto $ContextTokens | KV $KvType" -ForegroundColor Green
Write-Host "VRAM libre: $FreeMiB MiB; presupuesto conservador: $RequiredMiB MiB. Vision GPU: $Vision." -ForegroundColor Gray
Write-Host "Todos los tensores se fuerzan a CUDA0; ajuste de capas y cache en RAM desactivados." -ForegroundColor Gray
if ($DryRun) { Write-Host ($BinPath + " " + ($ServerArgs -join " ")); exit 0 }
if ($ManagedByIDE) {
    # Solo los lanzamientos independientes y explícitos de la app son administrables.
    # El PID y la fecha se verifican junto con el ejecutable hijo y el puerto al detener.
    $Marker = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
    New-Item -ItemType Directory -Force (Split-Path -Parent $Marker) | Out-Null
    $Owner = Get-Process -Id $PID -ErrorAction Stop
    @{ pid = $PID; iniciado = $Owner.StartTime.ToUniversalTime().Ticks.ToString(); puerto = $Port;
       modelo = $Modelo; contexto = $ContextTokens; kv = $KvType; vision = [bool]$Vision; pensar = $Pensar; dormir = $DormirSeg; hostIP = $HostIP } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath $Marker -Encoding ASCII
}
& $BinPath @ServerArgs
exit $LASTEXITCODE
