#
# Perform final cleanup
#

# Remove our working folder
Remove-Item -Path $WORKING_PATH -Recurse -Force -ErrorAction stop | Out-Null

# Dismount ISO images
Write-Output "$(Get-TS): Dismounting ISO images"
Dismount-DiskImage -ImagePath $FOD_ISO_PATH -ErrorAction stop | Out-Null

Write-Output "$(Get-TS): Media refresh completed!"