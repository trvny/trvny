#
# update Windows Preinstallation Environment (WinPE)
#

# Get the list of images contained within WinPE
$WINPE_IMAGES = Get-WindowsImage -ImagePath $MEDIA_NEW_PATH"\sources\boot.wim"

Foreach ($IMAGE in $WINPE_IMAGES)
{

# update WinPE
    Write-Output "$(Get-TS): Mounting WinPE, image index $($IMAGE.ImageIndex)"
    Mount-WindowsImage -ImagePath $MEDIA_NEW_PATH"\sources\boot.wim" -Index $IMAGE.ImageIndex -Path $WINPE_MOUNT -ErrorAction stop | Out-Null

# Add servicing stack update (Step 9 from the table)
    try
    {
        Write-Output "$(Get-TS): Adding package $LCU_PATH to WinPE, image index $($IMAGE.ImageIndex)"
        Add-WindowsPackage -Path $WINPE_MOUNT -PackagePath $LCU_PATH | Out-Null
    }
    Catch
    {
        $theError = $_
        Write-Output "$(Get-TS): $theError"
        if ($theError.Exception -like "*0x8007007e*")
        {
            Write-Warning "$(Get-TS): Failed with error 0x8007007e. This failure is a known issue with combined cumulative update, we can ignore."
        }
        else
        {
            throw
        }
    }

# Install lp.cab cab
    Write-Output "$(Get-TS): Adding package $WINPE_OC_LP_PATH to WinPE, image index $($IMAGE.ImageIndex)"
    Add-WindowsPackage -Path $WINPE_MOUNT -PackagePath $WINPE_OC_LP_PATH -ErrorAction stop | Out-Null

# Install language cabs for each optional package installed
    $WINPE_INSTALLED_OC = Get-WindowsPackage -Path $WINPE_MOUNT
    Foreach ($PACKAGE in $WINPE_INSTALLED_OC)
    {
        if ( ($PACKAGE.PackageState -eq "Installed") -and ($PACKAGE.PackageName.startsWith("WinPE-")) -and ($PACKAGE.ReleaseType -eq "FeaturePack") )
        {
            $INDEX = $PACKAGE.PackageName.IndexOf("-Package")
            if ($INDEX -ge 0)
            {
                $OC_CAB = $PACKAGE.PackageName.Substring(0, $INDEX) + "_" + $LANG + ".cab"
                if ($WINPE_OC_LANG_CABS.Contains($OC_CAB))
                {
                    $OC_CAB_PATH = Join-Path $WINPE_OC_LANG_PATH $OC_CAB

Write-Output "$(Get-TS): Adding package $OC_CAB_PATH to WinPE, image index $($IMAGE.ImageIndex)"
                    Add-WindowsPackage -Path $WINPE_MOUNT -PackagePath $OC_CAB_PATH -ErrorAction stop | Out-Null
                }
            }
        }
    }

# Add font support for the new language
    if ( (Test-Path -Path $WINPE_FONT_SUPPORT_PATH) )
    {
        Write-Output "$(Get-TS): Adding package $WINPE_FONT_SUPPORT_PATH to WinPE, image index $($IMAGE.ImageIndex)"
        Add-WindowsPackage -Path $WINPE_MOUNT -PackagePath $WINPE_FONT_SUPPORT_PATH -ErrorAction stop | Out-Null
    }

# Add TTS support for the new language
    if (Test-Path -Path $WINPE_SPEECH_TTS_PATH)
    {
        if ( (Test-Path -Path $WINPE_SPEECH_TTS_LANG_PATH) )
        {
            Write-Output "$(Get-TS): Adding package $WINPE_SPEECH_TTS_PATH to WinPE, image index $($IMAGE.ImageIndex)"
            Add-WindowsPackage -Path $WINPE_MOUNT -PackagePath $WINPE_SPEECH_TTS_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Adding package $WINPE_SPEECH_TTS_LANG_PATH to WinPE, image index $($IMAGE.ImageIndex)"
            Add-WindowsPackage -Path $WINPE_MOUNT -PackagePath $WINPE_SPEECH_TTS_LANG_PATH -ErrorAction stop | Out-Null
        }
    }

# Generates a new Lang.ini file which is used to define the language packs inside the image
    if ( (Test-Path -Path $WINPE_MOUNT"\sources\lang.ini") )
    {
        Write-Output "$(Get-TS): Updating lang.ini"
        DISM /image:$WINPE_MOUNT /Gen-LangINI /distribution:$WINPE_MOUNT | Out-Null
        if ($LastExitCode -ne 0)
        {
            throw "Error: Failed to update lang.ini. Exit code: $LastExitCode"
        }
    }

# Add latest cumulative update
    Write-Output "$(Get-TS): Adding package $LCU_PATH to WinPE, image index $($IMAGE.ImageIndex)"
    Add-WindowsPackage -Path $WINPE_MOUNT -PackagePath $LCU_PATH -ErrorAction stop | Out-Null

# Perform image cleanup
    Write-Output "$(Get-TS): Performing image cleanup on WinPE, image index $($IMAGE.ImageIndex)"
    DISM /image:$WINPE_MOUNT /cleanup-image /StartComponentCleanup /ResetBase /Defer | Out-Null
    if ($LastExitCode -ne 0)
    {
        throw "Error: Failed to perform image cleanup on WinPE, image index $($IMAGE.ImageIndex). Exit code: $LastExitCode"
    }

if ($IMAGE.ImageIndex -eq "2")
    {
        # Save setup.exe for later use. This will address possible binary mismatch with the version in the main OS \sources folder
        Copy-Item -Path $WINPE_MOUNT"\sources\setup.exe" -Destination $WORKING_PATH"\setup.exe" -Force -ErrorAction stop | Out-Null

# Save setuphost.exe for later use. This will address possible binary mismatch with the version in the main OS \sources folder
        # This is only required starting with Windows 11 version 24H2
        $TEMP = Get-WindowsImage -ImagePath $MEDIA_NEW_PATH"\sources\boot.wim" -Index $IMAGE.ImageIndex
        if ([System.Version]$TEMP.Version -ge [System.Version]"10.0.26100")
        {
            Copy-Item -Path $WINPE_MOUNT"\sources\setuphost.exe" -Destination $WORKING_PATH"\setuphost.exe" -Force -ErrorAction stop | Out-Null
        }
        else
        {
            Write-Output "$(Get-TS): Skipping copy of setuphost.exe; image version $($TEMP.Version)"
        }

# Save serviced boot manager files later copy to the root media.
        Copy-Item -Path $WINPE_MOUNT"\Windows\boot\efi\bootmgfw.efi" -Destination $WORKING_PATH"\bootmgfw.efi" -Force -ErrorAction stop | Out-Null
        Copy-Item -Path $WINPE_MOUNT"\Windows\boot\efi\bootmgr.efi" -Destination $WORKING_PATH"\bootmgr.efi" -Force -ErrorAction stop | Out-Null
    }

# Dismount
    Dismount-WindowsImage -Path $WINPE_MOUNT -Save -ErrorAction stop | Out-Null

#Export WinPE
    Write-Output "$(Get-TS): Exporting image to $WORKING_PATH\boot2.wim"
    Export-WindowsImage -SourceImagePath $MEDIA_NEW_PATH"\sources\boot.wim" -SourceIndex $IMAGE.ImageIndex -DestinationImagePath $WORKING_PATH"\boot2.wim" -ErrorAction stop | Out-Null
}

Move-Item -Path $WORKING_PATH"\boot2.wim" -Destination $MEDIA_NEW_PATH"\sources\boot.wim" -Force -ErrorAction stop | Out-Null