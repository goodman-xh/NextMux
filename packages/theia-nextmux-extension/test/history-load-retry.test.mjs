import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { outputFiles } = desktopRequire('esbuild').buildSync({
    entryPoints: [fileURLToPath(new URL('../src/browser/nextmux-history-load.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
});
const module = { exports: {} };
Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
const { loadConversationHistoryWithRetry } = module.exports;

test('transient history IPC failures recover the full original result after bounded delays', async () => {
    const record = { sessions: [{ id: 'history', turns: Array.from({ length: 20 }, (_, id) => ({ id, response: 'Full response'.repeat(1000) })) }] };
    const delays = []; let reads = 0;
    const actual = await loadConversationHistoryWithRetry(async () => {
        if (++reads < 3) throw new Error('IPC disconnected');
        return record;
    }, () => true, async delay => { delays.push(delay); });
    assert.equal(actual, record);
    assert.equal(reads, 3);
    assert.deepEqual(delays, [150, 400]);
});

test('permanent history failures propagate without producing an empty success or retrying', async () => {
    for (const code of ['INVALID_STORE_ROOT', 'INVALID_SESSION', 'TOO_LARGE', 'UNSUPPORTED_VERSION', 'STORE_CORRUPT', 'STORE_UNSAFE']) {
        const error = Object.assign(new Error(code), { code }); let reads = 0;
        await assert.rejects(loadConversationHistoryWithRetry(async () => { reads++; throw error; }, () => true,
            async () => { assert.fail('permanent store error must not retry'); }), value => value === error);
        assert.equal(reads, 1);
    }
});

test('exhausted transient retries preserve the original error and never synthesize history', async () => {
    const error = new Error('store temporarily unavailable'); let reads = 0;
    await assert.rejects(loadConversationHistoryWithRetry(async () => { reads++; throw error; }, () => true, async () => {}), value => value === error);
    assert.equal(reads, 3);
});

test('a disposed or superseded request never launches another read after its retry delay', async () => {
    let active = true, reads = 0;
    await assert.rejects(loadConversationHistoryWithRetry(async () => { reads++; throw new Error('IPC unavailable'); },
        () => active, async () => { active = false; }), /HISTORY_READ_CANCELLED/);
    assert.equal(reads, 1);
    await assert.rejects(loadConversationHistoryWithRetry(async () => { assert.fail('read after disposal'); }, () => false), /HISTORY_READ_CANCELLED/);
});

test('cancellation while the request is in flight returns its rejection without retrying', async () => {
    let active = true;
    const error = new Error('closed IPC');
    await assert.rejects(loadConversationHistoryWithRetry(async () => { active = false; throw error; }, () => active,
        async () => { assert.fail('retry after cancellation'); }), value => value === error);
});
