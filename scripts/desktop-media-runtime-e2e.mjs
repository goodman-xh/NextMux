#!/usr/bin/env node

import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';

if (process.platform !== 'win32' || process.arch !== 'arm64' || !process.env.NEXTMUX_PACKAGED_EXECUTABLE) {
  throw new Error('The bundled FFmpeg product probe must run from a packaged Windows ARM64 application.');
}

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const { socket, call, evaluate } = await connectToNextMuxWorkbench(cdpPort);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(read, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
}

try {
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  await evaluate(`(() => {
    if (!document.querySelector('[data-settings-panel="media"]')) document.querySelector('.nmx-account-trigger')?.click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('[data-settings-panel="media"]'))`),
    Boolean,
    5_000,
    'media settings navigation',
  );
  await evaluate(`document.querySelector('[data-settings-panel="media"]')?.click()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-media-runtime-settings'))`),
    Boolean,
    5_000,
    'media runtime settings',
  );
  await evaluate(`document.querySelector('.nmx-runtime-actions button:nth-child(2)')?.click()`);

  const state = await waitFor(
    () => evaluate(`(() => {
      const summary = document.querySelector('.nmx-media-runtime-card .nmx-runtime-summary');
      return {
        ready: summary?.classList.contains('is-ready') === true,
        source: summary?.querySelector('em')?.textContent?.trim() || '',
        version: summary?.querySelector('small')?.textContent?.trim() || '',
      };
    })()`),
    value => value?.ready && value.source === 'bundled' && value.version.length > 0,
    10_000,
    'packaged bundled FFmpeg probe',
  );
  console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, ffmpeg: state }));
} finally {
  socket.close();
}
