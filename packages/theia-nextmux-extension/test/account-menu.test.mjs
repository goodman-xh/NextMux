import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
const { AccountMenu, FeedbackDialog, accountMenuText, feedbackLength, hasValidFeedbackEmail, FEEDBACK_MIN_CHARS } = require('../lib/browser/nextmux-account-menu.js');
const { NEXTMUX_DESKTOP_LOCALES } = require('../lib/browser/nextmux-locale.js');
const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');

const noop = () => {};
const menu = extra => renderToStaticMarkup(React.createElement(AccountMenu, {
    locale: 'zh-CN', linked: true, identity: 'Ada', email: 'ada@example.test', balance: '$12.50', signOutArmed: false, signingOut: false,
    onTopUp: noop, onFeedback: noop, onSettings: noop, onSignOut: noop, onSignIn: noop, ...extra
}));

test('the account sheet lists balance with top-up, then feedback, settings and sign out, in that order', () => {
    const html = menu();
    const order = ['余额', '$12.50', '充值', '反馈', '设置', '退出登录'].map(text => html.indexOf(text));
    assert.ok(order.every(index => index >= 0), html);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(menu({ signOutArmed: true }), /再点一次确认退出/);
});

test('signed out: sign in replaces the balance, feedback is disabled and there is no sign out', () => {
    const html = menu({ linked: false, identity: '未登录', email: undefined, balance: undefined });
    assert.match(html, /登录 \/ 注册/);
    assert.doesNotMatch(html, /退出登录|余额/);
    assert.match(html, /<button type="button" role="menuitem" disabled=""[^>]*><i class="codicon codicon-feedback"/);
});

test('feedback needs at least 10 characters counted as people count them, and partnership requires a valid email', () => {
    assert.equal(FEEDBACK_MIN_CHARS, 10);
    assert.equal(feedbackLength('  十个字十个字十个字  '), 9);
    assert.equal(feedbackLength('😀😀😀😀😀😀😀😀😀😀'), 10);
    assert.equal(hasValidFeedbackEmail('没有邮箱的合作说明内容'), false);
    assert.equal(hasValidFeedbackEmail('联系邮箱 bd@company.com 洽谈合作'), true);
    const dialog = (text, kind = 'bug', locale = 'en') => renderToStaticMarkup(React.createElement(FeedbackDialog, {
        locale, kind, text, status: 'editing', error: '', onKind: noop, onText: noop, onSend: noop, onClose: noop
    }));
    assert.match(dialog('too short'), /<button class="nmx-primary-button" disabled="">Send feedback<\/button>/);
    assert.match(dialog('long enough now'), /<button class="nmx-primary-button">Send feedback<\/button>/);
    assert.match(dialog(''), /aria-checked="true"[^>]*>Bug</);
    const zhHtml = dialog('', 'suggestion', 'zh-CN');
    assert.match(zhHtml, /placeholder="我希望……"/);
    const tabOrder = ['问题 / Bug', '功能建议', '合作', '其他'].map(label => zhHtml.indexOf(label));
    assert.ok(tabOrder.every(index => index >= 0), zhHtml);
    assert.deepEqual([...tabOrder].sort((a, b) => a - b), tabOrder);
    assert.match(dialog('我们想洽谈模型渠道合作但没留邮箱', 'partnership', 'zh-CN'), /<button class="nmx-primary-button" disabled="">发送反馈<\/button>/);
    assert.match(dialog('我们想洽谈模型渠道合作，联系邮箱 bd@company.com', 'partnership', 'zh-CN'), /<button class="nmx-primary-button">发送反馈<\/button>/);
    assert.match(renderToStaticMarkup(React.createElement(FeedbackDialog, {
        locale: 'en', kind: 'bug', text: '', status: 'sent', error: '', onKind: noop, onText: noop, onSend: noop, onClose: noop
    })), /Thanks for your feedback/);
});

test('every shipped locale has its own account and feedback copy', () => {
    for (const entry of NEXTMUX_DESKTOP_LOCALES) {
        const locale = Array.isArray(entry) ? entry[0] : entry;
        const keys = ['balance', 'topUp', 'feedback', 'settings', 'signOut', 'partnership', 'placeholder', 'partnershipPlaceholder', 'emailRequired', 'minimum'];
        for (const key of keys) assert.ok(accountMenuText(locale, key).trim(), `${locale}:${key}`);
        // Loanwords such as German "Feedback" may match English; the copy as a whole must not.
        if (locale !== 'en') assert.ok(keys.filter(key => accountMenuText(locale, key) !== accountMenuText('en', key)).length >= keys.length - 1, locale);
    }
});

test('the avatar opens the account sheet while the gear keeps opening settings directly', () => {
    assert.match(widget, /className=\{`nmx-account-trigger [^`]*`\}[^>]*onClick=\{\(\) => this\.toggleAccountMenu\(\)\}/);
    assert.match(widget, /className=\{`nmx-account-settings-button [^`]*`\}[^\n]*\n\s*onClick=\{\(\) => this\.toggleSettingsPanel\('profile'\)\}/);
    // The dialog renders at shell level, outside the dock's stacking context.
    assert.match(widget, /\{this\.guard\('wallet-topup', \(\) => this\.renderWalletTopupSheet\(\)\)\}\n\s*\{this\.guard\('feedback', \(\) => this\.renderFeedbackDialog\(\)\)\}/);
});
