# Firma Authenticode de artefactos de Bonsai.
#   .\scripts\sign-release.ps1 -Path .\dist\BonsaiSetup.exe -PfxPath .\cert.pfx -PfxPassword "..."
#   .\scripts\sign-release.ps1 -Path .\dist\install.ps1 -PfxPath ... -PfxPassword ... -Verify
param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]]$Path,

    [string]$PfxPath = $env:BONSAI_SIGN_PFX,
    [string]$PfxPassword = $env:BONSAI_SIGN_PFX_PASSWORD,
    [string]$TimestampServer = "http://timestamp.digicert.com",
    [switch]$Verify
)

$ErrorActionPreference = "Stop"

function Find-SignTool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $kits = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    foreach ($kit in $kits) {
        $candidate = Join-Path $kit.FullName "x64\signtool.exe"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Import-PfxForSigning {
    param([string]$File, [string]$Password)
    if (-not (Test-Path -LiteralPath $File)) { throw "No existe el PFX: $File" }
    if (-not $Password) { throw "Falta la contraseña del PFX (-PfxPassword o BONSAI_SIGN_PFX_PASSWORD)" }
    $secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
    # Import-PfxCertificate existe en Windows PowerShell 5.1 y en pwsh 7;
    # Get-PfxCertificate -Password no está en 5.1.
    return Import-PfxCertificate -FilePath $File -CertStoreLocation Cert:\CurrentUser\My -Password $secure
}

if (-not $PfxPath) { throw "Falta -PfxPath o BONSAI_SIGN_PFX" }
$signtool = Find-SignTool
$archivos = @($Path | ForEach-Object { (Resolve-Path -LiteralPath $_).Path })
if (-not $archivos.Count) { throw "No hay archivos que firmar" }

foreach ($archivo in $archivos) {
    if (-not (Test-Path -LiteralPath $archivo)) { throw "No existe: $archivo" }
    $extension = [IO.Path]::GetExtension($archivo).ToLowerInvariant()
    if ($extension -in @(".ps1", ".psm1", ".psd1")) {
        # PowerShell usa Authenticode con Set-AuthenticodeSignature; signtool no
        # firma estos formatos. Se importa el PFX temporalmente y se retira.
        $cert = Import-PfxForSigning -File $PfxPath -Password $PfxPassword
        try {
            $firma = Set-AuthenticodeSignature -FilePath $archivo -Certificate $cert -TimestampServer $TimestampServer -HashAlgorithm SHA256
            if ($firma.Status -in @("NotSigned", "HashMismatch")) { throw "Firma no válida para ${archivo}: $($firma.StatusMessage)" }
            if ($firma.Status -ne "Valid") {
                Write-Warning "Firma aplicada pero la cadena no es de confianza (${archivo}: $($firma.Status)). Con un certificado público debe ser Valid."
            }
        } finally {
            Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
        }
        Write-Host "Firmado (PowerShell): $archivo"
        continue
    }

    if (-not $signtool) { throw "No se encontró signtool.exe; instala el Windows SDK o usa un runner windows-latest" }
    & $signtool sign /fd SHA256 /f $PfxPath /p $PfxPassword /tr $TimestampServer /td SHA256 $archivo
    if ($LASTEXITCODE -ne 0) { throw "signtool sign falló para ${archivo} (código $LASTEXITCODE)" }
    if ($Verify) {
        & $signtool verify /pa /v $archivo
        if ($LASTEXITCODE -ne 0) { throw "signtool verify falló para ${archivo} (código $LASTEXITCODE)" }
    }
    Write-Host "Firmado (PE): $archivo"
}

Write-Host "Firma completada. Comprueba con: Get-AuthenticodeSignature <archivo>"
