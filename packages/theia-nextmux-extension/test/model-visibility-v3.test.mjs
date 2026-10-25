import assert from 'node:assert/strict';
import test from 'node:test';
import {
    newModelVisibilityPreferences, parseModelVisibilityPreferences, migrateModelVisibilityPreferences,
    isModelVisible, setModelsVisible, createModelVisibilityCatalog, modelVisibilityCategories
} from '../lib/browser/nextmux-model-visibility.js';

const categories = ['language', '3d', 'image', 'video', 'speech', 'music', 'soundEffect', 'transcription'];
const group = category => category === 'language' ? 'language' : 'media';
const entry = (category, position) => ({
    canonicalModel: 'author-' + category + '/model-' + (90 - position),
    provider: 'author-' + category,
    kind: category === 'language' ? 'llm' : category === 'soundEffect' ? 'audio' : category,
    ...(category === '3d' ? { output: ['3d'] } : {}),
    ...(category === 'soundEffect' ? { output: ['audio'], capabilities: ['sound_effect_generation'] } : {})
});
const fixtures = () => Array.from({ length: 43 }, (_, position) => categories.map(category => entry(category, position))).flat();
const idsFor = (entries, category) => entries.filter(model => modelVisibilityCategories(model).includes(category)).map(model => model.canonicalModel);
const sorted = ids => [...ids].sort();

test('categories use public kinds and the comic sound-effect capability rule', () => {
    for (const category of categories) assert.deepEqual(modelVisibilityCategories(entry(category, 0)), [category]);
    assert.deepEqual(modelVisibilityCategories({ kind: '3d', output: ['text'] }), ['3d', 'language']);
    assert.deepEqual(modelVisibilityCategories({ kind: 'speech', capabilities: ['sound_effect_generation'] }), ['speech', 'soundEffect']);
    assert.deepEqual(modelVisibilityCategories({ kind: 'audio', capabilities: ['text-to-sound-effect'] }), ['soundEffect']);
    assert.deepEqual(modelVisibilityCategories({ kind: 'audio', capabilities: ['speech_generation'] }), ['speech']);
    for (const kind of ['embedding', 'rerank', 'moderation']) {
        assert.deepEqual(modelVisibilityCategories({ kind, output: ['text'], capabilities: ['text_to_speech'] }), [], kind);
    }
    assert.deepEqual(modelVisibilityCategories({ output: ['text'] }), ['language']);
    assert.deepEqual(modelVisibilityCategories({ capabilities: ['speech_to_text'] }), ['transcription']);
});

test('new task membership adds only its new group and preserves explicit hides and old unchecked models', () => {
    const original = createModelVisibilityCatalog([
        { canonicalModel: 'vendor/multimodal', provider: 'vendor', kind: 'llm', output: ['text'] },
        ...Array.from({ length: 42 }, (_, i) => ({ canonicalModel: `vendor/plain-${i}`, provider: 'vendor', kind: 'llm' }))
    ]);
    let prefs = newModelVisibilityPreferences(original);
    prefs = setModelsVisible(prefs, ['vendor/multimodal'], 'media', false, original);
    const expanded = createModelVisibilityCatalog([
        { canonicalModel: 'vendor/multimodal', provider: 'vendor', kind: 'llm', output: ['text', 'image'] },
        ...Array.from({ length: 42 }, (_, i) => ({ canonicalModel: `vendor/plain-${i}`, provider: 'vendor', kind: 'llm' }))
    ]);
    const next = migrateModelVisibilityPreferences(prefs, expanded);
    assert.deepEqual(expanded.modelCategories.get('vendor/multimodal'), ['language', 'image']);
    assert.ok(next.defaults.media.includes('vendor/multimodal'));
    assert.equal(isModelVisible(next, 'vendor/multimodal', 'media', expanded), false);
    assert.equal(isModelVisible(next, 'vendor/multimodal', 'language', expanded), true);
    assert.equal(isModelVisible(next, 'vendor/plain-41', 'language', expanded), false);
    assert.deepEqual(parseModelVisibilityPreferences(JSON.stringify(next)), next);
    assert.equal(migrateModelVisibilityPreferences(next, expanded), next);
    const { knownModelGroups: _oldSnapshot, ...legacy } = prefs;
    const migratedLegacy = migrateModelVisibilityPreferences(legacy, expanded);
    assert.equal(isModelVisible(migratedLegacy, 'vendor/multimodal', 'media', expanded), false);
    assert.equal(isModelVisible(migratedLegacy, 'vendor/plain-41', 'language', expanded), false);
    const corrected = createModelVisibilityCatalog([{ canonicalModel: 'google/deep-research-pro-preview-12-2025', provider: 'google', kind: 'llm', output: ['text'] }]);
    const oldImageChoice = { version: 3, catalogInitialized: true, knownModelIds: ['google/deep-research-pro-preview-12-2025'], defaults: { language: [], media: ['google/deep-research-pro-preview-12-2025'] }, overrides: {} };
    const correctedChoice = migrateModelVisibilityPreferences(oldImageChoice, corrected);
    assert.equal(isModelVisible(correctedChoice, 'google/deep-research-pro-preview-12-2025', 'language', corrected), true, 'an existing default choice follows its corrected purpose');
    assert.deepEqual(modelVisibilityCategories({ kind: 'video', output: ['video', 'audio'], capabilities: ['video_native_audio', 'speech_generation', 'music_generation', 'sound_effect_generation'] }), ['video']);
});

test('fresh catalog selects the first 40 in each of seven categories in server order', () => {
    const entries = fixtures();
    // A duplicate must not consume another slot, and old recommendation metadata cannot override server order.
    entries.push({ ...entry('language', 42), recommendedGroups: ['language'] });
    entries.push(...['embedding', 'rerank', 'moderation'].map(kind => ({
        canonicalModel: 'unsupported/' + kind, provider: 'unsupported', kind, output: ['text']
    })));
    const index = createModelVisibilityCatalog(entries);
    const prefs = newModelVisibilityPreferences(index);
    assert.equal(prefs.version, 3);
    assert.equal(prefs.catalogInitialized, true);
    assert.deepEqual(prefs.knownModelIds, [...index.canonicalIds]);
    assert.equal(prefs.defaults.language.length, 40);
    assert.equal(prefs.defaults.media.length, 280);
    for (const category of categories) {
        const expected = Array.from({ length: 43 }, (_, position) => entry(category, position).canonicalModel);
        assert.deepEqual(index.categories[category], expected, category + ' preserves server order');
        for (const [position, id] of expected.entries()) {
            assert.equal(isModelVisible(prefs, id, group(category), index), position < 40, category + ' position ' + position);
        }
    }
    for (const kind of ['embedding', 'rerank', 'moderation']) {
        assert.equal(prefs.defaults.language.includes('unsupported/' + kind), false);
        assert.equal(prefs.defaults.media.includes('unsupported/' + kind), false);
        assert.deepEqual(index.modelCategories.get('unsupported/' + kind), []);
    }
});

test('later releases are checked in every category without resetting the initial selections', () => {
    const entries = fixtures();
    const initial = createModelVisibilityCatalog(entries);
    const prefs = newModelVisibilityPreferences(initial);
    const newEntries = categories.map(category => entry(category, 50));
    const refreshedCatalog = createModelVisibilityCatalog([...newEntries, ...entries.toReversed()]);
    const refreshed = migrateModelVisibilityPreferences(prefs, refreshedCatalog);
    for (const category of categories) {
        const newId = entry(category, 50).canonicalModel;
        assert.equal(isModelVisible(refreshed, newId, group(category), refreshedCatalog), true, category);
        assert.ok(refreshed.knownModelIds.includes(newId), category + ' known snapshot is extended');
        assert.equal(isModelVisible(refreshed, entry(category, 0).canonicalModel, group(category), refreshedCatalog), true);
        assert.equal(isModelVisible(refreshed, entry(category, 42).canonicalModel, group(category), refreshedCatalog), false,
            'an old unchecked model remains unchecked even if reordered to the front');
    }
    assert.equal(prefs.knownModelIds.length, 344, 'refresh leaves the original preferences immutable');
    assert.equal(prefs.defaults.language.length, 40);
    assert.equal(refreshed.defaults.language.length, 41);
    assert.equal(refreshed.defaults.media.length, 287);
    assert.equal(migrateModelVisibilityPreferences(refreshed, refreshedCatalog), refreshed, 'unchanged refresh is idempotent');
});

test('explicit hides win when previously unknown releases and their public aliases appear', () => {
    const initial = createModelVisibilityCatalog(fixtures());
    let prefs = newModelVisibilityPreferences(initial);
    const newLanguage = entry('language', 50);
    const newImage = { ...entry('image', 50), aliases: ['private-image-deployment'] };
    prefs = setModelsVisible(prefs, [newLanguage.canonicalModel], 'language', false, initial);
    prefs = setModelsVisible(prefs, ['private-image-deployment'], 'media', false, initial);
    const expanded = createModelVisibilityCatalog([...fixtures(), newLanguage, newImage]);
    const refreshed = migrateModelVisibilityPreferences(prefs, expanded);
    assert.ok(refreshed.defaults.language.includes(newLanguage.canonicalModel), 'new releases enter defaults');
    assert.ok(refreshed.defaults.media.includes(newImage.canonicalModel));
    assert.equal(isModelVisible(refreshed, newLanguage.canonicalModel, 'language', expanded), false);
    assert.equal(isModelVisible(refreshed, newImage.canonicalModel, 'media', expanded), false);
    assert.equal(isModelVisible(refreshed, 'private-image-deployment', 'media', expanded), false);
    const shown = setModelsVisible(refreshed, [newImage.canonicalModel], 'media', true, expanded);
    assert.equal(isModelVisible(shown, 'private-image-deployment', 'media', expanded), true);
});

test('v2 migration unions top40 with previous defaults and retains every explicit override', () => {
    const entries = fixtures();
    const oldLanguage = entry('language', 42).canonicalModel;
    const oldVideo = entry('video', 42).canonicalModel;
    const imageHide = entry('image', 42).canonicalModel;
    entries.find(model => model.canonicalModel === oldLanguage).aliases = ['old-language-deployment'];
    const index = createModelVisibilityCatalog(entries);
    const original = { version: 2, catalogInitialized: true,
        defaults: { language: ['old-language-deployment', 'missing/old-language'], media: [oldVideo, 'missing/old-media'] },
        overrides: {
            ['language:' + entry('language', 0).canonicalModel]: false,
            ['language:' + entry('language', 41).canonicalModel]: true,
            ['media:' + entry('video', 0).canonicalModel]: false,
            ['media:' + imageHide]: false,
            'language:missing/explicit-show': true,
            'media:missing/explicit-hide': false
        } };
    const migrated = parseModelVisibilityPreferences(JSON.stringify(original), undefined, index);
    const languageDefaults = [oldLanguage, 'missing/old-language', ...idsFor(entries, 'language').slice(0, 40)];
    const mediaDefaults = [oldVideo, 'missing/old-media',
        ...categories.filter(category => category !== 'language').flatMap(category => idsFor(entries, category).slice(0, 40))];
    assert.equal(migrated.version, 3);
    assert.equal(migrated.catalogInitialized, true);
    assert.deepEqual(sorted(migrated.defaults.language), sorted(languageDefaults));
    assert.deepEqual(sorted(migrated.defaults.media), sorted(mediaDefaults));
    assert.deepEqual(migrated.knownModelIds, [...index.canonicalIds]);
    assert.deepEqual(migrated.overrides, original.overrides);
    assert.equal(isModelVisible(migrated, oldLanguage, 'language', index), true);
    assert.equal(isModelVisible(migrated, 'old-language-deployment', 'language', index), true);
    assert.equal(isModelVisible(migrated, oldVideo, 'media', index), true);
    for (const [key, visible] of Object.entries(original.overrides)) {
        const separator = key.indexOf(':');
        assert.equal(isModelVisible(migrated, key.slice(separator + 1), key.slice(0, separator), index), visible, key);
    }
});

test('v2 migration waits for a complete catalog and preserves exact pending settings', () => {
    const old = { version: 2, catalogInitialized: true,
        defaults: { language: ['missing/old-language'], media: ['missing/old-media'] },
        overrides: { 'language:missing/old-language': false } };
    const pending = parseModelVisibilityPreferences(JSON.stringify(old));
    assert.equal(pending.version, 3);
    assert.equal(pending.catalogInitialized, false);
    assert.deepEqual(pending.knownModelIds, []);
    assert.deepEqual(pending.defaults, old.defaults);
    assert.deepEqual(pending.overrides, old.overrides);
    assert.equal(migrateModelVisibilityPreferences(pending, createModelVisibilityCatalog([])), pending);
    const index = createModelVisibilityCatalog([entry('language', 0), entry('image', 0)]);
    const migrated = migrateModelVisibilityPreferences(pending, index);
    assert.equal(migrated.catalogInitialized, true);
    assert.ok(migrated.defaults.language.includes('missing/old-language'));
    assert.ok(migrated.defaults.media.includes('missing/old-media'));
    assert.equal(isModelVisible(migrated, entry('language', 0).canonicalModel, 'language', index), true);
    assert.equal(isModelVisible(migrated, 'missing/old-language', 'language', index), false);
});

test('initialized v2 recovery archives cannot revive unresolved v1 choices during v3 migration', () => {
    const archive = { defaults: { language: [], media: [] }, overrides: { 'language:archivedmodel': false } };
    const index = createModelVisibilityCatalog([{ canonicalModel: 'author/archived-model', provider: 'author', kind: 'llm' }]);
    const initializedV2 = { version: 2, catalogInitialized: true,
        defaults: { language: [], media: [] }, overrides: {}, legacy: archive };
    const pending = parseModelVisibilityPreferences(JSON.stringify(initializedV2));
    assert.equal(pending.catalogInitialized, false, 'v2 still waits for the v3 top20 union');
    assert.equal(pending.legacyMigrated, true, 'the old recovery archive was already processed');
    const migrated = migrateModelVisibilityPreferences(pending, index);
    assert.equal(isModelVisible(migrated, 'author/archived-model', 'language', index), true,
        'a newly unique alias cannot revive an old unresolved hide');
    assert.deepEqual(migrated.overrides, {});
    assert.deepEqual(migrated.legacy, archive);
    assert.equal(migrated.legacyMigrated, true);
    assert.deepEqual(parseModelVisibilityPreferences(JSON.stringify(migrated), undefined, index), migrated);

    const uninitializedV2 = { ...initializedV2, catalogInitialized: false };
    const firstMigration = parseModelVisibilityPreferences(JSON.stringify(uninitializedV2), undefined, index);
    assert.equal(isModelVisible(firstMigration, 'author/archived-model', 'language', index), false,
        'an unprocessed legacy choice still migrates once when its identity is unique');
    assert.deepEqual(firstMigration.overrides, { 'language:author/archived-model': false });
    assert.deepEqual(firstMigration.legacy, archive);
    assert.equal(firstMigration.legacyMigrated, true);
});

test('removed models remain known and reappearance preserves hides and initial unchecked choices', () => {
    const entries = fixtures();
    const first = createModelVisibilityCatalog(entries);
    let prefs = newModelVisibilityPreferences(first);
    const hiddenId = entry('language', 0).canonicalModel;
    const uncheckedId = entry('language', 42).canonicalModel;
    prefs = setModelsVisible(prefs, [hiddenId], 'language', false, first);
    const removed = createModelVisibilityCatalog(entries.filter(model => ![hiddenId, uncheckedId].includes(model.canonicalModel)));
    const afterRemoval = migrateModelVisibilityPreferences(prefs, removed);
    assert.ok(afterRemoval.knownModelIds.includes(hiddenId));
    assert.ok(afterRemoval.knownModelIds.includes(uncheckedId));
    const newcomer = entry('language', 50);
    const reappeared = createModelVisibilityCatalog([newcomer, ...entries]);
    const restored = migrateModelVisibilityPreferences(afterRemoval, reappeared);
    assert.equal(isModelVisible(restored, hiddenId, 'language', reappeared), false);
    assert.equal(isModelVisible(restored, uncheckedId, 'language', reappeared), false);
    assert.equal(isModelVisible(restored, newcomer.canonicalModel, 'language', reappeared), true);
    const reparsed = parseModelVisibilityPreferences(JSON.stringify(restored), undefined, reappeared);
    assert.deepEqual(reparsed, restored);
    assert.equal(isModelVisible(reparsed, uncheckedId, 'language', reappeared), false);
});

test('unknown own-API models stay visible after catalog initialization without inheriting author hides', () => {
    const index = createModelVisibilityCatalog(fixtures());
    let prefs = newModelVisibilityPreferences(index);
    prefs = setModelsVisible(prefs, [entry('language', 0).canonicalModel], 'language', false, index);
    for (const id of ['private-deployment', 'private/model-90', 'openai/custom-organization-model']) {
        assert.equal(isModelVisible(prefs, id, 'language', index), true, id);
    }
    const unknownHidden = setModelsVisible(prefs, ['private-deployment'], 'language', false, index);
    assert.equal(isModelVisible(unknownHidden, 'private-deployment', 'language', index), false);
    assert.equal(isModelVisible(unknownHidden, 'different-deployment', 'language', index), true);
});
