// Use the installed .NET SDK on arm64 Macs; Mono's x64 compiler can stall under Rosetta.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
let cached;
export function nativeCompiler() {
  if (cached !== undefined) return cached;
  const result = spawnSync('dotnet', ['--list-sdks'], { encoding: 'utf8', timeout: 20000 });
  const rows = (result.stdout || '').trim().split('\n').map(line => /^(\S+) \[(.+)\]$/.exec(line.trim())).filter(Boolean);
  const row = rows.at(-1);
  if (!row) {
    const command = process.platform === 'win32' ? process.env.NEXTMUX_CSC_PATH || 'csc.exe' : 'mcs';
    const probe = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (probe.error || process.platform !== 'win32' && spawnSync('mono', ['--version'], { timeout: 10000 }).error) return cached = null;
    return cached = { framework: command };
  }
  const root = dirname(row[2]);
  const versions = readdirSync(join(root, 'packs', 'Microsoft.NETCore.App.Ref')).filter(v => v.split('.')[0] === row[1].split('.')[0]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const version = versions.at(-1);
  return cached = { sdk: join(row[2], row[1]), refs: join(root, 'packs', 'Microsoft.NETCore.App.Ref', version, 'ref', `net${version.split('.')[0]}.0`), version };
}
const serializer = `namespace System.Web.Script.Serialization {
 public class JavaScriptSerializer {
  public string Serialize(object value) { return System.Text.Json.JsonSerializer.Serialize(value); }
  static object Read(System.Text.Json.JsonElement e) {
   switch(e.ValueKind) {
    case System.Text.Json.JsonValueKind.Object: var d=new System.Collections.Generic.Dictionary<string,object>(); foreach(var p in e.EnumerateObject())d[p.Name]=Read(p.Value);return d;
    case System.Text.Json.JsonValueKind.Array: var a=new System.Collections.Generic.List<object>();foreach(var v in e.EnumerateArray())a.Add(Read(v));return a.ToArray();
    case System.Text.Json.JsonValueKind.String:return e.GetString();
    case System.Text.Json.JsonValueKind.Number:long n;return e.TryGetInt64(out n)?(object)n:e.GetDouble();
    case System.Text.Json.JsonValueKind.True:return true;case System.Text.Json.JsonValueKind.False:return false;default:return null;
   }
  }
  public T Deserialize<T>(string text) { using(var doc=System.Text.Json.JsonDocument.Parse(text))return (T)Read(doc.RootElement); }
 }
}`;
export function compileNative(files, output) {
  const compiler = nativeCompiler();
  if (compiler.framework) return spawnSync(compiler.framework, ['-r:System.Web.Extensions', '-r:System.Drawing', `-out:${output}`, ...files], { encoding: 'utf8', timeout: 60000 });
  const shim = join(dirname(output), 'FrameworkJsonShim.cs');
  writeFileSync(shim, serializer);
  writeFileSync(output.replace(/\.(exe|dll)$/, '.runtimeconfig.json'), JSON.stringify({ runtimeOptions: { tfm: `net${compiler.version.split('.')[0]}.0`, framework: { name: 'Microsoft.NETCore.App', version: compiler.version }, rollForward: 'LatestMajor' } }));
  return spawnSync('dotnet', [join(compiler.sdk, 'Roslyn/bincore/csc.dll'), '-nologo', '-target:exe', `-out:${output}`,
    ...readdirSync(compiler.refs).filter(file => file.endsWith('.dll')).map(file => `-r:${join(compiler.refs, file)}`),
    ...(existsSync(join(compiler.sdk, 'System.Drawing.Common.dll')) ? [`-r:${join(compiler.sdk, 'System.Drawing.Common.dll')}`] : []), shim, ...files], { encoding: 'utf8', timeout: 60000 });
}
export function runNative(output, args = [], options = {}) {
  if (nativeCompiler()?.framework) return spawnSync(process.platform === 'win32' ? output : 'mono', process.platform === 'win32' ? args : [output, ...args], { encoding: 'utf8', timeout: 30000, ...options });
  return spawnSync('dotnet', [output, ...args], { encoding: 'utf8', timeout: 30000, ...options });
}
