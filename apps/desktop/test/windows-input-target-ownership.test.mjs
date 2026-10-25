import { nativeCompiler, compileNative, runNative } from './native-csharp-runner.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
test('compiled HWND contract refuses stale owners and roots without retargeting', {timeout:60000}, t => {
 if(!nativeCompiler()){t.skip('installed .NET SDK unavailable');return;}
const test=readFileSync(new URL('./windows-input-audit.test.mjs',import.meta.url),'utf8');
const objectText=test.slice(test.indexOf('  const native = {')+'  const native = '.length,test.indexOf('\n  let count = 0;')).trim().replace(/;$/,'');
const native=Function('return ('+objectText+')')();native.SwitchToThisWindow='{}';
native.GetWindowThreadProcessId='{pid=h.ToInt64()==22 && TestForeign?99u:7u;return TestThreadChanged && h.ToInt64()==22?14u:13u;}';
native.IsWindow='{return !(h.ToInt64()==22 && TestDestroyed);}';
native.GetAncestor='{return h.ToInt64()==22 || h.ToInt64()==33?new IntPtr(11):h;}';
native.GetGUIThreadInfo='{lpgui.hwndFocus=new IntPtr(TestFocused);return TestFocused!=0;}';
native.GetClassName='{string c=h.ToInt64()==22 || h.ToInt64()==33?(TestButton?"Button":"Edit"):"Notepad";text.Append(c);return c.Length;}';
native.PostMessage='{TestPosts.Add(new PostedMessage{hwnd=h.ToInt64(),msg=message,w=w.ToUInt64(),l=l.ToInt64()});if(TestChangeAfterOne && message==0x102)TestForeign=true;return true;}';
const harness=`
    struct PostedMessage {public long hwnd;public uint msg;public ulong w;public long l;}
    static List<Input> TestInputs=new List<Input>();static List<PostedMessage> TestPosts=new List<PostedMessage>();
    static List<long> TestDpis=new List<long>();static IntPtr TestDpi=new IntPtr(-2),TestChildWindow=IntPtr.Zero,TestLastFocused=IntPtr.Zero;
    static string TestClassName=null;static int TestDwmMode,TestDpiMode;
    static bool TestFailDown,TestCancelDown,TestResize,TestForeign,TestDestroyed,TestChangeAfterOne,TestButton,TestThreadChanged;static long TestFocused;
    static IntPtr hParent(IntPtr parent){return parent.ToInt64()==11?new IntPtr(22):parent;}static int rLeft(IntPtr h){return -800;}static int rTop(IntPtr h){return 20;}
    static void Reset(){FocusByRoot.Clear();TestPosts.Clear();TestInputs.Clear();TestForeign=false;TestDestroyed=false;TestChangeAfterOne=false;TestFocused=0;TestButton=false;TestThreadChanged=false;}
    static void Click(){Post(new Dictionary<string,object>{{"id",1},{"pid",7},{"windowId",11},{"kind","click"},{"x",.5},{"y",.5},{"button","left"}});TestPosts.Clear();}
    static void Type(){Post(new Dictionary<string,object>{{"id",2},{"pid",7},{"windowId",11},{"kind","text"},{"text","xx"}});}
    public static void Main(){
      var cases=new List<object>();
      Reset();TestFocused=11;Type();cases.Add(new{name="root focus cannot receive text",posts=TestPosts.Count});
      Reset();Click();TestForeign=true;Type();cases.Add(new{name="cached child foreign PID rejected",posts=TestPosts.Count});
      Reset();Click();TestDestroyed=true;TestFocused=33;Type();cases.Add(new{name="stale explicit target cannot switch to other focused child",posts=TestPosts.Count});
      Reset();Click();TestChangeAfterOne=true;Type();cases.Add(new{name="owner change between chars stops subsequent posting",posts=TestPosts.Count});
      Reset();Click();Type();cases.Add(new{name="stable editable target still receives both chars",posts=TestPosts.Count});
      Reset();TestButton=true;Click();Post(new Dictionary<string,object>{{"id",3},{"pid",7},{"windowId",11},{"kind","key"},{"key","Enter"}});cases.Add(new{name="single keys retain directed Button support",posts=TestPosts.Count});
      Reset();Click();TestButton=true;Type();cases.Add(new{name="changed class fails instead of reusing a cached target",posts=TestPosts.Count});
      Reset();Click();TestThreadChanged=true;Type();cases.Add(new{name="changed thread fails instead of reusing a cached target",posts=TestPosts.Count});
      Console.WriteLine(Json.Serialize(cases));
    }`;

 const original=readFileSync(new URL('../computer-input-windows.cs',import.meta.url),'utf8');
 const source=original.replace(/\[DllImport\([^\]]+\)\]\s*static extern ([^;]+);/g,(_,signature)=>{const k=signature.match(/\b(\w+)\([^)]*\)$/)?.[1];assert.ok(native[k],k);return 'static '+signature+' '+native[k];}).replace(/\n}\n}\s*$/,'\n'+harness+'\n}\n}\n');
 const dir=mkdtempSync(join(tmpdir(),'nextmux-hwnd-contract-'));
 try {
  const cs=join(dir,'Contract.cs'),exe=join(dir,'Contract.exe');writeFileSync(cs,source);
  const compiled=compileNative([cs],exe);assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
  const run=runNative(exe);assert.equal(run.status,0,run.stdout+run.stderr);
  const cases=JSON.parse(run.stdout.trim().split('\n').at(-1));assert.deepEqual(cases.map(x=>x.posts),[0,0,0,1,2,2,0,0]);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
