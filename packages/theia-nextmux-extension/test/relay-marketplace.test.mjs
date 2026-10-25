import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = process.env.NEXTMUX_RELAY_MARKETPLACE_MODULE_URL
    || '../lib/browser/nextmux-relay-marketplace.js';
const { rankRelayMarketplace, relayMerchantNumber } = await import(moduleUrl);

test('public rating is the 50-vote smoothed approval while ranking remains confidence-adjusted', () => {
    const rows = rankRelayMarketplace([
        { id: 'merchant-new', name: 'New relay', likes: 10, dislikes: 0 },
        { id: 'merchant-proven', name: 'Proven relay', likes: 85, dislikes: 15 }
    ], { sort: 'rating' });

    assert.deepEqual(rows.map(row => row.id), ['merchant-proven', 'merchant-new']);
    assert.deepEqual(rows.map(row => row.rating.score), [9, 10]); // (85 + 50) / (100 + 50), (10 + 50) / (10 + 50)
    assert.deepEqual(rows.map(row => row.rating.confidenceAdjustedScore), [8.3, 8]);
    assert.deepEqual(rows.map(row => row.rating.votes), [100, 10]);
});

test('an unrated merchant never exposes the Bayesian prior as a user rating', () => {
    const [row] = rankRelayMarketplace([{ id: 'new', name: 'New relay' }], { locale: 'zh-CN' });

    assert.equal(row.rating.score, undefined);
    assert.equal(row.rating.confidenceAdjustedScore, 7);
    assert.equal(row.display.rating, '—');
    assert.equal(row.display.ratingState, 'unrated');
    assert.equal(row.display.votes, '0');
    assert.equal(rankRelayMarketplace([
        { id: 'new', name: 'New relay' },
        { id: 'rated', name: 'Rated relay', likes: 8, dislikes: 2 }
    ], { sort: 'rating', filters: { minRating: 5 } }).map(item => item.id).join(','), 'rated');
});

test('merchant number is copyable and remains stable when a merchant is renamed', () => {
    const original = rankRelayMarketplace([
        { id: 'merchant-account-42', name: 'Original name' }
    ])[0];
    const renamed = rankRelayMarketplace([
        { id: 'merchant-account-42', name: 'Renamed relay' }
    ])[0];

    assert.match(original.merchantNumber, /^RLY-[0-9A-Z]{13}$/);
    assert.equal(renamed.merchantNumber, original.merchantNumber);
    assert.equal(relayMerchantNumber('merchant-account-42'), original.merchantNumber);
});

test('capability and model coverage filters require the requested complete coverage', () => {
    const allCapabilities = [
        'language', 'image', 'video', 'audio', 'music', 'audio_drama', 'silent_drama'
    ];
    const rows = rankRelayMarketplace([
        {
            id: 'complete', name: 'Complete relay', capabilities: allCapabilities,
            modelIds: ['GPT-5', 'Sora-2', 'audio-model']
        },
        {
            id: 'partial', name: 'Partial relay', capabilities: allCapabilities.slice(0, -1),
            modelIds: ['GPT-5']
        }
    ], {
        filters: {
            capabilities: allCapabilities,
            capabilityMatch: 'all',
            modelIds: ['gpt-5', 'SORA-2'],
            modelMatch: 'all',
            minModelCount: 2
        }
    });

    assert.deepEqual(rows.map(row => row.id), ['complete']);
    assert.deepEqual(rows[0].capabilities, allCapabilities);
    assert.equal(rows[0].modelCount, 3);
});

test('quality, price, network and API verification filters reject missing or non-matching evidence', () => {
    const rows = rankRelayMarketplace([
        {
            id: 'qualified', name: 'Qualified relay', likes: 60, dislikes: 10,
            multiplierBps: 12_500,
            estimatedPrice: { amountMicros: 2_500_000, currency: 'CNY', unitKey: 'per_million_tokens' },
            availability: 0.997,
            latencyMs: 450,
            apiVerification: { status: 'verified', confidence: 0.96, sampleCount: 40 }
        },
        { id: 'missing', name: 'No telemetry' },
        {
            id: 'failed', name: 'Failed verification', likes: 100, dislikes: 0,
            multiplierBps: 9_000,
            estimatedPrice: { amountMicros: 1_000_000, currency: 'CNY', unitKey: 'per_million_tokens' },
            availability: 0.999,
            latencyMs: 100,
            apiVerification: { status: 'failed', confidence: 1, sampleCount: 100 }
        }
    ], {
        filters: {
            minRating: 8,
            maxMultiplierBps: 13_000,
            maxEstimatedPriceMicros: 3_000_000,
            estimatedPriceCurrency: 'CNY',
            minAvailability: 0.99,
            maxLatencyMs: 500,
            apiVerification: ['verified'],
            minApiConfidence: 0.9
        }
    });

    assert.deepEqual(rows.map(row => row.id), ['qualified']);
    assert.equal(rows[0].multiplierBps, 12_500);
    assert.equal(rows[0].estimatedPrice.amountMicros, 2_500_000);
    assert.equal(rows[0].availability, 0.997);
    assert.equal(rows[0].latencyMs, 450);
    assert.equal(rows[0].apiVerification.status, 'verified');
});

test('all marketplace sort modes are directional, recommended is balanced, and missing ties stay stable', () => {
    const merchants = [
        {
            id: 'reliable', name: 'Reliable', likes: 90, dislikes: 10,
            multiplierBps: 12_000,
            estimatedPrice: { amountMicros: 3_000_000, currency: 'CNY', unitKey: 'per_million_tokens' },
            availability: 0.999,
            latencyMs: 600,
            apiVerification: { status: 'verified', confidence: 0.99, sampleCount: 80 },
            modelIds: ['m1', 'm2', 'm3', 'm4', 'm5']
        },
        {
            id: 'fast', name: 'Fast and cheap', likes: 55, dislikes: 45,
            multiplierBps: 8_000,
            estimatedPrice: { amountMicros: 1_000_000, currency: 'CNY', unitKey: 'per_million_tokens' },
            availability: 0.95,
            latencyMs: 100,
            apiVerification: { status: 'partial', confidence: 0.7, sampleCount: 10 },
            modelIds: Array.from({ length: 10 }, (_, index) => `m${index + 1}`)
        },
        { id: 'unknown', name: 'Unknown' }
    ];
    const ids = sort => rankRelayMarketplace(merchants, {
        sort,
        estimatedPriceCurrency: 'CNY'
    }).map(row => row.id);

    assert.deepEqual(ids('recommended'), ['reliable', 'fast', 'unknown']);
    assert.deepEqual(ids('rating'), ['reliable', 'fast', 'unknown']);
    assert.deepEqual(ids('multiplier'), ['fast', 'reliable', 'unknown']);
    assert.deepEqual(ids('estimated_price'), ['fast', 'reliable', 'unknown']);
    assert.deepEqual(ids('availability'), ['reliable', 'fast', 'unknown']);
    assert.deepEqual(ids('latency'), ['fast', 'reliable', 'unknown']);
    assert.deepEqual(ids('api_authenticity'), ['reliable', 'fast', 'unknown']);
    assert.deepEqual(ids('model_coverage'), ['fast', 'reliable', 'unknown']);

    const missing = rankRelayMarketplace([
        { id: 'z-last-lexically', name: 'First input' },
        { id: 'a-first-lexically', name: 'Second input' }
    ], { sort: 'latency' });
    assert.deepEqual(missing.map(row => row.name), ['First input', 'Second input']);
});

test('display data is locale-ready and malformed telemetry degrades to absent metrics', () => {
    const valid = rankRelayMarketplace([{
        id: 'display', name: 'Display relay', likes: 90, dislikes: 10,
        multiplierBps: 12_000,
        estimatedPrice: { amountMicros: 3_000_000, currency: 'CNY', unitKey: 'per_million_tokens' },
        availability: 0.999,
        latencyMs: 600,
        apiVerification: { status: 'verified', confidence: 0.99, sampleCount: 80 },
        capabilities: ['language', 'image'],
        modelIds: ['m1', 'm2']
    }], { locale: 'de-DE' })[0];

    assert.equal(valid.display.rating, '9,3'); // (90 + 50) / (100 + 50)
    assert.equal(valid.display.ratingState, 'rated');
    assert.equal(valid.display.multiplier, '1,20×');
    const tiny = rankRelayMarketplace([{ id: 'tiny', name: 'Tiny relay', likes: 1, dislikes: 0, multiplierBps: 1 }], { locale: 'de-DE' })[0];
    assert.equal(tiny.display.multiplier, '<0,01×', 'a paid quote never reads 0,00×');
    const half = rankRelayMarketplace([{ id: 'half', name: 'Half relay', likes: 1, dislikes: 0, multiplierBps: 1_450 }], { locale: 'en' })[0];
    assert.equal(half.display.multiplier, '0.15×');
    assert.deepEqual(valid.display.estimatedPrice, {
        amount: '3,00', currency: 'CNY', unitKey: 'per_million_tokens'
    });
    assert.equal(valid.display.availability, '99,90 %');
    assert.deepEqual(valid.display.latency, { value: '600', unitKey: 'millisecond' });
    assert.equal(valid.display.apiVerificationKey, 'relayMarketplace.apiVerification.verified');
    assert.deepEqual(valid.display.capabilityKeys, [
        'relayMarketplace.capability.language', 'relayMarketplace.capability.image'
    ]);

    const malformed = rankRelayMarketplace([{
        id: 'malformed', name: 'Malformed', likes: Number.NaN, dislikes: -10,
        multiplierBps: -1,
        estimatedPrice: { amountMicros: Number.POSITIVE_INFINITY, currency: '', unitKey: '' },
        availability: 99,
        latencyMs: -20,
        apiVerification: { status: 'verified', confidence: 2, sampleCount: -1 },
        capabilities: ['language', 'not-a-capability'],
        modelIds: ['M1', 'm1', '  ']
    }], { locale: 'not_a_locale' })[0];

    assert.equal(malformed.rating.score, undefined);
    assert.equal(malformed.rating.confidenceAdjustedScore, 7);
    assert.equal(malformed.display.rating, '—');
    assert.equal(malformed.display.ratingState, 'unrated');
    assert.equal(malformed.multiplierBps, undefined);
    assert.equal(malformed.estimatedPrice, undefined);
    assert.equal(malformed.availability, undefined);
    assert.equal(malformed.latencyMs, undefined);
    assert.equal(malformed.apiVerification.confidence, undefined);
    assert.equal(malformed.modelCount, 1);
    assert.deepEqual(malformed.capabilities, ['language']);
});

test('platform-promoted merchants lead only the recommended view in explicit rank order', () => {
    const merchants = [
        { id: 'organic', name: 'Organic', likes: 900, dislikes: 10, availability: 1 },
        { id: 'rank-two', name: 'Rank two', recommendedRank: 2 },
        { id: 'rank-one', name: 'Rank one', recommendedRank: 1 }
    ];

    assert.deepEqual(rankRelayMarketplace(merchants, { sort: 'recommended' }).map(row => row.id), [
        'rank-one', 'rank-two', 'organic'
    ]);
    assert.equal(rankRelayMarketplace(merchants, { sort: 'rating' })[0].id, 'organic');
});
