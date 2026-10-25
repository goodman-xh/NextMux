import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleComicVideoPrompt, ComicPromptTranslationCache, comicGenericVisualPrompt, comicImageMotionBrief,
    comicImageMotionPrompt, comicPromptUsesChinese, comicSceneReferenceCaption, comicSetPlatePrompt, comicStillFramePrompt, comicStillVisualPrompt } from '../lib/common/nextmux-comic-prompts.js';
import { comicDialoguePrompt, comicSpokenLanguage } from '../lib/common/nextmux-comic-flow.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { stockQueryFromShot } from '../lib/common/nextmux-stock-media.js';
const veo = videoModelGuide('google/veo-3.1');
const kling = videoModelGuide('kling-v3.0-pro');
const segment = { visual: 'A woman in a red coat opens the café door.', motion: 'She opens the door, then pauses.', seconds: 4,
    shotSize: 'medium', cameraMotion: 'push_in', cameraAngle: 'eye_level', lens: { focalLength: 'normal', depthOfField: 'shallow' },
    beats: [{ startSeconds: 0, endSeconds: 2, action: 'She opens the door.' }, { startSeconds: 2, endSeconds: 4, action: 'She pauses.' }] };
test('en gates Chinese shell; Veo uses timestamps and separate Audio / SFX while preserving dialogue', () => {
    assert.equal(comicPromptUsesChinese(veo, '她推开门'), false);
    assert.equal(comicPromptUsesChinese(kling, '她推开门'), true);
    const dialogue = comicDialoguePrompt([{ text: '你来了。', tone: 'softly' }], { promptLanguage: 'en' });
    const prompt = assembleComicVideoPrompt({ guide: veo, chinese: true, segments: [segment], dialogue, sound: 'The door creaks.', referenceCaption: comicSceneReferenceCaption(2, 'the café') });
    assert.match(prompt, /^\[00:00-00:04\] Cinematography: medium, eye level, normal, shallow, push in/);
    assert.match(prompt, /\[00:00-00:02\] She opens the door/);
    assert.match(prompt, /Audio: Dialogue/);
    assert.match(prompt, /“你来了。” \(spoken in Mandarin Chinese; tone: softly\)/);
    assert.match(prompt, /SFX: The door creaks/);
    assert.match(prompt, /reference image 2 \(\[Image 2\]\)/);
    assert.doesNotMatch(prompt, /镜头语言|对白|人物参考/);
});
test('Kling / Seedance numbered shots use story language; other models use camera-first formula', () => {
    assert.match(assembleComicVideoPrompt({ guide: kling, chinese: true, segments: [{ ...segment, visual: '她推开门。' }] }), /^镜头1 镜头语言：/);
    assert.match(assembleComicVideoPrompt({ guide: videoModelGuide('seedance-2.0'), segments: [segment] }), /^Shot 1 Cinematography:/);
    assert.match(assembleComicVideoPrompt({ guide: videoModelGuide('gen-4.5'), segments: [segment] }), /^Cinematography:.*A woman/);
});
test('first frame carries only motion, beats, camera, audio and a brief style reminder', () => {
    const prompt = assembleComicVideoPrompt({ guide: veo, segments: [segment], firstFrame: true, context: 'A sprawling ornate café.', identity: 'A crimson wool coat.', style: 'Full visual bible.', referenceCaption: 'Portrait details.', dialogue: 'Narrator: “Welcome.”', sound: 'The door creaks.' });
    assert.match(prompt, /She opens the door, then pauses/);
    assert.match(prompt, /\[00:02-00:04\] She pauses/);
    assert.match(prompt, /Keep the subjects, composition and art style of the first frame/);
    assert.doesNotMatch(prompt, /red coat|crimson|sprawling|Full visual bible|Portrait details/);
    assert.match(prompt, /Audio: Narrator/);
});
test('MV silent video omits dialogue and second soundtrack; limits never truncate spoken lines', () => {
    const prompt = assembleComicVideoPrompt({ guide: veo, segments: [segment], silent: true, dialogue: 'Never included', sound: 'Never included' });
    assert.match(prompt, /Silent video/); assert.doesNotMatch(prompt, /Never included|Audio:|SFX:/);
    assert.throws(() => assembleComicVideoPrompt({ guide: { ...veo, maxPromptChars: 30 }, segments: [segment] }), /Shorten the shot or split/);
});
test('translation caches exact content per shot, concurrent calls share a model request, edits retranslate', async () => {
    const cache = new ComicPromptTranslationCache(); let calls = 0;
    const translate = async request => { calls++; assert.match(request.system, /not dialogue/); const fields = JSON.parse(request.prompt); return JSON.stringify(Object.fromEntries(Object.keys(fields).map(key => [key, `${fields[key]} translated`]))); };
    const first = await Promise.all([cache.translate('s', { own: '推开门', style: '水彩' }, translate), cache.translate('s', { style: '水彩', own: '推开门' }, translate)]);
    assert.deepEqual(first[0], first[1]); assert.equal(calls, 1);
    first[0].own = 'mutated'; assert.equal((await cache.translate('s', { own: '推开门', style: '水彩' }, translate)).own, '推开门 translated');
    await cache.translate('s', { own: '关门' }, translate); assert.equal(calls, 2);
    await cache.translate('other-shot', { own: '关门' }, translate); assert.equal(calls, 3);
});
test('failed translation retries and old failure cannot evict a newer cached edit', async () => {
    const cache = new ComicPromptTranslationCache();
    await assert.rejects(cache.translate('s', { own: '推门' }, async () => 'text'), /invalid JSON/);
    await assert.rejects(cache.translate('s', { own: '推门' }, async () => '{"own":""}'), /incomplete/);
    let rejectOld; const old = cache.translate('s', { own: '旧稿' }, () => new Promise((_resolve, reject) => { rejectOld = reject; })); await Promise.resolve();
    const newer = await cache.translate('s', { own: '新稿' }, async () => '{"own":"Open the door."}'); rejectOld(new Error('failed'));
    await assert.rejects(old, /failed/); assert.deepEqual(await cache.translate('s', { own: '新稿' }, async () => { throw Error('miss'); }), newer);
});
test('spoken lines preserve original language and explicit tone', () => {
    for (const [text, language] of [['こんにちは。', 'Japanese'], ['你好。', 'Mandarin Chinese'], ['안녕.', 'Korean'], ['مرحباً.', 'Arabic'], ['नमस्ते।', 'Hindi']]) {
        const prompt = comicDialoguePrompt([{ text, tone: 'whispering' }], { promptLanguage: 'en' }); assert.ok(prompt.includes(`“${text}”`)); assert.ok(prompt.includes(`spoken in ${language}`));
    }
    assert.equal(comicSpokenLanguage('Bom dia.', 'pt-BR'), 'Brazilian Portuguese');
    assert.match(comicDialoguePrompt([{ text: 'Bonjour.' }], { promptLanguage: 'en', storyLanguage: 'fr' }), /spoken in French/);
});
test('image motion wrapper preserves picture and vision brief requests an editable motion-only instruction', () => {
    const prompt = comicImageMotionPrompt('The cat blinks.', videoModelGuide('gen-4.5')); assert.match(prompt, /Keep the subject, composition and art style/); assert.match(prompt, /Describe motion only/); assert.match(prompt, /Do not add text, subtitles or watermarks/);
    assert.match(comicImageMotionPrompt('小猫眨眼。', kling), /保持输入图片的主体/);
    const brief = comicImageMotionBrief('Japanese'); assert.match(brief.system, /Inspect the attached picture/); assert.match(brief.system, /one camera move with direction/); assert.match(brief.prompt, /in Japanese/);
});
test('set plate is empty; generic panel labels and camera values are English by default', () => {
    const set = comicSetPlatePrompt({ location: 'A café', timeOfDay: 'dusk' }, 'Watercolour'); assert.match(set, /empty establishing set plate/); assert.match(set, /no people, animals/);
    const prompt = comicGenericVisualPrompt({ style: '水彩', scene: '咖啡馆', shotSize: 'close_up', cameraMotion: 'crane_down' }); assert.match(prompt, /Visual style: 水彩/); assert.match(prompt, /Shot: close up; crane down/); assert.doesNotMatch(prompt, /统一视觉设定|场景：|镜头：/);
});
test('English stock terms take precedence and old projects retain the extractor fallback', () => {
    assert.equal(stockQueryFromShot({ visualPrompt: '雨夜街道霓虹灯', searchTerms: ['rainy', 'city', 'street', 'neon'] }), 'rainy city street neon');
    assert.equal(stockQueryFromShot({ visualPrompt: 'A coffee cup, warm light' }), 'coffee cup');
    assert.equal(stockQueryFromShot({ visualPrompt: 'A coffee cup, warm light', searchTerms: ['咖啡杯'] }), 'coffee cup');
});
test('legacy first-frame motion extraction is cached and removes appearance from the model instructions', async () => {
    const cache = new ComicPromptTranslationCache(); let calls = 0;
    const translator = async request => { calls++; assert.match(request.system, /Remove descriptions of faces/); assert.match(request.system, /Do not quote or translate dialogue/); assert.equal(JSON.parse(request.prompt).outputLanguage, 'English'); return '{"motion":"She opens the door; camera pushes in."}'; };
    const source = 'A woman wearing a crimson coat opens a café door.';
    assert.equal(await cache.translateMotion('legacy', source, 'English', translator), 'She opens the door; camera pushes in.');
    await cache.translateMotion('legacy', source, 'English', translator); assert.equal(calls, 1);
    cache.clear('legacy'); await cache.translateMotion('legacy', source, 'English', translator); assert.equal(calls, 2);
});
test('successful visual translations survive reload; original source and spoken lines are not persisted', async () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const first = new ComicPromptTranslationCache(512, () => storage);
    await first.translate('project:shot', { own: '推开门', tone: '温柔' }, async () => '{"own":"Open the door.","tone":"gently"}');
    const snapshot = [...values.values()].join(''); assert.doesNotMatch(snapshot, /推开门|温柔|"source"/);
    assert.match(snapshot, /Open the door/);
    const reloaded = new ComicPromptTranslationCache(512, () => storage);
    const restored = await reloaded.translate('project:shot', { tone: '温柔', own: '推开门' }, async () => { throw Error('should reuse persisted translation'); });
    assert.deepEqual(restored, { own: 'Open the door.', tone: 'gently' });
    let edits = 0;
    await reloaded.translate('project:shot', { own: '关上门' }, async () => { edits++; return '{"own":"Close the door."}'; }); assert.equal(edits, 1);
    reloaded.clear(); assert.equal(values.size, 0);
});
test('an old completion never overwrites a persisted newer edit, and failed results are not persisted', async () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const cache = new ComicPromptTranslationCache(512, () => storage); let resolveOld;
    const old = cache.translate('s', { own: 'old' }, () => new Promise(resolve => { resolveOld = resolve; })); await Promise.resolve();
    await cache.translate('s', { own: 'new' }, async () => '{"own":"New action."}');
    resolveOld('{"own":"Old action."}'); await old;
    const restored = new ComicPromptTranslationCache(512, () => storage);
    assert.deepEqual(await restored.translate('s', { own: 'new' }, async () => { throw Error('stale overwrite'); }), { own: 'New action.' });
    await assert.rejects(cache.translate('bad', { own: 'broken' }, async () => 'bad JSON'));
    assert.doesNotMatch([...values.values()].join(''), /"bad"|Old action/);
});
test('blocked or corrupt browser storage does not prevent normal translation', async () => {
    const cache = new ComicPromptTranslationCache(512, () => ({ getItem: () => '{broken', setItem: () => { throw Error('quota'); }, removeItem: () => {} }));
    assert.deepEqual(await cache.translate('s', { own: '推门' }, async () => '{"own":"Open the door."}'), { own: 'Open the door.' });
    // Reasoning models emitting <think> blocks, prose around code fences, and trailing commas in translation JSON:
    assert.deepEqual(await cache.translate('s-think', { own: '推门', style: '水彩' },
        async () => '<think>Translating visual fields...</think>\n```json\n{"own":"Open the door.","style":"Watercolour",}\n```'), { own: 'Open the door.', style: 'Watercolour' });
});

test('a shot picture is one still moment: camera travel, action order and shot rhythm stay out (round 31 live run)', () => {
    const prompt = comicStillVisualPrompt({
        style: '竖屏9:16短片；Q版3D卡通，暖色调。镜头遵循由环境建立到中景、近景和物件特写的节奏，画面不出现可读文字。',
        scene: '覆雪的小镇街道与木屋门廊, 下雪的深夜', title: '门前的盼望', shotSize: 'close_up', cameraAngle: 'eye_level',
        description: '越肩近景聚焦前爪按响门铃。', moment: '右前爪按住黄铜门铃。',
        visual: '越过橘猫邮递员右肩的近景，镜头从它肩侧与红围巾边缘开始，缓慢推向木门上的黄铜圆形门铃；它的右前爪伸出按住门铃，随后收回胸前等待。门框缝隙透出暖光，门廊覆着薄雪。'
    }, true);
    assert.match(prompt, /定格瞬间: 右前爪按住黄铜门铃/);
    assert.match(prompt, /越过橘猫邮递员右肩的近景/);
    assert.match(prompt, /门框缝隙透出暖光/);
    assert.doesNotMatch(prompt, /镜头从|推向|随后|节奏|previous|连续性/);
    const still = comicStillFramePrompt(prompt, true);
    assert.match(still.prompt, /单幅完整画面/);
    assert.match(still.negative, /多格漫画/);
});
