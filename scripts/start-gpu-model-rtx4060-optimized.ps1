<#
.SYNOPSIS
    RTX 4060 8GB optimized llama-server launcher (llama.cpp v0.8.0+, sm89 build).

.DESCRIPTION
    Single source of truth for launching the optimized server. Reads the preset
    from config/local-engine-presets-rtx4060-optimized.json and the model from
    chat/modelo.json, builds the llama-server argument line and launches it with
    the EXACT lifecycle that the rest of the project relies on:

        Start-Process -NoNewWindow -PassThru  +  WaitForExit()

    The wrapper normally stays alive while llama-server runs. The marker records
    both identities so a later stop can also recover a child whose wrapper died.
    Node launches this script with windowsHide:true and without detached:true.

.NOTES
    - Designed to be spawned from chat/lifecycle/process-adapter.mjs.
    - Writes logs/servidor-administrado-<port>.json so stop-managed-server.ps1
      can find and stop exactly this process (never foreign servers).
    - The chat template from chat/modelo.json is written to a .jinja file and
      passed with --chat-template-file (inline --chat-template breaks on quotes).
#>

param (
    [switch]$Json,
    [Parameter(Mandatory = $true)][string]$Modelo,
    [string]$ContextSize = "auto",
    [int]$Port = 8080,
    [string]$HostIP = "127.0.0.1",
    [ValidateSet("auto", "f16", "bf16", "q8_0", "q4_0")][string]$KVCacheType = "auto",
    [int]$Pensar = 0,
    [ValidateSet("", "default", "minimal", "low", "medium", "high", "xhigh")][string]$PensarNivel = "",
    [int]$DormirSeg = 0,
    [switch]$Vision,
    [switch]$MmprojCPU,
    [switch]$Precargar,
    [int]$GpuExtra = 0,
    [switch]$ContextoExplicito,
    [switch]$DryRun,
    [switch]$ManagedByIDE,
    [string]$EnginePreset = "",
    [int]$FreeMiBOverride = 0,
    [int]$MarginOverrideMiB = -1,
    [string]$DraftModel = "",
    [int]$DraftTokens = 4,
    [string]$Log = ""
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'managed-server-common.ps1')
if ($Json) {
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    function Write-Host { param($Object, $ForegroundColor, $BackgroundColor, [switch]$NoNewline, $Separator) }
}
trap {
    if ($Json) { @{ ok = $false; state = 'error'; port = $Port; error = $_.Exception.Message; detail = $_.ScriptStackTrace } | ConvertTo-Json -Compress; exit 1 }
    break
}


if ($Log -and -not $Json) {
    try { Start-Transcript -Path $Log -Append -Force | Out-Null } catch { }
}

# =============================================================================
# PRESET
# =============================================================================
$PresetPath = Join-Path $RootDir "config\local-engine-presets-rtx4060-optimized.json"
$Presets = Get-Content -LiteralPath $PresetPath -Raw | ConvertFrom-Json

$EngineOptions = $null
$SafetyMiB = if ($MarginOverrideMiB -ge 0) { $MarginOverrideMiB } else { 200 }
$SpeculativeDecoding = $false
$DraftModelPath = ""
$DraftMiB = 0
$DraftTokensCount = 4
$Batch = 512
$UBatch = 256
$ProjectorCPU = $false

if ($EnginePreset -and $EnginePreset -ne 'CUSTOM') {
    $EngineOptions = $Presets.$EnginePreset
    if (-not $EngineOptions) { throw "Preset de motor desconocido: $EnginePreset" }
    if ($ContextSize -eq "auto") { $ContextSize = [string]$EngineOptions.context }
    if ($KVCacheType -eq "auto") { $KVCacheType = [string]$EngineOptions.kv }
    if ($PSBoundParameters.ContainsKey('EngineOptions')) { }
    $SafetyMiB = if ($MarginOverrideMiB -ge 0) { $MarginOverrideMiB } else { [int]$EngineOptions.marginMiB }
    if (-not $PSBoundParameters.ContainsKey('Vision')) { $Vision = [bool]$EngineOptions.vision }
    $ProjectorCPU = [bool]$EngineOptions.mmprojCPU
    $Batch = [int]$EngineOptions.batch
    $UBatch = [int]$EngineOptions.ubatch
    if ($EngineOptions.spec -eq "draft") {
        $SpeculativeDecoding = $true
        $DraftModelPath = Join-Path $RootDir ("models\" + $EngineOptions.draftModel)
        $DraftTokensCount = [int]$EngineOptions.draftTokens
    }
} elseif ($EnginePreset -eq 'CUSTOM') {
    if ($KVCacheType -eq "auto") { $KVCacheType = "f16" }
} else {
    if ($ContextSize -eq "auto") { $ContextSize = "16384" }
    if ($KVCacheType -eq "auto") { $KVCacheType = "q4_0" }
}

if ($MarginOverrideMiB -ge 0) { $SafetyMiB = $MarginOverrideMiB }

# =============================================================================
# MODEL + BINARY
# =============================================================================
$Catalogo = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
# Model Hub: los modelos descargados viven en models/hub-catalog.json. Se fusionan
# aquí para que este lanzador (y el registro de parada) los trate como modelos más.
$HubPath = Join-Path $RootDir "models\hub-catalog.json"
if (Test-Path -LiteralPath $HubPath) {
    try {
        $Hub = Get-Content -LiteralPath $HubPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($prop in $Hub.modelos.PSObject.Properties) {
            if ($prop.Name -like "_*") { continue }
            if (-not $Catalogo.catalogo.PSObject.Properties[$prop.Name]) {
                $Catalogo.catalogo | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value
            }
        }
    } catch {
        Write-Host "Aviso: no se pudo leer models/hub-catalog.json: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
$Item = $Catalogo.catalogo.$Modelo
if (-not $Item -or ($Item.servidor.tipo -ne "gpu-completa" -and $Item.servidor.tipo -ne "moe-hibrido" -and $Item.servidor.tipo -ne "gpu-parcial")) {
    throw "Modelo sin perfil de GPU completa, MoE híbrido ni GPU parcial: $Modelo"
}
$EsMoe = $Item.servidor.tipo -eq "moe-hibrido"
# Denso más grande que la VRAM: una parte de las capas vive en RAM. El perfil
# declara cuántas capas caben (ngl) y cuántos MiB ocupan en la GPU.
$EsParcial = $Item.servidor.tipo -eq "gpu-parcial"
$NGpuLayers = 99
if ($EsParcial) {
    $NGpuLayers = [int]$Item.servidor.ngl
    if ($NGpuLayers -le 0 -or $NGpuLayers -ge 512) { throw "Perfil gpu-parcial sin ngl válido: $Modelo" }
}
# Measured, machine-specific MoE split table. It is used only for MoE models
# and only when the file exists; the old estimator remains the fallback.
$MeasuredMoePath = Join-Path $RootDir "config\measured-moe-profiles.json"
$MeasuredMoe = $null
if (Test-Path -LiteralPath $MeasuredMoePath) {
    try { $MeasuredMoe = Get-Content -LiteralPath $MeasuredMoePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {
        Write-Host "Aviso: no se pudo leer measured-moe-profiles.json: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
function Get-MeasuredMoeEntry([string]$Key) {
    if (-not $MeasuredMoe -or -not $MeasuredMoe.models) { return $null }
    $prop = $MeasuredMoe.models.PSObject.Properties[$Key]
    if (-not $prop) { return $null }
    return $prop.Value
}
$MeasuredMoeEntry = if ($EsMoe) { Get-MeasuredMoeEntry ([string]$Item.clave) } else { $null }
# Dense models also have a planned KV. An explicit context must not silently
# downgrade a near-lossless q8_0 plan to q4_0.
if ($Item.plan -and $Item.plan.kv -and -not $PSBoundParameters.ContainsKey('KVCacheType')) {
    $KVCacheType = [string]$Item.plan.kv
}
# For a dense model at a short explicit context, f16 KV is both faster and
# higher quality than the q8_0 plan that exists to maximize the auto context.
if (-not $EsMoe -and $ContextoExplicito -and $ContextSize -ne 'auto' -and [int]$ContextSize -le 16384 -and -not $PSBoundParameters.ContainsKey('KVCacheType')) {
    $KVCacheType = 'f16'
}
# En MoE manda el plan del modelo, no el preset denso: un preset de 110k deja
# casi toda la VRAM en KV y muy pocos expertos en la GPU. El plan ya calculó
# contexto, KV y reparto para ESTE GGUF.
if ($EsMoe -and $Item.plan) {
    if (-not $ContextoExplicito) {
        if ($Item.plan.contexto) { $ContextSize = [string]$Item.plan.contexto }
    }
    if ($Item.plan.kv -and -not $PSBoundParameters.ContainsKey('KVCacheType')) { $KVCacheType = [string]$Item.plan.kv }
    if ($null -ne $Item.plan.mmprojCPU) { $ProjectorCPU = [bool]$Item.plan.mmprojCPU }
    if ($Item.servidor.batch) { $Batch = [int]$Item.servidor.batch }
    if ($Item.servidor.ubatch) { $UBatch = [int]$Item.servidor.ubatch }
    if ($Item.plan.margenMiB) { $SafetyMiB = [int]$Item.plan.margenMiB }
}
$ModelPath = Join-Path $RootDir ("models\" + $Item.archivo)
if (-not (Test-Path -LiteralPath $ModelPath)) { throw "Falta el modelo: $ModelPath" }
if ([int64]$Item.bytes -gt 0 -and (Get-Item -LiteralPath $ModelPath).Length -ne [int64]$Item.bytes) {
    throw "El modelo no tiene el tamano verificado; descarga incompleta."
}

$Binaries = @(Get-BonsaiBinaries | Where-Object { Test-Path -LiteralPath $_.exe })
# Un modelo puede exigir una build concreta (Qwen3.8 necesita master: DeltaNet
# CUDA corregido y `--spec-type draft-mtp`). Si no, se mantiene el orden del
# registro, que conserva el binario optimizado como predeterminado.
$PreferredBinaryId = if ($Item.servidor.binario) { [string]$Item.servidor.binario } else { "" }
$Binary = if ($PreferredBinaryId) { $Binaries | Where-Object { $_.id -eq $PreferredBinaryId } | Select-Object -First 1 } else { $null }
if (-not $Binary) {
    if ($PreferredBinaryId) { throw "El modelo $Modelo exige el binario '$PreferredBinaryId' y no está disponible" }
    $Binary = $Binaries | Select-Object -First 1
}
if (-not $Binary) { throw "No hay binario llama-server permitido disponible" }
$BinPath = $Binary.exe
$UsingOptimized = ($BinPath -like "*build-RTX4060-Opt-sm89*") -or ($BinPath -like "*lab-server-mvq2*")
$Threads = 4
# Perfil del modelo (Hub): batch/ubatch/hilos medidos o recomendados. En presets
# nombrados manda el preset; para CUSTOM/AUTO manda el modelo.
if (($EnginePreset -eq 'CUSTOM' -or $EsParcial -or -not $EnginePreset) -and $Item.servidor) {
    # En `gpu-parcial` el perfil medido manda aunque el IDE haya emparejado un
    # preset por contexto/KV: 16 hilos son el óptimo medido para este denso.
    if ($Item.servidor.batch) { $Batch = [int]$Item.servidor.batch }
    if ($Item.servidor.ubatch) { $UBatch = [int]$Item.servidor.ubatch }
    if ($Item.servidor.threads) { $Threads = [int]$Item.servidor.threads }
}
# CUSTOM/AUTO: el plan del modelo decide si el proyector vive en CPU. En los
# presets nombrados manda el preset (`mmprojCPU`).
if (($EnginePreset -eq 'CUSTOM' -or -not $EnginePreset) -and $Item.vision -and $Item.vision.offload -eq $false) {
    $ProjectorCPU = $true
}
if ($MmprojCPU) { $ProjectorCPU = $true }
# Draft explícito por parámetro (model-lab y pruebas). Si el preset ya lo puso,
# no se toca; si viene vacío, se ignora.
# Draft del propio modelo (Model Hub): si no se pasó -DraftModel, se usa el
# que declara su perfil. Así el plan de VRAM y el arranque van en el mismo sitio.
if (-not $DraftModel -and $Item.servidor -and $Item.servidor.draftModel) {
    $DraftModel = [string]$Item.servidor.draftModel
    if ($Item.servidor.draftTokens) { $DraftTokens = [int]$Item.servidor.draftTokens }
}
if ($DraftModel) {
    $DraftModelPath = if ([IO.Path]::IsPathRooted($DraftModel)) { $DraftModel } else { Join-Path $RootDir ("models\" + $DraftModel) }
    $SpeculativeDecoding = Test-Path -LiteralPath $DraftModelPath
    if (-not $SpeculativeDecoding) { Write-Host "Aviso: no existe el borrador $DraftModelPath" -ForegroundColor Yellow }
}
if ($SpeculativeDecoding -and (Test-Path -LiteralPath $DraftModelPath)) {
    $DraftMiB = [math]::Ceiling((Get-Item -LiteralPath $DraftModelPath).Length / 1MB)
}

# =============================================================================
# VRAM
# =============================================================================
$GpuProfile = $Item.servidor
$WeightsMiB = [math]::Ceiling([int64]$Item.bytes / 1MB)
$IsMoe = $GpuProfile.tipo -eq "moe-hibrido" -and $null -ne $GpuProfile.moe
$LoadMode = if ($IsMoe) { [string]$GpuProfile.moe.loadMode } else { "auto" }
if (-not $LoadMode) { $LoadMode = "mmap" }
if ($IsMoe) {
    # Solo los pesos densos (atención, embeddings, router) van a la GPU. Los
    # expertos se reparten más abajo con la VRAM que sobre tras el KV.
    $DensosMiB = [int]$GpuProfile.moe.densosMiB
    if ($DensosMiB -le 0) {
        $DensosMiB = [math]::Max(1, $WeightsMiB - [int]$GpuProfile.moe.expertosMiB)
    }
    $WeightsMiB = $DensosMiB
}
if ($EsParcial) {
    # Solo los pesos que de verdad van a la GPU cuentan contra la VRAM; el resto
    # se queda en RAM (mmap) y no debe reducir el contexto calculado.
    if (-not $Item.servidor.pesosGpuEstandarMiB) { throw "Perfil gpu-parcial sin pesosGpuEstandarMiB: $Modelo" }
    $WeightsMiB = [int]$Item.servidor.pesosGpuEstandarMiB
} elseif (($EngineOptions -or $EnginePreset -eq 'CUSTOM') -and $Item.servidor.pesosGpuEstandarMiB) {
    $WeightsMiB = [int]$Item.servidor.pesosGpuEstandarMiB
}

$KvBytesPerElement = @{
    "f16"  = 2.0; "bf16" = 2.0; "q8_0" = 1.0; "q4_0" = 0.5;
}
$ElementBytes = $KvBytesPerElement[$KVCacheType]
if (-not $ElementBytes) { throw "Tipo de KV no soportado: $KVCacheType. Use: f16, bf16, q8_0, q4_0" }

$VisionProfile = if ($Vision) { $Item.vision } else { $null }
$VisionMiB = 0
$ProjectorPath = ""
if ($Vision) {
    if (-not $VisionProfile.archivo -or -not $VisionProfile.contexto) {
        throw "Este perfil no admite vision con proyector en GPU."
    }
    $ProjectorPath = Join-Path $RootDir ("models\" + $VisionProfile.archivo)
    if (-not (Test-Path -LiteralPath $ProjectorPath)) {
        throw "Falta el proyector de vision verificado: $ProjectorPath"
    }
    if ([int64]$VisionProfile.bytes -gt 0 -and (Get-Item -LiteralPath $ProjectorPath).Length -ne [int64]$VisionProfile.bytes) {
        throw "El proyector de vision no tiene el tamano verificado."
    }
    # Con -mmprojCPU el proyector vive en RAM: libera ~879 MiB de VRAM (permite ~110k
    # con q8_0) pero cada imagen se codifica en CPU (mas lento). Sin el flag, GPU.
    $VisionMiB = if ($ProjectorCPU) { 0 } else { [int]$VisionProfile.reservaMiB }
}

function Get-RequiredMiB([int]$ContextTokens, [string]$CacheType) {
    $bytes = $KvBytesPerElement[$CacheType]
    # Los modelos del Hub traen la suma REAL por capa (K+V, f16) leída del GGUF.
    # Se escala a la cuantización elegida; es más exacta que layers × heads × dim.
    if ($GpuProfile.kvF16BytesPorToken) {
        $cacheBytes = $ContextTokens * ([double]$GpuProfile.kvF16BytesPorToken) * ($bytes / 2.0)
        if ($GpuProfile.kvFijoF16Bytes) { $cacheBytes += [double]$GpuProfile.kvFijoF16Bytes * ($bytes / 2.0) }
    } else {
        $cacheBytes = $ContextTokens * [double]$GpuProfile.capasAtencionCompleta * $GpuProfile.cabezasKV * $GpuProfile.dimCabeza * 2 * $bytes
    }
    return $WeightsMiB + [math]::Ceiling($cacheBytes / 1MB) + [int]$GpuProfile.reservaMiB + $VisionMiB + $DraftMiB + $SafetyMiB
}

$FreeMiB = 0
$UsandoOverride = $false
if ($FreeMiBOverride -gt 0 -and $DryRun) {
    $FreeMiB = $FreeMiBOverride
    $UsandoOverride = $true
}
if (-not $UsandoOverride) {
    $FreeOutput = & nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits
    if ($LASTEXITCODE -ne 0) { throw "No se pudo comprobar la VRAM libre." }
    $FreeMiB = [int](@($FreeOutput)[0].Trim())
}

$TechoContexto = [int]$GpuProfile.contexto
if ($IsMoe -and $ContextSize -eq "auto" -and $GpuProfile.moe.ctxTope) {
    # El plan MoE reserva VRAM para expertos; el contexto "auto" no debe comerse
    # esa VRAM. Con contexto explícito se respeta lo que pida el usuario.
    $TechoContexto = [math]::Min($TechoContexto, [int]$GpuProfile.moe.ctxTope)
}
if ($Vision) {
    $TechoVision = [int]$VisionProfile.contexto
    if ($ContextSize -ne 'auto' -and $VisionProfile.contextoMaximoManual) {
        $TechoVision = [math]::Max($TechoVision, [int]$VisionProfile.contextoMaximoManual)
    }
    $TechoContexto = [math]::Min($TechoContexto, $TechoVision)
}

# `gpu-parcial` no usa el default denso de 16k: el plan medido ya fijó 32k.
# Un contexto pedido explícitamente por el IDE o por el usuario manda igual.
if ($EsParcial -and -not $PSBoundParameters.ContainsKey('ContextSize') -and -not $ContextoExplicito -and $Item.plan.contexto) {
    $ContextSize = [string]$Item.plan.contexto
}
if ($ContextSize -eq "auto") {
    $ContextTokens = $TechoContexto
    $Found = $false
    while ($ContextTokens -ge 4096) {
        $Req = Get-RequiredMiB $ContextTokens $KVCacheType
        if ($Req -le $FreeMiB) { $Found = $true; break }
        $ContextTokens -= 1024
    }
    if (-not $Found) { throw "No hay VRAM suficiente ni para 4096 tokens con KV=$KVCacheType" }
    Write-Host "Contexto auto: $ContextTokens tokens (KV=$KVCacheType, req=$Req MiB, free=$FreeMiB MiB)" -ForegroundColor Green
} else {
    $ContextTokens = [int]$ContextSize
    $Req = Get-RequiredMiB $ContextTokens $KVCacheType
    if ($Req -gt $FreeMiB) {
        throw "Contexto $ContextTokens con KV=$KVCacheType requiere $Req MiB, pero solo hay $FreeMiB MiB libres"
    }
    if ($ContextTokens -gt $TechoContexto) { throw "Contexto $ContextTokens supera el techo $TechoContexto" }
    Write-Host "Contexto: $ContextTokens tokens (req=$Req MiB, free=$FreeMiB MiB)" -ForegroundColor Cyan
}

# =============================================================================
# REPARTO MoE (VRAM <-> RAM)
# =============================================================================
$NCpuMoe = 0
$GpuExpertosMiB = 0
$CapasMoe = 0
if ($IsMoe) {
    $PorCapa = @($GpuProfile.moe.porCapa)
    $CapasMoe = $PorCapa.Count
    if ($CapasMoe -gt 0) {
        # La VRAM que sobra tras densos + KV se llena con las ÚLTIMAS capas de
        # expertos (--n-cpu-moe N deja las N primeras en RAM). Así el reparto se
        # adapta al contexto real, no al que se midió al descargar.
        $LibreExpertos = $FreeMiB - (Get-RequiredMiB $ContextTokens $KVCacheType)
        if ($LibreExpertos -lt 0) { throw "El plan MoE no cabe: faltan $(-$LibreExpertos) MiB para densos + KV" }
        $CapasGpu = 0
        $Acumulado = 0
        for ($i = $CapasMoe - 1; $i -ge 0; $i--) {
            $CapaMiB = [math]::Ceiling([double]$PorCapa[$i] / 1MB)
            if ($Acumulado + $CapaMiB -gt $LibreExpertos) { break }
            $Acumulado += $CapaMiB
            $CapasGpu += 1
        }
        $GpuExpertosMiB = $Acumulado
        $NCpuMoe = $CapasMoe - $CapasGpu
    } else {
        $NCpuMoe = [int]$GpuProfile.moe.nCpuMoe
    }
    # Measured table wins over the analytic estimate. The table was produced by
    # loading llama-server at each context and finding the largest n-cpu-moe
    # that survived 2048 prompt + 128/256 generated tokens without OOM.
    $MeasuredMoeChoice = $null
    if ($MeasuredMoeEntry -and $MeasuredMoeEntry.contexts) {
        $Candidates = @($MeasuredMoeEntry.contexts | Sort-Object { [int]$_.ctx })
        $MeasuredMoeChoice = $Candidates | Where-Object { [int]$_.ctx -ge $ContextTokens } | Select-Object -First 1
        if (-not $MeasuredMoeChoice) { $MeasuredMoeChoice = $Candidates[-1] }
        $NCpuMoe = [int]$MeasuredMoeChoice.nCpuMoe
        # If another application is already using VRAM, move enough experts
        # back to RAM to preserve the measured safety margin.
        $DeltaFree = [int]$MeasuredMoe.freeVramAssumedMiB - $FreeMiB
        if ($DeltaFree -gt 0 -and [double]$MeasuredMoeEntry.perLayerMiB -gt 0) {
            $ExtraCpu = [math]::Ceiling($DeltaFree / [double]$MeasuredMoeEntry.perLayerMiB)
            $NCpuMoe = [math]::Min($CapasMoe, $NCpuMoe + [int]$ExtraCpu)
            Write-Host ("MoE medido: VRAM libre {0} MiB (< {1}); +{2} capas a CPU" -f $FreeMiB, $MeasuredMoe.freeVramAssumedMiB, $ExtraCpu) -ForegroundColor Yellow
        }
        $CapasGpu = $CapasMoe - $NCpuMoe
        $GpuExpertosMiB = 0
        for ($i = $NCpuMoe; $i -lt $CapasMoe; $i++) {
            $GpuExpertosMiB += [math]::Ceiling([double]$PorCapa[$i] / 1MB)
        }
        Write-Host ("MoE medido: contexto {0}, n-cpu-moe {1} (fila {2}), ~{3} MiB de expertos en GPU" -f $ContextTokens, $NCpuMoe, $MeasuredMoeChoice.ctx, $GpuExpertosMiB) -ForegroundColor Green
    }
    if ($GpuExtra -gt 0 -and $NCpuMoe -ge $GpuExtra) {
        $NCpuMoe -= $GpuExtra
        $GpuExpertosMiB = 0
        for ($i = $NCpuMoe; $i -lt $CapasMoe; $i++) {
            $GpuExpertosMiB += [math]::Ceiling([double]$PorCapa[$i] / 1MB)
        }
        Write-Host ("GpuExtra: {0} capas más en GPU (margen agresivo; puede OOM en otro modelo)." -f $GpuExtra) -ForegroundColor Yellow
    }
    # Decisión dinámica de carga: `none` solo si los expertos de CPU + proyector
    # + 1 GiB de holgura caben en la RAM disponible AHORA. Si el usuario tiene
    # el navegador/IDE abiertos, se cae a mmap en vez de arriesgar swapping.
    $ExpertosRamMiB = 0
    for ($i = 0; $i -lt [math]::Min($NCpuMoe, $CapasMoe); $i++) {
        $ExpertosRamMiB += [math]::Ceiling([double]$PorCapa[$i] / 1MB)
    }
    $VisionRamMiB = if ($Vision -and $ProjectorCPU -and $VisionProfile) { [int]$VisionProfile.reservaMiB } else { 0 }
    $RamNecesariaMiB = $ExpertosRamMiB + $VisionRamMiB + 1024
    $FreeRamMiB = 0
    try {
        $FreeRamMiB = [int](Get-Counter '\Memory\Available MBytes' -ErrorAction Stop).CounterSamples[0].CookedValue
    } catch {
        try { $FreeRamMiB = [int]((Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).FreePhysicalMemory / 1024) } catch { $FreeRamMiB = 0 }
    }
    if ($FreeRamMiB -gt 0) {
        if ($LoadMode -eq "none" -and $FreeRamMiB -lt $RamNecesariaMiB) {
            $LoadMode = "mmap"
            Write-Host ("MoE: RAM disponible {0} MiB < {1} MiB necesarios; se usa mmap." -f $FreeRamMiB, $RamNecesariaMiB) -ForegroundColor Yellow
        } elseif ($LoadMode -eq "mmap" -and $FreeRamMiB -gt $RamNecesariaMiB) {
            $LoadMode = "none"
            Write-Host ("MoE: RAM disponible {0} MiB; los expertos caben y se carga sin mmap." -f $FreeRamMiB) -ForegroundColor DarkCyan
        }
    }
    if (-not $Item.servidor.threads) { $Threads = 12 } else { $Threads = [int]$Item.servidor.threads }
    if ($MeasuredMoeEntry -and $MeasuredMoeEntry.threads) {
        $Threads = [int]$MeasuredMoeEntry.threads
        Write-Host ("MoE medido: {0} hilos (tabla, no {1} del catálogo)" -f $Threads, $Item.servidor.threads) -ForegroundColor Green
    }
    $TextoMoe = ("MoE: {0}/{1} capas de expertos en GPU ({2} MiB), {3} en RAM ({4} MiB); hilos={5}" -f ($CapasMoe - $NCpuMoe), $CapasMoe, $GpuExpertosMiB, $NCpuMoe, $ExpertosRamMiB, $Threads) + "; carga=" + $LoadMode
    Write-Host $TextoMoe -ForegroundColor Magenta
}

# =============================================================================
# ARGS
# =============================================================================
# f16 KV has a llama.cpp idle-crash bug with context checkpoints: disable them
# and use the default (auto) slot layout for stability. Quantized KV keeps the
# single-slot layout that the project has used since v0.7.
$StableF16 = $true

# Muestreo por modelo. GPT-OSS recomienda temp 1.0, top_p 1.0, top_k 0,
# min_p ~0; Qwen/Ornith usan sus propios valores del catálogo.
$Temp = 0.6; $TopP = 0.90; $TopK = 20; $MinP = 0.05; $Presence = 0; $Repeat = 1
$Muestreo = $Item.muestreo.codigo
if ($Muestreo) {
    if ($null -ne $Muestreo.temperature) { $Temp = [double]$Muestreo.temperature }
    if ($null -ne $Muestreo.top_p) { $TopP = [double]$Muestreo.top_p }
    if ($null -ne $Muestreo.top_k) { $TopK = [int]$Muestreo.top_k }
    if ($null -ne $Muestreo.min_p) { $MinP = [double]$Muestreo.min_p }
    if ($null -ne $Muestreo.presence_penalty) { $Presence = [double]$Muestreo.presence_penalty }
    if ($null -ne $Muestreo.repeat_penalty) { $Repeat = [double]$Muestreo.repeat_penalty }
}

$ServerArgs = @("-m", $ModelPath, "--gpu-layers", "$NGpuLayers")
if ($EsParcial) {
    # Denso parcial: las capas que no caben se leen del GGUF con mmap. `--fit
    # off` impide que el auto-fit cambie el reparto medido en tiempo de carga.
    $ServerArgs += "--fit", "off"
    $ServerArgs += "--load-mode", "mmap"
}
if ($IsMoe) {
    # Reparto explícito: densos + KV en VRAM, expertos de las N primeras capas
    # en RAM. Si los expertos de CPU caben, `none` evita page faults y duplica
    # la velocidad; si no caben, `mmap` deja que Windows pagine desde el SSD.
    $ServerArgs += "--fit", "off"
    $ServerArgs += "--load-mode", $LoadMode
    if ($NCpuMoe -ge $CapasMoe -and $CapasMoe -gt 0) {
        $ServerArgs += "--cpu-moe"
    } elseif ($NCpuMoe -gt 0) {
        $ServerArgs += "--n-cpu-moe", "$NCpuMoe"
    }
}
if (-not $StableF16) {
    $ServerArgs += "--fit", "off"
    $ServerArgs += "--kv-offload"
}
$ServerArgs += "--flash-attn", "on"
$ServerArgs += "-c", "$ContextTokens"
$ServerArgs += "-ctk", $KVCacheType
$ServerArgs += "-ctv", $KVCacheType
if (-not $StableF16) { $ServerArgs += "-np", "1" }
$ServerArgs += "-b", "$Batch"
$ServerArgs += "-ub", "$UBatch"
$ServerArgs += "-t", "$Threads"
$ServerArgs += "--host", $HostIP
$ServerArgs += "--port", "$Port"
$ServerArgs += "--jinja"
$ServerArgs += "--metrics"
if ($EsParcial) {
    # La caché de prompt es lo que evita re-prefijar 25k tokens en cada turno.
    # Es un tope, no una reserva: el perfil decide cuántos MiB puede usar.
    $CacheRam = if ($null -ne $Item.servidor.cacheRamMiB) { [int]$Item.servidor.cacheRamMiB } else { 0 }
    $ServerArgs += "--cache-ram", "$CacheRam"
    if ($CacheRam -gt 0 -and $Item.servidor.cacheRecurrentPrefix -eq $true) {
        $ServerArgs += "--cache-recurrent-prefix"
    }
    if ($Item.servidor.mmapTrimGpu -eq $true) { $env:LLAMA_MMAP_TRIM_GPU = '1' }
} elseif (-not $StableF16 -or $IsMoe) { $ServerArgs += "--cache-ram", "0" }
$ServerArgs += "-lv", "4"
$ServerArgs += "--cors-origins", "http://127.0.0.1:$Port,http://localhost:$Port,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:8788,http://localhost:8788"
$ServerArgs += "--temp", "$Temp"
$ServerArgs += "--top-p", "$TopP"
$ServerArgs += "--top-k", "$TopK"
$ServerArgs += "--min-p", "$MinP"
$ServerArgs += "--presence-penalty", "$Presence"
$ServerArgs += "--repeat-penalty", "$Repeat"
# MTP (Qwen3.8): la cabeza nextn vive dentro del mismo GGUF. Un solo slot
# (`--parallel 1`) es obligatorio para que el árbol especulativo sea determinista.
$Mtp = ($Item.servidor.mtp -eq $true)
if ($Mtp) {
    $ServerArgs += "--spec-type", "draft-mtp"
    $ServerArgs += "--spec-draft-n-max", "$([int]$Item.servidor.specDraftNMax)"
    if ($null -ne $Item.servidor.specDraftPMin) { $ServerArgs += "--spec-draft-p-min", "$($Item.servidor.specDraftPMin)" }
    $ServerArgs += "--parallel", "1"
} elseif (-not $SpeculativeDecoding) {
    $ServerArgs += "--spec-type", "none"
}
$ServerArgs += "--no-context-shift"
if ($StableF16) { $ServerArgs += "--ctx-checkpoints", "0" }
# Qwen3.8 conserva el razonamiento histórico por defecto. En un agente eso
# multiplica los tokens del historial; el perfil lo apaga.
if ($Item.servidor.noPreserveThinking -eq $true) { $ServerArgs += "--no-reasoning-preserve" }

# Chat template -> file (inline breaks on quotes/newlines)
$ChatTemplatePath = ""
if ($Item.chat_template) {
    $ChatTemplatePath = Join-Path $RootDir "logs\chat_template_$Port.jinja"
    New-Item -ItemType Directory -Force (Split-Path -Parent $ChatTemplatePath) | Out-Null
    $Item.chat_template | Set-Content -LiteralPath $ChatTemplatePath -Encoding UTF8 -NoNewline
    $ServerArgs += "--chat-template-file", $ChatTemplatePath
}
# GPT-OSS/Harmony: el parser peg-native de llama.cpp falla con varias llamadas.
# Se pide la salida Harmony cruda y Bonsai la parsea en chat/harmony.mjs.
if ($Item.clave -eq "gpt-oss-20b" -or ($Item.capacidades -contains "Harmony")) {
    $ServerArgs += "--skip-chat-parsing"
}

if ($Vision) {
    $ServerArgs += "--mmproj", $ProjectorPath
    if ($ProjectorCPU) { $ServerArgs += "--no-mmproj-offload" }
    else { $ServerArgs += "--mmproj-offload"; $ServerArgs += "--mmproj-device", "CUDA0" }
    $ServerArgs += "--image-max-tokens", "512"
}

if ($Pensar -ne 0) {
    $ServerArgs += "--reasoning-budget", "$Pensar"
    $ServerArgs += "--reasoning-format", "deepseek"
    $Nivel = if ($PensarNivel) { $PensarNivel } elseif ($Item.pensar.nivel) { [string]$Item.pensar.nivel } else { "" }
    if ($Nivel -and $Nivel -ne "default") { $ServerArgs += "--reasoning-effort", $Nivel }
}

if ($SpeculativeDecoding -and -not $Mtp -and (Test-Path -LiteralPath $DraftModelPath)) {
    $ServerArgs += "--spec-type", "draft-simple"
    $ServerArgs += "--spec-draft-model", $DraftModelPath
    $ServerArgs += "--spec-draft-n-max", "$DraftTokensCount"
}

# =============================================================================
# DRY RUN
# =============================================================================
function ConvertTo-ArgumentText([string]$Value) {
    if ($Value -match '^[^\s"]+$') { return $Value }
    return '"' + $Value.Replace('"', '\"') + '"'
}
$ArgumentLine = (($ServerArgs | ForEach-Object { ConvertTo-ArgumentText ([string]$_) }) -join ' ')

if ($DryRun -and $Json) { @{ ok = $true; state = 'dry-run'; port = $Port; binId = $Binary.id; exe = $BinPath; arguments = $ServerArgs } | ConvertTo-Json -Compress -Depth 4; exit 0 }
if ($DryRun) {
    Write-Host ("BIN: " + $BinPath)
    Write-Host ("ARGS: " + $ArgumentLine)
    exit 0
}

# =============================================================================
# LAUNCH (proven lifecycle: Start-Process -NoNewWindow + WaitForExit)
# =============================================================================
# Precalentar la page cache evita que la primera generación lea expertos del
# SSD página a página. Solo tiene sentido si el GGUF cabe en RAM; en Nemotron 3
# Nano (16,85 GiB) provocaría thrashing, así que se omite.
if ($Precargar -and $IsMoe -and $LoadMode -eq "mmap") {
    $TotalRamBytes = (Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).TotalPhysicalMemory
    $CabeEnRam = (-not $TotalRamBytes) -or ([int64]$Item.bytes -lt ([double]$TotalRamBytes * 0.85))
    $PreScript = Join-Path $PSScriptRoot "precargar-gguf.mjs"
    if ($CabeEnRam -and (Test-Path -LiteralPath $PreScript) -and $NCpuMoe -gt 0) {
        Write-Host "Precalentando la page cache de los expertos en RAM..." -ForegroundColor DarkCyan
        try { & node $PreScript --file $ModelPath --layers $NCpuMoe | Out-Null } catch { Write-Host "Aviso: no se pudo precargar: $($_.Exception.Message)" -ForegroundColor Yellow }
    } elseif (-not $CabeEnRam) {
        Write-Host "Precarga omitida: el GGUF no cabe en RAM." -ForegroundColor Yellow
    }
}

$Metadata = [ordered]@{
    modelo = $Modelo; puerto = $Port; contexto = $ContextTokens; kv = $KVCacheType;
    vision = [bool]$Vision; pensar = $Pensar; dormir = $DormirSeg; hostIP = $HostIP;
    enginePreset = $EnginePreset; llamaVersion = "desconocida";
    activeKey = $(if ($Vision -and $VisionProfile) { $VisionProfile.archivo } else { $null });
    speculative = $SpeculativeDecoding; optimized = $UsingOptimized; mmprojCPU = [bool]$ProjectorCPU;
    tipo = [string]$Item.servidor.tipo;
    moe = [bool]$IsMoe; nCpuMoe = $NCpuMoe; capasMoe = $CapasMoe;
    gpuExpertosMiB = $GpuExpertosMiB; loadMode = $LoadMode
}
$ExitCode = Start-BonsaiManagedProcess $Metadata
exit $ExitCode
