import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = require('../app-plugin-core.cjs');
const zip = require('../app-plugin-zip.cjs');
const { build } = require('esbuild');

test('desktop ZIP adapter reads and writes packages separately from the shared portable core', () => {
  assert.equal(core.readZip, undefined);
  assert.equal(core.writeZip, undefined);
  const bytes = Buffer.from('{"schema":"nextmux.app-plugin/1"}');
  assert.deepEqual(zip.readZip(zip.writeZip([['plugin.json', bytes]])).get('plugin.json'), bytes);
  assert.throws(() => zip.readZip(Buffer.from('invalid')), error => {
    assert.deepEqual(error.diagnostic, { code: 'package_size', path: '', params: {} });
    return true;
  });
  assert.ok(require('../package.json').build.files.includes('app-plugin-zip.cjs'), 'the desktop ships its Node adapter');
  assert.deepEqual(readFileSync(new URL('../app-plugin-core.cjs', import.meta.url)), readFileSync(new URL('../../cloudflare-platform/src/app-plugin-core.cjs', import.meta.url)));
});

test('Worker validator bundles for the browser and reads a ZIP without Node compatibility', async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../cloudflare-platform/src/app-plugin-validation.js', import.meta.url))],
    bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  assert.equal(bundled.outputFiles.length, 1);
  const source = bundled.outputFiles[0].text;
  assert.doesNotMatch(source, /(?:require|__require)\(["']node:|\bBuffer\./);
  assert.ok(!Object.keys(bundled.metafile.inputs).some(name => name.endsWith('desktop/app-plugin-zip.cjs')));
  const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const bytes = zip.writeZip([['plugin.json', Buffer.from('{}')]]);
  const files = await worker.readPluginZip(new Uint8Array(bytes));
  assert.equal(new TextDecoder().decode(files.get('plugin.json')), '{}');
  assert.equal(worker.validateManifest({}).ok, false);
});
