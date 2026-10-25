#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && (!value || value.startsWith('--'))) throw new Error(`${name} requires a value`);
  return value;
}

async function walk(directory, results = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return results;
    throw error;
  }
  for (const entry of entries) {
    const pathname = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(pathname, results);
    else if (entry.isFile()) results.push(pathname);
  }
  return results;
}

async function sha256(pathname) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(pathname)) hash.update(chunk);
  return hash.digest('hex');
}

const output = resolve(argument('--output'));
const releaseDirectory = resolve(argument('--release-dir'));
const declaredPlatform = argument('--platform');
const declaredArchitecture = argument('--arch');
const files = (await walk(releaseDirectory)).sort((left, right) => left.localeCompare(right));
const artifacts = [];
for (const pathname of files) {
  const details = await stat(pathname);
  artifacts.push({
    path: relative(releaseDirectory, pathname).replaceAll('\\', '/'),
    bytes: details.size,
    sha256: await sha256(pathname),
  });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  declared: {
    platform: declaredPlatform,
    architecture: declaredArchitecture,
  },
  runner: {
    os: process.env.RUNNER_OS || null,
    architecture: process.env.RUNNER_ARCH || null,
    name: process.env.RUNNER_NAME || null,
    nodePlatform: process.platform,
    nodeArchitecture: process.arch,
    githubJob: process.env.GITHUB_JOB || null,
    githubRunId: process.env.GITHUB_RUN_ID || null,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  },
  artifacts,
};

await mkdir(dirname(output), { recursive: true });
const temporary = `${output}.tmp`;
await writeFile(temporary, `${JSON.stringify(report, undefined, 2)}\n`);
await rename(temporary, output);
console.log(output);
