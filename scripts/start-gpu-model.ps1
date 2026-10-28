# Modelos con todos los tensores y KV en CUDA. Nunca reduce las capas a CPU.
# El perfil automatico (-ContextSize auto y/o -KVCacheType auto) busca la mejor combinacion
# contexto/KV que quepa en la VRAM libre y la recuerda en logs\perfil-servidor-PORT.json para
# que el siguiente arranque no vuelva en silencio a 16K/f16.
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
    [switch]$ManagedByIDE,
    # SOLO PRUEBAS: sustituye la VRAM libre medida por nvidia-smi. Se ignora sin -DryRun.
    [int]$FreeMiBOverride = 0
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

# VRAM libre: nvidia-smi es la fuente real. El override solo existe para pruebas DryRun
# deterministas sin GPU; en un arranque real se ignora.
$FreeMiB = 0
$UsandoOverride = $false
if ($FreeMiBOverride -gt 0) {
    if ($DryRun) {
        $FreeMiB = $FreeMiBOverride
        $UsandoOverride = $true
    } else {
        Write-Host "Aviso: -FreeMiBOverride se ignora en un arranque real; se mide la VRAM con nvidia-smi." -ForegroundColor Yellow
    }
}
if (-not $UsandoOverride) {
    $FreeOutput = & nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits
    if ($LASTEXITCODE -ne 0) { throw "No se pudo comprobar la VRAM libre. No se arranca sin verificar la GPU." }
    $FreeMiB = [int](@($FreeOutput)[0].Trim())
}

$GpuProfile = $Item.servidor
$VisionProfile = if ($Vision) { $Item.vision } else { $null }
$VisionMiB = 0
if ($Vision) {
    if (-not $VisionProfile.archivo -or -not $VisionProfile.offload -or -not $VisionProfile.contexto) { throw "Este perfil solo admite vision con proyector propio en GPU y un techo de contexto declarado." }
    $ProjectorPath = Join-Path $RootDir ("models\" + $VisionProfile.archivo)
    if (-not (Test-Path -LiteralPath $ProjectorPath) -or (Get-Item -LiteralPath $ProjectorPath).Length -ne [int64]$VisionProfile.bytes) { throw "Falta el proyector de vision verificado: $ProjectorPath" }
    $VisionMiB = [int]$VisionProfile.reservaMiB
}

$WeightsMiB = [math]::Ceiling([int64]$Item.bytes / 1MB)
function Get-RequiredMiB([int]$ContextTokens, [string]$CacheType) {
    $ElementBytes = [double]$Catalogo.kv.bytesPorElemento.$CacheType
    $CacheBytes = $ContextTokens * [double]$GpuProfile.capasAtencionCompleta * $GpuProfile.cabezasKV * $GpuProfile.dimCabeza * 2 * $ElementBytes
    return $WeightsMiB + [math]::Ceiling($CacheBytes / 1MB) + [int]$GpuProfile.reservaMiB + $VisionMiB
}

# Perfil elegido (solo modo automatico): se guarda para reutilizarlo si sigue cabiendo.
$PerfilPath = Join-Path $RootDir "logs\perfil-servidor-$Port.json"
$KvOrder = @($Catalogo.kv.orden)
$TechoContexto = [int]$GpuProfile.contexto
if ($Vision) { $TechoContexto = [math]::Min($TechoContexto, [int]$VisionProfile.contexto) }

function Write-PerfilElegido([int]$Contexto, [string]$CacheType) {
    try {
        $Perfil = [ordered]@{
            modelo = $Modelo; archivo = [string]$Item.archivo; puerto = $Port;
            contexto = $Contexto; kv = $CacheType; vision = [bool]$Vision;
            libreMiB = $FreeMiB; fecha = (Get-Date).ToUniversalTime().ToString("o")
        }
        New-Item -ItemType Directory -Force (Split-Path -Parent $PerfilPath) | Out-Null
        $Perfil | ConvertTo-Json -Compress | Set-Content -LiteralPath $PerfilPath -Encoding ASCII
    } catch {
        Write-Host "Aviso: no se pudo guardar el perfil elegido: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Get-PerfilRecordado {
    if (-not (Test-Path -LiteralPath $PerfilPath)) { return $null }
    try {
        $p = Get-Content -LiteralPath $PerfilPath -Raw | ConvertFrom-Json
        if (-not $p -or [string]$p.modelo -ne $Modelo -or [int]$p.puerto -ne $Port -or [bool]$p.vision -ne [bool]$Vision) { return $null }
        $Ctx = [int]$p.contexto
        $Kv = [string]$p.kv
        if ($Ctx -lt 8192 -or $Ctx -gt $TechoContexto -or ($Ctx % 4096) -ne 0) { return $null }
        if ($KvOrder -notcontains $Kv) { return $null }
        if ((Get-RequiredMiB $Ctx $Kv) -gt $FreeMiB) { return $null }
        return @{ contexto = $Ctx; kv = $Kv }
    } catch {
        return $null
    }
}

$AutoContexto = ($ContextSize -eq "auto")
$AutoKv = ($KVCacheType -eq "auto")
$PerfilOrigen = "explicito"
if (-not $AutoContexto) {
    $ContextFijo = [int]$ContextSize
    if ($ContextFijo -lt 4096 -or $ContextFijo -gt [int]$GpuProfile.contexto) { throw "Contexto admitido: 4096 a $($GpuProfile.contexto) tokens." }
}
if ($AutoContexto -or $AutoKv) {
    $ContextTokens = 0
    $KvType = $null
    $Recordado = $null
    if ($AutoContexto -and $AutoKv) { $Recordado = Get-PerfilRecordado }
    if ($Recordado) {
        $ContextTokens = [int]$Recordado.contexto
        $KvType = [string]$Recordado.kv
        $PerfilOrigen = "recordado"
    } else {
        $PerfilOrigen = "auto"
        $KvCandidatos = if ($AutoKv) { $KvOrder } else { @($KVCacheType) }
        if ($AutoContexto) {
            # Busca el contexto MAS GRANDE que quepa (pasos de 4096, desde el techo) y, en cada
            # uno, el KV mas preciso (f16 > q8_0 > q4_0). No se queda en 16K ni divide por dos.
            $Tope = [int]([math]::Floor($TechoContexto / 4096) * 4096)
            if ($Tope -lt 8192) { throw "El techo de contexto ($TechoContexto tokens) es menor que el minimo de 8192." }
            $Elegido = $false
            for ($Ctx = $Tope; $Ctx -ge 8192; $Ctx -= 4096) {
                foreach ($Kv in $KvCandidatos) {
                    if ((Get-RequiredMiB $Ctx $Kv) -le $FreeMiB) {
                        $ContextTokens = $Ctx
                        $KvType = $Kv
                        $Elegido = $true
                        break
                    }
                }
                if ($Elegido) { break }
            }
            if (-not $Elegido) {
                if ($AutoKv) {
                    $MinMiB = Get-RequiredMiB 8192 "q4_0"
                    throw "No cabe en la GPU ni la combinacion minima (8192 tokens, KV q4_0): pide ~$MinMiB MiB y hay $FreeMiB MiB libres. No se usa CPU como respaldo."
                }
                $MinMiB = Get-RequiredMiB 8192 $KVCacheType
                throw "No cabe en la GPU ni el contexto minimo (8192 tokens) con KV ${KVCacheType}: pide ~$MinMiB MiB y hay $FreeMiB MiB libres. No se usa CPU como respaldo."
            }
        } else {
            # Contexto fijo: se elige el KV mas preciso que quepa (si el KV tambien es auto).
            $ContextTokens = $ContextFijo
            foreach ($Kv in $KvCandidatos) {
                if ((Get-RequiredMiB $ContextTokens $Kv) -le $FreeMiB) { $KvType = $Kv; break }
            }
            if (-not $KvType) {
                $MinMiB = Get-RequiredMiB $ContextTokens "q4_0"
                throw "No cabe en la GPU el contexto fijo $ContextTokens con ningun KV: el mas ligero (q4_0) pide ~$MinMiB MiB y hay $FreeMiB MiB libres. No se usa CPU como respaldo."
            }
        }
        Write-PerfilElegido $ContextTokens $KvType
    }
} else {
    $ContextTokens = [int]$ContextSize
    $KvType = $KVCacheType
}
if ($ContextTokens -lt 4096 -or $ContextTokens -gt [int]$GpuProfile.contexto) { throw "Contexto admitido: 4096 a $($GpuProfile.contexto) tokens." }
$RequiredMiB = Get-RequiredMiB $ContextTokens $KvType
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
if ($PerfilOrigen -eq "recordado") {
    Write-Host "Perfil recordado para el puerto ${Port}: contexto $ContextTokens | KV $KvType (sigue cabiendo en la VRAM libre)." -ForegroundColor Cyan
} elseif ($PerfilOrigen -eq "auto") {
    Write-Host "Perfil automatico para el puerto ${Port}: contexto $ContextTokens | KV $KvType (el mas capaz que cabe)." -ForegroundColor Cyan
}
Write-Host "VRAM libre: $FreeMiB MiB; presupuesto conservador: $RequiredMiB MiB. Vision GPU: $Vision." -ForegroundColor Gray
Write-Host "Todos los tensores se fuerzan a CUDA0; ajuste de capas y cache en RAM desactivados." -ForegroundColor Gray

# Para Start-Process hace falta una sola cadena de argumentos; se entrecomillan los que tengan espacios.
function ConvertTo-ArgumentText([string]$Value) {
    if ($Value -match '^[^\s"]+$') { return $Value }
    return '"' + $Value.Replace('"', '\"') + '"'
}
$ArgumentLine = (($ServerArgs | ForEach-Object { ConvertTo-ArgumentText ([string]$_) }) -join ' ')
if ($DryRun) { Write-Host ($BinPath + " " + $ArgumentLine); exit 0 }

# Se lanza SIEMPRE con Start-Process -PassThru: el marcador guarda el PID real de llama-server.exe
# (el del lanzador esta en wrapperPid). Si el wrapper muere, stop-managed-server.ps1 puede cerrar
# el servidor huerfano sin tocar procesos ajenos. El marcador se escribe ANTES de lanzar (no hay
# ventana sin marcador, igual que antes) y se completa con el PID real en cuanto existe.
$Wrapper = Get-Process -Id $PID -ErrorAction Stop
$WrapperTicks = $Wrapper.StartTime.ToUniversalTime().Ticks.ToString()
$Marker = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
function Write-MarcadorAdministrado([int]$ServidorPid) {
    $Info = [ordered]@{
        modelo = $Modelo; puerto = $Port; contexto = $ContextTokens; kv = $KvType;
        vision = [bool]$Vision; pensar = $Pensar; dormir = $DormirSeg; hostIP = $HostIP;
        pid = $PID; wrapperPid = $PID; iniciado = $WrapperTicks
    }
    if ($ServidorPid -gt 0) {
        $Info.pidServidor = $ServidorPid
        $Info.iniciadoServidor = (Get-Process -Id $ServidorPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString()
    }
    New-Item -ItemType Directory -Force (Split-Path -Parent $Marker) | Out-Null
    $Info | ConvertTo-Json -Compress | Set-Content -LiteralPath $Marker -Encoding ASCII
}
if ($ManagedByIDE) {
    try { Write-MarcadorAdministrado 0 } catch { Write-Host "Aviso: no se pudo escribir el marcador del servidor administrado: $($_.Exception.Message)" -ForegroundColor Yellow }
}
$Exec = Start-Process -FilePath $BinPath -ArgumentList $ArgumentLine -PassThru -NoNewWindow
if ($ManagedByIDE) {
    try { Write-MarcadorAdministrado ([int]$Exec.Id) } catch { Write-Host "Aviso: no se pudo completar el marcador con el PID real de llama-server.exe: $($_.Exception.Message)" -ForegroundColor Yellow }
}
$ExitCode = 1
try {
    $Exec.WaitForExit()
    $ExitCode = [int]$Exec.ExitCode
} finally {
    if ($ManagedByIDE) {
        try {
            if (Test-Path -LiteralPath $Marker) {
                $Info = Get-Content -LiteralPath $Marker -Raw | ConvertFrom-Json
                $esMio = if ($Info.pidServidor) { [int]$Info.pidServidor -eq [int]$Exec.Id } else { [int]$Info.wrapperPid -eq $PID }
                if ($esMio) { Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue }
            }
        } catch { }
    }
}
exit $ExitCode
