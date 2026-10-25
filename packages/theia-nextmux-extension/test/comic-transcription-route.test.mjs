import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { optionalKeyPriceQuoteId } from '../lib/common/nextmux-price-quote.js';

const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['comicTranscriptionRoutes', 'comicTranscriptionRoute', 'comicTranscriptionPrice',
    'comicTranscriptionMaximumPriceMicros', 'comicTranscriptionConsentKey', 'comicTranscriptionRequestRoute'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const Harness = new Function('optionalKeyPriceQuoteId', 'comicStepText', ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`,
    { target: ts.ScriptTarget.ES2022 }))(optionalKeyPriceQuoteId, () => 'Local');

const offeringId = '11111111-1111-4111-8111-111111111111';
const quote = `kq1_${'a'.repeat(64)}`;
const baseOffering = {
    id: offeringId, status: 'active', merchantId: 'merchant-1', canonicalModel: 'asr-model', providerName: 'Relay',
    keyPriceQuoteId: quote, keyPrice: { pricingMode: 'direct', quoteRequired: true },
    input: ['audio'], output: ['transcription'], capabilities: ['transcription'], price: { mode: 'direct', currency: 'USD', audioSecondMicros: 5 },
    pricingDetails: { quoteAt: 1, dimensions: [{ metric: 'audio_second', user: { unitSize: 60, amountMicros: 600 } }] }
};

function fixture(offering = baseOffering) {
    const h = new Harness();
    const project = {
        id: 'project-1', frameRate: 24,
        assets: [{ id: 'song-1', uri: 'nextmux.media/song.wav', durationMs: 180_000 }],
        music: { selectedAssetId: 'song-1' },
        scenes: [{ shots: [{ id: 'shot-1', durationFrames: 2160, audioAssetId: 'audio-1' }] }]
    };
    Object.assign(h, {
        platformCatalog: { offerings: [offering] }, selectedMerchantCatalog: undefined,
        merchantPickerSnapshots: new Map(), catalogRemovedMerchants: new Set(), desktopLocale: 'en',
        activeComicWorkspaceRoot: '/workspace', offeringMerchantId: value => value.merchantId,
        isModelVisible: () => true, comicStepChoice: () => ({ routeId: `managed:fixed:${offering.id}` }),
        comicProject: () => project, comicEditingProject: () => project, comicTimelineDocument: () => undefined,
        activeComicShotId: 'shot-1', comicTranscriptionCompositionClipId: undefined,
        activeComicShot: () => project.scenes[0].shots[0],
        musicSongShot: () => ({ shot: { durationFrames: 24 } })
    });
    return h;
}

test('a quoted direct transcription sends both the quote and a customer-price charge ceiling', () => {
    const h = fixture();
    const route = h.comicTranscriptionRoute();
    assert.equal(route?.id, `managed:fixed:${offeringId}`);
    assert.match(h.comicTranscriptionPrice(route), /\$0\.0006/, 'the customer quote wins over the lower merchant price');
    assert.equal(h.comicTranscriptionMaximumPriceMicros(route), 1_200, '90 seconds plus extraction rounding at a minute rate');
    assert.equal(h.comicTranscriptionMaximumPriceMicros(route, 'music'), 2_400, 'music uses the full song duration');
    assert.throws(() => h.comicTranscriptionRequestRoute(), error => error.code === 'ASR_COST_CONFIRMATION_REQUIRED');
    h.comicTranscriptionConfirmation = h.comicTranscriptionConsentKey();
    assert.deepEqual(h.comicTranscriptionRequestRoute(), {
        connectionId: `managed:fixed:${offeringId}`, model: 'asr-model', keyPriceQuoteId: quote, maximumPriceMicros: 1_200, costConfirmed: true
    });
    assert.equal(h.comicTranscriptionRequestRoute('music').maximumPriceMicros, 2_400);
    h.platformCatalog.offerings[0] = { ...baseOffering, pricingDetails: { ...baseOffering.pricingDetails, quoteAt: 2 } };
    assert.throws(() => h.comicTranscriptionRequestRoute(), error => error.code === 'ASR_COST_CONFIRMATION_REQUIRED',
        'a changed catalog price invalidates earlier consent');
});

test('quoted transcription binds the quote and a direct model without a measurable rate is hidden', () => {
    const quoted = fixture({ ...baseOffering, keyPrice: { pricingMode: 'official_key_multiplier', quoteRequired: true },
        price: { ...baseOffering.price, mode: 'reference_multiplier' } });
    quoted.comicTranscriptionConfirmation = quoted.comicTranscriptionConsentKey();
    assert.deepEqual(quoted.comicTranscriptionRequestRoute(), {
        connectionId: `managed:fixed:${offeringId}`, model: 'asr-model', keyPriceQuoteId: quote, costConfirmed: true
    });
    const unpriced = fixture(baseOffering);
    unpriced.platformCatalog.offerings[0] = { ...unpriced.platformCatalog.offerings[0], pricingDetails: { quoteAt: 1, dimensions: [] } };
    assert.equal(unpriced.comicTranscriptionRoutes().length, 1, 'merchant price without a customer quote cannot be shown');
    const invalidUnit = fixture({ ...baseOffering, pricingDetails: { quoteAt: 1,
        dimensions: [{ metric: 'audio_second', user: { unitSize: 0, amountMicros: 600 } }] } });
    assert.equal(invalidUnit.comicTranscriptionRoutes().length, 1, 'an invalid billing unit cannot yield a safe ceiling');
    const missingQuote = fixture({ ...baseOffering, keyPriceQuoteId: undefined });
    assert.equal(missingQuote.comicTranscriptionRoutes().length, 1, 'quote-required direct models cannot use an unquoted fallback');
});
