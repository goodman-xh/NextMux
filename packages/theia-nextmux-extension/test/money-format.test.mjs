import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatBalanceMicros, walletNetBalanceMicros } from '../lib/browser/nextmux-money-format.js';

test('balances round down to the smallest currency unit and never overstate funds', () => {
  assert.equal(formatBalanceMicros('en', 'USD', 4_996_000), '$4.99');
  assert.equal(formatBalanceMicros('en', 'USD', 4_999_999), '$4.99');
  assert.equal(formatBalanceMicros('en', 'USD', 5_000_000), '$5.00');
  assert.equal(formatBalanceMicros('en', 'USD', 4_000), '$0.00');
  assert.equal(formatBalanceMicros('en', 'USD', -1_004_000), '-$1.01', 'a debt is never shown smaller than it is');
  assert.equal(formatBalanceMicros('ja', 'JPY', 1_999_000_000), '￥1,999');
  assert.equal(formatBalanceMicros('en', 'NOT-A-CODE', 1_234_000), 'NOT-A-CODE 1.23');
});

test('every wallet balance on screen uses the rounded-down format', () => {
  const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(widget, /maximumFractionDigits: 2 \}\)\.format\(wallet\.availableMicros/);
  assert.equal((widget.match(/formatBalanceMicros\(this\.desktopLocale, wallet\.currency, walletNetBalanceMicros\(wallet\)\)/g) || []).length, 2);
});


test('actual balance includes reservations and preserves verified debt without changing admission funds', () => {
  const wallet = { availableMicros: 0, reservedMicros: 5_000_000 };
  assert.equal(walletNetBalanceMicros(wallet), 5_000_000);
  assert.equal(walletNetBalanceMicros({ ...wallet, usageDebtMicros: 7_000_000 }), -2_000_000);
  assert.equal(walletNetBalanceMicros({ ...wallet, usageInFlightMicros: 1_000_000 }), 4_000_000);
  assert.equal(walletNetBalanceMicros({ ...wallet, netBalanceMicros: 0 }), 0);
  assert.equal(walletNetBalanceMicros({ ...wallet, netBalanceMicros: -100 }), -100);
  assert.equal(walletNetBalanceMicros({ ...wallet, netBalanceMicros: NaN }), 5_000_000);
  assert.equal(wallet.availableMicros, 0, 'display conversion must not expose held funds for new admission');
});
