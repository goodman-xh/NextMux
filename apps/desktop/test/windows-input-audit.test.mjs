import { nativeCompiler, compileNative, runNative } from './native-csharp-runner.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createWindowsInput, commandFor } = require('../computer-input-windows.cjs');
const target = { pid: 7, windowId: 11, key: 'a' };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('background text is posted through the Unicode PostMessageW (PostMessageA garbles Chinese WM_CHAR)', () => {
  for (const file of ['../computer-input-windows.cs', '../computer-services-windows.cs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const declaration of source.match(/\[DllImport\([^\]]*\)\]\s*static extern bool PostMessage\(/g) || []) {
      assert.match(declaration, /EntryPoint\s*=\s*"PostMessageW"/, `${file}: ${declaration}`);
    }
  }
});

function fixture({ autoReady = true } = {}) {
  const children = [], requests = [];
  const spawn = () => {
    const child = new EventEmitter(); children.push(child);
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let ended = false, buffer = '', booted = false;
    child.kill = () => { if (!ended) { ended = true; child.emit('close', 0); } };
    child.stdin.on('finish', () => setImmediate(child.kill));
    child.ready = () => child.stdout.write('{"ready":true}\n');
    child.stdin.on('data', chunk => {
      buffer += chunk;
      for (let at; (at = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (!booted) { booted = true; if (autoReady) setImmediate(child.ready); continue; }
        const request = JSON.parse(line); requests.push(request);
        child.stdout.write(`${JSON.stringify({ id: request.id, ok: true })}\n`);
      }
    });
    return child;
  };
  return { spawn, children, requests };
}

test('disposing input while the helper starts prevents a new posted action', async () => {
  const fake = fixture({ autoReady: false });
  const input = createWindowsInput({ spawn: fake.spawn, source: () => '' });
  const execution = input.post({ ...target, kind: 'key' });
  const rejection = assert.rejects(execution, { code: 'computer_host_closed' });
  while (!fake.children.length) await tick();
  const disposed = input.dispose(); fake.children[0].ready();
  await rejection; await disposed;
  assert.equal(fake.requests.length, 0);
});

test('a transient synchronous helper spawn failure does not poison subsequent startup', async () => {
  const fake = fixture(); let attempts = 0;
  const input = createWindowsInput({ spawn: (...args) => {
    if (++attempts === 1) throw new Error('temporary resource exhaustion');
    return fake.spawn(...args);
  }, source: () => '' });
  await assert.rejects(input.post({ ...target, kind: 'key' }), { code: 'computer_input_unavailable' });
  await input.post({ ...target, kind: 'key' });
  assert.equal(attempts, 2); assert.equal(fake.requests.length, 1);
  await input.dispose();
});

test('a JSON scalar from a failed native bootstrap is rejected without throwing in the stdout listener', async () => {
  const fake = fixture({ autoReady: false });
  const input = createWindowsInput({ spawn: fake.spawn, source: () => '' });
  const execution = input.post({ ...target, kind: 'key' });
  const rejection = assert.rejects(execution, { code: 'computer_input_unavailable' });
  while (!fake.children.length) await tick();
  try { assert.doesNotThrow(() => fake.children[0].stdout.write('null\n')); }
  finally { fake.children[0].kill(); }
  await rejection; await input.dispose();
});

test('native pointer commands preserve fractions and reject invalid normalized coordinates', () => {
  const base = { pid: 7, windowId: 11, normalized: true };
  for (const action of ['click', 'rightClick', 'doubleClick', 'scroll']) {
    const command = commandFor(action, { ...base, x: 0, y: 1, direction: 'down' });
    assert.equal(command.normalized, true); assert.equal(command.x, 0); assert.equal(command.y, 1);
  }
  const drag = commandFor('drag', { ...base, fromX: 0, fromY: 0.2, toX: 1, toY: 0.8 });
  assert.equal(drag.normalized, true); assert.equal(drag.fromY, 0.2); assert.equal(drag.toY, 0.8);
  for (const x of [-0.01, 1.01, Infinity, NaN]) assert.throws(() => commandFor('click', { ...base, x, y: 0 }), { code: 'computer_input_invalid' });
  for (const normalized of ['true', 1, {}]) assert.throws(() => commandFor('click', { ...base, normalized, x: 0, y: 0 }), { code: 'computer_input_invalid' });
  assert.equal(commandFor('click', { ...base, normalized: false, x: 1300, y: 900 }).x, 1300);
});

test('native legacy cleanup remains bounded and public Run rejects global input while posting to exact controls', { timeout: 60000 }, t => {
  if (!nativeCompiler()) { t.skip('installed .NET SDK unavailable'); return; }
  // Compile the actual production Execute/Move/journaling logic. Only its
  // external Win32 calls are replaced: this test never injects desktop input.
  const native = {
    SendInput: `{ foreach(Input input in inputs) {
      if(TestFailDown && input.type==0 && input.value.mouse.flags==2) return 0;
      TestInputs.Add(input);
      if(TestCancelDown && input.type==0 && input.value.mouse.flags==2) Cancel.Set();
    } return count; }`,
    GetWindowThreadProcessId: '{ pid=7;return 13; }', IsWindow: '{ return true; }', IsIconic: '{ return false; }',
    ShowWindow: '{ return true; }', SetForegroundWindow: '{ return true; }', BringWindowToTop: '{ return true; }',
    SwitchToThisWindow: '{}',
    AttachThreadInput: '{ return true; }', GetForegroundWindow: '{ return new IntPtr(11); }',
    GetAncestor: '{ return h.ToInt64()==22 ? new IntPtr(11) : h; }',
    GetWindowRect: `{ bool physical=TestDpi.ToInt64()==-4 || TestDpi.ToInt64()==-3;
      r=physical ? new Rect{left=-810,top=10,right=210,bottom=530} : new Rect{left=-405,top=5,right=105,bottom=265};return true; }`,
    DwmGetWindowAttribute: `{ if(TestDwmMode==2) throw new EntryPointNotFoundException();
      r=new Rect{left=-800,top=20,right=TestResize?400:200,bottom=TestResize?720:520}; return TestDwmMode==1?-1:0; }`,
    GetSystemMetrics: '{ return index==76?-1920:index==77?-200:index==78?3840:1280; }',
    MapVirtualKeyEx: '{ return key==37?0xe025u:key; }', GetKeyboardLayout: '{ return IntPtr.Zero; }',
    SetProcessDPIAware: '{ return true; }', GetCurrentThreadId: '{ return 9; }',
    GetCursorPos: '{ p=new Point{x=123,y=456}; return true; }',
    SetCursorPos: '{ return true; }',
    WindowFromPoint: '{ return TestChildWindow!=IntPtr.Zero ? TestChildWindow : new IntPtr(11); }',
    GetGUIThreadInfo: '{ return false; }',
    SetFocus: '{ TestLastFocused=h; return IntPtr.Zero; }',
    PostMessage: '{ TestPosts.Add(new PostedMessage{hwnd=h.ToInt64(),msg=message,w=w.ToUInt64(),l=l.ToInt64()}); if(TestPostCancel && message==0x100 && w.ToUInt64()==66)postedCancel.Set(); return true; }',
    ChildWindowFromPointEx: '{ return hParent(parent); }',
    ScreenToClient: '{ point.x-=rLeft(h); point.y-=rTop(h); return true; }',
    GetWindowDpiAwarenessContext: '{ return new IntPtr(-4); }',
    PhysicalToLogicalPointForPerMonitorDPI: '{ return true; }',
    GetClassName: '{ string c=TestClassName ?? (h.ToInt64()==22?"Edit":"Notepad"); text.Append(c); return c.Length; }',
    GetClassLongPtr64: '{ return new IntPtr(8); }',
    GetClassLong32: '{ return 8u; }',
    IsWindowEnabled: '{ return true; }',
    IsWindowVisible: '{ return true; }',
    EnumChildWindows: '{ callback(new IntPtr(22),IntPtr.Zero); return true; }',
    SetThreadDpiAwarenessContext: `{ if(TestDpiMode==2) throw new EntryPointNotFoundException();
      if(TestDpiMode==1 && context.ToInt64()==-4) return IntPtr.Zero;
      IntPtr previous=TestDpi;TestDpi=context;TestDpis.Add(context.ToInt64());return previous; }`,
  };
  let count = 0;
  const source = readFileSync(new URL('../computer-input-windows.cs', import.meta.url), 'utf8')
    .replace(/\[DllImport\([^\]]+\)\]\s*static extern ([^;]+);/g, (_declaration, signature) => {
      const name = signature.match(/\b(\w+)\([^)]*\)$/)?.[1];
      assert.ok(native[name], `unexpected native import: ${name}`); count++;
      return `static ${signature} ${native[name]}`;
    });
  assert.equal(count, Object.keys(native).length);
  const harness = `
    struct PostedMessage { public long hwnd; public uint msg; public ulong w; public long l; }
    static List<Input> TestInputs=new List<Input>();
    static List<PostedMessage> TestPosts=new List<PostedMessage>();
    static List<long> TestDpis=new List<long>();
    static IntPtr TestDpi=new IntPtr(-2), TestChildWindow=IntPtr.Zero, TestLastFocused=IntPtr.Zero;
    static string TestClassName=null;
    static int TestDwmMode,TestDpiMode;
    static bool TestFailDown,TestCancelDown,TestResize,TestPostCancel;
    static IntPtr hParent(IntPtr parent) { return parent.ToInt64()==11 ? new IntPtr(22) : parent; }
    static int rLeft(IntPtr h) { return -800; }
    static int rTop(IntPtr h) { return 20; }
    static void TestAssert(bool ok,string message) {if(!ok)throw new Exception(message);}
    static void TestRun(string json) { TestInputs.Clear();TestDpis.Clear();Cancel.Reset();Execute(Json.Deserialize<Dictionary<string,object>>(json)); }
    static void TestPost(string json) { postedCancel=new ManualResetEvent(false);TestPosts.Clear();TestDpis.Clear();Post(Json.Deserialize<Dictionary<string,object>>(json)); }
    static Input TestMove(bool last=false) {
        Input found=new Input();bool seen=false;
        foreach(Input input in TestInputs) if(input.type==0 && (input.value.mouse.flags&1)!=0) {found=input;seen=true;if(!last)break;}
        TestAssert(seen,"missing mouse move");return found;
    }
    static void TestPoint(Input move,int x,int y) {
        TestAssert(move.value.mouse.x==(int)((x+1920)*65535L/3839),"physical x mismatch");
        TestAssert(move.value.mouse.y==(int)((y+200)*65535L/1279),"physical y mismatch");
        TestAssert(move.value.mouse.flags==0xc001,"absolute virtual-desktop mouse flags");
        TestAssert(move.value.mouse.extra.ToUInt64()==Marker,"owned-input marker");
    }
    static void TestRestored() {TestAssert(TestDpi.ToInt64()==-2,"DPI context leaked");TestAssert(TestDpis[TestDpis.Count-1]==-2,"DPI restore missing");}
    class AuditReader : System.IO.TextReader {
        readonly System.IO.TextReader inner;
        public AuditReader(System.IO.TextReader reader) { inner=reader; }
        public override string ReadLine() {
            PostedWork[] pending; lock(Posted) { pending=new List<PostedWork>(Posted.Values).ToArray(); }
            foreach(var item in pending) item.thread.Join();
            return inner.ReadLine();
        }
    }
    public static void GateAudit() {
        PipeRedirected=true; Console.SetIn(new AuditReader(Console.In));
        Run();
        TestAssert(TestInputs.Count==1 && (TestInputs[0].value.keyboard.flags&2)!=0,"Run may send only recorded release, never new global input");
        TestAssert(TestPosts.Count==5 && TestPosts[3].hwnd==22 && TestPosts[4].hwnd==22,"Run post must stay on exact child");
        Console.WriteLine("Windows public dispatch gate audit passed");
    }
    public static void Audit() {
        string click="{\\\"id\\\":1,\\\"action\\\":\\\"click\\\",\\\"pid\\\":7,\\\"windowId\\\":11,\\\"normalized\\\":true,\\\"x\\\":0,\\\"y\\\":0}";
        TestRun(click);TestPoint(TestMove(),-800,20);TestRestored();
        TestAssert(TestDpis[0]==-4,"PMv2 must precede pointer calculation");
        TestAssert(TestInputs[TestInputs.Count-1].value.mouse.flags==4,"mouse-up missing");
        TestRun(click.Replace("\\\"x\\\":0","\\\"count\\\":2,\\\"x\\\":0"));TestAssert(TestInputs.Count==5,"double click must contain exactly two down/up pairs");
        TestRun(click.Replace("\\\"x\\\":0","\\\"button\\\":\\\"right\\\",\\\"x\\\":0"));TestAssert(TestInputs[1].value.mouse.flags==8 && TestInputs[2].value.mouse.flags==16,"right mouse flags");
        TestRun(click.Replace("\\\"x\\\":0","\\\"modifiers\\\":[\\\"ctrl\\\"],\\\"x\\\":0"));TestAssert(TestInputs[0].type==1 && TestInputs[TestInputs.Count-1].value.keyboard.flags==10,"click modifier must release after mouse-up");
        TestRun(click.Replace("\\\"action\\\":\\\"click\\\"","\\\"action\\\":\\\"scroll\\\",\\\"direction\\\":\\\"left\\\",\\\"amount\\\":3,\\\"by\\\":\\\"line\\\""));
        TestAssert(TestInputs[TestInputs.Count-1].value.mouse.flags==0x1000 && unchecked((int)TestInputs[TestInputs.Count-1].value.mouse.data)==-360,"horizontal scroll direction and wheel units");TestRestored();
        string edge=click.Replace("\\\"x\\\":0","\\\"x\\\":1").Replace("\\\"y\\\":0","\\\"y\\\":1");
        TestRun(edge);TestPoint(TestMove(),199,519);TestRestored();
        TestResize=true;TestRun(edge);TestPoint(TestMove(),399,719);TestResize=false;
        TestDwmMode=1;TestRun(edge);TestPoint(TestMove(),209,529);TestRestored();
        TestDwmMode=2;TestRun(edge);TestPoint(TestMove(),209,529);TestRestored();TestDwmMode=0;
        TestDpiMode=1;TestRun(click);TestPoint(TestMove(),-800,20);TestAssert(TestDpis[0]==-3,"PMv1 fallback missing");TestRestored();
        TestDpiMode=2;TestRun(click);TestPoint(TestMove(),-800,20);TestAssert(TestDpis.Count==0,"unavailable DPI API must be tolerated");TestDpiMode=0;
        TestRun(click.Replace("\\\"normalized\\\":true","\\\"normalized\\\":false"));TestPoint(TestMove(),-810,10);TestRestored();
        string drag="{\\\"id\\\":2,\\\"action\\\":\\\"drag\\\",\\\"pid\\\":7,\\\"windowId\\\":11,\\\"normalized\\\":true,\\\"fromX\\\":0,\\\"fromY\\\":0,\\\"toX\\\":1,\\\"toY\\\":1,\\\"durationMs\\\":50}";
        TestRun(drag);TestPoint(TestMove(),-800,20);TestPoint(TestMove(true),199,519);TestRestored();
        TestCancelDown=true;TestRun(drag);TestAssert(TestInputs[TestInputs.Count-1].value.mouse.flags==4,"cancelled drag leaked mouse-down");TestRestored();TestCancelDown=false;
        TestFailDown=true;TestRun(click);TestAssert(TestInputs[TestInputs.Count-1].value.mouse.flags==4,"failed injection did not release journal");TestRestored();TestFailDown=false;
        TestRun("{\\\"id\\\":3,\\\"action\\\":\\\"keys\\\",\\\"pid\\\":7,\\\"windowId\\\":11,\\\"keys\\\":[\\\"ctrl\\\",\\\"left\\\"],\\\"holdMs\\\":0}");
        TestAssert(TestInputs.Count==4,"chord down/up count");
        TestAssert(TestInputs[1].value.keyboard.flags==9 && TestInputs[2].value.keyboard.flags==11,"extended-key flags");
        TestAssert(TestInputs[3].value.keyboard.scan==17 && TestInputs[3].value.keyboard.flags==10,"modifiers release in reverse order");TestRestored();
        TestChildWindow=new IntPtr(22);TestLastFocused=IntPtr.Zero;
        TestRun(click);TestChildWindow=IntPtr.Zero;
        TestRun("{\\\"id\\\":4,\\\"action\\\":\\\"typeText\\\",\\\"pid\\\":7,\\\"windowId\\\":11,\\\"text\\\":\\\"你好😀\\\"}");
        TestAssert(TestLastFocused.ToInt64()==22,"clicked child HWND must regain focus before typing");
        TestAssert(TestInputs.Count==8,"Unicode surrogate pair down/up count");
        for(int i=0;i<TestInputs.Count;i++) TestAssert(TestInputs[i].value.keyboard.flags==(i%2==0?4:6),"Unicode journal release flags");TestRestored();
        TestPost("{\\\"id\\\":5,\\\"action\\\":\\\"post\\\",\\\"pid\\\":7,\\\"windowId\\\":11,\\\"kind\\\":\\\"click\\\",\\\"x\\\":0.5,\\\"y\\\":0.5,\\\"button\\\":\\\"left\\\"}");
        TestAssert(TestPosts.Count==3 && TestPosts[0].hwnd==22 && TestPosts[1].msg==0x201 && TestPosts[2].msg==0x202,"background post click messages");TestRestored();
        TestPost("{\\\"id\\\":6,\\\"action\\\":\\\"post\\\",\\\"pid\\\":7,\\\"windowId\\\":11,\\\"kind\\\":\\\"text\\\",\\\"text\\\":\\\"Hi\\\\n\\\"}");
        TestAssert(TestPosts.Count==4 && TestPosts[0].msg==0x102 && TestPosts[1].msg==0x102 && TestPosts[2].msg==0x100 && TestPosts[3].msg==0x101,"background post text messages");TestRestored();
        TestPost(Json.Serialize(new {id=7,kind="key",pid=7,windowId=11,keys=new[]{"rightctrl","a","b"}}));
        TestAssert(TestPosts.Count==6,"posted chord must release all keys");
        ulong[] order={17,65,66,66,65,17};
        for(int i=0;i<6;i++) TestAssert(TestPosts[i].w==order[i] && TestPosts[i].msg==(i<3?0x100u:0x101u),"posted reverse release order");
        TestAssert((TestPosts[0].l&(1<<24))!=0 && (TestPosts[5].l&(1L<<31))!=0,"right Control extended/up bits");
        TestPostCancel=true;TestPost(Json.Serialize(new {id=8,kind="key",pid=7,windowId=11,keys=new[]{"rightctrl","a","b"},holdMs=100}));TestPostCancel=false;
        TestAssert(TestPosts.Count==6 && TestPosts[5].msg==0x101,"cancelled posted chord releases every down");
        TestPost(Json.Serialize(new {id=9,kind="key",pid=7,windowId=11,key="rightalt",holdMs=40}));
        TestAssert(TestPosts.Count==2 && TestPosts[0].msg==0x104 && TestPosts[1].msg==0x105,"standalone modifier hold has one down/up");
        TestAssert((TestPosts[0].l&(1<<29))==0 && (TestPosts[1].l&(1<<29))!=0,"Alt context follows actual chord order");
        Console.WriteLine("Windows pointer and input native audit passed");
    }
`;
  const directory = mkdtempSync(join(tmpdir(), 'nextmux-windows-input-audit-'));
  try {
    const file = join(directory, 'InputAudit.cs'), output = join(directory, 'InputAudit.exe');
    writeFileSync(file, source.replace('public static class Host {', `public static class Host {\n${harness}`)
      + '\nclass AuditMain { static void Main(string[] args) { if(args.Length>0) NextMuxInput.Host.GateAudit(); else NextMuxInput.Host.Audit(); } }\n');
    const compiled = compileNative([file], output);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
    const result = runNative(output);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /Windows pointer and input native audit passed/);
    assert.match(result.stdout, /"error":"cancelled"/);
    assert.match(result.stdout, /"error":"computer_input_injection_failed"/);
    const commands = ['keys','typeText','click','scroll','drag','hotkey','unknown'].map(action => ({ action, id:20,pid:7,windowId:11,text:'xx',keys:['a'],x:.5,y:.5 }));
    commands.push({ action:'cancel',id:999 },{ action:'post',id:21,pid:7,windowId:11,kind:'click',x:.5,y:.5 },
      { action:'post',id:22,pid:7,windowId:11,kind:'text',text:'xx' },{ action:'release',id:23,releases:[{type:1,vk:65,scan:0,flags:2}] });
    const gate = runNative(output, ['gate'],
      { encoding:'utf8', timeout:30000, input: commands.map(x => JSON.stringify(x)).join('\n')+'\n' });
    assert.equal(gate.status, 0, gate.stdout+gate.stderr || gate.error?.message);
    assert.equal((gate.stdout.match(/"error":"background_unsupported"/g)||[]).length, 7);
    assert.match(gate.stdout, /Windows public dispatch gate audit passed/);

  } finally { rmSync(directory, { recursive: true, force: true }); }
});
