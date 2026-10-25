import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentDelegationLedger } from '@nextmux/agent-runtime';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const source = new URL('../src/node/nextmux-agent-run-state-store.ts', import.meta.url);
const checkpoint = { version: 1, runId: 'durable-source-0001', nextTurn: 2, segment: 1,
    messages: [{ role: 'user', content: 'local crash-recovery fixture' }], seenToolCallIds: [],
    usage: { inputTokens: 3, outputTokens: 1 }, toolCalls: 0, repeatedToolBatchTurns: 0,
    createdAt: '2026-10-16T00:00:00.000Z' };
async function root(t) {
    const path = await fs.mkdtemp(join(tmpdir(), 'nextmux-state-durability-'));
    t.after(() => fs.rm(path, { recursive: true, force: true }));
    return path;
}
function storeAt(path, overrides = {}) {
    const { AgentRunStateStore } = loadCurrentSource(source, { 'fs/promises': { ...fs, ...overrides } });
    return new AgentRunStateStore(path);
}

test('checkpoint flush failure is not acknowledged or published', async t => {
    const path = await root(t);
    const store = storeAt(path, { open: async (name, ...args) => {
        const handle = await fs.open(name, ...args);
        if (!String(name).includes('.tmp-')) return handle;
        return { writeFile: (...data) => handle.writeFile(...data), close: () => handle.close(),
            sync: async () => { throw Object.assign(new Error('injected storage failure'), { code: 'EIO' }); } };
    } });
    await assert.rejects(store.save(checkpoint), error => error.code === 'RUN_STATE_UNAVAILABLE');
    assert.deepEqual(await fs.readdir(join(path, 'run-state')), []);
});

test('failed ledger replacement preserves the exact previous committed bytes', async t => {
    const path = await root(t), runId = 'durability-ledger-0001';
    const owner = { workspaceRoot: path, rootRunId: runId, conversationId: 'durability-conversation', depth: 0 };
    const first = createAgentDelegationLedger(runId, '2026-10-16T00:00:00.000Z');
    const normal = storeAt(path);
    await normal.saveDelegationLedger(first, owner);
    const filename = (await fs.readdir(join(path, 'run-state'))).find(name => name.endsWith('.json'));
    const before = await fs.readFile(join(path, 'run-state', filename));
    const failing = storeAt(path, { rename: async () => {
        throw Object.assign(new Error('injected Windows sharing violation'), { code: 'EPERM' });
    } });
    await assert.rejects(failing.saveDelegationLedger({ ...first, updatedAt: '2026-10-16T01:00:00.000Z' }, owner),
        error => error.code === 'DELEGATION_LEDGER_UNAVAILABLE');
    assert.deepEqual(await fs.readFile(join(path, 'run-state', filename)), before);
    assert.equal((await normal.loadDelegationLedger(runId)).updatedAt, first.updatedAt);
    assert.deepEqual(await fs.readdir(join(path, 'run-state')), [filename]);
});

test('directory flush failure cannot report a durable save', { skip: process.platform === 'win32' }, async t => {
    const path = await root(t);
    const store = storeAt(path, { open: async (name, flags, ...args) => {
        const handle = await fs.open(name, flags, ...args);
        if (flags !== 'r') return handle;
        return { close: () => handle.close(), sync: async () => {
            throw Object.assign(new Error('injected directory flush failure'), { code: 'EIO' });
        } };
    } });
    await assert.rejects(store.save(checkpoint), error => error.code === 'RUN_STATE_UNAVAILABLE');
    // The published record may exist, but the caller did not receive a safe continuation handle.
    assert.equal((await fs.readdir(join(path, 'run-state'))).filter(name => name.includes('.tmp-')).length, 0);
});

test('a separately terminated writer leaves an owner-bound checkpoint readable by a new process', async t => {
    const path = await root(t);
    const helper = new URL('./helpers/current-source-loader.mjs', import.meta.url).href;
    const owner = { workspaceRoot: path, conversationId: 'durability-process-test', rootRunId: checkpoint.runId, depth: 0 };
    const program = `import {loadCurrentSource} from ${JSON.stringify(helper)};
        const {AgentRunStateStore}=loadCurrentSource(new URL(${JSON.stringify(source.href)}));
        const store=new AgentRunStateStore(${JSON.stringify(path)});
        const id=await store.save(${JSON.stringify(checkpoint)},${JSON.stringify(owner)});
        process.stdout.write(id+'\\n'); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes; });
    const id = await new Promise((resolve, reject) => {
        let line = '';
        child.stdout.on('data', bytes => { line += bytes; if (line.includes('\n')) resolve(line.trim()); });
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`writer exited ${code}: ${stderr}`)));
    });
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL'); await exited;
    const reader = `import {loadCurrentSource} from ${JSON.stringify(helper)};
        const {AgentRunStateStore}=loadCurrentSource(new URL(${JSON.stringify(source.href)}));
        const store=new AgentRunStateStore(${JSON.stringify(path)});
        process.stdout.write(JSON.stringify(await store.load(${JSON.stringify(id)},{expectedOwner:${JSON.stringify(owner)}})));`;
    const loaded = await new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, ['--input-type=module', '-e', reader], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = ''; proc.stdout.on('data', b => { out += b; }); proc.stderr.on('data', b => { err += b; });
        proc.once('error', reject); proc.once('exit', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    });
    assert.deepEqual(loaded, checkpoint);
});
