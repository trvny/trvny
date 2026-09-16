[CmdletBinding()]
param(
    [switch]$Once,
    [string]$Root
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$manifestPath = Join-Path $Root 'app\current.json'
$configPath = Join-Path $Root 'config\dispatcher.json'
$secretRoot = Join-Path $Root 'secrets'
$logRoot = Join-Path $Root 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Read-DpapiSecret([string]$Name) {
    $path = Join-Path $secretRoot "$Name.dpapi"
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing Pet Dispatcher secret: $Name" }
    $secure = Get-Content -LiteralPath $path -Raw | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$mutex = [Threading.Mutex]::new($false, 'Local\PetDispatcherRemote')
$ownsMutex = $false
try {
    $ownsMutex = $mutex.WaitOne(0)
    if (-not $ownsMutex) { return }
    while ($true) {
        if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Missing Pet Dispatcher manifest: $manifestPath" }
        if (-not (Test-Path -LiteralPath $configPath)) { throw "Missing Pet Dispatcher config: $configPath" }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $nodePath = [string]$manifest.nodePath
        $releaseRoot = [string]$manifest.releaseRoot
        $entry = Join-Path $releaseRoot 'dist\src\index.js'
        if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw "Configured Node executable is missing: $nodePath" }
        if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Pet Dispatcher release entry is missing: $entry" }

        $queueToken = Read-DpapiSecret 'PET_DISPATCHER_QUEUE_TOKEN'
        $signingSecret = Read-DpapiSecret 'TASK_SIGNING_SECRET'
        $providerEnvNames = @(& $nodePath $entry provider-env-names | ConvertFrom-Json)
        $importedProviderEnv = [Collections.Generic.List[string]]::new()
        $providerEnvOriginal = @{}
        $providerEnvOriginallyPresent = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($name in $providerEnvNames) {
            $name = [string]$name
            $processEntry = Get-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
            if ($null -ne $processEntry) {
                $providerEnvOriginal[$name] = [string]$processEntry.Value
                [void]$providerEnvOriginallyPresent.Add($name)
            }
            $value = [Environment]::GetEnvironmentVariable($name, 'User')
            if ($value) {
                Set-Item -LiteralPath "Env:$name" -Value $value
                $importedProviderEnv.Add($name)
            }
        }
        $env:PET_DISPATCHER_CONFIG = $configPath
        $env:PET_DISPATCHER_QUEUE_TOKEN = $queueToken
        $env:PET_DISPATCHER_SIGNING_SECRET = $signingSecret
        $logPath = Join-Path $logRoot ("remote-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
        try {
            & $nodePath $entry remote *>> $logPath
            $exitCode = $LASTEXITCODE
        } finally {
            foreach ($name in $importedProviderEnv) {
                if ($providerEnvOriginallyPresent.Contains($name)) {
                    Set-Item -LiteralPath "Env:$name" -Value $providerEnvOriginal[$name]
                } else {
                    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
                }
            }
            Remove-Item Env:PET_DISPATCHER_QUEUE_TOKEN -ErrorAction SilentlyContinue
            Remove-Item Env:PET_DISPATCHER_SIGNING_SECRET -ErrorAction SilentlyContinue
            Remove-Item Env:PET_DISPATCHER_CONFIG -ErrorAction SilentlyContinue
            $queueToken = $null
            $signingSecret = $null
        }
        if ($Once) { exit $exitCode }
        Start-Sleep -Seconds 5
    }
} finally {
    if ($ownsMutex) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
}
