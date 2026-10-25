import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyDesktopTheme,
    desktopThemePreferenceNeedsPersistence,
    resolveDesktopTheme
} from '../lib/browser/nextmux-desktop-theme.js';

test('system theme resolves from the live OS preference', () => {
    assert.equal(resolveDesktopTheme('system', false), 'light');
    assert.equal(resolveDesktopTheme('system', true), 'dark');
    assert.equal(resolveDesktopTheme('light', true), 'light');
    assert.equal(resolveDesktopTheme('dark', false), 'dark');
});

test('desktop theme updates Theia preference and storage as one transaction', () => {
    const calls = [];
    const stored = new Map();

    const resolved = applyDesktopTheme({
        preference: 'light',
        systemPrefersDark: true,
        target: {
            setCurrentTheme: (theme, persist) => calls.push({ theme, persist })
        },
        storage: {
            setItem: (key, value) => stored.set(key, value)
        }
    });

    assert.equal(resolved, 'light');
    assert.deepEqual(calls, [{ theme: 'light', persist: true }]);
    assert.equal(stored.get('nextmux.desktop.theme.v1'), 'light');
    assert.equal(stored.get('theme'), 'light');
});

test('system preference remains system while Theia receives the resolved theme', () => {
    const calls = [];
    const stored = new Map();

    applyDesktopTheme({
        preference: 'system',
        systemPrefersDark: true,
        target: {
            setCurrentTheme: (theme, persist) => calls.push({ theme, persist })
        },
        storage: {
            setItem: (key, value) => stored.set(key, value)
        }
    });

    assert.deepEqual(calls, [{ theme: 'dark', persist: true }]);
    assert.equal(stored.get('nextmux.desktop.theme.v1'), 'system');
    assert.equal(stored.get('theme'), 'dark');
});

test('startup can apply the visible theme without rewriting the Theia preference', () => {
    const calls = [];
    const stored = new Map();

    applyDesktopTheme({
        preference: 'light',
        systemPrefersDark: true,
        persistPreference: false,
        target: {
            setCurrentTheme: (theme, persist) => calls.push({ theme, persist })
        },
        storage: {
            setItem: (key, value) => stored.set(key, value)
        }
    });

    assert.deepEqual(calls, [{ theme: 'light', persist: false }]);
    assert.equal(stored.get('nextmux.desktop.theme.v1'), 'light');
    assert.equal(stored.get('theme'), 'light');
});

test('the settled preference is rewritten only when it differs from the resolved theme', () => {
    assert.equal(desktopThemePreferenceNeedsPersistence('dark', 'light'), true);
    assert.equal(desktopThemePreferenceNeedsPersistence('light', 'light'), false);
    assert.equal(desktopThemePreferenceNeedsPersistence(undefined, 'dark'), true);
});
