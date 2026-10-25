import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { RelaySwitchControl } from '../lib/browser/nextmux-relay-switch-control.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';
import { usageAnalyticsText } from '../lib/browser/nextmux-usage-analytics-locale.js';
import { walletNetBalanceMicros } from '../lib/browser/nextmux-money-format.js';
import { walletBalanceText } from '../lib/browser/nextmux-wallet-balance-text.js';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const React = core('react');
// The component imports its stylesheet (bundled by webpack); Node only needs the JS.
require.extensions['.css'] = () => undefined;
const { WalletTopupSheet } = require('../lib/browser/nextmux-wallet-topup.js');
const { renderToStaticMarkup } = core('react-dom/server');
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

// Use the actual production markup, not a parallel HTML copy of the controls.
async function fixture() {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file);
    const nodes = new Map();
    function visit(node) {
        if (ts.isJsxElement(node)) {
            const value = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(file) === 'className')?.initializer;
            const name = value && ts.isStringLiteral(value) ? value.text : '';
            if (!nodes.has(name)) nodes.set(name, node.getText(file));
        }
        ts.forEachChild(node, visit);
    }
    visit(widget);
    for (const name of ['nmx-settings-heading', 'nmx-wallet-grid', 'nmx-billing-toolbar', 'nmx-billing-table', 'nmx-microphone-select']) assert.ok(nodes.get(name), name);
    const body = `class Fixture {
        desktopLocale = 'zh-CN'; platformSession = { linked: true }; accountOverviewLoading = false;
        settingsPanel = 'billing'; modelSwitchDefaultEnabled = true;
        billingTab = 'usage'; walletTopupSheetOpen = true; walletTopupAmount = '100'; walletTopupStage = 'idle'; walletTopupError = '';
        microphones = [{ deviceId: 'fixture', label: '内置麦克风' }]; selectedMicrophoneId = 'fixture';
        accountOverview = { usage: Array.from({ length: 30 }, (_, id) => ({ id, modelName: '测试模型 — 完整名称',
            currency: 'USD', providerName: '测试线路', canonicalModel: 'fixture', inputTokens: 1000, cachedInputTokens: 200,
            cacheWriteTokens: 0, outputTokens: 100, chargedMicros: 50000, settlementMultiplierBps: 10000, platformFeeBps: 0,
            completedAt: 1, durationMs: 1000, status: 'completed', metrics: [{ metric: 'input_token', quantity: 1000, customerAmountMicros: 50000 }] })) };
        formatMoneyMicros(currency, value) { return currency + ' ' + (value / 1000000).toFixed(6); }
        selectBillingTab() {} closeNavigationSurface() {} createWalletTopup() {} update() {} stopVoiceInput() {}
        tx() { return '设置'; }
        ${method('renderAutomaticRelaySwitch')}
        ${method('renderWalletTopupSheet')}
        renderPanel() {
            const title = '余额、充值与消费', subtitle = '统一余额可用于所有符合条件的托管线路。';
            const wallets = [{ currency: 'USD', availableMicros: 100000000, reservedMicros: 0, lifetimeSpentMicros: 50000, lifetimeCreditedMicros: 100050000 }];
            const dateTime = () => '2026/9/22', usageMetricName = name => name;
            return <>${nodes.get('nmx-settings-heading')}<section className='nmx-settings-panel nmx-billing-panel'>
                ${nodes.get('nmx-wallet-grid')}${nodes.get('nmx-billing-toolbar')}${nodes.get('nmx-billing-table')}
                <article className='nmx-settings-group'>${nodes.get('nmx-microphone-select')}
                    <div className='nmx-microphone-meter'><i style={{ width: '50%' }} /></div>
                </article>
                <div className='nmx-composer-alert-stack'><div className='nmx-attachment-error is-balance'><span>余额不足</span><button className='nmx-balance-recharge'>立即充值</button></div><div className='nmx-attachment-error'><span>无法添加附件</span></div></div>
            </section></>;
        }
    }; return Fixture;`;
    // renderWalletTopupSheet now delegates to the extracted WalletTopupSheet component.
    return new Function('React', 'microphoneText', 'usageRecordTotalTokens', 'RelaySwitchControl', 'localizeDesktopSurface', 'WalletTopupSheet', 'usageAnalyticsText', 'walletBalanceText', 'walletNetBalanceMicros', ts.transpile(body, { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }))(
        React, () => '输入设备', item => item.inputTokens + item.outputTokens, RelaySwitchControl, localizeDesktopSurface, WalletTopupSheet, usageAnalyticsText, walletBalanceText, walletNetBalanceMicros);
}

test('wallet, billing and top-up production controls remain readable in both themes', { timeout: 60000 }, async t => {
    const originalWindow = globalThis.window;
    globalThis.window = { innerWidth: 960 };
    t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
    const Fixture = await fixture();
    const css = (await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')))).join('\n');
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.bringToFront();
    await page.setRequestInterception(true);
    page.on('request', request => void request.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const palette = {};
    const show = async (theme, instance, modal = false) => {
        const markup = renderToStaticMarkup(React.createElement('div', { className: 'nmx-desktop-widget', id: 'nextmux.desktop.widget' },
            React.createElement('div', { className: `nmx-shell nmx-theme-${theme}` },
                React.createElement('div', { className: 'nmx-settings-page' }, instance.renderPanel()), modal && instance.renderWalletTopupSheet())));
        await page.setContent(`<html><head><style>${css}</style><style>html,body{margin:0;width:100%;height:100%}.nmx-settings-page{display:block;padding:20px}.nmx-billing-panel{max-width:800px}
            ${['hover', 'active', 'focus', 'focus-visible'].map(state => `.nmx-billing-toolbar nav button:${state}{--billing-test-${state}:1}`).join('\n')}
            </style></head><body>${markup}</body></html>`);
    };
    const colors = async (selector, property = 'color', adjacent = false) => page.$eval(selector, (node, options) => {
        const rgb = text => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d'); context.fillStyle = text; context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
        };
        const style = getComputedStyle(node), foreground = rgb(style[options.property]); let background;
        for (let current = options.adjacent ? node.parentElement : node; current; current = current.parentElement) {
            const candidate = rgb(getComputedStyle(current).backgroundColor);
            if (candidate[3] === 255) { background = candidate; break; }
        }
        const luminance = value => value.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
            .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const a = luminance(foreground), b = luminance(background || [255, 255, 255]);
        return { color: style.color, background: style.backgroundColor, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), opacity: style.opacity };
    }, { property, adjacent });
    for (const theme of ['dark', 'light']) {
        const instance = new Fixture();
        await page.setViewport({ width: 960, height: 800 });
        await show(theme, instance);
        // The page subtitle was removed as redundant copy (§6.8).
        assert.equal(await page.$('.nmx-settings-heading p'), null);
        const selectors = ['.nmx-settings-heading h2', '.nmx-billing-heading-actions button', '.nmx-billing-heading-actions button.is-primary',
            '.nmx-billing-heading-actions .nmx-topbar-routing > span:last-child', '.nmx-wallet-grid span', '.nmx-wallet-grid strong', '.nmx-wallet-grid dt', '.nmx-wallet-grid dd',
            '.nmx-billing-toolbar .is-active', '.nmx-billing-table > header', '.nmx-billing-table strong', '.nmx-billing-table small',
            '.nmx-billing-toolbar button:not(.is-active)', '.nmx-usage-breakdown summary', '.nmx-microphone-select select', '.nmx-attachment-error.is-balance', '.nmx-attachment-error:not(.is-balance)'];
        for (const selector of selectors) {
            const value = await colors(selector);
            assert.ok(value.contrast >= 4.5, `${theme} ${selector} contrast ${JSON.stringify(value)}`);
        }
        const table = await page.$eval('.nmx-billing-table', node => ({ h: node.clientHeight, total: node.scrollHeight, overflow: getComputedStyle(node).overflowY }));
        assert.equal(table.overflow, 'auto'); assert.ok(table.total > table.h && table.h <= 448, `${theme} billing history scrolls within the panel`);
        palette[theme] = await colors('.nmx-wallet-grid > article');
        const control = await page.$eval('.nmx-billing-heading-actions .nmx-same-model-switch', node => {
            const box = node.querySelector('.nmx-checkbox-indicator').getBoundingClientRect();
            const label = node.querySelector('span:last-child').getBoundingClientRect();
            return { gap: label.left - box.right, boxWidth: box.width, height: box.height };
        });
        assert.ok(control.gap >= 0 && control.gap <= 10 && control.boxWidth >= 12 && control.height >= 12, JSON.stringify(control));
        for (const checked of [false, true]) {
            await page.$eval('.nmx-billing-heading-actions .nmx-same-model-switch input', (input, value) => { input.checked = value; }, checked);
            const indicator = '.nmx-billing-heading-actions .nmx-checkbox-indicator';
            const border = await colors(indicator, 'borderTopColor', true);
            assert.ok(border.contrast >= 3, `${theme}/${checked ? 'checked' : 'unchecked'} checkbox boundary: ${JSON.stringify(border)}`);
            if (checked) {
                const mark = await colors(indicator, 'backgroundColor', true);
                assert.ok(mark.contrast >= 3, `${theme} checkbox selected mark: ${JSON.stringify(mark)}`);
            }
        }
        const tabs = await page.$$eval('.nmx-billing-toolbar nav button', nodes => nodes.map(node => ({ text: node.textContent, title: node.title, cursor: getComputedStyle(node).cursor })));
        assert.equal(tabs.length, 3);
        for (const tab of tabs) { assert.equal(tab.title, tab.text); assert.equal(tab.cursor, 'pointer'); }
        const interactionFailures = [];
        for (const selected of ['usage', 'topups', 'movements']) {
            instance.billingTab = selected;
            await show(theme, instance);
            for (let index = 1; index <= 3; index++) {
                const selector = `.nmx-billing-toolbar nav button:nth-child(${index})`;
                const inspect = async (interaction, expectedState = '') => {
                    // Include completed CSS transitions, not a cursor overlay or
                    // a screenshot pixel: these are the real computed text/fill.
                    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                    await page.$eval(selector, async node => {
                        getComputedStyle(node).color;
                        await Promise.all(node.getAnimations().map(animation => animation.finished));
                    });
                    if (expectedState) {
                        const state = await page.$eval(selector, (node, expected) => {
                            // Chromium's isolated execution world can report
                            // false for matches(':hover') while its renderer
                            // applies :hover. Test-only custom properties prove
                            // each real CSS pseudo-state without altering colors.
                            const style = getComputedStyle(node);
                            return Object.fromEntries(expected.split(':').filter(Boolean).map(pseudo =>
                                [pseudo, style.getPropertyValue(`--billing-test-${pseudo}`).trim()]));
                        }, expectedState);
                        assert.ok(Object.values(state).every(value => value === '1'), `${theme}/${selected}/${index}/${interaction}: ${JSON.stringify(state)}`);
                    }
                    const value = await colors(selector);
                    if (value.contrast < 4.5) interactionFailures.push({ selected, index, interaction, ...value });
                };
                await page.mouse.move(0, 0);
                await page.evaluate(() => document.activeElement?.blur());
                await inspect('rest');
                await page.hover(selector); await inspect('hover', ':hover');
                await page.mouse.down(); await inspect('pointer-pressed', ':hover:active:focus');
                await page.mouse.up(); await page.mouse.move(0, 0); await inspect('pointer-focus', ':focus');
                // Shift+Tab then Tab gives the target genuine keyboard focus.
                await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
                await page.keyboard.press('Tab'); await inspect('keyboard-focus', ':focus-visible');
                await page.hover(selector); await inspect('keyboard-focus-hover', ':hover:focus-visible');
                await page.keyboard.down('Space'); await inspect('keyboard-pressed-hover', ':active:hover:focus-visible');
                await page.keyboard.up('Space');
            }
        }
        assert.deepEqual(interactionFailures, [], `${theme} billing tab interaction contrast must remain at least 4.5:1`);
        assert.notEqual(await page.$eval('.nmx-billing-table strong[title]', node => getComputedStyle(node).cursor), 'help');
        for (const stage of ['idle', 'creating', 'waiting', 'credited', 'error']) {
            instance.walletTopupStage = stage === 'error' ? 'idle' : stage;
            instance.walletTopupError = stage === 'error' ? '无法创建订单，请稍后重试。' : '';
            // Current PlatformWalletTopupOrder shape (Whop USD checkout).
            instance.walletTopupOrder = ['waiting', 'credited'].includes(stage) ? { payment: { provider: 'whop', method: 'whop_checkout', status: 'pending',
                qrUrl: '', checkoutUrl: 'https://invalid.example/fixture', feeAmount: { currency: 'USD', minor: 330 },
                payableAmount: { currency: 'USD', minor: 10330, display: '$103.30' }, creditAmount: { currency: 'USD', micros: 100000000 }, expiresAt: Date.now() + 60000 }, topup: {
                id: 'synthetic', status: 'payment_pending', currency: 'USD', payableAmountMinor: 10330, creditCurrency: 'USD', creditAmountMicros: 100000000,
                baseAmountMinor: 10000, amountOffsetMinor: 0, creditAmountMinor: 10000, conversionMarginBps: 0, expiresAt: Date.now() + 60000,
                paidAt: null, creditedAt: null, createdAt: Date.now(), provider: 'whop', feeAmountMinor: 330, chargeAmountMinor: 10330 } } : undefined;
            await show(theme, instance, true);
            for (const selector of ['.nmx-topup-sheet h2', '.nmx-topup-sheet footer button.is-primary',
                ...(stage === 'error' ? ['.nmx-topup-error'] : stage === 'waiting' ? ['.nmx-topup-waiting', '.nmx-topup-waiting time']
                    : stage === 'credited' ? ['.nmx-topup-success'] : ['.nmx-topup-amount-field input', '.nmx-topup-presets [aria-pressed="true"]'])]) {
                const value = await colors(selector);
                assert.ok(value.contrast >= 4.5, `${theme}/${stage} ${selector}: ${JSON.stringify(value)}`);
            }
            if (stage === 'idle') {
                await page.hover('.nmx-topup-presets button:first-child');
                const value = await colors('.nmx-topup-presets button:first-child');
                assert.ok(value.contrast >= 4.5, `${theme} preset hover: ${JSON.stringify(value)}`);
            }
            if (stage === 'creating') assert.equal(await page.$eval('.nmx-topup-sheet footer .is-primary', node => node.disabled), true);
        }
        await page.setViewport({ width: 360, height: 520 });
        await show(theme, instance, true);
        const rect = await page.$eval('.nmx-topup-sheet', node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, top: r.top, overflow: node.scrollWidth > node.clientWidth + 1 }; });
        assert.ok(rect.left >= 0 && rect.right <= 360 && rect.top >= 0 && rect.bottom <= 520 && !rect.overflow, `${theme} small-screen top-up: ${JSON.stringify(rect)}`);
    }
    assert.notEqual(palette.dark.background, palette.light.background, 'the wallet card itself follows the selected theme');
    assert.deepEqual(errors, []);
});
