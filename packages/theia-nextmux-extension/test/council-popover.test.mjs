import test from 'node:test';
import assert from 'node:assert/strict';
import { councilPopoverPlacement } from '../lib/browser/nextmux-council-popover.js';

test('Council menu stays clear of the dialog header/footer and adapts to the available side', () => {
    const bounds = { left: 100, top: 120, width: 700, bottom: 600 };
    const first = councilPopoverPlacement({ left: 130, top: 140, bottom: 176, width: 240 }, bounds, 360);
    assert.equal(first.up, false);
    assert.equal(first.top, 182);
    const last = councilPopoverPlacement({ left: 500, top: 560, bottom: 596, width: 240 }, bounds, 360);
    assert.equal(last.up, true);
    assert.equal(last.left, 440);
    assert.equal(last.top + last.maxHeight, 554);
    for (const value of [first, last]) {
        assert.ok(value.top >= bounds.top);
        assert.ok(value.top + value.maxHeight <= bounds.bottom);
        assert.ok(value.left + value.width <= bounds.left + bounds.width);
    }
});

test('narrow viewport, scrolled-away anchors and short menus stay within visible dialog bounds', () => {
    const bounds = { left: 16, top: 110, width: 288, bottom: 280 };
    for (const top of [-400, 80, 130, 240, 500]) {
        const value = councilPopoverPlacement({ left: 240, top, bottom: top + 36, width: 140 }, bounds, 360);
        assert.equal(value.width, 288);
        assert.equal(value.left, 16);
        assert.ok(value.top >= bounds.top);
        assert.ok(value.top + value.maxHeight <= bounds.bottom);
    }
    const short = councilPopoverPlacement({ left: 20, top: 250, bottom: 280, width: 140 }, bounds, 250, 72);
    assert.equal(short.maxHeight, 72);
    assert.equal(short.top + short.maxHeight, 244);
});
