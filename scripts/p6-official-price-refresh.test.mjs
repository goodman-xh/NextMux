import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshOfficialPriceEvidence } from './p6-official-price-refresh.mjs';

test('refresh records source hashes without promoting unparsed prices', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nextmux-p6-'));
  const gaps = join(dir, 'gaps.json'); const out = join(dir, 'evidence.json');
  await writeFile(gaps, JSON.stringify({ entries: [{ canonicalId: 'vendor/model', providerScope: 'openrouter', officialSourceUrls: ['https://example.test/pricing'] }] }));
  const report = await refreshOfficialPriceEvidence({ gapPath: gaps, outputPath: out,
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('official').buffer }) });
  assert.equal(report.status, 'evidence_only');
  assert.equal(report.summary.reachableSources, 1);
  assert.equal(report.evidence[0].contentSha256.length, 64);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).status, 'evidence_only');
});

test('a 200 regional-block redirect is not official price evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nextmux-p6-block-'));
  const gaps = join(dir, 'gaps.json'), out = join(dir, 'evidence.json');
  await writeFile(gaps, JSON.stringify({ entries: [{ canonicalId: 'anthropic/model', officialSourceUrls: ['https://platform.claude.com/docs/en/about-claude/pricing'] }] }));
  const report = await refreshOfficialPriceEvidence({ gapPath: gaps, outputPath: out,
    fetchImpl: async () => ({ ok: true, status: 200, url: 'https://claude.com/app-unavailable-in-region', arrayBuffer: async () => new TextEncoder().encode('Unavailable').buffer }) });
  assert.equal(report.summary.reachableSources, 0);
  assert.equal(report.evidence[0].contentSha256, null);
  assert.equal(report.evidence[0].finalUrl, 'https://claude.com/app-unavailable-in-region');
  assert.equal(report.evidence[0].rejection, 'unexpected_redirect');
});

test('documented Claude docs migration is accepted while login and challenge pages are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nextmux-p6-redirect-'));
  const gaps = join(dir, 'gaps.json'), out = join(dir, 'evidence.json');
  await writeFile(gaps, JSON.stringify({ entries: [{ canonicalId: 'anthropic/model', officialSourceUrls: ['https://docs.anthropic.com/en/docs/about-claude/pricing'] }] }));
  for (const [url, body, accepted] of [
    ['https://platform.claude.com/docs/en/about-claude/pricing', '<title>Pricing</title>Official pricing', true],
    ['https://platform.claude.com/login', '<title>Sign in</title>', false],
    ['https://docs.anthropic.com/en/docs/about-claude/pricing', '<title>Just a moment...</title>', false],
    ['http://docs.anthropic.com/en/docs/about-claude/pricing', 'downgraded', false],
  ]) {
    const report = await refreshOfficialPriceEvidence({ gapPath: gaps, outputPath: out,
      fetchImpl: async () => ({ ok: true, status: 200, url, arrayBuffer: async () => new TextEncoder().encode(body).buffer }) });
    assert.equal(report.evidence[0].reachable, accepted, url);
    assert.equal(typeof report.evidence[0].contentSha256 === 'string', accepted);
  }
});
