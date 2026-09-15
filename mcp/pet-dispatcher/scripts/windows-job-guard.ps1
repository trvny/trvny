param([int]$WatchdogIntervalMs = 250)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public sealed class PetJobSnapshot {
    public long peakMemoryBytes;
    public uint activeProcesses;
    public string killReason;
}

public static class PetJobGuard {
    const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint PROCESS_TERMINATE = 0x0001;
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObjectW(IntPtr securityAttributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    sealed class State {
        public readonly object Gate = new object();
        public IntPtr Handle;
        public long MemoryLimit;
        public long Peak;
        public string Reason;
    }

    static readonly ConcurrentDictionary<string, State> Jobs = new ConcurrentDictionary<string, State>();
    static Timer Monitor;

    public static void Configure(int intervalMs) {
        if (intervalMs < 100) intervalMs = 100;
        Monitor = new Timer(_ => Tick(), null, intervalMs, intervalMs);
    }

    static void Tick() {
        foreach (var pair in Jobs) {
            var state = pair.Value;
            lock (state.Gate) {
                if (state.Handle == IntPtr.Zero) continue;
                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                if (!QueryInformationJobObject(state.Handle, 9, ref info, (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>(), IntPtr.Zero)) continue;
                long peak = unchecked((long)info.PeakJobMemoryUsed.ToUInt64());
                if (peak > state.Peak) state.Peak = peak;
                if (state.MemoryLimit > 0 && peak >= state.MemoryLimit * 9 / 10 && state.Reason == null) {
                    state.Reason = "memory_limit";
                    TerminateJobObject(state.Handle, 137);
                }
            }
        }
    }

    public static PetJobSnapshot Attach(string id, int pid, long memoryBytes, uint processLimit) {
        if (Jobs.ContainsKey(id)) throw new InvalidOperationException("job id already exists");
        var handle = CreateJobObjectW(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObjectW");
        try {
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            limits.BasicLimitInformation.ActiveProcessLimit = processLimit;
            limits.JobMemoryLimit = new UIntPtr(unchecked((ulong)memoryBytes));
            if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject");
            var process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess");
            try {
                if (!AssignProcessToJobObject(handle, process)) throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject");
            } finally { CloseHandle(process); }
            var state = new State { Handle = handle, MemoryLimit = memoryBytes };
            if (!Jobs.TryAdd(id, state)) throw new InvalidOperationException("failed to register job");
            return Snapshot(state);
        } catch {
            CloseHandle(handle);
            throw;
        }
    }

    public static PetJobSnapshot Kill(string id, string reason) {
        State state;
        if (!Jobs.TryGetValue(id, out state)) return null;
        lock (state.Gate) {
            if (state.Reason == null) state.Reason = String.IsNullOrWhiteSpace(reason) ? "cancelled" : reason;
            if (state.Handle != IntPtr.Zero) TerminateJobObject(state.Handle, 137);
            return Snapshot(state);
        }
    }

    public static PetJobSnapshot SnapshotById(string id) {
        State state;
        return Jobs.TryGetValue(id, out state) ? Snapshot(state) : null;
    }

    static PetJobSnapshot Snapshot(State state) {
        lock (state.Gate) {
            uint active = 0;
            if (state.Handle != IntPtr.Zero) {
                var extended = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                if (QueryInformationJobObject(state.Handle, 9, ref extended, (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>(), IntPtr.Zero)) {
                    long peak = unchecked((long)extended.PeakJobMemoryUsed.ToUInt64());
                    if (peak > state.Peak) state.Peak = peak;
                }
                var accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
                if (QueryInformationJobObject(state.Handle, 1, ref accounting, (uint)Marshal.SizeOf<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>(), IntPtr.Zero)) active = accounting.ActiveProcesses;
            }
            return new PetJobSnapshot { peakMemoryBytes = state.Peak, activeProcesses = active, killReason = state.Reason };
        }
    }

    public static PetJobSnapshot Release(string id) {
        State state;
        if (!Jobs.TryRemove(id, out state)) return null;
        lock (state.Gate) {
            var snapshot = Snapshot(state);
            var handle = state.Handle;
            state.Handle = IntPtr.Zero;
            if (handle != IntPtr.Zero) CloseHandle(handle);
            return snapshot;
        }
    }

    public static void CloseAll() {
        Monitor?.Dispose();
        foreach (var id in Jobs.Keys) {
            State state;
            if (!Jobs.TryRemove(id, out state)) continue;
            lock (state.Gate) {
                var handle = state.Handle;
                state.Handle = IntPtr.Zero;
                if (handle != IntPtr.Zero) CloseHandle(handle);
            }
        }
    }
}
'@

[PetJobGuard]::Configure($WatchdogIntervalMs)
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

try {
    while (($line = [Console]::In.ReadLine()) -ne $null) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $request = $line | ConvertFrom-Json
            $result = switch ($request.op) {
                'attach' { [PetJobGuard]::Attach([string]$request.jobId, [int]$request.pid, [long]$request.memoryBytes, [uint32]$request.processLimit) }
                'kill' { [PetJobGuard]::Kill([string]$request.jobId, [string]$request.reason) }
                'stats' { [PetJobGuard]::SnapshotById([string]$request.jobId) }
                'release' { [PetJobGuard]::Release([string]$request.jobId) }
                default { throw "unknown guard operation: $($request.op)" }
            }
            [Console]::Out.WriteLine((@{ id = [string]$request.id; ok = $true; result = $result } | ConvertTo-Json -Compress -Depth 5))
        } catch {
            [Console]::Out.WriteLine((@{ id = [string]$request.id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
        }
        [Console]::Out.Flush()
    }
} finally {
    [PetJobGuard]::CloseAll()
}
