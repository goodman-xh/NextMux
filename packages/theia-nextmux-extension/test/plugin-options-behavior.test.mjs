import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { AppPluginsSettings, AppPluginOptionsModal, appPluginUploadProblemText } from '../lib/browser/nextmux-app-plugins-view.js';
import { appPluginText, appPluginError } from '../lib/browser/nextmux-app-plugins-locale.js';
import { appPluginOptionsText, appPluginParamExtensions, isAppPluginImportFile } from '../lib/browser/nextmux-app-plugin-options-locale.js';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const { renderToStaticMarkup } = core('react-dom/server');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['pickAppPluginParamFile', 'chooseAppPluginUploadFile', 'submitAppPluginUpload'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file));
const bridgeCalls = [];
const dependencies = { appPluginOptionsText, appPluginParamExtensions, isAppPluginImportFile, appPluginText, appPluginError, appPluginUploadProblemText,
    appPluginPriceCents: () => 0, window: { nextmuxDesktop: { async pickAppPluginParamFile(...args) { bridgeCalls.push(args); return { ok: true }; } } } };
const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(dependencies));
const plugin = { id: 'fixture', ok: true, ready: true, enabled: false, params: { comments: { name: 'empty.txt', count: 0 } },
    summary: { id: 'fixture', name: 'Fixture plugin', version: '1.0.0', author: { name: 'Fixture author' }, description: 'One line description',
        license: 'MIT', homepage: 'https://example.invalid', apps: [{ platform: 'macos', bundleId: 'com.apple.TextEdit' }], keys: [], pointer: false,
        vision: 'none', modes: ['background'], risk: [], reflexes: [], decisions: [], events: [], goals: { default: 'Draft', examples: [] },
        params: [{ id: 'comments', type: 'file', label: 'Comment file', accept: ['.txt', '.md'] }], presets: [{ id: 'draft', label: 'Draft preset', goal: 'Write a draft' }] },
    readme: 'Developer integration guide' };
function fixture() {
    const value = new Harness();
    Object.assign(value, { desktopLocale: 'zh-CN', appPlugins: [plugin], appPluginsError: 'old', update() {}, async loadAppPlugins() {}, async configureAppPlugin(id, settings) { this.configured = { id, settings }; },
        fileDialogService: { async showOpenDialog(options) { value.dialog = options; return value.resource; } },
        appPluginUpload: { path: '', fileName: '', author: '', error: 'previous failure', busy: false },
        platformService: { async uploadAppPluginToMarket() { value.uploadCalls = (value.uploadCalls || 0) + 1; return { ok: false, problem: { code: 'package_corrupt' } }; } },
        async loadAppPluginMine() {}, addNotification() {} });
    bridgeCalls.length = 0;
    return value;
}
const resource = path => ({ path: { fsPath: () => path } });

test('file picker uses declared filters and passes the chosen path, never the label', async () => {
    const state = fixture(); state.resource = resource('/tmp/comments.md');
    await state.pickAppPluginParamFile('fixture', 'comments', 'Comment file');
    assert.deepEqual(state.dialog.filters, { 'Comment file': ['txt', 'md'] });
    assert.equal(state.dialog.canSelectFolders, false);
    assert.deepEqual(bridgeCalls, [['fixture', 'comments', '/tmp/comments.md', { scope: 'defaults' }]]);
    assert.equal(state.appPluginsError, '');
    state.resource = undefined; await state.pickAppPluginParamFile('fixture', 'comments');
    assert.equal(bridgeCalls.length, 1, 'cancel must not invoke the backend');
});

test('path and directory parameters use native selection and persist only the selected parameter', async () => {
    for (const type of ['path', 'directory']) {
        const state = fixture(); state.appPlugins = [{ ...plugin, summary: { ...plugin.summary, params: [{ id: 'folder', type, label: 'Folder', accept: ['*.json', '.JSON'] }] } }];
        state.resource = resource('/tmp/chosen'); await state.pickAppPluginParamFile('fixture', 'folder');
        // `path` is a folder, like its alias `directory` (the desktop core validates both as folders).
        assert.equal(state.dialog.canSelectFolders, true, `${type} picks a folder`);
        assert.equal(state.dialog.canSelectFiles, false);
        assert.deepEqual(state.configured, { id: 'fixture', settings: { params: { folder: '/tmp/chosen' }, scope: 'defaults' } });
        assert.deepEqual(bridgeCalls, []);
    }
    assert.deepEqual(appPluginParamExtensions(['*.MD', '.txt', 'md', '*', '../bad']), ['md', 'txt']);
});

test('unsupported uploads are rejected before backend calls, and new choices clear old errors', async () => {
    for (const name of ['plugin.txt', 'readme.md', 'random.json', 'plugin.zip.exe', 'plugin.gz']) assert.equal(isAppPluginImportFile(name), false, name);
    for (const name of ['plugin.zip', 'a.tar.gz', 'a.tgz', 'a.jevplugin', 'plugin.json', 'manifest.json', 'legacy.nmxplugin']) assert.equal(isAppPluginImportFile(name), true, name);
    const state = fixture(); state.resource = resource('/tmp/plugin.txt'); await state.chooseAppPluginUploadFile();
    assert.equal(state.appPluginUpload.path, ''); assert.match(state.appPluginUpload.error, /\.zip.*\.tar\.gz.*\.jevplugin.*plugin\.json.*manifest\.json/);
    state.appPluginUpload.path = '/tmp/plugin.txt'; await state.submitAppPluginUpload(); assert.equal(state.uploadCalls, undefined);
    state.resource = undefined; await state.chooseAppPluginUploadFile(); assert.equal(state.appPluginUpload.error, '');
    state.resource = resource('/tmp/valid.tgz'); await state.chooseAppPluginUploadFile(); await state.submitAppPluginUpload();
    assert.equal(state.uploadCalls, 1); assert.match(state.appPluginUpload.error, /损坏|压缩/); assert.equal(state.appPluginUpload.busy, false);
    state.resource = resource('/tmp/valid.zip'); await state.chooseAppPluginUploadFile(); assert.equal(state.appPluginUpload.error, '');
    assert.equal(appPluginUploadProblemText('zh-CN', { code: 'package_format_unsupported' }), appPluginOptionsText('zh-CN', 'unsupportedFormat'));
    assert.equal(appPluginUploadProblemText('zh-CN', { code: 'plugin_file_invalid' }), '无法读取插件文件或文件夹。');
});

const settings = { locale: 'en', plugins: [plugin], loading: false, error: '', busy: '', expandedId: 'fixture', testResults: {}, tab: 'installed',
    market: { plugins: [], loading: false, query: '', error: '', busy: '' }, mine: { loading: false, error: '' },
    onTab() {}, onLoadLocal() {}, onOpenDocs() {}, onChooseModel() {}, onUninstall() {}, onReload() {}, onTest() {}, onExpand() {} };
test('installed cards stay compact; options never contain run controls; details contain metadata and guide', () => {
    const list = renderToStaticMarkup(React.createElement(AppPluginsSettings, settings));
    assert.match(list, /nmx-plugin-card-options/); assert.match(list, /nmx-plugin-card-details/);
    assert.doesNotMatch(list, /nmx-plugin-params-bar|nmx-plugin-preset-goals|nmx-plugin-details|type="checkbox"/);
    const options = renderToStaticMarkup(React.createElement(AppPluginOptionsModal, { ...settings, plugin, kind: 'options', onClose() {} }));
    assert.match(options, /nmx-plugin-modal is-options/); assert.match(options, /nmx-plugin-params-bar/); assert.match(options, /Draft preset/);
    assert.match(options, />Clear<\/button>/, 'empty selected files remain clearable');
    assert.doesNotMatch(options, />Start<|>Stop<|>Run<|Developer integration guide/);
    const details = renderToStaticMarkup(React.createElement(AppPluginOptionsModal, { ...settings, plugin, kind: 'details', onClose() {} }));
    assert.match(details, /Developer integration guide/); assert.match(details, /MIT/); assert.match(details, /com.apple.TextEdit/); assert.match(details, /&quot;modes&quot;/);
});

test('existing host migration enables disabled records without replacing settings', () => {
    const host = readFileSync(new URL('../../../apps/desktop/app-plugins.cjs', import.meta.url), 'utf8');
    assert.match(host, /if \(record\.enabled !== true\) \{ record\.enabled = true; migrated = true; \}/);
    assert.match(host, /if \(migrated\) await save\(\)/);
});

test('closing an import dialog clears its old error while a busy install remains protected', () => {
    let callback;
    const visit = node => {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'AppPluginInstallDialog') {
            callback = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(file) === 'onCancel').initializer.expression;
        }
        ts.forEachChild(node, visit);
    }; visit(widget);
    const state = { appPluginInstall: { ok: false }, appPluginInstallError: 'old failure', update() {} };
    const close = new Function(ts.transpile(`return (${callback.getText(file)});`, { target: ts.ScriptTarget.ES2022 })).call(state);
    state.appPluginInstallBusy = true; close(); assert.equal(state.appPluginInstallError, 'old failure');
    state.appPluginInstallBusy = false; close(); assert.equal(state.appPluginInstall, undefined); assert.equal(state.appPluginInstallError, '');
});

test('actual plugin modal traps focus, closes with Escape/backdrop/button and restores the trigger', { timeout: 45000 }, async t => {
    const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
    const puppeteer = (await import(createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url)).resolve('puppeteer'))).default;
    const bundle = await build({ stdin: { loader: 'jsx', resolveDir: dirname(fileURLToPath(new URL('../lib/browser/nextmux-app-plugins-view.js', import.meta.url))), contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {AppPluginsSettings} from './nextmux-app-plugins-view';
const props=${JSON.stringify(settings)}; for(const key of ['onTab','onLoadLocal','onOpenDocs','onChooseModel','onUninstall','onReload','onTest','onExpand'])props[key]=()=>{};
createRoot(document.querySelector('main')).render(<AppPluginsSettings {...props}/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><main></main><script src="/fixture.js"></script>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }).catch(() => puppeteer.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })); t.after(() => browser.close()); const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message)); await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.click('.nmx-plugin-card-options'); await page.waitForFunction(() => document.activeElement?.classList.contains('nmx-plugin-modal'));
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.parentElement.className), 'nmx-plugin-modal-footer');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.className), 'nmx-plugin-modal-close');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.nmx-plugin-modal'));
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmx-plugin-card-options');
    await page.click('.nmx-plugin-card-details'); await page.click('.nmx-plugin-modal-close');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmx-plugin-card-details');
    await page.click('.nmx-plugin-card-options'); await page.evaluate(() => document.querySelector('.nmx-plugin-modal-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await page.waitForFunction(() => !document.querySelector('.nmx-plugin-modal')); assert.equal(await page.evaluate(() => document.activeElement.className), 'nmx-plugin-card-options');
    assert.deepEqual(errors, []);
});
