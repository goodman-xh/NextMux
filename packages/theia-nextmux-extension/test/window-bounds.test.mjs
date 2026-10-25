import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { defaultMainWindowBounds, fitWindowToWorkArea, mainWindowMinimumSize, NEXTMUX_MAIN_WINDOW_LIMITS } from '../lib/electron-main/nextmux-window-bounds.js';

const area = (width, height, x = 0, y = 0) => ({ x, y, width, height });
const inside = (rect, work) => rect.x >= work.x && rect.y >= work.y && rect.x + rect.width <= work.x + work.width && rect.y + rect.height <= work.y + work.height;

test('first-launch main window adapts to common screen resolutions within min/max limits', () => {
    const cases = [
        [area(1280, 680, 0, 0), 'small laptop with taskbar'],
        [area(1366, 728), '1366x768 laptop'],
        [area(1440, 875, 0, 25), 'macOS 1440x900'],
        [area(1512, 945, 0, 37), 'MacBook Pro 14 scaled'],
        [area(1920, 1040), 'full HD with taskbar'],
        [area(2560, 1400), 'QHD'],
        [area(3840, 2120), '4K at 100%'],
        [area(1920, 1040, -1920, 0), 'secondary display to the left'],
        [area(800, 560), 'tiny virtual machine']
    ];
    for (const [work, label] of cases) {
        const bounds = defaultMainWindowBounds(work);
        const minimum = mainWindowMinimumSize(work);
        assert.ok(inside(bounds, work), `${label}: ${JSON.stringify(bounds)} outside ${JSON.stringify(work)}`);
        assert.ok(bounds.width <= NEXTMUX_MAIN_WINDOW_LIMITS.maxWidth && bounds.height <= NEXTMUX_MAIN_WINDOW_LIMITS.maxHeight, `${label}: exceeds max`);
        assert.ok(bounds.width >= minimum.minWidth && bounds.height >= minimum.minHeight, `${label}: below min`);
        assert.ok(minimum.minWidth <= work.width && minimum.minHeight <= work.height, `${label}: minimum larger than the screen`);
        assert.ok(Math.abs(bounds.x + bounds.width / 2 - (work.x + work.width / 2)) <= 1
            && Math.abs(bounds.y + bounds.height / 2 - (work.y + work.height / 2)) <= 1, `${label}: not centered`);
        assert.ok([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger), `${label}: fractional bounds`);
    }
    assert.deepEqual(defaultMainWindowBounds(area(3840, 2120)), { x: 1200, y: 610, width: 1440, height: 900 }, 'large screens use the max size');
    const laptop = defaultMainWindowBounds(area(1366, 728));
    assert.ok(laptop.width < 1366 && laptop.height < 728, 'a laptop keeps visible desktop around the window');
    assert.deepEqual(mainWindowMinimumSize(area(800, 560)), { minWidth: 360, minHeight: 420 });
    assert.deepEqual(mainWindowMinimumSize(area(320, 380)), { minWidth: 320, minHeight: 380 });
});

test('restored windows are fitted to the work area like VS Code validateWindowState', () => {
    const work = area(1920, 1040);
    assert.deepEqual(fitWindowToWorkArea({ x: 100, y: 80, width: 1200, height: 800 }, work), { x: 100, y: 80, width: 1200, height: 800 });
    assert.deepEqual(fitWindowToWorkArea({ x: -400, y: -50, width: 2600, height: 1600 }, work), { x: 0, y: 0, width: 1920, height: 1040 });
    assert.deepEqual(fitWindowToWorkArea({ x: 1880, y: 1000, width: 900, height: 600 }, work), { x: 1020, y: 440, width: 900, height: 600 });
    assert.equal(fitWindowToWorkArea({ x: 0, y: 0, width: 0, height: 600 }, work), undefined);
    assert.equal(fitWindowToWorkArea({ x: Number.NaN, y: 0, width: 800, height: 600 }, work), undefined);
});

test('Electron main uses adaptive bounds instead of a fixed config size or a post-create resize', async () => {
    const main = await readFile(new URL('../src/electron-main/nextmux-electron-main-module.ts', import.meta.url), 'utf8');
    assert.match(main, /getDefaultTheiaWindowBounds\(\)[\s\S]*?defaultMainWindowBounds\(this\.getDisplayForNewWindow\(\)\.workArea\)/);
    assert.match(main, /getDefaultOptions\(\)[\s\S]*?width: _width, height: _height[\s\S]*?mainWindowMinimumSize/);
    assert.match(main, /getLastWindowOptions\(\)[\s\S]*?fitWindowToWorkArea/);
    const desktop = JSON.parse(await readFile(new URL('../../../apps/desktop/package.json', import.meta.url), 'utf8'));
    const options = desktop.theia.frontend.config.electron.windowOptions;
    assert.equal(options.width, undefined); assert.equal(options.height, undefined);
    const bootstrap = await readFile(new URL('../../../apps/desktop/bootstrap.cjs', import.meta.url), 'utf8');
    assert.doesNotMatch(bootstrap, /setBounds\(/, 'no visible resize jump after the window is shown');
});
