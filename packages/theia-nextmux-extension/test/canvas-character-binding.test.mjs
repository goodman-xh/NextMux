import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as comic from '@nextmux/comic-core';

const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
const method = service.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'bindComicCanvasCharacter');
const dependencies = {
    prepareCanvasCharacterProjectBinding: comic.prepareCanvasCharacterProjectBinding,
    commitCanvasCharacterToProject: comic.commitCanvasCharacterToProject,
    applyComicCommand: comic.applyComicCommand,
    bindCanvasCharacterPortrait: comic.bindCanvasCharacterPortrait,
    CanvasServiceError: Error
};
const Harness = new Function(...Object.keys(dependencies), ts.transpileModule(`class Harness { ${method.getText(ast)} }; return Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText)(...Object.values(dependencies));

test('portrait binding RPC saves the new canonical identity profile together with the approved canvas version', async () => {
    const now = '2026-09-30T00:00:00.000Z';
    let counter = 0;
    const idFactory = prefix => `${prefix}-${String(++counter).padStart(8, '0')}`;
    let project = comic.createComicProject({ now, idFactory, starter: 'storyboard' });
    project = comic.applyComicCommand(project, { type: 'character.add', expectedRevision: project.revision,
        character: { name: '小雨', appearance: '蓝色外套' } }, { now, idFactory });
    project = comic.applyComicCommand(project, { type: 'asset.import', expectedRevision: project.revision,
        asset: { id: 'asset-test-00000000', kind: 'image', uri: 'nextmux.media/portrait.png', mimeType: 'image/png', byteLength: 100,
            sha256: '1'.repeat(64), jobId: 'media-job-11111111-1111-1111-1111-111111111111', provider: 'fixture', model: 'fixture' } }, { now, idFactory });
    const characterId = project.characters[0].id;
    project = comic.setProjectCharacterProfile(project, characterId, { canonicalVersion: 1, immutableTraits: '蓝色外套',
        referenceViews: [], outfits: [], providerBindings: [], voiceBindings: [] }, now);
    let canvas = comic.seedCanvasFromProject(project);
    const character = canvas.nodes.find(node => node.kind === 'character');
    const portrait = canvas.nodes.find(node => node.origin?.role === 'portrait');
    const asset = project.assets[0];
    const version = { id: 'approved-portrait-v2', assetId: asset.id, kind: 'image', uri: asset.uri, createdAt: now, metadata: { sha256: asset.sha256 } };
    canvas = { ...canvas, nodes: canvas.nodes.map(node => node.id === portrait.id
        ? { ...node, payload: { ...node.payload, versions: [version], currentVersionId: version.id } } : node) };
    let savedProject, savedCanvas;
    const h = Object.assign(new Harness(), {
        canvasStore: () => ({ mutate: async (operation, revision) => { assert.equal(revision, canvas.revision); savedCanvas = await operation(canvas); } }),
        comicProjectStore: async () => ({ read: async () => ({ project }), commitPrepared: async (revision, prepared) => {
            assert.equal(revision, project.revision); savedProject = prepared; return { project: prepared };
        } }),
        syncComicProductionDocument: async () => {}, withComicProduction: async (_root, state) => state
    });
    const state = await h.bindComicCanvasCharacter({ workspaceRoot: '/fixture', characterNodeId: character.id, portraitNodeId: portrait.id,
        expectedCanvasRevision: canvas.revision, expectedProjectRevision: project.revision });
    assert.equal(savedProject.characters[0].canvasCharacter.canonicalVersion, 2);
    assert.equal(comic.characterAssetFromProject(state.project, characterId).sourceIdentityVersion, version.id);
    assert.equal(comic.prepareCanvasCharacterProjectForSave(savedProject).characters[0].identityVersion, version.id);
    assert.equal(savedCanvas.nodes.find(node => node.id === character.id).payload.currentVersionId, version.id);
});
