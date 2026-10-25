import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { DesktopDomainError } from '../lib/common/nextmux-domain-errors.js';

const read = relativePath => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
const widget = read('../src/browser/nextmux-desktop-widget.tsx');
const service = read('../src/node/nextmux-platform-service.ts');

test('bound projects are revalidated while unbound conversations retain a stable private workspace', async () => {
    const ast = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = ['workspaceRootIsOpen', 'verifyCodingProjectPath', 'codingSessionWorkspaceRoot', 'ensureCodingSessionWorkspace'].map(name => {
        const method = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
        assert.ok(method, name); return method.getText(ast);
    });
    const Harness = new Function('URI', 'DesktopDomainError', ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))({ fromFilePath: pathToFileURL }, DesktopDomainError);
    const root = await mkdtemp(join(tmpdir(), 'nextmux-workspace-fallback-'));
    try {
        const project = join(root, 'project'), privateRoot = join(root, 'private'), secondRoot = join(root, 'private-second');
        await Promise.all([mkdir(project), mkdir(privateRoot), mkdir(secondRoot)]);
        const state = new Harness(), requests = [], persisted = [];
        const bound = { id: 'bound', workspacePath: project, ownedWorkspace: false, updatedAt: 1 };
        Object.assign(state, { workspaceOptions: [{ path: project }], verifiedCodingProjectPaths: new Set([project]), codingSessions: [bound],
            fileService: { async resolve(uri) { return { isDirectory: (await stat(uri)).isDirectory() }; } },
            defaultPermissionMode: 'workspace_write',
            platformService: { async getConversationWorkspaceBindings(id) {
                requests.push(id); return { workspaceRoot: privateRoot, workspaces: [{ workspaceRoot: privateRoot }, { workspaceRoot: secondRoot }] };
            } },
            persistCodingSessions() { persisted.push(structuredClone(this.codingSessions)); }, persistDesktopRestoreState() {}
        });
        assert.equal(await state.ensureCodingSessionWorkspace(bound), bound);
        await rm(project, { recursive: true });
        await assert.rejects(state.ensureCodingSessionWorkspace(bound), { code: 'WORKSPACE_UNAVAILABLE' });
        assert.equal(state.verifiedCodingProjectPaths.has(project), false);
        await writeFile(project, 'a file is not a workspace');
        await assert.rejects(state.ensureCodingSessionWorkspace(bound), { code: 'WORKSPACE_UNAVAILABLE' });
        assert.deepEqual(requests, [], 'Missing bound projects never silently switch to a private directory');
        await rm(project); await mkdir(project);
        assert.equal(await state.ensureCodingSessionWorkspace(bound), bound, 'A deliberately reopened same path is usable again');
        const unbound = { id: 'unbound', workspacePath: '', ownedWorkspace: false, updatedAt: 1 };
        state.codingSessions.push(unbound);
        const resolved = await state.ensureCodingSessionWorkspace(unbound);
        assert.equal(resolved.privateWorkspacePath, privateRoot);
        assert.equal(resolved.ownedWorkspace, true);
        assert.deepEqual(resolved.workspaceBindings.map(item => item.path), [privateRoot, secondRoot]);
        assert.equal(state.codingSessionWorkspaceRoot(resolved), privateRoot);
        assert.equal(await state.ensureCodingSessionWorkspace(resolved), resolved);
        assert.deepEqual(requests, ['unbound']); assert.equal(persisted.length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('conversation workspace identifiers are validated before filesystem access', () => {
    assert.match(service, /!\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(conversationId\)/);
    assert.match(service, /throw new PlatformRequestError\('INVALID_CONVERSATION'/);
});
