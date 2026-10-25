import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, symlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { browserConversationKey, browserWorkspaceMatchesCanonical, findOwnedBrowser } from '../lib/browser/nextmux-browser-automation.js';
import { NextMuxLinkOpeningPolicy, LINK_OPENING_PREFERENCE_STORAGE_KEY } from '../lib/browser/nextmux-link-opening.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const member = name => widget.members.find(node => node.name?.getText(parsed) === name).getText(parsed);
const handler = ['handleBrowserToolRequest', 'revealAgentBrowser', 'captureAgentBrowsers'].map(member).join('\n');
const executable = ts.transpileModule(`class BrowserHarness { ${handler} }; globalThis.BrowserHarness = BrowserHarness;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(preference) {
    const externalUrls = [], captured = [];
    const context = vm.createContext({ browserConversationKey, browserWorkspaceMatchesCanonical, findOwnedBrowser, crypto: { randomUUID }, URL, Date, setTimeout,
        window: { nextmuxDesktop: { openExternal: async url => { externalUrls.push(url); return true; } } },
        isBrowserNavigationToolName: name => name === 'browser.open' || name === 'browser.open_external',
        runBrowserPageAction: async (_surface, request, isActive) => ({ requestId: request.id, ok: await isActive(), data: { url: 'https://fixture.test/', elements: [] } }) });
    vm.runInContext(executable, context);
    const host = new context.BrowserHarness();
    host.codingSessions = [{ id: 'A' }, { id: 'B' }];
    host.activeCodingSessionId = 'B'; host.activeBrowserId = 'tab-B'; host.activeSection = 'coding';
    host.projectBrowsers = new Map([['session:A', [{ id: 'tab-A', conversationId: 'A' }]], ['session:B', [{ id: 'tab-B', conversationId: 'B' }]]]);
    host.mountedBrowserIds = new Set(); host.foregroundChanges = 0; host.surfaceCalls = 0;
    const saved = new Map(preference ? [[LINK_OPENING_PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 2, destination: preference })]] : []);
    host.linkOpeningPolicy = new NextMuxLinkOpeningPolicy({ getItem: key => saved.get(key) ?? null,
        setItem: () => { throw Error('Opening a browser must not change the saved preference'); } });
    host.externalUrls = externalUrls; host.captured = captured;
    host.recordCodingBrowser = (...args) => captured.push(args);
    host.codingSessionWorkspaceRoot = () => '/same/project';
    host.platformService = { getBrowserToolRequests: async () => [{ id: 'request' }] };
    host.normalizeBrowserUrl = value => /^https?:/.test(value) ? value : undefined;
    host.setProjectBrowsers = (key, tabs) => host.projectBrowsers.set(key, tabs);
    host.showBrowserWorkContext = () => { host.foregroundChanges++; };
    host.update = () => {};
    host.browserToolSurface = async () => { host.surfaceCalls++; return {}; };
    return host;
}
const request = action => ({ id: 'request', conversationId: 'A', workspaceRoot: '/same/project', browserId: 'tab-A', action });

test('actual renderer handler reads an owning conversation tab while another conversation is foreground', async () => {
    const host = fixture();
    assert.equal((await host.handleBrowserToolRequest(request('snapshot'))).ok, true);
    assert.equal(host.activeCodingSessionId, 'B'); assert.equal(host.activeBrowserId, 'tab-B');
    assert.equal(host.foregroundChanges, 0); assert.equal(host.surfaceCalls, 1);
});

test('actual handler refuses another conversation tab even when both use the same workspace', async () => {
    const host = fixture();
    const result = await host.handleBrowserToolRequest({ ...request('click'), browserId: 'tab-B', selector: 'button' });
    assert.equal(result.ok, false); assert.equal(host.surfaceCalls, 0);
});

test('background open creates and mounts a tab under its owner without changing foreground selection', async () => {
    const host = fixture();
    const result = await host.handleBrowserToolRequest({ ...request('open'), url: 'https://fixture.test/' });
    assert.equal(result.ok, true);
    const created = host.projectBrowsers.get('session:A')[0];
    assert.equal(created.conversationId, 'A'); assert.ok(host.mountedBrowserIds.has(created.id));
    assert.equal(host.projectBrowsers.get('session:B').length, 1);
    assert.equal(host.activeBrowserId, 'tab-B'); assert.equal(host.foregroundChanges, 0);
});

test('the AI using a page of the visible conversation opens the right drawer on that tab, once per run if the user closes it', async () => {
    const host = fixture();
    host.activeCodingSessionId = 'A'; host.activeBrowserId = 'tab-A'; host.activeAgentRunId = 'run-1';
    const opened = await host.handleBrowserToolRequest({ ...request('open'), url: 'https://fixture.test/' });
    assert.equal(opened.ok, true);
    assert.equal(host.activeBrowserId, opened.data.id); assert.equal(host.foregroundChanges, 1);
    // The user closed the drawer while the AI keeps working: it stays closed for this run.
    host.browserDrawerDismissedRun = 'A:run-1';
    assert.equal((await host.handleBrowserToolRequest(request('snapshot'))).ok, true);
    assert.equal(host.foregroundChanges, 1);
    // The next run may show it again.
    host.activeAgentRunId = 'run-2';
    assert.equal((await host.handleBrowserToolRequest(request('snapshot'))).ok, true);
    assert.equal(host.foregroundChanges, 2); assert.equal(host.activeBrowserId, 'tab-A');
    // Outside the coding view nothing opens.
    host.activeSection = 'comic'; host.activeAgentRunId = 'run-3';
    assert.equal((await host.handleBrowserToolRequest(request('snapshot'))).ok, true);
    assert.equal(host.foregroundChanges, 2);
});

test('cancelled and expired queued requests cannot begin a page action', async () => {
    const host = fixture();
    host.platformService.getBrowserToolRequests = async () => [];
    assert.equal((await host.handleBrowserToolRequest(request('click'))).ok, false);
    assert.equal((await host.handleBrowserToolRequest({ ...request('click'), expiresAt: Date.now() - 1 })).ok, false);
    assert.equal(host.surfaceCalls, 0);
});

test('opening or activating a tab cannot report success after its request is stopped during mount', async () => {
    for (const action of ['open', 'activate']) {
        const host = fixture();
        host.browserToolSurface = async () => {
            host.platformService.getBrowserToolRequests = async () => [];
            return {};
        };
        assert.equal((await host.handleBrowserToolRequest({ ...request(action), url: 'https://fixture.test/' })).ok, false, action);
    }
});

test('navigation result is cancelled when stopped while the URL is loading', async () => {
    const host = fixture(); let navigations = 0;
    host.browserToolSurface = async () => ({ loadURL: async () => {
        navigations++;
        host.platformService.getBrowserToolRequests = async () => [];
    } });
    const result = await host.handleBrowserToolRequest({ ...request('navigate'), url: 'https://fixture.test/' });
    assert.equal(navigations, 1); assert.equal(result.ok, false);
});

test('browser.open follows the saved destination, with built-in as the default and per-call overrides', async () => {
    for (const [preference, destination, expected] of [
        [undefined, undefined, 'builtin-browser'],
        ['builtin-browser', 'default', 'builtin-browser'],
        ['system-browser', undefined, 'system-browser'],
        ['system-browser', 'default', 'system-browser'],
        ['system-browser', 'builtin-browser', 'builtin-browser'],
        ['builtin-browser', 'system-browser', 'system-browser']
    ]) {
        const host = fixture(preference);
        host.activeCodingSessionId = 'A';
        const result = await host.handleBrowserToolRequest({ ...request('open'), url: 'https://fixture.test/', ...(destination ? { destination } : {}) });
        assert.equal(result.ok, true); assert.equal(result.data.destination, expected);
        assert.equal(host.linkOpeningPolicy.getPreference(), preference);
        if (expected === 'system-browser') {
            assert.deepEqual(host.externalUrls, ['https://fixture.test/']);
            assert.equal(host.projectBrowsers.get('session:A').length, 1);
            assert.equal(host.surfaceCalls, 0); assert.equal(host.foregroundChanges, 0);
            assert.equal(result.data.id, undefined); assert.match(result.data.note, /no browserId/);
        } else {
            assert.deepEqual(host.externalUrls, []);
            assert.equal(host.projectBrowsers.get('session:A').length, 2);
            assert.equal(host.surfaceCalls, 1); assert.equal(host.foregroundChanges, 1);
            assert.ok(result.data.id);
        }
    }
});

test('open_external stays explicit and cancelled or invalid system-browser requests never dispatch', async () => {
    const host = fixture('builtin-browser');
    assert.equal((await host.handleBrowserToolRequest({ ...request('open_external'), url: 'https://fixture.test/' })).data.destination, 'system-browser');
    assert.deepEqual(host.externalUrls, ['https://fixture.test/']);
    for (const url of ['javascript:alert(1)', 'file:///private/data', '']) {
        assert.equal((await host.handleBrowserToolRequest({ ...request('open'), destination: 'system-browser', url })).ok, false);
    }
    host.platformService.getBrowserToolRequests = async () => [];
    assert.equal((await host.handleBrowserToolRequest({ ...request('open'), destination: 'system-browser', url: 'https://cancelled.test/' })).ok, false);
    assert.deepEqual(host.externalUrls, ['https://fixture.test/']);
});

test('capturing completed browser activity never mirrors a system page into the built-in drawer', () => {
    const host = fixture();
    host.captureAgentBrowsers('A', { events: [
        { type: 'tool_completed', toolName: 'browser.open', summary: { kind: 'browser.action', params: { action: 'open_external' }, title: 'Browser action', resource: { kind: 'browser', url: 'https://system.test/' } } },
        { type: 'tool_completed', toolName: 'browser.open_external', summary: { title: 'Opened https://legacy-system.test/', resource: { kind: 'browser', url: 'https://legacy-system.test/' } } },
        { type: 'tool_completed', toolName: 'browser.open', summary: { kind: 'browser.action', params: { action: 'open' }, title: 'Browser action', resource: { kind: 'browser', url: 'https://builtin.test/' } } }
    ] });
    // Built-in tabs are tracked live by their own browserId; a completed summary is a historical URL, and replaying it
    // would reopen an old page in a second tab or resurrect a closed one. So nothing is mirrored, system pages included.
    assert.deepEqual(host.captured.map(args => args[1]), []);
});


test('renderer accepts real symlink aliases but refuses another directory and a nested project', async t => {
    const base = await mkdtemp(join(tmpdir(), 'nmx-browser-owner-')); t.after(() => rm(base, { recursive: true, force: true }));
    const actual = join(base, 'actual'), alias = join(base, 'alias'), other = join(base, 'other'), child = join(actual, 'child');
    await mkdir(child, { recursive: true }); await mkdir(other); await symlink(actual, alias, 'dir');
    const serviceSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    const serviceFile = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const serviceClass = serviceFile.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
    const serviceMethod = serviceClass.members.find(node => node.name?.getText(serviceFile) === 'resolveWorkspaceFile').getText(serviceFile);
    const Resolver = new Function('realpath', 'isAbsolute', ts.transpileModule(`class Resolver { ${serviceMethod} }; return Resolver;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(realpath, isAbsolute);
    const resolver = new Resolver(); resolver.pathInside = (root, path) => path.startsWith(root + '/');
    const host = fixture(); host.codingSessionWorkspaceRoot = () => alias;
    host.platformService.resolveWorkspaceFile = (...args) => resolver.resolveWorkspaceFile(...args);
    assert.equal((await host.handleBrowserToolRequest({ ...request('snapshot'), workspaceRoot: await realpath(actual) })).ok, true);
    host.surfaceCalls = 0;
    assert.equal((await host.handleBrowserToolRequest({ ...request('snapshot'), workspaceRoot: other })).ok, false);
    assert.equal((await host.handleBrowserToolRequest({ ...request('snapshot'), workspaceRoot: child })).ok, false);
    assert.equal(host.surfaceCalls, 0);
});

test('canonical lookup failure and cancellation during lookup never perform a browser action', async () => {
    const host = fixture();
    host.platformService.resolveWorkspaceFile = async () => { throw new Error('missing directory'); };
    assert.equal((await host.handleBrowserToolRequest({ ...request('snapshot'), workspaceRoot: '/alias' })).ok, false);
    host.platformService.resolveWorkspaceFile = async () => {
        host.platformService.getBrowserToolRequests = async () => [];
        return { inside: true, path: '/actual' };
    };
    assert.equal((await host.handleBrowserToolRequest({ ...request('snapshot'), workspaceRoot: '/alias' })).ok, false);
    assert.equal(host.surfaceCalls, 0);
});
