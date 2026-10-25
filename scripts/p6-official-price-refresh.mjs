#!/usr/bin/env node
/**
 * Read-only official-price evidence refresher.
 *
 * It deliberately records only source metadata and a content digest.  It
 * never invents a tariff from a relay catalog or turns an unparsed page into
 * an executable price rule.  A parser can promote an entry after its exact
 * dimensions are verified.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceRejection(requestedUrl, finalUrl, bytes) {
  const requested = new URL(requestedUrl), target = new URL(finalUrl);
  const claudeDocs = new Set(['docs.anthropic.com', 'platform.claude.com']);
  if (target.protocol !== 'https:' || target.username || target.password
    || (target.origin !== requested.origin && !(claudeDocs.has(requested.hostname) && claudeDocs.has(target.hostname)))) return 'unexpected_redirect';
  if (/(?:app-unavailable|unsupported-region|access-denied|\/login(?:\/|$)|\/signin(?:\/|$))/i.test(target.pathname)) return 'blocked_source';
  const text = new TextDecoder().decode(bytes);
  if (/<title[^>]*>[^<]*(?:access denied|just a moment|unavailable in (?:your|this) region|sign in|log in)/i.test(text)) return 'blocked_source';
  return null;
}

export async function refreshOfficialPriceEvidence({ gapPath, outputPath, fetchImpl = globalThis.fetch } = {}) {
  if (!gapPath || !outputPath) throw new Error('p6_paths_required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_required');
  const gaps = JSON.parse(await readFile(resolve(gapPath), 'utf8'));
  const entries = Array.isArray(gaps.entries) ? gaps.entries : [];
  const evidence = [];
  for (const entry of entries) {
    for (const url of Array.isArray(entry.officialSourceUrls) ? entry.officialSourceUrls : []) {
      const checkedAt = new Date().toISOString();
      try {
        const response = await fetchImpl(url, { redirect: 'follow', headers: { accept: 'text/html,application/json' } });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const finalUrl = response.url || url;
        const rejection = sourceRejection(url, finalUrl, bytes);
        evidence.push({ canonicalId: entry.canonicalId, providerScope: entry.providerScope, url,
          finalUrl, httpStatus: response.status, reachable: response.ok === true && !rejection,
          contentSha256: response.ok && !rejection ? digest(bytes) : null,
          contentBytes: bytes.byteLength, ...(rejection ? { rejection } : {}), checkedAt });
      } catch (error) {
        evidence.push({ canonicalId: entry.canonicalId, providerScope: entry.providerScope, url,
          httpStatus: null, reachable: false, contentSha256: null, contentBytes: null,
          error: error instanceof Error ? error.name : 'fetch_failed', checkedAt });
      }
    }
  }
  const reachable = evidence.filter(item => item.reachable).length;
  const report = { schemaVersion: 1, stage: 'P6', kind: 'official_price_source_refresh',
    generatedAt: new Date().toISOString(), sourceAudit: gapPath, status: 'evidence_only',
    policy: 'Source reachability and hashes do not create prices. Exact dimensions must be parsed and reviewed before publication.',
    summary: { gapEntries: entries.length, sourceCount: evidence.length, reachableSources: reachable }, evidence };
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  const args = process.argv.slice(2); const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  refreshOfficialPriceEvidence({ gapPath: value('--gaps'), outputPath: value('--output') })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
