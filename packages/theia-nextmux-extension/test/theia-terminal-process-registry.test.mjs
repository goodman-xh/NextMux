import { makeOrderedTerminalFixture } from './ordered-terminal-fixture.mjs';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ShellCommandBuilder } from '@theia/process/lib/common/shell-command-builder.js';
import { TerminalProcess } from '@theia/process/lib/node/terminal-process.js';
import {
    resolveTerminalProfileCwd,
    TheiaTerminalProcessRegistry
} from '../lib/node/nextmux-theia-terminal-process-registry.js';

function fakeTerminal(executable = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', options = {}) {
    let retainedOutput = '';
    const readers = new Set();
    const output = {
        write(value) {
            retainedOutput += String(value);
            for (const reader of readers) {
                if (!reader.destroyed) reader.write(value);
            }
        }
    };
    const writes = [];
    const resizes = [];
    const process = makeOrderedTerminalFixture(executable);
    Object.defineProperties(process, {
        killed: { value: false },
        executable: { value: executable },
        arguments: { value: ['-NoLogo'] },
        createOutputStream: {
            value: () => {
                const reader = new PassThrough();
                if (retainedOutput) reader.write(retainedOutput);
                readers.add(reader);
                reader.once('close', () => readers.delete(reader));
                return reader;
            }
        },
        onExit: { value: () => ({ dispose() {} }) },
        resize: { value: (columns, rows) => { resizes.push({ columns, rows }); } },
        write: {
            configurable: true,
            value: value => {
                writes.push(value);
                const marker = /NextMux;([0-9a-f-]{36});/i.exec(value)?.[1];
                const startMarker = /NextMuxStart;([0-9a-f-]{36})/i.exec(value)?.[1];
                if (options.autoComplete !== false && marker && !value.includes('\u0003')) {
                    setImmediate(() => {
                        // ConPTY may asynchronously repaint the old viewport after
                        // resize and before the newly injected command is echoed.
                        output.write('\u001b[Hprevious command from reused terminal\r\n');
                        output.write(`${value.replace(/\r$/, '')}\r\n`);
                        output.write(`\u001b]777;NextMuxStart;${startMarker}\u0007`);
                        output.write('shared terminal output\r\n');
                        output.write(`\u001b]777;NextMux;${marker};0\u0007`);
                    });
                }
            }
        }
    });
    return { process, output, writes, resizes };
}

function commandMarkers(terminal) {
    const command = terminal.writes.find(value => value.includes('NextMuxStart;')) || '';
    const markerId = /NextMux;([0-9a-f-]{36});/i.exec(command)?.[1];
    const startMarkerId = /NextMuxStart;([0-9a-f-]{36})/i.exec(command)?.[1];
    assert.ok(markerId, 'the injected command must contain a completion marker');
    assert.equal(startMarkerId, markerId, 'start and completion markers must identify the same command');
    return { markerId, startMarkerId };
}

function acknowledgeCommand(terminal, exitCode = 0) {
    const { markerId, startMarkerId } = commandMarkers(terminal);
    terminal.output.write(`\u001b]777;NextMuxStart;${startMarkerId}\u0007`);
    terminal.output.write(`\u001b]777;NextMux;${markerId};${exitCode}\u0007`);
}

test('disposing while terminal cwd conversion is pending never injects the delayed command', { timeout: 10000 }, async () => {
    const terminal = fakeTerminal();
    let ready; let release;
    const preparing = new Promise(done => { ready = done; });
    const held = new Promise(done => { release = done; });
    const profile = { id: 'powershell_7', shellKind: 'powershell', shellPath: terminal.process.executable,
        shellArgs: ['-NoLogo'], label: 'PowerShell 7', source: 'path' };
    const registry = new TheiaTerminalProcessRegistry({ get: () => terminal.process }, new ShellCommandBuilder(), 41, profile,
        async (_profile, cwd) => { ready(); await held; return cwd; });
    const options = { command: 'node', args: ['write-late-file.js'], cwd: 'C:\\workspace', env: {}, tty: true,
        timeoutMs: 5000, outputCharacterLimit: 10000 };
    try {
        const starting = registry.start(options);
        const rejected = assert.rejects(starting, { name: 'AbortError' });
        await preparing;
        const closing = registry.dispose();
        assert.equal(registry.dispose(), closing);
        await closing;
        release(); await rejected;
        assert.deepEqual(terminal.writes, [], 'no command text reaches the terminal after dispose');
        await assert.rejects(registry.start(options), { name: 'AbortError' });
        assert.deepEqual(terminal.writes, []);
        // A stopped owner releases the shared terminal lease for a NEW run.
        const next = new TheiaTerminalProcessRegistry({ get: () => terminal.process }, new ShellCommandBuilder(), 41, profile);
        try { await (await next.start(options)).waitForExit(); }
        finally { await next.dispose(); }
        assert.equal(terminal.writes.length, 1);
    } finally { release(); await registry.dispose(); }
});

test('stopping from the terminal started callback prevents command injection without deadlock', { timeout: 10000 }, async () => {
    const terminal = fakeTerminal();
    const profile = { id: 'powershell_7', shellKind: 'powershell', shellPath: terminal.process.executable,
        shellArgs: ['-NoLogo'], label: 'PowerShell 7', source: 'path' };
    const registry = new TheiaTerminalProcessRegistry({ get: () => terminal.process }, new ShellCommandBuilder(), 41, profile);
    let stopped;
    try {
        await assert.rejects(registry.start({ command: 'node', args: ['write-late-file.js'], cwd: 'C:\\workspace', env: {}, tty: true,
            timeoutMs: 5000, outputCharacterLimit: 10000, callbacks: { onStarted: () => { stopped = registry.dispose(); } } }), { name: 'AbortError' });
        await stopped;
        assert.equal(terminal.writes.some(value => value.includes('write-late-file.js')), false,
            'only cancellation/probe traffic may reach the terminal, never the requested command');
    } finally { await registry.dispose(); }
});

const windowsCwdCases = [
    {
        cwd: "C:\\工作 目录\\emoji 😀\\cash$ amp& quote' (1)",
        wsl: "/mnt/custom/工作 目录/emoji 😀/cash$ amp& quote' (1)",
        git: "/c/工作 目录/emoji 😀/cash$ amp& quote' (1)"
    },
    {
        cwd: '\\\\server\\共享 空间\\emoji 😀\\cash$ amp& (2)',
        wsl: "/mnt/unc/server/共享 空间/emoji 😀/cash$ amp& (2)",
        git: "//server/共享 空间/emoji 😀/cash$ amp& (2)"
    }
];

test('WSL resolves drive and UNC cwd values with wslpath inside the selected distribution', async () => {
    const profile = {
        id: 'wsl:ubuntu', shellKind: 'wsl',
        shellPath: 'C:\\Windows\\System32\\wsl.exe', shellArgs: ['-d', 'Ubuntu 24.04'],
        label: 'WSL · Ubuntu 24.04', source: 'wsl'
    };
    for (const expected of windowsCwdCases) {
        const calls = [];
        const resolved = await resolveTerminalProfileCwd(profile, expected.cwd, async (executable, args) => {
            calls.push({ executable, args: [...args] });
            return `\ufeff${expected.wsl}\r\n`;
        });
        assert.equal(resolved, expected.wsl);
        assert.deepEqual(calls, [{
            executable: profile.shellPath,
            args: ['--distribution', 'Ubuntu 24.04', '--exec', 'wslpath', '-a', '-u', expected.cwd]
        }]);
    }
});

test('Git Bash resolves drive and UNC cwd values with cygpath from the same Git installation', async () => {
    const profile = {
        id: 'git_bash', shellKind: 'git_bash',
        shellPath: 'C:\\Portable Tools\\Git\\bin\\bash.exe', shellArgs: ['--login', '-i'],
        label: 'Git Bash', source: 'path'
    };
    for (const expected of windowsCwdCases) {
        const calls = [];
        const resolved = await resolveTerminalProfileCwd(profile, expected.cwd, async (executable, args) => {
            calls.push({ executable, args: [...args] });
            return `${expected.git}\n`;
        });
        assert.equal(resolved, expected.git);
        assert.deepEqual(calls, [{
            executable: 'C:\\Portable Tools\\Git\\usr\\bin\\cygpath.exe',
            args: ['-a', '-u', expected.cwd]
        }]);
    }
});

test('native Windows and macOS profiles keep their host cwd without invoking a converter', async () => {
    const cwd = windowsCwdCases[0].cwd;
    let calls = 0;
    const unexpected = async () => {
        calls += 1;
        throw new Error('native profiles must not invoke a POSIX cwd converter');
    };
    for (const profile of [
        { id: 'powershell', shellKind: 'powershell', shellPath: 'pwsh.exe', shellArgs: [], label: 'PowerShell', source: 'path' },
        { id: 'command_prompt', shellKind: 'cmd', shellPath: 'cmd.exe', shellArgs: [], label: 'Command Prompt', source: 'system' },
        { id: 'zsh', shellKind: 'zsh', shellPath: '/bin/zsh', shellArgs: ['-l'], label: 'Zsh', source: 'system' }
    ]) assert.equal(await resolveTerminalProfileCwd(profile, cwd, unexpected), cwd);
    assert.equal(calls, 0);
});

test('POSIX cwd conversion fails closed for missing tools, invalid output, profiles, and relative paths', async () => {
    const wsl = {
        id: 'wsl:ubuntu', shellKind: 'wsl', shellPath: 'wsl.exe', shellArgs: ['-d', 'Ubuntu'],
        label: 'WSL · Ubuntu', source: 'wsl'
    };
    await assert.rejects(
        resolveTerminalProfileCwd(wsl, 'C:\\workspace', async () => { throw new Error('ENOENT'); }),
        /Unable to translate the working directory for WSL/
    );
    await assert.rejects(
        resolveTerminalProfileCwd(wsl, 'C:\\workspace', async () => 'C:\\workspace\r\n'),
        /Unable to translate the working directory for WSL/
    );
    await assert.rejects(
        resolveTerminalProfileCwd({ ...wsl, shellArgs: [] }, 'C:\\workspace', async () => '/mnt/c/workspace\n'),
        /Unable to translate the working directory for WSL/
    );
    await assert.rejects(
        resolveTerminalProfileCwd(wsl, 'relative\\workspace', async () => '/wrong\n'),
        /working directory is not absolute/
    );
});

test('agent tools execute through the same backend-owned Theia terminal capability', async () => {
    const terminal = fakeTerminal();
    terminal.output.write('old user terminal history\r\n');
    const registry = new TheiaTerminalProcessRegistry(
        { get: id => id === 41 ? terminal.process : undefined },
        new ShellCommandBuilder(),
        41,
        {
            id: 'powershell_7',
            shellKind: 'powershell',
            shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
            shellArgs: ['-NoLogo'],
            label: 'PowerShell 7',
            source: 'path'
        }
    );
    const streamed = [];
    const session = await registry.start({
        command: 'node',
        args: ['server.js'],
        cwd: 'C:\\workspace',
        env: {},
        columns: 120,
        rows: 30,
        timeoutMs: 5_000,
        outputCharacterLimit: 10_000,
        callbacks: { onOutput: (_processId, chunk) => streamed.push(chunk.text) }
    });
    const result = await session.waitForExit();

    assert.match(terminal.writes[0], /node['"]?\s+['"]?server[.]js/);
    assert.deepEqual(terminal.resizes, [{ columns: 120, rows: 30 }],
        'the shared PTY must use the requested execution geometry before output starts');
    assert.match(terminal.writes[0], /NextMux;[0-9a-f-]{36}/i);
    assert.equal(result.exitCode, 0);
    assert.equal(result.tty, true);
    assert.match(result.chunks.map(chunk => chunk.text).join(''), /shared terminal output/);
    assert.doesNotMatch(result.chunks.map(chunk => chunk.text).join(''), /old user terminal history|previous command from reused terminal|]777;NextMux/);
    assert.doesNotMatch(result.chunks.map(chunk => chunk.text).join(''), /__nextmux_exit|Console]::Write/,
        'the model/activity stream must not expose the shell completion probe echo');
    assert.doesNotMatch(streamed.join(''), /]777;NextMux/);
    assert.equal(registry.release(session.processId), true);
    await registry.dispose();
});

test('noninteractive commands keep literal argv and EOF stdin without entering the shared PTY', async () => {
    const terminal = fakeTerminal();
    const registry = new TheiaTerminalProcessRegistry(
        { get: () => terminal.process }, new ShellCommandBuilder(), 41,
        { id: 'powershell_7', shellKind: 'powershell', shellPath: terminal.process.executable,
            shellArgs: [], label: 'PowerShell', source: 'path' }
    );
    const literal = 'line one\nline two; $HOME `not-a-command`';
    const streamed = [];
    const session = await registry.start({
        command: process.execPath,
        args: ['-e', "let input=''; process.stdin.on('data', data => input += data); process.stdin.on('end', () => console.log(JSON.stringify({arg: process.argv[1], input}))); process.stdin.resume();", literal],
        cwd: tmpdir(), env: process.env, tty: false, pipeStdin: false,
        timeoutMs: 5_000, outputCharacterLimit: 10_000,
        callbacks: { onOutput: (_id, chunk) => streamed.push(chunk.text) }
    });
    const result = await session.waitForExit();
    assert.equal(result.exitCode, 0);
    assert.equal(result.tty, false);
    assert.deepEqual(JSON.parse(result.chunks.map(chunk => chunk.text).join('')), { arg: literal, input: '' });
    assert.deepEqual(terminal.writes, []);
    assert.match(streamed.join(''), /line one/);
    assert.equal(registry.get(session.processId), session);
    assert.equal(registry.release(session.processId), true);
    await registry.dispose();
});

test('pausing a noninteractive command ends it and permits a subsequent command', async () => {
    const terminal = fakeTerminal();
    const registry = new TheiaTerminalProcessRegistry(
        { get: () => terminal.process }, new ShellCommandBuilder(), 41,
        { id: 'powershell_7', shellKind: 'powershell', shellPath: terminal.process.executable,
            shellArgs: [], label: 'PowerShell', source: 'path' }
    );
    const controller = new AbortController();
    const session = await registry.start({
        command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: tmpdir(), env: process.env, tty: false, pipeStdin: false,
        timeoutMs: 5_000, outputCharacterLimit: 10_000, signal: controller.signal,
    });
    controller.abort();
    const result = await session.waitForExit();
    assert.equal(result.terminationReason, 'cancelled');
    assert.equal(registry.release(session.processId), true);
    const next = await registry.start({
        command: process.execPath, args: ['-e', 'console.log("resumed")'],
        cwd: tmpdir(), env: process.env, tty: false, pipeStdin: false,
        timeoutMs: 5_000, outputCharacterLimit: 10_000,
    });
    assert.equal((await next.waitForExit()).exitCode, 0);
    assert.deepEqual(terminal.writes, []);
    await registry.dispose();
});

test('the shared WSL terminal builds its command with the translated shell-visible cwd', async () => {
    const terminal = fakeTerminal('C:\\Windows\\System32\\wsl.exe');
    const nativeCwd = windowsCwdCases[0].cwd;
    const shellCwd = windowsCwdCases[0].wsl;
    const profile = {
        id: 'wsl:ubuntu', shellKind: 'wsl',
        shellPath: 'C:\\Windows\\System32\\wsl.exe', shellArgs: ['-d', 'Ubuntu'],
        label: 'WSL · Ubuntu', source: 'wsl'
    };
    const registry = new TheiaTerminalProcessRegistry(
        { get: () => terminal.process }, new ShellCommandBuilder(), 52, profile,
        async (selectedProfile, cwd) => {
            assert.equal(selectedProfile, profile);
            assert.equal(cwd, nativeCwd);
            return shellCwd;
        }
    );
    const session = await registry.start({
        command: 'node', args: ['server.js'], cwd: nativeCwd, env: {},
        timeoutMs: 5_000, outputCharacterLimit: 10_000
    });
    await session.waitForExit();

    assert.match(terminal.writes[0], /\/mnt\/custom\/工作 目录\/emoji 😀/);
    assert.doesNotMatch(terminal.writes[0], /C:\\工作 目录/);
    await registry.dispose();
});

test('a cwd conversion failure writes nothing and releases the shared terminal lease', async () => {
    const terminal = fakeTerminal('C:\\Program Files\\Git\\bin\\bash.exe');
    const manager = { get: () => terminal.process };
    const profile = {
        id: 'git_bash', shellKind: 'git_bash',
        shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe', shellArgs: ['--login', '-i'],
        label: 'Git Bash', source: 'path'
    };
    const failing = new TheiaTerminalProcessRegistry(
        manager, new ShellCommandBuilder(), 63, profile,
        async () => { throw new Error('cygpath failed'); }
    );
    const options = {
        command: 'node', args: ['server.js'], cwd: windowsCwdCases[1].cwd, env: {},
        timeoutMs: 5_000, outputCharacterLimit: 10_000
    };
    await assert.rejects(() => failing.start(options), /cygpath failed/);
    assert.deepEqual(terminal.writes, [], 'an unresolved cwd must never reach the integrated shell');
    assert.deepEqual(terminal.resizes, [], 'an unresolved cwd must not mutate the PTY');

    const recovered = new TheiaTerminalProcessRegistry(
        manager, new ShellCommandBuilder(), 63, profile,
        async () => windowsCwdCases[1].git
    );
    const session = await recovered.start(options);
    await session.waitForExit();
    assert.equal(terminal.writes.length, 1, 'the failed conversion must release its backend-wide lease');
    await failing.dispose();
    await recovered.dispose();
});

test('terminating an attached command sends Ctrl+C without killing the reusable shell', async () => {
    const terminal = fakeTerminal('C:\\Program Files\\PowerShell\\7\\pwsh.exe', { autoComplete: false });
    const registry = new TheiaTerminalProcessRegistry(
        { get: () => terminal.process },
        new ShellCommandBuilder(),
        9,
        {
            id: 'powershell_7', shellKind: 'powershell',
            shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', shellArgs: ['-NoLogo'],
            label: 'PowerShell 7', source: 'path'
        }
    );
    const session = await registry.start({
        command: 'node', args: ['watch.js'], cwd: 'C:\\workspace', env: {},
        timeoutMs: 5_000, outputCharacterLimit: 10_000
    });
    let settled = false;
    const terminating = session.terminate().then(result => {
        settled = true;
        return result;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'Ctrl+C must not be reported as complete before the PTY acknowledges command completion');
    assert.equal(terminal.writes.at(-1), '\u0003');
    acknowledgeCommand(terminal, 130);
    assert.equal(await terminating, true);
    const result = await session.waitForExit();
    assert.equal(result.terminationReason, 'requested');
    assert.equal(result.signal, 'SIGINT');
    assert.equal(terminal.process.killed, false);
    await registry.dispose();
});

test('one backend-wide lease prevents separate agent registries from interleaving commands in the same PTY', async () => {
    const terminal = fakeTerminal('C:\\Program Files\\PowerShell\\7\\pwsh.exe', { autoComplete: false });
    const manager = { get: id => id === 73 ? terminal.process : undefined };
    const profile = {
        id: 'powershell_7', shellKind: 'powershell',
        shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', shellArgs: ['-NoLogo'],
        label: 'PowerShell 7', source: 'path'
    };
    const first = new TheiaTerminalProcessRegistry(manager, new ShellCommandBuilder(), 73, profile);
    const second = new TheiaTerminalProcessRegistry(manager, new ShellCommandBuilder(), 73, profile);
    const firstSession = await first.start({
        command: 'node', args: ['watch.js'], cwd: 'C:\\workspace', env: {},
        timeoutMs: 5_000, outputCharacterLimit: 10_000
    });

    await assert.rejects(() => second.start({
        command: 'node', args: ['second.js'], cwd: 'C:\\workspace', env: {},
        timeoutMs: 5_000, outputCharacterLimit: 10_000
    }), /integrated terminal is busy/i);
    assert.equal(terminal.writes.length, 1, 'a rejected concurrent command must never reach the shared PTY');

    acknowledgeCommand(terminal);
    await firstSession.waitForExit();
    const secondSession = await second.start({
        command: 'node', args: ['second.js'], cwd: 'C:\\workspace', env: {},
        timeoutMs: 5_000, outputCharacterLimit: 10_000
    });
    assert.equal(terminal.writes.length, 2, 'the next command may start only after the prior completion marker');
    acknowledgeCommand({ ...terminal, writes: [terminal.writes[1]] });
    await secondSession.waitForExit();
    await first.dispose();
    await second.dispose();
});

test('process.start with the selected profile attaches to the existing shell instead of nesting another shell', async () => {
    const terminal = fakeTerminal();
    Object.defineProperty(terminal.process, 'write', {
        configurable: true,
        value: value => { terminal.writes.push(value); }
    });
    const profile = {
        id: 'powershell_7', shellKind: 'powershell',
        shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', shellArgs: ['-NoLogo'],
        label: 'PowerShell 7', source: 'path'
    };
    const registry = new TheiaTerminalProcessRegistry(
        { get: () => terminal.process }, new ShellCommandBuilder(), 17, profile
    );
    const session = await registry.start({
        command: profile.shellPath,
        args: profile.shellArgs,
        cwd: 'C:\\workspace',
        env: {},
        tty: true,
        timeoutMs: 5_000,
        outputCharacterLimit: 10_000
    });
    assert.deepEqual(terminal.writes, [], 'an attached profile must not launch a nested shell');
    await session.write('echo live\r');
    assert.equal(terminal.writes[0], 'echo live\r');
    const terminating = session.terminate();
    await new Promise(resolve => setTimeout(resolve, 300));
    const markerId = /NextMux;([0-9a-f-]{36});130/i.exec(terminal.writes.at(-1))?.[1];
    assert.ok(markerId, 'an attached shell interruption must be followed by an exact completion probe');
    terminal.output.write(`\u001b]777;NextMux;${markerId};130\u0007`);
    await terminating;
    assert.ok(terminal.writes.includes('\u0003'));
    await registry.dispose();
});

test('a deadline-free attached terminal remains active and explicit termination still waits for its own acknowledgement', async () => {
    const terminal = fakeTerminal('C:\\Program Files\\PowerShell\\7\\pwsh.exe', { autoComplete: false });
    const profile = { id: 'powershell_7', shellKind: 'powershell', shellPath: terminal.process.executable,
        shellArgs: [], label: 'PowerShell', source: 'path' };
    const registry = new TheiaTerminalProcessRegistry({ get: () => terminal.process }, new ShellCommandBuilder(), 501, profile);
    try {
        const session = await registry.start({ command: 'node', args: ['server.js'], cwd: 'C:\\workspace', env: {},
            tty: true, timeoutMs: 0, outputCharacterLimit: 10_000 });
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.equal(session.running, true);
        assert.equal(terminal.writes.includes('\u0003'), false, 'there must be no hidden immediate timeout for a long-lived command');
        const stopping = session.terminate('requested');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(terminal.writes.at(-1), '\u0003');
        acknowledgeCommand(terminal, 130);
        await stopping;
        assert.equal((await session.waitForExit()).terminationReason, 'requested');
        assert.equal(terminal.process.killed, false);
    } finally { await registry.dispose(); }
});

test('an attached terminal still honours an explicit positive process deadline', async () => {
    const terminal = fakeTerminal('C:\\Program Files\\PowerShell\\7\\pwsh.exe', { autoComplete: false });
    const profile = { id: 'powershell_7', shellKind: 'powershell', shellPath: terminal.process.executable,
        shellArgs: [], label: 'PowerShell', source: 'path' };
    const registry = new TheiaTerminalProcessRegistry({ get: () => terminal.process }, new ShellCommandBuilder(), 502, profile);
    try {
        const session = await registry.start({ command: 'node', args: ['server.js'], cwd: 'C:\\workspace', env: {},
            tty: true, timeoutMs: 40, outputCharacterLimit: 10_000 });
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.equal(terminal.writes.at(-1), '\u0003');
        acknowledgeCommand(terminal, 130);
        const result = await session.waitForExit();
        assert.equal(result.terminationReason, 'timeout');
        assert.match(result.failure, /timed out/);
        assert.equal(terminal.process.killed, false);
    } finally { await registry.dispose(); }
});

test('disposing a deadline-free attached terminal stops only its leased command and releases the lease', async () => {
    const terminal = fakeTerminal('C:\\Program Files\\PowerShell\\7\\pwsh.exe', { autoComplete: false });
    const profile = { id: 'powershell_7', shellKind: 'powershell', shellPath: terminal.process.executable,
        shellArgs: [], label: 'PowerShell', source: 'path' };
    const manager = { get: () => terminal.process };
    const registry = new TheiaTerminalProcessRegistry(manager, new ShellCommandBuilder(), 503, profile);
    const next = new TheiaTerminalProcessRegistry(manager, new ShellCommandBuilder(), 503, profile);
    try {
        const options = { command: 'node', args: ['server.js'], cwd: 'C:\\workspace', env: {},
            tty: true, timeoutMs: 0, outputCharacterLimit: 10_000 };
        const session = await registry.start(options);
        const closing = registry.dispose();
        await new Promise(resolve => setImmediate(resolve));
        acknowledgeCommand(terminal, 130);
        await closing;
        assert.equal((await session.waitForExit()).terminationReason, 'runtime_dispose');
        const resumed = await next.start(options);
        const commands = terminal.writes.filter(value => value.includes('NextMuxStart;'));
        const latest = commands.at(-1);
        const marker = /NextMux;([0-9a-f-]{36});/i.exec(latest)[1];
        terminal.output.write(`\u001b]777;NextMuxStart;${marker}\u0007`);
        terminal.output.write(`\u001b]777;NextMux;${marker};0\u0007`);
        assert.equal((await resumed.waitForExit()).exitCode, 0);
        assert.equal(terminal.process.killed, false);
    } finally { await registry.dispose(); await next.dispose(); }
});

test('completed terminal sessions are capped at 48 with oldest completed sessions pruned automatically', async () => {
    const terminal = fakeTerminal();
    const profile = {
        id: 'powershell_7', shellKind: 'powershell', shellPath: terminal.process.executable,
        shellArgs: ['-NoLogo'], label: 'PowerShell 7', source: 'path'
    };
    const registry = new TheiaTerminalProcessRegistry({ get: () => terminal.process }, new ShellCommandBuilder(), 504, profile);
    try {
        const ids = [];
        for (let i = 0; i < 55; i += 1) {
            const session = await registry.start({
                command: 'node', args: [`job-${i}.js`], cwd: 'C:\\workspace', env: {},
                tty: true, timeoutMs: 5_000, outputCharacterLimit: 10_000
            });
            await session.waitForExit();
            ids.push(session.processId);
        }
        for (let i = 0; i < 7; i += 1) {
            assert.equal(registry.get(ids[i]), undefined, `completed session ${i} should have been evicted`);
        }
        for (let i = 7; i < 55; i += 1) {
            assert.ok(registry.get(ids[i]), `recent completed session ${i} should still be retained`);
        }
    } finally {
        await registry.dispose();
    }
});
