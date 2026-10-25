import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopAccountIdentity } from '../lib/browser/nextmux-account-identity.js';

test('account dock shows exactly one meaningful identity', () => {
    assert.equal(desktopAccountIdentity(false, undefined, '未登录'), '未登录');
    assert.equal(desktopAccountIdentity(true, { displayName: 'Alice', email: 'alice@example.com' }, '未登录'), 'Alice');
    assert.equal(desktopAccountIdentity(true, { displayName: ' status label ', email: 'xinwoteam1@gmail.com' }, '未登录'), 'xinwoteam1');
    assert.equal(desktopAccountIdentity(true, { displayName: 'Account Connected', email: 'member@example.com' }, 'Signed out'), 'member');
    assert.equal(desktopAccountIdentity(true, { email: 'member@example.com' }, 'Signed out'), 'member');
});
