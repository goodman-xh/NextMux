import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const shots = new URL('file:///tmp/nm-shots/tab-header/');

/** The real tab view with fake window controls; a canvas stream stands in for the app window's capture. */
export async function startFixture() {
    const entry = `import * as React from 'react'; import {createRoot} from 'react-dom/client';
import {ConversationVisualTabView, resetLiveBubbleCounterForTest} from './nextmux-conversation-tabs-view';
resetLiveBubbleCounterForTest();
const params=new URLSearchParams(location.search), locale=params.get('locale')||'en', windows=params.get('platform')==='windows';
const canvas=document.createElement('canvas'); canvas.width=320; canvas.height=240; const g=canvas.getContext('2d'); g.fillStyle='#345'; g.fillRect(0,0,320,240);
const listeners=new Set(); const state={ userInput:false, placement: windows ? 'desktop' : 'tab', sound:false, parkReason: windows ? (params.get('reason')||'foreground_input_required') : undefined };
const calls=[];
const controls={ state, subscribe:l=>{listeners.add(l);return()=>listeners.delete(l);}, canPark:!windows, canPoint:true, canMute:true, canLock: windows ? params.get('lock')!=='off' : true,
 start: async()=>({ stream: canvas.captureStream(5), placement: state.placement, sound: state.sound }),
 place: async p=>{ calls.push(['place',p]); state.placement=p; return p; }, pointer: async()=>true,
 setSound: async on=>{ calls.push(['sound',on]); state.sound=on; return on; }, setUserInput: async on=>{ calls.push(['input',on]); state.userInput=on; },
 terminateProcess: async()=>{ calls.push(['terminate']); return true; } };
window.fixture={calls, resetBubble:()=>resetLiveBubbleCounterForTest(), change:patch=>{Object.assign(state,patch); for(const l of [...listeners]) l();}};
const multi=params.get('multi')==='1', disconnected=params.get('reopen')!==null;
const tab={ id:'window:1:2', kind:'local-desktop', title:'英雄联盟WeGame版', target: multi ? 'League of Legends (TM) Client' : 'Calculator', status:disconnected ? 'disconnected' : 'connected', createdAt:Date.now(),
 windowRef: multi ? {pid:3332,windowId:6294172} : {pid:1,windowId:2}, appId:'com.apple.calculator',
 ...(multi ? { windows:[
  {pid:3420,windowId:4590396,title:'WeGame',app:'WeGame'},
  {pid:20852,windowId:1510622,title:'League of Legends',app:'LeagueClientUx'},
  {pid:3332,windowId:6294172,title:'League of Legends (TM) Client',app:'League of Legends'}
 ] } : {}) };
const root=createRoot(document.getElementById('fixture'));
const render=announcement=>root.render(<div className='nmx-desktop-widget'><div className={'nmx-shell nmx-theme-'+(params.get('theme')||'dark')}><ConversationVisualTabView locale={locale} tab={tab} announcement={announcement} controls={disconnected ? undefined : controls} onReopenApp={disconnected ? async mode => { calls.push(['reopen',mode]); return mode==='check_or_open' && params.get('reopen')==='running' ? 'running' : 'opened'; } : undefined} /></div></div>);
window.fixture.announce=render;
render();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', sourcefile: 'tab-header-fixture.tsx',
        resolveDir: dirname(fileURLToPath(new URL('../src/browser/nextmux-conversation-tabs-view.tsx', import.meta.url))) },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    const css = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-composer-attachments.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url))));
    const assets = {
        '/fixture.js': ['text/javascript', outputFiles[0].contents],
        '/style.css': ['text/css', Buffer.concat(css)],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))],
        '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'>
<style>html,body{margin:0;height:100%;font:13px system-ui}#fixture,.nmx-desktop-widget{width:100%;height:100%}.nmx-shell{display:block;position:relative;height:100%}</style></head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`]
    };
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

// Observe mutations so a busy browser cannot miss the short fade-out interval.
async function observeToast(page) {
    await page.evaluate(() => {
        const timeline = window.fixture.toastTimeline = {};
        const observer = new MutationObserver(() => {
            const toast = document.querySelector('.nmx-visual-tab-toast');
            const now = performance.now();
            if (toast && timeline.shownAt === undefined) timeline.shownAt = now;
            if (toast?.classList.contains('is-fading-out') && timeline.fadingAt === undefined) timeline.fadingAt = now;
            if (!toast && timeline.shownAt !== undefined) {
                timeline.removedAt = now;
                observer.disconnect();
            }
        });
        observer.observe(document.querySelector('.nmx-visual-tab-screen'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    });
}

async function expectToastAutoDismiss(page) {
    await page.waitForFunction(() => window.fixture.toastTimeline.removedAt !== undefined, { timeout: 5000 });
    const timeline = await page.evaluate(() => window.fixture.toastTimeline);
    assert.ok(timeline.fadingAt !== undefined, 'the toast must fade out before it is removed');
    assert.ok(timeline.fadingAt - timeline.shownAt >= 2500 && timeline.fadingAt - timeline.shownAt < 3300,
        `fade-out must start around 2700 ms: ${JSON.stringify(timeline)}`);
    assert.ok(timeline.removedAt - timeline.shownAt >= 2800 && timeline.removedAt - timeline.shownAt < 3800,
        `the toast must disappear around 3000 ms: ${JSON.stringify(timeline)}`);
    assert.ok(timeline.removedAt - timeline.fadingAt >= 200, 'fade-out must remain mounted for the animation');
    assert.equal(await page.$('.nmx-visual-tab-toast'), null);
}

if (!process.env.TAB_FIXTURE_ONLY) test('tab header switches: macOS placement pair, Windows keeps "tab only" disabled with this window\'s reason, and the AI\'s changes show', { timeout: 240000 }, async t => {
    await mkdir(shots, { recursive: true });
    const fixture = await startFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1100, height: 700 });
    const header = () => page.$$eval('.nmx-visual-tab header button, .nmx-visual-tab header label', nodes => nodes.map(node => ({
        text: node.textContent.trim(), disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true', pressed: node.getAttribute('aria-pressed'), title: node.getAttribute('title') || '',
        checked: node.querySelector('input')?.checked })));

    // macOS: both placements are choices; the AI turning switches on shows at once.
    await page.goto(`${fixture.origin}/?locale=zh-CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nmx-visual-tab-place button');
    let items = await header();
    assert.deepEqual(items.filter(item => /只在标签|也在桌面/.test(item.text)).map(item => [item.text, item.disabled, item.pressed]), [['只在标签', false, 'true'], ['也在桌面', false, 'false']]);
    // "实时" badge shows the occasional "点我关闭进程" bubble on entering, and clicking "实时" opens the process termination confirmation modal.
    await page.waitForSelector('.nmx-visual-tab-live.is-interactive');
    await page.waitForSelector('.nmx-visual-tab-live-bubble');
    assert.equal(await page.$eval('.nmx-visual-tab-live-bubble', node => node.textContent?.trim()), '点我关闭进程');
    await page.click('.nmx-visual-tab-live.is-interactive');
    await page.waitForSelector('.nmx-visual-tab-terminate-modal');
    assert.equal(await page.$('.nmx-visual-tab-live-bubble'), null, 'clicking 实时 dismisses the bubble immediately');
    assert.match(await page.$eval('#nmx-visual-tab-terminate-title', node => node.textContent || ''), /结束「英雄联盟WeGame版」进程？/);
    await page.click('.nmx-visual-tab-terminate-cancel');
    await page.waitForFunction(() => !document.querySelector('.nmx-visual-tab-terminate-modal'));
    await page.click('.nmx-visual-tab-live.is-interactive');
    await page.waitForSelector('.nmx-visual-tab-terminate-confirm');
    await page.click('.nmx-visual-tab-terminate-confirm');
    await page.waitForFunction(() => window.fixture.calls.some(call => call[0] === 'terminate'));
    await page.screenshot({ path: new URL('mac-zh-default.png', shots).pathname });
    await page.evaluate(() => window.fixture.change({ sound: true, userInput: true }));
    await page.waitForFunction(() => [...document.querySelectorAll('.nmx-visual-tab-switch input')].every(input => input.checked));
    await page.screenshot({ path: new URL('mac-zh.png', shots).pathname });

    // Multi-window dropdown on the right side of "实时": defaults to the latest formal window and switches on click.
    await page.goto(`${fixture.origin}/?locale=zh-CN&platform=windows&multi=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nmx-visual-tab-window-trigger');
    const triggerInfo = await page.$eval('.nmx-visual-tab-window-trigger', node => {
        const em = document.querySelector('.nmx-visual-tab > header > button');
        return {
            label: node.querySelector('.nmx-visual-tab-window-label')?.textContent?.trim(),
            count: node.querySelector('.nmx-visual-tab-window-count')?.textContent?.trim(),
            rightOfLive: Boolean(em && node.getBoundingClientRect().left >= em.getBoundingClientRect().right)
        };
    });
    assert.equal(triggerInfo.label, 'League of Legends (TM) Client');
    assert.equal(triggerInfo.count, '3');
    assert.equal(triggerInfo.rightOfLive, true);
    await page.click('.nmx-visual-tab-window-trigger');
    await page.waitForSelector('.nmx-visual-tab-window-menu .nmx-visual-tab-window-option');
    const options = await page.$$eval('.nmx-visual-tab-window-option', nodes => nodes.map(n => n.textContent.trim()));
    assert.deepEqual(options, ['WeGame', 'LeagueClientUx · League of Legends', 'League of Legends (TM) Client']);
    await page.screenshot({ path: new URL('windows-zh-multi-window-dropdown.png', shots).pathname });
    await page.click('.nmx-visual-tab-window-option:nth-child(2)');
    await page.waitForFunction(() => document.querySelector('.nmx-visual-tab-window-label')?.textContent?.trim() === 'LeagueClientUx · League of Legends');

    // Windows: "tab only" stays visible with aria-disabled and explains the reason when clicked; "also on desktop" brings the window forward.
    await page.goto(`${fixture.origin}/?locale=en&platform=windows&reason=background_input_unsupported&lock=off&theme=light`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nmx-visual-tab-place button');
    items = await header();
    const only = items.find(item => item.text === 'Tab only');
    const desktop = items.find(item => item.text === 'Also on desktop');
    assert.equal(only.disabled, true);
    assert.match(only.title, /does not accept input in the background/);
    assert.equal(desktop.pressed, 'true');
    assert.match(items.find(item => /Keyboard & mouse/.test(item.text)).title, /windows on the desktop can always be used directly/);
    await page.click('.nmx-visual-tab-place button[aria-disabled="true"]');
    assert.ok(await page.$('.nmx-visual-tab-screen .nmx-visual-tab-toast.is-error .nmx-visual-tab-error'), 'the notice floats inside the tab screen');
    assert.equal(await page.$eval('.nmx-visual-tab-error', node => node.textContent), only.title, 'the close icon must not change the notice text');
    assert.equal(await page.$('.nmx-visual-tab > header .nmx-visual-tab-error'), null, 'notices must not occupy header space');
    assert.ok(await page.$eval('.nmx-visual-tab > header', node => node.getBoundingClientRect().height < 44), 'the header must stay on one line while the notice is visible');
    await page.click('.nmx-visual-tab-toast-close');
    await page.waitForSelector('.nmx-visual-tab-toast', { hidden: true, timeout: 1000 });
    assert.equal(await page.$('.nmx-visual-tab-toast'), null, 'the close button removes the notice immediately');
    await page.click('.nmx-visual-tab-place button[aria-disabled="true"]');
    await page.waitForSelector('.nmx-visual-tab-toast');
    await page.click('.nmx-visual-tab-toast');
    await page.waitForSelector('.nmx-visual-tab-toast', { hidden: true, timeout: 1000 });
    assert.equal(await page.$('.nmx-visual-tab-toast'), null, 'clicking the notice itself also dismisses it');

    await observeToast(page);
    await page.click('.nmx-visual-tab-place button[aria-disabled="true"]');
    await expectToastAutoDismiss(page);
    const target = await page.$eval('.nmx-visual-tab-place button[aria-pressed="true"]', node => { const r = node.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { text: node.textContent, covered: top !== node && !node.contains(top), topClass: top?.className }; });
    assert.equal(target.covered, false, `the button is covered by ${target.topClass}`);
    await page.click('.nmx-visual-tab-place button[aria-pressed="true"]');
    await page.waitForFunction(() => window.fixture.calls.some(call => call[0] === 'place'), { timeout: 3000 }).catch(() => undefined);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.filter(call => call[0] === 'place')), [['place', 'desktop']]);
    await page.screenshot({ path: new URL('windows-en-light.png', shots).pathname });
    // Until the first frame arrives, an app tab says it is waiting for the app's picture (not "waiting for the desktop").
    if (await page.$('.nmx-visual-tab-empty')) assert.equal(await page.$eval('.nmx-visual-tab-empty strong', node => node.textContent), 'Waiting for the picture');

    // The default reason in another locale.
    await page.goto(`${fixture.origin}/?locale=ar&platform=windows`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nmx-visual-tab-place button');
    assert.match((await header()).find(item => item.disabled).title, /Windows/);
    assert.deepEqual(errors, []);
});

if (!process.env.TAB_FIXTURE_ONLY) test('tab announcements preserve the message, close on click and fade out after three seconds', { timeout: 30000 }, async t => {
    const fixture = await startFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto(`${fixture.origin}/?locale=zh-CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nmx-visual-tab-screen');
    const message = '键鼠已开启，你可随时介入操作，插件将继续运行';
    await page.evaluate(text => window.fixture.announce({ id: Date.now(), text }), message);
    await page.waitForSelector('.nmx-visual-tab-screen .nmx-visual-tab-toast.is-info .nmx-visual-tab-info');
    assert.equal(await page.$eval('.nmx-visual-tab-info', node => node.textContent), message);
    assert.equal(await page.$('.nmx-visual-tab > header .nmx-visual-tab-info'), null);
    assert.ok(await page.$eval('.nmx-visual-tab > header', node => node.getBoundingClientRect().height < 44));
    assert.equal(await page.$eval('.nmx-visual-tab-toast-close', node => node.getAttribute('aria-label')), '关闭通知');
    await page.click('.nmx-visual-tab-toast-close');
    await page.waitForSelector('.nmx-visual-tab-toast', { hidden: true, timeout: 1000 });
    assert.equal(await page.$('.nmx-visual-tab-toast'), null);

    await observeToast(page);
    await page.evaluate(text => window.fixture.announce({ id: Date.now(), text }), message);
    await expectToastAutoDismiss(page);
});

if (!process.env.TAB_FIXTURE_ONLY) test('a dismissed announcement cannot fade out a later error notice early', { timeout: 30000 }, async t => {
    const fixture = await startFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto(`${fixture.origin}/?locale=en&platform=windows`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nmx-visual-tab-place button[aria-disabled="true"]');
    await page.evaluate(() => window.fixture.announce({ id: Date.now(), text: 'Plugin is running' }));
    await page.waitForSelector('.nmx-visual-tab-toast.is-info');
    await page.click('.nmx-visual-tab-toast-close');
    await page.waitForSelector('.nmx-visual-tab-toast', { hidden: true, timeout: 1000 });
    // Separate the two deadlines enough to expose a stale announcement timer.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
    await observeToast(page);
    await page.click('.nmx-visual-tab-place button[aria-disabled="true"]');
    await page.waitForSelector('.nmx-visual-tab-toast.is-error');
    await expectToastAutoDismiss(page);
});


if (!process.env.TAB_FIXTURE_ONLY) test('disconnected app reopen checks running state, traps confirmation focus and restarts only after confirmation', { timeout: 120000 }, async t => {
    const fixture = await startFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?locale=zh-CN&reopen=stopped`);
    await page.waitForSelector('.nmx-visual-tab-reopen');
    assert.equal(await page.$eval('.nmx-visual-tab-reopen', node => node.textContent.trim()), '重新打开');
    await page.click('.nmx-visual-tab-reopen');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), [['reopen', 'check_or_open']]);
    assert.equal(await page.$('[role="dialog"]'), null);

    await page.goto(`${fixture.origin}/?locale=zh-CN&reopen=running`);
    await page.waitForSelector('.nmx-visual-tab-reopen');
    await page.click('.nmx-visual-tab-reopen');
    await page.waitForSelector('[role="dialog"]');
    assert.equal(await page.$eval('#nmx-visual-tab-reopen-title', node => node.textContent), '该应用已经在运行中，是否关闭重新打开？');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), [['reopen', 'check_or_open']]);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmx-visual-tab-terminate-cancel');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmx-visual-tab-terminate-confirm');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmx-visual-tab-terminate-cancel');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('nmx-visual-tab-reopen-link')), true);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), [['reopen', 'check_or_open']]);
    await page.click('.nmx-visual-tab-reopen');
    await page.waitForSelector('[role="dialog"]');
    await page.click('.nmx-visual-tab-terminate-confirm');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), [['reopen', 'check_or_open'], ['reopen', 'check_or_open'], ['reopen', 'restart']]);
    assert.deepEqual(errors, []);
});
