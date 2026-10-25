import { makeOrderedTerminalFixture } from './ordered-terminal-fixture.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import ts from 'typescript';
import { ShellCommandBuilder } from '@theia/process/lib/common/shell-command-builder.js';
import { TerminalProcess } from '@theia/process/lib/node/terminal-process.js';
import { TheiaTerminalProcessRegistry } from '../lib/node/nextmux-theia-terminal-process-registry.js';

// Read the normal compiled implementation, rather than a copied marker generator.
const compiled = readFileSync(new URL('../lib/node/nextmux-theia-terminal-process-registry.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('registry.js', compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const helperNames = ['completionSuffix', 'commandStartPrefix', 'interruptCompletionProbe'];
const helpers = Object.fromEntries(helperNames.map(name => {
    const matches = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.equal(matches.length, 1);
    return [name, Function(`return (${matches[0].getText(ast)});`)()];
}));

// Wire bytes captured from Windows PowerShell 5.1.26100.9711, using the actual
// three source helpers with the char-code successor. These test parser handling;
// they do not claim to run PowerShell on a non-Windows host.
const nativeProbeId = 'r11-native-readonly-probe';
const nativeHex = {
    commandStartPrefix: '1b5d3737373b4e6578744d757853746172743b7231312d6e61746976652d726561646f6e6c792d70726f626507',
    completionSuffix: '1b5d3737373b4e6578744d75783b7231312d6e61746976652d726561646f6e6c792d70726f62653b3007',
    interruptCompletionProbe: '1b5d3737373b4e6578744d75783b7231312d6e61746976652d726561646f6e6c792d70726f62653b31333007'
};
function wire(name, marker, exitCode = 0) {
    let text = Buffer.from(nativeHex[name], 'hex').toString('utf8').replace(nativeProbeId, marker);
    if (name === 'completionSuffix') text = text.replace(';0\x07', `;${exitCode}\x07`);
    return text;
}

test('all three compiled PowerShell marker writers use version-independent ESC/BEL and preserve exit sampling', () => {
    const marker = '87654321-1234-4234-8234-123456789abc';
    for (const name of helperNames) {
        const script = helpers[name]('powershell', marker);
        assert.match(script, /\[Console\]::Write\(\[char\]27 \+/);
        assert.match(script, /\+ \[char\]7\)/);
        assert.ok(!script.includes('`e'), `${name} must work in Windows PowerShell 5.1`);
    }
    assert.ok(helpers.completionSuffix('powershell', marker).startsWith(
        '; $__nextmuxSucceeded=$?; $__nextmuxExitCode=if ($__nextmuxSucceeded) { 0 } elseif ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 1 }; '));
});

function terminalFixture(exitCode = 0, attached = false) {
    const output = new PassThrough();
    const writes = [];
    const shellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const terminal = makeOrderedTerminalFixture(shellPath);
    Object.defineProperties(terminal, {
        killed: { value: false }, executable: { value: shellPath }, arguments: { value: ['-NoLogo'] },
        createOutputStream: { value: () => output }, onExit: { value: () => ({ dispose() {} }) },
        resize: { value: () => undefined },
        write: { value: value => {
            writes.push(value);
            if (value === '\x03') return;
            const marker = /NextMux;([0-9a-f-]{36});/.exec(value)?.[1];
            assert.ok(marker);
            assert.ok(value.includes('[char]27') && value.includes('[char]7'));
            assert.ok(!value.includes('`e'));
            const bytes = attached ? wire('interruptCompletionProbe', marker)
                : wire('commandStartPrefix', marker) + 'owned output\r\n' + wire('completionSuffix', marker, exitCode);
            // Split both OSC markers across stream chunks to exercise retained prefixes.
            setImmediate(() => { for (let i = 0; i < bytes.length; i += 7) output.write(bytes.slice(i, i + 7)); });
        } }
    });
    const profile = { id: 'powershell', shellKind: 'powershell', shellPath, shellArgs: ['-NoLogo'],
        label: 'Windows PowerShell', source: 'system' };
    const registry = new TheiaTerminalProcessRegistry({ get: () => terminal }, new ShellCommandBuilder(), 41, profile);
    return { registry, terminal, profile, writes };
}

for (const exitCode of [0, 7]) test(`native 5.1 wire fixture completes and retains output with exit ${exitCode}`, async () => {
    const f = terminalFixture(exitCode);
    try {
        const session = await f.registry.start({ command: 'node', args: ['--version'], cwd: 'C:\\owned',
            env: {}, tty: true, timeoutMs: 3000, outputCharacterLimit: 10000 });
        const result = await session.waitForExit();
        assert.match(result.processId, /^proc-[a-f0-9-]{36}$/);
        assert.equal(result.running, false); assert.equal(result.exitCode, exitCode);
        assert.equal(result.failure, undefined);
        assert.equal(result.chunks.map(chunk => chunk.text).join(''), 'owned output\n');
        assert.equal(f.registry.get(session.processId), session, 'completion must retain the managed session for process.read');
        const read = await f.registry.get(session.processId).read(0, 10000, 0);
        assert.equal(read.running, false); assert.equal(read.exitCode, exitCode); assert.equal(read.hasMore, false);
        assert.doesNotMatch(read.chunks.map(chunk => chunk.text).join(''), /NextMux|\x1b|\x07/);
    } finally { await f.registry.dispose(); }
});

test('native 5.1 interrupt wire fixture acknowledges Ctrl+C and retains the exited session', { timeout: 5000 }, async () => {
    const f = terminalFixture(0, true);
    try {
        const session = await f.registry.start({ command: f.profile.shellPath, args: f.profile.shellArgs,
            cwd: 'C:\\owned', env: {}, tty: true, timeoutMs: 0, outputCharacterLimit: 10000 });
        assert.deepEqual(f.writes, []);
        assert.equal(await session.terminate('requested'), true);
        const result = await session.waitForExit();
        assert.equal(result.running, false); assert.equal(result.signal, 'SIGINT');
        assert.equal(result.terminationReason, 'requested'); assert.equal(result.failure, undefined);
        assert.equal(f.writes.filter(value => value === '\x03').length, 1);
        assert.equal(f.writes.filter(value => value.includes(';130')).length, 1);
        assert.equal(f.registry.get(session.processId), session);
        assert.equal(f.terminal.killed, false);
    } finally { await f.registry.dispose(); }
});

for (const shell of ['powershell.exe', 'pwsh.exe']) test(`actual ${shell} emits start/completion/interrupt bytes and samples native exit 7`, {
    skip: process.platform !== 'win32' ? 'native Windows PowerShell is unavailable on this host' : false,
    timeout: 15000
}, t => {
    const marker = '87654321-1234-4234-8234-123456789abc';
    const script = helpers.commandStartPrefix('powershell', marker)
        + "& $env:ComSpec /d /c 'exit 7'" + helpers.completionSuffix('powershell', marker)
        + '; ' + helpers.interruptCompletionProbe('powershell', marker).trim();
    const actual = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 10000, windowsHide: true, maxBuffer: 16384 });
    if (shell === 'pwsh.exe' && actual.error?.code === 'ENOENT') return t.skip('PowerShell 7 is not installed; no compatibility PASS claimed');
    assert.equal(actual.error, undefined); assert.equal(actual.status, 0);
    assert.equal(actual.stderr.toString('utf8'), '');
    const expected = wire('commandStartPrefix', marker) + wire('completionSuffix', marker, 7) + wire('interruptCompletionProbe', marker);
    assert.equal(actual.stdout.toString('hex'), Buffer.from(expected).toString('hex'));
});
