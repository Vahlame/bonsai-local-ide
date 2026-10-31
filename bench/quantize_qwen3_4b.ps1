<#
.SYNOPSIS
    Build a controlled quantization matrix from the Qwen3-4B Q8_0 reference.

.DESCRIPTION
    Downloads are not performed here; the Q8_0 file must already exist. Each
    target is quantized from the same Q8_0 source with the same llama-quantize
    binary and thread count, so the only changing variable is the target type.
    Outputs are written next to the existing models and a JSON receipt records
    the exact command, source hash, output size and timestamps.

.NOTES
    This is an experiment, not a production model converter. Quantizing from
    Q8_0 (instead of F16) can lose a little quality; the quality report states
    that explicitly.
#>

param(
    [string]$Source = "models\Qwen3-4B-Instruct-2507-Q8_0.gguf",
    [string]$Quantize = "",
    [int]$Threads = 8,
    [string[]]$Types = @("Q6_K", "Q5_K_M", "Q4_K_M", "Q3_K_M"),
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$SourcePath = if ([IO.Path]::IsPathRooted($Source)) { $Source } else { Join-Path $Root $Source }
if (-not (Test-Path -LiteralPath $SourcePath)) { throw "Missing Q8 source: $SourcePath" }
$ToolsPath = Join-Path $Root 'config\inference-toolchain.local.json'
$Tools = Get-Content -LiteralPath $ToolsPath -Raw | ConvertFrom-Json
if (-not $Quantize) {
    $Quantize = Join-Path $Tools.installRoot 'build-RTX4060-Opt-sm89\bin\llama-quantize.exe'
}
if (-not (Test-Path -LiteralPath $Quantize)) { throw "Missing llama-quantize: $Quantize" }

$SourceHash = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash.ToLower()
$OutDir = Join-Path $Root 'bench\results'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$ReceiptPath = Join-Path $OutDir 'quantize-qwen3-4b.json'
$Receipt = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    source = $SourcePath
    sourceSha256 = $SourceHash
    quantize = $Quantize
    quantizeSha256 = (Get-FileHash -LiteralPath $Quantize -Algorithm SHA256).Hash.ToLower()
    threads = $Threads
    runs = @()
}

foreach ($Type in $Types) {
    $OutName = "Qwen3-4B-Instruct-2507-$Type.gguf"
    $OutPath = Join-Path $Root ("models\" + $OutName)
    if ((Test-Path -LiteralPath $OutPath) -and -not $Force) {
        Write-Host "exists, skipping: $OutName" -ForegroundColor Yellow
        $Receipt.runs += [ordered]@{
            type = $Type; output = $OutPath; skipped = $true
            bytes = (Get-Item -LiteralPath $OutPath).Length
            sha256 = (Get-FileHash -LiteralPath $OutPath -Algorithm SHA256).Hash.ToLower()
        }
        continue
    }
    $Log = Join-Path $OutDir ("quantize-" + $Type + ".log")
    $Cmd = "`"$Quantize`" --allow-requantize `"$SourcePath`" `"$OutPath`" $Type $Threads"
    Write-Host "quantize $Type -> $OutName" -ForegroundColor Cyan
    $t0 = Get-Date
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $Output = & cmd.exe /d /c $Cmd 2>&1
        $exit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    $Output | Set-Content -LiteralPath $Log -Encoding UTF8
    if ($exit -ne 0 -or -not (Test-Path -LiteralPath $OutPath)) {
        Get-Content -LiteralPath $Log -Tail 40
        throw "llama-quantize failed for $Type (exit $exit)"
    }
    $item = Get-Item -LiteralPath $OutPath
    $Receipt.runs += [ordered]@{
        type = $Type
        output = $OutPath
        bytes = $item.Length
        gib = [math]::Round($item.Length / 1GB, 3)
        sha256 = (Get-FileHash -LiteralPath $OutPath -Algorithm SHA256).Hash.ToLower()
        seconds = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
        log = $Log
    }
    $Receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
    Write-Host ("  OK {0:N2} GiB in {1:N0}s" -f ($item.Length / 1GB), ((Get-Date) - $t0).TotalSeconds) -ForegroundColor Green
}

$Receipt.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
$Receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
Write-Host "Receipt: $ReceiptPath" -ForegroundColor Green
