import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
async function productMethods() {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const names = ['relayOptionIsFull', 'relayOptions', 'relayOption', 'relayPickerOptions', 'toggleFavoriteMerchant', 'toggleFavoriteMerchantById', 'setRelaySourceQuery', 'loadPublicMerchantPage', 'loadNextPublicMerchantPage', 'handlePublicMerchantScroll', 'setRelaySortMode', 'setRelaySourceTab', 'toggleComposerRelayPicker',
        'calculateModelPickerPlacement', 'renderRelayPopover', 'renderRelayPickerPortal'];
    const methods = names.map(name => {
        const method = widget?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
        if (!method) throw new Error(`Production method missing: ${name}`);
        return method.getText(file);
    }).join('\n');
    return `import * as React from 'react'; import * as ReactDOM from 'react-dom';
import { filterRelayPickerSources, relayMetricSignal, relayMeasurementExplanation, relayMultiplierTag, relayMultiplierText, relayPercentText, serializeRelayFavoriteMerchants } from './nextmux-relay-picker';
import { relayText } from './nextmux-relay-locale';
import { relayMerchantIsFull } from '../common/nextmux-relay-capacity';
const RelayCapacityRefresh = () => null; // Layout fixture has no live capacity endpoint; dedicated capacity tests cover polling.
import { relayEvidenceText, relayAvailabilityText } from './nextmux-relay-marketplace-locale';
import { modelUsageText } from './nextmux-model-usage-locale';
import { modelCenterText } from './nextmux-model-center-locale';
import { relayMerchantNumber } from './nextmux-relay-marketplace';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { averageRelayAvailability, averageRelayLatency, INITIAL_RELAY_QUALITY, latestRelayLatency, measuredRelayAuthenticity, measuredRelayLatency, measuredRelayQuality, relayFeedbackVotes } from '../common/nextmux-relay-evidence';
import { managedRelayKey, officialConnectionRelayKey } from './nextmux-model-route-selection';
import { officialInvokableModelIds } from './nextmux-official-discovery';
import { placeAnchoredFloatingPanel } from './nextmux-floating-panel';
import { averageMultiplierBps, offeringMultiplierBps, offeringPriceText } from './nextmux-offering-price';
import { FavoriteHeartIcon } from './nextmux-favorite-icon';
export class RelayWidgetFixture {
    static FAVORITES_KEY = 'nextmux.desktop.favoriteMerchants.v1';
    activeSection = 'coding'; activeRelayKey = ''; relaySourceTab = 'merchant'; relaySourceQuery = '';
    relaySortMode = 'quality'; desktopLocale = 'zh-CN'; theme = 'dark'; terminalDrawerOpen = false;
    favoriteMerchantLabels = new Map();
    modelPickerRelayOpen = true; codingPopover = 'routes'; node = null;
    platformSession = { linked: false }; publicMerchantPageRequest = 0; publicMerchantSearchTimer = 0;
    publicMerchantPageLoading = false; publicMerchantPageError = false;
    publicMerchantPage = { merchants: this.syntheticPublicMerchants(), measuredAt: new Date().toISOString() };
    platformService = { getPublicMerchantDirectory: async ({ query = '' }) => ({
        merchants: this.syntheticPublicMerchants().filter(row => [row.id, row.name, relayMerchantNumber(row.id)].join(' ').toLowerCase().includes(query.toLowerCase())),
        measuredAt: new Date().toISOString()
    }) };
    syntheticPublicMerchants() { return [...this.managedOfferings().map(row => ({ id: row.merchantId, name: row.providerName })),
      { id: 'fixture-no-offering', name: 'Public merchant · No models yet' }]; }
    tx(key) { return key; }
    officialModels = { connections: [
      { id: 'fixture-official-one', label: 'Official BYOK · Synthetic', providerId: 'openai', providerName: 'OpenAI',
        model: 'synthetic-model', discoveredModels: [], status: 'verified', toolCapability: 'verified', lastLatencyMs: 150 },
      { id: 'fixture-custom-two', label: 'Custom compatible · Synthetic', providerId: 'custom', providerName: 'Compatible',
        model: 'synthetic-model', discoveredModels: [], status: 'unverified' }
    ] };
    managedOfferings() { return Array.from({ length: 18 }, (_, index) => ({
      merchantId: 'fixture-merchant-' + String(index + 1).padStart(2, '0'),
      providerName: index === 0 ? 'Atlas Synthetic' : index === 1 ? 'OpenRouter Synthetic' : index === 2
        ? 'VeryLongMerchantNameForNarrowWindowAndUnicode世界المورد'.repeat(3) : 'Synthetic relay ' + String(index + 1).padStart(2, '0'),
      routeScore: 50 + (index * 7) % 50, likes: index * 3, dislikes: index,
      network: { availability: .80 + ((index * 3) % 20) / 100, sampleCount: index, lastLatencyMs: index === 17 ? undefined : index === 16 ? 9876543 : (index * 53) % 400 },
      multiplierBps: index === 1 ? 250 : 10000 + ((index * 11) % 20) * 1000, registryModelId: 'synthetic-model-' + index
    })); }
    offeringMerchantId(offering) { return offering.merchantId; }
    update() {} resolvedDesktopTheme() { return this.theme; }
    rememberNavigation() {} closeModelEffortPickerImmediately() {}
    clearNavigationSurfaces() { this.codingPopover = ''; this.modelPickerRelayOpen = false; }
    closeNavigationSurface() { this.clearNavigationSurfaces(); this.update(); }
    completeNavigationSurface() { this.closeNavigationSurface(); }
    selectRelay(key) { this.activeRelayKey = key; this.update(); } // Selection receipt only, never executes a route.
    ${methods}
}
const RELAY_FAVORITES_STORAGE_KEY = RelayWidgetFixture.FAVORITES_KEY;`;
}
const bundle = () => build({
    entryPoints: [fileURLToPath(new URL('relay-picker-fixture.tsx', import.meta.url))], bundle: true, write: false,
    platform: 'browser', format: 'iife', logLevel: 'silent',
    alias: { react: coreRequire.resolve('react'), 'react-dom': coreRequire.resolve('react-dom'),
        'react-dom/client': coreRequire.resolve('react-dom/client') },
    plugins: [{ name: 'actual-relay-widget-methods', setup(builder) {
        builder.onResolve({ filter: /^relay-widget-fixture-source$/ }, () => ({ path: 'widget', namespace: 'relay-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'relay-fixture' }, async () => ({ contents: await productMethods(),
            loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)) }));
    } }]
});
await bundle();
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isolated relay picker</title><link rel="stylesheet" href="/codicon.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/production.css"><style>
html,body,#fixture{margin:0;width:100%;height:100%;font:13px system-ui;background:#151515;color:#eeecee}*{box-sizing:border-box}
html[data-theme=light],html[data-theme=light] body{background:#f1efed;color:#252225;color-scheme:light}
.fixture{width:100%;height:100%;overflow:hidden}.fixture-titlebar{height:40px;padding:8px;display:block}
.fixture-note,.fixture-selection{display:block;margin:8px;overflow-wrap:anywhere;font-size:11px}
.fixture-trigger{position:fixed;bottom:12px;left:16px;height:32px;max-width:calc(100% - 32px)}
</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`;
const host = `<!doctype html><html><head><meta charset="utf-8"><title>Relay picker QA host</title><style>
body{margin:12px;font:14px system-ui;background:#eee;color:#222}nav{display:flex;flex-wrap:wrap;gap:6px}button,select{padding:6px}
iframe{display:block;border:1px solid #aaa;width:900px;height:760px;margin-top:10px}output{display:block;margin:8px 0;max-width:1000px;overflow-wrap:anywhere}
</style></head><body><nav><button data-size="900,760">Wide 900×760</button><button data-size="320,680">Narrow 320×680</button>
<button data-size="640,360">Short 640×360</button><button data-size="320,900">Tall 320×900</button>
<select aria-label="Fixture locale" id="locale">${['zh-CN','en','de','ar','ja','ko','fr','es','pt-BR','ru','hi','zh-TW'].map(locale => `<option>${locale}</option>`).join('')}</select>
<select aria-label="Fixture theme" id="theme"><option>dark</option><option>light</option></select><button id="measure">Measure layout</button></nav>
<output id="metrics">Synthetic data only. Size buttons resize the same iframe without resetting source/search.</output>
<iframe title="Real relay picker component" src="/?locale=zh-CN&theme=dark"></iframe><script src="/host.js"></script></body></html>`;
const hostScript = `const frame=document.querySelector('iframe');
document.querySelectorAll('[data-size]').forEach(button=>button.onclick=()=>{const [w,h]=button.dataset.size.split(',');frame.style.width=w+'px';frame.style.height=h+'px'});
for(const id of ['locale','theme'])document.getElementById(id).onchange=()=>{frame.src='/?locale='+encodeURIComponent(document.getElementById('locale').value)+'&theme='+document.getElementById('theme').value};
document.getElementById('measure').onclick=()=>{const d=frame.contentDocument,p=d.querySelector('.nmx-model-picker-popover'),l=d.querySelector('.nmx-relay-options'),r=p?.getBoundingClientRect();
document.getElementById('metrics').textContent=JSON.stringify({viewport:[frame.contentWindow.innerWidth,frame.contentWindow.innerHeight],page:[d.documentElement.scrollWidth,d.documentElement.scrollHeight],panel:r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}:null,list:l?{client:l.clientHeight,scroll:l.scrollHeight}:null,sort:d.querySelector('[data-relay-sort][aria-pressed=true]')?.dataset.relaySort,tab:d.querySelector('[role=tab][aria-selected=true]')?.textContent,selected:d.querySelector('[data-fixture-selection]')?.dataset.fixtureSelection,rows:[...d.querySelectorAll('[data-relay-key]')].map(row=>({id:row.dataset.relayKey,name:row.querySelector('strong')?.textContent})),buttons:[...d.querySelectorAll('.nmx-relay-sort button')].map(button=>({name:button.getAttribute('aria-label'),pressed:button.getAttribute('aria-pressed'),height:button.getBoundingClientRect().height}))})};`;
const assets = {
    '/style.css': new URL('../src/browser/style/nextmux.css', import.meta.url),
    '/production.css': new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url),
    '/codicon.css': coreRequire.resolve('@vscode/codicons/dist/codicon.css'),
    '/codicon.ttf': coreRequire.resolve('@vscode/codicons/dist/codicon.ttf')
};
const server = createServer(async (request, response) => {
    try {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        const body = path === '/' ? html : path === '/host' ? host : path === '/host.js' ? hostScript
            : path === '/fixture.js' ? (await bundle()).outputFiles[0].contents : assets[path] ? await readFile(assets[path]) : null;
        response.writeHead(body ? 200 : 404, { 'content-type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css'
            : path.endsWith('.ttf') ? 'font/ttf' : 'text/html', 'cache-control': 'no-store',
            'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'self'; frame-src 'self'" });
        response.end(body || 'Not found');
    } catch (error) { console.error(error.message); response.writeHead(500); response.end('Fixture compilation failed'); }
});
const port = Number(process.env.NEXTMUX_RELAY_FIXTURE_PORT || 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid fixture port');
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log(`Isolated relay picker fixture: http://127.0.0.1:${server.address().port}/host`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
