import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_PRICE_DETAIL_WIDTH, placeAdjacentFloatingPanel, placeAnchoredFloatingPanel, placeModelPickerPanels } from '../lib/browser/nextmux-floating-panel.js';

test('anchored model picker chooses a visible side and clamps its full rectangle', () => {
    assert.deepEqual(
        placeAnchoredFloatingPanel(
            { top: 120, right: 280, bottom: 152, left: 80 },
            { width: 900, height: 600 },
            264,
            178
        ),
        { side: 'below', top: 162, left: 16, width: 264, height: 178, maxHeight: 430 }
    );
    assert.deepEqual(
        placeAnchoredFloatingPanel(
            { top: 510, right: 630, bottom: 542, left: 366 },
            { width: 640, height: 560 },
            264,
            420,
            { safeTop: 72, safeBottom: 8, edge: 8, gap: 10 }
        ),
        { side: 'above', top: 80, left: 366, width: 264, height: 420, maxHeight: 428 }
    );
});

test('anchored model picker uses a short below area without escaping a tiny viewport', () => {
    const placement = placeAnchoredFloatingPanel(
        { top: 86, right: 242, bottom: 114, left: 40 },
        { width: 320, height: 180 },
        264,
        360,
        { safeTop: 56, safeBottom: 8, edge: 8, gap: 6, minHeight: 120 }
    );
    assert.equal(placement.side, 'below');
    assert.equal(placement.top, 120);
    assert.equal(placement.height, 52);
    assert.equal(placement.maxHeight, 52);
    assert.ok(placement.left >= 8);
    assert.ok(placement.left + placement.width <= 312);
});

test('reasoning panel aligns to the hovered row and chooses the side with room', () => {
    assert.deepEqual(
        placeAdjacentFloatingPanel({ top: 120, right: 280, bottom: 152, left: 80 }, { width: 900, height: 600 }, 174, 178),
        { side: 'right', top: 120, left: 287, maxHeight: 472 }
    );
    assert.deepEqual(
        placeAdjacentFloatingPanel({ top: 210, right: 872, bottom: 242, left: 650 }, { width: 900, height: 600 }, 174, 178),
        { side: 'left', top: 210, left: 469, maxHeight: 382 }
    );
});

test('reasoning panel stays inside a short viewport and remains scrollable', () => {
    const placement = placeAdjacentFloatingPanel(
        { top: 510, right: 472, bottom: 542, left: 250 },
        { width: 640, height: 560 },
        174,
        208
    );
    assert.equal(placement.top, 344);
    assert.equal(placement.maxHeight, 208);
    assert.ok(placement.left >= 8);
    assert.ok(placement.left + 174 <= 632);
});

test('long context menu uses the full short viewport instead of a 96px strip', () => {
    const placement = placeAdjacentFloatingPanel(
        { top: 470, right: 460, bottom: 500, left: 220 },
        { width: 640, height: 520 }, 190, 680
    );
    assert.equal(placement.top, 8);
    assert.equal(placement.maxHeight, 504);
});


test('model prices and the menu stay adjacent and inside narrow or wide windows without overlap', () => {
    for (const width of [320, 360, 640, 800, 1280]) for (const right of [280, width - 12]) {
        const viewport = { width, height: 600 };
        const original = placeAnchoredFloatingPanel({ left: right - 100, right, top: 480, bottom: 510 }, viewport, 264, 300);
        const { picker, detail } = placeModelPickerPanels(original, viewport);
        assert.ok(picker.left >= 8 && picker.left + picker.width <= width - 8 + 0.001);
        assert.ok(detail.left >= 8 - 0.001 && detail.left + detail.width <= width - 8 + 0.001);
        assert.ok(detail.width >= 120 && picker.width >= 120);
        const gap = detail.side === 'left' ? picker.left - detail.left - detail.width : detail.left - picker.left - picker.width;
        assert.ok(Math.abs(gap - 7) < 0.001, 'the quote is next to the list, never on top of it');
        if (width >= 264 + MODEL_PRICE_DETAIL_WIDTH + 23) assert.equal(picker.width, 264, 'ordinary windows keep the original list width');
        if (width >= 264 + MODEL_PRICE_DETAIL_WIDTH + 23) assert.equal(detail.width, MODEL_PRICE_DETAIL_WIDTH, 'both quotes fit side by side');
        if (original.left + original.width + 7 + MODEL_PRICE_DETAIL_WIDTH > width - 8) assert.equal(detail.side, 'left');
    }
});
