// Build-time verification only. Installed clients neither download nor install Git.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const manifest = require('./git-runtime-manifest.json');
const { verifyNativeRuntimeSignature } = require('./native-runtime-signature.cjs');
const hashFile = async file => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const within = (root, target) => {
  const delta = path.relative(root, target);
  return !path.isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${path.sep}`);
};
function targetInfo(platform, architecture) {
  const target = `${platform}-${architecture}`, entry = manifest.targets[target];
  if (!entry) throw Error(`Unsupported bundled Git target: ${target}`);
  const prefix = architecture === 'arm64' ? 'clangarm64' : 'mingw64';
  return { ...entry, target, platform, architecture,
    binary: platform === 'win32' ? 'cmd/git.exe' : 'bin/git',
    coreBinary: platform === 'win32' ? `${prefix}/bin/git.exe` : 'bin/git',
    uploadPack: platform === 'win32' ? `${prefix}/bin/git-upload-pack.exe` : 'libexec/git-core/git-upload-pack',
    execPath: platform === 'win32' ? `${prefix}/libexec/git-core` : 'libexec/git-core',
    url: `https://github.com/desktop/dugite-native/releases/download/${manifest.release}/${entry.archive}` };
}
async function inspectArchitecture(file, platform, architecture) {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(4096); const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (platform === 'darwin') {
      if (bytesRead < 8 || header.readUInt32LE(0) !== 0xfeedfacf
        || header.readUInt32LE(4) !== (architecture === 'arm64' ? 0x0100000c : 0x01000007)) throw Error(`Git Mach-O architecture mismatch: ${file}`);
    } else {
      if (bytesRead < 64 || header.readUInt16LE(0) !== 0x5a4d) throw Error(`Invalid Git PE binary: ${file}`);
      const offset = header.readUInt32LE(60), pe = Buffer.alloc(6);
      if (offset > 16 * 1024 * 1024 || (await handle.read(pe, 0, pe.length, offset)).bytesRead !== pe.length
        || pe.readUInt32LE(0) !== 0x00004550 || pe.readUInt16LE(4) !== (architecture === 'arm64' ? 0xaa64 : 0x8664)) throw Error(`Git PE architecture mismatch: ${file}`);
    }
  } finally { await handle.close(); }
}
async function inventory(root) {
  const files = {}, links = {};
  const visit = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), name = path.relative(root, file).split(path.sep).join('/');
      if (name === 'complete.json') continue;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isSymbolicLink()) {
        const link = await fs.readlink(file);
        if (path.isAbsolute(link) || !within(root, path.resolve(path.dirname(file), link)) || !within(await fs.realpath(root), await fs.realpath(file))) throw Error(`Unsafe Git runtime link: ${name}`);
        links[name] = link;
      } else if (entry.isFile()) files[name] = await hashFile(file);
      else throw Error(`Unsupported Git runtime entry: ${name}`);
    }
  };
  await visit(root); return { files, links };
}
/** Before signing verify all bytes; signing changes executable bytes, so an
 * packaged binaries with changed hashes require the expected release signer.
 */
async function verifyGitRuntime(root, { platform, architecture, packaged = false, verifySignature = verifyNativeRuntimeSignature } = {}) {
  const info = targetInfo(platform, architecture);
  const complete = JSON.parse(await fs.readFile(path.join(root, 'complete.json'), 'utf8'));
  if (complete.schema !== 1 || complete.release !== manifest.release || complete.platform !== platform || complete.architecture !== architecture
    || complete.archiveSha256 !== info.sha256 || complete.archive !== info.archive) throw Error(`Bundled Git manifest mismatch: ${info.target}`);
  if (!complete.files || typeof complete.files !== 'object' || !complete.links || typeof complete.links !== 'object') throw Error('Missing Git inventory');
  for (const name of [info.binary, info.coreBinary, 'licenses/Git-GPL-2.0.txt', 'licenses/dugite-MIT.txt', 'SOURCE-PROVENANCE.json']) {
    if (!(name in complete.files) && !(name in complete.links)) throw Error(`Incomplete Git runtime: ${name}`);
    await fs.access(path.join(root, name));
  }
  const actual = await inventory(root);
  for (const category of ['files', 'links']) {
    const expected = Object.keys(complete[category]).sort(), found = Object.keys(actual[category]).sort();
    if (JSON.stringify(expected) !== JSON.stringify(found)) throw Error(`Git runtime ${category} inventory changed`);
    for (const name of expected) {
      // Signatures are permitted to change only native executable containers.
      const signatureMutable = packaged && category === 'files' && (platform === 'darwin' && (name.startsWith('bin/') || name.startsWith('libexec/'))
        || platform === 'win32' && /\.(?:exe|dll)$/i.test(name));
      if (complete[category][name] !== actual[category][name]) {
        if (!signatureMutable) throw Error(`Git runtime integrity mismatch: ${name}`);
        verifySignature(path.join(root, name), { platform });
      }
    }
  }
  await inspectArchitecture(path.join(root, info.binary), platform, architecture);
  await inspectArchitecture(path.join(root, info.coreBinary), platform, architecture);
  await fs.access(path.join(root, info.uploadPack));
  if (platform === 'darwin') {
    await fs.access(path.join(root, info.execPath, 'git'));
    await fs.access(path.join(root, 'share/git-core/templates/description'));
  }
  return { target: info.target, release: manifest.release, files: Object.keys(complete.files).length, sha256: info.sha256 };
}
async function beforePack(context) {
  const architecture = typeof context.arch === 'string' ? context.arch : ({ 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' })[context.arch];
  const platform = context.electronPlatformName;
  // electron-builder 26 keeps the app directory on the packager's `info` (the Packager); older versions exposed it directly.
  const appDir = context.packager.appDir || context.packager.info?.appDir || context.packager.projectDir;
  const root = path.join(appDir, 'build-resources', 'git-runtime', `${platform}-${architecture}`);
  await verifyGitRuntime(root, { platform, architecture });
  if (process.env.NEXTMUX_REQUIRE_SIGNING === '1') {
    // A provenance URL is not a GPL source offer. Official release preparation
    // must supply an audited corresponding-source archive for co-distribution.
    const sourceArchive = process.env.NEXTMUX_GIT_CORRESPONDING_SOURCE;
    const expected = process.env.NEXTMUX_GIT_CORRESPONDING_SOURCE_SHA256;
    if (!sourceArchive || !/^[a-f0-9]{64}$/.test(expected || '') || await hashFile(sourceArchive) !== expected) {
      throw Error('Signed release requires NEXTMUX_GIT_CORRESPONDING_SOURCE and its SHA256; distribute this complete source archive alongside installers');
    }
  }
}
module.exports = { manifest, targetInfo, hashFile, inspectArchitecture, inventory, verifyGitRuntime, beforePack };
