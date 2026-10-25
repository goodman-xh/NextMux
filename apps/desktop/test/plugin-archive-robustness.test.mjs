import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { gzipSync, deflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { readArchive, readZip, writeZip } = require('../app-plugin-zip.cjs');
const body = Buffer.from('{"schema":"nextmux.app-plugin/1"}');
function tar(entries, tail = Buffer.alloc(1024)) {
  const blocks = [];
  for (const { name = 'plugin.json', data = body, type = '0', size = data.length, link = '' } of entries) {
    const header = Buffer.alloc(512);
    header.write(name); header.write(size.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156); header.write(type, 156); header.write(link, 157);
    header.write('ustar\0', 257); header.write('00', 263);
    header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, tail]));
}

test('all ZIP aliases and bounded USTAR gzip archives canonicalize a single wrapped manifest', async () => {
  for (const extension of ['nmxplugin', 'zip', 'jevplugin']) {
    assert.deepEqual(await readArchive(writeZip([['wrapped/manifest.json', body]]), `plugin.${extension}`), new Map([['plugin.json', body]]));
  }
  for (const extension of ['tar.gz', 'tgz']) {
    assert.deepEqual(await readArchive(tar([{ name: 'wrapped/', type: '5', data: Buffer.alloc(0) }, { name: 'wrapped/manifest.json' }]), `plugin.${extension}`), new Map([['plugin.json', body]]));
  }
});

function metadataPluginFiles() {
  const manifest = {
    schema: 'nextmux.app-plugin/1', id: 'com.example.metadata', version: '1.0.0',
    name: 'Metadata fixture', description: 'A plugin packaged by desktop archive tools.', author: { name: 'NextMux' },
    apps: [{ platform: 'macos', bundleId: 'com.example.game' }],
    input: { modes: ['foreground'], keys: [] }, perception: { signals: [] },
    actions: { wait: { steps: [{ wait: 10 }] } }, reflexes: [{ when: 'false', do: 'wait' }], decisions: [], events: []
  };
  const files = new Map([['plugin.json', Buffer.from(JSON.stringify(manifest))], ['README.md', Buffer.from('# Metadata fixture\n')]]);
  const checked = require('../app-plugin-core.cjs').validateManifest(manifest, { files: new Set(files.keys()) });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return files;
}

test('Finder ZIP metadata is ignored before unwrapping exactly the plugin files', async () => {
  const files = metadataPluginFiles();
  const archive = writeZip([
    ['my-plugin/', Buffer.alloc(0)],
    ...[...files].map(([name, data]) => [`my-plugin/${name}`, data]),
    ['__MACOSX/my-plugin/._plugin.json', Buffer.from('AppleDouble metadata')],
    ['my-plugin/.DS_Store', Buffer.from('Finder metadata')]
  ]);
  assert.deepEqual(await readArchive(archive, 'my-plugin.zip'), files);
});

test('TGZ ignores AppleDouble and root Thumbs.db metadata before unwrapping the plugin', async () => {
  const files = metadataPluginFiles();
  const archive = tar([
    { name: 'my-plugin/', type: '5', data: Buffer.alloc(0) },
    ...[...files].map(([name, data]) => ({ name: `my-plugin/${name}`, data })),
    { name: 'my-plugin/._plugin.json', data: Buffer.from('AppleDouble metadata') },
    { name: 'Thumbs.db', data: Buffer.from('Explorer metadata') }
  ]);
  assert.deepEqual(await readArchive(archive, 'my-plugin.tgz'), files);
});

test('ZIP refuses traversal, duplicates, forged local headers, bad CRC, symlinks and declared overflows', () => {
  for (const name of ['/plugin.json', '../plugin.json', 'a/../plugin.json', 'C:/plugin.json', 'a\\plugin.json']) {
    assert.throws(() => readZip(writeZip([[name, body]])), { code: 'package_path' });
  }
  for (const names of [['plugin.json', 'plugin.json'], ['plugin.json', 'manifest.json']]) {
    assert.throws(() => readZip(writeZip(names.map(name => [name, body]))), { code: 'package_duplicate' });
  }
  const original = writeZip([['plugin.json', body]]), central = original.readUInt32LE(original.length - 6);
  const crc = Buffer.from(original); crc[30 + 'plugin.json'.length] ^= 1;
  assert.throws(() => readZip(crc), { code: 'package_corrupt' });
  const local = Buffer.from(original); local[30] = 120;
  assert.throws(() => readZip(local), { code: 'package_corrupt' });
  const link = Buffer.from(original); link.writeUInt32LE(0o120777 * 65536, central + 38);
  assert.throws(() => readZip(link), { code: 'package_link' });
  const bomb = Buffer.from(original); bomb.writeUInt32LE(0xffffffff, central + 24);
  assert.throws(() => readZip(bomb), { code: 'package_file_size' });
  assert.throws(() => readZip(original, { maxFiles: 0 }), { code: 'package_files' });
  assert.throws(() => readZip(original, { maxTotalBytes: 1 }), { code: 'package_file_size' });
});

test('ordinary deflated ZIP entries accept compression-level flags and verify the complete inflated payload', () => {
  const stored = writeZip([['plugin.json', body]]), dataStart = 30 + 'plugin.json'.length;
  const centralStart = stored.readUInt32LE(stored.length - 6);
  const compressed = deflateRawSync(body), local = Buffer.from(stored.subarray(0, dataStart));
  const central = Buffer.from(stored.subarray(centralStart, stored.length - 22)), end = Buffer.from(stored.subarray(-22));
  local.writeUInt16LE(2, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18);
  central.writeUInt16LE(2, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20);
  end.writeUInt32LE(local.length + compressed.length, 16);
  const zip = Buffer.concat([local, compressed, central, end]);
  assert.deepEqual(readZip(zip).get('plugin.json'), body);
  // Both directory and local headers lie about the uncompressed size: native output is still bounded.
  zip.writeUInt32LE(body.length - 1, 22); zip.writeUInt32LE(body.length - 1, local.length + compressed.length + 24);
  assert.throws(() => readZip(zip), { code: 'package_corrupt' });
});

test('tar rejects unsafe paths, all link/device/extension types, duplicate names and oversized headers', async () => {
  for (const name of ['/plugin.json', '../plugin.json', 'a/../plugin.json', 'C:/plugin.json', 'a\\plugin.json']) {
    await assert.rejects(readArchive(tar([{ name }]), 'p.tgz'), { code: 'package_path' });
  }
  for (const type of ['1', '2', '3', '4', '6', '7', 'x', 'g', 'L', 'K', 'S']) {
    await assert.rejects(readArchive(tar([{ type }]), 'p.tgz'), { code: 'package_link' });
  }
  await assert.rejects(readArchive(tar([{ link: 'elsewhere' }]), 'p.tgz'), { code: 'package_link' });
  for (const names of [['plugin.json', 'plugin.json'], ['plugin.json', 'manifest.json']]) {
    await assert.rejects(readArchive(tar(names.map(name => ({ name }))), 'p.tgz'), { code: 'package_duplicate' });
  }
  await assert.rejects(readArchive(tar([{ size: 0x7fffffff, data: Buffer.alloc(0) }]), 'p.tgz'), { code: 'package_file_size' });
  await assert.rejects(readArchive(tar([{}]), 'p.tgz', { maxFiles: 0 }), { code: 'package_files' });
  await assert.rejects(readArchive(tar([{}]), 'p.tgz', { maxTotalBytes: 1 }), { code: 'package_file_size' });
});

test('corrupt, truncated and trailing tar/gzip content never produces a partial package', async () => {
  const valid = tar([{}]);
  // A truncated trailer can advertise an impossible ISIZE; reject that before inflation.
  await assert.rejects(readArchive(valid.subarray(0, -5), 'p.tgz'), { code: 'package_file_size' });
  for (const bytes of [Buffer.from('garbage'), tar([{}], Buffer.alloc(0)), tar([{}], Buffer.alloc(1024, 1))]) {
    await assert.rejects(readArchive(bytes, 'p.tar.gz'), { code: 'package_corrupt' });
  }
  const crc = Buffer.from(valid); crc[crc.length - 8] ^= 1;
  await assert.rejects(readArchive(crc, 'p.tgz'), { code: 'package_corrupt' });
  await assert.rejects(readArchive(tar([{ name: 'README.md' }]), 'p.tgz'), { code: 'package_manifest_missing' });
  assert.throws(() => readArchive(body, 'p.txt'), { code: 'package_format_unsupported' });
});
