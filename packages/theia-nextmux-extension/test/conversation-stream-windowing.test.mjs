import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const filename = fileURLToPath(new URL('./conversation-stream-windowing-runtime.cjs', import.meta.url));
const { outputFiles } = await desktop('esbuild').build({
    entryPoints: [fileURLToPath(new URL('../src/browser/nextmux-conversation-stream.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external'
});
const runtime = new Module(filename);
runtime.filename = filename;
runtime.paths = Module._nodeModulePaths(dirname(filename));
runtime._compile(outputFiles[0].text, filename);
const { ConversationStream } = runtime.exports;
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const props = {
    locale: 'en', label: 'Activity', planLabel: 'Plan', idPrefix: 'windowing',
    renderMarkdown: text => React.createElement('p', { 'data-prose': true }, text),
    renderTerminal: () => null,
    renderSteering: item => React.createElement('div', { 'data-steering': true }, item.message.content),
    onOpen: () => {}, onRestore: () => {}
};
function projection(rowCount) {
    const items = [];
    const prose = suffix => items.push(
        { kind: 'text', key: `text-${suffix}`, text: `prose-${suffix}`, streaming: false },
        { kind: 'steering', key: `steering-${suffix}`, message: { id: suffix, content: `steering-${suffix}`, createdAt: '' }, applied: false }
    );
    prose('start');
    for (let index = 0; index < rowCount; index++) {
        if (index === Math.floor(rowCount / 2)) prose('middle');
        items.push({ kind: 'row', key: `row-${index}`, activity: 'command', title: 'Ran', target: `command-${index}`, icon: 'terminal', tone: 'done' });
    }
    prose('end');
    return { items, plan: [], idleCaret: false, streamTail: { state: 'complete' } };
}
const render = (projected, overrides = {}) => renderToStaticMarkup(React.createElement(ConversationStream, { ...props, projection: projected, ...overrides }));
const rowCount = html => [...html.matchAll(/class="nmx-stream-row\b/g)].length;

test('a 10,000-row stream mounts only its newest 240 activities and retains all prose and steering in order', () => {
    const html = render(projection(10000));
    assert.equal(rowCount(html), 240);
    assert.match(html, />command-9760</);
    assert.match(html, />command-9999</);
    assert.doesNotMatch(html, />command-(?:0|9759)</);
    assert.match(html, /<section[^>]*><button[^>]*nmx-stream-earlier-activity[^>]*>\+ 9760<\/button>/);
    const expectedOrder = ['prose-start', 'steering-start', 'prose-middle', 'steering-middle', 'command-9760', 'command-9999', 'prose-end', 'steering-end'];
    let position = -1;
    for (const content of expectedOrder) {
        const nextPosition = html.indexOf(content);
        assert.ok(nextPosition > position, `${content} retains its place in the journal`);
        position = nextPosition;
    }
});

test('Find exposes every old activity while a blank query keeps the window', () => {
    const projected = projection(10000);
    const html = render(projected, { searchQuery: 'command-0' });
    assert.equal(rowCount(html), 10000);
    assert.match(html, /<mark[^>]*>command-0<\/mark>/);
    assert.doesNotMatch(html, /nmx-stream-earlier-activity/);
    assert.equal(rowCount(render(projected, { searchQuery: '   ' })), 240);
});

test('normal turns retain their existing contents without additional controls or wrappers', () => {
    for (const count of [0, 234, 240]) {
        const html = render(projection(count));
        assert.equal(rowCount(html), count);
        assert.doesNotMatch(html, /nmx-stream-earlier-activity/);
        assert.match(html, /<section[^>]*><div class="nmx-agent-narration nmx-stream-text"/);
        assert.equal([...html.matchAll(/data-prose="true"/g)].length, count ? 3 : 2);
        assert.equal([...html.matchAll(/data-steering="true"/g)].length, count ? 3 : 2);
    }
    assert.match(render(projection(241)), /nmx-stream-earlier-activity[^>]*>\+ 1<\/button>/);
});
