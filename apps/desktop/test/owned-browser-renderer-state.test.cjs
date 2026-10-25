'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { readFileSync } = require('node:fs'), { resolve } = require('node:path'), { createRequire } = require('node:module');
const extension = resolve(__dirname, '../../../packages/theia-nextmux-extension');
const requireExtension = createRequire(resolve(extension, 'package.json')), ts = requireExtension('typescript');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function renderer(customBridge = {}, owner = { conversationId: 'conversation', browserId: 'browser', workspaceRoot: '/workspace' }) {
  const calls = [], timers = new Map(); let revision = 0, serial = 0;
  const state = mode => ({ id: 7, url: 'https://example.test/', title: 'Example', mode, revision: ++revision, loading: false, canGoBack: false, canGoForward: false, mobile: false });
  const bridge = Object.assign({ create: async () => state('background'), state: async () => state('background'), resize: async () => state('background'),
    preview: async () => { throw Error('[BROWSER_PREVIEW_EMPTY] Rendering'); }, navigate: async () => state('background'),
    release: async () => { calls.push('release'); return state('background'); }, close: async () => { calls.push('close'); }, takeover: async () => state('manual') }, customBridge);
  class Component { constructor(props) { this.props = props; } setState(update) { this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state) : update) }; } }
  const rect = { left: 100, top: 100, right: 700, bottom: 600, width: 600, height: 500 };
  const surface = { contains: element => element === viewport || element?.inside === true };
  const viewport = { getBoundingClientRect: () => rect, contains: element => element === viewport, closest: () => surface };
  const document = { hidden: false, body: {}, querySelectorAll: () => [], elementFromPoint: () => viewport, addEventListener() {}, removeEventListener() {} };
  const window = { nextmuxDesktop: { ownedBrowser: bridge }, innerWidth: 1200, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(resolve(extension, 'src/browser/nextmux-owned-browser-view.tsx'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => id === '@theia/core/shared/react' ? { PureComponent: Component, createElement: (type, props, ...children) => ({ type, props, children }) } : {},
    window, document, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }), ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask, setTimeout: callback => { timers.set(++serial, callback); return serial; }, clearTimeout: id => timers.delete(id), Error, Promise }, { filename: 'actual-nextmux-owned-browser-view.js' });
  const props = { owner, url: 'https://example.test/', title: 'Example', active: true, mobile: false, labels: {}, onLocation() {}, onTitle() {}, onSurface() {} };
  const view = new module.exports.NextMuxOwnedBrowserView(props); view.viewport = viewport; view.mounted = true;
  return { view, props, calls, state, bridge, document, viewport, timers,
    instantiate(nextOwner) { const nextProps = { ...props, owner: nextOwner }, next = new module.exports.NextMuxOwnedBrowserView(nextProps); next.viewport = viewport; next.mounted = true; return { view: next, props: nextProps }; } };
}

for (const event of ['inactive', 'outside-input', 'overlay']) test(`pending takeover is cancelled immediately when ${event} occurs`, async () => {
  const handoff = deferred(), f = renderer({ takeover: () => handoff.promise }); await f.view.ready();
  const toggling = f.view.toggle(); await flush();
  try {
    if (event === 'inactive') { const prior = f.view.props; f.view.props = { ...prior, active: false }; f.view.componentDidUpdate(prior); }
    else if (event === 'outside-input') f.view.outsideInput({ target: {} });
    else { f.document.querySelectorAll = () => [{ getBoundingClientRect: () => ({ left: 250, right: 300, top: 250, bottom: 300, width: 50, height: 50 }) }]; await f.view.layout(); }
    await flush(); assert.equal(f.calls.filter(call => call === 'release').length, 1, 'Main must receive release BEFORE the pending takeover resolves');
  } finally { handoff.resolve(f.state('manual')); await toggling; f.view.componentWillUnmount(); await flush(); }
});

test('DOM window blur alone must not release a manually controlled native child view', async () => {
  const f = renderer(); await f.view.ready(); f.view.accept(f.state('manual'));
  try { if (f.view.windowBlurred) f.view.windowBlurred(); await flush(); assert.equal(f.calls.filter(call => call === 'release').length, 0, 'Main BrowserWindow blur is authoritative; changing focus to its child webContents is not OS blur'); }
  finally { f.view.componentWillUnmount(); await flush(); }
});

test('transient preview failures do not mark a usable page as failed', async () => {
  const f = renderer(); await f.view.ready(); await f.view.refresh(); assert.equal(f.view.state.error, false); f.view.componentWillUnmount(); await flush();
});

test('manual release button is not pre-empted by document outside-input and never retakes control', async () => {
  const calls = [], f = renderer({ takeover: async () => { calls.push('takeover'); return f.state('manual'); } }); await f.view.ready(); f.view.accept(f.state('manual'));
  f.view.outsideInput({ target: { inside: true } }); await f.view.toggle(); await flush();
  try { assert.equal(f.calls.filter(call => call === 'release').length, 1); assert.equal(calls.length, 0); assert.equal(f.view.page.mode, 'background'); }
  finally { f.view.componentWillUnmount(); await flush(); }
});

for (const mode of ['background', 'manual']) test(`late preview cannot replace newer ${mode} state`, async () => {
  const capture = deferred(), f = renderer({ preview: () => capture.promise }); await f.view.ready();
  const refreshing = f.view.refresh(); await flush(); const previous = f.view.page.revision;
  f.view.accept({ ...f.state(mode), revision: previous + 10 });
  capture.resolve({ dataURL: 'data:image/png;base64,fixture', revision: previous, width: 20, height: 20, capturedAt: Date.now(), captureStartedAt: Date.now() }); await refreshing;
  try { assert.equal(f.view.state.preview, undefined); }
  finally { f.view.componentWillUnmount(); await flush(); }
});

test('unmount closes an in-flight creation after it completes and never publishes late state', async () => {
  const created = deferred(), f = renderer({ create: () => created.promise }); const ready = f.view.ready();
  f.view.componentWillUnmount(); assert.equal(f.calls.length, 0); created.resolve(f.state('background')); await ready; await flush();
  assert.equal(f.calls.filter(call => call === 'close').length, 1); assert.equal(f.view.page, undefined);
});

test('switching owner with same browser ID waits old close before acquiring a new immutable owner', async () => {
  const records = new Map(), calls = [];
  const bridge = {
    async create(owner) { calls.push(['create', owner.conversationId]); const current = records.get(owner.browserId); if (current && current !== owner.conversationId) throw Error('BROWSER_REQUEST_DENIED'); records.set(owner.browserId, owner.conversationId); return { id: 1, url: 'https://example.test/', title: '', loading: false, canGoBack: false, canGoForward: false, mode: 'background', revision: 1, mobile: false }; },
    async close(owner) { calls.push(['close', owner.conversationId]); if (records.get(owner.browserId) === owner.conversationId) records.delete(owner.browserId); }
  };
  const first = renderer(bridge); await first.view.ready(); first.view.componentWillUnmount();
  const second = first.instantiate({ ...first.props.owner, conversationId: 'next-conversation' });
  try { await second.view.ready(); assert.equal(records.get('browser'), 'next-conversation'); }
  finally { second.view.componentWillUnmount(); await flush(); }
});

test('renderer transport does not silently replace a foreign request workspace', async () => {
  const source = readFileSync(resolve(extension, 'src/browser/nextmux-browser-automation.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} }, calls = [], owner = { conversationId: 'c', browserId: 'b', workspaceRoot: '/allowed' };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), window: { nextmuxDesktop: { ownedBrowser: { action: async (...args) => { calls.push(args); return { requestId: 'request', ok: true }; } } } }, setTimeout, clearTimeout, setInterval, clearInterval, Error, Promise });
  const result = await module.exports.runBrowserPageAction({ ownedBrowser: owner }, { id: 'request', action: 'click', conversationId: 'c', browserId: 'b', workspaceRoot: '/foreign', selector: '#button', expiresAt: Date.now() + 1000 });
  assert.equal(result.ok, false); assert.equal(calls.length, 0);
});

test('an older navigation failure cannot roll back a newer URL after awaiting state', async () => {
  const rollback = deferred(), f = renderer(), locations = []; await f.view.ready();
  f.view.props = { ...f.view.props, onLocation: value => locations.push(value) };
  let observed = 0;
  const newest = { ...f.state('background'), url: 'https://new.test/', revision: 100 };
  f.bridge.state = () => ++observed === 1 ? rollback.promise : Promise.resolve(newest);
  f.bridge.navigate = (_owner, command) => command.url === 'https://bad.test/' ? Promise.reject(Error('denied')) : Promise.resolve(newest);
  const old = f.view.navigate({ action: 'navigate', url: 'https://bad.test/' }); const caught = old.catch(() => undefined); await flush();
  assert.equal(observed, 1, 'The older failure must already be waiting on its actual-page query');
  await f.view.navigate({ action: 'navigate', url: 'https://new.test/' });
  f.view.props = { ...f.view.props, url: 'https://new.test/' };
  rollback.resolve({ ...f.state('background'), url: 'https://old.test/', revision: 20 }); await caught; await flush();
  try { assert.equal(locations.includes('https://old.test/'), false, 'A late old state query must never publish a stale URL, even if the next refresh fixes it'); assert.equal(locations.at(-1), 'https://new.test/'); }
  finally { f.view.componentWillUnmount(); await flush(); }
});

test('a model close request cannot remove a page held by manual control', async () => {
  const source = readFileSync(resolve(extension, 'src/browser/nextmux-desktop-widget.tsx'), 'utf8');
  const ast = ts.createSourceFile('actual-widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = widget.members.find(node => node.name?.getText(ast) === 'handleBrowserToolRequest');
  const code = ts.transpileModule('(class { ' + method.getText(ast) + ' })', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const owner = { conversationId: 'conversation', browserId: 'browser', workspaceRoot: '/workspace' };
  const denied = { requestId: 'close-request', ok: false, code: 'BROWSER_MANUAL_CONTROL', message: 'Manual control' };
  const Instance = vm.runInNewContext(code, { browserWorkspaceMatchesCanonical: async (a, b) => a === b,
    browserConversationKey: id => id, findOwnedBrowser: (items, id) => items.find(item => item.id === id),
    runBrowserPageAction: async () => denied,
    window: { nextmuxDesktop: { ownedBrowser: { state: async () => ({ mode: 'manual' }), action: async () => denied } } }, Promise, Date });
  let removed = 0;
  const instance = new Instance(); Object.assign(instance, {
    codingSessions: [{ id: 'conversation' }], projectBrowsers: new Map([['conversation', [{ id: 'browser', conversationId: 'conversation' }]]]),
    codingSessionWorkspaceRoot: () => '/workspace', browserToolSurface: async () => ({ ownedBrowser: owner }),
    codingBrowserElement: () => ({ ownedBrowser: owner }), removeCodingBrowser: () => { removed++; },
    platformService: { getBrowserToolRequests: async () => [{ id: 'close-request' }] }
  });
  const result = await instance.handleBrowserToolRequest({ id: 'close-request', action: 'close', ...owner, expiresAt: Date.now() + 1000 });
  assert.equal(result.ok, false); assert.equal(removed, 0, 'A model close must be authorized by the main registry before local removal');
});

test('failed transition remains retryable without bypassing the authoritative main transition', async () => {
  const f = renderer(); await f.view.ready();
  f.view.accept({ ...f.state('transitioning'), error: { code: 'BROWSER_TRANSITION_UNSETTLED', message: 'Input has not settled' } });
  const tree = f.view.render(), button = tree.children[0].children.find(node => node.type === 'button');
  try { assert.equal(button.props.disabled, false, 'After a failed transition, an explicit retry must reach main instead of leaving the native page permanently locked'); }
  finally { f.view.componentWillUnmount(); await flush(); }
});
