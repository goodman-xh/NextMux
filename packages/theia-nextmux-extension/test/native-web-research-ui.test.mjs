import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const React = core('react'), { renderToStaticMarkup } = core('react-dom/server');
const modules = new Map();
function load(path) {
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    const localRequire = name => {
        if (name === '@theia/core/shared/react') return React;
        if (name.startsWith('.')) {
            const base = resolve(dirname(path), name), candidate = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
            if (/\.tsx?$/.test(candidate || '')) return load(candidate);
        }
        return createRequire(path)(name);
    };
    new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
    }).outputText)(localRequire, module, module.exports);
    return module.exports;
}
const src = fileURLToPath(new URL('../src/browser/', import.meta.url));
const fields = load(resolve(src, 'nextmux-native-web-research-fields.tsx'));
const source = readFileSync(resolve(src, 'nextmux-desktop-widget.tsx'), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['officialProviderPresets', 'openOfficialProvider', 'setOfficialDraft', 'saveOfficialConnection', 'renderOfficialConnectionSheet'];
const methods = names.map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, `production method ${name}`); return method.getText(file);
});
const dependencies = {
    React, ...fields, ...require('@nextmux/model-runtime/presets'), document: { activeElement: null }, HTMLElement: class {}, requestAnimationFrame: () => {},
    localizeDesktopSurface: (_locale, text) => text, myApisText: (_locale, key) => key, credentialStoreName: () => 'Credential store',
    localModelText: (_locale, key) => key, mediaTemplateProblem: () => undefined, mediaTemplateFromPreset: () => ({}),
    officialModelSurfaceText: (_locale, key) => key, isCatalogOnlyOfficialProvider: () => false,
    desktopDomainMessage: () => 'API Key', desktopStatus: code => code,
    ImeInput: props => React.createElement('input', props), MediaTemplateAdvanced: () => null
};
const Harness = new Function(...Object.keys(dependencies), ts.transpileModule(`class Harness { ${methods.join('\n')} }; return Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText)(...Object.values(dependencies));
const provider = { id: 'custom_openai', protocol: 'openai_chat_completions', name: 'Compatible API', modelFamily: 'Chat', description: 'My API',
    baseUrls: [], defaultBaseUrl: 'https://api.example.test/v1', defaultModel: 'chat-model', allowBaseUrlEdit: true, connectionNote: '', apiKeyPlaceholder: 'Key' };
const existing = { id: 'existing-connection', providerId: provider.id, protocol: provider.protocol, providerName: provider.name, label: 'My saved API',
    model: 'chat-model', baseUrl: provider.defaultBaseUrl, providerSettings: { apiVersion: 'v1' } };
function fixture() {
    const state = new Harness();
    Object.assign(state, { desktopLocale: 'en', officialModels: { providers: [], connections: [existing] }, officialConnectionStage: 'idle', officialDraft: {},
        node: { querySelector: () => null }, rememberNavigation() {}, clearNavigationSurfaces() {}, update() {},
        officialConnectionsFor: () => [], officialProviderModels: () => [], defaultOfficialProviderSettings: () => undefined,
        discoverLocalDraftModels: async () => {},
        refreshOfficialModelsAfterMutation: async () => {}, closeNavigationSurface() { this.officialProviderSheet = undefined; }
    });
    return state;
}

test('editing distinguishes automatic metadata, manual protocol and an explicit disabled setting', () => {
    const state = fixture(), manual = fields.nativeWebResearchSetting('anthropic_messages');
    for (const [stored, expected] of [[undefined, 'automatic'], [{ ...manual, source: 'provider_metadata' }, 'automatic'], [manual, manual], [null, null]]) {
        state.openOfficialProvider(provider, { ...existing, nativeWebResearch: stored }, true);
        assert.deepEqual(state.officialDraft.nativeWebResearch, expected);
        assert.equal(state.officialDraft.connectionId, existing.id);
        assert.equal(state.officialDraft.apiKey, '', 'editing never copies a saved key into the form');
        assert.deepEqual(state.officialDraft.providerSettings, existing.providerSettings);
    }
    state.openOfficialProvider(provider);
    assert.equal(fields.nativeWebResearchSelection(state.officialDraft.nativeWebResearch), 'automatic');
});

test('saving a protocol edit retains the connection and its stored key; disabled and automatic are explicit', async () => {
    for (const setting of [fields.nativeWebResearchSetting('openrouter_server_tools'), null, 'automatic']) {
        const state = fixture(), credentials = new Map([[existing.id, 'fixture-stored-key']]), requests = [];
        state.platformService = { saveOfficialModelConnection: async request => {
            requests.push(request);
            if (Object.hasOwn(request, 'apiKey')) credentials.set(request.connectionId, request.apiKey);
            return { connection: { ...existing, nativeWebResearch: request.nativeWebResearch } };
        } };
        state.openOfficialProvider(provider, existing, true);
        state.setOfficialDraft({ nativeWebResearch: setting });
        await state.saveOfficialConnection(false);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].connectionId, existing.id);
        assert.equal(requests[0].providerId, existing.providerId);
        assert.equal(requests[0].model, existing.model);
        assert.deepEqual(requests[0].providerSettings, existing.providerSettings);
        assert.deepEqual(requests[0].nativeWebResearch, setting);
        assert.equal(Object.hasOwn(requests[0], 'apiKey'), false, 'blank key must not replace the existing credential');
        assert.equal(credentials.get(existing.id), 'fixture-stored-key');
        assert.equal(state.myApisHighlight, existing.id, 'the saved own API stays in My APIs');
        assert.equal(state.officialConnectionStage, 'idle');
    }
});

test('choosing a web protocol in a new API draft preserves its key, address and model through saving', async () => {
    const state = fixture(), requests = [];
    state.platformService = { saveOfficialModelConnection: async request => { requests.push(request); return { connection: { ...existing, id: 'new-connection' } }; } };
    state.openOfficialProvider(provider);
    state.setOfficialDraft({ apiKey: 'fixture-new-key', label: 'My new API' });
    state.setOfficialDraft({ nativeWebResearch: fields.nativeWebResearchSetting('gemini_generate_content') });
    assert.equal(state.officialDraft.apiKey, 'fixture-new-key');
    assert.equal(state.officialDraft.baseUrl, provider.defaultBaseUrl);
    assert.equal(state.officialDraft.model, provider.defaultModel);
    await state.saveOfficialConnection(false);
    assert.equal(requests[0].apiKey, 'fixture-new-key');
    assert.equal(requests[0].nativeWebResearch.profile, 'gemini_generate_content');
    assert.equal(state.myApisHighlight, 'new-connection');
    assert.equal(state.officialDraft.apiKey, '', 'the input clears after a successful save');
});

test('the production form offers web configuration for own chat APIs and excludes media and Ollama', async () => {
    for (const [preset, visible] of [[provider, true], [{ ...provider, id: 'openrouter' }, true], [{ ...provider, id: 'anthropic', protocol: 'anthropic_messages' }, true],
        [{ ...provider, id: 'ollama' }, false], [{ ...provider, id: 'custom_media', protocol: 'async_media_template' }, false], [{ ...provider, id: 'minimax_music', protocol: 'minimax_music' }, false]]) {
        const state = fixture(); state.openOfficialProvider(preset);
        // Ollama has its own discovery action when its form opens.
        const markup = renderToStaticMarkup(state.renderOfficialConnectionSheet());
        assert.equal(markup.includes('data-native-web-research="true"'), visible, preset.id);
        const requests = [];
        state.platformService = { saveOfficialModelConnection: async request => { requests.push(request); return { connection: { ...existing, providerId: preset.id } }; } };
        await state.saveOfficialConnection(false);
        assert.equal(Object.hasOwn(requests[0], 'nativeWebResearch'), visible, `${preset.id}: no native web declaration for media/local defaults`);
    }
});

async function startBrowserFixture() {
    const entry = `import * as React from 'react'; import {createRoot} from 'react-dom/client';
import {NativeWebResearchFields} from './nextmux-native-web-research-fields';
const params=new URLSearchParams(location.search), locale=params.get('locale')||'zh-CN';
function Fixture(){const[value,setValue]=React.useState('automatic');window.setting=value;return <div className='nmx-desktop-widget'><div className={'nmx-shell nmx-theme-'+(params.get('theme')||'dark')} dir={locale==='ar'?'rtl':'ltr'}><div className='nmx-sheet-backdrop'><section className='nmx-purchase-sheet nmx-official-sheet'><section className='nmx-official-form'><NativeWebResearchFields locale={locale} disabled={params.has('busy')} value={value} onChange={setValue}/></section></section></div></div></div>};
createRoot(document.getElementById('fixture')).render(<Fixture/>);`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', sourcefile: 'native-web-fixture.tsx', resolveDir: src },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent', external: ['node:*'],
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'), '@theia/core/shared/react': core.resolve('react') } });
    const css = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-shell-polish.css'].map(name => readFile(resolve(src, `style/${name}`))));
    const assets = {
        '/fixture.js': ['text/javascript', outputFiles[0].contents], '/style.css': ['text/css', Buffer.concat(css)],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/style.css'><style>html,body{margin:0;height:100%;font:13px system-ui}#fixture,.nmx-desktop-widget{height:100%}.nmx-shell{display:block;position:relative;height:100%;background:var(--nmx-bg)}</style></head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`]
    };
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('all 12 locales render the web protocol field, keep narrow layouts readable and send the selected declaration', { timeout: 120000 }, async t => {
    const fixture = await startBrowserFixture(); t.after(fixture.close);
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = [], shots = '/tmp/nm-shots/native-web-research';
    page.on('pageerror', error => errors.push(error.message)); await mkdir(shots, { recursive: true });
    const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    for (const locale of locales) for (const width of [560, 1280]) {
        await page.setViewport({ width, height: 800 });
        await page.goto(`${fixture.origin}/?${new URLSearchParams({ locale, theme: width === 560 ? 'light' : 'dark' })}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-native-web-research]');
        await page.click('[data-native-web-research] > summary');
        const visible = await page.evaluate(() => {
            const field = document.querySelector('[data-native-web-research]'), box = field.getBoundingClientRect(), select = field.querySelector('select');
            const overflow = [...field.querySelectorAll('*')].filter(node => { const r=node.getBoundingClientRect(); return r.width>0 && (r.right>box.right+1 || r.left<box.left-1); }).map(node => node.tagName);
            return { text: field.innerText, labels: [...select.options].map(option => option.textContent), overflow, fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
                label: select.closest('label').innerText, hint: document.getElementById(select.getAttribute('aria-describedby'))?.textContent };
        });
        assert.deepEqual(visible.overflow, [], `${locale}/${width}: controls and text stay inside the form`);
        assert.equal(visible.fits, true, `${locale}/${width}: the field stays within the viewport`);
        assert.equal(visible.labels.length, 7);
        assert.ok(visible.label.includes(fields.nativeWebResearchText(locale, 'protocol')));
        assert.equal(visible.hint, fields.nativeWebResearchText(locale, 'hint'));
        assert.ok(visible.text.includes(fields.nativeWebResearchText(locale, 'local')));
        if (!['zh-CN', 'zh-TW'].includes(locale)) assert.doesNotMatch(visible.text, /联网协议|仅保存在本机|禁用联网/);
        for (const profile of ['openrouter_server_tools', 'openai_responses', 'anthropic_messages', 'gemini_generate_content', 'zhipu_chat']) {
            await page.select('[data-native-web-research] select', profile);
            assert.deepEqual(await page.evaluate(() => window.setting), fields.nativeWebResearchSetting(profile));
        }
        await page.select('[data-native-web-research] select', 'disabled');
        assert.equal(await page.evaluate(() => window.setting), null);
        await page.select('[data-native-web-research] select', 'automatic');
        assert.equal(await page.evaluate(() => window.setting), 'automatic');
        if (['zh-CN', 'de', 'ar', 'en'].includes(locale)) await page.screenshot({ path: `${shots}/${locale}-${width}.png` });
    }
    await page.goto(`${fixture.origin}/?busy=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-native-web-research]');
    assert.equal(await page.$eval('[data-native-web-research] select', select => select.disabled), true);
    assert.deepEqual(errors, []);
});
