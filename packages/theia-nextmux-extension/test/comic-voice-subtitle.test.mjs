import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = [];
function visit(node) {
    if (ts.isMethodDeclaration(node) && ['captureComicVoiceTarget', 'handleComicVoiceTranscript', 'confirmComicVoiceCommand'].includes(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(methods.length, 3);
const compiled = ts.transpileModule(`
const localizeDesktopSurface = (_locale, text) => text;
const parseComicVoiceCommand = text => ({ type: 'edit_subtitle', text });
const classifyComicVoiceCommand = () => ({ kind: 'media_job', requiresConfirmation: true });
const formatEditorTime = String;
export class Harness { ${methods.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture(playbackSeconds) {
    const cues = [
        { id: 'cue-a', text: '第一句', speakerCharacterId: 'alice', startFrame: 0, durationFrames: 24 },
        { id: 'cue-b', text: '第二句', speakerCharacterId: 'bob', startFrame: 24, durationFrames: 24 },
        { id: 'cue-c', text: '第三句', speakerCharacterId: 'alice', startFrame: 48, durationFrames: 24 }
    ];
    const h = new Harness();
    h.comicPlaybackSeconds = playbackSeconds;
    // The editor is on screen in the studio's 剪辑 view (or a window's 剪辑 step; see comicEditorOpen).
    h.comicEditorOpen = () => h.comicView === 'timeline';
    const shot = { id: 'shot', dialogueCues: cues };
    const scene = { id: 'scene', shots: [shot] };
    const project = { id: 'project', revision: 1, frameRate: 24, scenes: [scene] };
    h.comicProject = () => project;
    h.activeComicScene = () => scene;
    h.activeComicShot = () => shot;
    h.activeComicShotId = 'shot';
    h.activeComicWorkspaceRoot = '/workspace/comic';
    h.comicState = {};
    h.comicVoiceSession = { appendTranscript() {}, acceptCommand() {} };
    h.selectComicLocation = (sceneId, shotId) => { h.activeComicShotId = shotId; };
    h.ct = () => '';
    h.comicVoicePending = { transcript: '把字幕改成替换句', command: { type: 'edit_subtitle', text: '替换句' }, target: h.captureComicVoiceTarget() };
    h.commitComicCommand = async command => { h.savedCommand = command; return { project: {} }; };
    h.speakComicReply = text => { h.reply = text; };
    h.update = () => {};
    return { h, cues, project };
}

test('voice subtitle edit changes only the cue under the playhead', async () => {
    const { h, cues } = fixture(1.25); // frame 30, cue-b
    await h.confirmComicVoiceCommand();
    assert.deepEqual(h.savedCommand.cues.map(cue => cue.id), ['cue-a', 'cue-b', 'cue-c']);
    assert.deepEqual(h.savedCommand.cues.map(cue => cue.text), ['第一句', '替换句', '第三句']);
    assert.deepEqual(h.savedCommand.cues.map(cue => [cue.startFrame, cue.durationFrames, cue.speakerCharacterId]), [
        [0, 24, 'alice'], [24, 24, 'bob'], [48, 24, 'alice']
    ]);
});

test('A-024 timeline voice captures a non-first shot local frame independently of storyboard and later selection', async () => {
    const { h, project } = fixture(0);
    h.comicView = 'timeline';
    let seconds = 5.5;
    h.comicEditorController = { pause() {}, state: () => ({ seconds, shotId: 'shot' }) };
    h.comicEditorClips = () => [{ shotId: 'earlier', start: 0 }, { shotId: 'shot', start: 4 }];
    const target = h.captureComicVoiceTarget(); // voice input begins at frame 36, not the old clock's frame 0
    assert.equal(target.frame, 36);
    seconds = 6.5; // playback advances while speech recognition is running
    h.comicVoicePending = undefined;
    h.handleComicVoiceTranscript('替换句', target);
    seconds = 0;
    h.activeComicShotId = 'another';
    h.activeComicScene = h.activeComicShot = () => undefined;
    await h.confirmComicVoiceCommand();
    assert.equal(h.savedCommand.sceneId, project.scenes[0].id);
    assert.equal(h.savedCommand.shotId, 'shot');
    assert.equal(h.savedCommand.expectedRevision, 1);
    assert.deepEqual(h.savedCommand.cues.map(cue => cue.text), ['第一句', '替换句', '第三句']);
});

test('A-024 stale project revision or workspace refuses subtitle confirmation', async () => {
    for (const change of [({ project }) => project.revision++, ({ h }) => { h.activeComicWorkspaceRoot = '/other'; }]) {
        const f = fixture(1.5);
        change(f);
        await f.h.confirmComicVoiceCommand();
        assert.equal(f.h.savedCommand, undefined);
        assert.match(f.h.comicMessage, /重新发起/);
    }
});

test('voice subtitle edit falls back to the first cue outside all cue ranges', async () => {
    const { h } = fixture(10); // frame 240, no cue
    await h.confirmComicVoiceCommand();
    assert.deepEqual(h.savedCommand.cues.map(cue => cue.text), ['替换句', '第二句', '第三句']);
});
