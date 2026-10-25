using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using NextMuxAudio;

// Only the Win32/COM boundary is replaced; journal parsing and recovery run from production source.
class AudioProcess {
    public long birth, exit;
    public string path;
    public uint parent;
    public bool accessible=true;
}
static class AudioFakes {
    public static readonly Dictionary<uint,AudioProcess> Processes=new Dictionary<uint,AudioProcess>();
    public static readonly List<List<AudioSession>> Devices=new List<List<AudioSession>>();
    public static int LastError, FailedDevice=-1;
    static IEnumerator<KeyValuePair<uint,AudioProcess>> snapshot;
    public static IntPtr Open(uint pid) {
        AudioProcess process;
        if(!Processes.TryGetValue(pid,out process)) {LastError=87;return IntPtr.Zero;}
        if(!process.accessible) {LastError=5;return IntPtr.Zero;}
        return new IntPtr(pid);
    }
    public static bool Times(IntPtr handle,out long creation,out long exit,out long kernel,out long user) {
        AudioProcess process=Processes[(uint)handle.ToInt64()];
        creation=process.birth;exit=process.exit;kernel=user=0;return true;
    }
    public static bool Path(IntPtr handle,int flags,StringBuilder buffer,ref int size) {
        string path=Processes[(uint)handle.ToInt64()].path;
        if(flags!=1) path=path.Replace(@"\Device\HarddiskVolume3", "C:");
        buffer.Append(path);size=path.Length;return true;
    }
    public static void ResetSnapshot() {snapshot=Processes.GetEnumerator();}
    public static bool NextProcess(out uint pid,out uint parent) {
        if(snapshot.MoveNext()) {pid=snapshot.Current.Key;parent=snapshot.Current.Value.parent;return true;}
        pid=parent=0;return false;
    }
}
class AudioEnumerator : IMMDeviceEnumerator {
    public int EnumAudioEndpoints(int flow,int mask,out IMMDeviceCollection devices) {devices=new AudioDevices();return 0;}
}
class AudioDevices : IMMDeviceCollection {
    public int GetCount(out int count) {count=AudioFakes.Devices.Count;return 0;}
    public int Item(int index,out IMMDevice device) {device=new AudioDevice(index);return AudioFakes.FailedDevice==index ? -1 : 0;}
}
class AudioDevice : IMMDevice {
    readonly int index;
    public AudioDevice(int value) {index=value;}
    public int Activate(ref Guid iid,int context,IntPtr parameters,out object instance) {instance=new AudioManager(index);return 0;}
}
class AudioManager : IAudioSessionManager2 {
    readonly int index;
    public AudioManager(int value) {index=value;}
    public int GetAudioSessionControl(IntPtr guid,int flags,out IntPtr control) {control=IntPtr.Zero;return -1;}
    public int GetSimpleAudioVolume(IntPtr guid,int flags,out IntPtr volume) {volume=IntPtr.Zero;return -1;}
    public int GetSessionEnumerator(out IAudioSessionEnumerator sessions) {sessions=new AudioSessions(index);return 0;}
}
class AudioSessions : IAudioSessionEnumerator {
    readonly int index;
    public AudioSessions(int value) {index=value;}
    public int GetCount(out int count) {count=AudioFakes.Devices[index].Count;return 0;}
    public int GetSession(int item,out IAudioSessionControl2 session) {session=AudioFakes.Devices[index][item];return 0;}
}
class AudioSession : IAudioSessionControl2,ISimpleAudioVolume {
    public uint pid;
    public string id;
    public bool muted=true, fail;
    public int writes;
    public int GetState(out int state) {state=1;return 0;}
    public int GetDisplayName(out IntPtr name) {name=IntPtr.Zero;return 0;}
    public int SetDisplayName(IntPtr name,IntPtr context) {return 0;}
    public int GetIconPath(out IntPtr path) {path=IntPtr.Zero;return 0;}
    public int SetIconPath(IntPtr path,IntPtr context) {return 0;}
    public int GetGroupingParam(out Guid grouping) {grouping=Guid.Empty;return 0;}
    public int SetGroupingParam(ref Guid grouping,IntPtr context) {return 0;}
    public int RegisterAudioSessionNotification(IntPtr client) {return 0;}
    public int UnregisterAudioSessionNotification(IntPtr client) {return 0;}
    public int GetSessionIdentifier(out IntPtr identifier) {identifier=Marshal.StringToCoTaskMemUni(id);return 0;}
    public int GetSessionInstanceIdentifier(out IntPtr identifier) {return GetSessionIdentifier(out identifier);}
    public int GetProcessId(out uint owner) {owner=pid;return 0;}
    public int SetMasterVolume(float level,ref Guid context) {return 0;}
    public int GetMasterVolume(out float level) {level=1;return 0;}
    public int SetMute(bool value,ref Guid context) {if(fail)return -1;muted=value;writes++;return 0;}
    public int GetMute(out bool value) {value=muted;return 0;}
}
class AudioRecoveryContract {
    const string Exe=@"\Device\HarddiskVolume3\Apps\Player\player.exe";
    static string Id(string path,uint pid) {return "device|"+path+"%b{00000000-0000-0000-0000-000000000000}|"+pid+"%b0";}
    static void Check(bool ok,string message) {if(!ok)throw new Exception(message);}
    static FieldInfo Field(Type type,string name) {return type.GetField(name,BindingFlags.Static|BindingFlags.Instance|BindingFlags.NonPublic|BindingFlags.Public);}
    static void Invoke(string name) {typeof(Mixer).GetMethod(name,BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,null);}
    static IDictionary Records(string name) {return (IDictionary)Field(typeof(Mixer),name).GetValue(null);}
    static void ProtectLease(AudioSession session) {
        Type type=typeof(Mixer).GetNestedType("Lease",BindingFlags.NonPublic);
        object lease=Activator.CreateInstance(type,true);
        Field(type,"ownerPid").SetValue(lease,session.pid);
        Field(type,"ownerBirth").SetValue(lease,AudioFakes.Processes[session.pid].birth);
        Field(type,"original").SetValue(lease,true);
        Field(type,"volume").SetValue(lease,session);
        Records("Leases").Add("another-session-of-the-same-process",lease);
    }
    static void Main(string[] args) {
        string scenario=args[0], journal=args[1], oldId=Id(Exe,10);
        long now=DateTime.UtcNow.Ticks;
        string time=(now-TimeSpan.TicksPerDay).ToString();
        var target=new AudioSession{pid=20,id=Id(Exe.ToUpperInvariant(),20)};
        AudioFakes.Processes[20]=new AudioProcess{birth=200,path=Exe.ToUpperInvariant()};
        AudioFakes.Devices.Add(new List<AudioSession>{target});
        bool deferred=scenario=="leased-process" || scenario=="active-root" || scenario=="reused-root";
        bool later=scenario=="before-mute" || scenario=="restore-all" || scenario=="refresh";
        bool expectRecovery=true;
        AudioSession other=null;
        switch(scenario) {
            case "restarted": break;
            case "same-basename":
                other=new AudioSession{pid=21,id=Id(@"\Device\HarddiskVolume3\Other\player.exe",21)};
                AudioFakes.Processes[21]=new AudioProcess{birth=210,path=@"\Device\HarddiskVolume3\Other\player.exe"};
                AudioFakes.Devices[0].Add(other);break;
            case "expired": time=(now-TimeSpan.TicksPerDay*8).ToString();expectRecovery=false;break;
            case "unknown-time": time=null;expectRecovery=false;break;
            case "invalid-time": time="not-a-date";expectRecovery=false;break;
            case "future-time": time=(now+TimeSpan.TicksPerDay).ToString();expectRecovery=false;break;
            case "unknown-path": oldId=Id("player.exe",10);expectRecovery=false;break;
            case "path-mismatch": AudioFakes.Processes[20].path=@"\Device\HarddiskVolume9\Apps\Player\player.exe";expectRecovery=false;break;
            case "live-owner": case "before-mute": case "restore-all": case "refresh":
                AudioFakes.Processes[10]=new AudioProcess{birth=100,path=Exe};expectRecovery=false;break;
            case "inaccessible-owner":
                AudioFakes.Processes[10]=new AudioProcess{birth=100,path=Exe,accessible=false};expectRecovery=false;break;
            case "exited-owner": AudioFakes.Processes[10]=new AudioProcess{birth=100,path=Exe,exit=150};break;
            case "pid-reused":
                target.pid=10;target.id=Id(Exe,10)+"new";AudioFakes.Processes.Remove(20);
                AudioFakes.Processes[10]=new AudioProcess{birth=200,path=Exe};break;
            case "leased-process": case "active-root": expectRecovery=false;break;
            case "reused-root": break;
            case "partial-restore": case "enumeration-failure":
                other=new AudioSession{pid=20,id=Id(Exe,20)+"second",fail=scenario=="partial-restore"};
                AudioFakes.Devices.Add(new List<AudioSession>{other});
                if(scenario=="enumeration-failure") AudioFakes.FailedDevice=1;
                break;
            case "already-unmuted": target.muted=false;break;
            case "legacy-exact":
                time=null;target.pid=10;target.id=oldId;AudioFakes.Processes.Remove(20);
                AudioFakes.Processes[10]=new AudioProcess{birth=100,path=Exe};break;
            case "user-muted": case "new-timestamp": break;
            default: throw new Exception("Unknown scenario");
        }
        string record=Convert.ToBase64String(Encoding.UTF8.GetBytes(oldId))+"\t10\t100"+(time==null ? "" : "\t"+time)+"\n";
        File.WriteAllText(journal,deferred || scenario=="user-muted" || scenario=="new-timestamp" ? "" : record);
        Action cleanup=Mixer.ParentCleanup; // Exercises real service-start recovery.
        if(deferred) {
            if(scenario=="leased-process") ProtectLease(target);
            else {
                AudioFakes.Processes[30]=new AudioProcess{birth=300,path=@"\Device\HarddiskVolume3\Launcher\launcher.exe"};
                AudioFakes.Processes[20].parent=30;
                Records("Roots").Add((uint)30,(long)(scenario=="reused-root" ? 299 : 300));
            }
            File.WriteAllText(journal,record);Invoke("RecoverPersistedJournal");
        }
        if(scenario=="user-muted" || scenario=="new-timestamp") {
            target.muted=scenario=="user-muted";
            long before=DateTime.UtcNow.Ticks;Mixer.SetMute(20,true);
            string saved=File.ReadAllText(journal);
            if(scenario=="user-muted") {
                Check(saved.Length==0,"a user mute must never enter the recovery journal");
                Records("Leases").Clear();Records("Roots").Clear();Invoke("RecoverPersistedJournal");
                Check(target.muted && target.writes==1,"unjournaled user mute must not be undone");
            } else {
                string[] fields=saved.Trim().Split('\t');long stamped;
                Check(fields.Length==4 && Int64.TryParse(fields[3],out stamped) && stamped>=before && stamped<=DateTime.UtcNow.Ticks,"new lease persists UTC ticks");
                Invoke("SyncJournal");Check(File.ReadAllText(journal)==saved,"rewriting must not renew the recovery deadline");
                Mixer.SetMute(20,false);Check(!target.muted && File.ReadAllText(journal).Length==0,"normal restoration still clears its journal");
            }
        } else if(later) {
            Check(target.muted && target.writes==0,"live original owner prevents fallback");
            AudioFakes.Processes.Remove(10);
            if(scenario=="before-mute") {
                Mixer.SetMute(20,true);Check(target.muted && target.writes==2,"recover before capturing original mute state");
                Mixer.SetMute(20,false);
            } else if(scenario=="restore-all") cleanup();
            else Invoke("Refresh");
            Check(!target.muted && File.ReadAllText(journal).Length==0,"existing recovery call site must recover a restarted process");
        } else if(scenario=="partial-restore" || scenario=="enumeration-failure") {
            Check(!target.muted && other.muted && File.ReadAllText(journal).Length>0,"partial recovery must retain its only journal record");
            other.fail=false;AudioFakes.FailedDevice=-1;Invoke("RetryRecovery");
            Check(!other.muted && target.writes==1 && File.ReadAllText(journal).Length==0,"retry covers all devices without rewriting an unmuted session");
        } else {
            Check(target.muted!=expectRecovery,"unexpected recovered state: "+scenario);
            Check(target.writes==(expectRecovery && scenario!="already-unmuted" ? 1 : 0),"unexpected mute write: "+scenario);
            Check((File.ReadAllText(journal).Length==0)==expectRecovery,"journal must reflect confirmed recovery: "+scenario);
            if(other!=null) Check(other.muted && other.writes==0,"same basename in a different directory must stay muted");
            if(!expectRecovery) {
                string saved=File.ReadAllText(journal);Invoke("SyncJournal");
                Check(File.ReadAllText(journal)==saved,"retry must not invent or refresh a journal timestamp");
            }
            if(scenario=="already-unmuted") {
                target.muted=true;Invoke("RetryRecovery");Check(target.muted && target.writes==0,"completed recovery must not undo a later user mute");
            }
        }
        Console.WriteLine("Audio recovery passed: "+scenario);
    }
}
