#
# Update each main OS Windows image including the Windows Recovery Environment (WinRE)
#

# Get the list of images contained within the main OS
$WINOS_IMAGES = Get-WindowsImage -ImagePath $MEDIA_NEW_PATH"\sources\install.wim"

Foreach ($IMAGE in $WINOS_IMAGES)
{

# first mount the main OS image
    Write-Output "$(Get-TS): Mounting main OS, image index $($IMAGE.ImageIndex)"
    Mount-WindowsImage -ImagePath $MEDIA_NEW_PATH"\sources\install.wim" -Index $IMAGE.ImageIndex -Path $MAIN_OS_MOUNT -ErrorAction stop| Out-Null

if ($IMAGE.ImageIndex -eq "1")
    {

#
        # update Windows Recovery Environment (WinRE) within this OS image
        #
        Copy-Item -Path $MAIN_OS_MOUNT"\windows\system32\recovery\winre.wim" -Destination $WORKING_PATH"\winre.wim" -Force -ErrorAction stop | Out-Null
        Write-Output "$(Get-TS): Mounting WinRE"
        Mount-WindowsImage -ImagePath $WORKING_PATH"\winre.wim" -Index 1 -Path $WINRE_MOUNT -ErrorAction stop | Out-Null

# Add servicing stack update (Step 1 from the table)
        Write-Output "$(Get-TS): Adding package $LCU_PATH to WinRE"
        try
        {
            Add-WindowsPackage -Path $WINRE_MOUNT -PackagePath $LCU_PATH | Out-Null
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

#
        # Optional: Add the language to recovery environment
        #

# Install lp.cab cab
        Write-Output "$(Get-TS): Adding package $WINPE_OC_LP_PATH to WinRE"
        Add-WindowsPackage -Path $WINRE_MOUNT -PackagePath $WINPE_OC_LP_PATH -ErrorAction stop | Out-Null

# Install language cabs for each optional package installed
        $WINRE_INSTALLED_OC = Get-WindowsPackage -Path $WINRE_MOUNT
        Foreach ($PACKAGE in $WINRE_INSTALLED_OC)
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
                        Write-Output "$(Get-TS): Adding package $OC_CAB_PATH to WinRE"
                        Add-WindowsPackage -Path $WINRE_MOUNT -PackagePath $OC_CAB_PATH -ErrorAction stop | Out-Null
                    }
                }
            }
        }

# Add font support for the new language
        if ( (Test-Path -Path $WINPE_FONT_SUPPORT_PATH) )
        {
            Write-Output "$(Get-TS): Adding package $WINPE_FONT_SUPPORT_PATH to WinRE"
            Add-WindowsPackage -Path $WINRE_MOUNT -PackagePath $WINPE_FONT_SUPPORT_PATH -ErrorAction stop | Out-Null
        }

# Add TTS support for the new language
        if (Test-Path -Path $WINPE_SPEECH_TTS_PATH)
        {
            if ( (Test-Path -Path $WINPE_SPEECH_TTS_LANG_PATH) )
            {
                Write-Output "$(Get-TS): Adding package $WINPE_SPEECH_TTS_PATH to WinRE"
                Add-WindowsPackage -Path $WINRE_MOUNT -PackagePath $WINPE_SPEECH_TTS_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Adding package $WINPE_SPEECH_TTS_LANG_PATH to WinRE"
                Add-WindowsPackage -Path $WINRE_MOUNT -PackagePath $WINPE_SPEECH_TTS_LANG_PATH -ErrorAction stop | Out-Null
            }
        }

# Add Safe OS
        Write-Output "$(Get-TS): Adding package $SAFE_OS_DU_PATH to WinRE"
        Add-WindowsPackage -Path $WINRE_MOUNT -PackagePath $SAFE_OS_DU_PATH -ErrorAction stop | Out-Null

# Perform image cleanup
        Write-Output "$(Get-TS): Performing image cleanup on WinRE"
        DISM /image:$WINRE_MOUNT /cleanup-image /StartComponentCleanup /ResetBase /Defer | Out-Null
        if ($LastExitCode -ne 0)
        {
            throw "Error: Failed to perform image cleanup on WinRE. Exit code: $LastExitCode"
        }

# Dismount
        Dismount-WindowsImage -Path $WINRE_MOUNT  -Save -ErrorAction stop | Out-Null

# Export
        Write-Output "$(Get-TS): Exporting image to $WORKING_PATH\winre.wim"
        Export-WindowsImage -SourceImagePath $WORKING_PATH"\winre.wim" -SourceIndex 1 -DestinationImagePath $WORKING_PATH"\winre2.wim" -ErrorAction stop | Out-Null

}

Copy-Item -Path $WORKING_PATH"\winre2.wim" -Destination $MAIN_OS_MOUNT"\windows\system32\recovery\winre.wim" -Force -ErrorAction stop | Out-Null

#
    # update Main OS
    #

# Add servicing stack update (Step 17 from the table). Unlike WinRE and WinPE, we don't need to check for error 0x8007007e
    Write-Output "$(Get-TS): Adding package $LCU_PATH to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsPackage -Path $MAIN_OS_MOUNT -PackagePath $LCU_PATH | Out-Null

# Optional: Add language to main OS and corresponding language experience Features on Demand
    Write-Output "$(Get-TS): Adding package $OS_LP_PATH to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsPackage -Path $MAIN_OS_MOUNT -PackagePath $OS_LP_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Adding language FOD: Language.Fonts.Jpan~~~und-JPAN~0.0.1.0 to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsCapability -Name "Language.Fonts.$LANG_FONT_CAPABILITY~~~und-$LANG_FONT_CAPABILITY~0.0.1.0" -Path $MAIN_OS_MOUNT -Source $FOD_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Adding language FOD: Language.Basic~~~$LANG~0.0.1.0 to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsCapability -Name "Language.Basic~~~$LANG~0.0.1.0" -Path $MAIN_OS_MOUNT -Source $FOD_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Adding language FOD: Language.OCR~~~$LANG~0.0.1.0 to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsCapability -Name "Language.OCR~~~$LANG~0.0.1.0" -Path $MAIN_OS_MOUNT -Source $FOD_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Adding language FOD: Language.Handwriting~~~$LANG~0.0.1.0 to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsCapability -Name "Language.Handwriting~~~$LANG~0.0.1.0" -Path $MAIN_OS_MOUNT -Source $FOD_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Adding language FOD: Language.TextToSpeech~~~$LANG~0.0.1.0 to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsCapability -Name "Language.TextToSpeech~~~$LANG~0.0.1.0" -Path $MAIN_OS_MOUNT -Source $FOD_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Adding language FOD: Language.Speech~~~$LANG~0.0.1.0 to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsCapability -Name "Language.Speech~~~$LANG~0.0.1.0" -Path $MAIN_OS_MOUNT -Source $FOD_PATH -ErrorAction stop | Out-Null

# Optional: Add additional Features On Demand
	For ( $index = 0; $index -lt $FOD.count; $index++)#
	{
        Write-Output "$(Get-TS): Adding $($FOD[$index]) to main OS, index $($IMAGE.ImageIndex)"
        Add-WindowsCapability -Name $($FOD[$index]) -Path $MAIN_OS_MOUNT -Source $FOD_PATH -ErrorAction stop | Out-Null
	}

# Optional: Add Legacy Features
    For ( $index = 0; $index -lt $OC.count; $index++)
    {
        Write-Output "$(Get-TS): Adding $($OC[$index]) to main OS, index $($IMAGE.ImageIndex)"
        DISM /Image:$MAIN_OS_MOUNT /Enable-Feature /FeatureName:$($OC[$index]) /All | Out-Null
        if ($LastExitCode -ne 0)
        {
            throw "Error: Failed to add $($OC[$index]) to main OS, index $($IMAGE.ImageIndex). Exit code: $LastExitCode"
        }
    }

# Add latest cumulative update
    Write-Output "$(Get-TS): Adding package $LCU_PATH to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsPackage -Path $MAIN_OS_MOUNT -PackagePath $LCU_PATH -ErrorAction stop | Out-Null

# Perform image cleanup. Some Optional Components might require the image to be booted, and thus
    # image cleanup may fail. We'll catch and handle as a warning.
    Write-Output "$(Get-TS): Performing image cleanup on main OS, index $($IMAGE.ImageIndex)"
    DISM /image:$MAIN_OS_MOUNT /cleanup-image /StartComponentCleanup | Out-Null
    if ($LastExitCode -ne 0)
    {
        if ($LastExitCode -eq -2146498554)
        {
            # We hit 0x800F0806 CBS_E_PENDING. We will ignore this with a warning
            # This is likely due to legacy components being added that require online operations.
            Write-Warning "$(Get-TS): Failed to perform image cleanup on main OS, index $($IMAGE.ImageIndex). Exit code: $LastExitCode. The operation cannot be performed until pending servicing operations are completed. The image must be booted to complete the pending servicing operation."
        }
        else
        {
            throw "Error: Failed to perform image cleanup on main OS, index $($IMAGE.ImageIndex). Exit code: $LastExitCode"
        }
    }

# Finally, we'll add .NET 3.5 and the .NET cumulative update
    Write-Output "$(Get-TS): Adding NetFX3~~~~ to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsCapability -Name "NetFX3~~~~" -Path $MAIN_OS_MOUNT -Source $FOD_PATH -ErrorAction stop | Out-Null

# Add .NET Cumulative Update
    Write-Output "$(Get-TS): Adding package $DOTNET_CU_PATH to main OS, index $($IMAGE.ImageIndex)"
    Add-WindowsPackage -Path $MAIN_OS_MOUNT -PackagePath $DOTNET_CU_PATH -ErrorAction stop | Out-Null

# Dismount
    Dismount-WindowsImage -Path $MAIN_OS_MOUNT -Save -ErrorAction stop | Out-Null

# Export
    Write-Output "$(Get-TS): Exporting image to $WORKING_PATH\install2.wim"
    Export-WindowsImage -SourceImagePath $MEDIA_NEW_PATH"\sources\install.wim" -SourceIndex $IMAGE.ImageIndex -DestinationImagePath $WORKING_PATH"\install2.wim" -ErrorAction stop | Out-Null
}

Move-Item -Path $WORKING_PATH"\install2.wim" -Destination $MEDIA_NEW_PATH"\sources\install.wim" -Force -ErrorAction stop | Out-Null