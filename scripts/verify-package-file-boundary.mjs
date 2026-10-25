import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'));
const asar = builderRequire('@electron/asar');
const forbidden = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.dev\.vars(?:\.[^/]*)?|windows-codex-backup)(?:\/|$)/i;

/** A filename boundary, not a claim that arbitrary source text has no secrets.
 * Scan the actual archive AND physical extra/unpacked resources, without reading
 * credentials or following links outside the packaged Resources directory. */
export async function verifyPackageFileBoundary(resourcesDirectory) {
  const entries = asar.listPackage(join(resourcesDirectory, 'app.asar'));
  let forbiddenEntries = entries.filter(name => forbidden.test(name.replaceAll('\\', '/'))).length;
  let physicalEntries = 0;
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      physicalEntries++;
      if (forbidden.test(name)) forbiddenEntries++;
      if (entry.isDirectory()) await visit(join(directory, entry.name), `${name}/`);
    }
  }
  await visit(resourcesDirectory);
  if (forbiddenEntries) throw new Error(`Package file boundary rejected ${forbiddenEntries} sensitive configuration/history entries; file contents were not read.`);
  return { schemaVersion: 1, scope: 'sensitive-configuration-and-history-filenames',
    archiveEntries: entries.length, physicalEntries, forbiddenEntries: 0, followsSymbolicLinks: false, scansFileContents: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const index = process.argv.indexOf('--resources'), value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error('--resources requires the final Electron Resources directory');
  console.log(JSON.stringify(await verifyPackageFileBoundary(resolve(value))));
}
