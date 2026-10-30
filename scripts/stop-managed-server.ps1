# Detiene SOLO el llama-server administrado por esta instalacion.
#
# El marcador logs\servidor-administrado-PORT.json registra el PID real de llama-server.exe
# (pidServidor) y el del lanzador de PowerShell (wrapperPid). Si el lanzador murio pero el
# servidor sigue escuchando (fuga de BUG-05), este script lo reconoce por ejecutable, --port y
# modelo y lo cierra. Nunca toca un proceso ajeno: sin marcador valido, o con otro ejecutable,
# otro puerto u otro modelo, devuelve el mismo error de siempre y no lo detiene.
#
# Tambien entiende marcadores antiguos (solo `pid` del lanzador + `iniciado` + hijos).
param([Parameter(Mandatory=$true)][int]$Port, [switch]$CheckOnly)
$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$Marker = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
# Un servidor administrado puede usar el binario historico (bin\) o el optimizado
# para sm89 (.local\opt\...\build-RTX4060-Opt-sm89\bin\). Ambos son validos.
$ExpectedExes = @(
    [IO.Path]::GetFullPath((Join-Path $RootDir "bin\llama-server.exe")),
    [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe")),
    [IO.Path]::GetFullPath((Join-Path $RootDir ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe"))
)
$Catalogo = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
# Cualquiera de estos lanzadores es "nuestro" (historico u optimizado).
$StartScripts = @(
    (Join-Path $RootDir "scripts\start-server.ps1"),
    (Join-Path $RootDir "scripts\start-gpu-model-rtx4060-optimized.ps1")
)

function Get-Win32Process([int]$Id) {
    if ($Id -le 0) { return $null }
    $fila = @(Get-CimInstance Win32_Process -Filter ("ProcessId=" + $Id) -ErrorAction SilentlyContinue)
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
    if (-not $fila -or -not $fila.archivo -or $fila.servidor.tipo -ne "gpu-completa") { return "" }
    return [IO.Path]::GetFullPath((Join-Path $RootDir ("models\" + $fila.archivo)))
}
function Test-ServidorEsperado($Proceso, [string]$ModelPath) {
    if (-not $Proceso -or -not $Proceso.ExecutablePath) { return $false }
    $exe = Get-RealPath $Proceso.ExecutablePath
    if (-not ($ExpectedExes | Where-Object { $_ -ieq $exe })) { return $false }
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
$ListaEspera = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { [int]$_ })
$Servidores = New-Object System.Collections.Generic.List[int]
$Lanzador = $null

if ($MarkerValido) {
    $IniciadoMarcador = Read-Ticks ([string]$Info.iniciado)
    # 1) Marcador nuevo: el PID real de llama-server.exe, verificado por ejecutable, puerto,
    #    modelo y arranque posterior al del lanzador. iniciadoServidor queda como dato de
    #    diagnostico (no se exige igualdad exacta para no rechazar un cierre legitimo).
    if ($Info.pidServidor) {
        $srv = Get-Win32Process ([int]$Info.pidServidor)
        if ((Test-ServidorEsperado $srv $ModelPath) -and ((Get-StartTicks ([int]$Info.pidServidor)) -ge $IniciadoMarcador)) {
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
    if ($Servidores.Count -eq 0 -and -not $Lanzador) {
        foreach ($listener in $ListaEspera) {
            $srv = Get-Win32Process ($listener)
            if ((Test-ServidorEsperado $srv $ModelPath) -and ((Get-StartTicks $listener) -ge $IniciadoMarcador)) {
                $Servidores.Add([int]$listener)
            }
        }
    }
}
$Servidores = @($Servidores | Select-Object -Unique)

foreach ($listener in $ListaEspera) {
    if ($listener -notin $Servidores) {
        throw "El puerto $Port pertenece a un proceso que esta interfaz no administra. Cierra ese servidor manualmente si deseas cambiar el modelo."
    }
}
if ($CheckOnly) {
    if ($ListaEspera.Count -gt 0) { Write-Output "managed" }
    elseif ($Lanzador -or $Servidores.Count -gt 0) { Write-Output "starting" }
    else { Write-Output "empty" }
    exit 0
}
if ($Servidores.Count -eq 0) {
    if ($Lanzador) {
        throw "Hay un arranque administrado en curso para el puerto $Port; espera a que termine y vuelve a intentarlo."
    }
    # Marcador sin procesos: restos de un arranque que ya termino. Se descarta para no bloquear.
    if ($MarkerValido) { Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue }
    exit 0
}
foreach ($servidor in $Servidores) {
    Stop-Process -Id $servidor -Force -ErrorAction Stop
}
$limite = (Get-Date).AddSeconds(5)
while ((Get-Date) -lt $limite -and @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
    Start-Sleep -Milliseconds 100
}
Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue
