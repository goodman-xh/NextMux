#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Current React + production CSS only. Not an Electron build, real data or RPC.
const root = fileURLToPath(new URL('../', import.meta.url));
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'));
const extensionRequire = createRequire(join(root, 'packages/theia-nextmux-extension/package.json'));
const coreRequire = createRequire(extensionRequire.resolve('@theia/core/package.json'));
const platformRequire = createRequire(join(root, 'apps/cloudflare-platform/package.json'));
const { build } = desktopRequire('esbuild'), puppeteer = platformRequire('puppeteer');
const directory = await mkdtemp(join(tmpdir(), 'nextmux-recovery-visual-'));
const entry = `import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {NextMuxEditorRecoveryPanel} from './packages/theia-nextmux-extension/src/browser/nextmux-editor-recovery-panel';
import {editorRecoveryText} from './packages/theia-nextmux-extension/src/browser/nextmux-editor-recovery-locale';
const params=new URL(location.href).searchParams, locale=params.get('locale')||'en', theme=params.get('theme')||'dark';
const longName='very-long-unsaved-file-恢复副本-'.repeat(6)+'.txt';
const longPath='file:///synthetic-only/project/'+('long-nested-folder-without-spaces/'.repeat(12))+longName;
function Fixture(){const [entries,setEntries]=React.useState(()=>Array.from({length:64},(_,i)=>({key:'copy-'+i,
 name:i===0?longName:'恢复文件 '+i+' — ملف محفوظ — '+longName,path:longPath+'/'+i,
 status:i<32?'saved':i%2?'error':'memory',error:'EDITOR_RECOVERY_UNAVAILABLE',version:'local:'+i+':1:1'})));
 const [deleted,setDeleted]=React.useState(0);return <main className={'nmx-shell fixture-shell'+(theme==='light'?' nmx-theme-light':'')}
 data-theme={theme} dir={locale==='ar'?'rtl':'ltr'}>
 <div className='nmx-editor-recovery-status'><span>{editorRecoveryText(locale,'readonly')}</span>
 <button title={editorRecoveryText(locale,'copyAll')} aria-label={editorRecoveryText(locale,'copyAll')}><i className='codicon codicon-copy'></i></button>
 <button title={editorRecoveryText(locale,'title')} aria-label={editorRecoveryText(locale,'title')}><i className='codicon codicon-history'></i></button></div>
 <NextMuxEditorRecoveryPanel locale={locale} entries={entries} onOpen={()=>{}} onRetry={()=>{}}
 onDiscard={(key)=>{setDeleted(value=>value+1);setEntries(value=>value.filter(item=>item.key!==key));}}/>
 <output className='fixture-report' data-deleted={deleted}>Source preview · synthetic records · no RPC</output></main>}
createRoot(document.querySelector('#fixture')).render(<Fixture/>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'recovery-visual.tsx', loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { react: coreRequire.resolve('react'), 'react-dom/client': coreRequire.resolve('react-dom/client') }, logLevel: 'silent' });
const styles = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name =>
    readFile(join(root, 'packages/theia-nextmux-extension/src/browser/style', name))));
const iconStyle = await readFile(coreRequire.resolve('@vscode/codicons/dist/codicon.css'));
const iconFont = await readFile(coreRequire.resolve('@vscode/codicons/dist/codicon.ttf'));
const html = `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Isolated current-source recovery panel</title><link rel='stylesheet' href='/codicon.css'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'>
<style>html,body{margin:0;width:100%;height:100%;font:14px system-ui}*{box-sizing:border-box}
#nextmux\\.desktop\\.widget{position:static;width:100%;height:100%;min-width:0}
.fixture-shell.nmx-shell{display:block!important;min-width:0!important;width:100%;height:100vh;overflow:hidden;
--theia-descriptionForeground:var(--nmx-subtle);--theia-errorForeground:var(--nmx-danger);--theia-focusBorder:var(--nmx-focus-ring);--theia-panel-border:var(--nmx-border-strong)}
.fixture-report{display:block;margin:8px;font-size:10px;color:var(--nmx-subtle)}
</style></head><body><div id='nextmux.desktop.widget' class='nmx-desktop-widget'><div id='fixture'></div></div><script src='/fixture.js'></script></body></html>`;
const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const values = { '/': ['text/html', html], '/fixture.js': ['text/javascript', bundle.outputFiles[0].contents],
        '/style.css': ['text/css', styles[0]], '/production.css': ['text/css', styles[1]],
        '/codicon.css': ['text/css', iconStyle], '/codicon.ttf': ['font/ttf', iconFont] };
    const value = request.method === 'GET' ? values[path] : undefined;
    response.writeHead(value ? 200 : 404, { 'content-type': value?.[0] || 'text/plain', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; font-src 'self'; img-src 'none'" });
    response.end(value?.[1] || 'Not found');
});
let browser;
const measurements = [], screenshots = [], errors = []; let externalRequests = 0, dialogs = 0;
const report = { scope: 'current React recovery component + both production stylesheets, not a packaged app', directory,
    measurements, screenshots, errors };
try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({ headless: true, userDataDir: join(directory, 'chromium-profile') });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => { if (new URL(request.url()).origin === origin) void request.continue(); else { externalRequests++; void request.abort(); } });
    page.on('dialog', dialog => { dialogs++; void dialog.dismiss(); });
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 300)));
    const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measure = () => page.evaluate(() => {
        const panel = document.querySelector('.nmx-editor-recovery'), list = panel.querySelector('ul'), first = list.querySelector('li');
        const rectangle = element => { const { left, top, right, bottom, width, height } = element.getBoundingClientRect(); return { left, top, right, bottom, width, height }; };
        const p = rectangle(panel), clip = { top: p.top + panel.clientTop, bottom: p.top + panel.clientTop + panel.clientHeight };
        const scrollables = [panel, ...panel.querySelectorAll('*')].filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1);
        const names = ['strong', 'bdi'].map(selector => { const item = first.querySelector(selector), style = getComputedStyle(item); return {
            selector, titleMatches: item.title === item.textContent, titleLength: item.title.length,
            width: item.clientWidth, contentWidth: item.scrollWidth, height: item.getBoundingClientRect().height,
            lineHeight: parseFloat(style.lineHeight), whiteSpace: style.whiteSpace, ellipsis: style.textOverflow, fontSize: style.fontSize }; });
        const confirmation = panel.querySelector('.nmx-editor-recovery-confirm');
        const controls = confirmation ? [...confirmation.querySelectorAll('button')].map(button => ({ text: button.textContent, ...rectangle(button) })) : [];
        return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, pageScrollY: scrollY,
            panel: p, panelClient: panel.clientHeight,
            panelScroll: panel.scrollHeight, panelScrollTop: panel.scrollTop, panelWidth: panel.scrollWidth, listOverflow: getComputedStyle(list).overflowY,
            scrollables: scrollables.map(element => element === panel ? 'panel' : element.tagName + '.' + element.className),
            count: list.children.length, fontSize: getComputedStyle(panel).fontSize, direction: getComputedStyle(panel).direction,
            background: getComputedStyle(document.querySelector('main')).backgroundColor, color: getComputedStyle(panel).color,
            names, confirmation: confirmation ? { ...rectangle(confirmation), controls,
                controlsVisible: controls.every(button => button.top >= clip.top - 1 && button.bottom <= clip.bottom + 1 && button.left >= p.left && button.right <= p.right) } : undefined,
            statusButtons: [...document.querySelectorAll('.nmx-editor-recovery-status > button')].map(button => ({
                background: getComputedStyle(button).backgroundColor, border: getComputedStyle(button).borderWidth, ...rectangle(button) })) };
    });
    for (const theme of ['dark', 'light']) for (const width of [297, 497]) for (const locale of ['en', 'zh-CN', 'ar']) {
        await page.setViewport({ width, height: 720, deviceScaleFactor: 1 });
        await page.goto(`${origin}/?theme=${theme}&locale=${locale}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.nmx-editor-recovery li'); await settled();
        const baseline = await measure();
        assert.equal(baseline.count, 64); assert.equal(baseline.fontSize, '12px');
        assert.ok(baseline.panel.height <= Math.min(340, 720 * .45) + 1);
        assert.equal(baseline.direction, locale === 'ar' ? 'rtl' : 'ltr');
        assert.ok(baseline.pageWidth <= width && baseline.panelWidth <= baseline.panel.width + 1, `${theme}/${width}/${locale}: horizontal overflow`);
        assert.ok(baseline.pageHeight <= 720, 'The preview viewport must not gain a second vertical scrollbar');
        assert.deepEqual(baseline.scrollables, ['panel']); assert.equal(baseline.listOverflow, 'visible');
        for (const value of baseline.names) {
            assert.equal(value.titleMatches, true); assert.equal(value.whiteSpace, 'nowrap'); assert.equal(value.ellipsis, 'ellipsis');
            assert.ok(value.height <= value.lineHeight + 1); assert.ok(value.contentWidth > value.width, 'Long synthetic label must really ellipsize');
        }
        assert.ok(baseline.statusButtons.every(button => button.background === 'rgba(0, 0, 0, 0)' && button.border === '0px'));
        const channels = baseline.background.match(/\d+/g).slice(0, 3).map(Number);
        assert.ok(channels.every(channel => theme === 'light' ? channel > 200 : channel < 80), `Wrong ${theme} product surface: ${baseline.background}`);
        const baselinePath = join(directory, `${theme}-${width}-${locale}-list.png`);
        await page.screenshot({ path: baselinePath }); screenshots.push(baselinePath);
        await page.click('[data-recovery-key="copy-0"] > nav button:last-child'); await settled();
        const initial = await measure();
        assert.equal(initial.confirmation.controlsVisible, true, `${theme}/${width}/${locale}: first confirmation must reveal itself`);
        assert.equal(initial.pageScrollY, baseline.pageScrollY, 'Confirmation must not scroll the outer page');
        await page.$eval('.nmx-editor-recovery-confirm', element => element.scrollIntoView({ block: 'nearest' })); await settled();
        const confirmation = await measure();
        assert.ok(confirmation.confirmation.controlsVisible, `${theme}/${width}/${locale}: confirmation actions cannot be reached`);
        assert.deepEqual(confirmation.scrollables, ['panel']);
        assert.ok(confirmation.pageWidth <= width && confirmation.panelWidth <= confirmation.panel.width + 1);
        const confirmationPath = join(directory, `${theme}-${width}-${locale}-confirm.png`);
        await page.screenshot({ path: confirmationPath }); screenshots.push(confirmationPath);
        await page.click('.nmx-editor-recovery-confirm button:first-child'); await settled();
        assert.equal(await page.$('.nmx-editor-recovery-confirm'), null);
        await page.$eval('.nmx-editor-recovery', element => { element.scrollTop = element.scrollHeight; }); await settled();
        await page.click('[data-recovery-key="copy-63"] > nav button:last-child'); await settled();
        const lastInitial = await measure();
        assert.equal(lastInitial.confirmation.controlsVisible, true, `${theme}/${width}/${locale}: last confirmation must reveal itself without test scrolling`);
        assert.equal(lastInitial.pageScrollY, baseline.pageScrollY, 'Last confirmation must scroll only the panel');
        await page.$eval('.nmx-editor-recovery-confirm', element => element.scrollIntoView({ block: 'nearest' })); await settled();
        const last = await measure(); assert.equal(last.confirmation.controlsVisible, true);
        assert.deepEqual(last.scrollables, ['panel']); assert.equal(last.count, 64, 'First click is not deletion');
        await page.click('.nmx-editor-recovery-confirm .is-danger'); await settled();
        assert.equal(await page.$eval('.fixture-report', element => element.dataset.deleted), '1');
        assert.equal(await page.$$eval('.nmx-editor-recovery li', items => items.length), 63);
        measurements.push({ theme, width, locale, baseline, initial, confirmation, lastInitial, last });
    }
    assert.equal(externalRequests, 0); assert.equal(dialogs, 0); assert.deepEqual(errors, []);
    Object.assign(report, { passed: true, externalRequests, dialogs });
} catch (error) {
    report.failure = String(error.stack || error); process.exitCode = 1;
} finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ directory, passed: report.passed || false, cases: measurements.length, screenshots, failure: report.failure }));
}
