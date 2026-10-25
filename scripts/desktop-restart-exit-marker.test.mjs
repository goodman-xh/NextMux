import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { observeE2eAppExit } from './desktop-terminal-ci-e2e.mjs';
import { desktopText } from '../packages/theia-nextmux-extension/lib/browser/nextmux-locale.js';

test('restart evidence comes only from the owned child exit and preserves code/signal', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmx-exit-marker-'));
  try {
    const marker = join(root, 'exit.json'), child = new EventEmitter();
    observeE2eAppExit(child, marker, () => false, error => { throw error; });
    assert.equal(existsSync(marker), false);
    child.emit('exit', 0, null);
    assert.deepEqual({ ...JSON.parse(readFileSync(marker)), exitedAt: 0 }, { code: 0, signal: null, exitedAt: 0 });
    child.emit('exit', null, 'SIGKILL');
    assert.equal(JSON.parse(readFileSync(marker)).code, 0);
    const killed = join(root, 'killed.json'), other = new EventEmitter();
    observeE2eAppExit(other, killed, () => false, error => { throw error; });
    other.emit('exit', null, 'SIGTERM');
    assert.equal(JSON.parse(readFileSync(killed)).signal, 'SIGTERM');
  } finally { rmSync(root, { recursive: true }); }
});

test('cleanup cannot manufacture exit evidence and an existing marker is never overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmx-exit-marker-'));
  try {
    const marker = join(root, 'exit.json'), child = new EventEmitter();
    let error;
    observeE2eAppExit(child, marker, () => true, value => { error = value; });
    child.emit('exit', null, 'SIGTERM');
    assert.equal(existsSync(marker), false);
    writeFileSync(marker, 'preserve', { flag: 'wx' });
    const next = new EventEmitter();
    observeE2eAppExit(next, marker, () => false, value => { error = value; });
    next.emit('exit', 0, null);
    assert.equal(error.code, 'EEXIST');
    assert.equal(readFileSync(marker, 'utf8'), 'preserve');
  } finally { rmSync(root, { recursive: true }); }
  const source = readFileSync(new URL('./desktop-terminal-ci-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /NEXTMUX_DESKTOP_E2E_APP_EXIT_MARKER: appExitMarker/);
  assert.match(source, /observeE2eAppExit\(application, appExitMarker, \(\) => stopping/);
});

test('restart fixture hydration precedes mutating sidebar clicks and verifies a normal app exit', () => {
  const source = readFileSync(new URL('./desktop-restart-persistence-e2e.mjs', import.meta.url), 'utf8');
  const reload = source.indexOf('await reloadDesktopDocument');
  const durable = source.indexOf('stale Windows fixture durably restored before sidebar interaction', reload);
  const sidebar = source.indexOf("document.querySelectorAll('.nmx-project-row", reload);
  assert.ok(reload > 0 && durable > reload && sidebar > durable);
  assert.match(source, /value\?\.id === sessionId\s*&& value\.workspacePath === staleWorkspace/);
  assert.match(source, /assert\.equal\(firstExit\.code, 0/);
  assert.match(source, /assert\.equal\(firstExit\.signal, null/);
  assert.ok(source.indexOf("await mkdir(join(profile, 'logs')") < source.indexOf('secondProcess = launchNextMuxDesktop'));
  assert.equal(desktopText('en', 'recharge'), 'Add funds');
  assert.match(source, /assert\.equal\(linkedModelCenter\.accountText, desktopText\(restoredLocale, 'recharge'\)\)/);
  assert.match(source, /assert\.equal\(linkedSettings\.action, localizeDesktopSurface\(restoredLocale, '管理账户'\)\)/);
});
