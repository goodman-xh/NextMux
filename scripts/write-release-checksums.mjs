#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const releaseDirectory = join(repositoryRoot, 'apps', 'desktop', 'release');
const desktopPackage = JSON.parse(await readFile(join(repositoryRoot, 'apps', 'desktop', 'package.json'), 'utf8'));
const artifactPrefix = `NextMux-${desktopPackage.version}-`;
const prereleaseChannel = desktopPackage.version.includes('-')
  ? desktopPackage.version.slice(desktopPackage.version.indexOf('-') + 1).split('.')[0]
  : 'latest';
const requestedProfile = process.argv[2];

if (!requestedProfile || !/^(windows|macos)-(x64|arm64|native)$/.test(requestedProfile)) {
  throw new Error('Usage: node scripts/write-release-checksums.mjs <windows|macos>-<x64|arm64|native>');
}

const [platform, requestedArch] = requestedProfile.split('-');
const arch = requestedArch === 'native' ? process.arch : requestedArch;
if (!['x64', 'arm64'].includes(arch)) {
  throw new Error(`Unsupported release architecture: ${arch}`);
}
const profile = `${platform}-${arch}`;

function matches(name) {
  const updateManifest = `${prereleaseChannel}${platform === 'macos' ? '-mac' : ''}.yml`;
  if (name === updateManifest) return true;
  if (!name.startsWith(artifactPrefix)) return false;
  if (platform === 'windows') {
    return name.includes(`-${arch}-`) && (name.endsWith('.exe') || name.endsWith('.exe.blockmap'));
  }
  return name.includes(`-${arch}.`)
    && (name.endsWith('.dmg') || name.endsWith('.zip') || name.endsWith('.zip.blockmap'));
}

async function sha256(pathname) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(pathname)) hash.update(chunk);
  return hash.digest('hex');
}

const names = (await readdir(releaseDirectory)).filter(matches).sort((left, right) => left.localeCompare(right));
if (!names.length) throw new Error(`No ${profile} release artifacts found in ${releaseDirectory}`);

const lines = [];
for (const name of names) {
  lines.push(`${await sha256(join(releaseDirectory, name))} *${name}`);
}

const output = join(releaseDirectory, `SHA256SUMS-${profile}.txt`);
const temporary = `${output}.tmp`;
await writeFile(temporary, `${lines.join('\n')}\n`, { encoding: 'ascii' });
await rename(temporary, output);
console.log(output);
