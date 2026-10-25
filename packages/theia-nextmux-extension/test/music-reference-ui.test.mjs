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
const shots = new URL('file:///tmp/nm-shots/music-reference/');

/** The real song card with the "my voice / cover" fields, in the states a user meets. */
async function startFixture() {
    const entry = `import * as React from 'react'; import {createRoot} from 'react-dom/client';
import {MusicSongView} from './nextmux-music-studio'; import {MusicReferenceFields} from './nextmux-music-reference';
const params=new URLSearchParams(location.search), locale=params.get('locale')||'zh-CN', state=params.get('state')||'voice-empty';
const sample={ id:'a1', kind:'audio', status:'ready', uri:'assets/my-voice.wav', mimeType:'audio/wav', durationMs:18400, model:'my-voice.wav' };
const song={ id:'a2', kind:'audio', status:'ready', uri:'assets/old-song.mp3', mimeType:'audio/mpeg', durationMs:201000, model:'old-song.mp3' };
const settings={ lyrics:'', instrumental:false, genre:'', mood:'', tempo:'', vocals:'', language:'', style:'', length:'full', format:'mp3',
 mode: state==='cover' ? 'cover' : 'generate', vocalSource: state.startsWith('voice') || state==='unsupported' ? 'my_voice' : 'default',
 vocalReferenceAssetId: state==='voice-ready' || state==='voice-consent' ? 'a1' : undefined, vocalReferenceConsent: state==='voice-consent', referenceSongAssetId: state==='cover' ? 'a2' : undefined };
const support= state==='unsupported' ? { vocalReference:false, cover:false } : { vocalReference:true, cover:true };
const fields=<MusicReferenceFields locale={locale} settings={settings} support={support} assets={[sample,song]} disabled={false} onSettings={()=>{}} onImport={()=>{}} />;
const model=<label className='nmx-music-field'><span>Music model</span><select><option>mureka-template</option></select></label>;
createRoot(document.getElementById('fixture')).render(<div className='nmx-desktop-widget'><div className={'nmx-shell nmx-theme-'+(params.get('theme')||'dark')}><div className='nmx-music-workspace' style={{padding:24,maxWidth:420}}>
 <MusicSongView locale={locale} musicModel={model} referenceFields={fields} ownApi={true} canGenerate={state==='voice-consent'||state==='cover'} blockedReason={state==='voice-consent'||state==='cover'?undefined:'—'} running={0} versions={[]} busy={false} onGenerate={()=>{}} onChoose={()=>{}} onNext={()=>{}} />
</div></div></div>);`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', sourcefile: 'music-reference-fixture.tsx',
        resolveDir: dirname(fileURLToPath(new URL('../src/browser/nextmux-music-reference.tsx', import.meta.url))) },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent', external: ['node:*'],
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    const css = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-comic-workshop.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url))));
    const assets = {
        '/fixture.js': ['text/javascript', outputFiles[0].contents],
        '/style.css': ['text/css', Buffer.concat(css)],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))],
        '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'>
<style>html,body{margin:0;height:100%;font:13px system-ui}#fixture,.nmx-desktop-widget{height:100%}.nmx-shell{display:block;position:relative;min-height:100%;background:var(--nmx-bg)}</style></head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`]
    };
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('song card: my voice and cover fields in real Chromium (states × light/dark × zh-CN/en)', { timeout: 240000 }, async t => {
    await mkdir(shots, { recursive: true });
    const fixture = await startFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 520, height: 820 });
    for (const theme of ['dark', 'light']) for (const locale of ['zh-CN', 'en']) for (const state of ['voice-empty', 'voice-ready', 'voice-consent', 'cover', 'unsupported']) {
        const label = `${theme}-${locale}-${state}`;
        await page.goto(`${fixture.origin}/?${new URLSearchParams({ theme, locale, state })}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.nmx-music-sound');
        const layout = await page.$eval('.nmx-music-sound', node => {
            const box = node.getBoundingClientRect(); const card = node.closest('.nmx-music-card').getBoundingClientRect();
            const children = [...node.children].map(child => child.getBoundingClientRect());
            return { inside: box.left >= card.left - 1 && box.right <= card.right + 1, overflow: children.some(r => r.right > card.right + 1),
                column: getComputedStyle(node).flexDirection, text: node.innerText };
        });
        assert.ok(layout.inside && !layout.overflow, `${label}: fields overflow the card`);
        assert.equal(layout.column, 'column', `${label}: fields stack like the rest of the card`);
        if (state === 'voice-empty') assert.match(layout.text, locale === 'en' ? /Upload vocal sample[\s\S]*Upload a vocal sample first/ : /上传人声样本[\s\S]*请先上传人声样本/);
        if (state === 'voice-ready') assert.match(layout.text, locale === 'en' ? /my-voice\.wav · 18\.4 s[\s\S]*Confirm permission/ : /my-voice\.wav · 18\.4 s[\s\S]*请勾选人声使用授权/);
        if (state === 'cover') assert.match(layout.text, locale === 'en' ? /does not clone a voice[\s\S]*old-song\.mp3/ : /不代表克隆音色[\s\S]*old-song\.mp3/);
        if (state === 'cover') assert.equal(await page.$('.nmx-music-sound input[type=checkbox]'), null, `${label}: no voice consent for a cover`);
        if (state === 'unsupported') assert.match(layout.text, locale === 'en' ? /does not support the selected music mode/ : /不支持所选音乐模式/);
        await page.screenshot({ path: new URL(`${label}.png`, shots).pathname });
    }
    assert.deepEqual(errors, []);
});
