import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { DESKTOP_RELEASE_TARGETS } from '../../../scripts/desktop-release-targets.mjs';

const matrix = await readFile(new URL('../../../docs/TERMINAL_DISTRIBUTION_MATRIX.md', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = await readFile(new URL('../../../.github/workflows/desktop-release.yml', import.meta.url), 'utf8');
const resolver = await readFile(new URL('../../../packages/theia-nextmux-extension/src/node/nextmux-terminal-profile-resolver.ts', import.meta.url), 'utf8');
const platformService = await readFile(new URL('../../../packages/theia-nextmux-extension/src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');

test('distribution contract covers every consumer OS and architecture without treating CI as hardware certification', () => {
  for (const target of [
    'Windows 10 x64',
    'Windows 11 x64',
    'Windows 10 ARM64',
    'Windows 11 ARM64',
    'macOS 12+ Intel',
    'macOS 12+ Apple Silicon'
  ]) assert.match(matrix, new RegExp(target.replace('+', '\\+')));

  assert.match(matrix, /## 6\. CI 可验证项/);
  assert.match(matrix, /## 7\. 必须真实硬件认证的项目/);
  assert.match(matrix, /HARDWARE-PENDING/);
  assert.match(matrix, /windows-2025[^\n]*x64/);
  assert.match(matrix, /windows-11-arm[^\n]*arm64/);
  assert.match(matrix, /macos-26-intel[^\n]*x64/);
  assert.match(matrix, /macos-26[^\n]*ARM64/);
  assert.equal(packageJson.build.mac.minimumSystemVersion, '12.0');
  assert.deepEqual(
    DESKTOP_RELEASE_TARGETS.map(target => `${target.platform}-${target.arch}:${target.runner}`),
    [
      'windows-x64:windows-2025',
      'windows-arm64:windows-11-arm',
      'macos-x64:macos-26-intel',
      'macos-arm64:macos-26',
    ],
  );
  assert.match(workflow, /desktop-release-targets\.mjs --github-output/);
});

test('Windows shell and WSL claims stay aligned with fail-closed target-machine discovery', () => {
  for (const shell of ['PowerShell 7', 'Windows PowerShell', 'Command Prompt', 'Git Bash', 'WSL distribution']) {
    assert.match(matrix, new RegExp(shell));
  }
  assert.match(matrix, /wsl\.exe[^\n]*存在不等于 WSL 已安装完成/);
  assert.match(matrix, /setup_required/);
  assert.match(matrix, /禁止把“真实 WSL”私自塞进安装 EXE 或便携 EXE/);
  assert.match(resolver, /wslDistributions\.length \? 'ready' : 'setup_required'/);
  assert.match(resolver, /\['-d', distribution\]/);
  assert.match(platformService, /\['--list', '--quiet'\]/);
});

test('macOS contract preserves the account login shell and probes zsh, bash, and fish on both architectures', () => {
  assert.match(matrix, /os\.userInfo\(\)\.shell/);
  assert.match(matrix, /PATH 中实际存在的 `zsh`、`bash`、`fish`/);
  assert.match(matrix, /Intel 写死 `\/usr\/local`/);
  assert.match(matrix, /Apple Silicon 写死 `\/opt\/homebrew`/);
  assert.match(resolver, /path: options\.accountShell, source: 'account'/);
  assert.match(resolver, /\['zsh', 'bash', 'fish', 'pwsh', 'nu'\]/);
  assert.match(resolver, /shellKind === 'powershell' \? \['-NoLogo'\] : \['-l'\]/);
  assert.match(platformService, /accountShell = userInfo\(\)\.shell/);
  assert.match(platformService, /readFile\('\/etc\/shells'/);
});

test('contract cites official platform owners for every external release boundary', () => {
  for (const origin of [
    'https://learn.microsoft.com/',
    'https://github.com/microsoft/node-pty/',
    'https://www.electronjs.org/',
    'https://www.electron.build/',
    'https://docs.github.com/',
    'https://support.apple.com/',
    'https://nodejs.org/',
    'https://fishshell.com/'
  ]) assert.match(matrix, new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
