import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedProcessSession } from '../lib/process-session.js';
import { WorkspaceToolRuntime } from '../lib/workspace-tools.js';
import { AgentToolRegistry } from '../lib/registry.js';

const sample = '模拟错误中文';
// Fixed CP936 bytes, independent of any platform's locale or default encoding.
const gbk = 'c4a3c4e2b4edcef3d6d0cec4';
const base = { command: process.execPath, cwd: process.cwd(), env: process.env, timeoutMs: 5000, tty: false, outputCharacterLimit: 8192 };
async function run(args: string[], options: { outputEncoding?: string; command?: string } = {}) {
  const session = new ManagedProcessSession({ ...base, args, ...options });
  await session.ready();
  const snapshot = await session.waitForExit();
  return { ...snapshot, stdout: snapshot.chunks.filter(chunk => chunk.stream === 'stdout').map(chunk => chunk.text).join(''),
    stderr: snapshot.chunks.filter(chunk => chunk.stream === 'stderr').map(chunk => chunk.text).join('') };
}

test('explicit encoding preserves independent split stdout/stderr bytes and nonzero exit', async () => {
  const value = await run(['-e', `const b=Buffer.from('${gbk}','hex');process.stdout.write(b.subarray(0,1));process.stderr.write(b.subarray(0,3));setTimeout(()=>{process.stdout.write(b.subarray(1));process.stderr.write(b.subarray(3));process.exitCode=7},20)`], { outputEncoding: 'gbk' });
  assert.equal(value.stdout, sample); assert.equal(value.stderr, sample); assert.equal(value.exitCode, 7); assert.equal(value.outputEncoding, 'gbk');
});

test('default UTF8 remains unchanged and arbitrary nonUTF8 bytes are not guessed', async () => {
  assert.equal((await run(['-e', `process.stdout.write('${sample}')`])).stdout, sample);
  assert.notEqual((await run(['-e', `process.stdout.write(Buffer.from('${gbk}','hex'))`])).stdout, sample);
  const args = ['-e', 'process.stdout.write(Buffer.from([239,187,191,65]))'];
  assert.equal((await run(args, { outputEncoding: 'utf-8' })).stdout, (await run(args)).stdout);
});

test('UTF16LE partial units and incomplete final bytes flush without duplicate output', async () => {
  const value = await run(['-e', `const b=Buffer.from('${sample}','utf16le');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),15)`], { outputEncoding: 'utf-16le' });
  assert.equal(value.stdout, sample);
  const tail = await run(['-e', 'process.stdout.write(Buffer.from([196]))'], { outputEncoding: 'gbk' });
  assert.equal(tail.stdout, '�'); assert.equal(tail.chunks.length, 1);
});

test('explicit decoder does not rewrite argv or execute shell syntax', async () => {
  const literal = ['contains space', '$x; echo wrong', '"quoted"'];
  const value = await run(['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...literal], { outputEncoding: 'gbk' });
  assert.deepEqual(JSON.parse(value.stdout), literal);
});

test('stdin LF and CR remain literal even when an explicit output decoder is selected', async () => {
  const session = new ManagedProcessSession({ ...base, pipeStdin: true, outputEncoding: 'gbk',
    args: ['-e', "const chunks=[];process.stdin.on('data',x=>chunks.push(x));process.stdin.on('end',()=>process.stdout.write(Buffer.concat(chunks).toString('hex')))"] });
  await session.ready(); await session.write('a\nb\r'); await session.closeStdin();
  const result = await session.waitForExit();
  assert.equal(result.chunks.map(chunk => chunk.text).join(''), '610a620d');
});

test('invalid encodings and PTY decoding requests fail before spawning', () => {
  for (const outputEncoding of ['auto', '936', 'cp-unknown', '', null, 3, ' gbk', 'x'.repeat(65)]) {
    assert.throws(() => new ManagedProcessSession({ ...base, command: 'must-not-spawn', args: [], outputEncoding: outputEncoding as string }), /outputEncoding/);
  }
  assert.throws(() => new ManagedProcessSession({ ...base, command: 'must-not-spawn', args: [], tty: true, outputEncoding: 'gbk' }), /non-PTY/);
});

test('actual tools forward encoding and validate it consistently, including pwd fastpath', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-output-encoding-'))); const workspaceRoot = join(directory, 'root'); await mkdir(workspaceRoot);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot, checkpointRoot: join(directory, 'checkpoints'), permissionMode: 'full_access' });
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  try {
    const result = await tools.execute({ id: 'pipe', name: 'process.run', arguments: {
      command: process.execPath, args: ['-e', `process.stderr.write(Buffer.from('${gbk}','hex'));process.exitCode=7`], outputEncoding: 'gbk' } }, 'full_access', { runId: 'encoding-test' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((result.output as any).outputEncoding, 'gbk');
    assert.deepEqual({ stderr: (result.output as any).stderr, exitCode: (result.output as any).exitCode }, { stderr: sample, exitCode: 7 });
    for (const [id, name, args] of [
      ['invalid', 'process.run', { command: 'must-not-spawn', outputEncoding: 'auto' }],
      ['pwd', 'process.run', { command: 'pwd', outputEncoding: 'auto' }],
      ['pty', 'process.start', { command: 'must-not-spawn', tty: true, outputEncoding: 'gbk' }],
    ] as const) {
      const failed = await tools.execute({ id, name, arguments: args }, 'full_access', { runId: 'encoding-test' });
      assert.equal(failed.ok, false); assert.equal(failed.error?.code, 'INVALID_OUTPUT_ENCODING');
    }
    const pwd = await tools.execute({ id: 'pwd-valid', name: 'process.run', arguments: { command: 'pwd', outputEncoding: 'gbk' } }, 'full_access', { runId: 'encoding-test' });
    assert.equal(pwd.ok, true); assert.equal((pwd.output as any).stdout, workspaceRoot + '\n');
    const started = await tools.execute({ id: 'start-encoding', name: 'process.start', arguments: {
      command: process.execPath, args: ['-e', `process.stdout.write(Buffer.from('${gbk}','hex'))`], tty: false, outputEncoding: 'gbk' } }, 'full_access', { runId: 'encoding-test' });
    assert.equal(started.ok, true); assert.equal((started.output as any).outputEncoding, 'gbk');
    const output = await tools.execute({ id: 'read-encoding', name: 'process.read', arguments: {
      processId: (started.output as any).processId, waitMs: 1000 } }, 'full_access', { runId: 'encoding-test' });
    assert.equal(output.ok, true); assert.equal((output.output as any).outputEncoding, 'gbk');
    assert.deepEqual(runtime.getCreatedCheckpointIds(), []);
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('Windows PS5.1 explicit observed CP936 preserves runtime and parser diagnostics without rewriting commands', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const args = (code: string) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')];
  const codePage = await run(args('[Console]::OutputEncoding.CodePage'), { command: shell });
  if (codePage.exitCode !== 0 || codePage.stdout.trim() !== '936') { t.skip('This native fixture requires actual PS5.1 output CP936; no guessed encoding fallback'); return; }
  for (const [code, expected, exitCode] of [
    ["[Console]::Error.WriteLine('模拟错误中文');exit 7", sample, 7],
    ["Write-Error '模拟错误中文'", sample, 1],
    ["throw '模拟错误中文'", sample, 1],
    ["Write-Error '模拟错误中文", '字符串缺少终止符', 1],
    ["& $env:ComSpec /d /c 'echo 原生命令中文'", '原生命令中文', 0],
  ] as const) {
    const value = await run(args(code), { command: shell, outputEncoding: 'gbk' });
    assert.equal(value.exitCode, exitCode); assert.ok((value.stdout + value.stderr).includes(expected));
    assert.ok(!(value.stdout + value.stderr).includes('�'));
  }
});
