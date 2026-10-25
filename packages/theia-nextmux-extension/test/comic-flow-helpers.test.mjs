import assert from 'node:assert/strict';
import test from 'node:test';

import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),ts=require('typescript'),flow={};
new Function('exports',ts.transpileModule(readFileSync(new URL('../src/common/nextmux-comic-flow.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(flow);
const { clipSecondsFor, comicAddCastCaption, comicCastRounds, comicCastRoundsDone, comicCharacterGender, comicDialoguePrompt, comicPortraitPrompt, comicReferenceCaption, comicReferenceLayout, comicSpeakerLooks } = flow;
import { plannedClipSeconds, VIDEO_MODEL_FAMILIES, videoModelGuide, videoModelUsesReferences } from '../lib/common/nextmux-video-model-guide.js';

test('one person per reference picture: nobody is stitched into a shared picture', () => {
    assert.deepEqual(comicReferenceLayout(['a', 'b'], 3), [['a'], ['b']]);
    assert.deepEqual(comicReferenceLayout(['a', 'b', 'c', 'd'], 3), [['a'], ['b'], ['c']], 'a reference-only clip keeps the first people');
    const caption = comicReferenceCaption(comicReferenceLayout(['迅哥儿', '闰土（成年）', '母亲'], 3));
    assert.match(caption, /reference image 1 \(\[Image 1\]\) is 迅哥儿/);
    assert.match(caption, /reference image 3 \(\[Image 3\]\) is 母亲/);
    assert.doesNotMatch(caption, /left to right/);
    assert.match(caption, /Keep each person's face/);
});

test('a cast too big for one picture request is drawn into the opening frame two at a time', () => {
    assert.deepEqual(comicCastRounds(['a', 'b', 'c'], true, 4), [['a', 'b', 'c']], 'three people and the scene fit one request');
    assert.deepEqual(comicCastRounds(['a', 'b', 'c', 'd'], false, 4), [['a', 'b', 'c', 'd']]);
    const rounds = comicCastRounds(['a', 'b', 'c', 'd', 'e'], true);
    assert.deepEqual(rounds, [['a', 'b'], ['c', 'd'], ['e']]);
    assert.equal(comicCastRoundsDone(rounds, []), 0);
    assert.equal(comicCastRoundsDone(rounds, ['a', 'b', 'scene']), 1);
    assert.equal(comicCastRoundsDone(rounds, ['frame', 'c', 'd']), 2);
    assert.equal(comicCastRoundsDone(rounds, ['frame', 'e']), 3);
    assert.equal(comicCastRoundsDone(rounds, ['a', 'b', 'c']), 2, 'a frame drawn in one go with three people covers two rounds');
    const add = comicAddCastCaption(['母亲', '宏儿'], true);
    assert.match(add, /参考图1（\[Image 1\]）是这个镜头目前的开场画面/);
    assert.match(add, /参考图2（\[Image 2\]）是母亲；参考图3（\[Image 3\]）是宏儿/);
    assert.match(comicAddCastCaption(['Mother'], false), /Reference image 1 .* opening frame so far.*reference image 2 \(\[Image 2\]\) is Mother/s);
});

test('the mainstream video models have a guide; references are used only where they were verified', () => {
    for (const family of ['Veo 3.1', 'Kling 3.0', 'Kling O1', 'Seedance 2.0', 'Seedance 2.5', 'Sora 2', 'Wan 3.0', 'Hailuo 3', 'Grok Imagine', 'Runway Gen-4.5', 'HappyHorse', 'Vidu']) {
        assert.ok(VIDEO_MODEL_FAMILIES.includes(family), family);
    }
    const veo = videoModelGuide('google/veo-3.1-fast');
    assert.equal(veo.family, 'Veo 3.1');
    assert.equal(videoModelUsesReferences(veo), true);
    assert.deepEqual(plannedClipSeconds(veo, [4, 6, 8], { withReferences: true }), [8], 'Veo takes pictures only at 8 s');
    assert.deepEqual(plannedClipSeconds(veo, []), [4, 6, 8]);
    assert.equal(videoModelUsesReferences(videoModelGuide('kwaivgi/kling-v3.0-pro')), false, 'Kling opens on the reference: first frames instead');
    assert.equal(videoModelGuide('bytedance/seedance-2.0-fast').refusesRealFaces, true);
    assert.equal(videoModelGuide('someone/new-video-9').family, '', 'unknown models get the safe default');
    assert.equal(clipSecondsFor(5, [4, 6, 8]), 6);
    assert.equal(clipSecondsFor(9, [4, 6, 8]), 8);
    assert.equal(clipSecondsFor(3.2, []), 4);
});

test('a portrait prompt asks for the character alone on white, in the work\'s style', () => {
    const prompt = comicPortraitPrompt({ name: '闰土', appearance: '年近五十，破毡帽', description: '童年好友' }, 'Chinese ink-wash painting');
    assert.match(prompt, /Draw only this character and nothing else/);
    assert.match(prompt, /pure-white background/);
    assert.match(prompt, /破毡帽/);
    assert.match(prompt, /Visual style: Chinese ink-wash painting/);
});

test('each line names who says it by gender, looks and voice, so the model does not give a man\'s line to the woman on screen', () => {
    const man = { name: '陈屿', description: '男主角，二十八岁咖啡馆老板', voice: '低沉温和，语速不快', appearance: '二十八岁，利落短发。\n服装：黑色高领羊毛衫，深灰色西裤；胸前挂一台旧胶片相机。\n性格：内敛。' };
    const woman = { name: '林晚', description: '女主角，二十六岁插画师', voice: '清亮柔和', appearance: '二十四岁，长直发。\n服装：米白色长款风衣' };
    assert.equal(comicCharacterGender(man), 'male');
    assert.equal(comicCharacterGender(woman), 'female');
    assert.equal(comicCharacterGender({ description: '店员', voice: '', appearance: '' }), undefined);
    assert.equal(comicSpeakerLooks(man.appearance), '二十八岁，黑色高领羊毛衫，深灰色西裤');
    const prompt = comicDialoguePrompt([
        { text: '抱歉，你站在雨里的样子和我七年前拍到的照片一模一样。', speaker: { name: man.name, gender: 'male', looks: comicSpeakerLooks(man.appearance), voice: man.voice, onScreen: true } },
        { text: '妈妈……', speaker: { name: woman.name, gender: 'female', looks: '', voice: woman.voice, onScreen: false } },
        { text: '那年夏天。' }
    ]);
    assert.match(prompt, /1\. 陈屿——画面中那个男人（二十八岁，黑色高领羊毛衫，深灰色西裤）；嗓音：男声，低沉温和，语速不快。他说：“抱歉/);
    assert.match(prompt, /2\. 林晚——画外的声音（此人不在画面中，画面里的人都不开口）；嗓音：女声，清亮柔和。她说：“妈妈……”/);
    assert.match(prompt, /3\. 旁白（画外音，画面中没有人开口）：“那年夏天。”/);
    assert.match(prompt, /只有正在说这句台词的人嘴唇在动/);
    assert.match(prompt, /不要把字幕烧进画面/);
    assert.doesNotMatch(prompt, /无文字|无标识|无水印/, 'no blanket bans: only burned-in subtitles, which would double the editor\'s own');
    const english = comicDialoguePrompt([{ text: 'This one is on me.', speaker: { name: 'Leo', gender: 'male', looks: '30, grey coat', voice: 'deep', onScreen: true } }]);
    assert.match(english, /Leo — the man on screen \(30, grey coat\); voice: male voice, deep\. Says: “This one is on me\.”/);
    assert.equal(comicDialoguePrompt([]), '');
});

test('Chinese stories get Chinese reference captions; multi-shot models are marked in the guide', () => {
    assert.match(comicReferenceCaption([['林晚'], ['陈屿']], true), /^人物参考：参考图1（\[Image 1\]）是林晚；参考图2（\[Image 2\]）是陈屿。/);
    assert.equal(videoModelGuide('video_wan_3.0').multiShot, true);
    assert.deepEqual([videoModelGuide('video_wan_3.0').clipSeconds.at(0), videoModelGuide('video_wan_3.0').clipSeconds.at(-1)], [2, 30]);
    assert.equal(videoModelGuide('google/veo-3.1').multiShot, undefined, 'Veo films one set-up per clip');
});

test('dialogue lines land on their seconds, like a time-coded short-drama script', () => {
    const prompt = comicDialoguePrompt;
    const text = prompt([
        { text: '人人都说王爷不近女色。', tone: '小声试探，凑上前', seconds: [0.4, 3.1], speaker: { name: '丫头', gender: 'female', onScreen: true, looks: '浅绿色薄纱汉代广袖服' } },
        { text: '嗯。', tone: '眼都不抬，冷淡', seconds: [3.2, 4], speaker: { name: '王爷', gender: 'male', onScreen: true } }
    ]);
    assert.match(text, /1\.（0\.5–3 秒）丫头——画面中那个女人（浅绿色薄纱汉代广袖服）；嗓音：女声。她说：“人人都说王爷不近女色。”（语气: 小声试探，凑上前）/);
    assert.match(text, /2\.（3–4 秒）王爷/);
    assert.match(prompt([{ text: 'Is he coming?', tone: 'whispered', seconds: [0, 2] }], { chinese: false }), /1\.（0–2 s）Narrator/);
    assert.doesNotMatch(prompt([{ text: '嗯。' }]), /秒）/, 'untimed lines keep the plain numbering');
});
