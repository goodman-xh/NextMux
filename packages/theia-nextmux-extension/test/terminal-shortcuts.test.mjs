import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
    NEXTMUX_TERMINAL_SCROLLBACK_LINES,
    terminalShortcutAction
} from '../lib/browser/nextmux-terminal-shortcuts.js';

const key = (value, modifiers = {}) => ({
    key: value,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers
});

test('Windows Ctrl+C copies a selection but reaches the shell as SIGINT without one', () => {
    assert.equal(terminalShortcutAction(key('c', { ctrlKey: true }), 'windows', true), 'copy');
    assert.equal(terminalShortcutAction(key('c', { ctrlKey: true }), 'windows', false), 'terminal');
    assert.equal(terminalShortcutAction(key('v', { ctrlKey: true }), 'windows', false), 'paste');
});

test('macOS reserves Command for clipboard while Control+C remains a shell interrupt', () => {
    assert.equal(terminalShortcutAction(key('c', { metaKey: true }), 'macos', true), 'copy');
    assert.equal(terminalShortcutAction(key('v', { metaKey: true }), 'macos', false), 'paste');
    assert.equal(terminalShortcutAction(key('c', { ctrlKey: true }), 'macos', true), 'terminal');
});

test('Linux follows integrated-terminal Ctrl+Shift clipboard conventions', () => {
    assert.equal(terminalShortcutAction(key('c', { ctrlKey: true, shiftKey: true }), 'linux', true), 'copy');
    assert.equal(terminalShortcutAction(key('v', { ctrlKey: true, shiftKey: true }), 'linux', false), 'paste');
    assert.equal(terminalShortcutAction(key('c', { ctrlKey: true }), 'linux', true), 'terminal');
});

test('Insert compatibility shortcuts and unrelated keys preserve terminal input', () => {
    assert.equal(terminalShortcutAction(key('Insert', { ctrlKey: true }), 'windows', true), 'copy');
    assert.equal(terminalShortcutAction(key('Insert', { shiftKey: true }), 'windows', false), 'paste');
    assert.equal(terminalShortcutAction(key('x', { ctrlKey: true }), 'windows', true), 'terminal');
    assert.equal(terminalShortcutAction(key('c', { ctrlKey: true, altKey: true }), 'windows', true), 'terminal');
});

test('all NextMux terminal surfaces share a bounded ten-thousand-line scrollback and themed scrollbars', () => {
    assert.equal(NEXTMUX_TERMINAL_SCROLLBACK_LINES, 10_000);

    const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');

    assert.doesNotMatch(widget, /scrollback:\s*5_000/);
    assert.match(widget, /xterm\.options\.scrollback\s*=\s*NEXTMUX_TERMINAL_SCROLLBACK_LINES/);
    assert.match(widget, /xterm\.options\.fontFamily\s*=\s*NEXTMUX_TERMINAL_FONT_FAMILY/);
    assert.ok((widget.match(/scrollback:\s*NEXTMUX_TERMINAL_SCROLLBACK_LINES/g) || []).length >= 1);
    assert.ok((widget.match(/fontFamily:\s*NEXTMUX_TERMINAL_FONT_FAMILY/g) || []).length >= 1);
    assert.ok((widget.match(/nextmuxScrollbackLines\s*=\s*String\(/g) || []).length >= 2);
    assert.match(widget, /nextmuxFontFamily\s*=\s*NEXTMUX_TERMINAL_FONT_FAMILY/);
    assert.match(widget, /attachCustomKeyEventHandler\(/);
    assert.match(widget, /cursorInactiveStyle:\s*this\.props\.running\s*\?\s*'outline'\s*:\s*'none'/);
    assert.match(style, /\.nmx-terminal-host \.xterm-viewport[\s\S]*?scrollbar-color:/);
    assert.match(style, /\.nmx-theme-light[\s\S]*?\.nmx-agent-command-xterm \.xterm-viewport[\s\S]*?scrollbar-color:/);
    assert.doesNotMatch(widget, /NextMuxTaskTerminalHost|renderTaskTerminalSurface/,
        'agent command events must not be mirrored into a synthetic terminal');
});

test('terminal layout and disposal avoid stale xterm renderer callbacks', () => {
    const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const lifecycleE2e = readFileSync(fileURLToPath(new URL('../../../scripts/desktop-terminal-lifecycle-e2e.mjs', import.meta.url)), 'utf8');
    const terminalFixture = readFileSync(fileURLToPath(new URL('../../../scripts/desktop-terminal-fixture.mjs', import.meta.url)), 'utf8');

    assert.match(widget, /function disposeXtermAfterWrites\(/);
    assert.ok((widget.match(/disposeXtermAfterWrites\(terminal\)/g) || []).length >= 1);
    assert.match(widget, /xterm\?\.element\?\.isConnected/);
    assert.doesNotMatch(widget, /doResizeTerminal\?\s*:/, 'private immediate Theia resize bypasses lifecycle guards');
    assert.doesNotMatch(widget, /doResizeTerminal\.call/, 'private immediate Theia resize bypasses lifecycle guards');
    assert.match(lifecycleE2e, /Runtime\.exceptionThrown/);
    assert.match(lifecycleE2e, /rendererReloadSafe/);
    assert.match(lifecycleE2e, /active terminal cleanup after a renderer reload/);
    assert.match(lifecycleE2e, /new URL\('\.\/desktop-terminal-fixture\.mjs', import\.meta\.url\)/);
    assert.doesNotMatch(lifecycleE2e, /process\.argv\[2\] === '--fixture-/,
        'the lifecycle driver must not copy itself with its CDP helper dependency into the terminal');
    assert.match(terminalFixture, /--fixture-write/);
    assert.doesNotMatch(terminalFixture, /desktop-cdp-reload|WebSocket|NEXTMUX_CDP_PORT/,
        'the terminal child fixture must remain dependency-free and portable');
});

test('the pinned xterm release carries the upstream renderer-disposal safety fix', () => {
    const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const workspace = readFileSync(`${repositoryRoot}/pnpm-workspace.yaml`, 'utf8');
    const patchPath = workspace.match(/xterm@5\.3\.0:\s*([^\r\n]+)/)?.[1]?.trim();

    assert.equal(typeof patchPath, 'string', 'xterm 5.3.0 must be patched through pnpm, not mutated ad hoc');
    const absolutePatchPath = `${repositoryRoot}/${patchPath}`;
    assert.equal(existsSync(absolutePatchPath), true, `missing pinned xterm patch: ${absolutePatchPath}`);

    const patch = readFileSync(absolutePatchPath, 'utf8');
    assert.match(patch, /createRenderDimensions/);
    assert.match(patch, /_cachedDimensions/);
    assert.match(patch, /const renderer = this\._renderer\.value/);
    assert.match(patch, /return this\._cachedDimensions/);
    assert.match(patch, /this\._renderer\.value\?\.handleResize/);
});
