<#
.SYNOPSIS
    RTX 4060 8GB Optimized Model Launcher for llama.cpp v0.8.0+
.DESCRIPTION
    Optimized launcher with:
    - Auto VRAM calibration per profile
    - Speculative decoding support
    - Optimal KV quantization per profile
    - FlashAttn v2 tuned for sm89
    - Dynamic batch/ubatch sizing
    - mmproj offload optimization
    - Custom CUDA graph settings
.NOTES
    Replaces start-gpu-model.ps1 for RTX 4060 optimized builds.
#>

param (
    [Parameter(Mandatory=$true)][string]$Modelo,
    [string]$ContextSize = "auto",
    [int]$Port = 8080,
    [string]$HostIP = "127.0.0.1",
    [ValidateSet("auto", "f16", "q8_0", "q4_0", "IQ4_XS", "IQ2_XS", "IQ1_S")][string]$KVCacheType = "auto",
    [int]$Pensar = 0,
    [int]$DormirSeg = 0,
    [switch]$Vision,
    [switch]$DryRun,
    [switch]$ManagedByIDE,
    [ValidateSet("", "8GB-VISION-ULTRA-F16", "8GB-VISION-ULTRA", "8GB-VISION-HIGH", "8GB-VISION-BALANCED", "8GB-VISION-SAFE",
                 "8GB-CODE-MAX", "8GB-CODE-HIGH", "8GB-CODE-BALANCED", "8GB-CODE-FAST",
                 "8GB-RESEARCH", "8GB-VISION-QUALITY", "CUSTOM")][string]$EnginePreset = "",
    [int]$FreeMiBOverride = 0,
    [int]$MarginOverrideMiB = -1,
    [string]$DraftModel = "",
    [int]$DraftTokens = 4
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

# =============================================================================
# LOAD OPTIMIZED PRESETS
# =============================================================================
$PresetPath = Join-Path $RootDir "config\local-engine-presets-rtx4060-optimized.json"
$Presets = Get-Content -LiteralPath $PresetPath -Raw | ConvertFrom-Json
$EngineOptions = $null
$SafetyMiB = 0
$SpeculativeDecoding = $false
$DraftModelPath = ""
$DraftTokensCount = 4

if ($EnginePreset -and $EnginePreset -ne 'CUSTOM') {
    $EngineOptions = $Presets.$EnginePreset
    if (-not $EngineOptions) { throw "Preset de motor optimizado desconocido: $EnginePreset" }
    
    if ($ContextSize -eq "auto") { $ContextSize = [string]$EngineOptions.context }
    if ($KVCacheType -eq "auto") { $KVCacheType = [string]$EngineOptions.kv }
    $SafetyMiB = [int]$EngineOptions.marginMiB
    if (-not $PSBoundParameters.ContainsKey('Vision')) { $Vision = [bool]$EngineOptions.vision }
    
    # Speculative decoding setup
    if ($EngineOptions.spec -eq "draft") {
        $SpeculativeDecoding = $true
        $DraftModelPath = Join-Path $RootDir ("models\" + $EngineOptions.draftModel)
        $DraftTokensCount = [int]$EngineOptions.draftTokens
    }
}
elseif ($EnginePreset -eq 'CUSTOM') {
    # CUSTOM with optimized defaults for RTX 4060
    $SafetyMiB = if ($MarginOverrideMiB -ge 0) { $MarginOverrideMiB } else { 200 }
    if ($KVCacheType -eq "auto") { $KVCacheType = "q4_0" }  # Optimal default
}
else {
    # Legacy fallback
    if ($ContextSize -eq "auto") { $ContextSize = "16384" }
    if ($KVCacheType -eq "auto") { $KVCacheType = "q4_0" }
    $SafetyMiB = if ($MarginOverrideMiB -ge 0) { $MarginOverrideMiB } else { 200 }
}

# Override margin if explicitly provided
if ($MarginOverrideMiB -ge 0) { $SafetyMiB = $MarginOverrideMiB }

# =============================================================================
# LOAD MODEL CATALOG
# =============================================================================
$Catalogo = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Item = $Catalogo.catalogo.$Modelo
if (-not $Item -or $Item.servidor.tipo -ne "gpu-completa") { throw "Modelo sin perfil de GPU completa: $Modelo" }
$ModelPath = Join-Path $RootDir ("models\" + $Item.archivo)
$BinPath = Join-Path $RootDir "bin\llama-server.exe"

# Check for optimized binary
$OptBinPath = Join-Path $RootDir ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe"
if (Test-Path -LiteralPath $OptBinPath) {
    $BinPath = $OptBinPath
    Write-Host "Usando binario optimizado RTX 4060: $BinPath" -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $ModelPath)) { throw "Falta el modelo: $ModelPath" }
if ((Get-Item -LiteralPath $ModelPath).Length -ne [int64]$Item.bytes) { throw "El modelo no tiene el tamaño verificado; descarga incompleta." }
if (-not $DryRun -and @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) { throw "El puerto $Port ya está ocupado. No se modifican servidores ajenos." }

# =============================================================================
# VRAM MEASUREMENT
# =============================================================================
$FreeMiB = 0
$UsandoOverride = $false
if ($FreeMiBOverride -gt 0) {
    if ($DryRun) {
        $FreeMiB = $FreeMiBOverride
        $UsandoOverride = $true
    } else {
        Write-Host "Aviso: -FreeMiBOverride se ignora en arranque real; se mide VRAM con nvidia-smi." -ForegroundColor Yellow
    }
}
if (-not $UsandoOverride) {
    $FreeOutput = & nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits
    if ($LASTEXITCODE -ne 0) { throw "No se pudo comprobar la VRAM libre. No se arranca sin verificar la GPU." }
    $FreeMiB = [int](@($FreeOutput)[0].Trim())
}

# =============================================================================
# VRAM CALCULATION - OPTIMIZED FOR RTX 4060
# =============================================================================
$GpuProfile = $Item.servidor
$WeightsMiB = [math]::Ceiling([int64]$Item.bytes / 1MB)
if (($EngineOptions -or $EnginePreset -eq 'CUSTOM') -and $Item.servidor.pesosGpuEstandarMiB) {
    $WeightsMiB = [int]$Item.servidor.pesosGpuEstandarMiB
}

# KV cache bytes per element (updated for new quantization types)
$KvBytesPerElement = @{
    "f16"     = 2.0;      # 16-bit
    "q8_0"    = 1.0;      # 8-bit quantized
    "q4_0"    = 0.5;      # 4-bit quantized
    "IQ4_XS"  = 0.5625;   # 4.5-bit (4-bit + 0.5-bit overhead)
    "IQ2_XS"  = 0.28125;  # 2.25-bit
    "IQ1_S"   = 0.15625;  # 1.25-bit
}
$ElementBytes = $KvBytesPerElement[$KVCacheType]
if (-not $ElementBytes) { throw "Tipo de KV no soportado: $KVCacheType. Use: f16, q8_0, q4_0, IQ4_XS, IQ2_XS, IQ1_S" }

$VisionProfile = if ($Vision) { $Item.vision } else { $null }
$VisionMiB = 0
if ($Vision) {
    if (-not $VisionProfile.archivo -or -not $VisionProfile.offload -or -not $VisionProfile.contexto) { 
        throw "Este perfil solo admite visión con proyector propio en GPU y un techo de contexto declarado." 
    }
    $ProjectorPath = Join-Path $RootDir ("models\" + $VisionProfile.archivo)
    if (-not (Test-Path -LiteralPath $ProjectorPath) -or (Get-Item -LiteralPath $ProjectorPath).Length -ne [int64]$VisionProfile.bytes) { 
        throw "Falta el proyector de visión verificado: $ProjectorPath" 
    }
    # mmproj BF16 is ~900MB, but with offload it's mostly in VRAM
    $VisionMiB = [int]$VisionProfile.reservaMiB
}

function Get-RequiredMiB([int]$ContextTokens, [string]$CacheType) {
    $ElementBytes = $KvBytesPerElement[$CacheType]
    # KV cache = context * attention_layers * kv_heads * head_dim * 2 (K+V) * element_bytes
    $CacheBytes = $ContextTokens * [double]$GpuProfile.capasAtencionCompleta * $GpuProfile.cabezasKV * $GpuProfile.dimCabeza * 2 * $ElementBytes
    return $WeightsMiB + [math]::Ceiling($CacheBytes / 1MB) + [int]$GpuProfile.reservaMiB + $VisionMiB + $SafetyMiB
}

# =============================================================================
# AUTO CONTEXT SELECTION
# =============================================================================
$KvOrder = @("f16", "q8_0", "q4_0", "IQ4_XS", "IQ2_XS", "IQ1_S")
$TechoContexto = [int]$GpuProfile.contexto

if ($Vision) {
    $TechoVision = [int]$VisionProfile.contexto
    if ($ContextSize -ne 'auto' -and $VisionProfile.contextoMaximoManual) {
        $TechoVision = [math]::Max($TechoVision, [int]$VisionProfile.contextoMaximoManual)
    }
    $TechoContexto = [math]::Min($TechoContexto, $TechoVision)
}

if ($ContextSize -eq "auto") {
    Write-Host "Buscando mejor contexto para KV=$KVCacheType..." -ForegroundColor Cyan
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
    if ($Req -gt $FreeMiB) { throw "Contexto $ContextTokens con KV=$KVCacheType requiere $Req MiB, pero solo hay $FreeMiB MiB libres" }
    if ($ContextTokens -gt $TechoContexto) { throw "Contexto $ContextTokens supera el techo $TechoContexto del modelo" }
    Write-Host "Contexto fijo: $ContextTokens tokens (req=$Req MiB, free=$FreeMiB MiB)" -ForegroundColor Cyan
}

# =============================================================================
# BUILD ARGUMENT LINE
# =============================================================================
$ServerArgs = @(
    "-m", $ModelPath
    "--gpu-layers", "99"
    "--fit", "off"
    "--kv-offload"
    "--flash-attn", "on"
    "-c", $ContextTokens
    "-ctk", $KVCacheType
    "-ctv", $KVCacheType
    "-np", "1"
    "-b", [int]$EngineOptions.batch
    "-ub", [int]$EngineOptions.ubatch
    "-t", "4"
    "--host", $HostIP
    "--port", $Port
    "--jinja"
    "--metrics"
    "--cache-ram", "0"
    "-lv", "4"
    "--cors-origins", "http://127.0.0.1:$Port,http://localhost:$Port,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:8788,http://localhost:8788"
    "--temp", "0.6"
    "--top-p", "0.95"
    "--top-k", "20"
    "--min-p", "0"
    "--presence-penalty", "0"
    "--repeat-penalty", "1"
    "--spec-type", "none"
    "--no-context-shift"
)

# Chat template (from modelo.json) - use file to avoid command-line escaping issues
$ChatTemplatePath = ""
if ($Item.chat_template) {
    $ChatTemplatePath = Join-Path $RootDir "logs\chat_template_$Port.jinja"
    $Item.chat_template | Set-Content -LiteralPath $ChatTemplatePath -Encoding UTF8 -NoNewline
    $ServerArgs += "--chat-template-file", $ChatTemplatePath
    Write-Host "Chat template loaded from modelo.json ($(($Item.chat_template).Length) chars) -> $ChatTemplatePath" -ForegroundColor Cyan
}

# Vision args
if ($Vision) {
    $ServerArgs += "--mmproj", $ProjectorPath
    $ServerArgs += "--mmproj-offload"
    $ServerArgs += "--mmproj-device", "CUDA0"
    $ServerArgs += "--image-max-tokens", "512"
}

# Reasoning
if ($Pensar -gt 0) {
    $ServerArgs += "--reasoning-budget", $Pensar
    $ServerArgs += "--reasoning-format", "deepseek"
}

# Speculative decoding
if ($SpeculativeDecoding -and (Test-Path -LiteralPath $DraftModelPath)) {
    $ServerArgs += "--draft-model", $DraftModelPath
    $ServerArgs += "--draft-tokens", $DraftTokensCount
    Write-Host "Speculative decoding ENABLED: draft=$DraftModelPath, tokens=$DraftTokensCount" -ForegroundColor Green
}

# Flash attention (v2 optimized for sm89)
$ServerArgs += "--flash-attn", "on"

if ($DryRun) { 
    Write-Host ($BinPath + " " + ($ServerArgs | ForEach-Object { if ($_ -match ' ') { '"' + $_ + '"' } else { $_ } }) -join ' ')
    exit 0 
}

# =============================================================================
# LAUNCH WITH ATOMIC MARKER
# =============================================================================
$Wrapper = Get-Process -Id $PID -ErrorAction Stop
$WrapperTicks = $Wrapper.StartTime.ToUniversalTime().Ticks.ToString()
$Marker = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
$MarkerTmp = $Marker + ".tmp"

# Capture llama.cpp version
$LlamaVersion = "desconocida"
try { $out = & $BinPath --version 2>&1; if ($out) { $LlamaVersion = ($out -split "`r?`n" | Select-Object -First 1).Trim() } } catch {}

# Active key for reuse (vision projector)
$ActiveKey = $null
if ($Vision -and $VisionProfile -and $VisionProfile.archivo) { $ActiveKey = $VisionProfile.archivo }

function Write-MarcadorAdministrado([int]$ServidorPid) {
    $Info = [ordered]@{
        modelo = $Modelo; puerto = $Port; contexto = $ContextTokens; kv = $KVCacheType;
        vision = [bool]$Vision; pensar = $Pensar; dormir = $DormirSeg; hostIP = $HostIP;
        pid = $PID; wrapperPid = $PID; iniciado = $WrapperTicks; enginePreset = $EnginePreset;
        llamaVersion = $LlamaVersion; activeKey = $ActiveKey; speculative = $SpeculativeDecoding
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
    try { Write-MarcadorAdministrado 0 } catch { Write-Host "Aviso: no se pudo escribir marcador: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# Default log prefix
if (-not $env:BONSAI_LLAMA_LOG_PREFIX) {
    $env:BONSAI_LLAMA_LOG_PREFIX = Join-Path $RootDir "logs\llama-server-$Port"
}
$ExecOptions = @{ 
    FilePath = $BinPath; 
    ArgumentList = $ServerArgs; 
    PassThru = $true; 
    NoNewWindow = $true; 
    RedirectStandardOutput = $env:BONSAI_LLAMA_LOG_PREFIX + ".out.log"; 
    RedirectStandardError = $env:BONSAI_LLAMA_LOG_PREFIX + ".err.log" 
}
$Exec = Start-Process @ExecOptions
$null = $Exec.Handle

# Verify process stays alive
if ($ManagedByIDE) {
    Start-Sleep -Milliseconds 500
    $Vivo = Get-Process -Id $Exec.Id -ErrorAction SilentlyContinue
    if (-not $Vivo -or $Vivo.HasExited) {
        Write-Host "Error: llama-server.exe murió inmediatamente (PID $($Exec.Id)). Revisa $($env:BONSAI_LLAMA_LOG_PREFIX).err.log" -ForegroundColor Red
        if (Test-Path -LiteralPath $Marker) { Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue }
        exit 1
    }
    try { Write-MarcadorAdministrado ([int]$Exec.Id) } catch { Write-Host "Aviso: no se pudo completar marcador: $($_.Exception.Message)" -ForegroundColor Yellow }
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