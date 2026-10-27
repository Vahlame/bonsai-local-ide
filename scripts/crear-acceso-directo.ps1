# ==============================================================================
# Crea el acceso directo "Bonsai IDE" en el escritorio.
#   .\scripts\crear-acceso-directo.ps1
#
# El acceso directo abre la interfaz completa: arranca llama-server si no está
# (con visión, si el mmproj está descargado), levanta la interfaz y abre el navegador.
# ==============================================================================

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$Icono = Join-Path $RootDir "recursos\bonsai-ide.ico"
$StartUi = Join-Path $RootDir "scripts\start-ui.ps1"
$Escritorio = [Environment]::GetFolderPath("Desktop")
$Destino = Join-Path $Escritorio "Bonsai IDE.lnk"

if (-not (Test-Path $StartUi)) { Write-Error "No está $StartUi"; exit 1 }
if (-not (Test-Path $Icono)) {
    Write-Host "No hay icono en $Icono; se genera con: python scripts\crear-icono.py" -ForegroundColor Yellow
}

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($Destino)
$lnk.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$StartUi`""
$lnk.WorkingDirectory = $RootDir
if (Test-Path $Icono) { $lnk.IconLocation = "$Icono,0" }
$lnk.Description = "Bonsai IDE: chat local con el modelo en la GPU (abre la interfaz en el navegador)"
$lnk.WindowStyle = 1
$lnk.Save()

$comprobado = $shell.CreateShortcut($Destino)
Write-Host "Acceso directo creado:" -ForegroundColor Green
Write-Host ("  {0}" -f $Destino)
Write-Host ("  destino : {0}" -f $comprobado.TargetPath)
Write-Host ("  args    : {0}" -f $comprobado.Arguments)
Write-Host ("  carpeta : {0}" -f $comprobado.WorkingDirectory)
Write-Host ("  icono   : {0}" -f $comprobado.IconLocation)
