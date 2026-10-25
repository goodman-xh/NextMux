import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { productionStylesheets } from './coding-sidebar-fixture-harness.mjs';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);

test('global model settings preserve choices without exposing private provider catalogs', { timeout: 45000 }, async t => {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = ['settingsModelOptions', 'registryModelOption', 'registryModelSupportsWorkbench', 'normalizedModelId', 'modelKeyForOffering',
        'isModelVisible', 'setVisibleModels'].map(name => {
        const node = widget.members.find(value => ts.isMethodDeclaration(value) && value.name.getText(file) === name);
        assert.ok(node, `production method ${name}`); return node.getText(file);
    }).join('\n');
    const entry = `import * as React from 'react'; import { createRoot } from 'react-dom/client';
import { AnonymousModelsToggle, ModelVisibilitySettings, modelVisibilityCopy } from './nextmux-model-visibility-settings';
import { MODEL_VISIBILITY_KEY, parseModelVisibilityPreferences, isModelVisible as modelVisible, setModelsVisible, createModelVisibilityCatalog, migrateModelVisibilityPreferences, modelVisibilityCategories, resolveModelVisibilityId } from './nextmux-model-visibility';
import { isDecisionModel } from '../common/nextmux-decision-models';
const localizeDesktopSurface = (_, value) => value;
const row = (id, label, output = ['text'], kind = output.includes('video') ? 'video' : output.includes('image') ? 'image' : output.includes('audio') || output.includes('speech') ? 'speech' : 'llm') => ({ id, canonicalModel: id, displayName: label, kind, provider: id.split('/')[0], providerName: 'Synthetic', status: 'active', aliases: [id.split('/').pop()],
    workbenches: output.includes('text') ? ['coding'] : ['comic'], input: ['text'], output, capabilities: [] });
class Fixture {
    desktopLocale = 'en'; modelVisibilityError = ''; networkCalls = 0;
    modelVisibility = parseModelVisibilityPreferences(localStorage.getItem(MODEL_VISIBILITY_KEY), {
        language: JSON.stringify(['openai/gpt-6-astra', 'aurora/orbit-1', 'other/orbit-1']), media: JSON.stringify(['google/veo-3.1']) });
    globalModels = [row('openai/gpt-6-astra', 'GPT-6 Astra'), row('aurora/orbit-1', 'Aurora Orbit'), row('other/orbit-1', 'Other Orbit'),
        row('aurora/orbit-video', 'Orbit Video', ['video']), row('aurora/orbit-image', 'Orbit Image', ['image']),
        {...row('aurora/audio-understands-video', 'Video understanding audio model', ['audio']), input: ['text', 'video'], capabilities: ['input_video']},
        row('z-images/first-image', 'Z image first', ['image']), row('a-images/second-image', 'A image second', ['image']),
        row('aurora/voice', 'Orbit Voice', ['speech']), row('aurora/music', 'Orbit Music', ['audio'], 'music'),
        {...row('aurora/sound-effect', 'Orbit Sound Effect', ['audio']), capabilities: ['sound_effect_generation']},
        {...row('aurora/sound-alias', 'Orbit Sound Alias', ['audio']), capabilities: ['text_to_sound_effect']},
        row('aurora/transcription', 'Orbit Transcription', ['text'], 'transcription'),
        row('aurora/embedding', 'Unsupported Embedding', ['text'], 'embedding'),
        row('aurora/rerank', 'Unsupported Rerank', ['text'], 'rerank'), row('aurora/moderation', 'Unsupported Moderation', ['text'], 'moderation'),
        ...Array.from({ length: 25 }, (_, index) => row('catalog/image-' + index, 'Public image model ' + String(index).padStart(3, '0'), ['image'])),
        ...Array.from({ length: 250 }, (_, index) => row('catalog/public-' + index, 'Public catalog model ' + String(index).padStart(3, '0')))];
    modelVisibilityCatalog = createModelVisibilityCatalog(this.globalModels);
    loading = false; error = ''; retries = 0; anonymous = false;
    selectedMerchantCatalog = { merchantId: 'current', offerings: [row('vendor/exclusive-new', 'Merchant exclusive model')] };
    merchantPickerSnapshots = new Map([['old', { catalog: { merchantId: 'old', offerings: [row('vendor/other-cached', 'Another cached model'), row('vendor/cached-image', 'Cached image model', ['image'])] } }]]);
    merchantDiscoveredModels = new Map([['discovery', [row('vendor/discovered-only', 'Discovered directory model'), row('vendor/discovered-video', 'Discovered video model', ['video']),
        {...row('vendor/audio-understands-video', 'Video understanding audio model', ['audio']), input: ['text', 'video'], capabilities: ['input_video']}]]]);
    mediaDraft = { kind: 'image', connectionId: 'selected-route' };
    modelOptions(workbench) { return workbench === 'comic' ? [] : [{ id: 'lmstudio/team/local:Q4_K_M', label: 'Local runtime alias',
        model: 'team/local:Q4_K_M', providerName: 'LM Studio', available: true, input: ['text'], output: ['text'], capabilities: [], contextTokens: 32768 }]; }
    modelOnlyDisplayName(label, _provider, model) { return label || model; }
    update() { const copy = modelVisibilityCopy(this.desktopLocale); root.render(<><section className='nmx-settings-heading'><div className='nmx-settings-heading-copy'><span>Settings</span><h2>{copy[0]}</h2><p>{copy[1]}</p></div></section><section className='nmx-settings-panel nmx-models-settings'><ModelVisibilitySettings locale={this.desktopLocale} preferences={this.modelVisibility} catalog={this.modelVisibilityCatalog}
        language={this.settingsModelOptions('coding')} media={this.settingsModelOptions('comic')}
        loading={this.loading} error={this.error} onRetry={() => { this.retries++; this.loading = true; this.update(); }}
        onChange={(ids, group, visible) => this.setVisibleModels(ids, group, visible)} />
        <AnonymousModelsToggle enabled={this.anonymous} label='Enable anonymous models' help='Show reviewed anonymous models from the selected reseller.' onChange={enabled=>{this.anonymous=enabled;this.update();}} /></section></>); }
    ${methods}
}
const root = createRoot(document.getElementById('fixture')); const fixture = window.fixture = new Fixture();
window.modelVisibilityCopy = modelVisibilityCopy;
fixture.modelVisibility = migrateModelVisibilityPreferences(fixture.modelVisibility, fixture.modelVisibilityCatalog);
fixture.update();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx',
        resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'model-visibility-settings-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'),
            'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    // Match the real settings-panel ancestry and every production stylesheet:
    // later generic section rules must not silently shift the second column.
    const stylesheets = await productionStylesheets();
    const styles = await Promise.all(stylesheets.map(async name => [name, await readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')]));
    const html = `<!doctype html><html><head>${stylesheets.map(name => `<link rel='stylesheet' href='/${name}'>`).join('')}<style>
html,body,.nmx-desktop-widget{margin:0;width:100%;height:100%;font:14px system-ui}.fixture-workspace{grid-column:1/-1}
</style></head><body><div id='nextmux.desktop.widget' class='nmx-desktop-widget'><div class='nmx-shell nmx-theme-dark'><main class='nmx-workspace fixture-workspace'><div id='fixture' class='nmx-workspace-scroll nmx-settings-page'></div></main></div></div><script src='/fixture.js'></script></body></html>`;
    const resources = { '/fixture.js': ['text/javascript', outputFiles[0].contents], ...Object.fromEntries(styles.map(([name, css]) => [`/${name}`, ['text/css', css]])) };
    const server = createServer((request, response) => {
        const [contentType, body] = resources[request.url] || ['text/html', html];
        response.writeHead(200, { 'content-type': contentType,
            'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" });
        response.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = [];page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => { if (new URL(request.url()).origin === origin) void request.continue(); else { errors.push('external request blocked'); void request.abort(); } });
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForSelector('.nmx-model-visibility-row');
    assert.equal(await page.$('.nmx-model-visibility-column:last-child > header > span'), null, 'media counts appear only beside each category');
    assert.equal(await page.$$eval('[data-model-category]', buttons=>buttons.every(button=>{
        const [label,count]=button.children;const a=label.getBoundingClientRect(),b=count.getBoundingClientRect();return !button.querySelector('br')&&Math.abs(a.bottom-b.bottom)<4;
    })),true,'category and count share one line');
    const anonymous='.nmx-anonymous-models-toggle';
    assert.equal(await page.$eval(anonymous,e=>{const a=e.querySelector('input').getBoundingClientRect(),b=e.querySelector('span').getBoundingClientRect();return a.width===15&&b.left-a.right>=0&&b.left-a.right<=8&&Math.abs(a.y+a.height/2-b.y-b.height/2)<2;}),true,'checkbox stays immediately beside its label');
    await page.$eval(anonymous,e=>e.scrollIntoView({block:'center'}));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.mouse.move(0,0);await page.hover(anonymous);await page.waitForSelector('[role="tooltip"]');
    assert.match(await page.$eval('[role="tooltip"]',e=>e.textContent),/reviewed anonymous/);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="tooltip"]'));
    await page.focus(`${anonymous} input`);await page.waitForSelector('[role="tooltip"]');
    assert.equal(await page.$eval(`${anonymous} input`,e=>e.hasAttribute('aria-describedby')&&!e.hasAttribute('title')),true,'keyboard focus gets the same accessible explanation');
    await page.keyboard.press('Space');await page.waitForFunction(()=>fixture.anonymous);
    await page.keyboard.press('Tab');await page.waitForFunction(()=>!document.querySelector('[role="tooltip"]'));
    const listed = await page.evaluate(() => ({
        language: window.fixture.settingsModelOptions('coding').map(model => model.id),
        media: window.fixture.settingsModelOptions('comic').map(model => model.id)
    }));
    assert.equal(listed.language.length, 253);
    assert.deepEqual(listed.language.slice(0, 3), ['openai/gpt-6-astra', 'aurora/orbit-1', 'other/orbit-1'],
        'settings preserve the public catalog popularity order instead of alphabetizing provider names');
    assert.ok(listed.language.includes('aurora/orbit-1'));
    assert.ok(listed.language.includes('other/orbit-1'));
    assert.deepEqual(listed.media.slice(0, 10), ['aurora/orbit-video', 'aurora/orbit-image', 'aurora/audio-understands-video',
        'z-images/first-image', 'a-images/second-image', 'aurora/voice', 'aurora/music', 'aurora/sound-effect', 'aurora/sound-alias', 'aurora/transcription']);
    assert.equal(listed.media.length, 35);
    assert.ok([...listed.language, ...listed.media].every(id => !/embedding|rerank|moderation/.test(id)),
        'embedding, rerank and moderation models stay out of Settings even with text output');
    assert.ok([...listed.language, ...listed.media].every(id => !id.startsWith('vendor/') && !id.startsWith('lmstudio/')),
        'merchant caches and private BYOK models never enter the global settings catalog');
    assert.equal(await page.$('.nmx-model-visibility-settings > footer'), null);
    assert.match(await page.$eval('.nmx-settings-heading p', paragraph => paragraph.textContent), /global catalog.*merchant.*personal API/);
    const initialCounts = await page.$$eval('[data-model-category]', buttons => Object.fromEntries(buttons.map(button => [button.dataset.modelCategory, button.textContent])));
    assert.deepEqual(initialCounts, { '3d': '3D 0/0', image: 'Image 28/28', video: 'Video 1/1', speech: 'Voice-over 4/4', music: 'Music 1/1', soundEffect: 'Sound effects 2/2', transcription: 'Speech to text 1/1' },
        'all media categories show their own checked/total counts, with up to the first forty images checked');
    assert.equal(await page.$eval('.nmx-model-visibility-column:first-child > header > span', span => span.textContent), '37/253');
    assert.deepEqual(await page.$$eval('.nmx-model-visibility-column:last-child .nmx-model-visibility-row', rows => rows.slice(0, 3).map(row => row.querySelector('strong').textContent)),
        ['Orbit Image', 'Z image first', 'A image second'], 'category rows keep server order instead of sorting by author or title');
    assert.equal(await page.$('input[aria-label="Video understanding audio model"]'), null,
        'understanding video input is not video generation');
    assert.ok(await page.$$eval('input[type="checkbox"]', inputs => inputs.length) < 70,
        'the global catalog stays virtualized');
    await page.type('input[type="search"]', 'Aurora Orbit');
    await page.waitForSelector('input[aria-label="Aurora Orbit"]');
    assert.equal(await page.$eval('input[aria-label="Aurora Orbit"]', input => input.checked), false);
    assert.equal(await page.$eval('.nmx-model-visibility-column:first-child > header > span', span => span.textContent), '37/253',
        'search does not turn category totals into matched-row totals');
    await page.click('input[aria-label="Aurora Orbit"]');
    await page.waitForFunction(() => window.fixture.isModelVisible('aurora/orbit-1'));
    assert.equal(await page.evaluate(() => window.fixture.isModelVisible('other/orbit-1')), false,
        'models by different authors with the same short name are independent');
    await page.click('input[aria-label="Aurora Orbit"]');
    await page.waitForFunction(() => !window.fixture.isModelVisible('aurora/orbit-1'));
    assert.ok(await page.$('input[aria-label="Aurora Orbit"]'), 'unchecked rows remain available for re-enabling');
    await page.click('input[aria-label="Aurora Orbit"]');
    await page.waitForFunction(() => window.fixture.isModelVisible('aurora/orbit-1'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.nmx-model-visibility-row');
    await page.type('input[type="search"]', 'Aurora Orbit');
    await page.waitForSelector('input[aria-label="Aurora Orbit"]');
    assert.equal(await page.$eval('input[aria-label="Aurora Orbit"]', input => input.checked), true, 'explicit choices survive restart');
    await page.$eval('input[type="search"]', input => { input.focus(); input.select(); });
    await page.keyboard.press('Backspace');
    await page.waitForSelector('input[aria-label="Orbit Image"]');
    for (const theme of ['dark', 'light']) {
        for (const width of [1280, 620]) {
            await page.setViewport({ width, height: 850 });
            await page.evaluate(selectedTheme => {
                document.querySelector('.nmx-shell').className = `nmx-shell nmx-theme-${selectedTheme}`;
                document.querySelector('.nmx-settings-page').scrollTop = 0;
            }, theme);
            // Let resize observers update the production virtual lists.
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const layout = await page.evaluate(() => {
                const box = element => {
                    const bounds = element.getBoundingClientRect();
                    return { top: bounds.top, left: bounds.left, right: bounds.right, bottom: bounds.bottom, height: bounds.height, width: bounds.width };
                };
                const settings = document.querySelector('.nmx-model-visibility-settings');
                const columns = [...settings.querySelectorAll('.nmx-model-visibility-column')];
                const rows = [...settings.querySelectorAll('.nmx-model-visibility-row')];
                return {
                    settings: box(settings), footer: Boolean(settings.querySelector(':scope > footer')),
                    columns: columns.map(column => ({ ...box(column), header: box(column.querySelector('header')),
                        list: box(column.querySelector('.nmx-model-visibility-list')) })),
                    gaps: rows.map(row => box(row.querySelector('strong')).left - box(row.querySelector('input')).right),
                    overflow: [document.documentElement, document.querySelector('.nmx-settings-page'), settings,
                        ...columns, ...rows].map(element => ({ className: element.className, extra: element.scrollWidth - element.clientWidth })),
                    viewportWidth: innerWidth
                };
            });
            const label = `${theme} ${width}px`;
            assert.equal(layout.columns.length, 2, label);
            assert.equal(layout.footer, false, `${label}: no recommendation-source footer`);
            assert.ok(layout.gaps.length >= 2, `${label}: both production virtual lists render rows`);
            for (const column of layout.columns) {
                assert.ok(column.list.height > 200, `${label}: list must have a real viewport, got ${column.list.height}`);
                assert.ok(column.list.bottom <= column.bottom + 1, `${label}: list must remain inside its column`);
            }
            for (const gap of layout.gaps) assert.ok(gap >= 0 && gap < 20, `${label}: checkbox/title gap ${gap}px`);
            if (width > 700) assert.ok(Math.abs(layout.columns[0].header.top - layout.columns[1].header.top) <= 1,
                `${label}: column headers do not align: ${layout.columns[0].header.top}px vs ${layout.columns[1].header.top}px`);
            else assert.ok(layout.columns[1].top >= layout.columns[0].bottom - 1, `${label}: narrow columns must stack without overlap`);
            assert.ok(layout.settings.left >= -1 && layout.settings.right <= layout.viewportWidth + 1, `${label}: settings exceed viewport`);
            for (const element of layout.overflow) assert.ok(element.extra <= 1, `${label}: ${element.className} overflows by ${element.extra}px`);
            if (width === 1280) await page.screenshot({ path: `/tmp/nm-global-model-settings-${theme}.png` });
        }
    }
    await page.click('[data-model-category="speech"]');
    await page.waitForSelector('input[aria-label="Video understanding audio model"]');
    assert.equal(await page.$('input[aria-label="Orbit Video"]'), null, 'dubbing category excludes video-only models');
    await page.click('[data-model-category="music"]');
    await page.waitForSelector('input[aria-label="Orbit Music"]');
    assert.equal(await page.$('input[aria-label="Orbit Voice"]'), null, 'music has its own category');
    await page.click('[data-model-category="soundEffect"]');
    await page.waitForSelector('input[aria-label="Orbit Sound Effect"]');
    assert.ok(await page.$('input[aria-label="Orbit Sound Alias"]'), 'sound effects use the same capability aliases as the comic step');
    assert.equal(await page.$('input[aria-label="Orbit Voice"]'), null, 'speech models without sound-effect capability do not enter sound effects');
    await page.click('[data-model-category="transcription"]');
    await page.waitForSelector('input[aria-label="Orbit Transcription"]');
    assert.equal(await page.$eval('[data-model-category="transcription"] .nmx-model-category-count', span => span.textContent), '1/1');
    await page.click('[data-model-category="video"]');
    await page.waitForSelector('input[aria-label="Orbit Video"]');
    assert.equal(await page.$('input[aria-label="Video understanding audio model"]'), null,
        'understanding video input does not enter the video generation category');
    await page.click('[data-model-category="image"]');
    await page.waitForSelector('input[aria-label="Orbit Image"]');
    assert.equal(await page.$('input[aria-label="Video understanding audio model"]'), null);
    const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    for (const locale of locales) {
        await page.setViewport({ width: 620, height: 850 });
        await page.evaluate(value => { document.querySelector('.nmx-shell').dir=value==='ar'?'rtl':'ltr'; window.fixture.desktopLocale = value; window.fixture.update(); }, locale);
        await page.waitForFunction(value => document.querySelector('.nmx-model-visibility-column:first-child strong').textContent === window.modelVisibilityCopy(value)[3], {}, locale);
        assert.deepEqual(await page.$$eval('[data-model-category]', (buttons, value) => buttons.map(button => button.firstChild.textContent), locale),
            await page.evaluate(value => [5, 4, 6, 13, 14, 15].map(index => window.modelVisibilityCopy(value)[index]), locale),
            `${locale}: all six media categories have translated labels`);
        assert.equal(await page.evaluate(value => window.modelVisibilityCopy(value).filter(label => typeof label === 'string' && label.length > 0).length, locale), 16);
        const tabs=await page.$$eval('.nmx-model-visibility-column:last-child nav', navs=>navs.map(nav=>({
            width:nav.clientWidth,scrollWidth:nav.scrollWidth,overflow:getComputedStyle(nav).overflowX,
            buttons:[...nav.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect(),a=button.children[0].getBoundingClientRect(),b=button.children[1].getBoundingClientRect();return{top:r.top,height:r.height,width:r.width,textWidth:a.width+b.width};})
        })));
        assert.equal(tabs.length,1,`${locale}: media categories share one navigation row`);
        assert.equal(tabs[0].buttons.length,7);assert.equal(tabs[0].overflow,'auto');
        assert.ok(tabs[0].buttons.every(button=>Math.abs(button.top-tabs[0].buttons[0].top)<1&&button.width>=button.textWidth+3),`${locale}: categories and counts must not wrap or shrink`);
        await page.focus('[data-model-category="image"]');
        for(let i=0;i<5;i++)await page.keyboard.press('Tab');
        await page.waitForFunction(() => {
            const button = document.querySelector('[data-model-category="transcription"]');
            const item = button.getBoundingClientRect(), viewport = button.closest('nav').getBoundingClientRect();
            return item.left >= viewport.left - 1 && item.right <= viewport.right + 1;
        });
        assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-model-category')),'transcription');
        const lastTab=await page.$eval('[data-model-category="transcription"]',button=>{const a=button.getBoundingClientRect(),b=button.closest('nav').getBoundingClientRect();return {left:a.left,right:a.right,navLeft:b.left,navRight:b.right,scrollLeft:button.closest('nav').scrollLeft};});
        assert.ok(lastTab.left>=lastTab.navLeft-1&&lastTab.right<=lastTab.navRight+1,`${locale}: keyboard navigation scrolls the last category into view: ${JSON.stringify(lastTab)}`);
    }
    // Pointer activation centers in the strip only. Validate real scrolling,
    // including RTL's negative scrollLeft and natural clamping at both ends.
    for (const locale of ['en', 'zh-CN', 'ar']) {
        await page.setViewport({ width: 1280, height: 850 });
        await page.evaluate(value => {
            document.querySelector('.nmx-shell').dir = value === 'ar' ? 'rtl' : 'ltr';
            window.fixture.desktopLocale = value; window.fixture.update();
        }, locale);
        await page.waitForFunction(value => document.querySelector('.nmx-model-visibility-column:first-child strong').textContent === window.modelVisibilityCopy(value)[3], {}, locale);
        for (const category of ['speech', 'image', 'transcription']) {
            const selector = `[data-model-category="${category}"]`;
            await page.$eval(selector, button => button.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
            const pageScroll = await page.$eval('.nmx-settings-page', element => element.scrollTop);
            await page.click(selector);
            await page.waitForFunction(value => {
                const button = document.querySelector(`[data-model-category="${value}"]`), nav = button.closest('nav');
                const item = button.getBoundingClientRect(), viewport = nav.getBoundingClientRect();
                const desired = nav.scrollLeft + (item.left + item.right - viewport.left - viewport.right) / 2;
                const max = nav.scrollWidth - nav.clientWidth, rtl = getComputedStyle(nav).direction === 'rtl';
                const clamped = Math.max(rtl ? -max : 0, Math.min(rtl ? 0 : max, desired));
                return button.getAttribute('aria-pressed') === 'true' && Math.abs(nav.scrollLeft - clamped) < 1;
            }, {}, category);
            assert.equal(await page.$eval('.nmx-settings-page', element => element.scrollTop), pageScroll,
                `${locale} ${category}: category centering does not move the Settings page`);
            const geometry = await page.evaluate(() => {
                const nav = document.querySelector('.nmx-model-category-navigation nav'), bounds = nav.getBoundingClientRect();
                const buttons = [...nav.querySelectorAll('[data-model-category]')];
                return {
                    direction: getComputedStyle(nav).direction,
                    left: buttons.some(button => button.getBoundingClientRect().left < bounds.left - 1),
                    right: buttons.some(button => button.getBoundingClientRect().right > bounds.right + 1),
                    leftDisabled: document.querySelector('.nmx-model-category-scroll.is-left').disabled,
                    rightDisabled: document.querySelector('.nmx-model-category-scroll.is-right').disabled,
                    singleLine: buttons.every(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 1)
                };
            });
            assert.equal(geometry.direction, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(geometry.leftDisabled, !geometry.left, `${locale}: left overflow hint matches actual hidden categories`);
            assert.equal(geometry.rightDisabled, !geometry.right, `${locale}: right overflow hint matches actual hidden categories`);
            assert.equal(geometry.singleLine, true);
        }
        const typography = await page.evaluate(() => {
            const styles = element => { const css = getComputedStyle(element); return { size: css.fontSize, line: css.lineHeight, weight: css.fontWeight, height: element.getBoundingClientRect().height }; };
            const textTop = element => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect().top; };
            const leftHeader = document.querySelector('.nmx-model-visibility-column:first-child > header');
            const active = document.querySelector('[data-model-category][aria-pressed="true"]');
            return { title: styles(leftHeader.querySelector('strong')), category: styles(active),
                languageCount: styles(leftHeader.querySelector('.nmx-model-category-count')), mediaCount: styles(active.querySelector('.nmx-model-category-count')),
                titleOffset: textTop(leftHeader.querySelector('strong')) - textTop(active.querySelector('span')),
                countOffset: textTop(leftHeader.querySelector('.nmx-model-category-count')) - textTop(active.querySelector('.nmx-model-category-count')) };
        });
        assert.deepEqual(typography.title, typography.category, `${locale}: language and active media category share typography and height`);
        assert.deepEqual(typography.languageCount, typography.mediaCount, `${locale}: both count labels share the same typography`);
        assert.ok(Math.abs(typography.titleOffset) < 1, `${locale}: both title baselines align (${typography.titleOffset}px)`);
        assert.ok(Math.abs(typography.countOffset) < 1, `${locale}: both count baselines align (${typography.countOffset}px)`);
    }
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.$eval('[data-model-category="image"]', button => button.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await page.click('[data-model-category="image"]');
    assert.equal(await page.$eval('.nmx-model-category-navigation nav', nav => Math.abs(nav.scrollLeft) < 1), true,
        'reduced motion applies the category position immediately in RTL');
    const beforeArrow = await page.$eval('.nmx-model-category-navigation nav', nav => nav.scrollLeft);
    await page.click('.nmx-model-category-scroll.is-left');
    assert.ok(await page.$eval('.nmx-model-category-navigation nav', nav => nav.scrollLeft) < beforeArrow,
        'the physical left arrow reveals categories on the left in RTL');
    await page.focus('[data-model-category="image"]');
    for (let index = 0; index < 5; index++) { await page.keyboard.press('Tab'); }
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-model-category')), 'transcription');
    assert.equal(await page.$eval('[data-model-category="transcription"]', button => {
        const bounds = button.getBoundingClientRect(), viewport = button.closest('nav').getBoundingClientRect();
        return button.matches(':focus-visible') && bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1;
    }), true, 'keyboard focus remains visible after scrolling and retains its focus indicator');
    await page.emulateMediaFeatures([]);
    await page.click('[data-model-category="image"]');
    await page.evaluate(() => { window.fixture.desktopLocale = 'en'; window.fixture.update(); });
    await page.evaluate(() => { window.fixture.error = 'RAW_INTERNAL_ERROR'; window.fixture.update(); });
    await page.waitForSelector('.nmx-model-visibility-status[role="alert"]');
    assert.equal(await page.$eval('.nmx-model-visibility-status', status => status.textContent.includes('RAW_INTERNAL_ERROR')), false);
    assert.ok(await page.$('input[aria-label="Orbit Image"]'), 'a refresh error retains the cached global list');
    await page.evaluate(() => { window.fixture.globalModels = []; window.fixture.loading = true; window.fixture.update(); });
    await page.waitForFunction(() => document.querySelector('.nmx-model-visibility-settings').getAttribute('aria-busy') === 'true');
    assert.equal(await page.$$eval('.nmx-model-visibility-row', rows => rows.length), 0);
    assert.equal(await page.$eval('.nmx-model-visibility-status', status => status.textContent.trim()), 'Loading…');
    await page.evaluate(() => { window.fixture.loading = false; window.fixture.update(); });
    await page.waitForSelector('.nmx-model-visibility-status[role="alert"] button');
    await page.click('.nmx-model-visibility-status button');
    assert.equal(await page.evaluate(() => window.fixture.retries), 1, 'retry delegates one refresh to the catalog owner');
    assert.deepEqual(errors, []);
});
