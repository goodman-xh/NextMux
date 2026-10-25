import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as naming from '../lib/common/nextmux-model-name.js';
import { matchCatalogModel } from '../lib/browser/nextmux-own-model-match.js';
import { OwnModelList, ownModelListModels, officialDiscoveredModelIds, officialInvokableModelIds } from '../lib/browser/nextmux-official-discovery.js';
import { partitionModelPickerCandidates } from '../lib/browser/nextmux-model-route-selection.js';
import { modelIdentitySpelling, modelReleaseVariant as backendRelease } from '../../../apps/cloudflare-platform/src/model-name-resolver.js';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');

const grouped = [
    ['opus 5.5 1222', 'opus 5.5'], ['opus5.5 1222', 'claude-opus-5.5'],
    ['claude-opus-5-5-20261222', 'claude-opus-5-5'], ['opus-5-5-20261222', 'claude-opus-5.5'],
    ['claude-opus-5.5-1222', 'claude-opus-5.5'],
    // Display grouping follows the task's GPT example; it is not a tariff identity claim.
    ['gpt-6-astra-2026-10-01', 'gpt-6-astra'], ['gpt-6-astra-20261001', 'gpt-6-astra'],
    ['gpt-6-astra-1017', 'gpt-6-astra'], ['gpt-6-astra-mini-20261001', 'gpt-6-astra-mini'],
    ['deepseek-v3-20261001', 'deepseek-v3'], ['qwen3-8b-2026-10-01', 'qwen3-8b'],
    ['DeepSeekv4.1', 'deepseek-v4.1'], ['deepseekv4.1 1017', 'deepseek-v4.1-1017'],
    ['doubao-seedream-4-0-250828', 'doubao-seedream-4-0'],
];
const releases = ['DeepSeek-V4.1-Flash 1017', 'DeepSeek-V4.1-Flash1017', 'deepseek-v4.1-flash-1017',
    'deepseekv4.1 1017', 'DeepSeek-V4.1 1017', 'DeepSeek-V4.11017', 'deepseek-v4.1-1017',
    'kimi-k2-0905', 'deepseek-v3-0324', 'deepseek-r1-0528', 'qwen3-max-0902', 'mistral-large-2512', 'mistral-small-2603'];
const variants = ['mini', 'flash', 'pro', 'turbo', 'lite', 'preview', 'thinking', 'vision', 'instruct', '8b', '70b', 'v2', '2.1'];
const row = canonicalModel => ({ id: canonicalModel, canonicalModel, provider: canonicalModel.split('/')[0],
    output: ['text'], capabilities: [], contextTokens: null, maximumOutputTokens: null });

test('display group keys collapse only snapshot suffixes while retaining namespaces', () => {
    for (const [snapshot, base] of grouped) {
        assert.equal(naming.modelNameGroupKey(snapshot), naming.modelNameGroupKey(base), snapshot);
        assert.equal(naming.modelNameGroupKey(`author/${snapshot}`), naming.modelNameGroupKey(`author/${base}`), snapshot);
        assert.notEqual(naming.modelNameGroupKey(`other/${snapshot}`), naming.modelNameGroupKey(`author/${base}`), snapshot);
    }
    for (const suffix of variants) assert.notEqual(naming.modelNameGroupKey(`gpt-6-astra-${suffix}`), naming.modelNameGroupKey('gpt-6-astra'), suffix);
    for (const suffix of ['12345', '1234567', '12345678', '202610', 'v20261001']) {
        assert.notEqual(naming.modelNameGroupKey(`custom-model-${suffix}`), naming.modelNameGroupKey('custom-model'), suffix);
        assert.ok(!naming.modelNameForms(`custom-model-${suffix}`).includes('custom-model'), suffix);
    }
    assert.notEqual(naming.modelNameGroupKey('gpt-6.1'), naming.modelNameGroupKey('gpt-6'));
    assert.notEqual(naming.modelNameGroupKey('model-v2'), naming.modelNameGroupKey('model-v1'));
    assert.notEqual(naming.modelNameGroupKey('model-8b'), naming.modelNameGroupKey('model-70b'));
    assert.ok(!naming.modelNameForms('custom-model-v20261001').includes('custom-model-v'), 'a split explicit v-version is not a snapshot');
    assert.ok(naming.modelNameForms('doubao-seedream-4.0-250828').includes('seedream-4.0'), 'a branded six-digit build retains its unbranded lookup form');
});

test('documented backend Claude and numbered-release examples have the same grouping boundary', () => {
    for (const [name] of grouped.filter(([name]) => /opus/.test(name))) {
        assert.equal(`anthropic/${naming.modelNameGroupKey(name)}`, modelIdentitySpelling(name), name);
    }
    for (const name of releases) {
        assert.equal(naming.modelReleaseVariant(name), backendRelease(name), name);
        assert.equal(naming.modelNameGroupKey(name), modelIdentitySpelling(name).split('/').pop(), name);
        assert.ok(naming.modelNameForms(name).every(form => form.includes(backendRelease(name))), name);
        assert.notEqual(naming.modelNameGroupKey(name), naming.modelNameGroupKey('deepseek-v4.1'), name);
    }
    for (const canonical of ['moonshotai/kimi-k2', 'qwen/qwen3-235b-a22b']) {
        for (const suffix of ['thinking', 'thinking-cc']) {
            const name = `${canonical}-${suffix}`;
            assert.notEqual(naming.modelNameGroupKey(name), naming.modelNameGroupKey(canonical), name);
            assert.equal(matchCatalogModel(name, undefined, [row(canonical)]), undefined, name);
        }
    }
});

test('distinct variants and explicit versions cannot match a generic label or stale catalog alias', () => {
    for (const suffix of variants) {
        const id = `gpt-6-astra-${suffix}`;
        const base = { ...row('openai/gpt-6-astra'), aliases: [id] };
        const variant = row(`openai/${id}`);
        assert.equal(matchCatalogModel(id, 'gpt-6-astra', [base]), undefined, suffix);
        assert.equal(matchCatalogModel(id, 'gpt-6-astra', [base, variant]), variant, suffix);
        assert.equal(matchCatalogModel('gpt-6-astra', undefined, [{ ...variant, aliases: ['gpt-6-astra'] }]), undefined, suffix);
    }
    assert.equal(matchCatalogModel('gpt-6.1', 'gpt-6', [row('openai/gpt-6')]), undefined);
    assert.equal(matchCatalogModel('gpt-4o', undefined, [{ ...row('openai/gpt-5o'), aliases: ['gpt-4o'] }]), undefined);
    assert.equal(matchCatalogModel('model-70b', 'model-8b', [row('meta/model-8b')]), undefined);
    assert.equal(matchCatalogModel('opaque-deployment', 'gpt-6-astra', [row('openai/gpt-6-astra')])?.canonicalModel, 'openai/gpt-6-astra');
    assert.equal(matchCatalogModel('gpt-6-astra-ultra', 'gpt-6-astra', [row('openai/gpt-6-astra')]), undefined);
    assert.equal(matchCatalogModel('models/gpt-6-astra-20261001', undefined, [row('openai/gpt-6-astra')])?.canonicalModel, 'openai/gpt-6-astra');
});

test('My API groups snapshots without rewriting raw IDs, merging metadata, or changing executable discovery', () => {
    const models = ['gpt-6-astra-20261001', 'gpt-6-astra', 'gpt-6-astra-mini', 'DeepSeek-V4.1-Flash 1017', 'DeepSeek-V4.1']
        .map((id, i) => Object.freeze({ id, label: id, contextTokens: 100 + i, selectionMode: 'invokable' }));
    const connection = Object.freeze({ providerId: 'custom_openai', model: 'gpt-6-astra', discoveredModels: Object.freeze(models) });
    assert.deepEqual(ownModelListModels(connection), models.slice(1));
    const html = renderToStaticMarkup(React.createElement(OwnModelList, { locale: 'zh-CN', connection }));
    assert.equal((html.match(/<li>/g) || []).length, 4, 'the real drawer component renders the grouped inventory');
    assert.ok(!html.includes(models[0].id), 'the dated duplicate is collapsed in the default view');
    assert.ok(html.includes(models[2].id) && html.includes(models[3].id), 'mini and the numbered Flash release remain visible');
    assert.deepEqual(ownModelListModels(connection, ' 20261001 '), [models[0]], 'a collapsed snapshot remains searchable');
    assert.deepEqual(officialDiscoveredModelIds(connection), ['gpt-6-astra', ...models.filter(m => m.id !== 'gpt-6-astra').map(m => m.id)]);
    assert.equal(officialInvokableModelIds(connection).length, models.length);
    const snapshotOnly = { ...connection, model: '', discoveredModels: [models[0]] };
    assert.equal(ownModelListModels(snapshotOnly)[0], models[0]);
    assert.equal(ownModelListModels({ ...snapshotOnly, model: 'manual-model' })[1].id, 'manual-model');
});

test('picker groups after checking exact route availability and never borrows a snapshot verification', () => {
    const candidates = ['gpt-6-astra', 'gpt-6-astra-20261001', 'gpt-6-astra-mini', 'deepseek-v4.1', 'DeepSeek-V4.1-Flash 1017']
        .map(id => Object.freeze({ id: `own/${id}`, identity: `own/${id}` }));
    const partition = partitionModelPickerCandidates(candidates, new Set([candidates[1].id, candidates[2].id]), true);
    assert.deepEqual(partition.selectable, [candidates[1], candidates[2]]);
    assert.deepEqual(partition.unavailable, candidates.slice(3));
    for (const values of [candidates, [...candidates].reverse()]) {
        const available = partitionModelPickerCandidates(values, new Set(candidates.map(c => c.id)), true).selectable;
        assert.equal(available.length, 4);
        assert.ok(available.includes(candidates[0]), 'prefer a reported base only when it is itself selectable');
        assert.ok(!available.includes(candidates[1]));
    }
    assert.deepEqual(partitionModelPickerCandidates(candidates, new Set(candidates.map(c => c.id))).selectable, candidates,
        'existing callers retain exact identities until visibility and selection handling opt in');
});

test('Claude variants retain their suffix while normalizing the explicit version spelling', () => {
    for (const suffix of variants.filter(value => !/^[\d]|^v\d/.test(value))) {
        const canonical = `claude-opus-5.5-${suffix}`;
        const variant = row(`anthropic/${canonical}`);
        for (const id of [`opus5.5-${suffix}`, `claude-opus-5-5-${suffix}`, `opus-5-5-${suffix}-20261222`]) {
            assert.equal(naming.modelNameGroupKey(id), canonical, id);
            assert.equal(matchCatalogModel(id, 'Claude Opus 5.5', [variant]), variant, id);
            assert.equal(matchCatalogModel(id, 'Claude Opus 5.5', [row('anthropic/claude-opus-5.5')]), undefined, id);
        }
    }
});

test('the reported ID owns its release even when a label claims a different one', () => {
    const base = row('deepseek/deepseek-v4.1-flash');
    const release = { ...row('deepseek/deepseek-v4.1-flash-1017'), aliases: ['deepseek-v4.1-flash'] };
    assert.equal(matchCatalogModel('deepseek-v4.1-flash', 'DeepSeek-V4.1-Flash 1017', [base, release]), base);
    assert.equal(matchCatalogModel('deepseek-v4.1-flash', 'DeepSeek-V4.1-Flash 1017', [release]), undefined);
    assert.equal(matchCatalogModel('deployment', 'DeepSeek-V4.1-Flash 1017', [base, release]), release);
    assert.equal(matchCatalogModel('deepseek-v4.1-flash-1017', 'DeepSeek-V4.1-Flash 1018', [release]), release);
});

test('catalog matching keeps the backend documented media spellings and different thinking variants', () => {
    for (const [id, canonical] of [['Wan 3', 'alibaba/wan-3.0'], ['veo3.0', 'google/veo-3'],
        ['doubao-seedream-4-0-250828', 'bytedance/seedream-4.0'], ['kling_v3_pro', 'kling/kling-3-pro']]) {
        const target = row(canonical);
        assert.equal(matchCatalogModel(id, undefined, [target]), target, id);
    }
    const thinking = { ...row('openai/gpt-6-astra-thinking'), aliases: ['gpt-6-astra-non-thinking'] };
    assert.equal(matchCatalogModel('gpt-6-astra-non-thinking', undefined, [thinking]), undefined);
    for (const id of ['llama-3.1-70b-instruct', 'llama-3.2-8b-instruct']) {
        const different = { ...row('meta/llama-3.1-8b-instruct'), aliases: [id] };
        assert.equal(matchCatalogModel(id, 'Llama', [different]), undefined, id);
    }
});

test('picker grouping preserves the selected snapshot without promoting an unavailable route', () => {
    const candidates = ['gpt-6-astra', 'gpt-6-astra-20261001'].map(id => ({ id, identity: id }));
    for (const values of [candidates, [...candidates].reverse()]) {
        assert.deepEqual(partitionModelPickerCandidates(values, new Set(candidates.map(c => c.id)), true, candidates[1].id).selectable,
            [candidates[1]]);
    }
    assert.deepEqual(partitionModelPickerCandidates(candidates, new Set([candidates[0].id]), true, candidates[1].id).selectable,
        [candidates[0]]);
});
