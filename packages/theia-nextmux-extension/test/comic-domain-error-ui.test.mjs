import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { ComicCoreError } from '@nextmux/comic-core';
import { MODEL_ERROR_LOCALES } from '@nextmux/model-runtime/errors';
import { modelFailure, modelFailureText } from '../lib/browser/nextmux-model-errors.js';
import { conversationErrorText } from '../lib/browser/nextmux-conversation-stream-model.js';
import { MediaDiagnostic } from '../lib/browser/nextmux-media-diagnostics.js';
import { mediaAuditText } from '../lib/browser/nextmux-media-audit-locale.js';
import { DesktopDomainError } from '../lib/common/nextmux-domain-errors.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
function loadComponent(name) {
    const source = readFileSync(new URL(`../src/browser/${name}.tsx`, import.meta.url), 'utf8');
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React
    } }).outputText;
    new Function('require', 'module', 'exports', code)(createRequire(new URL(`../lib/browser/${name}.js`, import.meta.url)), module, module.exports);
    return module.exports;
}
const music = loadComponent('nextmux-music-studio');
const kinds = loadComponent('nextmux-comic-kinds');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const selected = new Set(['comicErrorState', 'comicError', 'comicErrorDetail', 'comicKindErrorState', 'comicKindError', 'comicKindErrorDetail',
    'musicUpdate', 'createComicMusicProject', 'renderComicKindSheet']);
const members = widget.members.filter(node => selected.has(node.name?.getText(ast))).map(node => node.getText(ast));
// Exercise the exact production error markup without instantiating the full Theia workbench.
const surfaces = ['renderComicWorkbench', 'renderComicCreateSheet', 'renderComicCharacterSheet'].map((name, index) => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    let element;
    (function visit(node) {
        if (ts.isJsxElement(node) && /nmx-studio-notice|nmx-agent-inline-error/.test(node.openingElement.attributes.getText(ast))
            && node.getText(ast).includes('this.comicErrorDetail')) element = node;
        ts.forEachChild(node, visit);
    })(method);
    assert.ok(element, `${name} has the production semantic error surface`);
    return `renderErrorSurface${index}() { return (${element.getText(ast)}); }`;
});
const dependencies = { React, modelFailure, modelFailureText, conversationErrorText, MediaDiagnostic, mediaAuditText, localizeDesktopSurface, ...music, ...kinds };
const Harness = new Function(...Object.keys(dependencies), ts.transpileModule(`class Harness { ${members.concat(surfaces).join('\n')} }; return Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
}).outputText)(...Object.values(dependencies));

function fixture() {
    return Object.assign(new Harness(), {
        desktopLocale: 'en', comicKindBusy: false, comicMessage: '', comicCreateDraft: {}, comicKindRatio: '16:9',
        update() {}, comicHasDirtyDraft: () => false, renderComicStepSummary: () => null,
        comicExistingPathsForDirectory: () => [],
        musicSettings: project => project.music, comicCreatePlan: () => ({ ratioOptions: ['16:9'], ratio: '16:9', rate: 24 }),
        closeNavigationSurface() {}, openExternalUrl() {}
    });
}
const raw = 'Original diagnostic: 场景 <My title> / keep this detail';
const domain = new ComicCoreError('INVALID_PROJECT', raw, 'comic.invalid_project.must_be_an_integer_from_to',
    { field: 'shot.durationFrames', minimum: 1, maximum: 600 });
function rpcError(value = domain) {
    return Object.assign(new Error('Comic RPC wrapper'), { code: value.code,
        data: JSON.parse(JSON.stringify({ readableError: value.readableError })) });
}
function escaped(value) { return renderToStaticMarkup(React.createElement('span', null, value)).slice(6, -7); }
function assertSurface(html, locale, error) {
    const expected = modelFailure(locale, error);
    assert.ok(html.includes(escaped(expected.text)), `${locale}: translated reason`);
    assert.ok(!html.includes('<details>') && !html.includes('<pre'), `${locale}: no diagnostic disclosure`);
    assert.ok(!html.includes(escaped(expected.detail)), `${locale}: original detail stays local`);
    assert.doesNotMatch(html, /Original diagnostic|Comic RPC wrapper/);
}

test('music settings RPC failures retain identity, parameters and authored lyrics across all twelve locales', async () => {
    const host = fixture(), error = rpcError();
    const lyrics = '她说：不要翻译这句。\nKeep these lyrics.';
    let command;
    host.musicCommand = async build => { command = build({ revision: 3, music: {} }); throw error; };
    await host.musicUpdate({ lyrics });
    assert.equal(command.patch.music.lyrics, lyrics);
    assert.equal(host.comicErrorState.failure, error);
    assert.deepEqual(host.comicErrorState.failure.data.readableError.params, { field: 'shot.durationFrames', minimum: 1, maximum: 600 });
    for (const locale of MODEL_ERROR_LOCALES) {
        host.desktopLocale = locale;
        assert.equal(host.comicError, modelFailureText(locale, error));
        assert.match(host.comicError, /1.*600/);
        if (locale !== 'en') assert.notEqual(host.comicError, modelFailureText('en', error));
        for (let index = 0; index < surfaces.length; index++) assertSurface(renderToStaticMarkup(host[`renderErrorSurface${index}`]()), locale, error);
    }
});

test('creation RPC errors render current-locale reasons without diagnostics inside all three kind sheets', async () => {
    const host = fixture(), error = rpcError();
    let submitted;
    host.platformService = { createComicLibraryProject: async request => { submitted = request; throw error; } };
    await host.createComicMusicProject({ title: '用户标题 / Keep title', start: 'instrumental', ratio: '16:9' });
    assert.equal(submitted.title, '用户标题 / Keep title');
    assert.equal(host.comicKindBusy, false);
    assert.equal(host.comicKindErrorState.failure, error);
    for (const locale of MODEL_ERROR_LOCALES) for (const kind of ['music', 'image', 'topic']) {
        host.desktopLocale = locale;
        host.comicKindSheet = kind;
        const html = renderToStaticMarkup(host.renderComicKindSheet());
        assertSurface(html.slice(html.indexOf('<div class="nmx-agent-inline-error"')), locale, error);
        assert.ok(!html.includes('<pre'), 'raw error diagnostic is not rendered');
    }
});

test('same-code domain reasons stay distinct and unknown prose appears only in details', async () => {
    const host = fixture();
    for (const locale of MODEL_ERROR_LOCALES) {
        host.desktopLocale = locale;
        const text = rpcError(new ComicCoreError('INVALID_PROJECT', raw, 'comic.invalid_project.must_be_text', {}));
        const list = rpcError(new ComicCoreError('INVALID_PROJECT', raw, 'comic.invalid_project.must_be_a_list', {}));
        host.comicError = { failure: text };
        const first = host.comicError;
        host.comicError = { failure: list };
        assert.notEqual(host.comicError, first);
        const unknown = new Error('Unrecognized local failure 原文');
        host.musicCommand = async () => { throw unknown; };
        await host.musicUpdate({});
        assert.equal(host.comicError, modelFailureText(locale, unknown));
        assert.notEqual(host.comicError, unknown.message);
        assertSurface(renderToStaticMarkup(host.renderErrorSurface0()), locale, unknown);
    }
});

test('shared desktop metadata remains intact and resetting either state removes stale diagnostic detail', () => {
    const host = fixture();
    const desktop = new DesktopDomainError('DESKTOP_OPERATION_FAILED', 'Local operation failed', { field: 'project' }, raw);
    host.comicError = { failure: desktop };
    for (const locale of MODEL_ERROR_LOCALES) {
        host.desktopLocale = locale;
        assert.equal(host.comicError, modelFailureText(locale, desktop));
        assert.ok(host.comicErrorDetail.includes(raw));
    }
    for (const locale of MODEL_ERROR_LOCALES) for (const name of ['comicError', 'comicKindError']) {
        host.desktopLocale = locale;
        host[name] = { failure: rpcError() };
        assert.ok(host[`${name}Detail`].includes(raw));
        host[name] = 'Existing business notice 用户内容';
        assert.equal(host[name], 'Existing business notice 用户内容');
        assert.equal(host[`${name}Detail`], undefined);
        const html = name === 'comicError' ? renderToStaticMarkup(host.renderErrorSurface0())
            : (host.comicKindSheet = 'image', renderToStaticMarkup(host.renderComicKindSheet()));
        assert.ok(html.includes(escaped('Existing business notice 用户内容')), `${locale}: authored business notice stays visible`);
        assert.doesNotMatch(html, /Original diagnostic|<details>|<pre/);
        host[name] = '';
        assert.equal(host[name], '');
        assert.equal(host[`${name}Detail`], undefined);
    }
});

test('all comic error catch assignments retain the error object instead of flattening message text', () => {
    const failures = [];
    (function visit(node) {
        if (ts.isBinaryExpression(node) && ['this.comicError', 'this.comicKindError'].includes(node.left.getText(ast))) {
            const right = node.right.getText(ast);
            if (right.includes('error.message') || right.includes('modelFailureText(') || right === 'this.mediaError') failures.push(right);
        }
        ts.forEachChild(node, visit);
    })(widget);
    assert.deepEqual(failures, []);
});
