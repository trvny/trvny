param([Parameter(Mandatory = $true)][string]$Name)
# Deletes the AppContainer profile MXC created for a session (name pet-dispatcher-<session id>).
# DeleteAppContainerProfile returns S_OK even when the profile does not exist, so this is idempotent.
$ErrorActionPreference = 'Stop'
if ($Name -notmatch '^pet-dispatcher-[A-Za-z0-9-]{1,64}$') { throw "refusing to delete profile '$Name'" }

Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class PetAppContainer {
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    public static extern int DeleteAppContainerProfile(string pszAppContainerName);
}
'@

$hr = [PetAppContainer]::DeleteAppContainerProfile($Name)
if ($hr -ne 0) { Write-Error ('DeleteAppContainerProfile failed: 0x{0:X8}' -f $hr); exit 1 }
