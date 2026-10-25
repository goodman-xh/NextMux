import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { parseMcpRegistryStored } from '../lib/common/nextmux-mcp-registry.js';

const TOKEN = `ghp_${'Q1w2E3r4T5'.repeat(4)}`;

function fixture(root, answer, linked = false) {
  const calls = [];
  class FixtureService extends NextMuxPlatformServiceImpl {
    networkFetch = async (url, init = {}) => { calls.push({ url: String(url), auth: init.headers?.authorization }); return answer(String(url)); };
    nextmuxDataRoot() { return root; }
    baseUrl = 'https://nextmux.example';
    async readGitHubAccountRecord() { return linked ? { login: 'octocat', allowAgent: false } : undefined; }
    async readGitHubCredential() { return linked ? TOKEN : null; }
    fetchDirectory(url, accept) { return this.directoryFetch(url, accept, 5_000); }
  }
  return { service: new FixtureService(), calls };
}

test('directory reads fall back to the NextMux mirror when GitHub limits or fails, not for real 404s', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-directory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = 'https://api.github.com/repos/anthropics/skills/commits/main';
  const limited = fixture(root, url => url.startsWith('https://nextmux.example/') ? new Response('{"sha":"mirror"}') : new Response('limit', { status: 403 }));
  assert.equal(await (await limited.service.fetchDirectory(target, 'application/json')).text(), '{"sha":"mirror"}');
  assert.equal(limited.calls[1].url, `https://nextmux.example/api/directory/mirror?url=${encodeURIComponent(target)}`);
  const offline = fixture(root, url => { if (url.startsWith('https://api.github.com/')) throw new TypeError('fetch failed'); return new Response('{"sha":"mirror"}'); });
  assert.equal((await offline.service.fetchDirectory(target, 'application/json')).status, 200);
  const missing = fixture(root, () => new Response('nope', { status: 404 }));
  assert.equal((await missing.service.fetchDirectory(target, 'application/json')).status, 404);
  assert.equal(missing.calls.length, 1, 'a real 404 is not retried through the mirror');
  const bothDown = fixture(root, () => { throw new TypeError('fetch failed'); });
  await assert.rejects(bothDown.service.fetchDirectory(target, 'application/json'), error => error.data.domainError.code === 'SKILL_DIRECTORY_UNREACHABLE');
});

test('a linked GitHub account lifts the directory rate limit, only toward api.github.com', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-directory-token-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { service, calls } = fixture(root, () => new Response('{}'), true);
  await service.fetchDirectory('https://api.github.com/repos/anthropics/skills/commits/main', 'application/json');
  await service.fetchDirectory(`https://raw.githubusercontent.com/anthropics/skills/${'a'.repeat(40)}/skills/pdf/SKILL.md`, 'application/octet-stream');
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`);
  assert.equal(calls[1].auth, undefined);
});

test('the MCP directory survives restarts through a validated disk copy', () => {
  const entry = parseMcpRegistryStored({ id: 'io.github.acme/tool', title: 'Tool', owner: 'acme', description: 'x', repositoryUrl: 'https://github.com/acme/tool', stars: 12.4,
    options: [{ kind: 'npx', configuration: { command: 'npx', args: ['-y', '@acme/tool@1.0.0'] }, secrets: ['ACME_KEY'] },
      { kind: 'remote', configuration: { serverUrl: 'http://insecure.test' }, secrets: [] },
      { kind: 'npx', configuration: { command: 'bash', args: ['-c', 'x'] }, secrets: [] }] });
  assert.equal(entry.stars, 12);
  assert.deepEqual(entry.options, [{ kind: 'npx', configuration: { command: 'npx', args: ['-y', '@acme/tool@1.0.0'] }, secrets: ['ACME_KEY'] }]);
  assert.equal(parseMcpRegistryStored({ title: 'no id' }), undefined);
});
