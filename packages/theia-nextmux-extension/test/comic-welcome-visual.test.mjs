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

// Comic workspace first view (§6.7): the production renderComicWelcome with
// production CSS in real Chromium — both themes, zh-CN / en / ar, narrow and
// wide, with and without a comic project folder. No placeholder or
// untranslated copy, a soft primary action, and the create action is wired.
test('comic welcome renders cleanly and wires its action in both themes and three locales', { timeout: 180000 }, async t => {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = name => widget.members.find(value => ts.isMethodDeclaration(value) && value.name.getText(file) === name).getText(file);
    const entry = `import * as React from 'react'; import * as ReactDOM from 'react-dom'; import { createRoot } from 'react-dom/client';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { formatBalanceMicros } from './nextmux-money-format';
import { ThemePreferenceIcon } from './nextmux-theme-icons';
import { DeviceLinkActions, deviceLinkState, deviceLinkText } from './nextmux-device-link-status';
import { comicCountText, pluginSummaryText } from './nextmux-shell-surface-locale';
import { SystemPermissionsSettings, systemPermissionsText } from './nextmux-system-permissions-panel';
import { SYSTEM_NOTIFICATIONS_KEY, systemNotificationsEnabled, taskNotificationText } from './nextmux-task-notification-text';
import { desktopText } from './nextmux-locale';
import { comicStudioText } from './nextmux-comic-studio-text';
import { formatEditorTime } from './nextmux-comic-editor';
import { COMIC_KIND_ICONS, COMIC_PROJECT_KINDS, ComicHomeCategories, comicKindText, comicProjectKindOf } from './nextmux-comic-kinds';
import URI from '@theia/core/lib/common/uri';
const params = new URLSearchParams(location.search);
class Fixture {
  desktopLocale = params.get('locale') || 'zh-CN'; comicStage = 'idle'; calls = []; comicModelsSheetOpen = false;
  comicLibrary = { root: '/Users/me/NextMux Comics', projects: [
    { path: '/Users/me/NextMux Comics/pilot', title: 'Pilot', aspectRatio: '9:16', shotCount: 12, generatedShotCount: 5, durationSeconds: 94, updatedAt: '2026-09-25T10:00:00Z' },
    { path: '/Users/me/NextMux Comics/sequel', title: 'Sequel', aspectRatio: '16:9', shotCount: 0, generatedShotCount: 0, updatedAt: '2026-09-24T10:00:00Z', projectKind: 'image' }] };
  comicLibraryLoaded = true; comicHomeKind = 'novel'; comicHomeStatus = 'all';
  tx(key) { return desktopText(this.desktopLocale, key); }
  ct(key, values) { return comicStudioText(this.desktopLocale, key, values); }
  activeComicWorkspace() { return params.get('workspace') ? { path: '/Users/me/comic', label: 'comic' } : undefined; }
  openComicCreateSheet() { this.calls.push('create'); } openComicKindSheet(kind) { this.calls.push('kind:' + kind); }
  openComicHomeKind() { this.calls.push('library'); } openComicStudio(path) { this.calls.push('open:' + path); }
  rememberNavigation() {} clearNavigationSurfaces() {}
  comicProjectOrder = [];
  ${method('renderComicWelcome')}
  ${method('comicHomeProject')}
  ${method('orderedComicProjects')}
  update() { ReactDOM.flushSync(() => root.render(<div className='nmx-desktop-widget' dir={this.desktopLocale === 'ar' ? 'rtl' : 'ltr'} lang={this.desktopLocale}><div className={'nmx-shell nmx-theme-' + (params.get('theme') || 'dark')}><section className='nmx-workspace'><div className='nmx-comic-studio'>{this.renderComicWelcome()}</div></section></div></div>));
    requestAnimationFrame(() => { const node = document.querySelector('.nmx-desktop-widget'), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let current = walker.nextNode(); current; current = walker.nextNode()) { if (current.parentElement?.closest('[data-nmx-literal]')) continue; const next = localizeDesktopSurface(this.desktopLocale, current.data); if (next !== current.data) current.data = next; }
      document.body.dataset.localized = '1'; }); }
}
const root = createRoot(document.getElementById('fixture')); const fixture = window.fixture = new Fixture(); fixture.update();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'comic-welcome-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    const assets = { '/fixture.js': ['text/javascript', outputFiles[0].contents],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))], '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'>${CSS.map(name => `<link rel='stylesheet' href='/${name}'>`).join('')}<style>${THEIA_THEME_CSS}
html,body,#fixture,.nmx-desktop-widget{margin:0;width:100%;height:100%;font:13px system-ui}*{box-sizing:border-box}.nmx-shell{display:block!important}.nmx-shell,.nmx-workspace,.nmx-comic-studio{width:100%;height:100%}</style></head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`] };
    for (const name of CSS) assets['/' + name] = ['text/css', await readFile(new URL(`../src/browser/style/${name}`, import.meta.url))];
    const server = createServer((request, response) => { const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await mkdir('/tmp/nm-shots/comic', { recursive: true });
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en', 'ar']) for (const workspace of ['', '1']) for (const [width, height] of [[480, 760], [1200, 800]]) {
        const label = `${theme}-${locale}-${workspace ? 'project' : 'empty'}-${width}`;
        await page.setViewport({ width, height });
        await page.goto(`${origin}/?${new URLSearchParams({ theme, locale, workspace })}`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.body.dataset.localized === '1').catch(error => { throw new Error(`${label}: never rendered (${errors.join(' | ') || error.message})`); });
        const report = await page.evaluate(() => ({ text: document.querySelector('.nmx-comic-empty-v4').innerText, overflow: document.documentElement.scrollWidth - innerWidth,
            kinds: document.querySelectorAll('.nmx-comic-cats-tabs > .nmx-comic-cats-tab').length,
            statuses: document.querySelectorAll('.nmx-comic-cats-status > button').length,
            cards: [...document.querySelectorAll('.nmx-comic-cats-card strong')].map(node => node.textContent),
            cta: (() => { const button = document.querySelector('.nmx-comic-primary-cta'); return button ? parseFloat(getComputedStyle(button).borderTopLeftRadius) : undefined; })() }));
        assert.doesNotMatch(report.text, /desktop action/, `${label}: placeholder copy`);
        if (locale !== 'zh-CN') assert.doesNotMatch(report.text, /[\p{Script=Han}]/u, `${label}: untranslated copy`);
        assert.ok(report.overflow <= 0, `${label}: horizontal overflow`);
        if (workspace) {
            assert.ok(report.cta >= 6, `${label}: soft primary action`);
            await page.click('.nmx-comic-primary-cta');
            assert.deepEqual(await page.evaluate(() => window.fixture.calls), ['create']);
        }
        // The four kinds are tabs on the home page; each lists its projects by status and creates its own kind.
        assert.equal(report.kinds, 4, `${label}: four kind tabs`);
        assert.equal(report.statuses, 6, `${label}: 全部 / 草稿 / 进行中 / 已完成 / 已导出 / 失败待处理`);
        assert.deepEqual(report.cards, ['Pilot'], `${label}: the novel tab lists only novel projects`);
        await page.evaluate(() => { window.fixture.calls = []; });
        await page.click('.nmx-comic-cats-tab.is-topic');
        await page.click('.nmx-comic-cats-new');
        assert.deepEqual(await page.evaluate(() => window.fixture.calls), ['kind:topic'], `${label}: the tab's 新建 starts its own kind`);
        await page.click('.nmx-comic-cats-tab.is-novel');
        if (width === 1200 || locale === 'zh-CN') await page.screenshot({ path: `/tmp/nm-shots/comic/welcome-${label}.png` });
    }
    assert.deepEqual(errors, []);
});
