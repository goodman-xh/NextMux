import { makeOrderedTerminalFixture } from './ordered-terminal-fixture.mjs';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import test from 'node:test';
import ts from 'typescript';
import { ShellCommandBuilder } from '@theia/process/lib/common/shell-command-builder.js';
import { TerminalProcess } from '@theia/process/lib/node/terminal-process.js';

const sourceUrl = new URL('../src/node/nextmux-theia-terminal-process-registry.ts', import.meta.url);
// Evaluate the exact changed TypeScript body, using the existing compiled siblings
// for its relative imports, as the package's ordinary Node entry point does.
const require = createRequire(new URL('../lib/node/nextmux-theia-terminal-process-registry.js', import.meta.url)), loaded = { exports: {} };
const output = ts.transpileModule(readFileSync(sourceUrl, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
new Function('require', 'module', 'exports', output + '\nexports.AttachedTerminalSession = AttachedTerminalSession;')(require, loaded, loaded.exports);
const { TheiaTerminalProcessRegistry } = loaded.exports;

// Use the existing registry test's actual PTY capability fixture unchanged.
const fixtureText = readFileSync(new URL('./theia-terminal-process-registry.test.mjs', import.meta.url), 'utf8');
const fixtureFile = ts.createSourceFile('fixture.js', fixtureText, ts.ScriptTarget.Latest, true);
const fixtureNode = fixtureFile.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'fakeTerminal');
const fakeTerminal = new Function('PassThrough', 'TerminalProcess', 'makeOrderedTerminalFixture', `return (${fixtureNode.getText(fixtureFile)});`)(PassThrough, TerminalProcess, makeOrderedTerminalFixture);

test('actual Theia adapter pages six thousand small PTY chunks with real cursors while internal full snapshots retain all output', { timeout: 10000 }, async () => {
    const terminal = fakeTerminal(undefined, { autoComplete: false });
    const profile = { id: 'fixture-powershell', shellKind: 'powershell', shellPath: terminal.process.executable, shellArgs: [], label: 'Fixture', source: 'path' };
    const registry = new TheiaTerminalProcessRegistry({ get: () => terminal.process }, new ShellCommandBuilder(), 41, profile);
    try {
        const session = await registry.start({ command: 'fixture-command', args: [], cwd: tmpdir(), env: {}, tty: true, timeoutMs: 5000, outputCharacterLimit: 100000 });
        const markerId = /NextMuxStart;([0-9a-f-]{36})/i.exec(terminal.writes[0])[1];
        terminal.output.write(`\u001b]777;NextMuxStart;${markerId}\u0007`);
        for (let index = 0; index < 6000; index += 1) terminal.output.write('x"\\\n');
        terminal.output.write(`\u001b]777;NextMux;${markerId};0\u0007`);
        const all = await session.waitForExit();
        assert.equal(all.chunks.length, 6000); assert.equal(all.exitCode, 0);
        assert.ok(JSON.stringify(all).length > 120000, 'the original successful output reproduced the old model envelope failure');
        let cursor = 0; const seen = [];
        do {
            const page = session.snapshot(cursor, 65536);
            assert.ok(JSON.stringify(page).length < 120000, 'finite pages fit the actual model tool output ceiling');
            assert.ok(JSON.stringify(page.chunks).length <= 80002, 'JSON chunk envelope stays bounded including escaped text');
            assert.equal(page.exitCode, 0); assert.equal(page.running, false);
            assert.equal(page.nextSequence, page.chunks.at(-1)?.sequence ?? cursor);
            assert.ok(page.chunks.length > 0); seen.push(...page.chunks.map(chunk => chunk.sequence)); cursor = page.nextSequence;
            if (!page.hasMore) break;
        } while (true);
        assert.deepEqual(seen, Array.from({ length: 6000 }, (_, index) => index + 1), 'no skipped hidden output or replay across pages');
        assert.equal(session.snapshot().chunks.length, 6000, 'secret scrubbing and internal exit collection keep the full ring');
    } finally { await registry.dispose(); }
});

test('actual terminal callbacks contain synchronous throws and asynchronous rejection without escaping the stream', { timeout: 10000 }, async () => {
    for (const event of ['onStarted', 'onOutput', 'onExited', 'asyncOnExited']) {
        const terminal = fakeTerminal(undefined, { autoComplete: false });
        const profile = { id: 'fixture-powershell', shellKind: 'powershell', shellPath: terminal.process.executable, shellArgs: [], label: 'Fixture', source: 'path' };
        const registry = new TheiaTerminalProcessRegistry({ get: () => terminal.process }, new ShellCommandBuilder(), 41, profile);
        const callbackName = event === 'asyncOnExited' ? 'onExited' : event;
        const callback = event === 'asyncOnExited' ? async () => { throw new Error('fixture secret must not be echoed'); } : () => { throw new Error('fixture secret must not be echoed'); };
        try {
            const session = await registry.start({ command: 'fixture-command', args: [], cwd: tmpdir(), env: {}, tty: true, timeoutMs: 5000, outputCharacterLimit: 10000, callbacks: { [callbackName]: callback } });
            const markerId = /NextMuxStart;([0-9a-f-]{36})/i.exec(terminal.writes[0])[1];
            assert.doesNotThrow(() => terminal.output.write(`\u001b]777;NextMuxStart;${markerId}\u0007callback-output\u001b]777;NextMux;${markerId};0\u0007`));
            const finished = await Promise.race([session.waitForExit(), new Promise(resolve => setTimeout(() => resolve('pending'), 100))]);
            assert.notEqual(finished, 'pending', event + ' cannot strand the completion promise');
            assert.equal(finished.exitCode, 0); assert.equal(finished.running, false);
            assert.equal(finished.failure, 'Terminal event callback failed');
            assert.ok(!JSON.stringify(finished).includes('fixture secret'));
        } finally { await registry.dispose(); }
    }
});

test('actual terminal lease-finished callback throw still resolves completion and waiting readers', { timeout: 10000 }, async () => {
    const terminal = fakeTerminal(undefined, { autoComplete: false });
    const profile = { id: 'fixture-powershell', shellKind: 'powershell', shellPath: terminal.process.executable, shellArgs: [], label: 'Fixture', source: 'path' };
    const session = await loaded.exports.AttachedTerminalSession.start(terminal.process, profile, new ShellCommandBuilder(),
        { command: 'fixture-command', args: [], cwd: tmpdir(), env: {}, tty: true, timeoutMs: 5000, outputCharacterLimit: 10000 }, false,
        () => { throw new Error('fixture lease callback failure'); });
    const reading = session.read(0, 65536, 1000);
    const markerId = /NextMuxStart;([0-9a-f-]{36})/i.exec(terminal.writes[0])[1];
    assert.doesNotThrow(() => terminal.output.write(`\u001b]777;NextMuxStart;${markerId}\u0007\u001b]777;NextMux;${markerId};0\u0007`));
    const finished = await Promise.race([Promise.all([session.waitForExit(), reading]), new Promise(resolve => setTimeout(() => resolve('pending'), 100))]);
    assert.notEqual(finished, 'pending', 'exit and read waiters are retired even when the lease callback throws');
    assert.ok(finished.every(value => !value.running && value.exitCode === 0 && value.failure === 'Terminal event callback failed'));
});
