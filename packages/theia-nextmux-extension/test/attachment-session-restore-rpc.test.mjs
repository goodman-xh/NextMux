import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;

// Exercise the real renderer request builder against the real file/history RPC,
// so a stub that ignores request ownership cannot hide this integration failure.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['readCachedAttachmentBytes', 'codingSessionWorkspaceRoot', 'workspaceRootIsOpen'];
const methods = [];
function visit(node) {
    if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(file))) methods.push(node.getText(file));
    ts.forEachChild(node, visit);
}
visit(file);
assert.equal(methods.length, names.length);
const code = ts.transpile(`class Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
const { codingProjectPathKey } = await import('../lib/browser/nextmux-sidebar-projects.js');
const Harness = new Function('URI', 'codingProjectPathKey', `${code}; return Harness;`)(URI, codingProjectPathKey);

class AttachmentService extends NextMuxPlatformServiceImpl {
    constructor(dataRoot, recent) {
        super();
        this.dataRoot = dataRoot;
        this.recent = recent;
        this.workspaceServer = { getMostRecentlyUsedWorkspace: async () => this.recent };
    }
    nextmuxDataRoot() { return this.dataRoot; }
}

async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-session-attachment-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, 'project A'), second = join(root, 'project B'), profile = join(root, 'profile');
    await Promise.all([mkdir(project), mkdir(second)]);
    const workspaceFile = join(root, 'NextMux.auto.theia-workspace');
    await writeFile(workspaceFile, JSON.stringify({ folders: [{ path: project }, { path: second }] }));
    const service = new AttachmentService(profile, pathToFileURL(project).href);
    const widget = new Harness();
    const requests = [];
    Object.assign(widget, {
        workspaceOptions: [{ path: project }, { path: second }], verifiedCodingProjectPaths: new Set(),
        base64ToBytes: value => new Uint8Array(Buffer.from(value, 'base64')),
        platformService: { readDesktopAttachment: request => {
            requests.push(request); return service.readDesktopAttachment(request);
        } }
    });
    return { service, widget, requests, project, second, profile, workspaceFile };
}

const conversationId = '00000000-0000-4000-8000-000000000084';
const cache = (service, name, bytes, scope = {}) => service.cacheDesktopAttachment({
    name, mimeType: 'text/plain', dataBase64: bytes.toString('base64'), ...scope
});

test('saved project attachment restores after MRU changes from its folder to a multi-root workspace file', async t => {
    const f = await fixture(t);
    const session = { id: conversationId, title: 'Synthetic attachment restore', workspacePath: f.project,
        ownedWorkspace: false, turns: [], createdAt: 1, updatedAt: 2,
        workspaceBindings: [{ id: 'project', path: f.project, kind: 'project', status: 'available' }] };
    await f.service.saveConversationHistory([session]);
    const examples = [['notes.txt', Buffer.from('Synthetic UTF-8 文本\n')],
        ['table.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,b\n1,2\n', 'utf16le')])]];
    for (const [name, bytes] of examples) {
        const item = { name, ...await cache(f.service, name, bytes, { workspaceRoot: f.project, conversationId }) };
        f.widget.platformService.readDesktopAttachment = request => {
            f.requests.push(request); return f.service.readDesktopAttachment(request);
        };
        assert.deepEqual(Buffer.from(await f.widget.readCachedAttachmentBytes(item, session)), bytes);
        // A fresh service must recover authorization from persisted history,
        // not an in-memory cache or a folder-shaped MRU.
        const restarted = new AttachmentService(f.profile, pathToFileURL(f.workspaceFile).href);
        f.widget.platformService.readDesktopAttachment = request => {
            f.requests.push(request); return restarted.readDesktopAttachment(request);
        };
        assert.deepEqual(Buffer.from(await f.widget.readCachedAttachmentBytes(item, session)), bytes);
        assert.equal(f.requests.at(-1).conversationId, conversationId);
        assert.equal(f.requests.at(-1).workspaceRoot, f.project);
    }
});

test('saved draft attachments restore before workspace roots reopen, including a secondary bound root', async t => {
    const f = await fixture(t);
    const session = { id: conversationId, title: 'Synthetic restart draft', workspacePath: f.project,
        ownedWorkspace: false, turns: [], createdAt: 1, updatedAt: 2,
        workspaceBindings: [
            { id: 'primary', path: f.project, kind: 'project', status: 'available' },
            { id: 'secondary', path: f.second, kind: 'project', status: 'available' }
        ] };
    await f.service.saveConversationHistory([session]);
    const restarted = new AttachmentService(f.profile, pathToFileURL(f.workspaceFile).href);
    f.widget.workspaceOptions = []; // Restore can start before Theia reopens project roots.
    f.widget.platformService.readDesktopAttachment = request => {
        f.requests.push(request); return restarted.readDesktopAttachment(request);
    };
    for (const [name, root, bytes] of [
        ['notes.txt', f.project, Buffer.from('Synthetic UTF-8 restart draft\n')],
        ['table.csv', f.second, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,b\n1,2\n', 'utf16le')])]
    ]) {
        const item = { name, ...await cache(f.service, name, bytes, { workspaceRoot: root, conversationId }) };
        assert.deepEqual(Buffer.from(await f.widget.readCachedAttachmentBytes(item, session)), bytes);
        assert.equal(f.requests.at(-1).workspaceRoot, root);
        assert.equal(f.requests.at(-1).conversationId, conversationId);
    }
    const foreign = join(f.profile, 'foreign');
    await mkdir(foreign);
    const foreignService = new AttachmentService(f.profile, pathToFileURL(foreign).href);
    const outside = { name: 'outside.txt', ...await cache(foreignService, 'outside.txt', Buffer.from('foreign bytes'), { workspaceRoot: foreign }) };
    const forged = { ...session, workspaceBindings: [...session.workspaceBindings,
        { id: 'forged', path: foreign, kind: 'project', status: 'available' }] };
    await assert.rejects(f.widget.readCachedAttachmentBytes(outside, forged), { code: 'ATTACHMENT_WORKSPACE_UNAUTHORIZED' });
});

test('private projectless attachments still use their owning conversation', async t => {
    const f = await fixture(t), bytes = Buffer.from('private synthetic bytes');
    const session = { id: conversationId, ownedWorkspace: true, workspacePath: '' };
    const item = { name: 'private.txt', ...await cache(f.service, 'private.txt', bytes, { conversationId }) };
    assert.deepEqual(Buffer.from(await f.widget.readCachedAttachmentBytes(item, session)), bytes);
    assert.equal(f.requests.at(-1).conversationId, conversationId);
    assert.equal(f.requests.at(-1).workspaceRoot, undefined);
});

test('legacy global attachments keep global scope even when restored inside a project conversation', async t => {
    const f = await fixture(t), bytes = Buffer.from('global synthetic bytes');
    const session = { id: conversationId, ownedWorkspace: false, workspacePath: f.project };
    const item = { name: 'global.txt', ...await cache(f.service, 'global.txt', bytes) };
    assert.deepEqual(Buffer.from(await f.widget.readCachedAttachmentBytes(item, session)), bytes);
    assert.equal(f.requests.at(-1).conversationId, undefined);
    assert.equal(f.requests.at(-1).workspaceRoot, undefined);
});
