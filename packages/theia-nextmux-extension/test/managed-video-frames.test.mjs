import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
const repo = process.env.NEXTMUX_MANAGED_AUDIO_TEST_REPOSITORY || fileURLToPath(new URL('../../../', import.meta.url));
const sourceRoot=resolve(repo,'packages/theia-nextmux-extension/src'),libRoot=resolve(repo,'packages/theia-nextmux-extension/lib');
const modules=new Map();
function load(filename){
 if(modules.has(filename))return modules.get(filename).exports;
 const candidateRoot=process.env.NEXTMUX_MANAGED_AUDIO_SOURCE_ROOT,candidate=candidateRoot&&resolve(candidateRoot,filename.slice(sourceRoot.length+1));
 const chosen=candidate&&existsSync(candidate)?candidate:undefined;
 if(!chosen)return createRequire(resolve(libRoot,filename.slice(sourceRoot.length+1).replace(/\.ts$/u,'.js')))('./'+filename.split(sep).at(-1).replace(/\.ts$/u,'.js'));
 const module={exports:{}};modules.set(filename,module);
 const output=ts.transpileModule(readFileSync(chosen,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}});
 const libRequire=createRequire(resolve(libRoot,filename.slice(sourceRoot.length+1).replace(/\.ts$/u,'.js')));
 const req=name=>name.startsWith('.')?load(resolve(dirname(filename),name+'.ts')):libRequire(name);
 new Function('exports','require','module','__filename','__dirname',output.outputText)(module.exports,req,module,filename,dirname(filename));return module.exports;
}
const {NextMuxPlatformServiceImpl}=load(resolve(sourceRoot,'node/nextmux-platform-service.ts'));
const {buildManagedCanvasAdapterPolicy}=load(resolve(sourceRoot,'common/nextmux-canvas-adapter-policy.ts'));

const id = '00000000-0000-4000-8000-000000000001';
const registryModelId = '00000000-0000-4000-8000-000000000002';
const imageInput = { firstFrame: true, lastFrame: true, referenceImages: true, maxReferences: 4 };
const offering = mediaInput => ({ id, registryModelId, status: 'active', mediaInput });
const signal = () => new AbortController().signal;

async function fixture(t, mediaInput = imageInput) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-managed-video-frames-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const service = new NextMuxPlatformServiceImpl();
    const calls = [], reads = [], catalog = [];
    service.baseUrl = 'https://platform.fixture.invalid';
    service.deviceId = async () => 'fixture-device';
    service.nextmuxDataRoot = () => root;
    service.mediaJobStore = async () => ({ setCapacityWaiting: async () => undefined });
    service.getPrivacySettings = async () => ({});
    service.getCatalogOffering = async offeringId => { catalog.push(offeringId); return offering(mediaInput); };
    service.resolveMediaInput = async (_root, uri) => { reads.push(uri); return join(root, uri); };
    service.noteRemoteTask = async (_root, job, task) => service.acceptedRemoteTasks.set(job.id, task);
    service.reportVideoMeasurement = async () => {};
    service.fetchVideoOutput = async () => new Response('fixture output');
    service.streamVideoOutput = async () => ({ relativeUri: 'nextmux.media/output.mp4' });
    service.networkFetch = async (url, init) => {
        calls.push({ url: String(url), ...init });
        return Response.json({ job: { id, status: 'completed' } });
    };
    const input = { connectionId: `managed:fixed:${id}`, keyPriceQuoteId: `kq1_${'a'.repeat(64)}`,
        model: 'video-model', prompt: 'Keep the scene', durationSeconds: 5, width: 1280, height: 720 };
    const job = { id: `job-${id}`, kind: 'video', idempotencyKey: 'same-paid-video' };
    const images = { 'first.png': Buffer.from('first-frame'), 'last.jpg': Buffer.from('last-frame'),
        'reference.webp': Buffer.from('scene-reference'), 'character.png': Buffer.from('character-reference') };
    await Promise.all(Object.entries(images).map(([name, bytes]) => writeFile(join(root, name), bytes)));
    const run = () => service.requestManagedVideo(root, job, input, signal());
    return { service, root, input, job, calls, reads, catalog, images, run };
}

test('managed video sends explicit first and last frames and every reference in the gateway contract fields', async t => {
    const f = await fixture(t);
    Object.assign(f.input, { firstFrameUri: 'first.png', lastFrameUri: 'last.jpg',
        referenceAssetUris: ['reference.webp'], characterReferenceUris: ['character.png'] });
    await f.run();
    const body = JSON.parse(f.calls[0].body);
    assert.deepEqual(body.referenceImage, { mimeType: 'image/png', dataBase64: f.images['first.png'].toString('base64') });
    assert.deepEqual(body.lastFrame, { mimeType: 'image/jpeg', dataBase64: f.images['last.jpg'].toString('base64') });
    assert.deepEqual(body.characterReferences, [
        { mimeType: 'image/webp', dataBase64: f.images['reference.webp'].toString('base64') },
        { mimeType: 'image/png', dataBase64: f.images['character.png'].toString('base64') }
    ]);
    assert.equal(new Headers(f.calls[0].headers).get('idempotency-key'), f.job.idempotencyKey);
    assert.deepEqual(f.catalog, [id]);
});

test('legacy one-picture jobs stay first-frame jobs; explicit reference mode preserves one reference', async t => {
    for (const generationMode of [undefined, 'referenceToVideo']) {
        const f = await fixture(t);
        Object.assign(f.input, { generationMode, referenceAssetUris: ['first.png'] });
        await f.run();
        const body = JSON.parse(f.calls[0].body);
        assert.equal(Boolean(body.referenceImage), generationMode === undefined);
        assert.equal(Boolean(body.characterReferences), generationMode === 'referenceToVideo');
    }
});

test('unpublished frames, references, count and last-frame-only inputs fail before image reads or paid submission', async t => {
    for (const [mediaInput, patch] of [
        [undefined, { firstFrameUri: 'first.png' }],
        [{ ...imageInput, firstFrame: false }, { referenceAssetUris: ['first.png'] }],
        [{ ...imageInput, lastFrame: false }, { firstFrameUri: 'first.png', lastFrameUri: 'last.jpg' }],
        [{ ...imageInput, referenceImages: false }, { characterReferenceUris: ['character.png'] }],
        [{ ...imageInput, maxReferences: 1 }, { referenceAssetUris: ['reference.webp', 'character.png'] }],
        [imageInput, { lastFrameUri: 'last.jpg' }],
        [imageInput, { characterReferenceUris: Array(5).fill('character.png') }]
    ]) {
        const f = await fixture(t, mediaInput ?? {});
        Object.assign(f.input, patch);
        await assert.rejects(f.run(), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
        assert.equal(f.calls.length, 0);
        assert.equal(f.reads.length, 0);
    }
});

test('automatic video requires one candidate to publish the complete shape, including paginated candidates', async t => {
    const f = await fixture(t);
    Object.assign(f.input, { connectionId: `managed:auto:${registryModelId}`, firstFrameUri: 'first.png',
        characterReferenceUris: ['character.png'] });
    f.service.getCatalog = async () => ({ online: true, offerings: [
        offering({ firstFrame: true, referenceImages: false }),
        offering({ firstFrame: false, referenceImages: true, maxReferences: 4 })
    ] });
    await assert.rejects(f.run(), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
    assert.equal(f.calls.length, 0);
    f.service.getCatalog = async () => ({ online: true, offerings: [offering({ firstFrame: false })], nextCursor: 'fixture-cursor' });
    f.service.getCatalogPage = async cursor => {
        assert.equal(cursor, 'fixture-cursor');
        return { online: true, offerings: [offering(imageInput)] };
    };
    await f.run();
    assert.equal(JSON.parse(f.calls[0].body).registryModelId, registryModelId);
});

test('managed video resumes an accepted frame job without rechecking catalog, rereading images or paying twice', async t => {
    const f = await fixture(t);
    f.input.firstFrameUri = 'first.png';
    await f.run();
    f.service.getCatalogOffering = async () => { throw new Error('catalog unavailable after acceptance'); };
    f.service.resolveMediaInput = async () => { throw new Error('image removed after acceptance'); };
    await f.run();
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(f.calls.filter(call => call.method === 'GET').length, 1);
    assert.deepEqual(f.reads, ['first.png']);
});

test('lost frame-job create responses replay the same image payload and idempotency key', async t => {
    const f = await fixture(t);
    f.input.firstFrameUri = 'first.png';
    const network = f.service.networkFetch;
    let first = true;
    f.service.networkFetch = async (...args) => {
        const result = await network(...args);
        if (first) { first = false; throw new Error('create response lost'); }
        return result;
    };
    await assert.rejects(f.run(), { code: 'PLATFORM_OFFLINE' });
    await f.run();
    assert.deepEqual(f.calls.map(call => new Headers(call.headers).get('idempotency-key')), [f.job.idempotencyKey, f.job.idempotencyKey]);
    assert.equal(f.calls[0].body, f.calls[1].body);
});

test('all managed frame and reference images enforce the gateway format and 5 MiB limit before submit', async t => {
    for (const [name, bytes, code] of [['empty.png', Buffer.alloc(0), 'VIDEO_REFERENCE_INVALID'],
        ['too-large.png', Buffer.alloc(5 * 1024 * 1024 + 1), 'VIDEO_REFERENCE_TOO_LARGE'],
        ['bad.gif', Buffer.from('bad'), 'VIDEO_REFERENCE_INVALID']]) {
        for (const field of ['firstFrameUri', 'lastFrameUri', 'characterReferenceUris']) {
            const f = await fixture(t);
            await writeFile(join(f.root, name), bytes);
            if (field === 'lastFrameUri') f.input.firstFrameUri = 'first.png';
            f.input[field] = field === 'characterReferenceUris' ? [name] : name;
            await assert.rejects(f.run(), { code });
            assert.equal(f.calls.length, 0);
        }
    }
});

for (const reason of ['client_shutdown', 'user_stop', 'exit_incognito']) test(`managed video ${reason} preserves detach versus explicit cancellation`, async t => {
    const f = await fixture(t), controller = new AbortController();
    f.service.networkFetch = async (url, init) => { f.calls.push({ url, ...init }); return Response.json({ job: { id, status: 'completed' } }); };
    f.service.fetchVideoOutput = async () => { controller.abort(reason); throw new DOMException('Aborted', 'AbortError'); };
    await assert.rejects(f.service.requestManagedVideo(f.root, f.job, f.input, controller.signal));
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, reason === 'client_shutdown' ? 0 : 1);
});

const quote=`kq1_${'a'.repeat(64)}`;
function audioOffering(input,audio=[false,true]){return {id,registryModelId,status:'active',category:'video',providerModelCode:'alibaba/wan-3.0',canonicalModel:'alibaba/wan-3.0',capabilities:['image_to_video','video_native_audio'],keyPriceQuoteId:quote,price:{videoInputImageEachMicros:0},mediaInput:{firstFrame:true,lastFrame:false,referenceImages:false,maxReferences:0},videoLimits:{shapeQuoteId:quote,inputImagePriceMicros:0,provenShapes:audio.map(requestAudio=>({resolution:'720p',aspectRatio:'16:9',width:1280,height:720,durationSeconds:5,firstFrame:Boolean(input.firstFrameUri),lastFrame:false,referenceImages:0,requestAudio}))}};}
function audioPolicy(input,audio=[false,true]){return buildManagedCanvasAdapterPolicy(audioOffering(input,audio),{kind:'video'});}
for(const requestAudio of [true,false])test(`managed verified audio=${requestAudio} reaches gateway without a raw provider control`,async t=>{
 const f=await fixture(t);Object.assign(f.input,{model:'alibaba/wan-3.0',requestAudio,resolution:'720p',aspectRatio:'16:9',generationMode:'imageToVideo',firstFrameUri:'first.png'});const before=JSON.stringify(f.input);let checks=0;f.service.canvasAdapterPolicy=async()=>{checks++;return audioPolicy(f.input);};await f.run();const body=JSON.parse(f.calls[0].body);assert.equal(body.requestAudio===true,requestAudio);assert.equal(Object.hasOwn(body,'generate_audio'),false);assert.equal(Object.hasOwn(body,'audioControlVersion'),false);assert.equal(checks,requestAudio?1:0);assert.equal(JSON.stringify(f.input),before);if(!requestAudio)assert.equal(Object.hasOwn(body,'requestAudio'),false,'old false body identity remains byte compatible');
});
test('an unproved managed on choice fails before paid POST or reference reads',async t=>{
 const f=await fixture(t);Object.assign(f.input,{requestAudio:true,firstFrameUri:'first.png',resolution:'720p',aspectRatio:'16:9'});f.service.canvasAdapterPolicy=async()=>audioPolicy(f.input,[false]);await assert.rejects(f.run(),{code:'VIDEO_CAPABILITY_UNSUPPORTED'});assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
});
test('accepted managed audio resumes its same task even after current catalog capability disappears',async t=>{
 const f=await fixture(t);Object.assign(f.input,{requestAudio:true,firstFrameUri:'first.png',resolution:'720p',aspectRatio:'16:9'});f.service.canvasAdapterPolicy=async()=>audioPolicy(f.input);await f.run();const originalBody=f.calls[0].body;f.service.canvasAdapterPolicy=async()=>{throw new Error('current capability changed');};f.service.getCatalogOffering=async()=>{throw new Error('current catalog changed');};await f.run();assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.equal(f.calls.filter(x=>x.method==='GET').length,1);assert.equal(f.calls[0].body,originalBody);
});
test('managed keeps rejecting own-only versioned controls and unsupported source-video/audio edits',async t=>{
 for(const patch of [{audioControlVersion:1,requestAudio:true},{requestSubtitles:true},{referenceAudioUris:['a.wav']},{sourceVideoUri:'original.mp4'}]){const f=await fixture(t);Object.assign(f.input,patch);await assert.rejects(f.run(),{code:'VIDEO_CAPABILITY_UNSUPPORTED'});assert.equal(f.calls.length,0);}
});

test('automatic managed audio chooses one paginated candidate that proves audio and images under the same quote',async t=>{
 const f=await fixture(t);Object.assign(f.input,{connectionId:`managed:auto:${registryModelId}`,model:'alibaba/wan-3.0',requestAudio:true,firstFrameUri:'first.png',resolution:'720p',aspectRatio:'16:9'});let pages=0;f.service.canvasAdapterPolicy=async()=>{throw new Error('fixed-only policy must not reject automatic route');};f.service.getCatalog=async()=>({online:true,offerings:[audioOffering(f.input,[false])],nextCursor:'audio-next'});f.service.getCatalogPage=async cursor=>{assert.equal(cursor,'audio-next');pages++;return{online:true,offerings:[audioOffering(f.input)]};};await f.run();assert.equal(pages,1);assert.equal(JSON.parse(f.calls[0].body).requestAudio,true);assert.equal(JSON.parse(f.calls[0].body).registryModelId,registryModelId);
});
test('automatic managed audio cannot combine one candidate audio proof with another image capability or quote',async t=>{
 const f=await fixture(t);Object.assign(f.input,{connectionId:`managed:auto:${registryModelId}`,model:'alibaba/wan-3.0',requestAudio:true,firstFrameUri:'first.png',resolution:'720p',aspectRatio:'16:9'});const wrong=audioOffering(f.input);wrong.mediaInput.firstFrame=false;const stale=audioOffering(f.input);stale.keyPriceQuoteId=`kq1_${'b'.repeat(64)}`;f.service.getCatalog=async()=>({online:true,offerings:[audioOffering(f.input,[false]),wrong,stale]});await assert.rejects(f.run(),{code:'VIDEO_CAPABILITY_UNSUPPORTED'});assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
});
