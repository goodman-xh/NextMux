import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test, { after, before } from 'node:test';
import ts from 'typescript';
import { requireCopyFallback } from './copy-fallback-module.mjs';
import { startSidebarFixture } from './coding-sidebar-fixture-harness.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methodNames = ['revealActiveCodingSession', 'scrollSidebarConversationList', 'setCodingSearchQuery', 'scheduleGlobalConversationSearch'];
const methods = methodNames.map(name => {
    const member = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    assert.ok(member, name);
    return member.getText(ast);
}).join('\n');
const browserMethods = ts.transpileModule(`class SidebarRevealHarness { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const localeSource = await readFile(new URL('../src/browser/nextmux-workbench-locale.ts', import.meta.url), 'utf8');
const localeExports = {};
new Function('exports', 'require', ts.transpileModule(`${localeSource}\nexport const fixtureCatalog = translations;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(localeExports, requireCopyFallback);
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const incognitoCopy = ts.transpileModule(await readFile(new URL('../src/browser/nextmux-incognito-text.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

let service;
let browser;
before(async () => {
    service = await startSidebarFixture();
    browser = await service.puppeteer.launch({ headless: true });
});
after(async () => {
    await browser?.close();
    if (service) await new Promise(resolve => service.server.close(resolve));
});

async function open(t, query = '?locale=en&theme=dark') {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
    await page.setViewport({ width: 1000, height: 720 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    // The shared fixture predates the incognito entry in the sidebar. Provide
    // the actual production copy before that JSX first renders.
    await page.evaluateOnNewDocument(`{ const exports = {}; ${incognitoCopy}; Object.assign(window, exports); }`);
    await page.goto(`${service.origin}/${query}`);
    await page.waitForSelector('.nmx-session-row');
    // The sidebar fixture renders the actual widget JSX and react-virtuoso.
    // Attach the actual action/search methods; only unrelated services are stubs.
    await page.addScriptTag({ content: `${browserMethods}
Object.defineProperties(Object.getPrototypeOf(window.fixture), Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(SidebarRevealHarness.prototype)).filter(([key]) => key !== 'constructor')));
window.fixture.codingSidebarRevealSessionId = '';
window.fixture.contextPanelCollapsed = false;
window.fixture.applicationExitPreparing = false;
window.fixture.constrainPaneSizes = function () { this.paneConstraints = (this.paneConstraints || 0) + 1; };
window.fixture.setProjectVisible = function (path, visible) {
    if (visible) this.hiddenProjectPaths.delete(path); else this.hiddenProjectPaths.add(path);
};
window.fixture.openCodingSession = function () { throw new Error('REVEAL_MUST_NOT_OPEN_SESSION'); };
window.fixture.selectWorkspaceRoot = function () { throw new Error('REVEAL_MUST_NOT_SELECT_WORKSPACE'); };
window.fixture.platformService = { searchConversationHistory() { throw new Error('REVEAL_MUST_NOT_SEARCH_HISTORY'); } };
window.fixture.prompt = 'NM_SIDEBAR_DRAFT_KEEP';
window.fixture.attachments = [{ id: 'synthetic-attachment', uri: 'file:///synthetic-existing', name: 'keep.txt' }];
window.fixture.selectedModelRouteId = 'synthetic-fixed-route';
window.fixture.selectedRelayKey = 'synthetic-relay';
window.fixture.permissionMode = 'full_access';
window.sidebarScrollEvents = [];
const nativeScrollIntoView = HTMLElement.prototype.scrollIntoView;
HTMLElement.prototype.scrollIntoView = function (options) {
    if (this.matches('.nmx-session-row[data-session-id]')) window.sidebarScrollEvents.push({ id: this.dataset.sessionId, options });
    return nativeScrollIntoView.call(this, options);
};
window.fixtureSnapshot = () => JSON.stringify({ owner: window.fixture.activeCodingSessionId,
    prompt: window.fixture.prompt, attachments: window.fixture.attachments,
    route: window.fixture.selectedModelRouteId, relay: window.fixture.selectedRelayKey,
    permission: window.fixture.permissionMode, sessions: window.fixture.codingSessions });
window.createSidebarSessions = (count, { path = '/work/nextmux', pinned = false, incognito = false } = {}) => {
    const now = Date.UTC(2026, 8, 24, 12, 0);
    return Array.from({ length: count }, (_, index) => ({ id: 'synthetic-' + index,
        title: 'Synthetic conversation ' + index, workspacePath: path, pinned, incognito,
        createdAt: now - index * 60000, updatedAt: now - index * 60000,
        turns: [{ id: 'synthetic-turn-' + index, prompt: 'fixture prompt', response: 'fixture reply',
            stage: 'complete', createdAt: now - index * 60000, completedAt: now - index * 60000 + 1000 }] }));
};` });
    return page;
}

const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const beforeSnapshot = page => page.evaluate(() => window.fixtureSnapshot());

test('the actual icon precedes permission and every locale owns its tooltip and accessible name', () => {
    const jsx = [];
    const visit = node => { if (ts.isJsxElement(node)) jsx.push(node); ts.forEachChild(node, visit); };
    visit(widget);
    const classes = node => node.openingElement.attributes.properties.find(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.text === 'className' && attribute.initializer && ts.isStringLiteral(attribute.initializer))?.initializer.text.split(/\s+/) || [];
    const below = jsx.find(node => classes(node).includes('nmx-composer-below'));
    assert.ok(below);
    const children = below.children.filter(ts.isJsxElement);
    const locate = children.find(node => classes(node).includes('nmx-conversation-locate'));
    assert.ok(locate);
    const permission = children.find(node => node !== locate && node.openingElement.attributes.properties.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.text === 'className' && attribute.initializer && ts.isJsxExpression(attribute.initializer)
            && attribute.initializer.expression && ts.isTemplateExpression(attribute.initializer.expression)
            && attribute.initializer.expression.head.text.includes('nmx-permission-button')));
    assert.ok(permission);
    assert.ok(children.indexOf(locate) < children.indexOf(permission));
    const render = ts.transpileModule(`class LocateButton { render(codingSession) { return ${locate.getText(ast)}; } }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
    }).outputText;
    const Harness = new Function('React', 'workbenchText', `${render}; return LocateButton;`)(React, localeExports.workbenchText);
    let clicks = 0;
    for (const locale of locales) {
        const own = localeExports.fixtureCatalog[locale];
        assert.ok(Object.hasOwn(own, 'locateConversation'), locale);
        const text = own.locateConversation;
        assert.equal(typeof text, 'string', locale);
        assert.ok(text.trim() && text !== 'locateConversation', locale);
        const state = new Harness(); state.desktopLocale = locale; state.revealActiveCodingSession = () => { clicks += 1; };
        const button = state.render({ id: 'synthetic' });
        assert.equal(button.props.title, text, locale);
        assert.equal(button.props['aria-label'], text, locale);
        assert.equal(button.props.disabled, false, locale);
        assert.equal(state.render(undefined).props.disabled, true, locale);
        button.props.onClick();
    }
    assert.equal(clicks, locales.length);
});

test('hidden, collapsed project and search filtering reveal the existing sixth row without changing conversation state', { timeout: 30000 }, async t => {
    const page = await open(t, '?locale=en&theme=light');
    await page.evaluate(() => {
        const f = window.fixture;
        f.codingSessions = window.createSidebarSessions(9);
        f.activeCodingSessionId = 'synthetic-7';
        f.contextPanelCollapsed = true;
        f.hiddenProjectPaths.add('/work/nextmux');
        f.expandedCodingProjects.clear(); f.expandedProjectConversationLists.clear();
        f.codingSearchOpen = true; f.codingSearchQuery = 'does not match';
        f.codingSearchResultQuery = f.codingSearchQuery; f.codingSearchMatches = new Map();
        f.update();
    });
    assert.equal(await page.$('[data-session-id="synthetic-7"]'), null);
    const before = await beforeSnapshot(page);
    const token = await page.evaluate(() => window.fixture.codingSearchRequestToken);
    await page.evaluate(() => window.fixture.revealActiveCodingSession());
    await page.waitForFunction(() => window.sidebarScrollEvents.some(event => event.id === 'synthetic-7'));
    const state = await page.evaluate(() => ({ collapsed: window.fixture.contextPanelCollapsed,
        constrained: window.fixture.paneConstraints, query: window.fixture.codingSearchQuery,
        searchOpen: window.fixture.codingSearchOpen, token: window.fixture.codingSearchRequestToken,
        hidden: window.fixture.hiddenProjectPaths.has('/work/nextmux'),
        projectExpanded: window.fixture.expandedCodingProjects.has('/work/nextmux'),
        rowsExpanded: window.fixture.expandedProjectConversationLists.has('/work/nextmux'),
        pending: window.fixture.codingSidebarRevealSessionId, scroll: window.sidebarScrollEvents.at(-1) }));
    assert.equal(state.collapsed, false); assert.ok(state.constrained > 0);
    assert.equal(state.query, ''); assert.equal(state.searchOpen, false); assert.ok(state.token > token);
    assert.equal(state.hidden, false); assert.equal(state.projectExpanded, true); assert.equal(state.rowsExpanded, true);
    assert.equal(state.pending, ''); assert.deepEqual(state.scroll.options, { block: 'center', behavior: 'auto' });
    assert.equal(await beforeSnapshot(page), before);
    const scrollCount = await page.evaluate(() => window.sidebarScrollEvents.length);
    await page.evaluate(() => { window.fixture.update(); window.fixture.update(); }); await settled(page);
    assert.equal(await page.evaluate(() => window.sidebarScrollEvents.length), scrollCount, 'background renders must not repeat a completed reveal');
});

test('recent and private conversations beyond the first five rows use the existing Recent collection', { timeout: 30000 }, async t => {
    const page = await open(t);
    for (const incognito of [false, true]) {
        await page.evaluate(incognito => {
            const f = window.fixture;
            f.codingSessions = window.createSidebarSessions(9, { path: '', incognito });
            f.activeCodingSessionId = 'synthetic-8';
            f.expandedProjectConversationLists.clear(); f.expandedCodingProjects.clear();
            window.sidebarScrollEvents = []; f.update();
        }, incognito);
        assert.equal(await page.$('[data-session-id="synthetic-8"]'), null);
        const before = await beforeSnapshot(page);
        await page.evaluate(() => window.fixture.revealActiveCodingSession());
        await page.waitForFunction(() => window.sidebarScrollEvents.some(event => event.id === 'synthetic-8'));
        assert.equal(await page.evaluate(() => window.fixture.expandedProjectConversationLists.has('__recent__')), true);
        assert.equal(await page.evaluate(() => window.fixture.expandedCodingProjects.size), 0);
        assert.equal(await beforeSnapshot(page), before);
    }
});

test('actual react-virtuoso mounts and centers a distant current conversation, including pinned collections', { timeout: 30000 }, async t => {
    const page = await open(t);
    for (const pinned of [false, true]) {
        await page.evaluate(pinned => {
            const f = window.fixture;
            const nav = document.querySelector('.nmx-context-nav');
            if (nav) nav.scrollTop = 0;
            f.codingSessions = window.createSidebarSessions(100, { pinned });
            f.activeCodingSessionId = 'synthetic-88';
            f.expandedCodingProjects = new Set(['/work/nextmux']);
            f.expandedProjectConversationLists = new Set(['/work/nextmux']);
            window.sidebarScrollEvents = []; f.update();
        }, pinned);
        await page.waitForSelector('.nmx-session-virtual-list'); await settled(page);
        assert.equal(await page.$eval('.nmx-session-virtual-list', el => getComputedStyle(el).overflowY), 'visible', 'virtual list does not create a nested vertical scrollbar');
        assert.equal(await page.$('[data-session-id="synthetic-88"]'), null, 'the distant row starts outside the virtualized viewport');
        const before = await beforeSnapshot(page);
        await page.evaluate(() => window.fixture.revealActiveCodingSession());
        try {
            await page.waitForFunction(() => {
                if (window.fixture.codingSidebarRevealSessionId) return false;
                const row = document.querySelector('.nmx-session-row[data-session-id="synthetic-88"]');
                if (!row) return false;
                const rect = row.getBoundingClientRect(); const list = row.closest('.nmx-context-nav').getBoundingClientRect();
                return rect.top >= list.top - 1 && rect.bottom <= list.bottom + 1;
            });
        } catch (error) {
            t.diagnostic(JSON.stringify(await page.evaluate(() => ({
                pending: window.fixture.codingSidebarRevealSessionId, scrolls: window.sidebarScrollEvents,
                mounted: [...document.querySelectorAll('.nmx-session-virtual-list .nmx-session-row')].map(row => row.dataset.sessionId),
                lists: [...document.querySelectorAll('.nmx-context-nav')].map(list => ({
                    top: list.scrollTop, height: list.clientHeight, total: list.scrollHeight,
                    bounds: { top: list.getBoundingClientRect().top, bottom: list.getBoundingClientRect().bottom }
                }))
            }))));
            throw error;
        }
        await settled(page);
        const geometry = await page.$eval('[data-session-id="synthetic-88"]', row => {
            const rect = row.getBoundingClientRect(); const list = row.closest('.nmx-context-nav').getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, listTop: list.top, listBottom: list.bottom };
        });
        assert.ok(geometry.top >= geometry.listTop - 1 && geometry.bottom <= geometry.listBottom + 1, JSON.stringify(geometry));
        assert.ok(Math.abs((geometry.top + geometry.bottom) / 2 - (geometry.listTop + geometry.listBottom) / 2) <= 33,
            `the target remains near the center after layout settles: ${JSON.stringify(geometry)}`);
        assert.equal(await beforeSnapshot(page), before);
        assert.equal(await page.evaluate(() => window.fixture.codingSidebarRevealSessionId), '');
    }
});

test('queued virtual scrolling and DOM reveal stop when their captured conversation changes', { timeout: 30000 }, async t => {
    const page = await open(t);
    const result = await page.evaluate(async () => {
        const f = window.fixture;
        const raf = window.requestAnimationFrame; const callbacks = [];
        window.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
        f.activeCodingSessionId = 's-a';
        f.revealActiveCodingSession();
        const virtualCalls = [];
        f.scrollSidebarConversationList({ scrollToIndex(value) { virtualCalls.push(value); } }, f.codingSessions);
        f.activeCodingSessionId = 's-b';
        f.prompt = 'NM_OTHER_OWNER_KEEP';
        window.requestAnimationFrame = raf;
        for (let count = 0; callbacks.length && count < 100; count++) callbacks.shift()(performance.now());
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const switched = { owner: f.activeCodingSessionId, prompt: f.prompt };
        // Returning later to A must not replay the cancelled request on a ref update.
        f.activeCodingSessionId = 's-a';
        f.scrollSidebarConversationList({ scrollToIndex(value) { virtualCalls.push(value); } }, f.codingSessions);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { virtualCalls, scrolls: window.sidebarScrollEvents, ...switched };
    });
    await settled(page);
    assert.deepEqual(result.virtualCalls, []); assert.deepEqual(result.scrolls, []);
    assert.equal(result.owner, 's-b'); assert.equal(result.prompt, 'NM_OTHER_OWNER_KEEP');
});

test('a stale virtual ref or completed request never scrolls a background or unrelated collection', { timeout: 30000 }, async t => {
    const page = await open(t);
    const result = await page.evaluate(async () => {
        const f = window.fixture; const calls = [];
        const handle = { scrollToIndex(value) { calls.push(value); } };
        f.codingSidebarRevealSessionId = 's-a'; f.activeCodingSessionId = 's-b';
        f.scrollSidebarConversationList(handle, f.codingSessions);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        f.activeCodingSessionId = 's-a';
        f.scrollSidebarConversationList(handle, f.codingSessions.filter(session => session.id !== 's-a'));
        f.scrollSidebarConversationList(null, f.codingSessions);
        f.codingSidebarRevealSessionId = '';
        f.scrollSidebarConversationList(handle, f.codingSessions);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return calls;
    });
    assert.deepEqual(result, []);
});

test('missing owner, another section and exit preparation cannot launch a reveal', { timeout: 30000 }, async t => {
    const page = await open(t);
    const results = await page.evaluate(() => {
        const f = window.fixture; const results = [];
        for (const guard of ['missing', 'section', 'exit']) {
            f.activeCodingSessionId = guard === 'missing' ? 'absent' : 's-a';
            f.activeSection = guard === 'section' ? 'comic' : 'coding';
            f.applicationExitPreparing = guard === 'exit';
            f.contextPanelCollapsed = true; f.codingSidebarRevealSessionId = '';
            f.revealActiveCodingSession();
            results.push({ guard, collapsed: f.contextPanelCollapsed, pending: f.codingSidebarRevealSessionId });
        }
        return results;
    });
    for (const result of results) { assert.equal(result.collapsed, true, result.guard); assert.equal(result.pending, '', result.guard); }
});
