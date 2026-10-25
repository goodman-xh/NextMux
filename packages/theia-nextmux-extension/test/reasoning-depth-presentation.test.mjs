import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { declaredReasoningSettings, reasoningDepthChoices } from '../lib/common/nextmux-model-controls.js';

// This module deliberately has no runtime dependencies on model detection or
// request dispatch. Exercise its source without changing those shared paths.
const source = readFileSync(new URL('../src/browser/nextmux-reasoning-depth-presentation.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { reasoningDepthChoicesForDisplay, reasoningSwitchEnabledDefault } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const choice = (id, label, settings = {}, evidence) => Object.freeze({ id, label, settings: Object.freeze(settings), ...(evidence ? { evidence } : {}) });

test('the coding display preserves resolved depth identities, order, evidence and defaults', () => {
    const off = choice('enabled:false', 'off', { reasoningEnabled: false });
    const low = choice('effort:low', 'low', {}, 'verified');
    const high = choice('budget:24576', 'high', { reasoningBudgetTokens: 24576 }, 'accepted');
    const on = choice('enabled:true', 'on', { reasoningEnabled: true });
    const original = Object.freeze({ options: Object.freeze([off, low, high, on]), defaultId: low.id });
    const displayed = reasoningDepthChoicesForDisplay(original);
    assert.deepEqual(displayed.options, [low, high]);
    assert.equal(displayed.options[0], low);
    assert.equal(displayed.options[1], high);
    assert.equal(displayed.defaultId, low.id);
    assert.deepEqual(original.options, [off, low, high, on]);
});

test('switch-only controls disappear without enabling them or rewriting their default', () => {
    const off = choice('enabled:false', 'off', { reasoningEnabled: false });
    const on = choice('enabled:true', 'on', { reasoningEnabled: true });
    const original = Object.freeze({ options: Object.freeze([off, on]), defaultId: off.id });
    assert.deepEqual(reasoningDepthChoicesForDisplay(original), { options: [] });
    assert.equal(original.defaultId, 'enabled:false');
    assert.equal(original.options[0].settings.reasoningEnabled, false);
});

test('a hidden off default never marks an arbitrary visible depth as selected', () => {
    const off = choice('effort:none', 'off');
    const low = choice('effort:low', 'low');
    const high = choice('effort:high', 'high');
    assert.deepEqual(reasoningDepthChoicesForDisplay({ options: [off, low, high], defaultId: off.id }), { options: [low, high] });
    assert.deepEqual(reasoningDepthChoicesForDisplay({ options: [off, high], defaultId: off.id }), { options: [] });
});

test('adaptive alone and already-empty choices have no depth selector', () => {
    const adaptive = choice('mode:adaptive', 'auto', { reasoningMode: 'adaptive' });
    const original = { options: [choice('mode:disabled', 'off'), adaptive, choice('mode:enabled', 'on')], defaultId: adaptive.id };
    assert.deepEqual(reasoningDepthChoicesForDisplay(original), { options: [] });
    assert.equal(original.defaultId, adaptive.id);
    assert.deepEqual(reasoningDepthChoicesForDisplay({ options: [] }), { options: [] });
});

test('the frontend default reuses only an already-eligible switch enable option', () => {
    const declared = { support: 'supported', source: 'provider_metadata', scope: 'route' };
    for (const control of [
        { ...declared, type: 'on-off', parameter: 'enable_thinking', values: [true, false], default: false },
        { ...declared, type: 'on-off', parameter: 'thinking.type', values: ['enabled', 'disabled'], default: 'disabled' }
    ]) {
        const resolved = reasoningDepthChoices({ reasoningControls: [control] });
        const before = structuredClone(resolved);
        const enabled = reasoningSwitchEnabledDefault(resolved);
        assert.equal(enabled, resolved.options.find(option => option.label === 'on'));
        assert.ok(enabled);
        assert.deepEqual(enabled.settings, control.parameter === 'enable_thinking' ? { reasoningEnabled: true } : { reasoningMode: 'enabled' });
        assert.deepEqual(resolved, before, 'finding a default does not apply it or rewrite model evidence');
        const rejected = reasoningDepthChoices({ reasoningControls: [control] }, { [enabled.id]: 'rejected' });
        assert.equal(reasoningSwitchEnabledDefault(rejected), undefined, 'a refused enable option must not be restored');
    }
});

test('enable defaults never replace real depths, adaptive choices, disabled-only or unknown support', () => {
    const on = choice('enabled:true', 'on', { reasoningEnabled: true });
    assert.equal(reasoningSwitchEnabledDefault({ options: [on, choice('effort:high', 'high')] }), undefined);
    assert.equal(reasoningSwitchEnabledDefault({ options: [on, choice('mode:adaptive', 'auto')] }), undefined);
    assert.equal(reasoningSwitchEnabledDefault({ options: [choice('enabled:false', 'off')] }), undefined);
    assert.equal(reasoningSwitchEnabledDefault({ options: [] }), undefined);
});

test('comic requests preserve their existing defaults while coding retains its eligible enable default', () => {
    const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'reasoningSettingsForRoute');
    assert.ok(method);
    const Harness = new Function('declaredReasoningSettings', 'reasoningSwitchEnabledDefault',
        ts.transpile(`class Harness { ${method.getText(file)} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
        declaredReasoningSettings, reasoningSwitchEnabledDefault);
    const contract = { reasoningControls: [{ support: 'supported', source: 'provider_metadata', scope: 'route',
        type: 'on-off', parameter: 'enable_thinking', values: [true, false], default: false }] };
    const route = { id: 'route' };
    const session = { routeId: route.id };
    const h = Object.assign(new Harness(), {
        activeCodingSession: () => session, modelKeyForRoute: () => 'model', reasoningSettingsByModel: {},
        modelReasoningContract: () => contract, reasoningDepthChoicesForRoute: () => reasoningDepthChoices(contract)
    });
    assert.deepEqual(h.reasoningSettingsForRoute(route), { reasoningEnabled: true });
    assert.deepEqual(h.reasoningSettingsForRoute(route, false), {}, 'comic leaves the provider default untouched');
    for (const explicit of [true, false]) {
        session.reasoningSettings = { reasoningEnabled: explicit };
        assert.deepEqual(h.reasoningSettingsForRoute(route, false), { reasoningEnabled: explicit });
        assert.deepEqual(h.reasoningSettingsForRoute(route), { reasoningEnabled: explicit });
    }
    delete session.reasoningSettings;
    h.reasoningSettingsByModel.model = { reasoningEnabled: true };
    assert.deepEqual(h.reasoningSettingsForRoute(route, false), { reasoningEnabled: true }, 'comic keeps an existing saved model preference');
});
