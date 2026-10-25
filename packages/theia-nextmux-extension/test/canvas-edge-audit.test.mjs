import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createCanvasDocument, validateCanvasDocument, validateCanvasEdge } from '@nextmux/comic-core/canvas';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';
const audit = await loadCanvasToolsSource('browser/nextmux-comic-canvas-edge-audit.ts');
const copy = await loadCanvasToolsSource('browser/nextmux-comic-canvas-edge-audit-text.ts');
const now = '2026-10-03T10:00:00.000Z';
const image = id => ({id,kind:'image',title:id,position:{x:0,y:0},size:{width:280,height:280},payload:{versions:[{id:`${id}-v`,assetId:`${id}-asset`,kind:'image',uri:`assets/${id}.png`,createdAt:now}],currentVersionId:`${id}-v`}});
const gen = (id, mode='imageToImage') => ({id,kind:mode==='imageToImage'?'imageGen':'videoGen',title:id,position:{x:450,y:80},size:{width:280,height:280},payload:{mode,modelId:'fixture',prompt:'Keep this prompt',parameters:{},versions:[]}});
const edge = (id, sourceNodeId='a',targetNodeId='target',role='referenceImage',extra={}) => ({id,sourceNodeId,targetNodeId,sourcePort:'output',targetPort:role,role,order:0,binding:'followCurrent',...extra});
const board = (nodes=[image('a'),image('b'),gen('target')],edges=[]) => ({...createCanvasDocument({id:'canvas',projectId:'project',now}),nodes,edges});
const codes = items => items.flatMap(item => item.issues.map(issue => issue.code));

function damaged() {return board(undefined,[edge('keep'),edge('source','b','target','referenceImage',{sourcePort:'input'}),edge('target-port','b','target','referenceImage',{targetPort:'output'}),edge('dangling','gone','target')]);}

test('existing edge scans reuse core port rules and mark dangling endpoints as additional rules', () => {
 const doc=damaged(), findings=audit.scanCanvasEdges(doc);
 assert.ok(codes(findings).includes('SOURCE_PORT'));assert.ok(codes(findings).includes('TARGET_PORT'));assert.ok(codes(findings).includes('NODE_MISSING'));
 assert.equal(audit.CANVAS_EDGE_BASE_CHECKS.has('SOURCE_PORT'),true);assert.equal(audit.CANVAS_EDGE_BASE_CHECKS.has('NODE_MISSING'),false);
 for(const row of findings) for(const issue of validateCanvasEdge(doc,row.edge)) assert.ok(row.issues.some(i=>i.code===issue.code));
 assert.equal(findings.some(row=>row.edge.id==='keep'),false);
 assert.deepEqual(audit.canvasEdgeBounds(doc,doc.edges[0]),{x:0,y:0,width:730,height:360});
 assert.deepEqual(audit.canvasEdgeBounds(doc,doc.edges[3]),{x:450,y:80,width:280,height:280});
 assert.equal(audit.canvasEdgeBounds(doc,edge('both','gone','also-gone')),undefined);
});

test('allowed multi-reference inputs stay valid; only constrained roles count another edge, groups and direct inputs', () => {
 const many=board(undefined,[edge('a-ref'),edge('b-ref','b')]);assert.deepEqual(audit.scanCanvasEdges(many),[]);
 const first=board([image('a'),image('b'),gen('target','imageToVideo')],[edge('first','a','target','firstFrame')]);
 assert.deepEqual(audit.scanCanvasEdges(first),[],'the existing edge does not count itself twice');
 const two={...first,edges:[...first.edges,edge('second','b','target','firstFrame')]};assert.deepEqual(audit.scanCanvasEdges(two).map(i=>i.index),[0,1]);assert.ok(codes(audit.scanCanvasEdges(two)).includes('ROLE_LIMIT'));
 assert.deepEqual(audit.scanCanvasEdges(audit.previewCanvasEdgeRepair(two,[1])),[],'retained edge becomes valid immediately after one explicit deletion');
 const direct=structuredClone(first);direct.nodes[2].payload.inputs=[{role:'firstFrame',version:image('b').payload.versions[0]}];assert.ok(codes(audit.scanCanvasEdges(direct)).includes('ROLE_LIMIT'));
 const grouped=board([image('a'),image('b'),gen('target','imageToVideo'),{id:'group',kind:'group',title:'group',position:{x:0,y:0},size:{width:200,height:200},payload:{groupId:'g'}}],[edge('group-edge','group','target','firstFrame')]);
 grouped.groups=[{id:'g',title:'group',nodeIds:['a','b']}];assert.ok(codes(audit.scanCanvasEdges(grouped)).includes('ROLE_LIMIT'));
});

test('repair preview is immutable, removes only selected invalid rows, and refuses incomplete or stale repairs', () => {
 const doc=damaged(), original=structuredClone(doc);
 const preview=audit.previewCanvasEdgeRepair(doc,[1,0,99]);assert.deepEqual(preview.edges.map(e=>e.id),['keep','target-port','dangling']);assert.strictEqual(preview.nodes,doc.nodes);assert.deepEqual(doc,original);
 assert.equal(audit.applyCanvasEdgeRepair(doc,doc,[1],now).reason,'invalid');
 const result=audit.applyCanvasEdgeRepair(doc,doc,[1,2,3],now);assert.equal(result.ok,true);assert.deepEqual(validateCanvasDocument(result.canvas),[]);assert.deepEqual(result.canvas.edges,[doc.edges[0]]);assert.strictEqual(result.canvas.nodes,doc.nodes);assert.equal(result.canvas.revision,doc.revision+1);
 assert.equal(audit.applyCanvasEdgeRepair(doc,{...doc,edges:doc.edges.map(e=>e.id==='source'?{...e,sourcePort:'output'}:e)},[1,2,3],now).reason,'changed');
 assert.equal(audit.applyCanvasEdgeRepair(doc,doc,[0],now).reason,'empty');
 const invalidNode={...doc,nodes:doc.nodes.map(n=>n.id==='target'?{...n,size:{width:-1,height:280}}:n)};assert.equal(audit.applyCanvasEdgeRepair(invalidNode,invalidNode,[1,2,3],now).reason,'invalid','edge cleanup never bypasses non-edge validation');
 const history=[doc]; const restored=history.pop();assert.deepEqual(restored,original,'history keeps nodes, immutable versions, edges and original roles');
});

test('duplicate identifiers use row identity and cycles are diagnosed without automatic deletion', () => {
 const same=board(undefined,[edge('same'),edge('same','b')]);assert.equal(audit.scanCanvasEdges(same).length,2);
 const repaired=audit.applyCanvasEdgeRepair(same,same,[1],now);assert.equal(repaired.ok,true);assert.deepEqual(repaired.canvas.edges,[same.edges[0]]);
 const circular=board([gen('one'),gen('two')],[edge('one-two','one','two'),edge('two-one','two','one')]);assert.ok(codes(audit.scanCanvasEdges(circular)).includes('CYCLE'));
 assert.equal(audit.previewCanvasEdgeRepair(circular,[0]).edges.length,1);assert.deepEqual(audit.scanCanvasEdges(audit.previewCanvasEdgeRepair(circular,[0])),[]);
});

test('all 12 languages explicitly translate every audit control and reason with matching placeholders', async () => {
 const source=await readFile(new URL('../src/browser/nextmux-comic-canvas-edge-audit-text.ts',import.meta.url),'utf8');
 const syntax=ts.createSourceFile('edge-text.ts',source,ts.ScriptTarget.Latest,true);
 const declarations=new Map(syntax.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).map(d=>[d.name.text,d.initializer]));
 const english=new Map(declarations.get('EN').properties.map(p=>[p.name.text,p.initializer.text]));
 assert.equal(declarations.get('TEXT').properties.length,12);
 for(const lang of declarations.get('TEXT').properties){const entries=new Map(declarations.get(lang.initializer.text).properties.map(p=>[p.name.text,p.initializer.text]));assert.equal(entries.size,english.size);
 for(const[key,value]of english){assert.ok(entries.get(key)?.trim());assert.equal(copy.canvasEdgeAuditText(lang.name.text,key),entries.get(key));assert.deepEqual([...entries.get(key).matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...value.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort());}}
});

test('real React audit supports locate, staged delete/rescan/apply, external change protection and undo', {timeout:60000}, async t => {
 const require=createRequire(import.meta.url), core=createRequire(require.resolve('@theia/core/package.json'));
 const app=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url)), platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
 const puppeteer=platform('puppeteer');
 const {outputFiles}=await app('esbuild').build({stdin:{resolveDir:new URL('../src/browser/',import.meta.url).pathname,loader:'tsx',contents:`
 import React from '${core.resolve('react')}';import {createRoot} from '${core.resolve('react-dom/client')}';
 import {CanvasEdgeAuditPanel} from './nextmux-comic-canvas-edge-audit-panel';
 const initial=${JSON.stringify(damaged())};const history=[];let render,doc=structuredClone(initial);window.fixture={applied:0,located:[],keys:[],closed:0};
 const root=createRoot(document.querySelector('main'));
 function App(){const[current,setCurrent]=React.useState(doc),[open,setOpen]=React.useState(true),[epoch,setEpoch]=React.useState(0);window.fixture.current=current;
 window.fixture.update=()=>setCurrent(c=>({...c,edges:c.edges.map(e=>e.id==='dangling'?{...e,sourceNodeId:'b',role:'referenceImage',targetPort:'referenceImage'}:e)}));
 window.fixture.reset=()=>{setCurrent(structuredClone(initial));setOpen(true);setEpoch(n=>n+1)};
 window.fixture.undo=()=>{setCurrent(history.pop());setOpen(true)};
 return <div onKeyDown={e=>window.fixture.keys.push(e.key)}><button id='outside'>Canvas</button>{open&&<CanvasEdgeAuditPanel key={epoch} locale='en' canvas={current} onLocate={e=>window.fixture.located.push(e.id)} onApply={next=>{history.push(current);window.fixture.applied++;setCurrent(next)}} onClose={()=>{window.fixture.closed++;setOpen(false)}}/>}</div>}
 root.render(<App/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@theia/core/shared/react':core.resolve('react')}});
 const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',request=>void request.respond({status:200,contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><main></main>'}));
 await page.goto('https://edge-audit.test/');await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('[data-edge-index]');
 const count=()=>page.$$eval('[data-edge-index]',els=>els.length);
 const click=label=>page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label)?.click(),label);
 const remove=id=>page.click(`button[aria-label="Remove from preview: ${id}"]`);
 assert.equal(await count(),3);assert.equal(await page.evaluate(()=>window.fixture.applied),0);
 await page.click('button[aria-label="Locate connection: dangling"]');assert.deepEqual(await page.evaluate(()=>window.fixture.located),['dangling']);
 await page.focus('[role=dialog]');await page.keyboard.press('Delete');assert.deepEqual(await page.evaluate(()=>window.fixture.keys),[]);
 await remove('dangling');assert.equal(await count(),2);assert.equal(await page.evaluate(()=>window.fixture.current.edges.length),4);assert.ok(await page.$('[data-edge-blocked]'));
 assert.equal(await page.$$eval('button',els=>els.find(e=>e.textContent==='Apply repair').disabled),true);
 await click('Undo preview removals');assert.equal(await count(),3);
 await remove('dangling');await page.evaluate(()=>window.fixture.update());await page.waitForFunction(()=>!document.querySelector('[data-edge-preview]'));
 assert.match(await page.$eval('[data-edge-notice]',e=>e.textContent),/canvas changed/);assert.equal(await page.evaluate(()=>window.fixture.applied),0);
 assert.equal(await page.evaluate(()=>window.fixture.current.edges.find(e=>e.id==='dangling').sourceNodeId),'b','changed edge was not removed');
 await page.evaluate(()=>window.fixture.reset());await page.waitForSelector('[data-edge-index]');
 await remove('dangling');await click('Select all issue rows');await click('Remove selected from preview');assert.equal(await count(),0);assert.equal(await page.evaluate(()=>window.fixture.applied),0);
 await click('Check again');assert.equal(await count(),0);await click('Apply repair');await page.waitForFunction(()=>window.fixture.applied===1);
 assert.deepEqual(await page.evaluate(()=>window.fixture.current.edges.map(e=>e.id)),['keep']);assert.equal(await count(),0);assert.equal(await page.$('[data-edge-preview]'),null);
 await page.evaluate(()=>window.fixture.undo());await page.waitForFunction(()=>document.querySelectorAll('[data-edge-index]').length===3);assert.deepEqual(await page.evaluate(()=>window.fixture.current),damaged(),'undo restores original edge roles, nodes, versions and provenance');
 await remove('dangling');await page.focus('[role=dialog]');await page.keyboard.press('Escape');assert.equal(await page.$('[role=dialog]'),null);assert.equal(await page.evaluate(()=>window.fixture.current.edges.length),4,'closing discards preview');
 await page.focus('#outside');await page.keyboard.press('Delete');assert.deepEqual(await page.evaluate(()=>window.fixture.keys),['Delete']);assert.deepEqual(errors,[]);
});
