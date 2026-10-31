param([switch]$PurgeStandby)
$ErrorActionPreference = "Stop"
if (-not $PurgeStandby) { Write-Host "nada que hacer"; exit 0 }
$code = @'
using System;
using System.Runtime.InteropServices;
public static class BonsaiCache {
  [DllImport("ntdll.dll")]
  public static extern int NtSetSystemInformation(int InfoClass, IntPtr Info, int Length);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out long lpLuid);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, int BufferLength, IntPtr PreviousState, IntPtr ReturnLength);
  [DllImport("kernel32.dll")]
  public static extern IntPtr GetCurrentProcess();
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct TOKEN_PRIVILEGES { public int PrivilegeCount; public long Luid; public int Attributes; }
  public static bool EnableProfilePrivilege() {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, out token)) return false;
    long luid;
    if (!LookupPrivilegeValue(null, "SeProfileSingleProcessPrivilege", out luid)) return false;
    TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
    tp.PrivilegeCount = 1; tp.Luid = luid; tp.Attributes = 0x00000002;
    return AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
  }
  public static int Purge() {
    if (!EnableProfilePrivilege()) return -1;
    IntPtr p = Marshal.AllocHGlobal(4);
    Marshal.WriteInt32(p, 4); // MemoryPurgeStandbyList
    int r = NtSetSystemInformation(0x50, p, 4); // SystemMemoryListInformation
    Marshal.FreeHGlobal(p);
    return r;
  }
}
'@
Add-Type -TypeDefinition $code
$r = [BonsaiCache]::Purge()
if ($r -ne 0) { throw "No se pudo purgar la standby list (NTSTATUS $r)" }
Write-Host "standby list purgada"
