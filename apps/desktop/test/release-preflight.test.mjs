import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReleaseEnvironment } from '../../../scripts/verify-desktop-release-environment.mjs';

const common = {
  platform: 'win32',
  arch: 'x64',
  signed: false,
  tag: 'v1.2.3',
  rootVersion: '1.2.3',
  desktopVersion: '1.2.3',
  environment: {},
  hostPlatform: 'win32',
  hostArch: 'x64',
};

test('release preflight requires native OS and architecture', () => {
  assert.throws(() => validateReleaseEnvironment({ ...common, hostPlatform: 'darwin' }), /target OS/);
  assert.throws(() => validateReleaseEnvironment({ ...common, hostArch: 'arm64' }), /built natively/);
});

test('release preflight requires exact package/tag version equality', () => {
  assert.throws(() => validateReleaseEnvironment({ ...common, tag: 'v1.2.4' }), /does not match desktop version/);
  assert.throws(() => validateReleaseEnvironment({ ...common, desktopVersion: '1.2.4' }), /package versions must match/);
});

test('signed Windows preflight requires certificate and updater publisher identity', () => {
  assert.throws(() => validateReleaseEnvironment({ ...common, signed: true }), /WIN_CSC_LINK/);
  const environment = { WIN_CSC_LINK: 'certificate', WIN_CSC_KEY_PASSWORD: 'password' };
  assert.throws(() => validateReleaseEnvironment({ ...common, signed: true, environment }), /WINDOWS_PUBLISHER_NAME/);
  assert.equal(validateReleaseEnvironment({
    ...common,
    signed: true,
    environment: { ...environment, WINDOWS_PUBLISHER_NAME: 'Example Publisher' },
  }).signingCredentialMode, 'authenticode');
});

test('signed macOS preflight accepts API-key notarization credentials', () => {
  const report = validateReleaseEnvironment({
    ...common,
    platform: 'darwin',
    arch: 'arm64',
    hostPlatform: 'darwin',
    hostArch: 'arm64',
    signed: true,
    environment: {
      CSC_LINK: 'certificate',
      CSC_KEY_PASSWORD: 'password',
      APPLE_API_KEY: 'AuthKey.p8',
      APPLE_API_KEY_ID: 'KEYID',
      APPLE_API_ISSUER: 'ISSUER',
      APPLE_TEAM_ID: 'TEAMID1234',
    },
  });
  assert.equal(report.signingCredentialMode, 'app-store-connect-api-key');
});

test('signed macOS preflight requires the expected Apple Team ID in every notarization mode (B18-09)', () => {
  assert.throws(() => validateReleaseEnvironment({
    ...common, platform: 'darwin', arch: 'arm64', hostPlatform: 'darwin', hostArch: 'arm64', signed: true,
    environment: { CSC_LINK: 'certificate', CSC_KEY_PASSWORD: 'password', APPLE_KEYCHAIN: 'build.keychain', APPLE_KEYCHAIN_PROFILE: 'notary' },
  }), /APPLE_TEAM_ID/);
});
