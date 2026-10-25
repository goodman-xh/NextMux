import assert from 'node:assert/strict';
import test from 'node:test';

const { videoModelMakesSound } = await import('../lib/common/nextmux-model-sound.js');

test('video models that make their own sound are recognised by capability or by name (same rule as the platform)', () => {
    for (const model of ['google/veo-3.1-generate-preview', 'veo3.1', 'openai/sora-2-pro', 'klingai/kling-v2.6-t2v', 'kling-v3-pro', 'alibaba/wan-v2.6-i2v', 'wan2.5-t2v-preview',
        'bytedance/seedance-v1.5-pro', 'bytedance/seedance-2.5', 'lightricks/ltx-2']) assert.equal(videoModelMakesSound(model), true, model);
    for (const model of ['google/veo-2', 'minimax/hailuo-2.3', 'kling-v2-1-master', 'wan2.2-t2v-plus', 'bytedance/seedance-v1.0-pro', 'zhipu/cogvideox-3']) assert.equal(videoModelMakesSound(model), false, model);
    // The platform's taxonomy flag wins for names the rule does not know.
    assert.equal(videoModelMakesSound('vendor/new-video-model', ['video_generation', 'video_native_audio']), true);
});

test('own generation APIs: a relay model name or a format that turns sound on means the model speaks', async () => {
    const { videoModelMakesSound } = await import('../lib/common/nextmux-model-sound.js');
    assert.equal(videoModelMakesSound('video_wan_3.0'), true, '速创-style names with underscores');
    assert.equal(videoModelMakesSound('video_veo3.1_fast'), true);
    // Hailuo 3 makes its own sound (video model guide); Hailuo 2.3 does not.
    assert.equal(videoModelMakesSound('video_minimax_h3'), true);
    assert.equal(videoModelMakesSound('video_hailuo_2.3'), false);
    assert.equal(videoModelMakesSound('custom-model', ['native_audio']), true, 'a template with generate_audio on');
    const { officialMediaCapabilities } = await import('@nextmux/model-runtime/presets');
    const { normalizeMediaTemplate } = await import('@nextmux/model-runtime/media-template');
    const withSound = normalizeMediaTemplate({ preset: 'wuyin', submit: { body: '{"prompt":"{{prompt}}","generate_audio":"true"}' } });
    const silent = normalizeMediaTemplate({ preset: 'wuyin', submit: { body: '{"prompt":"{{prompt}}","images":"{{references_csv}}"}' } });
    assert.ok(officialMediaCapabilities('async_media_template', 'm', { mediaTemplate: withSound }).includes('native_audio'));
    assert.ok(!officialMediaCapabilities('async_media_template', 'm', { mediaTemplate: silent }).includes('native_audio'));
    assert.ok(officialMediaCapabilities('async_media_template', 'm', { mediaTemplate: silent }).includes('reference_to_video'));
});
