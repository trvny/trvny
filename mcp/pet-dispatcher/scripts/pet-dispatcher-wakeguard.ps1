[CmdletBinding()]
param(
    [ValidateSet('status', 'on', 'off', 'guard')]
    [string]$Action = 'status',
    [ValidateRange(1, 720)]
    [int]$Minutes = 120,
    # Local CLI only (profile `wakeguard forever`); the remote tool never passes it.
    [switch]$Forever,
    [string]$Root
)

# Keeps the Legion awake (no idle hibernation) without touching the power plan.
# `guard` = the long-lived process holding SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
# Windows drops the request when the process dies, so killing a guard is a valid release.
# `on` / `off` / `status` = short control calls, JSON on stdout, used by the worker (system.wakeguard)
# and the profile `wakeguard` function. Display may still sleep; lid close / manual sleep still win.
#
# Rules from incidents (memory: wakeguard-and-hibernation):
#  - `on` while a guard runs: start the NEW guard first, wait for its state file, only then stop
#    the old one. Any gap = instant hibernation once the idle timer has long expired.
#  - stop only processes whose command line is this script with `-Action guard` (PIDs get reused).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Same PS 7 module collision guard as pet-dispatcher-start-worker.ps1 (CimCmdlets autoloads below).
$env:PSModulePath = @(
    (Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
    (Join-Path $env:WINDIR 'system32\WindowsPowerShell\v1.0\Modules')
) -join ';'

if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$stateRoot = Join-Path $Root 'state'
$scriptPath = $PSCommandPath
$heartbeatSeconds = 60

function Get-StatePath([int]$ProcessId) { Join-Path $stateRoot "wakeguard-$ProcessId.json" }

function Read-GuardState([int]$ProcessId) {
    $path = Get-StatePath $ProcessId
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $null }
}

# Live guard processes: powershell.exe running THIS installed script file (full path, so another installation or an
# unrelated process mentioning the file name is never matched) with -Action guard.
function Test-GuardCommandLine($CommandLine) {
    $CommandLine -and $CommandLine.IndexOf($scriptPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $CommandLine -match '-Action\s+guard'
}

function Get-Guards {
    @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { Test-GuardCommandLine $_.CommandLine })
}

function Stop-Guard([int]$ProcessId) {
    # Re-check identity right before the kill.
    $row = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
    if ($row -and (Test-GuardCommandLine $row.CommandLine)) {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath (Get-StatePath $ProcessId) -Force -ErrorAction SilentlyContinue
}

function Get-Status {
    $guards = Get-Guards
    $live = @($guards | ForEach-Object { [int]$_.ProcessId })
    # Stale state files (guard killed hard, finally never ran).
    if (Test-Path -LiteralPath $stateRoot) {
        Get-ChildItem -LiteralPath $stateRoot -Filter 'wakeguard-*.json' | ForEach-Object {
            if ($_.BaseName -match '^wakeguard-(\d+)$' -and [int]$Matches[1] -notin $live) {
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }
    $now = [DateTime]::UtcNow
    $rows = @(foreach ($guardPid in $live) {
            $state = Read-GuardState $guardPid
            $age = $null
            if ($state -and $state.heartbeatAt) {
                $age = [int]($now - [DateTime]::Parse($state.heartbeatAt, $null, 'RoundtripKind')).TotalSeconds
            }
            [ordered]@{
                pid                 = $guardPid
                startedAt           = if ($state) { $state.startedAt } else { $null }
                until               = if ($state) { $state.until } else { $null }
                heartbeatAgeSeconds = $age
            }
        })
    $newest = $rows | Sort-Object { $_.startedAt } -Descending | Select-Object -First 1
    [ordered]@{
        running             = [bool]$newest
        pid                 = if ($newest) { $newest.pid } else { $null }
        startedAt           = if ($newest) { $newest.startedAt } else { $null }
        until               = if ($newest) { $newest.until } else { $null }
        heartbeatAgeSeconds = if ($newest) { $newest.heartbeatAgeSeconds } else { $null }
        guards              = $rows.Count
    }
}

function Write-Result($Value) { $Value | ConvertTo-Json -Compress -Depth 4 }

# A state file proves readiness only if it names this very process and was written after the launch; a stale file
# left by a hard-killed guard whose PID Windows reused must not count.
function Test-GuardReady([int]$ProcessId, [DateTime]$LaunchedUtc) {
    $state = Read-GuardState $ProcessId
    if (-not $state -or [int]$state.pid -ne $ProcessId -or -not $state.startedAt) { return $false }
    [DateTime]::Parse($state.startedAt, $null, 'RoundtripKind').ToUniversalTime() -ge $LaunchedUtc.AddSeconds(-1)
}

switch ($Action) {
    'guard' {
        Add-Type -Namespace PetDispatcher -Name WakeNative -MemberDefinition `
            '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
        $esContinuous = [uint32]2147483648   # 0x80000000
        $esSystemRequired = [uint32]1
        if ([PetDispatcher.WakeNative]::SetThreadExecutionState($esContinuous -bor $esSystemRequired) -eq 0) { exit 1 }
        New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
        $statePath = Get-StatePath $PID
        $started = [DateTime]::UtcNow
        $until = if ($Forever) { $null } else { $started.AddMinutes($Minutes) }
        try {
            while ($true) {
                $state = [ordered]@{
                    pid         = $PID
                    startedAt   = $started.ToString('o')
                    until       = if ($until) { $until.ToString('o') } else { $null }
                    heartbeatAt = [DateTime]::UtcNow.ToString('o')
                }
                Set-Content -LiteralPath $statePath -Value (Write-Result $state) -Encoding UTF8
                if ($until -and [DateTime]::UtcNow -ge $until) { break }
                $sleep = $heartbeatSeconds
                if ($until) { $sleep = [Math]::Max(1, [Math]::Min($heartbeatSeconds, [int]($until - [DateTime]::UtcNow).TotalSeconds)) }
                Start-Sleep -Seconds $sleep
            }
        }
        finally {
            [void][PetDispatcher.WakeNative]::SetThreadExecutionState($esContinuous)
            Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        }
        exit 0
    }
    'on' {
        # Control calls (on/off) are serialized: overlapping calls would each snapshot the guards and leave duplicates
        # or a guard behind an `off`.
        $control = New-Object System.Threading.Mutex($false, 'Local\PetDispatcherWakeguardControl')
        if (-not $control.WaitOne(30000)) { Write-Result ([ordered]@{ error = 'another wakeguard call is still running' }); exit 1 }
        try {
        $old = @(Get-Guards | ForEach-Object { [int]$_.ProcessId })
        $launched = [DateTime]::UtcNow
        $guardArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$scriptPath`"",
            '-Action', 'guard', '-Root', "`"$Root`"")
        $guardArgs += if ($Forever) { '-Forever' } else { @('-Minutes', $Minutes) }
        $new = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $guardArgs -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while ([DateTime]::UtcNow -lt $deadline -and -not (Test-GuardReady $new.Id $launched)) {
            if ($new.HasExited) { break }
            Start-Sleep -Milliseconds 250
        }
        if (-not (Test-GuardReady $new.Id $launched)) {
            Stop-Guard $new.Id
            Write-Result ([ordered]@{ error = 'new guard did not report in 15 s; previous guard left running' })
            exit 1
        }
        foreach ($guardPid in $old) { Stop-Guard $guardPid }
        Write-Result (Get-Status)
        exit 0
        }
        finally { $control.ReleaseMutex() }
    }
    'off' {
        $control = New-Object System.Threading.Mutex($false, 'Local\PetDispatcherWakeguardControl')
        if (-not $control.WaitOne(30000)) { Write-Result ([ordered]@{ error = 'another wakeguard call is still running' }); exit 1 }
        try {
            foreach ($guard in Get-Guards) { Stop-Guard ([int]$guard.ProcessId) }
            Write-Result (Get-Status)
            exit 0
        }
        finally { $control.ReleaseMutex() }
    }
    default {
        Write-Result (Get-Status)
        exit 0
    }
}
