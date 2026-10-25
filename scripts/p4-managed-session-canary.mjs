#!/usr/bin/env node
/**
 * Bounded authenticated production canary for the managed multiplexed session.
 *
 * This intentionally exercises only tiny text requests against an already
 * published offering. It never prints or writes device/provider credentials,
 * prompt content, or response bodies. It is evidence for transport behaviour,
 * not a substitute for a one-hour/72-hour provider-owned resumable task.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { WebSocket } from '../packages/theia-nextmux-extension/node_modules/undici/index.js';
import {
  connect,
  deviceId,
  safeEvent,
  waitFor,
} from './managed-session-client.mjs';

const ORIGIN = String(process.env.NEXTMUX_CANARY_ORIGIN || 'https://nextmux.app').replace(/\/+$/, '');
const OFFERING_ID = String(process.env.NEXTMUX_CANARY_OFFERING_ID || '0d223fd4-5162-495d-8318-f66cd97549f0');
const REGISTRY_MODEL_ID = String(process.env.NEXTMUX_CANARY_REGISTRY_MODEL_ID || '23a3f673-0cf2-41dd-9087-b42c03a96fca');
const MERCHANT_ID = String(process.env.NEXTMUX_CANARY_MERCHANT_ID || '');
const OUTPUT = resolve(process.env.NEXTMUX_CANARY_REPORT || 'docs/reports/p4-managed-session-canary-2026-09-13.json');
const startedAt = new Date().toISOString();
const runId = `p4-ws-${Date.now()}-${randomUUID().slice(0, 8)}`;
const taskIds = { first: `${runId}-first`, second: `${runId}-second`, reconnect: `${runId}-reconnect` };
const keys = { first: `${runId}-idempotency-first`, second: `${runId}-idempotency-second`, reconnect: `${runId}-idempotency-reconnect` };

function frameBody(label, keyPriceQuoteId) {
  return {
    offeringId: OFFERING_ID,
    registryModelId: REGISTRY_MODEL_ID,
    keyPriceQuoteId,
    maximumOutputTokens: 8,
    messages: [{ role: 'user', content: `NextMux bounded transport canary ${label}; answer with one short word.` }],
  };
}

/**
 * Price consent is intentionally fetched from the live scoped catalog rather
 * than copied into the canary.  Quotes are short-lived and tied to the
 * offering's current credential cohort; sending without one is rejected by
 * the gateway before a provider request is made.
 */
async function liveQuote(rawDevice) {
  let merchantId = MERCHANT_ID;
  if (!merchantId) {
    const directory = await fetch(new URL('/api/merchants/public?limit=100', ORIGIN), { headers: { 'x-nextmux-device-id': rawDevice } });
    if (!directory.ok) throw new Error(`merchant_directory_http_${directory.status}`);
    const payload = await directory.json();
    const merchant = (payload.merchants || []).find(item => /openrouter/i.test(String(item.name || '')) && item.apiStatus?.state === 'ready')
      || (payload.merchants || []).find(item => /openrouter/i.test(String(item.name || '')));
    merchantId = String(merchant?.id || '');
  }
  if (!merchantId) throw new Error('merchant_directory_entry_missing');
  const url = new URL('/api/catalog', ORIGIN);
  url.searchParams.set('merchantId', merchantId);
  url.searchParams.set('limit', '500');
  const response = await fetch(url, { headers: { 'x-nextmux-device-id': rawDevice } });
  if (!response.ok) throw new Error(`catalog_http_${response.status}`);
  const payload = await response.json();
  const offering = (payload.offerings || []).find(item => item.id === OFFERING_ID && item.registryModelId === REGISTRY_MODEL_ID);
  const quote = offering?.keyPriceQuoteId;
  if (!/^kq1_[a-f0-9]{64}$/.test(String(quote || ''))) throw new Error('catalog_quote_missing');
  return String(quote);
}

async function run() {
  const rawDevice = deviceId();
  if (!/^[A-Za-z0-9:_-]{16,180}$/.test(rawDevice)) throw new Error('device_id_invalid');
  const keyPriceQuoteId = await liveQuote(rawDevice);
  const sessionId = randomUUID();
  const evidence = { sessionId, taskIds, idempotencyKeys: Object.values(keys).map(value => `${value.slice(0, 12)}…`), first: {}, second: {}, reconnect: {}, duplicate: {}, lease: {} };
  const first = await connect(sessionId, rawDevice, { origin: ORIGIN, WebSocket });
  first.socket.send(JSON.stringify({ type: 'start', taskId: taskIds.first, idempotencyKey: keys.first, body: frameBody('first', keyPriceQuoteId) }));
  const firstComplete = await waitFor(first.events, event => event.type === 'session.event' && event.taskId === taskIds.first && ['session.completed', 'session.failed'].includes(String(event.event?.type)));
  evidence.first.events = first.events.filter(event => event.taskId === taskIds.first).map(safeEvent);
  evidence.first.terminal = safeEvent(firstComplete);
  first.socket.send(JSON.stringify({ type: 'start', taskId: taskIds.first, idempotencyKey: keys.first, body: frameBody('duplicate', keyPriceQuoteId) }));
  const duplicate = await waitFor(first.events, event => event.type === 'session.accepted' && event.taskId === taskIds.first && event.duplicate === true);
  evidence.duplicate = safeEvent(duplicate);
  first.socket.send(JSON.stringify({ type: 'start', taskId: taskIds.second, idempotencyKey: keys.second, body: frameBody('second', keyPriceQuoteId) }));
  const secondComplete = await waitFor(first.events, event => event.type === 'session.event' && event.taskId === taskIds.second && ['session.completed', 'session.failed'].includes(String(event.event?.type)));
  evidence.second.events = first.events.filter(event => event.taskId === taskIds.second).map(safeEvent);
  evidence.second.terminal = safeEvent(secondComplete);
  first.socket.close(1000, 'canary_done');

  const reconnect = await connect(sessionId, rawDevice, { origin: ORIGIN, WebSocket });
  reconnect.socket.send(JSON.stringify({ type: 'ping' }));
  const pong = await waitFor(reconnect.events, event => event.type === 'pong');
  evidence.reconnect.handshake = true;
  evidence.reconnect.pong = safeEvent(pong);
  reconnect.socket.send(JSON.stringify({ type: 'start', taskId: taskIds.reconnect, idempotencyKey: keys.reconnect, body: frameBody('reconnect', keyPriceQuoteId) }));
  const accepted = await waitFor(reconnect.events, event => event.type === 'session.event' && event.taskId === taskIds.reconnect && event.event?.type === 'session.accepted');
  // Close immediately after the durable acceptance event. The provider task is
  // allowed to finish independently; reconnecting must expose metadata rather
  // than dispatching a second request.
  reconnect.socket.close(1000, 'canary_reconnect');
  const resumed = await connect(sessionId, rawDevice, { origin: ORIGIN, WebSocket });
  resumed.socket.send(JSON.stringify({ type: 'resume', taskId: taskIds.reconnect }));
  const resume = await waitFor(resumed.events, event => event.type === 'session.resume' && event.taskId === taskIds.reconnect);
  evidence.reconnect.accepted = safeEvent(accepted);
  evidence.reconnect.resume = safeEvent(resume);
  evidence.reconnect.sequenceMetadataOnly = !Object.hasOwn(resume, 'body');
  resumed.socket.close(1000, 'canary_done');
  const providerCompleted = [evidence.first, evidence.second].every(item => item.terminal?.eventType === 'session.completed');
  evidence.status = evidence.duplicate.duplicate === true && evidence.reconnect.handshake === true && evidence.reconnect.sequenceMetadataOnly === true && providerCompleted ? 'passed' : 'failed';
  evidence.transport = 'cloudflare-durable-object-hibernation-websocket';
  evidence.origin = ORIGIN;
  evidence.startedAt = startedAt;
  evidence.finishedAt = new Date().toISOString();
  evidence.credentials = 'desktop keychain device identity; provider credential remains Worker-managed and redacted';
  evidence.scope = 'bounded two-task multiplex + duplicate idempotency + close/reconnect lease/resume metadata; not a 1h/72h run';
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify({ version: 1, stage: 'P4', ...evidence }, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: evidence.status, report: OUTPUT, taskCount: 3, duplicate: evidence.duplicate.duplicate === true, reconnect: evidence.reconnect.handshake === true }));
}

run().catch(error => { console.error(JSON.stringify({ status: 'failed', code: String(error?.message || 'canary_failed') })); process.exitCode = 1; });
