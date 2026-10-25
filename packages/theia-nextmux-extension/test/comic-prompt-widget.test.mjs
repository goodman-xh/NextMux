import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { ComicPromptTranslationCache } from '../lib/common/nextmux-comic-prompts.js';

// Execute the actual request preparation and dialogue methods with a mocked project text model.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['comicPrepareMediaInput', 'comicShotSoundPrompt']);
const methods = [];
function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast); assert.equal(methods.length, names.size);
const dependency = path => JSON.stringify(new URL(path, import.meta.url).href);
const compiled = ts.transpileModule(`
import { assembleComicVideoPrompt, comicPromptUsesChinese, comicImageMotionPrompt, comicStillFramePrompt } from ${dependency('../lib/common/nextmux-comic-prompts.js')};
import { comicCharacterGender, comicSpeakerLooks, comicSpokenLanguage, comicDialoguePrompt, comicSoundLine } from ${dependency('../lib/common/nextmux-comic-flow.js')};
import { videoModelGuide } from ${dependency('../lib/common/nextmux-video-model-guide.js')};
import { comicShotFieldText } from ${dependency('../lib/browser/nextmux-comic-studio-text.js')};
export class Harness { ${methods.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture(kind = 'novel', model = 'google/veo-3.1') {
    const h = new Harness();
    const character = { id: 'c', name: 'Lin', description: 'female', appearance: '服装：红外套', voice: '低声' };
    const shot = { id: 's', title: 'Door', visualPrompt: '她推门。', durationFrames: 96, shotSize: 'medium', cameraMotion: 'push_in', negativePrompt: '',
        dialogueCues: [{ speakerCharacterId: 'c', text: '别走。', tone: '温柔' }] };
    const scene = { id: 'scene', shots: [shot] };
    const project = { id: 'p', projectKind: kind, frameRate: 24, characters: [character], scenes: [scene] };
    const calls = [];
    Object.assign(h, {
        comicPromptTranslations: new ComicPromptTranslationCache(), comicState: { production: { script: { language: 'zh-CN' } } }, comicStepPrefs: { choices: {} }, desktopLocale: 'en',
        comicProject: () => project, comicProjectKind: value => value.projectKind,
        buildComicVisualPrompt: () => 'Shot: medium\n她推门。', comicShotOnScreen: () => [character], comicVideoMakesSound: () => true,
        comicFirstFrameMotion: async (_shot, _model, visual) => { h.motionSource = visual; return 'She opens the door; the camera moves forward.'; },
        comicPlanText: async request => {
            calls.push(request);
            const fields = JSON.parse(request.slice(request.lastIndexOf('\n') + 1));
            const translate = value => value.replaceAll('她推门。', 'She opens the door.').replaceAll('她轻推门。', 'She gently opens the door.')
                .replaceAll('红外套', 'red coat').replaceAll('低声', 'quiet voice').replaceAll('温柔', 'gently').replaceAll('猫眨眼。', 'The cat blinks.').replaceAll('她说', 'She says');
            return JSON.stringify(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, translate(value)])));
        },
        comicShotPromptFields: async () => { h.usedShotFields = true; return { own: 'She opens the door.' }; },
        deskClipPrompt: async (_shot, _route, _facts, _refs, frame, fields) => { h.normalFrame = frame; return `NORMAL ${fields.own}`; }
    });
    return { h, shot, scene, calls, route: { model, kind: 'official', id: 'r' } };
}

test('generic default request follows normal per-family shot preparation', async () => {
    const { h, shot, scene, route } = fixture();
    const prompt = `${h.buildComicVisualPrompt()}\n${h.comicShotSoundPrompt(shot, route.model)}`;
    const input = await h.comicPrepareMediaInput('video', { prompt, model: route.model }, shot, scene, route);
    assert.equal(input.prompt, 'NORMAL She opens the door.'); assert.equal(h.usedShotFields, true);
});
test('custom visual edit never sends stored dialogue to translation and translates speaker notes', async () => {
    const { h, shot, scene, route, calls } = fixture();
    const prompt = `她轻推门。\n${h.comicShotSoundPrompt(shot, route.model)}`;
    const input = await h.comicPrepareMediaInput('video', { prompt, model: route.model }, shot, scene, route);
    assert.equal(calls.length, 1); assert.ok(calls.every(call => !call.includes('别走。')));
    assert.match(input.prompt, /^\[00:00-00:04\]/); assert.match(input.prompt, /She gently opens the door/);
    assert.match(input.prompt, /“别走。” \(spoken in Mandarin Chinese; tone: gently\)/);
    assert.match(input.prompt, /red coat/); assert.match(input.prompt, /quiet voice/); assert.doesNotMatch(input.prompt, /红外套|低声|温柔/);
});
test('custom quoted dialogue is protected during translation and restored verbatim', async () => {
    const { h, shot, scene, route, calls } = fixture(); shot.dialogueCues = [];
    const input = await h.comicPrepareMediaInput('video', { prompt: '她说“等一下。”', model: route.model }, shot, scene, route);
    assert.ok(calls.every(call => !call.includes('等一下。'))); assert.match(calls[0], /__NEXTMUX_QUOTE_0__/);
    assert.match(input.prompt, /“等一下。” \(spoken in Mandarin Chinese\)/);
});
test('custom first-frame input uses motion only and original dialogue with translated speaker notes', async () => {
    const { h, shot, scene, route, calls } = fixture();
    const input = await h.comicPrepareMediaInput('video', { prompt: 'In a crimson coat, 她轻推门。', model: route.model, firstFrameUri: 'assets/start.png' }, shot, scene, route);
    assert.match(input.prompt, /She opens the door; the camera moves forward/); assert.doesNotMatch(input.prompt, /crimson coat/);
    assert.match(input.prompt, /“别走。”/); assert.match(input.prompt, /quiet voice/); assert.ok(calls.every(call => !call.includes('别走。')));
});
test('image-kind animation honors the edited draft and unwraps only the unedited generic fallback', async () => {
    const { h, shot, scene, route } = fixture('image');
    const edited = await h.comicPrepareMediaInput('video', { prompt: '猫眨眼。', model: route.model, referenceAssetUris: ['cat.png'] }, shot, scene, route);
    assert.match(edited.prompt, /The cat blinks/); assert.doesNotMatch(edited.prompt, /She opens/); assert.match(edited.prompt, /Keep the subject, composition and art style/);
    const batch = await h.comicPrepareMediaInput('video', { prompt: h.buildComicVisualPrompt(), model: route.model, referenceAssetUris: ['cat.png'] }, shot, scene, route);
    assert.match(batch.prompt, /She opens the door/); assert.doesNotMatch(batch.prompt, /Shot: medium/);
});
test('bilingual models retain visual story language and do not call the translation model', async () => {
    const { h, shot, scene, route, calls } = fixture('novel', 'kling-v3.0-pro');
    const input = await h.comicPrepareMediaInput('video', { prompt: '她轻推门。', model: route.model }, shot, scene, route);
    assert.equal(calls.length, 0); assert.match(input.prompt, /^镜头1/); assert.match(input.prompt, /她轻推门。/);
});
test('a model that loses a protected quote fails before any video request can be submitted', async () => {
    const { h, shot, scene, route } = fixture(); shot.dialogueCues = [];
    h.comicPlanText = async () => '{"prompt":"She speaks.","negative":""}';
    await assert.rejects(h.comicPrepareMediaInput('video', { prompt: '她说“等一下。”', model: route.model }, shot, scene, route), /omitted quoted text/);
    h.comicPlanText = async () => '{"prompt":"She says __NEXTMUX_QUOTE_0__","negative":""}';
    const retry = await h.comicPrepareMediaInput('video', { prompt: '她说“等一下。”', model: route.model }, shot, scene, route);
    assert.match(retry.prompt, /“等一下。”/);
});

test('an old image project with empty motion generates a new editable instruction from its actual picture', async () => {
    const { h, shot, scene, route } = fixture('image'); shot.visualPrompt = '';
    let generated = 0; h.comicGenerateMotionFromAsset = async (actualScene, actualShot) => { assert.equal(actualScene.id, scene.id); assert.equal(actualShot.id, shot.id); generated++; return '猫眨眼。'; };
    const input = await h.comicPrepareMediaInput('video', { prompt: h.buildComicVisualPrompt(), model: route.model, referenceAssetUris: ['cat.png'] }, shot, scene, route);
    assert.equal(generated, 1); assert.match(input.prompt, /The cat blinks/);
});
