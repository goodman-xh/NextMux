import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encryptSecret, hmac } from "../apps/cloudflare-platform/src/security.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const platform = join(root, "apps", "cloudflare-platform");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const variables = Object.fromEntries((await readFile(join(platform, ".dev.vars"), "utf8"))
  .split(/\r?\n/)
  .map(line => line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/))
  .filter(Boolean)
  .map(match => [match[1], match[2].replace(/^['"]|['"]$/g, "")]));
assert.ok(variables.SESSION_SECRET);
assert.ok(variables.DATA_ENCRYPTION_KEY);

const buyerId = `qa-buyer-${randomUUID()}`;
const merchantId = `qa-merchant-${randomUUID()}`;
const endpointId = randomUUID();
const offeringId = randomUUID();
const credentialId = randomUUID();
const geminiEndpointId = randomUUID();
const geminiOfferingId = randomUUID();
const geminiCredentialId = randomUUID();
const rawDevice = `qa-device-${randomUUID()}`;
const upstreamKey = `qa-key-${randomUUID()}`;
const requestKey = `qa-media-${randomUUID()}`;
const now = Date.now();
const deviceHash = await hmac(variables.SESSION_SECRET, `desktop-device:${rawDevice}`);
const encrypted = await encryptSecret(variables.DATA_ENCRYPTION_KEY, upstreamKey);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const seedFile = join(root, "artifacts", `qa-media-${randomUUID()}.sql`);
const cleanupFile = join(root, "artifacts", `qa-media-cleanup-${randomUUID()}.sql`);
const seed = `PRAGMA foreign_keys = ON;
INSERT INTO users(id,email,display_name,locale,role,status,email_verified_at,created_at,updated_at) VALUES(${quote(buyerId)},${quote(`${buyerId}@nextmux.test`)},'QA Buyer','en','user','active',${now},${now},${now});
INSERT INTO users(id,email,display_name,locale,role,status,email_verified_at,created_at,updated_at) VALUES(${quote(merchantId)},${quote(`${merchantId}@nextmux.test`)},'QA Merchant','en','merchant','active',${now},${now},${now});
INSERT INTO merchant_profiles(user_id,merchant_name,website_url,support_contact,onboarding_state,listing_status,trust_score,created_at,updated_at) VALUES(${quote(merchantId)},'QA Media Relay','','qa@nextmux.test','complete','listed',95,${now},${now});
INSERT INTO merchant_finance_profiles(merchant_user_id,settlement_delay_days,settlement_calendar,platform_fee_bps,reserve_bps,minimum_withdrawal_minor,created_at,updated_at) VALUES(${quote(merchantId)},2,'calendar',1000,0,1000,${now},${now});
INSERT INTO buyer_devices(subject_hash,user_id,label,status,linked_at,created_at,last_seen_at) VALUES(${quote(deviceHash)},${quote(buyerId)},'QA Desktop','active',${now},${now},${now});
INSERT INTO relay_endpoints(id,merchant_user_id,name,base_url,protocol,delivery_mode,status,network_score,identity_score,created_at,updated_at) VALUES(${quote(endpointId)},${quote(merchantId)},'QA Media','http://192.168.3.5:4181/v1','openai','gateway','active',98,96,${now},${now});
INSERT INTO provider_models(id,endpoint_id,model_id,display_name,category,status,identity_score,network_score,created_at,updated_at,price_currency,price_minor,price_unit,region,agent_readiness_score,pricing_mode,reference_model,settlement_multiplier_bps,platform_fee_bps,registry_model_id,discovery_state,discovered_at) SELECT ${quote(offeringId)},${quote(endpointId)},'gpt-image-2','QA Image Route','image','listed',97,98,${now},${now},'USD',0,'image','global',90,'direct','openai/gpt-image-2',10000,1000,id,'confirmed',${now} FROM model_registry WHERE canonical_model='openai/gpt-image-2';
INSERT INTO endpoint_model_policies(id,endpoint_id,registry_model_id,scope_key,primary_upstream_model_id,upstream_aliases_json,category,status,created_at,updated_at) SELECT ${quote(randomUUID())},${quote(endpointId)},id,'all','gpt-image-2','["gpt-image-2"]','image','active',${now},${now} FROM model_registry WHERE canonical_model='openai/gpt-image-2';
INSERT INTO credential_inventory(id,endpoint_id,secret_cipher,secret_iv,fingerprint,masked_value,status,purpose,priority,weight,created_at,updated_at) VALUES(${quote(credentialId)},${quote(endpointId)},${quote(encrypted.cipher)},${quote(encrypted.iv)},${quote(randomUUID())},'qa-••••','available','production',10,100,${now},${now});
INSERT INTO credential_model_access(credential_id,upstream_model_id,access_state,source,success_count,failure_count,last_checked_at,last_success_at) VALUES(${quote(credentialId)},'gpt-image-2','verified','manual',1,0,${now},${now});
INSERT INTO model_price_versions(id,model_id,audience,metric,currency,unit_size,amount_micros,effective_from,created_at) VALUES(${quote(randomUUID())},${quote(offeringId)},'merchant','image','USD',1,50000,${now},${now});
INSERT INTO model_price_versions(id,model_id,audience,metric,currency,unit_size,amount_micros,effective_from,created_at) VALUES(${quote(randomUUID())},${quote(offeringId)},'customer','image','USD',1,55000,${now},${now});
INSERT INTO relay_endpoints(id,merchant_user_id,name,base_url,protocol,auth_header,delivery_mode,status,network_score,identity_score,created_at,updated_at) VALUES(${quote(geminiEndpointId)},${quote(merchantId)},'QA Gemini Media','http://192.168.3.5:4181/v1beta','gemini','x-goog-api-key','gateway','active',98,96,${now},${now});
INSERT INTO provider_models(id,endpoint_id,model_id,display_name,category,status,identity_score,network_score,created_at,updated_at,price_currency,price_minor,price_unit,region,agent_readiness_score,pricing_mode,reference_model,settlement_multiplier_bps,platform_fee_bps,registry_model_id,discovery_state,discovered_at) SELECT ${quote(geminiOfferingId)},${quote(geminiEndpointId)},'gemini-3.1-flash-image','QA Gemini Image Route','image','listed',97,98,${now},${now},'USD',0,'image','global',90,'direct','google/gemini-3.1-flash-image',10000,1000,id,'confirmed',${now} FROM model_registry WHERE canonical_model='google/gemini-3.1-flash-image';
INSERT INTO endpoint_model_policies(id,endpoint_id,registry_model_id,scope_key,primary_upstream_model_id,upstream_aliases_json,category,status,created_at,updated_at) SELECT ${quote(randomUUID())},${quote(geminiEndpointId)},id,'all','gemini-3.1-flash-image','["gemini-3.1-flash-image"]','image','active',${now},${now} FROM model_registry WHERE canonical_model='google/gemini-3.1-flash-image';
INSERT INTO credential_inventory(id,endpoint_id,secret_cipher,secret_iv,fingerprint,masked_value,status,purpose,priority,weight,created_at,updated_at) VALUES(${quote(geminiCredentialId)},${quote(geminiEndpointId)},${quote(encrypted.cipher)},${quote(encrypted.iv)},${quote(randomUUID())},'qa-••••','available','production',10,100,${now},${now});
INSERT INTO credential_model_access(credential_id,upstream_model_id,access_state,source,success_count,failure_count,last_checked_at,last_success_at) VALUES(${quote(geminiCredentialId)},'gemini-3.1-flash-image','verified','manual',1,0,${now},${now});
INSERT INTO model_price_versions(id,model_id,audience,metric,currency,unit_size,amount_micros,effective_from,created_at) VALUES(${quote(randomUUID())},${quote(geminiOfferingId)},'merchant','image','USD',1,50000,${now},${now});
INSERT INTO model_price_versions(id,model_id,audience,metric,currency,unit_size,amount_micros,effective_from,created_at) VALUES(${quote(randomUUID())},${quote(geminiOfferingId)},'customer','image','USD',1,55000,${now},${now});
INSERT INTO customer_wallet_movements(id,user_id,currency,kind,reference_type,reference_id,idempotency_key,available_delta_micros,reserved_delta_micros,spent_delta_micros,created_at) VALUES(${quote(randomUUID())},${quote(buyerId)},'USD','topup','qa','managed-media',${quote(`qa-topup-${randomUUID()}`)},1000000,0,0,${now});
`;

function d1File(path) {
  execFileSync(process.execPath, [wrangler, "d1", "execute", "nextmux-platform-d1", "--local", "--config", "wrangler.jsonc", "--file", path], { cwd: platform, stdio: ["ignore", "ignore", "pipe"] });
}

function d1Json(command) {
  const output = execFileSync(process.execPath, [wrangler, "d1", "execute", "nextmux-platform-d1", "--local", "--config", "wrangler.jsonc", "--command", command, "--json"], { cwd: platform, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output);
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let upstreamCalls = 0;
let requestId = "";
const server = createServer(async (request, response) => {
  const openAIRequest = request.method === "POST" && request.url === "/v1/images/generations" && request.headers.authorization === `Bearer ${upstreamKey}`;
  const geminiRequest = request.method === "POST" && request.url === "/v1beta/models/gemini-3.1-flash-image:generateContent" && request.headers["x-goog-api-key"] === upstreamKey;
  if (!openAIRequest && !geminiRequest) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":{"message":"not found"}}');
    return;
  }
  upstreamCalls += 1;
  let body = "";
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  if (geminiRequest) {
    assert.deepEqual(payload.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
    assert.equal(payload.generationConfig.imageConfig.aspectRatio, "1:1");
  } else {
    assert.equal(payload.model, "gpt-image-2");
    assert.equal(payload.n, 1);
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(geminiRequest
    ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] }
    : { data: [{ b64_json: png.toString("base64") }] }));
});

try {
  await writeFile(cleanupFile, `PRAGMA foreign_keys = ON;
DELETE FROM merchant_usage_settlements WHERE attempt_id IN (SELECT a.id FROM inference_attempts a JOIN inference_requests r ON r.id=a.request_id WHERE r.user_id LIKE 'qa-buyer-%');
DELETE FROM usage_meter_events WHERE attempt_id IN (SELECT a.id FROM inference_attempts a JOIN inference_requests r ON r.id=a.request_id WHERE r.user_id LIKE 'qa-buyer-%');
DELETE FROM inference_customer_charge_lines WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id LIKE 'qa-buyer-%');
DELETE FROM route_switch_events WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id LIKE 'qa-buyer-%');
DELETE FROM router_decisions WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id LIKE 'qa-buyer-%');
DELETE FROM inference_media_outputs WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id LIKE 'qa-buyer-%');
DELETE FROM inference_attempts WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id LIKE 'qa-buyer-%');
DELETE FROM inference_requests WHERE user_id LIKE 'qa-buyer-%';
DELETE FROM customer_wallet_movements WHERE user_id LIKE 'qa-buyer-%';
DELETE FROM customer_wallets WHERE user_id LIKE 'qa-buyer-%';
DELETE FROM merchant_usage_wallet_movements WHERE merchant_user_id LIKE 'qa-merchant-%';
DELETE FROM merchant_usage_wallets WHERE merchant_user_id LIKE 'qa-merchant-%';
DELETE FROM model_price_versions WHERE model_id IN (SELECT m.id FROM provider_models m JOIN relay_endpoints e ON e.id=m.endpoint_id WHERE e.merchant_user_id LIKE 'qa-merchant-%');
DELETE FROM provider_models WHERE endpoint_id IN (SELECT id FROM relay_endpoints WHERE merchant_user_id LIKE 'qa-merchant-%');
DELETE FROM credential_usage_daily WHERE credential_id IN (SELECT c.id FROM credential_inventory c JOIN relay_endpoints e ON e.id=c.endpoint_id WHERE e.merchant_user_id LIKE 'qa-merchant-%');
DELETE FROM credential_balance_snapshots WHERE credential_id IN (SELECT c.id FROM credential_inventory c JOIN relay_endpoints e ON e.id=c.endpoint_id WHERE e.merchant_user_id LIKE 'qa-merchant-%');
DELETE FROM credential_inventory WHERE endpoint_id IN (SELECT id FROM relay_endpoints WHERE merchant_user_id LIKE 'qa-merchant-%');
DELETE FROM relay_endpoints WHERE merchant_user_id LIKE 'qa-merchant-%';
DELETE FROM buyer_devices WHERE user_id LIKE 'qa-buyer-%';
DELETE FROM users WHERE id LIKE 'qa-buyer-%';
DELETE FROM users WHERE id LIKE 'qa-merchant-%';
`);
  d1File(cleanupFile);
  await writeFile(seedFile, seed);
  d1File(seedFile);
  await new Promise((resolveListen, rejectListen) => server.listen(4181, "0.0.0.0", error => error ? rejectListen(error) : resolveListen()));
  const requestBody = { kind: "image", input: { prompt: "A clean QA frame", width: 1024, height: 1024 }, automaticRouting: false, offeringId };
  const invoke = () => fetch("http://127.0.0.1:4173/api/gateway/media", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": requestKey, "x-nextmux-device-id": rawDevice }, body: JSON.stringify(requestBody) });
  const first = await invoke();
  if (first.status !== 200) assert.fail(await first.text());
  assert.equal(first.headers.get("content-type"), "image/png");
  assert.equal(first.headers.get("x-nextmux-charged-micros"), "55000");
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), png);
  requestId = first.headers.get("x-nextmux-call-id") || "";
  assert.ok(requestId);
  const replay = await invoke();
  if (replay.status !== 200) assert.fail(await replay.text());
  assert.equal(replay.headers.get("x-idempotent-replay"), "true");
  assert.equal(upstreamCalls, 1);
  const rows = d1Json(`SELECT r.status,r.charged_micros AS chargedMicros,s.net_micros AS merchantNet,u.metric,u.quantity,w.available_micros AS availableMicros,w.reserved_micros AS reservedMicros,w.lifetime_spent_micros AS spentMicros FROM inference_requests r JOIN inference_attempts a ON a.request_id=r.id JOIN usage_meter_events u ON u.attempt_id=a.id JOIN merchant_usage_settlements s ON s.attempt_id=a.id JOIN customer_wallets w ON w.user_id=r.user_id AND w.currency=r.currency WHERE r.id=${quote(requestId)};`);
  const result = rows[0]?.results?.[0];
  assert.deepEqual({ status: result?.status, chargedMicros: result?.chargedMicros, merchantNet: result?.merchantNet, metric: result?.metric, quantity: result?.quantity, availableMicros: result?.availableMicros, reservedMicros: result?.reservedMicros, spentMicros: result?.spentMicros }, { status: "completed", chargedMicros: 55000, merchantNet: 50000, metric: "image", quantity: 1, availableMicros: 945000, reservedMicros: 0, spentMicros: 55000 });
  const geminiResponse = await fetch("http://127.0.0.1:4173/api/gateway/media", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${requestKey}-gemini`, "x-nextmux-device-id": rawDevice }, body: JSON.stringify({ ...requestBody, offeringId: geminiOfferingId }) });
  if (geminiResponse.status !== 200) assert.fail(await geminiResponse.text());
  assert.equal(geminiResponse.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await geminiResponse.arrayBuffer()), png);
  assert.equal(upstreamCalls, 2);
  process.stdout.write("managed media gateway: passed\n");
} finally {
  if (server.listening) await new Promise(resolveClose => server.close(() => resolveClose()));
  await writeFile(cleanupFile, `PRAGMA foreign_keys = ON;
DELETE FROM merchant_usage_settlements WHERE attempt_id IN (SELECT a.id FROM inference_attempts a JOIN inference_requests r ON r.id=a.request_id WHERE r.user_id=${quote(buyerId)});
DELETE FROM usage_meter_events WHERE attempt_id IN (SELECT a.id FROM inference_attempts a JOIN inference_requests r ON r.id=a.request_id WHERE r.user_id=${quote(buyerId)});
DELETE FROM inference_customer_charge_lines WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id=${quote(buyerId)});
DELETE FROM route_switch_events WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id=${quote(buyerId)});
DELETE FROM router_decisions WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id=${quote(buyerId)});
DELETE FROM inference_media_outputs WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id=${quote(buyerId)});
DELETE FROM inference_attempts WHERE request_id IN (SELECT id FROM inference_requests WHERE user_id=${quote(buyerId)});
DELETE FROM inference_requests WHERE user_id=${quote(buyerId)};
DELETE FROM customer_wallet_movements WHERE user_id=${quote(buyerId)};
DELETE FROM customer_wallets WHERE user_id=${quote(buyerId)};
DELETE FROM merchant_usage_wallet_movements WHERE merchant_user_id=${quote(merchantId)};
DELETE FROM merchant_usage_wallets WHERE merchant_user_id=${quote(merchantId)};
DELETE FROM model_price_versions WHERE model_id IN (SELECT m.id FROM provider_models m JOIN relay_endpoints e ON e.id=m.endpoint_id WHERE e.merchant_user_id=${quote(merchantId)});
DELETE FROM provider_models WHERE endpoint_id IN (SELECT id FROM relay_endpoints WHERE merchant_user_id=${quote(merchantId)});
DELETE FROM credential_usage_daily WHERE credential_id IN (SELECT c.id FROM credential_inventory c JOIN relay_endpoints e ON e.id=c.endpoint_id WHERE e.merchant_user_id=${quote(merchantId)});
DELETE FROM credential_balance_snapshots WHERE credential_id IN (SELECT c.id FROM credential_inventory c JOIN relay_endpoints e ON e.id=c.endpoint_id WHERE e.merchant_user_id=${quote(merchantId)});
DELETE FROM credential_inventory WHERE endpoint_id IN (SELECT id FROM relay_endpoints WHERE merchant_user_id=${quote(merchantId)});
DELETE FROM relay_endpoints WHERE merchant_user_id=${quote(merchantId)};
DELETE FROM buyer_devices WHERE user_id=${quote(buyerId)};
DELETE FROM users WHERE id=${quote(buyerId)};
DELETE FROM users WHERE id=${quote(merchantId)};
`);
  try { d1File(cleanupFile); } catch {}
  await rm(seedFile, { force: true });
  await rm(cleanupFile, { force: true });
}
