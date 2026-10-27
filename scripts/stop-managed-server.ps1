param([Parameter(Mandatory=$true)][int]$Port, [switch]$CheckOnly)
$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$Marker = Join-Path $RootDir "logs\servidor-administrado-$Port.json"
$ExpectedExe = [IO.Path]::GetFullPath((Join-Path $RootDir "bin\llama-server.exe"))
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$owner = $null
if (Test-Path -LiteralPath $Marker) {
    try {
        $info = Get-Content -LiteralPath $Marker -Raw | ConvertFrom-Json
        $candidate = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$info.pid) -ErrorAction Stop
        $p = Get-Process -Id ([int]$info.pid) -ErrorAction Stop
        if ([int]$info.puerto -eq $Port -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$info.iniciado -and
            $candidate.Name -match '^powershell(\.exe)?$' -and
            $candidate.CommandLine -match '(?i)(?:^|\s)-ManagedByIDE(?:\s|$)' -and
            $candidate.CommandLine -like ("*" + (Join-Path $RootDir "scripts\start-server.ps1") + "*")) { $owner = $candidate }
    } catch { $owner = $null }
}
$managed = @()
if ($owner) {
    $managed = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $owner.ProcessId) -ErrorAction Stop | Where-Object {
        $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $ExpectedExe -and
        $_.CommandLine -match ("(?i)(?:^|\s)--port\s+" + $Port + "(?:\s|$)")
    })
}
foreach ($listener in $listeners) {
    if ($listener -notin @($managed | ForEach-Object { [int]$_.ProcessId })) {
        throw "El puerto $Port pertenece a un proceso que esta interfaz no administra. Cierra ese servidor manualmente si deseas cambiar el modelo."
    }
}
if ($CheckOnly) {
    if ($listeners.Count -gt 0) { Write-Output "managed" }
    elseif ($owner) { Write-Output "starting" }
    else { Write-Output "empty" }
    exit 0
}
foreach ($child in $managed) {
    Stop-Process -Id $child.ProcessId -Force -ErrorAction Stop
}
if ($owner -and $managed.Count -eq 0) {
    throw "Hay un arranque administrado en curso para el puerto $Port; espera a que termine y vuelve a intentarlo."
}
