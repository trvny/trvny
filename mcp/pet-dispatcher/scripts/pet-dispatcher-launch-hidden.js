// Windowless logon entry point for pet-dispatcher-launch.ps1 (JScript, run by wscript.exe //B).
// powershell.exe -WindowStyle Hidden as the Run command still flashes a console: the window
// is created visible and only hidden afterwards. wscript has no console, and Run(..., 0)
// creates powershell with SW_HIDE from the start.
var fso = new ActiveXObject("Scripting.FileSystemObject");
var shell = new ActiveXObject("WScript.Shell");
var binRoot = fso.GetParentFolderName(WScript.ScriptFullName);
var powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
var launcher = binRoot + "\\pet-dispatcher-launch.ps1";
shell.Run('"' + powershell + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + launcher + '"', 0, false);
