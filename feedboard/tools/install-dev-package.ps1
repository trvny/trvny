[CmdletBinding()]
param(
    [string]$PackagePath
)

$ErrorActionPreference = 'Stop'
$expectedIdentity = 'trvny.Feedboard'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    Write-Host 'Feedboard development MSIX contains executable code and needs administrator privileges.'
    Write-Host 'Requesting elevation...'

    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($PackagePath) {
        $arguments += " -PackagePath `"$PackagePath`""
    }

    $elevated = Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $elevated.ExitCode
}

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
    Write-Host 'Install failed. Make sure Windows 11 Developer Mode is enabled for widget sideloading.'
    Write-Host 'This development package is intentionally unsigned and uses the Windows unsigned-package identity namespace.'
    throw
}

Write-Host "Installed Feedboard from $($mainPackage.FullName)"
Write-Host 'Open the Windows Widgets Board and add Feedboard from the widget picker.'
