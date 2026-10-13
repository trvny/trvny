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

# Supervisor first, so it cannot respawn the worker we are about to stop.
$targets = @(
    Get-CimInstance Win32_Process -Filter "Name='wscript.exe' OR Name='powershell.exe' OR Name='pwsh.exe'" |
        Where-Object {
            $_.ProcessId -ne $PID -and $_.CommandLine -and (
                $_.CommandLine.IndexOf($Supervisor, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $_.CommandLine.IndexOf('pet-dispatcher-launch.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0
            )
        }
)
foreach ($target in $targets) { Stop-Tree $target.ProcessId }

if (Test-Path -LiteralPath $pidPath) {
    $workerPid = 0
    if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$workerPid) -and $workerPid -gt 0) {
        # The pid file survives reboots: only kill a node that runs a release under this install root.
        $worker = Get-CimInstance Win32_Process -Filter "ProcessId=$workerPid" -ErrorAction SilentlyContinue
        $releases = Join-Path $root 'app\releases\'
        if ($worker -and $worker.Name -eq 'node.exe' -and $worker.CommandLine -and
            $worker.CommandLine.IndexOf($releases, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            Stop-Tree $workerPid
        }
    }
}

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
