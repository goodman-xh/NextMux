#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This script intentionally lives at the workspace root, while Puppeteer is a
// package-local dependency of the Cloudflare platform. Resolve it from that
// package instead of relying on Node's upward lookup from /scripts.
const require = createRequire(import.meta.url);
const platformDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'cloudflare-platform');
const puppeteer = require(require.resolve('puppeteer', { paths: [platformDir] }));

const verificationUrl = process.env.NEXTMUX_DEVICE_LINK_E2E_VERIFICATION_URL || '';
if (!/^https?:\/\//.test(verificationUrl)) {
  throw new Error('NEXTMUX_DEVICE_LINK_E2E_VERIFICATION_URL must contain a live /connect-device URL.');
}

const cookies = JSON.parse(process.env.NEXTMUX_DEVICE_LINK_E2E_COOKIE_JSON || '[]');
if (!Array.isArray(cookies) || cookies.length === 0) {
  throw new Error('NEXTMUX_DEVICE_LINK_E2E_COOKIE_JSON must contain an authenticated browser cookie array.');
}

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setCookie(...cookies);
  await page.goto(verificationUrl, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#device-link-form button[type="submit"]', { visible: true });

  const completed = page.waitForResponse(response => {
    const request = response.request();
    return request.method() === 'POST' && new URL(response.url()).pathname === '/api/devices/link/complete';
  });
  await page.click('#device-link-form button[type="submit"]');
  const response = await completed;
  const payload = await response.json();
  if (!response.ok() || payload.ok !== true) throw new Error(`Device authorization failed: ${JSON.stringify(payload)}`);

  const callback = new URL(payload.deepLinkUrl);
  const nonce = callback.searchParams.get('nonce') || '';
  const strict = callback.protocol === 'nextmux:'
    && callback.hostname === 'device-link'
    && callback.pathname === '/complete'
    && !callback.username && !callback.password && !callback.port && !callback.hash
    && [...callback.searchParams.keys()].length === 1
    && callback.searchParams.getAll('nonce').length === 1
    && /^[A-Za-z0-9_-]{43}$/.test(nonce)
    && callback.toString() === `nextmux://device-link/complete?nonce=${nonce}`;
  if (!strict) throw new Error(`Platform returned a non-allowlisted deep link: ${payload.deepLinkUrl}`);

  if (process.env.NEXTMUX_DEVICE_LINK_E2E_OUTPUT) {
    await writeFile(process.env.NEXTMUX_DEVICE_LINK_E2E_OUTPUT, `${payload.deepLinkUrl}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({ ok: true, deepLinkUrl: payload.deepLinkUrl, expiresAt: payload.expiresAt })}\n`);
} finally {
  await browser.close();
}
