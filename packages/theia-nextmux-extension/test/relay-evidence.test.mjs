import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { INITIAL_RELAY_QUALITY, averageRelayAvailability, averageRelayLatency, latestRelayLatency, measuredModelFidelity, measuredRelayAuthenticity, measuredRelayLatency, measuredRelayQuality, relayFeedbackVotes } from '../lib/common/nextmux-relay-evidence.js';
import { rankRelayMarketplace } from '../lib/browser/nextmux-relay-marketplace.js';
import { relayAvailabilityText, relayEvidenceText, relayLatestLatencyText, relayMarketplaceText } from '../lib/browser/nextmux-relay-marketplace-locale.js';

test('unknown relay samples stay absent and an old p95 field is not recast as a latest probe', () => {
    for (const value of [null, undefined, '', '0', NaN, Infinity, -1]) assert.equal(measuredRelayLatency(value), undefined);
    assert.equal(measuredRelayLatency(0), 0);
    assert.equal(latestRelayLatency({ p95LatencyMs: 20 }), undefined);
    assert.equal(latestRelayLatency({ p95LatencyMs: 1, lastLatencyMs: 70 }), 70);
    assert.equal(latestRelayLatency({ p95LatencyMs: 1, lastLatencyMs: null }), undefined);
});

test('latency averages include measured zero, exclude unknown and do not invent a zero when empty', () => {
    assert.equal(averageRelayLatency([]), undefined);
    assert.equal(averageRelayLatency([null, undefined]), undefined);
    assert.equal(averageRelayLatency([null, 0, 100, undefined]), 50);
    assert.equal(averageRelayLatency([0]), 0);
});

test('quality and fidelity require actual feedback or identity samples, not routing priors or API discovery', () => {
    // No vote yet is the initial 100% a new store starts with, never the routing prior (99) and never "unmeasured".
    assert.equal(measuredRelayQuality([{ routeScore: 99 }]), INITIAL_RELAY_QUALITY);
    assert.equal(INITIAL_RELAY_QUALITY, 100);
    assert.equal(measuredRelayQuality([]), 100);
    // 50 virtual positive votes: likes never lower it, one early dislike costs about 2 points, never a crash to 0%.
    assert.equal(measuredRelayQuality([{ likes: 7, dislikes: 0 }]), 100);
    assert.equal(measuredRelayQuality([{ likes: 0, dislikes: 1 }]), 98);
    assert.equal(measuredRelayQuality([{ likes: 0, dislikes: 2 }]), 96);
    assert.equal(measuredRelayQuality([{ likes: 0, dislikes: 5 }]), 91);
    assert.equal(measuredRelayQuality([{ likes: 3, dislikes: 1 }]), 98);
    assert.equal(measuredRelayQuality([{ likes: 0, dislikes: 10 }]), 83);
    assert.equal(measuredRelayQuality([{ likes: 9000, dislikes: 1000 }]), 90);
    assert.equal(measuredRelayQuality([{ likes: 0, dislikes: 30 }]), 63, 'a .5 boundary rounds like the platform SQL');
    assert.equal(measuredRelayQuality([{ likes: NaN, dislikes: -1 }]), 100);
    assert.equal(relayFeedbackVotes([{ likes: NaN, dislikes: -1 }, { routeScore: 99 }]), 0);
    assert.equal(relayFeedbackVotes([{ likes: 3, dislikes: 1 }, { likes: 2 }]), 6);
    for (const value of [undefined, { index: 90, sampleCount: 0 }, { index: 90, sampleCount: 0.5 }, { index: 101, sampleCount: 2 }]) {
        assert.equal(measuredModelFidelity(value), undefined);
    }
    assert.equal(measuredModelFidelity({ index: 0, sampleCount: 1 }), 0);
    assert.equal(measuredModelFidelity({ index: 90, sampleCount: 2 }), 90);
});

test('availability requires real samples and excludes routing priors from mixed merchants', () => {
    assert.equal(averageRelayAvailability([]), undefined);
    for (const sampleCount of [undefined, null, 0, -1, NaN, Infinity, 0.5]) {
        assert.equal(averageRelayAvailability([{ availability: 0.5, sampleCount }]), undefined);
    }
    for (const availability of [undefined, null, NaN, Infinity, -1, 1.01]) {
        assert.equal(averageRelayAvailability([{ availability, sampleCount: 2 }]), undefined);
    }
    assert.equal(averageRelayAvailability([{ availability: 0, sampleCount: 2 }]), 0);
    assert.equal(averageRelayAvailability([{ availability: 1, sampleCount: 2 }]), 1);
    assert.equal(averageRelayAvailability([
        { availability: 0.5, sampleCount: 0 },
        { availability: 0.8, sampleCount: 10 },
        { availability: 1, sampleCount: 20 }
    ]), 0.9);
    const rows = rankRelayMarketplace([
        { id: 'prior', name: 'Prior', availability: averageRelayAvailability([{ availability: 0.5, sampleCount: 0 }]) },
        { id: 'measured', name: 'Measured', availability: averageRelayAvailability([{ availability: 0, sampleCount: 1 }]) }
    ], { sort: 'availability' });
    assert.deepEqual(rows.map(row => row.id), ['measured', 'prior']);
    assert.equal(rows[1].display.availability, undefined);
});

test('unmeasured relays sort last and fail latency filters rather than appearing fastest', () => {
    const merchants = [
        { id: 'unknown', name: 'Unknown', latencyMs: null },
        { id: 'slow', name: 'Slow', latencyMs: 20 },
        { id: 'zero', name: 'Zero', latencyMs: 0 }
    ];
    const rows = rankRelayMarketplace(merchants, { sort: 'latency', locale: 'en' });
    assert.deepEqual(rows.map(row => row.id), ['zero', 'slow', 'unknown']);
    assert.equal(rows[2].display.latency, undefined);
    assert.equal(rows[0].display.latency.value, '0');
    assert.deepEqual(rankRelayMarketplace(merchants, { sort: 'latency', filters: { maxLatencyMs: 10 } }).map(row => row.id), ['zero']);
});

test('few-sample threshold is explicit at 0 and 19 ratings, absent at 20, without changing observed score', () => {
    const rows = rankRelayMarketplace([
        { id: 'none', name: 'None', likes: 0, dislikes: 0 },
        { id: 'few', name: 'Few', likes: 19, dislikes: 0 },
        { id: 'threshold', name: 'Threshold', likes: 20, dislikes: 0 }
    ], { locale: 'en' });
    const byId = new Map(rows.map(row => [row.id, row]));
    assert.equal(byId.get('none').display.fewSamples, true);
    assert.equal(byId.get('none').display.ratingState, 'unrated');
    assert.equal(byId.get('few').display.fewSamples, true);
    assert.equal(byId.get('few').display.votes, '19');
    assert.equal(byId.get('few').display.rating, '10.0');
    assert.equal(byId.get('threshold').display.fewSamples, false);
    assert.equal(byId.get('threshold').display.votes, '20');
    assert.equal(byId.get('threshold').display.rating, '10.0');
});

test('evidence labels cover all twelve locales and never call a latest sample p95', () => {
    const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    for (const locale of locales) {
        for (const key of ['fewSamples', 'sampleHint', 'latest', 'unmeasured']) {
            assert.ok(relayEvidenceText(locale, key));
            if (locale !== 'en') assert.notEqual(relayEvidenceText(locale, key), relayEvidenceText('en', key));
        }
        assert.equal(relayLatestLatencyText(locale, undefined), relayEvidenceText(locale, 'unmeasured'));
        assert.equal(relayAvailabilityText(locale, undefined), relayEvidenceText(locale, 'unmeasured'));
        assert.equal(relayAvailabilityText(locale, 0), new Intl.NumberFormat(locale, {
            style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(0));
        assert.ok(relayLatestLatencyText(locale, 0).includes('ms'));
        assert.doesNotMatch(relayLatestLatencyText(locale, 120), /p95/i);
    }
    assert.equal(relayEvidenceText('zh-CN', 'fewSamples'), '样本较少');
    assert.match(relayEvidenceText('zh-CN', 'sampleHint'), /不是统计置信度/);
});

test('merchant ID hints direct all locales to the relay picker', () => {
    const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    assert.match(relayMarketplaceText('en', 'copyHint'), /relay picker/);
    assert.match(relayMarketplaceText('zh-CN', 'copyHint'), /中转商选择器/);
    assert.match(relayMarketplaceText('zh-TW', 'copyHint'), /中轉商選擇器/);
    assert.match(relayMarketplaceText('ja', 'copyHint'), /リレー選択/);
    for (const locale of locales) {
        const hint = relayMarketplaceText(locale, 'copyHint');
        assert.ok(hint);
        if (locale !== 'en') assert.notEqual(hint, relayMarketplaceText('en', 'copyHint'));
    }
});

test('desktop catalog consumers use explicit latest/absent evidence instead of the percentile field', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const directory = readFileSync(new URL('../src/browser/nextmux-model-center-merchants.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /network\.p95LatencyMs/);
    assert.doesNotMatch(source, /option\.latencyMs > 0|latencyMs \|\| Number\.MAX_SAFE_INTEGER/);
    assert.match(directory, /const rating = modelCenterRating\(merchant\)/);
    assert.match(directory, /text\('votedRating', rating\.samples\)/);
    assert.doesNotMatch(source, /network\.availability/);
    // The directory's third metric is 真实性 too; a relay without identity evidence says so instead of showing 0%.
    assert.match(directory, /merchant\.metrics\?\.authenticity === undefined \? relayText\(locale, 'authenticityPending'\)/);
    // The drawer's third column is 真实性 (model identity), not network availability.
    // Absent authenticity reads "—" (relayPercentText), never a percentile or 0%.
    assert.match(source, /kind: 'authenticity' as const, icon: 'verified', value: option\.authenticity, text: relayPercentText\(this\.desktopLocale, option\.authenticity\)/);
});

test('a relay\'s authenticity is the mean of its models that have evidence; untested models are left out', () => {
    assert.equal(measuredRelayAuthenticity([]), undefined);
    assert.equal(measuredRelayAuthenticity([{ index: 50, sampleCount: 0 }, undefined]), undefined, 'no evidence is unknown, not zero');
    assert.equal(measuredRelayAuthenticity([{ index: 100, sampleCount: 3 }, { index: 80, sampleCount: 1 }, { index: 50, sampleCount: 0 }]), 90);
});
