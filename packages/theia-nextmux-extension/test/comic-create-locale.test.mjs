import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { comicStudioText } from '../lib/browser/nextmux-comic-studio-text.js';
import { ImeInput, ImeTextarea } from '../lib/browser/nextmux-ime-field.js';
import { ComicAdaptSettingsFields, comicAdaptExtraText } from '../lib/browser/nextmux-comic-adapt-settings.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';
import { normalizeComicAdaptSettings } from '@nextmux/comic-core/adaptation';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['renderComicCreateSheet'].map(name => {
  const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
  assert.ok(method, `render the production ${name}`);
  return method.getText(ast);
});
const js = ts.transpileModule(`class Harness { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
}).outputText;
const Harness = Function('React', 'ImeInput', 'ImeTextarea', 'ComicAdaptSettingsFields', 'comicAdaptExtraText', 'localizeDesktopSurface', `${js}; return Harness;`)(
  React, ImeInput, ImeTextarea, ComicAdaptSettingsFields, comicAdaptExtraText, localizeDesktopSurface);

const choices = [
  { id: 'own:a:gpt', group: 'own', label: 'GPT', detail: 'My API' },
  { id: 'relay:r1', group: 'relay', label: 'Claude', detail: 'Relay A' }
];

function render(locale, draft, selected, textChoices = choices) {
  const host = Object.assign(new Harness(), {
    desktopLocale: locale, comicCreateSheetOpen: true, comicStage: 'idle', comicError: '',
    comicCreateDraft: { title: 'Pilot', scriptText: '', aspectRatio: '16:9', frameRate: 24, starter: 'storyboard', ...draft },
    activeComicWorkspaceRoot: '/work', comicLibrary: { root: '/Users/me/NextMux Comics' },
    ct(key, values) { return comicStudioText(locale, key, values); },
    comicTextRouteChoices: () => textChoices, comicTextRoute: () => selected,
    comicCreatePlan: draft => ({ choices: [], ratioOptions: ['9:16', '16:9', '1:1', '4:3'], ratio: draft.aspectRatio, ratioLimited: false,
      rateOptions: [24, 25, 30], rate: draft.frameRate, foreignRates: [] }),
    comicCanvasFor: ratio => ({ '9:16': { width: 1080, height: 1920 }, '16:9': { width: 1920, height: 1080 }, '1:1': { width: 1080, height: 1080 }, '4:3': { width: 1440, height: 1080 } })[ratio],
    modelDisplayName: model => model,
    // Each step shows its own model picker (tested with the picker itself); here only where it goes.
    renderComicStepSummary: (capability, variant, label) => React.createElement('div', { className: 'step-picker', 'data-step': capability, 'data-variant': variant }, label),
    comicAdaptSettings: normalizeComicAdaptSettings({ episodes: 3, episodeSeconds: 90 }), setComicAdaptSettings() {},
    selectComicTextRoute() {}, update() {}, closeNavigationSurface() {}, completeNavigationSurface() {}, selectSection() {}, createComicProject() {}
  });
  return renderToStaticMarkup(host.renderComicCreateSheet());
}

test('comic creation sheet is localized and saves into the separate comic library by default', () => {
  for (const locale of ['en', 'zh-TW', 'zh-CN']) {
    const html = render(locale, { title: 'Pilot' });
    assert.match(html, new RegExp(`<h2 id="nmx-comic-create-title">${comicStudioText(locale, 'newComic')}</h2>`));
    assert.ok(html.includes(comicStudioText(locale, 'saveTo', { path: '/Users/me/NextMux Comics' })), locale);
    assert.ok(html.includes(comicStudioText(locale, 'createLead')), locale);
  }
  assert.notEqual(comicStudioText('en', 'newComic'), comicStudioText('zh-CN', 'newComic'));
});

test('新建漫剧 asks for the name only: the story, settings, ratio and models are on the 剧本 step', () => {
  for (const draft of [{ title: 'Pilot' }, { title: 'Pilot', scriptText: 'Once upon a time' }]) {
    const html = render('en', draft);
    assert.doesNotMatch(html, /<textarea/, 'no story field');
    assert.doesNotMatch(html, /nmx-comic-adapt-settings|step-picker|<select|<option/, 'no settings, pickers, ratio or frame rate');
    assert.match(html, /<button class="nmx-primary-button">/, 'a named comic can be created');
  }
  // Without a name (or only spaces) nothing can be created.
  for (const title of ['', '   ']) assert.match(render('en', { title }), /<button class="nmx-primary-button" disabled="">/);
});
