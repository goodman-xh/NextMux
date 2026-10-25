using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Low-level hooks must run on their installing thread with a message loop;
// callbacks never do IPC, OCR, disk I/O or audio work.
// https://learn.microsoft.com/windows/win32/winmsg/lowlevelkeyboardproc
// https://learn.microsoft.com/windows/win32/winmsg/lowlevelmouseproc
// https://learn.microsoft.com/windows/win32/api/winuser/ns-winuser-kbdllhookstruct
namespace NextMuxServices {
public static class Host {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr h; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public Point point; public uint privateValue; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public uint vk,scan,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public Point point;public uint data,flags,time;public UIntPtr extra; }
    delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id,Hook callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr window,uint min,uint max);
    [DllImport("user32.dll")] static extern bool PeekMessage(out Message message,IntPtr window,uint min,uint max,uint remove);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int count);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    static readonly object Gate=new object(), Output=new object();
    static Dictionary<long,uint> targets=new Dictionary<long,uint>();
    static readonly HashSet<uint> blockedKeys=new HashSet<uint>();
    static readonly HashSet<int> blockedButtons=new HashSet<int>();
    static readonly System.Collections.Concurrent.ConcurrentQueue<string> Events=new System.Collections.Concurrent.ConcurrentQueue<string>();
    static Thread thread,writer;
    static volatile bool ending;
    static uint threadId;
    static IntPtr keyboardHook,mouseHook;
    static Hook keyboard=KeyboardHook,mouse=MouseHook;
    static readonly ManualResetEvent ready=new ManualResetEvent(false);
    static readonly AutoResetEvent hookSync=new AutoResetEvent(false);
    static long lastEvent;
    public static void Write(string json) {lock(Output) {Console.WriteLine(json);Console.Out.Flush();}}
    static bool Target(IntPtr h,out uint pid) {
        h=GetAncestor(h,2); uint actual;
        lock(Gate) { if(!targets.TryGetValue(h.ToInt64(),out pid)) return false; }
        GetWindowThreadProcessId(h,out actual);return actual==pid && IsWindow(h);
    }
    static void Blocked(IntPtr h,uint pid) {
        long now=Environment.TickCount & Int32.MaxValue;
        if(now-lastEvent<200 && now>=lastEvent) return;lastEvent=now;
        Events.Enqueue("{\"type\":\"input-blocked\",\"pid\":"+pid+",\"windowId\":"+GetAncestor(h,2).ToInt64()+"}");
    }
    public static bool PassKeyboard(uint key,bool windowsHeld,bool ctrlAlt) {
        return key==0x5b || key==0x5c || key==0x11 || key==0xa2 || key==0xa3 || key==0x12 || key==0xa4 || key==0xa5 || windowsHeld || key==0x2e && ctrlAlt;
    }
    static IntPtr KeyboardHook(int code,IntPtr message,IntPtr data) {
        if(code<0) return CallNextHookEx(IntPtr.Zero,code,message,data);
        var key=(Keyboard)Marshal.PtrToStructure(data,typeof(Keyboard));
        // Qwen and NextMux input is injected; physical input has neither bit nor marker.
        if((key.flags&0x10)!=0 || key.extra.ToUInt64()==0x4e4d5558) return CallNextHookEx(IntPtr.Zero,code,message,data);
        bool up=(key.flags&0x80)!=0;
        // Pass modifier downs too, so an escape chord is never left incomplete.
        if(PassKeyboard(key.vk, (GetAsyncKeyState(0x5b)&0x8000)!=0 || (GetAsyncKeyState(0x5c)&0x8000)!=0,
            (GetAsyncKeyState(0x11)&0x8000)!=0 && (GetAsyncKeyState(0x12)&0x8000)!=0))
            return CallNextHookEx(IntPtr.Zero,code,message,data);
        if(up) {if(blockedKeys.Remove(key.vk)) return new IntPtr(1);return CallNextHookEx(IntPtr.Zero,code,message,data);}
        uint pid;IntPtr h=GetForegroundWindow();
        if(Target(h,out pid)) {blockedKeys.Add(key.vk);Blocked(h,pid);return new IntPtr(1);}
        return CallNextHookEx(IntPtr.Zero,code,message,data);
    }
    static IntPtr MouseHook(int code,IntPtr message,IntPtr data) {
        if(code<0) return CallNextHookEx(IntPtr.Zero,code,message,data);
        var input=(Mouse)Marshal.PtrToStructure(data,typeof(Mouse));
        if((input.flags&1)!=0 || input.extra.ToUInt64()==0x4e4d5558) return CallNextHookEx(IntPtr.Zero,code,message,data);
        int msg=message.ToInt32(); if(msg==0x200) return CallNextHookEx(IntPtr.Zero,code,message,data);
        int button=msg==0x201||msg==0x202?1:msg==0x204||msg==0x205?2:msg==0x207||msg==0x208?3:msg==0x20b||msg==0x20c?4:0;
        bool up=msg==0x202||msg==0x205||msg==0x208||msg==0x20c;
        if(up) {if(blockedButtons.Remove(button)) return new IntPtr(1);return CallNextHookEx(IntPtr.Zero,code,message,data);}
        uint pid;IntPtr h=WindowFromPoint(input.point);
        if(Target(h,out pid)) {if(button!=0)blockedButtons.Add(button);Blocked(h,pid);return new IntPtr(1);}
        return CallNextHookEx(IntPtr.Zero,code,message,data);
    }
    static void SyncHooksOnThread() {
        bool need;
        lock(Gate) need=targets.Count>0 && !ending;
        if(need) {
            if(keyboardHook==IntPtr.Zero) keyboardHook=SetWindowsHookEx(13,keyboard,GetModuleHandle(null),0);
            if(mouseHook==IntPtr.Zero) mouseHook=SetWindowsHookEx(14,mouse,GetModuleHandle(null),0);
        } else {
            if(keyboardHook!=IntPtr.Zero) { UnhookWindowsHookEx(keyboardHook); keyboardHook=IntPtr.Zero; }
            if(mouseHook!=IntPtr.Zero) { UnhookWindowsHookEx(mouseHook); mouseHook=IntPtr.Zero; }
            blockedKeys.Clear();
            blockedButtons.Clear();
        }
        hookSync.Set();
    }
    public static bool Start() {
        if(thread==null) {
            thread=new Thread(delegate() {
                threadId=GetCurrentThreadId();Message m;PeekMessage(out m,IntPtr.Zero,0,0,0);
                ready.Set();
                try {
                    while(GetMessage(out m,IntPtr.Zero,0,0)>0) {
                        if(m.message==0x8001) SyncHooksOnThread();
                    }
                }
                finally {if(keyboardHook!=IntPtr.Zero)UnhookWindowsHookEx(keyboardHook);if(mouseHook!=IntPtr.Zero)UnhookWindowsHookEx(mouseHook);keyboardHook=mouseHook=IntPtr.Zero;blockedKeys.Clear();blockedButtons.Clear();}
            });thread.IsBackground=true;thread.Start();
            writer=new Thread(delegate() {while(!ending) {string item;while(Events.TryDequeue(out item)) Write(item);Thread.Sleep(50);}});writer.IsBackground=true;writer.Start();
        }
        return ready.WaitOne(5000);
    }
    public static void WatchParent(int parentPid, Action onExit) {
        if(parentPid<=0) return;
        var watcher=new Thread(delegate() {
            while(!ending) {
                try {
                    var p=System.Diagnostics.Process.GetProcessById(parentPid);
                    if(p.HasExited) break;
                } catch { break; }
                Thread.Sleep(500);
            }
            if(!ending) {
                try { if(onExit!=null) onExit(); } catch { }
                try { Stop(); } catch { }
                Environment.Exit(0);
            }
        });
        watcher.IsBackground=true;
        watcher.Start();
    }
    public static void Shield(long[] handles,uint[] pids) {
        if(handles.Length!=pids.Length) throw new Exception("shield_request_invalid");
        var next=new Dictionary<long,uint>();
        for(int i=0;i<handles.Length;i++) {uint actual;GetWindowThreadProcessId(new IntPtr(handles[i]),out actual);if(actual!=pids[i]||!IsWindow(new IntPtr(handles[i]))) throw new Exception("window_not_found");next[handles[i]]=pids[i];}
        lock(Gate) targets=next;
        if(threadId!=0) {
            hookSync.Reset();
            PostThreadMessage(threadId,0x8001,UIntPtr.Zero,IntPtr.Zero);
            hookSync.WaitOne(2000);
            if(handles.Length>0 && (keyboardHook==IntPtr.Zero || mouseHook==IntPtr.Zero)) throw new Exception("lock_unavailable");
        }
    }
    [DllImport("user32.dll",EntryPoint="PostMessageW",SetLastError=true)] static extern bool PostMessage(IntPtr h,uint message,UIntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h,int cmd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h,bool altTab);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk,byte scan,uint flags,UIntPtr extra);

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
    interface IServiceProvider10 {
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object QueryService(ref Guid service, ref Guid riid);
    }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B")]
    interface IVirtualDesktopManager {
        bool IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow);
        Guid GetWindowDesktopId(IntPtr topLevelWindow);
        void MoveWindowToDesktop(IntPtr topLevelWindow, [In, MarshalAs(UnmanagedType.LPStruct)] Guid desktopId);
    }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5")]
    interface IApplicationViewCollection {
        int GetViews(out IntPtr array);
        int GetViewsByZOrder(out IntPtr array);
        int GetViewsByAppUserModelId([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr array);
        [PreserveSig]
        int GetViewForHwnd(IntPtr hwnd, out IntPtr view);
    }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("3F07F4BE-B107-441A-AF0F-39D82529072C")]
    interface IVirtualDesktop26100 {
        bool IsViewVisible(IntPtr view);
        Guid GetId();
    }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("53F5CA0B-158F-4124-900C-057158060B27")]
    interface IVirtualDesktopManagerInternal26100 {
        int GetCount();
        void MoveViewToDesktop(IntPtr view, IVirtualDesktop26100 desktop);
        bool CanViewMoveDesktops(IntPtr view);
        IVirtualDesktop26100 GetCurrentDesktop();
        void GetDesktops(out IntPtr desktops);
        [PreserveSig]
        int GetAdjacentDesktop(IVirtualDesktop26100 from, int direction, out IVirtualDesktop26100 desktop);
        void SwitchDesktop(IVirtualDesktop26100 desktop);
        void SwitchDesktopAndMoveForegroundView(IVirtualDesktop26100 desktop);
        IVirtualDesktop26100 CreateDesktop();
        void MoveDesktop(IVirtualDesktop26100 desktop, int nIndex);
        void RemoveDesktop(IVirtualDesktop26100 desktop, IVirtualDesktop26100 fallback);
        IVirtualDesktop26100 FindDesktop(ref Guid desktopid);
    }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A3175F2D-239C-4BD2-8AA0-EEBA8B0B138E")]
    interface IVirtualDesktopManagerInternal22621 {
        int GetCount();
        void MoveViewToDesktop(IntPtr view, IVirtualDesktop26100 desktop);
        bool CanViewMoveDesktops(IntPtr view);
        IVirtualDesktop26100 GetCurrentDesktop();
        void GetDesktops(out IntPtr desktops);
        [PreserveSig]
        int GetAdjacentDesktop(IVirtualDesktop26100 from, int direction, out IVirtualDesktop26100 desktop);
        void SwitchDesktop(IVirtualDesktop26100 desktop);
        IVirtualDesktop26100 CreateDesktop();
        void MoveDesktop(IVirtualDesktop26100 desktop, int nIndex);
        void RemoveDesktop(IVirtualDesktop26100 desktop, IVirtualDesktop26100 fallback);
        IVirtualDesktop26100 FindDesktop(ref Guid desktopid);
    }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("536D3495-B208-4CC9-AE26-DE8111275BF8")]
    interface IVirtualDesktop22000 {
        bool IsViewVisible(IntPtr view);
        Guid GetId();
    }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("B2F925B9-5A0F-4D2E-9F4D-2B1507593C10")]
    interface IVirtualDesktopManagerInternal22000 {
        int GetCount(IntPtr monitor);
        void MoveViewToDesktop(IntPtr view, IVirtualDesktop22000 desktop);
        bool CanViewMoveDesktops(IntPtr view);
        IVirtualDesktop22000 GetCurrentDesktop(IntPtr monitor);
        void GetDesktops(IntPtr monitor, out IntPtr desktops);
        [PreserveSig]
        int GetAdjacentDesktop(IVirtualDesktop22000 from, int direction, out IVirtualDesktop22000 desktop);
        void SwitchDesktop(IntPtr monitor, IVirtualDesktop22000 desktop);
        IVirtualDesktop22000 CreateDesktop(IntPtr monitor);
        void MoveDesktop(IVirtualDesktop22000 desktop, IntPtr monitor, int nIndex);
        void RemoveDesktop(IVirtualDesktop22000 desktop, IVirtualDesktop22000 fallback);
        IVirtualDesktop22000 FindDesktop(ref Guid desktopid);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("FF72FFDD-BE7E-43FC-9C03-AD81681E88E4")]
    interface IVirtualDesktop10 { bool IsViewVisible(IntPtr view); Guid GetId(); }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("F31574D6-B682-4CDC-BD56-1827860ABEC6")]
    interface IVirtualDesktopManagerInternal10 {
        int GetCount(); void MoveViewToDesktop(IntPtr view, IVirtualDesktop10 desktop); bool CanViewMoveDesktops(IntPtr view);
        IVirtualDesktop10 GetCurrentDesktop(); void GetDesktops(out IntPtr desktops);
        [PreserveSig] int GetAdjacentDesktop(IVirtualDesktop10 from, int direction, out IVirtualDesktop10 desktop);
        void SwitchDesktop(IVirtualDesktop10 desktop); IVirtualDesktop10 CreateDesktop();
        void RemoveDesktop(IVirtualDesktop10 desktop, IVirtualDesktop10 fallback); IVirtualDesktop10 FindDesktop(ref Guid id);
    }
    [ThreadStatic] static IVirtualDesktopManagerInternal10 vdmi10;
    // The IID and vtable both vary. Unknown/preview builds are deliberately unsupported.
    public static string DesktopInterfaceForBuild(int build, int revision) {
        if(build>=10240 && build<=19045) return "win10";
        if(build==22000) return "22000";
        if((build==22621 && revision>=2215) || build==22631) return "22621";
        if((build==26100 && revision>=2605) || build==26200) return "26100";
        return "";
    }
    static string DesktopInterface() {
        try {
            using(var key=Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion")) {
                return DesktopInterfaceForBuild(Int32.Parse(Convert.ToString(key.GetValue("CurrentBuildNumber"))),Convert.ToInt32(key.GetValue("UBR",0)));
            }
        } catch { return ""; }
    }
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr hAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

    static readonly object DesktopGate = new object();
    static readonly Dictionary<string, Guid> groupDesktops = new Dictionary<string, Guid>();
    static readonly Dictionary<long, string> windowGroups = new Dictionary<long, string>();
    static readonly Dictionary<long, Guid> windowOriginalDesktops = new Dictionary<long, Guid>();
    static readonly Dictionary<long, Point> windowOriginalPositions = new Dictionary<long, Point>();
    static int vdSupportState = 0; // 0 = unknown, 1 = supported, -1 = unsupported

    static bool IsChromiumWindow(IntPtr h) {
        if (!IsWindow(h)) return false;
        var cls = new StringBuilder(128);
        if (GetClassName(h, cls, cls.Capacity) <= 0) return false;
        string c = cls.ToString();
        return c.StartsWith("Chrome_", StringComparison.OrdinalIgnoreCase)
            || c.StartsWith("Cef", StringComparison.OrdinalIgnoreCase);
    }

    static bool QueryVirtualDesktopInterfaces(
        out IVirtualDesktopManager vdm,
        out IApplicationViewCollection views,
        out IVirtualDesktopManagerInternal26100 vdmi26100,
        out IVirtualDesktopManagerInternal22621 vdmi22621,
        out IVirtualDesktopManagerInternal22000 vdmi22000
    ) {
        vdm = null; views = null; vdmi26100 = null; vdmi22621 = null; vdmi22000 = null;
        try {
            vdm = (IVirtualDesktopManager)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A")));
            var shell = (IServiceProvider10)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239")));
            var viewSvc = new Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5");
            views = (IApplicationViewCollection)shell.QueryService(ref viewSvc, ref viewSvc);
            var svc = new Guid("C5E0CDCA-7B6E-41B2-9FC4-D93975CC467B");
            string version=DesktopInterface(); vdmi10=null;
            if(version=="26100") {
                var iid=new Guid("53F5CA0B-158F-4124-900C-057158060B27");
                vdmi26100=(IVirtualDesktopManagerInternal26100)shell.QueryService(ref svc,ref iid); return vdmi26100!=null;
            }
            if(version=="22621") {
                var iid=new Guid("A3175F2D-239C-4BD2-8AA0-EEBA8B0B138E");
                vdmi22621=(IVirtualDesktopManagerInternal22621)shell.QueryService(ref svc,ref iid); return vdmi22621!=null;
            }
            if(version=="22000") {
                var iid=new Guid("B2F925B9-5A0F-4D2E-9F4D-2B1507593C10");
                vdmi22000=(IVirtualDesktopManagerInternal22000)shell.QueryService(ref svc,ref iid); return vdmi22000!=null;
            }
            if(version=="win10") {
                var iid=new Guid("F31574D6-B682-4CDC-BD56-1827860ABEC6");
                vdmi10=(IVirtualDesktopManagerInternal10)shell.QueryService(ref svc,ref iid); return vdmi10!=null;
            }
        } catch { }
        return false;
    }

    public static bool CanPark() {
        if (vdSupportState != 0) return vdSupportState > 0;
        lock (DesktopGate) {
            if (vdSupportState != 0) return vdSupportState > 0;
            IVirtualDesktopManager vdm; IApplicationViewCollection views;
            IVirtualDesktopManagerInternal26100 v1; IVirtualDesktopManagerInternal22621 v2; IVirtualDesktopManagerInternal22000 v3;
            bool ok = QueryVirtualDesktopInterfaces(out vdm, out views, out v1, out v2, out v3);
            vdSupportState = ok ? 1 : -1;
            return ok;
        }
    }

    static Guid CurrentDesktopGuid(IVirtualDesktopManagerInternal26100 v1, IVirtualDesktopManagerInternal22621 v2, IVirtualDesktopManagerInternal22000 v3) {
        try {
            if (vdmi10 != null) return vdmi10.GetCurrentDesktop().GetId();
            if (v1 != null) return v1.GetCurrentDesktop().GetId();
            if (v2 != null) return v2.GetCurrentDesktop().GetId();
            if (v3 != null) return v3.GetCurrentDesktop(IntPtr.Zero).GetId();
        } catch { }
        return Guid.Empty;
    }

    static bool DesktopExists(Guid id, IVirtualDesktopManagerInternal26100 v1, IVirtualDesktopManagerInternal22621 v2, IVirtualDesktopManagerInternal22000 v3) {
        if (id == Guid.Empty) return false;
        try {
            if (vdmi10 != null) return vdmi10.FindDesktop(ref id) != null;
            if (v1 != null) return v1.FindDesktop(ref id) != null;
            if (v2 != null) return v2.FindDesktop(ref id) != null;
            if (v3 != null) return v3.FindDesktop(ref id) != null;
        } catch { }
        return false;
    }

    static Guid CreateNamedDesktop(string name, IVirtualDesktopManagerInternal26100 v1, IVirtualDesktopManagerInternal22621 v2, IVirtualDesktopManagerInternal22000 v3) {
        if (vdmi10 != null) return vdmi10.CreateDesktop().GetId();
        if (v1 != null) return v1.CreateDesktop().GetId();
        if (v2 != null) return v2.CreateDesktop().GetId();
        if (v3 != null) return v3.CreateDesktop(IntPtr.Zero).GetId();
        return Guid.Empty;
    }

    static bool MoveViewToDesktopByGuid(IntPtr hwnd, IApplicationViewCollection views, IVirtualDesktopManager vdm, Guid targetId,
        IVirtualDesktopManagerInternal26100 v1, IVirtualDesktopManagerInternal22621 v2, IVirtualDesktopManagerInternal22000 v3) {
        if (targetId == Guid.Empty) return false;
        IntPtr view = IntPtr.Zero;
        try {
            int hr = views.GetViewForHwnd(hwnd, out view);
            if (hr == 0 && view != IntPtr.Zero) {
                if (vdmi10 != null) { var d=vdmi10.FindDesktop(ref targetId); if(d!=null) { vdmi10.MoveViewToDesktop(view,d); return vdm.GetWindowDesktopId(hwnd)==targetId; } }
                if (v1 != null) { var d = v1.FindDesktop(ref targetId); if (d != null) { v1.MoveViewToDesktop(view, d); return vdm.GetWindowDesktopId(hwnd)==targetId; } }
                if (v2 != null) { var d = v2.FindDesktop(ref targetId); if (d != null) { v2.MoveViewToDesktop(view, d); return vdm.GetWindowDesktopId(hwnd)==targetId; } }
                if (v3 != null) { var d = v3.FindDesktop(ref targetId); if (d != null) { v3.MoveViewToDesktop(view, d); return vdm.GetWindowDesktopId(hwnd)==targetId; } }
            }
        } catch { }
        finally {
            if (view != IntPtr.Zero) { try { Marshal.Release(view); } catch { } }
        }
        try {
            vdm.MoveWindowToDesktop(hwnd, targetId);
            return vdm.GetWindowDesktopId(hwnd)==targetId;
        } catch { return false; }
    }

    static void RemoveDesktopByGuid(Guid removeId, Guid fallbackId,
        IVirtualDesktopManagerInternal26100 v1, IVirtualDesktopManagerInternal22621 v2, IVirtualDesktopManagerInternal22000 v3) {
        if (removeId == Guid.Empty) return;
        try {
            if (v1 != null) {
                var target = v1.FindDesktop(ref removeId);
                var fallback = fallbackId != Guid.Empty && fallbackId != removeId ? v1.FindDesktop(ref fallbackId) : v1.GetCurrentDesktop();
                if (fallback == null || fallback.GetId() == removeId) fallback = v1.GetCurrentDesktop();
                if (target != null && fallback != null && target.GetId() != fallback.GetId()) v1.RemoveDesktop(target, fallback);
                return;
            }
            if (v2 != null) {
                var target = v2.FindDesktop(ref removeId);
                var fallback = fallbackId != Guid.Empty && fallbackId != removeId ? v2.FindDesktop(ref fallbackId) : v2.GetCurrentDesktop();
                if (fallback == null || fallback.GetId() == removeId) fallback = v2.GetCurrentDesktop();
                if (target != null && fallback != null && target.GetId() != fallback.GetId()) v2.RemoveDesktop(target, fallback);
                return;
            }
            if (v3 != null) {
                var target = v3.FindDesktop(ref removeId);
                var fallback = fallbackId != Guid.Empty && fallbackId != removeId ? v3.FindDesktop(ref fallbackId) : v3.GetCurrentDesktop(IntPtr.Zero);
                if (fallback == null || fallback.GetId() == removeId) fallback = v3.GetCurrentDesktop(IntPtr.Zero);
                if (target != null && fallback != null && target.GetId() != fallback.GetId()) v3.RemoveDesktop(target, fallback);
            }
        } catch { }
    }

    static bool IsTrayHiddenMainWindow(IntPtr h) {
        if (!IsWindow(h)) return false;
        if ((GetWindowLong(h, -20) & 0x80 /* WS_EX_TOOLWINDOW */) != 0) return false;
        WinRect r;
        if (!GetWindowRect(h, out r) || r.right - r.left < 200 || r.bottom - r.top < 120) return false;
        var cls = new StringBuilder(128); GetClassName(h, cls, cls.Capacity);
        var title = new StringBuilder(256); GetWindowText(h, title, title.Capacity);
        string c = cls.ToString(), t = title.ToString();
        if (t == "no_active_wnd" || string.IsNullOrEmpty(t)) return false;
        return c == "TWINCONTROL" && string.Equals(t, "WeGame", StringComparison.OrdinalIgnoreCase);
    }

    static readonly Dictionary<long,uint> windowProcessIds=new Dictionary<long,uint>();
    static readonly Dictionary<long,long> windowBirths=new Dictionary<long,long>();
    static readonly string DesktopJournal=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"NextMux","parked-windows-v1.txt");
    static long ProcessBirth(uint pid) {
        try { using(var process=System.Diagnostics.Process.GetProcessById((int)pid)) return process.StartTime.ToUniversalTime().Ticks; } catch { return 0; }
    }
    static bool SaveDesktops() {
        try {
            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(DesktopJournal));
            string temporary=DesktopJournal+".tmp";
            using(var file=new System.IO.FileStream(temporary,System.IO.FileMode.Create,System.IO.FileAccess.Write,System.IO.FileShare.None)) {
                using(var writer=new System.IO.StreamWriter(file,new UTF8Encoding(false),1024,true)) {
                    Guid desktop; if(groupDesktops.TryGetValue("NextMux:A",out desktop)) writer.WriteLine("desktop\t"+desktop);
                    foreach(var pair in windowOriginalDesktops) {
                        uint pid; long birth;
                        if(windowProcessIds.TryGetValue(pair.Key,out pid) && windowBirths.TryGetValue(pair.Key,out birth)) writer.WriteLine(pair.Key+"\t"+pid+"\t"+birth+"\t"+pair.Value);
                    }
                    writer.Flush(); file.Flush(true);
                }
            }
            if(System.IO.File.Exists(DesktopJournal)) System.IO.File.Replace(temporary,DesktopJournal,null);
            else System.IO.File.Move(temporary,DesktopJournal);
            return true;
        } catch { return false; }
    }
    static void ForgetDesktopWindow(long window) {
        windowGroups.Remove(window); windowOriginalDesktops.Remove(window); windowProcessIds.Remove(window); windowBirths.Remove(window);
    }
    public static void RecoverDesktops() {
        lock(DesktopGate) {
            try {
                if(!System.IO.File.Exists(DesktopJournal)) return;
                foreach(string line in System.IO.File.ReadAllLines(DesktopJournal)) {
                    string[] fields=line.Split('\t'); Guid desktop;
                    if(fields.Length==2 && fields[0]=="desktop" && Guid.TryParse(fields[1],out desktop)) { groupDesktops["NextMux:A"]=desktop; continue; }
                    long window,birth; uint pid;
                    if(fields.Length!=4 || !Int64.TryParse(fields[0],out window) || !UInt32.TryParse(fields[1],out pid)
                        || !Int64.TryParse(fields[2],out birth) || birth<=0 || !Guid.TryParse(fields[3],out desktop)) continue;
                    if(ProcessBirth(pid)!=birth) continue;
                    uint owner; GetWindowThreadProcessId(new IntPtr(window),out owner); if(owner!=pid) continue;
                    windowOriginalDesktops[window]=desktop; windowProcessIds[window]=pid; windowBirths[window]=birth; windowGroups[window]="NextMux:A";
                }
            } catch { return; }
            RestoreDesktops();
        }
    }
    public static bool ParkWindow(uint pid,long window,string groupKey) {
        lock(DesktopGate) {
            IntPtr h=new IntPtr(window); uint owner; GetWindowThreadProcessId(h,out owner);
            long birth=ProcessBirth(pid); if(!IsWindow(h) || owner!=pid || birth==0) return false;
            IVirtualDesktopManager vdm; IApplicationViewCollection views;
            IVirtualDesktopManagerInternal26100 v1; IVirtualDesktopManagerInternal22621 v2; IVirtualDesktopManagerInternal22000 v3;
            if(!QueryVirtualDesktopInterfaces(out vdm,out views,out v1,out v2,out v3)) return false;
            Guid current=CurrentDesktopGuid(v1,v2,v3), target;
            if(current==Guid.Empty) return false;
            if(!groupDesktops.TryGetValue("NextMux:A",out target) || !DesktopExists(target,v1,v2,v3)) {
                target=CreateNamedDesktop("NextMux",v1,v2,v3); if(target==Guid.Empty) return false;
                groupDesktops["NextMux:A"]=target;
            }
            // The user may visit A themselves; never claim isolation on the current desktop.
            if(target==current) return false;
            if(!windowOriginalDesktops.ContainsKey(window)) {
                Guid original; try { original=vdm.GetWindowDesktopId(h); } catch { return false; }
                if(original==Guid.Empty || original==target) original=current;
                windowOriginalDesktops[window]=original; windowProcessIds[window]=pid; windowBirths[window]=birth;
            }
            if(!SaveDesktops()) return false; // A crash between move and acknowledgement is recoverable.
            windowGroups[window]="NextMux:A";
            if(MoveViewToDesktopByGuid(h,views,vdm,target,v1,v2,v3)) return true;
            UnparkWindow(pid,window,-1,false);
            return false;
        }
    }
    public static bool UnparkWindow(uint pid,long window,long hostWindow,bool activate) {
        lock(DesktopGate) {
            IntPtr h=new IntPtr(window); uint owner; GetWindowThreadProcessId(h,out owner);
            long birth;
            if(!IsWindow(h) || (pid!=0 && owner!=pid) || (windowBirths.TryGetValue(window,out birth) && ProcessBirth(owner)!=birth)) {
                ForgetDesktopWindow(window); SaveDesktops(); return false;
            }
            if(windowOriginalDesktops.ContainsKey(window)) {
                IVirtualDesktopManager vdm; IApplicationViewCollection views;
                IVirtualDesktopManagerInternal26100 v1; IVirtualDesktopManagerInternal22621 v2; IVirtualDesktopManagerInternal22000 v3;
                if(!QueryVirtualDesktopInterfaces(out vdm,out views,out v1,out v2,out v3)) return false;
                Guid target=CurrentDesktopGuid(v1,v2,v3), original;
                if((hostWindow<0 || groupDesktops.ContainsValue(target)) && windowOriginalDesktops.TryGetValue(window,out original)
                    && DesktopExists(original,v1,v2,v3)) target=original;
                if(target==Guid.Empty || groupDesktops.ContainsValue(target) || !MoveViewToDesktopByGuid(h,views,vdm,target,v1,v2,v3)) return false;
                ForgetDesktopWindow(window); SaveDesktops();
            }
            if(activate) { if(IsIconic(h)) ShowWindowAsync(h,9); SetForegroundWindow(h); }
            return true;
        }
    }
    public static void RestoreDesktops() {
        lock(DesktopGate) {
            foreach(var pair in new List<KeyValuePair<long,uint>>(windowProcessIds)) UnparkWindow(pair.Value,pair.Key,0,false);
            // Keep the reusable desktop A. Never remove a desktop that may contain windows the user moved there.
            SaveDesktops();
        }
    }

    public static bool CloseWindow(uint pid,long window) {
        IntPtr h=new IntPtr(window);uint actual;GetWindowThreadProcessId(h,out actual);
        return IsWindow(h) && actual==pid && PostMessage(h,0x10,UIntPtr.Zero,IntPtr.Zero);
    }
    public static string WindowReason(uint pid,long window) {
        IntPtr h=new IntPtr(window);uint actual;GetWindowThreadProcessId(h,out actual);
        if(!IsWindow(h)||actual!=pid) return "window_not_found";
        if(!IsWindowVisible(h) && !IsTrayHiddenMainWindow(h)) {
            lock(DesktopGate) { if(!windowGroups.ContainsKey(window)) return "window_not_found"; }
        }
        if(IsIconic(h)) return "window_minimized";
        if(CanPark()) return "ok";
        var name=new StringBuilder(256);GetClassName(h,name,name.Capacity);
        return name.ToString()=="ApplicationFrameWindow" || name.ToString()=="Windows.UI.Core.CoreWindow" ? "background_input_unsupported" : "foreground_input_required";
    }
    delegate bool EnumProc(IntPtr h,IntPtr l);
    [StructLayout(LayoutKind.Sequential)] struct WinRect { public int left,top,right,bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out WinRect r);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h,int index);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder text,int count);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h,IntPtr hdc,uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out int value,int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out WinRect value,int size);
    static IntPtr EnterPhysicalDpi() {
        try {
            IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
            return previous!=IntPtr.Zero ? previous : SetThreadDpiAwarenessContext(new IntPtr(-3));
        } catch { return IntPtr.Zero; }
    }
    public static Dictionary<string,object> CaptureWindow(uint pid,long window,int maxSize,string path) {
        IntPtr previousDpi=EnterPhysicalDpi();
        try {
            IntPtr h=new IntPtr(window); uint actual; GetWindowThreadProcessId(h,out actual);
            if(!IsWindow(h)||actual!=pid) return new Dictionary<string,object>{{"ok",false},{"error","window_not_found"}};
            if(IsIconic(h)) return new Dictionary<string,object>{{"ok",false},{"error","window_minimized"}};
            if(!IsWindowVisible(h) && IsTrayHiddenMainWindow(h)) {
                string grp = null;
                lock(DesktopGate) { windowGroups.TryGetValue(window, out grp); }
                if(grp != null) ParkWindow(pid, window, grp);
                else { try { ShowWindowAsync(h, 8 /* SW_SHOWNA */); Thread.Sleep(40); } catch { } }
            }
            WinRect r; int hr=-1;
            try { hr=DwmGetWindowAttribute(h,9 /* DWMWA_EXTENDED_FRAME_BOUNDS */,out r,Marshal.SizeOf(typeof(WinRect))); } catch { hr=-1; r=new WinRect(); }
            if(hr!=0||r.right<=r.left||r.bottom<=r.top) {
                if(!GetWindowRect(h,out r)||r.right<=r.left||r.bottom<=r.top) return new Dictionary<string,object>{{"ok",false},{"error","window_not_capturable"}};
            }
            int srcW=Math.Max(1,r.right-r.left), srcH=Math.Max(1,r.bottom-r.top);
            WinRect full; if(!GetWindowRect(h,out full)||full.right<=full.left||full.bottom<=full.top) full=r;
            int fullW=Math.Max(srcW,full.right-full.left), fullH=Math.Max(srcH,full.bottom-full.top);
            int limit=Math.Max(160,Math.Min(2048,maxSize>0?maxSize:1280));
            double scale=Math.Min(1.0,(double)limit/Math.Max(srcW,srcH));
            int dstW=Math.Max(1,(int)Math.Round(srcW*scale)), dstH=Math.Max(1,(int)Math.Round(srcH*scale));
            using(var raw=new System.Drawing.Bitmap(fullW,fullH,System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
                bool printed=false;
                using(var g=System.Drawing.Graphics.FromImage(raw)) {
                    IntPtr hdc=g.GetHdc();
                    try { printed=PrintWindow(h,hdc,2 /* PW_RENDERFULLCONTENT */)||PrintWindow(h,hdc,0); }
                    finally { g.ReleaseHdc(hdc); }
                    // The screen region shows this window only when it is in front; otherwise it would be another
                    // window's pixels (another conversation's app, or NextMux itself), so never copy it then.
                    if(!printed&&GetAncestor(GetForegroundWindow(),2)==h) {
                        try { g.CopyFromScreen(full.left,full.top,0,0,new System.Drawing.Size(fullW,fullH)); printed=true; } catch { }
                    }
                }
                if(!printed) return new Dictionary<string,object>{{"ok",false},{"error","window_not_capturable"}};
                int cropX=Math.Max(0,Math.Min(fullW-1,r.left-full.left)), cropY=Math.Max(0,Math.Min(fullH-1,r.top-full.top));
                int cropW=Math.Max(1,Math.Min(fullW-cropX,srcW)), cropH=Math.Max(1,Math.Min(fullH-cropY,srcH));
                using(var dst=new System.Drawing.Bitmap(dstW,dstH,System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
                    using(var dg=System.Drawing.Graphics.FromImage(dst)) {
                        dg.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        dg.DrawImage(raw,new System.Drawing.Rectangle(0,0,dstW,dstH),new System.Drawing.Rectangle(cropX,cropY,cropW,cropH),System.Drawing.GraphicsUnit.Pixel);
                    }
                    if(!string.IsNullOrEmpty(path)) {
                        var bits=dst.LockBits(new System.Drawing.Rectangle(0,0,dstW,dstH),System.Drawing.Imaging.ImageLockMode.ReadOnly,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                        try {
                            int stride=Math.Abs(bits.Stride);
                            byte[] bytes=new byte[stride*dstH];
                            Marshal.Copy(bits.Scan0,bytes,0,bytes.Length);
                            System.IO.File.WriteAllBytes(path,bytes);
                            return new Dictionary<string,object>{{"ok",true},{"width",dstW},{"height",dstH},{"stride",stride}};
                        } finally { dst.UnlockBits(bits); }
                    }
                    using(var ms=new System.IO.MemoryStream()) {
                        System.Drawing.Imaging.ImageCodecInfo codec=null;
                        foreach(var info in System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders()) if(info.MimeType=="image/jpeg") { codec=info; break; }
                        if(codec!=null) {
                            using(var ep=new System.Drawing.Imaging.EncoderParameters(1)) {
                                ep.Param[0]=new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality,82L);
                                dst.Save(ms,codec,ep);
                            }
                        } else dst.Save(ms,System.Drawing.Imaging.ImageFormat.Jpeg);
                        return new Dictionary<string,object>{{"ok",true},{"mimeType","image/jpeg"},{"data",Convert.ToBase64String(ms.ToArray())},{"width",dstW},{"height",dstH}};
                    }
                }
            }
        } catch {
            return new Dictionary<string,object>{{"ok",false},{"error","window_not_capturable"}};
        } finally {
            if(previousDpi!=IntPtr.Zero) { try { SetThreadDpiAwarenessContext(previousDpi); } catch { } }
        }
    }
    public static byte[] PrepareOcrCrop(byte[] frameBytes, int frameWidth, int frameHeight, int stride, int x, int y, int width, int height, int maxDim, out int outWidth, out int outHeight, out int singleHeight, out int gapHeight) {
        int limit = Math.Max(2048, maxDim);
        int scale = 1;
        if (Math.Min(width, height) < 320 && width * 3 <= limit && height * 6 + 16 <= limit) scale = 3;
        else if (Math.Min(width, height) < 480 && width * 2 <= limit && height * 4 + 16 <= limit) scale = 2;
        if (scale == 1) {
            outWidth = width; outHeight = height; singleHeight = height; gapHeight = 0;
            byte[] raw = new byte[width * height * 4];
            for (int row = 0; row < height; row++) {
                Buffer.BlockCopy(frameBytes, (y + row) * stride + x * 4, raw, row * width * 4, width * 4);
            }
            return raw;
        }
        int sw = width * scale, sh = height * scale, gap = 16;
        outWidth = sw; singleHeight = sh; gapHeight = gap; outHeight = sh * 2 + gap;
        using (var src = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
            var sbd = src.LockBits(new System.Drawing.Rectangle(0, 0, width, height), System.Drawing.Imaging.ImageLockMode.WriteOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            try {
                int sStride = Math.Abs(sbd.Stride);
                for (int row = 0; row < height; row++) {
                    Marshal.Copy(frameBytes, (y + row) * stride + x * 4, new IntPtr(sbd.Scan0.ToInt64() + row * sStride), width * 4);
                }
            } finally { src.UnlockBits(sbd); }
            using (var dst = new System.Drawing.Bitmap(sw, outHeight, System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
                using (var g = System.Drawing.Graphics.FromImage(dst)) {
                    g.Clear(System.Drawing.Color.Black);
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.DrawImage(src, new System.Drawing.Rectangle(0, 0, sw, sh), new System.Drawing.Rectangle(0, 0, width, height), System.Drawing.GraphicsUnit.Pixel);
                    using (var ia = new System.Drawing.Imaging.ImageAttributes()) {
                        var cm = new System.Drawing.Imaging.ColorMatrix();
                        cm.Matrix00 = 2.2f; cm.Matrix11 = 2.2f; cm.Matrix22 = 2.2f;
                        cm.Matrix40 = -0.22f; cm.Matrix41 = -0.22f; cm.Matrix42 = -0.22f;
                        ia.SetColorMatrix(cm);
                        g.DrawImage(src, new System.Drawing.Rectangle(0, sh + gap, sw, sh), 0, 0, width, height, System.Drawing.GraphicsUnit.Pixel, ia);
                    }
                }
                var dbd = dst.LockBits(new System.Drawing.Rectangle(0, 0, sw, outHeight), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                try {
                    byte[] result = new byte[sw * outHeight * 4];
                    int dStride = Math.Abs(dbd.Stride);
                    if (dStride == sw * 4) {
                        Marshal.Copy(dbd.Scan0, result, 0, result.Length);
                    } else {
                        for (int row = 0; row < outHeight; row++) {
                            Marshal.Copy(new IntPtr(dbd.Scan0.ToInt64() + row * dStride), result, row * sw * 4, sw * 4);
                        }
                    }
                    return result;
                } finally { dst.UnlockBits(dbd); }
            }
        }
    }
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder text,ref uint size);
    static string ImagePath(uint pid) {
        IntPtr process=OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */,false,pid);
        if(process==IntPtr.Zero) return "";
        try { var text=new StringBuilder(1024); uint size=(uint)text.Capacity; return QueryFullProcessImageName(process,0,text,ref size) ? text.ToString() : ""; }
        finally { CloseHandle(process); }
    }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ProcessEntry {
        public uint Size,Usage,ProcessId; public IntPtr DefaultHeap; public uint ModuleId,Threads,ParentProcessId; public int PriorityBase; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string ExeFile;
    }
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint processId);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot,ref ProcessEntry entry);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot,ref ProcessEntry entry);
    static Dictionary<uint,uint> Parents() {
        var parents=new Dictionary<uint,uint>();
        IntPtr snapshot=CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */,0);
        if(snapshot==new IntPtr(-1)) return parents;
        try {
            var entry=new ProcessEntry { Size=(uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            for(bool more=Process32FirstW(snapshot,ref entry);more;more=Process32NextW(snapshot,ref entry)) parents[entry.ProcessId]=entry.ParentProcessId;
        } finally { CloseHandle(snapshot); }
        return parents;
    }
    /// <summary>Visible, uncloaked (or NextMux-parked), unowned top-level app windows of at least 200×120, with their process image path and
    /// the image paths of up to six live ancestor processes (a launcher that started the window's program).</summary>
    public static object[] TopWindows() {
        var rows=new List<object>(); var paths=new Dictionary<uint,string>(); var parents=Parents();
        Func<uint,string> pathOf=id=>{ string value; if(!paths.TryGetValue(id,out value)) { value=ImagePath(id); paths[id]=value; } return value; };
        EnumWindows((h,l)=>{
            IntPtr owner=GetWindow(h,4 /* GW_OWNER */);
            bool visible=IsWindowVisible(h);
            if((!visible && !IsTrayHiddenMainWindow(h)) || (owner!=IntPtr.Zero && IsWindowVisible(owner))) return true;
            if((GetWindowLong(h,-20) & 0x80 /* WS_EX_TOOLWINDOW */)!=0) return true;
            int cloaked=0; try { DwmGetWindowAttribute(h,14,out cloaked,4); } catch { }
            if(cloaked!=0) {
                bool isParked=false;
                if(cloaked==2) {
                    lock(DesktopGate) { isParked=windowGroups.ContainsKey(h.ToInt64()); }
                }
                if(!isParked) return true;
            }
            WinRect r; if(!GetWindowRect(h,out r) || r.right-r.left<200 || r.bottom-r.top<120) return true;
            var title=new StringBuilder(256); GetWindowText(h,title,title.Capacity);
            string titleStr=title.ToString();
            if(titleStr=="no_active_wnd") return true;
            uint pid; GetWindowThreadProcessId(h,out pid); if(pid==0) return true;
            string path=pathOf(pid);
            var ancestors=new List<string>(); var ancestorPids=new List<uint>(); uint current=pid, parent;
            long childBirth=ProcessBirth(pid);
            for(int depth=0;depth<6 && parents.TryGetValue(current,out parent) && parent!=0 && parent!=current;depth++) {
                long parentBirth=ProcessBirth(parent);
                if(childBirth==0 || parentBirth==0 || parentBirth>childBirth) break; // A recycled parent PID is not ancestry.
                string above=pathOf(parent); if(above.Length==0) break;
                ancestors.Add(above); ancestorPids.Add(parent); current=parent; childBirth=parentBirth;
            }
            rows.Add(new Dictionary<string,object>{{"pid",pid},{"windowId",h.ToInt64()},{"title",titleStr},{"width",r.right-r.left},{"height",r.bottom-r.top},{"executable",path},{"ancestors",ancestors.ToArray()},{"ancestorPids",ancestorPids.ToArray()}});
            return true;
        },IntPtr.Zero);
        return rows.ToArray();
    }
    public static void Stop() {
        RestoreDesktops();
        lock(Gate) targets.Clear();ending=true;
        if(threadId!=0)PostThreadMessage(threadId,0x12,UIntPtr.Zero,IntPtr.Zero);
        if(thread!=null)thread.Join(2000);if(writer!=null)writer.Join(1000);
    }
}
}
