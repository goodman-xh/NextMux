import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { officialMediaCapabilities } from '@nextmux/model-runtime/presets';
import { comicStudioText } from '../lib/browser/nextmux-comic-studio-text.js';

const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['registryModelSupportsWorkbench', 'comicConnectionMetadata', 'comicOfficialModelRoutes', 'computeComicOfficialModelRoutes', 'registryIndex', 'comicMediaSupportsKind', 'mediaCompatibleConnections', 'normalizedModelId', 'modelKeyForConnection', 'submitComicMediaPrompt', 'comicAgentKindNow', 'comicCatalogMediaRoutes', 'loadComicStepDirectory']);
const methods = [];
function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
}
visit(ast);
// Inlined for the data: URL below (it cannot resolve relative imports): own-model-kind and the name forms it uses.
const inline = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const ownModelKindSource = `${await inline('../../model-runtime/src/model-task-capabilities.ts')}\n${await inline('../src/common/nextmux-model-name.ts')}\n${await inline('../src/browser/nextmux-own-model-kind.ts')}\n${await inline('../src/browser/nextmux-own-model-match.ts')}`;
const compiled = ts.transpileModule(`const managedRelayKey = id => "managed:" + id; const officialMediaCapabilities = ${officialMediaCapabilities.toString()}; ${ownModelKindSource}; export class Harness { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const vision = { canonicalModel: 'vendor/vision-chat', input: ['text', 'image'], output: ['text'], capabilities: ['tools'] };
const image = { canonicalModel: 'vendor/image-v1', input: ['text'], output: ['image'], capabilities: ['image_generation'] };
const speech = { canonicalModel: 'vendor/tts-v1', input: ['text'], output: ['audio'], capabilities: ['tts'] };
function fixture() {
    const h = new Harness();
    h.registryModels = [vision, image, speech];
    h.setComicPrompt = value => { h.comicPrompt = value; };
    // Own APIs are classified on this computer from what the API itself reported (never the cloud catalog).
    h.officialModels = { connections: [{ id: 'key-a', providerId: 'vendor', providerName: 'Vendor', model: 'vision-chat', discoveredModels: [
        { id: 'vision-chat', inputModalities: ['text', 'image'], outputModalities: ['text'] },
        { id: 'image-v1', outputModalities: ['image'] }, { id: 'tts-v1', outputModalities: ['speech'] }] }] };
    h.connectionForDiscoveredModel = (connection, model) => ({ ...connection, model });
    h.activeRelayKey = 'official:key-a';
    h.managedOfferings = () => [];
    h.isModelVisible = () => true;
    h.mediaState = { runtime: { comfyUi: { available: false } } };
    return h;
}

test('image-input language models stay out of comic picker, actual image/audio outputs remain', () => {
    const h = fixture();
    assert.equal(h.registryModelSupportsWorkbench(vision, 'comic'), false);
    assert.equal(h.registryModelSupportsWorkbench(vision, 'coding'), true);
    assert.deepEqual(h.comicOfficialModelRoutes().map(route => route.connection.model), ['image-v1', 'tts-v1']);
    assert.deepEqual(h.mediaCompatibleConnections('image').map(route => route.model), ['image-v1']);
    assert.deepEqual(h.mediaCompatibleConnections('speech').map(route => route.model), ['tts-v1']);
    assert.equal(h.mediaCompatibleConnections('video').length, 0);
    assert.equal(h.mediaCompatibleConnections('music').length, 0);
});

test('a provider key alone never invents gpt-image, sora or another callable model', () => {
    const h = fixture();
    h.registryModels = [vision];
    // The key's own model list names no media model: nothing is invented from the provider's name.
    h.officialModels.connections[0].discoveredModels = [{ id: 'vision-chat', outputModalities: ['text'] }];
    assert.equal(h.mediaCompatibleConnections('image').length, 0);
    assert.equal(h.mediaCompatibleConnections('speech').length, 0);
});

test('the editor command bar never generates media: other text gets a hint, the prompt is kept, nothing is charged', async () => {
    for (const view of ['storyboard', 'workflow', 'timeline']) {
        const h = fixture();
        h.comicPrompt = 'A rain-soaked street';
        h.comicHasDirtyDraft = () => false;
        h.handleComicVoiceTranscript = () => false;
        h.comicView = view;
        h.ct = key => comicStudioText('zh-CN', key);
        h.openMediaSheet = () => assert.fail('the bar makes nothing; a shot is made on the shot, with the AI 模型 panel’s model');
        h.update = () => {};
        h.platformService = { startAgentRun() { assert.fail('media models must not receive chat/tools requests'); } };
        assert.equal(await h.submitComicMediaPrompt(), false);
        assert.match(h.comicMessage, /AI 模型/);
        assert.equal(h.comicPrompt, 'A rain-soaked street', 'the prompt is kept');
    }
});

test('playback commands work without selecting or spending on a model', async () => {
    const h = fixture();
    h.comicPrompt = '后退 10 秒';
    h.comicHasDirtyDraft = () => false;
    h.handleComicVoiceTranscript = text => text === '后退 10 秒';
    h.update = () => {};
    h.modelRoutes = () => { assert.fail('local playback needs no route'); };
    assert.equal(await h.submitComicMediaPrompt(), true);
    assert.equal(h.comicPrompt, '');
});

// No global catalog is necessary for a native protocol with a known official model.
test('native music and sound-effect presets remain selectable with exact media kinds', () => {
    const h = fixture();
    h.registryModels = [];
    h.activeRelayKey = 'official:native';
    h.officialModels.connections = [{ id: 'native', providerId: 'elevenlabs', providerName: 'ElevenLabs',
        protocol: 'elevenlabs_music', model: 'music_v1', discoveredModels: [{ id: 'music_v2' }, { id: 'unknown' }] }];
    assert.deepEqual(h.mediaCompatibleConnections('music').map(route => route.model), ['music_v1', 'music_v2']);
    assert.equal(h.mediaCompatibleConnections('speech').length, 0);
    assert.equal(h.mediaCompatibleConnections('sound_effect').length, 0);
    // Replaced, not edited in place, as the widget does (the route lists are cached per connections array).
    h.officialModels = { ...h.officialModels, connections: [{ ...h.officialModels.connections[0], protocol: 'elevenlabs_sound_effect',
        model: 'eleven_text_to_sound_v2', discoveredModels: [] }] };
    assert.equal(h.mediaCompatibleConnections('sound_effect').length, 1);
    assert.equal(h.mediaCompatibleConnections('music').length, 0);
});


test('managed music is discoverable before a merchant catalog has been cached; sound effects stay separate', async () => {
    const h = fixture();
    h.platformCatalog = { offerings: [
        { id: 'music', status: 'active', merchantId: 'm', canonicalModel: 'vendor/music', capabilities: ['music_generation'], input: ['text'], output: ['audio'], routeScore: 10 },
        { id: 'tts', status: 'active', merchantId: 'm', canonicalModel: 'vendor/tts', capabilities: ['tts'], input: ['text'], output: ['audio'], routeScore: 20 },
        { id: 'legacy', status: 'active', merchantId: 'm', canonicalModel: 'vendor/legacy-music', capabilities: ['text_to_music'], input: ['text'], output: ['audio'], routeScore: 5 }
    ] };
    h.offeringMerchantId = offering => offering.merchantId;
    h.isModelVisible = () => true;
    assert.deepEqual(h.comicCatalogMediaRoutes('music', 'm').map(route => route.offering.id), ['music']);
    assert.deepEqual(h.comicCatalogMediaRoutes('sound_effect', 'm'), []);
    h.activeRelayKey = 'managed:m';
    h.managedOfferings = () => h.platformCatalog.offerings;
    assert.deepEqual(h.mediaCompatibleConnections('music').map(route => route.offering.id), ['music']);
    assert.deepEqual(h.mediaCompatibleConnections('sound_effect'), []);
    h.comicStepDirectory = new Map();
    h.catalogSnapshotRevision = 1;
    h.catalogRemovedMerchants = new Set();
    const queries = [];
    h.platformService = { getPublicMerchantDirectory: async query => { queries.push(query); return { merchants: [{ id: 'm', name: 'Merchant' }] }; } };
    h.update = () => {};
    await h.loadComicStepDirectory('music');
    await h.loadComicStepDirectory('sound_effect');
    assert.equal(queries.length, 1);
    assert.equal(queries[0].capability, 'music_generation');
    assert.deepEqual(h.comicStepDirectory.get('music').relays, [{ key: 'managed:m', label: 'Merchant' }]);
});

test('managed comic step routes require the published category as well as the exact output kind', () => {
    const h = fixture();
    h.activeRelayKey = 'managed:m';
    const row = (id, category, output, capabilities) => ({ id, merchantId: 'm', status: 'active', canonicalModel: id,
        registryModelId: id, routeScore: 10, category, input: ['text'], output, capabilities });
    h.platformCatalog = { offerings: [
        row('image', 'image', ['image'], ['image_generation']),
        row('video', 'video', ['video'], ['video_generation']),
        row('speech', 'audio', ['speech'], ['tts']),
        row('music', 'audio', ['audio'], ['music_generation']),
        row('chat-image', 'text', ['text', 'image'], ['tools', 'image_generation']),
        row('coding-video', 'coding', ['text', 'video'], ['tools', 'video_generation']),
        row('video-speech', 'video', ['speech'], ['tts']),
        row('text-music', 'text', ['audio'], ['music_generation'])
    ] };
    h.managedOfferings = () => h.platformCatalog.offerings;
    h.offeringMerchantId = offering => offering.merchantId;
    h.isModelVisible = () => true;
    for (const [kind, ids] of [['image', ['image']], ['video', ['video']], ['speech', ['speech']], ['music', ['music']]]) {
        assert.deepEqual(h.mediaCompatibleConnections(kind).map(route => route.offering.id), ids, `loaded ${kind} picker`);
        assert.deepEqual(h.comicCatalogMediaRoutes(kind, 'm').map(route => route.offering.id), ids, `uncached ${kind} fallback`);
    }
});

test('unavailable models stay out of both loaded managed media and own API directories', () => {
    const h = fixture();
    h.activeRelayKey = 'managed:m';
    const image = { id: 'available-image', merchantId: 'm', category: 'image', status: 'active', canonicalModel: 'image-v1',
        registryModelId: 'image-v1', routeScore: 10, input: ['text'], output: ['image'], capabilities: ['image_generation'] };
    h.managedOfferings = () => [image, { ...image, id: 'offline-image', available: false }];
    assert.deepEqual(h.mediaCompatibleConnections('image').map(route => route.offering.id), ['available-image']);
    h.activeRelayKey = 'official:key-a';
    h.officialModels = { connections: h.officialModels.connections.map(connection => ({ ...connection,
        discoveredModels: connection.discoveredModels.map(model => model.id === 'image-v1' ? { ...model, available: false } : model) })) };
    assert.deepEqual(h.comicOfficialModelRoutes().map(route => route.connection.model), ['tts-v1']);
});
