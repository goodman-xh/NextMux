import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopAccountLinkCoordinator } from '../lib/browser/nextmux-account-link.js';

const nonce = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const deepLink = `nextmux://device-link/complete?nonce=${nonce}`;

test('deep-link completion refreshes the unified desktop account immediately and cancels polling', async () => {
  const timers = new Map();
  let timerId = 0;
  let completedNonce = '';
  let polled = 0;
  const sessions = [];
  const coordinator = new DesktopAccountLinkCoordinator({
    complete: async value => {
      completedNonce = value;
      return { linked: true, user: { id: 'user-1', email: 'buyer@example.com', displayName: 'Buyer', locale: 'en' }, wallets: [] };
    },
    poll: async () => { polled += 1; return { linked: false, wallets: [] }; },
    accept: session => sessions.push(session),
    reportError: error => assert.fail(String(error)),
    setTimer: callback => { timerId += 1; timers.set(timerId, callback); return timerId; },
    clearTimer: id => timers.delete(id),
    now: () => 1_000,
  });

  coordinator.start({ code: '1234-5678', verificationUrl: 'https://nextmux.app/connect-device?code=1234-5678', expiresAt: 601_000 });
  assert.equal(timers.size, 1, 'polling is retained only as a fallback');
  assert.equal(await coordinator.handleDeepLink(deepLink), true);
  assert.equal(completedNonce, nonce);
  assert.equal(polled, 0, 'successful callback must not wait for polling');
  assert.equal(sessions.at(-1).user.id, 'user-1');
  assert.equal(timers.size, 0, 'successful callback cancels the fallback');
});

test('fallback polling is cancellable and ignores callbacks outside the strict allowlist', async () => {
  const timers = new Map();
  let nextTimer = 0;
  let completeCalls = 0;
  const coordinator = new DesktopAccountLinkCoordinator({
    complete: async () => { completeCalls += 1; return { linked: false, wallets: [] }; },
    poll: async () => ({ linked: false, wallets: [] }),
    accept: () => undefined,
    reportError: () => undefined,
    setTimer: callback => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; },
    clearTimer: id => timers.delete(id),
    now: () => 1_000,
  });
  coordinator.start({ code: '1234-5678', verificationUrl: 'https://nextmux.app/connect-device?code=1234-5678', expiresAt: 601_000 });
  assert.equal(await coordinator.handleDeepLink('nextmux://device-link/other?nonce=' + nonce), false);
  assert.equal(completeCalls, 0);
  coordinator.cancel();
  assert.equal(timers.size, 0);
});
