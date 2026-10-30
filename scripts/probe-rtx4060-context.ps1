<#
.SYNOPSIS
    Probe the maximum STABLE f16 context with vision + thinking on the RTX 4060.

.DESCRIPTION
    For each context size it starts the optimized llama-server (f16 KV, vision,
    reasoning budget) directly, waits for /health, sends one small reasoning
    completion, then idles ~8 s (the f16 idle-crash window) and checks the process
    is still alive. Stops the server and records PASS/FAIL with peak VRAM.

    The output is a Markdown table under reports/context-probe-<stamp>.md so the
    chosen preset can be justified with measurements, not guesses.

.NOTES
    Run alone; needs the GPU free. Uses bin paths from the optimized build.
#>

param(
    [int[]]$Contexts = @(24576, 28672, 32768, 36864, 39936, 43008),
    [string]$ContextList = "",
    [string]$KV = "f16",
    [int]$UBatch = 256,
    [int]$Port = 8090,
    [int]$Think = 4096,
    [switch]$Vision
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
if ($ContextList) {
    $Contexts = @($ContextList.Split(",") | ForEach-Object { [int]($_.Trim()) })
}

$BinCands = @(
    (Join-Path $RootDir ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe"),
    (Join-Path $env:USERPROFILE ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe")
)
$Bin = $BinCands | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Bin) { throw "Falta el binario optimizado." }

$Model = Join-Path $RootDir "models\Ornith-1.5-9B-Q4_K_M.gguf"
$Cat = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Item = $Cat.catalogo.ornith9b
$Proj = Join-Path $RootDir ("models\" + $Item.vision.archivo)
$Tpl = Join-Path $RootDir "logs\chat_template_probe.jinja"
if ($Item.chat_template) { $Item.chat_template | Set-Content -LiteralPath $Tpl -Encoding UTF8 -NoNewline }

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Out = Join-Path $RootDir "reports\context-probe-$Stamp.md"
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
"# Context probe ($KV, ub=$UBatch, vision=$([bool]$Vision), think=$Think) - $Stamp`n" | Set-Content $Out -Encoding UTF8
"| ctx | result | peak VRAM MiB | free MiB | notes |`n|---:|---|---:|---:|---|" | Add-Content $Out -Encoding UTF8

Get-Process llama-server* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

foreach ($ctx in $Contexts) {
    Write-Host "==> ctx $ctx" -ForegroundColor Cyan
    $peak = 0; $free = 0; $notes = ""; $ok = $false
    $args = @(
        "-m", $Model, "--gpu-layers", "99", "--flash-attn", "on",
        "-c", "$ctx", "-ctk", $KV, "-ctv", $KV,
        "-b", "512", "-ub", "$UBatch", "-t", "4",
        "--host", "127.0.0.1", "--port", "$Port", "--jinja", "--metrics", "-lv", "2",
        "--spec-type", "none", "--no-context-shift", "--ctx-checkpoints", "0",
        "--chat-template-file", $Tpl,
        "--reasoning-budget", "$Think", "--reasoning-format", "deepseek"
    )
    if ($Vision) { $args += @("--mmproj", $Proj, "--mmproj-offload", "--mmproj-device", "CUDA0", "--image-max-tokens", "512") }

    $logOut = Join-Path $RootDir "logs\probe-$ctx.out.log"
    $logErr = Join-Path $RootDir "logs\probe-$ctx.err.log"
    $p = Start-Process -FilePath $Bin -ArgumentList (($args | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ') -PassThru -NoNewWindow -RedirectStandardOutput $logOut -RedirectStandardError $logErr
    $deadline = (Get-Date).AddSeconds(120)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        if ($p.HasExited) { break }
        try { if ((Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $healthy = $true; break } } catch {}
        Start-Sleep -Milliseconds 800
    }

    if ($healthy) {
        # one reasoning completion with a REALISTIC long prompt (~1.2k tokens): the
        # compute buffer grows with prefill, so a tiny prompt hides OOM at high ctx.
        try {
            $filler = ("The asset ledger reconciles every cash movement daily. " * 120)
            $payload = @{ model = "Ornith-1.5-9B"; messages = @(@{ role = "user"; content = ($filler + "`n`nResponde solo: OK") }); max_tokens = 24; temperature = 0.2 } | ConvertTo-Json -Depth 6
            Invoke-WebRequest "http://127.0.0.1:$Port/v1/chat/completions" -Method POST -Headers @{"Content-Type"="application/json"} -Body $payload -UseBasicParsing -TimeoutSec 120 | Out-Null
        } catch { $notes += "completion-error; " }
        # idle crash window
        Start-Sleep -Seconds 8
        if (-not $p.HasExited) { $ok = $true } else { $notes += "died-after-idle; " }
        # peak VRAM
        try {
            $mem = & nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader,nounits
            $parts = ($mem -split ',') | ForEach-Object { [int]([string]$_).Trim() }
            $peak = $parts[0]; $free = $parts[1]
        } catch {}
    } else {
        if ($p.HasExited) { $notes += "start-failed(exit $($p.ExitCode)); " } else { $notes += "health-timeout; " }
    }

    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1

    $res = if ($ok) { "PASS" } else { "FAIL" }
    Write-Host "   $res $notes" -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
    "| $ctx | $res | $peak | $free | $notes |" | Add-Content $Out -Encoding UTF8
}

Write-Host "Reporte: $Out" -ForegroundColor Green
