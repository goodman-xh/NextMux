import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Stage 3e [CANVAS-COMIC-01..03]: local media cost estimates, the pre-flight balance gate and the media budget ledger.
// The sources are transpiled here (no build needed); this file is excluded from the package build.
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map<string, Record<string, unknown>>();

function loadTsModule<T = Record<string, unknown>>(relativeFromSrc: string): T {
    const candidate = resolve(srcRoot, relativeFromSrc);
    const fullPath = /\.tsx?$/.test(candidate) ? candidate : existsSync(`${candidate}.ts`) ? `${candidate}.ts` : `${candidate}.tsx`;
    const cached = moduleCache.get(fullPath);
    if (cached) return cached as T;
    const transpiled = ts.transpileModule(readFileSync(fullPath, 'utf8'), { fileName: fullPath,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React } }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    moduleCache.set(fullPath, module.exports);
    const load = (specifier: string): unknown => specifier.startsWith('.')
        ? loadTsModule(resolve(dirname(fullPath), specifier.replace(/\.[cm]?js$/u, '')).slice(srcRoot.length + 1)) : nodeRequire(specifier);
    new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled)(module.exports, load, module, fullPath, dirname(fullPath));
    moduleCache.set(fullPath, module.exports);
    return module.exports as T;
}

const tiersModule = loadTsModule<typeof import('../../common/nextmux-media-price-tiers.js')>('common/nextmux-media-price-tiers.ts');
const canvasTiers = loadTsModule<typeof import('../../common/nextmux-canvas-media-tiers.js')>('common/nextmux-canvas-media-tiers.ts');
const estimator = loadTsModule<typeof import('../../common/nextmux-media-cost-estimator.js')>('common/nextmux-media-cost-estimator.ts');
const ledgerModule = loadTsModule<typeof import('../../common/nextmux-media-budget-ledger.js')>('common/nextmux-media-budget-ledger.ts');
const budgetLocale = loadTsModule<typeof import('../../browser/nextmux-media-budget-locale.js')>('browser/nextmux-media-budget-locale.ts');
const { normalizeOfferingMediaTiers } = tiersModule;
const { canvasVideoTier, coveringVideoResolutionClass } = canvasTiers;
const { estimateManagedImageCostMicros, estimateManagedVideoCostMicros, estimateManagedMediaJobMicros, estimateManagedTextCostMicros,
    offeringIsOwnPriced, offeringMultiplierBps, resolveEffectiveOfferingPrice } = estimator;
const { LocalMediaBudgetLedger, computeWalletSpendableMicros } = ledgerModule;

const videoTable = (requestTier: 'output_size' | 'fixed' | undefined, extra: Record<string, unknown> = {}) => normalizeOfferingMediaTiers({
    version: 1, kind: 'video', unit: 'second', currency: 'USD', basis: 'official_multiplier', multiplierBps: 12_500, defaultTierId: '720p',
    ...(requestTier ? { requestTier } : {}), ...extra,
    tiers: [
        { id: '720p', resolution: '720p', audio: true, officialMicros: 400_000, customerMicros: 510_000 },
        { id: '1080p', resolution: '1080p', audio: true, officialMicros: 400_000, customerMicros: 510_000 },
        { id: '4k', resolution: '4k', audio: true, officialMicros: 600_000, customerMicros: 765_000 }
    ]
})!;

test('a video tier is the one the gateway bills: covering class by short edge, named class, next class up, fixed and default', () => {
    // The gateway's VIDEO_CLASS_SHORT_EDGES: 960×540 is 720p (not 480p), 2560×1440 is 2K, a 768-pixel short edge is 768p.
    assert.equal(coveringVideoResolutionClass(960, 540), '720p');
    assert.equal(coveringVideoResolutionClass(854, 480), '480p');
    assert.equal(coveringVideoResolutionClass(1366, 768), '768p');
    assert.equal(coveringVideoResolutionClass(1080, 1920), '1080p');
    assert.equal(coveringVideoResolutionClass(2560, 1440), '2k');
    assert.equal(coveringVideoResolutionClass(7680, 4320), '4k');
    assert.equal(coveringVideoResolutionClass(undefined, 720), undefined);
    const sized = videoTable('output_size');
    assert.equal(canvasVideoTier(sized, { resolution: '1080p' })?.id, '1080p');
    assert.equal(canvasVideoTier(sized, { width: 1920, height: 1080 })?.id, '1080p');
    // An unlisted class bills at the next listed class up; nothing above it is refused.
    assert.equal(canvasVideoTier(sized, { width: 2560, height: 1440 })?.id, '4k');
    assert.equal(canvasVideoTier(sized, { resolution: '768p' })?.id, '1080p');
    assert.equal(canvasVideoTier(videoTable('output_size', { tiers: undefined }), { resolution: '4k' })?.id, '4k');
    // The server did not say the size picks the tier (older payloads): the default tier, whatever was asked.
    assert.equal(canvasVideoTier(videoTable(undefined), { resolution: '4k', width: 3840, height: 2160 })?.id, '720p');
    // A format that sends no size is billed at its one tier.
    assert.equal(canvasVideoTier(videoTable('fixed', { billedTierId: '1080p' }), { resolution: '4k' })?.id, '1080p');
    const capped = normalizeOfferingMediaTiers({ version: 1, kind: 'video', unit: 'second', currency: 'USD', basis: 'official_multiplier', multiplierBps: 10_000,
        defaultTierId: '720p', requestTier: 'output_size', tiers: [{ id: '720p', resolution: '720p', officialMicros: 1, customerMicros: 1 }, { id: '1080p', resolution: '1080p', officialMicros: 2, customerMicros: 2 }] })!;
    assert.equal(canvasVideoTier(capped, { resolution: '4k' }), undefined);
});

test('a tier the platform could not price is not offered: no official × multiplier stand-in without the fee', () => {
    const table = normalizeOfferingMediaTiers({ version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 15_000,
        defaultTierId: '1K', imageInputPerMillionMicros: 3_000_000,
        tiers: [{ id: '1K', resolution: '1K', officialMicros: 39_000, customerMicros: 59_670 }, { id: '4K', resolution: '4K', officialMicros: 240_000, customerMicros: null }] })!;
    assert.deepEqual(table.tiers.map(tier => tier.id), ['1K']);
    assert.equal(table.multiplierBps, 15_000);
    assert.equal(table.imageInputPerMillionMicros, 3_000_000);
    assert.equal(normalizeOfferingMediaTiers({ version: 1, kind: 'image', unit: 'image', tiers: [{ id: 'x', officialMicros: 1 }] }), undefined);
});

const geminiImage = {
    price: { currency: 'USD', imageEachMicros: 59_670, mediaTiers: {
        version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 15_000, defaultTierId: '1K',
        promptInputPerMillionMicros: 750_000, textOutputPerMillionMicros: 4_500_000,
        tokenRates: [{ metric: 'output_token', modality: 'text_thinking', officialMicros: 3_000_000, customerMicros: 4_500_000 }],
        tiers: [{ id: '1K', resolution: '1K', officialMicros: 39_000, customerMicros: 59_670 }, { id: '2K', resolution: '2K', officialMicros: 39_000, customerMicros: 59_670 },
            { id: '4K', resolution: '4K', officialMicros: 240_000, customerMicros: 367_200 }] } },
    multiplierBps: 15_000
} as never;

test('a picture costs its tier plus the token fees beside it; no size means the default tier, an unpriced size no estimate', () => {
    const prompt = 'A lighthouse at dusk';
    const promptFee = Math.ceil(estimator.estimatePromptTokens(prompt) * 750_000 / 1_000_000);
    const thinkingFee = Math.ceil(1024 * 4_500_000 / 1_000_000);
    assert.equal(estimateManagedImageCostMicros(geminiImage, { width: 4096, height: 4096, prompt }), 367_200 + promptFee + thinkingFee);
    assert.equal(estimateManagedImageCostMicros(geminiImage, { prompt }), 59_670 + promptFee + thinkingFee);
    const gridOnly = { price: { currency: 'USD', mediaTiers: { version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 10_000,
        defaultTierId: 'medium_1024x1024', tiers: [{ id: 'medium_1024x1024', quality: 'medium', size: '1024x1024', officialMicros: 42_000, customerMicros: 42_840 },
            { id: 'medium_1536x1024', quality: 'medium', size: '1536x1024', officialMicros: 63_000, customerMicros: 64_260 }] } }, multiplierBps: 10_000 } as never;
    assert.equal(estimateManagedImageCostMicros(gridOnly, { width: 1024, height: 1536, quality: 'medium' }), undefined, 'no 1024×1536 tier: refused upstream');
    assert.equal(estimateManagedImageCostMicros(gridOnly, { width: 1536, height: 1024, quality: 'medium', count: 2 }), 64_260 * 2);
    // A token-priced model: reference pictures on the prompt rate (1600 each), its picture as 1290 output tokens.
    const tokenPriced = { price: { currency: 'USD', inputPerMillionMicros: 300_000, imageOutputPerMillionMicros: 30_000_000 }, multiplierBps: 10_000 } as never;
    assert.equal(estimateManagedImageCostMicros(tokenPriced, { prompt: 'x', referenceImageCount: 2 }),
        Math.ceil(64 * 300_000 / 1_000_000) + Math.ceil(3200 * 300_000 / 1_000_000) + Math.ceil(1290 * 30_000_000 / 1_000_000));
    assert.equal(estimateManagedImageCostMicros({ price: { currency: 'USD' } } as never, {}), undefined);
});

test('price modes: a merchant price is never derived from the official sheet; the quoted key price multiplier comes first', () => {
    const multiplier = { price: { currency: 'USD', videoSecondMicros: 100_000 }, officialPrice: { videoInputImageEachMicros: 20_000, requestEachMicros: 50_000 },
        multiplierBps: 15_000, keyPrice: { selectedMultiplierBps: 20_000 } } as never;
    assert.equal(offeringIsOwnPriced(multiplier), false);
    assert.equal(offeringMultiplierBps(multiplier), 20_000);
    assert.deepEqual(resolveEffectiveOfferingPrice(multiplier), { currency: 'USD', videoSecondMicros: 100_000, videoInputImageEachMicros: 40_000, requestEachMicros: 100_000 });
    const direct = { price: { currency: 'USD', mode: 'direct', videoSecondMicros: 90_000 }, officialPrice: { videoInputImageEachMicros: 20_000 }, multiplierBps: 15_000 } as never;
    const ownPriced = { price: { currency: 'USD', videoSecondMicros: 90_000 }, officialPrice: { videoInputImageEachMicros: 20_000 }, multiplierBps: null } as never;
    for (const offering of [direct, ownPriced]) {
        assert.equal(offeringIsOwnPriced(offering), true);
        assert.equal(offeringMultiplierBps(offering), null);
        assert.deepEqual(resolveEffectiveOfferingPrice(offering), { currency: 'USD', videoSecondMicros: 90_000 });
    }
    // The price card re-exports the same two functions (one definition).
    const card = readFileSync(resolve(srcRoot, 'browser/nextmux-offering-price.tsx'), 'utf8');
    assert.match(card, /export \{ offeringIsOwnPriced, offeringMultiplierBps \};/);
    assert.doesNotMatch(card, /export function offeringIsOwnPriced/);
});

test('a clip costs seconds × its tier (or flat) price, or its per-request price, plus each input picture', () => {
    const tiered = { price: { currency: 'USD', videoInputImageEachMicros: 10_000, mediaTiers: { version: 1, kind: 'video', unit: 'second', currency: 'USD',
        basis: 'official_multiplier', multiplierBps: 12_500, defaultTierId: '720p', requestTier: 'output_size',
        tiers: [{ id: '720p', resolution: '720p', officialMicros: 400_000, customerMicros: 510_000 }, { id: '4k', resolution: '4k', officialMicros: 600_000, customerMicros: 765_000 }] } },
    multiplierBps: 12_500 } as never;
    assert.equal(estimateManagedVideoCostMicros(tiered, { durationSeconds: 8, width: 3840, height: 2160, inputImageCount: 2 }), 8 * 765_000 + 2 * 10_000);
    assert.equal(estimateManagedVideoCostMicros(tiered, { durationSeconds: 8, width: 1280, height: 720 }), 8 * 510_000);
    assert.equal(estimateManagedVideoCostMicros({ price: { currency: 'USD', requestEachMicros: 250_000, videoInputImageEachMicros: 5_000 } } as never, { inputImageCount: 1 }), 255_000);
    assert.equal(estimateManagedVideoCostMicros({ price: { currency: 'USD', videoSecondMicros: 100_000 } } as never, {}), undefined, 'a per-second price needs seconds');
    assert.equal(estimateManagedMediaJobMicros({ price: { currency: 'USD', videoSecondMicros: 100_000 } } as never, 'video',
        { connectionId: 'managed:x', model: 'm', prompt: 'p', durationSeconds: 5, firstFrameUri: 'a', referenceAssetUris: ['b'] } as never), 500_000);
    assert.equal(estimateManagedTextCostMicros({ price: { currency: 'USD', inputPerMillionMicros: 1_000_000, outputPerMillionMicros: 2_000_000 } } as never, { prompt: 'hi' }),
        Math.ceil(64 * 1) + Math.ceil(512 * 2));
});

test('spendable balance: nothing while debt is owed or the net balance is not positive, else available capped by net', () => {
    assert.equal(computeWalletSpendableMicros(undefined), 0);
    assert.equal(computeWalletSpendableMicros({ availableMicros: 5_000_000, usageDebtMicros: 1 }), 0);
    assert.equal(computeWalletSpendableMicros({ availableMicros: 5_000_000, netBalanceMicros: 0 }), 0);
    assert.equal(computeWalletSpendableMicros({ availableMicros: 5_000_000, netBalanceMicros: 3_000_000 }), 3_000_000);
    assert.equal(computeWalletSpendableMicros({ availableMicros: 5_000_000, reservedMicros: 0, usageInFlightMicros: 6_000_000 }), 0);
    assert.equal(computeWalletSpendableMicros({ availableMicros: 2_000_000 }), 2_000_000);
});

test('the ledger stops a second click on the same balance, and moves money to jobs without counting it twice', () => {
    const ledger = new LocalMediaBudgetLedger();
    // $0.12 spendable, two $0.10 clicks a millisecond apart: the second is refused at once.
    assert.equal(ledger.tryReserve('click-1', 100_000, 120_000, 1_000).ok, true);
    const second = ledger.tryReserve('click-2', 100_000, 120_000, 1_001);
    assert.equal(second.ok, false);
    assert.equal(second.availableBeforeMicros, 20_000);
    assert.equal(second.otherReservedMicros, 100_000);
    // A click that became a job: the job keeps its share, the opening frame it drew on the way was spent.
    ledger.move('click-1', 'media-job:1', 70_000, { restSpentAt: 1_100, now: 1_100 });
    assert.equal(ledger.get('media-job:1', 1_100)?.amountMicros, 70_000);
    assert.equal(ledger.get('click-1', 1_100)?.heldSince, 1_100);
    assert.equal(ledger.totalReservedMicros(1_100), 100_000, 'moved, not added');
    // A wallet snapshot taken before the frame was charged still needs the reservation; one after it does not.
    ledger.reconcileWalletBalance(120_000, 1_050, 1_200);
    assert.ok(ledger.get('click-1', 1_200));
    ledger.reconcileWalletBalance(90_000, 1_150, 1_200);
    assert.equal(ledger.get('click-1', 1_200), undefined);
    assert.equal(ledger.get('media-job:1', 1_200)?.amountMicros, 70_000, 'the queued job is still the desktop\'s to count');
    // Never more than was set aside moves, and moving to itself does nothing.
    ledger.move('media-job:1', 'media-job:1', 1, { now: 1_200 });
    ledger.move('media-job:1', 'step', Number.POSITIVE_INFINITY, { now: 1_200 });
    assert.equal(ledger.get('step', 1_200)?.amountMicros, 70_000);
    assert.equal(ledger.get('media-job:1', 1_200), undefined);
});

test('jobs the gateway holds stop counting once a later wallet snapshot shows the hold, so the queue is not refused twice', () => {
    // $1.00, three queued $0.50/$0.50/$0.40 jobs: the third waits behind the first two.
    const ledger = new LocalMediaBudgetLedger();
    assert.equal(ledger.tryReserve('job-a', 500_000, 1_000_000, 0).ok, true);
    assert.equal(ledger.tryReserve('job-b', 400_000, 1_000_000, 0).ok, true);
    // Job a starts: the gateway holds $0.50, the next snapshot shows $0.50 available.
    ledger.markServerHeld('job-a', 100);
    assert.equal(ledger.isServerHeld('job-a'), true);
    assert.equal(ledger.reconcileWalletBalance(500_000, 200, 250), 100_000, 'only job b is still counted');
    assert.equal(ledger.tryReserve('job-c', 100_000, 500_000, 300).ok, true);
    // A held job that ends keeps its reservation until a snapshot shows the charge; one never sent is freed at once.
    ledger.markServerHeld('job-b', 400);
    assert.equal(ledger.releaseIfPending('job-b'), false);
    assert.equal(ledger.releaseIfPending('job-c'), true);
    assert.equal(ledger.reconcileWalletBalance(100_000, 399, 500), 0, 'snapshot fetched before job b reached the gateway');
    assert.equal(ledger.reconcileWalletBalance(100_000, 450, 500), 100_000);
    // A lost release cannot block spending for good.
    const short = new LocalMediaBudgetLedger(1_000);
    short.tryReserve('leak', 900_000, 1_000_000, 0);
    assert.equal(short.availableMicros(1_000_000, 999), 100_000);
    assert.equal(short.availableMicros(1_000_000, 1_000), 1_000_000);
});

test('the shortfall is said in NextMux terms in every desktop language, never as a provider quota', () => {
    for (const locale of budgetLocale.mediaBudgetLocales) {
        const text = budgetLocale.mediaBudgetText(locale, 'shortfallHeld', { needed: 'N1', available: 'A1', held: 'H1' });
        assert.ok(text.includes('N1') && text.includes('A1') && text.includes('H1'), locale);
        for (const key of ['shortfall', 'shortfallPlatform', 'topUp', 'pendingShots', 'setPlates', 'openingFrames', 'clips', 'startFrame', 'video', 'translation', 'total', 'available', 'short', 'note'] as const) {
            assert.notEqual(budgetLocale.mediaBudgetText(locale, key, { n: 2, amount: 'X' }), '', `${locale} ${key}`);
        }
    }
    assert.equal(budgetLocale.mediaBudgetLocales.length, 12);
});

// The desk and canvas flows, as the widget runs them (methods extracted from the real source).
const widgetSource = readFileSync(resolve(srcRoot, 'browser/nextmux-desktop-widget.tsx'), 'utf8');
const widgetFile = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = widgetFile.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget') as ts.ClassDeclaration;
const methods = ['tryAcquireLocalMediaBudget', 'checkLocalMediaBudget', 'mediaBudgetShortfall', 'isMediaBudgetFailure', 'mediaFailureText', 'releaseLocalMediaBudget',
    'syncLocalMediaBudgetJobs', 'managedWalletSpendableMicros', 'reconcileMediaBudget', 'deskShotBudgetKey', 'reserveDeskShotBudget', 'setDeskBalanceError',
    'releaseDeskShotBudgets', 'reserveDeskEnqueueBudget', 'rebindDeskEnqueueBudget', 'rebindCanvasNodeBudget', 'settleCanvasClickBudget', 'releaseDeskPortraitBudget'];
const methodSource = methods.map(name => {
    const member = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === name);
    assert.ok(member, name);
    return member!.getText(widgetFile);
}).join('\n');
const bindings = {
    LocalMediaBudgetLedger, computeWalletSpendableMicros, estimateManagedMediaJobMicros, mediaBudgetText: budgetLocale.mediaBudgetText,
    formatPriceMicros: (_locale: string, micros: number) => `US$${(micros / 1_000_000).toFixed(2)}`, modelFailureText: () => 'model failure'
};
const Harness = new Function(...Object.keys(bindings), ts.transpile(`class Harness { localMediaBudgetLedger = new LocalMediaBudgetLedger(); canvasClickMediaShares = new Map();
    managedLiveMediaJobs = new Set(); ${methodSource} }; return Harness;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(...Object.values(bindings));

function widget(availableMicros: number) {
    const refreshes: number[] = [];
    const instance = Object.assign(new Harness(), {
        desktopLocale: 'en', platformSession: { linked: true, wallets: [{ currency: 'USD', availableMicros }] }, accountOverview: { wallets: [] },
        persistComicDesk: () => {}, update: () => {}, scheduleWalletRefresh: () => refreshes.push(1),
        // A shot here costs: plate $0.10, frame $0.10, clip $0.50 (only the steps it still needs).
        deskShotCost: (_project: unknown, _scene: unknown, _shot: unknown, _image: unknown, _video: unknown, steps: { plate: boolean; frame: boolean }) => {
            const plate = steps.plate ? 100_000 : 0, frame = steps.frame ? 100_000 : 0;
            return { offering: { price: { currency: 'USD' } }, plate, frame, video: 500_000, seconds: 5, total: plate + frame + 500_000 };
        }
    });
    return { instance, refreshes, ledger: instance.localMediaBudgetLedger as InstanceType<typeof LocalMediaBudgetLedger> };
}
const managedImage = { kind: 'managed', offering: { price: { currency: 'USD', imageEachMicros: 100_000 } } };
const managedVideo = { kind: 'managed', offering: { price: { currency: 'USD', videoSecondMicros: 100_000 } } };
const plateInput = { connectionId: 'managed:fixed:x', model: 'img', prompt: 'plate', width: 1280, height: 720 };
const project = { id: 'p1' }, scene = { id: 's1' }, desk = () => ({ paused: false, error: undefined as string | undefined, balanceError: undefined as string | undefined });
const allSteps = { plate: true, frame: true, frameReferences: 2, videoReferences: 1 };

test('a shot sets aside everything it still needs before its first step, so a later shot cannot strand it half-filmed', () => {
    // Enough for one whole shot ($0.70) and a bit: the second shot waits, filming pauses before any of it is spent.
    const { instance, ledger } = widget(1_000_000);
    const firstDesk = desk();
    assert.equal(instance.reserveDeskShotBudget(firstDesk, project, scene, { id: 'shot-1' }, managedImage, managedVideo, allSteps), true);
    const plateHold = instance.reserveDeskEnqueueBudget(managedImage, 'image', plateInput, 'p1', 'shot-1');
    assert.equal(ledger.get(plateHold)?.amountMicros, 100_000, 'the plate takes its share of the shot');
    assert.equal(ledger.get('desk-shot:p1:shot-1')?.amountMicros, 600_000);
    assert.equal(ledger.totalReservedMicros(), 700_000, 'moved, not counted twice');
    instance.rebindDeskEnqueueBudget(plateHold, { id: 'job-plate' });
    assert.equal(ledger.get('media-job:job-plate')?.amountMicros, 100_000);
    // While shot 1 is being filmed, shot 2 does not start: the note shows, filming goes on so shot 1 can finish.
    const secondDesk = desk();
    assert.equal(instance.reserveDeskShotBudget(secondDesk, project, scene, { id: 'shot-2' }, managedImage, managedVideo, allSteps, true), false);
    assert.equal(secondDesk.paused, false);
    assert.equal(secondDesk.error, secondDesk.balanceError);
    assert.match(secondDesk.error!, /needs about US\$0\.70.*US\$0\.30 is left after US\$0\.70 set aside/);
    assert.equal(ledger.get('desk-shot:p1:shot-2'), undefined, 'nothing of the refused shot is set aside');
    // With nothing else in progress, the same refusal pauses filming.
    assert.equal(instance.reserveDeskShotBudget(secondDesk, project, scene, { id: 'shot-2' }, managedImage, managedVideo, allSteps, false), false);
    assert.equal(secondDesk.paused, true);
    // Once the balance covers it, the shot is set aside and the stale balance note goes.
    instance.platformSession.wallets[0].availableMicros = 2_000_000;
    assert.equal(instance.reserveDeskShotBudget(secondDesk, project, scene, { id: 'shot-2' }, managedImage, managedVideo, allSteps, true), true);
    assert.equal(secondDesk.error, undefined);
    assert.equal(ledger.get('desk-shot:p1:shot-2')?.amountMicros, 700_000);
    // Filming finished: what shots still hold is free again.
    instance.releaseDeskShotBudgets('p1');
    assert.equal(ledger.get('desk-shot:p1:shot-1'), undefined);
    assert.equal(ledger.get('desk-shot:p1:shot-2'), undefined);
    assert.ok(ledger.get('media-job:job-plate'), 'queued jobs keep theirs');
});

test('the queue follows jobs: a started job waits for the next snapshot, one that never started is freed, a settled one refreshes the wallet', () => {
    const { instance, ledger, refreshes } = widget(1_000_000);
    for (const id of ['run', 'wait', 'gone', 'cancel']) ledger.tryReserve(`media-job:${id}`, 100_000, 1_000_000);
    const managed = { connectionId: 'managed:fixed:x' };
    instance.syncLocalMediaBudgetJobs([
        { id: 'run', status: 'running', startedAt: '2026-10-24T00:00:00Z', input: managed },
        { id: 'wait', status: 'queued', input: managed },
        { id: 'cancel', status: 'cancelled', input: managed }
    ]);
    assert.equal(ledger.isServerHeld('media-job:run'), true);
    assert.equal(ledger.isServerHeld('media-job:wait'), false);
    assert.equal(ledger.get('media-job:gone'), undefined);
    assert.equal(ledger.get('media-job:cancel'), undefined);
    assert.equal(refreshes.length, 0);
    instance.syncLocalMediaBudgetJobs([{ id: 'run', status: 'succeeded', startedAt: '2026-10-24T00:00:00Z', input: managed }, { id: 'wait', status: 'queued', input: managed }]);
    assert.equal(refreshes.length, 1, 'a paid job settled');
    instance.platformSession.wallets[0].availableMicros = 900_000;
    instance.reconcileMediaBudget(Date.now() + 1);
    assert.equal(ledger.get('media-job:run'), undefined);
    assert.ok(ledger.get('media-job:wait'));
});

test('a canvas click hands its media share to the job and keeps what it spent on the way until the wallet shows it', () => {
    const { instance, ledger } = widget(1_000_000);
    ledger.tryReserve('canvas-click', 650_000, 1_000_000);
    instance.canvasClickMediaShares.set('canvas-click', 500_000);
    instance.rebindCanvasNodeBudget('canvas-click', { job: { id: 'video-1' } });
    assert.equal(ledger.get('media-job:video-1')?.amountMicros, 500_000);
    assert.equal(ledger.get('canvas-click')?.amountMicros, 150_000);
    assert.equal(ledger.isServerHeld('canvas-click'), true);
    // A click that stopped before drawing anything spent nothing; a balance refusal reads in NextMux's words.
    ledger.tryReserve('canvas-stop', 100_000, 1_000_000);
    instance.settleCanvasClickBudget('canvas-stop', false);
    assert.equal(ledger.get('canvas-stop'), undefined);
    const refusal = instance.checkLocalMediaBudget({ price: { currency: 'USD' } }, 900_000);
    assert.equal(refusal.code, 'INSUFFICIENT_BALANCE');
    assert.match(instance.mediaFailureText(refusal), /needs about US\$0\.90/);
    assert.equal(instance.mediaFailureText(Object.assign(new Error('x'), { code: 'INSUFFICIENT_BALANCE' })), budgetLocale.mediaBudgetText('en', 'shortfallPlatform'));
    assert.equal(instance.mediaFailureText(new Error('other')), 'model failure');
    assert.equal(ledger.get('media-budget-check'), undefined, 'a check sets nothing aside');
});

test('a drawn portrait waits for the wallet, a failed one is freed; signed out nothing is checked locally', () => {
    const { instance, ledger, refreshes } = widget(1_000_000);
    ledger.tryReserve('portrait-ok', 50_000, 1_000_000);
    ledger.tryReserve('portrait-failed', 50_000, 1_000_000);
    instance.releaseDeskPortraitBudget('portrait-ok', true);
    instance.releaseDeskPortraitBudget('portrait-failed', false);
    assert.equal(ledger.isServerHeld('portrait-ok'), true);
    assert.equal(ledger.get('portrait-failed'), undefined);
    assert.equal(refreshes.length, 1);
    instance.platformSession = { linked: false, wallets: [] };
    assert.deepEqual(instance.tryAcquireLocalMediaBudget('anything', undefined, 10_000_000), { ok: true });
});

test('the shoot summary counts a set plate once per scene, a frame for each shot with cast, clips with their seconds, and own-API steps by count', () => {
    const summaryMethods = ['deskPendingShootCost', 'deskShotCost', 'managedWalletSpendableMicros'].map(name =>
        widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === name)!.getText(widgetFile)).join('\n');
    const summaryBindings = { ...bindings, estimateManagedImageCostMicros, estimateManagedVideoCostMicros, comicSetPlatePrompt: () => 'the set' };
    const Summary = new Function(...Object.keys(summaryBindings), ts.transpile(`class Summary { localMediaBudgetLedger = new LocalMediaBudgetLedger(); ${summaryMethods} }; return Summary;`,
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(...Object.values(summaryBindings));
    const shot = (id: string, frames: number, cast: number) => ({ id, durationFrames: frames, cast, visualPrompt: 'v' });
    const project = { id: 'p1', frameRate: 24, canvas: { width: 1280, height: 720, aspectRatio: '16:9' }, assets: [], styleBible: '',
        scenes: [{ id: 'a', episodeNumber: 1, shots: [shot('a1', 120, 1), shot('a2', 48, 0)] }, { id: 'b', episodeNumber: 1, shots: [shot('b1', 72, 2)] }, { id: 'draft', shots: [shot('x', 24, 0)] }] };
    const routes = { image: { kind: 'managed', offering: { price: { currency: 'USD', imageEachMicros: 40_000 } } }, video: { kind: 'managed', offering: { price: { currency: 'USD', videoSecondMicros: 100_000 } } } };
    const make = (video: unknown) => Object.assign(new Summary(), { desktopLocale: 'en', comicDesk: { redo: new Set() }, comicProject: () => project,
        comicStepMediaRoute: (kind: 'image' | 'video') => kind === 'image' ? routes.image : video, comicShotCharacterReferences: (item: { cast: number }) => Array.from({ length: item.cast }, () => 'ref'),
        platformSession: { linked: true, wallets: [{ currency: 'USD', availableMicros: 1_000_000 }] }, accountOverview: { wallets: [] } });
    const cost = make(routes.video).deskPendingShootCost();
    assert.deepEqual(cost.rows, [
        { label: 'Set plates', detail: '× 2', amount: 'US$0.08' },
        { label: 'Opening frames', detail: '× 2', amount: 'US$0.08' },
        { label: 'Clips', detail: '× 3 · 10 s', amount: 'US$1.00' }
    ]);
    assert.deepEqual(cost.total, { label: 'Estimated total · 3 shots to film', amount: 'US$1.16' });
    assert.deepEqual(cost.balance, { label: 'Available balance', amount: 'US$1.00' });
    assert.equal(cost.short, 'US$0.16 short');
    // Clips on the user's own API: counted, billed there, left out of the total.
    const own = make({ kind: 'official' }).deskPendingShootCost();
    assert.deepEqual(own.rows.at(-1), { label: 'Clips', detail: '× 3 · 10 s', amount: 'Billed by your own API' });
    assert.equal(own.total.amount, 'US$0.16');
    assert.equal(own.short, undefined);
});
