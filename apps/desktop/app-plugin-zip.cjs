'use strict';

// Node-only package adapter. Shared validation and model rules stay portable in app-plugin-core.cjs.
const { inflateRawSync } = require('node:zlib');
const { LIMITS, allowedFile } = require('./app-plugin-core.cjs');

// ---------------------------------------------------------------------------------------------------------------
// .nmxplugin: a plain zip read by hand, with every limit checked before a byte is inflated.

const ARCHIVE_TOTAL_BYTES = 64 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const checksum = data => {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
function safeName(name, directory = false) {
  const value = directory && name.endsWith('/') ? name.slice(0, -1) : name;
  if (!value || /[\\:\u0000-\u001f\u007f]/.test(value) || value.startsWith('/')
    || value.split('/').some(part => !part || part === '.' || part === '..')) throw zipError('package_path', name);
  return value;
}
// Finder, macOS tar and Explorer add metadata entries to archives they create; they are never part of a plugin.
const systemFile = name => name.split('/').some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._')
  || /^(?:thumbs\.db|desktop\.ini)$/i.test(part));
function packageFiles(archived) {
  const files = new Map([...archived].filter(([name]) => !systemFile(name)));
  const names = [...files.keys()];
  const top = names.length && names.every(name => name.includes('/')) ? names[0].split('/')[0] : '';
  const wrapped = top && names.every(name => name.startsWith(`${top}/`));
  const result = new Map();
  for (const [name, data] of files) {
    let relative = wrapped ? name.slice(top.length + 1) : name;
    if (relative === 'manifest.json') relative = 'plugin.json';
    if (!allowedFile(relative)) throw zipError('package_unexpected_file', relative);
    if (relative.endsWith('.png') && (data.length < 8 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) throw zipError('package_not_png', relative);
    if (result.has(relative)) throw zipError('package_duplicate', relative);
    result.set(relative, data);
  }
  if (!result.has('plugin.json')) throw zipError('package_manifest_missing');
  return result;
}
function archiveLimits(options = {}) {
  const limits = { maxFiles: LIMITS.files, maxFileBytes: LIMITS.fileBytes, maxTotalBytes: ARCHIVE_TOTAL_BYTES };
  for (const key of Object.keys(limits)) if (options[key] !== undefined) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 0 || options[key] > limits[key]) throw zipError('package_size');
    limits[key] = options[key];
  }
  return limits;
}
function readZip(buffer, options) {
  const { maxFiles, maxFileBytes, maxTotalBytes } = archiveLimits(options);
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > LIMITS.packageBytes) throw zipError('package_size');
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) throw zipError('package_not_zip');
  const count = buffer.readUInt16LE(end + 10), directorySize = buffer.readUInt32LE(end + 12), directory = buffer.readUInt32LE(end + 16);
  if (count > maxFiles) throw zipError('package_files');
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count
    || count === 0xffff || directory + directorySize !== end) throw zipError('package_corrupt');
  let pointer = directory, total = 0;
  const entries = [], names = new Set(), ranges = [];
  // Validate every directory record, size and local extent before inflating any entry.
  for (let index = 0; index < count; index++) {
    if (pointer + 46 > end || buffer.readUInt32LE(pointer) !== 0x02014b50) throw zipError('package_corrupt');
    const flags = buffer.readUInt16LE(pointer + 8), method = buffer.readUInt16LE(pointer + 10), crc = buffer.readUInt32LE(pointer + 16);
    const compressedSize = buffer.readUInt32LE(pointer + 20), size = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28), extraLength = buffer.readUInt16LE(pointer + 30), commentLength = buffer.readUInt16LE(pointer + 32);
    const attributes = buffer.readUInt32LE(pointer + 38), local = buffer.readUInt32LE(pointer + 42);
    if (!nameLength || pointer + 46 + nameLength + extraLength + commentLength > end || buffer.readUInt16LE(pointer + 34)) throw zipError('package_corrupt');
    const nameBytes = buffer.subarray(pointer + 46, pointer + 46 + nameLength), name = nameBytes.toString('utf8'), isDirectory = name.endsWith('/');
    if (!Buffer.from(name).equals(nameBytes)) throw zipError('package_path');
    const canonical = safeName(name, isDirectory);
    if (names.has(canonical)) throw zipError('package_duplicate', name);
    names.add(canonical);
    const kind = (attributes >>> 16) & 0o170000;
    if (kind && kind !== 0o100000 && kind !== 0o040000) throw zipError('package_link', name);
    if (kind === 0o040000 && !isDirectory || kind === 0o100000 && isDirectory) throw zipError('package_corrupt');
    if (flags & 1) throw zipError('package_encrypted');
    if (flags & ~0x80e || ![0, 8].includes(method) || method === 0 && flags & 6) throw zipError('package_compression');
    if (size > maxFileBytes || (total += size) > maxTotalBytes) throw zipError('package_file_size', name);
    if (isDirectory && size !== 0 || method === 0 && compressedSize !== size) throw zipError('package_corrupt');
    if (local + 30 > directory || buffer.readUInt32LE(local) !== 0x04034b50) throw zipError('package_corrupt');
    const localNameLength = buffer.readUInt16LE(local + 26), localExtraLength = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressedSize;
    if (dataEnd > directory || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method
      || !buffer.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) throw zipError('package_corrupt');
    let extent = dataEnd;
    if (flags & 8) {
      const signed = dataEnd + 4 <= directory && buffer.readUInt32LE(dataEnd) === 0x08074b50;
      const descriptor = dataEnd + (signed ? 4 : 0); extent = descriptor + 12;
      if (extent > directory || buffer.readUInt32LE(descriptor) !== crc || buffer.readUInt32LE(descriptor + 4) !== compressedSize || buffer.readUInt32LE(descriptor + 8) !== size) throw zipError('package_corrupt');
    } else if (buffer.readUInt32LE(local + 14) !== crc || buffer.readUInt32LE(local + 18) !== compressedSize || buffer.readUInt32LE(local + 22) !== size) throw zipError('package_corrupt');
    if (ranges.some(([start, end]) => local < end && extent > start)) throw zipError('package_corrupt');
    ranges.push([local, extent]);
    entries.push({ name, isDirectory, method, crc, size, dataStart, dataEnd });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  if (pointer !== end) throw zipError('package_corrupt');
  const files = new Map();
  for (const entry of entries) {
    const compressed = buffer.subarray(entry.dataStart, entry.dataEnd);
    let data;
    try {
      if (entry.method === 0) data = Buffer.from(compressed);
      else {
        const result = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size), info: true });
        if (result.engine.bytesWritten !== compressed.length) throw zipError('package_corrupt');
        data = result.buffer;
      }
    } catch { throw zipError('package_corrupt', entry.name); }
    if (data.length !== entry.size || checksum(data) !== entry.crc) throw zipError('package_corrupt', entry.name);
    if (!entry.isDirectory) files.set(entry.name, data);
  }
  return packageFiles(files);
}

/** Tar headers precede their payload. Read in 512-byte blocks, validating each header before retaining data. */
async function readTarGzip(buffer, options) {
  const { maxFiles, maxFileBytes, maxTotalBytes } = archiveLimits(options);
  if (!Buffer.isBuffer(buffer) || buffer.length > LIMITS.packageBytes) throw zipError('package_size');
  if (buffer.length < 18 || buffer.readUInt16LE(0) !== 0x8b1f || buffer[2] !== 8 || buffer[3] & 0xe0) throw zipError('package_corrupt');
  const maxInflated = maxTotalBytes + (maxFiles + 2) * 1024;
  if (buffer.readUInt32LE(buffer.length - 4) > maxInflated) throw zipError('package_file_size');
  const gunzip = require('node:zlib').createGunzip({ chunkSize: 512, readableHighWaterMark: 512 });
  const files = new Map(), names = new Set();
  let partial = Buffer.alloc(0), current, remaining = 0, total = 0, inflated = 0, count = 0, zeroBlocks = 0;
  const octal = bytes => {
    const value = bytes.toString('ascii').replace(/\0.*$/, '').trim();
    if (bytes[0] & 0x80 || value && !/^[0-7]+$/.test(value)) throw zipError('package_corrupt');
    const number = value ? parseInt(value, 8) : 0;
    if (!Number.isSafeInteger(number)) throw zipError('package_file_size');
    return number;
  };
  const string = bytes => {
    const end = bytes.indexOf(0), value = bytes.subarray(0, end < 0 ? bytes.length : end);
    const name = value.toString('utf8');
    if (!Buffer.from(name).equals(value)) throw zipError('package_path');
    return name;
  };
  const block = bytes => {
    if (remaining) {
      const size = Math.min(512, remaining);
      bytes.copy(current.data, current.data.length - remaining, 0, size);
      remaining -= size;
      if (!remaining) {
        if (bytes.subarray(size).some(byte => byte !== 0)) throw zipError('package_corrupt');
        files.set(current.name, current.data); current = undefined;
      }
      return;
    }
    if (bytes.every(byte => byte === 0)) { zeroBlocks++; return; }
    if (zeroBlocks) throw zipError('package_corrupt');
    if (++count > maxFiles) throw zipError('package_files');
    const checksumValue = octal(bytes.subarray(148, 156));
    let sum = 0; for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : bytes[index];
    if (sum !== checksumValue) throw zipError('package_corrupt');
    const magic = string(bytes.subarray(257, 263));
    if (magic && magic !== 'ustar' && magic !== 'ustar ') throw zipError('package_corrupt');
    const prefix = magic ? string(bytes.subarray(345, 500)) : '';
    const name = `${prefix ? `${prefix}/` : ''}${string(bytes.subarray(0, 100))}`;
    const type = bytes[156], directory = type === 53;
    if (![0, 48, 53].includes(type) || string(bytes.subarray(157, 257))) throw zipError('package_link', name);
    const canonical = safeName(name, directory);
    if (names.has(canonical)) throw zipError('package_duplicate', name);
    names.add(canonical);
    const size = octal(bytes.subarray(124, 136));
    if (size > maxFileBytes || (total += size) > maxTotalBytes) throw zipError('package_file_size', name);
    if (directory) { if (size) throw zipError('package_corrupt'); return; }
    current = { name, data: Buffer.alloc(size) }; remaining = size;
    if (!size) { files.set(name, current.data); current = undefined; }
  };
  try {
    // The only compressed input allocation is already bounded by packageBytes. Native output is block-sized.
    await new Promise((resolve, reject) => {
      gunzip.on('data', chunk => {
        try {
          inflated += chunk.length;
          if (inflated > maxInflated) throw zipError('package_file_size');
          partial = partial.length ? Buffer.concat([partial, chunk]) : chunk;
          while (partial.length >= 512) { block(partial.subarray(0, 512)); partial = partial.subarray(512); }
        } catch (error) { gunzip.destroy(error); }
      });
      gunzip.once('error', reject);
      gunzip.once('end', resolve);
      gunzip.end(buffer);
    });
    if (remaining || partial.length || zeroBlocks < 2 || gunzip.bytesWritten !== buffer.length) throw zipError('package_corrupt');
    return packageFiles(files);
  } catch (error) { throw error?.diagnostic ? error : zipError('package_corrupt'); }
  finally { gunzip.destroy(); }
}

function readArchive(buffer, filename, options) {
  if (/\.(?:nmxplugin|zip|jevplugin)$/i.test(filename)) {
    if (Buffer.isBuffer(buffer) && buffer.length < 22) throw zipError('package_corrupt');
    return readZip(buffer, options);
  }
  if (/\.(?:tar\.gz|tgz)$/i.test(filename)) return readTarGzip(buffer, options);
  throw zipError('package_format_unsupported');
}

function zipError(code, detail) {
  return Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code, diagnostic: { code, path: detail || '', params: {} } });
}

/** Writes a zip (stored, no compression): used by the plugin packer and the tests. */
function writeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = checksum(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

module.exports = { readZip, writeZip, readTarGzip, readArchive };
