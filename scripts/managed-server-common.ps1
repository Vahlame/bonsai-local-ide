# Shared registry and launch critical section. Compatible with Windows PowerShell 5.1.
function Get-BonsaiBinaries {
    $registry = Get-Content -LiteralPath (Join-Path $RootDir 'config\llama-binaries.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($entry in $registry.binaries) {
        $expanded = [Environment]::ExpandEnvironmentVariables([string]$entry.relative)
        if (-not [IO.Path]::IsPathRooted($expanded)) { $expanded = Join-Path $RootDir $expanded }
        [pscustomobject]@{ id = [string]$entry.id; exe = [IO.Path]::GetFullPath($expanded) }
    }
}
function Get-BonsaiMutex {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($RootDir.ToLowerInvariant()))).Replace('-', '') }
    finally { $sha.Dispose() }
    return New-Object Threading.Mutex($false, "Local\Bonsai-$hash-$Port")
}
function Enter-BonsaiMutex($Mutex, [int]$TimeoutMs = 35000) {
    try { $entered = $Mutex.WaitOne($TimeoutMs) } catch [Threading.AbandonedMutexException] { $entered = $true }
    if (-not $entered) { throw 'Hay una operacion administrada en curso' }
}

function Start-BonsaiManagedProcess($Metadata) {
    $markerPath = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
    $tempPath = "$markerPath.$PID.tmp"
    $exec = $null
    $mutex = Get-BonsaiMutex
    $locked = $false
    $ownsMarker = $false
    try {
        Enter-BonsaiMutex $mutex
        $locked = $true
        $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        if (@($listeners | Where-Object { $_.Port -eq $Port }).Count) { throw "El puerto $Port ya esta ocupado" }
        if ($ManagedByIDE -and (Test-Path -LiteralPath $markerPath)) {
            $old = $null
            try { $old = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json } catch { }
            foreach ($identity in @(@{ id = $old.wrapperPid; ticks = $old.iniciado }, @{ id = $old.pidServidor; ticks = $old.iniciadoServidor }, @{ id = $old.pid; ticks = $old.iniciado })) {
                $oldProcess = if ($identity.id) { Get-Process -Id ([int]$identity.id) -ErrorAction SilentlyContinue } else { $null }
                if ($oldProcess -and $identity.ticks -and $oldProcess.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$identity.ticks) {
                    throw "Existe un marcador con procesos vivos en $Port; detener antes de arrancar"
                }
            }
            Remove-Item -LiteralPath $markerPath -Force
        }
        $wrapper = Get-Process -Id $PID -ErrorAction Stop
        $Metadata.wrapperPid = $PID
        $Metadata.pid = $PID
        $Metadata.iniciado = $wrapper.StartTime.ToUniversalTime().Ticks.ToString()
        $Metadata.binId = $Binary.id
        $Metadata.exe = $BinPath
        $Metadata.vramBeforeMiB = $FreeMiB
        function Write-LaunchMarker {
            [IO.File]::WriteAllText($tempPath, ($Metadata | ConvertTo-Json -Compress -Depth 6), (New-Object Text.UTF8Encoding($false)))
            if (Test-Path -LiteralPath $markerPath) { [IO.File]::Replace($tempPath, $markerPath, [System.Management.Automation.Language.NullString]::Value) }
            else { [IO.File]::Move($tempPath, $markerPath) }
        }
        if ($ManagedByIDE) {
            New-Item -ItemType Directory -Force (Split-Path -Parent $markerPath) | Out-Null
            Write-LaunchMarker
            $ownsMarker = $true
        }
        if (-not $env:BONSAI_LLAMA_LOG_PREFIX) { $env:BONSAI_LLAMA_LOG_PREFIX = Join-Path $RootDir "logs\llama-server-$Port" }
        $exec = Start-Process -FilePath $BinPath -ArgumentList $ArgumentLine -PassThru -NoNewWindow -RedirectStandardOutput ($env:BONSAI_LLAMA_LOG_PREFIX + '.out.log') -RedirectStandardError ($env:BONSAI_LLAMA_LOG_PREFIX + '.err.log')
        $null = $exec.Handle
        if ($ManagedByIDE) {
            $Metadata.pidServidor = $exec.Id
            $Metadata.iniciadoServidor = $exec.StartTime.ToUniversalTime().Ticks.ToString()
            Write-LaunchMarker
        }
        if ($Json) { [Console]::Out.WriteLine((@{ ok = $true; state = 'starting'; port = $Port; wrapperPid = $PID; serverPid = $exec.Id; binId = $Binary.id; exe = $BinPath } | ConvertTo-Json -Compress)) }
        $mutex.ReleaseMutex(); $locked = $false
        if ($IsMoe) {
            try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'win-optimize-process.ps1') -Pid $exec.Id | Out-Null } catch { }
        }
        $exec.WaitForExit()
        if ($null -eq $exec.ExitCode) { return 1 }
        return [int]$exec.ExitCode
    } finally {
        # On launch/marker failure the exact process we just created is ours.
        if ($exec -and -not $exec.HasExited) {
            Stop-Process -Id $exec.Id -Force -ErrorAction Stop
            if (-not $exec.WaitForExit(8000)) { throw "El hijo $($exec.Id) no termino; se conserva el marcador" }
        }
        if ($ownsMarker -and (Test-Path -LiteralPath $markerPath)) {
            $saved = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
            if ($saved.wrapperPid -eq $PID -and $saved.iniciado -eq $Metadata.iniciado) { Remove-Item -LiteralPath $markerPath -Force }
        }
        if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
