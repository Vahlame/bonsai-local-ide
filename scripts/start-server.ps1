# ==============================================================================
# Arranque de modelos verificados para GPU completa en la RTX 4060 de 8 GB.
# Los datos del modelo y el muestreo salen de chat\modelo.json (GGUF + docs de PrismML).
#
#   .\scripts\start-server.ps1                  # contexto automatico (la VRAM libre), SIN razonamiento
#   .\scripts\start-server.ps1 -ContextSize 16384   # contexto fijo
#   .\scripts\start-server.ps1 -DryRun          # solo comprueba la VRAM y muestra el comando
#   .\scripts\start-server.ps1 -Pensar 2048     # razona con un tope de 2048 tokens (solo modelos que lo admiten)
#   .\scripts\start-server.ps1 -Pensar 0        # sin razonamiento aunque la interfaz lo tenga encendido
#   .\scripts\start-server.ps1 -Vision          # vision con proyector en GPU
# ==============================================================================

param (
    [string]$ContextSize = "auto",   # auto = la mayor ventana (KV q4_0) que cabe en la VRAM libre; o un numero de tokens
    [int]$Port = 8080,
    [string]$HostIP = "127.0.0.1",
    [ValidateSet("auto", "f16", "q8_0", "q4_0")]
    [string]$KVCacheType = "auto",   # auto = el KV mas preciso que quepa en la VRAM libre
    [int]$Pensar = -1,               # -1 = auto: lo del ajuste "Modo razonamiento" de la interfaz SI el modelo lo admite (catalogo.<clave>.pensar). 0 = apagado. N>0 = tope de N tokens
    [int]$Threads = 8,
    [int]$UBatch = 512,
    [ValidateSet("", "8GB-SAFE", "8GB-BALANCED", "8GB-MAX-SPEED", "8GB-CONTEXT", "8GB-VISION", "8GB-VISION-CONTEXT", "8GB-VISION-QUALITY", "8GB-VISION-LONG", "CUSTOM")][string]$EnginePreset = "",
    [int]$DormirSeg = 0,             # libera la VRAM tras N s sin peticiones (0 = nunca)
    [string]$Modelo = "",            # clave de un perfil verificado de GPU completa en chat\modelo.json
    [string]$Log = "",               # guarda todo lo que dice este script en ese archivo (lo usa el cambio de modelo)
    [switch]$Vision,                 # carga el proyector compatible en GPU
    [switch]$SinVision,
    [switch]$VisionGpu,              # alias de Vision
    [switch]$Forzar,                 # heredado: no permite omitir la comprobacion GPU
    [switch]$DryRun,                 # no lanza nada: comprueba y muestra el comando
    [switch]$Diagnostico,            # log detallado de la cache de prompt en logs\
    [switch]$ManagedByIDE            # proceso lanzado por la interfaz, identificable para detenerlo
)

$RootDir = Split-Path -Parent $PSScriptRoot
$BinPath = Join-Path $RootDir "bin\llama-server.exe"
$M = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
# Model Hub: modelos descargados en models/hub-catalog.json (ver chat/model-hub.mjs).
$HubPath = Join-Path $RootDir "models\hub-catalog.json"
if (Test-Path -LiteralPath $HubPath) {
    try {
        $Hub = Get-Content -LiteralPath $HubPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($prop in $Hub.modelos.PSObject.Properties) {
            if ($prop.Name -like "_*") { continue }
            if (-not $M.catalogo.PSObject.Properties[$prop.Name]) {
                $M.catalogo | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value
            }
        }
    } catch { }
}

# Registro opcional: sin esto, cuando el servidor lo lanza otra aplicacion (el cambio
# de modelo de la interfaz) el motivo de un fallo no queda en ningun sitio visible.
if ($Log) {
    try { Start-Transcript -Path $Log -Append -Force | Out-Null } catch { }
    Write-Host ("[{0}] start-server.ps1 -Modelo '{1}'{2}" -f (Get-Date).ToString("s"), $Modelo, $(if ($Vision) { " -Vision" } else { "" })) -ForegroundColor DarkGray
}

# Modelo: por defecto modeloPredeterminado; -Modelo elige otra entrada del catalogo.
# Si la interfaz guardo una eleccion (chat\modelo-activo.json), esa manda sobre el
# predeterminado: es lo que hace que el modelo elegido en la app siga puesto despues
# de cerrar y volver a abrir. -Modelo solo afecta a este arranque: no toca lo guardado.
$ModelFile = $M.modelo.archivo
$ModelBytes = [int64]$M.modelo.bytes
$ModelRol = "predeterminado"
$elegidoEnApp = ""
if (-not $Modelo) {
    $activoPath = Join-Path $RootDir "chat\modelo-activo.json"
    if (Test-Path $activoPath) {
        $activo = $null
        try {
            $activo = Get-Content $activoPath -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            Write-Host "Aviso: chat\modelo-activo.json no se puede leer; se usa el modelo predeterminado." -ForegroundColor Yellow
        }
        $claveActiva = if ($activo -and $activo.clave) { [string]$activo.clave } else { "" }
        $catActiva = if ($claveActiva) { $M.catalogo.$claveActiva } else { $null }
        if ($catActiva -and $catActiva.archivo -and (Test-Path (Join-Path $RootDir ("models\" + $catActiva.archivo)))) {
            # Se reutiliza el mismo camino que -Modelo: una sola resolucion del catalogo.
            $Modelo = $claveActiva
            $elegidoEnApp = $claveActiva
        } elseif ($claveActiva) {
            Write-Host ("Aviso: el modelo guardado '{0}' no esta en el catalogo o le falta el GGUF; se usa el predeterminado." -f $claveActiva) -ForegroundColor Yellow
        }
    }
}
if (-not $Modelo) { $Modelo = [string]$M.modeloPredeterminado }
if ($Modelo) {
    $cat = $M.catalogo.$Modelo
    if ($cat -and $cat.archivo) {
        $ModelFile = $cat.archivo
        if ($cat.bytes) { $ModelBytes = [int64]$cat.bytes }
        $ModelRol = $cat.rol
    } elseif ($Modelo -like "*.gguf") {
        $ModelFile = $Modelo
        $ModelRol = "suelto"
        # Un GGUF suelto no tiene bytes declarados en el catalogo. Sin esto se comparaba con
        # los del modelo por defecto y la opcion documentada NO arrancaba nunca salvo que el
        # fichero midiera exactamente lo mismo, con un error que hablaba de descarga cortada.
        $ModelBytes = 0
    } else {
        $claves = ($M.catalogo.PSObject.Properties | Where-Object { $_.Name -notlike "_*" } | ForEach-Object { $_.Name }) -join ", "
        Write-Error "Modelo desconocido: '$Modelo'. Claves del catalogo: $claves"
        exit 1
    }
}
$ModelPath = Join-Path $RootDir ("models\" + $ModelFile)
$Inv = [Globalization.CultureInfo]::InvariantCulture

# Razonamiento por modelo: solo los que lo admiten (catalogo.<clave>.pensar.compatible).
# bolding_v1 deja sin respuesta el 24 % de los prompts con thinking: ese nunca razona.
$claveModelo = ($M.catalogo.PSObject.Properties | Where-Object { $_.Name -notlike "_*" -and $_.Value.archivo -eq $ModelFile } | Select-Object -First 1).Name
$pensarCat = if ($claveModelo) { $M.catalogo.$claveModelo.pensar } else { $null }
$pensarCompatible = [bool]($pensarCat -and $pensarCat.compatible)
$pensarOrigen = "explicito"
if ($Pensar -lt 0) {
    # Auto: lo que diga el ajuste "Modo razonamiento" de la interfaz (chat\ui-settings.json).
    $pensarOrigen = "ajuste de la interfaz"
    $Pensar = if ($pensarCompatible) { [int]$pensarCat.presupuesto } else { 0 }
    $ajustesPath = Join-Path $RootDir "chat\ui-settings.json"
    if (Test-Path $ajustesPath) {
        try {
            $ajustes = Get-Content $ajustesPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($ajustes.pensar) { $Pensar = [int]$ajustes.pensar }
        } catch {
            Write-Host "Aviso: chat\ui-settings.json no se puede leer; se arranca sin razonamiento." -ForegroundColor Yellow
        }
    }
}
if ($pensarCompatible -and $Pensar -le 0) { $Pensar = [int]$pensarCat.presupuesto; Write-Host "Razonamiento activo con el presupuesto del modelo: $Pensar tokens." }
if ($Pensar -gt 0 -and -not $pensarCompatible) {
    Write-Host ("Aviso: {0} no admite el modo razonamiento (ver chat\modelo.json); se arranca sin el." -f $(if ($claveModelo) { $claveModelo } else { $ModelFile })) -ForegroundColor Yellow
    $Pensar = 0
}

if ($claveModelo -and $M.catalogo.$claveModelo.servidor.tipo -eq "gpu-completa") {
    # CUSTOM no tiene preset de referencia: el contexto/KV/vision llegan como parametros.
    if ($EnginePreset -and $EnginePreset -ne 'CUSTOM' -and -not $PSBoundParameters.ContainsKey('Vision') -and -not $PSBoundParameters.ContainsKey('VisionGpu')) {
        $Vision = [bool](Get-Content (Join-Path $RootDir 'config\local-engine-presets.json') -Raw | ConvertFrom-Json).$EnginePreset.vision
    }
    if ($SinVision) { $Vision = $false; $VisionGpu = $false }
    & (Join-Path $PSScriptRoot "start-gpu-model.ps1") -Modelo $claveModelo -ContextSize $ContextSize -Port $Port -HostIP $HostIP -KVCacheType $KVCacheType -Pensar $Pensar -DryRun:$DryRun -DormirSeg $DormirSeg -Vision:($Vision -or $VisionGpu) -ManagedByIDE:$ManagedByIDE -EnginePreset $EnginePreset
    exit $LASTEXITCODE
}

Write-Error "El modelo '$ModelFile' no tiene un perfil verificado de GPU completa. Selecciona ornith9b; no se admite descarga de tensores o vision a CPU."
exit 1
