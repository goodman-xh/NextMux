import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { executeBrowserPageCommand, runBrowserPageAction, browserConversationKey, browserWorkspaceMatches, findOwnedBrowser } from '../lib/browser/nextmux-browser-automation.js';

function page() {
    let document;
    class Element {
        constructor(tag = 'BUTTON', name = 'Run') { this.tagName = tag; this.innerText = name; this.textContent = name; this.isConnected = true; this.visible = true; this.disabled = false; this.attrs = {}; this.listeners = new Map(); this.ownerDocument = document; }
        getAttribute(key) { return this.attrs[key] ?? null; }
        getBoundingClientRect() { return { x: 10, y: 10, width: this.visible ? 100 : 0, height: 30 }; }
        closest() { return null; }
        matches(selector) { if (selector.includes(':disabled')) return this.disabled; if (selector.includes('[readonly]')) return this.readonly; return true; }
        getRootNode() { return document; }
        contains(element) { return element === this; }
        scrollIntoView() {}
        addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
        removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== listener)); }
        dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); return true; }
        click() { this.dispatchEvent({ type: 'click' }); document.body.innerText = 'Action done'; }
    }
    class Input extends Element {
        constructor() { super('INPUT', 'Name'); this.type = 'text'; this._value = ''; }
        get value() { return this._value; }
        set value(value) { this._value = value; }
    }
    class TextArea extends Input {}
    const targets = [];
    document = { readyState: 'complete', title: 'Fixture', body: { innerText: 'Before' },
        querySelectorAll(selector) { if (selector === '[') throw new Error('invalid'); if (selector === '.missing') return []; return targets; },
        getElementById() { return undefined; }, elementFromPoint() { return document.hit || targets[0]; } };
    const context = vm.createContext({ window: {}, document, location: { href: 'https://fixture.test/' },
        getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
        HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: TextArea,
        Event: class { constructor(type) { this.type = type; } }, setTimeout, Map, Date, Math });
    const executeJavaScript = async source => vm.runInContext(source, context);
    const command = value => executeJavaScript(`(${executeBrowserPageCommand.toString()})(${JSON.stringify(value)})`);
    return { targets, Element, Input, document, command, surface: { executeJavaScript } };
}

test('snapshot produces tab-document refs and rejects refs from an older snapshot', async () => {
    const p = page(); p.targets.push(new p.Element());
    const first = await p.command({ action: 'snapshot' });
    assert.equal(first.elements[0].name, 'Run');
    const ref = first.elements[0].ref;
    await p.command({ action: 'snapshot' });
    const stale = await p.command({ action: 'click', ref });
    assert.equal(stale.ok, false); assert.equal(stale.code, 'STALE_ELEMENT_REF');
});

test('observed ref cannot silently redirect to replacement DOM element', async () => {
    const p = page(), button = new p.Element(); p.targets.push(button);
    const shot = await p.command({ action: 'snapshot' }); button.isConnected = false;
    p.targets.splice(0, 1, new p.Element());
    assert.equal((await p.command({ action: 'click', ref: shot.elements[0].ref })).code, 'STALE_ELEMENT_REF');
});

test('click waits until a disabled target becomes enabled, then verifies a fresh page', async () => {
    const p = page(), button = new p.Element(); p.targets.push(button); button.disabled = true;
    setTimeout(() => { button.disabled = false; }, 130);
    const result = await runBrowserPageAction(p.surface, { id: 'req', action: 'click', selector: 'button', timeoutMs: 1_000 });
    assert.equal(result.ok, true); assert.equal(result.data.pageChanged, true);
    assert.equal(result.data.snapshot.text, 'Action done');
    assert.equal(result.data.verification, 'event-delivered-and-page-observed');
});

test('hidden, covered, ambiguous and malformed targets report failure', async () => {
    const p = page(), button = new p.Element(); p.targets.push(button); button.visible = false;
    assert.equal((await p.command({ action: 'click', selector: 'button', timeoutMs: 100 })).ok, false);
    button.visible = true; p.document.hit = new p.Element('DIV', 'Overlay');
    assert.equal((await p.command({ action: 'click', selector: 'button', timeoutMs: 200 })).code, 'ELEMENT_NOT_ACTIONABLE');
    p.targets.push(new p.Element());
    assert.equal((await p.command({ action: 'click', selector: 'button' })).code, 'AMBIGUOUS_ELEMENT');
    assert.equal((await p.command({ action: 'click', selector: '[' })).code, 'INVALID_SELECTOR');
});

test('fill uses native value setter and detects a controlled field rejecting the new value', async () => {
    const p = page(), input = new p.Input(); p.targets.push(input);
    const success = await p.command({ action: 'fill', selector: 'input', text: 'Alice' });
    assert.equal(success.ok, true); assert.equal(input.value, 'Alice');
    input.addEventListener('input', () => { input.value = ''; });
    const rejected = await p.command({ action: 'fill', selector: 'input', text: 'Bob' });
    assert.equal(rejected.ok, false); assert.equal(rejected.code, 'FILL_NOT_RETAINED');
});

test('password values are never included in snapshots', async () => {
    const p = page(), input = new p.Input(); input.type = 'password'; input.value = 'secret-value'; p.targets.push(input);
    const snapshot = await p.command({ action: 'snapshot' });
    assert.equal(JSON.stringify(snapshot).includes('secret-value'), false);
});

test('browser ownership is per conversation even in a shared workspace', () => {
    const tabs = [{ id: 'a', conversationId: 'conversation-a' }, { id: 'b', conversationId: 'conversation-b' }];
    assert.notEqual(browserConversationKey('conversation-a'), browserConversationKey('conversation-b'));
    assert.equal(findOwnedBrowser(tabs, 'a', 'conversation-b'), undefined);
    assert.equal(findOwnedBrowser(tabs, 'a', 'conversation-a'), tabs[0]);
    assert.equal(browserWorkspaceMatches('C:\\Work\\App', 'c:/work/app/'), true);
    assert.equal(browserWorkspaceMatches('/Users/A', '/Users/B'), false);
});

test('cancellation while awaiting actionability prevents a later click', async () => {
    const p = page(), button = new p.Element(); p.targets.push(button); button.disabled = true;
    let active = true, clicks = 0;
    button.addEventListener('click', () => { clicks++; });
    setTimeout(() => { active = false; }, 70);
    setTimeout(() => { button.disabled = false; }, 350);
    const result = await runBrowserPageAction(p.surface, { id: 'cancelled-request', action: 'click', selector: 'button', timeoutMs: 1_000 }, async () => active);
    assert.equal(result.ok, false); assert.equal(clicks, 0);
});

test('expired command never mutates the page', async () => {
    const p = page(), input = new p.Input(); p.targets.push(input);
    const result = await p.command({ action: 'fill', selector: 'input', text: 'late', expiresAt: Date.now() - 1 });
    assert.equal(result.code, 'CANCELLED'); assert.equal(input.value, '');
});

test('desktop forwards iframe and upload requests to the exact owned webview without DOM fallback', async () => {
    const original = globalThis.window, calls = [];
    globalThis.window = { nextmuxDesktop: { performBrowserAction: async (...args) => { calls.push(args); return { requestId: 'native', ok: true }; } } };
    try {
        const request = { id: 'native', action: 'upload', conversationId: 'owner', browserId: 'tab', workspaceRoot: '/work',
            frameId: 'frame', ref: 'element', paths: ['/work/file.txt'], expiresAt: Date.now() + 5000 };
        const result = await runBrowserPageAction({ getWebContentsId: () => 42, executeJavaScript: async () => { throw Error('must not fall back'); } }, request);
        assert.equal(result.ok, true);
        assert.deepEqual(calls, [[42, request]]);
    } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test('desktop operation cancelled before dispatch never reaches native IPC', async () => {
    const original = globalThis.window;
    globalThis.window = { nextmuxDesktop: { performBrowserAction: async () => { throw Error('cancelled operation was dispatched'); } } };
    try {
        const result = await runBrowserPageAction({ getWebContentsId: () => 42, executeJavaScript: async () => { throw Error('must not fall back'); } },
            { id: 'cancel', action: 'click', conversationId: 'owner', browserId: 'tab', workspaceRoot: '/work' }, async () => false);
        assert.equal(result.ok, false);
    } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test('native success arriving before the cancellation poll cannot complete a stopped request', async () => {
    const original = globalThis.window;
    let active = true, calls = 0;
    globalThis.window = { nextmuxDesktop: { performBrowserAction: async () => {
        calls++; active = false;
        return { requestId: 'late-native', ok: true };
    } } };
    try {
        const result = await runBrowserPageAction({ getWebContentsId: () => 42 },
            { id: 'late-native', action: 'snapshot', conversationId: 'owner', browserId: 'tab', workspaceRoot: '/work' }, async () => active);
        assert.equal(calls, 1); assert.equal(result.ok, false);
        assert.match(result.message, /cancelled/i);
    } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test('a snapshot returned after cancellation is discarded in the web host', async () => {
    let active = true;
    const result = await runBrowserPageAction({ executeJavaScript: async () => {
        active = false; return { ok: true, action: 'snapshot', text: 'late observation' };
    } }, { id: 'late-web', action: 'snapshot' }, async () => active);
    assert.equal(result.ok, false); assert.equal(result.data, undefined);
});

test('stopping during post-click observation does not report success or click again', async () => {
    const p = page(), button = new p.Element(); p.targets.push(button);
    let active = true, clicks = 0;
    button.addEventListener('click', () => { clicks++; });
    const result = await runBrowserPageAction({ executeJavaScript: async source => {
        const value = await p.surface.executeJavaScript(source);
        if (value?.snapshotId) active = false;
        return value;
    } }, { id: 'late-click', action: 'click', selector: 'button' }, async () => active);
    assert.equal(clicks, 1); assert.equal(result.ok, false); assert.equal(result.data, undefined);
});

test('shadow DOM hit-testing pierces nested shadowRoot and controlled input retry retains value', async () => {
    const p = page();
    const host = new p.Element('custom-input'), inner = new p.Input();
    host.shadowRoot = {
        querySelectorAll: () => [inner],
        elementFromPoint: () => inner,
        contains: node => node === inner
    };
    inner.getRootNode = () => host.shadowRoot;
    p.targets.push(host);
    const snap = await p.command({ action: 'snapshot' });
    assert.equal(snap.ok, true);
    const inputRef = snap.elements.find(el => el.role === 'input').ref;
    let firstEvent = true;
    inner.addEventListener('input', () => {
        if (firstEvent) {
            firstEvent = false;
            inner.value = '';
        }
    });
    const filled = await p.command({ action: 'fill', ref: inputRef, text: 'controlled-text' });
    assert.equal(filled.ok, true);
    assert.equal(inner.value, 'controlled-text');
});
