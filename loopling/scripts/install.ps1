$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$target = Join-Path $codexHome 'pets\loopling'

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $root 'pet\pet.json') $target -Force
Copy-Item (Join-Path $root 'pet\spritesheet.webp') $target -Force

Write-Host "Loopling installed to $target"
Write-Host 'Restart ChatGPT, then open Settings -> Pets and select Loopling.'
