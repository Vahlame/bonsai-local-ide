param(
    [Parameter(Mandatory = $true)][Alias("Pid")][int]$ProcessId,
    [ValidateSet("normal", "above", "high")][string]$Cpu = "above"
)
$ErrorActionPreference = "Stop"
$code = @'
using System;
using System.Runtime.InteropServices;
public static class BonsaiProc {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetPriorityClass(IntPtr h, uint cls);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetProcessInformation(IntPtr h, int cls, IntPtr info, int len);
  [StructLayout(LayoutKind.Sequential)]
  public struct MEMORY_PRIORITY_INFORMATION { public uint MemoryPriority; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POWER_THROTTLING_STATE { public uint Version; public uint ControlMask; public uint StateMask; }
  public static string Apply(int pid, uint cpuClass) {
    IntPtr h = OpenProcess(0x0200 | 0x0400, false, pid); // SET_INFORMATION | QUERY_INFORMATION
    if (h == IntPtr.Zero) return "OpenProcess=" + Marshal.GetLastWin32Error();
    string res = "";
    if (!SetPriorityClass(h, cpuClass)) res += "prio=" + Marshal.GetLastWin32Error() + " ";
    var m = new MEMORY_PRIORITY_INFORMATION { MemoryPriority = 5 };
    IntPtr pm = Marshal.AllocHGlobal(Marshal.SizeOf(m));
    Marshal.StructureToPtr(m, pm, false);
    if (!SetProcessInformation(h, 0, pm, Marshal.SizeOf(m))) res += "mem=" + Marshal.GetLastWin32Error() + " ";
    Marshal.FreeHGlobal(pm);
    // EcoQoS: ExecutionSpeed control activo con StateMask=0 => sin limitación.
    var p = new POWER_THROTTLING_STATE { Version = 1, ControlMask = 1, StateMask = 0 };
    IntPtr pp = Marshal.AllocHGlobal(Marshal.SizeOf(p));
    Marshal.StructureToPtr(p, pp, false);
    if (!SetProcessInformation(h, 4, pp, Marshal.SizeOf(p))) res += "eco=" + Marshal.GetLastWin32Error() + " ";
    Marshal.FreeHGlobal(pp);
    CloseHandle(h);
    return res.Trim();
  }
}
'@
Add-Type -TypeDefinition $code
$clase = @{ normal = 0x0020; above = 0x8000; high = 0x0080 }[$Cpu]
$r = [BonsaiProc]::Apply($ProcessId, [uint32]$clase)
if ($r) { Write-Host "aviso: $r" } else { Write-Host "proceso $ProcessId optimizado (CPU $Cpu, memoria 5, sin EcoQoS)" }
