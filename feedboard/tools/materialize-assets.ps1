$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'assets\feedboard.png.b64'
$outDir = Join-Path $root 'assets\generated'
$outFile = Join-Path $outDir 'Feedboard.png'

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$base64 = (Get-Content -Raw $source) -replace '\s', ''
[IO.File]::WriteAllBytes($outFile, [Convert]::FromBase64String($base64))
Write-Host "Wrote $outFile"
