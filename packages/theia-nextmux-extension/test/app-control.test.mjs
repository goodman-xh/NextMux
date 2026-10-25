import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const control = require('../lib/browser/nextmux-app-control.js');
const { nextmuxTabInstructions } = require('../lib/node/nextmux-app-tools.js');

test('应用操控: the picked app becomes one marker line the agent reads, and the turn shows it as a chip', () => {
    const app = { name: '计算器', id: 'com.apple.calculator', icon: '' };
    assert.equal(control.appControlMarker(app), '[App: 计算器 (com.apple.calculator)]');
    assert.equal(control.withAppControlMarker(app, '算一下 1+1'), '[App: 计算器 (com.apple.calculator)]\n算一下 1+1');
    assert.equal(control.withAppControlMarker(app, ''), '[App: 计算器 (com.apple.calculator)]', 'an app alone opens it');
    assert.equal(control.withAppControlMarker(undefined, 'hi'), 'hi');
    assert.deepEqual(control.parseAppControlMarker('[App: 计算器 (com.apple.calculator)]\n算一下 1+1'), { app: { name: '计算器', id: 'com.apple.calculator' }, text: '算一下 1+1' });
    assert.deepEqual(control.parseAppControlMarker('[App: WeChat]'), { app: { name: 'WeChat', id: 'WeChat' }, text: '' });
    assert.deepEqual(control.parseAppControlMarker('say [App: x] later'), { text: 'say [App: x] later' }, 'only a first line counts');
    // Brackets or line breaks in an app's name cannot forge or break the line.
    assert.equal(control.appControlMarker({ name: 'Evil] \n[App: X', id: 'a(b)' }), '[App: Evil App: X (a b)]');
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const key of ['button', 'pickTitle', 'remove', 'unavailable', 'selected', 'needsFullAccess', 'switchFullAccess']) assert.ok(control.appControlText(locale, key), `${locale}.${key}`);
    }
    assert.equal(control.appControlText('zh-CN', 'button'), '应用操控');
});

test('the agent is told how to find tabs, when to ask, and what never to do in an app', () => {
    const text = nextmuxTabInstructions();
    assert.match(text, /Call tabs\.list before acting/);
    assert.match(text, /never open a second copy/);
    assert.match(text, /\[App: Calculator \(com\.apple\.calculator\)\]" \(the name may be localized\)/);
    assert.doesNotMatch(text, /[\u3400-\u9fff]/, 'the instructions are English');
    assert.match(text, /if exactly one tab has that kind, use it without asking; if several do, ask which/);
    assert.match(text, /call task\.request_user_input and wait: .*one option per candidate/, 'questions go to the answer drawer, not a new message');
    assert.match(text, /Never end your reply just to ask/);
    assert.match(text, /not in Full access/);
    assert.match(text, /never pay, transfer or trade/);
    assert.match(text, /Skill plugins are only for the apps they were made for/);
});

test('the composer offers 应用操控 beside the permission button and sends the pick with the message', () => {
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const below = widget.slice(widget.indexOf("<div className='nmx-composer-below'>"), widget.indexOf('{routePriceNotice &&', widget.indexOf("<div className='nmx-composer-below'>")));
    assert.match(below, /nmx-permission-button[\s\S]*nmx-app-control-button/, 'the icon follows the permission button');
    assert.match(below, /title=\{appControlText\(this\.desktopLocale, 'button'\)\}/);
    assert.match(widget, /<ComposerAppChip app=\{this\.composerApp\(\)!\}[\s\S]{0,400}<div className=\{`nmx-composer-input/, 'the chip sits on its own row above the text');
    assert.match(widget, /value = withAppControlMarker\(pickedApp, value\);/);
    assert.match(widget, /withAppControlMarker\(pickedApp, materializePastedTextPrompt/, 'a message queued while a run works keeps the pick too');
    assert.match(widget, /this\.editingTurnApp && <span className='nmx-turn-app-row'><TurnAppChip/, 'editing a sent turn renders the app chip instead of raw [App: ...] text');
    assert.match(widget, /parsedPrompt\.app && <span className='nmx-turn-app-row'><TurnAppChip/, 'queued follow-up items render the app chip instead of raw [App: ...] text');
    assert.equal(control.appControlText('zh-CN', 'closeBody'), '只影响 NextMux 为标签打开的应用；你原本就开着的应用总是放回桌面。应用会正常退出，有未保存的内容会先问你。');
});
