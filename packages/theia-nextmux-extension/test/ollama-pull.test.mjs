import assert from 'node:assert/strict';
import test from 'node:test';
import { runOllamaPull } from '../lib/node/nextmux-ollama-pull.js';
import { ollamaPullLocales, ollamaPullText } from '../lib/browser/nextmux-ollama-pull-locale.js';

// LobeChat #13: a model the Ollama server lacks is downloaded from the failed reply, with real progress.
const stream = (lines, { split = 7 } = {}) => {
    const text = lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n';
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new ReadableStream({ pull(controller) {
        if (offset >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.subarray(offset, offset + split));
        offset += split;
    } });
};
const pull = async (body, init = {}) => {
    const updates = [];
    let state = { model: 'qwen2.5:7b', status: 'pulling', completedBytes: 0, totalBytes: 0 };
    let request;
    await runOllamaPull({ endpoint: 'http://127.0.0.1:11434/api/pull', model: 'qwen2.5:7b',
        fetch: async (url, options) => { request = { url, options }; return new Response(body, { status: init.status ?? 200 }); },
        update: next => { state = { ...state, ...next }; updates.push(state); } });
    return { state, updates, request };
};

test('progress is summed over the layers and the download ends with Ollama\'s success line', async () => {
    const { state, updates, request } = await pull(stream([
        { status: 'pulling manifest' },
        { status: 'pulling 6a0746a1ec1a', digest: 'sha256:a', total: 4_000, completed: 1_000 },
        { status: 'pulling 4fa551d4f938', digest: 'sha256:b', total: 1_000, completed: 0 },
        'not json',
        { status: 'pulling 6a0746a1ec1a', digest: 'sha256:a', total: 4_000, completed: 4_000 },
        { status: 'pulling 4fa551d4f938', digest: 'sha256:b', total: 1_000, completed: 500 },
        { status: 'verifying sha256 digest' },
        { status: 'success' }
    ]));
    assert.equal(request.url, 'http://127.0.0.1:11434/api/pull');
    assert.deepEqual(JSON.parse(request.options.body), { model: 'qwen2.5:7b', stream: true });
    assert.deepEqual(updates.map(update => [update.step, update.completedBytes, update.totalBytes]).slice(0, 6), [
        ['pulling manifest', 0, 0], ['pulling 6a0746a1ec1a', 1_000, 4_000], ['pulling 4fa551d4f938', 1_000, 5_000],
        ['pulling 6a0746a1ec1a', 4_000, 5_000], ['pulling 4fa551d4f938', 4_500, 5_000], ['verifying sha256 digest', 4_500, 5_000]
    ]);
    assert.equal(state.status, 'completed');
    assert.equal(state.completedBytes, 5_000);
});

test('an error line, an HTTP failure or a stream cut short ends as a failure with the reason', async () => {
    const failedLine = await pull(stream([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]));
    assert.equal(failedLine.state.status, 'failed');
    assert.equal(failedLine.state.error, 'pull model manifest: file does not exist');
    const http = await pull('nope', { status: 500 });
    assert.equal(http.state.status, 'failed');
    assert.match(http.state.error, /HTTP 500/);
    const cut = await pull(stream([{ status: 'pulling 6a07', digest: 'sha256:a', total: 10, completed: 5 }]));
    assert.equal(cut.state.status, 'failed');
    assert.match(cut.state.error, /ended before Ollama reported success/);
});

test('the download action speaks every interface language', () => {
    for (const locale of ollamaPullLocales) {
        for (const key of ['pull', 'pulling', 'pullingStep', 'pulled', 'pullAgain', 'failed']) {
            const text = ollamaPullText(locale, key, { model: 'llama3', percent: '42%', step: 'pulling manifest', error: 'x' });
            assert.ok(text.includes('llama3') || key === 'failed', `${locale}.${key}`);
            assert.doesNotMatch(text, /\{\w+\}/, `${locale}.${key} fills every value`);
        }
    }
    assert.equal(ollamaPullText('zh-CN', 'pulling', { model: 'qwen2.5:7b', percent: '42%' }), '正在下载 qwen2.5:7b · 42%');
});
