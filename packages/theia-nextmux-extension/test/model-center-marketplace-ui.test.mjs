import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { desktopText } from '../lib/browser/nextmux-locale.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';
import { modelUsageText } from '../lib/browser/nextmux-model-usage-locale.js';
import { modelCenterText } from '../lib/browser/nextmux-model-center-locale.js';
import { MODEL_CENTER_CATEGORIES, modelCenterFilterLabel, modelCenterRating } from '../lib/browser/nextmux-model-center-merchants.js';
import { relayMultiplierTag, relayPercentText } from '../lib/browser/nextmux-relay-picker.js';

const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const directory = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-model-center-merchants.tsx', import.meta.url)), 'utf8');
const directoryStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-model-center.css', import.meta.url)), 'utf8');
const locale = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-locale.ts', import.meta.url)), 'utf8');
const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
const officialQaRoute = readFileSync(fileURLToPath(new URL('../../../scripts/desktop-official-qa-route.mjs', import.meta.url)), 'utf8');

test('quality relay view uses public merchant totals and one shared directory rather than offering/model counts', () => {
    assert.match(widget, /const showOfficial = this\.modelCenterView === 'official'/);
    assert.match(widget, /\(showMarketplace \|\| showFavorites\) && <ModelCenterMerchants/);
    assert.match(widget, /modelCenterMerchantCount = page\.totalCount/);
    assert.doesNotMatch(widget, /data-model-center-view='(?:relays|verification)'|rankRelayMarketplace\(/);
    assert.match(directory, /service\.getPublicMerchantDirectory\(/);
    assert.match(directoryStyle, /\.nmx-mc-merchant/);
});

test('model-center favorites reuse the conversation picker store and the same merchant component', () => {
    assert.match(widget, /favorites=\{\[\.\.\.this.favoriteMerchantLabels\]\}/);
    assert.match(widget, /onFavorite=\{\(id, name\) => this.toggleFavoriteMerchantById\(id, name\)\}/);
    assert.match(widget, /RELAY_FAVORITES_STORAGE_KEY/);
    assert.match(directory, /data-model-center-favorite=\{merchant.id\}/);
    assert.match(directory, /loadModelCenterFavorites/);
});

test('model-center search retains merchant lookup while the source-scoped model picker stays lightweight', () => {
    assert.match(locale, /searchModels: 'Search models or merchant ID'/);
    assert.match(locale, /searchModels: '搜索模型或商家编号'/);
    assert.match(locale, /allModels: 'Quality relays'/);
    assert.match(locale, /allModels: '优质中转'/);
    assert.match(widget, /publicCode/);
    assert.doesNotMatch(directory, /relayMerchantNumber/);
    assert.doesNotMatch(widget, /modelMerchantNumber/);
    // The model list is searchable now that it shows everything the chosen API can run (2026-09-29).
    assert.match(widget, /className='nmx-model-picker-search'[\s\S]{0,200}<ImeInput/);
    assert.match(widget, /className='nmx-composer-popover nmx-route-popover nmx-model-picker-popover nmx-model-only-popover'/);
    assert.match(widget, /const modelOptions = this\.activeRelayKey[\s\S]*?this\.codingModelOptions\(this\.activeRelayKey\)[\s\S]*?: \[\];/);
    assert.match(widget, /data=\{pickerRows\}/);
    assert.doesNotMatch(widget, /<em>\{unavailableReasonText\}<\/em>/);
    assert.match(widget, /<button aria-disabled=\{!supported\}/);
    assert.match(widget, /data-capability-gate=\{supported \? 'verified_generation_and_tools' : model\.listingPending \? 'listing_pending' : unavailableReason\}/);
});

test('composer model trigger always owns the compact model picker, including before a source is selected', () => {
    const codingWorkbench = widget.slice(widget.indexOf('protected renderCodingWorkbench()'), widget.indexOf('protected renderScheduleDialog('));
    const modelTrigger = codingWorkbench.slice(codingWorkbench.indexOf("<button className={`nmx-route-button"), codingWorkbench.indexOf("<button className='nmx-mic-button'"));
    assert.match(modelTrigger, /onClick=\{\(\) => this\.toggleCodingPopover\('routes'\)\}/);
    assert.doesNotMatch(modelTrigger, /activeRelayKey|toggleComposerRelayPicker/);
    assert.match(codingWorkbench, /codingPopover === 'routes' && !this\.modelPickerRelayOpen[\s\S]*?nmx-model-only-popover/);
    assert.match(codingWorkbench, /this\.activeRelayKey \? 'noSourceModels' : 'chooseSourceFirst'/);
    assert.doesNotMatch(modelTrigger, /打开模型中心|openModelCenter/);
    // The only Model Center link inside the picker is the fix path for a rejected API key.
    for (const match of codingWorkbench.matchAll(/relayText\(this\.desktopLocale, 'openModelCenter'\)/g)) {
        assert.match(codingWorkbench.slice(Math.max(0, match.index - 260), match.index), /officialPickerAuthFailures\.has/);
    }
    const relayTrigger = codingWorkbench.slice(codingWorkbench.indexOf("data-relay-trigger='composer'"), codingWorkbench.indexOf("<button className={`nmx-route-button"));
    assert.match(relayTrigger, /toggleComposerRelayPicker\(\)/);
});

test('initial rating with zero feedback samples defaults to 100% score until someone votes', () => {
    const quality = { state: 'pending', reason: 'no_feedback', sampleCount: 0 };
    assert.deepEqual(modelCenterRating({ id: 'merchant', name: 'Synthetic', measurement: { quality } }), { value: 100, initial: true, samples: 0 });
    assert.deepEqual(modelCenterRating({ id: 'merchant', name: 'Synthetic', measurement: { quality: { state: 'pending', reason: 'no_feedback' } } }), { value: 100, initial: true, samples: 0 });
    assert.deepEqual(modelCenterRating({ id: 'merchant', name: 'Synthetic' }), { value: 100, initial: true, samples: 0 });
    assert.deepEqual(modelCenterRating({ id: 'merchant', name: 'Synthetic', metrics: { quality: 0 }, measurement: { quality: { state: 'measured', sampleCount: 9 } } }), { value: 0, initial: false, samples: 9 });
    assert.deepEqual(modelCenterRating({ id: 'merchant', name: 'Synthetic', metrics: { quality: 100 }, measurement: { quality: { state: 'pending', reason: 'awaiting_samples', sampleCount: 0 } } }), { value: 100, initial: true, samples: 0 });
    assert.match(directory, /merchant.apiStatus\?\.state/);
});

test('measured percentages keep at most one decimal and a missing multiplier never reads "—×"', () => {
    assert.equal(relayPercentText('en', 200 / 3), '66.7%');
    assert.equal(relayPercentText('en', 100), '100%');
    assert.equal(relayPercentText('zh-CN', 87.5), '87.5%');
    for (const missing of [undefined, Number.NaN, -1, 101]) assert.equal(relayPercentText('en', missing), '—');
    assert.equal(relayMultiplierTag('en', 12_500), '1.25×');
    assert.equal(relayMultiplierTag('en', 250), '0.03×');
    assert.equal(relayMultiplierTag('en', 6_666), '0.67×');
    assert.equal(relayMultiplierTag('en', 1), '<0.01×', 'a paid quote never reads as free');
    for (const missing of [undefined, null, 1.5, -10]) assert.equal(relayMultiplierTag('en', missing), '');
    assert.doesNotMatch(widget, /`\$\{relayMultiplierText\([^`]*\)\}×`/, 'every multiplier with its × goes through relayMultiplierTag');
    assert.doesNotMatch(widget, /\$\{option\.(quality|authenticity)\}%/, 'the drawer formats its percentages');
    assert.match(directoryStyle, /strong\[data-unmeasured\]/);
});

test('remaining model identity detail never presents the neutral compatibility score as measured', () => {
    assert.equal(widget.split("offering.fidelity.sampleCount > 0 ? `${offering.fidelity.index}%` : '—'").length - 1, 1);
    assert.doesNotMatch(widget, /<strong>\{offering.fidelity.index\}%<\/strong>/);
});

test('relay metrics keep one final rule set without dead text-label styles', () => {
    assert.equal((style.match(/\.nmx-relay-merchant-metrics\s*>\s*span\s*\{/g) || []).length, 1);
    assert.equal((style.match(/\.nmx-purchase-metrics\s*>\s*span\s*\{/g) || []).length, 1);
    assert.doesNotMatch(style, /\.nmx-(?:relay-merchant|purchase)-metrics[^,{]*small/);
    assert.match(style, /\.nmx-relay-merchant-metrics > span \{[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;/);
    assert.match(style, /\.nmx-purchase-metrics > span \{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*17px minmax\(0, 1fr\);/);
    assert.doesNotMatch(widget, /PlatformOffering\s*&\s*\{/);
});

test('workbench navigation uses the native titlebar and relay selection sits beside the model control', () => {
    assert.match(widget, /<div className='nmx-titlebar-drag-region' aria-hidden='true'><\/div>[\s\S]*?<div className='nmx-titlebar-actions'/);
    assert.match(widget, /<div className='nmx-titlebar-actions' aria-label='窗口导航'/);
    assert.doesNotMatch(widget, /activeSection === 'settings' && <div className='nmx-titlebar-actions'/);
    assert.match(widget, /item\('models',[\s\S]*?item\('coding',[\s\S]*?item\('comic'/);
    assert.doesNotMatch(widget, /nmx-titlebar-relay|data-relay-trigger='titlebar'/);
    assert.match(widget, /className=\{`nmx-composer-relay-button[\s\S]*?data-relay-trigger='composer'[\s\S]*?<button className=\{`nmx-route-button/);
    // Comics choose a model per step; the studio header keeps one “AI 模型” entry (a relay for every step
    // and each step's model), not a relay menu and a model menu of its own.
    assert.doesNotMatch(widget, /nmx-comic-relay-button|data-relay-trigger='comic'|nmx-comic-model-button|renderComicModelControls/);
    assert.match(widget, /<div className='nmx-studio-header-actions'>\s*(?:\{project && [^\n]*renderComicDeskButton\(project\)\}\s*)?\{this\.renderComicModelButton\(\)\}/);
    assert.match(officialQaRoute, /document\.querySelector\('\[data-relay-trigger="composer"\]'\)/);
    assert.doesNotMatch(widget, /renderWorkspaceTopbarNavigation|nmx-workspace-topbar-navigation|nmx-topbar-relay-anchor/);
    assert.match(widget, /protected renderRelayPopover\([\s\S]*?\): React\.ReactNode/);
    const relayPopover = widget.slice(
        widget.indexOf('protected renderRelayPopover('),
        widget.indexOf('protected renderContextAccountDock()')
    );
    assert.doesNotMatch(relayPopover, /aria-label=['\"]关闭['\"]/);

    const modelCenterTopbar = widget.slice(
        widget.indexOf("<header className='nmx-workspace-topbar nmx-model-center-topbar'>"),
        widget.indexOf("<div className='nmx-workspace-scroll nmx-model-center'>")
    );
    assert.match(modelCenterTopbar, /nmx-platform-state[\s\S]*?renderAutomaticRelaySwitch[\s\S]*?nmx-wallet-chip[\s\S]*?登录\/注册/);
    assert.doesNotMatch(modelCenterTopbar, /nmx-my-apis-button/);
    assert.doesNotMatch(modelCenterTopbar, /catalogConnected|目录已连接/);
    assert.match(widget, /data-official-action='add-api'/);
    assert.match(widget, /data-official-field='provider-preset'/);
    assert.match(widget, /renderOfferingSheet[\s\S]*?>登录\/注册<\/button>/);

    assert.match(widget, /protected toggleComposerRelayPicker\(\): void[\s\S]*?this\.modelPickerRelayOpen = true/);
    assert.match(widget, /nmx-model-picker-relay-view[\s\S]*?renderRelayPopover\(\)/);
    assert.match(widget, /protected selectRelay\([\s\S]*?this\.modelPickerRelayOpen = false;[\s\S]*?this\.codingPopover = '';/);
    assert.match(style, /\.nmx-model-picker-popover > \.nmx-model-picker-relay-view\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow:\s*hidden/);
    assert.match(style, /\.nmx-model-picker-relay-view > \.nmx-relay-popover\s*\{[\s\S]*?position:\s*static;[\s\S]*?width:\s*100%/);
    assert.match(style, /\.nmx-relay-popover\s*\{[\s\S]*?width:\s*min\(264px/);
    assert.match(style, /\.nmx-model-context-nav\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(style, /body\.mac \.nmx-titlebar-drag-region\s*\{[\s\S]*?-webkit-app-region:\s*drag/);
    assert.match(style, /body\.mac \.nmx-titlebar-actions\s*\{\s*left:\s*78px/);
    assert.doesNotMatch(style, /nmx-titlebar-relay/);
    assert.match(style, /@container nmx-composer-width \(max-width: 440px\) \{[\s\S]*?\.nmx-composer \.nmx-composer-relay-button[\s\S]*?width:\s*31px/);
    assert.match(style, /@media \(max-width:\s*1160px\)\s*\{[\s\S]*?\.nmx-comic-agent-controls\s*\{[\s\S]*?grid-template-columns:\s*29px minmax\(0, 1fr\) 34px/);
    assert.match(style, /@media \(max-width:\s*1120px\)\s*\{[\s\S]*?\.nmx-titlebar-primary-nav button span\s*\{\s*display:\s*none/);
});

test('model-center navigation renders the original text in one column, without decorative icons', () => {
    const parsed = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let method;
    const visit = node => {
        if (ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'renderContextPanel') method = node.getText(parsed);
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    assert.ok(method);
    const Harness = new Function('React', 'localizeDesktopSurface', 'modelUsageText', 'modelCenterText', 'ImeInput', 'ImeTextarea', 'MODEL_CENTER_CATEGORIES', 'modelCenterFilterLabel', ts.transpile(`class Harness { ${method} }; return Harness;`, {
        jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022
    }))(React, localizeDesktopSurface, modelUsageText, modelCenterText, 'input', 'textarea', MODEL_CENTER_CATEGORIES, modelCenterFilterLabel);
    const rows = node => React.Children.toArray(node.props.children);
    const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    for (const locale of locales) {
        const harness = Object.assign(new Harness(), {
            activeSection: 'models', modelSearchQuery: '', modelCenterView: 'all', modelCapabilityFilter: 'all',
            desktopLocale: locale,
            platformCatalog: { offerings: [] }, officialModels: { providers: [] },
            favoriteMerchantLabels: new Map(),
            tx: key => desktopText(locale, key), renderContextAccountDock: () => null
        });
        const nav = rows(harness.renderContextPanel()).find(node => node.props.className === 'nmx-context-nav nmx-model-context-nav');
        const items = rows(nav);
        assert.deepEqual(items.filter(node => node.type === 'p').map(node => node.props.children), [
            desktopText(locale, 'browse'), localizeDesktopSurface(locale, '记录'), modelCenterText(locale, 'categories'), desktopText(locale, 'capabilities')
        ]);
        // Categories use the shared taxonomy's words (3D models are their own browse bucket); tool support is a
        // capability, listed apart (never a category).
        const filters = items.filter(node => node.props['data-model-capability']);
        const expectedFilters = ['all', 'reasoning', '3d', 'image', 'video', 'audio', 'coding'];
        assert.deepEqual(filters.map(node => node.props['data-model-capability']), expectedFilters, locale);
        assert.deepEqual(filters.map(node => node.props.title), expectedFilters.map(filter => modelCenterFilterLabel(locale, filter)), locale);
        const buttons = items.filter(node => node.type === 'button');
        assert.equal(buttons.length, 4 + expectedFilters.length, locale);
        assert.equal(buttons.filter(button => button.props.className === 'is-active').length, 1, locale);
        for (const button of buttons) {
            assert.equal(rows(button).some(node => node.type === 'i'), false, locale);
            const label = rows(button).find(node => node.props.className === 'nmx-context-nav-label');
            assert.equal(label.props.children, button.props.title, locale);
            assert.ok(String(label.props.children).trim(), locale);
            assert.equal(typeof button.props.onClick, 'function', locale);
        }
        assert.equal(buttons[0].props.className, 'is-active');

        harness.modelCenterView = 'usage';
        const usagePanel = rows(harness.renderContextPanel());
        const usageNav = usagePanel.find(node => node.props.className === 'nmx-context-nav nmx-model-context-nav');
        assert.equal(rows(usageNav).filter(node => node.props['data-model-capability']).length, expectedFilters.length, locale);
        const usageSearch = usagePanel.find(node => node.props.className === 'nmx-context-search');
        assert.ok(usageSearch, `usage keeps the same sidebar search: ${locale}`);
        assert.equal(usagePanel.some(node => node.props.className === 'nmx-context-status'), false, `no fake global healthy status: ${locale}`);
        assert.equal(rows(usageNav).filter(node => node.props.className === 'is-active').length, 1, locale);
        assert.equal(rows(usageSearch).find(node => node.type === 'input').props.value, '');
        assert.equal(rows(usageSearch).find(node => node.type === 'input').props.placeholder, modelCenterText(locale, 'search'));
        harness.modelSearchQuery = 'retained query';
        assert.equal(rows(rows(harness.renderContextPanel()).find(node => node.props.className === 'nmx-context-search'))
            .find(node => node.type === 'input').props.value, 'retained query');
    }
    const localStyle = style.slice(style.indexOf('.nmx-model-context-nav {'), style.indexOf('.nmx-model-picker-popover > .nmx-model-picker-relay-view'));
    assert.doesNotMatch(localStyle, /clip-path:|clip:|position:\s*absolute|repeat\(2/);
    assert.match(localStyle, /white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/);
    assert.match(localStyle, /\.nmx-context-nav-count\s*\{[\s\S]*?flex:\s*0 0 auto/);
    assert.match(localStyle, /text-align:\s*start/);
});

test('ordinary settings omit the retired media destination and its unreachable settings panel', () => {
    const context = widget.slice(widget.indexOf('protected renderContextPanel()'), widget.indexOf('protected formatOfferingPrice('));
    assert.doesNotMatch(context, /settingsButton\('media'/);
    assert.doesNotMatch(context, /settingsButton\('audio'/);
    assert.match(context, /settingsButton\('system',/);
    assert.match(context, /settingsButton\('updates', '更新'\)/);
    assert.doesNotMatch(widget, /nmx-media-runtime-settings/);
    assert.ok(widget.includes('protected async saveMediaRuntime('));
});

test('saved official accounts stay compact until the user explicitly adds or reconfigures one', () => {
    assert.match(widget, /protected officialConnectionEditorOpen = false/);
    assert.match(widget, /const showSaved = connections\.length > 0 && !custom && !this\.myApisReturn;/);
    assert.match(widget, /\{showSaved && <section className='nmx-saved-connections'>/);
    assert.match(widget, /\(this\.officialConnectionEditorOpen \|\| !showSaved\) && <section className='nmx-official-form'>/);
    assert.match(widget, /data-official-action='add'[\s\S]*?openOfficialProvider\(provider, undefined, true\)/);
    assert.match(widget, /data-official-action='configure'[\s\S]*?openOfficialProvider\(provider, connection, true\)/);
    assert.match(widget, /this\.officialConnectionEditorOpen = false;[\s\S]*?this\.officialDraft = \{/);
    assert.doesNotMatch(widget, /browserAuth|使用浏览器连接|OfficialBrowserAuth/, 'OpenRouter connects with an API key like every other provider');
});
