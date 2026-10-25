import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AgentToolRegistry } from '@nextmux/agent-runtime';
import { githubTokenKind } from '../lib/common/nextmux-github-account.js';
import { GitHubAccountError, gitHubCommandEnvironment, registerGitHubTools, verifyGitHubToken } from '../lib/node/nextmux-github-tools.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { githubAccountText, githubErrorKey } from '../lib/browser/nextmux-github-account-panel.js';

const exec = promisify(execFile);
const CLASSIC = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
const FINE = `github_pat_${'11ABCDEFG0'.repeat(8)}_x`;
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...(init.headers || {}) }, ...init });

test('only real GitHub token shapes are accepted', () => {
  assert.equal(githubTokenKind(CLASSIC), 'classic');
  assert.equal(githubTokenKind(` ${FINE} `), 'fine-grained');
  assert.equal(githubTokenKind(`gho_${'x'.repeat(36)}`), 'oauth');
  for (const value of ['', 'ghp_short', 'sk-live-123', `ghp_${'a'.repeat(36)} extra`, 'github_pat_']) assert.equal(githubTokenKind(value), undefined, value);
});

test('a token is verified with GitHub and only the account profile is kept', async () => {
  const seen = [];
  const profile = await verifyGitHubToken(async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.authorization });
    return json({ login: 'octocat', name: 'The Octocat', avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4' }, { headers: { 'x-oauth-scopes': 'repo, workflow' } });
  }, CLASSIC, 'classic');
  assert.deepEqual(seen, [{ url: 'https://api.github.com/user', auth: `Bearer ${CLASSIC}` }]);
  assert.deepEqual(profile, { login: 'octocat', tokenKind: 'classic', name: 'The Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4',
    profileUrl: 'https://github.com/octocat', scopes: ['repo', 'workflow'] });
  await assert.rejects(verifyGitHubToken(async () => new Response('{}', { status: 401 }), CLASSIC, 'classic'),
    error => error instanceof GitHubAccountError && error.code === 'GITHUB_TOKEN_INVALID');
  await assert.rejects(verifyGitHubToken(async () => { throw new TypeError('fetch failed'); }, CLASSIC, 'classic'),
    error => error instanceof GitHubAccountError && error.code === 'GITHUB_UNREACHABLE');
  assert.equal(githubErrorKey('令牌无效或已过期，请在 GitHub 重新生成'), 'errInvalid');
  assert.match(githubAccountText('en', 'errInvalid'), /invalid or expired/);
});

test('full-access commands answer git credential requests for github.com only', async t => {
  try { await exec('git', ['--version']); } catch { t.skip('git is not installed'); return; }
  const home = await mkdtemp(join(tmpdir(), 'nextmux-git-credential-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...gitHubCommandEnvironment('octocat', CLASSIC) };
  const fill = input => new Promise((resolve, reject) => {
    const child = execFile('git', ['credential', 'fill'], { env, cwd: home }, (error, stdout, stderr) => error ? resolve({ error, stdout, stderr }) : resolve({ stdout }));
    child.stdin.end(input);
    child.on('error', reject);
  });
  const github = await fill('protocol=https\nhost=github.com\npath=octo/repo.git\n\n');
  assert.match(github.stdout, /^username=octocat$/m);
  assert.match(github.stdout, new RegExp(`^password=${CLASSIC}$`, 'm'));
  const other = await fill('protocol=https\nhost=gitlab.example.test\n\n');
  assert.ok(other.error, 'no credential is offered to another host');
  assert.doesNotMatch(other.stdout || '', /ghp_/);
});

test('github.read works in every mode; github.write needs full access and stays on api.github.com', async () => {
  const calls = [];
  const registry = new AgentToolRegistry();
  registerGitHubTools(registry, { login: 'octocat', token: CLASSIC, fetch: async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body, auth: init.headers.authorization });
    if (String(url).includes('/revoked')) return new Response('{}', { status: 401 });
    return json({ number: 7, title: 'Add docs' }, { headers: { link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"' } });
  } });
  const run = (name, args, mode) => registry.execute({ id: `gh-${calls.length}-${name}`, name, arguments: args }, mode, { runId: 'github-tools-test' });
  const read = await run('github.read', { path: '/repos/o/r/pulls', query: { state: 'open', per_page: 50 } }, 'read_only');
  assert.equal(read.ok, true);
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/pulls?state=open&per_page=50');
  assert.equal(calls[0].method, 'GET');
  assert.equal(read.output.nextPage, '/repos/o/r/pulls?page=2');
  assert.ok(!JSON.stringify(read).includes(CLASSIC), 'the model never sees the token');
  const denied = await run('github.write', { method: 'POST', path: '/repos/o/r/pulls', body: { title: 'x', head: 'a', base: 'main' } }, 'workspace_write');
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'PERMISSION_DENIED');
  const created = await run('github.write', { method: 'POST', path: '/repos/o/r/pulls', body: { title: 'x', head: 'a', base: 'main' } }, 'full_access');
  assert.equal(created.ok, true);
  assert.equal(calls.at(-1).method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).body), { title: 'x', head: 'a', base: 'main' });
  for (const path of ['https://evil.test/x', '/repos/../user', '//evil.test/x', 'repos/o/r']) {
    const bad = await run('github.read', { path }, 'read_only');
    assert.equal(bad.ok, false, path);
  }
  const revoked = await run('github.read', { path: '/revoked' }, 'read_only');
  assert.equal(revoked.error.code, 'GITHUB_TOKEN_INVALID');
});

test('linking stores the token in the keychain seam and the profile on disk; unlinking removes both', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-github-account-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keychain = new Map();
  class FixtureService extends NextMuxPlatformServiceImpl {
    networkFetch = async () => json({ login: 'octocat', name: 'The Octocat' });
    nextmuxDataRoot() { return root; }
    async readGitHubCredential() { return keychain.get('github') ?? null; }
    async writeGitHubCredential(token) { keychain.set('github', token); }
    async deleteGitHubCredential() { keychain.delete('github'); }
    agentAccount() { return this.githubAgentAccount(); }
  }
  const service = new FixtureService();
  assert.deepEqual(await service.getGitHubAccount(), { connected: false, allowAgent: true });
  await assert.rejects(service.connectGitHubAccount('not-a-token'), /github_pat_/);
  const linked = await service.connectGitHubAccount(FINE);
  assert.equal(linked.connected, true);
  assert.equal(linked.login, 'octocat');
  assert.equal(linked.tokenKind, 'fine-grained');
  assert.equal(keychain.get('github'), FINE);
  const stored = await readFile(join(root, 'github-account.json'), 'utf8');
  assert.doesNotMatch(stored, /github_pat_/, 'the profile file never contains the token');
  assert.deepEqual(await service.agentAccount(), { login: 'octocat', token: FINE });
  assert.equal((await service.setGitHubAgentAccess(false)).allowAgent, false);
  assert.equal(await service.agentAccount(), undefined);
  assert.equal((await service.connectGitHubAccount(FINE)).allowAgent, false, 'replacing the token keeps the AI switch');
  assert.deepEqual(await service.disconnectGitHubAccount(), { connected: false, allowAgent: true });
  assert.equal(keychain.size, 0);
  assert.deepEqual(await service.getGitHubAccount(), { connected: false, allowAgent: true });
});

test('agent runs get GitHub tools and full-access git credentials only for a linked account', () => {
  const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  assert.match(source, /const githubAccount = request\.workbench === 'comic' \? undefined : await this\.githubAgentAccount\(\);/);
  assert.match(source, /githubAccount && effectivePermissionMode === 'full_access'\s*\? gitHubCommandEnvironment/);
  assert.match(source, /if \(githubAccount\) registerGitHubTools\(tools/);
  const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  assert.match(widget, /<GitHubAccountSettings locale=\{this\.desktopLocale\} api=\{this\.platformService\}/);
});
