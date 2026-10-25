#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function present(environment, name) {
  return typeof environment[name] === 'string' && environment[name].trim().length > 0;
}

function requirePair(environment, first, second, label) {
  assert.ok(present(environment, first), `${label}: ${first} is required`);
  assert.ok(present(environment, second), `${label}: ${second} is required`);
}

export function validateReleaseEnvironment(options) {
  const {
    platform,
    arch,
    signed,
    tag,
    rootVersion,
    desktopVersion,
    environment = process.env,
    hostPlatform = process.platform,
    hostArch = process.arch,
  } = options;

  assert.ok(['win32', 'darwin'].includes(platform), `Unsupported release platform: ${platform}`);
  assert.ok(['x64', 'arm64'].includes(arch), `Unsupported release architecture: ${arch}`);
  assert.equal(hostPlatform, platform,
    `Desktop artifacts must be built on their target OS (${platform}), not ${hostPlatform}`);
  assert.equal(hostArch, arch,
    `Desktop artifacts must be built natively for ${arch}, not by a ${hostArch} Node process`);
  assert.equal(desktopVersion, rootVersion, 'root and desktop package versions must match');

  if (tag) {
    assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `Release tag is not a supported semver tag: ${tag}`);
    assert.equal(tag, `v${desktopVersion}`,
      `Release tag ${tag} does not match desktop version ${desktopVersion}`);
  }

  if (signed && platform === 'win32') {
    assert.ok(present(environment, 'WIN_CSC_LINK') || present(environment, 'CSC_LINK'),
      'Windows Authenticode: WIN_CSC_LINK or CSC_LINK is required');
    assert.ok(present(environment, 'WIN_CSC_KEY_PASSWORD') || present(environment, 'CSC_KEY_PASSWORD'),
      'Windows Authenticode: WIN_CSC_KEY_PASSWORD or CSC_KEY_PASSWORD is required');
    const link = present(environment, 'WIN_CSC_LINK') ? 'WIN_CSC_LINK' : 'CSC_LINK';
    const password = present(environment, 'WIN_CSC_KEY_PASSWORD')
      ? 'WIN_CSC_KEY_PASSWORD'
      : 'CSC_KEY_PASSWORD';
    requirePair(environment, link, password, 'Windows Authenticode');
    assert.ok(present(environment, 'WINDOWS_PUBLISHER_NAME'),
      'Windows Authenticode: WINDOWS_PUBLISHER_NAME is required for updater signature verification');
  }

  if (signed && platform === 'darwin') {
    requirePair(environment, 'CSC_LINK', 'CSC_KEY_PASSWORD', 'macOS Developer ID signing');
    const hasApiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
      .every(name => present(environment, name));
    const hasAppleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
      .every(name => present(environment, name));
    const hasKeychainProfile = ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE']
      .every(name => present(environment, name));
    assert.ok(hasApiKey || hasAppleId || hasKeychainProfile,
      'macOS notarization requires an App Store Connect API key, Apple ID credentials, or a keychain profile');
    // The signature check of every signed build compares against the expected team, whichever way it was notarized.
    assert.ok(present(environment, 'APPLE_TEAM_ID'),
      'macOS signing: APPLE_TEAM_ID is required to verify the Developer ID team of the built app');
  }

  return {
    platform,
    architecture: arch,
    signed,
    version: desktopVersion,
    tag: tag || null,
    signingCredentialMode: !signed ? 'unsigned-test-build'
      : platform === 'win32' ? 'authenticode'
        : present(environment, 'APPLE_API_KEY') ? 'app-store-connect-api-key'
          : present(environment, 'APPLE_ID') ? 'apple-id'
            : 'keychain-profile',
  };
}

async function main() {
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: verify-desktop-release-environment.mjs --platform <win32|darwin> --arch <x64|arm64> --signed <true|false> [--tag vX.Y.Z]');
    }
    values.set(key.slice(2), value);
  }
  const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const desktopPackage = JSON.parse(await readFile(join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
  const report = validateReleaseEnvironment({
    platform: values.get('platform'),
    arch: values.get('arch'),
    signed: values.get('signed') === 'true',
    tag: values.get('tag') || '',
    rootVersion: rootPackage.version,
    desktopVersion: desktopPackage.version,
  });
  console.log(JSON.stringify(report, undefined, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
