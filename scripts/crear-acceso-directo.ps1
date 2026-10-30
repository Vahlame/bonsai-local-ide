# ==============================================================================
# Crea el acceso directo "Bonsai IDE" en el escritorio.
#   .\scripts\crear-acceso-directo.ps1
#
# El acceso directo abre el IDE en su VENTANA DE APLICACIÓN (sin GPU) y deja el
# servidor Node en segundo plano; el modelo se arranca con "Iniciar" en la barra.
#
# IMPORTANTE: no añadir -NoBrowser. Con ese flag el lanzador arranca la interfaz
# pero no abre ninguna ventana, que es justo el síntoma de "le doy doble clic y no
# se abre nada".
# ==============================================================================

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$Icono = Join-Path $RootDir "recursos\bonsai-ide.ico"
$Launcher = Join-Path $RootDir "scripts\bonsai-rtx4060.ps1"
$Escritorio = [Environment]::GetFolderPath("Desktop")
$Destino = Join-Path $Escritorio "Bonsai IDE.lnk"

if (-not (Test-Path $Launcher)) { Write-Error "No está $Launcher"; exit 1 }
if (-not (Test-Path $Icono)) {
    Write-Host "No hay icono en $Icono; se genera con: python scripts\crear-icono.py" -ForegroundColor Yellow
}

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($Destino)
$lnk.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`" launch"
$lnk.WorkingDirectory = $RootDir
if (Test-Path $Icono) { $lnk.IconLocation = "$Icono,0" }
$lnk.Description = "Bonsai IDE: abre el IDE en su ventana (sin GPU); el modelo se inicia desde la barra"
$lnk.WindowStyle = 7
$lnk.Save()

$comprobado = $shell.CreateShortcut($Destino)
Write-Host "Acceso directo creado:" -ForegroundColor Green
Write-Host ("  {0}" -f $Destino)
Write-Host ("  destino : {0}" -f $comprobado.TargetPath)
Write-Host ("  args    : {0}" -f $comprobado.Arguments)
Write-Host ("  carpeta : {0}" -f $comprobado.WorkingDirectory)
Write-Host ("  icono   : {0}" -f $comprobado.IconLocation)
