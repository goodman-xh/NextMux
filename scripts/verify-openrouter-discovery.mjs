#!/usr/bin/env node
/** Read-only post-deploy proof: one D1 SELECT and executable catalog GETs.
 * No credentials are loaded from files; NEXTMUX_DEVICE_ID must be supplied by
 * the operator. --sql prints the complete SELECT without accessing any service.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DISCOVERY_FEATURES_VERSION } from '../apps/cloudflare-platform/src/model-discovery.js';
import { OFFICIAL_DISCOVERY_MERCHANTS } from '../apps/cloudflare-platform/src/discovery-publications.js';
import { approvedOfficialPriceSourceKeys } from '../apps/cloudflare-platform/src/model-catalog.js';
import { listPriceBaseTierSourceKey, listPriceSourceKey } from '../apps/cloudflare-platform/src/official-list-prices.js';
import { mediaPriceSourceKey } from '../apps/cloudflare-platform/src/official-media-prices.js';
import { parseChargeContract } from '../apps/cloudflare-platform/src/official-charge-contracts.js';
import { priceContractAvailability } from '../apps/cloudflare-platform/src/pricing-charge-contract.js';
import { publicationRequiredMetrics } from '../apps/cloudflare-platform/src/merchant-publication-candidates.js';
import { auxiliaryContractAvailability } from '../apps/cloudflare-platform/src/managed-auxiliary.js';

const official = OFFICIAL_DISCOVERY_MERCHANTS.find(value => value.protocol === 'openrouter');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const array = value => { try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
const requiredModalities = Object.freeze({ decisions: 'decision', embeddings: 'embedding', rerank: 'embedding', transcription: 'audio', image: 'image' });
const automaticPriceSources = new Set([...approvedOfficialPriceSourceKeys, listPriceSourceKey, listPriceBaseTierSourceKey, mediaPriceSourceKey, 'openrouter-api']);
const decisionFamilies = Object.freeze({ Jev: /(?:^|\/)jev(?:[-:.]|$)/i, Kev: /(?:^|\/)kev(?:[-:.]|$)/i, Span: /(?:^|\/)span(?:[-:.]|$)/i });

function decisionRoutes(row, catalog) {
  return (catalog?.data || []).filter(model => model.id === row.modelId && model.canonical_model === row.canonicalModel)
    .flatMap(model => (model.routes || []).filter(route => route.id === row.publicationId && route.merchant_id === official.id
      && route.protocol === 'openrouter' && route.input_price_per_million_tokens > 0)
      .map(route => ({ modelId: model.id, publicationId: route.id })));
}

function matchingOfferings(row, catalog, output) {
  return (catalog?.offerings || []).filter(offering => offering.id === row.publicationId && offering.merchantId === official.id
    && offering.canonicalModel === row.canonicalModel && offering.providerModelCode === row.modelId
    && offering.category === requiredModalities[output]
    && (offering.kind === (output === 'embeddings' ? 'embedding' : output) || array(offering.output).includes(output)));
}

function priceEvidence(row, output) {
  const sourcePrices = array(row.pricesJson), category = requiredModalities[output];
  const valid = price => Number.isSafeInteger(price?.amountMicros) && price.amountMicros >= 0
    && Number.isSafeInteger(price?.unitSize) && price.unitSize > 0 && price.currency === 'USD';
  const prices = new Map(sourcePrices.filter(price => valid(price) && automaticPriceSources.has(price.sourceKey)).map(price => [price.metric, price]));
  const contract = row.chargeContractJson ? parseChargeContract({ contractJson: row.chargeContractJson, id: row.chargeContractId,
    canonicalModel: row.canonicalModel, sourceKey: row.chargeContractSourceKey, sourceUrl: row.chargeContractSourceUrl }) : null;
  if (row.chargeContractJson && !contract) return { priced: false, reason: 'official_charge_contract_invalid' };
  if (contract && !automaticPriceSources.has(row.chargeContractSourceKey)) return { priced: false, reason: 'charge_contract_source_not_automatic' };
  const obligation = priceContractAvailability({ canonicalModel: row.canonicalModel, protocol: 'openrouter', category, kind: output === 'embeddings' ? 'embedding' : output, output: array(row.outputJson) }, sourcePrices, contract);
  if (obligation?.reasonCode) return { priced: false, reason: obligation.reasonCode, requiredDimensions: obligation.requiredDimensions || [] };
  // Use the same lane requirements as publication. A transcription token
  // tariff needs both input and output; an image-token row alone cannot prove
  // the picture workbench's image price. Source obligations can add dimensions.
  const lane = publicationRequiredMetrics(category, { kind: output, output: array(row.outputJson) }, prices);
  const requiredDimensions = [...new Set([...lane, ...(obligation?.requiredDimensions || [])])];
  const missingDimensions = requiredDimensions.filter(metric => !prices.has(metric));
  if (missingDimensions.length) return { priced: false, reason: 'automatic_price_dimensions_missing', requiredDimensions, missingDimensions };
  if (['embeddings', 'rerank', 'transcription'].includes(output)) {
    const executable = auxiliaryContractAvailability({ canonicalModel: row.canonicalModel, protocol: 'openrouter', category,
      kind: output === 'embeddings' ? 'embedding' : output, prices: [...prices.values()] }, contract);
    if (executable.reasonCode) return { priced: false, reason: executable.reasonCode, requiredDimensions: executable.requiredDimensions,
      unsupportedDimensions: executable.unsupportedDimensions };
  }
  if (category === 'decision' && prices.get('input_token').amountMicros <= 0) return { priced: false, reason: 'decision_input_price_must_be_positive', requiredDimensions };
  return { priced: true, requiredDimensions };
}

export function discoveryVerificationSql({ now = Date.now(), featuresVersion = DISCOVERY_FEATURES_VERSION } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(featuresVersion) || featuresVersion < 3) throw new Error('verification_parameters_invalid');
  return `WITH formal AS (
    SELECT e.id,e.merchant_user_id,e.discovery_revision FROM relay_endpoints e
    JOIN users u ON u.id=e.merchant_user_id JOIN merchant_profiles mp ON mp.user_id=u.id
    WHERE e.merchant_user_id=${quote(official.id)} AND e.protocol='openrouter'
      AND rtrim(e.base_url,'/')=${quote(official.baseUrl)} AND e.status='active'
      AND u.status='active' AND mp.listing_status='listed'
  ), scans AS (
    SELECT f.id AS endpoint_id,f.merchant_user_id,c.id AS credential_id,j.scan_id,j.last_good_at,
      j.completed_features_version,j.completed_modality_version,
      CASE WHEN j.status='ready' AND j.endpoint_revision=f.discovery_revision AND j.credential_revision=c.discovery_revision
        AND j.completed_features_version>=${featuresVersion} AND j.completed_features_version>=j.target_features_version
        AND j.completed_modality_version>=j.target_modality_version AND j.scan_id<>'' THEN 1 ELSE 0 END AS scan_ready
    FROM formal f LEFT JOIN credential_inventory c ON c.endpoint_id=f.id AND c.purpose='production' AND c.status='available'
      AND (c.cooldown_until IS NULL OR c.cooldown_until<=${now})
    LEFT JOIN credential_discovery_jobs j ON j.credential_id=c.id
  )
  SELECT s.endpoint_id AS endpointId,s.merchant_user_id AS merchantId,s.credential_id AS credentialId,
    s.scan_id AS scanId,s.scan_ready AS scanReady,s.last_good_at AS completedAt,s.completed_features_version AS featuresVersion,
    d.upstream_model_id AS modelId,r.canonical_model AS canonicalModel,d.output_modalities_json AS outputJson,
    (SELECT json_group_array(json_object('metric',p.metric,'currency',p.currency,
        'amountMicros',CASE WHEN v.mode='override' THEN v.amount_micros ELSE p.amount_micros END,
        'unitSize',CASE WHEN v.mode='override' THEN v.unit_size ELSE p.unit_size END,
        'sourceKey',CASE WHEN v.mode='override' THEN 'admin_override' ELSE p.source_key END,'referenceSourceKey',p.source_key,'sourceUrl',p.source_url,'policyMode',v.mode))
      FROM official_reference_prices p LEFT JOIN official_price_policy_versions v ON v.id=(
        SELECT a.id FROM official_price_policy_versions a WHERE a.canonical_model=p.canonical_model AND a.metric=p.metric AND a.currency=p.currency
          AND a.mode<>'cancel' AND a.effective_from<=${now} AND (a.effective_to IS NULL OR a.effective_to>${now})
          AND NOT EXISTS(SELECT 1 FROM official_price_policy_versions c WHERE c.revokes_version_id=a.id AND c.created_at<=${now})
        ORDER BY a.effective_from DESC,a.revision DESC LIMIT 1)
      WHERE p.canonical_model=r.canonical_model AND p.currency='USD'
        AND p.effective_from<=${now} AND (p.effective_to IS NULL OR p.effective_to>${now})) AS pricesJson,
    b.id AS chargeContractId,b.contract_json AS chargeContractJson,b.source_key AS chargeContractSourceKey,b.source_url AS chargeContractSourceUrl,
    m.id AS publicationId,m.status AS publicationStatus,
    EXISTS(SELECT 1 FROM audit_logs a WHERE a.target_type='model' AND a.target_id=m.id AND a.action='provider.model.auto_review') AS autoReviewed
  FROM scans s
  LEFT JOIN credential_discovery_model_presence presence ON s.scan_ready=1 AND presence.credential_id=s.credential_id
    AND presence.last_seen_scan_id=s.scan_id AND presence.last_complete_scan_id=s.scan_id AND presence.missing_complete_scans=0
  LEFT JOIN discovered_endpoint_models d ON d.endpoint_id=s.endpoint_id AND d.upstream_model_id=presence.upstream_model_id
    AND d.discovery_state NOT IN ('unavailable','rejected')
  LEFT JOIN model_registry r ON r.id=d.registry_model_id
  LEFT JOIN official_charge_contracts b ON b.id=(SELECT contract.id FROM official_charge_contracts contract
    WHERE lower(contract.canonical_model)=lower(r.canonical_model) AND contract.effective_from<=${now}
      AND (contract.effective_to IS NULL OR contract.effective_to>${now}) ORDER BY contract.effective_from DESC,contract.id DESC LIMIT 1)
  LEFT JOIN provider_models m ON m.endpoint_id=s.endpoint_id AND m.registry_model_id=d.registry_model_id
    AND EXISTS(SELECT 1 FROM endpoint_model_policies policy WHERE policy.endpoint_id=m.endpoint_id
      AND policy.registry_model_id=m.registry_model_id AND policy.primary_upstream_model_id=d.upstream_model_id AND policy.status='active')
  ORDER BY s.endpoint_id,s.credential_id,d.upstream_model_id,m.id`;
}

export function evaluateDiscoveryVerification(rows, catalog) {
  const errors = [], endpoints = [];
  if (!Array.isArray(rows) || !rows.length) errors.push('No active formal OpenRouter endpoint found. Draft endpoints do not qualify.');
  if (!Array.isArray(catalog?.data)) errors.push('decision-models did not return a model list.');
  for (const endpointId of new Set((rows || []).map(row => row.endpointId))) {
    const endpoint = rows.filter(row => row.endpointId === endpointId), scans = new Map(endpoint.map(row => [row.credentialId, row]));
    const ready = endpoint.filter(row => Number(row.scanReady) === 1 && row.modelId);
    const evidence = { endpointId, merchantId: official.id, featuresVersion: DISCOVERY_FEATURES_VERSION,
      scans: [...scans.values()].map(row => ({ credentialId: row.credentialId, scanId: row.scanId, completedAt: row.completedAt, featuresVersion: row.featuresVersion, ready: Number(row.scanReady) === 1 })), modalities: {}, decisions: {} };
    if (!scans.size || [...scans.values()].some(row => !row.credentialId || Number(row.scanReady) !== 1)) errors.push(`${endpointId}: an available production credential has not completed the current discovery version.`);
    const listed = row => row.publicationId && row.publicationStatus === 'listed' && Number(row.autoReviewed) === 1;
    for (const output of Object.keys(requiredModalities)) {
      const members = ready.filter(row => array(row.outputJson).includes(output));
      const pricing = new Map(members.map(row => [row, priceEvidence(row, output)]));
      const prices = members.filter(row => pricing.get(row).priced);
      const publications = prices.filter(row => row.publicationId);
      const reviewed = publications.filter(listed);
      const executable = reviewed.filter(row => output === 'decisions' ? decisionRoutes(row, catalog).length
        : matchingOfferings(row, catalog, output).some(offering => offering.status === 'active'));
      const unique = values => new Set(values.map(row => row.modelId)).size;
      evidence.modalities[output] = { scanMembers: unique(members), priced: unique(prices), published: unique(publications), autoReviewedListed: unique(reviewed), executableRoutes: unique(executable) };
      for (const [stage, count] of Object.entries(evidence.modalities[output])) if (!count) errors.push(`${endpointId}: ${output} has no ${stage} evidence in the same current formal scan.${['published', 'executableRoutes'].includes(stage) ? ' Check priceRejections and routeRejections for charge-contract, protocol or metering blockers; discovery/pricing alone does not prove an executable route.' : ''}`);
      const rejected = [...new Map(members.filter(row => !pricing.get(row).priced).map(row => [row.modelId, { modelId: row.modelId, ...pricing.get(row) }])).values()];
      if (rejected.length) evidence.modalities[output].priceRejections = rejected;
      if (output !== 'decisions') {
        const unavailable = reviewed.filter(row => !executable.includes(row)).map(row => {
          const offerings = matchingOfferings(row, catalog, output);
          return { modelId: row.modelId, publicationId: row.publicationId,
            reasons: [...new Set(offerings.length ? offerings.map(offering => offering.unavailableReason || 'managed_route_unavailable') : ['catalog_offering_missing'])] };
        });
        if (unavailable.length) evidence.modalities[output].routeRejections = [...new Map(unavailable.map(row => [row.publicationId, row])).values()];
      }
    }
    for (const [family, pattern] of Object.entries(decisionFamilies)) {
      const publications = ready.filter(row => pattern.test(row.modelId) && array(row.outputJson).includes('decisions') && priceEvidence(row, 'decisions').priced && listed(row));
      const routes = publications.flatMap(row => decisionRoutes(row, catalog));
      evidence.decisions[family] = routes;
      if (!routes.length) errors.push(`${endpointId}: ${family} has no executable decision-models route from its formal, priced, auto-reviewed publication.`);
    }
    endpoints.push(evidence);
  }
  return { ok: errors.length === 0, readOnly: true, featuresVersion: DISCOVERY_FEATURES_VERSION, endpoints, errors };
}

export async function verifyOpenRouterDiscovery({ database = 'nextmux-platform-d1', origin = 'https://nextmux.app', deviceId,
  execute = spawnSync, fetcher = fetch, now = Date.now() } = {}) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(database)) throw new Error('database_name_invalid');
  const url = new URL('/v1/decision-models', origin);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('https_origin_required');
  if (!/^[A-Za-z0-9:_-]{16,180}$/.test(deviceId || '')) throw new Error('Set NEXTMUX_DEVICE_ID to an already linked desktop credential; no device will be created.');
  const result = execute('pnpm', ['exec', 'wrangler', 'd1', 'execute', database, '--remote', '--config', 'wrangler.jsonc', '--command', discoveryVerificationSql({ now }), '--json'],
    { cwd: fileURLToPath(new URL('../apps/cloudflare-platform/', import.meta.url)), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // Avoid echoing CLI errors, request headers or full authenticated payloads.
  if (result.status !== 0) throw new Error('Read-only D1 SELECT failed; check Wrangler authentication and deployed migrations.');
  let blocks;
  try { blocks = JSON.parse(result.stdout); } catch { throw new Error('D1 did not return JSON.'); }
  if (!Array.isArray(blocks) || blocks.some(block => block.success === false || !Array.isArray(block.results))) throw new Error('D1 SELECT returned an invalid result.');
  const get = target => fetcher(target.href, { method: 'GET', headers: { accept: 'application/json', 'x-nextmux-device-id': deviceId }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const response = await get(url);
  if (!response.ok) throw new Error(`decision-models returned HTTP ${response.status}.`);
  const catalog = await response.json(), offerings = [];
  let after = '';
  do {
    const retailUrl = new URL('/api/catalog', origin);
    retailUrl.searchParams.set('merchantId', official.id);
    retailUrl.searchParams.set('limit', '100');
    if (after) retailUrl.searchParams.set('after', after);
    const retailResponse = await get(retailUrl);
    if (!retailResponse.ok) throw new Error(`public catalog returned HTTP ${retailResponse.status}.`);
    const page = await retailResponse.json();
    if (!Array.isArray(page?.offerings)) throw new Error('public catalog did not return an offering list.');
    if (page.nextCursor !== undefined && page.nextCursor !== null && (typeof page.nextCursor !== 'string' || page.nextCursor.length > 128 || page.nextCursor <= after)) throw new Error('public catalog returned an invalid pagination cursor.');
    offerings.push(...page.offerings);
    after = page.nextCursor || '';
  } while (after);
  return evaluateDiscoveryVerification(blocks.flatMap(block => block.results), { ...catalog, offerings });
}

async function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index];
    if (flag === '--sql') options.sql = true;
    else if (flag === '--database' || flag === '--origin') {
      const value = process.argv[++index]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options[flag.slice(2)] = value;
    } else if (flag === '--help') {
      console.log('NEXTMUX_DEVICE_ID=<already-linked device credential> node scripts/verify-openrouter-discovery.mjs [--origin https://nextmux.app] [--database nextmux-platform-d1]\nUse --sql to inspect the read-only SELECT offline. Requires Node >=22, pnpm and an authenticated Wrangler session.');
      return;
    } else throw new Error(`Unknown option ${flag}`);
  }
  if (options.sql) { console.log(discoveryVerificationSql()); return; }
  const report = await verifyOpenRouterDiscovery({ ...options, deviceId: process.env.NEXTMUX_DEVICE_ID });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
