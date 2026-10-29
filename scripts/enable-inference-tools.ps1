param([switch]$Persist)
$ErrorActionPreference='Stop'
$ProjectRoot=Split-Path -Parent $PSScriptRoot
$Manifest=Join-Path $ProjectRoot 'config\inference-toolchain.local.json'
$Tools=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$ToolPaths=@((Split-Path $Tools.nvcc),(Split-Path $Tools.nsys),(Split-Path $Tools.ncu),(Split-Path $Tools.cmake),(Split-Path $Tools.ninja))
foreach($ToolPath in $ToolPaths) { if(-not (Test-Path -LiteralPath $ToolPath -PathType Container)) {throw "Missing tool directory: $ToolPath"} }
$env:Path=(@($ToolPaths)+@($env:Path -split ';') | Where-Object {$_} | Select-Object -Unique) -join ';'
$env:CUDA_PATH=$Tools.cudaRoot
if($Persist) {
    if(-not $Tools.PSObject.Properties['previousUserEnvironment']) {
        $Tools | Add-Member -NotePropertyName previousUserEnvironment -NotePropertyValue ([ordered]@{Path=[Environment]::GetEnvironmentVariable('Path','User');CUDA_PATH=[Environment]::GetEnvironmentVariable('CUDA_PATH','User')})
        [IO.File]::WriteAllText($Manifest,($Tools | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
    }
    $UserPath=[Environment]::GetEnvironmentVariable('Path','User')
    $UpdatedPath=(@($ToolPaths)+@($UserPath -split ';') | Where-Object {$_} | Select-Object -Unique) -join ';'
    [Environment]::SetEnvironmentVariable('Path',$UpdatedPath,'User')
    [Environment]::SetEnvironmentVariable('CUDA_PATH',$Tools.cudaRoot,'User')
    Write-Host 'CUDA, Nsight, CMake and Ninja added to the user PATH for new terminals.'
}
& $Tools.nvcc --version
& $Tools.nsys --version
& $Tools.ncu --version
