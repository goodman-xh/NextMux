import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { conversationWindowText } from '../lib/browser/nextmux-conversation-tabs-view.js';
import { appPluginText } from '../lib/browser/nextmux-app-plugins-locale.js';
import { NEXTMUX_DESKTOP_LOCALES } from '../lib/browser/nextmux-locale.js';

const source = name => readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');
const widget = source('nextmux-desktop-widget.tsx');

test('after Esc the composer says the AI stopped controlling windows and offers 恢复控制', () => {
    assert.match(widget, /const desktopControlStopped = Boolean\(codingSession && this\.desktopControlEscapedConversations\.has\(codingSession\.id\)\);/);
    assert.match(widget, /className='nmx-attachment-error is-desktop-control' role='status' aria-live='polite'>[\s\S]{0,400}onClick=\{\(\) => this\.resumeDesktopControl\(codingSession\.id\)\}/);
    // 恢复控制 lifts both the renderer's and the main process's block.
    assert.match(widget, /protected resumeDesktopControl\(conversationId: string\): void \{\s*if \(!this\.desktopControlEscapedConversations\.delete\(conversationId\)\) return;\s*void window\.nextmuxDesktop\?\.clearComputerUserEsc\?\.\(conversationId\)/);
    for (const locale of NEXTMUX_DESKTOP_LOCALES) {
        assert.ok(conversationWindowText(locale, 'escStopped').includes('Esc'), `${locale} names the key`);
        assert.ok(conversationWindowText(locale, 'resumeControl').length > 1, locale);
    }
    assert.equal(conversationWindowText('zh-CN', 'resumeControl'), '恢复控制');
    const css = readFileSync(new URL('../src/browser/style/nextmux-Variables.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-attachment-error\.is-desktop-control \{[^}]*color: var\(--nmxv-fg-2\)/, 'a neutral note, not an error colour');
    assert.match(css, /\.nmx-desktop-control-resume:focus-visible \{[^}]*outline: 2px solid/);
});

test('the plugin run bar pauses in every language through the shared catalog', () => {
    assert.match(source('nextmux-app-plugins-view.tsx'), /props\.onPause && <button type='button' onClick=\{props\.onPause\}>\{t\(locale, 'pause'\)\}<\/button>/);
    assert.equal(appPluginText('zh-CN', 'pause'), '暂停');
    assert.equal(appPluginText('ja', 'pause'), '一時停止');
    assert.match(widget, /onPause=\{\(\) => void bridge\.commandAppPlugin\?\.\(run\.runId, \{ pause: true \}\)\}/);
});

test('a note resizes only from its grip and keeps no stale ceiling after the drag', () => {
    const notes = source('nextmux-thread-notes.tsx');
    assert.match(notes, /if \(event\.clientY < box\.bottom - 18 \|\| \(rtl \? event\.clientX > box\.left \+ 18 : event\.clientX < box\.right - 18\)\) return;/);
    assert.match(notes, /setMaxHeight\(undefined\);\s*if \(area\.current\) area\.current\.style\.maxHeight = '';/);
});

test('opening 模型 / 漫剧 / 设置 from a council role conversation does not leave it', () => {
    assert.match(widget, /onViewingChange=\{viewing => \{ if \(viewing\) this\.councilVisibilityController\.selectChild\(activeCouncilChild\.childRunId\); else if \(!this\.activeCouncilChildId\) this\.councilVisibilityController\.leaveToConversation\(\); \}\}/);
});
