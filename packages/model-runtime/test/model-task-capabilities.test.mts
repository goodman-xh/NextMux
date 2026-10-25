import assert from 'node:assert/strict';
import test from 'node:test';
import { knownModelTaskCorrection, modelTaskCategories, isDecisionTaskModel, isDecisionOnlyModel } from '../lib/model-task-capabilities.js';
import { merchantModelCategories } from '../lib/merchant-modalities.js';
import { parseModelContract, applyModelRequestContract, modelSupportsMusicReference } from '../lib/model-contract.js';

test('models appear in all independent tasks without confusing input vision and embedded sound', () => {
    const model = { id: 'openai/gpt-5.5', kind: 'llm', input: ['text', 'image'], output: ['text', 'image'] };
    assert.deepEqual(modelTaskCategories(model), ['language', 'image']);
    assert.deepEqual(merchantModelCategories(model), ['language', 'image']);
    assert.deepEqual(model.output, ['text', 'image']);
    assert.deepEqual(modelTaskCategories({ kind: 'llm', input: ['image'], output: ['text'], capabilities: ['vision', 'tools'] }), ['language']);
    assert.deepEqual(modelTaskCategories({ kind: 'llm', output: ['text'], capabilities: ['image_generation'] }), ['language']);
    assert.deepEqual(modelTaskCategories({ kind: 'llm', output: ['text'], capabilityDeclarations: { image_generation: { support: 'supported', source: 'provider_metadata', scope: 'model' } } }), ['language', 'image']);
    assert.deepEqual(modelTaskCategories({ kind: 'llm', output: ['text', 'audio'], capabilities: ['audio_generation'] }), ['language']);
    assert.deepEqual(modelTaskCategories({ kind: 'video', output: ['video', 'audio'], capabilities: ['video_native_audio', 'speech_generation', 'music_generation', 'sound_effect_generation'] }), ['video']);
    assert.deepEqual(modelTaskCategories({ kind: 'speech', capabilities: ['text_to_speech', 'sound_effect_generation'] }), ['speech', 'sound_effect']);
    assert.deepEqual(modelTaskCategories({ id: 'tencent/hunyuan-3d-2', kind: '3d', output: ['text'], capabilities: ['tools', '3d'] }), ['3d', 'language']);
    assert.deepEqual(modelTaskCategories({ id: 'tencent/hunyuan-3d-2', category: '3d', output: ['text'] }), ['3d', 'language']);
});

test('confirmed identity corrections do not resurrect the same bad upstream metadata as a second task', () => {
    for (const [id, kind] of [
        ['runway/gen4_image', 'image'], ['runway/eleven_multilingual_v2', 'speech'],
        ['google/deep-research-pro-preview-12-2025', 'llm'], ['fal-ai/fal-ai/trellis-2', '3d'],
        ['meta/esm2-650m', 'embedding'], ['nvidia/synthetic-video-detector', 'other'],
        ['openai/gpt-oss-safeguard-20b', 'moderation'], ['fastino/GLiNER-2.5-Decide', 'decision']
    ] as const) {
        const model = { id, kind: 'llm', output: ['text', 'image', 'video'], capabilities: ['tools', 'image_generation', 'video_generation'] };
        assert.equal(knownModelTaskCorrection(model), kind, id);
        assert.deepEqual(modelTaskCategories(model), [kind === 'llm' ? 'language' : kind], id);
    }
    assert.deepEqual(modelTaskCategories({ id: 'openrouter/auto', kind: 'image', output: ['text', 'image'] }), ['language', 'image']);
    assert.equal(knownModelTaskCorrection({ id: 'private/runway', name: 'gen4_image' }), undefined);
    assert.equal(knownModelTaskCorrection({ id: 'opencode/jev-latest', output: ['text'] }), undefined, 'unverified serving alias stays unchanged');
    assert.deepEqual(modelTaskCategories({ kind: 'future_kind', output: ['text', 'image'] }), ['other']);
    assert.deepEqual(modelTaskCategories({ id: 'google/deep-research-pro-preview-12-2025', output: ['image'], mode: 'image_generation', taskCategories: ['language', 'image'] }), ['language'], 'the known bad source cannot resurrect its task under a new field');
    assert.deepEqual(modelTaskCategories({ id: 'google/deep-research-pro-preview-12-2025', output: ['image'], taskCategories: ['image'], capabilityDeclarations: { image_generation: { support: 'supported', source: 'provider_metadata', scope: 'model' } } }), ['language', 'image'], 'a separately established capability can augment an old identity correction');
    assert.equal(knownModelTaskCorrection({ id: 'new/recognizer', pipeline_tag: 'automatic-speech-recognition', output: ['text'] }), 'transcription');
    assert.deepEqual(modelTaskCategories({ id: 'new/embedder', supportedGenerationMethods: ['embedContent'] }), ['embedding']);
    assert.equal(knownModelTaskCorrection({ id: 'new/unknown', supportedGenerationMethods: ['generateContent'] }), undefined, 'shared content endpoint does not identify an output task');
    assert.equal(isDecisionTaskModel(null as never), false);
    assert.deepEqual(modelTaskCategories(null as never), ['other']);
});

test('decision purpose is consistent across metadata shapes without granting a decision transport', () => {
    for (const model of [
        { canonicalModel: '@cf/cloudflare/clef', output: ['text'] },
        { id: 'typesafe/jev-latest', output: ['text'] },
        { modelId: 'vendor/opaque', discoveredOutputJson: '["decisions"]', registryOutputJson: '["text"]' },
        { id: 'togethercomputer/tev1-4b-experimental', output: ['decisions'] },
        { id: 'together/Tev1-4B-experimental', output: ['text'] },
        { id: 'future/native-decider', taskCategories: ['decision'], output: ['text'] },
        { id: 'vendor/opaque', displayName: 'Jev Fast' }
    ]) assert.equal(isDecisionTaskModel(model), true);
    for (const id of ['typesafe/jev-router', 'vendor/jev-chat', 'vendor/jev-text', 'vendor/spanish-chat']) {
        assert.equal(isDecisionTaskModel({ id }), false, id);
        assert.equal(isDecisionTaskModel({ id, output: ['text'] }), false, id);
    }
    assert.equal(isDecisionTaskModel({ id: 'vendor/jev-9', kind: 'decision', output: ['text'] }), false, 'unverified name/category cannot override declared output');
    assert.deepEqual(modelTaskCategories({ kind: 'transcription', output: ['text'], input: ['audio'] }), ['transcription']);
    assert.deepEqual(modelTaskCategories({ output: ['rerank'] }), ['rerank']);
});

test('explicit future task declarations survive contract storage without becoming request or upload permission', () => {
    const options = { protocol: 'openai', scope: 'model' as const };
    const contract = parseModelContract({ pipeline_tag: 'automatic-speech-recognition', taskCategories: ['language', 'invalid', 'language'] }, options);
    assert.deepEqual(contract.taskCategories, ['language', 'transcription']);
    assert.deepEqual(parseModelContract(JSON.parse(JSON.stringify(contract)), options).taskCategories, contract.taskCategories);
    assert.equal(parseModelContract({ input: ['image'], capabilities: ['vision', 'audio_generation'] }, options).taskCategories, undefined);
    const request = applyModelRequestContract({ messages: [] }, { ...contract, protocol: 'openai', model: 'new/task', baseUrl: 'https://provider.test/v1' }, {});
    assert.equal('taskCategories' in request, false);
    assert.equal(modelSupportsMusicReference({ taskCategories: ['music'] }, 'vocal_reference'), false);
});


test('an independently verified decision role augments a language model without excluding it from chat', () => {
    const model = { id: 'openai/gpt-6-luna', output: ['text'], taskCategories: ['language', 'decision'],
        capabilityDeclarations: { decision: { support: 'supported', source: 'provider_metadata', scope: 'model' } } };
    assert.equal(isDecisionTaskModel(model), true);
    assert.equal(isDecisionOnlyModel(model), false);
    assert.deepEqual(modelTaskCategories(model), ['language', 'decision']);
    assert.equal(isDecisionTaskModel({ id: 'openai/new-language', output: ['text'], capabilities: ['decision'] }), false);
    assert.equal(isDecisionTaskModel({ ...model, taskCategories: [], capabilityDeclarations: { decision: { support: 'supported', source: 'provider_metadata', scope: 'transport' } } }), false);
    assert.equal(isDecisionOnlyModel({ id: 'typesafe/jev-latest', output: ['text'] }), true);
});
