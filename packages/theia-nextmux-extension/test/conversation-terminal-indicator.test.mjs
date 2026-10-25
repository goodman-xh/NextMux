import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');

test('terminal conversation rows expose an unread completion indicator', () => {
    // The unread dot fades in and out (Radix Presence pattern) instead of popping.
    assert.match(widget, /<FadePresence present=\{Boolean\(unread\)\}><i className='nmx-session-terminal-dot'/);
    assert.match(widget, /\{unread \? null : waiting \?/);
    assert.match(widget, /waiting \? <i className=\{`codicon codicon-/);
    assert.match(widget, /latest\?\.stage === 'running' \? <i className='nmx-thread-spinner'/);
    assert.match(widget, /className='nmx-session-terminal-dot'[^>]*aria-label=\{localizeDesktopSurface\(this\.desktopLocale, '对话已结束'\)\}/s);
    assert.match(style, /\.nmx-session-terminal-dot\s*\{[\s\S]*?background:\s*#4f9cff/);
});
