'use strict';

const { access, readdir, readFile } = require('node:fs/promises');
const { constants } = require('node:fs');
const { platform } = require('node:os');
const { join } = require('node:path');

function asDrive(path, description = 'Mounted volume') {
  return {
    blockSize: 0,
    busType: 'UNKNOWN',
    busVersion: null,
    description,
    device: path,
    devicePath: path,
    enumerator: 'nextmux-portable',
    error: null,
    isCard: null,
    isReadOnly: false,
    isRemovable: false,
    isSCSI: null,
    isSystem: path === '/' || /^[A-Za-z]:\\$/.test(path),
    isUAS: null,
    isUSB: null,
    isVirtual: null,
    logicalBlockSize: 0,
    mountpoints: [{ path, label: null }],
    raw: '',
    size: null,
    partitionTableType: null
  };
}

async function canRead(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function listWindows() {
  const candidates = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
  const readable = await Promise.all(candidates.map(async path => ({ path, readable: await canRead(path) })));
  return readable.filter(candidate => candidate.readable).map(candidate => asDrive(candidate.path, 'Windows volume'));
}

async function listDarwin() {
  const paths = ['/'];
  try {
    const entries = await readdir('/Volumes', { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        paths.push(join('/Volumes', entry.name));
      }
    }
  } catch {
    // A sandbox may not expose /Volumes. The root mount remains usable.
  }
  return paths.map(path => asDrive(path, 'macOS volume'));
}

async function listLinux() {
  const paths = new Set(['/']);
  try {
    const mounts = await readFile('/proc/self/mounts', 'utf8');
    for (const line of mounts.split('\n')) {
      const mountpoint = line.split(' ')[1]?.replaceAll('\\040', ' ');
      if (mountpoint && (mountpoint.startsWith('/mnt/') || mountpoint.startsWith('/media/') || mountpoint.startsWith('/run/media/'))) {
        paths.add(mountpoint);
      }
    }
  } catch {
    // Root is a safe minimum in restricted/container environments.
  }
  return [...paths].map(path => asDrive(path, 'Linux volume'));
}

async function list() {
  switch (platform()) {
    case 'win32': return listWindows();
    case 'darwin': return listDarwin();
    case 'linux': return listLinux();
    default: return [];
  }
}

module.exports = { list };
