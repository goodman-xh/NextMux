import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['restoreAllChanges', 'restoreCheckpoint', 'recordCommittedRestores', 'refreshRestoredContextFiles', 'createWorkspaceRestorePlan', 'isCheckpointRestored', 'markCheckpointRestored', 'unmarkCheckpointRestored'].map(name =>
    widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast)).join('\n');
const js = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeAgentRunVerification } = require('@nextmux/agent-runtime/run-verification');
const Harness = Function('changeFileGroupKey', 'desktopFailureMessage', 'localizeDesktopSurface', 'fileDrawerText', 'normalizeAgentRunVerification', `${js}; return Harness;`)(require('../lib/browser/nextmux-change-grouping.js').changeFileGroupKey, (_locale, error) => error.message, (_locale, text) => text, (_locale, key) => key, normalizeAgentRunVerification);

function fixture() {
    const host = new Harness();
    const owner = { id: 'original', turns: [] };
    const calls = [], marks = [], releases = [], versions = [], notices = [];
    let active = owner;
    Object.assign(host, {
        activeWorkspaceRoot: '/original', desktopLocale: 'zh-CN',
        activeCodingSession: () => active, codingSessionWorkspaceRoot: () => '/original',
        codingSessionStoredWorkspaceRoots: () => ['/original'],
        conversationMutations: { tryAcquire: id => () => releases.push(id) },
        isCheckpointRestored: id => id === 'already-restored',
        markCheckpointRestored: (id, session) => marks.push([id, session.id]),
        recordContextFileVersion: async (...args) => versions.push(args),
        platformService: {
            getAgentCheckpointDiff: async (root, id) => ({ checkpointId: id, path: 'file.ts', kind: 'modified' }),
            restoreAgentCheckpointGroups: async groups => {
                for (const group of groups) calls.push([group.workspaceRoot, group.checkpointIds]);
                return { checkpointIds: groups.flatMap(group => group.checkpointIds),
                    versions: groups.map(group => ({ workspaceRoot: group.workspaceRoot, checkpointId: 'restoration-event', path: 'file.ts' })) };
            }
        },
        update() {}, async loadContextFiles() {}, addNotification(...args) { notices.push(args); }
    });
    return { host, owner, calls, marks, releases, versions, notices, switchSession: () => { active = { id: 'other', turns: [] }; } };
}
const changes = ['first', 'second', 'second', 'already-restored'].map(checkpointId => ({ checkpointId }));

test('restore all submits a reverse unique chain and marks only the successful receipt', async () => {
    const f = fixture();
    await f.host.restoreAllChanges(changes);
    assert.deepEqual(f.calls, [['/original', ['already-restored', 'second', 'first']]]);
    assert.deepEqual(f.marks, [['already-restored', 'original'], ['second', 'original'], ['first', 'original']]);
    assert.deepEqual(f.releases, ['original']);
    assert.deepEqual(f.versions, [['original', '/original', 'restoration-event', undefined, false]]);
    assert.equal(f.host.restoringCheckpointId, '');
});

test('a chain conflict leaves the UI unmarked and releases the mutation lock', async () => {
    const f = fixture();
    f.host.platformService.restoreAgentCheckpointGroups = async () => { throw new Error('CHECKPOINT_CONFLICT'); };
    await f.host.restoreAllChanges(changes);
    assert.deepEqual(f.marks, []);
    assert.equal(f.host.agentError, 'CHECKPOINT_CONFLICT');
    assert.deepEqual(f.releases, ['original']);
});

for (const operation of ['single', 'all']) {
    for (const navigated of [false, true]) {
        test(`${operation} restore conflict is visible after a settled turn${navigated ? ' even after navigation' : ''}`, async () => {
            const f = fixture();
            f.owner.turns.push({ id: 'finished-turn', stage: 'complete' });
            f.host.platformService.restoreAgentCheckpointGroups = async () => {
                if (navigated) f.switchSession();
                throw new Error('CHECKPOINT_CONFLICT');
            };
            if (operation === 'single') await f.host.restoreCheckpoint('file-checkpoint');
            else await f.host.restoreAllChanges(changes);
            assert.deepEqual(f.notices.map(args => args.slice(0, 3)), [['error', '无法恢复修改', 'CHECKPOINT_CONFLICT']]);
            assert.deepEqual(f.marks, []);
            assert.deepEqual(f.versions, []);
            assert.deepEqual(f.releases, ['original']);
            if (navigated) assert.equal(f.host.agentError, '');
        });
    }
}

test('navigation during restore keeps checkpoint receipts on the original conversation', async () => {
    const f = fixture();
    let finish;
    f.host.platformService.restoreAgentCheckpointGroups = () => new Promise(resolve => { finish = resolve; });
    const restoring = f.host.restoreAllChanges(changes);
    f.switchSession();
    await new Promise(resolve => setImmediate(resolve));
    finish({ checkpointIds: ['already-restored', 'second', 'first'], versions: [{ workspaceRoot: '/original', checkpointId: 'new-version', path: 'file.ts' }] });
    await restoring;
    assert.deepEqual(f.marks, [['already-restored', 'original'], ['second', 'original'], ['first', 'original']]);
    assert.deepEqual(f.versions, [['original', '/original', 'new-version', undefined, false]]);
});

test('single-file review restore uses the grouped transaction and records its new version', async () => {
    const f = fixture();
    await f.host.restoreCheckpoint('file-checkpoint');
    assert.deepEqual(f.calls, [['/original', ['file-checkpoint']]]);
    assert.deepEqual(f.marks, [['file-checkpoint', 'original']]);
    assert.deepEqual(f.versions, [['original', '/original', 'restoration-event', undefined, false]]);
    assert.deepEqual(f.releases, ['original']);
});

test('postcommit history failure warns once and does not repeat or misreport a successful file restore', async () => {
    const f = fixture(), attempts = [];
    f.host.platformService.restoreAgentCheckpointGroups = async groups => {
        f.calls.push(groups);
        return { checkpointIds: ['first'], versions: [
            { workspaceRoot: '/original', checkpointId: 'failed-ui-event' },
            { workspaceRoot: '/other-root', checkpointId: 'recorded-ui-event' }
        ] };
    };
    f.host.recordContextFileVersion = async (...args) => {
        attempts.push(args);
        if (args[2] === 'failed-ui-event') throw new Error('history refresh unavailable');
    };
    await f.host.restoreAllChanges([{ checkpointId: 'first' }]);
    assert.equal(f.calls.length, 1); assert.equal(attempts.length, 2);
    assert.deepEqual(f.marks, [['first', 'original']]); assert.equal(f.host.agentError, '');
    assert.deepEqual(f.notices.map(args => args.slice(0, 3)), [['warning', 'history', 'historyPartial']]);
    assert.deepEqual(f.releases, ['original']);
});

test('running work cannot restore, but a previous receipt does not prevent a new restore', async () => {
    const f = fixture();
    f.owner.turns.push({ stage: 'running' });
    await f.host.restoreAllChanges(changes);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.releases, []);
    f.owner.turns = [];
    await f.host.restoreAllChanges([{ checkpointId: 'already-restored' }]);
    assert.deepEqual(f.calls, [['/original', ['already-restored']]]);
    assert.deepEqual(f.releases, ['original']);
});

test('undo all replays unique after versions forward with each current hash and keeps receipts on the owner', async () => {
    const f = fixture(), writes = [], unmarks = [];
    f.host.unmarkCheckpointRestored = (id, session) => unmarks.push([id, session.id]);
    f.host.platformService.getAgentFileState = async ({ checkpointId }) => ({ sha256: `baseline-${checkpointId}` });
    f.host.platformService.restoreAgentFileVersion = async request => {
        writes.push(request);
        if (request.checkpointId === 'first') f.switchSession();
        return { checkpointId: `version-${request.checkpointId}` };
    };
    await f.host.restoreAllChanges(changes, true);
    assert.deepEqual(writes.map(item => [item.checkpointId, item.side, item.expectedSha256, item.conversationId]),
        ['first', 'second', 'already-restored'].map(id => [id, 'after', `baseline-${id}`, 'original']));
    assert.deepEqual(unmarks, ['first', 'second', 'already-restored'].map(id => [id, 'original']));
    assert.deepEqual(f.versions.map(item => item.slice(0, 3)), ['first', 'second', 'already-restored'].map(id => ['original', '/original', `version-${id}`]));
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.releases, ['original']);
});

test('a later undo conflict preserves earlier committed history and leaves failed files marked', async () => {
    const f = fixture(), unmarks = [];
    f.host.unmarkCheckpointRestored = id => unmarks.push(id);
    f.host.platformService.getAgentFileState = async () => ({ sha256: null });
    f.host.platformService.restoreAgentFileVersion = async request => {
        if (request.checkpointId === 'second') throw new Error('CHECKPOINT_CONFLICT');
        return { checkpointId: 'committed-first' };
    };
    await f.host.restoreAllChanges(changes, true);
    assert.deepEqual(unmarks, ['first']);
    assert.deepEqual(f.versions.map(item => item[2]), ['committed-first']);
    assert.equal(f.host.agentError, 'CHECKPOINT_CONFLICT');
    assert.deepEqual(f.releases, ['original']);
});

test('single grouped file restores a reverse chain and undo reaches its final after version', async () => {
    const f = fixture(), writes = [], unmarks = [];
    f.owner.turns = [{ id: 'turn', changes: [
        { checkpointId: 'first', path: 'a.ts' }, { checkpointId: 'other', path: 'b.ts' }, { checkpointId: 'last', path: 'a.ts' }
    ] }];
    f.host.unmarkCheckpointRestored = id => unmarks.push(id);
    f.host.platformService.getAgentFileState = async () => ({ sha256: 'current' });
    f.host.platformService.restoreAgentFileVersion = async request => { writes.push(request.checkpointId); return { checkpointId: `v-${request.checkpointId}` }; };
    await f.host.restoreCheckpoint('first');
    assert.deepEqual(f.calls, [['/original', ['last', 'first']]]);
    await f.host.restoreCheckpoint('first', true);
    assert.deepEqual(writes, ['first', 'last']);
    assert.deepEqual(unmarks, ['first']);
});

const build = desktopRequire('esbuild').buildSync({
    entryPoints: [fileURLToPath(new URL('../src/browser/nextmux-change-review.tsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, loader: { '.css': 'empty' },
    external: ['react'], logLevel: 'silent'
});
const module = { exports: {} };
Function('require', 'module', 'exports', build.outputFiles[0].text)(require, module, module.exports);
const React = require('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const { NextMuxChangeReview } = module.exports;
const verification = { status: 'passed', changedPaths: ['a.ts'], revision: 1,
    checks: [{ callId: 'test', command: 'node --test', status: 'passed', exitCode: 0, afterLastChange: true, revision: 1 }] };
const files = ['a', 'b'].map(checkpointId => ({ checkpointId, path: `${checkpointId}.ts`, additions: 1, deletions: 0 }));
function render(extra = {}) {
    return renderToStaticMarkup(React.createElement(NextMuxChangeReview, { locale: 'zh-CN', changes: files, verification,
        isRestored: () => false, onOpen() {}, onRestore() {}, onRestoreAll() {}, ...extra }));
}
test('change review keeps file restoration without redundant verification badges or commands', () => {
    assert.doesNotMatch(render(), /is-passed|检查通过|nmx-turn-review-check|node --test/);
    // Without a passing or failing check the summary is only "N files changed" (no "unverified" badge).
    assert.doesNotMatch(render({ verification: undefined }), /is-unverified|尚未验证/);
    assert.match(render({ verification: undefined }), /2 个文件已修改/);
    assert.doesNotMatch(render({ isRestored: id => id === 'a' }), /is-unverified|尚未验证/);
    const previouslyRestored = render({ isRestored: () => true });
    assert.doesNotMatch(previouslyRestored, /is-unverified|disabled/);
    // Round 31 live run: a restore recorded on the same turn was summed into the row (+6 −6) and still offered 恢复.
    assert.equal(previouslyRestored.match(/已恢复/g)?.length, 2);
    assert.match(previouslyRestored, /撤销全部恢复/);
    assert.doesNotMatch(previouslyRestored, /恢复所有修改|<b>\+/);
    const partlyRestored = render({ isRestored: id => id === 'a' });
    assert.match(partlyRestored, /恢复所有修改/);
    assert.match(partlyRestored, /is-restored/);
    assert.equal(partlyRestored.match(/>恢复</g)?.length, 1);
    assert.equal(render({ changes: [], verification: undefined }), '');
});

test('checkpoint coverage warnings do not render extra warning text in the file review list', () => {
    assert.equal(render({ changes: [], verification: undefined, warnings: ['Snapshot budget exceeded'] }), '');
});

test('restored receipts survive a new widget and invalidate previous passing checks', () => {
    const host = new Harness();
    host.codingSessions = [{ id: 'owner', turns: [{ id: 'turn', changes: files, verification }] }];
    host.restoredCheckpointKeys = new Set();
    host.checkpointRestoreKey = id => `owner:${id}`;
    host.updateCodingTurn = (owner, id, patch) => {
        host.codingSessions = host.codingSessions.map(session => session.id === owner
            ? { ...session, turns: session.turns.map(turn => turn.id === id ? { ...turn, ...patch } : turn) } : session);
    };
    const originalSession = host.codingSessions[0];
    host.markCheckpointRestored('a', originalSession);
    host.markCheckpointRestored('b', originalSession);
    const saved = JSON.parse(JSON.stringify(host.codingSessions));
    host.restoredCheckpointKeys.clear();
    host.codingSessions = saved;
    assert.equal(host.isCheckpointRestored('a', saved[0]), true);
    assert.equal(host.isCheckpointRestored('b', saved[0]), true);
    assert.equal(saved[0].turns[0].verification.status, 'unverified');
    assert.equal(saved[0].turns[0].verification.checks[0].afterLastChange, false);
    host.unmarkCheckpointRestored('a', saved[0]);
    assert.equal(host.isCheckpointRestored('a', host.codingSessions[0]), false);
    assert.equal(host.isCheckpointRestored('b', host.codingSessions[0]), true);
});


test('partial snapshot coverage keeps standard restore label without extra warning copy', () => {
    const html = render({ warnings: ['Source snapshot file/byte budget reached'] });
    assert.match(html, /恢复所有修改/); assert.doesNotMatch(html, /恢复已记录修改|Source snapshot|部分文件超出/);
    assert.equal(render({ changes: [], warnings: ['Source snapshot file/byte budget reached'] }), '');
});

test('permission-only and omitted large previews do not pretend to be zero-line content edits', () => {
    assert.match(render({ changes: [{ ...files[0], beforeMode: 0o644, afterMode: 0o755, additions: 0, deletions: 0 }] }), /644 → 755/);
    const html = render({ changes: [{ ...files[0], truncated: true, patch: '', additions: 0, deletions: 0 }] });
    assert.match(html, /完整版本可恢复/); assert.doesNotMatch(html, /<b>\+0<\/b>/);
});


test('single-file undo preserves A:first → B:second → A:last order for one external target across roots', async () => {
    const f = fixture(), writes = [], unmarks = [];
    const externalChanges = [
        { checkpointId: 'first', path: '/shared/file.ts', externalTarget: '/shared/file.ts', workspaceRoot: '/root-a' },
        { checkpointId: 'second', path: '/shared/file.ts', externalTarget: '/shared/file.ts', workspaceRoot: '/root-b' },
        { checkpointId: 'last', path: '/shared/file.ts', externalTarget: '/shared/file.ts', workspaceRoot: '/root-a' }
    ];
    f.owner.turns = [{ id: 'turn', changes: externalChanges }];
    f.host.codingSessionStoredWorkspaceRoots = () => ['/root-a', '/root-b'];
    f.host.platformService.getAgentCheckpointDiff = async (root, id) => {
        const change = externalChanges.find(item => item.checkpointId === id);
        assert.equal(root, change.workspaceRoot);
        return { ...change, kind: 'modified' };
    };
    let currentHash = 'original';
    f.host.platformService.getAgentFileState = async () => ({ sha256: currentHash });
    f.host.platformService.restoreAgentFileVersion = async request => {
        assert.equal(request.expectedSha256, currentHash);
        assert.equal(request.side, 'after');
        writes.push([request.workspaceRoot, request.checkpointId]);
        currentHash = `after-${request.checkpointId}`;
        return { checkpointId: `version-${request.checkpointId}` };
    };
    f.host.unmarkCheckpointRestored = id => unmarks.push(id);
    await f.host.restoreCheckpoint('first', true);
    assert.deepEqual(writes, [['/root-a', 'first'], ['/root-b', 'second'], ['/root-a', 'last']]);
    assert.equal(currentHash, 'after-last');
    assert.deepEqual(unmarks, ['first']);
    assert.deepEqual(f.versions.map(item => item.slice(0, 3)), [
        ['original', '/root-a', 'version-first'], ['original', '/root-b', 'version-second'], ['original', '/root-a', 'version-last']
    ]);
    assert.deepEqual(f.notices, []);
});

test('restore marks and undo synchronize a shared external target across roots without changing another file', () => {
    const f = fixture();
    f.owner.turns = [{ id: 'turn', changes: [
        { checkpointId: 'first', path: '/shared/file.ts', externalTarget: '/shared/file.ts', workspaceRoot: '/root-a' },
        { checkpointId: 'second', path: '/shared/file.ts', externalTarget: '/shared/file.ts', workspaceRoot: '/root-b' },
        { checkpointId: 'last', path: '/shared/file.ts', externalTarget: '/shared/file.ts', workspaceRoot: '/root-a' },
        { checkpointId: 'other', path: '/shared/file.ts', externalTarget: '/another/file.ts', workspaceRoot: '/root-a' }
    ] }];
    delete f.host.markCheckpointRestored;
    delete f.host.isCheckpointRestored;
    f.host.codingSessions = [f.owner];
    f.host.restoredCheckpointKeys = new Set();
    f.host.checkpointRestoreKey = id => `original:${id}`;
    f.host.updateCodingTurn = (owner, id, patch) => {
        f.host.codingSessions = f.host.codingSessions.map(session => session.id === owner
            ? { ...session, turns: session.turns.map(turn => turn.id === id ? { ...turn, ...patch } : turn) } : session);
    };
    f.host.markCheckpointRestored('first', f.owner);
    assert.deepEqual(f.host.codingSessions[0].turns[0].restoredCheckpointIds, ['first', 'second', 'last']);
    for (const id of ['first', 'second', 'last']) assert.equal(f.host.isCheckpointRestored(id, f.owner), true);
    assert.equal(f.host.isCheckpointRestored('other', f.owner), false);
    f.host.markCheckpointRestored('other', f.owner);
    f.host.codingSessions = JSON.parse(JSON.stringify(f.host.codingSessions));
    f.host.restoredCheckpointKeys.clear();
    f.host.unmarkCheckpointRestored('second', f.owner);
    for (const id of ['first', 'second', 'last']) assert.equal(f.host.isCheckpointRestored(id, f.owner), false);
    assert.equal(f.host.isCheckpointRestored('other', f.owner), true);
    assert.deepEqual(f.host.codingSessions[0].turns[0].restoredCheckpointIds, ['other']);
});
