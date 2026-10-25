import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { applyCanvasCommand, createCanvasDocument } from '@nextmux/comic-core/canvas';
import { buildManagedCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { estimateManagedVideoPriceMicros, managedVideoInputImageCount } from '../lib/common/nextmux-managed-video-price.js';
import { canvasVideoInputImageCount, managedCanvasVideoEstimate } from '../lib/browser/nextmux-comic-canvas-price.js';
import { formatManagedVideoPrice, formatManagedVideoEstimate, videoPriceUnitText } from '../lib/browser/nextmux-video-price.js';
import { offeringPriceText, offeringPriceSignature, offeringOfficialPrice } from '../lib/browser/nextmux-offering-price.js';
import { publicMediaRouteContract } from '../../../apps/cloudflare-platform/src/gateway-media-request-contract.js';
import { publicVideoShapeProof } from '../../../apps/cloudflare-platform/src/video-shape-proofs.js';
import { historicalVideoRows, offlineVideoRoute } from '../../../apps/cloudflare-platform/test/fixtures/catalog/video-34b-audit-input.mjs';

const price = { currency: 'USD', mode: 'reference_multiplier', multiplierBps: 10_000, videoSecondMicros: 130_000, videoInputImageEachMicros: 40_000 };
const now = '2026-10-01T00:00:00.000Z';
const image = id => ({ id, assetId: id, kind: 'image', uri: `nextmux.media/${id}.png`, createdAt: now });
function canvas(mode = 'firstLastFrame') {
    let board = createCanvasDocument({ id: 'image-fees', projectId: 'fixture-project', now });
    const node = { id: 'video', kind: 'videoGen', title: 'Clip', position: { x: 0, y: 0 }, size: { width: 320, height: 240 },
        payload: { mode, modelId: 'minimax/hailuo-3', prompt: 'Keep the composition.', versions: [], parameters: { durationSeconds: 5 },
            inputs: [{ id: 'first', role: 'firstFrame', order: 0, version: image('first') },
                ...(mode === 'firstLastFrame' ? [{ id: 'last', role: 'lastFrame', order: 1, version: image('last') }] : []),
                ...[0, 1].map(index => ({ id: `reference-${index}`, role: 'referenceImage', order: index + 2, version: image(`reference-${index}`) }))] } };
    board = applyCanvasCommand(board, { type: 'node.add', node }, { now });
    return { board, node: board.nodes[0] };
}

test('managed video estimate adds each input image once and keeps text-only and legacy prices unchanged', () => {
    assert.equal(estimateManagedVideoPriceMicros(price, 5, 0), 650_000);
    assert.equal(estimateManagedVideoPriceMicros(price, 5, 1), 690_000);
    assert.equal(estimateManagedVideoPriceMicros(price, 5, 2), 730_000);
    assert.equal(estimateManagedVideoPriceMicros(price, 5, 4), 810_000);
    assert.equal(estimateManagedVideoPriceMicros({ videoSecondMicros: 130_000 }, 5, 4), 650_000);
    assert.equal(managedVideoInputImageCount({ firstFrameUri: 'same.png', lastFrameUri: 'same.png',
        referenceAssetUris: ['reference.png'], characterReferenceUris: ['character.png'] }), 4);
    for (const invalid of [null, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(estimateManagedVideoPriceMicros({ ...price, videoSecondMicros: invalid }, 5, 1), undefined);
    }
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(estimateManagedVideoPriceMicros({ ...price, videoInputImageEachMicros: invalid }, 5, 1), undefined);
    }
    assert.equal(estimateManagedVideoPriceMicros(price, 5, -1), undefined);
    assert.equal(estimateManagedVideoPriceMicros(price, 0, 1), undefined);
    assert.equal(estimateManagedVideoPriceMicros({ ...price, videoSecondMicros: Number.MAX_SAFE_INTEGER }, 5, 1), undefined);
    assert.equal(estimateManagedVideoPriceMicros({ ...price, videoSecondMicros: 1, videoInputImageEachMicros: 1 }, 0.5, 2), 3);
});

test('all twelve locales display both video rates, the input-image dimension and the cost breakdown', () => {
    const locales = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    assert.match(formatManagedVideoPrice('zh-CN', price), /(?:US)?\$0\.13 \/ 秒 \+ (?:US)?\$0\.04 \/ 张输入图/u);
    assert.match(formatManagedVideoEstimate('en', price, 5, 2), /\$0\.73.*\$0\.65.*2 input images \$0\.08/u);
    for (const locale of locales) {
        const display = formatManagedVideoPrice(locale, price), estimate = formatManagedVideoEstimate(locale, price, 5, 2);
        assert.ok(display.includes(' + ') && estimate.includes(' + '), locale);
        assert.ok(videoPriceUnitText(locale) && offeringPriceText(locale, 'videoInputImage'), locale);
        if (locale !== 'en') assert.notEqual(offeringPriceText(locale, 'videoInputImage'), offeringPriceText('en', 'videoInputImage'));
    }
    assert.equal(formatManagedVideoEstimate('en', price, 5, 0), '$0.65');
    assert.equal(formatManagedVideoPrice('en', { ...price, videoInputImageEachMicros: undefined }), '$0.13 / second');
});

test('canvas estimates include direct and wired input images and exclude written character identities', () => {
    const fixture = canvas();
    assert.equal(canvasVideoInputImageCount(fixture.board, fixture.node), 4);
    assert.match(managedCanvasVideoEstimate('en', fixture.board, fixture.node, { price }), /\$0\.81.*4 input images \$0\.16/u);
    let board = applyCanvasCommand(fixture.board, { type: 'node.add', node: { id: 'upstream', kind: 'imageGen', title: 'Pending picture',
        position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { mode: 'textToImage', modelId: 'fixture-image', prompt: 'Portrait', parameters: {}, versions: [] } } }, { now });
    board = applyCanvasCommand(board, { type: 'edge.connect', edge: { id: 'wire', sourceNodeId: 'upstream', sourcePort: 'output',
        targetNodeId: 'video', targetPort: 'referenceImage', role: 'referenceImage', order: 0, binding: 'followCurrent' } }, { now });
    board = applyCanvasCommand(board, { type: 'node.add', node: { id: 'identity', kind: 'character', title: 'Character',
        position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { characterId: 'character-id', description: 'A traveler.', versions: [] } } }, { now });
    board = applyCanvasCommand(board, { type: 'edge.connect', edge: { id: 'identity-wire', sourceNodeId: 'identity', sourcePort: 'output',
        targetNodeId: 'video', targetPort: 'character', role: 'character', order: 1, binding: 'followCurrent' } }, { now });
    assert.equal(canvasVideoInputImageCount(board, fixture.node), 5);
    assert.match(managedCanvasVideoEstimate('en', board, fixture.node, { price }), /\$0\.85.*5 input images \$0\.20/u);
    const withoutDuration = { ...fixture.node, payload: { ...fixture.node.payload, parameters: {} } };
    assert.match(managedCanvasVideoEstimate('en', board, withoutDuration, { price }, { status: 'available', version: 'fixture', id: 'fixture', modes: [
        { mode: 'firstLastFrame', defaultResolution: '720p', duration: { kind: 'fixed', seconds: 5 },
            outputVariants: [{ id: '720p', resolution: '720p', aspectRatios: ['16:9'] }] }] }), /\$0\.85/u);
});

test('the billed-image dimension changes quote signatures and official multiplier reconstruction', () => {
    const offering = { price, multiplierBps: 10_000, keyPrice: { selectedMultiplierBps: 10_000 } };
    assert.notEqual(offeringPriceSignature(offering), offeringPriceSignature({ ...offering, price: { ...price, videoInputImageEachMicros: 50_000 } }));
    assert.equal(offeringOfficialPrice({ ...offering, multiplierBps: 20_000, keyPrice: { selectedMultiplierBps: 20_000 } }).videoInputImageEachMicros, 20_000);
});

test('real H3 itemised-fee catalog proof opens image and first/last modes while stale fees close both consumers', () => {
    const row = historicalVideoRows.find(item => item.modelId === 'minimax/hailuo-3');
    assert.ok(row);
    const route = offlineVideoRoute(row), flat = publicMediaRouteContract(route, 'video'), proof = publicVideoShapeProof(route);
    const offering = { ...row.priorOffering, ...flat, price, keyPriceQuoteId: route.pricing.keyQuote.keyPriceQuoteId,
        videoLimits: { ...flat.videoLimits, ...proof } };
    assert.equal(proof.inputImagePriceMicros, 40_000);
    const capability = buildManagedCanvasCapability(offering), policy = buildManagedCanvasAdapterPolicy(offering);
    assert.ok(capability.modes.some(mode => mode.mode === 'imageToVideo'));
    assert.ok(capability.modes.some(mode => mode.mode === 'firstLastFrame'));
    assert.ok(policy.videoShapeProofs?.some(shape => shape.firstFrame && shape.lastFrame));
    for (const mismatch of [
        { ...offering, price: { ...price, videoInputImageEachMicros: 50_000 } },
        { ...offering, videoLimits: { ...offering.videoLimits, inputImagePriceMicros: undefined } },
        { ...offering, videoLimits: { ...offering.videoLimits, inputImagePriceMicros: -1 } },
    ]) {
        assert.deepEqual(buildManagedCanvasCapability(mismatch).modes, []);
        assert.equal(buildManagedCanvasAdapterPolicy(mismatch).videoShapeProofs, undefined);
    }
    const changed = { ...offering, price: { ...price, videoInputImageEachMicros: 50_000 },
        videoLimits: { ...offering.videoLimits, inputImagePriceMicros: 50_000 } };
    assert.notEqual(buildManagedCanvasCapability(changed).version, capability.version);
});

// Run the actual old-desk/model-picker/chat renderer methods without loading a Theia window.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['formatOfferingPrice', 'formatManagedMediaPrice', 'managedMediaEstimate', 'comicChatEstimate', 'comicCanvasEstimate']);
const methods = [];
(function walk(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, walk); })(ast);
assert.equal(methods.length, names.size);
const compiled = ts.transpileModule(`const { formatManagedVideoPrice, formatManagedVideoEstimate, managedVideoInputImageCount, managedCanvasVideoEstimate } = deps;
class Harness { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('deps', `${compiled}\nreturn Harness;`)({ formatManagedVideoPrice, formatManagedVideoEstimate, managedVideoInputImageCount, managedCanvasVideoEstimate });

test('the model picker, old desk cost confirmation, chat button and canvas callback use the full image quote', () => {
    const h = new Harness(), offering = { category: 'video', price }, route = { kind: 'managed', offering };
    Object.assign(h, { desktopLocale: 'en', mediaDraft: { kind: 'video' }, comicChatUi: () => ({ references: ['a', 'b'] }),
        comicChatReferencePolicy: () => ({ limit: 4 }), canvasRouteOf: () => ({ key: 'fixture', kind: 'video' }),
        canvasModelChoices: () => ({ routes: new Map([['fixture', route]]) }), canvasCapabilityOf: () => ({}) });
    assert.equal(h.formatOfferingPrice(offering), '$0.13 / second + $0.04 / input image');
    assert.equal(h.formatManagedMediaPrice(route), '$0.13 / second + $0.04 / input image');
    assert.match(h.managedMediaEstimate(route, 'video', { durationSeconds: 5, firstFrameUri: 'first.png', lastFrameUri: 'last.png' }), /\$0\.73/u);
    assert.match(h.comicChatEstimate('video', { source: { kind: 'managed' }, offering }, { seconds: 5 }, 'Clip'), /\$0\.73/u);
    assert.equal(h.comicChatEstimate('video', { source: { kind: 'managed' }, offering }, { seconds: 5 }, 'Proposal', 0), '$0.65');
    const fixture = canvas();
    assert.match(h.comicCanvasEstimate({ doc: fixture.board }, fixture.node), /\$0\.81/u);
    assert.ok(source.includes("estimateOf={node => this.comicCanvasEstimate(session, node)}"));
});
