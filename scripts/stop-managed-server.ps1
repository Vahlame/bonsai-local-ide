# Detiene SOLO el llama-server administrado por esta instalacion.
#
# El marcador logs\servidor-administrado-PORT.json registra el PID real de llama-server.exe
# (pidServidor) y el del lanzador de PowerShell (wrapperPid). Si el lanzador murio pero el
# servidor sigue escuchando (fuga de BUG-05), este script lo reconoce por ejecutable, --port y
# modelo y lo cierra. Nunca toca un proceso ajeno: sin marcador valido, o con otro ejecutable,
# otro puerto u otro modelo, devuelve el mismo error de siempre y no lo detiene.
#
# Tambien entiende marcadores antiguos (solo `pid` del lanzador + `iniciado` + hijos).
param([Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port, [switch]$CheckOnly, [switch]$Json, [switch]$AllowStarting, [int]$TimeoutMs = 35000)
$ErrorActionPreference = "Stop"
if ($Json) { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) }
$RootDir = Split-Path -Parent $PSScriptRoot
$Marker = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
. (Join-Path $PSScriptRoot 'managed-server-common.ps1')
$Binaries = @(Get-BonsaiBinaries)
$ExpectedExes = @($Binaries | ForEach-Object { $_.exe })
$mutex = Get-BonsaiMutex
$locked = $false
$Info = $null
$Servidores = @()
$Lanzador = $null
$ListaEspera = @()
try {
Enter-BonsaiMutex $mutex $TimeoutMs
$locked = $true
$Catalogo = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
# Model Hub: modelos descargados en models/hub-catalog.json. Sin esto, un
# llama-server de un modelo del Hub no se reconocería como propio y no se podría
# detener ni cambiar.
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
    } catch { }
}
# Cualquiera de estos lanzadores es "nuestro" (historico u optimizado).
$StartScripts = @(
    (Join-Path $RootDir "scripts\start-server.ps1"),
    (Join-Path $RootDir "scripts\start-gpu-model.ps1"),
    (Join-Path $RootDir "scripts\start-gpu-model-rtx4060-optimized.ps1")
)

function Get-Win32Process([int]$Id) {
    if ($Id -le 0) { return $null }
    $fila = @(Get-CimInstance Win32_Process -Filter ("ProcessId=" + $Id) -ErrorAction Stop)
    if ($fila.Count -eq 0) { return $null }
    return $fila[0]
}
function Get-RealPath($Value) {
    if (-not $Value) { return "" }
    try { return [IO.Path]::GetFullPath([string]$Value) } catch { return "" }
}
function Get-StartTicks([int]$Id) {
    try { return (Get-Process -Id $Id -ErrorAction Stop).StartTime.ToUniversalTime().Ticks } catch { return [int64]0 }
}
function Read-Ticks([string]$Texto) {
    $ticks = [int64]0
    if ([int64]::TryParse([string]$Texto, [ref]$ticks)) { return $ticks }
    return [int64]0
}
# Del marcador sale el GGUF que se lanzo: exe esperado + --port + -m del modelo del marcador.
function Get-ModelPathDelMarcador($Info) {
    if (-not $Info -or -not $Info.modelo) { return "" }
    $fila = $Catalogo.catalogo.([string]$Info.modelo)
    if (-not $fila -or -not $fila.archivo -or ($fila.servidor.tipo -ne "gpu-completa" -and $fila.servidor.tipo -ne "moe-hibrido")) { return "" }
    return [IO.Path]::GetFullPath((Join-Path $RootDir ("models\" + $fila.archivo)))
}
function Test-ServidorEsperado($Proceso, [string]$ModelPath) {
    if (-not $Proceso -or -not $Proceso.ExecutablePath) { return $false }
    $exe = Get-RealPath $Proceso.ExecutablePath
    if (-not ($ExpectedExes | Where-Object { $_ -ieq $exe })) { return $false }
    if ($Info.binId -or $Info.exe) {
        $entry = $Binaries | Where-Object { $_.id -ceq [string]$Info.binId } | Select-Object -First 1
        if (-not $entry -or $entry.exe -ine (Get-RealPath $Info.exe) -or $entry.exe -ine $exe) { return $false }
    }
    $cmd = [string]$Proceso.CommandLine
    if (-not $cmd) { return $false }
    if (-not ($cmd -match ("(?i)(?:^|\s)--port\s+" + $Port + "(?:\s|$)"))) { return $false }
    if ($ModelPath) {
        $plano = $cmd -replace '"', ''
        if (-not ($plano -match ("(?i)(?:^|\s)-m\s+" + [regex]::Escape($ModelPath) + "(?:\s|$)"))) { return $false }
    }
    return $true
}
function Test-Lanzador($Proceso, $Info) {
    if (-not $Proceso) { return $false }
    if ($Proceso.Name -notmatch '^powershell(\.exe)?$') { return $false }
    $cmd = [string]$Proceso.CommandLine
    if (-not $cmd) { return $false }
    if ($cmd -notmatch '(?i)(?:^|\s)-ManagedByIDE(?:\s|$)') { return $false }
    $esNuestro = $false
    foreach ($script in $StartScripts) { if ($cmd -like ("*" + $script + "*")) { $esNuestro = $true; break } }
    if (-not $esNuestro) { return $false }
    if ($cmd -match '(?i)(?:^|\s)-Port\s+(\d+)(?:\s|$)' -and [int]$Matches[1] -ne $Port) { return $false }
    $marcador = Read-Ticks ([string]$Info.iniciado)
    if ($marcador -le 0) { return $false }
    return ((Get-StartTicks ([int]$Proceso.ProcessId)) -eq $marcador)
}

# Marcador: solo vale si es de este puerto, de un modelo de GPU completa del catalogo y tiene fecha.
$Info = $null
$MarkerValido = $false
if (Test-Path -LiteralPath $Marker) {
    try { $Info = Get-Content -LiteralPath $Marker -Raw | ConvertFrom-Json } catch { $Info = $null }
    if ($Info -and [int]$Info.puerto -eq $Port -and (Read-Ticks ([string]$Info.iniciado)) -gt 0) {
        if (Get-ModelPathDelMarcador $Info) { $MarkerValido = $true }
    }
}
$ModelPath = if ($MarkerValido) { Get-ModelPathDelMarcador $Info } else { "" }
function Get-Listeners {
    # Query the class, rather than swallowing access/transport errors as an empty port.
    @(Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetTCPConnection -Filter "LocalPort=$Port AND State=2" -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { [int]$_ })
}
$ListaEspera = @(Get-Listeners)
$Servidores = New-Object System.Collections.Generic.List[int]
$Lanzador = $null

if ($MarkerValido) {
    $IniciadoMarcador = Read-Ticks ([string]$Info.iniciado)
    # 1) Marcador nuevo: el PID real de llama-server.exe, verificado por ejecutable, puerto,
    #    modelo y arranque posterior al del lanzador. Si iniciadoServidor esta presente,
    #    debe coincidir exactamente para rechazar un PID reutilizado.
    if ($Info.pidServidor) {
        $srv = Get-Win32Process ([int]$Info.pidServidor)
        if ((Test-ServidorEsperado $srv $ModelPath) -and ((Get-StartTicks ([int]$Info.pidServidor)) -ge $IniciadoMarcador) -and
            (-not $Info.iniciadoServidor -or (Get-StartTicks ([int]$Info.pidServidor)) -eq (Read-Ticks ([string]$Info.iniciadoServidor)))) {
            $Servidores.Add([int]$Info.pidServidor)
        }
    }
    # 2) Lanzador vivo (marcador nuevo: wrapperPid; antiguo: pid) y sus hijos directos.
    $WrapperId = 0
    if ($Info.wrapperPid) { $WrapperId = [int]$Info.wrapperPid } elseif ($Info.pid) { $WrapperId = [int]$Info.pid }
    $candidato = Get-Win32Process $WrapperId
    if (Test-Lanzador $candidato $Info) {
        $Lanzador = $candidato
        foreach ($hijo in @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $WrapperId) -ErrorAction SilentlyContinue)) {
            if ((Test-ServidorEsperado $hijo $ModelPath) -and ((Get-StartTicks ([int]$hijo.ProcessId)) -ge $IniciadoMarcador)) {
                $Servidores.Add([int]$hijo.ProcessId)
            }
        }
    }
    # 3) Huerfano (BUG-05): el lanzador ya no existe, pero el marcador identifica el modelo que
    #    se lanzo y el listener es el bin\llama-server.exe esperado con el --port correcto.
    if ($Servidores.Count -eq 0 -and -not $Lanzador -and -not $Info.pidServidor) {
        foreach ($listener in $ListaEspera) {
            $srv = Get-Win32Process ($listener)
            if ((Test-ServidorEsperado $srv $ModelPath) -and $srv.ParentProcessId -eq $WrapperId -and ((Get-StartTicks $listener) -ge $IniciadoMarcador)) {
                $Servidores.Add([int]$listener)
            }
        }
    }
}
$Servidores = @($Servidores | Select-Object -Unique)


$foreign = @($ListaEspera | Where-Object { $_ -notin $Servidores })
$state = if ($foreign.Count) { 'foreign' } elseif ($ListaEspera.Count) { 'ready' } elseif ($Lanzador -or $Servidores.Count) { 'starting' } else { 'empty' }
$Details = [ordered]@{
    ok = $true; state = $state; port = $Port; marker = $Info; markerPath = $Marker;
    wrapperPid = $(if ($Lanzador) { [int]$Lanzador.ProcessId } else { $null });
    serverPid = $(if ($Servidores.Count) { [int]$Servidores[0] } else { $null });
    exe = $(if ($Servidores.Count) { (Get-Win32Process $Servidores[0]).ExecutablePath } else { $Info.exe });
    binId = $Info.binId; model = $Info.modelo; listenerPids = $ListaEspera;
    portClosed = ($ListaEspera.Count -eq 0); markerRemoved = (-not (Test-Path -LiteralPath $Marker))
}
if ($CheckOnly) {
    if ($Json) { $Details | ConvertTo-Json -Compress -Depth 8 }
    elseif ($state -eq 'foreign') { throw "El puerto $Port pertenece a un proceso que esta interfaz no administra" }
    elseif ($state -eq 'ready') { Write-Output 'managed' }
    else { Write-Output $state }
    exit 0
}
if ($state -eq 'foreign') { throw "El puerto $Port pertenece a un proceso que esta interfaz no administra" }
if ($Lanzador -and -not $Servidores.Count -and -not $AllowStarting) {
    throw "Hay un arranque administrado en curso para el puerto $Port"
}
$stopped = New-Object 'System.Collections.Generic.List[int]'
$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
# Revalidate immediately before killing: a reused PID is never permission to kill.
foreach ($serverId in $Servidores) {
    $proc = Get-Win32Process $serverId
    if ($proc -and -not (Test-ServidorEsperado $proc $ModelPath)) { throw "Cambio la identidad del PID $serverId; no se detiene" }
    if ($proc -and $Info.pidServidor -eq $serverId -and $Info.iniciadoServidor -and (Get-StartTicks $serverId) -ne (Read-Ticks ([string]$Info.iniciadoServidor))) { throw "Cambio la fecha del PID $serverId" }
    if ($proc) { Stop-Process -Id $serverId -Force -ErrorAction Stop; $stopped.Add($serverId) }
}
# Wait for the model and port before forcing a wrapper that did not exit naturally.
if ($Servidores.Count) {
    do {
        $modelAlive = @($Servidores | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        $modelListeners = @(Get-Listeners)
        if (-not $modelAlive.Count -and -not $modelListeners.Count) { break }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    if ($modelAlive.Count -or $modelListeners.Count) { throw "El modelo o puerto $Port siguen vivos; se conserva el marcador" }
}
# In a start cancellation the wrapper must stop creating children before the final scan.
if ($Lanzador) {
    $wrapperId = [int]$Lanzador.ProcessId
    $proc = Get-Win32Process $wrapperId
    if ($proc -and -not (Test-Lanzador $proc $Info)) { throw "Cambio la identidad del wrapper $wrapperId" }
    if ($proc) { Stop-Process -Id $wrapperId -Force -ErrorAction Stop; $stopped.Add($wrapperId) }
    $children = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $wrapperId) -ErrorAction Stop)
    foreach ($child in $children) {
        if (Test-ServidorEsperado $child $ModelPath) {
            $childId = [int]$child.ProcessId
            if ((Get-StartTicks $childId) -ge (Read-Ticks ([string]$Info.iniciado))) {
                Stop-Process -Id $childId -Force -ErrorAction Stop
                if ($childId -notin $Servidores) { $Servidores += $childId }
                $stopped.Add($childId)
            }
        }
    }
}
$checkIds = @($Servidores) + @($stopped)
do {
    $alive = @($checkIds | Select-Object -Unique | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    $listeners = @(Get-Listeners)
    if (-not $alive.Count -and -not $listeners.Count) { break }
    Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
if ($alive.Count -or $listeners.Count) { throw "El servidor del puerto $Port sigue vivo; PID(s): $($alive -join ','); se conserva el marcador" }
if (Test-Path -LiteralPath $Marker) { Remove-Item -LiteralPath $Marker -Force -ErrorAction Stop }
if (Test-Path -LiteralPath $Marker) { throw 'No se pudo borrar el marcador' }
if ($Json) {
    $Details.state = 'empty'
    $Details.portClosed = $true
    $Details.markerRemoved = $true
    $Details.stoppedPids = @($stopped | Select-Object -Unique)
    $Details | ConvertTo-Json -Compress -Depth 8
}
} catch {
    if ($Json) {
        [ordered]@{ ok = $false; state = $(if ($state -eq 'foreign') { 'foreign' } else { 'error' });
            error = $_.Exception.Message; port = $Port; marker = $Info; markerPath = $Marker;
            serverPids = @($Servidores); wrapperPid = $(if ($Lanzador) { $Lanzador.ProcessId } else { $null });
            listenerPids = @($ListaEspera); markerRemoved = (-not (Test-Path -LiteralPath $Marker)) } | ConvertTo-Json -Compress -Depth 8
        exit 1
    }
    throw
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
