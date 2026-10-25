import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';
const common = await loadCanvasToolsSource('common/nextmux-canvas-download.ts');
const backend = await loadCanvasToolsSource('node/nextmux-canvas-download.ts');
const copy = await loadCanvasToolsSource('browser/nextmux-comic-canvas-download-text.ts');
const unzip = createRequire(new URL('../../theia-ffmpeg-portable/package.json', import.meta.url))('unzipper');
const uri = path => pathToFileURL(path).href;
const item = (name, extension = 'png') => ({ nodeId:'node', versionId:'v1', assetId:'a1', kind:'image', label:'海边.png', extension, name, manual:false });

test('five naming rules, fixed timestamp, bounds, extension and case-insensitive collisions', () => {
    const options = common.normalizeCanvasDownloadNaming(null);
    assert.deepEqual(options, {rule:'index_name',start:1,padding:3,separator:'_',prefix:'',timestamp:false});
    for (const [rule, expected] of [['index_name','001_海边'],['name_index','海边_001'],['name','海边'],['index','001'],['type_index','image_001']]) {
        assert.equal(common.canvasDownloadAutoName(item(''),0,{...options,rule},'20261003_120000'),expected);
    }
    const items=[{...item(''),nodeId:'a'},{...item('Keep this'),nodeId:'b',manual:true}];
    const next=common.renameCanvasDownloads(items,{...options,start:0,padding:6,prefix:'Take',timestamp:true},'20261003_120000');
    assert.equal(next[0].name,'Take_20261003_120000_000000_海边');assert.equal(next[1].name,'Keep this');
    assert.equal(common.renameCanvasDownloads([...next].reverse(),options,'later')[0].name,'Keep this');
    assert.equal(common.renameCanvasDownloads(next,options,'later',true)[1].name,'002_海边');
    assert.deepEqual(common.canvasDownloadFileNames([item('Shot.PNG'),item('shot'),item('shot','mp4'),item('shot(2)'),item('  ')]),
        {names:['Shot.png','shot(2).png','shot.mp4','shot(2)(2).png','.png'],conflicts:[1,3],empty:[4]});
    assert.equal(common.canvasDownloadExtension('https://host/file.mp4'),undefined);
    assert.equal(common.canvasDownloadExtension('nextmux.media/a.PNG'),'png');
    assert.equal(common.sanitizeCanvasDownloadName('../../CON:bad'),'_.._CON_bad');
    assert.equal(common.normalizeCanvasDownloadNaming({start:-1,padding:99,prefix:'x'.repeat(100)}).prefix.length,24);
    assert.ok(Buffer.byteLength(common.canvasDownloadFileNames([item('中'.repeat(140))]).names[0]) <= 240,'Unicode names leave room for an extension and collision suffix');
});

async function fixture(t) {
    const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'nextmux-download-')));
    await fs.mkdir(join(root,'nextmux.media'));await fs.mkdir(join(root,'saved'));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const first=Buffer.from('真实素材\0original\n'),second=Buffer.from([0,1,2,3,255]);
    await fs.writeFile(join(root,'nextmux.media/a.png'),first);await fs.writeFile(join(root,'nextmux.media/b.mp4'),second);
    const canvas={nodes:[{id:'node',payload:{versions:[{id:'v1',assetId:'a1',uri:'nextmux.media/a.png',kind:'image'}]}},
        {id:'video',payload:{versions:[{id:'v2',assetId:'a2',uri:'nextmux.media/b.mp4',kind:'video'}]}}]};
    const request=(name,items=[item('Picture')])=>({workspaceRoot:root,canvasId:'main',requestId:'download-1',destinationUri:uri(join(root,'saved',name)),items:items.map(({nodeId,versionId,assetId,name,extension})=>({nodeId,versionId,assetId,name,extension}))});
    return {root,canvas,request,first,second};
}
async function noTemp(root) { assert.deepEqual((await fs.readdir(join(root,'saved'))).filter(name=>name.startsWith('.nextmux-download-')),[]); }
test('single save writes original bytes; existing and source files stay untouched', async t => {
    const f=await fixture(t);const original=await fs.stat(join(f.root,'nextmux.media/a.png'));
    await fs.writeFile(join(f.root,'saved/PICTURE.png'),'unrelated');
    const result=await backend.exportCanvasDownload(f.request('Picture.png'),f.canvas);
    assert.equal(result.fileName,'Picture(2).png');assert.deepEqual(await fs.readFile(fileURLToPath(result.destinationUri)),f.first);
    assert.equal(await fs.readFile(join(f.root,'saved/PICTURE.png'),'utf8'),'unrelated');
    assert.equal((await fs.stat(join(f.root,'nextmux.media/a.png'))).mtimeMs,original.mtimeMs);await noTemp(f.root);
});
test('multi-save produces a real UTF-8 ZIP, independent reader extracts exact bytes and duplicate suffixes', async t => {
    const f=await fixture(t);const result=await backend.exportCanvasDownload(f.request('Media.zip',[item('海边'),item('海边'),
        {...item('海边','mp4'),nodeId:'video',versionId:'v2',assetId:'a2'}]),f.canvas);
    const zip=await unzip.Open.file(fileURLToPath(result.destinationUri));
    assert.deepEqual(zip.files.map(entry=>entry.path),['海边.png','海边(2).png','海边.mp4']);
    assert.deepEqual(await Promise.all(zip.files.map(entry=>entry.buffer())),[f.first,f.first,f.second]);
    assert.equal((await fs.stat(fileURLToPath(result.destinationUri))).size,result.bytes);await noTemp(f.root);
});
test('version/asset ownership, remote sources, destination extension and source symlinks are rejected', async t => {
    const f=await fixture(t);
    for (const field of ['nodeId','versionId','assetId']) {
        await assert.rejects(backend.exportCanvasDownload(f.request('Bad.png',[{...item('Bad'),[field]:'other'}]),f.canvas),{code:'CANVAS_DOWNLOAD_SOURCE'});
    }
    await assert.rejects(backend.exportCanvasDownload(f.request('Wrong.jpg'),f.canvas),{code:'CANVAS_DOWNLOAD_EXTENSION'});
    await assert.rejects(backend.exportCanvasDownload({...f.request('Bad.png'),destinationUri:'https://host/a.png'},f.canvas),{code:'CANVAS_DOWNLOAD_INVALID'});
    await assert.rejects(backend.exportCanvasDownload(f.request('Bad.png',[item('')]),f.canvas),{code:'CANVAS_DOWNLOAD_INVALID'});
    const bad=structuredClone(f.canvas);bad.nodes[0].payload.versions[0].uri='https://host/a.png';
    await assert.rejects(backend.exportCanvasDownload(f.request('Bad.png'),bad),{code:'CANVAS_DOWNLOAD_SOURCE'});
    await fs.unlink(join(f.root,'nextmux.media/a.png'));await fs.symlink(join(f.root,'nextmux.media/b.mp4'),join(f.root,'nextmux.media/a.png'));
    await assert.rejects(backend.exportCanvasDownload(f.request('Bad.png'),f.canvas),{code:'CANVAS_DOWNLOAD_UNSAFE'});await noTemp(f.root);
});
test('one scoped request writes once; altered retry and pre-cancelled request never save', async t => {
    const f=await fixture(t), service=new backend.CanvasDownloadService(async()=>f.canvas), request=f.request('Once.png');
    const [first,second]=await Promise.all([service.run(request),service.run(request)]);assert.deepEqual(first,second);
    assert.deepEqual(await fs.readdir(join(f.root,'saved')),['Once.png']);
    await assert.rejects(service.run({...request,destinationUri:uri(join(f.root,'saved/Other.png'))}),{code:'CANVAS_DOWNLOAD_CONFLICT'});
    service.cancel({...request,requestId:'cancelled'});
    await assert.rejects(service.run({...request,requestId:'cancelled'}),{code:'CANVAS_DOWNLOAD_CANCELLED'});
    const controller=new AbortController();controller.abort();
    await assert.rejects(backend.exportCanvasDownload(f.request('Cancelled.png'),f.canvas,controller.signal),{code:'CANVAS_DOWNLOAD_CANCELLED'});await noTemp(f.root);
});
test('concurrent saves never replace a destination and mid-stream cancellation leaves no partial file', async t => {
    const f=await fixture(t);
    const results=await Promise.all(Array.from({length:4},()=>backend.exportCanvasDownload(f.request('Race.png'),f.canvas)));
    assert.equal(new Set(results.map(result=>result.fileName)).size,4);
    for (const result of results) assert.deepEqual(await fs.readFile(fileURLToPath(result.destinationUri)),f.first);
    const large=join(f.root,'nextmux.media/a.png');await fs.writeFile(large,Buffer.alloc(12*1024*1024,77));
    const controller=new AbortController(), saving=backend.exportCanvasDownload(f.request('Cancel.png'),f.canvas,controller.signal);
    const observe=saving.then(()=>false, error=>error);
    while (!(await fs.readdir(join(f.root,'saved'))).some(name=>name.startsWith('.nextmux-download-'))) await new Promise(resolve=>setImmediate(resolve));
    controller.abort();assert.equal((await observe).code,'CANVAS_DOWNLOAD_CANCELLED');
    await assert.rejects(fs.stat(join(f.root,'saved/Cancel.png')),{code:'ENOENT'});await noTemp(f.root);
    assert.equal((await fs.stat(large)).size,12*1024*1024);
});
test('retry cache and pre-cancel tombstones are bounded; active saves survive expiry and cache pressure', async t => {
    const f=await fixture(t);let clock=1000, release;
    const service=new backend.CanvasDownloadService(scope=>scope.requestId==='active'?new Promise(resolve=>{release=resolve;}):Promise.resolve(f.canvas),()=>clock);
    const active={...f.request('Active.png'),requestId:'active'}, pending=service.run(active);
    await new Promise(resolve=>setImmediate(resolve));
    clock+=backend.CANVAS_DOWNLOAD_RETRY_WINDOW_MS+1;
    for (let i=0;i<backend.CANVAS_DOWNLOAD_RETAINED_REQUESTS+5;i++) {
        service.cancel({...active,requestId:'cancel-'+i});
        await assert.rejects(service.run({...active,requestId:'failed-'+i,items:[{...active.items[0],assetId:'missing'}]}),{code:'CANVAS_DOWNLOAD_SOURCE'});
    }
    assert.equal(service.cancelled.size,backend.CANVAS_DOWNLOAD_RETAINED_REQUESTS);
    assert.equal(service.tasks.size,backend.CANVAS_DOWNLOAD_RETAINED_REQUESTS+1);
    assert.equal(service.run(active),pending,'active request remains the same save after expiry and pressure');
    release(f.canvas);const result=await pending;assert.deepEqual(await service.run(active),result);
    assert.equal(service.tasks.size,backend.CANVAS_DOWNLOAD_RETAINED_REQUESTS);
    clock+=backend.CANVAS_DOWNLOAD_RETRY_WINDOW_MS+1;
    const expired=await service.run({...active,requestId:'cancel-104'});
    assert.equal(expired.fileName,'Active(2).png','expired pre-cancel record no longer blocks a new explicit save');
    assert.equal(service.tasks.size,1);assert.equal(service.cancelled.size,0);await noTemp(f.root);
});
test('connection disposal cancels pending ownership loads and rejects new saves', async t => {
    const f=await fixture(t);let release;
    const service=new backend.CanvasDownloadService(()=>new Promise(resolve=>{release=resolve;}));
    const pending=service.run(f.request('Disconnected.png'));
    await new Promise(resolve=>setImmediate(resolve));service.dispose();release(f.canvas);
    await assert.rejects(pending,{code:'CANVAS_DOWNLOAD_CANCELLED'});
    await assert.rejects(service.run({...f.request('New.png'),requestId:'new'}),{code:'CANVAS_DOWNLOAD_CANCELLED'});
    assert.equal(service.tasks.size,0);assert.equal(service.cancelled.size,0);
    assert.deepEqual(await fs.readdir(join(f.root,'saved')),[]);await noTemp(f.root);
});
test('all download copy has twelve locales with stable unknown-key fallback', () => {
    for (const locale of ['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi']) {
        for (const key of ['download','title','rule','index_name','name_index','name','index','type_index','start','padding','separator','underscore','hyphen','space','none','prefix','timestamp','applyAll','automatic','manual','restore','up','down','fileName','preview','zipName','cancel','save','saving','conflicts','empty','invalid','failed','saved','extension','source','tooLarge']) {
            assert.ok(copy.downloadText(locale,key).trim());assert.notEqual(copy.downloadText(locale,key),key,`${locale}.${key}`);
        }
        assert.ok(copy.downloadText(locale,'saved',{name:'a.png'}).includes('a.png'));
        assert.equal(copy.downloadText(locale,'unknown-key'),'unknown-key');
    }
});
