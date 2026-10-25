import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compactDirectoryPrefix } from '../lib/browser/nextmux-conversation-media.js';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('production markdown, sanitization and stream disclosures share accessible file/search contracts', { timeout: 60000 }, async t => {
    const bundle = await build({ stdin: { loader: 'tsx', resolveDir: fileURLToPath(new URL('../src/browser/', import.meta.url)), contents: `
import * as React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {ConversationMarkdown,renderConversationMarkdownHtml} from './nextmux-conversation-markdown';
import {decorateConversationMedia} from './nextmux-conversation-media';
import {ConversationStream,StreamFilePath} from './nextmux-conversation-stream';
import {NextMuxChangeReview} from './nextmux-change-review';
window.html=renderConversationMarkdownHtml;window.opened=[];window.terminals=0;
const resolve=target=>{let path=target.replace(/^file:\\/\\//,'').replace(/#L\\d+(?:-L?\\d+)?$/,'');return {path:path.startsWith('/')?path:'/own/'+path,url:'file://'+path}};
const decorate=el=>decorateConversationMedia(el,resolve);
const markdown='Inline: '+String.fromCharCode(96)+'src/a.ts'+String.fromCharCode(96)+' and [file](file:///tmp/b.ts) and [local](out/c.txt) and README.md.\\n\\n[Web code '+String.fromCharCode(96)+'src/web.ts'+String.fromCharCode(96)+'](https://example.com).';
const projection={plan:[],items:[{kind:'row',key:'command',activity:'command',title:'Ran echo title-only',tone:'done',icon:'terminal',details:{kind:'terminal',command:'echo title-only',output:'\\u001b[31mresult-only\\u001b[0m',running:false}}],streamTail:{state:'complete'},idleCaret:false};
const changes=['failed-version','successful-version'].map(checkpointId=>({checkpointId,path:'src/a.ts',kind:'modified',additions:1,deletions:0,patch:'',createdAt:'2026-10-21',binary:false,truncated:false}));
const events=changes.map((change,index)=>({type:'tool_completed',callId:String(index),toolName:'workspace.write_file',ok:Boolean(index),status:index?'succeeded':'failed',summary:{checkpointId:change.checkpointId,resource:{kind:'file',action:'modified',path:'src/a.ts'}}}));
function Fixture(){const[query,setQuery]=React.useState('');window.search=q=>flushSync(()=>setQuery(q));return <>
<div id='message' onClickCapture={e=>{const p=e.target.closest('.nmx-file-path-pill');if(p)window.opened.push(p.dataset.path)}}><ConversationMarkdown markdown={markdown} locale='en' className='nmx-user-markdown' onRender={decorate}/></div>
<StreamFilePath path='out/artifact.txt' resolve={p=>'/own/'+p} onOpen={()=>window.opened.push('/own/out/artifact.txt')}/>
<ConversationStream locale='en' projection={projection} idPrefix='turn' label='activity' planLabel='plan' searchQuery={query}
renderMarkdown={s=><span>{s}</span>} renderTerminal={()=>{window.terminals++;return <span>delayed</span>}} renderSteering={()=>null} onOpen={()=>{}} onRestore={()=>{}}/>
<NextMuxChangeReview locale='en' changes={changes} events={events} restoring={false} blocked={false} isRestored={()=>false}
resolveFilePath={p=>'/own/'+p} onOpen={()=>{}} onRestore={()=>{}} onRestoreAll={()=>{}}/>
</>}
createRoot(document.querySelector('main')).render(<Fixture/>);` }, bundle: true, write: false, platform: 'browser', format: 'iife',
        loader: { '.css': 'empty', '.ttf': 'empty' }, alias: { react: core.resolve('react'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') }, logLevel: 'silent' });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html');
        res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><main></main><script src="/fixture.js"></script>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const browser = await puppeteer.launch({ headless: true,
        ...(existsSync(installedChrome) ? { executablePath: installedChrome } : {}) }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForSelector('#message .nmx-file-path-pill');
    await t.test('all local reference forms have sanitized nested directory/name spans and absolute data paths', async () => {
        const paths = await page.$$eval('#message .nmx-file-path-pill', pills => pills.map(pill => ({ path: pill.dataset.path, title: pill.title,
            role: pill.getAttribute('role'), tab: pill.tabIndex, dir: pill.querySelector('.nmx-file-path-dir > span')?.textContent,
            name: pill.querySelector('.nmx-file-path-name > span')?.textContent, childCount: pill.children.length })));
        assert.deepEqual(paths.map(item => item.path), ['/own/src/a.ts', '/tmp/b.ts', '/own/out/c.txt', '/own/README.md']);
        for (const item of paths) { assert.equal(item.title, item.path); assert.equal(item.role, 'link'); assert.equal(item.tab, 0); assert.equal(item.childCount, 2);
            assert.equal(item.dir, compactDirectoryPrefix(item.path.slice(0, item.path.length - item.name.length))); assert.ok(item.path.endsWith(`/${item.name}`)); }
        assert.deepEqual(paths.map(item => item.dir), ['…/src/', '/tmp/', '…/out/', '/own/'], 'the pill shows a compact directory; title and data-path keep the full path');
        assert.equal(await page.$eval('a[href="https://example.com"]', node => node.querySelectorAll('.nmx-file-path-pill').length), 0);
        const safe = await page.evaluate(() => window.html('`README.md` <img src=x onerror=alert(1)>', 'en'));
        assert.match(safe, /nmx-file-path-name/); assert.doesNotMatch(safe, /<img/);
    });
    await t.test('Enter opens markdown and artifact references using the same resolved path', async () => {
        await page.focus('#message .nmx-file-path-pill'); await page.keyboard.press('Enter');
        await page.focus('main > .nmx-file-path-pill'); await page.keyboard.press('Enter');
        assert.deepEqual(await page.evaluate(() => window.opened), ['/own/src/a.ts', '/own/out/artifact.txt']);
    });
    await t.test('command disclosure paints plain output synchronously without a terminal or duplicate command', async () => {
        const result = await page.evaluate(() => { const trigger=document.querySelector('.nmx-stream-trigger');trigger.click();return new Promise(resolve=>queueMicrotask(()=>{
            const body=document.querySelector('.nmx-stream-details');resolve({text:body?.textContent,terminals:window.terminals,animations:document.querySelector('.nmx-stream-collapse')?.getAnimations().length});})); });
        assert.deepEqual(result, { text: 'result-only', terminals: 0, animations: 0 });
    });
    await t.test('search wraps command results using the shared nmx-search-hit class', async () => {
        await page.evaluate(() => window.search('result-only'));
        assert.equal(await page.$eval('mark.nmx-search-hit', mark => mark.textContent), 'result-only');
        await page.evaluate(() => window.search(''));
        assert.equal(await page.$('mark.nmx-search-hit'), null);
    });
    await t.test('modified files omit superseded failed checkpoints and reuse path pills', async () => {
        const result = await page.$eval('.nmx-turn-review-file', row => ({ additions: row.querySelector('b')?.textContent,
            path: row.querySelector('.nmx-file-path-pill')?.dataset.path }));
        assert.deepEqual(result, { additions: '+1', path: '/own/src/a.ts' });
    });
    assert.deepEqual(errors, []);
});
