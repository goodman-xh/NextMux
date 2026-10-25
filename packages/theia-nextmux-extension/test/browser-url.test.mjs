import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { normalizeSafeBrowserUrl } from '../lib/browser/nextmux-browser-url.js';

const widgetSource = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const productionStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url)), 'utf8');

test('browser, files and agents stay available as peer tabs; agent details have no second browser entry', () => {
  const require = createRequire(import.meta.url), React = require('react');
  const file = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const names = ['renderWorkContextTitlebar', 'renderAgentChildPanel', 'showBrowserWorkContext', 'showFileWorkContext', 'showAgentWorkContext'];
  const methods = names.map(name => widget.members.find(node => node.name?.getText(file) === name).getText(file));
  const Harness = new Function('React', 'agentChildText', 'workbenchText', 'agentChildDomId', 'compactConversationId', 'parseAppControlMarker',
    ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, {
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React
    }))(React, (_locale, key) => key, (_locale, key) => key, (prefix, id) => `${prefix}-${id}`, id => id,
      require('../lib/browser/nextmux-app-control.js').parseAppControlMarker);
  const child = { childRunId: 'child', parentRunId: 'parent', rootRunId: 'root', task: 'Synthetic agent', status: 'completed',
    taskContext: { workspaceRoot: '/synthetic', relevantPaths: [], recentOperations: [] }, events: [] };
  const browser = { id: 'existing-tab', url: 'https://example.test', title: 'Existing page' };
  let saved = 0;
  const host = Object.assign(new Harness(), { desktopLocale: 'en', workContextOpen: true, activeSection: 'coding', workContextMode: 'agent',
    currentAgentChildren: () => [child], currentCodingBrowsers: () => [browser],
    cancelContextFileListScrollRestore() {}, captureThreadReadingAnchor() {}, schedulePaneResizeUpdate() {}, syncActiveBrowser() {}, loadSiteState() {}, constrainPaneSizes() {}, update() {},
    persistActiveCodingSessionState() { saved++; }, hydrateDelegationLedgersForSession() {},
    activeCodingSession: () => ({ id: 'owner' }), codingSessionWorkspaceRoot: () => '/synthetic', contextFilesWorkspace: '/synthetic',
    contextFileChildren: new Map([['/synthetic', []]]), findAgentChild: () => undefined, childContinuationHandle: () => undefined,
    agentChildContinuationStates: new Map(), agentChildScrollStates: {}, privacySettings: { saveConversationHistory: true },
    agentChildStatusIcon: () => 'check', agentChildStatusLabel: () => 'completed', renderAgentActivity: () => null, renderUserMessage: () => null });
  const walk = value => !value || typeof value !== 'object' ? [] : [value, ...React.Children.toArray(value.props?.children).flatMap(walk)];
  const tabs = () => walk(host.renderWorkContextTitlebar()).filter(node => node.props.role === 'tab');
  for (const mode of ['agent', 'browser', 'file', 'agent']) {
    if (host.workContextMode !== mode) {
      const id = mode === 'file' ? 'files' : mode === 'agent' ? 'agents' : mode;
      tabs().find(node => node.props.id === `nmx-context-tab-${id}`).props.onClick();
    }
    assert.equal(host.workContextMode, mode, 'the actual tab handler selects its surface');
    const rendered = tabs();
    assert.deepEqual(rendered.map(node => node.props.id), ['nmx-context-tab-browser', 'nmx-context-tab-files', 'nmx-context-tab-agents']);
    assert.equal(rendered.filter(node => node.props['aria-selected']).length, 1);
    assert.equal(rendered.filter(node => node.props.tabIndex === 0).length, 1);
    assert.equal(rendered.find(node => node.props['aria-selected']).props.id,
      `nmx-context-tab-${mode === 'file' ? 'files' : mode === 'agent' ? 'agents' : mode}`);
  }
  assert.equal(saved, 3);
  const details = walk(host.renderAgentChildPanel());
  assert.ok(details.some(node => node.props['data-agent-child-detail'] === 'child'));
  assert.equal(details.filter(node => node.type === 'button' && (node.props['aria-label'] === 'browser'
    || node.props.className?.includes('nmx-agent-open-browser'))).length, 0);
  assert.equal(host.currentCodingBrowsers()[0], browser, 'switching drawer surfaces preserves existing browser state');
});

test('browser URL normalization preserves query data and supports bare hosts', () => {
  assert.equal(
    normalizeSafeBrowserUrl('https://example.test/site?signature=token-value&view=full'),
    'https://example.test/site?signature=token-value&view=full',
  );
  assert.equal(normalizeSafeBrowserUrl('example.test:8443/docs'), 'https://example.test:8443/docs');
  assert.equal(normalizeSafeBrowserUrl('localhost:4181/health'), 'http://localhost:4181/health');
});

test('browser URL normalization rejects unsafe, credentialed, control-byte, and oversized targets', () => {
  assert.equal(normalizeSafeBrowserUrl('javascript:alert(1)'), undefined);
  assert.equal(normalizeSafeBrowserUrl('file:///C:/secret.txt'), undefined);
  assert.equal(normalizeSafeBrowserUrl('https://user:password@example.test/private'), undefined);
  assert.equal(normalizeSafeBrowserUrl('https://example.test/a\n/b'), undefined);
  assert.equal(normalizeSafeBrowserUrl(`https://example.test/${'x'.repeat(2_000)}`), undefined);
});

test('browser tabs keep one mounted webview per tab and hide only inactive tabs', () => {
  assert.match(widgetSource, /protected renderCodingBrowserView\(browser: CodingBrowserRecord, active: boolean\)/);
  assert.match(widgetSource, /retainedBrowsers\.map\(browser => this\.renderCodingBrowserView/);
  assert.match(widgetSource, /mountedBrowserIds\.has\(browser\.id\)/);
  assert.match(widgetSource, /if \(!drawerVisible && this\.mountedBrowserIds\.size === 0\) return undefined/);
  assert.match(widgetSource, /<section key=\{browser\.id\} className=\{`nmx-browser-view/);
  assert.match(widgetSource, /page history and scroll state[\s\S]*?key: this\.props\.id,/);
  assert.match(widgetSource, /aria-hidden': !this\.props\.active/);
  assert.match(productionStyle, /\.nmx-browser-view\.is-inactive\s*\{[\s\S]*?display:\s*none;/);
});

test('file drawer scroll is scoped to and restored with each conversation', () => {
  assert.match(widgetSource, /readonly contextFileListScrollTop\?: number;/);
  assert.match(widgetSource, /protected contextFileListElement\(\): HTMLElement \| undefined/);
  assert.match(widgetSource, /protected scheduleContextFileListScrollRestore\(\): void/);
  assert.match(widgetSource, /protected onContextFileListScroll = \(event: React\.UIEvent<HTMLElement>\)/);
  assert.match(widgetSource, /<div\b[^>]*\bonScroll=\{this\.onContextFileListScroll\}/);
  assert.match(widgetSource, /contextFileListScrollTop,[\s\S]*?\.\.\.\(thread/);
  assert.match(widgetSource, /this\.scheduleContextFileListScrollRestore\(\);[\s\S]*?this\.localizeRenderedSurface\(\)/);
  assert.match(widgetSource, /contextFileListScrollRestorePending = Boolean\(viewState\?\.workContextOpen && viewState\.workContextMode === 'file'\)/);
});

test('file editor reading position is wired through the real drawer and survives editor recreation', () => {
  assert.match(widgetSource, /readonly contextFileScrollPositions\?: ContextFileScrollPositions;/);
  assert.match(widgetSource, /protected contextFileEditorScrollPosition\(uri: string\): ContextFileScrollPosition/);
  assert.match(widgetSource, /protected onContextFileEditorScroll = \(uri: string, position: ContextFileScrollPosition\)/);
  assert.match(widgetSource, /initialScrollPosition=\{this\.contextFileEditorScrollPosition\(preview\.uri\)\}/);
  assert.match(widgetSource, /onScrollPositionChange=\{position => \{ if \(isCurrentEditor\(\)\) this\.onContextFileEditorScroll\(preview\.uri, position\); \}\}/);
  assert.match(widgetSource, /editor\.onDidScrollChange\(event =>/);
  assert.match(widgetSource, /textarea\.addEventListener\('scroll', onScroll/);
  assert.match(widgetSource, /if \(!this\.props\.initialScrollPosition \|\| this\.props\.revealRange\) return/);
});
