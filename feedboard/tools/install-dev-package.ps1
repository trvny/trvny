[CmdletBinding()]
param(
    [string]$PackagePath
)

$ErrorActionPreference = 'Stop'

if (-not $PackagePath) {
    $candidate = Get-ChildItem -Path $PSScriptRoot -Recurse -File -Filter *.msix |
        Select-Object -First 1

    if (-not $candidate) {
        throw 'No .msix package found next to this script.'
    }

    $PackagePath = $candidate.FullName
}

$resolved = (Resolve-Path $PackagePath).Path

try {
    Add-AppxPackage -Path $resolved -AllowUnsigned
}
catch {
    Write-Host ''
    Write-Host 'Install failed. Feedboard development packages require Windows 11 Developer Mode.'
    Write-Host 'Enable Developer Mode in Settings > System > Advanced > For developers, then retry.'
    throw
}

Write-Host "Installed Feedboard from $resolved"
Write-Host 'Open the Windows Widgets Board and add Feedboard from the widget picker.'
