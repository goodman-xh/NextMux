import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { updateScheduledTaskStore } = require('../lib/node/nextmux-schedule-store');
const LIMIT = 16 * 1024 * 1024;
const task = () => ({ id: randomUUID(), title: '中文计划', prompt: '中'.repeat(12_000), workspacePath: '/project',
    cadence: 'daily', runAt: '09:00', createdAt: Date.now(), enabled: true });
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'nm-schedule-utf8-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return { root, target: join(root, 'tasks.json') };
}

test('schedule writes enforce the same UTF-8 byte budget as reads without replacing the last valid file', async t => {
    const { root, target } = await fixture(t), initial = task();
    await updateScheduledTaskStore(root, { upsert: [initial], remove: [] });
    const before = await readFile(target);
    await assert.rejects(updateScheduledTaskStore(root, { upsert: Array.from({ length: 470 }, task), remove: [] }), { code: 'SCHEDULE_STORE_TOO_LARGE' });
    assert.deepEqual(await readFile(target), before);
    assert.deepEqual((await updateScheduledTaskStore(root)).map(item => item.id), [initial.id]);
});

test('legacy oversized Chinese plans remain readable and progressively shrink without data loss', async t => {
    const { root, target } = await fixture(t), tasks = Array.from({ length: 475 }, task);
    const legacy = JSON.stringify({ version: 1, tasks });
    assert.ok(legacy.length < LIMIT); assert.ok(Buffer.byteLength(legacy) > LIMIT);
    await writeFile(target, legacy);
    assert.equal((await updateScheduledTaskStore(root)).length, tasks.length);
    await assert.rejects(updateScheduledTaskStore(root, { upsert: [task()], remove: [] }), { code: 'SCHEDULE_STORE_TOO_LARGE' });
    assert.equal(await readFile(target, 'utf8'), legacy);
    await updateScheduledTaskStore(root, { upsert: [], remove: [tasks[0].id] });
    const partial = await stat(target); assert.ok(partial.size > LIMIT); assert.ok(partial.size < Buffer.byteLength(legacy));
    assert.equal((await updateScheduledTaskStore(root)).length, 474);
    await assert.rejects(updateScheduledTaskStore(root, { upsert: [task()], remove: [tasks[1].id, tasks[2].id] }), { code: 'SCHEDULE_STORE_TOO_LARGE' });
    assert.equal((await stat(target)).size, partial.size);
    const remaining = await updateScheduledTaskStore(root, { upsert: [], remove: tasks.slice(1, 25).map(item => item.id) });
    assert.ok((await stat(target)).size < LIMIT);
    assert.deepEqual(remaining.map(item => item.id).sort(), tasks.slice(25).map(item => item.id).sort());
    const added = task(); await updateScheduledTaskStore(root, { upsert: [added], remove: [] });
    assert.equal((await updateScheduledTaskStore(root)).length, 451);
});

test('bounded legacy recovery rejects larger or malformed stores without changing them', async t => {
    const { root, target } = await fixture(t);
    const file = await open(target, 'w'); try { await file.truncate(LIMIT * 3 + 1); } finally { await file.close(); }
    await assert.rejects(updateScheduledTaskStore(root, { upsert: [], remove: [] }), { code: 'SCHEDULE_STORE_TOO_LARGE' });
    assert.equal((await stat(target)).size, LIMIT * 3 + 1);
    await writeFile(target, '{broken');
    await assert.rejects(updateScheduledTaskStore(root, { upsert: [task()], remove: [] }));
    assert.equal(await readFile(target, 'utf8'), '{broken');
});
