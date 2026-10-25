import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const widgetSource = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const serviceSource = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');

test('terminal discovery callers share and await the same frontend load promise', () => {
    assert.match(widgetSource, /terminalRuntimeLoadPromise: Promise<void> \| undefined/);
    assert.match(widgetSource, /if \(!refresh && this\.terminalRuntimeLoadPromise\) return this\.terminalRuntimeLoadPromise/);
    assert.doesNotMatch(widgetSource, /if \(this\.terminalRuntimeLoading\) return;/);
});

test('launch retries only transient profile discovery failures before reporting unsupported hardware', () => {
    assert.match(widgetSource, /supportReason === 'terminal_profile_unavailable'/);
    assert.match(widgetSource, /await this\.loadTerminalRuntime\(true\)/);
});

test('backend terminal discovery uses a resilient cache rather than a permanently rejected promise', () => {
    assert.match(serviceSource, /ResilientTerminalRuntimeCache/);
    assert.doesNotMatch(serviceSource, /terminalRuntimePromise: Promise<DesktopTerminalRuntime>/);
});
