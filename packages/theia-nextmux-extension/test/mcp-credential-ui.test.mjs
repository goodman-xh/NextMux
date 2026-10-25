import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { McpCredentialEditor } from '../lib/browser/nextmux-mcp-credential-editor.js';
import { McpAccessPanel } from '../lib/browser/nextmux-mcp-access-panel.js';
import { mcpCredentialText } from '../lib/browser/nextmux-mcp-credential-locale.js';
import { mcpUserCredentialConfigurable, saveMcpCredentialSettings } from '../lib/browser/nextmux-mcp-credential-settings.js';
import { createMcpAccessRefresh } from '../lib/browser/nextmux-mcp-access-refresh.js';
const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const ref = { id: '11111111-1111-4111-8111-111111111111', revision: '22222222-2222-4222-8222-222222222222', kind: 'bearer' };
const server = { name: 'fixture', fingerprint: 'f'.repeat(64), local: false, credentialEditable: true, connection: 'https://fixture.invalid', details: '{}', approved: false, running: false, needsReview: false, tools: [], credential: ref };
const props = { server, locale: 'en', busy: false, onSave: async () => true, onCancel() {} };
const walk = element => !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(walk)];
const find = (tree, type) => walk(tree).find(item => item.type === type);
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };

// Isolated React hook/handler contracts, not a browser or full React lifecycle test.
function harness(component, initial, states = []) {
    let current = initial; const slots = [...states]; let index = 0;
    return { setProps(value) { current = value; }, render() {
        const pointer = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
        const previous = pointer.current; index = 0;
        pointer.current = {
            useState(value) { const at = index++; if (!(at in slots)) slots[at] = typeof value === 'function' ? value() : value; return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; },
            useRef(value) { const at = index++; if (!(at in slots)) slots[at] = { current: value }; return slots[at]; }, useEffect() {}
        };
        try { return component(current); } finally { pointer.current = previous; }
    } };
}
function ports(overrides = {}) {
    let user = { fixture: { serverUrl: 'https://fixture.invalid/mcp', autostart: false }, other: { command: 'never-executed' } };
    const calls = [];
    const value = { readUser: () => user, readEffective: () => user,
        writeCredential: async (name, expected, value) => { assert.equal(JSON.stringify(user[name]), expected); user = { ...user, [name]: value }; calls.push(['preferences', user]); },
        change: async input => { calls.push(['rpc', input]); return { credential: ref, servers: [server] }; }, ...overrides };
    return { value, calls, replace: next => { user = next; } };
}
const change = { serverName: 'fixture', fingerprint: server.fingerprint, action: 'set', kind: 'bearer', value: 'SYNTHETIC_WRITE_ONLY' };

test('all twelve locales render write-only passwords and four static modes without locator/secret readback', () => {
    for (const locale of locales) {
        const html = renderToStaticMarkup(React.createElement(McpCredentialEditor, { ...props, locale }));
        for (const key of ['authentication', 'none', 'secret', 'save', 'cancel', 'boundary']) {
            const escaped = renderToStaticMarkup(React.createElement('span', null, mcpCredentialText(locale, key))).slice(6, -7);
            assert.ok(html.includes(escaped), `${locale}/${key}`);
        }
        assert.match(html, /type="password"[^>]*value=""/); assert.match(html, /autoComplete="new-password"/);
        assert.equal((html.match(/<option/g) || []).length, 4); assert.match(html, /novalidate=""/i);
        assert.doesNotMatch(html, /11111111|22222222|SYNTHETIC_WRITE_ONLY|OAuth|type="submit"[^>]*>Start/);
        if (locale === 'ar') assert.match(html, /dir="rtl"/);
    }
});

test('submit clears the password before awaiting, locks double clicks, and a failed save requires re-entry', async () => {
    let resolve; const calls = [];
    const h = harness(McpCredentialEditor, { ...props, onSave: input => { calls.push(input); return new Promise(r => { resolve = r; }); } });
    find(h.render(), 'input').props.onChange({ currentTarget: { value: change.value } });
    const form = h.render(); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1); assert.deepEqual(calls[0], change); assert.equal(find(h.render(), 'input').props.value, '');
    resolve(false); await flush(); assert.equal(find(h.render(), 'input').props.value, '');
    find(h.render(), 'input').props.onChange({ currentTarget: { value: 'NEW_SYNTHETIC' } });
    h.render().props.onSubmit({ preventDefault() {} }); assert.equal(calls.length, 2); resolve(true); await flush();
});

test('mode change, cancel and a newly keyed server never retain passwords; invalid values never reach RPC', async () => {
    let calls = 0, cancelled = 0; const h = harness(McpCredentialEditor, { ...props, onSave: async () => { calls++; return true; }, onCancel: () => { cancelled++; } });
    find(h.render(), 'input').props.onChange({ currentTarget: { value: 'two words' } });
    h.render().props.onSubmit({ preventDefault() {} }); assert.equal(calls, 0); assert.equal(find(h.render(), 'input').props.value, '');
    find(h.render(), 'input').props.onChange({ currentTarget: { value: 'UNSAVED' } });
    find(h.render(), 'select').props.onChange({ currentTarget: { value: 'x-api-key' } }); assert.equal(find(h.render(), 'input').props.value, '');
    find(h.render(), 'input').props.onChange({ currentTarget: { value: 'CANCELLED' } });
    walk(h.render()).find(item => item.type === 'button' && item.props.type === 'button').props.onClick();
    assert.equal(cancelled, 1); assert.equal(find(h.render(), 'input').props.value, '');
    assert.equal(find(harness(McpCredentialEditor, { ...props, server: { ...server, name: 'other' } }).render(), 'input').props.value, '');
    find(h.render(), 'select').props.onChange({ currentTarget: { value: 'none' } });
    assert.equal(find(h.render(), 'input'), undefined); h.render().props.onSubmit({ preventDefault() {} }); await flush(); assert.equal(calls, 1);
});

test('settings write only a validated locator and preserve unrelated user configurations', async () => {
    const f = ports(); await saveMcpCredentialSettings(change, f.value);
    const saved = f.calls.find(call => call[0] === 'preferences')[1];
    assert.deepEqual(saved.fixture.nextmuxCredential, ref); assert.equal(saved.fixture.autostart, false);
    assert.deepEqual(saved.other, { command: 'never-executed' }); assert.doesNotMatch(JSON.stringify(saved), /SYNTHETIC_WRITE_ONLY|"value"/);
    const cleared = ports({ change: async input => { assert.deepEqual(input, { serverName: 'fixture', fingerprint: server.fingerprint, action: 'clear' }); return { servers: [{ ...server, credential: undefined }] }; } });
    cleared.replace({ fixture: { serverUrl: 'https://fixture.invalid/mcp', nextmuxCredential: ref } });
    await saveMcpCredentialSettings({ serverName: 'fixture', fingerprint: server.fingerprint, action: 'clear' }, cleared.value);
    assert.equal('nextmuxCredential' in cleared.value.readUser().fixture, false);
});

test('workspace overrides, disappearing or changed configurations do not copy or overwrite user folders', async () => {
    const f = ports({ readEffective: () => ({ fixture: { serverUrl: 'https://other.invalid/mcp' } }) });
    assert.equal(mcpUserCredentialConfigurable('fixture', f.value.readUser(), f.value.readEffective()), false);
    await assert.rejects(saveMcpCredentialSettings(change, f.value), /MCP_USER_CONFIGURATION_REQUIRED/); assert.equal(f.calls.length, 0);
    const g = ports(); g.value.change = async () => { g.replace({ fixture: { serverUrl: 'https://changed.invalid/mcp' } }); return { credential: ref, servers: [server] }; };
    await assert.rejects(saveMcpCredentialSettings(change, g.value), /MCP_CONFIGURATION_CHANGED/); assert.equal(g.calls.length, 0);
    assert.equal(g.value.readUser().fixture.serverUrl, 'https://changed.invalid/mcp');
});

test('keychain or preference failure cannot report success, automatically rotate twice, or restore old credentials', async () => {
    const f = ports({ writeCredential: async () => { throw new Error('disk unavailable'); } });
    await assert.rejects(saveMcpCredentialSettings(change, f.value), /disk unavailable/);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'rpc'); assert.equal(f.value.readUser().fixture.nextmuxCredential, undefined);
    const g = ports({ change: async () => { throw new Error('keychain unavailable'); } });
    await assert.rejects(saveMcpCredentialSettings(change, g.value), /keychain unavailable/); assert.equal(g.calls.length, 0);
    const h = ports({ writeCredential: async () => {} });
    await assert.rejects(saveMcpCredentialSettings(change, h.value), /MCP_CONFIGURATION_SAVE_FAILED/);
    const invalid = ports({ change: async () => ({ credential: { ...ref, value: 'NOT_A_REFERENCE' }, servers: [] }) });
    await assert.rejects(saveMcpCredentialSettings(change, invalid.value), /MCP_CREDENTIAL_REFERENCE_INVALID/); assert.equal(invalid.calls.length, 0);
});

test('panel auth entry requires explicit backend support and a user setting; switching unmounts the old editor', () => {
    const panelProps = { locale: 'en', service: {}, addServer: async () => {}, changeCredential: async () => [], credentialConfigurable: () => true, onChange() {} };
    const h = harness(McpAccessPanel, panelProps, [[server, { ...server, name: 'second' }, { ...server, name: 'local', credentialEditable: false, local: true }, { ...server, name: 'legacy', credentialEditable: undefined }]]);
    let tree = h.render(); const buttons = walk(tree).filter(item => item.type === 'button' && item.props.children === 'Authentication');
    assert.equal(buttons.length, 2); buttons[0].props.onClick(); tree = h.render();
    assert.equal(walk(tree).filter(item => item.type === McpCredentialEditor).length, 1);
    assert.ok(walk(tree).find(item => item.type === McpCredentialEditor).key.includes(`fixture=2${server.fingerprint}`));
    walk(tree).filter(item => item.type === 'button' && item.props.children === 'Authentication')[1].props.onClick();
    assert.equal(walk(h.render()).find(item => item.type === McpCredentialEditor).props.server.name, 'second');
    const unavailable = harness(McpAccessPanel, { ...panelProps, credentialConfigurable: () => false }, [[server]]).render();
    assert.equal(walk(unavailable).filter(item => item.type === 'button' && item.props.children === 'Authentication').length, 0);
});

test('widget uses User preference scope and bounded production CSS; credentials are never routed through add/start', () => {
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(widget, /inspect\(MCP_SERVERS_PREF\)\?\.globalValue/);
    assert.match(widget, /writeCredential: \(name, expected, value\) => writeMcpCredentialPreference\(name, expected, value/);
    const editor = readFileSync(new URL('../src/browser/nextmux-mcp-credential-editor.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(editor, /localStorage|sessionStorage|console\.|action: 'start'|getCredential|secretCipher/);
    const css = readFileSync(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-mcp-access \.nmx-mcp-credential-editor \{[^}]*max-height: min\(380px, 52vh\);[^}]*overflow: auto/);
    assert.match(css, /\.nmx-mcp-access \.nmx-settings-actions[^}]*flex-wrap: wrap/);
});

test('cross-window MCP notifications immediately invalidate old grants and coalesce pending reads without stale restoration', async () => {
    const pending = [], accepted = []; let invalidations = 0;
    const reader = createMcpAccessRefresh({ load: () => new Promise(resolve => pending.push(resolve)), invalidate: () => { invalidations++; }, accept: value => accepted.push(value), failed() { assert.fail('unexpected failure'); } });
    reader.refresh(); assert.equal(pending.length, 1);
    for (let index = 0; index < 12; index++) reader.refresh();
    assert.equal(pending.length, 1); assert.equal(invalidations, 13);
    pending.shift()([{ ...server, approved: true, running: true }]); await flush(); assert.equal(accepted.length, 0); assert.equal(pending.length, 1);
    pending.shift()([{ ...server, approved: false, running: false, credential: undefined }]); await flush();
    assert.equal(accepted.length, 1); assert.equal(accepted[0][0].approved, false); assert.equal(reader.version, 13);
    reader.dispose(); reader.refresh(); assert.equal(pending.length, 0);
});

test('snapshot failures remain fail-closed and a disposed panel cannot publish late data; subscription is actually wired', async () => {
    let reject, resolve, failures = 0; const accepted = [];
    const reader = createMcpAccessRefresh({ load: () => new Promise((ok, fail) => { resolve = ok; reject = fail; }), invalidate() {}, accept: value => accepted.push(value), failed: () => { failures++; } });
    reader.refresh(); reject(new Error('synthetic read failure')); await flush(); assert.equal(failures, 1);
    reader.refresh(); reader.dispose(); resolve([server]); await flush(); assert.equal(accepted.length, 0);
    const panel = readFileSync(new URL('../src/browser/nextmux-mcp-access-panel.tsx', import.meta.url), 'utf8');
    assert.match(panel, /notifications\?\.onDidUpdateMCPServers\(\(\) => reader.refresh\(\)\)/);
    assert.match(panel, /subscription\?\.dispose\(\); reader.dispose\(\)/);
    assert.match(panel, /if \(refresh.current\?\.version === accessVersion\)/);
    assert.match(panel, /approved: false, running: false, tools: \[\]/);
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(widget, /notifications=\{this.mcpNotificationService\}/);
});
