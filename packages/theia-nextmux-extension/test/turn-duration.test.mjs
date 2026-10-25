import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const duration = require('../lib/browser/nextmux-turn-duration.js');

test('reply durations use fixed-width clock digits', () => {
    assert.equal(duration.formatTurnDuration(0), '0:00');
    assert.equal(duration.formatTurnDuration(7_400), '0:07');
    assert.equal(duration.formatTurnDuration(83_000), '1:23');
    assert.equal(duration.formatTurnDuration(3_723_000), '1:02:03');
    assert.equal(duration.formatTurnDuration(-5), '0:00');
});

test('the tooltip says what the number is in the interface language', () => {
    assert.match(duration.turnDurationLabel('zh-CN', 'took', 83_000), /^本轮用时 /);
    assert.match(duration.turnDurationLabel('en', 'running', 5_000), /^Running for /);
});

test('every AI reply shows its duration: live while running, fixed once finished, and rebases createdAt when resumed', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /stage === 'running' \? <div className='nmx-turn-copy is-running'><TurnDuration locale=\{this\.desktopLocale\} startedAt=\{turn\.createdAt\} \/>/);
    assert.match(source, /turn\.completedAt && <TurnDuration locale=\{this\.desktopLocale\} startedAt=\{turn\.createdAt\} endedAt=\{turn\.completedAt\} \/>/);
    assert.match(source, /const priorElapsedMs = codingTurn\.completedAt !== undefined && codingTurn\.completedAt > codingTurn\.createdAt\s*\?\s*codingTurn\.completedAt - codingTurn\.createdAt\s*:\s*0/);
    assert.match(source, /const resumedCreatedAt = Math\.max\(1, Date\.now\(\) - priorElapsedMs\)/);
});
