# ==============================================================================
# Calibracion unica para hacerla con la GPU LIBRE (carga el modelo; ~10-15 min en total).
# Cada fase es opcional. Sin fases, o con -Plan, solo muestra lo que haria y no toca la GPU.
#
#   .\scripts\optimizar.ps1 -Plan -Todo     # ver los comandos sin ejecutar nada
#   .\scripts\optimizar.ps1 -Medir          # llama-bench: el -ub y -t mas rapidos + velocidad con contexto largo
#   .\scripts\optimizar.ps1 -Sesgo          # sesgo de media de la K para el KV q4_0 (receta de PrismML)
#   .\scripts\optimizar.ps1 -Calidad        # perplejidad: f16 / q8_0 / q4_0 con y sin sesgo
#   .\scripts\optimizar.ps1 -Todo
#
# Resultado: config\optimo.json (lo lee start-server.ps1) y logs\optimizar-*.txt
# ==============================================================================

param (
    [switch]$Medir,
    [switch]$Sesgo,
    [switch]$Calidad,
    [switch]$Todo,
    [switch]$Plan,      # solo muestra los comandos
    [switch]$Forzar     # salta la comprobacion de GPU libre
)

$RootDir = Split-Path -Parent $PSScriptRoot
$Bin = Join-Path $RootDir "bin"
$M = Get-Content (Join-Path $RootDir "chat\modelo.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Model = Join-Path $RootDir ("models\" + $M.modelo.archivo)
$Logs = Join-Path $RootDir "logs"
$OptPath = Join-Path $RootDir "config\optimo.json"
$BiasPath = Join-Path $RootDir ("models\" + [IO.Path]::GetFileNameWithoutExtension($M.modelo.archivo) + "-kv-bias.gguf")

function Quote([string]$s) { if ($s -match "\s") { return '"' + $s + '"' } else { return $s } }

function Get-KvPerToken([string]$type) {
    return $M.modelo.capasAtencionCompleta * $M.modelo.cabezasKV * $M.modelo.dimCabeza * 2 * [double]$M.kv.bytesPorElemento.$type
}
# Mismas cuentas que scripts\start-server.ps1 y chat\modelo.mjs (calibradas con el servidor real)
function Get-ComputeCtxMiB([int]$ctx) {
    $c = $M.vram.computo
    return [math]::Max($c.pisoMiB, $c.baseMiB + $c.porMilTokensMiB * $ctx / 1024)
}
function Get-VramMiB([int]$ctx, [string]$type, [int]$ub) {
    $u = $M.vram.ubatch
    $compute = (Get-ComputeCtxMiB $ctx) + ([math]::Max($u.referencia, $ub) - $u.referencia) * $u.extraPorTokenMiB
    $kvMiB = [math]::Ceiling($ctx * (Get-KvPerToken $type) / 1MB)
    return [int][math]::Ceiling($M.vram.pesosMiB + $M.vram.estadoRecurrenteMiB + $M.vram.fijoCudaMiB + $kvMiB + $compute)
}
function Get-PeakMiB([int]$ctx, [string]$type, [int]$ub) {
    return [int][math]::Ceiling((Get-VramMiB $ctx $type $ub) + (Get-ComputeCtxMiB $ctx))
}

# Lanza una herramienta de bin\ y devuelve @{ Code; Out; Text }. Usa Start-Process y no 2>&1:
# en Windows PowerShell 5.1 redirigir el stderr de un exe nativo lo convierte en errores.
function Invoke-Tool([string]$name, [string[]]$toolArgs, [string]$tag) {
    $exe = Join-Path $Bin ($name + ".exe")
    $argString = ($toolArgs | ForEach-Object { Quote $_ }) -join " "
    Write-Host ("    > " + (Quote $exe) + " " + $argString) -ForegroundColor DarkGray
    if ($Plan) { return $null }
    New-Item -ItemType Directory -Force $Logs | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $out = Join-Path $Logs ("optimizar-{0}-{1}.out.txt" -f $tag, $stamp)
    $err = Join-Path $Logs ("optimizar-{0}-{1}.err.txt" -f $tag, $stamp)
    $p = Start-Process -FilePath $exe -ArgumentList $argString -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -Wait -PassThru
    $so = Get-Content $out -Raw -ErrorAction SilentlyContinue
    $se = Get-Content $err -Raw -ErrorAction SilentlyContinue
    return @{ Code = $p.ExitCode; Out = $so; Text = ("" + $so + "`n" + $se) }
}

function Read-Opt {
    $h = @{}
    if (Test-Path $OptPath) {
        $o = Get-Content $OptPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = $p.Value }
    }
    return $h
}
function Save-Opt($h) {
    New-Item -ItemType Directory -Force (Split-Path $OptPath) | Out-Null
    ($h | ConvertTo-Json -Depth 4) | Set-Content -Path $OptPath -Encoding UTF8
}

# ---- analisis de resultados (se prueban sin GPU con datos de ejemplo) ----

function ConvertFrom-BenchJson([string]$text) {
    if (-not $text) { return @() }
    $i = $text.IndexOf("[")
    $j = $text.LastIndexOf("]")
    if ($i -lt 0 -or $j -le $i) { return @() }
    # En Windows PowerShell 5.1 ConvertFrom-Json entrega el array como UN solo objeto: se
    # reenumera para que tambien funcione al encadenarlo con | Where-Object (antes mezclaba filas).
    $parsed = ConvertFrom-Json -InputObject $text.Substring($i, $j - $i + 1)
    return @($parsed | ForEach-Object { $_ })
}

# Elige el -ub mas pequeno que rinda al menos el 99 % del mejor en prefill (menos VRAM a igual
# velocidad; una diferencia menor al 1 % es ruido) y los hilos mas pocos que den al menos el 98 %
# del mejor en generacion.
function Select-Bench($rows, [int]$maxUb) {
    $depth0 = { ($null -eq $_.n_depth) -or ($_.n_depth -eq 0) }
    $pp = @($rows | Where-Object $depth0 | Where-Object { $_.n_prompt -ge 2048 -and $_.n_gen -eq 0 -and $_.n_ubatch -le $maxUb })
    $tg = @($rows | Where-Object $depth0 | Where-Object { $_.n_gen -gt 0 -and $_.n_prompt -eq 0 })
    if ($pp.Count -eq 0 -or $tg.Count -eq 0) { return $null }
    $bestPp = ($pp | Measure-Object -Property avg_ts -Maximum).Maximum
    $ub = ($pp | Where-Object { $_.avg_ts -ge 0.99 * $bestPp } | Sort-Object n_ubatch | Select-Object -First 1)
    $bestTg = ($tg | Measure-Object -Property avg_ts -Maximum).Maximum
    $th = ($tg | Where-Object { $_.avg_ts -ge 0.98 * $bestTg } | Sort-Object n_threads | Select-Object -First 1)
    return @{ ubatch = [int]$ub.n_ubatch; threads = [int]$th.n_threads; ppTps = [math]::Round($bestPp, 1); tgTps = [math]::Round($bestTg, 1) }
}

function Get-Ppl([string]$text) {
    if (-not $text) { return $null }
    $all = [regex]::Matches($text, "PPL\s*=\s*([0-9]+\.[0-9]+)")
    if ($all.Count -eq 0) { return $null }
    return [double]::Parse($all[$all.Count - 1].Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
}

# ---- fases ----

function Invoke-Medir {
    Write-Host "[Medir] llama-bench: prefill y generacion segun -ub y -t (KV q4_0, como en uso real)" -ForegroundColor Green
    $maxUb = 4096
    # El -ub grande gasta VRAM de calculo: solo entra si con 64k y KV q4_0 sigue cabiendo
    foreach ($ub in 128, 256, 512, 1024, 2048) {
        if ((Get-PeakMiB 65536 "q4_0" $ub) + $M.vram.margenMiB -le ($M.vram.totalMiB - 200)) { $maxUb = $ub }
    }
    # En la primera medicion el prefill mejoraba al bajar -ub (647 / 630 / 616 t/s con 256 / 512 / 1024): se anade 128
    $benchArgs = @("-m", $Model, "-ngl", "99", "-fa", "on", "-ctk", "q4_0", "-ctv", "q4_0", "-p", "512,2048", "-n", "128", "-ub", "128,256,512,1024", "-t", "4,8", "-r", "2", "-o", "json")
    $r = Invoke-Tool "llama-bench" $benchArgs "bench"
    if ($Plan) {
        Write-Host "    (despues, con el mejor -ub y -t, mide la generacion a 0 / 8k / 32k de contexto con -d)" -ForegroundColor DarkGray
        return
    }
    $best = Select-Bench (ConvertFrom-BenchJson $r.Out) $maxUb
    if (-not $best) { Write-Host "    No pude leer resultados de llama-bench. Revisa logs\optimizar-bench-*.txt" -ForegroundColor Red; return }
    Write-Host ("    Mejor: -ub {0} -t {1} | prefill {2} t/s | generacion {3} t/s" -f $best.ubatch, $best.threads, $best.ppTps, $best.tgTps) -ForegroundColor Cyan
    $opt = Read-Opt
    $opt["ubatch"] = $best.ubatch
    $opt["threads"] = $best.threads
    $opt["ppTps"] = $best.ppTps
    $opt["tgTps"] = $best.tgTps
    $opt["medido"] = (Get-Date -Format "yyyy-MM-dd")
    Save-Opt $opt

    Write-Host "    Velocidad real con contexto lleno (la generacion baja al crecer el KV; tarda unos minutos)..." -ForegroundColor Gray
    $deepArgs = @("-m", $Model, "-ngl", "99", "-fa", "on", "-ctk", "q4_0", "-ctv", "q4_0", "-p", "512", "-n", "128", "-d", "0,8192,32768", "-ub", "$($best.ubatch)", "-t", "$($best.threads)", "-r", "2", "-o", "json")
    $d = Invoke-Tool "llama-bench" $deepArgs "bench-profundo"
    $deep = ConvertFrom-BenchJson $d.Out
    $profundo = @()
    foreach ($depth in ($deep | ForEach-Object { [int]$_.n_depth } | Sort-Object -Unique)) {
        $rp = $deep | Where-Object { [int]$_.n_depth -eq $depth -and $_.n_prompt -gt 0 -and $_.n_gen -eq 0 } | Select-Object -First 1
        $rg = $deep | Where-Object { [int]$_.n_depth -eq $depth -and $_.n_gen -gt 0 } | Select-Object -First 1
        if (-not $rp -or -not $rg) { continue }
        # Una desviacion mayor al 10 % delata una medicion contaminada (cambio de modo de energia, otra app, GPU fria)
        $shaky = if (($rp.stddev_ts -gt 0.1 * $rp.avg_ts) -or ($rg.stddev_ts -gt 0.1 * $rg.avg_ts)) { "  <- inestable, repetir" } else { "" }
        Write-Host ("      con {0,6} tokens de contexto: lectura {1,6:N1} t/s | generacion {2,5:N1} t/s{3}" -f $depth, $rp.avg_ts, $rg.avg_ts, $shaky) -ForegroundColor Cyan
        $profundo += @{ ctx = $depth; lectura = [math]::Round($rp.avg_ts, 1); generacion = [math]::Round($rg.avg_ts, 1) }
    }
    if ($profundo.Count -gt 0) {
        $opt = Read-Opt
        $opt["profundidad"] = $profundo
        Save-Opt $opt
    }
}

function Invoke-Sesgo {
    Write-Host "[Sesgo] llama-kv-mean-center: sesgo de media de la K para el KV q4_0" -ForegroundColor Green
    $corpus = Join-Path $Logs "calibracion-corpus.txt"
    $parts = @("scripts\calibracion.txt", "README.md", "ARQUITECTURA-Y-PLAN-MAESTRO.md", "chat\bonsai-chat.mjs", "chat\context.mjs", "chat\actions.mjs")
    if ($Plan) {
        Write-Host ("    corpus = " + ($parts -join " + ") + "  ->  logs\calibracion-corpus.txt") -ForegroundColor DarkGray
    } else {
        New-Item -ItemType Directory -Force $Logs | Out-Null
        $parts | ForEach-Object { Get-Content (Join-Path $RootDir $_) -Raw -Encoding UTF8 } | Set-Content -Path $corpus -Encoding UTF8
    }
    # Calibracion e inferencia tienen que coincidir en la rotacion de la K: se calibra sin rotar
    # y start-server.ps1 sirve con LLAMA_ATTN_ROT_DISABLE=1 cuando encuentra este archivo.
    $env:LLAMA_ATTN_ROT_DISABLE = "1"
    $r = Invoke-Tool "llama-kv-mean-center" @("-m", $Model, "-f", $corpus, "-o", $BiasPath, "-ngl", "99", "-c", "512") "sesgo"
    Remove-Item Env:LLAMA_ATTN_ROT_DISABLE -ErrorAction SilentlyContinue
    if ($Plan) { return }
    if ($r.Code -ne 0 -or -not (Test-Path $BiasPath)) {
        Write-Host "    Fallo la calibracion (codigo $($r.Code)). Revisa logs\optimizar-sesgo-*.txt" -ForegroundColor Red
        return
    }
    Write-Host ("    Sesgo guardado: {0} ({1:N0} bytes)" -f $BiasPath, (Get-Item $BiasPath).Length) -ForegroundColor Cyan
}

function Invoke-Calidad {
    Write-Host "[Calidad] llama-perplexity sobre texto que NO se uso para calibrar (menos es mejor)" -ForegroundColor Green
    $text = Join-Path $Logs "ppl-texto.txt"
    $parts = @("chat\ui-server.mjs", "chat\ui\index.html", "scripts\start-aider.ps1", "scripts\start-cursor-bridge.ps1")
    if ($Plan) {
        Write-Host ("    texto = " + ($parts -join " + ") + "  ->  logs\ppl-texto.txt (si ya existe se reutiliza)") -ForegroundColor DarkGray
    } elseif (Test-Path $text) {
        # Mismo texto en todas las corridas: asi las perplejidades de hoy y de dentro de un mes se pueden comparar
        Write-Host "    Reutilizo logs\ppl-texto.txt (borralo si quieres generar otro texto de prueba)" -ForegroundColor DarkGray
    } else {
        New-Item -ItemType Directory -Force $Logs | Out-Null
        $parts | ForEach-Object { Get-Content (Join-Path $RootDir $_) -Raw -Encoding UTF8 } | Set-Content -Path $text -Encoding UTF8
    }
    $configs = @(
        @{ n = "f16  / f16  (referencia)"; kv = "f16"; bias = $false },
        @{ n = "q8_0 / q8_0"; kv = "q8_0"; bias = $false },
        @{ n = "q4_0 / q4_0 (rotacion por defecto)"; kv = "q4_0"; bias = $false },
        @{ n = "q4_0 / q4_0 + sesgo, sin rotacion"; kv = "q4_0"; bias = $true }
    )
    $res = @()
    foreach ($c in $configs) {
        if ($c.bias -and -not $Plan -and -not (Test-Path $BiasPath)) {
            Write-Host ("    {0}: se salta (falta el sesgo; corre -Sesgo antes)" -f $c.n) -ForegroundColor Yellow
            continue
        }
        $pArgs = @("-m", $Model, "-f", $text, "-c", "2048", "--chunks", "16", "-ngl", "99", "-fa", "on", "-ctk", $c.kv, "-ctv", $c.kv)
        if ($c.bias) { $pArgs += @("--kv-mean-center", $BiasPath); $env:LLAMA_ATTN_ROT_DISABLE = "1" }
        $r = Invoke-Tool "llama-perplexity" $pArgs "ppl"
        Remove-Item Env:LLAMA_ATTN_ROT_DISABLE -ErrorAction SilentlyContinue
        if ($Plan) { continue }
        $ppl = Get-Ppl $r.Text
        if ($null -eq $ppl) { Write-Host ("    {0}: sin resultado (codigo {1})" -f $c.n, $r.Code) -ForegroundColor Red; continue }
        $res += @{ n = $c.n; kv = $c.kv; bias = $c.bias; ppl = $ppl }
    }
    if ($Plan -or $res.Count -eq 0) { return }
    $ref = ($res | Where-Object { $_.kv -eq "f16" } | Select-Object -First 1)
    Write-Host ""
    foreach ($x in $res) {
        $delta = if ($ref) { " ({0:+0.000;-0.000} frente a f16)" -f ($x.ppl - $ref.ppl) } else { "" }
        Write-Host ("    {0,-36} PPL {1:N4}{2}" -f $x.n, $x.ppl, $delta) -ForegroundColor Cyan
    }
    $rot = $res | Where-Object { $_.kv -eq "q4_0" -and -not $_.bias } | Select-Object -First 1
    $bia = $res | Where-Object { $_.kv -eq "q4_0" -and $_.bias } | Select-Object -First 1
    if ($rot -and $bia) {
        $useBias = ($bia.ppl -lt ($rot.ppl - 0.001))
        $opt = Read-Opt
        $opt["kvBias"] = $useBias
        Save-Opt $opt
        $msg = if ($useBias) { "el sesgo MEJORA el q4_0: start-server.ps1 lo usara" } else { "el sesgo NO mejora la rotacion por defecto: start-server.ps1 lo ignorara" }
        Write-Host ("    Conclusion: " + $msg) -ForegroundColor Yellow
    }
}

# ---- principal (no corre si se carga con dot-sourcing para probar las funciones) ----

if ($MyInvocation.InvocationName -ne ".") {
    if ($Todo) { $Medir = $true; $Sesgo = $true; $Calidad = $true }
    if (-not ($Medir -or $Sesgo -or $Calidad)) {
        Write-Host "Elige fases: -Medir, -Sesgo, -Calidad o -Todo. Con -Plan solo se muestran los comandos." -ForegroundColor Yellow
        Write-Host "Cabecera de este archivo: ayuda completa."
        exit 0
    }
    $ErrorActionPreference = "Stop"
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ("  Calibracion de Ternary-Bonsai-2-27B" + $(if ($Plan) { " (PLAN: no se ejecuta nada)" } else { "" })) -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    if (-not $Plan) {
        foreach ($tool in "llama-bench", "llama-kv-mean-center", "llama-perplexity") {
            if (-not (Test-Path (Join-Path $Bin ($tool + ".exe")))) { Write-Error "Falta bin\$tool.exe"; exit 1 }
        }
        if (-not (Test-Path $Model)) { Write-Error "No se encontro el modelo: $Model"; exit 1 }
        if (-not $Forzar) {
            if (Get-Process -Name "llama-server" -ErrorAction SilentlyContinue) {
                Write-Host "Hay un llama-server abierto y ocupa la GPU. Cierralo antes de calibrar (o usa -Forzar)." -ForegroundColor Red
                exit 2
            }
            if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
                $o = & nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>$null
                if ($LASTEXITCODE -eq 0 -and $o) {
                    $free = [int]@($o)[0].Trim()
                    $need = $M.vram.pesosMiB + 1200
                    if ($free -lt $need) {
                        Write-Host ("La GPU esta ocupada: {0} MiB libres y hacen falta ~{1}. Cierra lo que la use o repite con -Forzar." -f $free, $need) -ForegroundColor Red
                        exit 2
                    }
                }
            }
        }
    }

    if ($Medir) { Invoke-Medir }
    if ($Sesgo) { Invoke-Sesgo }
    if ($Calidad) { Invoke-Calidad }
    Write-Host ""
    if ($Plan) { Write-Host "Plan mostrado. Quita -Plan para ejecutarlo con la GPU libre." -ForegroundColor Yellow }
    else { Write-Host "Listo. start-server.ps1 usara config\optimo.json y el sesgo (si ayuda) en el siguiente arranque." -ForegroundColor Green }
}
