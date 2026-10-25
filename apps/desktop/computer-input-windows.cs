using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

// SendInput is subject to UIPI and dispatches into the foreground input stream.
// https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-sendinput
// https://learn.microsoft.com/windows/win32/api/winuser/ns-winuser-keybdinput
// https://learn.microsoft.com/windows/win32/api/winuser/ns-winuser-mouseinput
namespace NextMuxInput {
public static class Host {
    const uint Marker = 0x4e4d5558;
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union value; }
    [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo {
        public int cbSize, flags;
        public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
        public Rect rcCaret;
    }
    struct FocusEntry { public uint pid; public IntPtr child; public uint rootThread, childThread; public string childClass; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, uint attribute, out Rect r, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern uint MapVirtualKeyEx(uint key, uint type, IntPtr layout);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint idThread, ref GuiThreadInfo lpgui);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
    // Background input: messages posted straight to the window under the point, never through the foreground
    // input stream, so tabs of different conversations take clicks and text at the same time without moving the
    // user's cursor or focus. https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-postmessagew
    // The Unicode entry point: through PostMessageA a UTF-16 WM_CHAR (Chinese, emoji halves) is read as DBCS bytes and garbled.
    [DllImport("user32.dll", EntryPoint="PostMessageW", SetLastError=true)] static extern bool PostMessage(IntPtr h, uint message, UIntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr parent, Point point, uint flags);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref Point point);
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
    [DllImport("user32.dll")] static extern bool PhysicalToLogicalPointForPerMonitorDPI(IntPtr h, ref Point point);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] static extern IntPtr GetClassLongPtr64(IntPtr h, int index);
    [DllImport("user32.dll", EntryPoint="GetClassLongW")] static extern uint GetClassLong32(IntPtr h, int index);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    delegate bool ChildProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, ChildProc callback, IntPtr l);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool fAltTab);
    static readonly Dictionary<long, FocusEntry> FocusByRoot = new Dictionary<long, FocusEntry>();
    static readonly HashSet<long> ActiveTextInputByRoot = new HashSet<long>();
    static Point lastMovePoint;
    static bool haveMovePoint;
    /// <summary>Bring a window forward again (or unlock foreground transition between concurrent conversation tabs).</summary>
    static void Activate(IntPtr h) {
        if(h==IntPtr.Zero || !IsWindow(h) || GetAncestor(GetForegroundWindow(),2)==h) return;
        try { Send(Key(0x12,0,2)); } catch { }
        uint fgOwner, targetOwner;
        uint fgThread=GetWindowThreadProcessId(GetForegroundWindow(),out fgOwner);
        uint targetThread=GetWindowThreadProcessId(h,out targetOwner);
        uint curThread=GetCurrentThreadId();
        bool attachedFg=fgThread!=0 && fgThread!=curThread && AttachThreadInput(curThread,fgThread,true);
        bool attachedTarget=targetThread!=0 && targetThread!=curThread && targetThread!=fgThread && AttachThreadInput(curThread,targetThread,true);
        try {
            if(IsIconic(h)) ShowWindow(h,9); else ShowWindow(h,5);
            BringWindowToTop(h);
            SetForegroundWindow(h);
            if(GetAncestor(GetForegroundWindow(),2)!=h) SwitchToThisWindow(h,true);
        }
        finally {
            if(attachedTarget) AttachThreadInput(curThread,targetThread,false);
            if(attachedFg) AttachThreadInput(curThread,fgThread,false);
        }
    }
    static void RememberFocus(IntPtr h, uint pid, uint rootThread) {
        if(!haveMovePoint || h==IntPtr.Zero || !IsWindow(h)) return;
        try {
            IntPtr hit=WindowFromPoint(lastMovePoint);
            uint hitOwner=0, hitThread=hit!=IntPtr.Zero ? GetWindowThreadProcessId(hit,out hitOwner) : 0;
            var gui=new GuiThreadInfo { cbSize=Marshal.SizeOf(typeof(GuiThreadInfo)) };
            IntPtr focus=IntPtr.Zero;
            if(hitThread!=0 && GetGUIThreadInfo(hitThread,ref gui) && gui.hwndFocus!=IntPtr.Zero) focus=gui.hwndFocus;
            else if(rootThread!=0 && GetGUIThreadInfo(rootThread,ref gui) && gui.hwndFocus!=IntPtr.Zero) focus=gui.hwndFocus;
            if(focus==IntPtr.Zero) focus=hit;
            if(focus!=IntPtr.Zero && IsWindow(focus) && (focus==h || GetAncestor(focus,2)==h)) {
                lock(FocusByRoot) FocusByRoot[h.ToInt64()]=new FocusEntry { pid=pid, child=focus };
            }
        } catch { }
    }
    static void RestoreChildFocus(IntPtr h, uint pid, ref uint thread) {
        if(h==IntPtr.Zero || !IsWindow(h)) return;
        try {
            IntPtr child=IntPtr.Zero;
            FocusEntry entry;
            lock(FocusByRoot) if(FocusByRoot.TryGetValue(h.ToInt64(),out entry)) {
                if(entry.pid==pid && entry.child!=IntPtr.Zero && IsWindow(entry.child) && (entry.child==h || GetAncestor(entry.child,2)==h)) {
                    child=entry.child;
                } else {
                    FocusByRoot.Remove(h.ToInt64());
                }
            }
            if(child==IntPtr.Zero) {
                var gui=new GuiThreadInfo { cbSize=Marshal.SizeOf(typeof(GuiThreadInfo)) };
                if(thread!=0 && GetGUIThreadInfo(thread,ref gui) && gui.hwndFocus!=IntPtr.Zero && gui.hwndFocus!=h && GetAncestor(gui.hwndFocus,2)==h) {
                    child=gui.hwndFocus;
                } else {
                    Rect r;
                    if(VisibleRect(h,out r) && r.right>r.left && r.bottom>r.top) {
                        IntPtr center=WindowFromPoint(new Point{x=(r.left+r.right)/2,y=(r.top+r.bottom)/2});
                        if(center!=IntPtr.Zero && center!=h && IsWindow(center) && GetAncestor(center,2)==h) child=center;
                    }
                }
            }
            if(child!=IntPtr.Zero && child!=h) {
                uint childOwner=0, childThread=GetWindowThreadProcessId(child,out childOwner);
                uint curThread=GetCurrentThreadId();
                bool attachedChild=childThread!=0 && childThread!=curThread && AttachThreadInput(curThread,childThread,true);
                bool attachedRoot=thread!=0 && thread!=curThread && thread!=childThread && AttachThreadInput(curThread,thread,true);
                try { SetFocus(child); }
                finally {
                    if(attachedRoot) AttachThreadInput(curThread,thread,false);
                    if(attachedChild) AttachThreadInput(curThread,childThread,false);
                }
                if(childThread!=0) thread=childThread;
            }
        } catch { }
    }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object Output = new object();
    static readonly ManualResetEvent Cancel = new ManualResetEvent(false);
    static Thread worker;
    sealed class PostedWork { public Thread thread; public ManualResetEvent cancel = new ManualResetEvent(false); }
    static readonly Dictionary<long, PostedWork> Posted = new Dictionary<long, PostedWork>();
    [ThreadStatic] static ManualResetEvent postedCancel;
    static void DrainPosted() {
        PostedWork[] pending;
        lock(Posted) { pending=new List<PostedWork>(Posted.Values).ToArray(); foreach(var item in pending) item.cancel.Set(); }
        foreach(var item in pending) item.thread.Join();
    }
    static long active;
    static void Emit(object value) { lock(Output) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); } }
    static long Number(Dictionary<string, object> value, string key, long fallback=0) { return value.ContainsKey(key) ? Convert.ToInt64(value[key]) : fallback; }
    static double Decimal(Dictionary<string, object> value, string key) { return Convert.ToDouble(value[key]); }
    static string Text(Dictionary<string, object> value, string key, string fallback="") { return value.ContainsKey(key) ? Convert.ToString(value[key]) : fallback; }
    static void Check(IntPtr h, uint pid) {
        if(Cancel.WaitOne(0)) throw new Exception("cancelled");
        uint owner; GetWindowThreadProcessId(h, out owner);
        if(!IsWindow(h) || owner != pid) throw new Exception("window_not_found");
        if(GetAncestor(GetForegroundWindow(), 2) != h) throw new Exception("computer_foreground_changed");
    }
    static void Pause(int milliseconds, IntPtr h, uint pid) {
        for(int remaining=milliseconds; remaining>0; remaining-=10) {
            if(Cancel.WaitOne(Math.Min(10,remaining))) throw new Exception("cancelled"); Check(h,pid);
        }
    }
    static Input Key(ushort vk, ushort scan, uint flags) { return new Input {type=1, value=new Union {keyboard=new Keyboard {vk=vk,scan=scan,flags=flags,extra=new UIntPtr(Marker)}}}; }
    static Input MouseInput(uint flags, uint data=0, int x=0, int y=0) { return new Input {type=0,value=new Union {mouse=new Mouse {flags=flags,data=data,x=x,y=y,extra=new UIntPtr(Marker)}}}; }
    static void Send(Input input) { if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input))) != 1) throw new Exception("computer_input_injection_failed"); }
    static Input Release(Dictionary<string, object> data) {
        return Number(data,"type")==1 ? Key((ushort)Number(data,"vk"),(ushort)Number(data,"scan"),(uint)Number(data,"flags")|2)
            : MouseInput((uint)Number(data,"flags"));
    }
    static Dictionary<string, object> Record(Input up) {
        return up.type==1 ? new Dictionary<string,object>{{"type",1},{"vk",up.value.keyboard.vk},{"scan",up.value.keyboard.scan},{"flags",up.value.keyboard.flags}}
            : new Dictionary<string,object>{{"type",0},{"flags",up.value.mouse.flags}};
    }
    static ushort Vk(string name) {
        name=name.ToLowerInvariant();
        if(name.Length==1 && name[0]>='a' && name[0]<='z') return (ushort)Char.ToUpperInvariant(name[0]);
        if(name.Length==1 && name[0]>='0' && name[0]<='9') return (ushort)name[0];
        int function; if(name.StartsWith("f") && Int32.TryParse(name.Substring(1),out function) && function>=1 && function<=24) return (ushort)(111+function);
        switch(name) {
            case "ctrl": case "control": return 0x11; case "shift": return 0x10; case "alt": case "option": return 0x12;
            case "cmd": case "command": case "win": case "meta": return 0x5b;
            case "leftctrl": case "leftcontrol": case "lctrl": case "lcontrol": return 0xa2;
            case "rightctrl": case "rightcontrol": case "rctrl": case "rcontrol": return 0xa3;
            case "leftshift": case "lshift": return 0xa0; case "rightshift": case "rshift": return 0xa1;
            case "leftalt": case "leftoption": case "lalt": return 0xa4; case "rightalt": case "rightoption": case "ralt": return 0xa5;
            case "leftcmd": case "leftcommand": case "leftmeta": case "leftwin": case "lwin": return 0x5b;
            case "rightcmd": case "rightcommand": case "rightmeta": case "rightwin": case "rwin": return 0x5c;
            case "enter": case "return": return 13; case "escape": case "esc": return 27; case "tab": return 9;
            case "space": case " ": return 32; case "backspace": return 8; case "delete": case "del": return 46;
            case "left": case "arrowleft": return 37; case "up": case "arrowup": return 38; case "right": case "arrowright": return 39; case "down": case "arrowdown": return 40;
            case "home": return 36; case "end": return 35; case "pageup": return 33; case "pagedown": return 34; case "insert": return 45;
            case "capslock": return 20; case "numlock": return 144; case "scrolllock": return 145;
            case "-": return 189; case "=": return 187; case "[": return 219; case "]": return 221; case "\\": return 220;
            case ";": return 186; case "'": return 222; case ",": return 188; case ".": return 190; case "/": return 191; case "`": return 192;
            default: throw new Exception("computer_key_unsupported");
        }
    }
    static Input Physical(ushort vk, IntPtr layout, bool up) {
        uint scan=MapVirtualKeyEx(vk,4,layout);
        uint flags=8u | (up?2u:0u) | ((scan & 0xff00)!=0?1u:0u);
        return scan==0 ? Key(vk,0,up?2u:0u) : Key(0,(ushort)(scan & 255),flags);
    }
    static IntPtr PhysicalDpi() {
        // Each Execute runs on a new worker. A process-wide system-DPI setting
        // does not prevent coordinate virtualization on mixed-DPI monitors.
        // https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext
        try {
            IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2
            return previous!=IntPtr.Zero ? previous : SetThreadDpiAwarenessContext(new IntPtr(-3));
        } catch(EntryPointNotFoundException) {return IntPtr.Zero;}
        catch(DllNotFoundException) {return IntPtr.Zero;}
    }
    static bool VisibleRect(IntPtr h, out Rect r) {
        // Window captures omit the invisible resize frame. DWM returns those
        // visible bounds in physical pixels, unlike DPI-virtualized GetWindowRect.
        // https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-getwindowrect
        try { if(DwmGetWindowAttribute(h,9,out r,Marshal.SizeOf(typeof(Rect)))==0 && r.right>r.left && r.bottom>r.top) return true; }
        catch(EntryPointNotFoundException) { }
        catch(DllNotFoundException) { }
        return GetWindowRect(h,out r);
    }
    static void Move(IntPtr h, uint pid, double x, double y, bool normalized) {
        Check(h,pid); Rect r;
        if(!(normalized ? VisibleRect(h,out r) : GetWindowRect(h,out r)) || r.right<=r.left || r.bottom<=r.top) throw new Exception("window_not_found");
        // Fractions are always evaluated against the current physical window,
        // including every drag step, so a resized tab never reuses stale bounds.
        if(normalized) {x*=r.right-r.left;y*=r.bottom-r.top;}
        int px=r.left+(int)Math.Min(Math.Max(0,x),r.right-r.left-1), py=r.top+(int)Math.Min(Math.Max(0,y),r.bottom-r.top-1);
        int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
        if(width<2 || height<2 || px<left || py<top || px>=left+width || py>=top+height) throw new Exception("computer_pointer_offscreen");
        lastMovePoint=new Point{x=px,y=py}; haveMovePoint=true;
        try { SetCursorPos(px,py); } catch { }
        Send(MouseInput(0x8000|0x4000|1,0,(int)((px-left)*65535L/(width-1)),(int)((py-top)*65535L/(height-1))));
        if(IsGameWindow(h)) Send(MouseInput(1,0,0,0));
    }
    static void Execute(Dictionary<string,object> request) {
        long id=Number(request,"id"); string failure=null, lastAction=null;
        IntPtr previousDpi=IntPtr.Zero, targetWindow=IntPtr.Zero;
        uint targetPid=0, targetThread=0;
        bool restore=false, haveCursor=false; Point savedCursor=new Point(); IntPtr savedForeground=IntPtr.Zero;
        var held=new List<Dictionary<string,object>>();
        Action<Input,Input> down=(press,up)=>{ held.Add(Record(up)); Emit(new {id=id,held=held.ToArray()}); Send(press); };
        Action release=()=>{
            bool failed=false;
            for(int i=held.Count-1;i>=0;i--) { try {Send(Release(held[i]));held.RemoveAt(i);} catch {failed=true;} }
            Emit(new {id=id,held=held.ToArray()});
            if(failed) throw new Exception("computer_input_cleanup_failed");
        };
        try {
            previousDpi=PhysicalDpi();
            haveMovePoint=false;
            string action=lastAction=Text(request,"action");
            // The user's own input through a tab: put the pointer and the user's window back afterwards, so the cursor
            // stays where the user is (in the tab) instead of ending up on the app's window on the monitor.
            restore=action!="release" && request.ContainsKey("restore") && request["restore"] is bool && (bool)request["restore"];
            if(restore) { savedForeground=GetForegroundWindow(); haveCursor=GetCursorPos(out savedCursor); }
            if(action=="release") {
                foreach(object item in (IEnumerable)request["releases"]) held.Add((Dictionary<string,object>)item);
            } else {
                IntPtr h=targetWindow=new IntPtr(Number(request,"windowId")); uint pid=targetPid=(uint)Number(request,"pid"), owner;
                uint thread=targetThread=GetWindowThreadProcessId(h,out owner);
                if(!IsWindow(h)||owner!=pid) throw new Exception("window_not_found");
                if(IsIconic(h)) ShowWindow(h,9);
                if(GetAncestor(GetForegroundWindow(),2)!=h) {
                    Activate(h);
                    for(int w=0;w<80 && GetAncestor(GetForegroundWindow(),2)!=h;w++) {
                        if(w==30) Activate(h);
                        Thread.Sleep(3);
                    }
                }
                Check(h,pid);
                    if(action=="keys"||action=="typeText") RestoreChildFocus(h,pid,ref thread);
                    if(restore && CefOrChromium(h)) Thread.Sleep(IsGameWindow(h) ? 65 : 50);
                IntPtr layout=GetKeyboardLayout(thread);
                var keys=new List<ushort>();
                string keyField=action=="keys"?"keys":"modifiers";
                if(request.ContainsKey(keyField)) foreach(object name in (IEnumerable)request[keyField]) { ushort vk=Vk(Convert.ToString(name)); if(!keys.Contains(vk)) keys.Add(vk); }
                foreach(ushort vk in keys) { Check(h,pid); down(Physical(vk,layout,false),Physical(vk,layout,true)); }
                if(action=="keys") Pause((int)Number(request,"holdMs"),h,pid);
                else if(action=="typeText") {
                    foreach(char c in Text(request,"text")) {Check(h,pid);down(Key(0,c,4),Key(0,c,6));release();Pause((int)Number(request,"delayMs"),h,pid);}
                } else {
                    bool drag=action=="drag";
                    bool normalized=request.ContainsKey("normalized") && request["normalized"] is bool && (bool)request["normalized"];
                    Move(h,pid,Decimal(request,drag?"fromX":"x"),Decimal(request,drag?"fromY":"y"),normalized);
                    if(restore && CefOrChromium(h)) Thread.Sleep(IsGameWindow(h) ? 45 : 25);
                    string button=Text(request,"button","left"); uint press=button=="right"?8u:button=="middle"?32u:2u,up=press*2;
                    if(action=="scroll") {
                        string direction=Text(request,"direction");
                        double amount=Decimal(request,"amount"); string by=Text(request,"by","line");
                        int delta=(int)Math.Max(1,Math.Min(120000,amount*(by=="pixel"?1:by=="page"?1200:120)));
                        if(direction=="down"||direction=="left") delta=-delta;
                        Check(h,pid);Send(MouseInput(direction=="left"||direction=="right"?0x1000u:0x800u,unchecked((uint)delta)));
                    } else if(drag) {
                        down(MouseInput(press),MouseInput(up)); int duration=(int)Number(request,"durationMs",300),steps=Math.Max(1,duration/10);
                        for(int i=1;i<=steps;i++) {Pause(duration/steps,h,pid);double t=(double)i/steps;Move(h,pid,Decimal(request,"fromX")+(Decimal(request,"toX")-Decimal(request,"fromX"))*t,Decimal(request,"fromY")+(Decimal(request,"toY")-Decimal(request,"fromY"))*t,normalized);}
                    } else {
                        for(int i=0;i<Number(request,"count",1);i++) {Check(h,pid);down(MouseInput(press),MouseInput(up));if(restore && CefOrChromium(h)) Thread.Sleep(IsGameWindow(h) ? 55 : 35);Send(MouseInput(up));held.RemoveAt(held.Count-1);Emit(new{id=id,held=held.ToArray()});if(i+1<Number(request,"count",1)) Pause(40,h,pid);}
                    }
                }
            }
        } catch(Exception ex) { failure=ex.Message; }
        finally {
            try {release();} catch {failure="computer_input_cleanup_failed";}
            if(restore) {
                // Let the raw input thread hand the injected events to the app before the pointer and focus move back.
                Thread.Sleep(IsGameWindow(targetWindow) ? 110 : (CefOrChromium(targetWindow) ? 80 : 16));
            }
            if(failure==null && haveMovePoint && (lastAction=="click" || lastAction=="drag")) {
                RememberFocus(targetWindow,targetPid,targetThread);
            }
            if(restore) {
                try { if(haveCursor) SetCursorPos(savedCursor.x,savedCursor.y); } catch { }
                try { Activate(savedForeground); } catch { }
            }
            if(previousDpi!=IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi);
        }
        Emit(new {id=id,ok=failure==null,error=failure});
    }
    // ---- Background input ---------------------------------------------------------------------------------------
    // Windows whose content is drawn by another process or reads raw/DirectInput: posted messages never reach it.
    static readonly string[] ForegroundOnlyClasses = { "ApplicationFrameWindow", "Windows.UI.Core.CoreWindow" };
    static readonly string[] ForegroundRestoreClasses = { "RiotWindowClass", "RCLIENT",
        "UnityWndClass", "UnrealWindow", "SDL_app", "GLFW30", "LWJGL", "Valve001", "CryENGINE", "OgreD3D11Wnd", "LaunchUnrealUWindowsClient" };
    static string ClassOf(IntPtr h) { var text=new System.Text.StringBuilder(256); return GetClassName(h,text,text.Capacity)>0 ? text.ToString() : ""; }
    static bool ForegroundOnly(IntPtr h) { string name=ClassOf(h); foreach(string item in ForegroundOnlyClasses) if(name==item) return true; return false; }
    static bool IsGameWindowName(string name) {
        if(String.IsNullOrEmpty(name)) return false;
        foreach(string item in ForegroundRestoreClasses) if(name.Equals(item,StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }
    static bool IsGameWindow(IntPtr h) {
        if(h==IntPtr.Zero) return false;
        return IsGameWindowName(ClassOf(h));
    }
    static bool PureChromium(IntPtr h) {
        if(h==IntPtr.Zero) return false;
        if(IsGameWindow(h)) return true;
        string name=ClassOf(h);
        return name.StartsWith("Cef",StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("Chrome_",StringComparison.OrdinalIgnoreCase);
    }
    static bool CefOrChromium(IntPtr h) {
        if(h==IntPtr.Zero) return false;
        if(IsGameWindow(h)) return true;
        return PureChromium(h);
    }
    static bool HasDoubleClicks(IntPtr h) {
        // CS_DBLCLKS: only such classes turn a second press into WM_xBUTTONDBLCLK.
        try { return ((IntPtr.Size==8 ? GetClassLongPtr64(h,-26).ToInt64() : GetClassLong32(h,-26)) & 8)!=0; } catch { return false; }
    }
    static IntPtr LParam(int low, int high) { return new IntPtr((int)(((uint)(ushort)(short)high << 16) | (uint)(ushort)(short)low)); }
    static void PostOrFail(IntPtr h, uint message, uint w, IntPtr l) {
        // UIPI refuses posts into higher-integrity windows (ERROR_ACCESS_DENIED): the foreground path decides then.
        if(!PostMessage(h,message,new UIntPtr(w),l)) throw new Exception(Marshal.GetLastWin32Error()==5 ? "background_unsupported" : "window_not_found");
    }
    /// The deepest enabled, visible child of root under a physical screen point (covered windows included).
    static IntPtr DeepChild(IntPtr root, Point screen) {
        IntPtr parent=root;
        for(int depth=0; depth<32; depth++) {
            Point local=screen;
            if(!ScreenToClient(parent,ref local)) break;
            IntPtr child=ChildWindowFromPointEx(parent,local,1|2|4); // CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT
            if(child==IntPtr.Zero || child==parent) break;
            parent=child;
        }
        return parent;
    }
    /// A physical screen point in the target's own coordinate space (DPI-unaware and system-aware apps are scaled by Windows).
    static Point LogicalScreen(IntPtr target, Point screen) {
        Point point=screen;
        IntPtr previous=IntPtr.Zero;
        try { previous=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(target)); PhysicalToLogicalPointForPerMonitorDPI(target,ref point); }
        catch(EntryPointNotFoundException) { }
        finally { if(previous!=IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
        return point;
    }
    static Point ClientOf(IntPtr target, Point logicalScreen) {
        Point point=logicalScreen;
        IntPtr previous=IntPtr.Zero;
        try { previous=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(target)); ScreenToClient(target,ref point); }
        catch(EntryPointNotFoundException) { ScreenToClient(target,ref point); }
        finally { if(previous!=IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
        return point;
    }
    /// Where typed text goes without focusing anything: the control last clicked in this window, the window thread's own
    /// focus. Never guess the first text box or the root when neither is known.
    static FocusEntry BindTarget(IntPtr root, uint pid, uint rootThread, IntPtr target) {
        uint owner;
        uint childThread=GetWindowThreadProcessId(target,out owner);
        var entry=new FocusEntry {pid=pid,child=target,rootThread=rootThread,childThread=childThread,childClass=ClassOf(target)};
        ValidateTarget(root,entry,false);
        return entry;
    }
    static void ValidateTarget(IntPtr root, FocusEntry entry, bool text) {
        uint rootOwner, childOwner;
        uint rootThread=GetWindowThreadProcessId(root,out rootOwner);
        uint childThread=GetWindowThreadProcessId(entry.child,out childOwner);
        if(!IsWindow(root) || !IsWindow(entry.child) || rootOwner!=entry.pid || childOwner!=entry.pid
            || rootThread==0 || rootThread!=entry.rootThread || childThread==0 || childThread!=entry.childThread
            || GetAncestor(root,2)!=root || (entry.child!=root && GetAncestor(entry.child,2)!=root)
            || !IsWindowVisible(root) || !IsWindowEnabled(root) || !IsWindowVisible(entry.child) || !IsWindowEnabled(entry.child)
            || String.IsNullOrEmpty(entry.childClass) || ClassOf(entry.child)!=entry.childClass)
            throw new Exception("background_target_unavailable");
        if(text && ((entry.child==root && !PureChromium(root)) || !EditableClass(entry.childClass)))
            throw new Exception("background_unsupported");
    }
    static bool EditableClass(string name) {
        return name.Equals("Edit",StringComparison.OrdinalIgnoreCase)
            || name.Equals("RichEdit",StringComparison.OrdinalIgnoreCase)
            || name.Equals("RichEdit20A",StringComparison.OrdinalIgnoreCase)
            || name.Equals("RichEdit20W",StringComparison.OrdinalIgnoreCase)
            || name.Equals("RICHEDIT50W",StringComparison.OrdinalIgnoreCase)
            || name.Equals("RICHEDIT60W",StringComparison.OrdinalIgnoreCase)
            || name.Equals("RichEditD2DPT",StringComparison.OrdinalIgnoreCase)
            || name.Equals("NotepadTextBox",StringComparison.OrdinalIgnoreCase)
            || name.Equals("Scintilla",StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("WindowsForms10.EDIT.",StringComparison.Ordinal)
            || name.StartsWith("Chrome_",StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("Cef",StringComparison.OrdinalIgnoreCase)
            || IsGameWindowName(name);
    }
    static FocusEntry TextTarget(IntPtr root, uint pid, uint thread, bool editable) {
        if(PureChromium(root)) {
            FocusEntry entry=BindTarget(root,pid,thread,root);
            ValidateTarget(root,entry,editable);
            return entry;
        }
        lock(FocusByRoot) {
            FocusEntry entry;
            if(FocusByRoot.TryGetValue(root.ToInt64(),out entry)) {
                // A stale explicit selection is an error, never permission to type elsewhere.
                if(entry.pid!=pid || entry.rootThread!=thread) throw new Exception("background_target_unavailable");
                if(entry.child==root && !PureChromium(root)) throw new Exception("background_unsupported");
                ValidateTarget(root,entry,editable);
                return entry;
            }
        }
        var gui=new GuiThreadInfo { cbSize=Marshal.SizeOf(typeof(GuiThreadInfo)) };
        if(thread!=0 && GetGUIThreadInfo(thread,ref gui) && gui.hwndFocus!=IntPtr.Zero
            && GetAncestor(gui.hwndFocus,2)==root) {
            FocusEntry entry=BindTarget(root,pid,thread,gui.hwndFocus);
            if(entry.child==root && !PureChromium(root)) throw new Exception("background_unsupported");
            ValidateTarget(root,entry,editable);
            return entry;
        }
        IntPtr found=IntPtr.Zero;
        ChildProc visit=(h,l)=>{
            if(IsWindowVisible(h) && IsWindowEnabled(h) && EditableClass(ClassOf(h))) { found=h; return false; }
            return true;
        };
        EnumChildWindows(root,visit,IntPtr.Zero);
        GC.KeepAlive(visit);
        if(found!=IntPtr.Zero && found!=root && GetAncestor(found,2)==root) {
            FocusEntry entry=BindTarget(root,pid,thread,found);
            ValidateTarget(root,entry,editable);
            return entry;
        }
        throw new Exception("background_target_unavailable");
    }
    static void PostBound(IntPtr root, FocusEntry entry, bool text, uint message, uint w, IntPtr l) {
        // Revalidate at every message boundary; this never substitutes a different HWND.
        if(postedCancel!=null && postedCancel.WaitOne(0)) throw new Exception("cancelled");
        ValidateTarget(root,entry,text);
        PostOrFail(entry.child,message,w,l);
    }
    // Ups must still be sent after cancellation or a control becomes disabled.
    static void ReleaseBound(IntPtr root, FocusEntry entry, uint message, uint w, IntPtr l) {
        uint owner, childOwner;
        if(!IsWindow(root) || !IsWindow(entry.child)) return;
        if(GetWindowThreadProcessId(root,out owner)!=entry.rootThread || owner!=entry.pid
            || GetWindowThreadProcessId(entry.child,out childOwner)!=entry.childThread || childOwner!=entry.pid
            || GetAncestor(entry.child,2)!=root) return;
        PostOrFail(entry.child,message,w,l);
    }
    static bool AltKey(ushort vk) { return vk==0x12 || vk==0xa4 || vk==0xa5; }
    static bool ModifierKey(ushort vk) { return vk==0x10 || vk==0x11 || AltKey(vk) || vk==0x5b || vk==0x5c || (vk>=0xa0 && vk<=0xa3); }
    static ushort MessageKey(ushort vk) { return vk==0xa0||vk==0xa1 ? (ushort)0x10 : vk==0xa2||vk==0xa3 ? (ushort)0x11 : vk==0xa4||vk==0xa5 ? (ushort)0x12 : vk; }
    static uint KeyLParam(ushort vk, IntPtr layout, bool up) {
        uint scan=MapVirtualKeyEx(vk,4,layout);
        bool extended=(scan & 0xff00)==0xe000 || vk==0xa3 || vk==0xa5 || vk==0x5b || vk==0x5c;
        return 1u | ((scan & 0xff)<<16) | (extended?1u<<24:0u) | (up?(1u<<30)|(1u<<31):0u);
    }
    static void Post(Dictionary<string,object> request) {
        long id=Number(request,"id"); string failure=null; IntPtr previousDpi=IntPtr.Zero;
        try {
            previousDpi=PhysicalDpi();
            IntPtr root=new IntPtr(Number(request,"windowId")); uint pid=(uint)Number(request,"pid"), owner;
            uint thread=GetWindowThreadProcessId(root,out owner);
            if(!IsWindow(root) || owner!=pid) throw new Exception("window_not_found");
            // A minimised window has no layout to hit; a foreground-only window ignores posted input.
            if(IsIconic(root) || ForegroundOnly(root)) throw new Exception("background_unsupported");
            string kind=Text(request,"kind");
            bool pureChromium=PureChromium(root);
            if(kind=="click" || kind=="doubleClick" || kind=="scroll" || kind=="move" || kind=="drag") {
                Rect r;
                if(!VisibleRect(root,out r) || r.right<=r.left || r.bottom<=r.top) throw new Exception("window_not_found");
                if(kind=="drag") {
                    double fromX=Decimal(request,"fromX"), fromY=Decimal(request,"fromY"), toX=Decimal(request,"toX"), toY=Decimal(request,"toY");
                    int durationMs=(int)Math.Max(50,Math.Min(2000,Number(request,"durationMs",300)));
                    if(!(fromX>=0 && fromX<=1 && fromY>=0 && fromY<=1 && toX>=0 && toX<=1 && toY>=0 && toY<=1)) throw new Exception("computer_input_invalid");
                    var fromScreen=new Point { x=r.left+(int)Math.Min(fromX*(r.right-r.left),r.right-r.left-1), y=r.top+(int)Math.Min(fromY*(r.bottom-r.top),r.bottom-r.top-1) };
                    var toScreen=new Point { x=r.left+(int)Math.Min(toX*(r.right-r.left),r.right-r.left-1), y=r.top+(int)Math.Min(toY*(r.bottom-r.top),r.bottom-r.top-1) };
                    IntPtr dragTarget=pureChromium ? root : DeepChild(root,fromScreen);
                    if(ForegroundOnly(dragTarget)) throw new Exception("background_unsupported");
                    FocusEntry dragBinding=BindTarget(root,pid,thread,dragTarget);
                    Point fromClient=pureChromium
                        ? new Point { x=(int)Math.Min(fromX*(r.right-r.left),r.right-r.left-1), y=(int)Math.Min(fromY*(r.bottom-r.top),r.bottom-r.top-1) }
                        : ClientOf(dragTarget,LogicalScreen(dragTarget,fromScreen));
                    Point toClient=pureChromium
                        ? new Point { x=(int)Math.Min(toX*(r.right-r.left),r.right-r.left-1), y=(int)Math.Min(toY*(r.bottom-r.top),r.bottom-r.top-1) }
                        : ClientOf(dragTarget,LogicalScreen(dragTarget,toScreen));
                    IntPtr fromAt=LParam(fromClient.x,fromClient.y), toAt=LParam(toClient.x,toClient.y);
                    string dragBtn=Text(request,"button","left");
                    bool dragRight=dragBtn=="right", dragMiddle=dragBtn=="middle";
                    uint dragDown=dragRight?0x204u:dragMiddle?0x207u:0x201u, dragUp=dragRight?0x205u:dragMiddle?0x208u:0x202u, dragHeld=dragRight?2u:dragMiddle?16u:1u;
                    PostBound(root,dragBinding,false,0x200,0,fromAt);
                    try {
                        PostBound(root,dragBinding,false,dragDown,dragHeld,fromAt);
                        int steps=Math.Max(1,durationMs/16);
                        for(int i=1;i<=steps;i++) {
                            if(postedCancel.WaitOne(Math.Max(1,durationMs/steps))) throw new Exception("cancelled");
                            int sx=fromClient.x+(int)Math.Round((toClient.x-fromClient.x)*(double)i/steps);
                            int sy=fromClient.y+(int)Math.Round((toClient.y-fromClient.y)*(double)i/steps);
                            PostBound(root,dragBinding,false,0x200,dragHeld,LParam(sx,sy));
                        }
                    } finally {
                        ReleaseBound(root,dragBinding,dragUp,0,toAt);
                    }
                    lock(FocusByRoot) FocusByRoot[root.ToInt64()]=dragBinding;
                } else {
                    double fx=Decimal(request,"x"), fy=Decimal(request,"y");
                    if(!(fx>=0 && fx<=1 && fy>=0 && fy<=1)) throw new Exception("computer_input_invalid");
                    var screen=new Point { x=r.left+(int)Math.Min(fx*(r.right-r.left),r.right-r.left-1), y=r.top+(int)Math.Min(fy*(r.bottom-r.top),r.bottom-r.top-1) };
                    IntPtr target=pureChromium ? root : DeepChild(root,screen);
                    if(ForegroundOnly(target)) throw new Exception("background_unsupported");
                    FocusEntry binding=BindTarget(root,pid,thread,target);
                    Point client=pureChromium
                        ? new Point { x=(int)Math.Min(fx*(r.right-r.left),r.right-r.left-1), y=(int)Math.Min(fy*(r.bottom-r.top),r.bottom-r.top-1) }
                        : ClientOf(target,LogicalScreen(target,screen));
                    Point logical=pureChromium
                        ? new Point { x=r.left+client.x, y=r.top+client.y }
                        : LogicalScreen(target,screen);
                    if(kind=="move") {
                        PostBound(root,binding,false,0x200,0,LParam(client.x,client.y));
                    } else if(kind=="scroll") {
                        string direction=Text(request,"direction","down");
                        bool horizontal=direction=="left"||direction=="right";
                        // WM_MOUSEWHEEL: positive is away from the user (up); WM_MOUSEHWHEEL: positive is right. lParam is screen coordinates.
                        int sign=direction=="up"||direction=="right" ? 1 : -1;
                        int amount=(int)Math.Max(1,Math.Min(20,Number(request,"amount",3)));
                        for(int i=0;i<amount;i++) PostBound(root,binding,false,horizontal?0x20Eu:0x20Au,(uint)(ushort)(short)(sign*120)<<16,LParam(logical.x,logical.y));
                    } else {
                        string btn=Text(request,"button","left");
                        bool right=btn=="right", middle=btn=="middle";
                        uint down=right?0x204u:middle?0x207u:0x201u, up=right?0x205u:middle?0x208u:0x202u, twice=right?0x206u:middle?0x209u:0x203u, held=right?2u:middle?16u:1u;
                        IntPtr at=LParam(client.x,client.y);
                        PostBound(root,binding,false,0x200,0,at);           // WM_MOUSEMOVE: hover state and hit testing first
                        try { PostBound(root,binding,false,down,held,at); }
                        finally { ReleaseBound(root,binding,up,0,at); }
                        if(kind=="doubleClick") {
                            try { PostBound(root,binding,false,HasDoubleClicks(target)?twice:down,held,at); }
                            finally { ReleaseBound(root,binding,up,0,at); }
                        }
                        // Text typed next goes where this click landed.
                        if(!right && !middle) lock(FocusByRoot) FocusByRoot[root.ToInt64()]=binding;
                    }
                }
            } else if(kind=="text") {
                string text=Text(request,"text");
                if(text.Length==0 || text.Length>16000) throw new Exception("computer_input_invalid");
                FocusEntry binding=TextTarget(root,pid,thread,true);
                IntPtr target=binding.child;
                if(ForegroundOnly(target)) throw new Exception("background_unsupported");
                IntPtr layout=GetKeyboardLayout(GetWindowThreadProcessId(target,out owner));
                for(int i=0;i<text.Length;i++) {
                    char c=text[i];
                    if(c=='\r' && i+1<text.Length && text[i+1]=='\n') continue;
                    if(c=='\n' || c=='\r' || c=='\t') {
                        // Enter and Tab as keys (TranslateMessage in the app makes their WM_CHAR), as a keyboard would.
                        ushort vk=(ushort)(c=='\t'?9:13);
                        try { PostBound(root,binding,true,0x100,vk,new IntPtr((int)KeyLParam(vk,layout,false))); }
                        finally { ReleaseBound(root,binding,0x101,vk,new IntPtr(unchecked((int)KeyLParam(vk,layout,true)))); }
                    } else PostBound(root,binding,true,0x102,c,new IntPtr(1)); // WM_CHAR, UTF-16 units (surrogate pairs as two)
                }
                if(pureChromium) { lock(FocusByRoot) ActiveTextInputByRoot.Add(root.ToInt64()); }
            } else if(kind=="key") {
                var chord=new List<object>();
                var vks=new List<ushort>();
                if(request.ContainsKey("modifiers") && request["modifiers"] is IEnumerable) {
                    foreach(object mod in (IEnumerable)request["modifiers"]) {
                        string modText=Convert.ToString(mod);
                        if(!String.IsNullOrEmpty(modText)) {
                            ushort mvk=Vk(modText);
                            chord.Add(modText);
                            if(!vks.Contains(mvk)) vks.Add(mvk);
                        }
                    }
                }
                if(request.ContainsKey("keys") && request["keys"] is IEnumerable) {
                    foreach(object k in (IEnumerable)request["keys"]) {
                        string kText=Convert.ToString(k);
                        if(!String.IsNullOrEmpty(kText)) {
                            ushort kvk=Vk(kText);
                            chord.Add(kText);
                            if(!vks.Contains(kvk)) vks.Add(kvk);
                        }
                    }
                } else {
                    string singleKey=Text(request,"key");
                    ushort svk=Vk(singleKey);
                    chord.Add(singleKey);
                    if(!vks.Contains(svk)) vks.Add(svk);
                }
                if(vks.Count==0) throw new Exception("computer_input_invalid");
                int holdMs=(int)Math.Max(0L,Math.Min(3000L,Number(request,"holdMs",0L)));
                FocusEntry binding=TextTarget(root,pid,thread,false);
                IntPtr target=binding.child;
                if(ForegroundOnly(target)) throw new Exception("background_unsupported");
                IntPtr layout=GetKeyboardLayout(GetWindowThreadProcessId(target,out owner));
                int repeat=(int)Math.Max(1,Math.Min(50,Number(request,"repeat",1)));
                for(int r=0;r<repeat;r++) {
                    var pressed=new List<ushort>();
                    try {
                        foreach(ushort vk in vks) {
                            bool altHeld=pressed.Exists(AltKey);
                            uint lp=KeyLParam(vk,layout,false)|(altHeld?1u<<29:0u);
                            pressed.Add(vk);
                            PostBound(root,binding,false,altHeld||AltKey(vk)?0x104u:0x100u,MessageKey(vk),new IntPtr(unchecked((int)lp)));
                        }
                        if(holdMs>0) {
                            ushort primary=vks[vks.Count-1];
                            bool altHeld=pressed.Exists(AltKey);
                            uint repeatLp=KeyLParam(primary,layout,false)|(1u<<30)|(altHeld?1u<<29:0u);
                            for(int rem=holdMs;rem>0;rem-=35) {
                                if(postedCancel.WaitOne(Math.Min(35,rem))) throw new Exception("cancelled");
                                if(rem>35 && !ModifierKey(primary)) PostBound(root,binding,false,altHeld?0x104u:0x100u,MessageKey(primary),new IntPtr(unchecked((int)repeatLp)));
                            }
                        }
                    } finally {
                        bool cleanupFailed=false;
                        for(int i=pressed.Count-1;i>=0;i--) {
                            ushort vk=pressed[i];
                            bool altHeld=pressed.Exists(AltKey);
                            uint lp=KeyLParam(vk,layout,true)|(altHeld?1u<<29:0u);
                            try { ReleaseBound(root,binding,altHeld||AltKey(vk)?0x105u:0x101u,MessageKey(vk),new IntPtr(unchecked((int)lp))); } catch { cleanupFailed=true; }
                            pressed.RemoveAt(i);
                        }
                        if(cleanupFailed) throw new Exception("computer_input_cleanup_failed");
                    }
                }
            } else throw new Exception("computer_input_invalid");
        } catch(Exception ex) { failure=ex.Message; }
        finally { if(previousDpi!=IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi); }
        Emit(new {id=id,ok=failure==null,error=failure});
    }
    public static bool PipeRedirected;
    public static int ParentPid;
    static void WatchParent(int parentPid) {
        if(parentPid<=0) return;
        var watcher=new Thread(delegate() {
            while(true) {
                try {
                    var p=System.Diagnostics.Process.GetProcessById(parentPid);
                    if(p.HasExited) break;
                } catch { break; }
                Thread.Sleep(500);
            }
            try { Cancel.Set(); DrainPosted(); if(worker!=null) worker.Join(500); } catch { }
            Environment.Exit(0);
        });
        watcher.IsBackground=true;
        watcher.Start();
    }
    public static void Run() {
        if(!PipeRedirected) { Console.InputEncoding=new System.Text.UTF8Encoding(false);Console.OutputEncoding=new System.Text.UTF8Encoding(false); }
        WatchParent(ParentPid);
        SetProcessDPIAware(); Emit(new {ready=true});
        try {
            string line; while((line=Console.ReadLine())!=null) {
                var request=Json.Deserialize<Dictionary<string,object>>(line); string action=Text(request,"action");
                if(action=="cancel") {
                    long cancelId=Number(request,"id");
                    if(cancelId==active) Cancel.Set();
                    lock(Posted) { PostedWork item; if(Posted.TryGetValue(cancelId,out item)) item.cancel.Set(); }
                    continue;
                }
                // JS queues each HWND; separate windows run concurrently. The reader stays free to cancel holds.
                if(action=="post") {
                    long postId=Number(request,"id"); var item=new PostedWork();
                    item.thread=new Thread(()=> {
                        postedCancel=item.cancel;
                        try { Post(request); }
                        finally { lock(Posted) { Posted.Remove(postId); item.cancel.Dispose(); } postedCancel=null; }
                    });
                    lock(Posted) { Posted.Add(postId,item); item.thread.Start(); }
                    continue;
                }
                if(action!="release") {Emit(new{id=Number(request,"id"),ok=false,error="background_unsupported"});continue;}
                if(worker!=null) worker.Join(); Cancel.Reset();active=Number(request,"id");
                worker=new Thread(()=>Execute(request));worker.IsBackground=false;worker.Start();
            }
        } finally {Cancel.Set();DrainPosted();if(worker!=null) worker.Join();}
    }
}
}
