'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { list } = require('./index.js');

test('returns readable mount points without native bindings', async () => {
  const drives = await list();
  assert.ok(drives.length >= 1);
  for (const drive of drives) {
    assert.ok(Array.isArray(drive.mountpoints));
    assert.ok(drive.mountpoints.every(mount => typeof mount.path === 'string'));
  }
});
