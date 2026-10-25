import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
const methods = new Set(['canvasStore', 'directorService', 'saveComicDirectorCapture', 'importComicDirectorModel', 'directorUploadStore', 'beginComicDirectorUpload', 'appendComicDirectorUpload', 'discardComicDirectorUpload']);
const fields = new Set(['comicCanvasStores', 'comicDirectorServices']), members = [];
(function walk(node) {
    if (ts.isMethodDeclaration(node) && methods.has(node.name.getText(ast)) || ts.isPropertyDeclaration(node) && fields.has(node.name.getText(ast))) members.push(node.getText(ast));
    ts.forEachChild(node, walk);
})(ast);
class Store { constructor(workspaceRoot, canvasId) { Object.assign(this, { workspaceRoot, canvasId }); } }
class Director {
    constructor(workspaceRoot, store, options) { Object.assign(this, { workspaceRoot, store, options }); }
    saveCapture(request) { return { capture: request, store: this.store }; }
    importModel(request) { return { model: request, root: this.workspaceRoot }; }
}
class Uploads {
    constructor(workspaceRoot) { this.root = workspaceRoot; }
    begin(request) { return request; }
    append(uploadId, offset, dataBase64) { return { uploadId, offset, dataBase64 }; }
    discard(uploadId) { return uploadId; }
}
function harness() {
    const dependencies = { realpathSync, ComicCanvasStore: Store, ComicDirectorService: Director, DirectorUploadStore: Uploads,
        CanvasServiceError: class extends Error {}, resolveCanvasToolFfprobe: async ffmpegPath => `${ffmpegPath}-probe` };
    const js = ts.transpileModule(`const {${Object.keys(dependencies).join(',')}} = dependencies; class Harness { ${members.join('\n')} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const Harness = new Function('dependencies', `${js}\nreturn Harness;`)(dependencies);
    const rpc = new Harness(); rpc.validateWorkspaceRootInput = value => assert.equal(typeof value, 'string');
    rpc.getMediaRuntimeState = async () => ({ ffmpeg: { available: true, path: '/fixture/ffmpeg' } });
    return rpc;
}
test('director RPC routes captures to the selected canvas, reuses canonical stores, and uses the existing FFmpeg runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'director-rpc-'));
    try {
        const rpc = harness(), request = { workspaceRoot: root, canvasId: 'canvas-sub', captureId: 'click', kind: 'image' };
        const result = await rpc.saveComicDirectorCapture(request);
        assert.deepEqual(result.capture, { captureId: 'click', kind: 'image', canvasId: 'canvas-sub' }); assert.equal(result.store.canvasId, 'canvas-sub');
        assert.equal(rpc.directorService(root + '/.', 'canvas-sub'), rpc.directorService(root, 'canvas-sub'));
        assert.notEqual(rpc.directorService(root), rpc.directorService(root, 'canvas-sub'));
        assert.deepEqual(await rpc.directorService(root).options.runtime(), { ffmpegPath: '/fixture/ffmpeg', ffprobePath: '/fixture/ffmpeg-probe' });
        assert.deepEqual(await rpc.importComicDirectorModel({ workspaceRoot: root, name: 'a.glb', mimeType: '', dataBase64: 'AAAA' }),
            { model: { name: 'a.glb', mimeType: '', dataBase64: 'AAAA' }, root: realpathSync(root) });
        rpc.getMediaRuntimeState = async () => ({ ffmpeg: { available: false } });
        await assert.rejects(rpc.directorService(root).options.runtime());
        assert.deepEqual(await rpc.beginComicDirectorUpload({ workspaceRoot: root, purpose: 'model', byteLength: 3, mimeType: '' }), { purpose: 'model', byteLength: 3, mimeType: '' });
        assert.deepEqual(await rpc.appendComicDirectorUpload({ workspaceRoot: root, uploadId: 'upload-id', offset: 0, dataBase64: 'AAAA' }), { uploadId: 'upload-id', offset: 0, dataBase64: 'AAAA' });
        assert.equal(await rpc.discardComicDirectorUpload({ workspaceRoot: root, uploadId: 'upload-id' }), 'upload-id');
    } finally { await rm(root, { recursive: true, force: true }); }
});
