[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Supervisor
)

# Stops the running supervisor and worker (and, on the first install after the wscript switch,
# the legacy PowerShell launcher), then starts a fresh supervisor. Prints the new supervisor PID.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Supervisor -PathType Leaf)) {
    throw "Pet Dispatcher supervisor is missing: $Supervisor"
}
if ($Supervisor -match '["\r\n]') { throw 'Invalid supervisor path.' }

$env:PSModulePath = @(
    (Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
    (Join-Path $env:WINDIR 'system32\WindowsPowerShell\v1.0\Modules')
) -join ';'

$root = Split-Path -Parent (Split-Path -Parent $Supervisor)
$pidPath = Join-Path $root 'state\worker.pid'
$lockPath = Join-Path $root 'state\supervisor.lock'

function Stop-Tree([int]$ProcessId) {
    & taskkill.exe /PID $ProcessId /T /F *> $null
    # 128 = already gone, which is fine.
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 128) {
        throw "Could not stop Pet Dispatcher process PID $ProcessId."
    }
}

# Supervisor first, so it cannot respawn the worker we are about to stop. The legacy launcher is matched by
# its full path under THIS install root, so a second install of Pet Dispatcher is left alone.
$legacyLauncher = Join-Path $root 'bin\pet-dispatcher-launch'
$targets = @(
    Get-CimInstance Win32_Process -Filter "Name='wscript.exe' OR Name='powershell.exe' OR Name='pwsh.exe'" |
        Where-Object {
            $_.ProcessId -ne $PID -and $_.CommandLine -and (
                $_.CommandLine.IndexOf($Supervisor, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $_.CommandLine.IndexOf($legacyLauncher, [StringComparison]::OrdinalIgnoreCase) -ge 0
            )
        }
)
foreach ($target in $targets) { Stop-Tree $target.ProcessId }

# Stop every worker of this install, found by identity ("<root>\app\releases\...\index.js remote"), not via the pid
# file: it can be missing or stale, and a worker left running would be adopted by the replacement supervisor with the
# OLD release's code. A failing WMI query aborts the restart rather than guessing.
$releases = Join-Path $root 'app\releases\'
$workers = @(
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($releases, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $_.CommandLine -match 'index\.js"?\s+remote\s*$'
    }
)
foreach ($worker in $workers) { Stop-Tree $worker.ProcessId }
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue

# The lock file is held open by a live supervisor, so deleting it only works once that is gone.
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while (Test-Path -LiteralPath $lockPath) {
    try { [IO.File]::Delete($lockPath) }
    catch {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Old Pet Dispatcher supervisor still holds its lock.' }
        Start-Sleep -Milliseconds 100
    }
}

$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$replacement = Start-Process -FilePath $wscript -PassThru -ArgumentList "//B //Nologo `"$Supervisor`""

Start-Sleep -Milliseconds 750
$replacement.Refresh()
if ($replacement.HasExited) {
    throw "Replacement Pet Dispatcher supervisor exited immediately with code $($replacement.ExitCode)."
}

Write-Output $replacement.Id
