<#
.SYNOPSIS
    RTX 4060 8GB optimized llama-server launcher (llama.cpp v0.8.0+, sm89 build).

.DESCRIPTION
    Single source of truth for launching the optimized server. Reads the preset
    from config/local-engine-presets-rtx4060-optimized.json and the model from
    chat/modelo.json, builds the llama-server argument line and launches it with
    the EXACT lifecycle that the rest of the project relies on:

        Start-Process -NoNewWindow -PassThru  +  WaitForExit()

    This wrapper stays alive for as long as llama-server runs. It must NOT exit
    early: llama-server is a child process and Windows tears down the whole job
    when the parent exits. The caller (ui-server.mjs) spawns us with
    windowsHide:true and unref(); that is what keeps the server alive after the
    caller dies.

.NOTES
    - Designed to be spawned from chat/ui-server.mjs (lanzarServidorLlama).
    - Writes logs/servidor-administrado-<port>.json so stop-managed-server.ps1
      can find and stop exactly this process (never foreign servers).
    - The chat template from chat/modelo.json is written to a .jinja file and
      passed with --chat-template-file (inline --chat-template breaks on quotes).
#>

param (
    [Parameter(Mandatory = $true)][string]$Modelo,
    [string]$ContextSize = "auto",
    [int]$Port = 8080,
    [string]$HostIP = "127.0.0.1",
    [ValidateSet("auto", "f16", "bf16", "q8_0", "q4_0")][string]$KVCacheType = "auto",
    [int]$Pensar = 0,
    [int]$DormirSeg = 0,
    [switch]$Vision,
    [switch]$MmprojCPU,
    [switch]$Precargar,
    [int]$GpuExtra = 0,
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

if ($Log) {
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
if (-not $Item -or ($Item.servidor.tipo -ne "gpu-completa" -and $Item.servidor.tipo -ne "moe-hibrido")) {
    throw "Modelo sin perfil de GPU completa ni MoE híbrido: $Modelo"
}
# En MoE manda el plan del modelo, no el preset denso: un preset de 110k deja
# casi toda la VRAM en KV y muy pocos expertos en la GPU. El plan ya calculó
# contexto, KV y reparto para ESTE GGUF.
$EsMoe = $Item.servidor.tipo -eq "moe-hibrido"
if ($EsMoe -and $Item.plan) {
    if ($Item.plan.contexto) { $ContextSize = [string]$Item.plan.contexto }
    if ($Item.plan.kv) { $KVCacheType = [string]$Item.plan.kv }
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

$BinPath = Join-Path $RootDir "bin\llama-server.exe"
$Candidates = @(
    (Join-Path $RootDir ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe"),
    (Join-Path $env:USERPROFILE ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe")
)
foreach ($cand in $Candidates) {
    if (Test-Path -LiteralPath $cand) { $BinPath = $cand; break }
}
$UsingOptimized = $BinPath -like "*build-RTX4060-Opt-sm89*"
$Threads = 4
# Perfil del modelo (Hub): batch/ubatch/hilos medidos o recomendados. En presets
# nombrados manda el preset; para CUSTOM/AUTO manda el modelo.
if (($EnginePreset -eq 'CUSTOM' -or -not $EnginePreset) -and $Item.servidor) {
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
if (($EngineOptions -or $EnginePreset -eq 'CUSTOM') -and $Item.servidor.pesosGpuEstandarMiB) {
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

$ServerArgs = @("-m", $ModelPath, "--gpu-layers", "99")
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
if (-not $StableF16 -or $IsMoe) { $ServerArgs += "--cache-ram", "0" }
$ServerArgs += "-lv", "4"
$ServerArgs += "--cors-origins", "http://127.0.0.1:$Port,http://localhost:$Port,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:8788,http://localhost:8788"
$ServerArgs += "--temp", "0.6"
$ServerArgs += "--top-p", "0.90"
$ServerArgs += "--top-k", "20"
$ServerArgs += "--min-p", "0.05"
$ServerArgs += "--presence-penalty", "0"
$ServerArgs += "--repeat-penalty", "1"
$ServerArgs += "--spec-type", "none"
$ServerArgs += "--no-context-shift"
if ($StableF16) { $ServerArgs += "--ctx-checkpoints", "0" }

# Chat template -> file (inline breaks on quotes/newlines)
$ChatTemplatePath = ""
if ($Item.chat_template) {
    $ChatTemplatePath = Join-Path $RootDir "logs\chat_template_$Port.jinja"
    New-Item -ItemType Directory -Force (Split-Path -Parent $ChatTemplatePath) | Out-Null
    $Item.chat_template | Set-Content -LiteralPath $ChatTemplatePath -Encoding UTF8 -NoNewline
    $ServerArgs += "--chat-template-file", $ChatTemplatePath
}

if ($Vision) {
    $ServerArgs += "--mmproj", $ProjectorPath
    if ($ProjectorCPU) { $ServerArgs += "--no-mmproj-offload" }
    else { $ServerArgs += "--mmproj-offload"; $ServerArgs += "--mmproj-device", "CUDA0" }
    $ServerArgs += "--image-max-tokens", "512"
}

if ($Pensar -gt 0) {
    $ServerArgs += "--reasoning-budget", "$Pensar"
    $ServerArgs += "--reasoning-format", "deepseek"
}

if ($SpeculativeDecoding -and (Test-Path -LiteralPath $DraftModelPath)) {
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

if ($DryRun) {
    Write-Host ("BIN: " + $BinPath)
    Write-Host ("ARGS: " + $ArgumentLine)
    exit 0
}

# =============================================================================
# LAUNCH (proven lifecycle: Start-Process -NoNewWindow + WaitForExit)
# =============================================================================
$Wrapper = Get-Process -Id $PID -ErrorAction Stop
$WrapperTicks = $Wrapper.StartTime.ToUniversalTime().Ticks.ToString()
$Marker = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
$MarkerTmp = $Marker + ".tmp"

$LlamaVersion = "desconocida"
try {
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $out = & $BinPath --version 2>&1
    $ErrorActionPreference = $oldEAP
    if ($out) { $LlamaVersion = ($out -split "`r?`n" | Select-Object -First 1).Trim() }
} catch { }

$ActiveKey = $null
if ($Vision -and $VisionProfile -and $VisionProfile.archivo) { $ActiveKey = $VisionProfile.archivo }

function Write-MarcadorAdministrado([int]$ServidorPid) {
    $Info = [ordered]@{
        modelo = $Modelo; puerto = $Port; contexto = $ContextTokens; kv = $KVCacheType;
        vision = [bool]$Vision; pensar = $Pensar; dormir = $DormirSeg; hostIP = $HostIP;
        pid = $PID; wrapperPid = $PID; iniciado = $WrapperTicks; enginePreset = $EnginePreset;
        llamaVersion = $LlamaVersion; activeKey = $ActiveKey; speculative = $SpeculativeDecoding;
        optimized = $UsingOptimized; mmprojCPU = [bool]$ProjectorCPU;
        moe = [bool]$IsMoe; nCpuMoe = $NCpuMoe; capasMoe = $CapasMoe;
        gpuExpertosMiB = $GpuExpertosMiB; loadMode = $LoadMode
    }
    if ($ServidorPid -gt 0) {
        $Info.pidServidor = $ServidorPid
        $Info.iniciadoServidor = (Get-Process -Id $ServidorPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString()
    }
    New-Item -ItemType Directory -Force (Split-Path -Parent $Marker) | Out-Null
    $Info | ConvertTo-Json -Compress | Set-Content -LiteralPath $MarkerTmp -Encoding ASCII
    if (Test-Path -LiteralPath $Marker) { Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue }
    Rename-Item -LiteralPath $MarkerTmp -NewName $Marker -Force
}

if ($ManagedByIDE) {
    try { Write-MarcadorAdministrado 0 } catch { Write-Host "Aviso marcador: $($_.Exception.Message)" -ForegroundColor Yellow }
}

if (-not $env:BONSAI_LLAMA_LOG_PREFIX) {
    $env:BONSAI_LLAMA_LOG_PREFIX = Join-Path $RootDir "logs\llama-server-$Port"
}

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

$ExecOptions = @{
    FilePath               = $BinPath
    ArgumentList           = $ArgumentLine
    PassThru               = $true
    NoNewWindow            = $true
    RedirectStandardOutput = $env:BONSAI_LLAMA_LOG_PREFIX + ".out.log"
    RedirectStandardError  = $env:BONSAI_LLAMA_LOG_PREFIX + ".err.log"
}
$Exec = Start-Process @ExecOptions
$null = $Exec.Handle

# En portátiles Windows puede aplicar EcoQoS (throttling) y memoria de baja
# prioridad a un proceso lanzado en segundo plano. En un MoE eso se nota mucho:
# los hilos que leen expertos de RAM se frenan. Se sube la prioridad de memoria
# y se desactiva EcoQoS sin tocar la prioridad del resto del sistema.
if ($IsMoe) {
    try {
        $opt = Join-Path $PSScriptRoot "win-optimize-process.ps1"
        if (Test-Path -LiteralPath $opt) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $opt -Pid $Exec.Id | Out-Null
        }
    } catch { }
}

if ($ManagedByIDE) {
    Start-Sleep -Milliseconds 300
    $Vivo = Get-Process -Id $Exec.Id -ErrorAction SilentlyContinue
    if (-not $Vivo -or $Vivo.HasExited) {
        Write-Host "Error: llama-server.exe murio al arrancar (PID $($Exec.Id)). Revisa $($env:BONSAI_LLAMA_LOG_PREFIX).err.log" -ForegroundColor Red
        if (Test-Path -LiteralPath $Marker) { Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue }
        exit 1
    }
    try { Write-MarcadorAdministrado ([int]$Exec.Id) } catch { Write-Host "Aviso marcador PID: $($_.Exception.Message)" -ForegroundColor Yellow }
}

$ExitCode = 1
try {
    $Exec.WaitForExit()
    $NativeExitCode = $Exec.ExitCode
    if ($null -eq $NativeExitCode) { $ExitCode = 1 } else { $ExitCode = [int]$NativeExitCode }
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