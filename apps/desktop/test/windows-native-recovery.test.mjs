import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeCompiler, compileNative, runNative } from './native-csharp-runner.mjs';
const desktop = fileURLToPath(new URL('../', import.meta.url));

test('production C# contracts preserve user mutes, retain failed restores, and select known desktop ABI versions', t => {
  if (!nativeCompiler()) return t.skip('installed .NET SDK unavailable');
  const directory = mkdtempSync(join(tmpdir(), 'nmx-recovery-contract-'));
  try {
    const audio = join(directory, 'Audio.cs'), harness = join(directory, 'Contract.cs'), output = join(directory, 'Contract.exe');
    const journal = join(directory, 'muted.txt');
    writeFileSync(audio, readFileSync(join(desktop, 'computer-audio-windows.cs'), 'utf8').replace(
      /static readonly string JournalPath = System\.IO\.Path\.Combine\([\s\S]*?"audio-muted-sessions-v2.txt"\);/, `static readonly string JournalPath = @"${journal}";`));
    const extra = `
        var failed=AddLease("failed",false,30); failed.fail=true;
        bool rejected=false;try { Mixer.SetMute(30,false); } catch(InvalidOperationException) { rejected=true; }
        Check(rejected && failed.value,"failed restore must not acknowledge unmute");
        var leases=(IDictionary)Field(typeof(Mixer),"Leases").GetValue(null);
        Check(leases.Contains("failed"),"failed restore must retain lease");
        Check(System.IO.File.ReadAllText(@"${journal}").Contains(Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("failed"))),"failed restore must retain durable record");
        failed.fail=false; Mixer.SetMute(30,false); Check(!failed.value && !leases.Contains("failed"),"retry restores and removes lease");
        Check(NextMuxServices.Host.DesktopInterfaceForBuild(19045,0)=="win10","Win10 ABI");
        Check(NextMuxServices.Host.DesktopInterfaceForBuild(22000,0)=="22000","Win11 original ABI");
        Check(NextMuxServices.Host.DesktopInterfaceForBuild(22621,2215)=="22621","Win11 22H2 ABI");
        Check(NextMuxServices.Host.DesktopInterfaceForBuild(26100,2605)=="26100","Win11 24H2 ABI");
        Check(NextMuxServices.Host.DesktopInterfaceForBuild(22621,100)=="","unknown revision stays put");
        Check(NextMuxServices.Host.DesktopInterfaceForBuild(99999,0)=="","unknown build stays put");
        Check((ushort)vk.Invoke(null,new object[]{"rightctrl"})==0xa3,"right Control mapping");
        Check((ushort)vk.Invoke(null,new object[]{"leftalt"})==0xa4,"left Alt mapping");
        Check((ushort)vk.Invoke(null,new object[]{"rightwin"})==0x5c,"right Windows mapping");
        Check(Mixer.ParentCleanup.Target==null,"watchdog cleanup is native static delegate");
    `;
    writeFileSync(harness, readFileSync(join(desktop, 'test/windows-native-contract.cs'), 'utf8')
      .replace('public bool value;', 'public bool fail; public bool value;')
      .replace('{value=mute;writes++;return 0;}', '{if(fail)return -1;value=mute;writes++;return 0;}')
      .replace('Console.WriteLine("Windows native contracts passed");', extra + 'Console.WriteLine("Windows native contracts passed");'));
    const compiled = compileNative([audio, join(desktop, 'computer-input-windows.cs'), join(desktop, 'computer-services-windows.cs'), harness], output);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = runNative(output);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Windows native contracts passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('production C# sources compile against .NET Framework 4.8 reference assemblies used by PowerShell', t => {
  const compiler = nativeCompiler(), framework = '/Library/Frameworks/Mono.framework/Versions/Current/lib/mono/4.8-api';
  if (!compiler?.sdk || !existsSync(join(framework, 'mscorlib.dll'))) return t.skip('Framework reference assemblies unavailable');
  const directory = mkdtempSync(join(tmpdir(), 'nmx-framework-contract-'));
  try {
    const result = spawnSync('dotnet', [join(compiler.sdk, 'Roslyn/bincore/csc.dll'), '-nologo', '-target:library', '-nostdlib', `-out:${join(directory, 'Native.dll')}`,
      ...['mscorlib', 'System', 'System.Core', 'System.Drawing', 'System.Web.Extensions'].map(name => `-r:${join(framework, name + '.dll')}`),
      ...['computer-audio-windows.cs', 'computer-input-windows.cs', 'computer-services-windows.cs', 'windows-apps-native.cs'].map(name => join(desktop, name))],
    { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('production audio journal recovers only recent, unclaimed, exact executable identities after restart', async t => {
  assert.ok(nativeCompiler(), 'installed C# compiler required for the recovery regression');
  const directory = mkdtempSync(join(tmpdir(), 'nmx-audio-restart-'));
  try {
    const audio = join(directory, 'Audio.cs'), output = join(directory, 'AudioContract.exe'), journal = join(directory, 'muted.txt');
    const boundaries = {
      CreateToolhelp32Snapshot: 'return new IntPtr(1);',
      Process32FirstW: 'AudioFakes.ResetSnapshot(); return Process32NextW(snapshot,ref entry);',
      Process32NextW: 'return AudioFakes.NextProcess(out entry.ProcessId,out entry.ParentProcessId);',
      OpenProcess: 'return AudioFakes.Open(pid);',
      QueryFullProcessImageName: 'return AudioFakes.Path(process,flags,buffer,ref size);',
      GetProcessTimes: 'return AudioFakes.Times(process,out creation,out exit,out kernel,out user);',
      CloseHandle: 'return true;'
    };
    const replaced = [];
    const source = readFileSync(join(desktop, 'computer-audio-windows.cs'), 'utf8')
      .replace(/static readonly string JournalPath = System\.IO\.Path\.Combine\([\s\S]*?"audio-muted-sessions-v2.txt"\);/, `static readonly string JournalPath = @"${journal}";`)
      .replace(/\[DllImport\("kernel32\.dll"[^\]]*\)\] static extern (\w+) (\w+)\(([^;]*)\);/g, (_match, type, name, parameters) => {
        assert.ok(boundaries[name], `unexpected native boundary ${name}`); replaced.push(name);
        return `static ${type} ${name}(${parameters}) { ${boundaries[name]} }`;
      })
      .replaceAll('new MMDeviceEnumeratorComObject()', 'new AudioEnumerator()')
      .replaceAll('Marshal.GetLastWin32Error()', 'AudioFakes.LastError');
    assert.deepEqual(replaced.sort(), Object.keys(boundaries).sort());
    writeFileSync(audio, source);
    const compiled = compileNative([audio, join(desktop, 'test/windows-audio-recovery-contract.cs')], output);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    for (const scenario of ['restarted', 'same-basename', 'expired', 'unknown-time', 'invalid-time', 'future-time',
      'unknown-path', 'path-mismatch', 'live-owner', 'inaccessible-owner', 'exited-owner', 'pid-reused',
      'leased-process', 'active-root', 'reused-root', 'partial-restore', 'enumeration-failure', 'already-unmuted',
      'legacy-exact', 'user-muted', 'new-timestamp', 'before-mute', 'restore-all', 'refresh']) {
      await t.test(scenario, () => {
        const result = runNative(output, [scenario, journal]);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, new RegExp(`Audio recovery passed: ${scenario}`));
      });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
