import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const browser = new URL('../src/browser/', import.meta.url);
const { SURFACE_LITERAL_SELECTOR, SURFACE_CONTENT_SELECTOR, SURFACE_FIELD_SELECTOR, isSurfaceLiteral, forEachSurfaceTextNode } = loadCurrentSource(new URL('nextmux-surface-walk.ts', browser));

/** A minimal element whose closest() understands the comma-separated tag/.class/[attr]/[attr="v"] selectors used here. */
function element(tag, { classes = [], attrs = {}, parent = null } = {}) {
    const node = { tag, classes, attrs, parent };
    const matchesOne = (target, selector) => {
        selector = selector.trim();
        if (selector.startsWith('.')) return target.classes.includes(selector.slice(1));
        const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
        if (attribute) return attribute[1] in target.attrs && (attribute[2] === undefined || target.attrs[attribute[1]] === attribute[2]);
        return target.tag === selector;
    };
    node.closest = selector => {
        for (let current = node; current; current = current.parent) if (selector.split(',').some(part => matchesOne(current, part))) return current;
        return null;
    };
    return node;
}

test('content subtrees are literal for text and attributes; fields are literal only for their text', () => {
    for (const token of ['[data-nmx-literal]', '.monaco-editor', '.xterm', '.nmx-terminal-host', 'pre', 'code',
        '.nmx-user-markdown', '.nmx-assistant-markdown', '.nmx-message-pasted-chip']) {
        assert.ok(SURFACE_CONTENT_SELECTOR.includes(token), `content selector includes ${token}`);
        assert.ok(SURFACE_LITERAL_SELECTOR.includes(token), `the text walk skips ${token}`);
    }
    for (const token of ['textarea', 'input', '[contenteditable="true"]']) {
        assert.ok(SURFACE_FIELD_SELECTOR.includes(token), `field selector includes ${token}`);
        assert.ok(SURFACE_LITERAL_SELECTOR.includes(token), `the text walk skips ${token}`);
        assert.ok(!SURFACE_CONTENT_SELECTOR.includes(token), `${token} placeholders and titles stay translatable`);
    }
    const shell = element('div', { classes: ['nmx-shell'] });
    // A field's placeholder/title/aria-label is UI chrome (for example "例如：每天检查待办事项").
    assert.equal(isSurfaceLiteral(element('input', { attrs: { placeholder: '例如' }, parent: shell })), false);
    assert.equal(isSurfaceLiteral(element('textarea', { parent: shell })), false);
    // What the user or the model wrote keeps its attributes as written.
    const reply = element('div', { classes: ['nmx-assistant-markdown'], parent: shell });
    assert.equal(isSurfaceLiteral(element('a', { attrs: { title: 'fable5.1' }, parent: reply })), true);
    assert.equal(isSurfaceLiteral(element('span', { parent: element('pre', { parent: shell }) })), true);
    assert.equal(isSurfaceLiteral(element('button', { parent: element('div', { attrs: { 'data-nmx-literal': '' }, parent: shell }) })), true);
    assert.equal(isSurfaceLiteral(element('button', { parent: shell })), false);
    assert.equal(isSurfaceLiteral(null), false);
});

test('forEachSurfaceTextNode skips subtrees matching SURFACE_LITERAL_SELECTOR', () => {
    const visited = [];
    const root = {
        closest: () => null,
        ownerDocument: {
            createTreeWalker(_root, _whatToShow, filter) {
                const nodes = [
                    { nodeType: 1, matches: sel => sel === SURFACE_LITERAL_SELECTOR, isLiteralElement: true },
                    { nodeType: 3, data: '立即充值' }
                ];
                let idx = 0;
                return {
                    nextNode() {
                        while (idx < nodes.length) {
                            const node = nodes[idx++];
                            const decision = filter.acceptNode(node);
                            if (decision === 1) return node; // FILTER_ACCEPT
                        }
                        return null;
                    }
                };
            }
        }
    };
    const prevNodeFilter = globalThis.NodeFilter;
    const prevNode = globalThis.Node;
    globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
    globalThis.Node = { ELEMENT_NODE: 1 };
    try {
        forEachSurfaceTextNode(root, node => visited.push(node.data));
    } finally {
        globalThis.NodeFilter = prevNodeFilter;
        globalThis.Node = prevNode;
    }
    assert.deepEqual(visited, ['立即充值']);
});

test('pasted text chip and searching assistant markdown carry data-nmx-literal markers', () => {
    const pasteQueueSource = readFileSync(new URL('nextmux-composer-paste-queue.ts', browser), 'utf8');
    assert.match(pasteQueueSource, /className:\s*'nmx-message-pasted-chip__title',\s*'data-nmx-literal':\s*true/);
    assert.match(pasteQueueSource, /className:\s*'nmx-message-pasted-chip__preview',\s*'data-nmx-literal':\s*true/);

    const widgetSource = readFileSync(new URL('nextmux-desktop-widget.tsx', browser), 'utf8');
    assert.match(widgetSource, /className='nmx-assistant-markdown is-searching'\s+data-nmx-literal/);
});
