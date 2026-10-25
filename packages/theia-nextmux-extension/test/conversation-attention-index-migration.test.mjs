import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';
import { conversationAttention } from '../lib/common/nextmux-conversation-attention.js';

test('an old projection rebuilds runtime provenance and attention once without rewriting conversation bodies or the manifest', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-attention-migration-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const now = Date.now();
    const makeSession = (id, turn) => ({ id, workspacePath: '/project', title: id,
        createdAt: now, updatedAt: now, pinned: false,
        turns: [{ id: `${id}-turn`, prompt: 'retained user message', response: '', createdAt: now, ...turn }] });
    const original = [
        makeSession('branch', { stage: 'complete', completedAt: now, branchUserOnly: true }),
        makeSession('waiting', { stage: 'running', events: [{ type: 'user_input_requested', at: new Date(now).toISOString(),
            question: { runId: 'run-waiting', taskId: 'waiting', questionId: 'question-waiting',
                createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
                prompt: 'private pending question text' } }] }),
        makeSession('runtime-final', { stage: 'paused', response: '任务已暂停，可从检查点继续。', error: '旧界面错误',
            stopReason: 'pause_requested', finalMessage: { origin: 'runtime', stopReason: 'pause_requested', params: { count: 2 } },
            failure: { code: 'MODEL_TIMEOUT', kind: 'model_timeout', message: '旧界面错误' } }),
    ];
    await new ConversationStore(root).save(original);
    const manifestPath = join(root, 'manifest-v1.json');
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const bodies = new Map(await Promise.all(manifest.sessions.map(async entry =>
        [entry.file, await readFile(join(root, entry.file))])));
    const indexPath = join(root, 'index-v1.sqlite');
    const oldIndex = new DatabaseSync(indexPath);
    try {
        // Keep the generation current: only the projection schema version can invalidate it.
        assert.equal(oldIndex.prepare("SELECT value FROM metadata WHERE key = 'generation'").get().value, manifest.generation);
        oldIndex.prepare("UPDATE metadata SET value = '2' WHERE key = 'summary_version'").run();
        for (const row of oldIndex.prepare('SELECT id, summary FROM sessions').all()) {
            const summary = JSON.parse(row.summary);
            delete summary.latestTurn.branchUserOnly;
            delete summary.latestTurn.attention;
            oldIndex.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(JSON.stringify(summary), row.id);
        }
        for (const row of oldIndex.prepare('SELECT id, search_record FROM sessions').all()) {
            const record = JSON.parse(row.search_record);
            for (const message of record.messages) {
                delete message.finalMessage;
                delete message.stopReason;
                delete message.failure;
            }
            oldIndex.prepare('UPDATE sessions SET search_record = ? WHERE id = ?').run(JSON.stringify(record), row.id);
        }
    } finally { oldIndex.close(); }

    const reader = new ConversationStore(root);
    let bodyReads = 0;
    const read = reader.readFile;
    reader.readFile = async (path, ...args) => {
        if (bodies.has(basename(String(path)))) bodyReads++;
        return read(path, ...args);
    };
    const page = await reader.list({ limit: 10 });
    assert.equal(page.status, 'ok');
    assert.equal(page.total, 3);
    assert.equal(bodyReads, 3, 'the first list rebuilds each old projection from its authoritative body');
    const branch = page.sessions.find(session => session.id === 'branch');
    const waiting = page.sessions.find(session => session.id === 'waiting');
    assert.equal(branch.latestTurn.branchUserOnly, true);
    assert.equal(conversationAttention(branch.id, branch.latestTurn), undefined);
    assert.equal(conversationAttention(waiting.id, waiting.latestTurn).kind, 'question');
    assert.deepEqual(waiting.turns, []);
    assert.equal(waiting.historyLoaded, false);
    assert.equal(JSON.stringify(page.sessions).includes('private pending question text'), false);

    const restarted = new ConversationStore(root);
    restarted.readFile = reader.readFile;
    await restarted.list({ limit: 10 });
    await restarted.search({ query: 'retained user message' });
    assert.equal(bodyReads, 3, 'the upgraded projection stays lazy across a store restart and search');
    const [runtimeRecord] = await restarted.searchRecords({ conversationId: 'runtime-final' });
    const assistant = runtimeRecord.messages.find(message => message.id.endsWith(':assistant'));
    assert.equal(assistant.response, '任务已暂停，可从检查点继续。', 'UI search retains the original stored text');
    assert.equal(assistant.error, '旧界面错误');
    assert.deepEqual(assistant.finalMessage, { origin: 'runtime', stopReason: 'pause_requested', params: { count: 2 } });
    assert.equal(assistant.stopReason, 'pause_requested');
    assert.deepEqual(assistant.failure, { code: 'MODEL_TIMEOUT', kind: 'model_timeout' });
    const upgraded = new DatabaseSync(indexPath);
    try {
        assert.equal(upgraded.prepare("SELECT value FROM metadata WHERE key = 'summary_version'").get().value, '3');
        assert.equal(upgraded.prepare("SELECT value FROM metadata WHERE key = 'generation'").get().value, manifest.generation);
    } finally { upgraded.close(); }
    assert.deepEqual(await readFile(manifestPath), manifestBytes, 'the manifest generation and bytes stay unchanged');
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('session-')).sort(), [...bodies.keys()].sort());
    for (const [file, bytes] of bodies) assert.deepEqual(await readFile(join(root, file)), bytes, file);
});
