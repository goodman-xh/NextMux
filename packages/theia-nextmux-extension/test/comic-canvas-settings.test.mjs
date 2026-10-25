import test from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_SETTINGS_SPEC, DEFAULT_CANVAS_SETTINGS, CANVAS_SNAP_GRID_SIZE, normalizeCanvasSettings, canvasSettingsStorageKey }
    from '../lib/browser/nextmux-comic-canvas-settings.js';

test('settings declare a default, range/options and step for every preference', () => {
    assert.deepEqual(normalizeCanvasSettings(null), DEFAULT_CANVAS_SETTINGS);
    assert.deepEqual(normalizeCanvasSettings([]), DEFAULT_CANVAS_SETTINGS);
    assert.equal(Object.keys(DEFAULT_CANVAS_SETTINGS).length, 20);
    for (const [key, definition] of Object.entries(CANVAS_SETTINGS_SPEC)) {
        assert.equal(DEFAULT_CANVAS_SETTINGS[key], definition.default);
        if (definition.type === 'number') {
            assert.ok(definition.min <= definition.default && definition.default <= definition.max);
            assert.ok(definition.step > 0);
        } else assert.ok(definition.values.includes(definition.default));
    }
    assert.equal(DEFAULT_CANVAS_SETTINGS.submitDelaySeconds, 0);
    assert.equal(DEFAULT_CANVAS_SETTINGS.arrangeHorizontalSpacing, 100);
    assert.equal(DEFAULT_CANVAS_SETTINGS.arrangeVerticalSpacing, 110);
    assert.equal(DEFAULT_CANVAS_SETTINGS.groupPadding, 80);
    assert.equal(DEFAULT_CANVAS_SETTINGS.navigationSensitivity, 1);
    assert.equal(DEFAULT_CANVAS_SETTINGS.navigationShiftBoost, 2.5);
    assert.equal(CANVAS_SNAP_GRID_SIZE, 10);
    assert.notEqual(CANVAS_SNAP_GRID_SIZE, DEFAULT_CANVAS_SETTINGS.gridSpacing);
});

test('all numeric preferences clamp bounds, quantize steps and reject non-finite/string values', () => {
    for (const [key, definition] of Object.entries(CANVAS_SETTINGS_SPEC)) {
        if (definition.type !== 'number') continue;
        assert.equal(normalizeCanvasSettings({ [key]: -1e10 })[key], definition.min);
        assert.equal(normalizeCanvasSettings({ [key]: 1e10 })[key], definition.max);
        assert.equal(normalizeCanvasSettings({ [key]: definition.min + definition.step * 1.4 })[key],
            Number((definition.min + definition.step).toFixed(10)));
        for (const bad of [NaN, Infinity, -Infinity, '2', null]) {
            assert.equal(normalizeCanvasSettings({ [key]: bad })[key], definition.default);
        }
    }
});

test('normalization is immutable, excludes unknown/inherited preferences and respects grid-guide dependency', () => {
    const input = Object.freeze({ blankAreaAction: 'doubleClick', wheelAction: 'zoom', snapGrid: false, alignmentGuides: true,
        wireAnimation: true, minimap: true, notifyOnCompletion: false, submitDelaySeconds: 4.2, providerChannel: 'paid', clock: 60 });
    const normalized = normalizeCanvasSettings(input);
    assert.equal(normalized.blankAreaAction, 'doubleClick');
    assert.equal(normalized.wheelAction, 'zoom');
    assert.equal(normalized.alignmentGuides, false);
    assert.equal(normalized.wireAnimation, true);
    assert.equal(normalized.minimap, true);
    assert.equal(normalized.notifyOnCompletion, false);
    assert.equal(normalized.submitDelaySeconds, 4);
    assert.equal(Object.hasOwn(normalized, 'providerChannel'), false);
    assert.equal(Object.hasOwn(normalized, 'clock'), false);
    assert.equal(input.alignmentGuides, true);
    assert.deepEqual(normalizeCanvasSettings(normalized), normalized);
    assert.deepEqual(normalizeCanvasSettings(Object.create({ panSensitivity: 5 })), DEFAULT_CANVAS_SETTINGS);
    assert.equal(normalizeCanvasSettings({ blankAreaAction: 'click', wheelAction: 'scroll', wireAnimation: 1 }).wireAnimation, false);
});

test('storage keys isolate preferences by user and require an identity', () => {
    assert.notEqual(canvasSettingsStorageKey('user:a'), canvasSettingsStorageKey('user%3Aa'));
    assert.notEqual(canvasSettingsStorageKey('user:a'), canvasSettingsStorageKey('user:b'));
    assert.equal(canvasSettingsStorageKey('user a').includes('user%20a'), true);
    assert.throws(() => canvasSettingsStorageKey(' '), /user ID/);
});
