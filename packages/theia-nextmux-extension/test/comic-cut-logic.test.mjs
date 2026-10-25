import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createComicProject, applyComicEditorEdits } from '@nextmux/comic-core';
import { comicCutLanes, comicCutMaximumDuration, comicCutTrimDelta } from '../lib/browser/nextmux-comic-cut.js';
import { clipAt, clipOpacity, comicEditorContributions, comicEditorCanAmplify, comicEditorVideoPosition, comicEditorAudioPosition } from '../lib/browser/nextmux-comic-editor.js';

const clip = (shotId, start = 0, duration = 3, patch = {}) => ({ shotId, sceneId: 'scene', sceneTitle: 'Scene', title: shotId, start, duration,
    index: 0, kind: 'image', transitionIn: 'cut', transitionOut: 'cut', cameraMotion: 'static', cues: [], cueList: [], ...patch });

test('video end drag is bounded by remaining whole source frames after splitting', () => {
    const video = clip('right-half', 3, 1, { kind: 'video', videoStart: 3, videoLength: 4.01 });
    assert.equal(comicCutMaximumDuration(video, 24), 1);
    assert.equal(comicCutTrimDelta(video, 'end', 100, 24), 0);
    assert.equal(comicCutTrimDelta(video, 'end', -100, 24), 1 / 24 - 1);
    assert.equal(comicCutTrimDelta(video, 'start', -100, 24), -3);
});

test('stills can extend beyond a file length and a video never starts before its source', () => {
    const still = clip('still', 0, 3, { imageUrl: 'picture', videoStart: 0, videoLength: 1 });
    assert.equal(comicCutMaximumDuration(still, 24), Infinity);
    assert.equal(comicCutTrimDelta(still, 'start', -10000, 24), -10000);
    assert.equal(comicCutTrimDelta(clip('v', 0, 2, { kind: 'video' }), 'start', -5, 24), 0);
});

test('music restarted from the beginning is a separate lane item', () => {
    const audio = start => [{ key: 'music:m', assetId: 'm', role: 'music', url: 'x', start, length: 9 }];
    const restarted = comicCutLanes([clip('a', 0, 3, { audio: audio(0) }), clip('b', 3, 3, { audio: audio(0) })]);
    assert.equal(restarted.music.length, 2);
    const continuous = comicCutLanes([clip('a', 0, 3, { audio: audio(0) }), clip('b', 3, 3, { audio: audio(3) })]);
    assert.equal(continuous.music.length, 1);
    const dissolve = comicCutLanes([clip('a', 0, 3, { audio: audio(0) }), clip('b', 2.5, 3, { audio: audio(2.5) })]);
    assert.equal(dissolve.music.length, 1);
    assert.equal(dissolve.music[0].duration, 5.5, 'shared source continuation counts overlap once');
});

test('time lookup keeps gaps empty and chooses incoming clip at a dissolve', () => {
    const clips = [clip('a', 0, 3), clip('b', 2.5, 3, { dissolveIn: 0.5 })];
    assert.equal(clipAt(clips, -1), -1);
    assert.equal(clipAt(clips, 2.5), 1);
    assert.equal(clipAt(clips, 5.5), 1);
    assert.equal(clipAt(clips, 5.6), -1);
    assert.equal(clipAt([clip('a', 0, 1), clip('b', 2, 1)], 1.5), -1);
    const layers = comicEditorContributions(clips, 2.75);
    assert.deepEqual(layers.map(item => [item.clip.shotId, item.offset, item.weight]), [['a', 2.75, 0.5], ['b', 0.25, 0.5]]);
    assert.deepEqual(comicEditorContributions(clips, 3).map(item => item.clip.shotId), ['b']);
});

test('tiny-clip picture fade is bounded and simultaneous fades multiply as FFmpeg does', () => {
    assert.equal(clipOpacity(clip('tiny', 0, 0.04, { fadeIn: 0.12 }), 0.02), 0.5);
    assert.equal(clipOpacity(clip('both', 0, 1, { fadeIn: 1, fadeOut: 1 }), 0.5), 0.25);
});

test('Web Audio only accepts native file and origin-safe sources', () => {
    assert.equal(comicEditorCanAmplify('file:///movie.mp4', 'file:///app/index.html'), true);
    assert.equal(comicEditorCanAmplify('file:///movie.mp4', 'https://editor.test'), false);
    assert.equal(comicEditorCanAmplify('https://media.test/movie.mp4', 'https://editor.test'), false);
    assert.equal(comicEditorCanAmplify('/movie.mp4', 'https://editor.test'), true);
    assert.equal(comicEditorCanAmplify('blob:https://editor.test/id', 'https://editor.test'), true);
});

test('stream origins change media seeks while content in-points and trim capacity stay logical', () => {
    const video = clip('global-offset', 0, 1, { kind: 'video', videoUrl: 'source', videoStart: 1, videoOrigin: 5, videoLength: 2 });
    assert.equal(comicEditorVideoPosition(video, 0.25), 6.25);
    assert.equal(comicCutMaximumDuration(video, 24), 1);
    const delayed = { key: 'voice', assetId: 'voice', role: 'audio', url: 'voice', start: 1, origin: 0.5, length: 1 };
    assert.equal(comicEditorAudioPosition(delayed, 0.25), 1.75);
});

const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methodNames = new Set(['comicTimelineDocument', 'comicEditingProject', 'comicCutScopeKey', 'comicCutHistoryValid', 'comicCutHistoryEntry', 'applyComicCutState', 'applyComicCutLibraryState', 'runComicCutEdits', 'stepComicCutHistory']);
const methods = [];
function visit(node) { if (ts.isMethodDeclaration(node) && methodNames.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast); assert.equal(methods.length, methodNames.size);
const compiled = ts.transpileModule(`export class HistoryHarness { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { HistoryHarness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
function history() {
    const h = new HistoryHarness(); const project = createComicProject();
    const shotId = project.scenes[0].shots[0].id;
    Object.assign(h, { activeComicWorkspaceRoot: '/fixture', comicState: { project }, activeComicShotId: shotId, activeComicEpisodeId: 'episode',
        comicStage: 'idle', comicCutOperation: 0, comicTimelineSequence: 0, comicUndoRevision: project.revision, comicUndoProjectId: project.id, comicUndoWorkspaceRoot: '/fixture', comicUndoStack: [], comicRedoStack: [], comicError: '', comicHasDirtyDraft: () => false,
        comicProject() { return this.comicState.project; }, comicCutClips(project) { return project.scenes.flatMap(scene => scene.shots.map(shot => ({ shotId: shot.id, sceneId: scene.id }))); },
        syncComicSelection(sceneId, shotId) { this.activeComicShotId = shotId || ''; }, update() {},
        comicEditorController: { state: () => ({ seconds: 2 }), pause() {} },
        platformService: { async applyComicEdits({ edits }) { const result = applyComicEditorEdits(h.comicProject(), edits); return { state: { project: result.project }, createdShotIds: result.createdShotIds }; },
            async restoreComicProject({ project }) { return { project: { ...structuredClone(project), revision: h.comicProject().revision + 1 } }; } }
    });
    return h;
}

test('undo and redo restore exact project snapshots, selection and playhead', async () => {
    const h = history(); const original = structuredClone(h.comicProject());
    const sceneId = original.scenes[0].id; const shotId = original.scenes[0].shots[0].id;
    await h.runComicCutEdits([{ type: 'command', command: { type: 'shot.duplicate', sceneId, shotId } }]);
    const duplicateId = h.comicProject().scenes[0].shots[1].id;
    h.activeComicShotId = duplicateId;
    const duplicate = structuredClone(h.comicProject());
    await h.stepComicCutHistory('undo');
    assert.deepEqual({ ...h.comicProject(), revision: original.revision }, original);
    assert.equal(h.activeComicShotId, shotId);
    assert.deepEqual(h.comicEditorPendingSeek, { seconds: 2, hold: true });
    await h.stepComicCutHistory('redo');
    assert.deepEqual({ ...h.comicProject(), revision: duplicate.revision }, duplicate);
    assert.equal(h.activeComicShotId, duplicateId);
});

test('history and edits cannot overwrite dirty drafts or run during external work', async () => {
    for (const blocked of [{ comicHasDirtyDraft: () => true }, { comicStage: 'running' }, { comicExternalChange: true }, { comicCutImporting: true }]) {
        const h = history(); const project = h.comicProject(); const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
        Object.assign(h, blocked);
        assert.equal(await h.runComicCutEdits([{ type: 'command', command: { type: 'shot.delete', sceneId, shotId } }]), undefined);
        await h.stepComicCutHistory('undo'); assert.equal(h.comicProject(), project);
        assert.equal(h.comicUndoStack.length, 0);
    }
});

test('equal revision numbers in another workspace or project cannot reuse editorial history', async () => {
    for (const differentProject of [false, true]) {
        const h = history(); const project = h.comicProject(); const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
        await h.runComicCutEdits([{ type: 'command', command: { type: 'shot.duplicate', sceneId, shotId } }]);
        if (differentProject) h.comicState = { project: { ...createComicProject(), revision: h.comicUndoRevision } };
        else h.activeComicWorkspaceRoot = '/other-workspace';
        const current = h.comicProject();
        await h.stepComicCutHistory('undo');
        assert.equal(h.comicProject(), current);
        assert.equal(h.comicUndoStack.length, 0);
        assert.equal(h.comicRedoStack.length, 0);
    }
});

test('failed history restore preserves both stacks and a new edit clears redo', async () => {
    const h = history(); const project = h.comicProject(); const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
    await h.runComicCutEdits([{ type: 'command', command: { type: 'shot.duplicate', sceneId, shotId } }]);
    const restore = h.platformService.restoreComicProject;
    h.platformService.restoreComicProject = async () => { throw new Error('conflict'); };
    await h.stepComicCutHistory('undo'); assert.equal(h.comicUndoStack.length, 1); assert.equal(h.comicRedoStack.length, 0);
    h.platformService.restoreComicProject = restore;
    await h.stepComicCutHistory('undo'); assert.equal(h.comicRedoStack.length, 1);
    await h.runComicCutEdits([{ type: 'command', command: { type: 'shot.update', sceneId, shotId, patch: { title: 'New edit' } } }]);
    assert.equal(h.comicRedoStack.length, 0);
});

test('editorial undo and redo retain library files imported after the history snapshot', async () => {
    const h = history(); const project = h.comicProject(); const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
    await h.runComicCutEdits([{ type: 'command', command: { type: 'shot.duplicate', sceneId, shotId } }]);
    await h.stepComicCutHistory('undo');
    const imported = applyComicEditorEdits(h.comicProject(), [{ type: 'command', command: { type: 'asset.import', asset: {
        id: 'asset-imported-picture', kind: 'image', uri: 'nextmux.media/picture.png', mimeType: 'image/png', byteLength: 100,
        sha256: 'a'.repeat(64), jobId: 'media-job-00000000-0000-4000-8000-000000000001', provider: 'local', model: 'picture.png', source: 'imported'
    } } }]).project;
    h.applyComicCutLibraryState({ project: imported });
    assert.equal(h.comicRedoStack[0].project.assets.some(asset => asset.id === 'asset-imported-picture'), true);
    await h.stepComicCutHistory('redo');
    assert.equal(h.comicProject().assets.some(asset => asset.id === 'asset-imported-picture'), true);
    await h.stepComicCutHistory('undo');
    assert.equal(h.comicProject().assets.some(asset => asset.id === 'asset-imported-picture'), true);
});
