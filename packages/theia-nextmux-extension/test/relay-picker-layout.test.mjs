import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
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
const locales = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

async function fixtureBundle() {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = ['relayOptionIsFull', 'relayOptions', 'relayOption', 'relayPickerOptions', 'loadPublicMerchantPage', 'loadNextPublicMerchantPage',
        'handlePublicMerchantScroll', 'setRelaySortMode', 'setRelaySourceTab', 'setRelaySourceQuery',
        'toggleFavoriteMerchant', 'toggleFavoriteMerchantById', 'calculateModelPickerPlacement', 'renderRelayPopover', 'renderRelayPickerPortal']
        .map(name => {
            const node = widget.members.find(value => ts.isMethodDeclaration(value) && value.name.getText(file) === name);
            assert.ok(node, `production method ${name}`); return node.getText(file);
        }).join('\n');
    const entry = `import * as React from 'react'; import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import { filterRelayPickerSources, relayMetricSignal, relayMeasurementExplanation, relayMultiplierText, serializeRelayFavoriteMerchants } from './nextmux-relay-picker';
import { relayDelistedText, relayText } from './nextmux-relay-locale';
import { relayMerchantIsFull } from '../common/nextmux-relay-capacity';
const RelayCapacityRefresh = () => null; // Layout fixture has no live capacity endpoint; dedicated capacity tests cover polling.
import { modelCenterText } from './nextmux-model-center-locale';
import { relayEvidenceText, relayAvailabilityText } from './nextmux-relay-marketplace-locale';
import { modelUsageText } from './nextmux-model-usage-locale';
import { relayMerchantNumber } from './nextmux-relay-marketplace';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { SurfaceTooltips } from './nextmux-surface-tooltips';
import { formatBalanceMicros } from './nextmux-money-format';
import { desktopText } from './nextmux-locale';
import { averageRelayAvailability, averageRelayLatency, latestRelayLatency, measuredRelayAuthenticity, measuredRelayLatency, measuredRelayQuality } from '../common/nextmux-relay-evidence';
import { managedRelayKey, officialConnectionRelayKey } from './nextmux-model-route-selection';
import { officialInvokableModelIds } from './nextmux-official-discovery';
import { isOfficialMediaProtocol } from '@nextmux/model-runtime/presets';
import { placeAnchoredFloatingPanel, placeModelPickerPanels } from './nextmux-floating-panel';
import { averageMultiplierBps, offeringMultiplierBps, offeringPriceText } from './nextmux-offering-price';
const params = new URLSearchParams(location.search), count = Number(params.get('count'));
const RELAY_FAVORITES_STORAGE_KEY = 'isolated-relay-layout-favorites';
class FixtureWidget {
    desktopLocale = params.get('locale'); theme = params.get('theme');
    activeSection = 'coding'; activeRelayKey = 'managed:synthetic-0'; relaySourceTab = 'merchant'; relaySourceQuery = '';
    relaySortMode = 'quality'; favoriteMerchantLabels = new Map(); modelPickerRelayOpen = true; codingPopover = 'routes';
    terminalDrawerOpen = false; node = document.getElementById('fixture-anchor');
    officialModels = { connections: [
        { id: 'synthetic-official', label: 'Synthetic official API', providerId: 'openai', providerName: 'OpenAI',
            model: 'synthetic/model', discoveredModels: [], status: 'verified', toolCapability: 'verified', lastLatencyMs: 125 },
        { id: 'synthetic-custom', label: 'Synthetic custom compatible API', providerId: 'custom', providerName: 'Compatible',
            model: 'synthetic/model', discoveredModels: [], status: 'unverified', lastLatencyMs: 1234 }
    ] };
    platformSession = { linked: false }; publicMerchantPageRequest = 0; publicMerchantSearchTimer = 0;
    publicMerchantPageLoading = false; publicMerchantPageError = false; completedRequests = 0; selectionCalls = [];
    platformService = { getPublicMerchantDirectory: async ({ query = '', merchantIds }) => {
        if (!merchantIds) await new Promise(resolve => { this.releaseDirectory = resolve; }); this.completedRequests++;
        if (this.failNext) { this.failNext = false; throw new Error('Synthetic directory error'); }
        return { measuredAt: '2026-09-07T00:00:00Z', merchants: Array.from({ length: count }, (_, index) => ({
            id: 'synthetic-' + index, name: index === 1 ? 'VeryLongSyntheticMerchant世界المورد'.repeat(4) : 'Synthetic Merchant ' + index,
            metrics: index === 16 ? {} : index === 2 ? { quality: 60, authenticity: 80, latencyMs: 1500, multiplierBps: 12500 }
                : index === 3 ? { quality: 20, authenticity: 50, latencyMs: 5000, multiplierBps: 25000 }
                : index === 4 ? { quality: 0, authenticity: 0, latencyMs: 0, multiplierBps: 0 }
                : { quality: 90, authenticity: 99, latencyMs: index === 17 ? 9876543 : index === 1 ? 1234 : 125 + index,
                    multiplierBps: index < 2 ? 250 : 10000 }
        })).filter(row => (!merchantIds || merchantIds.includes(row.id)) && [row.id, row.name].join(' ').toLowerCase().includes(query.toLowerCase())) };
    } };
    managedOfferings() { return []; } offeringMerchantId(value) { return value.merchantId; }
    resolvedDesktopTheme() { return this.theme; } tx(key) { return desktopText(this.desktopLocale, key); }
    closeNavigationSurface() {} selectRelay(key) { this.selectionCalls.push(key); throw new Error('Layout fixture must not execute or change a real route'); }
    update() { root.render(this.renderRelayPickerPortal()); }
    ${methods}
}
const root = createRoot(document.getElementById('fixture')), instance = new FixtureWidget(); window.fixture = instance;
window.expectedMultiplier = relayMultiplierText(instance.desktopLocale, 250); window.expectedDelisted = relayDelistedText(instance.desktopLocale);
// The real app sets direction on its widget, not the document. Body portals must own their direction.
document.documentElement.dir = 'ltr'; instance.node.dir = instance.desktopLocale === 'ar' ? 'rtl' : 'ltr';
document.documentElement.dataset.theme = instance.theme;
instance.update(); void instance.loadPublicMerchantPage().then(() => { window.fixtureDirectoryReady = true; });`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx',
        resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'isolated-relay-layout-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    return outputFiles[0].contents;
}

test('actual async relay directory stays compact and legible in twelve locales, both themes and narrow/large/short windows', { timeout: 300000 }, async t => {
    const assets = {
        '/fixture.js': ['text/javascript', await fixtureBundle()],
        '/style.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux.css', import.meta.url))],
        '/production.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url))],
        '/pickers.css': ['text/css', await readFile(new URL('../src/browser/style/nextmux-pickers-settings.css', import.meta.url))],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))],
        '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'><link rel='stylesheet' href='/pickers.css'>
<style>html,body{margin:0;width:100%;height:100%;font:13px system-ui;background:#151515}*{box-sizing:border-box}
html[data-theme=light],html[data-theme=light] body{background:#f1efed;color-scheme:light}
.fixture-trigger{position:fixed;bottom:12px;left:16px;height:32px;width:120px}.fixture-titlebar{height:40px}</style>
</head><body><div id='fixture-anchor'><div class='nmx-titlebar-primary-nav fixture-titlebar'></div><button class='nmx-composer-relay-button fixture-trigger'>Synthetic source</button></div><div id='fixture'></div><script src='/fixture.js'></script></body></html>`],
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
    const browser = await puppeteer.launch({ headless: true }); // Temporary profile, no real desktop/account.
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = [], cases = [], sourceCases = [], stateCases = [];
    let currentCase = 'initializing';
    t.after(() => t.diagnostic(`Completed ${cases.length}/144 layouts, ${sourceCases.length}/32 source checks and ${stateCases.length}/16 journeys; last case: ${currentCase}`));
    page.on('pageerror', error => { errors.push(error.message); t.diagnostic(`Browser error: ${error.message}`); });
    await page.setRequestInterception(true);
    page.on('request', request => { if (new URL(request.url()).origin === origin) void request.continue(); else { errors.push('external request blocked'); void request.abort(); } });
    for (const [width, height] of [[320, 680], [900, 760], [640, 360]]) for (const locale of locales) for (const theme of ['dark', 'light']) for (const count of [2, 18]) {
        const label = `${width}x${height}/${locale}/${theme}/${count} merchants`;
        currentCase = label;
        await page.setViewport({ width, height });
        await page.goto(`${origin}/?${new URLSearchParams({ locale, theme, count: String(count) })}`, { waitUntil: 'load' });
        // Hold the synthetic response until the real loading renderer is present. A selector miss or 0-row result cannot pass.
        await page.waitForFunction(() => window.fixture?.publicMerchantPageLoading && typeof window.fixture.releaseDirectory === 'function'
            && document.querySelector('.nmx-relay-loading-center .codicon-modifier-spin'));
        assert.equal(await page.$$eval('[data-relay-key]', rows => rows.length), 0, `${label}: before directory response`);
        await page.evaluate(() => window.fixture.releaseDirectory());
        await page.waitForFunction(expected => window.fixtureDirectoryReady === true && window.fixture.completedRequests === 1
            && !window.fixture.publicMerchantPageLoading && !window.fixture.publicMerchantPageError
            && window.fixture.publicMerchantPage?.merchants.length === expected
            && document.querySelectorAll('[data-relay-key]').length === expected, {}, count);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const layout = await page.evaluate(() => {
            const panel = document.querySelector('.nmx-relay-picker-popover'), list = panel.querySelector('.nmx-relay-options');
            const panelStyle = getComputedStyle(panel);
            const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
            const rows = [...list.querySelectorAll('[data-relay-key]')].map(row => ({ ...rect(row), key: row.dataset.relayKey,
                name: { ...rect(row.querySelector('strong')), text: row.querySelector('strong').textContent, title: row.querySelector('strong').getAttribute('aria-label'), nativeTitle: row.querySelector('strong').title },
                metrics: [...row.querySelectorAll('[data-relay-metric]')].map(cell => ({ ...rect(cell), kind: cell.dataset.relayMetric,
                    title: cell.getAttribute('aria-label'), nativeTitle: cell.title, text: cell.textContent, accessible: cell.getAttribute('aria-label'), level: Number(cell.dataset.signalLevel),
                    color: getComputedStyle(cell).color, cursor: getComputedStyle(cell).cursor, svg: rect(cell.querySelector('svg')), glyph: rect(cell.querySelector('.codicon')), value: rect(cell.querySelector('.nmx-relay-metric-value')),
                    circles: [...cell.querySelectorAll('circle')].map(circle => ({ track: circle.classList.contains('nmx-relay-dial-track'),
                        pathLength: circle.getAttribute('pathLength'), arc: circle.getAttribute('stroke-dasharray'),
                        color: getComputedStyle(circle).stroke, fill: getComputedStyle(circle).fill, opacity: getComputedStyle(circle).opacity })) })),
                favorite: row.parentElement.querySelector('[data-relay-favorite]') && rect(row.parentElement.querySelector('[data-relay-favorite]')),
            }));
            const controls = [...panel.querySelectorAll('[role=tab], [data-relay-sort]')].map(node => ({ ...rect(node),
                text: node.textContent, title: node.title, kind: node.dataset.relaySort ? 'sort' : 'tab',
                labelRect: rect(node.querySelector('span') || node), labelClip: getComputedStyle(node.querySelector('span') || node).clip,
                iconRect: node.querySelector('i') && rect(node.querySelector('i')),
                metric: node.dataset.relaySort,
                accessible: node.getAttribute('aria-label') || node.title,
                active: node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true',
                background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, shadow: getComputedStyle(node).boxShadow }));
            return { panel: rect(panel), maxHeight: parseFloat(panel.style.maxHeight), list: { ...rect(list), client: list.clientHeight, scroll: list.scrollHeight }, rows, controls,
                colors: { background: panelStyle.backgroundColor, borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => panelStyle[`border${side}Color`]),
                    borderWidths: ['Top', 'Right', 'Bottom', 'Left'].map(side => panelStyle[`border${side}Width`]),
                    contentBackground: getComputedStyle(panel.querySelector('.nmx-relay-popover')).backgroundColor },
                repeatedHeader: Boolean(panel.querySelector(':scope > header')), direction: getComputedStyle(panel).direction,
                language: panel.closest('[lang]')?.lang, documentDirection: document.documentElement.dir,
                expectedMultiplier: window.expectedMultiplier, pageWidth: document.documentElement.scrollWidth, footerDisplay: getComputedStyle(panel.querySelector('.nmx-relay-directory-page')).display };
        });
        assert.equal(layout.rows.length, count, `${label}: exact nonzero rows required`);
        assert.ok(count > 0 && layout.list.height > 0, `${label}: empty/collapsed list must fail`);
        assert.ok(layout.panel.left >= 8 && layout.panel.right <= width - 8 && layout.panel.top >= 46 && layout.panel.bottom <= height - 8, `${label}: safe viewport`);
            assert.equal(layout.panel.width, Math.min(264, width - 16), `${label}: provider drawer matches the model drawer width`);
        assert.equal(layout.repeatedHeader, false, `${label}: source tabs replace the repeated outer title`);
        assert.equal(layout.documentDirection, 'ltr', `${label}: fixture must not globally repair portal direction`);
        assert.equal(layout.direction, locale === 'ar' ? 'rtl' : 'ltr', `${label}: body portal owns its correct direction`);
        assert.equal(layout.language, locale, `${label}: body portal owns its locale`);
        const expectedBackground = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(37, 36, 39)';
        const expectedBorder = theme === 'light' ? 'rgb(215, 206, 219)' : 'rgb(81, 75, 86)';
        assert.equal(layout.colors.background, expectedBackground, `${label}: computed surface must use the new palette, not an overridden CSS variable`);
        assert.equal(layout.colors.contentBackground, expectedBackground, `${label}: inner content must not paint the old palette over the surface`);
        assert.deepEqual(layout.colors.borders, Array(4).fill(expectedBorder), `${label}: all computed border colors must use the new palette`);
        assert.ok(layout.colors.borderWidths.every(value => parseFloat(value) > 0), `${label}: theme border must actually be painted`);
        assert.ok(layout.pageWidth <= width, `${label}: horizontal page overflow`);
        assert.equal(layout.footerDisplay, 'none', `${label}: no blank directory footer`);
        assert.equal(layout.controls.length, 7, `${label}: three tabs plus four metric sort controls`);
        assert.equal(layout.controls.filter(control => control.active).length, 2, `${label}: active tab and sort remain apparent`);
        for (const control of layout.controls) {
            assert.ok(control.width > 0 && control.height >= 24 && control.height <= 36, `${label}: compact nonzero controls`);
            assert.ok(control.left >= layout.panel.left && control.right <= layout.panel.right, `${label}: controls overflow`);
            assert.ok(control.accessible, `${label}: compact controls keep localized accessible labels`);
            if (control.kind === 'sort') {
                assert.equal(control.height, 32, `${label}: flat labels retain compact hit targets`);
                assert.ok(control.width >= 60 && control.text.trim() && control.iconRect.width >= 12 && control.iconRect.height >= 12,
                    `${label}: all four flat sorting icons must actually be visible with localized names`);
            }
        }
        const sorts = layout.controls.filter(control => control.kind === 'sort');
        assert.ok(sorts.every(control => Math.abs(control.width - sorts[0].width) <= 1 && control.top === sorts[0].top), `${label}: four equal flat columns`);
        assert.ok(Math.abs(Math.min(...sorts.map(control => control.left)) - layout.list.left) <= 3
            && Math.abs(Math.max(...sorts.map(control => control.right)) - layout.list.right) <= 3, `${label}: sort labels span the source list`);
        const activeTab = layout.controls.find(control => control.kind === 'tab' && control.active);
        const inactiveTab = layout.controls.find(control => control.kind === 'tab' && !control.active);
        assert.notEqual(activeTab.shadow, inactiveTab.shadow, `${label}: selected tab has a distinct underline`);
        assert.match(activeTab.shadow, /-2px.*inset|inset.*-2px/, `${label}: selected tab keeps the thin inset underline`);
        for (const row of layout.rows) {
            assert.equal(row.height, 32, `${label}: one compact merchant row`);
            assert.ok(row.name.width > 0 && row.name.title.includes(row.name.text), `${label}: full name remains in tooltip`);
            assert.equal(row.name.nativeTitle, '', `${label}: name does not create a duplicate native tooltip`);
            assert.equal(row.metrics.length, 4, `${label}: all four metrics present`);
            assert.ok(row.name.width >= row.width * .30, `${label}: compact metrics should leave at least 30% for the merchant name (${row.name.width}/${row.width})`);
            assert.ok(row.favorite && row.favorite.width >= 18 && row.favorite.height >= 24, `${label}: favorite remains a usable separate target`);
            const index = Number(row.key.split('-').at(-1));
            const expectedLevels = index === 16 ? [0, 0, 0, 0] : index === 2 ? [3, 3, 3, 3] : index === 3 ? [1, 1, 1, 1]
                : index === 4 ? [1, 1, 5, 5] : [5, 5, index === 17 ? 1 : index === 1 ? 3 : 5, index < 2 ? 5 : 4];
            assert.deepEqual(row.metrics.map(metric => metric.kind), ['quality', 'authenticity', 'latency', 'price'], `${label}: fixed semantic column order`);
            assert.deepEqual(row.metrics.map(metric => metric.level), expectedLevels, `${label}: actual measurement bands for ${row.key}`);
            for (const [metricIndex, metric] of row.metrics.entries()) {
                assert.ok(metric.width > 0 && metric.left >= row.left && metric.right <= row.right, `${label}: metric horizontally outside row`);
                assert.ok(metric.width >= 30, `${label}: metric column remains legible`);
                assert.equal(metric.height, 24, `${label}: every dial has the same 24px target`);
                assert.equal(metric.svg.width, 0, `${label}: obsolete dial is hidden`); assert.equal(metric.svg.height, 0, label);
                assert.ok(metric.text.trim().length > 0 && metric.value.width > 0 && metric.value.height > 0, `${label}: exact value is rendered in its column`);
                assert.ok(metric.value.left >= metric.left - 1 && metric.value.right <= metric.right + 1, `${label}: value stays inside its metric cell`);
                assert.equal(metric.accessible, metric.title, `${label}: precise accessible measurement matches hover title`);
                assert.equal(metric.nativeTitle, '', `${label}: metrics use one portal tooltip, not a duplicate system tooltip`);
                assert.equal(metric.cursor, 'default', `${label}: non-actionable metrics retain the normal cursor`);
                const tone = metric.level === 0 ? 'unknown' : metric.level >= 4 ? 'good' : metric.level === 3 ? 'medium' : 'poor';
                const colors = theme === 'light' ? { unknown: 'rgb(116, 107, 122)', good: 'rgb(24, 134, 108)', medium: 'rgb(167, 103, 31)', poor: 'rgb(182, 69, 81)' }
                    : { unknown: 'rgb(170, 165, 175)', good: 'rgb(31, 188, 155)', medium: 'rgb(228, 166, 83)', poor: 'rgb(222, 108, 119)' };
                assert.equal(metric.color, colors[tone], `${label}: ${metric.kind} actually paints the measured ${tone} color`);
                if (metricIndex) assert.ok(Math.abs(metric.width - row.metrics[metricIndex - 1].width) <= 1, `${label}: four value columns have equal widths`);
                if (row.key === 'managed:synthetic-17' && metric.kind === 'latency') assert.ok(metric.title.includes('9876543') || metric.title.includes('9,876,543'), `${label}: extreme latency remains available in tooltip`);
                assert.ok(metric.right <= row.favorite.left + 1 || metric.left >= row.favorite.right - 1, `${label}: ${metric.kind} overlaps favorite target`);
            }
        }
        const small = layout.rows.find(row => row.key === 'managed:synthetic-0').metrics.find(metric => metric.kind === 'price');
        assert.ok(small.title.includes(layout.expectedMultiplier), `${label}: accessible full multiplier`);
        await page.hover('[data-relay-key="managed:synthetic-0"] [data-relay-metric="price"]');
        await page.waitForSelector('.nmx-relay-metric-tooltip');
        const tooltip = await page.$eval('.nmx-relay-metric-tooltip', node => ({ direction: getComputedStyle(node).direction, language: node.lang,
            text: node.textContent, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
        assert.equal(tooltip.direction, locale === 'ar' ? 'rtl' : 'ltr', `${label}: sibling metric portal must not inherit LTR from body`);
        assert.equal(tooltip.language, locale, `${label}: metric tooltip locale`);
        assert.ok(tooltip.text.includes(layout.expectedMultiplier), `${label}: full multiplier available in real hover portal`);
        assert.ok(tooltip.left >= 8 && tooltip.right <= width - 8, `${label}: tooltip stays within viewport`);
        await page.mouse.move(width - 1, 0);
        if (count === 2 && width === 320 && ['en', 'ar'].includes(locale)) {
            await page.focus('[data-relay-key="managed:synthetic-0"]');
            await page.waitForSelector('.nmx-relay-metric-tooltip');
            const keyboardTooltip = await page.$eval('.nmx-relay-metric-tooltip', node => ({ text: node.textContent, direction: getComputedStyle(node).direction }));
            assert.equal(keyboardTooltip.text.split('\n').length, 4, `${label}: row focus exposes every exact measurement`);
            assert.ok(keyboardTooltip.text.includes(layout.expectedMultiplier) && keyboardTooltip.text.includes('125'), `${label}: keyboard users retain full price and latency precision`);
            assert.equal(keyboardTooltip.direction, locale === 'ar' ? 'rtl' : 'ltr', `${label}: focused tooltip owns its direction`);
            assert.deepEqual(await page.evaluate(() => window.fixture.selectionCalls), [], `${label}: inspecting metrics cannot choose a source`);
            await page.keyboard.press('Tab');
        }
        if (count === 2) {
            assert.ok(layout.panel.height === Math.min(300, layout.maxHeight), `${label}: two merchants keep the restored drawer height (${layout.panel.height}px)`);
            assert.ok(layout.list.scroll <= layout.list.client + 1, `${label}: two merchants have unnecessary scrolling: panel=${layout.panel.height}, list=${layout.list.client}, scroll=${layout.list.scroll}, rows=${layout.rows.map(row => row.height)}`);
            assert.ok(layout.rows.every(row => row.top >= layout.list.top && row.bottom <= layout.list.bottom + 1), `${label}: short list clipped`);
        } else {
            assert.ok(layout.panel.height <= layout.maxHeight, `${label}: a large directory remains in available height`);
            // Content height can fit on a large screen; narrower/shorter screens must scroll internally.
            if (height < 700) assert.ok(layout.list.scroll > layout.list.client, `${label}: clipped directory must scroll internally`);
            const before = await page.$eval('.nmx-relay-sort', node => node.getBoundingClientRect().top);
            await page.$eval('.nmx-relay-options', node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
            assert.equal(await page.$eval('.nmx-relay-options', node => node.scrollTop > 0), layout.list.scroll > layout.list.client, `${label}: results actually scroll when necessary`);
            assert.equal(await page.$eval('.nmx-relay-sort', node => node.getBoundingClientRect().top), before, `${label}: controls must not scroll away`);
        }
        cases.push({ case: label, height: layout.panel.height, list: layout.list.client, scroll: layout.list.scroll });
        if (count === 2 && width !== 640 && ['zh-CN', 'en', 'de', 'ar'].includes(locale)) {
            // A stored next page belongs only to the public directory, not favorite/private API chrome.
            await page.evaluate(() => { window.fixture.publicMerchantPage = { ...window.fixture.publicMerchantPage, nextCursor: 'synthetic-next' }; window.fixture.update(); });
            // Exercise real handlers, not fixture-only tab or favorite mutations.
            for (const id of ['synthetic-0', 'synthetic-1']) await page.click(`[data-relay-favorite="${id}"]`);
            assert.deepEqual(await page.evaluate(() => window.fixture.selectionCalls), [], `${label}: favoriting must not select a source`);
            assert.equal(await page.evaluate(() => window.fixture.activeRelayKey), 'managed:synthetic-0', label);
            assert.equal(await page.evaluate(() => window.fixture.favoriteMerchantLabels.size), 2, `${label}: both favorites persisted`);
            await page.focus('[data-relay-source-tab="merchant"]');
            await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight');
            await page.waitForFunction(() => window.fixture.relaySourceTab === 'favorite' && document.querySelectorAll('[data-relay-key]').length === 2);
            for (const tab of ['favorite', 'my-api']) {
                if (tab === 'my-api') await page.keyboard.press('End');
                await page.waitForFunction(expected => window.fixture.relaySourceTab === expected
                    && document.querySelector(`[data-relay-source-tab="${expected}"]`)?.getAttribute('aria-selected') === 'true'
                    && document.querySelectorAll('[data-relay-key]').length === 2, {}, tab);
                await page.waitForFunction(() => document.querySelectorAll('[data-relay-key]').length === 2);
                const density = await page.evaluate(() => {
                    const panel = document.querySelector('.nmx-relay-picker-popover'), list = panel.querySelector('.nmx-relay-options');
                    return { panelHeight: panel.getBoundingClientRect().height, width: panel.getBoundingClientRect().width,
                        heights: [...list.querySelectorAll('[data-relay-key]')].map(node => node.getBoundingClientRect().height),
                        scroll: list.scrollHeight, client: list.clientHeight, sorts: panel.querySelectorAll('[data-relay-sort]').length,
                        activeTab: document.activeElement?.getAttribute('data-relay-source-tab'),
                        keys: [...list.querySelectorAll('[data-relay-key]')].map(node => node.dataset.relayKey),
                        own: [...list.querySelectorAll('[data-relay-key]')].map(row => row.querySelector('.nmx-relay-option-metrics.is-own')?.textContent ?? null),
                        dials: [...list.querySelectorAll('[data-relay-key]')].map(row => [...row.querySelectorAll('[data-relay-metric]')].map(node => ({
                            kind: node.dataset.relayMetric, level: node.dataset.signalLevel, width: node.getBoundingClientRect().width,
                            height: node.getBoundingClientRect().height, left: node.getBoundingClientRect().left,
                            title: node.getAttribute('aria-label'), accessible: node.getAttribute('aria-label') }))) };
                });
                assert.deepEqual(density.heights, [32, 32], `${label}/${tab}: same two-row density`);
            assert.equal(density.width, Math.min(264, width - 16), `${label}/${tab}: same drawer width as model picker`);
                assert.ok(density.panelHeight === 300, `${label}/${tab}: source tabs share the restored drawer height`);
                assert.ok(density.scroll <= density.client + 1, `${label}/${tab}: no unnecessary scrolling`);
                assert.equal(density.sorts, 0, `${label}/${tab}: no merchant sort on private/favorite tab`);
                assert.equal(density.activeTab, tab, `${label}/${tab}: roving keyboard focus follows selection`);
                for (const dials of density.dials) {
                    // An own API has no market score or price: it shows its authenticity and measured speed in the same dial columns.
                    assert.equal(dials.length, tab === 'my-api' ? 2 : 4, `${label}/${tab}: relays show four dial columns, own APIs two`);
                    if (tab === 'my-api') assert.deepEqual(dials.map(dial => dial.kind), ['authenticity', 'latency'], `${label}: own API columns`);
                    for (const [index, dial] of dials.entries()) {
                        assert.ok(dial.width >= 30, label); assert.equal(dial.height, 24, label);
                        assert.equal(dial.accessible, dial.title, `${label}/${tab}: exact data remains available`);
                        if (index) assert.ok(Math.abs(dial.width - dials[index - 1].width) <= 1, `${label}/${tab}: equal column spacing`);
                    }
                }
                if (tab === 'my-api') assert.ok(density.own.every(text => typeof text === 'string' && /\d/.test(text) && !/models?|模型/i.test(text)),
                    `${label}: personal APIs show their measured speed, no model count and no market quality or price`);
                sourceCases.push(`${label}/${tab}`);
            }
            // A successful favorites refresh with no matching merchant confirms
            // that the saved provider has left the public directory. Its local
            // name remains visible, selection is disabled, and the star still
            // provides the only removal action.
            await page.click('[data-relay-source-tab="favorite"]');
            await page.waitForFunction(() => window.fixture.relaySourceTab === 'favorite' && document.querySelectorAll('[data-relay-key]').length === 2);
            await page.evaluate(() => { window.fixture.favoriteMerchantPage = { merchants: [] }; window.fixture.update(); });
            await page.waitForFunction(() => [...document.querySelectorAll('[data-relay-key]')].every(node => node.hasAttribute('disabled')));
            assert.equal(await page.$$('.nmx-relay-option-row.is-unavailable [data-relay-key]').then(nodes => nodes.length), 2, `${label}: stale favorites are marked unavailable`);
            const delisted = await page.$$eval('.nmx-relay-option-row.is-unavailable', rows => rows.map(row => {
                const badge = row.querySelector('[data-relay-delisted]'), box = badge?.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
                return { text: badge?.textContent, inside: Boolean(box) && box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1 && box.width > 0,
                    star: Boolean(row.querySelector('[data-relay-favorite]:not([disabled])')) };
            }));
            assert.ok(delisted.every(row => row.text && row.inside && row.star), `${label}: visible delisted badge with a remove-favorite star ${JSON.stringify(delisted)}`);
            assert.equal(delisted[0].text, await page.evaluate(() => window.expectedDelisted));
            if (['zh-CN', 'en'].includes(locale) && count === 2) await page.screenshot({ path: `/tmp/nm-shots/pickers/relay-delisted-${theme}-${locale}-${width}x${height}.png` });
            await page.evaluate(() => {
                window.fixture.favoriteMerchantPage = { merchants: [
                    { id: 'synthetic-0', name: 'Synthetic Merchant 0' },
                    { id: 'synthetic-1', name: 'VeryLongSyntheticMerchant世界المورد'.repeat(4) }
                ] };
                window.fixture.update();
            });
            await page.waitForFunction(() => [...document.querySelectorAll('[data-relay-key]')].every(node => !node.hasAttribute('disabled')));
            await page.click('[data-relay-source-tab="favorite"]');
            await page.waitForFunction(() => document.querySelectorAll('[data-relay-favorite]').length === 2);
            await page.click('[data-relay-favorite="synthetic-0"]');
            await page.waitForFunction(() => document.querySelectorAll('[data-relay-key]').length === 1);
            await page.click('[data-relay-favorite="synthetic-1"]');
            await page.waitForFunction(() => window.fixture.favoriteMerchantLabels.size === 0
                && document.querySelectorAll('[data-relay-key]').length === 0 && document.querySelector('.nmx-relay-options [role=status]'));
            assert.deepEqual(await page.evaluate(() => window.fixture.selectionCalls), [], `${label}: removal never selects a source`);
            await page.click('[data-relay-source-tab="merchant"]');
            await page.waitForFunction(() => window.fixture.publicMerchantPageLoading);
            await page.evaluate(() => { window.fixture.failNext = true; window.fixture.releaseDirectory(); });
            await page.waitForFunction(() => window.fixture.publicMerchantPageError && !window.fixture.publicMerchantPageLoading
                && document.querySelector('.nmx-relay-directory-page button'));
            assert.equal(await page.$$eval('.nmx-relay-options .nmx-route-empty', nodes => nodes.length), 0, `${label}: failure is not an empty directory`);
            await page.click('.nmx-relay-directory-page button');
            await page.waitForFunction(() => window.fixture.publicMerchantPageLoading && !window.fixture.publicMerchantPageError);
            await page.evaluate(() => window.fixture.releaseDirectory());
            await page.waitForFunction(() => !window.fixture.publicMerchantPageLoading && !window.fixture.publicMerchantPageError
                && document.querySelectorAll('[data-relay-key]').length === 2);
            await page.type('.nmx-relay-source-search input', 'no-synthetic-match');
            await page.waitForFunction(() => window.fixture.publicMerchantSearchTimer === 0 && window.fixture.publicMerchantPageLoading
                && window.fixture.relaySourceQuery === 'no-synthetic-match');
            await page.evaluate(() => window.fixture.releaseDirectory());
            await page.waitForFunction(() => !window.fixture.publicMerchantPageLoading && !window.fixture.publicMerchantPageError
                && window.fixture.publicMerchantPage?.merchants.length === 0
                && document.querySelectorAll('[data-relay-key]').length === 0 && document.querySelector('.nmx-relay-options [role=status]'));
            assert.deepEqual(await page.evaluate(() => window.fixture.selectionCalls), [], `${label}: retry/search never select a source`);
            stateCases.push(`${label}/favorite-empty/directory-error/retry/search-empty`);
        }
    }
    assert.equal(cases.length, 144); assert.deepEqual(errors, []);
    assert.equal(sourceCases.length, 32); assert.equal(stateCases.length, 16);
    t.diagnostic(`144 actual async renderer/CSS layouts plus 32 favorite/API layouts and 16 state/keyboard journeys passed; locales=${locales.join(', ')}; four equal value columns, four full-width sort labels, measured tones and precise hover, 2/18 merchants, dark/light, 320x680/900x760/640x360.`);
});
