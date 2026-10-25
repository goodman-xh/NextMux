import assert from 'node:assert/strict';
import test from 'node:test';
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { browserOptions } from '../gen-esbuild.browser.mjs';

test('browser bundle keeps the Node-only PTY runtime out of the renderer', async () => {
  const result = await esbuild.build({
    ...browserOptions,
    // Same image loader the real renderer build adds in esbuild.mjs (showcase banners are inlined).
    loader: { ...browserOptions.loader, '.webp': 'dataurl' },
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    // A read-only graph regression must not let the asset-copy plugin overwrite
    // the desktop bundle being built in parallel.
    plugins: browserOptions.plugins.filter(plugin => plugin.name !== 'plugin:copy'),
    write: false,
    metafile: true,
    logLevel: 'silent'
  });

  assert.ok(result.outputFiles?.length, 'the browser bundle should produce output files');
  const inputs = Object.keys(result.metafile?.inputs || {});
  assert.ok(inputs.some(input => /agent-runtime[\\/]runtime[\\/]citations\.cjs$/.test(input)),
    'the shared citation normalizer must be included in the real renderer graph');
  assert.equal(inputs.some(input => /agent-runtime[\\/]lib[\\/]index\.js$/.test(input)), false,
    'citation display must use the browser-safe package subpath, not the Node barrel');
  assert.equal(inputs.some(input => /windows-codex-backup|rollout-.*\.jsonl/i.test(input)), false,
    'local conversation backups must never become bundled imports');
  assert.equal(
    inputs.some(input => /(?:node-pty|agent-runtime[\\/]lib[\\/]process-session)/i.test(input)),
    false,
    'browser code must not import the filesystem/PTY-bound agent runtime entrypoint'
  );
});
