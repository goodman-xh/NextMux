import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
const locale = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-link-opening-locale.ts', import.meta.url)), 'utf8');

test('assistant links are intercepted without making prose itself clickable', () => {
  assert.match(source, /className='nmx-gateway-content'[\s\S]*?onClickCapture=\{event => this\.handleAssistantContentClick\(event\)\}/);
  // Only anchors and file-path pills are links; the surrounding prose is not.
  assert.match(source, /const element = event\.target instanceof Element \? event\.target : null;[\s\S]*?element \? element\.closest<HTMLElement>\('a\[href\], a\[data-href\], \.nmx-file-path-pill\[data-href\]'\)/);
  assert.match(source, /event\.preventDefault\(\);[\s\S]*?this\.requestConversationLinkOpen\(href\)/);
});

test('web links follow the default built-in browser and remembered system or built-in choices', () => {
  assert.match(source, /this\.linkOpeningPolicy\.decide\(target\)/);
  assert.match(source, /this\.linkOpeningPolicy\.confirm\(target,[\s\S]*?remember: this\.rememberConversationLinkChoice/);
  assert.match(source, /confirmConversationLinkOpen\('system-browser'\)/);
  assert.match(source, /confirmConversationLinkOpen\('builtin-browser'\)/);
  assert.match(source, /value=\{this\.linkOpeningPolicy\.getPreference\(\) \|\| ''\}/);
  assert.match(source, /<option value=''>\{linkOpeningText\(this\.desktopLocale, 'defaultBrowser'\)\}<\/option>/);
  assert.match(locale, /'zh-CN':[\s\S]*?defaultBrowser: '默认使用内置浏览器'/);
  assert.doesNotMatch(locale, /askEveryTime/);
});

test('file links resolve deterministically with the viewer’s branch isolation, bound network roots and read-only external files', () => {
  const openLink = source.slice(source.indexOf('protected async openConversationFileLink('), source.indexOf('protected normalizeBrowserUrl('));
  const viewer = source.slice(source.indexOf('protected async openToolFileActivity('), source.indexOf('protected openToolBrowserActivity('));
  // Behaviour is exercised in batch2-file-opening; these pins keep the link path on the viewer's guards.
  assert.match(openLink, /conversationFileUri\(evidence\.path\)/);
  assert.match(openLink, /await this\.resolveToolReadBranchUri\(session, uri, node\.path\)/);
  assert.match(openLink, /uri\.authority && !\[\.\.\.this\.codingSessionStoredWorkspaceRoots\(session\), workspaceRoot\][\s\S]*?this\.fileActivityRootContains\(root, uri\)/);
  assert.match(openLink, /!real\?\.inside \? \{ readOnly: true \}/);
  assert.match(openLink, /#L\(\\d\+\)/);
  // A user click may preview an explicit external file; inherited files still use their private branch copy.
  assert.match(viewer, /await this\.resolveToolReadBranchUri\(session, uri/);
  assert.match(viewer, /uri\.authority[\s\S]*?this\.codingSessionStoredWorkspaceRoots\(session\)[\s\S]*?this\.fileActivityRootContains\(root, uri\)[\s\S]*?unbound-network-file/);
  assert.match(viewer, /if \(path\.split\('\/'\)\.some\(segment => segment === '\.\.'\)\) throw new Error\('outside-workspace'\)/);
  assert.match(viewer, /readOnly = true/);
  assert.match(viewer, /await this\.previewContextFile\(/);
  assert.match(viewer, /\.\.\.\(readOnly \? \{ readOnly: true \}/);
});

test('the confirmation dialog is viewport-safe and theme-owned', () => {
  assert.match(source, /className='nmx-thread-dialog nmx-link-opening-dialog'/);
  assert.match(source, /type='checkbox'[\s\S]*?rememberConversationLinkChoice/);
  assert.match(style, /\.nmx-link-opening-dialog\s*\{[\s\S]*?width:\s*min\(520px, calc\(100vw - 32px\)\);[\s\S]*?background:\s*var\(--nmx-panel\);/);
  assert.match(style, /\.nmx-link-opening-dialog > code\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
});
