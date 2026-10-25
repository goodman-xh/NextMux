import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

// Round 31 live run: comic scripts, pictures, voices and clips on an own API never reached 使用记录.
function logHost(root) {
    const proto = NextMuxPlatformServiceImpl.prototype;
    return Object.assign(Object.create(proto), { nextmuxDataRoot: () => root, ownApiUsageWrites: Promise.resolve() });
}

test('own-API comic calls are logged on this computer and listed newest first', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nmx-own-usage-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const host = logHost(root);
    host.recordOwnApiUsage({ id: 'run-1', at: 1_000, kind: 'text', connectionId: 'official-a', model: 'openai/gpt-5.6-terra',
        source: host.ownApiUsageSource('/Users/me/Documents/NextMux Comics/雪夜', false), inputTokens: 1200, outputTokens: 300, status: 'completed' });
    host.recordOwnApiUsage({ id: 'job-1', at: 2_000, kind: 'image', connectionId: 'official-a', model: 'recraft/recraft-v4.1-flash',
        source: host.ownApiUsageSource('/Users/me/Documents/NextMux Comics/.chats', false), status: 'completed' });
    await appendFile(join(root, 'own-api-usage-v1.jsonl'), 'not json\n{"id":1}\n');
    const entries = await host.listOwnApiUsage();
    assert.deepEqual(entries.map(entry => entry.id), ['job-1', 'run-1']);
    assert.deepEqual(entries[0].source, { kind: 'comic_chat' });
    assert.deepEqual(entries[1].source, { kind: 'comic', title: '雪夜' });
    assert.equal(entries[1].inputTokens, 1200);
    assert.match(await readFile(join(root, 'own-api-usage-v1.jsonl'), 'utf8'), /job-1/);
});

test('a missing log lists nothing', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nmx-own-usage-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    assert.deepEqual(await logHost(root).listOwnApiUsage(), []);
});

test('own-API coding calls persist source.kind = coding with token usage', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nmx-own-usage-coding-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const host = logHost(root);
    host.recordOwnApiUsage({ id: 'coding-turn-1', at: 5_000, kind: 'text', connectionId: 'official-a', model: 'claude-sonnet-4-5',
        source: { kind: 'coding', title: '修复应用操控队列显示' }, inputTokens: 2500, outputTokens: 800, status: 'completed' });
    const entries = await host.listOwnApiUsage();
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].source, { kind: 'coding', title: '修复应用操控队列显示' });
    assert.equal(entries[0].inputTokens, 2500);
    assert.equal(entries[0].outputTokens, 800);
});
