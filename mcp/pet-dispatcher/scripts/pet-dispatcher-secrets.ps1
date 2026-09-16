[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Set','Get','Remove')]
    [string]$Action,
    [Parameter(Mandatory = $true)]
    [ValidateSet('CONTROL_PLANE_TOKEN','TASK_SIGNING_SECRET','PET_DISPATCHER_QUEUE_TOKEN')]
    [string]$Name,
    [string]$Value,
    [string]$Root
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Join-Path $env:USERPROFILE '.local\share\pet-dispatcher\secrets' }
$path = Join-Path $Root "$Name.dpapi"

switch ($Action) {
    'Set' {
        if (-not $Value) { throw 'Set requires -Value.' }
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
        $secure = ConvertTo-SecureString $Value -AsPlainText -Force
        ConvertFrom-SecureString $secure | Set-Content -LiteralPath $path -Encoding ascii -NoNewline
        return
    }
    'Get' {
        if (-not (Test-Path -LiteralPath $path)) { throw "Secret is not stored: $Name" }
        $secure = Get-Content -LiteralPath $path -Raw | ConvertTo-SecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        }
        return
    }
    'Remove' {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        return
    }
}
