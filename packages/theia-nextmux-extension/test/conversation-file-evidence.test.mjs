import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { outputFiles } = await desktop('esbuild').build({
    entryPoints: [fileURLToPath(new URL('../src/browser/nextmux-conversation-file-target.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm'
});
const { conversationTurnFileEvidence: evidence } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const read = (path, overrides = {}) => ({ type: 'tool_completed', ok: true, toolName: 'workspace.read_file',
    summary: { title: 'read', kind: 'workspace.read_file', resource: { kind: 'file', action: 'read', path } }, ...overrides });

test('the actual reply path matches a unique completed read even when the session workspace differs', () => {
    const target = String.raw`C:\Users\test\Desktop\ai漫剧\app\components\AdminConsole.tsx`;
    assert.deepEqual(evidence('app/components/AdminConsole.tsx#L42', [read(target), read(target)]), { status: 'matched', path: target });
});

test('matching uses every relative path segment and permits a unique evidenced bare filename', () => {
    const exact = '/outside/project/app/components/AdminConsole.tsx';
    const sameName = '/outside/other/lib/components/AdminConsole.tsx';
    assert.deepEqual(evidence('app/components/AdminConsole.tsx', [read(exact), read(sameName)]), { status: 'matched', path: exact });
    for (const path of ['AdminConsole.tsx', './AdminConsole.tsx']) {
        assert.deepEqual(evidence(path, [read(exact)]), { status: 'matched', path: exact });
        assert.deepEqual(evidence(path, [read(exact), read(sameName)]), { status: 'matched', path: sameName });
    }
    assert.deepEqual(evidence('../app/components/AdminConsole.tsx', [read(exact)]), { status: 'none' });
});

test('duplicate suffixes without a workspace use the latest successful turn evidence', () => {
    const first = '/one/app/components/AdminConsole.tsx';
    const second = '/two/app/components/AdminConsole.tsx';
    assert.deepEqual(evidence('app/components/AdminConsole.tsx', [read(first), read(second)]), { status: 'matched', path: second });
    assert.deepEqual(evidence('AdminConsole.tsx', [read(first), read(second), read(first)]), { status: 'matched', path: first });
});

test('main-conversation duplicates prefer the exact active-workspace resolution', () => {
    const path = '/project/tests/admin-unified-layout.test.mjs';
    const turn = { workspaceRoot: '/project/', events: [read(path), read('/project/copy/tests/admin-unified-layout.test.mjs'),
        read('/other/tests/admin-unified-layout.test.mjs')] };
    assert.deepEqual(evidence('tests/admin-unified-layout.test.mjs#L12', turn), { status: 'matched', path });
});

test('subagent duplicates prefer the explicitly supplied private workspace', () => {
    const path = '/private/child/tests/admin-unified-layout.test.mjs';
    const turn = { workspaceRoot: '/project', events: [read(path), read('/project/tests/admin-unified-layout.test.mjs')] };
    assert.deepEqual(evidence('tests/admin-unified-layout.test.mjs', turn, '/private/child/'), { status: 'matched', path });
});

test('bare filenames prefer recent in-workspace evidence over another root or a prefix sibling', () => {
    const path = '/project/nested/recent/report.md';
    const turn = { workspaceRoot: '/project/', events: [read('/project/old/report.md'), read(path),
        read('/project-copy/report.md'), read('/elsewhere/report.md')] };
    assert.deepEqual(evidence('report.md', turn), { status: 'matched', path });
    assert.deepEqual(evidence('report.md', { workspaceRoot: '/project', events: [read('/other/a/report.md'), read('/other/b/report.md')] }),
        { status: 'matched', path: '/other/b/report.md' });
});

test('mixed relative and absolute evidence keeps recency at filesystem roots and roots with repeated trailing separators', () => {
    for (const [workspaceRoot, path] of [
        ['/', '/new/report.md'], ['/project//', '/project/new/report.md'],
        ['C:\\', 'C:/new/report.md'], ['//server/share//', '//server/share/new/report.md']
    ]) {
        assert.deepEqual(evidence('report.md', { workspaceRoot, events: [read('old/report.md'), read(path)] }),
            { status: 'matched', path }, workspaceRoot);
    }
});

test('Windows and UNC workspaces compare normalized separators and case with trailing root separators', () => {
    for (const [root, path, nested] of [
        ['C:\\Users\\test\\work\\', String.raw`c:\Users\test\WORK\tests\report.md`, 'C:/Users/test/work/copy/tests/report.md'],
        ['\\\\Server\\Share\\work\\', String.raw`\\server\share\WORK\tests\report.md`, '//Server/Share/work/copy/tests/report.md']
    ]) {
        assert.deepEqual(evidence('tests/report.md', [read(path), read(nested)], root), { status: 'matched', path });
    }
});

test('absolute destinations never change to a similarly named workspace file', () => {
    const path = '/outside/tests/report.md';
    const events = [read(path), read('/project/tests/report.md')];
    assert.deepEqual(evidence(path, events, '/project'), { status: 'matched', path });
    assert.deepEqual(evidence('/missing/tests/report.md', events, '/project'), { status: 'none' });
});

test('uncompleted, failed, unrelated tools and unrooted relative resources cannot supply a target', () => {
    const path = '/outside/project/app/file.ts';
    const events = [read(path, { type: 'tool_started' }), read(path, { ok: false }), read(path, { ok: undefined }),
        read(path, { toolName: 'unrelated.tool' }), read('app/file.ts')];
    assert.deepEqual(evidence('app/file.ts', events), { status: 'none' });
});

test('native resource percent signs remain literal while Markdown destinations decode exactly once', () => {
    const path = '/outside/project/app/literal%20name.ts';
    assert.deepEqual(evidence('app/literal%2520name.ts', [read(path)]), { status: 'matched', path });
    assert.deepEqual(evidence('app/literal%20name.ts', [read(path)]), { status: 'none' });
});

test('HTTPS destinations never become files even if their path resembles a successful read', () => {
    assert.deepEqual(evidence('https://example.test/app/file.ts', [read('/outside/app/file.ts')]), { status: 'none' });
});
