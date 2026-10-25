import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
const source = await readFile(widgetUrl, 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['loadManagedPriceNotices', 'persistManagedPriceNotices', 'dismissRoutePriceNotice',
    'notificationPriceText', 'recordManagedPriceEvents', 'loadNotifications', 'persistNotifications'].map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, name); return method.getText(file);
}).join('\n');
const getter = widget.members.find(node => ts.isGetAccessorDeclaration(node) && node.name.getText(file) === 'routePriceNotice');
assert.ok(getter);
let banner, article;
function visit(node) {
    if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText(file), text = node.getText(file);
        if (tag === 'div' && /className='nmx-route-price-notice(?: |')/.test(node.openingElement.attributes.getText(file))) banner = text;
        if (tag === 'article' && node.openingElement.attributes.getText(file).includes('item.managedPrice')) article = text;
    }
    ts.forEachChild(node, visit);
}
visit(widget); assert.ok(banner, 'production price banner JSX'); assert.ok(article, 'production structured notification article JSX');

async function bundle() {
    const result = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), contents: `
import * as React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {MANAGED_PRICE_NOTICES_KEY,ManagedPriceNoticeStore,managedPriceNotificationId,normalizeOwnedManagedPriceNotice,ownedManagedPriceEvent,managedPriceNoticeItem} from './nextmux-managed-price-notice';
import {managedPriceText,managedPriceSummary} from './nextmux-managed-price-text';
class Fixture {
    managedPriceNotices=new ManagedPriceNoticeStore(); notifications=[]; activeCodingSessionId='B'; desktopLocale='en'; removedCodingSessionIds=new Set();
    codingSessions=[{id:'A',title:'Conversation A'},{id:'B',title:'Conversation B'}];
    ${getter.getText(file)}
    ${methods}
    render(){
        const routePriceNotice=this.routePriceNotice;
        const notice=routePriceNotice ? (${banner}) : null;
        // Retain the actual JSX event handler to exercise a stale render's
        // callback without reaching into React's private DOM properties.
        this.currentDismiss=notice ? React.Children.toArray(notice.props.children).find(child=>child.type==='button').props.onClick : undefined;
        return <><nav><button data-owner='A' onClick={()=>{this.activeCodingSessionId='A';this.update();}}>Conversation A</button>
            <button data-owner='B' onClick={()=>{this.activeCodingSessionId='B';this.update();}}>Conversation B</button>
            <button data-locale='en' onClick={()=>{this.desktopLocale='en';this.update();}}>English</button>
            <button data-locale='zh-CN' onClick={()=>{this.desktopLocale='zh-CN';this.update();}}>中文</button></nav>
            <h1>{this.activeCodingSessionId}</h1><section className='composer'>{notice}</section>
            <section className='nmx-notification-list'>{this.notifications.map(item=>(${article}))}</section></>;
    }
    update(){flushSync(()=>root.render(this.render()));}
}
const root=createRoot(document.querySelector('main')); window.f=new Fixture();
f.loadManagedPriceNotices(); f.loadNotifications(); f.update();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', alias: {
        react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client'), 'react-dom': core.resolve('react-dom')
    } });
    return result.outputFiles[0].text;
}

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function event(sessionId, runId, number, quote, amount = 1_250_000) {
    const requestId = uuid(number), effectiveQuoteId = `kq1_${quote.repeat(64)}`, at = 1_780_000_000_000 + number;
    return { type: 'model_price_changed', sessionId, runId, at: new Date(at).toISOString(), pricingUpdate: {
        id: `${requestId}:${effectiveQuoteId}`, requestId, at, effectiveQuoteId,
        previousQuoteId: `kq1_${'f'.repeat(64)}`, offeringId: uuid(999), model: 'SYNTHETIC_MODEL', currency: 'USD', usageMultiplierBps: amount / 100,
        previousUsageMultiplierBps: 10000,
        rates: [{ metric: 'input_token', unitSize: 1_000_000, customerAmountMicros: amount },
            { metric: 'output_token', unitSize: 1_000_000, customerAmountMicros: 0 }]
    } };
}

test('real Chromium renders production managed-price ownership, dismissal and persisted localization', async t => {
    const script = await bundle(), evidence = [], evidenceDir = process.env.NEXTMUX_PRICE_BROWSER_EVIDENCE;
    if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
    const server = createServer((request, response) => {
        if (request.url === '/bundle.js') { response.setHeader('content-type', 'text/javascript'); response.end(script); return; }
        response.setHeader('content-type', 'text/html');
        response.end(`<!doctype html><meta charset='utf-8'><title>Isolated managed price notification fixture</title>
<style>body{font:16px system-ui;margin:32px;color:#19232c;background:#f4f6f8}main{max-width:980px}nav{display:flex;gap:12px}button{padding:8px 12px;border:1px solid #aab6c2;border-radius:6px;background:white;cursor:pointer}.composer{min-height:64px}.nmx-route-price-notice{background:#fff8db;padding:16px;border:1px solid #d2b859;border-radius:8px;display:flex;gap:12px;align-items:center}.nmx-route-price-notice span{flex:1}article{padding:18px;background:white;border:1px solid #d8dee4;border-radius:8px;margin-top:14px}p{line-height:1.5;margin:10px 0}small{color:#526473}</style>
<main></main><script src='/bundle.js'></script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const setup = async () => {
        const context = await browser.createBrowserContext(), page = await context.newPage();
        await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : request.abort());
        const errors = []; page.on('pageerror', error => errors.push(String(error)));
        await page.goto(origin); await page.waitForSelector('nav');
        const publish = async update => page.evaluate(update => f.recordManagedPriceEvents([update], update.sessionId, update.runId), update);
        const state = () => page.evaluate(() => ({ active: f.activeCodingSessionId, locale: f.desktopLocale,
            banner: document.querySelector('.nmx-route-price-notice')?.textContent || '',
            bannerOwner: document.querySelector('.nmx-route-price-notice')?.getAttribute('data-session-id'),
            bannerEvent: document.querySelector('.nmx-route-price-notice')?.getAttribute('data-price-event-id'),
            bannerHelp: document.querySelector('.nmx-route-price-notice')?.getAttribute('data-help'),
            bannerTitle: document.querySelector('.nmx-route-price-notice')?.getAttribute('title'),
            notifications: [...document.querySelectorAll('article')].map(node => ({ owner: node.dataset.sessionId,
                run: node.dataset.runId, request: node.dataset.requestId, title: node.querySelector('strong')?.textContent, body: node.querySelector('p')?.textContent })) }));
        const capture = async name => {
            const current = await state(); evidence.push({ case: name, ...current });
            if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${name}.png`), fullPage: true });
        };
        const close = async () => { assert.deepEqual(errors, []); await context.close(); };
        return { page, publish, state, capture, close };
    };

    await t.test('background A stays out of B and identical notices retain their two owners', async () => {
        const h = await setup(), a = event('A', 'run-A', 1, 'a'), b = event('B', 'run-B', 2, 'a');
        await h.publish(a);
        let state = await h.state(); assert.equal(state.active, 'B'); assert.equal(state.banner, '');
        assert.equal(state.notifications.length, 1); assert.equal(state.notifications[0].owner, 'A');
        await h.page.click('[data-owner=A]'); state = await h.state();
        assert.equal(state.bannerOwner, 'A'); assert.equal(state.bannerEvent, a.pricingUpdate.id);
        assert.match(state.banner, /The merchant adjusted this model's multiplier\. Please note!/);
        assert.doesNotMatch(state.banner, /SYNTHETIC_MODEL|USD|×/);
        assert.equal(state.bannerHelp, 'The multiplier changed from ×1 to ×1.25');
        assert.equal(state.bannerTitle, state.bannerHelp);
        await h.publish(b); state = await h.state(); assert.equal(state.bannerOwner, 'A');
        assert.equal(state.notifications.length, 2); assert.deepEqual(state.notifications.map(item => item.owner).sort(), ['A', 'B']);
        assert.equal(state.notifications[0].body, state.notifications[1].body);
        await h.page.click('[data-owner=B]'); assert.equal((await h.state()).bannerOwner, 'B');
        await h.capture('managed-price-two-owners'); await h.close();
    });

    await t.test('duplicate receipts and a new run with the same effective rates do not notify or reopen a dismissed banner', async () => {
        const h = await setup(), a = event('A', 'run-A', 1, 'a');
        await h.publish(a); await h.page.click('[data-owner=A]');
        await h.publish(a); assert.equal((await h.state()).notifications.length, 1);
        await h.page.click('.nmx-route-price-notice button'); assert.equal((await h.state()).banner, '');
        await h.publish(event('A', 'run-A-restarted', 3, 'b'));
        assert.equal((await h.state()).notifications.length, 1); assert.equal((await h.state()).banner, '');
        await h.page.reload(); await h.page.waitForSelector('nav'); await h.page.click('[data-owner=A]');
        await h.publish(event('A', 'run-A-again', 4, 'c'));
        assert.equal((await h.state()).notifications.length, 1); assert.equal((await h.state()).banner, '');
        await h.capture('managed-price-dismissed-same-rate'); await h.close();
    });

    await t.test('a stale production dismiss closure cannot clear a newer A event or B event', async () => {
        const h = await setup(); await h.publish(event('A', 'run-A', 1, 'a')); await h.page.click('[data-owner=A]');
        await h.page.evaluate(() => window.oldDismiss = f.currentDismiss);
        const newer = event('A', 'run-A', 5, 'b', 2_500_000); await h.publish(newer);
        await h.page.evaluate(() => oldDismiss()); assert.equal((await h.state()).bannerEvent, newer.pricingUpdate.id);
        const b = event('B', 'run-B', 6, 'c', 3_500_000); await h.publish(b); await h.page.click('[data-owner=B]');
        await h.page.evaluate(() => oldDismiss()); assert.equal((await h.state()).bannerEvent, b.pricingUpdate.id);
        await h.page.click('.nmx-route-price-notice button'); assert.equal((await h.state()).banner, '');
        await h.page.click('[data-owner=A]'); assert.equal((await h.state()).bannerEvent, newer.pricingUpdate.id);
        assert.equal((await h.state()).notifications.length, 3, 'dismiss only removes the exact banner, not durable notifications');
        await h.capture('managed-price-stale-dismiss'); await h.close();
    });

    await t.test('structured notifications reload and rerender in Chinese and English without rewriting stored price metadata', async () => {
        const h = await setup(), a = event('A', 'run-A', 1, 'a');
        await h.page.click('[data-locale="zh-CN"]'); await h.publish(a); await h.page.click('[data-owner=A]');
        let state = await h.state(); assert.match(state.banner, /该模型的倍率已被商家调整，请知悉！/); assert.match(state.notifications[0].body, /本次调用/);
        assert.equal(state.bannerHelp, '倍率已从 ×1 调整为 ×1.25');
        const stored = await h.page.evaluate(() => JSON.parse(localStorage.getItem('nextmux.desktop.notifications.v1'))[0]);
        assert.equal(stored.managedPrice.sessionId, 'A'); assert.equal(stored.managedPrice.pricingUpdate.id, a.pricingUpdate.id);
        assert.match(stored.body, /本次调用/);
        await h.page.reload(); await h.page.waitForSelector('nav'); await h.page.click('[data-owner=A]');
        state = await h.state(); assert.match(state.banner, /The merchant adjusted this model's multiplier/);
        assert.match(state.notifications[0].body, /This call uses the current price/);
        await h.capture('managed-price-persisted-en');
        await h.page.click('[data-locale="zh-CN"]'); state = await h.state();
        assert.match(state.banner, /该模型的倍率已被商家调整，请知悉！/); assert.match(state.notifications[0].body, /本次调用/);
        const restored = await h.page.evaluate(() => JSON.parse(localStorage.getItem('nextmux.desktop.notifications.v1'))[0]);
        assert.deepEqual(restored.managedPrice, stored.managedPrice); assert.equal(restored.body, stored.body);
        assert.equal(state.notifications.length, 1); await h.capture('managed-price-persisted-zh'); await h.close();
    });

    if (evidenceDir) await writeFile(join(evidenceDir, 'managed-price-browser.json'), JSON.stringify({ at: new Date().toISOString(), browser: await browser.version(), evidence }, null, 2));
});
