#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  api, approveSupply, balanceOperation, executeD1File, persistIdentities, productionPreflight,
  provisionProvider, runStateStore, settleTestCredit, verifyBalanceOperation, verifyIdentitySessions, waitForDiscovery,
} from './production-marketplace-e2e.mjs';
import {
  buildAuthorityCleanupSql, buildRecoverySessionSql, chooseProductionModel, createIdentityPlan, ProductionE2EError,
  PROVIDERS, safeFailure,
} from './production-marketplace-e2e-core.mjs';

export const DESKTOP_ACCEPTANCE_CONFIRMATION = 'PREPARE_RETAINED_DESKTOP_ACCEPTANCE';
export const DESKTOP_CREDIT_CONFIRMATION = 'GRANT_AUDITED_DESKTOP_TEST_CREDIT';
const statePath = join(homedir(), '.nextmux', 'private', 'desktop-acceptance.json');
const identity = (state, role) => state.plan.identities.find(item => item.role === role);
const error = (code, message) => new ProductionE2EError(code, message);

export function validateDesktopProviders(input) {
  if (!input || !Array.isArray(input.providers) || input.providers.length < 1 || input.providers.length > 2) throw error('providers_invalid', 'Provide one or two explicit merchant configurations');
  const seen = new Set();
  return input.providers.map(provider => {
    if (!PROVIDERS[provider.id] || seen.has(provider.id) || typeof provider.apiKey !== 'string' || provider.apiKey.length < 8
      || provider.apiKey.length > 1000 || /\s|[\u0000-\u001f\u007f]/u.test(provider.apiKey)
      || !Array.isArray(provider.modelIds) || provider.modelIds.length < 1 || provider.modelIds.length > 32
      || provider.modelIds.some(id => typeof id !== 'string' || !id || id.length > 160 || /\s|[\u0000-\u001f\u007f]/u.test(id))
      || new Set(provider.modelIds).size !== provider.modelIds.length) throw error('provider_invalid', 'Use distinct providers with explicit, bounded model IDs and a credential');
    seen.add(provider.id);
    return { id: provider.id, apiKey: provider.apiKey, modelIds: [...provider.modelIds] };
  });
}

/** Listing preparation costs no inference tokens; no fallback to a cheaper/different model. */
export function desktopListingEvidence(models, exactModelId) {
  const candidates = models.filter(model => model.modelId === exactModelId);
  const registry = new Map(candidates.map(model => [model.registryModelId, {
    id: model.registryModelId, canonicalModel: model.canonicalModel, status: model.registryStatus,
    input: model.input, output: model.output, capabilities: model.capabilities,
    contextTokens: model.contextTokens, maximumOutputTokens: model.maximumOutputTokens,
  }]));
  return chooseProductionModel(candidates, candidates, registry, exactModelId);
}

function persistState(store, state) {
  state.updatedAt = Date.now();
  // Credentials stay in the caller's memory; only revocable test sessions live
  // in the owner's 0600 journal. Routes must not duplicate those sessions.
  store.save({ ...state, routes: state.routes.map(({ account: _account, ...route }) => route) });
}

export function publicDesktopAcceptance(state) {
  return { runId: state.plan.runId, stage: state.stage, buyerId: identity(state, 'buyer').id,
    identityMethod: 'audited_test_identity_not_email_registration',
    routes: state.routes.filter(route => route.approved).map(route => ({
      provider: route.provider, merchantId: route.merchantId, offeringId: route.offeringId,
      canonicalModel: route.canonicalModel, upstreamModelId: route.upstreamModelId,
      keyPriceQuoteId: route.keyPriceQuoteId, price: route.customerPrice,
    })), skipped: state.skipped || [], fundedMicros: state.fundedMicros || 0,
    callbackOpened: state.callbackOpened === true, closed: state.closed === true,
    closing: !state.closed && (state.stage === 'closing' || state.intent?.operation === 'close_test_credit_and_authority'),
    ...(state.lastAudit ? { audit: state.lastAudit } : {}) };
}

async function defaultOpenDeepLink(url, appPath) {
  if (!/^nextmux:\/\/device-link\/complete\?nonce=[A-Za-z0-9_-]+$/.test(url)
    || process.platform !== 'darwin' || typeof appPath !== 'string' || !appPath.startsWith('/') || !appPath.endsWith('.app')) {
    throw error('desktop_callback_invalid', 'Pass the exact running Mac application path to open the normal device-link callback');
  }
  await new Promise((accept, reject) => {
    const child = spawn('open', ['-a', appPath, url], { stdio: 'ignore' });
    child.once('error', reject); child.once('exit', code => code === 0 ? accept() : reject(error('desktop_callback_failed', 'Unable to open the desktop callback')));
  });
}

const defaultIo = { api, approveSupply, balanceOperation, executeD1File, persistIdentities, productionPreflight,
  provisionProvider, settleTestCredit, verifyBalanceOperation, verifyIdentitySessions, waitForDiscovery, openDeepLink: defaultOpenDeepLink };

/** No inference is sent here. The actual desktop owns conversations, tools and artifacts. */
export async function runDesktopAcceptance(command, input, store, io = defaultIo) {
  if (!['prepare', 'list', 'audit', 'link', 'fund', 'close'].includes(command)) throw error('command_invalid', 'Use prepare, list, audit, link, fund or close');
  let state = store.load();
  if (state && state.kind !== 'desktop_acceptance') throw error('state_invalid', 'This journal belongs to another workflow');
  if (command === 'list') return state ? publicDesktopAcceptance(state) : { prepared: false };
  if (state?.closed) {
    if (command === 'audit' || command === 'close') return publicDesktopAcceptance(state);
    throw error('acceptance_closed', 'This retained acceptance run is closed; it cannot re-create administrative authority');
  }
  if (state?.stage === 'closing' || state?.intent?.operation === 'close_test_credit_and_authority') {
    // Read the timestamped audit already on disk; auditing a closing run must
    // not recreate owner memberships after cleanup committed but its ACK was lost.
    if (command === 'audit') return publicDesktopAcceptance(state);
    if (command !== 'close') throw error('acceptance_closing', 'This run is closing; only audit or close may continue');
  }
  if (process.env.NEXTMUX_DESKTOP_ACCEPTANCE_CONFIRM !== DESKTOP_ACCEPTANCE_CONFIRMATION) throw error('confirmation_missing', 'An explicit retained-desktop-acceptance confirmation is required');
  const providers = command === 'prepare' ? validateDesktopProviders(input) : [];
  if (!state && command !== 'prepare') throw error('acceptance_missing', 'Prepare the retained test identities first');
  if (!state) {
    state = { schemaVersion: 1, kind: 'desktop_acceptance', retention: 'retain', stage: 'initialized',
      plan: createIdentityPlan(Date.now(), undefined, { retention: 'retain' }), routes: [], skipped: [], createdAt: Date.now() };
    persistState(store, state);
  }
  const persist = () => persistState(store, state);
  const needsIdentitySeed = state.stage === 'initialized';
  if (command === 'close') {
    state.stage = 'closing'; state.intent = { operation: 'close_test_credit_and_authority' }; persist();
  }
  // Recover only the previously journaled, isolated identities. No account
  // status changes and no recovery of a closed run.
  if (needsIdentitySeed) {
    await io.productionPreflight(); await io.persistIdentities(state.plan); await io.verifyIdentitySessions(state.plan);
    if (command !== 'close') state.stage = 'identities_seeded';
    persist();
  } else {
    await io.executeD1File(buildRecoverySessionSql(state.plan)); await io.verifyIdentitySessions(state.plan);
  }
  try {
    if (command === 'prepare') {
      const discovery = new Map();
      const cachedDiscovery = async (...args) => {
        const key = `${args[0]}:${args[2]}`;
        if (!discovery.has(key)) discovery.set(key, await io.waitForDiscovery(...args));
        return discovery.get(key);
      };
      for (const provider of providers) for (const modelId of provider.modelIds) {
        if (state.routes.some(route => route.provider === provider.id && route.upstreamModelId === modelId && route.approved)) continue;
        state.intent = { operation: 'publish_model', provider: provider.id, modelId }; persist();
        // The normal provisioner already journals endpoint/key/policy creation
        // intentions before mutations and refuses suspended or conflicting supply.
        try {
          const route = await io.provisionProvider(state.plan, { id: provider.id, apiKey: provider.apiKey, modelId }, state.routes, 96,
            new Set(), persist, { api: io.api, waitForDiscovery: cachedDiscovery, modelEvidence: desktopListingEvidence });
          const approved = await io.approveSupply(state.plan, route, persist);
          Object.assign(route, approved, { approved: true });
          state.skipped = state.skipped.filter(row => row.provider !== provider.id || row.modelId !== modelId);
          delete state.intent; persist();
        } catch (failure) {
          if (failure?.code !== 'production_model_unavailable') throw failure;
          // Joining the public merchant directory is independent from selling
          // a model. The provisioner has authenticated this merchant's key and
          // cached its discovery before this particular price/capability error.
          const merchant = identity(state, `merchant-${provider.id}`);
          state.intent = { operation: 'publish_merchant_identity', provider: provider.id, modelId }; persist();
          await io.api('/api/admin/action', { account: identity(state, 'admin-requester'), method: 'POST', body: {
            action: 'merchant_listing', id: merchant.id, status: 'listed', reason: `Retained desktop acceptance ${state.plan.runId}; identity only, no unpriced route authorization`,
          } });
          state.skipped = state.skipped.filter(row => row.provider !== provider.id || row.modelId !== modelId);
          state.skipped.push({ provider: provider.id, modelId, reason: 'no_complete_official_price_or_tool_capability' });
          delete state.intent; persist();
        }
      }
      state.stage = 'prepared'; persist();
    }
    if (command === 'link') {
      if (typeof input?.code !== 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(input.code)) throw error('link_code_invalid', 'Use the code displayed by this desktop login');
      const codeHash = createHash('sha256').update(input.code).digest('hex');
      const existingCallback = state.intent?.operation === 'link_desktop' && state.intent.codeHash === codeHash
        && state.callback?.expiresAt > Date.now() ? state.callback : null;
      state.intent = { operation: 'link_desktop', codeHash }; persist();
      if (!existingCallback) {
        const linked = await io.api('/api/devices/link/complete', { account: identity(state, 'buyer'), method: 'POST', body: { code: input.code } });
        state.callback = { url: linked.deepLinkUrl, expiresAt: linked.expiresAt }; persist();
      }
      await io.openDeepLink(state.callback.url, input.appPath);
      // The operator verifies the actual app's session after callback delivery;
      // launching a URL is not proof that the desktop consumed the nonce.
      state.callbackOpened = true; delete state.callback; delete state.intent; persist();
    }
    if (command === 'fund') {
      const amount = Number(input?.amountMicros);
      if (process.env.NEXTMUX_DESKTOP_CREDIT_CONFIRM !== DESKTOP_CREDIT_CONFIRMATION || typeof input?.amountMicros !== 'number'
        || !Number.isSafeInteger(amount) || amount < 1000 || amount > 50_000_000) {
        throw error('test_credit_unconfirmed', 'Explicitly confirm an audited test grant of 1,000 to 50,000,000 USD micros; this is not a payment');
      }
      if (state.fundedMicros && state.fundedMicros !== amount) throw error('test_credit_amount_conflict', 'The one grant for this run cannot change its budget');
      if (state.intent?.operation === 'grant_test_credit' && state.intent.amountMicros !== amount) throw error('test_credit_amount_conflict', 'An unresolved grant cannot change its budget');
      if (state.fundedMicros && !state.fundingOperationId) throw error('test_credit_receipt_missing', 'The recorded grant has no receipt; no new credit will be granted');
      state.intent = { operation: 'grant_test_credit', amountMicros: amount }; persist();
      state.fundingOperationId = state.fundingOperationId
        ? await io.verifyBalanceOperation(state.plan, state.fundingOperationId, amount, 'grant')
        : await io.balanceOperation(state.plan, amount, 'grant');
      state.fundedMicros = amount;
      delete state.intent; persist();
    }
    if (command === 'audit' || command === 'close') {
      const buyer = identity(state, 'buyer');
      const [account, usage] = await Promise.all([io.api('/api/account', { account: buyer }),
        io.api('/api/wallet/merchant-usage?limit=50', { account: buyer })]);
      state.lastAudit = { measuredAt: new Date().toISOString(), wallets: account.wallets || [], merchantUsage: usage.items || [] }; persist();
    }
    if (command === 'close') {
      state.intent = { operation: 'close_test_credit_and_authority' }; persist();
      state.creditClosure = await io.settleTestCredit(state.plan);
      await io.executeD1File(buildAuthorityCleanupSql(state.plan));
      state.closed = true; state.stage = 'closed'; delete state.intent; persist();
      // Deliberately retain merchant inventory, the linked buyer, model usage,
      // local conversations and files; no cleanupSupply/cleanupBuyerDevice call.
    }
    delete state.failure; persist();
    return publicDesktopAcceptance(state);
  } catch (failure) {
    state.failure = safeFailure(failure, state.intent?.operation || command); persist();
    // A failed test must not unlist a working merchant or erase the user's evidence.
    throw failure;
  }
}

async function main() {
  const command = process.argv[2] || 'list';
  let text = '';
  if (!['list', 'audit', 'close'].includes(command)) for await (const chunk of process.stdin) {
    text += chunk.toString('utf8'); if (Buffer.byteLength(text) > 32_768) throw error('input_too_large', 'Input is limited to 32 KiB');
  }
  const input = text ? JSON.parse(text) : {};
  const store = runStateStore(process.env.NEXTMUX_DESKTOP_ACCEPTANCE_STATE_FILE || statePath);
  try { console.log(JSON.stringify(await runDesktopAcceptance(command, input, store), null, 2)); }
  finally { store.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(failure => {
  console.error(JSON.stringify(safeFailure(failure, 'desktop_acceptance'))); process.exitCode = 1;
});
