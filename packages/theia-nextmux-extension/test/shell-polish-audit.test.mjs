import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { startSettingsFixture } from './settings-fixture-harness.mjs';

// Regressions found by the 2026-09 real-app audit of the app shell, settings,
// plugins/MCP and comic studio. Unit checks run against lib/; the visual
// checks mount production renderSettings + every production stylesheet in
// real Chromium (settings-fixture-harness.mjs).
const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const { shellSurfaceCatalog, shellSurfaceSources, pluginSummaryText, comicCountText } = require('../lib/browser/nextmux-shell-surface-locale.js');
const { localizeDesktopSurface } = require('../lib/browser/nextmux-surface-locale.js');
const { formatMcpArguments, parseMcpArguments, mcpTransportLabel, mcpStatus } = require('../lib/browser/nextmux-mcp-access-panel.js');
const { DeviceLinkActions, deviceLinkState, deviceLinkText } = require('../lib/browser/nextmux-device-link-status.js');
const { ThemePreferenceIcon } = require('../lib/browser/nextmux-theme-icons.js');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const han = /[\p{Script=Han}]/u;
const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const polish = await readFile(new URL('../src/browser/style/nextmux-shell-polish.css', import.meta.url), 'utf8');
const frontendModule = await readFile(new URL('../src/browser/nextmux-frontend-module.ts', import.meta.url), 'utf8');
const platformService = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const mcpServer = await readFile(new URL('../src/node/nextmux-mcp-server.ts', import.meta.url), 'utf8');

test('reviewed shell rows exist for all eleven translated locales and win over the machine catalogue', () => {
    for (const locale of locales.filter(value => value !== 'zh-CN')) {
        for (const source of shellSurfaceSources) {
            assert.ok(shellSurfaceCatalog[locale][source]?.trim(), `${locale}:${source}`);
            assert.equal(localizeDesktopSurface(locale, source), shellSurfaceCatalog[locale][source], `${locale}:${source}`);
        }
    }
    // Film shot sizes and shot (镜头) were literal ("A grand vision", ja "撃たれた", de "Erschossen").
    assert.equal(localizeDesktopSurface('en', '大远景'), 'Extreme long shot');
    assert.equal(localizeDesktopSurface('ja', '镜头'), 'ショット');
    assert.equal(localizeDesktopSurface('de', '镜头'), 'Einstellung');
    assert.equal(localizeDesktopSurface('en', '上移'), 'Move up');
    // Composite labels are translated by substring replacement and must use the reviewed terms too.
    assert.equal(localizeDesktopSurface('en', '镜头 01 · 远景'), 'Shot 01 · Long shot');
    // zh-TW paraphrases replaced by OpenCC conversions of the source.
    assert.equal(localizeDesktopSurface('zh-TW', '余额、充值与消费'), '餘額、儲值與消費');
    assert.equal(localizeDesktopSurface('zh-TW', 'Agent 就绪'), 'Agent 就緒');
});

test('plugin summary and comic counters never leak Chinese measure words or wrong plurals', () => {
    assert.equal(pluginSummaryText('en', 'summary', 0, 1), '0 Skills · 1 MCP services');
    assert.equal(pluginSummaryText('zh-CN', 'summary', 2, 3), '2 个 Skills · 3 个 MCP 服务');
    for (const locale of locales) {
        for (const kind of ['summary', 'skillsCard', 'mcpCard']) {
            const text = pluginSummaryText(locale, kind, 4, 5);
            assert.doesNotMatch(text, /\{n\}|piece/, `${locale}:${kind}`);
            if (!locale.startsWith('zh') && locale !== 'ja') assert.doesNotMatch(text, han, `${locale}:${kind}`);
        }
        for (const kind of ['scriptChars', 'episodes', 'characters', 'sceneDrafts', 'scenes', 'shots']) {
            assert.doesNotMatch(comicCountText(locale, kind, 3), /\{n\}/, `${locale}:${kind}`);
            if (!locale.startsWith('zh') && !['ja', 'ko'].includes(locale)) assert.doesNotMatch(comicCountText(locale, kind, 3), han, `${locale}:${kind}`);
        }
    }
    assert.equal(comicCountText('en', 'scenes', 1), '1 scene');
    assert.equal(comicCountText('en', 'shots', 2), '2 shots');
    assert.equal(comicCountText('zh-CN', 'scriptChars', 41), '41 字');
    assert.match(widget, /pluginSummaryText\(this\.desktopLocale, 'summary'/);
    assert.doesNotMatch(widget, /个 Skills · \$\{this\.runningMcpServers\.length\} 个 MCP 服务/);
    assert.doesNotMatch(widget, /'Local project file'/, 'comic runtime card must not hard-code English');
    assert.match(widget, /codicon-extensions'><\/i><span>插件<\/span>/, 'plugins use the extensions glyph, not @');
});

test('MCP editor shows one argument per line, localizes every transport label and names a missing command', () => {
    assert.equal(formatMcpArguments(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']), '-y\n@modelcontextprotocol/server-filesystem\n/tmp');
    assert.equal(formatMcpArguments([]), '');
    for (const lossy of [['a folder '], [''], ['line\nbreak'], ['[json-like']]) {
        const text = formatMcpArguments(lossy);
        assert.equal(text, JSON.stringify(lossy), 'values that cannot survive line splitting stay JSON');
        assert.deepEqual(parseMcpArguments(text), lossy);
    }
    assert.deepEqual(parseMcpArguments(formatMcpArguments(['node', 'server.mjs'])), ['node', 'server.mjs']);
    assert.deepEqual(parseMcpArguments(''), []);
    const labels = new Set(locales.map(locale => mcpTransportLabel(locale)));
    assert.equal(labels.size >= 10, true, 'transport label is translated, not the "Add service" fallback');
    for (const locale of locales) {
        const status = mcpStatus(locale, { running: false, approved: true, local: true, status: 'Errored', diagnostic: 'dependency', failure: { stage: 'startup', code: 'runtime_missing' } });
        assert.equal(status.tone, 'error');
        assert.doesNotMatch(status.label, /运行组件|Runtime component/, `${locale}: a missing user command is not a broken install`);
    }
    assert.match(mcpStatus('en', { running: false, approved: true, local: true, status: 'Errored', failure: { stage: 'startup', code: 'runtime_missing' } }).label, /Command not found/);
    const panel = require('node:fs').readFileSync(new URL('../src/browser/nextmux-mcp-access-panel.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(panel, /useState\('\[\]'\)|setArgs\('\[\]'\)/, 'the args editor must not start with a raw JSON array');
    assert.doesNotMatch(panel, /locale === 'zh-CN' \? '个参数' : 'args'/);
    // A spawn failure (ENOENT) must not be overwritten by the generic exit event that follows it.
    assert.match(mcpServer, /const prior = this\.localFailure;\s*if \(!prior \|\| prior\.code === 'process_exit' \|\| prior\.code === 'connection'\)/);
    assert.match(mcpServer, /spawn \$\{code === -2 \? 'ENOENT'/);
});

test('community Skills errors are friendly and deduplicated instead of "GitHub 返回 HTTP 403" per source', () => {
    assert.doesNotMatch(platformService, /GitHub 返回 HTTP/);
    assert.match(platformService, /status === 403 \|\| status === 429 \? 'GitHub 访问受限，请稍后重试'/);
    assert.match(platformService, /reasons\.length === 1 \? reasons\[0\]/);
    for (const locale of locales.filter(value => value !== 'zh-CN')) {
        assert.doesNotMatch(localizeDesktopSurface(locale, 'GitHub 访问受限，请稍后重试'), /HTTP|Return|返回/, locale);
    }
});

test('browser sign-in has a visible pending / expired state with the one-time code, reopen and cancel', () => {
    assert.equal(deviceLinkState({ linked: false, starting: true }), 'starting');
    assert.equal(deviceLinkState({ linked: false, starting: false, expiresAt: 2_000, now: 1_000 }), 'pending');
    assert.equal(deviceLinkState({ linked: false, starting: false, expiresAt: 1_000, now: 2_000 }), 'expired');
    assert.equal(deviceLinkState({ linked: true, starting: false, expiresAt: 2_000, now: 1_000 }), 'idle');
    for (const locale of locales) for (const state of ['idle', 'starting', 'pending', 'expired']) assert.ok(deviceLinkText(locale, state).trim(), `${locale}:${state}`);
    const noop = () => undefined;
    const pending = renderToStaticMarkup(React.createElement(DeviceLinkActions, { locale: 'en', state: 'pending', code: '6557-4560', signInLabel: 'Sign in', onStart: noop, onReopen: noop, onCancel: noop }));
    assert.match(pending, /6557-4560/); assert.match(pending, />Open again</); assert.match(pending, />Cancel</);
    const expired = renderToStaticMarkup(React.createElement(DeviceLinkActions, { locale: 'zh-CN', state: 'expired', signInLabel: '登录/注册', onStart: noop, onReopen: noop, onCancel: noop }));
    assert.match(expired, />重新登录</);
    const starting = renderToStaticMarkup(React.createElement(DeviceLinkActions, { locale: 'en', state: 'starting', signInLabel: 'Sign in', onStart: noop, onReopen: noop, onCancel: noop }));
    assert.match(starting, /disabled=""/);
    assert.match(widget, /protected cancelDeviceLink\(\): void \{[\s\S]*?accountLinkCoordinator\?\.cancel\(\)/);
    assert.match(widget, /deviceLinkExpiryTimer = remaining > 0/);
});

test('theme options use sun / moon / monitor glyphs and the "浅色 / 深色" wording', () => {
    for (const theme of ['system', 'light', 'dark']) {
        const markup = renderToStaticMarkup(React.createElement(ThemePreferenceIcon, { theme }));
        assert.match(markup, new RegExp(`data-theme-icon="${theme}"`)); assert.match(markup, /stroke="currentColor"/);
    }
    assert.match(widget, /\[\['system', '跟随系统'\], \['light', '浅色'\], \['dark', '深色'\]\]/);
    assert.doesNotMatch(widget, /\['light', '白色', 'chrome-maximize'\]/);
    assert.equal(localizeDesktopSurface('en', '浅色'), 'Light');
    assert.equal(localizeDesktopSurface('ja', '深色'), 'ダーク');
});

test('shell polish stylesheet is loaded last and repairs the audited defects', () => {
    const imports = [...frontendModule.matchAll(/style\/([^']+\.css)'/g)].map(match => match[1]);
    for (const earlier of ['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-comic-studio.css', 'nextmux-pickers-settings.css', 'nextmux-settings-polish.css']) {
        assert.ok(imports.indexOf('nextmux-shell-polish.css') > imports.indexOf(earlier), `shell polish must load after ${earlier}`);
    }
    assert.match(polish, /\.nmx-shell \.nmx-context-nav \{\s*overflow-y: auto;/);
    assert.match(polish, /\.nmx-model-center-topbar \.nmx-topbar-routing > \.nmx-checkbox-indicator \{ display: none; \}/);
    assert.match(polish, /\.nmx-permission-sheet\.nmx-comic-character-sheet \{\s*width: min\(760px/);
    assert.match(polish, /\.nmx-relay-options strong \{[\s\S]*?mask-image: linear-gradient\(90deg/);
    assert.match(polish, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(widget, /className='nmx-projects-add' aria-label='添加项目文件夹'/);
    assert.match(widget, /<select data-nmx-literal value=\{this\.desktopLocale\}/, 'language endonyms are not machine-translated');
});

test('signed-out account card, theme icons, MCP editor and comic sheets render soft and correct in real Chromium', { timeout: 240000 }, async t => {
    const { origin, server, puppeteer } = await startSettingsFixture();
    t.after(() => new Promise(resolve => server.close(resolve)));
    await mkdir('/tmp/nm-shots/shell-polish', { recursive: true });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en']) for (const [width, height] of [[760, 760], [1280, 820]]) {
        const label = `${theme}-${locale}-${width}`;
        await page.setViewport({ width, height });
        await page.goto(`${origin}/?${new URLSearchParams({ theme, locale, panel: 'profile' })}`, { waitUntil: 'load' });
        await page.waitForFunction(() => Number(document.body.dataset.localized || 0) > 0);
        // Theme options: three SVG glyphs, no codicon square/dot stand-ins.
        const theming = await page.evaluate(() => [...document.querySelectorAll('.nmx-theme-options [role=radio]')].map(node => ({
            svg: Boolean(node.querySelector('svg.nmx-theme-icon')), codicon: Boolean(node.querySelector('.codicon-chrome-maximize, .codicon-circle-filled')),
            iconWidth: node.querySelector('svg')?.getBoundingClientRect().width || 0 })));
        assert.equal(theming.length, 3, label);
        assert.ok(theming.every(item => item.svg && !item.codicon && item.iconWidth >= 12 && item.iconWidth <= 18), `${label}: ${JSON.stringify(theming)}`);
        // Signed out → pending browser sign-in shows the code and two actions inside the card.
        const states = [];
        for (const [link, expected] of [[undefined, 'idle'], [{ code: '6557-4560', verificationUrl: 'https://nextmux.app/connect-device?code=6557-4560', expiresAt: Date.now() + 600_000 }, 'pending'], [{ code: 'OLD', verificationUrl: 'https://nextmux.app/x', expiresAt: Date.now() - 1 }, 'expired']]) {
            const before = await page.evaluate(() => Number(document.body.dataset.localized || 0));
            await page.evaluate(value => { window.fixture.platformSession = { linked: false, wallets: [] }; window.fixture.deviceLink = value; window.fixture.update(); }, link);
            await page.waitForFunction(value => Number(document.body.dataset.localized || 0) > value, {}, before);
            states.push(await page.evaluate(() => {
                const card = document.querySelector('.nmx-profile-card'), actions = card.querySelector('.nmx-device-link-actions');
                const cardBox = card.getBoundingClientRect(), box = actions.getBoundingClientRect();
                return { state: actions.dataset.deviceLinkState, text: card.innerText, buttons: [...actions.querySelectorAll('button')].map(button => ({ text: button.textContent, radius: parseFloat(getComputedStyle(button).borderTopLeftRadius), transition: getComputedStyle(button).transitionDuration })),
                    inside: box.left >= cardBox.left - 1 && box.right <= cardBox.right + 1, actionsWidth: box.width, codeLines: actions.querySelector('.nmx-device-link-code') ? (Math.abs(actions.querySelector('.nmx-device-link-code > small').getBoundingClientRect().top - actions.querySelector('.nmx-device-link-code > bdi').getBoundingClientRect().top) < 8 && actions.querySelector('.nmx-device-link-code > bdi').getBoundingClientRect().height < 24 ? 1 : 2) : 0 };
            }));
            assert.equal(states.at(-1).state, expected, `${label}: ${expected}`);
        }
        const [idle, pending, expired] = states;
        assert.equal(idle.buttons.length, 1, `${label}: idle has one sign-in button`);
        assert.equal(pending.buttons.length, 2, `${label}: pending offers reopen + cancel`);
        assert.match(pending.text, /6557-4560/, `${label}: one-time code visible`);
        if (pending.codeLines !== 1) await page.screenshot({ path: `/tmp/nm-shots/shell-polish/${label}-code.png` });
        assert.equal(pending.codeLines, 1, `${label}: the code chip stays on one line (avatar rule must not squeeze it)`);
        assert.ok(pending.actionsWidth > 120 && pending.inside, `${label}: action group has real width inside the card`);
        assert.equal(expired.buttons.length, 1, `${label}: expired offers sign in again`);
        assert.doesNotMatch(idle.text, /未登录\s*\n\s*未登录|Not signed in\s*\n\s*Not signed in/, `${label}: no duplicated "not signed in"`);
        for (const state of states) for (const button of state.buttons) {
            assert.ok(button.radius >= 6, `${label}: rounded account buttons`);
            assert.ok(parseFloat(button.transition) > 0, `${label}: account buttons transition on hover`);
        }
        if (locale === 'en') for (const state of states) assert.doesNotMatch(state.text, /[\p{Script=Han}]/u, `${label}: untranslated account copy`);
        // MCP editor: empty argument list with an example placeholder, transport label localized.
        await page.click('[data-settings-panel="mcp"]');
        await page.waitForSelector('.nmx-mcp-toolbar button:not([disabled])');
        await page.evaluate(() => [...document.querySelectorAll('.nmx-mcp-toolbar button')].at(-1).click());
        await page.waitForSelector('.nmx-mcp-form select');
        await page.select('.nmx-mcp-form select', 'local');
        await page.waitForSelector('.nmx-mcp-form textarea');
        const editor = await page.evaluate(() => ({ value: document.querySelector('.nmx-mcp-form textarea').value, placeholder: document.querySelector('.nmx-mcp-form textarea').placeholder,
            transport: document.querySelector('.nmx-mcp-form select').closest('label').querySelector('span').textContent }));
        assert.equal(editor.value, '', `${label}: no raw [] in the one-per-line editor`);
        assert.match(editor.placeholder, /\n/, `${label}: placeholder shows one argument per line`);
        assert.equal(editor.transport, locale === 'en' ? 'Transport' : '连接类型', label);
        // MCP tool rows: checkbox + text, not the 150px settings label grid.
        await page.evaluate(() => { for (const details of document.querySelectorAll('.nmx-mcp-server-toggle')) details.click(); });
        const tools = await page.evaluate(() => [...document.querySelectorAll('.nmx-mcp-tools fieldset > label')].map(row => {
            const box = row.querySelector('input').getBoundingClientRect(), text = row.querySelector('span').getBoundingClientRect();
            return { display: getComputedStyle(row).display, checkbox: box.width, gap: text.left - box.right };
        }));
        for (const tool of tools) {
            assert.equal(tool.display, 'flex', `${label}: tool row layout`);
            assert.ok(tool.checkbox >= 12 && tool.checkbox <= 16 && tool.gap >= 4 && tool.gap <= 16, `${label}: checkbox sits next to its tool ${JSON.stringify(tool)}`);
        }
        // Production CSS for comic sheets: soft fields and the full-width character editor.
        const comic = await page.evaluate(() => {
            const host = document.createElement('div');
            host.className = document.querySelector('.fixture-shell').className;
            host.innerHTML = `<div class='nmx-comic-studio'><div class='nmx-sheet-backdrop nmx-dialog-backdrop'>
                <section class='nmx-permission-sheet nmx-comic-create-sheet nmx-comic-surface-v4'><label>Name<input value='x'></label><label>Ratio<select><option>16:9</option></select></label><div><button class='nmx-secondary-button'>Cancel</button><button class='nmx-primary-button'>Create</button></div></section></div>
                <div class='nmx-sheet-backdrop nmx-dialog-backdrop'><section class='nmx-permission-sheet nmx-comic-character-sheet nmx-comic-surface-v4'><header><div><span>Characters</span><h2>Project</h2></div><div class='nmx-character-library-actions'><button>Save</button></div><button>×</button></header><div class='nmx-character-layout'><aside><button class='nmx-character-new'>+ New</button></aside><section><label>Name<input value=''></label></section></div></section>
            </div></div>`;
            document.body.append(host);
            const input = host.querySelector('.nmx-comic-create-sheet input'), select = host.querySelector('.nmx-comic-create-sheet select'), character = host.querySelector('.nmx-comic-character-sheet');
            const style = node => getComputedStyle(node);
            const result = { inputRadius: parseFloat(style(input).borderTopLeftRadius), selectRadius: parseFloat(style(select).borderTopLeftRadius),
                inputHeight: input.getBoundingClientRect().height, characterWidth: character.getBoundingClientRect().width, viewport: innerWidth,
                footerGap: host.querySelector('.nmx-comic-create-sheet > div:last-child').getBoundingClientRect().top - select.getBoundingClientRect().bottom,
                characterInputRadius: parseFloat(style(host.querySelector('.nmx-character-layout input')).borderTopLeftRadius) };
            host.remove();
            return result;
        });
        assert.ok(comic.inputRadius >= 6 && comic.selectRadius >= 6 && comic.characterInputRadius >= 6, `${label}: comic fields are rounded ${JSON.stringify(comic)}`);
        assert.ok(comic.inputHeight >= 32 && comic.inputHeight <= 36, `${label}: comic field height`);
        assert.ok(comic.footerGap >= 12, `${label}: dialog actions are separated from the last field`);
        assert.ok(comic.characterWidth >= Math.min(700, comic.viewport - 60), `${label}: character editor is not squeezed to 460px (${comic.characterWidth})`);
        await page.screenshot({ path: `/tmp/nm-shots/shell-polish/${label}.png` });
    }
    assert.deepEqual(errors, []);
});

test('scheduled plans can be run now through the same claimed, de-duplicated dispatch path', () => {
    assert.match(widget, /protected async executeScheduledTask\(task: ScheduledTaskRecord, manualOccurrenceAt\?: number\)/);
    assert.match(widget, /const occurrenceAt = manualOccurrenceAt \?\? this\.scheduledTaskDueAt\(task, Date\.now\(\)\);/);
    assert.match(widget, /className='nmx-scheduled-run' disabled=\{task\.lastStatus === 'running' \|\| this\.runningScheduledTaskIds\.has\(task\.id\)[^}]*\} aria-label='立即运行'[^>]*onClick=\{\(\) => void this\.executeScheduledTask\(task, Date\.now\(\)\)\}/);
    assert.doesNotMatch(widget, /'后台唤醒' : '应用运行时'/, 'the app-run mode reads as a behaviour, not "Application Runtime"');
    for (const locale of locales.filter(value => value !== 'zh-CN')) {
        assert.doesNotMatch(localizeDesktopSurface(locale, '立即运行'), locale.startsWith('zh') || locale === 'ja' ? /$^/ : han, locale);
        assert.notEqual(localizeDesktopSurface(locale, '立即运行'), '立即运行', locale);
        assert.notEqual(localizeDesktopSurface(locale, '应用打开时运行'), '应用打开时运行', locale);
    }
});
