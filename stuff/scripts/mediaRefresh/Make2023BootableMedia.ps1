<#
.SYNOPSIS
    Microsoft 'Windows UEFI CA 2023' Media Update Script

.DESCRIPTION
    This script updates Windows media to use boot binaries signed with the 'Windows UEFI CA 2023' certificate.

.NOTES
    File Name  : Make2023BootableMedia.ps1
    Author     : Microsoft Corporation
    Version    : 1.4
    Date       : 2026-03-13

.LICENSE
    Licensed under the BSD License. See License.txt in the project root for full license information.

.COPYRIGHT
    Copyright (c) Microsoft Corporation. All rights reserved.
#>

param (

    [Parameter(Position=0,mandatory=$true)]
	[string] $MediaPath,

	[ValidateSet("ISO", "USB", "LOCAL", IgnoreCase=$true)]
	[Parameter(Position = 1, Mandatory=$false)]
	[string] $TargetType,

	[Parameter(Position = 2,mandatory=$false)]
	[string] $ISOPath,

	[Parameter(Position = 3,mandatory=$false)]
    [string] $USBDrive,

    [Parameter(Position = 4,mandatory=$false)]
    [string] $FileSystem,

    [Parameter(Position = 5, Mandatory=$false)]
    [string] $NewMediaPath,

    [Parameter(Position = 6, Mandatory=$false)]
    [string] $StagingDir,

    [Parameter(Position = 7, Mandatory=$false)]
    [bool] $DebugOn = $false
)

function Get-TS { return "{0:HH:mm:ss}" -f [DateTime]::Now }

function Show-Usage {
    $scriptName = $global:ScriptName
    Write-Host "Usage:`r`n$scriptName -MediaPath <path> -TargetType <type> -ISOPath <path> -USBDrive <drive:> -FileSystem <type> -NewMediaPath <path> -StagingDir <path>" -ForegroundColor Blue
    Write-Host "  -MediaPath <path> The path to the media folder or ISO file to be used as baseline."
    Write-Host "  -TargetType <type> The type of media to be created (ISO, USB, or LOCAL)."
    Write-Host "        ISO: Convert media specified in -MediaPath to 2023 bootable ISO file. Targets -ISOPath."
    Write-Host "        USB: Convert media specified in -MediaPath to 2023 bootable image and writes it to -USBDrive."
    Write-Host "        LOCAL: Convert media specified in -MediaPath to 2023 bootable image copied to -NewMediaPath."
    Write-Host "  -ISOPath <path> The path to the new ISO file to be created from -MediaPath."
    Write-Host "  -USBDrive <drive:> The drive letter to a target USB drive (example E:)."
    Write-Host "  -FileSystem <type> Optional. The file system to format the USB drive with (FAT32 or ExFAT). Default is FAT32."
    Write-Host "  -NewMediaPath <path> Required for LOCAL TargetType. -MediaPath content is duplicated here and then updated."
    Write-Host "  -StagingDir (optional) <path> Overrides default temp staging path used by this script. System %TEMP% used by default with random subfolder."
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "$scriptName -MediaPath C:\Media\Win10Media -TargetType ISO -ISOPath C:\Media\Win10_Updated.iso"
    Write-Host "$scriptName -MediaPath C:\Media\Win11.iso -TargetType ISO -ISOPath C:\Media\Win11_Updated.iso"
    Write-Host "$scriptName -MediaPath \\server\share\Win11_Media -TargetType ISO -ISOPath C:\Media\Win11_Updated.iso"
    Write-Host "$scriptName -MediaPath \\server\share\Win11.iso -TargetType ISO -ISOPath C:\Media\Win11_Updated.iso"
    Write-Host "$scriptName -MediaPath C:\Media\Win1124H2 -TargetType USB -USBDrive H:"
    Write-Host "$scriptName -MediaPath C:\Media\Win11.iso -TargetType USB -USBDrive E:"
    Write-Host "$scriptName -MediaPath C:\Media\Win1124H2 -TargetType LOCAL -NewMediaPath C:\Media\Win1124H2_Updated"
    Write-Host "$scriptName -MediaPath H:\Media\Win11.iso -TargetType LOCAL -NewMediaPath R:\Win11_Updated"
    Write-Host "$scriptName -MediaPath C:\Media\Win1124H2 -TargetType ISO -ISOPath C:\Media\Win1124H2_Updated.iso -StagingDir C:\Temp\Win1124H2"
    Write-Host "`r`nIMPORTANT! You must provide this script with a media source (-MediaPath) which has the latest 2024-4B (or later) updates included!`r`n" -ForegroundColor Red
}

function Show-ADK-Req {
    Write-Host "The Windows ADK must be installed on the system if trying to create ISO media. Available at https://aka.ms/adk" -ForegroundColor Red
    Write-Host "After install, open an admin-elevated 'Deploy and Imaging Tools Environment' command prompt provided with the ADK." -ForegroundColor Red
    Write-Host "Then run PowerShell from this command prompt and you should be good to go.`r`n" -ForegroundColor Red
}

function Download-Oscdimg {
    <#
    .SYNOPSIS
        Downloads oscdimg.exe from the Microsoft public symbol server for the current architecture. These are not signed so 
        they are validated against known SHA256 hashes before being used. 
    .OUTPUTS
        The file path to the downloaded oscdimg.exe, or $null on failure.
    #>

    $archUrls = @{
        "AMD64" = "https://msdl.microsoft.com/download/symbols/oscdimg.exe/9F01AFB765000/oscdimg.exe"
        "ARM64" = "https://msdl.microsoft.com/download/symbols/oscdimg.exe/2267BF2C66000/oscdimg.exe"
        "x86"   = "https://msdl.microsoft.com/download/symbols/oscdimg.exe/CFBCC93A60000/oscdimg.exe"
    }

    $arch = $env:PROCESSOR_ARCHITECTURE
    if (-not $archUrls.ContainsKey($arch)) {
        Write-Host "Unsupported architecture [$arch] for oscdimg download." -ForegroundColor Red
        return $null
    }

    $url = $archUrls[$arch]
    $expectedHash = $global:oscdimg_known_hashes[$arch]
    $destPath = Join-Path -Path $env:TEMP -ChildPath "oscdimg.exe"

    Write-Host "Downloading oscdimg.exe for [$arch] from Microsoft symbol server..." -ForegroundColor Blue
    Write-Dbg-Host "Download URL: $url"
    Write-Dbg-Host "Destination: $destPath"

    $tmpDownloadPath = "$destPath.download"
    try {
        Invoke-WebRequest -Uri $url -OutFile $tmpDownloadPath -UseBasicParsing -ErrorAction Stop
    } catch {
        Write-Host "Failed to download oscdimg.exe: $($_.Exception.Message)" -ForegroundColor Red
        Remove-Item -Path $tmpDownloadPath -Force -ErrorAction SilentlyContinue
        return $null
    }

    if (-not (Test-Path $tmpDownloadPath)) {
        Write-Host "Download appeared to succeed but file not found at [$tmpDownloadPath]." -ForegroundColor Red
        return $null
    }

    # Validate downloaded file against known SHA256 hash
    $actualHash = (Get-FileHash -Path $tmpDownloadPath -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
        Write-Host "Downloaded oscdimg.exe failed integrity check." -ForegroundColor Red
        Write-Host "Expected SHA256: $expectedHash" -ForegroundColor Red
        Write-Host "Actual SHA256:   $actualHash" -ForegroundColor Red
        Remove-Item -Path $tmpDownloadPath -Force -ErrorAction SilentlyContinue
        return $null
    }
    Write-Dbg-Host "SHA256 hash verified: $actualHash"

    # Move validated file into place
    Move-Item -Path $tmpDownloadPath -Destination $destPath -Force

    $fileSize = (Get-Item $destPath).Length
    Write-Host "Successfully downloaded oscdimg.exe ($fileSize bytes) to [$destPath]" -ForegroundColor Green
    return $destPath
}

function Debug-Pause {

    if ($global:Dbg_Pause) {
        Write-Host "Press any key to continue"
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
    return
}

# Routine to help with script debugging
function Write-Dbg-Host {
    if ($global:Dbg_Output) {
        Write-Host "$(Get-TS): [DBG] $args" -ForegroundColor DarkMagenta
    }
}

function Execute-Cleanup {

    # Pause here to allow the user to see the mounted WIM
    Debug-Pause

    Write-Dbg-Host "Cleaning up"

    if ($global:WIM_Mount_Path) {
        Write-Dbg-Host "Dismounting [$global:WIM_Mount_Path]"
        try {
            Dismount-WindowsImage -Path $global:WIM_Mount_Path -Discard -ErrorAction stop | Out-Null
            try {
                Write-Dbg-Host "Removing WIM mount path [$global:WIM_Mount_Path]"
                Remove-Item -Path $global:WIM_Mount_Path -Recurse -Force -ErrorAction stop | Out-Null
            } catch {
                Write-Host "Failed to remove WIM mount path [$global:WIM_Mount_Path]" -ForegroundColor Red
                Write-Host $_.Exception.Message -ForegroundColor Red
            }
        } catch {
            Write-Host "Failed to dismount WIM [$global:WIM_Mount_Path]" -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
        }
    }

    if ($global:ISO_Mount_Path) {
        Write-Dbg-Host "Dismounting [$global:ISO_Mount_Path]"

        try {
            Dismount-DiskImage -ImagePath $global:ISO_Mount_Path -ErrorAction stop | Out-Null
        } catch {
            Write-Host "Failed to dismount ISO [$global:ISO_Mount_Path]" -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
        }
    }

    if ($global:StagingDir_Created -eq $true) {
        Write-Dbg-Host "Removing staging directory [$global:Staging_Directory_Path]"
        try {
            Remove-Item -Path $global:Staging_Directory_Path -Recurse -Force -ErrorAction stop | Out-Null
        } catch {
            Write-Host "Failed to remove [$global:Staging_Directory_Path]" -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
        }
    }
}

function Validate-Requirements {
    param (
        [string] $TargetType
    )

    # If the target type is ISO, check for the required support tools from the ADK
    if ($TargetType -eq "ISO") {

        Write-Host "Checking for required support tools" -ForegroundColor Blue
        # Check if the script is running with administrative privileges
        if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
            Write-Host "You do not have Administrator rights to run this script.`nPlease re-run this script as an Administrator." -ForegroundColor Red
            exit
        }
        # Look for the oscdimg.exe tool in the commonly used install path for the ADK.
        $adkOsCdImgPath = "\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe"
        $progFilesPath = Get-ChildItem "Env:ProgramFiles(x86)"
        if ($progFilesPath -ne $null) {
            $executablePath = Join-Path -Path $progFilesPath.Value -ChildPath $adkOsCdImgPath
            if (Test-Path -Path $executablePath) {
                Write-Dbg-Host "Found [oscdimg.exe] in [$executablePath]"
                $global:oscdimg_exe = $executablePath
                return $true
            }
            Write-Dbg-Host "[oscdimg.exe] not found in [$executablePath]"
        }
        # Final attempt to find oscdimg.exe in the system PATH
        $executablePath = (where.exe oscdimg.exe 2>$null)
        if ($null -eq $executablePath) {
            # See if oscdimg.exe exists in the current working directory
            $executablePath = Join-Path -Path $PWD.Path -ChildPath "oscdimg.exe"
            if (-not (Test-Path -Path $executablePath)) {
                Write-Dbg-Host "[oscdimg.exe] not found in [$PWD] or in the system PATH!"

                # Check if oscdimg.exe was previously downloaded to the temp directory
                $tempOscdimg = Join-Path -Path $env:TEMP -ChildPath "oscdimg.exe"
                if (Test-Path -Path $tempOscdimg) {
                    # Validate hash before trusting a cached copy from user-writable temp dir
                    $expectedHash = $global:oscdimg_known_hashes[$env:PROCESSOR_ARCHITECTURE]
                    $actualHash = (Get-FileHash -Path $tempOscdimg -Algorithm SHA256).Hash
                    if ($expectedHash -and $actualHash -eq $expectedHash) {
                        Write-Dbg-Host "Found previously downloaded [oscdimg.exe] in [$tempOscdimg] with valid hash"
                        Write-Host "Using previously downloaded oscdimg.exe from [$tempOscdimg]" -ForegroundColor Green
                        $global:oscdimg_exe = $tempOscdimg
                        return $true
                    } else {
                        Write-Dbg-Host "Cached [oscdimg.exe] at [$tempOscdimg] failed integrity check. Removing."
                        Remove-Item -Path $tempOscdimg -Force -ErrorAction SilentlyContinue
                    }
                }

                # Offer to download oscdimg.exe from the Microsoft public symbol server
                Write-Host "`r`noscdimg.exe is required for ISO media creation and was not found on this system." -ForegroundColor Yellow
                Write-Host "It can be downloaded directly from the Microsoft public symbol server (~450 KB)." -ForegroundColor Yellow
                Write-Host "Alternatively, it is included with an install of the full Windows ADK (https://aka.ms/adk).`r`n" -ForegroundColor Yellow
                $response = Read-Host "Download oscdimg.exe from Microsoft? (Y/N)"
                if ($response -match '^[Yy]') {
                    $downloadedPath = Download-Oscdimg
                    if ($null -ne $downloadedPath) {
                        $global:oscdimg_exe = $downloadedPath
                        return $true
                    }
                    Write-Host "Download failed. Please install the Windows ADK instead." -ForegroundColor Red
                }

                Show-ADK-Req
                return $false
            }
        }

        Write-Dbg-Host "[oscdimg.exe] found in [$executablePath]"
        $global:oscdimg_exe = $executablePath
    }
    return $true
}

function Initialize-MediaPaths {
    param (
         [string] $MediaPath,
         [string] $NewMediaPath,
         [string] $StagingDir
     )

    $isUNCPath = $false
    $localMediaPath = $MediaPath
    $mountResult = $null

    # If NewMediaPath is provided, use it as the staging directory
    if ($NewMediaPath) {
        try {
            $tmpPath = ConvertTo-AbsolutePath -Path $NewMediaPath
        }
        catch {
            Write-Host "Error processing [$NewMediaPath] -> Error: $($_.Exception.Message)" -ForegroundColor Red
            return $false
        }

        if ($NewMediaPath -match "^[a-zA-Z]:$") {
            $tmpPath = "$NewMediaPath\"
        }

        $global:Temp_Media_To_Update_Path = $tmpPath
        $global:Staging_Directory_Path = $tmpPath

    } else {

        # If NewMediaPath is not provided, use the StagingDir as the staging directory
        $result = Initialize-StagingDirectory $StagingDir
        if ($result -eq $false) {
            return $false
        }
        $global:Temp_Media_To_Update_Path = $global:Staging_Directory_Path + "\MediaToUpdate"
    }

    if (-not (Test-Path -Path $global:Temp_Media_To_Update_Path)) {
        try {
            New-Item -ItemType Directory -Path $global:Temp_Media_To_Update_Path  -Force | Out-Null
            Write-Dbg-Host "[$global:Temp_Media_To_Update_Path] created"
        } catch {
            Write-Host $_.Exception.Message -ForegroundColor Red
            return $false
        }
    }

    Write-Host "Staging media" -ForegroundColor Blue
    $global:Src_Media_Path = $MediaPath
    # See if MediaPath is a UNC path
    if ($MediaPath -match "^\\\\") {
        Write-Dbg-Host "[$MediaPath] is a UNC path"
        $isUNCPath = $true
    }

    # Now determine if this is an ISO
    if ($MediaPath -match "\.iso$") {

        Write-Dbg-Host "[$MediaPath] is an ISO file"
        if ($isUNCPath) {

            $localIsoPath = $global:Staging_Directory_Path + "\$((Get-Item -Path $global:Src_Media_Path).Name)"
            Write-Host "Copying [$global:Src_Media_Path] to staging directory"
            Write-Dbg-Host "Copying [$global:Src_Media_Path] --> [$localIsoPath]"
            try {
                Copy-LargeFileWithProgres -SourcePath $global:Src_Media_Path -Destination $localIsoPath -Force -ErrorAction stop | Out-Null
            } catch {
                Write-Host $_.Exception.Message -ForegroundColor Red
                return $false
            }
        } else{
            # Get full path for the ISO
            $global:Src_Media_Path = (Get-Item -Path $MediaPath).FullName
            if ($global:Src_Media_Path -eq $null) {
                Write-Host "Failed to get full path for [$MediaPath]" -ForegroundColor Red
                return $false
            }
            $localIsoPath = $global:Src_Media_Path
        }

        Write-Host "Mounting ISO from staged media" -ForegroundColor Blue
        Write-Dbg-Host "Mounting ISO [$localIsoPath]"
        $mountResult = Mount-DiskImage -ImagePath $localIsoPath -PassThru -ErrorAction stop
        if ($mountResult -eq $null) {
            Write-Host "Failed to mount $localIsoPath" -ForegroundColor Red
            return $false
        }

        $global:ISO_Mount_Path = $localIsoPath
        $localMediaPath = ($mountResult | Get-Volume).DriveLetter + ":"

        # Retrieve the volume label from the mounted ISO to be used later if a new ISO is created
        $global:ISO_Label = (Get-Volume -DriveLetter ($mountResult | Get-Volume).DriveLetter).FileSystemLabel

    } else {

        Write-Dbg-Host "[$MediaPath] is a directory"
        try {
            $tmpPath = ConvertTo-AbsolutePath -Path $MediaPath -AllowUNC $true
        }
        catch {
            Write-Host "Error processing [$MediaPath] -> Error: $($_.Exception.Message)" -ForegroundColor Red
            return $false
        }

        $global:Src_Media_Path = $tmpPath
        $localMediaPath = $tmpPath
    }

    $bootWimPath = $localMediaPath + "\sources\boot.wim"
    Write-Dbg-Host "Making sure [$bootWimPath] exists"
    if (-not (Test-Path -Path $bootWimPath)) {
        Write-Host "[$localMediaPath\] does not appear to point to valid Windows media!" -ForegroundColor Red
        return $false
    }

    # Get the current working directory and add "WimMount" to it
    $global:WIM_Mount_Path = $global:Staging_Directory_Path + "\WimMount"

    # If the WIM MOUNT directory does not exist, create it
    if (-not (Test-Path -Path $global:WIM_Mount_Path)) {
        New-Item -ItemType Directory -Path $global:WIM_Mount_Path -Force | Out-Null
        Write-Dbg-Host "Creating mount path [$global:WIM_Mount_Path]"
    }else{
        Write-Dbg-Host "Mount path [$global:WIM_Mount_Path] already exists"
    }

    Write-Dbg-Host "Copying [$localMediaPath] --> [$global:Temp_Media_To_Update_Path]"
    try {
        Copy-FilesWithProgress -SourcePath $localMediaPath -DestinationPath $global:Temp_Media_To_Update_Path
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        return $false
    }

    if ($mountResult -ne $null) {
        Write-Dbg-Host "Unmounting [$global:ISO_Mount_Path]"
        try {
            Dismount-DiskImage -ImagePath $global:ISO_Mount_Path -ErrorAction stop | Out-Null
        } catch {
            Write-Host "Failed to dismount ISO [$global:ISO_Mount_Path]" -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
            return $false
        }
    }

    Write-Dbg-Host "Media [$global:Temp_Media_To_Update_Path] ready for update!"

    return $true
}

function Initialize-StagingDirectory {
     param (
         [string] $StagingDir
     )

    # If $StagingDir does not exist, set it to the system %TEMP%\%randomdir% directory
    Write-Host "Initializing staging directory" -ForegroundColor Blue

    if (-not $StagingDir) {
        $global:Staging_Directory_Path = [System.IO.Path]::GetTempPath() + ([System.IO.Path]::GetRandomFileName()).Replace(".", "")
        Write-Dbg-Host "Using default staging directory [$global:Staging_Directory_Path]"
        New-Item -ItemType Directory -Path $global:Staging_Directory_Path -Force | Out-Null
        $global:StagingDir_Created = $true
    } else {
        Write-Dbg-Host "Using provided staging directory [$StagingDir]"

        try {
            $tmpPath = ConvertTo-AbsolutePath -Path $StagingDir
            Write-Dbg-Host "StagingDir [$StagingDir] -> [$tmpPath]"
        }
        catch {
            Write-Host "Staging failure -> Error: $($_.Exception.Message) [$StagingDir]" -ForegroundColor Red
            return $false
        }

        $global:Staging_Directory_Path = $tmpPath

        $driveLetter = (Split-Path -Qualifier $global:Staging_Directory_Path).TrimEnd(':')
        try {
            $fs = (Get-Volume -DriveLetter $driveLetter -ErrorAction Stop).FileSystem
        } catch {
            Write-Host "Drive [$driveLetter`:] does not exist or is not accessible." -ForegroundColor Red
            return $false
        }

        # Make sure the staging directory is on an NTFS formatted file system. This is required for WIM mounting
        # which uses reparse points not fully supported on ReFS or other file systems.
        if ($fs -ne "NTFS") {
            Write-Host "`r`nStagingDir [$global:Staging_Directory_Path] must target an NTFS formatted file system (required for WIM mounting).`r`n" -ForegroundColor Red

            if ($global:StagingDir_Created -eq $true) {
                Write-Dbg-Host "Removing staging directory [$global:Staging_Directory_Path]"
                Remove-Item -Path $global:Staging_Directory_Path -Recurse -Force | Out-Null
                $global:StagingDir_Created = $false
            }
            return $false
        }

        $drive = Get-PSDrive -Name $driveLetter -PSProvider FileSystem
        if ($drive.Free -lt 10GB) {
            Write-Host "Drive [$drive] used for temp file staging does not not have enough free disk space! (10GB required)" -ForegroundColor Red
            Write-Dbg-Host "Drive [$drive] free disk space: $($drive.Free / 1GB)GB"

            if ($global:StagingDir_Created -eq $true) {
                Write-Dbg-Host "Removing staging directory [$global:Staging_Directory_Path]"
                Remove-Item -Path $global:Staging_Directory_Path -Recurse -Force | Out-Null
            }
            return $false
        }

        if (Test-Path -Path "$global:Staging_Directory_Path\") {
            # Provided staging directory already exists, ask the user if they want to overwrite it
            Write-Dbg-Host "Staging directory [$global:Staging_Directory_Path] already exists."
            Write-Dbg-Host "Appending random subfolder to staging directory [$global:Staging_Directory_Path]"
            $global:Staging_Directory_Path = "$global:Staging_Directory_Path\" + ([System.IO.Path]::GetRandomFileName()).Replace(".", "")

            try {
                New-Item -ItemType Directory -Path $global:Staging_Directory_Path -Force | Out-Null
                $global:StagingDir_Created = $true
            } catch {
                Write-Host "Failed to create staging directory [$global:Staging_Directory_Path]" -ForegroundColor Red
                Write-Host $_.Exception.Message -ForegroundColor Red
                return $false
            }
        } else {
            # Provided staging directory does not exist, create it
            try {
                New-Item -ItemType Directory -Path $global:Staging_Directory_Path -Force | Out-Null
                $global:StagingDir_Created = $true
                Write-Dbg-Host "[$global:Staging_Directory_Path] created"
            }
            catch {
                Write-Host "Failed to create staging directory [$global:Staging_Directory_Path]" -ForegroundColor Red
                Write-Host $_.Exception.Message -ForegroundColor Red
                return $false
            }
        }
    }

    return $true
}
function Validate-Parameters {
    param (
        [string] $TargetType,
        [string] $ISOPath,
        [string] $USBDrive,
        [string] $NewMediaPath,
        [string] $FileSystem,
        [string] $StagingDir
     )

    if (-not $TargetType) {
        Write-Host "`r`n-TargetType parameter required`r`n" -ForegroundColor Red
        return $false
    }

    switch ($TargetType) {
        "ISO" {

            if ($NewMediaPath){
                Write-Host "`r`n-NewMediaPath parameter invalid for TargetType ISO.`r`n" -ForegroundColor Red
                return $false
            }

            if ($USBDrive) {
                Write-Host "`r`n-USBDrive parameter invalid for TargetType ISO.`r`n" -ForegroundColor Red
                return $false
            }

            if ($FileSystem) {
                Write-Host "`r`n-FileSystem parameter invalid for TargetType ISO.`r`n" -ForegroundColor Red
                return $false
            }

            if (-not $ISOPath) {
                Write-Host "`r`n-ISOPath parameter required for TargetType ISO.`r`n" -ForegroundColor Red
                return $false
            }

            if (-not ($ISOPath -match "\.iso$")) {
                Write-Host "`r`n-ISOPath must specify a *.ISO file.`r`n" -ForegroundColor Red
                Write-Dbg-Host "Invalid ISOPath [$ISOPath]"
                return $false
            }

            # Normalize ISOPath to an absolute path
            try {
                $script:ISOPath = ConvertTo-AbsolutePath -Path $ISOPath
                Write-Dbg-Host "ISOPath: [$ISOPath] -> [$script:ISOPath]"
                $ISOPath = $script:ISOPath
            } catch {
                Write-Host "Invalid -ISOPath '$ISOPath': $($_.Exception.Message)" -ForegroundColor Red
                return $false
            }

            # if $ISOPath exists, ask the user if they want to overwrite it, otherwise abort
            if (Test-Path -Path $ISOPath) {
                Write-Host "ISO [$ISOPath] already exists. Do you want to overwrite it? (Y/N)" -ForegroundColor Yellow
                $response = Read-Host
                if ($response -ne "Y") {
                    Write-Host "Aborting execution`r`n" -ForegroundColor Red
                    exit
                } else {
                    Write-Dbg-Host "Deleting [$ISOPath]"
                    Remove-Item -Path $ISOPath -Force
                }
            }

            Write-Dbg-Host "ISOPath [$ISOPath]"
        }
        "USB" {

            if ($NewMediaPath){
                Write-Host "`r`n-NewMediaPath parameter invalid for TargetType USB.`r`n" -ForegroundColor Red
                return $false
            }

            if ($ISOPath) {
                Write-Host "`r`n-ISOPath parameter invalid for TargetType USB.`r`n" -ForegroundColor Red
                return $false
            }

            if ($FileSystem -and
                ($FileSystem -ne "FAT32" -and $FileSystem -ne "ExFAT")) {
                Write-Host "`r`n-FileSystem must be FAT32 to boot on most UEFI systems." -ForegroundColor Red
                return $false
            }

            if (-not $USBDrive) {
                Write-Host "`r`n-USBDrive parameter required for TargetType USB.`r`n" -ForegroundColor Red
                return $false
            }

            if (-not ($USBDrive -match "^[a-zA-Z]:$")) {
                Write-Host "`r`n-USBDrive must specify a valid drive letter. ($USBDrive invalid!)`r`n" -ForegroundColor Red
                return $false
            } else {
                Write-Host "`r`nWARNING: Contents on drive [$USBDrive] will be erased! Continue? (Y/N) " -ForegroundColor Yellow
                $response = Read-Host
                if ($response -ne "Y") {
                    Write-Host "Aborting execution`r`n" -ForegroundColor Red
                    exit
                }
                # Make sure the drive can support FAT32 if that is the target/default file system.
                Write-Dbg-Host "Checking drive [$USBDrive] file system"
                if (-not $FileSystem -or $FileSystem -ne "ExFAT") {
                    $partition = Get-Partition -DriveLetter $USBDrive.TrimEnd(':')
                    Write-Dbg-Host "Partition: $partition"
                    Write-Dbg-Host "Partition size: $($partition.Size / 1GB)GB"
                    if ($partition.Size -gt 32GB) {
                        Write-Host "Target drive partition is larger than 32GB and cannot be formatted as FAT32. " -ForegroundColor Red
                        Write-Host "Create a partition smaller than 32GB and try again (or use ExFAT)." -ForegroundColor Red
                        return $false
                    }
                }
            }
        }
        "LOCAL" {

            if ($USBDrive) {
                Write-Host "`r`n-USBDrive parameter invalid for TargetType LOCAL.`r`n" -ForegroundColor Red
                return $false
            }

            if ($ISOPath) {
                Write-Host "`r`n-ISOPath parameter invalid for TargetType LOCAL.`r`n" -ForegroundColor Red
                return $false
            }

            if ($FileSystem) {
                Write-Host "`r`n-FileSystem parameter invalid for TargetType LOCAL.`r`n" -ForegroundColor Red
                return $false
            }

            if (-not $NewMediaPath) {
                Write-Host "`r`n-NewMediaPath parameter required for TargetType LOCAL.`r`n" -ForegroundColor Red
                return $false
            }

            if ($StagingDir) {
                Write-Host "`r`n-StagingDir parameter ignored for TargetType LOCAL.`r`n" -ForegroundColor Yellow
            }

            try {
                $tmpPath = ConvertTo-AbsolutePath -Path $NewMediaPath
                Write-Dbg-Host "NewMediaPath: [$NewMediaPath] -> [$tmpPath]"
            }
            catch {
                Write-Host "-$NewMediaPath' -> Error: $($_.Exception.Message)" -ForegroundColor Red
                return $false
            }

            $driveLetter = (Split-Path -Qualifier $tmpPath).TrimEnd(':')
            try {
                $fs = (Get-Volume -DriveLetter $driveLetter -ErrorAction Stop).FileSystem
            } catch {
                Write-Host "Drive [$driveLetter`:] does not exist or is not accessible." -ForegroundColor Red
                return $false
            }

            # Make sure the target drive is NTFS. This is required for WIM mounting which uses
            # reparse points not fully supported on ReFS or other file systems.
            if ($fs -ne "NTFS") {
                Write-Host "`r`n-NewMediaPath [$tmpPath] must target an NTFS formatted file system (required for WIM mounting).`r`n" -ForegroundColor Red
                return $false
            }

            $drive = Get-PSDrive -Name $driveLetter -PSProvider FileSystem
            if ($drive.Free -lt 10GB) {
                Write-Host "[$tmpPath] does not have enough free space! (10GB required)" -ForegroundColor Red
                Write-Dbg-Host "Drive [$drive] free disk space: $($drive.Free / 1GB)GB"
                return $false
            }
        }
        default {
            Write-Host "Invalid TargetType: $TargetType" -ForegroundColor Red
            return $false
        }
    }

    return $true
}

function ConvertTo-AbsolutePath {
    param(
        [string]$Path,
        [bool] $AllowUNC = $false
        )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "Path cannot be null or empty"
    }

    # Reject UNC paths
    if (-not $AllowUNC) {
        if ($Path -match "^\\\\") {
            throw "Network (UNC) path not allowed"
        }
    }

    $tmpPath = $Path.TrimEnd('\')

    # If a root drive path (C:\), return as-is
    if ($tmpPath -match "^[a-zA-Z]:") {
        return $tmpPath
    }

    # Handle rooted but not fully qualified paths (\rootdir)
    if ($tmpPath -match "^\\[^\\]") {
        # Combine with current drive
        $currentDrive = (Get-Location).Drive.Name + ":"
        return [System.IO.Path]::GetFullPath($currentDrive + $tmpPath)
    }

    # Handle relative paths (.\subdir, ..\parent, subdir)
    if (-not [System.IO.Path]::IsPathRooted($tmpPath)) {
        return [System.IO.Path]::GetFullPath((Join-Path -Path $PWD.Path -ChildPath $tmpPath))
    }

    # For any other case, try to get full path
    return [System.IO.Path]::GetFullPath($tmpPath)
}

function Copy-FilesWithProgress {
    param (
        [string] $SourcePath,
        [string] $DestinationPath
    )

    $files = Get-ChildItem -Path $SourcePath -Recurse -File
    $totalFiles = $files.Count
    $currentFile = 0

    foreach ($file in $files) {
        $currentFile++
        $percentComplete = [math]::Round(($currentFile / $totalFiles) * 100, 2)
        $destinationFile = $file.FullName -replace [regex]::Escape($SourcePath), $DestinationPath

        $destinationDir = [System.IO.Path]::GetDirectoryName($destinationFile)
        if (-not (Test-Path -Path $destinationDir)) {
            New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        }

        # if the file is larger than 5MB, use the Copy-LargeFileWithProgres function
        if ($file.Length -gt 5MB) {
            Copy-LargeFileWithProgres -SourcePath $file.FullName -DestinationPath $destinationFile
            continue
        } else{
            Copy-Item -Path $file.FullName -Destination $destinationFile -Force
        }

        Write-Progress -Activity "Copying files" -Status "copying [$file]" -PercentComplete $percentComplete
    }
    Write-Progress -Activity "Copying files" -Completed
}

function Copy-LargeFileWithProgres {
    param (
        [string] $SourcePath,
        [string] $DestinationPath
    )

    # Define source and destination files
    $sourceFile = $SourcePath
    $destinationFile = $DestinationPath
    $fileName = [System.IO.Path]::GetFileName($sourceFile)

    # Get the total size of the source file
    $totalSize = (Get-Item $sourceFile).Length

    # Open file streams
    $sourceStream = [System.IO.File]::OpenRead($sourceFile)
    $destinationStream = [System.IO.File]::Create($destinationFile)

    # Define buffer size (e.g., 1 MB)
    $bufferSize = 10MB
    $buffer = New-Object byte[] $bufferSize
    $totalRead = 0

    # Copy in chunks
    try {
        while (($bytesRead = $sourceStream.Read($buffer, 0, $bufferSize)) -gt 0) {
            # Write to destination
            $destinationStream.Write($buffer, 0, $bytesRead)

            # Update total read
            $totalRead += $bytesRead

            # Calculate progress
            $percentComplete = [math]::Round(($totalRead / $totalSize) * 100, 2)

            # Display progress
            Write-Progress -Activity "Copying files" -Status "copying [$fileName] $percentComplete% complete" -PercentComplete $percentComplete
        }
        Write-Progress -Activity "Copying file" -Completed
    }
    finally {
        # Close streams
        $sourceStream.Close()
        $destinationStream.Close()
    }
}

function Copy-2023BootBins {

    $bootWimPath = $global:Temp_Media_To_Update_Path + "\sources\boot.wim"
    # Make sure we have a boot.wim file
    if (-not (Test-Path -Path $bootWimPath)) {
        Write-Host "[$global:Src_Media_Path] does not appear to point to valid Windows media!" -ForegroundColor Red
        return $false
    }
    $bootWimMount = $global:WIM_Mount_Path
    Write-Dbg-Host "Mounting [$bootWimPath]"
    Write-Host "Mounting boot.wim from staged media" -ForegroundColor Blue
    try {
        $mountedImage = Mount-WindowsImage -ImagePath $bootWimPath -Index 1 -Path $bootWimMount -ReadOnly -ErrorAction stop | Out-Null
        Write-Dbg-Host "Mounted [$bootWimPath] --> [$bootWimMount]"
    } catch {
        Write-Host "Failed to mount boot.wim of the source media!`r`nMake sure -StagingDir is targeting an NTFS formatted file system (ReFS is not supported for WIM mounting)." -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        return $false
    }

    $ex_bins_path = $bootWimMount + "\Windows\Boot\EFI_EX"
    $ex_fonts_path = $bootWimMount + "\Windows\Boot\FONTS_EX"
    $ex_dvd_path = $bootWimMount + "\Windows\Boot\DVD_EX"

    # Make sure the directories exist
    if (-not (Test-Path -Path $ex_dvd_path) -or
        -not (Test-Path -Path $ex_fonts_path) -or
        -not (Test-Path -Path $ex_bins_path)) {
        Write-Host "-MediaPath [$((Get-Item -Path $global:Src_Media_Path).Name)] does not have required binaries." -ForegroundColor Red
        Write-Host "Make sure all required updates (2024-4B or later) have been applied." -ForegroundColor Red
        Write-Host "[$global:Temp_Media_To_Update_Path] staged but was not updated!" -ForegroundColor Red
        return $false
    }

    Write-Host "Updating staged media to use boot binaries signed with 'Windows UEFI CA 2023' certificate" -ForegroundColor Blue

    try {
        # Special case the architecture specific binary name
        $bootmgr_archver = "bootx64.efi"
        if (Test-Path -Path $global:Temp_Media_To_Update_Path\efi\boot\bootaa64.efi) {
            $bootmgr_archver = "bootaa64.efi" # ARM64
        }

        # Copy $ex_bins_path\bootmgrfw_EX.efi to $global:Temp_Media_To_Update_Path\efi\boot\bootx64.efi
        Write-Dbg-Host "Copying [$ex_bins_path\bootmgfw_EX.efi] to [$global:Temp_Media_To_Update_Path\efi\boot\$bootmgr_archver]"
        Copy-Item -Path $ex_bins_path"\bootmgfw_EX.efi" -Destination $global:Temp_Media_To_Update_Path"\efi\boot\"$bootmgr_archver -Force -ErrorAction stop | Out-Null

        # Copy $ex_bins_path\bootmgr_EX.efi to $global:Temp_Media_To_Update_Path\bootmgr.efi (but only if it exists)
        # Note that this file technically is not signed with the 'Windows UEFI CA 2023' certificate, but if present in the update, it should be copied.
        if ((Test-Path -Path $ex_bins_path"\bootmgr_EX.efi")) {
             # Copy  $ex_bins_path\bootmgr_EX.efi to $global:Temp_Media_To_Update_Path\bootmgr.efi
            Write-Dbg-Host "Copying [$ex_bins_path\bootmgr_EX.efi] to [$global:Temp_Media_To_Update_Path\bootmgr.efi]"
            Copy-Item -Path $ex_bins_path"\bootmgr_EX.efi" -Destination $global:Temp_Media_To_Update_Path"\bootmgr.efi" -Force -ErrorAction stop | Out-Null
        } else {
            Write-Dbg-Host "[$ex_bins_path\bootmgr_EX.efi] does not exist. Skipping."
        }

        # Copy $ex_dvd_path\EFI\en-US\efisys_EX.bin to $global:Temp_Media_To_Update_Path\efi\microsoft\boot\
        Write-Dbg-Host "Copying [$ex_dvd_path\EFI\en-US\efisys_EX.bin] to [$global:Temp_Media_To_Update_Path\efi\microsoft\boot\efisys_ex.bin]"
        Copy-Item -Path $ex_dvd_path"\EFI\en-US\efisys_EX.bin" -Destination $global:Temp_Media_To_Update_Path"\efi\microsoft\boot\efisys_ex.bin" -Force -ErrorAction stop | Out-Null

        # Copy $ex_fonts_path\* to $global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts_ex
        Write-Dbg-Host "Copying [$ex_fonts_path\*] to [$global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts_ex]"
        New-Item -ItemType Directory -Path $global:Temp_Media_To_Update_Path"\efi\microsoft\boot\fonts_ex" -Force | Out-Null
        Copy-Item -Path $ex_fonts_path"\*" -Destination $global:Temp_Media_To_Update_Path"\efi\microsoft\boot\fonts_ex\" -Force -ErrorAction stop | Out-Null

        # Rename $global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts_ex\*_EX.ttf to *.ttf
        Write-Dbg-Host "Renaming [$global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts_ex\*_EX.ttf] to [*.ttf]"
        Get-ChildItem -Path $global:Temp_Media_To_Update_Path"\efi\microsoft\boot\fonts_ex" -Filter "*_EX.ttf" | Rename-Item -NewName { $_.Name -replace '_EX', '' } -Force -ErrorAction stop

        # Copy $global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts_ex\* to $global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts
        Write-Dbg-Host "Copying [$global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts_ex\*] to [$global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts]"
        Copy-Item -Path $global:Temp_Media_To_Update_Path"\efi\microsoft\boot\fonts_ex\*" -Destination $global:Temp_Media_To_Update_Path"\efi\microsoft\boot\fonts" -Force -ErrorAction stop | Out-Null

        # Remove $global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts_ex
        Write-Dbg-Host "Removing [$global:Temp_Media_To_Update_Path\efi\microsoft\boot\fonts_ex]"
        Remove-Item -Path $global:Temp_Media_To_Update_Path"\efi\microsoft\boot\fonts_ex" -Recurse -Force -ErrorAction stop | Out-Null

        # Copy boot.stl from the mounted boot.wim to the staged media if not already present
        $bootStlSource = $bootWimMount + "\Windows\Boot\EFI\boot.stl"
        $bootStlDest = $global:Temp_Media_To_Update_Path + "\EFI\Microsoft\Boot\boot.stl"
        if (-not (Test-Path -Path $bootStlSource)) {
            Write-Dbg-Host "[boot.stl] not found in mounted boot.wim at [$bootStlSource]. Skipping."
        } elseif (Test-Path -Path $bootStlDest) {
            Write-Dbg-Host "[boot.stl] already exists at [$bootStlDest]. Preserving existing file."
        } else {
            Write-Dbg-Host "Copying [$bootStlSource] to [$bootStlDest]"
            Copy-Item -Path $bootStlSource -Destination $bootStlDest -Force -ErrorAction stop | Out-Null
        }

    } catch {
        Write-Host "$_" -ForegroundColor Red
        return $false
    }

    if ($global:WIM_Mount_Path) {
        Write-Dbg-Host "Dismounting [$global:WIM_Mount_Path]"
        try {
            Dismount-WindowsImage -Path $global:WIM_Mount_Path -Discard -ErrorAction stop | Out-Null
            try {
                Write-Dbg-Host "Removing WIM mount path [$global:WIM_Mount_Path]"
                Remove-Item -Path $global:WIM_Mount_Path -Recurse -Force -ErrorAction stop | Out-Null
                $global:WIM_Mount_Path = $null
            } catch {
                Write-Host "Failed to remove WIM mount path [$global:WIM_Mount_Path]" -ForegroundColor Red
                Write-Host $_.Exception.Message -ForegroundColor Red
            }
        } catch {
            Write-Host "Failed to dismount WIM [$global:WIM_Mount_Path]" -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
        }
    }
    return $true
}

function Create-ISOMedia {
    param (
         [string] $ISOPath
     )

     Write-Host "Writing 'Windows UEFI CA 2023' bootable ISO media at location [$ISOPath]" -ForegroundColor Blue

     # If $ISOLabel is not set, then default to "WINDOWS2023PCAISO"
    if (-not $global:ISO_Label) {
        $global:ISO_Label = "WIN2023PCAISO"
    }

    # Generate a timestamp string in the following format: mm/dd/yyyy,hh:mm:ss
    $timestamp = Get-Date -Format "MM/dd/yyyy,HH:mm:ss"

    $runCommand = "-l$global:ISO_Label -t$timestamp -bootdata:2#p0,e,b$global:Temp_Media_To_Update_Path\boot\etfsboot.com#pEF,e,b$global:Temp_Media_To_Update_Path\efi\microsoft\boot\efisys_ex.bin -u2 -udfver102 -o $global:Temp_Media_To_Update_Path `"$($ISOPath)`""

    Write-Dbg-Host "Running [$global:oscdimg_exe $runCommand]"
    try {

        # Extract the directory portion of $ISOPath
        $isoDirPath = Split-Path -Parent $ISOPath

        # Make sure ISO path is valid or the call to oscdimg.exe will fail
        if (-not (Test-Path $isoDirPath)) {
            Write-Dbg-Host "ISOPath [$isoDirPath] not valid. Creating it."
            New-Item -ItemType Directory -Path $isoDirPath -Force | Out-Null
        }

        Write-Dbg-Host "Writing [$ISOPath]"
        Start-Process -FilePath $global:oscdimg_exe -ArgumentList $runCommand -Wait -NoNewWindow -ErrorAction Stop | Out-Null
    } catch {
        Write-Host "Failed to create ISO [$ISOPath]" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        return $false
    }
    return $true
}

function Create-USBMedia {
    param (
         [string] $USBDrive,
         [string] $FileSystem
     )

    Write-Host "Creating 'Windows UEFI CA 2023' bootable USB media on drive [$USBDrive]" -ForegroundColor Blue

    $volume = Get-Volume -DriveLetter $USBDrive.TrimEnd(':')
    $currentLabel = $volume.FileSystemLabel

    if (-not $currentLabel) {
        $currentLabel = "BOOT2023PCA"
    }

    $fileSystem = $FileSystem
    if (-not $FileSystem) {
        $fileSystem = "FAT32"
    }

    # Format the drive using the existing label
    try {
        Write-Dbg-Host "Formatting drive [$USBDrive] as $fileSystem"
        Format-Volume -DriveLetter $USBDrive.TrimEnd(':') -FileSystem $fileSystem -NewFileSystemLabel $currentLabel -Force -ErrorAction stop | Out-Null
    } catch {
        Write-Host "Failed to format drive [$USBDrive] as $fileSystem" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        return $false
    }

    try {
        # If FAT32 and install.wim is larger than 4GB then split it
        if ($fileSystem -eq "FAT32") {
            $installWimPath = $global:Temp_Media_To_Update_Path + "\sources\install.wim"
            if ((Test-Path -Path $installWimPath) -and ((Get-Item -Path $installWimPath).Length -gt 4GB)) {

                Write-Dbg-Host "[$installWimPath] is larger than 4GB, splitting it"
                $installSwmPath = $global:Temp_Media_To_Update_Path + "\sources\install.swm"
                $installSwmSize = 4000
                Write-Host "Updating Media to be FAT32 compatible" -ForegroundColor Blue
                Split-WindowsImage -ImagePath $installWimPath -SplitImagePath $installSwmPath -FileSize $installSwmSize -ErrorAction stop | Out-Null

                # Remove the original install.wim
                Remove-Item -Path $installWimPath -Force -ErrorAction stop | Out-Null
            }
        }

        Write-Dbg-Host "Copying media to USB drive [$USBDrive\]"
        Copy-FilesWithProgress -SourcePath "$global:Temp_Media_To_Update_Path" -DestinationPath "$USBDrive\"
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        return $false
    }

    return $true
}
function Update-LocalMedia {

    # Work here was already done during staging and CopyBins
    Write-Host "Creating 'Windows UEFI CA 2023' bootable local media at location [$global:Temp_Media_To_Update_Path]" -ForegroundColor Blue
    return $true
}

Set-StrictMode -Version Latest

# Global variables
$global:ScriptName = Split-Path -Leaf $PSCommandPath
$global:Src_Media_Path = $null
$global:Staging_Directory_Path = $null
$global:StagingDir_Created = $false
$global:Temp_Media_To_Update_Path = $null
$global:WIM_Mount_Path = $null
$global:ISO_Mount_Path = $null
$global:ISO_Label = $null
$global:oscdimg_exe = $null
$global:oscdimg_known_hashes = @{
    "AMD64" = "ABCD07318EBD8CDBE274B46C9DE78820DCA9709D558CDBC1F5D1730924264D07"
    "ARM64" = "CDAE3649F6A6DE45F50A0B5FB5E2BBC098503B9EEFB1AE6A398FC955B434F579"
    "x86"   = "85AC2DDD96239D037560E5336727F9A8BE2B902734B9DD88264DD7DB5612EFB9"
}
$global:Dbg_Pause = $false
$global:Dbg_Output = $DebugOn

try {
    Write-Host "`r`n`r`nMicrosoft 'Windows UEFI CA 2023' Media Update Script - Version 1.4`r`n" -ForegroundColor DarkYellow

    # First validate that the required tools/environment exist
    $result = Validate-Parameters -TargetType $TargetType -ISOPath $ISOPath -USBDrive $USBDrive -NewMediaPath $NewMediaPath -FileSystem $FileSystem -StagingDir $StagingDir
    if (-not $result) {
        Write-Dbg-Host "Validate-Parameters failed"
        Show-Usage
        exit
    }

    # validate params
    $result = Validate-Requirements -TargetType $TargetType
    if (-not $result) {
        Write-Dbg-Host "Validate-Requirements failed"
        exit
    }

    # Now initialize media path requirements
    $result = Initialize-MediaPaths -MediaPath $MediaPath -NewMediaPath $NewMediaPath -StagingDir $StagingDir
    if (-not $result) {
        Write-Dbg-Host "Initialize-MediaPath failed"
        Execute-Cleanup
        exit
    }

    $result = Copy-2023BootBins
    if (-not $result) {
        Write-Dbg-Host "Copy-2023BootBins failed"
        Execute-Cleanup
        exit
    }

    switch ($TargetType) {
        "ISO" {
            $result = Create-ISOMedia -ISOPath $ISOPath
            if (-not $result) {
                Write-Host "ISO media creation failed" -ForegroundColor Red
            } else {
                if (Test-Path -Path $ISOPath){
                    Write-Host "Successfully created ISO [$ISOPath]" -ForegroundColor Green
                }
            }
        }
        "USB" {
            $result = Create-USBMedia -USBDrive $USBDrive -FileSystem $FileSystem
            if (-not $result) {
                Write-Host "USB media creation failed!" -ForegroundColor Red
                break
            }
            Write-Host "Successfully created media on drive [$USBDrive]" -ForegroundColor Green
            break
        }
        "LOCAL" {

            $result = Update-LocalMedia
            if (-not $result) {
                Write-Host "Local media update failed!" -ForegroundColor Red
                break
            }
            Write-Host "Local media updated successfully at location [$global:Temp_Media_To_Update_Path]" -ForegroundColor Green
            break
        }
        default {
            Write-Host "Invalid TargetType: $TargetType" -ForegroundColor Red
            Show-Usage
            break
        }
    }
}
catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Execute-Cleanup
exit

# SIG # Begin signature block
# MIIllQYJKoZIhvcNAQcCoIIlhjCCJYICAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCD+ZxVimyub9RNg
# jt2EszzfQF/nnKB/U4bZIgTZNBqoRaCCCtkwggT6MIID4qADAgECAhMzAAAFGdrd
# qovcRLKSAAAAAAUZMA0GCSqGSIb3DQEBCwUAMIGEMQswCQYDVQQGEwJVUzETMBEG
# A1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWlj
# cm9zb2Z0IENvcnBvcmF0aW9uMS4wLAYDVQQDEyVNaWNyb3NvZnQgV2luZG93cyBQ
# cm9kdWN0aW9uIFBDQSAyMDExMB4XDTI1MDYxOTE4MTE0NFoXDTI2MDYxNzE4MTE0
# NFowcDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldhc2hpbmd0b24xEDAOBgNVBAcT
# B1JlZG1vbmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjEaMBgGA1UE
# AxMRTWljcm9zb2Z0IFdpbmRvd3MwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
# AoIBAQCZDMq7dDmGKUNA27gASKX04wCVoYWGXif+YkSjXbDCGjDYwgMNz8tke7Sa
# EFHAw+RsHFLu0kuXJPlCUi+NrU6FC1mzGr0CwtDCanbiuS0YRSh0jk46E0yifLgl
# UOM8wlO7u46aBHateelW3IeGVotvGYd0kC61ThrUmkNo5spbbdf2gFPHocVhLmyP
# TbknaEcWdlDg6GiTTLh9atBO4AgAMwYn2C7gnSvjqbFD3o5jxMqt2FzoT98fEW76
# H7b2r2j1p3xnb1YfF2MdT4Y6JJ2WsypuyzFIOjJKb1Sy2/oTYIhZOCHL96Sn2j1r
# wsjJOTiIYjULVNT348tItL5I2IQFAgMBAAGjggF2MIIBcjAfBgNVHSUEGDAWBgor
# BgEEAYI3CgMGBggrBgEFBQcDAzAdBgNVHQ4EFgQUFeA5BFr8G6fQq5LRBOaHXjkh
# u80wRQYDVR0RBD4wPKQ6MDgxHjAcBgNVBAsTFU1pY3Jvc29mdCBDb3Jwb3JhdGlv
# bjEWMBQGA1UEBRMNMjI5ODc5KzUwNTMyNjAfBgNVHSMEGDAWgBSpKQI5jhbEl3jN
# kPmeT5rhfFWvUzBXBgNVHR8EUDBOMEygSqBIhkZodHRwOi8vd3d3Lm1pY3Jvc29m
# dC5jb20vcGtpb3BzL2NybC9NaWNXaW5Qcm9QQ0EyMDExXzIwMTEtMTAtMTkuY3Js
# JTIwMGEGCCsGAQUFBwEBBFUwUzBRBggrBgEFBQcwAoZFaHR0cDovL3d3dy5taWNy
# b3NvZnQuY29tL3BraW9wcy9jZXJ0cy9NaWNXaW5Qcm9QQ0EyMDExXzIwMTEtMTAt
# MTkuY3J0MAwGA1UdEwEB/wQCMAAwDQYJKoZIhvcNAQELBQADggEBAJdoeu54uGlY
# x7NxqBMJABhMXaVJWeLoHLOzWHGm0lD+5w+SSQGlCmdWfnEUX+JSNQfp2bN/zik7
# sgmh4yOCIG8uSp1A0ySh1xobM2+JOAMPTm5NZZZiyo0J3cQgQMDMBPbLQlYARkx0
# m4Ax9gbd2E0zyTRFr3CkYiqqpnEJsrddEOGQE0Zlxw6dXfF9xuNuswFzYrvqmRdI
# BCwLesitK+Rp+JQDnitRIpFWlHR9oLXbPxATwqWH/oLJcmwV6J7gE17V8r5OqAxN
# EJwEJnNj68kdHG6pYKLUk81siK31OULzVfxLxsHpH97xF8QX7gKNcz+PfqiD5vL1
# FAFzznp3K2EwggXXMIIDv6ADAgECAgphB3ZWAAAAAAAIMA0GCSqGSIb3DQEBCwUA
# MIGIMQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMH
# UmVkbW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMTIwMAYDVQQD
# EylNaWNyb3NvZnQgUm9vdCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkgMjAxMDAeFw0x
# MTEwMTkxODQxNDJaFw0yNjEwMTkxODUxNDJaMIGEMQswCQYDVQQGEwJVUzETMBEG
# A1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWlj
# cm9zb2Z0IENvcnBvcmF0aW9uMS4wLAYDVQQDEyVNaWNyb3NvZnQgV2luZG93cyBQ
# cm9kdWN0aW9uIFBDQSAyMDExMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
# AQEA3Qy7ouQuCePnxfeWabwAIb1pMzPvrQTLVIDuBoO7xSCE2ffSi/M4sKukrS18
# YnkF/+NKPwQ1IHDjxOdr4JzANnXpijHdjXDl3De1dEaWKFuHYCMsv9xHpWf3USee
# cusHpsm5HjtTNXzl0+wnuYcc/rnJIwlvqEaRwW6WPEHTy6M/XQJqTexpHyUoXDb/
# /UMVCpTgGbTP38IS4sJbJ+4neDCLWyoJayKJU2AWLMBoHVO67EnznWGMhWgJc0Rd
# faJUK9159xXPNV1sHCtczrycI4tvbrUm2TYTw0/WJ665MjtBkizhx8136KpUTvdc
# CwSHZbRDGKiy4G0Zd+xaJPpIAwIDAQABo4IBQzCCAT8wEAYJKwYBBAGCNxUBBAMC
# AQAwHQYDVR0OBBYEFKkpAjmOFsSXeM2Q+Z5PmuF8Va9TMBkGCSsGAQQBgjcUAgQM
# HgoAUwB1AGIAQwBBMAsGA1UdDwQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB8GA1Ud
# IwQYMBaAFNX2VsuP6KJcYmjRPZSQW9fOmhjEMFYGA1UdHwRPME0wS6BJoEeGRWh0
# dHA6Ly9jcmwubWljcm9zb2Z0LmNvbS9wa2kvY3JsL3Byb2R1Y3RzL01pY1Jvb0Nl
# ckF1dF8yMDEwLTA2LTIzLmNybDBaBggrBgEFBQcBAQROMEwwSgYIKwYBBQUHMAKG
# Pmh0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2kvY2VydHMvTWljUm9vQ2VyQXV0
# XzIwMTAtMDYtMjMuY3J0MA0GCSqGSIb3DQEBCwUAA4ICAQAU/HxxUaV5wm6y7zk+
# vDxSD24rPxATc/6oaNBIpjRNipYFJu4xRpBhedb/OC5Fa/TA5Si42h2PitsJ1xrH
# TAo2ZmqM7BvXBJCoGBekm7niQDI2dsTBWsa/5ATA6hbTrMNo72Ks3VRsUDBYput8
# /pSnTo707HyGc1fCUiFzNFrzo4pWyATaBwnt+IvjzvR+jq7w9guKCPs/yR1yf1O4
# 675j4OM9MWWwgeXyrM0WpJ89qLGbwkLQkIRfVB3/ieq6HUeQb7BzTkGfQJ9f5aEq
# shGRc4ohKPDO3nM5Xz6rXGDs3wMQqNMJ6fT2loW2f1GIZkcZjaKwEj2BKmgFd7uR
# TGJ7tsEHx7p6hzQDDktiepnpyvzOSjfJLaRXfBz+Pdy4D1r61sSzAoUCOuqz2W7k
# aSE33oHR9nUZBWfTk1deKRs5yO4t4c3kRXNb0NLOeqsWGYJGWNBenYGzZ69sNfK8
# 5T8k4jWiCnUG9hhWmdR4LNEFG+vQiAGdqhDxBd+6fixjtwabIyHE+Xhs4lgXBjYr
# kRIDzKTZ8i26+ZSdQO0YRfHOilxrPqsD03AYKgpq4F9H0dVjCjLyr9c2HypwWuVC
# WQhxS1e6foOB8CE89BzBxbmQkw6IRZOG6bEgmb6Yy8WVpF1i1qBjCCC9dRB3fT3z
# Rbmfl5/LV4BvM6kEz3ekYhxZfjGCGhIwghoOAgEBMIGcMIGEMQswCQYDVQQGEwJV
# UzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UE
# ChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMS4wLAYDVQQDEyVNaWNyb3NvZnQgV2lu
# ZG93cyBQcm9kdWN0aW9uIFBDQSAyMDExAhMzAAAFGdrdqovcRLKSAAAAAAUZMA0G
# CWCGSAFlAwQCAQUAoIGwMBkGCSqGSIb3DQEJAzEMBgorBgEEAYI3AgEEMBwGCisG
# AQQBgjcCAQsxDjAMBgorBgEEAYI3AgEVMC8GCSqGSIb3DQEJBDEiBCCJgyOcK6IS
# 6Btoux/fEFsdbD7ufZG3p8Cc9RWtTt9ecDBEBgorBgEEAYI3AgEMMTYwNKAUgBIA
# TQBpAGMAcgBvAHMAbwBmAHShHIAaaHR0cHM6Ly93d3cubWljcm9zb2Z0LmNvbSAw
# DQYJKoZIhvcNAQEBBQAEggEAkuoQ40eGbSXywJA1UmEmzNn4nzqPzl17duZ4mp+G
# rdxcQ2VUKdFWbirWxL4gtxMbQNvda4z4GAHOZGh6FNKvvnzUx2RG6KrBSZXH3IuT
# SXv8F/lcLb60rjv9qLI5Vb1B3xO8APn/DDtlqJAateGAUsccNQRiaUFzo53R0+Jn
# MhL5AmIwarXY0Hg4K8jnQo2cANIWLSuuKleTs0Mw18TI71KS2I4oIY5fxFBXb2Zd
# JYAKe/k43YLHAPsnXdAntRHAH57e/4ikhBFSaKsiirgAWwL6u2QV5/buR+se90en
# eOVCpIa1tKaL2aPoTtUs2akRkVO0z0njGv2hbRdeqX7qqKGCF5MwghePBgorBgEE
# AYI3AwMBMYIXfzCCF3sGCSqGSIb3DQEHAqCCF2wwghdoAgEDMQ8wDQYJYIZIAWUD
# BAIBBQAwggFRBgsqhkiG9w0BCRABBKCCAUAEggE8MIIBOAIBAQYKKwYBBAGEWQoD
# ATAxMA0GCWCGSAFlAwQCAQUABCCkYtXjTekSt8ijMrDnHZVPc05qkI70G0DJeLOr
# MkCMFgIGaaySCVXHGBIyMDI2MDMxNDIxMzAxNS4zNFowBIACAfSggdGkgc4wgcsx
# CzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9uMRAwDgYDVQQHEwdSZWRt
# b25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xJTAjBgNVBAsTHE1p
# Y3Jvc29mdCBBbWVyaWNhIE9wZXJhdGlvbnMxJzAlBgNVBAsTHm5TaGllbGQgVFNT
# IEVTTjo3RjAwLTA1RTAtRDk0NzElMCMGA1UEAxMcTWljcm9zb2Z0IFRpbWUtU3Rh
# bXAgU2VydmljZaCCEeowggcgMIIFCKADAgECAhMzAAACBte8UTiYI+wsAAEAAAIG
# MA0GCSqGSIb3DQEBCwUAMHwxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5n
# dG9uMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9y
# YXRpb24xJjAkBgNVBAMTHU1pY3Jvc29mdCBUaW1lLVN0YW1wIFBDQSAyMDEwMB4X
# DTI1MDEzMDE5NDI1MFoXDTI2MDQyMjE5NDI1MFowgcsxCzAJBgNVBAYTAlVTMRMw
# EQYDVQQIEwpXYXNoaW5ndG9uMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVN
# aWNyb3NvZnQgQ29ycG9yYXRpb24xJTAjBgNVBAsTHE1pY3Jvc29mdCBBbWVyaWNh
# IE9wZXJhdGlvbnMxJzAlBgNVBAsTHm5TaGllbGQgVFNTIEVTTjo3RjAwLTA1RTAt
# RDk0NzElMCMGA1UEAxMcTWljcm9zb2Z0IFRpbWUtU3RhbXAgU2VydmljZTCCAiIw
# DQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAOlEhZsgzdGWvf3tyMdpjHzmXsj5
# lVYYwIEIz3XUGlTr4gZYKqSyqCp59kUSMrM1UNgL1hyAhMDPbvo0aC8QKbhl82/8
# U/BxpIPPvFsNuw6jFvBCgdQ1Guj7Hm5tmFPpYl5T3sXTr68OMDD9i3W9Y6BFOqY/
# 902v2iohsTmgIth0ffAj+ehiawlVzv3rqf4HtQAYBZTax7cvP7F3Gc2w1fgJHrMg
# xUlNJ7M//ZJM1zElO72TayXv+/M6HEmEJDfyt1oSiqEYeteuZWQSFK/5LTQMwlzU
# 4hfGp9vA+MyoRWnsreSZzMKRu6bUE4gnbC4MBsq4l6Wm141mP9Lnw1JDDqSF+4kC
# W6ocreKCRL867Hj2pM/6tT49B424P4a2sKikW5xGZqdC/EhIY2jGcGrdR4NOqmGb
# pojsYwe0UPoM6MmWWUfWBVZc9PKK9/7i03xOY7rIiAHi4/TRsf2Of93LLFKPE9Da
# ca9m2C2qe+reHdNGNGeRz57VcHW5q0NrXNRxLuveKh1OnIBN7aGCRVfebgOFHMjo
# DhInp9skz2KwsfwAYpzKaKwrNi6kB4VJMnXQkQVroyMdBhiiGgIXvtHQILAw2O8T
# hd8se76oo9jwZB+xl2KBD1yVQCLJ0WZW3rWHK2jFk/suZdvOMPRV5zLNmgvgSq7V
# ezMGy6UCvkt3YrBzAgMBAAGjggFJMIIBRTAdBgNVHQ4EFgQU7TCwsp0MalP3tzHc
# jKbKj9IGbhIwHwYDVR0jBBgwFoAUn6cVXQBeYl2D9OXSZacbUzUZ6XIwXwYDVR0f
# BFgwVjBUoFKgUIZOaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jcmwv
# TWljcm9zb2Z0JTIwVGltZS1TdGFtcCUyMFBDQSUyMDIwMTAoMSkuY3JsMGwGCCsG
# AQUFBwEBBGAwXjBcBggrBgEFBQcwAoZQaHR0cDovL3d3dy5taWNyb3NvZnQuY29t
# L3BraW9wcy9jZXJ0cy9NaWNyb3NvZnQlMjBUaW1lLVN0YW1wJTIwUENBJTIwMjAx
# MCgxKS5jcnQwDAYDVR0TAQH/BAIwADAWBgNVHSUBAf8EDDAKBggrBgEFBQcDCDAO
# BgNVHQ8BAf8EBAMCB4AwDQYJKoZIhvcNAQELBQADggIBAHbcZk5971OFNS8Pb2Li
# 3qUOnEmGlVEyZ75RvJmEEUJmGgZO2MN2mEACtTZDrVZiDdhVyXZF0mbk9RtnZsDv
# vOT6q0vEL7d03FWxNx23E8NJJaDAEfFOPqkKagM1eiUBixam8dAUIcOoR8CIHFfV
# 2ZpduJM/V3Rd9++BHp2yFRypof+YV+MNkDEtTWzodxWAK8FAmUnvEQbmMUp22pqk
# pZxtQfBNWpdAZsiUdUKU0nfKpbpndQkf8IVxiItX97ry6tOYa2JnEZJhvhIFI8Ct
# OtNh4c6VAiP/uWhVaZ9ZfbLgAZX8P4zPJkzK8XDhXIvRWCr3oTNArK16JV4FpUSP
# FAqjcBw9QtEXhTPP3w/a0IzldsVndCiP08uDeuAVevSgkSF+Ha2pSuFMl3Xf6Lj9
# 96T3NaJyiyGXBeAW7TTZlYFXMBIQW6oQPjyrK6Vn/aMYkFy1r4V2TaWg/YrehKPg
# 9BB7UzPNVk7nYBc7jYweWGbdIejf9GFD4jUDQ3L724B6GRAfouvGStU29kbh/Q8A
# oxupRxcbvHOconTHQdivlrJYZscplFw5tT7/fhmkv02tc551UNeZJ3bKUpKX+++L
# VDA0mpcmX/6AmRAR62qYcBQVCQW16aLwxRdAbbD9EMddfBYCMT6ogNktD+TjPZnb
# Xq1ZpHpEMocaTB4KgO1C3OQdMIIHcTCCBVmgAwIBAgITMwAAABXF52ueAptJmQAA
# AAAAFTANBgkqhkiG9w0BAQsFADCBiDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldh
# c2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBD
# b3Jwb3JhdGlvbjEyMDAGA1UEAxMpTWljcm9zb2Z0IFJvb3QgQ2VydGlmaWNhdGUg
# QXV0aG9yaXR5IDIwMTAwHhcNMjEwOTMwMTgyMjI1WhcNMzAwOTMwMTgzMjI1WjB8
# MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVk
# bW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSYwJAYDVQQDEx1N
# aWNyb3NvZnQgVGltZS1TdGFtcCBQQ0EgMjAxMDCCAiIwDQYJKoZIhvcNAQEBBQAD
# ggIPADCCAgoCggIBAOThpkzntHIhC3miy9ckeb0O1YLT/e6cBwfSqWxOdcjKNVf2
# AX9sSuDivbk+F2Az/1xPx2b3lVNxWuJ+Slr+uDZnhUYjDLWNE893MsAQGOhgfWpS
# g0S3po5GawcU88V29YZQ3MFEyHFcUTE3oAo4bo3t1w/YJlN8OWECesSq/XJprx2r
# rPY2vjUmZNqYO7oaezOtgFt+jBAcnVL+tuhiJdxqD89d9P6OU8/W7IVWTe/dvI2k
# 45GPsjksUZzpcGkNyjYtcI4xyDUoveO0hyTD4MmPfrVUj9z6BVWYbWg7mka97aSu
# eik3rMvrg0XnRm7KMtXAhjBcTyziYrLNueKNiOSWrAFKu75xqRdbZ2De+JKRHh09
# /SDPc31BmkZ1zcRfNN0Sidb9pSB9fvzZnkXftnIv231fgLrbqn427DZM9ituqBJR
# 6L8FA6PRc6ZNN3SUHDSCD/AQ8rdHGO2n6Jl8P0zbr17C89XYcz1DTsEzOUyOArxC
# aC4Q6oRRRuLRvWoYWmEBc8pnol7XKHYC4jMYctenIPDC+hIK12NvDMk2ZItboKaD
# IV1fMHSRlJTYuVD5C4lh8zYGNRiER9vcG9H9stQcxWv2XFJRXRLbJbqvUAV6bMUR
# HXLvjflSxIUXk8A8FdsaN8cIFRg/eKtFtvUeh17aj54WcmnGrnu3tz5q4i6tAgMB
# AAGjggHdMIIB2TASBgkrBgEEAYI3FQEEBQIDAQABMCMGCSsGAQQBgjcVAgQWBBQq
# p1L+ZMSavoKRPEY1Kc8Q/y8E7jAdBgNVHQ4EFgQUn6cVXQBeYl2D9OXSZacbUzUZ
# 6XIwXAYDVR0gBFUwUzBRBgwrBgEEAYI3TIN9AQEwQTA/BggrBgEFBQcCARYzaHR0
# cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9Eb2NzL1JlcG9zaXRvcnkuaHRt
# MBMGA1UdJQQMMAoGCCsGAQUFBwMIMBkGCSsGAQQBgjcUAgQMHgoAUwB1AGIAQwBB
# MAsGA1UdDwQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB8GA1UdIwQYMBaAFNX2VsuP
# 6KJcYmjRPZSQW9fOmhjEMFYGA1UdHwRPME0wS6BJoEeGRWh0dHA6Ly9jcmwubWlj
# cm9zb2Z0LmNvbS9wa2kvY3JsL3Byb2R1Y3RzL01pY1Jvb0NlckF1dF8yMDEwLTA2
# LTIzLmNybDBaBggrBgEFBQcBAQROMEwwSgYIKwYBBQUHMAKGPmh0dHA6Ly93d3cu
# bWljcm9zb2Z0LmNvbS9wa2kvY2VydHMvTWljUm9vQ2VyQXV0XzIwMTAtMDYtMjMu
# Y3J0MA0GCSqGSIb3DQEBCwUAA4ICAQCdVX38Kq3hLB9nATEkW+Geckv8qW/qXBS2
# Pk5HZHixBpOXPTEztTnXwnE2P9pkbHzQdTltuw8x5MKP+2zRoZQYIu7pZmc6U03d
# mLq2HnjYNi6cqYJWAAOwBb6J6Gngugnue99qb74py27YP0h1AdkY3m2CDPVtI1Tk
# eFN1JFe53Z/zjj3G82jfZfakVqr3lbYoVSfQJL1AoL8ZthISEV09J+BAljis9/kp
# icO8F7BUhUKz/AyeixmJ5/ALaoHCgRlCGVJ1ijbCHcNhcy4sa3tuPywJeBTpkbKp
# W99Jo3QMvOyRgNI95ko+ZjtPu4b6MhrZlvSP9pEB9s7GdP32THJvEKt1MMU0sHrY
# UP4KWN1APMdUbZ1jdEgssU5HLcEUBHG/ZPkkvnNtyo4JvbMBV0lUZNlz138eW0QB
# jloZkWsNn6Qo3GcZKCS6OEuabvshVGtqRRFHqfG3rsjoiV5PndLQTHa1V1QJsWkB
# RH58oWFsc/4Ku+xBZj1p/cvBQUl+fpO+y/g75LcVv7TOPqUxUYS8vwLBgqJ7Fx0V
# iY1w/ue10CgaiQuPNtq6TPmb/wrpNPgkNWcr4A245oyZ1uEi6vAnQj0llOZ0dFtq
# 0Z4+7X6gMTN9vMvpe784cETRkPHIqzqKOghif9lwY1NNje6CbaUFEMFxBmoQtB1V
# M1izoXBm8qGCA00wggI1AgEBMIH5oYHRpIHOMIHLMQswCQYDVQQGEwJVUzETMBEG
# A1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWlj
# cm9zb2Z0IENvcnBvcmF0aW9uMSUwIwYDVQQLExxNaWNyb3NvZnQgQW1lcmljYSBP
# cGVyYXRpb25zMScwJQYDVQQLEx5uU2hpZWxkIFRTUyBFU046N0YwMC0wNUUwLUQ5
# NDcxJTAjBgNVBAMTHE1pY3Jvc29mdCBUaW1lLVN0YW1wIFNlcnZpY2WiIwoBATAH
# BgUrDgMCGgMVAARrR/XXxccz9U12ooGzhBfE2c33oIGDMIGApH4wfDELMAkGA1UE
# BhMCVVMxEzARBgNVBAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAc
# BgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjEmMCQGA1UEAxMdTWljcm9zb2Z0
# IFRpbWUtU3RhbXAgUENBIDIwMTAwDQYJKoZIhvcNAQELBQACBQDtYEnxMCIYDzIw
# MjYwMzE0MjA1NjE3WhgPMjAyNjAzMTUyMDU2MTdaMHQwOgYKKwYBBAGEWQoEATEs
# MCowCgIFAO1gSfECAQAwBwIBAAICP4wwBwIBAAICD8wwCgIFAO1hm3ECAQAwNgYK
# KwYBBAGEWQoEAjEoMCYwDAYKKwYBBAGEWQoDAqAKMAgCAQACAwehIKEKMAgCAQAC
# AwGGoDANBgkqhkiG9w0BAQsFAAOCAQEAe25d8hEzbmrAWzta/qVQX4uBCqf499/Q
# lCHmQFrpkcn+P8mNHoODsVyTJTWUWR3Ar9L+651v9BrykeWWvZ07sgm6lsnVDAN8
# bbHb3/CEzC0RRMer7zpCDtSurffNRRW1xgwbsy5MG3oDXahRlqqcMoypMIpMygcn
# DGJeLY55g8tnAMxa5mB/daEb0ui2jyo/OSRvCekdvveUbUYZAsuwjP2m4svPQKoP
# ociJPIfVitkvZFkW0C9X3KLhFLn6MzZy1ALJ9tmRapTp5ga8mlFnpocktA00FZ2u
# +KctLJE8giCq/CtUbhZuvDFVDHzPGwrQhsZc8mi6pa5xaclxK+vR8DGCBA0wggQJ
# AgEBMIGTMHwxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9uMRAwDgYD
# VQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xJjAk
# BgNVBAMTHU1pY3Jvc29mdCBUaW1lLVN0YW1wIFBDQSAyMDEwAhMzAAACBte8UTiY
# I+wsAAEAAAIGMA0GCWCGSAFlAwQCAQUAoIIBSjAaBgkqhkiG9w0BCQMxDQYLKoZI
# hvcNAQkQAQQwLwYJKoZIhvcNAQkEMSIEIHOXyPfRmT1h+RhG/uD7v4it3HzwDZBu
# 02yarhwg8KjWMIH6BgsqhkiG9w0BCRACLzGB6jCB5zCB5DCBvQQg4Oj1lIiRnp1W
# 0pP4T+5nHZYDLsqJczlHUkg6E0l/S9IwgZgwgYCkfjB8MQswCQYDVQQGEwJVUzET
# MBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMV
# TWljcm9zb2Z0IENvcnBvcmF0aW9uMSYwJAYDVQQDEx1NaWNyb3NvZnQgVGltZS1T
# dGFtcCBQQ0EgMjAxMAITMwAAAgbXvFE4mCPsLAABAAACBjAiBCDOXA2RgXULQgRU
# 4ul7Wep3sN5k7ERISh1IlMnc4ecZCzANBgkqhkiG9w0BAQsFAASCAgARRpI1rRsW
# ullYQ9stoQzVTKmbZXcYGraZEsJakxAmRYtZFlZo0VVu5lao0d/b1wKENu9Ox68T
# GyFEaJ0J58aE8JVY1XEwbBWiOYAxpeH3VvjakPG8OPKvzTjS0dZY3Hi8NE5Ot1TS
# oOd6zXacBHBUutzxqDMTSr+AcIlFyZqEuzAygfgNDzXXJ7whhHhbLnQ6k+JBTcjO
# 2Pu1I1osUbUb4XoLZ5oQzlZgQ2NsdQQ0xFggpzm/juCoxlDRrukPDzy5XJUFI8y4
# E+lx3efzeLqktXF7Uu6+uoFIbUISjklSc73BMCWN2+JSPL+eLuy9cK6QBSIawmmT
# Hg5ab5t1UGY8E5uqZ2vv+QpoyFjBAsLCCsXiNrMm2Y1qz4dn61rf0BbKbU0Pibxn
# LjraXuhsemFsGkH81NmTR+03/ZM+bFL5DBPPki92dywNGdxxyKqRcNTe7bLKkzMo
# 13Mvet+9Bkzna9wNyNqCcVBAzNCDFUuXvuUX418TlqKd732SgsFKwV/9iljblcAB
# B1wLwuNnUWG33CRqvkpTJNrXbQjmR/QjUKByHP2XVZoU6ln6pwk4UlYaE0Hbdv1S
# zqABDxDawgIn+XmVmtYpA/92nP619iZ1+pxm/lGI/HcrsGlmf0ZpnU+bRjw8DTVh
# 2USJUCbMZlF9BXKtQyeWuedos+KNtkG10Q==
# SIG # End signature block
