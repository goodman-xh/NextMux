import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { registerAppTools } from '../lib/node/nextmux-app-tools.js';
import { registerProjectMemoryTools } from '../lib/node/nextmux-project-memory-tools.js';
import { registerScheduleTools } from '../lib/node/nextmux-schedule-tools.js';
import { ProjectMemoryStore } from '../lib/node/nextmux-project-memory.js';
import { BrowserRefNames, browserActivitySummary } from '../lib/common/nextmux-browser-activity-summary.js';
const { conversationHistorySearchRecords, conversationMessageModelProjection } = createRequire(import.meta.url)('../lib/node/nextmux-conversation-search.js');

const registry = () => {
    const entries = new Map();
    return { entries, register(descriptor, handler) { entries.set(descriptor.name, { descriptor, handler }); },
        call(name, input = {}) { return entries.get(name).handler(input, { runId: 'model-language-test' }); } };
};
const english = value => assert.doesNotMatch(JSON.stringify(value), /\p{Script=Han}/u);
const summarySnapshot = result => ({ kind: result.summary.kind, params: result.summary.params, title: result.summary.title });

test('app tool model projection snapshots have English wrappers and semantic activities', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-model-language-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const tools = registry();
    registerAppTools(tools, { skillsRoot: root, otherSkillRoots: [],
        installSkillFromUrl: async () => ({ id: 'catalog:pdf-reader', installed: true }),
        addMcpServer: async () => ({ ok: true }), listMcpServers: async () => ({ ok: true, data: [] }) });
    const results = [await tools.call('nextmux.skills.list'),
        await tools.call('nextmux.skills.install', { url: 'https://github.com/example/skills' }),
        await tools.call('nextmux.skills.create', { name: 'test-skill', description: 'Test skill', instructions: 'Read the project files.' }),
        await tools.call('nextmux.mcp.add', { name: 'docs', command: 'docs-server' }), await tools.call('nextmux.mcp.list')];
    english([...tools.entries.values()].map(entry => entry.descriptor));
    english(results.map(result => result.modelOutput));
    assert.deepEqual(results.map(summarySnapshot), [
        { kind: 'nextmux.skills.list', params: { count: 0 }, title: 'Listed 0 installed skills' },
        { kind: 'nextmux.skills.install', params: { name: 'pdf-reader' }, title: 'Installed skill: pdf-reader' },
        { kind: 'nextmux.skills.create', params: { name: 'test-skill' }, title: 'Created skill: test-skill' },
        { kind: 'nextmux.mcp.add', params: { name: 'docs' }, title: 'Added MCP server: docs (awaiting user approval)' },
        { kind: 'nextmux.mcp.list', params: undefined, title: 'Read MCP servers' }
    ]);
    const failed = registry();
    registerAppTools(failed, { skillsRoot: root, otherSkillRoots: [],
        addMcpServer: async () => ({ ok: false, message: '界面错误' }), listMcpServers: async () => ({ ok: false, message: '界面错误' }) });
    await assert.rejects(failed.call('nextmux.mcp.add', { name: 'docs', command: 'docs-server' }), { code: 'MCP_ADD_FAILED', message: 'The MCP server could not be added' });
    await assert.rejects(failed.call('nextmux.mcp.list'), { code: 'MCP_LIST_FAILED', message: 'MCP servers could not be read' });
});

test('project memory and new DESIGN template are English while user content is preserved', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-memory-language-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new ProjectMemoryStore(root);
    await store.ensureDesign();
    assert.equal((await store.readDesign()).content, '# Project design\n\n## Goals and audience\n\n## Colors\n\n## Typography\n\n## Layout and spacing\n\n## Components and interaction\n\n## Accessibility\n\n## References and acceptance criteria\n');
    const userDesign = '# 用户设计\n保留用户文字。';
    await writeFile(join(root, 'DESIGN.md'), userDesign);
    await store.ensureDesign();
    assert.equal((await store.readDesign()).content, userDesign);
    const tools = registry(); registerProjectMemoryTools(tools, root);
    const proposed = await tools.call('project_memory.propose', { title: '用户经验', content: '用户正文', source: '用户来源' });
    const results = [await tools.call('project_memory.search'), await tools.call('project_memory.read', { id: proposed.modelOutput.id }), await tools.call('project_design.read'), proposed];
    assert.deepEqual(results.map(result => [result.summary.kind, result.summary.title]), [
        ['project_memory.search', 'Search project memory'], ['project_memory.read', 'Read project memory'],
        ['project_design.read', 'Read project design'], ['project_memory.propose', 'Save experience draft']]);
    english(proposed.modelOutput);
    assert.equal(results[1].modelOutput.entry.content, '用户正文');
    assert.equal(results[2].modelOutput.design.content, userDesign);
});

test('schedule projection omits stored UI messages and preserves user-authored text', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-schedule-language-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const tasks = [{ id: 'plan-1', title: '用户计划', prompt: '用户请求', workspacePath: root,
        lastStatus: 'failed', lastMessage: '系统中文错误', definitionRevision: 1 }];
    const tools = registry(); registerScheduleTools(tools, { workspaceRoot: root, defaults: {}, load: async () => tasks });
    const listed = await tools.call('nextmux.list_schedules');
    const output = JSON.parse(listed.modelOutput);
    assert.equal(output.tasks[0].lastStatus, 'failed');
    assert.equal(Object.hasOwn(output.tasks[0], 'lastMessage'), false);
    assert.equal(output.tasks[0].prompt, '用户请求');
    assert.deepEqual(summarySnapshot(listed), { kind: 'nextmux.list_schedules', params: { count: 1 }, title: 'Read project schedules' });
});

test('browser summaries carry semantic action and preserve external target names', () => {
    const names = new BrowserRefNames();
    names.remember('tab', { elements: [{ ref: 'button-1', name: '用户页面按钮' }] });
    const summary = browserActivitySummary({ action: 'click', ref: 'button-1' }, names, 'tab');
    assert.deepEqual(summary, { kind: 'browser.action', params: { action: 'click' }, title: 'Browser action', target: '用户页面按钮' });
});

test('all computer, tab and plugin operations expose English canonical activities', async () => {
    const sourceUrl = new URL('../src/node/nextmux-computer-tools.ts', import.meta.url);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ts.transpile(readFileSync(sourceUrl, 'utf8'), {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true
    }))(createRequire(new URL('../lib/node/nextmux-computer-tools.js', import.meta.url)), module, module.exports);
    const bridge = new module.exports.DesktopComputerTools();
    bridge.setCapability({ available: true, platform: 'darwin', delivery: 'background', version: 'test' });
    bridge.request = async () => ({ ok: true, output: { ok: true } });
    const tools = registry(); bridge.register(tools, 'conversation');
    const inputByName = {
        'computer.list_apps': {}, 'computer.list_windows': {}, 'computer.open_app': { selector: 'App' },
        'computer.observe_window': { pid: 1, windowId: 2 },
        'tabs.open_app': { app: 'App' }, 'tabs.list': {}, 'tabs.set': { tabId: 'tab' }, 'tabs.show': { tabId: 'tab' },
        'tabs.screenshot': { tabId: 'tab' }, 'tabs.click': { tabId: 'tab', x: 0, y: 0 },
        'tabs.drag': { tabId: 'tab', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        'tabs.scroll': { tabId: 'tab', x: 0, y: 0, direction: 'down' }, 'tabs.key': { tabId: 'tab', key: 'enter' },
        'tabs.type': { tabId: 'tab', text: '用户输入' }, 'tabs.close': { tabId: 'tab' },
        'plugins.list': {}, 'plugins.start': { tabId: 'tab', plugin: 'test-plugin' },
        'plugins.command': { runId: 'run' }, 'plugins.status': { runId: 'run' }, 'plugins.stop': { runId: 'run' }
    };
    const common = { pid: 1, windowId: 2, snapshotId: 'snapshot' };
    for (const name of ['click', 'double_click', 'right_click']) inputByName[`computer.${name}`] = common;
    Object.assign(inputByName, {
        'computer.verify_state': { ...common, expect: [{ window: { exists: true } }] }, 'computer.scroll': { ...common, direction: 'down', amount: 1 },
        'computer.drag': { ...common, fromX: 0, fromY: 0, toX: 1, toY: 1 }, 'computer.set_value': { ...common, elementToken: 'e', value: '用户输入' },
        'computer.type_text': { ...common, text: '用户输入' }, 'computer.press_key': { ...common, key: 'enter' }, 'computer.hotkey': { ...common, keys: ['ctrl', 'c'] }
    });
    assert.equal(Object.keys(inputByName).length, tools.entries.size);
    for (const [name, input] of Object.entries(inputByName)) {
        const result = await tools.call(name, input);
        assert.equal(result.summary.kind, name);
        english(result.summary);
        english(tools.entries.get(name).descriptor);
    }
    bridge.dispose();
});

const serviceSource = ts.createSourceFile('service.ts', readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const serviceClass = serviceSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
function serviceWithMethods(names, dependencies = {}) {
    const methods = names.map(name => serviceClass.members.find(member => member.name?.getText(serviceSource) === name).getText(serviceSource)).join('\n');
    const Service = new Function(...Object.keys(dependencies), ts.transpile(`class Service { ${methods} }; return Service;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(dependencies));
    return new Service();
}

test('browser cancellation, shutdown and timeout model errors are English snapshots', async () => {
    const { randomUUID } = await import('node:crypto');
    const service = serviceWithMethods(['requestBrowserTool'], { randomUUID, BROWSER_TOOL_REQUEST_TIMEOUT_MS: 1 });
    service.browserToolRequests = new Map();
    const request = { action: 'snapshot', conversationId: 'conversation' };
    assert.equal((await service.requestBrowserTool(request, AbortSignal.abort())).message, 'The browser action was cancelled.');
    service.connectionDisposed = true;
    assert.equal((await service.requestBrowserTool(request)).message, 'The app is closing; the browser action was not executed.');
    service.connectionDisposed = false;
    const controller = new AbortController();
    const pending = service.requestBrowserTool(request, controller.signal);
    controller.abort();
    assert.equal((await pending).message, 'The browser action was cancelled; verify any dispatched action on the page.');
    assert.equal((await service.requestBrowserTool(request)).message, 'The browser action timed out. Read a new snapshot to verify its result before retrying.');
});

test('conversation tool activity snapshots preserve user conversation text', async () => {
    const { AgentToolError } = await import('@nextmux/agent-runtime');
    const { randomUUID, createHash } = await import('node:crypto');
    const service = serviceWithMethods(['registerConversationTools'], { AgentToolError, randomUUID, createHash,
        boundedJsonValue: value => value, conversationMessageModelProjection, PlatformRequestError: class extends Error {} });
    const message = { id: 'message', prompt: '用户提问', response: '用户所需回复', error: '', createdAt: 1 };
    const conversation = { id: 'conversation', title: '用户标题', workspacePath: '/project', messages: [message] };
    service.durableConversationSearchRecords = async () => [conversation];
    const saved = new Map();
    service.conversationStore = () => ({ readSession: async id => saved.get(id), isDeletedSession: async () => false });
    service.patchConversationHistory = async ({ upserts }) => upserts.forEach(record => saved.set(record.id, record));
    const tools = registry(); service.registerConversationTools(tools, '/project');
    const searched = await tools.call('nextmux.search_conversations', { query: '用户' });
    const read = await tools.call('nextmux.get_conversation_message', { conversationId: 'conversation', messageId: 'message' });
    const created = await tools.call('nextmux.create_conversation', { title: '用户标题', idempotencyKey: 'same' });
    const reused = await tools.call('nextmux.create_conversation', { title: '用户标题', idempotencyKey: 'same' });
    assert.equal(searched.modelOutput.results[0].messages[0].response, message.response);
    assert.equal(read.modelOutput.response, message.response);
    assert.deepEqual([searched, read, created, reused].map(result => [result.summary.kind, result.summary.title]), [
        ['conversation.search', 'Search local conversations'], ['conversation.read', 'Read conversation message'],
        ['conversation.create', 'Create local conversation'], ['conversation.exists', 'Conversation already exists']
    ]);
    english([...tools.entries.values()].map(entry => entry.descriptor));
});

test('conversation search and exact read canonicalize only runtime prose and structured errors', async () => {
    const { AgentToolError } = await import('@nextmux/agent-runtime');
    const service = serviceWithMethods(['registerConversationTools'], { AgentToolError,
        boundedJsonValue: value => value, conversationMessageModelProjection });
    const authored = '任务已暂停，可从检查点继续。以上是我引用的提示，接下来解释实现细节。';
    const cases = [
        { id: 'runtime', response: '旧的本地化结束消息', finalMessage: { origin: 'runtime', stopReason: 'pause_requested' },
            stopReason: 'pause_requested', error: '旧界面错误', failure: { code: 'MODEL_TIMEOUT', kind: 'model_timeout', message: '旧界面错误' } },
        { id: 'legacy', response: '任务已暂停，可从检查点继续。', stopReason: 'pause_requested' },
        { id: 'authored', response: authored, stopReason: 'pause_requested' },
        { id: 'invalid', response: '保留模型正文', finalMessage: { origin: 'runtime', stopReason: '未知停止原因' },
            stopReason: '未知停止原因', error: '未知系统错误', failure: { code: '本地化错误', kind: 'failed' } },
        { id: 'completed', response: 'Task completed.', finalMessage: { origin: 'runtime', stopReason: 'completed' }, stopReason: 'completed' }
    ];
    const records = conversationHistorySearchRecords([{ id: 'conversation', title: '用户标题', workspacePath: '/project', createdAt: 1, updatedAt: 2,
        turns: cases.map(value => ({ ...value, prompt: '用户请求', createdAt: 1, assistantMessageId: value.id })) }]);
    service.durableConversationSearchRecords = async () => records;
    const tools = registry(); service.registerConversationTools(tools, '/project');
    const search = await tools.call('nextmux.search_conversations', { conversationId: 'conversation' });
    const responses = Object.fromEntries(search.modelOutput.results[0].messages.map(message => [message.messageId, message]));
    for (const candidate of cases) {
        const read = (await tools.call('nextmux.get_conversation_message', { conversationId: 'conversation', messageId: candidate.id })).modelOutput;
        if (responses[candidate.id]) assert.equal(responses[candidate.id].response, read.response);
        if (candidate.id === 'runtime' || candidate.id === 'legacy') assert.equal(read.response, 'Task paused; resume from its checkpoint.');
        if (candidate.id === 'runtime') { assert.equal(read.errorCode, 'MODEL_TIMEOUT'); assert.equal(read.error, 'Task failed (MODEL_TIMEOUT).'); }
        if (candidate.id === 'authored') assert.equal(read.response, authored);
        if (candidate.id === 'invalid') { assert.equal(read.response, '保留模型正文'); assert.equal(read.error, 'Task failed.'); assert.equal(read.errorCode, undefined); }
        if (candidate.id === 'completed') assert.equal(read.response, 'Task completed.');
        assert.doesNotMatch(read.error, /\p{Script=Han}/u);
    }
    assert.equal(records[0].messages.find(message => message.id === 'runtime').response, '旧的本地化结束消息');
    assert.equal(records[0].messages.find(message => message.id === 'runtime').error, '旧界面错误');
});

test('skill loader uses English fallback and passes through user-authored descriptions and instructions', async () => {
    const { AgentToolError } = await import('@nextmux/agent-runtime');
    const { fileURLToPath } = await import('node:url');
    const service = serviceWithMethods(['registerSkills'], { AgentToolError, join, tmpdir, homedir: tmpdir, fileURLToPath,
        MAX_AGENT_SKILLS: 20, SKILL_LIMITS: { totalInstructions: 10000 }, readVerifiedAgentSkill: async value => value,
        SkillFormatError: class extends Error {}, PlatformRequestError: class extends Error {} });
    service.skillEnvironment = { getConfigDirUri: async () => new URL('file:///tmp/config') };
    const tools = registry(); tools.registerHostSkillLoader = tools.register.bind(tools);
    await service.registerSkills(tools, [{ name: 'empty-description', description: '', instructions: '用户写的技能正文' },
        { name: 'user-skill', description: '用户说明', instructions: '用户要求' }], '/project');
    assert.equal(tools.entries.get('skill.load').descriptor.description,
        'Load one user-approved Skill only when it is relevant to the task. Available Skills:\nempty-description: No description available.\nuser-skill: 用户说明');
    const result = await tools.call('skill.load', { name: 'empty-description' });
    assert.deepEqual(summarySnapshot(result), { kind: 'skill.load', params: { name: 'empty-description' }, title: 'Load skill: empty-description' });
    assert.equal(result.modelOutput.instructions, '用户写的技能正文');
});

test('browser error semantics survive renderer RPC and reach AgentToolError', async () => {
    const { AgentToolError, safeAgentMessageParams } = await import('@nextmux/agent-runtime');
    const service = serviceWithMethods(['resolveBrowserToolRequest', 'registerBrowserTools'], {
        AgentToolError, safeAgentMessageParams, boundedJsonValue: value => value, browserActivitySummary
    });
    let resolved;
    service.browserToolRequests = new Map([['request', { timer: undefined, resolve: value => { resolved = value; } }]]);
    await service.resolveBrowserToolRequest({ requestId: 'request', ok: false, code: 'BROWSER_ELEMENT_MISSING',
        params: { action: 'click', count: 1, nested: { ignore: true } }, message: 'The browser target was not found.' });
    assert.deepEqual(resolved, { requestId: 'request', ok: false, code: 'BROWSER_ELEMENT_MISSING',
        params: { action: 'click', count: 1 }, message: 'The browser target was not found.' });
    service.requestBrowserTool = async () => resolved;
    const tools = registry(); service.registerBrowserTools(tools, 'conversation', '/workspace');
    await assert.rejects(tools.call('browser.click', { ref: 'target' }), error => {
        assert.equal(error.code, 'BROWSER_ELEMENT_MISSING');
        assert.equal(error.message, 'The browser target was not found.');
        assert.deepEqual(error.params, { action: 'click', count: 1 });
        return true;
    });
});

test('crash-recovery journal preserves bounded semantic activities and error parameters', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-journal-language-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ts.transpile(readFileSync(new URL('../src/node/nextmux-agent-run-journal.ts', import.meta.url), 'utf8'),
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(
        createRequire(new URL('../lib/node/nextmux-agent-run-journal.js', import.meta.url)), module, module.exports);
    const store = new module.exports.AgentRunJournalStore(root), runId = 'agent-language-recovery';
    await store.appendEvent(runId, { type: 'tool_completed', callId: 'call', toolName: 'browser.click', ok: false, status: 'failed', durationMs: 2,
        at: new Date().toISOString(), summary: { kind: 'tool.error', params: { code: 'BROWSER_ELEMENT_MISSING', bad: { nested: true } }, title: 'Tool failed' },
        failure: { code: 'BROWSER_ELEMENT_MISSING', message: 'The browser target was not found.', params: { action: 'click' } } });
    await store.flushEvents(runId);
    const [event] = await new module.exports.AgentRunJournalStore(root).loadEvents(runId);
    assert.equal(event.summary.kind, 'tool.error');
    assert.deepEqual(event.summary.params, { code: 'BROWSER_ELEMENT_MISSING' });
    assert.deepEqual(event.failure.params, { action: 'click' });
});
