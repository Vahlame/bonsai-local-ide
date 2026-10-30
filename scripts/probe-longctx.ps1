<#
.SYNOPSIS
    Long-context retrieval probe: 3 needles at 10/50/90% depth.

.DESCRIPTION
    Starts the optimized server at a given context/KV (vision optional), builds a
    prompt that fills ~Ratio of the window, places three access codes at 10/50/90%,
    and asks for them in order. This checks that the extra context is actually
    usable, not just allocatable.

    Reports prompt_n (real tokens) and PASS/FAIL to reports/longctx-<stamp>.md.
#>

param(
    [string]$KV = "q8_0",
    [int]$Context = 71680,
    [int]$Port = 8097,
    [double]$Ratio = 0.8,
    [int]$Think = 0,
    [switch]$Vision,
    [switch]$CPUProjector,
    [string]$Image = ""
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$BinCands = @(
    (Join-Path $RootDir ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe"),
    (Join-Path $env:USERPROFILE ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe")
)
$Bin = $BinCands | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Bin) { throw "Falta el binario optimizado." }
$Model = Join-Path $RootDir "models\Ornith-1.5-9B-Q4_K_M.gguf"
$Cat = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Proj = Join-Path $RootDir ("models\" + $Cat.catalogo.ornith9b.vision.archivo)
$Tpl = Join-Path $RootDir "logs\chat_template_longctx.jinja"
$Cat.catalogo.ornith9b.chat_template | Set-Content -LiteralPath $Tpl -Encoding UTF8 -NoNewline

$Codes = @("QX-7419", "ZK-2288", "RM-5306")

# Filler: frases ~17 tokens. Se insertan 3 agujas en 10/50/90%.
$target = [int]($Context * $Ratio)
$n = [math]::Max(200, [int]($target / 17))
$sb = [System.Text.StringBuilder]::new()
$p10 = [int]($n * 0.10); $p50 = [int]($n * 0.50); $p90 = [int]($n * 0.90)
for ($i = 1; $i -le $n; $i++) {
    if ($i -eq $p10) { [void]$sb.Append("Nota: primer codigo de acceso $($Codes[0]). ") }
    if ($i -eq $p50) { [void]$sb.Append("Nota: segundo codigo de acceso $($Codes[1]). ") }
    if ($i -eq $p90) { [void]$sb.Append("Nota: tercer codigo de acceso $($Codes[2]). ") }
    [void]$sb.Append("Registro $i del expediente conserva fecha, sello y firma del responsable. ")
}
$prompt = $sb.ToString() + "`n`nResponde SOLO los tres codigos de acceso, en orden y separados por coma."

$args = @(
    "-m", $Model, "--gpu-layers", "99", "--flash-attn", "on",
    "-c", "$Context", "-ctk", $KV, "-ctv", $KV,
    "-b", "512", "-ub", "256", "-t", "4",
    "--host", "127.0.0.1", "--port", "$Port", "--jinja", "--metrics", "-lv", "2",
    "--spec-type", "none", "--no-context-shift", "--ctx-checkpoints", "0",
    "--chat-template-file", $Tpl,
    "--reasoning-budget", "$Think", "--reasoning-format", "deepseek"
)
if ($Vision) {
    $args += @("--mmproj", $Proj)
    if ($CPUProjector) { $args += @("--no-mmproj-offload") } else { $args += @("--mmproj-offload", "--mmproj-device", "CUDA0") }
    $args += @("--image-max-tokens", "512")
}

Get-Process llama-server* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
# Igual que en el probe de techo: esperar a que el driver libere la VRAM anterior.
$libreEspera = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $libreEspera) {
    try {
        $libre = [int]((& nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits) | Select-Object -First 1)
        if ($libre -ge 7600) { break }
    } catch { break }
    Start-Sleep -Milliseconds 700
}

$logOut = Join-Path $RootDir "logs\longctx-$KV-$Context.out.log"
$logErr = Join-Path $RootDir "logs\longctx-$KV-$Context.err.log"
$p = Start-Process -FilePath $Bin -ArgumentList (($args | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ') -PassThru -NoNewWindow -RedirectStandardOutput $logOut -RedirectStandardError $logErr
$deadline = (Get-Date).AddSeconds(180); $healthy = $false
while ((Get-Date) -lt $deadline) {
    if ($p.HasExited) { break }
    try { if ((Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $healthy = $true; break } } catch {}
    Start-Sleep -Milliseconds 800
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $RootDir "reports\longctx-$stamp.md"
$ok = $false; $promptN = 0; $reply = ""; $note = ""
$visOk = $null; $visMs = 0; $visReply = ""; $peak = 0; $free = 0
if ($healthy) {
    try {
        $body = @{ model = "Ornith-1.5-9B"; messages = @(@{ role = "user"; content = $prompt }); max_tokens = 64; temperature = 0.2; reasoning_budget = $Think } | ConvertTo-Json -Depth 6
        $r = Invoke-RestMethod "http://127.0.0.1:$Port/v1/chat/completions" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body -TimeoutSec 600
        $reply = [string]$r.choices[0].message.content
        $promptN = [int]$r.timings.prompt_n
        $a = $reply.IndexOf($Codes[0]); $b = $reply.IndexOf($Codes[1]); $c = $reply.IndexOf($Codes[2])
        $ok = ($a -ge 0 -and $b -ge 0 -and $c -ge 0 -and $a -lt $b -and $b -lt $c)
    } catch { $note = "request-error: $($_.Exception.Message)" }
    # Imagen real: comprueba que el proyector (GPU o CPU) sigue entendiendo capturas y mide latencia.
    if ($Image -and (Test-Path -LiteralPath $Image)) {
        try {
            $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $Image)))
            $content = @(
                @{ type = "text"; text = "Mira esta captura del IDE. Enumera en una sola linea los paneles o zonas que ves." },
                @{ type = "image_url"; image_url = @{ url = "data:image/png;base64,$b64" } }
            )
            $vbody = @{ model = "Ornith-1.5-9B"; messages = @(@{ role = "user"; content = $content }); max_tokens = 120; temperature = 0.2; reasoning_budget = 0 } | ConvertTo-Json -Depth 8
            $t0 = Get-Date
            $vr = Invoke-RestMethod "http://127.0.0.1:$Port/v1/chat/completions" -Method POST -Headers @{"Content-Type"="application/json"} -Body $vbody -TimeoutSec 900
            $visMs = [int]((Get-Date) - $t0).TotalMilliseconds
            $visReply = [string]$vr.choices[0].message.content
            $v = $visReply.ToLowerInvariant()
            $hits = @("chat", "explorador", "editor", "historial", "terminal", "problemas", "esquema", "modelo", "respuesta", "contexto", "configuraci", "panel", "secci", "campo", "agente") | Where-Object { $v.Contains($_) }
            $visOk = ($hits.Count -ge 2)
        } catch { $note += " vision-error: $($_.Exception.Message)" }
    }
    try {
        $mem = & nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader,nounits
        $parts = ($mem -split ',') | ForEach-Object { [int]([string]$_).Trim() }
        $peak = $parts[0]; $free = $parts[1]
    } catch {}
} else {
    $note = if ($p.HasExited) { "start-failed" } else { "health-timeout" }
}
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }

@"
# Long-context retrieval - $stamp

| KV | Context | Ratio | prompt_n | Result | VRAM peak | free | Vision | Reply |
|---|---|---:|---:|:--:|---:|---:|:--:|---|
| $KV | $Context | $Ratio | $promptN | $(if ($ok) { "PASS" } else { "FAIL" }) | $peak | $free | $(if ($null -eq $visOk) { "-" } elseif ($visOk) { "PASS ($($visMs)ms)" } else { "FAIL ($($visMs)ms)" }) | $($reply -replace "\|", "/") |

Vision reply (CPU proj: $([bool]$CPUProjector)): $($visReply -replace "\|", "/")

$note
"@ | Set-Content -LiteralPath $out -Encoding UTF8

Write-Host "KV=$KV ctx=$Context prompt_n=$promptN -> $(if ($ok) { 'PASS' } else { 'FAIL' }) $note" -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
Write-Host "Reporte: $out"
