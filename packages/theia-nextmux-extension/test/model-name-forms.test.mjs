import assert from 'node:assert/strict';
import test from 'node:test';

const { modelNameForms } = await import('../lib/common/nextmux-model-name.js');
const { videoModelGuide } = await import('../lib/common/nextmux-video-model-guide.js');
const { videoModelMakesSound } = await import('../lib/common/nextmux-model-sound.js');
const { ownModelKind } = await import('../lib/browser/nextmux-own-model-kind.js');

test('relay spellings of one model are recognised: underscores, spaces, kind prefixes, build numbers', () => {
    for (const name of ['video_wan_3.0', 'Wan 3.0', 'wan3.0-0826', 'alibaba/wan-3.0', 'WAN_3']) {
        assert.equal(videoModelGuide(name).family, 'Wan 3.0', name);
        assert.equal(videoModelMakesSound(name), true, name);
        assert.equal(ownModelKind({ id: name }), 'video', name);
    }
    assert.equal(videoModelGuide('kling_v3_pro').family, 'Kling 3.0');
    assert.equal(videoModelGuide('video_minimax_h3').family, 'Hailuo 3');
    assert.ok(modelNameForms('video_veo3.1_fast').includes('veo-3.1-fast'));
    assert.equal(modelNameForms('').length, 0);
});

test('a name nothing matches still has its exact form (it stays usable, just unpriced)', () => {
    assert.deepEqual(modelNameForms('my-lab/secret-model')[0], 'my-lab/secret-model');
    assert.equal(videoModelGuide('my-lab/secret-model').family, videoModelGuide('').family);
});

test('author release numbers survive every loose spelling while Claude version dates normalize', () => {
    for (const [name, release] of [
        ['DeepSeek-V4.1-Flash 1017', '1017'], ['DeepSeek-V4.1-Flash1017', '1017'],
        ['deepseekv4.1 1017', '1017'], ['DeepSeek-V4.1 1017', '1017'], ['DeepSeek-V4.11017', '1017'],
        ['deepseek-v3-0324', '0324'], ['deepseek-r1-0528', '0528'],
        ['qwen3-max-0902', '0902'], ['mistral-large-2512', '2512'], ['mistral-small-2603', '2603'],
    ]) assert.ok(modelNameForms(name).every(form => form.includes(release)), name);
    assert.ok(modelNameForms('DeepSeek-V4.1-Flash1017').includes('deepseek-v4.1-flash-1017'));
    assert.ok(modelNameForms('deepseekv4.1 1017').includes('deepseek-v4.1-1017'));
    assert.ok(modelNameForms('DeepSeekv4.1').includes('deepseek-v4.1'));
    for (const name of ['opus 5.5', 'opus5.5 1222', 'claude-opus-5.5-1222', 'opus-5-5-20261222']) {
        assert.ok(modelNameForms(name).includes('claude-opus-5.5'), name);
    }
});

test('voice chat models that answer with audio are not music models (“gpt-audio” is not Udio)', () => {
    const chatAudio = { inputModalities: ['text', 'audio'], outputModalities: ['text', 'audio'] };
    assert.equal(ownModelKind({ id: 'openai/gpt-audio-mini', ...chatAudio }), 'llm');
    assert.equal(ownModelKind({ id: 'openai/gpt-audio', ...chatAudio }), 'llm');
    assert.equal(ownModelKind({ id: 'openai/gpt-4o-audio-preview', outputModalities: ['audio'] }), 'speech');
    assert.equal(ownModelKind({ id: 'google/lyria-3-pro-preview', outputModalities: ['text', 'audio'] }), 'music');
    assert.equal(ownModelKind({ id: 'udio-v1.5', outputModalities: ['audio'] }), 'music');
    assert.equal(ownModelKind({ id: 'suno-v5' }), 'music');
    assert.equal(ownModelKind({ id: 'audio-large' }), 'llm');
});
