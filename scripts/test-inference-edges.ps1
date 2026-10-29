param([string]$RuntimeDirectory = '')
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Tools = Get-Content -LiteralPath (Join-Path $ProjectRoot 'config\inference-toolchain.local.json') -Raw | ConvertFrom-Json
$BuildInfo = Get-Content -LiteralPath (Join-Path $ProjectRoot 'reports\coder-phase2\build-Auto.json') -Raw | ConvertFrom-Json
$EdgeBuild = Join-Path $Tools.installRoot 'edge-tests'
New-Item -ItemType Directory -Path $EdgeBuild -Force | Out-Null
$DevEnvironment = & $env:ComSpec /d /s /c "`"$($Tools.vcvars)`" >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'MSVC environment setup failed' }
foreach ($Line in $DevEnvironment) {
    if ($Line -match '^(Path|INCLUDE|LIB|LIBPATH)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') }
}
$TestExe = Join-Path $EdgeBuild 'test-inference-edges.exe'
$Object = Join-Path $EdgeBuild 'test-inference-edges.obj'
$Libraries = @('ggml-base.lib','ggml.lib') | ForEach-Object { Join-Path $BuildInfo.build "ggml\src\$_" }
& cl.exe /nologo /EHsc /std:c++17 /MD /O2 /fp:precise ("/I" + (Join-Path $BuildInfo.source 'ggml\include')) `
    (Join-Path $PSScriptRoot 'test-inference-edges.cpp') ("/Fe:" + $TestExe) ("/Fo:" + $Object) @Libraries
if ($LASTEXITCODE -ne 0) { throw 'Edge-test compilation failed' }
if (-not $RuntimeDirectory) { $RuntimeDirectory = Split-Path $BuildInfo.binary }
$RuntimeDirectory = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$env:Path = $RuntimeDirectory + ';' + $env:Path
Write-Host "Testing backend DLLs from $RuntimeDirectory"
& $TestExe $RuntimeDirectory
if ($LASTEXITCODE -ne 0) { throw "CPU/CUDA edge correctness failed: exit $LASTEXITCODE" }
