import assert from 'node:assert/strict';
import test from 'node:test';
import {
    newModelVisibilityPreferences, parseModelVisibilityPreferences, migrateModelVisibilityPreferences,
    isModelVisible, setModelsVisible, createModelVisibilityCatalog, resolveModelVisibilityId,
    modelVisibilityIdentity
} from '../lib/browser/nextmux-model-visibility.js';

const catalog = (...items) => createModelVisibilityCatalog(items.map(item => typeof item === 'string'
    ? { canonicalModel: item, provider: item.split('/')[0], kind: 'llm' } : { kind: 'llm', ...item }));
const emptyPreferences = index => ({ version: 3, catalogInitialized: true,
    knownModelIds: [...index.canonicalIds], defaults: { language: [], media: [] }, overrides: {} });

test('offline preferences defer defaults and keep unknown own-API models visible', () => {
    const prefs = newModelVisibilityPreferences();
    assert.equal(prefs.version, 3);
    assert.equal(prefs.catalogInitialized, false);
    assert.deepEqual(prefs.defaults, { language: [], media: [] });
    assert.deepEqual(prefs.knownModelIds, []);
    for (const id of ['openai/gpt-6-astra', 'custom/local-model', 'private-deployment', 'anthropic/claude-opus-4.6']) {
        assert.equal(isModelVisible(prefs, id, 'language'), true, id);
    }
    const hidden = setModelsVisible(prefs, ['custom/local-model'], 'language', false);
    assert.equal(isModelVisible(hidden, 'custom/local-model', 'language'), false);
    assert.equal(isModelVisible(hidden, 'other/local-model', 'language'), true);
});

test('exact author, punctuation, nested model path and case identities stay distinct', () => {
    const index = catalog('author-a/model-1.2', 'author-a/model-12', 'author-b/model-1.2',
        'author-c/Family/Model-V1', 'author-c/Family/model-v1');
    assert.equal(modelVisibilityIdentity(' author-a/model-1.2 '), 'author-a/model-1.2');
    const prefs = setModelsVisible(emptyPreferences(index), ['author-a/model-1.2', 'author-c/Family/Model-V1'], 'language', true, index);
    assert.equal(isModelVisible(prefs, 'author-a/model-1.2', 'language', index), true);
    assert.equal(isModelVisible(prefs, 'author-a/model-12', 'language', index), false);
    assert.equal(isModelVisible(prefs, 'author-b/model-1.2', 'language', index), false);
    assert.equal(isModelVisible(prefs, 'author-c/Family/model-v1', 'language', index), false);
    assert.equal(resolveModelVisibilityId('Family/Model-V1', index), 'author-c/Family/Model-V1');
    assert.equal(resolveModelVisibilityId('model-1.2', index), 'model-1.2');
    assert.equal(resolveModelVisibilityId('author-c/family/model-v1', index), 'author-c/family/model-v1');
});

test('only unambiguous public aliases share checkbox overrides across relays and BYOK', () => {
    const index = catalog({ canonicalModel: 'anthropic/claude-haiku-4.5', provider: 'anthropic',
        aliases: ['anthropic/claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'anthropic.claude-haiku-4-5-20251001-v1:0'] },
        'other-author/claude-haiku-4.5');
    let prefs = setModelsVisible(emptyPreferences(index), ['anthropic/claude-haiku-4.5'], 'language', true, index);
    for (const id of ['anthropic/claude-haiku-4.5', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'anthropic.claude-haiku-4-5-20251001-v1:0']) {
        assert.equal(isModelVisible(prefs, id, 'language', index), true, id);
    }
    assert.equal(isModelVisible(prefs, 'other-author/claude-haiku-4.5', 'language', index), false);
    assert.equal(isModelVisible(prefs, 'merchant-private/claude-haiku-4.5', 'language', index), true, 'unknown author remains usable');
    assert.equal(isModelVisible(prefs, 'claude-haiku-4.5', 'language', index), true, 'ambiguous own-API ID has no public checkbox');
    prefs = setModelsVisible(prefs, ['claude-haiku-4-5'], 'language', false, index);
    assert.equal(isModelVisible(prefs, 'anthropic/claude-haiku-4.5', 'language', index), false);
    assert.equal(isModelVisible(prefs, 'claude-haiku-4.5', 'language', index), true, 'ambiguous ID must not inherit another author\'s hide');
});

test('conflicting public aliases stay unresolved while exact canonical IDs always win', () => {
    const index = catalog(
        { canonicalModel: 'author-a/model', provider: 'author-a', aliases: ['shared-api-model', 'author-b/model'] },
        { canonicalModel: 'author-b/model', provider: 'author-b', aliases: ['shared-api-model'] });
    assert.equal(resolveModelVisibilityId('shared-api-model', index), 'shared-api-model');
    assert.equal(resolveModelVisibilityId('author-b/model', index), 'author-b/model');
    assert.equal(resolveModelVisibilityId('model', index), 'model');
    const hidden = setModelsVisible(emptyPreferences(index), [...index.canonicalIds], 'language', false, index);
    assert.equal(isModelVisible(hidden, 'shared-api-model', 'language', index), true);
    assert.equal(isModelVisible(hidden, 'model', 'language', index), true);
});

test('v1 migration preserves unique defaults, explicit overrides and original recovery data', () => {
    const original = { version: 1, defaults: { language: ['gpt4o'], media: ['veo31'] },
        overrides: { 'language:gpt4o': false, 'language:obscure1': true, 'media:veo31': false } };
    const deferred = parseModelVisibilityPreferences(JSON.stringify(original));
    assert.equal(deferred.version, 3);
    assert.equal(deferred.catalogInitialized, false);
    const index = catalog('openai/gpt-4o', 'openai/gpt-6-astra', 'vendor/obscure-1',
        { canonicalModel: 'google/veo-3.1', provider: 'google', kind: 'video' });
    const migrated = migrateModelVisibilityPreferences(deferred, index);
    assert.equal(migrated.catalogInitialized, true);
    assert.ok(migrated.defaults.language.includes('openai/gpt-4o'));
    assert.ok(migrated.defaults.media.includes('google/veo-3.1'));
    assert.equal(isModelVisible(migrated, 'openai/gpt-4o', 'language', index), false);
    assert.equal(isModelVisible(migrated, 'vendor/obscure-1', 'language', index), true);
    assert.equal(isModelVisible(migrated, 'google/veo-3.1', 'media', index), false);
    assert.deepEqual(parseModelVisibilityPreferences(JSON.stringify(migrated)), migrated);
    assert.deepEqual(migrated.legacy, { defaults: original.defaults, overrides: original.overrides });
});

test('v1 lossy choices never spread between authors or punctuation-distinct versions', () => {
    const prefs = parseModelVisibilityPreferences(JSON.stringify({ version: 1,
        defaults: { language: ['model12', 'shared'], media: [] },
        overrides: { 'language:model12': true, 'language:shared': true, 'language:absent': false } }));
    const firstForty = Array.from({ length: 40 }, (_, i) => 'filler/initial-' + i);
    const ambiguous = ['author-a/model-1.2', 'author-a/model-12', 'author-a/shared', 'author-b/shared'];
    const index = catalog(...firstForty, ...ambiguous);
    const migrated = migrateModelVisibilityPreferences(prefs, index);
    for (const id of ambiguous) assert.equal(isModelVisible(migrated, id, 'language', index), false, id);
    assert.equal(migrated.legacy.overrides['language:absent'], false, 'retain unrecoverable original data');
    const expanded = catalog(...firstForty, ...ambiguous, 'author-a/absent');
    const refreshed = migrateModelVisibilityPreferences(migrated, expanded);
    assert.equal(isModelVisible(refreshed, 'author-a/absent', 'language', expanded), true, 'future releases use the new-release rule');
    assert.equal(Object.hasOwn(refreshed.overrides, 'language:author-a/absent'), false, 'future catalogs cannot revive unresolved v1 hides');
});

test('a canonical choice made while catalog loads takes precedence over its old v1 choice', () => {
    const prefs = parseModelVisibilityPreferences(JSON.stringify({ version: 1,
        defaults: { language: ['gpt4o'], media: [] }, overrides: { 'language:gpt4o': false } }));
    const chosen = setModelsVisible(prefs, ['openai/gpt-4o'], 'language', true);
    const index = catalog('openai/gpt-4o');
    const migrated = migrateModelVisibilityPreferences(chosen, index);
    assert.equal(isModelVisible(migrated, 'openai/gpt-4o', 'language', index), true);
});

test('pre-v1 exact disabled route IDs migrate through public aliases and later show wins', () => {
    const index = catalog({ canonicalModel: 'anthropic/claude-haiku-4.5', provider: 'anthropic', aliases: ['claude-haiku-4-5'] });
    const prefs = parseModelVisibilityPreferences(null, { language: JSON.stringify(['claude-haiku-4-5']) }, index);
    assert.equal(isModelVisible(prefs, 'anthropic/claude-haiku-4.5', 'language', index), false);
    const shown = setModelsVisible(prefs, ['anthropic/claude-haiku-4.5'], 'language', true, index);
    const restored = parseModelVisibilityPreferences(JSON.stringify(shown), { language: JSON.stringify(['claude-haiku-4-5']) }, index);
    assert.equal(isModelVisible(restored, 'claude-haiku-4-5', 'language', index), true);
});

test('empty catalog defers initialization and malformed v3 storage remains safe', () => {
    const prefs = newModelVisibilityPreferences();
    assert.equal(migrateModelVisibilityPreferences(prefs, catalog()), prefs);
    const hidden = setModelsVisible(prefs, ['google/veo-3.1'], 'media', false);
    assert.equal(isModelVisible(hidden, 'google/veo-3.1', 'media'), false);
    assert.equal(isModelVisible(hidden, 'veo-3.1', 'media'), true, 'offline IDs are not guessed aliases');
    assert.equal(parseModelVisibilityPreferences('{broken').version, 3);
    const parsed = parseModelVisibilityPreferences(JSON.stringify({ version: 3, catalogInitialized: true,
        knownModelIds: ['openai/gpt-4o', 'openai/gpt-4o', 4, 'bad\u0000id'],
        defaults: { language: ['openai/gpt-4o', 4, 'bad\u0000id'], media: [] },
        overrides: { 'language:openai/gpt-4o': false, 'language:other': 'false', invalid: true } }));
    assert.deepEqual(parsed.defaults.language, ['openai/gpt-4o']);
    assert.deepEqual(parsed.knownModelIds, ['openai/gpt-4o']);
    assert.deepEqual(parsed.overrides, { 'language:openai/gpt-4o': false });
});

test('catalog canonical spelling changes retain choices only through explicit public aliases', () => {
    const originalCatalog = catalog('minimax/minimax-m2.7', 'openai/gpt-4o');
    let prefs = newModelVisibilityPreferences(originalCatalog);
    prefs = setModelsVisible(prefs, ['minimax/minimax-m2.7'], 'language', false, originalCatalog);
    const revised = catalog({ canonicalModel: 'minimax/MiniMax-M2.7', provider: 'minimax', aliases: ['minimax/minimax-m2.7'] },
        { canonicalModel: 'openai/GPT-4o', provider: 'openai', aliases: ['openai/gpt-4o'] }, 'other/gpt-4o');
    prefs = migrateModelVisibilityPreferences(prefs, revised);
    assert.equal(isModelVisible(prefs, 'minimax/MiniMax-M2.7', 'language', revised), false);
    assert.equal(isModelVisible(prefs, 'openai/GPT-4o', 'language', revised), true);
    assert.equal(isModelVisible(prefs, 'other/gpt-4o', 'language', revised), true, 'new author is independently enabled');
    prefs = setModelsVisible(prefs, ['minimax/MiniMax-M2.7'], 'language', true, revised);
    assert.equal(isModelVisible(prefs, 'minimax/MiniMax-M2.7', 'language', revised), true);
    assert.equal(isModelVisible(prefs, 'minimax/minimax-m2.7', 'language', revised), true);
});
