'use strict';

// Native helpers share the backend's marked, disposable session directory.
// This registry never deletes a path supplied by a renderer.
const fs = require('node:fs');
const path = require('node:path');
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

function sessionContainer(id, workspaceRoot) {
  if (!UUID.test(id) || typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) throw Error('incognito_invalid_path');
  const workspace = path.resolve(workspaceRoot);
  if (fs.realpathSync(workspace) !== workspace) throw Error('incognito_symlink');
  let candidate = workspace;
  while (path.basename(candidate) !== id && path.dirname(candidate) !== candidate) candidate = path.dirname(candidate);
  const owner = path.dirname(candidate), root = path.dirname(owner);
  const match = /^owner-(\d+)-([a-f\d-]{36})$/i.exec(path.basename(owner));
  if (path.basename(candidate) !== id || path.basename(root) !== 'incognito-sessions-v1' || !match || !UUID.test(match[2])) throw Error('incognito_invalid_owner');
  const relative = path.relative(path.join(candidate, 'workspace'), workspace);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('incognito_invalid_workspace');
  for (const directory of [root, owner, candidate, path.join(candidate, 'workspace')]) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) throw Error('incognito_symlink');
  }
  const markerPath = path.join(owner, '.nextmux-incognito-owner.json'), stat = fs.lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw Error('incognito_invalid_marker');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (marker.version !== 1 || marker.kind !== 'nextmux-incognito' || marker.pid !== Number(match[1]) || marker.nonce !== match[2]) throw Error('incognito_invalid_marker');
  return candidate;
}

// The backend commits this marker before acknowledging a mode switch. Read it
// again at quit so an interrupted renderer acknowledgement cannot change which
// conversations are retained. Native code never reads the conversation body.
function privateMode(id, container) {
  const marker = path.join(container, '.nextmux-incognito-session.json');
  let stat;
  try { stat = fs.lstatSync(marker); } catch (error) {
    if (error.code === 'ENOENT') return true; // Existing private sessions predating mode switching.
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('incognito_invalid_mode');
  const value = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (value.version !== 1 || value.kind !== 'nextmux-incognito-session' || value.id !== id
      || value.incognitoOrigin !== true || !['private', 'normal'].includes(value.mode)
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Number.isSafeInteger(value.activePid) || value.activePid < 1 || !UUID.test(value.activeNonce)) throw Error('incognito_invalid_mode');
  return value.mode === 'private';
}

function createIncognitoNativeRegistry() {
  const sessions = new Map();
  return {
    register({ id, workspaceRoot } = {}, owner) {
      try {
        const container = sessionContainer(id, workspaceRoot), previous = sessions.get(id);
        privateMode(id, container);
        if (previous) return !previous.closed && previous.owner === owner && previous.container === container;
        sessions.set(id, { owner, container, workspaceRoot, closed: false, pending: new Set() });
        return true;
      } catch { return false; }
    },
    setMode({ id, workspaceRoot, enabled } = {}, owner) {
      if (typeof enabled !== 'boolean') return false;
      try {
        const container = sessionContainer(id, workspaceRoot);
        if (privateMode(id, container) !== enabled) return false;
        const previous = sessions.get(id);
        if (previous) return !previous.closed && previous.owner === owner && previous.container === container;
        sessions.set(id, { owner, container, workspaceRoot, closed: false, pending: new Set() });
        return true;
      } catch { return false; }
    },
    has(id) { return sessions.has(id); },
    owner(id) { return sessions.get(id)?.owner; },
    closed(id) { return sessions.get(id)?.closed === true; },
    acquire(id) {
      const entry = sessions.get(id);
      if (!entry) return undefined;
      if (entry.closed || sessionContainer(id, entry.workspaceRoot) !== entry.container) throw Error('incognito_session_closed');
      let done;
      const pending = new Promise(resolve => { done = resolve; });
      entry.pending.add(pending);
      let released = false;
      return {
        directory() {
          // Parent-by-parent creation rejects links instead of following them.
          let directory = entry.container;
          // Keep the native helper's existing frame-path allowlist intact.
          for (const part of ['state', 'native', 'nextmux-frames-private']) {
            directory = path.join(directory, part);
            try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
            if (!fs.lstatSync(directory).isDirectory() || fs.realpathSync(directory) !== directory) throw Error('incognito_symlink');
          }
          return directory;
        },
        release() { if (!released) { released = true; entry.pending.delete(pending); done(); } }
      };
    },
    async finish(ids, owner, stop, { applicationQuit = false } = {}) {
      if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => !UUID.test(id) || !applicationQuit && sessions.has(id) && sessions.get(id).owner !== owner)) return false;
      // The backend's quit cleanup also drains creations that were pending when
      // the renderer listed IDs. Include every native session registered since
      // that list; the main-process quit guard prevents any later registration.
      let selected;
      try {
        selected = applicationQuit ? [...sessions.keys()].filter(id => {
          const entry = sessions.get(id);
          // Already drained entries cannot contain new writes and their backend
          // directory may already be gone after a cancelled application quit.
          if (entry.closed) return false;
          return privateMode(id, sessionContainer(id, entry.workspaceRoot));
        }) : [...new Set(ids)].filter(id => sessions.has(id));
      } catch { return false; }
      const entries = selected.map(id => sessions.get(id));
      for (const entry of entries) entry.closed = true;
      try {
        await stop(selected);
        await Promise.all(entries.flatMap(entry => [...entry.pending]));
        return true;
      } catch { return false; }
    }
  };
}

module.exports = { createIncognitoNativeRegistry, sessionContainer };
