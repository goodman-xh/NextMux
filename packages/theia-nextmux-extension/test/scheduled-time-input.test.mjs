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

test('native scheduled time input retains multi-digit edits across asynchronous widget renders', { timeout: 60000 }, async t => {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const render = ['selectedScheduleModelRoute', 'scheduleRouteModelLabel', 'reasoningDepthChoicesForRoute', 'reasoningDepthLabel', 'renderScheduleDialog'].map(name => widget.members.find(node => node.name?.getText(file) === name).getText(file)).join('\n');
    const entry = `import * as React from 'react'; import { createRoot } from 'react-dom/client';
import { validScheduleTime, localScheduleDateTime } from '../common/nextmux-schedule';
import { normalizeContextWindowTokens, contextWindowTokenLabel } from '../common/nextmux-context-budget';
import { goalScheduleText } from './nextmux-goal-schedule-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { formatBalanceMicros } from './nextmux-money-format';
import { declaredReasoningSettings, reasoningDepthChoices } from '../common/nextmux-model-controls';
import { reasoningOptionKey } from '@nextmux/model-runtime/reasoning-evidence';
import { reasoningControlText } from './nextmux-reasoning-controls-locale';
const contextBudgetText = (_locale, value) => value;
class Fixture {
 desktopLocale = 'zh-CN'; scheduleDialogOpen = true; scheduledTasks = []; scheduledTasksReady = true;
 scheduleDraft = { title: 'Test plan', prompt: 'No external work', workspacePath: '/project', cadence: 'once', runAt: '2099-09-21T04:02', routeId: 'route' };
 scheduledTaskWorkspaceOptions() { return [{ path: '/project', label: 'Project' }]; }
 scheduleModelRoutes() { return [{ id: 'route', kind: 'official_connection', connection: { model: 'Model' } }]; }
 isModelVisible() { return true; } modelKeyForRoute() { return 'Model'; }
 relayOptions() { return []; } reasoningEffortLevels() { return []; } modelContextWindowTokens() { return undefined; }
 modelReasoningContract() { return undefined; } localReasoningEvidence() { return undefined; }
 permissionLabel(mode) { return mode; } trapDialogFocus() {} closeNavigationSurface() {} async saveScheduledTask() { this.saved = this.scheduleDraft.runAt; }
 update() { requestAnimationFrame(() => root.render(this.renderScheduleDialog())); }
 ${render}
}
const root = createRoot(document.getElementById('fixture')); window.fixture = new Fixture(); window.fixture.update();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx',
        resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'schedule-time-fixture.tsx' }, bundle: true, write: false,
        platform: 'browser', format: 'iife', logLevel: 'silent', alias: { react: core.resolve('react'),
        'react-dom/client': core.resolve('react-dom/client') } });
    const server = createServer((request, response) => {
        response.writeHead(200, { 'content-type': request.url === '/fixture.js' ? 'text/javascript' : 'text/html' });
        response.end(request.url === '/fixture.js' ? outputFiles[0].contents : `<!doctype html><html lang="en-US"><body><input id="native-baseline" type="datetime-local" value="2099-09-21T04:02"><div id="fixture"></div><script src="/fixture.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('#fixture input[type="datetime-local"]');
    await page.focus('#native-baseline');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.type('52', { delay: 100 });
    assert.equal(await page.$eval('#native-baseline', input => input.value), '2099-09-21T04:52');
    await page.focus('#fixture input[type="datetime-local"]');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.type('52', { delay: 100 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const value = await page.$eval('#fixture input[type="datetime-local"]', input => input.value);
    assert.equal(value, '2099-09-21T04:52');
    assert.equal(await page.evaluate(() => window.fixture.scheduleDraft.runAt), value);
    await page.click('#fixture button.is-primary');
    assert.equal(await page.evaluate(() => window.fixture.saved), value, 'saving uses the last edit without a second confirmation');
    await page.$$eval('#fixture select', selects => selects.find(select => [...select.options].some(option => option.value === 'once')).id = 'cadence');
    await page.select('#cadence', 'daily');
    await page.waitForSelector('#fixture input[type="time"]');
    assert.equal(await page.$eval('#fixture input[type="time"]', input => input.value), '09:00');
    await page.focus('#fixture input[type="time"]');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('37', { delay: 100 });
    assert.equal(await page.$eval('#fixture input[type="time"]', input => input.value), '09:37');
    assert.equal(await page.evaluate(() => window.fixture.scheduleDraft.runAt), '09:37');
    await page.select('#cadence', 'weekly');
    await page.waitForFunction(() => document.querySelector('#fixture input[type="time"]').value === '09:00');
    await page.focus('#fixture input[type="time"]');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Backspace');
    await page.waitForFunction(() => document.querySelector('#fixture button.is-primary').disabled);
    assert.equal(await page.evaluate(() => window.fixture.scheduleDraft.runAt), '');
    assert.equal(await page.$eval('#fixture input[type="time"]', input => input.getAttribute('aria-invalid')), 'true');
    assert.match(await page.$eval('#nmx-schedule-time-error', node => node.textContent), /有效时间/);
    await page.keyboard.type('09', { delay: 100 });
    await page.waitForFunction(() => !document.querySelector('#fixture button.is-primary').disabled);
    assert.equal(await page.$('#nmx-schedule-time-error'), null);
    assert.equal(await page.$eval('#fixture input[type="time"]', input => input.value), '09:09');
    await page.click('#fixture button.is-primary');
    assert.equal(await page.evaluate(() => window.fixture.saved), '09:09');
    await page.evaluate(() => {
        const state = window.fixture;
        const prior = { ...state.scheduleDraft, id: 'ai-plan', routeId: 'official:connection:gpt-6-astra', relayKey: 'official:connection',
            modelId: 'gpt-6-astra', reasoningEffort: 'low', contextWindowTokens: 32000,
            modelRoute: { kind: 'official_connection', connectionId: 'connection', model: 'gpt-6-astra' } };
        state.scheduledTasks = [prior]; state.scheduleDraft = { ...prior };
        state.scheduleModelRoutes = () => [{ id: 'official:connection', kind: 'official_connection',
            connection: { id: 'connection', model: 'gpt-6-astra' } }];
        state.isModelVisible = () => false; // Editing preserves a previously chosen hidden model.
        state.reasoningEffortLevels = route => route ? ['low', 'high'] : [];
        state.reasoningEffortLabel = value => value;
        state.modelContextWindowTokens = route => route ? 128000 : undefined;
        state.update();
    });
    await page.waitForSelector('select[aria-label="计划思考深度"]');
    await page.waitForFunction(() => !document.querySelector('select[aria-label="计划思考深度"]').disabled);
    assert.equal(await page.$eval('select[aria-label="计划模型"]', select => select.value), 'official:connection');
    assert.deepEqual(await page.$eval('select[aria-label="计划思考深度"]', select => ({ value: select.value, disabled: select.disabled })), { value: 'effort:low', disabled: false }, 'the saved effort is the selected thinking-depth choice');
    assert.equal(await page.$('input[aria-label="custom"]'), null, 'model context is not a user-editable capacity');
    assert.equal(await page.$eval('.nmx-schedule-capability-readonly strong', value => value.textContent), '128K', 'API capacity replaces legacy custom caps');
    await page.evaluate(() => { window.fixture.modelContextWindowTokens = () => undefined; window.fixture.reasoningEffortLevels = () => []; window.fixture.update(); });
    await page.waitForFunction(() => !document.querySelector('.nmx-schedule-capability-readonly'));
    assert.equal(await page.$('select[aria-label="计划思考深度"]'), null, 'unknown API capability stays hidden');
    assert.equal(await page.evaluate(() => window.fixture.scheduleDraft.routeId), 'official:connection:gpt-6-astra', 'rendering metadata does not mutate the saved execution snapshot');
    assert.deepEqual(errors, []);
});
