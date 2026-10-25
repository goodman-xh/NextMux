import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdtemp, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { withComicMediaFilesArchiveLock } from '../lib/node/nextmux-comic-media-files-archive.js';

function waitForChild(child, stage) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`child did not reach ${stage}`)); }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onError = error => { cleanup(); reject(error); };
    const onExit = code => { cleanup(); reject(new Error(`child exited at ${stage}: ${code}`)); };
    const onMessage = message => {
      if (message?.stage === 'error') { cleanup(); reject(new Error(message.message)); }
      else if (message?.stage === stage) { cleanup(); resolve(message); }
    };
    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

test('a former media archive lock owner cannot publish or release a replacement process lock', { timeout: 20_000 }, async () => {
  // Preserve this small isolated fixture under the OS temporary directory; no user media is removed.
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-comic-media-lock-ownership-'));
  const workspace = join(sandbox, 'workspace');
  const lockPath = `${workspace}.lock`;
  await mkdir(workspace);
  const modulePath = fileURLToPath(new URL('../lib/node/nextmux-comic-media-files-archive.js', import.meta.url));
  const childSource = String.raw`
    (async () => {
      const { withComicMediaFilesArchiveLock } = require(process.argv[1]);
      await withComicMediaFilesArchiveLock(process.argv[2], async (_root, assertOwned) => {
        process.send({ stage: 'entered' });
        await new Promise(resolve => process.once('message', resolve));
        let verdict = 'accepted';
        try { assertOwned(); } catch (error) { verdict = error.code || error.message; }
        process.send({ stage: 'verdict', verdict });
      });
      process.disconnect();
    })().catch(error => { process.send({ stage: 'error', message: String(error.stack || error) }); process.exitCode = 1; });
  `;
  let child;
  let oldOwnerContinued = false;
  let oldOwnerError;
  try {
    try {
      await withComicMediaFilesArchiveLock(workspace, async (_root, assertOwned) => {
        await rename(lockPath, `${lockPath}.preserved`);
        child = spawn(process.execPath, ['-e', childSource, modulePath, workspace], {
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        await waitForChild(child, 'entered');
        assertOwned();
        oldOwnerContinued = true;
      });
    } catch (error) { oldOwnerError = error; }
    assert.ok(child);
    const newOwnerLockSurvived = Boolean(await lstat(lockPath).catch(() => undefined));
    const verdict = waitForChild(child, 'verdict');
    child.send('finish');
    const newOwner = await verdict;
    assert.equal(oldOwnerContinued, false);
    assert.equal(oldOwnerError?.code, 'COMIC_MEDIA_BUSY');
    assert.equal(newOwnerLockSurvived, true, 'former owner release must preserve the new process lock');
    assert.equal(newOwner.verdict, 'accepted');
  } finally {
    if (child && child.exitCode === null) child.kill();
  }
});
