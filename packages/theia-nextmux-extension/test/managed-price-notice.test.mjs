import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { ManagedPriceNoticeStore, MANAGED_PRICE_NOTICES_KEY, managedPriceNotificationId,
    normalizeManagedPriceUpdate, normalizeOwnedManagedPriceNotice, ownedManagedPriceEvent,
    managedPriceRateSignature, managedPriceNoticeItem } from '../lib/browser/nextmux-managed-price-notice.js';
import { managedPriceText, managedPriceSummary } from '../lib/browser/nextmux-managed-price-text.js';
import { appendAgentActivityEvents } from '../lib/browser/nextmux-agent-activity.js';
import { projectConversationStream } from '../lib/browser/nextmux-conversation-stream-model.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';
import { createConversationAgentRun } from '../lib/browser/nextmux-conversation-agent-run.js';
import { mergeAgentEventPollSnapshot } from '../lib/browser/nextmux-agent-event-poll.js';
import { AgentQuestionController } from '../lib/browser/nextmux-agent-question.js';

const require = createRequire(import.meta.url);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const quote = c => `kq1_${c.repeat(64)}`;
const update = (n = 1, amount = 100, extra = {}) => ({
    id: `${uuid(n)}:${quote('a')}`, requestId: uuid(n), at: n * 1000, effectiveQuoteId: quote('a'),
    offeringId: uuid(99), model: 'QA model', currency: 'USD', usageMultiplierBps: amount * 100, previousUsageMultiplierBps: 5000,
    rates: [{ metric: 'input_token', unitSize: 1000000, customerAmountMicros: amount },
        { metric: 'output_token', unitSize: 1000000, customerAmountMicros: amount * 2 }], ...extra
});
const event = (sessionId = 'A', runId = 'run-A', price = update()) => ({
    type: 'model_price_changed', runId, sessionId, pricingUpdate: price, at: new Date(price.at).toISOString()
});
const owned = (owner = 'A', price = update(), run = 'run-A') => ({ sessionId: owner, runId: run, pricingUpdate: price });

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['routePriceNotice', 'loadManagedPriceNotices', 'persistManagedPriceNotices', 'dismissRoutePriceNotice',
    'notificationPriceText', 'recordManagedPriceEvents', 'recordManagedChildPriceEvents', 'restoreManagedPriceHistory',
    'loadNotifications', 'persistNotifications', 'markNotificationsRead', 'clearNotifications',
    'pollAgentRun', 'pollScheduledAgentRun', 'pollAgentChildRun', 'mergeAgentChildRunSnapshot'];
const methods = names.map(name => {
    const node = widget.members.find(node => node.name?.getText(file) === name);
    assert.ok(node, name); return node.getText(file);
});
test('production composer notices keep single-line copy and expose complete hover text', () => {
    const notices = [];
    const visit = node => {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'div'
            && node.openingElement.attributes.properties.some(attribute => attribute.name?.getText(file) === 'className'
                && attribute.initializer?.text?.includes('nmx-route-price-notice'))
            && node.openingElement.attributes.properties.some(attribute => ['data-price-event-id', 'data-council-below-notice'].includes(attribute.name?.getText(file)))) notices.push(node);
        ts.forEachChild(node, visit);
    };
    visit(widget);
    const dependencies = { React: require('react'), managedPriceText };
    const harness = { desktopLocale: 'zh-CN', councilBelowNotice: '该文件不存在', update() {}, dismissRoutePriceNotice() {} };
    const notice = managedPriceNoticeItem('zh-CN', owned());
    for (const node of notices) {
        const render = new Function(...Object.keys(dependencies), ts.transpile(`return function(routePriceNotice) { return ${node.getText(file)}; };`, {
            target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React
        }))(...Object.values(dependencies));
        const element = render.call(harness, notice);
        const isCouncil = element.props['data-council-below-notice'] === 'true';
        assert.match(element.props.className, /nmx-council-below-notice/);
        assert.equal(element.props['data-help'], isCouncil ? '该文件不存在' : '倍率已从 ×0.5 调整为 ×1');
        assert.equal(element.props.title, element.props['data-help']);
        const span = dependencies.React.Children.toArray(element.props.children).find(child => child.type === 'span');
        assert.equal(span.props.children, isCouncil ? '该文件不存在' : '该模型的倍率已被商家调整，请知悉！');
        if (!isCouncil) {
            const noDetail = render.call(harness, { ...notice, detail: undefined });
            assert.equal(noDetail.props['data-help'], notice.message);
        }
    }
    assert.equal(notices.length, 2);
});

function fixture(storage = new Map()) {
    const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
    const dependencies = { MANAGED_PRICE_NOTICES_KEY, managedPriceNotificationId, normalizeOwnedManagedPriceNotice,
        ownedManagedPriceEvent, managedPriceNoticeItem, managedPriceText, managedPriceSummary, mergeAgentEventPollSnapshot,
        AgentQuestionController, isInsufficientBalanceFailure: () => false,
        window: { localStorage, setTimeout }, crypto: require('node:crypto').webcrypto };
    const code = ts.transpile(`class Harness { ${methods.join('\n')} };`, { target: ts.ScriptTarget.ES2022 });
    const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
    const state = new Harness();
    Object.assign(state, { activeCodingSessionId: 'B', desktopLocale: 'en', managedPriceNotices: new ManagedPriceNoticeStore(),
        notifications: [], composerNotifications: [], activeModelRoute: () => ({ kind: 'managed_gateway', offering: { id: update().offeringId } }), removedCodingSessionIds: new Set(), codingSessions: [{ id: 'A', title: 'Alpha' }, { id: 'B', title: 'Beta' }],
        scheduledAgentRuns: new Map(), agentChildContinuationStates: new Map(), updated: 0,
        update() { this.updated++; }, updateCodingTurn() {}, recordSteeringEvents() {}, notifyThreadContentChanged() {},
        childResultFromAgentRun: result => result, platformService: {} });
    return { state, storage, localStorage };
}

test('receipt normalization strips arbitrary data and checks owner/run, request identity and rates', () => {
    const value = { ...update(), secret: 'MUST_NOT_PERSIST', prompt: 'MUST_NOT_PERSIST', rates: [{ ...update().rates[0], secret: 'NO' }] };
    assert.doesNotMatch(JSON.stringify(normalizeManagedPriceUpdate(value)), /secret|prompt|PERSIST/);
    assert.equal(ownedManagedPriceEvent(event(), 'B', 'run-A'), undefined);
    assert.equal(ownedManagedPriceEvent(event(), 'A', 'wrong-run'), undefined);
    assert.deepEqual(ownedManagedPriceEvent({ ...event(), sessionId: undefined }, 'A', 'run-A'), owned());
    for (const bad of [{ id: 'wrong' }, { at: 0 }, { requestId: 'not-a-request' }, { rates: [] },
        { rates: [update().rates[0], update().rates[0]] }, { currency: 'secret-USD' }]) {
        assert.equal(normalizeManagedPriceUpdate({ ...update(), ...bad }), undefined);
    }
    assert.equal(normalizeManagedPriceUpdate(update()).previousUsageMultiplierBps, 5000);
    for (const invalid of ['10000', -1, NaN, Infinity, 1.5, null]) {
        assert.equal(normalizeManagedPriceUpdate(update(1, 100, { previousUsageMultiplierBps: invalid })).previousUsageMultiplierBps, undefined);
    }
});

test('initial use at any multiplier only records a baseline; quote rotation and unchanged multipliers do not announce a change', () => {
    const store = new ManagedPriceNoticeStore();
    const first = update(1, 200, { previousUsageMultiplierBps: undefined, previousQuoteId: quote('b') });
    assert.equal(store.observe(owned('A', first)).notice, undefined);
    assert.equal(store.current('A'), undefined);
    const snapshot = JSON.parse(JSON.stringify(store.serialize()));
    assert.equal(snapshot[0].usageMultiplierBps, 20000);
    const restored = new ManagedPriceNoticeStore(); restored.restore(snapshot);
    assert.equal(restored.observe(owned('A', update(2, 250, { usageMultiplierBps: 20000, previousUsageMultiplierBps: undefined }))).notice, undefined);
    const changed = restored.observe(owned('A', update(3, 250, { usageMultiplierBps: 30000, previousUsageMultiplierBps: undefined }))).notice;
    assert.ok(changed, 'a multiplier change notifies even if customer rate signature is unchanged');
    assert.equal(changed.pricingUpdate.previousUsageMultiplierBps, 20000);
    assert.equal(managedPriceNoticeItem('zh-CN', changed).detail, '倍率已从 ×2 调整为 ×3');
    assert.equal(restored.observe(owned('B', update(4, 400, { previousUsageMultiplierBps: undefined }))).notice, undefined);
    assert.equal(restored.observe(owned('A', update(5, 400, { offeringId: uuid(98), previousUsageMultiplierBps: undefined }))).notice, undefined);
});

test('an explicit server previous multiplier proves an adjustment, including a zero baseline, and is not replayed', () => {
    const store = new ManagedPriceNoticeStore();
    const first = update(1, 200, { previousUsageMultiplierBps: 0 });
    const notice = store.observe(owned('A', first)).notice;
    assert.ok(notice);
    assert.equal(managedPriceNoticeItem('zh-CN', notice).detail, '倍率已从 ×0 调整为 ×2');
    store.dismiss('A', first.id);
    assert.equal(store.observe(owned('A', update(2, 200, { previousUsageMultiplierBps: 0 }))).notice, undefined);
    assert.equal(store.observe(owned('B', update(3, 200, { previousUsageMultiplierBps: 20000 }))).notice, undefined);
});

test('legacy persisted initial-price banners become baselines without reviving the old false notification', () => {
    const first = owned('A', update(1, 200, { previousUsageMultiplierBps: undefined }));
    const store = new ManagedPriceNoticeStore();
    store.restore([{ sessionId: 'A', offeringId: first.pricingUpdate.offeringId,
        signature: managedPriceRateSignature(first.pricingUpdate), observedAt: first.pricingUpdate.at,
        lastReceiptId: first.pricingUpdate.id, notice: first }]);
    assert.equal(store.current('A'), undefined);
    assert.equal(store.observe(owned('A', update(2, 200, { previousUsageMultiplierBps: undefined }))).notice, undefined);
    assert.ok(store.observe(owned('A', update(3, 300, { previousUsageMultiplierBps: undefined }))).notice);
});

test('effective fingerprint compares currency and all actual dimensions, ignoring quote/audit/multiplier changes', () => {
    const price = update();
    assert.equal(managedPriceRateSignature(price), managedPriceRateSignature({ ...price, usageMultiplierBps: 25000,
        effectiveQuoteId: quote('b'), rates: [...price.rates].reverse() }));
    for (const difference of [{ currency: 'EUR' }, { rates: [{ ...price.rates[0], unitSize: 1 }, price.rates[1]] },
        { rates: [price.rates[0], { ...price.rates[1], customerAmountMicros: 201 }] }]) {
        assert.notEqual(managedPriceRateSignature(price), managedPriceRateSignature({ ...price, ...difference }));
    }
});

test('same receipt and same effective rates stay dismissed across new runs and persistence; a return to an earlier price notifies', () => {
    const store = new ManagedPriceNoticeStore();
    assert.ok(store.observe(owned()).notice);
    assert.equal(store.dismiss('A', update().id), true);
    assert.equal(store.observe(owned()).notice, undefined);
    assert.equal(store.observe(owned('A', update(2), 'new-run')).notice, undefined);
    const restored = new ManagedPriceNoticeStore(); restored.restore(JSON.parse(JSON.stringify(store.serialize())));
    assert.equal(restored.current('A'), undefined);
    assert.equal(restored.observe(owned('A', update(3), 'third-run')).notice, undefined);
    assert.ok(restored.observe(owned('A', update(4, 200))).notice);
    assert.ok(restored.observe(owned('A', update(5, 100))).notice, 'price 100→200→100 is a real new change');
    assert.equal(restored.observe(owned('A', update(4, 200))).changed, false, 'late old snapshot must not replace new effective rate');
});

test('late close only dismisses its exact owner and price event', () => {
    const store = new ManagedPriceNoticeStore();
    store.observe(owned()); store.observe(owned('B', update(), 'run-B'));
    store.observe(owned('A', update(2, 200)));
    assert.equal(store.dismiss('A', update().id), false);
    assert.equal(store.current('A').pricingUpdate.id, update(2, 200).id);
    assert.equal(store.current('B').sessionId, 'B');
    assert.equal(store.dismiss('A', update(2).id), true);
    assert.equal(store.current('A'), undefined); assert.ok(store.current('B'));
});

test('production notification ingestion persists distinct owners and preserves read/dismiss on replay or restart', () => {
    const { state, storage } = fixture();
    state.recordManagedPriceEvents([event()], 'A', 'run-A');
    assert.equal(state.routePriceNotice, undefined, 'A background event cannot show under B');
    state.recordManagedPriceEvents([event('B', 'run-B')], 'B', 'run-B');
    assert.equal(state.notifications.length, 2, 'same text in two sessions remains two records');
    state.markNotificationsRead(); state.dismissRoutePriceNotice('A', update().id);
    state.recordManagedPriceEvents([event('A', 'later-run', update(2))], 'A', 'later-run');
    assert.equal(state.notifications.length, 2); assert.ok(state.notifications.every(item => item.read));
    const restored = fixture(storage).state; restored.loadNotifications(); restored.loadManagedPriceNotices();
    restored.activeCodingSessionId = 'A'; assert.equal(restored.routePriceNotice, undefined);
    restored.recordManagedPriceEvents([event()], 'A', 'run-A');
    assert.equal(restored.notifications.length, 2); assert.ok(restored.notifications.every(item => item.read));
    const english = restored.notificationPriceText(restored.notifications[0]).body;
    restored.desktopLocale = 'zh-CN'; assert.notEqual(restored.notificationPriceText(restored.notifications[0]).body, english);
    restored.clearNotifications(); restored.recordManagedPriceEvents([event()], 'A', 'run-A');
    assert.equal(restored.notifications.length, 0, 'clearing center does not replay a known price receipt');
});

test('notification storage and render failures cannot reject the poll or request lifecycle', () => {
    const { state, localStorage } = fixture(); localStorage.setItem = () => { throw new Error('quota'); };
    assert.doesNotThrow(() => state.recordManagedPriceEvents([event()], 'A', 'run-A'));
    state.notificationPriceText = () => { throw new Error('display'); };
    assert.doesNotThrow(() => state.recordManagedPriceEvents([event('A', 'run-A', update(2, 200))], 'A', 'run-A'));
    assert.equal(state.notifications.length, 1);
});

const snapshot = (runId, events, extra = {}) => ({ runId, status: 'completed', events, children: [], firstEventIndex: 0,
    nextEventIndex: events.length, updatedAt: 1000, result: { runId, events }, ...extra });
test('ordinary production poll associates root and child receipts with A while B stays active', async () => {
    const { state } = fixture(); const run = createConversationAgentRun('A');
    run.activeAgentRunId = 'run-A'; run.agentPollGeneration = 1;
    const child = { childRunId: 'child-A', rootRunId: 'run-A', taskContext: { conversationId: 'A' },
        events: [event('A', 'child-A', update(2, 200))] };
    state.platformService.getAgentRunSnapshot = async () => snapshot('run-A', [event()], { children: [child] });
    await state.pollAgentRun('run-A', 1, run);
    assert.equal(state.activeCodingSessionId, 'B'); assert.equal(state.routePriceNotice, undefined);
    assert.deepEqual(state.notifications.map(item => item.managedPrice.runId), ['child-A', 'run-A']);
    assert.equal(state.notifications.every(item => item.managedPrice.sessionId === 'A'), true);
});

test('scheduled production poll rejects foreign event ownership and records original session', async () => {
    const { state } = fixture(); state.platformService.getAgentRunSnapshot = async () => snapshot('schedule-A',
        [event('B', 'schedule-A'), event('A', 'schedule-A', update(2))]);
    await state.pollScheduledAgentRun('schedule-A', 'A', 'turn-A');
    assert.equal(state.notifications.length, 1); assert.equal(state.notifications[0].managedPrice.sessionId, 'A');
    assert.equal(state.routePriceNotice, undefined);
});

test('continued child production poll uses its continuation run and original session', async () => {
    const { state } = fixture(); const child = { childRunId: 'child-A', rootRunId: 'root-A', events: [], nextEventIndex: 0, updatedAt: 0 };
    const continuation = { childRunId: child.childRunId, runId: 'continued-A', sessionId: 'A', turnId: 'turn-A', cursor: 0, controller: new AbortController() };
    state.agentChildContinuationStates.set(child.childRunId, continuation);
    state.findAgentChild = () => ({ child }); state.updateCodingChildSnapshot = (_owner, _turn, _child, fn) => fn(child);
    state.platformService.getAgentRunSnapshot = async () => snapshot('continued-A', [event('A', 'continued-A')]);
    await state.pollAgentChildRun(continuation);
    assert.equal(state.notifications.length, 1); assert.equal(state.notifications[0].managedPrice.runId, 'continued-A');
    assert.equal(state.routePriceNotice, undefined);
});

test('history compaction retains bounded authoritative event and activity replay renders one copy in all locales', () => {
    const first = event();
    const events = appendAgentActivityEvents([first], [{ ...first, at: new Date(9000).toISOString() }]);
    assert.equal(events.length, 1);
    const mirror = createConversationHistoryMirror([{ id: 'A', title: 'A', workspacePath: '', updatedAt: 1000,
        turns: [{ id: 'turn-A', createdAt: 1000, prompt: 'QA', response: '', error: '', stage: 'complete', agentRootRunId: 'run-A', events }] }]);
    const stored = readConversationHistoryMirror(JSON.stringify(mirror)).sessions[0];
    assert.deepEqual(stored.turns[0].events[0], first);
    const { state } = fixture(); state.restoreManagedPriceHistory(stored);
    assert.equal(state.notifications.length, 1); assert.equal(state.routePriceNotice, undefined);
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const projection = projectConversationStream({ locale, running: false, events: [first, event('A', 'run-A', update(2))] });
        const rows = projection.items.filter(item => item.activity === 'price-update');
        assert.equal(rows.length, 1); assert.ok(rows[0].title); assert.match(rows[0].meta, /USD/);
        assert.doesNotMatch(rows[0].details.text, /\{(?:price|model)\}/);
    }
});

test('visible multiplier notice matches both conversation and selected merchant/model offering', () => {
    const { state } = fixture();
    state.recordManagedPriceEvents([event('B', 'run-B')], 'B', 'run-B');
    assert.equal(state.routePriceNotice.pricingUpdate.offeringId, update().offeringId);
    state.activeModelRoute = () => ({ kind: 'managed_gateway', offering: { id: uuid(98) } });
    assert.equal(state.routePriceNotice, undefined, 'a different merchant/model route must not inherit a notice');
    state.activeModelRoute = () => ({ kind: 'official_connection' }); assert.equal(state.routePriceNotice, undefined);
    state.activeModelRoute = () => ({ kind: 'managed_gateway', offering: { id: update().offeringId } });
    assert.ok(state.routePriceNotice.detail.includes('1'));
});
