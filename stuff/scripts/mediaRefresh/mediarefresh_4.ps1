#
# update remaining files on media
#

# Add Setup DU by copy the files from the package into the newMedia
Write-Output "$(Get-TS): Adding package $SETUP_DU_PATH"
cmd.exe /c $env:SystemRoot\System32\expand.exe $SETUP_DU_PATH -F:* $MEDIA_NEW_PATH"\sources" | Out-Null
if ($LastExitCode -ne 0)
{
    throw "Error: Failed to expand $SETUP_DU_PATH. Exit code: $LastExitCode"
}

# Copy setup.exe from boot.wim, saved earlier.
Write-Output "$(Get-TS): Copying $WORKING_PATH\setup.exe to $MEDIA_NEW_PATH\sources\setup.exe"
Copy-Item -Path $WORKING_PATH"\setup.exe" -Destination $MEDIA_NEW_PATH"\sources\setup.exe" -Force -ErrorAction stop | Out-Null

# Copy setuphost.exe from boot.wim, saved earlier.
if (Test-Path -Path $WORKING_PATH"\setuphost.exe")
{
    Write-Output "$(Get-TS): Copying $WORKING_PATH\setuphost.exe to $MEDIA_NEW_PATH\sources\setuphost.exe"
    Copy-Item -Path $WORKING_PATH"\setuphost.exe" -Destination $MEDIA_NEW_PATH"\sources\setuphost.exe" -Force -ErrorAction stop | Out-Null
}

# Copy bootmgr files from boot.wim, saved earlier.
$MEDIA_NEW_FILES = Get-ChildItem $MEDIA_NEW_PATH -Force -Recurse -Filter b*.efi

Foreach ($File in $MEDIA_NEW_FILES)
{
    if (($File.Name -ieq "bootmgfw.efi") -or ($File.Name -ieq "bootx64.efi") -or ($File.Name -ieq "bootia32.efi") -or ($File.Name -ieq "bootaa64.efi"))
    {
        Write-Output "$(Get-TS): Copying $WORKING_PATH\bootmgfw.efi to $($File.FullName)"
        Copy-Item -Path $WORKING_PATH"\bootmgfw.efi" -Destination $File.FullName -Force -ErrorAction stop | Out-Null
    }
    elseif ($File.Name -ieq "bootmgr.efi")
    {
        Write-Output "$(Get-TS): Copying $WORKING_PATH\bootmgr.efi to $($File.FullName)"
        Copy-Item -Path $WORKING_PATH"\bootmgr.efi" -Destination $File.FullName -Force -ErrorAction stop | Out-Null
    }
}