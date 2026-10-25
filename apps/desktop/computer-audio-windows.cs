// Mutes or unmutes one app's sound in the Windows volume mixer (the tab's sound switch; computer-window-view.cjs).
// Every active playback device is covered, and so are the app's child processes, which is where Chromium and
// Electron apps play sound from. NextMux journals owned session identities before muting and restores
// their original state on closing the last tab, quitting, or recovering after a crash.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace NextMuxAudio
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr context);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr context);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(ref Guid grouping, IntPtr context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier(out IntPtr identifier);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr identifier);
        [PreserveSig] int GetProcessId(out uint processId);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid context);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    public static class Mixer
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct ProcessEntry
        {
            public uint Size, Usage, ProcessId;
            public IntPtr DefaultHeapId;
            public uint ModuleId, Threads, ParentProcessId;
            public int PriorityClassBase;
            public uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
        }

        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, System.Text.StringBuilder buffer, ref int size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

        static string ProcessPath(uint pid, bool native = false)
        {
            if (pid == 0) return "";
            IntPtr h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
            if (h == IntPtr.Zero) return "";
            try
            {
                var sb = new System.Text.StringBuilder(1024); int cap = sb.Capacity;
                return QueryFullProcessImageName(h, native ? 1 /* PROCESS_NAME_NATIVE */ : 0, sb, ref cap) ? sb.ToString(0, cap) : "";
            }
            finally { CloseHandle(h); }
        }
        static string AppRoot(string path)
        {
            if (String.IsNullOrEmpty(path)) return "";
            string norm = path.Replace('/', '\\').Trim().ToLowerInvariant();
            if (norm.StartsWith(@"c:\windows\")) return "";
            string[] parts = norm.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 3) return "";
            if ((parts[1] == "program files" || parts[1] == "program files (x86)") && parts.Length >= 4) return parts[0] + "\\" + parts[1] + "\\" + parts[2];
            if (parts[1] == "users" && parts.Length >= 7 && parts[3] == "appdata" && parts[4] == "local" && parts[5] == "programs") return String.Join("\\", parts, 0, 7);
            if (parts[1] == "users" && parts.Length >= 6 && parts[3] == "appdata") return String.Join("\\", parts, 0, 6);
            return parts[0] + "\\" + parts[1];
        }

        static readonly Dictionary<uint, long> Unmuted = new Dictionary<uint, long>();
        static bool IsUnmuted(uint pid)
        {
            long birth;
            if (!Unmuted.TryGetValue(pid, out birth)) return false;
            long current = Birth(pid);
            if (current == 0 || current != birth) { Unmuted.Remove(pid); return false; }
            return true;
        }

        /// <summary>The app's process, its descendants, and other instances of the exact executable.</summary>
        static HashSet<uint> Family(uint root, bool ignoreUnmuted = false)
        {
            var parents = new Dictionary<uint, uint>();
            IntPtr snapshot = CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0);
            if (snapshot != new IntPtr(-1))
            {
                try
                {
                    var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
                    for (bool more = Process32FirstW(snapshot, ref entry); more; more = Process32NextW(snapshot, ref entry)) parents[entry.ProcessId] = entry.ParentProcessId;
                }
                finally { CloseHandle(snapshot); }
            }
            var family = new HashSet<uint> { root };
            for (bool grew = true; grew;)
            {
                grew = false;
                foreach (var pair in parents)
                {
                    if (!family.Contains(pair.Key) && pair.Key != pair.Value && family.Contains(pair.Value) && (ignoreUnmuted || !IsUnmuted(pair.Key)))
                        grew |= family.Add(pair.Key);
                }
            }
            string executable = ProcessPath(root);
            if (!String.IsNullOrEmpty(executable))
            {
                foreach (var pair in parents)
                {
                    if (!family.Contains(pair.Key) && (ignoreUnmuted || !IsUnmuted(pair.Key)) && String.Equals(ProcessPath(pair.Key), executable, StringComparison.OrdinalIgnoreCase))
                        family.Add(pair.Key);
                }
            }
            return family;
        }

        // Keep original session state until the last root releases it. Recovery must prove
        // session ownership; executable-name registry scans could unmute the user's other apps.
        sealed class Lease {
            public ISimpleAudioVolume volume;
            public bool original;
            public uint ownerPid;
            public long ownerBirth;
            public long journaledUtc;
            public string exeName;
            public HashSet<uint> roots = new HashSet<uint>();
        }
        static readonly object Gate = new object();
        static readonly Dictionary<string, Lease> Leases = new Dictionary<string, Lease>();
        static readonly Dictionary<uint, long> Roots = new Dictionary<uint, long>();
        static System.Threading.Timer timer;

        static readonly string JournalPath = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NextMux", "audio-muted-sessions-v2.txt");
        static readonly Dictionary<string, Lease> Recovery = new Dictionary<string, Lease>();
        static Mixer() {
            RecoverPersistedJournal();
            if(Recovery.Count>0) timer=new System.Threading.Timer(delegate(object unused) {Refresh();},null,2000,2000);
        }
        // A native delegate can run on the watchdog thread without a PowerShell runspace.
        // Access at bootstrap also initializes recovery before the first mute request.
        public static Action ParentCleanup { get { return RestoreAll; } }
        static string ExtractExeName(string processPath, string sessionId) {
            if(!String.IsNullOrEmpty(processPath)) return processPath;
            if(String.IsNullOrEmpty(sessionId)) return "";
            int start=sessionId.IndexOf('|')+1;
            if(start==0 || start>=sessionId.Length) return "";
            int boundary=sessionId.IndexOf('|',start);
            if(boundary<0) boundary=sessionId.Length;
            int end=sessionId.LastIndexOf("%b",boundary-1,StringComparison.OrdinalIgnoreCase);
            if(end<=start) return "";
            string path=sessionId.Substring(start,end-start);
            // This Windows session format is not a public API contract: unknown forms fail closed.
            return path.StartsWith(@"\Device\",StringComparison.OrdinalIgnoreCase) && path.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)
                && path.IndexOfAny(new[]{'\0','\r','\n'})<0 ? path : "";
        }
        // Persist exact session instance + process creation time BEFORE changing the mixer.
        // Legacy exe-name journals cannot prove ownership and are deliberately left untouched.
        static bool SyncJournal() {
            string temporary = JournalPath + ".tmp";
            try {
                var records = new Dictionary<string, Lease>(Recovery);
                foreach(var pair in Leases) if(!pair.Value.original) records[pair.Key]=pair.Value;
                System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(JournalPath));
                using(var file=new System.IO.FileStream(temporary,System.IO.FileMode.Create,System.IO.FileAccess.Write,System.IO.FileShare.None)) {
                    using(var writer=new System.IO.StreamWriter(file,new System.Text.UTF8Encoding(false),1024,true)) {
                        foreach(var pair in records) writer.WriteLine(Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(pair.Key)) + "\t" + pair.Value.ownerPid + "\t" + pair.Value.ownerBirth
                            + (pair.Value.journaledUtc>0 ? "\t" + pair.Value.journaledUtc : ""));
                        writer.Flush(); file.Flush(true);
                    }
                }
                if(System.IO.File.Exists(JournalPath)) System.IO.File.Replace(temporary,JournalPath,null);
                else System.IO.File.Move(temporary,JournalPath);
                return true;
            } catch { return false; }
        }
        static void RecoverPersistedJournal() {
            try {
                if(!System.IO.File.Exists(JournalPath)) return;
                foreach(string line in System.IO.File.ReadAllLines(JournalPath)) {
                    var fields=line.Split('\t'); uint pid; long birth, journaled=0;
                    if((fields.Length!=3 && fields.Length!=4) || !UInt32.TryParse(fields[1],out pid) || !Int64.TryParse(fields[2],out birth) || pid==0 || birth<=1) continue;
                    if(fields.Length==4 && (!Int64.TryParse(fields[3],out journaled) || journaled<0 || journaled>DateTime.MaxValue.Ticks)) journaled=0;
                    try { Recovery[System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(fields[0]))]=new Lease{ownerPid=pid,ownerBirth=birth,journaledUtc=journaled}; } catch { }
                }
            } catch { return; }
            RetryRecovery();
        }
        static bool RecoveryOwnerGone(Lease lease) {
            IntPtr process=OpenProcess(0x1000,false,lease.ownerPid);
            // Access denied or an unreadable creation time is not proof that the old owner is gone.
            if(process==IntPtr.Zero) return Marshal.GetLastWin32Error()==87 /* ERROR_INVALID_PARAMETER: PID no longer exists */;
            try {
                long creation, exit, kernel, user;
                return GetProcessTimes(process,out creation,out exit,out kernel,out user) && creation>1
                    && (exit!=0 || creation!=lease.ownerBirth);
            } finally { CloseHandle(process); }
        }
        static void RetryRecovery() {
            if(Recovery.Count==0) return;
            IMMDeviceEnumerator enumerator=null; IMMDeviceCollection devices=null;
            try {
                var protectedPids=new HashSet<uint>();
                foreach(var lease in Leases.Values) protectedPids.Add(lease.ownerPid);
                foreach(var root in Roots) if(Birth(root.Key)==root.Value) protectedPids.UnionWith(Family(root.Key));
                long now=DateTime.UtcNow.Ticks;
                var restarted=new Dictionary<string,string>();
                foreach(var pair in Recovery) {
                    long written=pair.Value.journaledUtc;
                    if(written<=0 || written>now || now-written>TimeSpan.TicksPerDay*7 || !RecoveryOwnerGone(pair.Value)) continue;
                    string path=ExtractExeName(null,pair.Key);
                    if(path.Length>0) restarted[pair.Key]=path;
                }
                var restored=new HashSet<string>(); var failed=new HashSet<string>(); bool complete=true;
                enumerator=(IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                if(enumerator.EnumAudioEndpoints(0,1,out devices)!=0 || devices==null) return;
                int deviceCount; if(devices.GetCount(out deviceCount)!=0) return;
                var managerId=typeof(IAudioSessionManager2).GUID;
                for(int d=0;d<deviceCount;d++) {
                    IMMDevice device=null; object manager=null; IAudioSessionEnumerator sessions=null;
                    try {
                        if(devices.Item(d,out device)!=0 || device.Activate(ref managerId,23,IntPtr.Zero,out manager)!=0) {complete=false;continue;}
                        if(((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions)!=0) {complete=false;continue;}
                        int count; if(sessions.GetCount(out count)!=0) {complete=false;continue;}
                        for(int i=0;i<count;i++) {
                            IAudioSessionControl2 session=null;
                            try {
                                uint pid; IntPtr text;
                                if(sessions.GetSession(i,out session)!=0 || session.GetProcessId(out pid)!=0 || session.GetSessionInstanceIdentifier(out text)!=0) {complete=false;continue;}
                                string id; try { id=Marshal.PtrToStringUni(text); } finally { Marshal.FreeCoTaskMem(text); }
                                if(id==null || protectedPids.Contains(pid)) continue;
                                long birth=Birth(pid);
                                if(birth<=1) continue;
                                Lease lease;
                                var context=Guid.Empty;
                                if(Recovery.TryGetValue(id,out lease) && pid==lease.ownerPid && birth==lease.ownerBirth) {
                                    if(((ISimpleAudioVolume)session).SetMute(false,ref context)==0) Recovery.Remove(id);
                                    continue;
                                }
                                if(restarted.Count==0) continue;
                                string path=ProcessPath(pid,true);
                                var matches=new List<string>();
                                foreach(var pair in restarted) if(String.Equals(path,pair.Value,StringComparison.OrdinalIgnoreCase)) matches.Add(pair.Key);
                                if(matches.Count==0) continue;
                                bool muted; var volume=(ISimpleAudioVolume)session;
                                bool success=volume.GetMute(out muted)==0 && Birth(pid)==birth && (!muted || volume.SetMute(false,ref context)==0);
                                foreach(string key in matches) (success ? restored : failed).Add(key);
                            } finally { Free(session); }
                        }
                    } finally { Free(sessions); Free(manager); Free(device); }
                }
                // Keep the record until every enumerated matching session has been restored, across all devices.
                if(complete) foreach(string key in restored) if(!failed.Contains(key)) Recovery.Remove(key);
                SyncJournal();
            } catch { /* Keep unconfirmed leases for the next recovery attempt. */ }
            finally { Free(devices); Free(enumerator); }
        }
        static void ReleaseLease(string key, Lease lease) {
            var context=Guid.Empty;
            try {
                if(lease.volume.SetMute(lease.original,ref context)!=0) return;
                Free(lease.volume); Leases.Remove(key); Recovery.Remove(key);
            } catch { /* Never erase the only recovery record on a failed restore. */ }
        }

        static long Birth(uint pid)
        {
            if (pid == 0) return 0;
            IntPtr h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
            if (h != IntPtr.Zero)
            {
                try { long c, e, k, u; if (GetProcessTimes(h, out c, out e, out k, out u) && c > 0 && e == 0) return c; }
                finally { CloseHandle(h); }
            }
            return 0;
        }
        static void Free(object item) { if(item!=null && Marshal.IsComObject(item)) Marshal.ReleaseComObject(item); }
        static int Capture(uint root) {
            var family = Family(root);
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDeviceCollection devices = null;
            int changed = 0;
            bool journalDirty = false;
            try {
                Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out devices));
                int deviceCount; Marshal.ThrowExceptionForHR(devices.GetCount(out deviceCount));
                var managerId = typeof(IAudioSessionManager2).GUID;
                for (int deviceIndex=0; deviceIndex<deviceCount; deviceIndex++) {
                    IMMDevice device=null; object manager=null; IAudioSessionEnumerator sessions=null;
                    try {
                        if(devices.Item(deviceIndex,out device)!=0 || device.Activate(ref managerId,23,IntPtr.Zero,out manager)!=0) continue;
                        if(((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions)!=0) continue;
                        int count; sessions.GetCount(out count);
                        for(int index=0;index<count;index++) {
                            IAudioSessionControl2 session=null; bool keep=false;
                            try {
                                uint owner; if(sessions.GetSession(index,out session)!=0 || session.GetProcessId(out owner)!=0 || !family.Contains(owner)) continue;
                                IntPtr text; if(session.GetSessionInstanceIdentifier(out text)!=0) continue;
                                string id; try {id=Marshal.PtrToStringUni(text);} finally {Marshal.FreeCoTaskMem(text);}
                                if(String.IsNullOrEmpty(id)) continue;
                                Lease lease;
                                if(!Leases.TryGetValue(id,out lease)) {
                                    var volume=(ISimpleAudioVolume)session; bool original;
                                    if(volume.GetMute(out original)!=0) continue;
                                    lease=new Lease {
                                        volume=volume,
                                        original=original,
                                        ownerPid=owner,
                                        ownerBirth=Birth(owner),
                                        journaledUtc=DateTime.UtcNow.Ticks,
                                        exeName=ExtractExeName(ProcessPath(owner), id)
                                    };
                                    if(!original && lease.ownerBirth<=1) continue;
                                    Leases.Add(id,lease);keep=true;
                                    if(!original) {
                                        journalDirty=true;
                                        if(!SyncJournal()) { Leases.Remove(id); keep=false; throw new InvalidOperationException("sound_journal_unavailable"); }
                                    }
                                }
                                lease.roots.Add(root); var context=Guid.Empty;
                                Marshal.ThrowExceptionForHR(lease.volume.SetMute(true,ref context));
                                changed++;
                            } finally { if(!keep) Free(session); }
                        }
                    } finally {Free(sessions);Free(manager);Free(device);}
                }
            } finally {
                if(journalDirty) SyncJournal();
                Free(devices);Free(enumerator);
            }
            return changed;
        }
        static void RestoreRoot(uint pid, bool explicitUnmute) {
            Roots.Remove(pid);
            foreach(var pair in new List<KeyValuePair<string,Lease>>(Leases)) {
                pair.Value.roots.Remove(pid);
                if(pair.Value.roots.Count==0) ReleaseLease(pair.Key,pair.Value);
            }
            SyncJournal();
        }
        public static int SetMute(uint processId, bool mute) {
            lock(Gate) {
                RetryRecovery();
                if(!mute) {
                    RestoreRoot(processId, true);
                    foreach(var lease in Leases.Values) if(lease.roots.Count==0) throw new InvalidOperationException("sound_restore_failed");
                    return 0;
                }
                foreach (uint member in Family(processId, true)) Unmuted.Remove(member);
                long birth=Birth(processId); if(birth==0) throw new InvalidOperationException("sound_process_missing");
                if(Roots.ContainsKey(processId) && Roots[processId]!=birth) RestoreRoot(processId, false);
                Roots[processId]=birth;
                if(timer==null) timer=new System.Threading.Timer(delegate(object unused) {Refresh();},null,2000,2000);
                int changed;
                try {changed=Capture(processId);} catch {RestoreRoot(processId, false);throw;}
                return changed;
            }
        }
        static void Refresh() {
            lock(Gate) {
                RetryRecovery();
                bool releasedAny = false;
                foreach(var pair in new List<KeyValuePair<string,Lease>>(Leases)) {
                    if(pair.Value.roots.Count==0 || pair.Value.ownerPid!=0 && Birth(pair.Value.ownerPid)!=pair.Value.ownerBirth) {
                        ReleaseLease(pair.Key, pair.Value);
                        releasedAny = true;
                    }
                }
                if (releasedAny) SyncJournal();
                foreach(var root in new List<uint>(Roots.Keys)) {
                    if(Birth(root)!=Roots[root]) {RestoreRoot(root, false);continue;}
                    try {Capture(root);} catch { /* The next refresh covers a new audio device/session. */ }
                }
            }
        }
        public static void RestoreAll() {
            lock(Gate) {
                if(timer!=null) {timer.Dispose();timer=null;}
                RetryRecovery();
                Unmuted.Clear();
                foreach(uint root in new List<uint>(Roots.Keys)) RestoreRoot(root, false);
                foreach(var pair in new List<KeyValuePair<string,Lease>>(Leases)) ReleaseLease(pair.Key, pair.Value);
                SyncJournal();
            }
        }
    }
}
