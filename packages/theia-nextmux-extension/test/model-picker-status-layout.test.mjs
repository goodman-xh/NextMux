import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
// Assert rendered colors, not CSS variables: a higher-specificity !important
// declaration can override the visual while the intended tokens remain intact.
const pickerColors = {
    dark: { background: 'rgb(37, 36, 39)', border: 'rgb(81, 75, 86)' },
    light: { background: 'rgb(255, 255, 255)', border: 'rgb(215, 206, 219)' }
};
const automaticBestLabels = {
    'zh-CN': '自动最优', 'zh-TW': '自動最佳', en: 'Automatic best', ja: '自動最適', ko: '자동 최적',
    es: 'Mejor automático', fr: 'Meilleur automatique', de: 'Automatisch optimal', 'pt-BR': 'Melhor automático',
    ru: 'Автоматически лучший', ar: 'الأفضل تلقائياً', hi: 'स्वचालित सर्वोत्तम'
};

async function fixtureBundle() {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    const render = method('renderCodingWorkbench');
    const declarations = ['automaticPicker', 'modelOptions', 'modelPickerRelayKey', 'merchantCatalogPending', 'composerRelay',
        'pickerConnection', 'officialPickerPending', 'officialPickerFailed', 'modelRouteById', 'modelPickerIdentity', 'pickerPartition', 'visibleModelOptions', 'priceVariantRoutes', 'moreModelOptions', 'pickerQuery', 'matchesPickerQuery', 'withPriceVariants', 'pickerRows', 'pickerSearchable',
        'modelPickerSwitchRoute', 'modelPickerSwitchPanel', 'modelPickerSwitchModel', 'modelPickerSwitchHint', 'modelPickerChromeHeight',
        'modelPickerDesiredHeight', 'modelPickerPlacement', 'modelPickerMaximumHeight', 'modelPickerHeight',
        'renderModelPickerOption']
        .map(name => {
            const node = render.body.statements.find(statement => ts.isVariableStatement(statement)
                && statement.declarationList.declarations.some(value => value.name.getText(file) === name));
            assert.ok(node, `production declaration ${name}`); return node.getText(file);
        }).join('\n');
    let portal, projectDialog;
    const findPortal = node => {
        if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(property => ts.isJsxAttribute(property)
            && property.name.getText(file) === 'className' && property.initializer?.text === 'nmx-model-picker-portal nmx-desktop-widget')
            && node.getText(file).includes('nmx-model-only-popover')) portal = node;
        if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(property => ts.isJsxAttribute(property)
            && property.name.getText(file) === 'className' && property.initializer?.text === 'nmx-thread-dialog nmx-project-delete-dialog')) projectDialog = node;
        ts.forEachChild(node, findPortal);
    };
    findPortal(widget); assert.ok(portal, 'production model-only portal'); assert.ok(projectDialog, 'production project deletion dialog');
    const entry = `import * as React from 'react'; import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client'; import { Virtuoso } from 'react-virtuoso';
import { managedRelayKey, partitionModelPickerCandidates } from './nextmux-model-route-selection';
import { modelPickerEvidenceText, modelPickerListText, relayMultiplierTag, relayMultiplierText, relayPercentText } from './nextmux-relay-picker';
import { ImeInput } from './nextmux-ime-field';
import { SurfaceTooltips } from './nextmux-surface-tooltips';
import { reasoningControlText } from './nextmux-reasoning-controls-locale';
import { relayText } from './nextmux-relay-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { contextWindowTokenLabel, effectiveContextWindowTokens, normalizeContextWindowTokens } from '../common/nextmux-context-budget';
import { contextBudgetText } from './nextmux-context-budget-locale';
import { measuredModelFidelity, measuredRelayAuthenticity, measuredRelayQuality } from '../common/nextmux-relay-evidence';
import { placeAnchoredFloatingPanel, placeAdjacentFloatingPanel, placeModelPickerPanels } from './nextmux-floating-panel';
import { projectMenuText } from './nextmux-project-menu';
import { RelaySwitchControl, relaySwitchCopy, automaticOptimalText } from './nextmux-relay-switch-control';
import { modelSwitchRouteKey } from '../common/nextmux-model-switch-policy';
import { reasoningDepthChoicesForDisplay } from './nextmux-reasoning-depth-presentation';
import { OfferingPriceCard, offeringIsOwnPriced, offeringMultiplierBps, offeringPriceSignature, offeringPriceText } from './nextmux-offering-price';
const runningTaskText = (_locale, key) => key;
const params = new URLSearchParams(location.search);
const priceFields = ['inputPerMillionMicros','outputPerMillionMicros','cachedInputPerMillionMicros','cacheWritePerMillionMicros','imageOutputPerMillionMicros','imageEachMicros','videoSecondMicros','videoInputImageEachMicros','audioPerMillionCharactersMicros','audioSecondMicros','requestEachMicros'];
const fullPrice = params.has('prices') ? { multiplierBps: 2500, keyPrice: { selectedMultiplierBps: 2500 },
    price: { mode: 'reference_multiplier', currency: 'USD', multiplierBps: 2500, ...Object.fromEntries(priceFields.map((key,index)=>[key,(index+1)*125000])) },
    officialPrice: { currency: 'USD', ...Object.fromEntries(priceFields.map((key,index)=>[key,(index+1)*500000])) } } : {};
const models = ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma'].map((label, index) => ({ id: 'fixture/model-' + index, label, model: label, available: true }));
class FixtureWidget {
    desktopLocale = params.get('locale') || 'en'; merchantCatalogStatus = params.get('state') || 'loading';
    merchantCatalogError = ['failed', 'partial'].includes(this.merchantCatalogStatus);
    activeRelayKey = params.has('empty') ? '' : 'managed:synthetic'; activeSection = 'coding'; codingPopover = 'routes'; modelPickerRelayOpen = false;
    selectedModelIds = { coding: '' }; modelPickerEffortModelId = ''; catalogLoading = false;
    selectedMerchantDiscoveredModels = { merchantId: 'synthetic', state: 'ready' };
    selectedMerchantCatalog = { nextCursor: 'synthetic-next-page' };
    officialModels = { connections: [] }; officialPickerValidations = new Map(); officialPickerValidationFailures = new Map();
    officialBusyConnectionId = ''; officialConnectionStage = 'idle';
    switchPolicy = { version: 1, revision: 0, mode: 'allowlisted_models', fallbackRegistryModelIds: [models[1].id], merchantScope: 'selected_merchant' };
    modelSwitchSettings = { get: () => this.switchPolicy };
    automaticRouting = false;
    modelOnlyDisplayName(value) { return value; }
    setAutomaticRouting(value) { this.automaticRouting = value; this.calls.push({ automatic: value }); this.update(); }
    registryModels = models.map(model => ({ id: model.id, canonicalModel: model.model, displayName: model.label, provider: 'Synthetic', output: ['text'], capabilities: [], contextTokens: 32000, maximumOutputTokens: 4096 }));
    platformCatalog = { offerings: models.map(model => ({ registryModelId: model.id, canonicalModel: model.label, displayName: model.label,
        status: 'active', workbenches: ['coding'], output: ['text'], merchantId: 'synthetic' })) };
    projectDeleteConversations = false; projectDeleteBusy = false; projectDeleteError = '';
    node = document.getElementById('fixture-anchor'); calls = [];
    codingModelOptions() { return params.has('nomodels') ? [] : models; }
    relayOption() { return { kind: 'managed', merchantId: 'synthetic', label: 'Synthetic only' }; }
    routesForRelay() { return (params.has('nomodels') ? [] : models).map((model, index) => ({ id: model.id, registryModelId: model.id, kind: 'managed_gateway', offering: { ...this.platformCatalog.offerings[index], ...fullPrice, keyPriceQuoteId: 'fixture-quote' } })); }
    managedModelRoute(route) { return { mode: 'fixed', offeringId: route.id }; }
    offeringMerchantId(offering) { return offering.merchantId; }
    changeModelSwitchPolicy(_route, patch) { this.calls.push({ switchPolicy: patch }); this.switchPolicy = { ...this.switchPolicy, ...patch }; this.update(); }
    modelKeyForRoute(route) { return route.id; }
    isModelVisible() { return true; }
    modelContextWindowTokens() { return 32000; }
    selectedModelOption() { return undefined; }
    loadMorePickerModels() {}
    modelReasoningContract() { return undefined; } reasoningDepthChoicesForRoute() { return { options: [] }; } activeReasoningDepthId() { return undefined; }
    reasoningDepthLabel() { return ''; } modelListedAsMore() { return false; }
    reasoningEffortLevels() { return []; } reasoningEffortForRoute() { return undefined; }
    resolvedDesktopTheme() { return params.get('theme') || 'dark'; }
    tx(key) { return key === 'retry' ? (this.desktopLocale === 'zh-CN' ? '重试' : this.desktopLocale === 'de' ? 'Erneut versuchen' : this.desktopLocale === 'ar' ? 'إعادة المحاولة' : 'Retry') : key; }
    loadSelectedMerchantCatalog(...args) { this.calls.push(args); }
    closeNavigationSurface() {}
    completeNavigationSurface() { this.calls.push({ navigation: 'complete' }); }
    openSettingsPanel(panel) { this.calls.push({ settings: panel }); }
    selectModelOptionOnRelay(...args) { this.calls.push({ selection: args }); }
    closeProjectDialog() { this.calls.push('cancel'); } trapDialogFocus() {}
    confirmProjectRemoval() { throw new Error('The layout fixture must never delete anything'); }
    fixtureOpen = true;
    setFixtureOpen(open) { this.fixtureOpen = open; this.update(); }
    update() { renderRoot.render(this.fixtureOpen ? (params.get('kind') === 'project' ? this.renderProjectDialog() : this.render()) : null); }
    ${method('calculateModelPickerPlacement').getText(file)}
    ${method('calculateModelEffortPlacement').getText(file)}
    ${method('fitModelEffortMenu').getText(file)}
    ${['cancelModelEffortPickerClose','scheduleModelEffortPickerClose','closeModelEffortPickerImmediately'].map(name=>method(name).getText(file)).join('\n')}
    ${method('openModelEffortPicker').getText(file)}
    ${method('renderModelSwitchPanel').getText(file)}
    ${method('renderAutomaticRelaySwitch').getText(file)}
    render() { const route = params.has('managed') ? this.routesForRelay()[0] : undefined, agentRunning = params.has('running'); ${declarations} return ${portal.getText(file)}; }
    renderProjectDialog() { const deleteProject = { path: '/synthetic/project', label: 'Synthetic Project' };
        return <div className={'nmx-desktop-widget nmx-shell nmx-theme-' + this.resolvedDesktopTheme()} dir={this.desktopLocale === 'ar' ? 'rtl' : 'ltr'}><div className='nmx-sheet-backdrop nmx-dialog-backdrop'>${projectDialog.getText(file)}</div></div>; }
}
const trigger = document.querySelector('.fixture-trigger');
if (params.has('corner')) { const corner=params.get('corner'); trigger.style.left=corner.endsWith('left')?'12px':'auto'; trigger.style.right=corner.endsWith('right')?'12px':'auto';
 trigger.style.top=corner.startsWith('top')?'60px':'auto'; trigger.style.bottom=corner.startsWith('bottom')?'12px':'auto'; }
const instance = new FixtureWidget(); window.fixture = instance;
// The real app sets direction on the widget, not html; body portals must own it.
document.documentElement.dir = 'ltr';
const renderRoot = createRoot(document.getElementById('fixture')); instance.update();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx',
        resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'isolated-model-status-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'),
            'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    return outputFiles[0].contents;
}

// Exercise production TSX/CSS in isolated browser layouts, including every
// supported header translation, narrow windows and RTL. Allow shared-runner
// contention without masking a real hang.
test('actual model/status and project-dialog renderers preserve compact layout with production CSS', { timeout: 360000 }, async t => {
    const assets = {
        '/fixture.js': ['text/javascript', await fixtureBundle()],
        '/style.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux.css', import.meta.url))],
        '/production.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url))],
        '/shell-polish.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux-shell-polish.css', import.meta.url))],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))],
        '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'><link rel='stylesheet' href='/shell-polish.css'>
<style>html,body{margin:0;width:100%;height:100%;font:13px system-ui;background:#151515}*{box-sizing:border-box}
.fixture-trigger{position:fixed;bottom:12px;left:16px;height:32px;width:120px}.fixture-titlebar{height:40px}</style>
</head><body><div id='fixture-anchor'><div class='nmx-titlebar-primary-nav fixture-titlebar'></div><button class='nmx-route-button fixture-trigger'>Synthetic source</button></div><div id='fixture'></div><script src='/fixture.js'></script></body></html>`],
    };
    const server = createServer((request, response) => {
        const asset = request.method === 'GET' ? assets[new URL(request.url, 'http://127.0.0.1').pathname] : undefined;
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain', 'cache-control': 'no-store',
            'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'self'" });
        response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const onlyCase = process.env.NEXTMUX_PICKER_LAYOUT_CASE; let matchedCases = 0;
    // Puppeteer creates an isolated temporary profile; no desktop app/profile or account is opened.
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => { if (new URL(request.url()).origin === origin) void request.continue(); else { errors.push('external request blocked'); void request.abort(); } });
    const verifyLastModelAccess = async label => {
            await page.hover('.nmx-model-picker-list'); await page.mouse.wheel({deltaY:500});
            await page.waitForFunction(()=>{const list=document.querySelector('.nmx-model-picker-list'),last=list.querySelector('[data-model-id="fixture/model-2"]');
                const l=list.getBoundingClientRect(),r=last.getBoundingClientRect();return (list.scrollHeight<=list.clientHeight+1 || list.scrollTop>0) && r.top>=l.top-1 && r.bottom<=l.bottom+1;}, {timeout:3000}).catch(async error=>{
                const observed=await page.$eval('.nmx-model-picker-list',el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}));
                throw new Error(`${label}: cannot reach the last model ${JSON.stringify(observed)} (${error.message})`);
            });
            const lastSelector='.nmx-model-option[data-model-id="fixture/model-2"] > button';
            await page.focus(lastSelector);
            assert.equal(await page.$eval(lastSelector,node=>node===document.activeElement),true,`${label}: last model is keyboard reachable`);
            await page.click(lastSelector);
            assert.equal(await page.evaluate(()=>window.fixture.calls.filter(call=>call.selection).at(-1)?.selection[0]),'fixture/model-2',`${label}: scrolled last model selects its own route`);
            await page.click('.nmx-model-picker-settings-link');
            assert.equal(await page.evaluate(()=>window.fixture.calls.filter(call=>call.settings==='models').length),1,`${label}: short viewport keeps model settings reachable`);
    };
    await mkdir('/tmp/nm-shots/pickers', { recursive: true });
    const priceCases = [];
    for (const [width, height] of [[1280, 800], [900, 760], [800, 640], [640, 520], [320, 680]]) for (const locale of ['zh-CN', 'ar']) {
        for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
            const theme = locale === 'ar' ? 'light' : 'dark';
            const label = `${width}x${height}/${locale}/${theme}/${corner}/full-prices`;
            if (onlyCase && label !== onlyCase) continue; matchedCases++;
            await page.setViewport({ width, height }); await page.mouse.move(0, 0);
            await page.goto(`${origin}/?${new URLSearchParams({ state: 'ready', locale, theme, corner, prices: '1' })}`, { waitUntil: 'load' });
            await page.waitForSelector('.nmx-model-option > button');
            const rowIndex = corner.startsWith('bottom') ? 2 : 0;
            const rowSelector = `.nmx-model-option[data-model-id="fixture/model-${rowIndex}"]`;
            await page.hover(`${rowSelector} > button`);
            await page.waitForSelector(`.nmx-model-effort-menu[data-model-id="fixture/model-${rowIndex}"]`);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const layout = await page.evaluate(selector => {
                const list = document.querySelector('.nmx-model-only-popover'), quote = document.querySelector('.nmx-model-effort-menu'), row = document.querySelector(selector);
                const box = el => { const r = el.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height }; };
                return { list:box(list), quote:box(quote), row:box(row), entries:quote.querySelectorAll('.nmx-offering-price-block dl > div').length,
                    dimensions: [...quote.querySelectorAll('.nmx-offering-price-block')].map(block=>block.querySelectorAll('dl > div').length),
                    scrollHeight:quote.scrollHeight,clientHeight:quote.clientHeight,scrollWidth:quote.scrollWidth,clientWidth:quote.clientWidth,
                    overflowY:getComputedStyle(quote).overflowY, pageWidth:document.documentElement.scrollWidth };
            }, rowSelector);
            const { list, quote, row } = layout;
            if ((width === 320 || width === 1280) && locale === 'zh-CN' && corner === 'bottom-right')
                await page.screenshot({ path: `/tmp/nm-shots/pickers/model-quote-${width}x${height}.png` });
            for (const [name, box] of [['list', list], ['quote', quote]]) assert.ok(box.left >= 7 && box.right <= width - 7 && box.top >= 7 && box.bottom <= height - 7,
                `${label}: ${name} is clipped by the viewport ${JSON.stringify(layout)}`);
            assert.ok(quote.right <= list.left - 1 || quote.left >= list.right + 1,
                `${label}: quotation covers the model list ${JSON.stringify(layout)}`);
            const horizontalGap = Math.max(quote.left - list.right, list.left - quote.right);
            assert.ok(horizontalGap <= 12, `${label}: quotation is detached from its model list (${horizontalGap}px)`);
            assert.ok(Math.min(quote.bottom,row.bottom)-Math.max(quote.top,row.top)>0,
                `${label}: quotation is not next to the hovered model ${JSON.stringify(layout)}`);
            assert.deepEqual(layout.dimensions,[11,11],`${label}: all priced dimensions, including the last row, are rendered for both price sources`);
            assert.ok(layout.scrollWidth <= layout.clientWidth + 1 && layout.pageWidth <= width,
                `${label}: long price content overflows horizontally ${JSON.stringify(layout)}`);
            assert.ok(quote.width >= 120 && list.width >= 120, `${label}: a panel was collapsed into an unusable sliver`);
            // Cross the real hover gap and scroll the card without selecting a model or closing it.
            await page.mouse.move((quote.left+quote.right)/2,Math.min(quote.bottom-12,Math.max(quote.top+12,(row.top+row.bottom)/2)),{steps:3});
            await page.mouse.wheel({ deltaY: 1800 });
            await new Promise(resolve=>setTimeout(resolve,220));
            assert.ok(await page.$('.nmx-model-effort-menu'), `${label}: price hover closed while moving into the card`);
            if(layout.scrollHeight>layout.clientHeight+2) {
                assert.ok(['auto','scroll'].includes(layout.overflowY),`${label}: long quotation has no scroll mechanism`);
                const reached = await page.$eval('.nmx-model-effort-menu',el=>({top:el.scrollTop,bottom:el.getBoundingClientRect().bottom,last:el.querySelector('.nmx-offering-price-block:last-child dl > div:last-child dd').getBoundingClientRect().bottom}));
                assert.ok(reached.top>0 && reached.last<=reached.bottom+1,`${label}: the last billed dimension cannot be reached ${JSON.stringify(reached)}`);
            }
            assert.deepEqual(await page.evaluate(()=>window.fixture.calls),[],`${label}: looking at prices must not select or dispatch a model`);
            await page.click('.nmx-model-picker-settings-link');
            const calls=await page.evaluate(()=>window.fixture.calls);
            assert.equal(calls.filter(call=>call.settings==='models').length,1,`${label}: settings action must open the model visibility page once`);
            assert.equal(calls.filter(call=>call.navigation==='complete').length,1,`${label}: settings action closes the current navigation surface`);
            assert.ok(calls.every(call=>!call.selection),`${label}: settings action selected a model`);
            priceCases.push({case:label,listWidth:list.width,quoteWidth:quote.width,quoteHeight:quote.height,gap:horizontalGap});
        }
    }
    assert.deepEqual(errors, []);
    t.diagnostic(`${priceCases.length} full-price hover/scroll/viewport/non-overlap/footer layouts passed: ${JSON.stringify(priceCases)}`);
    const cases = [];
    for (const [width, height] of [[360, 520], [900, 760], [640, 320]]) for (const locale of ['en', 'zh-CN', 'de', 'ar']) for (const state of ['loading', 'failed', 'partial']) {
        const theme = width === 900 ? 'light' : 'dark';
        const label = `${width}x${height}/${locale}/${theme}/${state}`;
        if (onlyCase && label !== onlyCase) continue; matchedCases++;
        await page.setViewport({ width, height });
        await page.mouse.move(0, 0);
        await page.goto(`${origin}/?${new URLSearchParams({ state, locale, theme })}`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('.nmx-model-picker-list [data-model-id]').length === 3);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const layout = await page.evaluate(() => {
            const panel = document.querySelector('.nmx-model-only-popover'), list = panel.querySelector('.nmx-model-picker-list'), status = panel.querySelector('[role=status]'), button = status.querySelector('button');
            const rect = node => { const value = node.getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height }; };
            return { panel: rect(panel), list: rect(list), status: rect(status), direction: getComputedStyle(panel).direction,
                colors: { background: getComputedStyle(panel).backgroundColor, border: getComputedStyle(panel).borderTopColor },
                lang: panel.closest('[lang]')?.lang, documentDirection: getComputedStyle(document.documentElement).direction,
                button: button && { ...rect(button), flexShrink: getComputedStyle(button).flexShrink, display: getComputedStyle(button).display },
                statusText: status.textContent, spinner: Boolean(status.querySelector('.codicon-modifier-spin')),
                rows: [...list.querySelectorAll('[data-model-id]')].map(row => ({ ...rect(row), text: row.querySelector('strong').textContent })),
                pageWidth: document.documentElement.scrollWidth };
        });
        assert.deepEqual(layout.rows.map(row => row.text), ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma'], label);
        assert.deepEqual(layout.colors, pickerColors[theme], `${label}: generic popover styles overrode the model drawer palette`);
        assert.equal(layout.documentDirection, 'ltr', `${label}: html direction must not mask detached portal inheritance`);
        assert.equal(layout.direction, locale === 'ar' ? 'rtl' : 'ltr', `${label}: model portal lost widget direction`);
        assert.equal(layout.lang, locale, `${label}: model portal lost widget language`);
        if(layout.list.height<(height>=520?92:64)) await page.screenshot({path:'/tmp/nextmux-model-picker-collapse.png'});
        assert.ok(layout.list.height >= (height >= 520 ? 92 : 64), `${label}: model list collapsed to ${layout.list.height}px ${JSON.stringify(layout)}`);
        assert.ok(layout.rows.every(row => row.height >= 28), `${label}: model row height collapsed`);
        if (height >= 520) assert.ok(layout.rows.every(row => row.top >= layout.list.top - 1 && row.bottom <= layout.list.bottom + 34), `${label}: cached rows clipped`);
        else assert.ok(layout.rows[0].top >= layout.list.top - 1 && layout.rows[0].bottom <= layout.list.bottom + 1, `${label}: short viewport must show the first model`);
        assert.ok(layout.status.height <= 66, `${label}: status row expanded to ${layout.status.height}px`);
        assert.ok(layout.panel.left >= 8 && layout.panel.right <= width - 8 && layout.panel.top >= 46 && layout.panel.bottom <= height - 8, `${label}: panel exceeds safe viewport`);
        assert.ok(layout.pageWidth <= width, `${label}: horizontal page overflow`);
        assert.equal(layout.spinner, state === 'loading', label);
        if (state === 'loading') assert.equal(layout.button, null, label);
        else {
            assert.ok(layout.button.width < layout.panel.width * .65 && layout.button.height <= 34, `${label}: retry inherits a large full-width button`);
            // A flex item blockifies inline-flex to computed flex; geometry is the regression boundary.
            assert.ok(['flex', 'inline-flex'].includes(layout.button.display), label); assert.equal(layout.button.flexShrink, '0', label);
            await page.click('.nmx-merchant-catalog-status button');
            assert.deepEqual(await page.evaluate(() => window.fixture.calls), [['synthetic', true]], `${label}: actual retry callback changed source`);
        }
        if (height < 520) await verifyLastModelAccess(label);
        cases.push({ case: label, listHeight: layout.list.height, statusHeight: layout.status.height, retryWidth: layout.button?.width });
    }
    assert.deepEqual(errors, []);
    t.diagnostic(`${cases.length} production-render/CSS/Virtuoso layouts passed: ${JSON.stringify(cases)}`);
    const managedCases = [];
    for (const [width, height] of [[900, 760], [640, 320], [320, 680]]) for (const locale of Object.keys(automaticBestLabels)) for (const state of ['ready', 'loading', 'failed', 'partial']) {
        const theme = width === 900 ? 'light' : 'dark';
        const label = `${width}x${height}/${locale}/${theme}/${state}/managed`;
        if (onlyCase && label !== onlyCase) continue; matchedCases++;
        await page.setViewport({ width, height });
        await page.mouse.move(0, 0);
        await page.goto(`${origin}/?${new URLSearchParams({ managed: '1', running: '1', state, locale, theme })}`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-model-picker-auto-switch input[type=checkbox]');
        const measure = () => page.evaluate(() => {
            const panel = document.querySelector('.nmx-model-only-popover'), header = panel.querySelector('header');
            const list = panel.querySelector('.nmx-model-picker-list'), toggle = header.querySelector('input');
            const toggleStyle = getComputedStyle(toggle), switchText = toggle.parentElement.querySelector('span:last-child');
            const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
            return { panel: rect(panel), list: rect(list), header: rect(header), checked: toggle.checked, label: toggle.getAttribute('aria-label'),
                hint: toggle.parentElement.dataset.help, inputHint: toggle.dataset.help, textHint: switchText.dataset.help, switch: rect(toggle.parentElement), text: switchText.textContent,
                nativeTitles: [toggle.parentElement.title, toggle.title, switchText.title],
                checkbox: { ...rect(toggle), opacity: toggleStyle.opacity, visibility: toggleStyle.visibility, display: toggleStyle.display },
                heading: rect(header.querySelector('strong')), refresh: rect(header.querySelector('button')),
                colors: { background: getComputedStyle(panel).backgroundColor, border: getComputedStyle(panel).borderTopColor },
                footer: panel.querySelector('.nmx-model-picker-settings-link') ? rect(panel.querySelector('.nmx-model-picker-settings-link')) : undefined, nextRun: rect(panel.querySelector('.nmx-next-run-label')),
                direction: getComputedStyle(panel).direction, headerScrollWidth: header.scrollWidth, headerClientWidth: header.clientWidth,
                rows: [...list.querySelectorAll('[data-model-id]')].map(row => ({ ...rect(row), text: row.querySelector('strong').textContent })) };
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const closed = await measure();
        assert.deepEqual(closed.colors, pickerColors[theme], `${label}: model drawer palette`);
        assert.equal(closed.checked, false, label);
        assert.ok(closed.hint.includes('Synthetic Alpha'), `${label}: hover explanation uses the actual model`);
        assert.equal(closed.inputHint, closed.hint, `${label}: checkbox has the full explanation`);
        assert.equal(closed.textHint, closed.hint, `${label}: visible label has the full explanation`);
        assert.deepEqual(closed.nativeTitles, ['', '', ''], `${label}: native tooltips must not duplicate the visible explanation`);
        assert.equal(closed.label, automaticBestLabels[locale], `${label}: checkbox keeps its short localized accessible label`);
        assert.equal(closed.text, automaticBestLabels[locale], `${label}: visible label must not include the long model-specific explanation`);
        assert.equal(closed.direction, locale === 'ar' ? 'rtl' : 'ltr', `${label}: header uses the active language direction`);
        assert.ok(closed.checkbox.width >= 12 && closed.checkbox.height >= 12 && closed.checkbox.opacity !== '0'
            && closed.checkbox.visibility === 'visible' && closed.checkbox.display !== 'none', `${label}: the actual checkbox must remain visible`);
        assert.ok(closed.headerScrollWidth <= closed.headerClientWidth + 1, `${label}: translated header has horizontal overflow ${JSON.stringify(closed)}`);
        assert.ok(closed.panel.width >= 120 && closed.panel.width <= 264, `${label}: model drawer remains readable and makes room for its quote`);
        assert.ok(closed.footer && closed.footer.height >= 24 && closed.footer.top >= closed.list.bottom - 1 && closed.footer.bottom <= closed.panel.bottom - 1,
            `${label}: settings entry stays visible below the scrolling list`);
        assert.ok(closed.switch.width > 0 && closed.switch.left >= closed.panel.left && closed.switch.right <= closed.panel.right,
            `${label}: header checkbox remains within the model drawer`);
        assert.ok(closed.switch.top >= closed.header.top && closed.switch.bottom <= closed.header.bottom + 1,
            `${label}: automatic-best remains within the header, including the narrow two-row layout`);
        for (const [name, control] of [['title',closed.heading],['refresh',closed.refresh]]) {
            const overlapWidth=Math.min(closed.switch.right,control.right)-Math.max(closed.switch.left,control.left);
            const overlapHeight=Math.min(closed.switch.bottom,control.bottom)-Math.max(closed.switch.top,control.top);
            assert.ok(overlapWidth<=1 || overlapHeight<=1,`${label}: automatic-best overlaps ${name}`);
        }
        const exerciseTooltip = (width === 900 && state === 'ready' && ['zh-CN', 'ar'].includes(locale))
            || (width === 640 && locale === 'en' && state === 'ready')
            || (width === 320 && locale === 'de' && state === 'failed');
        const tooltipSelector = '.nmx-surface-tooltip[role="tooltip"]';
        const verifyTooltip = async target => {
            await page.waitForSelector(tooltipSelector, { visible: true, timeout: 3000 });
            const tip = await page.$eval(tooltipSelector, node => { const r = node.getBoundingClientRect(); return {
                text: node.textContent, id: node.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
                descriptions: [...document.querySelectorAll('.nmx-model-picker-auto-switch [aria-describedby], .nmx-model-picker-auto-switch[aria-describedby]')].map(n => n.getAttribute('aria-describedby'))
            }; });
            assert.equal(tip.text, closed.hint, `${label}: ${target} shows the actual readable explanation`);
            assert.ok(tip.left >= 7 && tip.right <= width - 7 && tip.top >= 7 && tip.bottom <= height - 7, `${label}: ${target} tooltip stays in the viewport`);
            assert.ok(tip.scrollHeight <= tip.clientHeight + 1 && tip.scrollWidth <= tip.clientWidth + 1, `${label}: ${target} explanation is not clipped`);
            assert.ok(tip.descriptions.some(ids => ids.split(' ').includes(tip.id)), `${label}: ${target} tooltip is associated with its control`);
            const visible = await measure();
            for (const field of ['panel', 'header', 'list', 'switch', 'checkbox']) {
                assert.deepEqual(visible[field], closed[field], `${label}: ${target} tooltip must not move or resize ${field}`);
            }
        };
        if (exerciseTooltip) for (const target of ['checkbox', 'text', 'label gap']) {
            await page.mouse.move(0, 0);
            await page.waitForSelector(tooltipSelector, { hidden: true, timeout: 3000 });
            if (target === 'label gap') {
                const x = closed.switch.left + 1, y = (closed.switch.top + closed.switch.bottom) / 2;
                assert.equal(await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.matches('.nmx-model-picker-auto-switch'), {x,y}), true, `${label}: fixture actually hovers label padding`);
                await page.mouse.move(x, y);
            } else await page.hover(target === 'checkbox' ? '.nmx-model-picker-auto-switch input' : '.nmx-model-picker-auto-switch span:last-child');
            await verifyTooltip(target);
        }
        await page.mouse.move(0, 0);
        await page.waitForSelector(tooltipSelector, { hidden: true, timeout: 3000 });
        await page.focus('.nmx-model-picker-auto-switch input');
        assert.equal(await page.$eval('.nmx-model-picker-auto-switch input', node => node.disabled), false, `${label}: managed model toggle remains focusable`);
        if (exerciseTooltip) await verifyTooltip('keyboard focus');
        assert.equal(await page.$('.nmx-same-model-switch-tooltip'), null, `${label}: the compact header does not recreate the obsolete footer tooltip`);
        await page.keyboard.press('Escape');
        await page.waitForSelector(tooltipSelector, { hidden: true, timeout: 3000 });
        await page.click('.nmx-model-picker-auto-switch input');
        await page.waitForFunction(() => document.querySelector('.nmx-model-picker-auto-switch input').checked);
        const opened = await measure();
        assert.equal(opened.inputHint, closed.hint, `${label}: toggling keeps the checkbox explanation`);
        assert.equal(opened.textHint, closed.hint, `${label}: toggling keeps the label explanation`);
        assert.equal(opened.panel.height, closed.panel.height, `${label}: switching does not create obsolete footer space`);
        assert.equal(opened.list.height, closed.list.height, `${label}: toggling automatic-best must not consume list space`);
        assert.ok(opened.list.height >= (width >= 559 && height >= 520 ? 92 : 64), `${label}: model list leaves fewer than its readable rows ${JSON.stringify(opened)}`);
        assert.ok(opened.panel.left >= 8 && opened.panel.right <= width - 8 && opened.panel.top >= 46 && opened.panel.bottom <= height - 8, `${label}: panel remains within safe viewport`);
        await page.keyboard.press('Space');
        await page.waitForFunction(() => !document.querySelector('.nmx-model-picker-auto-switch input')?.checked);
        assert.deepEqual(await page.evaluate(() => window.fixture.calls), [{ automatic: true }, { automatic: false }], `${label}: one click and one keyboard toggle each invoke the handler exactly once`);
        if (exerciseTooltip) {
            await page.mouse.move(0, 0);
            await page.focus('.fixture-trigger');
            await page.hover('.nmx-model-picker-auto-switch span:last-child');
            await verifyTooltip('before closing');
            await page.evaluate(() => window.fixture.setFixtureOpen(false));
            await page.waitForSelector('.nmx-model-only-popover', { hidden: true, timeout: 3000 });
            await page.waitForSelector(tooltipSelector, { hidden: true, timeout: 3000 });
            await page.mouse.move(0, 0);
            await page.evaluate(() => window.fixture.setFixtureOpen(true));
            await page.waitForSelector('.nmx-model-picker-auto-switch input');
            await page.focus('.nmx-model-picker-auto-switch input');
            await verifyTooltip('reopened keyboard focus');
            assert.deepEqual(await page.evaluate(() => window.fixture.calls), [{ automatic: true }, { automatic: false }], `${label}: hovering, focusing, closing and reopening never toggle automatically`);
            if (width === 900 && locale === 'zh-CN' && state === 'ready') await page.screenshot({ path: '/tmp/nm-shots/pickers/model-auto-tooltip-900x760.png' });
        }
        if (width < 559 || height < 520) await verifyLastModelAccess(label);
        managedCases.push({ case: label, height: opened.panel.height, listHeight: opened.list.height, headerHeight: opened.header.height });
    }
    assert.deepEqual(errors, []);
    t.diagnostic(`${managedCases.length} real model-header automatic-best layouts and keyboard toggles passed: ${JSON.stringify(managedCases)}`);
    for (const [width, height] of [[320, 680], [900, 760], [640, 320]]) {
        if (onlyCase) continue;
        await page.setViewport({ width, height });
        await page.goto(`${origin}/?empty=1&locale=zh-CN&state=ready`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-model-picker-empty-list .nmx-route-empty span');
        const empty = await page.evaluate(() => {
            const list = document.querySelector('.nmx-model-picker-empty-list'), text = list.querySelector('.nmx-route-empty span');
            const r = list.getBoundingClientRect(), t = text.getBoundingClientRect();
            return { text: text.textContent, left: t.left, right: t.right, top: t.top, bottom: t.bottom,
                list: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight,
                    overflowY: getComputedStyle(list).overflowY, scrollTop: list.scrollTop }, x: Math.abs(t.left + t.width / 2 - r.left - r.width / 2),
                y: Math.abs(t.top + t.height / 2 - r.top - r.height / 2) };
        });
        assert.equal(empty.text, '请先选择中转商或添加自有 API');
        assert.ok(empty.x <= 1 && empty.y <= 1, `empty text is centered at ${width}x${height}: ${JSON.stringify(empty)}`);
        assert.ok(empty.left >= empty.list.left && empty.right <= empty.list.right && empty.top >= empty.list.top && empty.bottom <= empty.list.bottom,
            `empty text is fully visible at ${width}x${height}`);
        assert.equal(empty.list.scrollTop, 0, `empty text starts in the visible viewport at ${width}x${height}`);
        assert.ok(empty.list.overflowY !== 'scroll' && !(empty.list.overflowY === 'auto' && empty.list.scrollHeight > empty.list.clientHeight + 1),
            `empty state does not show an unnecessary scrollbar at ${width}x${height}: ${JSON.stringify(empty)}`);
    }
    // §6.1: an empty drawer shows its short “Loading…” in the visual center (U025/U056).
    await mkdir('/tmp/nm-shots/pickers', { recursive: true });
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en']) for (const [width, height] of [[320, 640], [1280, 800]]) {
        for (const kind of ['loading', 'empty']) {
            if (onlyCase) continue;
            await page.setViewport({ width, height });
            await page.goto(`${origin}/?${new URLSearchParams({ nomodels: '1', state: kind === 'loading' ? 'loading' : 'ready', locale, theme, ...(kind === 'empty' ? { empty: '1' } : {}) })}`, { waitUntil: 'load' });
            const selector = kind === 'loading' ? '.nmx-model-picker-empty-list .nmx-merchant-catalog-status' : '.nmx-model-picker-empty-list .nmx-route-empty span';
            await page.waitForSelector(selector);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const centered = await page.evaluate(selector => {
                const panel = document.querySelector('.nmx-model-only-popover'), list = panel.querySelector('.nmx-model-picker-empty-list'), node = panel.querySelector(selector);
                const p = panel.getBoundingClientRect(), l = list.getBoundingClientRect(), n = node.getBoundingClientRect();
                const header = panel.querySelector('header').getBoundingClientRect();
                return { text: node.textContent, dx: Math.abs(n.left + n.width / 2 - (l.left + l.width / 2)), dy: Math.abs(n.top + n.height / 2 - (l.top + l.height / 2)),
                    listFills: l.bottom >= panel.querySelector('.nmx-model-picker-settings-link').getBoundingClientRect().top - 12 && l.top <= header.bottom + 2, height: p.height };
            }, selector);
            const label = `${theme}/${locale}/${width}x${height}/${kind}`;
            if (onlyCase && label !== onlyCase) continue; matchedCases++;
            assert.ok(centered.dx <= 2 && centered.dy <= 2, `${label}: not centered ${JSON.stringify(centered)}`);
            assert.ok(centered.listFills, `${label}: the empty list does not fill the drawer body ${JSON.stringify(centered)}`);
            if (kind === 'loading') assert.match(centered.text, locale === 'zh-CN' ? /^加载中…$/ : /^Loading…$/, label);
            await page.screenshot({ path: `/tmp/nm-shots/pickers/model-picker-${kind}-${theme}-${locale}-${width}x${height}.png` });
        }
    }
    const evidenceCases = [];
    for (const [width, height] of [[320, 680], [900, 760]]) for (const locale of ['en', 'zh-CN', 'de', 'ar']) {
        const theme = width === 900 ? 'light' : 'dark';
        const label = `${width}x${height}/${locale}/${theme}/evidence`;
        if (onlyCase && label !== onlyCase) continue; matchedCases++;
        await page.setViewport({ width, height });
        await page.mouse.move(0, 0);
        await page.goto(`${origin}/?${new URLSearchParams({ state: 'ready', locale, theme })}`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-model-option > button');
        await page.focus('.nmx-model-option > button');
        await page.waitForSelector('.nmx-model-effort-portal .nmx-model-evidence-menu');
        const layout = await page.evaluate(() => {
            const portal = document.querySelector('.nmx-model-effort-portal'), panel = portal.querySelector('section');
            const rect = panel.getBoundingClientRect();
            return { direction: getComputedStyle(panel).direction, lang: portal.lang, documentDirection: document.documentElement.dir,
                colors: { background: getComputedStyle(panel).backgroundColor, border: getComputedStyle(panel).borderTopColor },
                width: rect.width, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                labels: panel.querySelectorAll('.nmx-model-evidence dt').length, values: panel.querySelectorAll('.nmx-model-evidence dd').length,
                context: panel.querySelector('.nmx-model-evidence div:last-child dd')?.textContent,
                priceCards: panel.querySelectorAll('.nmx-offering-price').length,
                priceSections: panel.querySelectorAll('.nmx-offering-price-block').length };
        });
        assert.equal(layout.documentDirection, 'ltr', label);
        assert.deepEqual(layout.colors, pickerColors[theme], `${label}: evidence lost the shared model picker palette`);
        assert.equal(layout.direction, locale === 'ar' ? 'rtl' : 'ltr', `${label}: detached evidence portal lost its direction`);
        assert.equal(layout.lang, locale, label);
        assert.ok(layout.width >= 120 && layout.width <= 340, `${label}: evidence remains readable within its available space`);
        assert.ok(layout.left >= 8 && layout.right <= width - 8 && layout.top >= 8 && layout.bottom <= height - 8, `${label}: focused model evidence escaped viewport`);
        // Authenticity, quality and the route's context (a fact, written as vendors do: 32K).
        assert.equal(layout.labels, 3, label); assert.equal(layout.values, 3, label); assert.equal(layout.context, '32K', label);
        assert.equal(layout.priceCards, 1, `${label}: price details are available beside the two evidence metrics`);
        assert.equal(layout.priceSections, 2, `${label}: official and relay price sections remain visible`);
        assert.deepEqual(await page.evaluate(() => window.fixture.calls), [], `${label}: keyboard focus must not select or dispatch a model`);
        evidenceCases.push(label);
    }
    assert.deepEqual(errors, []);
    t.diagnostic(`${evidenceCases.length} detached evidence direction/geometry layouts passed: ${evidenceCases.join(', ')}`);
    const projectCases = [];
    for (const [width, height] of [[360, 520], [900, 760]]) for (const locale of ['en', 'zh-CN', 'de', 'ar']) {
        const label = `${width}x${height}/${locale}/project-delete`;
        if (onlyCase && label !== onlyCase) continue; matchedCases++;
        await page.setViewport({ width, height });
        await page.goto(`${origin}/?${new URLSearchParams({ kind: 'project', locale })}`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-project-delete-checkbox');
        const layout = await page.evaluate(() => {
            const dialog = document.querySelector('.nmx-project-delete-dialog'), label = dialog.querySelector('.nmx-project-delete-checkbox');
            const input = label.querySelector('input'), text = label.querySelector('span');
            const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
            return { direction: getComputedStyle(label).flexDirection, dialog: rect(dialog), input: rect(input), text: rect(text),
                checked: input.checked, cancelFocused: dialog.querySelector('footer button') === document.activeElement };
        });
        assert.equal(layout.direction, 'row', `${label}: inherited column stacks the checkbox above its text`);
        assert.equal(layout.checked, false, `${label}: deletion must remain opt-in`);
        assert.equal(layout.cancelFocused, true, `${label}: Cancel must hold default focus`);
        assert.ok(Math.abs(layout.input.top - layout.text.top) <= 4, `${label}: checkbox is not beside the first text line`);
        assert.ok(layout.input.width >= 15 && layout.input.width <= 17, `${label}: checkbox shrank`);
        assert.ok(locale === 'ar' ? layout.input.left >= layout.text.right + 7 : layout.text.left >= layout.input.right + 7, `${label}: checkbox/text overlap`);
        assert.ok(layout.dialog.left >= 0 && layout.dialog.right <= width, `${label}: dialog overflows`);
        await page.click('.nmx-project-delete-checkbox input');
        assert.equal(await page.$eval('.nmx-project-delete-checkbox input', node => node.checked), true);
        await page.click('.nmx-project-delete-dialog footer button:first-child');
        assert.deepEqual(await page.evaluate(() => window.fixture.calls), ['cancel'], `${label}: no delete handler should run`);
        projectCases.push(label);
    }
    assert.deepEqual(errors, []);
    t.diagnostic(`${projectCases.length} project-delete checkbox/focus/RTL layouts passed: ${projectCases.join(', ')}`);
    assert.ok(matchedCases > 0, `No layout matched ${onlyCase || 'the full matrix'}`);
});
