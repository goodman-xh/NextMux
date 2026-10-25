#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const manifestPath = fileURLToPath(new URL('../config/desktop-release-targets.json', import.meta.url));

function fail(message) {
  throw new Error(`Invalid desktop release target manifest: ${message}`);
}

function nonEmptyString(value, field, index) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} at index ${index} must be a non-empty string`);
  return value.trim();
}

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('root must be an object');
  if (value.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (!Array.isArray(value.targets) || value.targets.length !== 4) fail('exactly four targets are required');

  const ids = new Set();
  const combinations = new Set();
  const targets = value.targets.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`target ${index} must be an object`);
    const id = nonEmptyString(raw.id, 'id', index);
    const platform = nonEmptyString(raw.platform, 'platform', index);
    const arch = nonEmptyString(raw.arch, 'arch', index);
    const runner = nonEmptyString(raw.runner, 'runner', index);
    if (ids.has(id)) fail(`duplicate target id ${id}`);
    ids.add(id);
    if (platform !== 'windows' && platform !== 'macos') fail(`${id} has unsupported platform ${platform}`);
    if (arch !== 'x64' && arch !== 'arm64') fail(`${id} has unsupported architecture ${arch}`);
    const combination = `${platform}-${arch}`;
    if (combinations.has(combination)) fail(`duplicate platform/architecture ${combination}`);
    combinations.add(combination);
    if (id !== combination) fail(`${id} must equal ${combination}`);
    return Object.freeze({ id, platform, arch, runner });
  });

  for (const combination of ['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64']) {
    if (!combinations.has(combination)) fail(`missing target ${combination}`);
  }
  return Object.freeze(targets);
}

const parsedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
export const DESKTOP_RELEASE_TARGETS = validateManifest(parsedManifest);

export function desktopReleaseMatrix(platform) {
  if (platform !== 'windows' && platform !== 'macos') fail(`cannot create a matrix for ${platform}`);
  return {
    include: DESKTOP_RELEASE_TARGETS
      .filter(target => target.platform === platform)
      .map(({ id, runner, arch }) => ({ id, runner, arch })),
  };
}

function writeGitHubOutput(name, value) {
  const line = `${name}=${JSON.stringify(value)}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line, 'utf8');
  else process.stdout.write(line);
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  if (process.argv.includes('--github-output')) {
    writeGitHubOutput('windows', desktopReleaseMatrix('windows'));
    writeGitHubOutput('macos', desktopReleaseMatrix('macos'));
  } else {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, targets: DESKTOP_RELEASE_TARGETS }, null, 2)}\n`);
  }
}
