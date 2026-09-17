[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Launcher,
    [string]$MutexName = 'Local\PetDispatcherRemote'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
    throw "Pet Dispatcher launcher is missing: $Launcher"
}
if ($Launcher -match '["\r\n]') { throw 'Invalid launcher path.' }

$env:PSModulePath = @(
    (Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
    (Join-Path $env:WINDIR 'system32\WindowsPowerShell\v1.0\Modules')
) -join ';'

function Test-MutexAvailable {
    $mutex = [Threading.Mutex]::new($false, $MutexName)
    $acquired = $false
    try {
        try { $acquired = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $acquired = $true }
        return $acquired
    } finally {        if ($acquired) { try { $mutex.ReleaseMutex() } catch {} }
        $mutex.Dispose()
    }
}

$targets = @(
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
        Where-Object {
            $_.ProcessId -ne $PID -and
            $_.CommandLine -and
            $_.CommandLine.IndexOf($Launcher, [StringComparison]::OrdinalIgnoreCase) -ge 0
        }
)
foreach ($target in $targets) {
    & taskkill.exe /PID $target.ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not stop old Pet Dispatcher launcher PID $($target.ProcessId)."
    }
}

$deadline = [DateTime]::UtcNow.AddSeconds(5)
while (-not (Test-MutexAvailable)) {
    if ([DateTime]::UtcNow -ge $deadline) {
        throw 'Old Pet Dispatcher launcher still owns the singleton mutex.'
    }
    Start-Sleep -Milliseconds 100
}
$powerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$quotedLauncher = '"' + $Launcher.Replace('"', '""') + '"'
$replacement = Start-Process -FilePath $powerShell -WindowStyle Hidden -PassThru -ArgumentList (
    "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $quotedLauncher"
)

Start-Sleep -Milliseconds 750
$replacement.Refresh()
if ($replacement.HasExited) {
    throw "Replacement Pet Dispatcher launcher exited immediately with code $($replacement.ExitCode)."
}

Write-Output $replacement.Id
