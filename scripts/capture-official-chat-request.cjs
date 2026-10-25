/** Opt-in --require preload. No action unless NEXTMUX_PRIVATE_CAPTURE_CONFIG is set. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_BODY_BYTES = 1024 * 1024;
const fail = code => { throw new Error(code); };
const owned = stat => typeof process.getuid !== 'function' || stat.uid === process.getuid();
function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat) || (stat.mode & 0o777) !== 0o700) fail('PRIVATE_CAPTURE_DIRECTORY_REQUIRED');
}
function readPrivateFile(filename, maximum = MAX_BODY_BYTES) {
  const handle = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile() || !owned(stat) || (stat.mode & 0o777) !== 0o600 || stat.size > maximum) fail('PRIVATE_CAPTURE_FILE_REQUIRED');
    const bytes = fs.readFileSync(handle);
    if (bytes.length > maximum) fail('PRIVATE_CAPTURE_FILE_TOO_LARGE');
    return bytes;
  } finally { fs.closeSync(handle); }
}
function validateConfig(config) {
  if (!config || config.enabled !== true || config.version !== 1
    || Object.keys(config).some(key => !['enabled', 'version', 'endpoint', 'model', 'nonce', 'outputDirectory'].includes(key))) fail('PRIVATE_CAPTURE_INVALID_CONFIG');
  const url = new URL(config.endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith('/chat/completions') || url.href !== config.endpoint) fail('PRIVATE_CAPTURE_INVALID_ENDPOINT');
  if (config.model !== 'gpt-5.6-luna' || !/^NM_(?:WIRE_QA_[A-F0-9]{32}|LUNA_WIRE_QA_[0-9]{8}_[1-9][0-9]{0,5})$/.test(config.nonce)
    || !path.isAbsolute(config.outputDirectory)) fail('PRIVATE_CAPTURE_INVALID_TARGET');
  assertPrivateDirectory(config.outputDirectory);
  return config;
}
function userText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) return message.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  return '';
}
function createCaptureFetch(originalFetch, rawConfig) {
  const config = validateConfig(rawConfig);
  if (typeof originalFetch !== 'function') fail('PRIVATE_CAPTURE_FETCH_UNAVAILABLE');
  return async function captureFetch(input, init) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).href; }
    catch { return originalFetch(input, init); }
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    if (url !== config.endpoint || method !== 'POST') return originalFetch(input, init);
    // The actual SDK uses a string body. Unknown/streamed bodies at the armed endpoint fail closed.
    const body = init?.body;
    if (!(typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array)) fail('PRIVATE_CAPTURE_UNSUPPORTED_BODY');
    const bytes = Buffer.from(body);
    if (bytes.length > MAX_BODY_BYTES) fail('PRIVATE_CAPTURE_BODY_TOO_LARGE');
    let request;
    try { request = JSON.parse(bytes.toString('utf8')); } catch { fail('PRIVATE_CAPTURE_INVALID_JSON'); }
    if (request?.model !== config.model) {
      if (bytes.includes(Buffer.from(config.nonce))) fail('PRIVATE_CAPTURE_TARGET_MODEL_MISMATCH');
      return originalFetch(input, init);
    }
    // While armed, other Luna requests to this endpoint are blocked rather than accidentally dispatched.
    if (!Array.isArray(request.messages)) fail('PRIVATE_CAPTURE_INVALID_MESSAGES');
    const lastUser = request.messages.filter(message => message?.role === 'user').at(-1);
    const nonceLines = userText(lastUser).split(/\r?\n/).filter(line => line.trim() === config.nonce);
    if (nonceLines.length !== 1 || request.stream !== true) fail('PRIVATE_CAPTURE_TARGET_NOT_CONFIRMED');
    assertPrivateDirectory(config.outputDirectory);
    // Atomic, cross-process claim; retain it on every failure. Never fall back to the network.
    let claim;
    try { claim = fs.openSync(path.join(config.outputDirectory, 'capture-claim'), 'wx', 0o600); }
    catch { fail('PRIVATE_CAPTURE_ALREADY_CLAIMED'); }
    fs.closeSync(claim);
    try {
      fs.writeFileSync(path.join(config.outputDirectory, 'request.bin'), bytes, { flag: 'wx', mode: 0o600 });
      const report = { schemaVersion: 1, status: 'captured_without_dispatch', capturedAt: new Date().toISOString(),
        model: config.model, bodyBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        endpointSha256: createHash('sha256').update(config.endpoint).digest('hex'), nonceSha256: createHash('sha256').update(config.nonce).digest('hex'),
        messageCount: request.messages.length, systemMessageCount: request.messages.filter(message => message?.role === 'system').length,
        toolDefinitionCount: Array.isArray(request.tools) ? request.tools.length : 0,
        targetUpstreamRequestCount: 0, returnedModelResponseCount: 0 };
      fs.writeFileSync(path.join(config.outputDirectory, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } catch { fail('PRIVATE_CAPTURE_WRITE_FAILED'); }
    fail('PRIVATE_CAPTURE_COMPLETE_NO_DISPATCH');
  };
}

module.exports = { assertPrivateDirectory, readPrivateFile, validateConfig, createCaptureFetch };
if (process.env.NEXTMUX_PRIVATE_CAPTURE_CONFIG) {
  try {
    const config = JSON.parse(readPrivateFile(path.resolve(process.env.NEXTMUX_PRIVATE_CAPTURE_CONFIG), 16 * 1024).toString('utf8'));
    globalThis.fetch = createCaptureFetch(globalThis.fetch, config);
  } catch { fail('PRIVATE_CAPTURE_PRELOAD_SETUP_FAILED'); }
}
