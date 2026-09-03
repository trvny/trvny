[CmdletBinding()]
param(
    [string]$PackagePath
)

$ErrorActionPreference = 'Stop'
$expectedIdentity = 'trvny.Feedboard'

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-MsixIdentityName {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entry = $archive.GetEntry('AppxManifest.xml')
        if (-not $entry) {
            return $null
        }

        $stream = $entry.Open()
        try {
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
            try {
                [xml]$manifest = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
            }
        }
        finally {
            $stream.Dispose()
        }

        return [string]$manifest.Package.Identity.Name
    }
    finally {
        $archive.Dispose()
    }
}

if ($PackagePath) {
    $resolvedPath = (Resolve-Path -LiteralPath $PackagePath).Path
    $mainPackage = Get-Item -LiteralPath $resolvedPath
    if ((Get-MsixIdentityName -Path $mainPackage.FullName) -ne $expectedIdentity) {
        throw "Package '$($mainPackage.FullName)' is not the Feedboard MSIX."
    }
}
else {
    $mainPackages = @(
        Get-ChildItem -Path $PSScriptRoot -Recurse -File -Filter *.msix |
            Where-Object {
                $_.FullName -notmatch '[\\/]Dependencies[\\/]' -and
                (Get-MsixIdentityName -Path $_.FullName) -eq $expectedIdentity
            }
    )

    if ($mainPackages.Count -ne 1) {
        throw "Expected exactly one Feedboard MSIX next to this script, found $($mainPackages.Count)."
    }

    $mainPackage = $mainPackages[0]
}

$dependencyRoot = Join-Path $mainPackage.Directory.FullName 'Dependencies'
if (-not (Test-Path $dependencyRoot)) {
    throw "Dependency folder not found: $dependencyRoot"
}

$dependencyPackages = @()
foreach ($arch in @('x86', 'x64')) {
    $archDir = Join-Path $dependencyRoot $arch
    $packages = @(
        Get-ChildItem -Path $archDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in '.appx', '.msix' }
    )

    if ($packages.Count -eq 0) {
        throw "Required $arch dependency packages are missing from $archDir"
    }

    $dependencyPackages += $packages
}

try {
    Add-AppxPackage `
        -Path $mainPackage.FullName `
        -DependencyPath $dependencyPackages.FullName `
        -AllowUnsigned `
        -ForceUpdateFromAnyVersion `
        -ForceApplicationShutdown
}
catch {
    Write-Host ''
    Write-Host 'Install failed. Feedboard development packages require Windows 11 Developer Mode.'
    Write-Host 'Enable Developer Mode in Settings > System > Advanced > For developers, then retry.'
    throw
}

Write-Host "Installed Feedboard from $($mainPackage.FullName)"
Write-Host 'Open the Windows Widgets Board and add Feedboard from the widget picker.'
