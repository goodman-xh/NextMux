import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { measuredModelFidelity, measuredRelayQuality } from '../lib/common/nextmux-relay-evidence.js';
import { declaredReasoningEfforts, reasoningControlField, reasoningDepthChoices } from '../lib/common/nextmux-model-controls.js';
import { reasoningOptionKey } from '@nextmux/model-runtime/reasoning-evidence';
import { reasoningControlText } from '../lib/browser/nextmux-reasoning-controls-locale.js';
import { reasoningDepthChoicesForDisplay } from '../lib/browser/nextmux-reasoning-depth-presentation.js';
import { modelPickerEvidenceText, relayMultiplierTag, relayMultiplierText, relayPercentText } from '../lib/browser/nextmux-relay-picker.js';
import * as offeringPrice from '../lib/browser/nextmux-offering-price.js';
import { protocolSupportsReasoningEffort } from '@nextmux/model-runtime/capabilities';
import { relayText } from '../lib/browser/nextmux-relay-locale.js';
import { contextWindowChoices, contextWindowTokenLabel, normalizeContextWindowTokens, effectiveContextWindowTokens } from '../lib/common/nextmux-context-budget.js';
import { contextBudgetText } from '../lib/browser/nextmux-context-budget-locale.js';
import { ModelTaxonomyTags } from '../lib/browser/nextmux-model-taxonomy-tags.js';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const render = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'renderCodingWorkbench');
const declaration = render.body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(value => value.name.getText(file) === 'renderModelPickerOption'));
assert.ok(declaration, 'exercise the production row renderer, not a separately reimplemented component');
const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React });
const method = name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
const modelReasoningContract = method('modelReasoningContract');
const reasoningEffortLevels = method('reasoningEffortLevels');
assert.ok(modelReasoningContract && reasoningEffortLevels, 'exercise the production model reasoning contract');
const depthMethods = ['reasoningDepthChoicesForRoute', 'activeReasoningDepthId', 'reasoningDepthLabel'].map(name => method(name).getText(file)).join('\n');
const ReasoningHarness = new Function('declaredReasoningEfforts', 'protocolSupportsReasoningEffort', 'reasoningDepthChoices', 'reasoningOptionKey', 'reasoningControlText',
    compile(`class ReasoningHarness { ${modelReasoningContract.getText(file)} ${reasoningEffortLevels.getText(file)} ${depthMethods}
      localReasoningEvidence() { return undefined; } reasoningSettingsForRoute() { return {}; } }; return ReasoningHarness;`))
    (declaredReasoningEfforts, protocolSupportsReasoningEffort, reasoningDepthChoices, reasoningOptionKey, reasoningControlText);
const createRenderer = new Function('React', 'ReactDOM', 'document', 'modelRouteById', 'modelPickerRelayKey',
    'measuredModelFidelity', 'measuredRelayQuality', 'modelPickerEvidenceText', 'relayMultiplierText', 'relayMultiplierTag', 'relayPercentText', 'relayText', 'runningTaskText',
    'contextWindowChoices', 'contextWindowTokenLabel', 'normalizeContextWindowTokens', 'effectiveContextWindowTokens', 'contextBudgetText', 'reasoningControlField',
    'priceVariantRoutes', 'OfferingPriceCard', 'offeringIsOwnPriced', 'offeringMultiplierBps', 'offeringPriceText', 'reasoningControlText', 'reasoningDepthChoicesForDisplay', 'ModelTaxonomyTags',
    compile(`${declaration.getText(file)}; return renderModelPickerOption;`));
function* elements(value) {
    if (Array.isArray(value)) { for (const child of value) yield* elements(child); return; }
    if (!React.isValidElement(value)) return;
    yield value; yield* elements(value.props.children);
}
const model = { id: 'provider/model', label: 'Synthetic model', sourceName: 'Synthetic relay' };
function fixture(route) {
    const context = Object.assign(new ReasoningHarness(), {
        desktopLocale: 'en', selectedModelIds: { coding: '' }, modelPickerEffortModelId: '',
        modelPickerEffortPlacement: { side: 'right', top: 50, left: 300, maxHeight: 200 },
        calls: [], reasoningEffortLevels: () => [], reasoningEffortForRoute: () => undefined, resolvedDesktopTheme: () => 'dark',
        modelContextWindowTokens: () => undefined,
        contextWindowForRoute() { return this.contextWindowTokens; },
        fitModelEffortMenu() {},
        setModelOptionReasoningDepth(...args) { this.calls.push({ depth: args }); },
        openModelEffortPicker(id, anchor, count) { this.calls.push({ id, anchor, count }); this.modelPickerEffortModelId = id; },
        scheduleModelEffortPickerClose() {}, cancelModelEffortPickerClose() {}, update() {},
        selectModelOptionOnRelay(...args) { this.calls.push({ select: args }); },
        completeNavigationSurface() { this.calls.push({ close: true }); }
    });
    const render = createRenderer.call(context, React, { createPortal: node => node }, { body: {} },
        new Map(route ? [[model.id, route]] : []), 'managed:source', measuredModelFidelity, measuredRelayQuality,
        modelPickerEvidenceText, relayMultiplierText, relayMultiplierTag, relayPercentText, relayText, (_locale, key) => key,
        contextWindowChoices, contextWindowTokenLabel, normalizeContextWindowTokens, effectiveContextWindowTokens, contextBudgetText, reasoningControlField,
        new Map(), offeringPrice.OfferingPriceCard, offeringPrice.offeringIsOwnPriced, offeringPrice.offeringMultiplierBps, offeringPrice.offeringPriceText, reasoningControlText, reasoningDepthChoicesForDisplay, ModelTaxonomyTags);
    return { context, render };
}

test('model rows show only model names while hover and keyboard focus reveal three honest source-specific metrics', () => {
    const route = { kind: 'managed_gateway', offering: { likes: 3, dislikes: 1, fidelity: { index: 0, sampleCount: 0 },
        multiplierBps: 10000, keyPriceQuoteId: 'quote-one', keyPrice: { selectedMultiplierBps: 12500 } } };
    const { context, render } = fixture(route);
    const row = render(model, true);
    let tree = [...elements(row)];
    const button = tree.find(node => node.type === 'button');
    assert.equal(tree.filter(node => node.type === 'em').length, 0);
    assert.deepEqual(tree.filter(node => node.type === 'strong').map(node => node.props.children), ['Synthetic model']);
    assert.match(button.props['aria-label'], /Model authenticity: —.*Quality: (?:75|98%).*Multiplier: 1\.25×/);
    for (const event of ['onPointerEnter', 'onFocus']) {
        row.props[event]({ currentTarget: 'anchor' });
        assert.deepEqual(context.calls.at(-1), { id: model.id, anchor: 'anchor', count: 0 });
    }
    tree = [...elements(render(model, true))];
    // A relay route's multiplier moves into its price card (官方报价 / 当前倍率 / 中转商报价) instead of a third row.
    assert.deepEqual(tree.filter(node => node.type === 'dt').map(node => node.props.children), ['Model authenticity', 'Quality']);
    // Quality is a share of votes: shown with its "%", never a bare number.
    assert.deepEqual(tree.filter(node => node.type === 'dd').map(node => node.props.children), ['—', '98%']);
    assert.deepEqual(tree.filter(node => node.type === 'dd').map(node => node.props['data-unmeasured']), [true, undefined]);
    assert.equal(tree.find(node => node.type === offeringPrice.OfferingPriceCard)?.props.offering, route.offering);
    button.props.onClick({ currentTarget: { closest: () => 'anchor' } });
    // No price variant: the model's first route (no pinned route id).
    assert.deepEqual(context.calls.find(call => call.select).select, [model.id, 'coding', 'managed:source', { id: 'quote-one' }, undefined]);
});

test('discovered but unpublished models can be focused for details but cannot select or dispatch a route', () => {
    const { context, render } = fixture();
    const discovered = { ...model, listingPending: true, discoveredMultiplierBps: 15000 };
    let row = render(discovered, false);
    const button = [...elements(row)].find(node => node.type === 'button');
    assert.equal(button.props['aria-disabled'], true);
    assert.equal(button.props.disabled, undefined, 'keyboard users can inspect why a cached model is unavailable');
    button.props.onClick({ currentTarget: {} });
    assert.equal(context.calls.length, 0);
    row.props.onFocus({ currentTarget: 'anchor' });
    row = render(discovered, false);
    assert.deepEqual([...elements(row)].filter(node => node.type === 'dd').map(node => node.props.children), ['—', '—', '1.5×']);
    assert.equal([...elements(row)].find(node => node.props.className === 'nmx-model-evidence-note').props.children, 'Not yet published for use');
});

test('personal API identity and quality stay unknown instead of inheriting another merchant’s metrics', () => {
    const { render } = fixture({ kind: 'official_connection', connection: { label: 'Own API', status: 'verified' } });
    const button = [...elements(render(model, true))].find(node => node.type === 'button');
    assert.match(button.props['aria-label'], /Model authenticity: —.*Quality: —.*Multiplier: —/);
});

test('detached model evidence portal owns its locale and writing direction', () => {
    for (const locale of ['en', 'zh-CN', 'de', 'ar']) {
        const { context, render } = fixture();
        context.desktopLocale = locale;
        context.modelPickerEffortModelId = model.id;
        const portal = [...elements(render(model, false))].find(node => node.props.className?.includes('nmx-model-effort-portal'));
        assert.equal(portal.props.dir, locale === 'ar' ? 'rtl' : 'ltr');
        assert.equal(portal.props.lang, locale);
    }
});

test('pointer and keyboard placement include the thinking-depth row and the route context fact', () => {
    const { context, render } = fixture({ kind: 'managed_gateway', offering: { keyPriceQuoteId: 'quote-context' } });
    context.reasoningEffortLevels = () => ['low', 'high'];
    context.reasoningEffortForRoute = () => 'low';
    context.reasoningEffortLabel = value => value;
    context.modelContextWindowTokens = () => 128000;
    context.contextWindowTokens = 32000;
    context.setModelOptionContextWindow = (...args) => context.calls.push({ context: args });
    const row = render(model, true);
    for (const event of ['onPointerEnter', 'onFocus']) {
        row.props[event]({ currentTarget: 'anchor' });
        // Card rows for placement: depth caption + row (2), window caption + one row of three tiers (2).
        assert.deepEqual(context.calls.at(-1), { id: model.id, anchor: 'anchor',
            count: 4 });
    }
    const tree = [...elements(render(model, true))];
    // One thinking-depth row whatever the API's parameter is; the current choice is marked.
    const depth = tree.filter(node => node.props['data-reasoning-depth']);
    assert.deepEqual(depth.map(node => node.props['data-reasoning-depth']), ['effort:low', 'effort:high']);
    assert.deepEqual(depth.map(node => node.props['aria-checked']), [true, false]);
    assert.deepEqual(depth.map(node => node.props.children), ['Low', 'High']);
    depth[1].props.onClick();
    assert.deepEqual(context.calls.at(-1).depth.slice(0, 3).map(value => value?.id ?? value), [model.id, 'effort:high', 'coding']);
    const contextButtons = tree.filter(node => node.props['data-context-window'] !== undefined);
    assert.deepEqual(contextButtons.map(node => node.props['data-context-window']), [32000, 64000, 128000]);
    assert.deepEqual(contextButtons.map(node => node.props['aria-checked']), [true, false, false]);
    assert.deepEqual(contextButtons.map(node => node.props.children), ['32K', '64K', '128K']);
    contextButtons[2].props.onClick();
    assert.deepEqual(context.calls.at(-1).context.slice(0, 3), [model.id, 128000, { id: 'quote-context' }]);
    assert.equal(tree.some(node => node.type === 'input' || node.type === 'select'), false, 'no free-form or dropdown thinking controls');
    assert.deepEqual(tree.filter(node => node.type === 'dt').map(node => node.props.children), ['Model authenticity', 'Quality']);
    assert.equal(tree.some(node => node.props.className === 'nmx-model-context-readonly'), false);
});


test('models without declared capacity or effort omit both option sections', () => {
    const { context, render } = fixture({ kind: 'official_connection', connection: { label: 'Own API' } });
    context.modelPickerEffortModelId = model.id;
    const tree = [...elements(render(model, true))];
    assert.equal(tree.some(node => node.props['data-context-window'] !== undefined), false);
    assert.equal(tree.some(node => node.props['data-reasoning-depth'] !== undefined), false);
    assert.equal(tree.some(node => node.type === 'input'), false);
    assert.equal(tree.some(node => node.props.className === 'nmx-model-effort-caption'), false);
});

test('the production picker hides a switch-only depth section and removes off from real depth choices', () => {
    const declared = { support: 'supported', source: 'provider_metadata', scope: 'route' };
    const route = { kind: 'managed_gateway', offering: {
        reasoningControls: [{ ...declared, type: 'on-off', parameter: 'enable_thinking', values: [true, false], default: false }]
    } };
    const { context, render } = fixture(route);
    context.modelPickerEffortModelId = model.id;
    let tree = [...elements(render(model, true))];
    assert.equal(tree.some(node => node.props.className === 'nmx-model-effort-caption'), false);
    assert.equal(tree.some(node => node.props.role === 'radiogroup'), false);
    assert.equal(tree.some(node => node.props['data-reasoning-depth'] !== undefined), false);
    assert.deepEqual(context.reasoningDepthChoicesForRoute(route).options.map(option => option.label), ['off', 'on'], 'raw model choices remain unchanged');

    context.reasoningEffortLevels = () => ['none', 'low', 'high'];
    context.reasoningEffortForRoute = () => 'low';
    tree = [...elements(render(model, true))];
    const buttons = tree.filter(node => node.props['data-reasoning-depth']);
    assert.deepEqual(buttons.map(node => node.props['data-reasoning-depth']), ['effort:low', 'effort:high']);
    assert.deepEqual(buttons.map(node => node.props['aria-checked']), [true, false]);
    assert.deepEqual(context.reasoningDepthChoicesForRoute(route).options.map(option => option.id), ['effort:none', 'effort:low', 'effort:high']);
});

test('actual effort selector requires exact declared metadata, never model-name inference', () => {
    const current = new ReasoningHarness();
    const connection = { providerId: 'custom_openai', protocol: 'openai_chat_completions', model: 'gpt-6-astra', modelFamily: 'GPT-6 Astra', discoveredModels: [] };
    const route = { kind: 'official_connection', connection };
    assert.deepEqual(current.reasoningEffortLevels(route), []);
    connection.discoveredModels = [{ id: 'another', reasoningEfforts: ['low', 'high'] }];
    assert.deepEqual(current.reasoningEffortLevels(route), []);
    connection.discoveredModels = [{ id: 'gpt-6-astra', reasoningEfforts: ['high'] }];
    assert.deepEqual(current.reasoningEffortLevels(route), ['high']);
    connection.protocol = 'media';
    assert.deepEqual(current.reasoningEffortLevels(route), []);
    assert.deepEqual(current.reasoningEffortLevels({ kind: 'managed_gateway', offering: { capabilities: ['reasoning'] } }), []);
});

test('a route that rejected long requests shows its measured limit under the window facts', () => {
    const { context, render } = fixture({ kind: 'managed_gateway', offering: { keyPriceQuoteId: 'quote-cap' } });
    context.rawModelContextWindowTokens = () => 1_048_576;
    context.learnedRouteContextCap = () => 131_072;
    context.modelContextWindowTokens = () => 131_072;
    const row = render(model, true);
    row.props.onPointerEnter({ currentTarget: 'anchor' });
    const tree = [...elements(render(model, true))];
    assert.deepEqual(tree.filter(node => node.props['data-context-window'] !== undefined).map(node => node.props.children), ['32K', '64K', '128K'],
        'only sizes the route really accepted are offered');
    const note = tree.find(node => node.props.className === 'nmx-model-context-learned');
    assert.ok(note, 'the measured limit is explained');
    assert.match(String([...elements(note)].find(node => node.type === 'span').props.children), /stays within 128K\./);
    context.learnedRouteContextCap = () => undefined;
    context.modelContextWindowTokens = () => 1_048_576;
    assert.equal([...elements(render(model, true))].some(node => node.props.className === 'nmx-model-context-learned'), false, 'no note without a measured limit');
});
