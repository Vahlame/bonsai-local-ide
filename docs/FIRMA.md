# Firma de artefactos (Authenticode)

El ZIP portable no se puede firmar con Authenticode: Authenticode firma
ejecutables PE (`.exe`, `.dll`, `.msi`) y scripts de PowerShell, no un `.zip`.
La release publica el ZIP con su SHA-256; para una experiencia "Editor
desconocido" → "Bonsai Local IDE" hace falta firmar un **instalador** o un
**bootstrapper**.

## Opciones de certificado

| Opción | Uso | Coste |
|---|---|---|
| Autofirmado | Pruebas locales; los usuarios verán "Editor desconocido" salvo que importen el certificado | 0 |
| OV Code Signing | Firma normal en Windows; SmartScreen gana reputación con el tiempo | ~200-400 €/año |
| EV Code Signing | Reputación SmartScreen inmediata; suele exigir token/HSM | ~400-800 €/año |
| Azure Trusted Signing | Firma en CI sin PFX ni token; integración oficial con GitHub Actions | pago por uso |
| SignPath.io | Firma gratuita para proyectos open source | 0 para OSS |

Para GitHub Actions **no uses un token USB**: el runner no lo ve. Usa un PFX
exportable (OV), Azure Trusted Signing, SSL.com eSigner o SignPath.

## Prueba local con certificado autofirmado

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Bonsai Local IDE (dev)" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyUsage DigitalSignature `
  -FriendlyName "Bonsai Dev"

$pwd = ConvertTo-SecureString -String "CambiaEstaClave" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "$env:TEMP\bonsai-dev.pfx" -Password $pwd

.\scripts\sign-release.ps1 `
  -Path ".\dist\BonsaiSetup.exe" `
  -PfxPath "$env:TEMP\bonsai-dev.pfx" `
  -PfxPassword "CambiaEstaClave"

Get-AuthenticodeSignature ".\dist\BonsaiSetup.exe" | Format-List Status,SignerCertificate
```

Para que otro equipo lo acepte sin aviso, importa el certificado en
`Cert:\LocalMachine\TrustedPeople` (o `TrustedPublisher`) y en `Root`; eso solo
es aceptable en pruebas internas, nunca para distribución pública.

## Con un certificado real

```powershell
.\scripts\sign-release.ps1 `
  -Path ".\dist\BonsaiSetup.exe", ".\dist\BonsaiSetup.msi" `
  -PfxPath "C:\secrets\bonsai-codesign.pfx" `
  -PfxPassword $env:BONSAI_SIGN_PFX_PASSWORD
```

El helper usa `signtool sign /fd SHA256 /tr <timestamp> /td SHA256` y luego
`signtool verify /pa`. Para `.ps1` usa `Set-AuthenticodeSignature`. Si no hay
`signtool.exe`, busca la última versión x64 del Windows SDK.

## GitHub Actions

Guarda el PFX en base64 y la contraseña como secretos del repositorio:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("bonsai-codesign.pfx")) |
  Set-Clipboard
```

```text
SIGN_PFX_BASE64
SIGN_PFX_PASSWORD
```

En el workflow de release:

```yaml
env:
  SIGN_PFX_BASE64: ${{ secrets.SIGN_PFX_BASE64 }}
  SIGN_PFX_PASSWORD: ${{ secrets.SIGN_PFX_PASSWORD }}

steps:
  - name: Firmar instalador
    if: ${{ env.SIGN_PFX_BASE64 != '' }}
    shell: pwsh
    run: |
      $pfx = Join-Path $env:RUNNER_TEMP "bonsai.pfx"
      [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:SIGN_PFX_BASE64))
      ./scripts/sign-release.ps1 -Path "dist/BonsaiSetup.exe" -PfxPath $pfx -PfxPassword $env:SIGN_PFX_PASSWORD
```

Si el proyecto no genera un `.exe`/`.msi`, la alternativa es un bootstrapper
`.ps1` firmado que descarga el ZIP y verifica el SHA-256 embebido. El ZIP y su
`.sha256` siguen publicándose para verificación manual.

## Qué no firmar

- No firmes `llama-server.exe` ni DLLs de terceros como si fueran tuyos: la
  firma implica que tú eres el editor. Si redistribuyes el runtime, firma tu
  instalador/contenedor, no el binario ajeno.
- No publiques el PFX ni la contraseña; el PFX en base64 solo va en secretos.
- No uses `Set-AuthenticodeSignature` sobre el ZIP: fallará o no aportará nada.

## Estado actual

La release 2.5.1 publica ZIP + SHA-256 + SBOM. La firma Authenticode queda
pendiente de certificado; el workflow no finge firmar lo que no puede.
