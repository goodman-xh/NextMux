import assert from 'node:assert/strict';
import test from 'node:test';
import { parseComicStepPrefs, recommendedComicStepCandidate, resolveComicStep, resolveComicStepCandidate, simpleComicStepChoices } from '../lib/browser/nextmux-comic-step-models.js';
import { comicModelPanelText, comicModelSetupSummary, comicModelSetupText, comicSetupGroups, comicSetupTab } from '../lib/browser/nextmux-comic-model-setup.js';


const own = { key: 'official:key-a', kind: 'official', label: 'My key' };
const auto = { key: 'auto', kind: 'automatic', label: '' };
const relayA = { key: 'managed:relay-a', kind: 'managed', label: 'Relay A' };
const relayB = { key: 'managed:relay-b', kind: 'managed', label: 'Relay B' };
const candidate = (source, model, rank, routeId = `${source.key}-${model}`) => ({ key: `${source.key}::${routeId}`, routeId, model, label: model, source, rank });

const video = [
    candidate(relayA, 'seedance-pro', 5), candidate(relayA, 'kling-2', 9),
    candidate(relayB, 'veo-3', 2), candidate(auto, 'veo-3', 3), candidate(own, 'wan-2.5', 50)
];
const text = [candidate(own, 'gpt-5.1', 10), candidate(auto, 'claude-opus', 1), candidate(relayB, 'claude-opus', 4)];

test('the simple menu lists each model once: own API first, then by quality', () => {
    assert.deepEqual(simpleComicStepChoices(video).map(item => `${item.source.key}/${item.model}`),
        ['official:key-a/wan-2.5', 'auto/veo-3', 'managed:relay-a/seedance-pro', 'managed:relay-a/kling-2']);
    // A stored model that moved to another source is still found by its model ID.
    assert.equal(resolveComicStepCandidate(video, 'kling-2').key, 'managed:relay-a::managed:relay-a-kling-2');
});

test('a step uses its own choice, else the global relay’s best model, else the recommended one', () => {
    assert.deepEqual(resolveComicStep(video, undefined, undefined), { candidate: video[4], origin: 'recommended', globalUnsupported: false });
    const global = resolveComicStep(video, undefined, 'managed:relay-a');
    assert.equal(global.candidate.model, 'seedance-pro', 'the relay’s own best, not the overall best');
    assert.equal(global.origin, 'global');
    const own = resolveComicStep(video, video[1].key, 'managed:relay-a');
    assert.equal(own.candidate.model, 'kling-2');
    assert.equal(own.origin, 'step');
    // The global relay cannot do this step: the recommended model, and the panel says why.
    const text = resolveComicStep([candidate(relayB, 'claude-opus', 4)], undefined, 'managed:relay-a');
    assert.equal(text.origin, 'recommended');
    assert.equal(text.globalUnsupported, true);
    assert.equal(text.candidate.model, 'claude-opus');
    // A choice that no longer exists falls back to the global relay instead of a stale route.
    const stale = resolveComicStep(video, 'managed:relay-z::gone', 'managed:relay-a');
    assert.equal(stale.origin, 'global');
    assert.equal(resolveComicStep([], undefined, 'managed:relay-a').candidate, undefined);
});

test('默认推荐 ignores earlier choices and relays; turning it off brings them back', () => {
    assert.equal(resolveComicStep(video, video[1].key, 'managed:relay-a', true).candidate, video[4], 'the recommended model (own API first)');
    assert.equal(resolveComicStep(video, video[1].key, 'managed:relay-a', true).origin, 'recommended');
    assert.equal(resolveComicStep(video, video[1].key, 'managed:relay-a', false).candidate, video[1]);
});

test('the step pane splits models into 中转商 and 自有 API, each with its recommendation first', () => {
    const local = { key: 'local', kind: 'local', label: 'ComfyUI' };
    const all = [...video, candidate(local, 'workflow', 9_000)];
    assert.deepEqual(all.map(item => comicSetupTab(item)), ['relay', 'relay', 'relay', 'relay', 'own', 'own']);
    // NextMux routing leads the relays, then each relay by its best model, each relay's models by rank.
    assert.deepEqual(comicSetupGroups(all, 'relay').map(group => [group.source.key, group.candidates.map(item => item.model)]), [
        ['auto', ['veo-3']], ['managed:relay-b', ['veo-3']], ['managed:relay-a', ['seedance-pro', 'kling-2']]
    ]);
    assert.deepEqual(comicSetupGroups(all, 'own').map(group => group.source.key), ['official:key-a', 'local'], 'this Mac comes after own APIs');
    assert.deepEqual(comicSetupGroups([], 'own'), []);
});

test('preferences keep the switch; older ones without it read as on unless something was chosen', () => {
    assert.deepEqual(parseComicStepPrefs(JSON.stringify({ choices: { video: 'x' }, advanced: { video: true }, relays: {}, global: 'managed:relay-a' })),
        { choices: { video: 'x' }, advanced: { video: true }, relays: {}, global: 'managed:relay-a', auto: false });
    assert.equal(parseComicStepPrefs(JSON.stringify({ choices: {}, advanced: {}, relays: {} })).auto, true);
    assert.equal(parseComicStepPrefs(JSON.stringify({ choices: { video: 'x' }, auto: true })).auto, true);
    assert.deepEqual(parseComicStepPrefs('{'), { choices: {}, advanced: {}, relays: {}, auto: true });
    assert.equal('global' in parseComicStepPrefs(JSON.stringify({ global: 42 })), false);
});

test('the header button says 默认推荐 or 手动选择 and counts core steps without a model', () => {
    const steps = [
        { capability: 'text', candidates: text, resolution: resolveComicStep(text, undefined, undefined, true) },
        { capability: 'image', candidates: [], resolution: resolveComicStep([], undefined, undefined, true) },
        { capability: 'video', candidates: video, resolution: resolveComicStep(video, undefined, undefined, true) },
        { capability: 'music', candidates: [], resolution: resolveComicStep([], undefined, undefined, true) }
    ];
    assert.deepEqual(comicModelSetupSummary('zh-CN', steps, true), { relay: '默认推荐', missing: 1 }, 'music is optional');
    assert.equal(comicModelSetupSummary('zh-CN', steps, false).relay, '手动选择');
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        assert.doesNotMatch(comicModelPanelText(locale, 'covered', { model: 'Veo' }), /\{model\}/, locale);
        assert.doesNotMatch(comicModelPanelText(locale, 'missingSteps', { steps: 'A' }), /\{steps\}/, locale);
        assert.ok(comicModelSetupText(locale, 'step_video'), locale);
    }
});

test('默认推荐: own API first, then the platform default for this kind × step, then the best-ranked model; a user choice always wins', () => {
    const relays = video.filter(candidate => candidate.source.kind !== 'official');
    const platformDefault = { sourceKey: relayA.key, model: 'kling-2' };
    assert.equal(recommendedComicStepCandidate(video, platformDefault).source.kind, 'official', 'own API first');
    assert.equal(recommendedComicStepCandidate(relays, platformDefault).key, `${relayA.key}::${relayA.key}-kling-2`);
    // The default's relay no longer offers it: the same model at another relay.
    assert.equal(recommendedComicStepCandidate(relays.filter(candidate => candidate.source.key !== relayA.key), { sourceKey: relayA.key, model: 'veo-3' }).model, 'veo-3');
    // An unknown default falls back to the ranking.
    assert.equal(recommendedComicStepCandidate(relays, { sourceKey: relayA.key, model: 'gone' }).key, recommendedComicStepCandidate(relays).key);
    assert.equal(resolveComicStep(relays, undefined, undefined, true, platformDefault).candidate.model, 'kling-2');
    assert.equal(resolveComicStep(relays, `${relayB.key}::${relayB.key}-veo-3`, undefined, false, platformDefault).candidate.model, 'veo-3', 'the user\'s choice wins');
});
