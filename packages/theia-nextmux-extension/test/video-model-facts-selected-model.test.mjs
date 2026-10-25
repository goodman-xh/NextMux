import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';

// Both real methods execute against an isolated directory/key-store/network seam.
// No provider calls, credential reads, project mutations or generated files.
const source = readFileSync(process.env.NEXTMUX_VIDEO_FACTS_TEST_SOURCE || new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('platform.ts', source, ts.ScriptTarget.Latest, true);
assert.equal(ast.parseDiagnostics.length, 0);
const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
const method = name => service.members.find(node => node.name?.getText(ast) === name).getText(ast);
const routerHostCheck = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isOpenRouterBaseUrl').getText(ast);
const routerCheck = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isOpenRouterMediaConnection').getText(ast);
class PlatformRequestError extends Error { constructor(code) { super(code); this.code = code; } }
function harness({ available = true, output = 'video', missingKey = false, template } = {}) {
    const calls = { keys: 0, limits: [], headers: [] };
    const connection = { id: 'official-fixture', protocol: template ? 'async_media_template' : 'openai_chat_completions',
        model: 'default-text-model', baseUrl: 'https://openrouter.ai/api/v1', providerSettings: template ? { mediaTemplate: template } : {},
        discoveredModels: [{ id: 'default-text-model', available: true, outputModalities: ['text'] },
            { id: 'alibaba/wan-3.0', available, outputModalities: [output] }] };
    const code = ts.transpile(`${routerHostCheck}\n${routerCheck}\nclass Harness { ${method('getVideoModelFacts')} ${method('mediaConnection')} }\nreturn Harness;`, { target: ts.ScriptTarget.ES2022 });
    const Harness = new Function('videoModelGuide', 'PlatformRequestError', 'mediaMessage', 'readKeychainPassword', 'officialKeyAccount', 'productEnv', code)(
        videoModelGuide, PlatformRequestError, key => key, async () => { calls.keys++; return missingKey ? null : 'non-secret-fixture'; }, id => id, () => undefined);
    const instance = new Harness();
    instance.readOfficialConnectionIndex = async () => [connection];
    instance.officialVideoHeaders = (selected, key) => { calls.headers.push([selected.id, key]); return {}; };
    instance.openRouterVideoLimits = async (_selected, _headers, model) => { calls.limits.push(model); return {
        durations: [5, 10, 15], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], frameImages: ['first_frame'], audio: false };
    };
    return { instance, calls, connection };
}

test('selected video reads its real listing when the saved connection default is a text model', async () => {
    const { instance, calls } = harness();
    const result = await instance.getVideoModelFacts('official-fixture', 'alibaba/wan-3.0');
    assert.equal(result.source, 'listing');
    assert.deepEqual(result.clipSeconds, [5, 10, 15]);
    assert.deepEqual(result.resolutions, ['720p', '1080p']);
    assert.deepEqual(result.aspectRatios, ['16:9', '9:16']);
    assert.equal(result.firstFrame, true); assert.equal(result.lastFrame, false);
    assert.equal(result.nativeAudio, false); assert.equal(result.supportsGenerateAudio, false);
    assert.deepEqual(calls.limits, ['alibaba/wan-3.0']); assert.equal(calls.keys, 1);
});
for (const rejected of [{ available: false }, { output: 'text' }])
    test('an unavailable or non-video selected model never reads credentials or its provider listing ' + JSON.stringify(rejected), async () => {
        const { instance, calls } = harness(rejected);
        const result = await instance.getVideoModelFacts('official-fixture', 'alibaba/wan-3.0');
        assert.equal(result.source, 'guide'); assert.equal(calls.keys, 0); assert.deepEqual(calls.limits, []);
    });
test('a missing configured key keeps the existing guide fallback and never queries the provider', async () => {
    const { instance, calls } = harness({ missingKey: true });
    const result = await instance.getVideoModelFacts('official-fixture', 'alibaba/wan-3.0');
    assert.equal(result.source, 'guide'); assert.equal(calls.keys, 1); assert.deepEqual(calls.limits, []);
});
test('a selected custom video template keeps its declared durations and first-frame behavior', async () => {
    const { instance, calls } = harness({ template: { kind: 'video', seconds: [6, 10], images: 'multipart', maxReferences: 3,
        submit: { body: '{"first":"{{first_frame}}","refs":"{{references}}"}' } } });
    const result = await instance.getVideoModelFacts('official-fixture', 'alibaba/wan-3.0');
    assert.deepEqual(result.clipSeconds, [6, 10]); assert.equal(result.firstFrame, true);
    assert.equal(result.referencesVerified, true); assert.equal(result.maxReferences, 3);
    assert.equal(calls.keys, 1); assert.deepEqual(calls.limits, []);
});
test('an unsuccessful provider metadata lookup preserves the existing guide fallback', async () => {
    const { instance, calls } = harness();
    instance.openRouterVideoLimits = async () => { throw new Error('metadata fixture unavailable'); };
    const result = await instance.getVideoModelFacts('official-fixture', 'alibaba/wan-3.0');
    assert.equal(result.source, 'guide'); assert.deepEqual(result.resolutions, []);
    assert.deepEqual(result.aspectRatios, []); assert.equal(calls.keys, 1);
});
test('invalid model arguments are rejected before any key or metadata read', async () => {
    const { instance, calls } = harness();
    for (const model of ['', 'x'.repeat(301), 7]) await assert.rejects(instance.getVideoModelFacts('official-fixture', model), { code: 'INVALID_MEDIA_REQUEST' });
    assert.equal(calls.keys, 0); assert.deepEqual(calls.limits, []);
});
