import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DesktopUpdateAction, desktopUpdateText, updateAppearsInDock } from '../lib/browser/nextmux-update-action.js';

const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server'), ts = require('typescript');
const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const state = { phase: 'available', version: '1.2.5', currentVersion: '1.2.4', progress: 0, packaged: true, portable: false, checkedAt: 0, nextCheckAt: 0, revision: 2 };
const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = sourceFile.statements.find(item => ts.isClassDeclaration(item) && item.name.text === 'NextMuxDesktopWidget');
const actualMethod = name => widgetClass.members.find(item => item.name?.getText(sourceFile) === name).getText(sourceFile);
const props = { state, locale: 'en', busy: false, onDownload() {}, onDetails() {} };

test('all twelve locales render compact update/ready labels and explicit non-interruption wording', () => {
    for (const locale of locales) {
        for (const phase of ['available', 'ready']) {
            const html = renderToStaticMarkup(React.createElement(DesktopUpdateAction, { ...props, locale, state: { ...state, phase } }));
            assert.ok(html.includes(desktopUpdateText(locale, phase === 'ready' ? 'ready' : 'update')));
            assert.match(html, /nmx-account-update/); assert.doesNotMatch(html, /disabled=""/);
        }
        for (const key of ['preparing', 'downloadFailed', 'backgroundHint', 'download', 'checking', 'check', 'current', 'waiting', 'error', 'downloadPage', 'checkedAt', 'portableHint', 'developmentHint', 'verificationHint', 'restartHint']) {
            assert.ok(desktopUpdateText(locale, key)?.trim(), `${locale}/${key}`);
        }
    }
});

test('only explicit available click downloads; ready opens details and never installs or quits', () => {
    let downloads = 0, details = 0;
    const callbacks = { onDownload: () => downloads++, onDetails: () => details++ };
    DesktopUpdateAction({ ...props, ...callbacks }).props.onClick(); assert.equal(downloads, 1);
    DesktopUpdateAction({ ...props, ...callbacks, state: { ...state, phase: 'ready' } }).props.onClick(); assert.equal(details, 1);
    for (const changed of [{ busy: true }, { state: { ...state, phase: 'downloading', progress: 35.7 } }]) {
        const button = DesktopUpdateAction({ ...props, ...callbacks, ...changed });
        assert.equal(button.props.disabled, true); button.props.onClick();
    }
    assert.equal(downloads, 1); assert.equal(details, 1);
});

test('download percent never rounds up completion; preparing is not relabeled ready', () => {
    for (const [progress, expected] of [[49.9, '49%'], [99.99, '99%'], [NaN, '0%'], [Infinity, '0%'], [-1, '0%'], [102, '100%']]) {
        const html = renderToStaticMarkup(React.createElement(DesktopUpdateAction, { ...props, state: { ...state, phase: 'downloading', progress } }));
        assert.ok(html.includes(expected)); assert.match(html, /disabled=""/);
    }
    const html = renderToStaticMarkup(React.createElement(DesktopUpdateAction, { ...props, state: { ...state, phase: 'downloading', progress: 100, preparing: true } }));
    assert.ok(html.includes(desktopUpdateText('en', 'preparing'))); assert.doesNotMatch(html, />Ready</);
});

test('ordinary states retain the settings gear; update does not nest a button in the account button', () => {
    for (const phase of ['idle', 'checking', 'current', 'error', 'unsupported']) {
        assert.equal(updateAppearsInDock({ phase }), false);
        assert.equal(DesktopUpdateAction({ ...props, state: { ...state, phase } }), null);
    }
    const dock = actualMethod('renderContextAccountDock');
    assert.match(dock, /toggleSettingsPanel\('profile'\)/);
    assert.match(dock, /!showUpdate && <button className=\{`nmx-account-settings-button [^`]*`\}[\s\S]*?<i className='codicon codicon-settings-gear'><\/i><\/button>\}/);
    assert.match(dock, /<\/button>\}?\s*<DesktopUpdateAction/);
    assert.match(dock, /onDetails=.*openSettingsPanel\('updates'\)/);
    const css = readFileSync(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-context-account-dock \.nmx-account-update\s*\{[^}]*max-width: 100px/);
    assert.match(css, /background: #1263db; color: #fff/);
    assert.match(css, /\.nmx-account-update > span[^}]*text-overflow: ellipsis/);
});

function widgetFixture(bridge) {
    const methods = ['applyDesktopUpdateState', 'downloadDesktopUpdate'].map(actualMethod).join('\n');
    const Class = Function('desktopUpdateText', 'window', ts.transpile(`class Fixture { ${methods} } return Fixture;`, { target: ts.ScriptTarget.ES2022 }))(desktopUpdateText, { nextmuxDesktop: bridge });
    return Object.assign(new Class(), { updateState: { ...state }, updateBusy: false, updateError: '', updateMessage: '', desktopLocale: 'en', update() {} });
}

test('actual widget methods reject stale snapshots and synchronously lock repeated download clicks', async () => {
    let calls = 0, finish;
    const widget = widgetFixture({ downloadUpdate: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, getUpdateState: async () => ({ ...state, phase: 'downloading', revision: 3 }) });
    const first = widget.downloadDesktopUpdate(), second = widget.downloadDesktopUpdate();
    assert.equal(calls, 1); await second;
    widget.applyDesktopUpdateState({ ...state, phase: 'ready', progress: 100, revision: 5 });
    finish(true); await first;
    assert.equal(widget.updateState.phase, 'ready'); assert.equal(widget.updateState.revision, 5);
    assert.equal(widget.updateBusy, false);
});

test('a rejected or failed download keeps an actionable localized error without quitting', async () => {
    const widget = widgetFixture({ downloadUpdate: async () => false, getUpdateState: async () => ({ ...state }) });
    await widget.downloadDesktopUpdate(); assert.equal(widget.updateError, desktopUpdateText('en', 'downloadFailed'));
    const failed = widgetFixture({ downloadUpdate: async () => { throw new Error('private path'); } });
    await failed.downloadDesktopUpdate(); assert.equal(failed.updateError, desktopUpdateText('en', 'downloadFailed'));
    assert.equal(failed.updateBusy, false);
    assert.doesNotMatch(actualMethod('downloadDesktopUpdate'), /installUpdate|quit|addNotification/);
});
