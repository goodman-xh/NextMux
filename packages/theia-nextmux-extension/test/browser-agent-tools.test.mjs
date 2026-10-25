import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { AgentToolRegistry, AgentToolError } from '@nextmux/agent-runtime';
import { BrowserRefNames, browserActivitySummary } from '../lib/common/nextmux-browser-activity-summary.js';

async function browserRegistryFixture(answer) {
  const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
  const service = parsed.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(parsed) === 'registerBrowserTools'));
  const method = service.members.find(member => member.name?.getText(parsed) === 'registerBrowserTools').getText(parsed);
  const summaryData = [];
  const context = vm.createContext({ AgentToolError, Object, browserActivitySummary: (input, names, key) => {
    summaryData.push(input.data);
    return browserActivitySummary(input, names, key);
  } });
  vm.runInContext(ts.transpileModule('class BrowserToolsHarness { ' + method + ' }; globalThis.BrowserToolsHarness = BrowserToolsHarness;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const host = new context.BrowserToolsHarness(), calls = [], registry = new AgentToolRegistry();
  host.browserRefNames = new BrowserRefNames();
  host.requestBrowserTool = async request => {
    calls.push(request);
    return answer(request);
  };
  host.registerBrowserTools(registry, 'owner', '/project');
  const execute = (name, args = {}) => registry.execute({ id: 'fixture-call', name, arguments: args }, 'full_access', { runId: 'run', workspaceRoot: '/project' });
  return { registry, calls, summaryData, execute };
}

test('built-in page identity aliases round-trip while snapshot refs and original result data stay intact', async () => {
  const opened = Object.freeze({ id: 'owned-page', snapshotId: 'observation-only', destination: 'builtin-browser',
    url: 'https://fixture.test/', title: 'Fixture', elements: Object.freeze([{ ref: 'observation-onlye1', name: 'Input' }]) });
  const listed = Object.freeze([Object.freeze({ id: 'owned-page', url: opened.url, title: opened.title, active: true }),
    Object.freeze({ id: 'other-owned-page', url: 'https://fixture.test/other', title: 'Other', active: false })]);
  const snapshot = Object.freeze({ snapshotId: 'latest-observation', elements: Object.freeze([{ ref: 'latest-observatione1', name: 'Input' }]) });
  const f = await browserRegistryFixture(request => ({ ok: true, data: request.action === 'open' ? opened
    : request.action === 'list' ? listed : snapshot }));
  const page = await f.execute('browser.open', { url: opened.url });
  assert.equal(page.output.browserId, opened.id, 'actual builtin destination supplies the direct next-tool argument');
  assert.equal(page.output.id, opened.id);
  assert.equal(page.output.snapshotId, opened.snapshotId);
  assert.strictEqual(page.output.elements, opened.elements);
  assert.equal(Object.hasOwn(opened, 'browserId'), false, 'the renderer result is not mutated');
  assert.strictEqual(f.summaryData[0], opened, 'display summary receives the original data');
  const read = await f.execute('browser.snapshot', { browserId: page.output.browserId });
  assert.strictEqual(read.output, snapshot, 'other action results are unchanged');
  assert.equal(f.calls.at(-1).browserId, opened.id);
  const tabs = await f.execute('browser.tabs');
  assert.equal(tabs.output.length, listed.length);
  for (let index = 0; index < listed.length; index++) {
    assert.equal(tabs.output[index].browserId, listed[index].id);
    for (const key of ['id', 'url', 'title', 'active']) assert.equal(tabs.output[index][key], listed[index][key]);
    assert.equal(Object.hasOwn(listed[index], 'browserId'), false);
  }
  await f.execute('browser.click', { browserId: tabs.output[1].browserId, ref: snapshot.elements[0].ref });
  assert.equal(f.calls.at(-1).browserId, listed[1].id);
  assert.equal(f.calls.at(-1).ref, snapshot.elements[0].ref);
  assert.ok(f.calls.every(call => call.conversationId === 'owner' && call.workspaceRoot === '/project'));
  assert.equal(f.calls.length, 4, 'projection never creates an extra renderer action');
});

test('page identity aliases never guess from system, truncated, malformed or failed results', async () => {
  let response;
  const f = await browserRegistryFixture(() => response);
  const unchanged = [
    { destination: 'system-browser', id: 'external-page', snapshotId: 'observation-only' },
    { destination: 'builtin-browser', truncated: true, id: 'owned-page', originalCharacters: 70000 },
    { destination: 'builtin-browser', snapshotId: 'observation-only' },
    { destination: 'builtin-browser', id: '' },
    { destination: 'builtin-browser', id: ' '.repeat(3) },
    { destination: 'builtin-browser', id: 'x'.repeat(121) },
    Object.assign(new (class UnexpectedRecord {})(), { destination: 'builtin-browser', id: 'class-instance' })
  ];
  for (const data of unchanged) {
    response = { ok: true, data };
    const result = await f.execute('browser.open', { url: 'https://fixture.test/', destination: 'builtin-browser' });
    assert.strictEqual(result.output, data);
    assert.equal(Object.hasOwn(result.output, 'browserId'), false);
    assert.strictEqual(f.summaryData.at(-1), data);
  }
  response = { ok: true, data: [{ id: 'x'.repeat(120), active: false }, { id: 42 }, { truncated: true, id: 'unverified' }, null] };
  const list = await f.execute('browser.tabs');
  assert.equal(list.output[0].browserId, response.data[0].id, 'the existing maximum length remains supported');
  assert.strictEqual(list.output[1], response.data[1]);
  assert.strictEqual(list.output[2], response.data[2]);
  assert.strictEqual(list.output[3], null);
  response = { ok: false, code: 'BROWSER_TOOL_FAILED', message: 'Existing failure', params: { action: 'open' } };
  const before = f.summaryData.length, failed = await f.execute('browser.open', { url: 'https://fixture.test/' });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, response.code);
  assert.equal(failed.error.message, response.message);
  assert.equal(f.summaryData.length, before, 'failure does not create a success summary or alias');
  assert.equal(f.calls.length, unchanged.length + 2, 'no implicit retry is dispatched');
});

test('every browser page argument explains stable identity and each target field explains exactly one choice', async () => {
  const f = await browserRegistryFixture(() => ({ ok: true }));
  const tools = f.registry.descriptors('full_access');
  const pageTools = ['snapshot', 'activate', 'navigate', 'back', 'forward', 'reload', 'click', 'fill', 'select', 'upload', 'drag'];
  const descriptions = pageTools.map(action => {
    const descriptor = tools.find(tool => tool.name === 'browser.' + action);
    assert.deepEqual(descriptor.inputSchema.properties.browserId.minLength, 1);
    assert.deepEqual(descriptor.inputSchema.properties.browserId.maxLength, 120);
    assert.equal(Object.hasOwn(descriptor.inputSchema, 'oneOf'), false, 'description-only guidance preserves input validation');
    return descriptor.inputSchema.properties.browserId.description;
  });
  assert.equal(new Set(descriptions).size, 1);
  assert.match(descriptions[0], /browserId returned/);
  assert.match(descriptions[0], /snapshotId.*never a page id/);
  for (const action of ['click', 'fill', 'select', 'upload', 'drag']) {
    const properties = tools.find(tool => tool.name === 'browser.' + action).inputSchema.properties;
    assert.match(properties.ref.description, /exactly one.*ref.*selector/i);
    assert.match(properties.selector.description, /exactly one.*ref.*selector/i);
    assert.match(properties.ref.description, /latest snapshot/);
  }
});

test('built-in browser tools are registered as structured renderer actions', async () => {
  const service = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  for (const name of ['browser.tabs', 'browser.open', 'browser.activate', 'browser.navigate', 'browser.back', 'browser.forward', 'browser.reload', 'browser.snapshot', 'browser.click', 'browser.fill']) {
    assert.match(service, new RegExp(`name: '${name.replace('.', '\\.')}'`), `missing ${name}`);
  }
  assert.match(service, /getBrowserToolRequests/);
  assert.match(service, /resolveBrowserToolRequest/);
  assert.match(widget, /startBrowserToolBridge/);
  assert.match(widget, /runBrowserPageAction/);
  assert.match(widget, /findOwnedBrowser/);
  assert.doesNotMatch(widget, /request\.conversationId !== this\.activeCodingSessionId/);
  const automation = await readFile(new URL('../src/browser/nextmux-browser-automation.ts', import.meta.url), 'utf8');
  assert.match(automation, /document\.querySelectorAll/);
  assert.doesNotMatch(service, /browser\.executeJavaScript/);
});

test('actual browser.open tool validates and forwards per-call destinations and reports the executed destination', async () => {
  const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
  const service = parsed.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(parsed) === 'registerBrowserTools'));
  const method = service.members.find(member => member.name?.getText(parsed) === 'registerBrowserTools').getText(parsed);
  const context = vm.createContext({ AgentToolError, Object, browserActivitySummary });
  vm.runInContext(ts.transpileModule(`class BrowserToolsHarness { ${method} }; globalThis.BrowserToolsHarness = BrowserToolsHarness;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const host = new context.BrowserToolsHarness();
  host.browserRefNames = new BrowserRefNames();
  const calls = [];
  host.requestBrowserTool = async request => {
    calls.push(request);
    return { ok: true, data: { url: request.url, destination: request.destination || 'system-browser' } };
  };
  const registry = new AgentToolRegistry();
  host.registerBrowserTools(registry, 'owner', '/project');
  const execute = (arguments_, permission = 'full_access') => registry.execute({ id: 'call', name: 'browser.open', arguments: arguments_ }, permission, { runId: 'run', workspaceRoot: '/project' });
  for (const destination of [undefined, 'default', 'builtin-browser', 'system-browser']) {
    const result = await execute({ url: 'https://fixture.test/', ...(destination ? { destination } : {}) });
    assert.equal(result.ok, true);
    const expected = destination === 'builtin-browser' ? 'builtin-browser' : 'system-browser';
    assert.equal(result.output.destination, expected);
    assert.equal(result.summary.params.action, expected === 'system-browser' ? 'open_external' : 'open');
    assert.equal(calls.at(-1).destination, ['builtin-browser', 'system-browser'].includes(destination) ? destination : undefined);
  }
  const count = calls.length;
  assert.equal((await execute({ url: 'https://fixture.test/', destination: 'Chrome' })).ok, false);
  assert.equal((await execute({ url: 'https://fixture.test/' }, 'read_only')).ok, false);
  assert.equal(calls.length, count);
  assert.match(registry.descriptors('full_access').find(tool => tool.name === 'browser.open').description, /even when the user names Chrome, Safari or Edge/);
  const tools = registry.descriptors('full_access');
  assert.match(tools.find(tool => tool.name === 'browser.open').description, /pass this id as browserId/);
  assert.match(tools.find(tool => tool.name === 'browser.tabs').description, /page.*id, title and URL/);
  assert.match(tools.find(tool => tool.name === 'browser.click').inputSchema.properties.browserId.description, /snapshotId.*never a page id/);
  const opened = { id: 'owned-page', snapshotId: 'snapshot-only', destination: 'builtin-browser', url: 'https://fixture.test/' };
  host.requestBrowserTool = async request => {
    calls.push(request);
    return { ok: true, data: request.action === 'open' ? opened : { ok: true } };
  };
  const page = await execute({ url: opened.url, destination: 'builtin-browser' });
  assert.equal(page.output.id, opened.id);
  assert.equal(page.output.snapshotId, opened.snapshotId, 'observation identity remains separate');
  assert.equal((await registry.execute({ id: 'click-owned', name: 'browser.click', arguments: { browserId: page.output.id, ref: 'e2' } },
    'full_access', { runId: 'run', workspaceRoot: '/project' })).ok, true);
  assert.equal(calls.at(-1).browserId, opened.id);
  assert.equal(calls.at(-1).conversationId, 'owner', 'the conversation ownership contract is unchanged');
});

test('app and browser instructions preserve the default browser unless the user explicitly chooses an app tab', async () => {
  const source = await readFile(new URL('../src/node/nextmux-app-tools.ts', import.meta.url), 'utf8');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(
    createRequire(new URL('../lib/node/nextmux-app-tools.js', import.meta.url)), module, module.exports);
  const app = module.exports.nextmuxAppInstructions('/skills');
  const tabs = module.exports.nextmuxTabInstructions();
  assert.match(app, /saved built-in\/system browser choice/);
  assert.match(app, /with no saved choice, it opens in the right-hand browser drawer/);
  assert.match(app, /Merely naming Chrome, Safari or Edge does not request an app tab/);
  assert.match(app, /user attached that browser.*explicitly selected an existing browser app tab.*explicitly asked/s);
  assert.match(app, /Do not change their saved preference/);
  assert.match(tabs, /For browsers, the browser routing rules take precedence/);
  assert.match(tabs, /a browser app tab merely existing does not override the browser routing rules/);
  assert.match(tabs, /first line like "\[App: Calculator/);
  assert.doesNotMatch(tabs, /For requests like.*"open this link"/);
});

test('public research instructions distinguish remote tools from an explicit browser request without inventing search access', async () => {
  const { nextmuxAppInstructions } = await import('../lib/node/nextmux-app-tools.js');
  const instructions = nextmuxAppInstructions('/skills');
  assert.match(instructions, /Public web research.*is not a request to open the user/);
  assert.match(instructions, /Only call tools actually offered/);
  assert.match(instructions, /model API does not automatically include search/);
  assert.match(instructions, /fall back to browser\.open using the saved browser preference/);
  assert.match(instructions, /Use the browser only after this capability\/results check/);
  assert.match(instructions, /Logged-in\/dynamic pages or real page interactions/);
  assert.match(instructions, /pending billing\/transport receipt is not proof/);
  assert.match(instructions, /Preserve source URLs/);
  assert.doesNotMatch(instructions, /A request to open a browser, open a link, search/);
  const service = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const computer = await readFile(new URL('../src/node/nextmux-computer-tools.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /ordinary browser\/link\/search requests/);
  assert.doesNotMatch(computer, /ordinary browser, link or web search requests/);
});
