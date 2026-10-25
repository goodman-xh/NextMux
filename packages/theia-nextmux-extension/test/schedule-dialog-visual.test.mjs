import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { CSS, THEIA_THEME_CSS } from './settings-fixture-harness.mjs';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);

// “已安排” dialog (§6.6): the production renderScheduleDialog in real Chromium
// with production CSS. Any folder can be chosen, and relay, model, reasoning
// effort, context and permission are per task; models are named by their own
// display name (a registry family such as “gpt-image” is shared by several).
async function bundle() {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = name => { const node = widget.members.find(value => ts.isMethodDeclaration(value) && value.name.getText(file) === name); assert.ok(node, name); return node.getText(file); };
    const entry = `import * as React from 'react'; import * as ReactDOM from 'react-dom'; import { createRoot } from 'react-dom/client';
import { localScheduleDateTime, validScheduleTime } from '../common/nextmux-schedule';
import { contextBudgetText } from './nextmux-context-budget-locale';
import { contextWindowTokenLabel } from '../common/nextmux-context-budget';
import { goalScheduleText } from './nextmux-goal-schedule-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { formatBalanceMicros } from './nextmux-money-format';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { modelDisplayNameOnly } from './nextmux-model-display-name';
import { declaredReasoningSettings, reasoningDepthChoices } from '../common/nextmux-model-controls';
import { reasoningOptionKey } from '@nextmux/model-runtime/reasoning-evidence';
import { reasoningControlText } from './nextmux-reasoning-controls-locale';
const params = new URLSearchParams(location.search);
const offering = (id, displayName) => ({ id, displayName, modelFamily: 'gpt-image', providerName: 'Synthetic Relay', canonicalModel: 'openai/' + id });
const routes = [{ id: 'm1', kind: 'managed_gateway', offering: offering('gpt-image-2', 'GPT Image 2') }, { id: 'm2', kind: 'managed_gateway', offering: offering('gpt-image-1.5', 'GPT Image 1.5') },
  { id: 'o1', kind: 'official_connection', connection: { id: 'c1', model: 'claude-sonnet-4-5', modelFamily: 'Claude', providerName: 'Anthropic' } }];
class Fixture {
  desktopLocale = params.get('locale') || 'zh-CN'; calls = []; scheduleDialogOpen = true; scheduledTasks = []; scheduleCatalogLoading = false;
  scheduleDraft = { title: '', prompt: '', cadence: 'daily', runAt: '09:00', workspacePath: '', relayKey: '', routeId: undefined };
  scheduleDraftError = ''; scheduledTasksPersistenceError = ''; scheduleSaving = false; scheduledTasksReady = true; defaultPermissionMode = 'full_access';
  scheduledTaskWorkspaceOptions() { return [{ path: '/Users/me/app', label: 'app' }]; }
  scheduleModelRoutes() { return this.scheduleDraft.relayKey ? routes : []; }
  selectedScheduleModelRoute(available) { return available.find(route => route.id === this.scheduleDraft.routeId); }
  isModelVisible() { return true; }
  relayOptions() { return [{ key: 'managed:relay', label: 'Synthetic Relay', kind: 'managed' }, { key: 'official:c1', label: 'Anthropic', kind: 'official' }, { key: 'auto', label: 'Auto', kind: 'automatic' }]; }
  modelReasoningContract() { return undefined; } localReasoningEvidence() { return undefined; }
  reasoningEffortLevels(route) { return route?.kind === 'official_connection' ? ['low', 'medium', 'high'] : []; }
  modelContextWindowTokens(route) { return route?.kind === 'official_connection' ? 200000 : undefined; }
  reasoningEffortLabel(value) { return value; }
  modelOnlyDisplayName(displayName, providerName, canonicalModel, fallback) { return modelDisplayNameOnly(displayName, providerName, canonicalModel, fallback); }
  closeNavigationSurface() { this.calls.push(['close']); } trapDialogFocus() {}
  chooseScheduleWorkspace() { this.calls.push(['chooseFolder']); this.scheduleDraft = { ...this.scheduleDraft, workspacePath: '/Users/me/app' }; this.update(); }
  loadScheduleModels() { this.calls.push(['loadModels', this.scheduleDraft.relayKey]); }
  selectScheduleModel(id) { this.calls.push(['model', id]); this.scheduleDraft = { ...this.scheduleDraft, routeId: id }; this.update(); }
  saveScheduledTask() { this.calls.push(['save', { ...this.scheduleDraft }]); }
  ${method('permissionLabel')}
  ${method('scheduleRouteModelLabel')}
  ${method('reasoningDepthChoicesForRoute')}
  ${method('reasoningDepthLabel')}
  ${method('renderScheduleDialog')}
  update() { ReactDOM.flushSync(() => root.render(<div className='nmx-desktop-widget' dir={this.desktopLocale === 'ar' ? 'rtl' : 'ltr'} lang={this.desktopLocale}><div className={'nmx-shell nmx-theme-' + (params.get('theme') || 'dark')}>{this.renderScheduleDialog()}</div></div>));
    requestAnimationFrame(() => { const node = document.querySelector('.nmx-desktop-widget'), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let current = walker.nextNode(); current; current = walker.nextNode()) { if (current.parentElement?.closest('[data-nmx-literal]')) continue; const next = localizeDesktopSurface(this.desktopLocale, current.data); if (next !== current.data) current.data = next; }
      for (const element of node.querySelectorAll('[placeholder],[aria-label],[title]')) for (const name of ['placeholder', 'aria-label', 'title']) { const value = element.getAttribute(name); if (value) element.setAttribute(name, localizeDesktopSurface(this.desktopLocale, value)); }
      document.body.dataset.localized = String(Number(document.body.dataset.localized || 0) + 1); }); }
}
const root = createRoot(document.getElementById('fixture')); const fixture = window.fixture = new Fixture(); fixture.update();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'schedule-dialog-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    return outputFiles[0].contents;
}

test('schedule dialog: any folder, per-task relay/model/effort/context/permission, named models, both themes', { timeout: 180000 }, async t => {
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    await mkdir('/tmp/nm-shots/schedule', { recursive: true });
    const assets = { '/fixture.js': ['text/javascript', await bundle()],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))], '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'>${CSS.map(name => `<link rel='stylesheet' href='/${name}'>`).join('')}<style>${THEIA_THEME_CSS}
html,body,#fixture,.nmx-desktop-widget{margin:0;width:100%;height:100%;font:13px system-ui}*{box-sizing:border-box}.nmx-shell{position:relative;width:100%;height:100%}</style></head><body><div id='fixture'></div><script>document.body.className='theia-'+(new URLSearchParams(location.search).get('theme')||'dark')</script><script src='/fixture.js'></script></body></html>`] };
    for (const name of CSS) assets['/' + name] = ['text/css', await readFile(new URL(`../src/browser/style/${name}`, import.meta.url))];
    const server = createServer((request, response) => { const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en']) for (const [width, height] of [[420, 760], [1200, 820]]) {
        const label = `${theme}-${locale}-${width}`;
        await page.setViewport({ width, height });
        await page.goto(`${origin}/?${new URLSearchParams({ theme, locale })}`, { waitUntil: 'load' });
        await page.waitForFunction(() => Number(document.body.dataset.localized || 0) > 0);
        const initial = await page.evaluate(() => ({ create: document.querySelector('.nmx-schedule-dialog footer .is-primary').disabled, effort: Boolean(document.querySelector('[aria-label*="effort" i], select[aria-label="计划思考深度"]')) }));
        assert.ok(initial.create, `${label}: create stays disabled until the plan is complete`);
        await page.click('.nmx-schedule-workspace-row button');
        assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['chooseFolder'], `${label}: any folder can be chosen`);
        const relay = await page.$('.nmx-schedule-options select');
        await relay.select('official:c1');
        assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['loadModels', 'official:c1']);
        const relayOptions = await page.$$eval('.nmx-schedule-options select:first-of-type option', options => options.map(option => option.value));
        assert.ok(!relayOptions.includes('auto'), `${label}: no automatic entry in the relay list`);
        const models = await page.evaluate(() => [...document.querySelectorAll('.nmx-schedule-options label:nth-child(2) select option')].map(option => option.textContent));
        assert.ok(models.includes('GPT Image 2') && models.includes('GPT Image 1.5') && models.includes('claude-sonnet-4-5'), `${label}: models are named individually ${models}`);
        const modelSelect = (await page.$$('.nmx-schedule-options select'))[1];
        await modelSelect.select('o1');
        await page.waitForFunction(() => document.querySelectorAll('.nmx-schedule-runtime-options select').length === 2);
        const runtime = await page.evaluate(() => ({ selects: document.querySelectorAll('.nmx-schedule-runtime-options select').length,
            permissions: [...document.querySelectorAll('.nmx-schedule-runtime-options select')].at(-1).options.length,
            context: document.querySelector('.nmx-schedule-capability-readonly strong')?.textContent || '' }));
        assert.equal(runtime.permissions, 3, `${label}: three permission levels`);
        assert.match(runtime.context, /200/, `${label}: exact context from the API`);
        await modelSelect.select('m1');
        await page.waitForFunction(() => document.querySelectorAll('.nmx-schedule-runtime-options select').length === 1);
        assert.equal(await page.$('.nmx-schedule-capability-readonly'), null, `${label}: no guessed context when the API gives none`);
        await page.type('.nmx-schedule-dialog label input', 'Nightly check');
        await page.type('.nmx-schedule-dialog textarea', 'Run the test suite');
        await page.waitForFunction(() => !document.querySelector('.nmx-schedule-dialog footer .is-primary').disabled);
        const geometry = await page.evaluate(() => { const dialog = document.querySelector('.nmx-schedule-dialog').getBoundingClientRect();
            const controls = [...document.querySelectorAll('.nmx-schedule-dialog :is(button, select, input, textarea)')];
            return { inside: dialog.left >= 0 && dialog.right <= innerWidth + 1, square: controls.filter(node => parseFloat(getComputedStyle(node).borderTopLeftRadius) < 4).map(node => node.tagName + ':' + (node.getAttribute('aria-label') || node.textContent).slice(0, 20)),
                text: document.querySelector('.nmx-schedule-dialog').innerText };
        });
        assert.ok(geometry.inside, `${label}: dialog inside the window`);
        assert.deepEqual(geometry.square, [], `${label}: rounded controls`);
        if (locale === 'en') assert.doesNotMatch(geometry.text, /[\p{Script=Han}]|desktop action/u, `${label}: untranslated copy`);
        await page.screenshot({ path: `/tmp/nm-shots/schedule/dialog-${label}.png` });
        await page.click('.nmx-schedule-dialog footer .is-primary');
        const saved = await page.evaluate(() => window.fixture.calls.at(-1));
        assert.equal(saved[0], 'save'); assert.equal(saved[1].routeId, 'm1'); assert.equal(saved[1].relayKey, 'official:c1');
    }
    assert.deepEqual(errors, []);
});
