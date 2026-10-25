import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
const names = ['recordCodingBrowser', 'captureAgentBrowsers', 'updateCodingBrowserLocation', 'setProjectBrowsers',
    'handleBrowserToolRequest', 'openToolBrowserActivity'];
const methods = names.map(name => {
    const method = widget.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(ast) === name);
    assert.ok(method, name); return method.getText(ast);
});
const navigation = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'isBrowserNavigationToolName');
const code = ts.transpileModule(`${navigation.getText(ast)}\nclass Harness { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Harness = new Function('crypto', 'browserConversationKey', 'findOwnedBrowser', 'browserWorkspaceMatchesCanonical', 'runBrowserPageAction',
    `${code}; return Harness;`)({ randomUUID }, id => `session:${id}`,
    (tabs, id, owner) => tabs.find(tab => tab.id === id && tab.conversationId === owner), async () => true,
    async (_surface, request) => ({ requestId: request.id, ok: true, data: { url: 'https://example.com/', title: 'Example Domain' } }));
const event = (toolName, url, kind = 'browser.action', action = 'snapshot') => ({ type: 'tool_completed', toolName,
    summary: { title: 'Browser action', ...(kind ? { kind, params: { action } } : {}), resource: { kind: 'browser', url, title: 'Page' } } });
function harness(tabs = []) {
    const h = new Harness();
    Object.assign(h, { codingSessions: [{ id: 'owner' }], activeCodingSessionId: 'owner', activeBrowserId: tabs[0]?.id,
        projectBrowsers: new Map([['session:owner', tabs]]), mountedBrowserIds: new Set(), update() {}, persistProjectBrowsers() {},
        normalizeBrowserUrl: value => new URL(value).toString(), codingSessionWorkspaceRoot: () => '/workspace',
        revealAgentBrowser: (_owner, id) => { h.activeBrowserId = id; return true; }, browserToolSurface: async () => ({}),
        activeCodingSession: () => h.codingSessions[0], currentCodingBrowsers: () => h.projectBrowsers.get('session:owner') || [],
        showBrowserWorkContext() {}, persistActiveCodingSessionState() {} });
    return h;
}
const tab = (id = 'stable', url = 'https://example.com/') => ({ id, conversationId: 'owner', url, title: 'Example Domain', source: 'agent', createdAt: 1, updatedAt: 1 });

test('completed pre-navigation snapshots do not recreate historical URLs or change stable tab identity', () => {
    const h = harness([tab()]);
    h.updateCodingBrowserLocation('stable', 'https://www.iana.org/help/example-domains', 'Example Domains');
    const before = JSON.stringify(h.currentCodingBrowsers());
    h.captureAgentBrowsers('owner', { events: [event('browser.snapshot', 'https://example.com/'),
        event('browser.click', 'https://www.iana.org/help/example-domains'), event('browser.snapshot', 'https://www.iana.org/help/example-domains')] });
    assert.equal(JSON.stringify(h.currentCodingBrowsers()), before); assert.equal(h.activeBrowserId, 'stable');
});

test('initial built-in open creates its tab before completion and replay does not duplicate it', async () => {
    const h = harness();
    const request = { id: 'open-request', conversationId: 'owner', workspaceRoot: '/workspace', action: 'open', destination: 'builtin-browser', url: 'https://example.com/' };
    h.platformService = { getBrowserToolRequests: async () => [request] };
    const result = await h.handleBrowserToolRequest(request);
    assert.equal(result.ok, true); assert.equal(h.currentCodingBrowsers().length, 1);
    const id = result.data.id; assert.equal(h.currentCodingBrowsers()[0].id, id); assert.equal(h.mountedBrowserIds.has(id), true);
    h.captureAgentBrowsers('owner', { events: [event('browser.open', 'https://example.com/', 'browser.action', 'open')] });
    assert.equal(h.currentCodingBrowsers().length, 1); assert.equal(h.currentCodingBrowsers()[0].id, id);
});

test('a user-closed tab and system browser are not resurrected from completed results', () => {
    const h = harness();
    h.captureAgentBrowsers('owner', { events: [event('browser.snapshot', 'https://example.com/'), event('browser.open_external', 'https://outside.example/')] });
    assert.equal(h.currentCodingBrowsers().length, 0);
});

test('legacy built-in names and structured browser actions cannot manufacture identities', () => {
    const h = harness();
    h.captureAgentBrowsers('owner', { events: [event('browser_navigate', 'https://old.example/', null), event('renamed_wrapper', 'https://old.example/')] });
    assert.equal(h.currentCodingBrowsers().length, 0);
});

test('explicitly opening a legacy browser activity still works', () => {
    const h = harness();
    h.openToolBrowserActivity({ resource: { kind: 'browser', url: 'https://legacy.example/', title: 'Saved page' } });
    assert.equal(h.currentCodingBrowsers().length, 1); assert.equal(h.currentCodingBrowsers()[0].url, 'https://legacy.example/');
    assert.equal(h.activeBrowserId, h.currentCodingBrowsers()[0].id);
});

test('external preview discovery and local preview URL discovery remain available', () => {
    const h = harness();
    h.captureAgentBrowsers('owner', { events: [event('playwright.navigate', 'https://preview.example/', null),
        { type: 'tool_completed', toolName: 'site.preview', summary: { title: 'Preview ready', details: ['http://localhost:3000/'] } }] });
    assert.deepEqual(h.currentCodingBrowsers().map(t => t.url).sort(), ['http://localhost:3000/', 'https://preview.example/']);
});
