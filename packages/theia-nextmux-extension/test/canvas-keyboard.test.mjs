import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const source = (await readFile(new URL('../src/browser/nextmux-comic-canvas-keyboard.ts', import.meta.url), 'utf8')).replace(/^import .*React.*\n/m, '');
const code = desktop('esbuild').transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, React: {} });
const { canvasShortcut, canvasNavigationStep } = module.exports;
const event = (key, extra = {}) => ({ key, keyCode: 0, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
test('canvas command mapping accepts both platforms and excludes IME and AltGr', () => {
    for (const mod of ['ctrlKey', 'metaKey']) for (const [key, command] of Object.entries({ a:'selectAll', c:'copy', v:'paste', d:'duplicate', z:'undo', y:'redo', g:'group', '0':'fit', '=':'zoomIn', '+':'zoomIn', '-':'zoomOut' })) assert.equal(canvasShortcut(event(key, { [mod]: true })), command);
    assert.equal(canvasShortcut(event('Z', { metaKey: true, shiftKey: true })), 'redo');
    assert.equal(canvasShortcut(event('G', { ctrlKey: true, shiftKey: true })), 'ungroup');
    for (const [key, command] of Object.entries({ Escape:'cancel', Delete:'delete', Backspace:'delete', F2:'rename', Tab:'add' })) assert.equal(canvasShortcut(event(key)), command);
    for (const extra of [{ isComposing:true }, { keyCode:229 }, { ctrlKey:true, altKey:true }]) assert.equal(canvasShortcut(event('a', { metaKey:true, ...extra })), undefined);
});
test('reference navigation is continuous screen-pixel motion with capped frame time and Shift multiplier', () => {
    const view = { x: 12, y: 20, zoom: 0.5 }, size = { width: 1000, height: 700 };
    assert.equal(canvasNavigationStep(view, new Set(['KeyW']), 0.02, size).y, 36);
    assert.equal(canvasNavigationStep(view, new Set(['KeyA']), 0.02, size, 1, 2.5, true).x, 52);
    assert.equal(canvasNavigationStep(view, new Set(['KeyD']), 4, size).x, -28);
    assert.equal(canvasNavigationStep(view, new Set(['KeyS']), 0.02, size, 2).y, -12);
    const opposite = canvasNavigationStep(view, new Set(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE']), 0.02, size);
    assert.deepEqual(JSON.parse(JSON.stringify(opposite)), view);
});
test('Q and E navigation never bind the operating-system Command/Control Q or E chords', () => {
    for (const mod of ['ctrlKey', 'metaKey']) for (const key of ['q', 'Q', 'e', 'E'])
        assert.equal(canvasShortcut(event(key, { [mod]: true })), undefined);
    for (const key of ['q', 'Q', 'e', 'E']) assert.equal(canvasShortcut(event(key)), undefined, 'plain Q/E use held navigation, not command chords');
});
test('QE zoom preserves the canvas center and clamps the actual viewport range', () => {
    const view = { x: -80, y: 20, zoom: 0.8 }, size = { width: 1000, height: 700 };
    const next = canvasNavigationStep(view, new Set(['KeyE']), 0.02, size);
    assert.ok(next.zoom > view.zoom);
    assert.ok(Math.abs((500 - next.x) / next.zoom - (500 - view.x) / view.zoom) < 1e-8);
    assert.ok(Math.abs((350 - next.y) / next.zoom - (350 - view.y) / view.zoom) < 1e-8);
    assert.equal(canvasNavigationStep({ ...view, zoom: 3 }, new Set(['KeyE']), 0.05, size).zoom, 3);
    assert.equal(canvasNavigationStep({ ...view, zoom: 0.04 }, new Set(['KeyQ']), 0.05, size).zoom, 0.04);
});
