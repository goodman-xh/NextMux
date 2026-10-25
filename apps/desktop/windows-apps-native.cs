using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// EnumChildWindows sees the app process behind an ApplicationFrameHost frame.
// Keep the top-level owner PID for HWND validation, and the app PID separately.
// https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumchildwindows
// https://learn.microsoft.com/windows/win32/api/appmodel/nf-appmodel-getapplicationusermodelid
// https://learn.microsoft.com/windows/win32/api/appmodel/nf-appmodel-getpackagefamilyname
public static class NextMuxAppWindows {
    public sealed class Identity {
        public uint pid;
        public string executable = "";
        public string appId = "";
        public string packageFamilyName = "";
    }
    public sealed class AppWindow {
        public long windowId;
        public uint pid;
        public string title;
        public int width;
        public int height;
        public bool minimized;
        public List<Identity> processes = new List<Identity>();
    }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    delegate bool Enumerate(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(Enumerate callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Enumerate callback, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr process, ref uint size, StringBuilder name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetPackageFamilyName(IntPtr process, ref uint size, StringBuilder name);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    static Identity Identify(uint pid) {
        var info = new Identity { pid = pid };
        IntPtr process = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (process == IntPtr.Zero) return info;
        try {
            uint size = 32768;
            var text = new StringBuilder((int)size);
            if (QueryFullProcessImageName(process, 0, text, ref size)) info.executable = text.ToString();
            size = 1024; text = new StringBuilder((int)size);
            if (GetApplicationUserModelId(process, ref size, text) == 0) info.appId = text.ToString();
            size = 1024; text = new StringBuilder((int)size);
            if (GetPackageFamilyName(process, ref size, text) == 0) info.packageFamilyName = text.ToString();
        } finally { CloseHandle(process); }
        return info;
    }
    // A tray/background app may have no eligible HWND. Reuse exact executable/AUMID identity for reopening checks.
    public static Identity[] ProcessSnapshot() {
        var result = new List<Identity>();
        int currentSession;
        using (var current = System.Diagnostics.Process.GetCurrentProcess()) { currentSession = current.SessionId; }
        foreach (var process in System.Diagnostics.Process.GetProcesses()) {
            try {
                if (process.SessionId != currentSession) continue;
                var identity = Identify((uint)process.Id);
                if (identity.executable.Length > 0 || identity.appId.Length > 0) result.Add(identity);
            } catch (InvalidOperationException) { /* Process exited during enumeration. */ }
            catch (System.ComponentModel.Win32Exception) { /* Another user's or protected process is not ours to reopen. */ }
            finally { process.Dispose(); }
        }
        return result.ToArray();
    }
    public static AppWindow[] Snapshot() {
        var result = new List<AppWindow>();
        var identities = new Dictionary<uint, Identity>();
        EnumWindows(delegate(IntPtr window, IntPtr unused) {
            if ((GetWindowLong(window, -20) & 0x80 /* WS_EX_TOOLWINDOW */) != 0) return true;
            Rect rect;
            if (!GetWindowRect(window, out rect)) return true;
            bool minimized = IsIconic(window);
            if (!minimized && (rect.right - rect.left < 80 || rect.bottom - rect.top < 80)) return true;
            var text = new StringBuilder(512); GetWindowText(window, text, text.Capacity);
            string title = text.ToString();
            if (title == "no_active_wnd") return true;
            bool visible = IsWindowVisible(window);
            if (!visible) {
                var cls = new StringBuilder(128); GetClassName(window, cls, cls.Capacity);
                if (cls.ToString() != "TWINCONTROL" || !string.Equals(title, "WeGame", StringComparison.OrdinalIgnoreCase) || rect.right - rect.left < 200) return true;
            } else {
                int cloaked = 0; try { DwmGetWindowAttribute(window, 14, out cloaked, 4); } catch { }
                if (cloaked == 1) return true;
            }
            uint owner; GetWindowThreadProcessId(window, out owner);
            var row = new AppWindow { windowId = window.ToInt64(), pid = owner, title = title,
                width = rect.right - rect.left, height = rect.bottom - rect.top, minimized = minimized };
            var pids = new HashSet<uint>(); pids.Add(owner);
            EnumChildWindows(window, delegate(IntPtr child, IntPtr ignored) {
                uint childPid; GetWindowThreadProcessId(child, out childPid); pids.Add(childPid); return true;
            }, IntPtr.Zero);
            foreach (uint pid in pids) {
                if (!identities.ContainsKey(pid)) identities[pid] = Identify(pid);
                row.processes.Add(identities[pid]);
            }
            result.Add(row); return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}
