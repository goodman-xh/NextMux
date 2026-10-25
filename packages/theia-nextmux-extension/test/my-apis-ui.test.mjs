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
const shots = new URL('file:///tmp/nm-shots/my-apis/');

/** The real 我的 API dialog and the Model Center top bar button, in the states a user meets. */
async function startFixture() {
    const entry = `import * as React from 'react'; import {createRoot} from 'react-dom/client';
import {MyApisDialog, myApisText} from './nextmux-my-apis';
const params=new URLSearchParams(location.search), locale=params.get('locale')||'zh-CN', state=params.get('state')||'list';
const rows = state==='empty' ? [] : [
 { id:'a', kind:'chat', name:'My relay with a rather long connection name for testing', providerName: myApisText(locale,'compatibleTitle'), host:'api.example-relay.com', summary:'128 models', status:'reachable', latencyMs: 820 },
 { id:'b', kind:'media', name:'Video · Wan 3.0', providerName: myApisText(locale,'mediaTitle'), host:'api.example.com', summary:'1 model', status:'ready' },
 { id:'c', kind:'local', name:'Ollama', providerName:'Ollama', host:'127.0.0.1:11434', summary:'Ollama 0.12.3 running, 3 models', status:'verified', latencyMs: 13 },
 { id:'d', kind:'chat', name:'Anthropic', providerName:'Anthropic', host:'api.anthropic.com', summary:'', status:'unverified' }];
const noop=()=>{};
createRoot(document.getElementById('fixture')).render(<div className='nmx-desktop-widget'><div className={'nmx-shell nmx-theme-'+(params.get('theme')||'dark')} dir={locale==='ar'?'rtl':'ltr'}>
 <header className='nmx-workspace-topbar nmx-model-center-topbar'><div className='nmx-model-center-topbar-actions'>
  <button type='button' className='nmx-my-apis-button'><i className='codicon codicon-key'></i><span>{myApisText(locale,'title')}</span>{rows.length>0 && <span className='nmx-my-apis-badge'>{rows.length}</span>}</button></div></header>
 <MyApisDialog locale={locale} platform={params.get('os')||'mac'} rows={rows} busy={false} confirmRemoveId={state==='confirm'?'a':undefined} highlightId={state==='saved'?'b':undefined}
  message={state==='saved'?'Saved':undefined} onClose={noop} onAdd={noop} onAddLocal={noop} onOfficial={noop} onEdit={noop} onTest={noop} onRemove={noop} onCancelRemove={noop} />
</div></div>);`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', sourcefile: 'my-apis-fixture.tsx',
        resolveDir: dirname(fileURLToPath(new URL('../src/browser/nextmux-my-apis.tsx', import.meta.url))) },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent', external: ['node:*'],
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
            '@theia/core/shared/react': core.resolve('react') } });
    const css = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-shell-polish.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url))));
    const assets = {
        '/fixture.js': ['text/javascript', outputFiles[0].contents],
        '/style.css': ['text/css', Buffer.concat(css)],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))],
        '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'>
<style>html,body{margin:0;height:100%;font:13px system-ui}#fixture,.nmx-desktop-widget{height:100%}.nmx-shell{display:block;position:relative;height:100%;background:var(--nmx-bg)}
.nmx-model-center-topbar{display:flex;justify-content:flex-end;padding:18px 24px}</style></head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`]
    };
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('我的 API: dialog and top bar badge in real Chromium (states × themes × locales × widths)', { timeout: 300000 }, async t => {
    await mkdir(shots, { recursive: true });
    const fixture = await startFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [1280, 560]) for (const theme of ['dark', 'light']) for (const locale of ['zh-CN', 'en', 'de', 'ar']) for (const state of ['list', 'confirm', 'saved', 'empty']) {
        if (width === 560 && !['zh-CN', 'de'].includes(locale)) continue;
        const label = `${width}-${theme}-${locale}-${state}`;
        await page.setViewport({ width, height: 860 });
        await page.goto(`${fixture.origin}/?${new URLSearchParams({ theme, locale, state, os: locale === 'de' ? 'windows' : 'mac' })}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.nmx-my-apis');
        await page.evaluate(() => document.fonts.ready);
        const layout = await page.evaluate(() => {
            const dialog = document.querySelector('.nmx-my-apis').getBoundingClientRect();
            const overflow = [...document.querySelectorAll('.nmx-my-apis *')].filter(node => {
                const box = node.getBoundingClientRect();
                return box.width > 0 && (box.right > dialog.right + 1 || box.left < dialog.left - 1);
            }).map(node => node.className || node.tagName);
            const actions = [...document.querySelectorAll('.nmx-my-apis-actions')].map(node => node.getBoundingClientRect());
            const mains = [...document.querySelectorAll('.nmx-my-apis-main')].map(node => node.getBoundingClientRect());
            const overlap = actions.some((box, index) => mains[index] && box.top < mains[index].bottom - 1 && box.left < mains[index].right - 1 && box.right > mains[index].left + 1);
            const badge = document.querySelector('.nmx-my-apis-badge')?.getBoundingClientRect();
            const button = document.querySelector('.nmx-my-apis-button').getBoundingClientRect();
            return { overflow, overlap, fits: dialog.left >= 0 && dialog.right <= innerWidth && dialog.bottom <= innerHeight,
                badgeCorner: badge ? badge.top < button.top && badge.right > button.right - 4 : null, text: document.querySelector('.nmx-my-apis').innerText,
                background: getComputedStyle(document.querySelector('.nmx-my-apis')).backgroundColor };
        });
        assert.deepEqual(layout.overflow, [], `${label}: content overflows the dialog`);
        assert.equal(layout.overlap, false, `${label}: actions overlap the connection text`);
        assert.ok(layout.fits, `${label}: dialog does not fit the window`);
        if (state === 'empty') assert.equal(layout.badgeCorner, null, `${label}: no badge without connections`);
        else assert.equal(layout.badgeCorner, true, `${label}: badge sits on the button corner`);
        if (locale === 'zh-CN' && state === 'list') assert.match(layout.text, /我的 API[\s\S]*4 个连接[\s\S]*可连接 · 工具调用未通过[\s\S]*生成接口[\s\S]*连接已验证[\s\S]*尚未检测/);
        if (locale === 'de') assert.match(layout.text, /Windows-Anmeldeinformationsverwaltung/, `${label}: Windows names its credential store`);
        if (locale === 'zh-CN' && state === 'confirm') assert.match(layout.text, /删除这个连接以及保存的 API Key？/);
        if (state === 'empty') assert.match(layout.text, locale === 'en' ? /No APIs yet/ : /./);
        assert.notEqual(layout.background, 'rgba(0, 0, 0, 0)', `${label}: dialog has a solid background`);
        await page.screenshot({ path: new URL(`${label}.png`, shots).pathname });
    }
    assert.deepEqual(errors, []);
});
