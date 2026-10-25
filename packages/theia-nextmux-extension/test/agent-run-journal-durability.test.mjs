import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const source = new URL('../src/node/nextmux-agent-run-journal.ts', import.meta.url);
const actual = loadCurrentSource(source);
const runId = 'journal-durability-root-001';
function record(path, revision = 1) {
    return { schemaVersion: 1, runId, state: 'running',
        owner: { workspaceRoot: path, conversationId: 'journal-fixture', rootRunId: runId, depth: 0 },
        checkpointId: `resume-00000000-0000-4000-8000-00000000000${revision}`,
        checkpointTurn: revision, workbench: 'coding', permissionMode: 'workspace_write',
        createdAt: 1_000, updatedAt: 1_000 + revision };
}
async function directory(t) {
    const path = await fs.mkdtemp(join(tmpdir(), 'nextmux-journal-durability-'));
    t.after(() => fs.rm(path, { recursive: true, force: true }));
    return path;
}
function store(path, overrides = {}) {
    const { AgentRunJournalStore } = loadCurrentSource(source, { 'fs/promises': { ...fs, ...overrides } });
    return new AgentRunJournalStore(path);
}

test('journal file flush failure keeps the last committed recovery revision', async t => {
    const path = await directory(t), normal = store(path);
    await normal.save(record(path));
    const before = await fs.readdir(path);
    const failing = store(path, { open: async (name, ...args) => {
        const handle = await fs.open(name, ...args);
        if (!String(name).includes('.tmp-')) return handle;
        return { writeFile: (...data) => handle.writeFile(...data), close: () => handle.close(),
            sync: async () => { throw new Error('injected file flush failure'); } };
    } });
    await assert.rejects(failing.save(record(path, 2)), error =>
        error.code === 'AGENT_RUN_JOURNAL_UNAVAILABLE' && !error.checkpointReferenceMayExist);
    assert.deepEqual(await fs.readdir(path), before);
    assert.equal((await normal.load(runId)).checkpointTurn, 1);
});

test('uncertain directory flush retains previous revision and marks the new reference',
    { skip: process.platform === 'win32' }, async t => {
    const path = await directory(t), normal = store(path);
    await normal.save(record(path));
    const first = (await fs.readdir(path))[0];
    const failing = store(path, { open: async (name, flags, ...args) => {
        const handle = await fs.open(name, flags, ...args);
        if (flags !== 'r') return handle;
        return { close: () => handle.close(), sync: async () => { throw new Error('injected directory failure'); } };
    } });
    await assert.rejects(failing.save(record(path, 2)), error =>
        error.code === 'AGENT_RUN_JOURNAL_UNAVAILABLE' && error.checkpointReferenceMayExist);
    const revisions = await fs.readdir(path);
    assert.equal(revisions.length, 2);
    assert.ok(revisions.includes(first));
    assert.equal((await normal.load(runId)).checkpointTurn, 2);
});

test('cleanup failure after committed journal save cannot invalidate its new checkpoint', async t => {
    const path = await directory(t), normal = store(path);
    await normal.save(record(path));
    let published = false;
    const failingCleanup = store(path, {
        rename: async (...args) => { await fs.rename(...args); published = true; },
        readdir: async (...args) => { if (published) throw new Error('injected cleanup failure'); return fs.readdir(...args); }
    });
    await failingCleanup.save(record(path, 2));
    assert.equal((await normal.load(runId)).checkpointTurn, 2);
    assert.equal((await fs.readdir(path)).length, 2);
});

const platformSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', platformSource, ts.ScriptTarget.Latest, true);
const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
const method = service.members.find(node => ts.isMethodDeclaration(node)
    && node.name.getText(ast) === 'saveAgentJobRecoveryCheckpoint').getText(ast);
const js = ts.transpileModule(`class Harness { ${method} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const { AgentRunStateStoreError } = loadCurrentSource(new URL('../src/node/nextmux-agent-run-state-store.ts', import.meta.url));
const Harness = Function('AgentRunJournalError', 'AgentRunStateStoreError', `${js}; return Harness;`)
    (actual.AgentRunJournalError, AgentRunStateStoreError);

test('recovery attachment preserves possibly referenced state and removes only definite orphans', async () => {
    for (const uncertain of [false, true]) {
        const host = new Harness(), removed = [];
        host.agentJobs = new Map([[runId, { status: 'running' }]]);
        host.attachAgentJobRecoveryCheckpoint = async () => {
            throw new actual.AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'fixture', uncertain);
        };
        const checkpointStore = { save: async () => 'new-checkpoint', remove: async id => removed.push(id) };
        await assert.rejects(host.saveAgentJobRecoveryCheckpoint(runId, { nextTurn: 2 }, checkpointStore, {}),
            error => error.code === 'AGENT_RUN_JOURNAL_UNAVAILABLE');
        assert.deepEqual(removed, uncertain ? [] : ['new-checkpoint']);
    }
});

const attachMethod = service.members.find(node => ts.isMethodDeclaration(node)
    && node.name.getText(ast) === 'attachAgentJobRecoveryCheckpoint').getText(ast);
function attachHarness(now) {
    const compiled = ts.transpileModule(`class Harness { ${attachMethod} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    return new (Function('Date', `${compiled}; return Harness;`)({ now: () => now }))();
}
async function writeRevision(path, value) {
    const hash = createHash('sha256').update(value.runId).digest('hex');
    const target = join(path, `agent-run-${hash}-${randomUUID()}.json`);
    await fs.writeFile(target, JSON.stringify(value));
    return target;
}

for (const [name, nextTime] of [['same millisecond', 2000], ['clock rollback', 1500]]) {
    test(`committed ${name} revision survives cleanup failure and caller removal of old checkpoint`, async t => {
        const path = await directory(t), normal = store(path);
        const prior = { ...record(path), updatedAt: 2000 };
        await normal.save(prior);
        let published = false;
        const failingCleanup = store(path, {
            rename: async (...args) => { await fs.rename(...args); published = true; },
            readdir: async (...args) => { if (published) throw new Error('cleanup failed'); return fs.readdir(...args); }
        });
        const next = record(path, 2), checkpoints = new Set([prior.checkpointId, next.checkpointId]);
        const job = { recoveryRecord: prior, recoveryCheckpointId: prior.checkpointId, recoveryJournal: failingCleanup };
        await attachHarness(nextTime).attachAgentJobRecoveryCheckpoint(job, { remove: async id => checkpoints.delete(id) }, next.checkpointId, 2);
        const recovered = await normal.load(runId);
        assert.equal(recovered.checkpointId, next.checkpointId);
        assert.equal(recovered.journalRevision, 2);
        assert.equal(recovered.updatedAt, nextTime);
        assert.ok(checkpoints.has(recovered.checkpointId));
        assert.equal(checkpoints.has(prior.checkpointId), false);
        assert.equal((await fs.readdir(path)).length, 2);
    });
}

test('legacy single revision is read as zero and migrated without trusting incoming counter', async t => {
    const path = await directory(t);
    await writeRevision(path, record(path));
    const normal = store(path);
    assert.equal((await normal.load(runId)).journalRevision, undefined);
    await normal.save({ ...record(path, 2), journalRevision: 9876 });
    assert.equal((await normal.load(runId)).journalRevision, 1);
});

test('conflicting maximum revisions fail closed and cannot be overwritten by a later save', async t => {
    const path = await directory(t), normal = store(path);
    for (const revision of [undefined, 7]) {
        await fs.rm(path, { recursive: true }); await fs.mkdir(path);
        await writeRevision(path, { ...record(path), ...(revision === undefined ? {} : { journalRevision: revision }) });
        await writeRevision(path, { ...record(path, 2), ...(revision === undefined ? {} : { journalRevision: revision }) });
        const before = await fs.readdir(path);
        await assert.rejects(normal.load(runId), error => error.code === 'AGENT_RUN_JOURNAL_CONFLICT');
        await assert.rejects(normal.save(record(path, 3)), error => error.code === 'AGENT_RUN_JOURNAL_CONFLICT' && !error.checkpointReferenceMayExist);
        assert.deepEqual(await fs.readdir(path), before);
    }
});

test('read failures and malformed predecessor counters stop before publication', async t => {
    const path = await directory(t), normal = store(path);
    await normal.save(record(path));
    const before = await fs.readdir(path);
    for (const field of ['readdir', 'readFile']) {
        let renamed = false;
        const failing = store(path, { [field]: async () => { throw new Error('read failed'); },
            rename: async (...args) => { renamed = true; return fs.rename(...args); } });
        await assert.rejects(failing.save(record(path, 2)), error => error.code === 'AGENT_RUN_JOURNAL_UNAVAILABLE' && !error.checkpointReferenceMayExist);
        assert.equal(renamed, false);
        assert.deepEqual(await fs.readdir(path), before);
    }
    const existing = join(path, before[0]);
    await fs.writeFile(existing, JSON.stringify({ ...record(path), journalRevision: -1 }));
    await assert.rejects(normal.save(record(path, 2)), error => error.code === 'AGENT_RUN_JOURNAL_CORRUPT' && !error.checkpointReferenceMayExist);
    assert.deepEqual(await fs.readdir(path), before);
});

test('multiple store instances serialize revisions without losing increments', async t => {
    const path = await directory(t);
    await Promise.all(Array.from({ length: 8 }, (_, index) => store(path).save(record(path, index + 1))));
    const latest = await store(path).load(runId);
    assert.equal(latest.journalRevision, 8);
    assert.equal((await fs.readdir(path)).length, 1);
});

test('separate processes share the revision lock and persist every ordered increment', async t => {
    const path = await directory(t);
    const loader = new URL('./helpers/current-source-loader.mjs', import.meta.url).href;
    const program = `import { loadCurrentSource } from ${JSON.stringify(loader)};
        const { AgentRunJournalStore } = loadCurrentSource(new URL(${JSON.stringify(source.href)}));
        await new AgentRunJournalStore(process.argv[1]).save(JSON.parse(process.argv[2]));`;
    await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', program, path, JSON.stringify(record(path, index + 1))], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', value => { stderr += value; });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `child ${code}`)));
    })));
    assert.equal((await store(path).load(runId)).journalRevision, 4);
    assert.equal((await fs.readdir(path)).length, 1);
});

for (const afterPublish of [false, true]) {
    test(`lost writer lock ${afterPublish ? 'after' : 'before'} publication preserves replacement lock and signals reference uncertainty`, async t => {
        const path = await directory(t);
        await store(path).save(record(path));
        const lockPath = join(path, `.agent-run-${createHash('sha256').update(runId).digest('hex')}.lock`);
        const replace = async () => { await fs.rename(lockPath, `${lockPath}.old`); await fs.mkdir(lockPath); };
        const failing = store(path, afterPublish ? {
            rename: async (...args) => { await fs.rename(...args); await replace(); }
        } : {
            open: async (name, ...args) => {
                const handle = await fs.open(name, ...args);
                if (!String(name).includes('.tmp-')) return handle;
                return { writeFile: (...values) => handle.writeFile(...values), close: () => handle.close(),
                    sync: async () => { await handle.sync(); await replace(); } };
            }
        });
        await assert.rejects(failing.save(record(path, 2)), error => error.code === 'AGENT_RUN_JOURNAL_UNAVAILABLE' && error.checkpointReferenceMayExist === afterPublish);
        assert.equal((await fs.stat(lockPath)).isDirectory(), true);
        assert.equal((await fs.readdir(path)).filter(name => name.endsWith('.json')).length, afterPublish ? 2 : 1);
    });
}

test('parallel different runs keep independent lock identities and optional owner fields', async t => {
    const path = await directory(t);
    const values = ['independent-run-one', 'independent-run-two'].map(id => ({ ...record(path), runId: id,
        owner: { ...record(path).owner, rootRunId: id, workspaceBindingsKey: undefined } }));
    await Promise.all(values.map(value => store(path).save(value)));
    await Promise.all(values.map(value => store(path).save(value)));
    for (const value of values) assert.equal((await store(path).load(value.runId)).journalRevision, 2);
    assert.equal((await fs.readdir(path)).length, 2);
    await assert.rejects(store(path).save({ ...values[0], owner: { ...values[0].owner, conversationId: 'other-owner' } }),
        error => error.code === 'AGENT_RUN_JOURNAL_OWNER_MISMATCH' && !error.checkpointReferenceMayExist);
});
