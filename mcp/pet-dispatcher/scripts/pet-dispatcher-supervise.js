// Resident Pet Dispatcher supervisor (JScript, run by wscript.exe //B from the HKCU Run key).
// Replaces the resident PowerShell 5.1 launcher with a much lighter wscript process.
// wscript has no console, and Run(..., 0) starts children with SW_HIDE from the first frame,
// so nothing flashes at logon. PowerShell is one-shot only: start-worker.ps1 decrypts the DPAPI
// secrets, starts node and exits.
//
// Singleton: the lock file stays open for the life of this process. Scripting.FileSystemObject
// opens without FILE_SHARE_DELETE, so DeleteFile fails (error 70) while another supervisor holds
// it; a stale lock from a dead process deletes fine. Residual race: two supervisors started in
// the same few milliseconds on a missing lock file can both win.
//
// Worker liveness: state\worker.pid (written by start-worker.ps1) checked through WMI. The pid
// file survives reboots, so a match needs more than a node.exe: the command line must be
// "<installed release>\index.js remote" under this install root. A worker that is already
// running is adopted, so restarting only the supervisor does not bounce it.
var POLL_MS = 10000;      // worker liveness check
var RETRY_MS = 60000;     // wait after start-worker.ps1 failed (missing manifest mid-install etc.)
var MIN_LIFE_MS = 60000;  // a worker dying sooner than this is crash-looping: back off by RETRY_MS

var shell = new ActiveXObject("WScript.Shell");
var fso = new ActiveXObject("Scripting.FileSystemObject");
var binRoot = fso.GetParentFolderName(WScript.ScriptFullName);
var root = fso.GetParentFolderName(binRoot);
var stateRoot = root + "\\state";
var logRoot = root + "\\logs";
var pidPath = stateRoot + "\\worker.pid";
var lockPath = stateRoot + "\\supervisor.lock";
var releaseMarker = (root + "\\app\\releases\\").toLowerCase();
var starter = binRoot + "\\pet-dispatcher-start-worker.ps1";
var powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
var lockHandle = null;
var wmi = null;

function envNumber(name, fallback) {
  var n = parseInt(shell.Environment("Process")(name), 10);
  return n > 0 ? n : fallback;
}
POLL_MS = envNumber("PET_DISPATCHER_SUPERVISOR_POLL_MS", POLL_MS);
RETRY_MS = envNumber("PET_DISPATCHER_SUPERVISOR_RETRY_MS", RETRY_MS);
MIN_LIFE_MS = envNumber("PET_DISPATCHER_SUPERVISOR_MIN_LIFE_MS", MIN_LIFE_MS);

function pad(n) { return (n < 10 ? "0" : "") + n; }

function log(message) {
  try {
    var d = new Date();
    var day = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    var time = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    var file = fso.OpenTextFile(logRoot + "\\supervisor-" + day + ".log", 8, true);
    file.WriteLine(time + " " + message);
    file.Close();
  } catch (e) {}
}

function ensureFolder(path) {
  if (!fso.FolderExists(path)) fso.CreateFolder(path);
}

function acquireLock() {
  try {
    fso.DeleteFile(lockPath, true);
  } catch (e) {
    // 53 = file not found (fine); anything else (70 = held by a live supervisor) = not ours.
    if ((e.number & 0xFFFF) !== 53) return false;
  }
  try {
    lockHandle = fso.OpenTextFile(lockPath, 8, true);
    return true;
  } catch (e2) {
    return false;
  }
}

function workerPid() {
  try {
    if (!fso.FileExists(pidPath)) return 0;
    var file = fso.OpenTextFile(pidPath, 1);
    var text = file.ReadAll();
    file.Close();
    var n = parseInt(text, 10);
    return n > 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

// True when pid is the installed node worker ("...\app\releases\...\index.js remote").
// On a WMI failure answers true: not knowing is no reason to start a second worker.
function isWorker(pid) {
  try {
    if (!wmi) wmi = GetObject("winmgmts:{impersonationLevel=impersonate}!\\\\.\\root\\cimv2");
    var rows = wmi.ExecQuery("SELECT Name, CommandLine FROM Win32_Process WHERE ProcessId=" + pid);
    for (var it = new Enumerator(rows); !it.atEnd(); it.moveNext()) {
      var row = it.item();
      var commandLine = String(row.CommandLine || "");
      return String(row.Name).toLowerCase() === "node.exe" &&
        commandLine.toLowerCase().indexOf(releaseMarker) >= 0 &&
        /index\.js"?\s+remote\s*$/i.test(commandLine);
    }
    return false;
  } catch (e) {
    wmi = null;
    log("WMI check failed: " + e.message);
    return true;
  }
}

function startWorker() {
  var command = '"' + powershell + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + starter + '" -Root "' + root + '"';
  return shell.Run(command, 0, true);
}

try { ensureFolder(stateRoot); ensureFolder(logRoot); } catch (e) { WScript.Quit(1); }
if (!acquireLock()) WScript.Quit(0);
log("supervisor up");

var startedAt = 0;  // 0 = worker adopted from before this supervisor started
while (true) {
  var pid = workerPid();
  if (pid && isWorker(pid)) {
    WScript.Sleep(POLL_MS);
    continue;
  }
  if (pid) log("worker pid " + pid + " is gone");
  if (startedAt && new Date().getTime() - startedAt < MIN_LIFE_MS) {
    log("worker died within " + Math.round((new Date().getTime() - startedAt) / 1000) + " s, backing off");
    WScript.Sleep(RETRY_MS);
  }
  var code = startWorker();
  if (code !== 0) {
    log("start-worker failed, exit " + code + " (details in the start-worker line above)");
    WScript.Sleep(RETRY_MS);
    continue;
  }
  startedAt = new Date().getTime();
  log("worker started, pid " + workerPid());
  WScript.Sleep(POLL_MS);
}
