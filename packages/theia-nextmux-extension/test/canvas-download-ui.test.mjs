import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const require=createRequire(import.meta.url), core=createRequire(require.resolve('@theia/core/package.json'));
const desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;

test('actual React download dialog protects manual names, reorders, resolves collisions, saves and cancels', {timeout:45000}, async t=>{
    const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:dirname(fileURLToPath(new URL('../src/browser/nextmux-comic-canvas-download.tsx',import.meta.url))),contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';
import {CanvasDownloadDialog} from './nextmux-comic-canvas-download';
const root=createRoot(document.querySelector('main'));
const items=['Alpha','Beta','Gamma'].map((label,index)=>({nodeId:'n'+index,versionId:'v'+index,assetId:'a'+index,kind:'image',label,extension:'png',name:'',manual:false}));
const fixture={key:0,count:3,closed:0,saved:[],calls:[],pending:false};window.fixture=fixture;
fixture.render=()=>root.render(<CanvasDownloadDialog key={fixture.key} locale='en' items={items.slice(0,fixture.count)}
 onSave={(items,zipName,signal)=>{fixture.calls.push({items,zipName,signal});return fixture.pending?new Promise(resolve=>fixture.finish=resolve):Promise.resolve({destinationUri:'file:///saved/'+(items.length>1?zipName:'single.png'),fileName:items.length>1?zipName:'single.png',files:[],bytes:7});}}
 onClose={()=>{fixture.closed++;root.render(<p>Closed</p>);}} onSaved={result=>fixture.saved.push(result)}/>);
fixture.render();`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'@theia/core/shared/react':core.resolve('react'),'react-dom/client':core.resolve('react-dom/client')}});
    const server=createServer((req,res)=>{res.writeHead(200,{'content-type':req.url==='/bundle.js'?'text/javascript':'text/html'});res.end(req.url==='/bundle.js'?outputFiles[0].text:'<main></main><script src="/bundle.js"></script>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('[role=dialog]');
    const names=()=>page.$$eval('.nmx-board-download-items input',els=>els.map(el=>el.value));
    const fill=async(selector,value)=>{await page.$eval(selector,el=>el.select());await page.keyboard.type(value);};
    assert.deepEqual(await names(),['001_Alpha','002_Beta','003_Gamma']);
    await fill('[aria-label="Filename 2"]','手改名称');
    await page.select('.nmx-board-download-options select','index');await fill('[aria-label="Start number"]','10');
    assert.deepEqual(await names(),['010','手改名称','012']);
    await page.click('.nmx-board-download-items li:first-child button[aria-label="Move down"]');
    assert.deepEqual(await names(),['手改名称','011','012']);
    await page.$$eval('button',els=>els.find(el=>el.textContent.startsWith('Apply to all')).click());
    assert.deepEqual(await names(),['010','011','012']);
    await fill('[aria-label="Filename 1"]','Picture.PNG');await fill('[aria-label="Filename 2"]','picture');
    assert.match(await page.$eval('[role=status]',el=>el.textContent),/Duplicate/);
    assert.match(await page.$eval('.nmx-board-download-items li:nth-child(2) small',el=>el.textContent),/picture\(2\)\.png/);
    await page.$eval('[aria-label="Filename 1"]',el=>el.select());await page.keyboard.press('Backspace');
    assert.equal(await page.$eval('footer .is-primary',el=>el.disabled),true);
    assert.match(await page.$eval('[role=alert]',el=>el.textContent),/empty/);
    await page.click('.nmx-board-download-items li:first-child > button');
    assert.equal((await names())[0],'010');assert.equal(await page.$eval('footer .is-primary',el=>el.disabled),false);
    await fill('[aria-label="ZIP filename"]','Review');await page.click('footer .is-primary');await page.waitForFunction(()=>window.fixture.closed===1);
    assert.deepEqual(await page.evaluate(()=>({calls:window.fixture.calls.length,items:window.fixture.calls[0].items.length,zip:window.fixture.calls[0].zipName,saved:window.fixture.saved.length})),{calls:1,items:3,zip:'Review.zip',saved:1});
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nextmux.canvas.download.naming.v1')).rule),'index');
    await page.evaluate(()=>{window.fixture.key++;window.fixture.count=1;window.fixture.pending=true;window.fixture.render();});await page.waitForSelector('[role=dialog]');
    assert.equal(await page.$('[aria-label="ZIP filename"]'),null,'single save is a file, without ZIP naming UI');
    await page.click('footer .is-primary');await page.waitForFunction(()=>window.fixture.calls.length===2);
    assert.equal(await page.$eval('footer .is-primary',el=>el.disabled),true);
    await page.click('header button');await page.waitForFunction(()=>window.fixture.calls[1].signal.aborted);
    await page.evaluate(()=>window.fixture.finish(undefined));assert.equal(await page.evaluate(()=>window.fixture.saved.length),1);
    assert.deepEqual(errors,[]);
});
