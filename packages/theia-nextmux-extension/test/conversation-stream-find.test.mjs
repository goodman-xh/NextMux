import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// Isolated production-component regression only: no installed app or conversation data.
const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
const source = await readFile(widgetUrl, 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const targetMethod = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'threadSearchTargetElement').getText(file);

async function serve(t) {
    const bundle = await build({ stdin: { loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), contents: `
import * as React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
import { ConversationStream } from './nextmux-conversation-stream';
const definitions = [
 ['plain', {kind:'text',text:'hiddenneedle plain answer'}],
 ['terminal', {kind:'terminal',command:'echo demo',output:'hiddenneedle terminal output',running:false}],
 ['markdown', {kind:'markdown',text:'**hiddenneedle** markdown answer'}],
 ['link', {kind:'link',title:'Reference',url:'https://example.invalid',text:'hiddenneedle link explanation'}],
 ['unrelated', {kind:'text',text:'unrelated content'}]
];
const detailsText = d => d.kind==='terminal' ? [d.command,d.output].filter(Boolean).join('\\n') : d.kind==='link' ? [d.title,d.url,d.text].filter(Boolean).join(' ') : d.text;
let activity=definitions.map(([key,d])=>key+'\\n'+detailsText(d)).join('\\n');
const projection={plan:[],items:definitions.map(([key,details])=>({kind:'row',key,title:key,icon:'check',tone:'muted',activity:key,details})),streamTail:{state:'complete'},idleCaret:false};
if(new URLSearchParams(location.search).has('rows')){
 projection.plan=[{id:'p1',title:'PlanNeedle verify work',status:'completed'},{id:'p2',title:'Deliver result',status:'pending'}];
 projection.items=[
 {kind:'row',key:'rowfile',activity:'rowfile',title:'Read file',target:'src/example.ts',meta:'7 lines',chip:'cached',tone:'muted',icon:'file',details:{kind:'text',text:'ordinary stored detail'},open:{kind:'file',label:'Open fixture file',summary:{title:'fixture'}},restoreCheckpointId:'checkpoint'},
 {kind:'row',key:'phrase',activity:'phrase',phrase:true,title:'Opened ',target:'page',after:' successfully',meta:'details',chip:'allowed',tone:'muted',icon:'globe'}];
 activity=[...projection.plan.map(step=>step.title),...projection.items.flatMap(item=>[[item.title,item.target,item.after,item.meta,item.chip].filter(Boolean).join(' '),item.details?detailsText(item.details):''].filter(Boolean))].join('\\n');
}

const counters={open:0,restore:0,terminal:0};
class Locator {
 ${targetMethod}
 activeCodingSession(){return {turns:[{id:'turn',response:'',prompt:'',error:''}]};}
 turnSearchableFields(){return {activity,response:'',error:''};}
}
const locator = new Locator();
function Fixture(){const [query,setQuery]=React.useState('');window.setQuery=q=>flushSync(()=>setQuery(q));locator.threadFindQuery=query;
return <div className='nmx-task-turn' data-turn-id='turn'><ConversationStream locale='en' projection={projection} idPrefix='turn' label='activity' planLabel='plan'
 searchQuery={query} renderVersion={query} renderMarkdown={text=><span>{text}</span>} renderTerminal={(command,output)=>{counters.terminal++;return <pre>{command+'\\n'+output}</pre>;}}
 renderSteering={()=>null} onOpen={()=>counters.open++} onRestore={()=>counters.restore++}/></div>;}
window.locate=key=>{const d=definitions.find(([k])=>k===key)[1];const text=detailsText(d);const offset=activity.indexOf(text)+text.indexOf('hiddenneedle');
 const el=locator.threadSearchTargetElement(document.querySelector('.nmx-task-turn'),{turnId:'turn',field:'activity',offset});
 return {tag:el?.tagName,text:el?.textContent,active:el?.classList.contains('is-active'),row:el?.closest('.nmx-stream-row')?.dataset.activityKind};};
window.locateRow=query=>{const el=locator.threadSearchTargetElement(document.querySelector('.nmx-task-turn'),{turnId:'turn',field:'activity',offset:activity.indexOf(query)});return {tag:el?.tagName,text:el?.textContent,active:el?.classList.contains('is-active')};};
window.counters=counters;flushSync(()=>createRoot(document.querySelector('main')).render(<Fixture/>));
` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'transform', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    const css = await readFile(new URL('../src/browser/style/nextmux-conversation-stream.css', import.meta.url), 'utf8');
    const server = createServer((request, response) => {
        if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(bundle.outputFiles[0].contents); }
        else if (request.url === '/style.css') { response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }); response.end(css); }
        else { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><main></main><script src="/fixture.js"></script>'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}
const settle = page => page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(()=>{}))); await new Promise(requestAnimationFrame); });

test('Find reveals stored tool details, highlights and locates matches, then restores manual expansion', {timeout:45000}, async t => {
    const origin = await serve(t);
    const browser = await puppeteer.launch({ headless:true }); t.after(()=>browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => { if(request.url().startsWith(origin)) void request.continue(); else void request.abort(); });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin,{waitUntil:'load'});
    assert.equal(await page.locator('.nmx-stream-details').count?.() ?? await page.$$eval('.nmx-stream-details',nodes=>nodes.length),0);
    await page.click('[data-activity-kind="plain"] .nmx-stream-trigger'); await settle(page);
    await page.click('[data-activity-kind="unrelated"] .nmx-stream-trigger'); await settle(page);
    await page.evaluate(()=>window.setQuery('hiddenneedle')); await settle(page);
    const view=await page.evaluate(()=>[...document.querySelectorAll('.nmx-stream-row')].map(row=>({key:row.dataset.activityKind,expanded:row.querySelector('.nmx-stream-trigger').getAttribute('aria-expanded'),marks:[...row.querySelectorAll('mark')].map(mark=>mark.textContent)})));
    assert.deepEqual(view.map(item=>item.marks.length),[1,1,1,1,0]);
    assert.ok(view.every(item=>item.expanded==='true'));
    for(const key of ['plain','terminal','markdown','link']) {
        assert.deepEqual(await page.evaluate(key=>window.locate(key),key),{tag:'MARK',text:'hiddenneedle',active:true,row:key});
    }
    // Clicking a forced-open match does not rewrite the user's saved collapsed state.
    await page.click('[data-activity-kind="terminal"] .nmx-stream-trigger');
    await page.evaluate(()=>window.setQuery('')); await settle(page);
    assert.deepEqual(await page.$$eval('.nmx-stream-row',rows=>rows.map(row=>row.querySelector('.nmx-stream-trigger').getAttribute('aria-expanded'))),['true','false','false','false','true']);
    assert.equal(await page.$$eval('mark',nodes=>nodes.length),0);
    await page.evaluate(()=>window.setQuery('term-never-present')); await settle(page);
    assert.deepEqual(await page.$$eval('.nmx-stream-row',rows=>rows.map(row=>row.querySelector('.nmx-stream-trigger').getAttribute('aria-expanded'))),['true','false','false','false','true']);
    assert.deepEqual(await page.evaluate(()=>window.counters),{open:0,restore:0,terminal:0});
    assert.deepEqual(errors,[]);
});


test('Find highlights plan and styled row fields, spans field boundaries, and preserves row actions', {timeout:45000}, async t => {
    const origin = await serve(t);
    const browser = await puppeteer.launch({headless:true}); t.after(()=>browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',request=>{if(request.url().startsWith(origin))void request.continue();else void request.abort();});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/?rows=1',{waitUntil:'load'});
    for(const query of ['PlanNeedle','Read','src/example.ts','7 lines','cached','successfully','allowed']){
        await page.evaluate(query=>window.setQuery(query),query);await settle(page);
        assert.equal(await page.$$eval('mark',nodes=>nodes.map(node=>node.textContent).join('')),query);
        assert.deepEqual(await page.evaluate(query=>window.locateRow(query),query),{tag:'MARK',text:query,active:true});
    }
    await page.evaluate(()=>window.setQuery('file src/example.ts'));await settle(page);
    assert.deepEqual(await page.$$eval('mark',nodes=>nodes.map(node=>node.textContent)),['file','src/example.ts']);
    assert.deepEqual(await page.evaluate(()=>window.locateRow('file src/example.ts')),{tag:'MARK',text:'file',active:true});
    // A row-title hit does not force unrelated detail content open or disable existing actions.
    assert.equal(await page.$$eval('.nmx-stream-details',nodes=>nodes.length),0);
    await page.click('[data-activity-kind="rowfile"] .nmx-stream-trigger');await settle(page);
    assert.equal(await page.$eval('[data-activity-kind="rowfile"] .nmx-stream-trigger',el=>el.getAttribute('aria-expanded')),'true');
    await page.click('[aria-label="Open fixture file"]');
    await page.click('.nmx-file-activity-restore');
    assert.deepEqual(await page.evaluate(()=>window.counters),{open:1,restore:1,terminal:0});
    await page.evaluate(()=>window.setQuery(''));await settle(page);
    assert.equal(await page.$$eval('mark',nodes=>nodes.length),0);
    assert.equal(await page.$eval('[data-activity-kind="rowfile"] .nmx-stream-trigger',el=>el.getAttribute('aria-expanded')),'true');
    assert.deepEqual(errors,[]);
});
