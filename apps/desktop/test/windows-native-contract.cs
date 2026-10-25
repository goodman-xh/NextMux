using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using NextMuxAudio;

// Runs the production native data/lease/escape policies without loading user32,
// Core Audio or a live desktop. Compile alongside the production C# sources.
class FakeVolume : ISimpleAudioVolume {
    public bool value; public int writes;
    public int SetMasterVolume(float level,ref Guid context) {return 0;}
    public int GetMasterVolume(out float level) {level=1;return 0;}
    public int SetMute(bool mute,ref Guid context) {value=mute;writes++;return 0;}
    public int GetMute(out bool mute) {mute=value;return 0;}
}
class NativeContract {
    static void Check(bool condition,string reason) {if(!condition)throw new Exception(reason);}
    static FieldInfo Field(Type type,string name) {return type.GetField(name,BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Static|BindingFlags.Instance);}
    static FakeVolume AddLease(string id,bool original,params uint[] holders) {
        Type mixer=typeof(Mixer),lease=mixer.GetNestedType("Lease",BindingFlags.NonPublic);
        object instance=Activator.CreateInstance(lease,true);var volume=new FakeVolume{value=true};
        Field(lease,"volume").SetValue(instance,volume);Field(lease,"original").SetValue(instance,original);
        Field(lease,"roots").SetValue(instance,new HashSet<uint>(holders));
        ((IDictionary)Field(mixer,"Leases").GetValue(null)).Add(id,instance);
        var roots=(Dictionary<uint,long>)Field(mixer,"Roots").GetValue(null);foreach(uint root in holders)roots[root]=1;
        return volume;
    }
    static void Main() {
        var normal=AddLease("normal",false,10,11);var alreadyMuted=AddLease("muted",true,10);
        Mixer.SetMute(10,false);
        Check(normal.value && normal.writes==0,"one shared holder must keep its session muted");
        Check(alreadyMuted.value && alreadyMuted.writes==1,"originally muted session stays muted");
        Mixer.SetMute(11,false);Check(!normal.value && normal.writes==1,"last holder restores original unmuted state");
        var restarted=AddLease("new-session",false,20);var other=AddLease("other-session",true,21);
        Mixer.RestoreAll();Check(!restarted.value && other.value,"quit restores each session's original state");
        Mixer.RestoreAll();Check(restarted.writes==1,"restoration is idempotent");
        Type host=typeof(NextMuxInput.Host);
        Type input=host.GetNestedType("Input",BindingFlags.NonPublic);
        Check(Marshal.SizeOf(input)==(IntPtr.Size==8?40:28),"SendInput ABI layout");
        var vk=host.GetMethod("Vk",BindingFlags.NonPublic|BindingFlags.Static);
        Check((ushort)vk.Invoke(null,new object[]{"Control"})==17,"modifier alias");
        Check((ushort)vk.Invoke(null,new object[]{"ArrowLeft"})==37,"navigation alias");
        Check((ushort)vk.Invoke(null,new object[]{"F24"})==135,"function key");
        Check(NextMuxServices.Host.PassKeyboard(0x5b,false,false),"Win key always passes");
        Check(NextMuxServices.Host.PassKeyboard(0x4c,true,false),"Win+L always passes");
        Check(NextMuxServices.Host.PassKeyboard(0x2e,false,true),"Ctrl+Alt+Del always passes");
        Check(!NextMuxServices.Host.PassKeyboard(0x41,false,false),"physical typing can be shielded");
        Console.WriteLine("Windows native contracts passed");
    }
}
