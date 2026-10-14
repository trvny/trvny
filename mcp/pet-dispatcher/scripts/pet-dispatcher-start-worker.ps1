[CmdletBinding()]
param(
    [string]$Root
)

# One-shot: decrypt the DPAPI secrets, start the node worker detached, record its PID, exit.
# Called by pet-dispatcher-supervise.js (wscript) whenever no live worker exists. Runs under
# powershell.exe (5.1) because DPAPI ConvertTo-SecureString is the only reason PowerShell is here.
# Exit 0 = worker started; 1 = failed (reason appended to logs\supervisor-DATE.log).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Reset PSModulePath to the Windows PowerShell 5.1 defaults before anything else runs. A parent
# further up the logon chain can carry PowerShell 7's Modules folder; 5.1 then autoloads the PS7
# copy of a built-in module and the type-extension XML collides ("member AuditToString is already
# present"), killing the launch with zero log output. Reproduced 17.09.2026.
$env:PSModulePath = @(
    (Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
    (Join-Path $env:WINDIR 'system32\WindowsPowerShell\v1.0\Modules')
) -join ';'

if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$manifestPath = Join-Path $Root 'app\current.json'
$configPath = Join-Path $Root 'config\dispatcher.json'
$secretRoot = Join-Path $Root 'secrets'
$logRoot = Join-Path $Root 'logs'
$stateRoot = Join-Path $Root 'state'
$pidPath = Join-Path $stateRoot 'worker.pid'
$providerCredentialPath = Join-Path $PSScriptRoot 'provider-credential-env-names.json'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

function Read-DpapiSecret([string]$Name) {
    $path = Join-Path $secretRoot "$Name.dpapi"
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing Pet Dispatcher secret: $Name" }
    $secure = Get-Content -LiteralPath $path -Raw | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

try {
    # A worker that is alive but unrecorded (pid file lost, or the supervisor could not verify it) must not be
    # doubled: adopt it by re-recording its pid and start nothing.
    $releaseMarker = Join-Path $Root 'app\releases\'
    # A failing scan must not read as "no worker": throwing here makes the supervisor back off instead of launching
    # extra node processes while WMI is down.
    $alive = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($releaseMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $_.CommandLine -match 'index\.js"?\s+remote\s*$'
    })
    if ($alive.Count -gt 0) {
        Set-Content -LiteralPath $pidPath -Value $alive[0].ProcessId -Encoding ascii -NoNewline
        Add-Content -LiteralPath (Join-Path $logRoot ("supervisor-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))) -Value ('{0} start-worker: adopted running worker pid {1}' -f (Get-Date -Format 'HH:mm:ss'), $alive[0].ProcessId)
        exit 0
    }
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Missing Pet Dispatcher manifest: $manifestPath" }
    if (-not (Test-Path -LiteralPath $configPath)) { throw "Missing Pet Dispatcher config: $configPath" }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $nodePath = [string]$manifest.nodePath
    $releaseRoot = [string]$manifest.releaseRoot
    $entry = Join-Path $releaseRoot 'dist\src\index.js'
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw "Configured Node executable is missing: $nodePath" }
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Pet Dispatcher release entry is missing: $entry" }

    # The logon process can already carry User-scope provider credentials.
    # Read the installer-published scrub list without launching any child first.
    if (-not (Test-Path -LiteralPath $providerCredentialPath -PathType Leaf)) {
        throw "Missing provider credential scrub list: $providerCredentialPath"
    }
    $providerCredentialEnvNames = @(Get-Content -LiteralPath $providerCredentialPath -Raw | ConvertFrom-Json)
    if ($providerCredentialEnvNames.Count -eq 0) { throw 'Provider credential scrub list is empty.' }
    foreach ($name in $providerCredentialEnvNames) {
        Remove-Item -LiteralPath "Env:$([string]$name)" -ErrorAction SilentlyContinue
    }

    $env:PET_DISPATCHER_CONFIG = $configPath
    $env:PET_DISPATCHER_QUEUE_TOKEN = Read-DpapiSecret 'PET_DISPATCHER_QUEUE_TOKEN'
    $env:PET_DISPATCHER_SIGNING_SECRET = Read-DpapiSecret 'TASK_SIGNING_SECRET'

    # Start-Process truncates its redirect targets, so every start gets its own pair of files.
    # Nothing else prunes them: drop empty stderr logs of finished workers, keep the newest 40 files.
    Get-ChildItem -LiteralPath $logRoot -Filter 'remote-*.err.log' -ErrorAction SilentlyContinue |
        Where-Object { $_.Length -eq 0 } | Remove-Item -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $logRoot -Filter 'remote-*.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 40 | Remove-Item -ErrorAction SilentlyContinue
    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
    $outPath = Join-Path $logRoot "remote-$stamp.log"
    $errPath = Join-Path $logRoot "remote-$stamp.err.log"
    $worker = Start-Process -FilePath $nodePath -ArgumentList @("`"$entry`"", 'remote') `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $outPath -RedirectStandardError $errPath
    try {
        Set-Content -LiteralPath $pidPath -Value $worker.Id -Encoding ascii -NoNewline
    } catch {
        # An unrecorded worker would be invisible to the supervisor, which would then start another.
        & taskkill.exe /PID $worker.Id /T /F *> $null
        throw "Could not record worker pid $($worker.Id), worker stopped: $($_.Exception.Message)"
    }

    Start-Sleep -Milliseconds 750
    $worker.Refresh()
    if ($worker.HasExited) { throw "Worker exited immediately with code $($worker.ExitCode); see $errPath" }
    exit 0
} catch {
    $line = '{0} start-worker: {1}' -f (Get-Date -Format 'HH:mm:ss'), $_.Exception.Message
    Add-Content -LiteralPath (Join-Path $logRoot ("supervisor-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))) -Value $line
    exit 1
} finally {
    Remove-Item Env:PET_DISPATCHER_QUEUE_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:PET_DISPATCHER_SIGNING_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:PET_DISPATCHER_CONFIG -ErrorAction SilentlyContinue
}
