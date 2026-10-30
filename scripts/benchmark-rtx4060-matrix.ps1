<#
.SYNOPSIS
    RTX 4060 performance matrix for Ornith 1.5 9B (Q4_K_M).

.DESCRIPTION
    Runs llama-bench over the knobs that actually move the needle on an 8 GB Ada
    laptop GPU, all fully offloaded (-ngl 99), single GPU (-sm none), f16 KV unless
    stated, FlashAttention on. Writes one Markdown table per config plus a combined
    report under reports/perf-<date>/.

    Knobs: batch (-b), ubatch (-ub), threads (-t), load mode (-lm: mmap vs none vs
    mlock) and KV precision (f16 vs q8_0) for comparison.

.NOTES
    Run alone: the GPU must be free. It does not start the server.
#>

param(
    [string]$Model = "",
    [int]$Prompt = 2048,
    [int]$Gen = 128,
    [int]$Reps = 2
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

$BinCands = @(
    (Join-Path $RootDir ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-bench.exe"),
    (Join-Path $env:USERPROFILE ".local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-bench.exe")
)
$Bench = $BinCands | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Bench) { throw "No se encontro llama-bench optimizado. Ejecuta build-rtx4060-optimized.ps1" }

if (-not $Model) { $Model = Join-Path $RootDir "models\Ornith-1.5-9B-Q4_K_M.gguf" }
if (-not (Test-Path -LiteralPath $Model)) { throw "Falta el modelo: $Model" }

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OutDir = Join-Path $RootDir "reports\perf-$Stamp"
New-Item -ItemType Directory -Force $OutDir | Out-Null

$Common = @("-m", $Model, "-ngl", "99", "-sm", "none", "-fa", "on", "-p", "$Prompt", "-n", "$Gen", "-r", "$Reps", "-o", "md")

# name, extra args
$Configs = @(
    @{ n = "01-baseline-b512-ub256-t4-mmap-f16";   a = @("-b","512","-ub","256","-t","4","-ctk","f16","-ctv","f16","-lm","mmap") },
    @{ n = "02-ub128-b512-t4-f16";                 a = @("-b","512","-ub","128","-t","4","-ctk","f16","-ctv","f16","-lm","mmap") },
    @{ n = "03-ub512-b512-t4-f16";                 a = @("-b","512","-ub","512","-t","4","-ctk","f16","-ctv","f16","-lm","mmap") },
    @{ n = "04-b1024-ub256-t4-f16";                a = @("-b","1024","-ub","256","-t","4","-ctk","f16","-ctv","f16","-lm","mmap") },
    @{ n = "05-b2048-ub256-t4-f16";                a = @("-b","2048","-ub","256","-t","4","-ctk","f16","-ctv","f16","-lm","mmap") },
    @{ n = "06-t8-b512-ub256-f16";                 a = @("-b","512","-ub","256","-t","8","-ctk","f16","-ctv","f16","-lm","mmap") },
    @{ n = "07-nommap-b512-ub256-t4-f16";          a = @("-b","512","-ub","256","-t","4","-ctk","f16","-ctv","f16","-lm","none") },
    @{ n = "08-mlock-b512-ub256-t4-f16";           a = @("-b","512","-ub","256","-t","4","-ctk","f16","-ctv","f16","-lm","mlock") },
    @{ n = "09-ub512-t8-nommap-f16";               a = @("-b","512","-ub","512","-t","8","-ctk","f16","-ctv","f16","-lm","none") },
    @{ n = "10-q8kv-b512-ub256-t4";                a = @("-b","512","-ub","256","-t","4","-ctk","q8_0","-ctv","q8_0","-lm","mmap") }
)

$Combined = Join-Path $OutDir "matriz.md"
"# RTX 4060 perf matrix - $Stamp`n" | Set-Content -LiteralPath $Combined -Encoding UTF8
"Model: $Model`nPrompt=$Prompt Gen=$Gen Reps=$Reps`n" | Add-Content -LiteralPath $Combined -Encoding UTF8

foreach ($c in $Configs) {
    $name = $c.n
    $args = $Common + @($c.a)
    Write-Host "==> $name" -ForegroundColor Cyan
    $dest = Join-Path $OutDir "$name.md"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        # llama-bench escribe el progreso (CUDA init, etc.) por stderr: se captura todo
        # sin tratarlo como error de PowerShell.
        & $Bench @args 2>&1 | Set-Content -LiteralPath $dest -Encoding UTF8
        "`n## $name`n" | Add-Content -LiteralPath $Combined -Encoding UTF8
        Get-Content -LiteralPath $dest | Add-Content -LiteralPath $Combined -Encoding UTF8
    } catch {
        Write-Host "  fallo: $($_.Exception.Message)" -ForegroundColor Yellow
        "`n## $name`n(fallo): $($_.Exception.Message)" | Add-Content -LiteralPath $Combined -Encoding UTF8
    } finally {
        $ErrorActionPreference = $prev
    }
}

Write-Host "Listo: $Combined" -ForegroundColor Green
