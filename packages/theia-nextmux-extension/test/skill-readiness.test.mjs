import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { Emitter } = require('@theia/core/lib/common/event');
const { DisposableCollection } = require('@theia/core/lib/common/disposable');
const { Deferred } = require('@theia/core/lib/common/promise-util');
const { URI } = require('@theia/core/lib/common/uri');
const skill = require('@theia/ai-core/lib/common/skill');
const key = 'ai-features.skillDirectories';
const modules = {
    tslib: createRequire(require.resolve('@theia/ai-core/package.json'))('tslib'),
    '@theia/core/shared/inversify': { inject: () => () => {}, injectable: () => target => target, named: () => () => {}, postConstruct: () => () => {} },
    '@theia/core': { Emitter, DisposableCollection, URI, ILogger: Symbol('logger') },
    '@theia/core/lib/browser': {},
    '@theia/core/lib/common/env-variables': { EnvVariablesServer: Symbol('env') },
    '@theia/filesystem/lib/browser/file-service': { FileService: class {} },
    '@theia/filesystem/lib/common/files': { FileChangeType: { UPDATED: 0, ADDED: 1, DELETED: 2 } },
    '@theia/workspace/lib/browser': { WorkspaceService: class {} },
    '../common/ai-core-preferences': { AICorePreferences: Symbol('prefs'), PREFERENCE_NAME_SKILL_DIRECTORIES: key },
    '@theia/ai-core/lib/common/ai-core-preferences': { PREFERENCE_NAME_SKILL_DIRECTORIES: key },
    '../common/skill': skill,
    '../common/prompt-service': { PromptService: Symbol('prompt') }
};
function load(source) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', source)(id => modules[id] ?? require(id), module, module.exports);
    return module.exports;
}
// Run the actual installed scanner. Only its browser services are replaced; parser, URI and Deferred are real.
const upstream = load(readFileSync(require.resolve('@theia/ai-core/lib/browser/skill-service'), 'utf8'));
modules['./skill-service'] = upstream;
modules['@theia/ai-core/lib/browser/skill-service'] = upstream;
modules['@theia/ai-core/lib/browser/skill-prompt-coordinator'] = load(readFileSync(require.resolve('@theia/ai-core/lib/browser/skill-prompt-coordinator'), 'utf8'));
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText;
modules['./nextmux-domain-errors'] = load(compile(readFileSync(new URL('../src/common/nextmux-domain-errors.ts', import.meta.url), 'utf8')));
modules['./nextmux-skill-domain'] = load(compile(readFileSync(new URL('../src/common/nextmux-skill-domain.ts', import.meta.url), 'utf8')));
modules['../common/nextmux-skill-format'] = load(compile(readFileSync(new URL('../src/common/nextmux-skill-format.ts', import.meta.url), 'utf8')));
const { NextMuxSkillService, NextMuxSkillPromptCoordinator } = load(compile(readFileSync(new URL('../src/browser/nextmux-skill-service.ts', import.meta.url), 'utf8')));
const { skillReadinessText } = load(compile(readFileSync(new URL('../src/browser/nextmux-skill-readiness-locale.ts', import.meta.url), 'utf8')));

function fixture(failure) {
    const files = new Emitter(), preferences = new Emitter(), workspace = new Emitter();
    let fail = failure, reads = 0, listeners = 0;
    const service = new NextMuxSkillService();
    service.preferences = { [key]: [], onPreferenceChanged: listener => { listeners++; return preferences.event(listener); } };
    service.fileService = { onDidFilesChange: listener => { listeners++; return files.event(listener); }, exists: async () => false };
    service.workspaceService = {
        get ready() { return fail === 'workspace' ? Promise.reject(new Error('private workspace diagnostic')) : Promise.resolve(); },
        tryGetRoots: () => [], onWorkspaceChanged: listener => { listeners++; return workspace.event(listener); }
    };
    service.envVariablesServer = {
        getHomeDirUri: async () => { reads++; if (fail === 'home') throw new Error('private home diagnostic'); return 'file:///synthetic/home'; },
        getConfigDirUri: async () => { if (fail === 'config') throw new Error('private config diagnostic'); return 'file:///synthetic/config'; }
    };
    service.logger = { info() {}, debug() {}, warn() {}, error() {} };
    const commands = new Map(); let adds = 0;
    const coordinator = new NextMuxSkillPromptCoordinator();
    coordinator.skillService = service;
    coordinator.promptService = {
        addBuiltInPromptFragment(fragment) { adds++; commands.set(fragment.id, fragment); },
        removePromptFragment(id) { commands.delete(id); }
    };
    return { service, coordinator, commands, files, preferences, workspace, get reads() { return reads; },
        get listeners() { return listeners; }, get adds() { return adds; }, repair() { fail = undefined; } };
}

for (const source of ['workspace', 'home', 'config']) {
    test(`${source} initialization failure settles readiness and allows startup; retry uses the real scanner`, async () => {
        const f = fixture(source);
        f.service.init();
        await assert.rejects(f.service.ready, /SKILLS_NOT_READY/);
        await f.coordinator.onStart();
        assert.equal(f.service.state, 'error');
        assert.equal(f.listeners, 3);
        f.repair();
        await f.service.refresh();
        assert.equal(f.service.state, 'ready');
        f.service.init();
        await f.coordinator.onStart();
        assert.equal(f.listeners, 3, 'retries must not duplicate file, preference or workspace subscriptions');
    });
}

test('concurrent refresh calls share a complete scan and never resolve early', async () => {
    const f = fixture();
    const gate = new Deferred();
    f.service.envVariablesServer.getHomeDirUri = () => gate.promise;
    f.service.init();
    const first = f.service.ready, second = f.service.refresh();
    assert.equal(first, second);
    let complete = false;
    first.then(() => { complete = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(complete, false);
    gate.resolve('file:///synthetic/home');
    await second;
    assert.equal(f.service.state, 'ready');
});

test('workspace changes during initialization rescan before requests can observe ready', async () => {
    const f = fixture();
    const gate = new Deferred(); let scans = 0;
    const scan = f.service.doUpdate.bind(f.service);
    f.service.doUpdate = async () => { scans++; if (scans === 1) await gate.promise; await scan(); };
    f.service.init();
    await new Promise(resolve => setImmediate(resolve));
    f.workspace.fire([]);
    gate.resolve();
    await f.service.ready;
    assert.equal(scans, 2);
});

test('recovery registers commands once, and subsequent successful refresh removes obsolete commands', async () => {
    const f = fixture('home');
    f.service.init();
    await f.coordinator.onStart();
    f.service.doUpdate = async () => { f.service.skills = new Map([['fixture', { name: 'fixture', description: 'test', location: '/fixture/SKILL.md' }]]); };
    f.repair();
    await f.service.refresh();
    await new Promise(resolve => setImmediate(resolve));
    await f.coordinator.onStart();
    await f.service.refresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.commands.size, 1);
    assert.equal(f.adds, 1);
    f.service.doUpdate = async () => { f.service.skills = new Map(); };
    await f.service.refresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.commands.size, 0);
});

test('file events honor directory boundaries and discover newly created Skills directories', async () => {
    const f = fixture();
    f.service.init(); await f.service.ready;
    f.service.watchedDirectories.add('file:///synthetic/skills');
    f.service.parentWatchers.set('/synthetic', '/synthetic/new-skills');
    let updates = 0;
    f.service.scheduleUpdate = () => { updates++; };
    f.files.fire({ changes: [{ type: 0, resource: new URI('file:///synthetic/skills-other/SKILL.md') }] });
    f.files.fire({ changes: [{ type: 1, resource: new URI('file:///synthetic/skills/.nextmux-install-123/SKILL.md') }] });
    assert.equal(updates, 0);
    f.files.fire({ changes: [{ type: 0, resource: new URI('file:///synthetic/skills/demo/SKILL.md') }] });
    f.files.fire({ changes: [{ type: 0, resource: new URI('file:///synthetic/skills/demo/subdir') }] });
    f.files.fire({ changes: [{ type: 1, resource: new URI('file:///synthetic/new-skills') }] });
    assert.equal(updates, 3);
});

test('real discovery isolates malformed global Skills, keeps good Skills ready and clears errors after repair', async () => {
    const f = fixture();
    const format = modules['../common/nextmux-skill-format'];
    const root = '/synthetic/home/.agents/skills';
    const content = new Map([
        ['good', '---\nname: good\ndescription: Good skill\n---\nValid instructions.'],
        ['.nextmux-install-temp', '---\nname: good\ndescription: Staging skill\n---\nTemporary staging dir.'],
        ['colon', '---\nname: colon\ndescription: Review: inspect code\n---\nValid instructions.'],
        ['long', `---\nname: long\ndescription: Large body\n---\n${'x'.repeat(format.SKILL_LIMITS.instructions + 1)}`],
        // 23,000 CJK characters are 69 KB: within the 192 KiB file limit, so this Skill loads.
        ['unicode', `---\nname: unicode\ndescription: Large bytes\n---\n${'中'.repeat(23000)}`],
        ['invalid-utf8', new Uint8Array([0xc3, 0x28])]
    ]);
    f.service.fileService.exists = async uri => uri.path.fsPath() === root || content.has(uri.parent.path.base);
    f.service.fileService.resolve = async () => ({ children: [...content.keys()].map(name => ({ name, isDirectory: true, resource: URI.fromFilePath(`${root}/${name}`) })) });
    f.service.fileService.watch = () => ({ dispose() {} });
    f.service.fileService.readFile = async (uri, options) => {
        assert.equal(options.limits.size, format.SKILL_LIMITS.fileBytes);
        const body = content.get(uri.parent.path.base);
        return { value: { buffer: typeof body === 'string' ? new TextEncoder().encode(body) : body } };
    };
    f.service.init();
    await f.service.ready;
    assert.equal(f.service.state, 'ready');
    assert.deepEqual(f.service.getSkills().map(skill => skill.name), ['good', 'unicode']);
    assert.deepEqual(f.service.getSkillErrors().map(error => error.name), ['colon', 'long', 'invalid-utf8']);
    await f.coordinator.onStart();
    assert.equal(f.commands.size, 2);
    content.delete('long'); content.delete('unicode'); content.delete('invalid-utf8');
    content.set('colon', '---\nname: colon\ndescription: "Review: inspect code"\n---\nValid instructions.');
    await f.service.refresh();
    assert.equal(f.service.getSkills().length, 2);
    assert.deepEqual(f.service.getSkillErrors(), []);
});

const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const method = name => {
    let result; const visit = node => { if (ts.isMethodDeclaration(node) && node.name.getText(ast) === name) result = node.getText(ast); ts.forEachChild(node, visit); };
    visit(ast); assert.ok(result); return result;
};

test('renderer prepares the same full validated bytes and reports a broken Skill without truncating it', async () => {
    const format = modules['../common/nextmux-skill-format'];
    const content = new Map([
        ['good', '---\nname: good\ndescription: Good\n---\nRead all of this.'],
        ['large', `---\nname: large\ndescription: Too long\n---\n${'x'.repeat(format.SKILL_LIMITS.instructions + 1)}`]
    ]);
    const skills = [...content.keys()].map(name => ({ name, description: name, location: `/global/${name}/SKILL.md` }));
    const issues = [];
    const Fixture = new Function('URI', 'SKILL_LIMITS', 'parseNextMuxSkill', 'decodeSkillBytes', 'crypto', 'window',
        `${compile(`class Fixture { ${method('prepareAgentSkills')} }`)}; return Fixture;`)(URI, format.SKILL_LIMITS,
        format.parseNextMuxSkill, format.decodeSkillBytes, require('node:crypto').webcrypto,
        { setTimeout: (callback, ms) => setTimeout(callback, ms).unref(), clearTimeout });
    const widget = new Fixture();
    Object.assign(widget, {
        workspaceSkills: () => skills,
        skillService: { ready: Promise.resolve(), getSkills: () => skills, reportSkillError: (...args) => issues.push(args) },
        fileService: { readFile: async uri => ({ value: { buffer: new TextEncoder().encode(content.get(uri.parent.path.base)) } }) }
    });
    const prepared = await widget.prepareAgentSkills('/project');
    assert.deepEqual(prepared.map(skill => skill.name), ['good']);
    assert.equal(prepared[0].instructions, 'Read all of this.');
    assert.equal(prepared[0].sourceSha256, require('node:crypto').createHash('sha256').update(content.get('good')).digest('hex'));
    assert.equal(issues.length, 1);
    assert.equal(issues[0][0], 'large');
    assert.equal(issues[0][2].code, 'INVALID_SKILLS');
});

function submissionFixture(ready) {
    const body = compile(`class Fixture { ${method('executePromptSubmission')} }`);
    const Fixture = new Function('composerContentToken', 'automaticRelaySource', 'MAX_TOTAL_ATTACHMENTS_PER_TASK', 'skillReadinessText',
        `${body}; return Fixture;`)((owner, prompt) => `${owner}:${prompt}`, () => 'manual', 32, skillReadinessText);
    const widget = new Fixture();
    Object.assign(widget, {
        applicationExitGeneration: 0, conversationHistoryLoadGeneration: 0, applicationExitPreparing: false,
        activeCodingSessionId: 'original', prompt: 'keep this draft', attachments: [], pastedTextReferences: [], editedTurnAttachmentOrder: [],
        agentStage: 'idle', activeAgentRunId: '', desktopLocale: 'zh-CN',
        conversationHistoryReady: () => true, activePastedTextReferences: () => [], update() {}, skillService: { ready },
        invalidCouncilConfigMessage: () => undefined,
        // 应用操控: no app picked for this message.
        composerApp: () => undefined
    });
    return widget;
}

test('failed Skills initialization preserves the actual submission draft and creates no task', async () => {
    const widget = submissionFixture(Promise.reject(new Error('SKILLS_NOT_READY')));
    assert.equal(await widget.executePromptSubmission('coding'), false);
    assert.equal(widget.prompt, 'keep this draft');
    assert.equal(widget.submittedPrompt, undefined);
    assert.equal(widget.agentStage, 'idle');
    assert.match(widget.attachmentError, /Skills/);
});

test('a late readiness result cannot send from a different conversation', async () => {
    const gate = new Deferred();
    const widget = submissionFixture(gate.promise);
    const pending = widget.executePromptSubmission('coding');
    widget.activeCodingSessionId = 'different';
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(widget.prompt, 'keep this draft');
    assert.equal(widget.submittedPrompt, undefined);
});
