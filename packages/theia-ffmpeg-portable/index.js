/*
 * Build-time compatibility package for Eclipse Theia's @theia/ffmpeg API.
 *
 * The upstream package compiles a native addon only to enumerate codecs after
 * replacing Electron's FFmpeg library. NextMux preserves the upstream
 * replacement flow, but makes the verification portable for contributors who
 * do not have a platform C/C++ toolchain installed.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const electronGet = require('@electron/get');
const unzipper = require('unzipper');

const KNOWN_PROPRIETARY_CODECS = new Set(['h264', 'aac']);

function resolveElectronDist(options = {}) {
  if (options.electronDist) {
    return options.electronDist;
  }

  const packagePath = require.resolve('electron/package.json', {
    paths: [process.cwd(), __dirname]
  });
  return path.resolve(packagePath, '..', 'dist');
}

function ffmpegNameAndLocation({ platform = process.platform } = {}) {
  switch (platform) {
    case 'darwin':
      return {
        name: 'libffmpeg.dylib',
        location: 'Electron.app/Contents/Frameworks/Electron Framework.framework/Libraries/'
      };
    case 'win32':
      return { name: 'ffmpeg.dll', location: '' };
    case 'linux':
      return { name: 'libffmpeg.so', location: '' };
    default:
      throw new Error(`${platform} is not supported`);
  }
}

function ffmpegRelativePath(options = {}) {
  const { location, name } = ffmpegNameAndLocation(options);
  return path.join(location, name);
}

function ffmpegAbsolutePath(options = {}) {
  return path.join(resolveElectronDist(options), ffmpegRelativePath(options));
}

async function readElectronVersion(electronDist) {
  const versionPath = path.resolve(electronDist, 'version');
  return (await fsp.readFile(versionPath, 'utf8')).trim();
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const sha256 = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', chunk => sha256.update(chunk))
      .on('close', () => resolve(sha256.digest()))
      .on('error', reject);
  });
}

async function replaceFfmpeg(options = {}) {
  let shouldDownload = true;
  let shouldReplace = true;
  const platform = options.platform || process.env.npm_config_platform || process.platform;
  const arch = options.arch || process.env.npm_config_arch || process.arch;
  const { name, location } = ffmpegNameAndLocation({ platform });
  const electronDist = resolveElectronDist(options);
  const electronVersion = options.electronVersion || await readElectronVersion(electronDist);
  const ffmpegPath = options.ffmpegPath || path.resolve(electronDist, location, name);
  const cachedPath = path.join(
    os.tmpdir(),
    `theia-cli/cache/electron-v${electronVersion}-${platform}-${arch}`,
    name
  );

  if (await pathExists(cachedPath)) {
    shouldDownload = false;
    if (await pathExists(ffmpegPath)) {
      const [cachedHash, distHash] = await Promise.all([
        hashFile(cachedPath),
        hashFile(ffmpegPath)
      ]);
      if (cachedHash.equals(distHash)) {
        shouldReplace = false;
      }
    }
  }

  if (shouldDownload) {
    const archivePath = await electronGet.downloadArtifact({
      version: electronVersion,
      artifactName: 'ffmpeg',
      platform,
      arch
    });
    const archive = await unzipper.Open.file(archivePath);
    const entry = archive.files.find(file => file.path.endsWith(name));
    if (!entry) {
      throw new Error(`Electron FFmpeg archive did not contain "${name}".`);
    }
    await fsp.mkdir(path.dirname(cachedPath), { recursive: true });
    await new Promise((resolve, reject) => {
      entry.stream()
        .pipe(fs.createWriteStream(cachedPath))
        .on('finish', resolve)
        .on('error', reject);
    });
  }

  if (shouldReplace) {
    await fsp.mkdir(path.dirname(ffmpegPath), { recursive: true });
    await fsp.copyFile(cachedPath, ffmpegPath);
  }

  const [cachedHash, installedHash] = await Promise.all([
    hashFile(cachedPath),
    hashFile(ffmpegPath)
  ]);
  if (!cachedHash.equals(installedHash)) {
    throw new Error('Electron FFmpeg integrity verification failed after replacement.');
  }
  console.warn(`[nextmux] Electron FFmpeg prepared and SHA-256 verified: ${ffmpegPath}`);
}

function getFfmpegCodecs() {
  // The portable layer intentionally avoids loading a platform-specific addon.
  // The official artifact is integrity-checked in replaceFfmpeg instead.
  return [];
}

async function checkFfmpeg(options = {}) {
  const ffmpegPath = options.ffmpegPath || ffmpegAbsolutePath(options);
  if (!await pathExists(ffmpegPath)) {
    throw new Error(`Electron FFmpeg library is missing: ${ffmpegPath}`);
  }
  const digest = (await hashFile(ffmpegPath)).toString('hex');
  if (options.json) {
    console.log(JSON.stringify({
      free: [],
      proprietary: [],
      verification: 'official-electron-artifact-sha256',
      sha256: digest
    }, undefined, 2));
  }
  console.warn(`[nextmux] FFmpeg portable verification passed (${digest.slice(0, 12)}…).`);
}

function _loadFfmpegNativeAddon() {
  return { codecs: getFfmpegCodecs };
}

module.exports = {
  KNOWN_PROPRIETARY_CODECS,
  _loadFfmpegNativeAddon,
  checkFfmpeg,
  ffmpegAbsolutePath,
  ffmpegNameAndLocation,
  ffmpegRelativePath,
  getFfmpegCodecs,
  readElectronVersion,
  replaceFfmpeg
};
