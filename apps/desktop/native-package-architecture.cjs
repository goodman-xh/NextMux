'use strict';

// Read container headers, never execute packaged programs. See Microsoft's PE/CLR
// specifications and Electron's ASAR format. An x86 PE is not proof of AnyCPU.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const targets = new Set(['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64']);
const within = (root, value) => {
  const relative = path.relative(root, value);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};
function assertTarget({ platform, arch }) {
  if (!targets.has(`${platform}-${arch}`)) throw new Error(`Unsupported independent desktop target: ${platform}-${arch}`);
}
function fileReader(filename) {
  const fd = fs.openSync(filename, 'r'), size = fs.fstatSync(fd).size;
  return { size, close: () => fs.closeSync(fd), read(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) throw new Error(`Truncated native container: ${filename}`);
    const buffer = Buffer.alloc(length);
    if (fs.readSync(fd, buffer, 0, length, offset) !== length) throw new Error(`Cannot read native container: ${filename}`);
    return buffer;
  } };
}
function identifyNative(reader, label = 'binary') {
  const invalid = reason => { throw new Error(`Invalid native container (${reason}): ${label}`); };
  if (reader.size < 4) return undefined;
  const magic = reader.read(0, 4), be = magic.readUInt32BE(0), le = magic.readUInt32LE(0);
  if ([0xfeedface, 0xfeedfacf].includes(le) || [0xfeedface, 0xfeedfacf].includes(be)) {
    const little = [0xfeedface, 0xfeedfacf].includes(le), header = reader.read(0, (little ? le : be) === 0xfeedfacf ? 32 : 28);
    const cpu = little ? header.readUInt32LE(4) : header.readUInt32BE(4);
    if ([0x0100000c, 0x01000007].includes(cpu) && (little ? le : be) !== 0xfeedfacf) invalid('Mach-O CPU/header width');
    return { format: 'Mach-O', platform: 'darwin', architectures: [cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : `cpu-${cpu.toString(16)}`] };
  }
  if ([0xcafebabe, 0xcafebabf].includes(be) || [0xcafebabe, 0xcafebabf].includes(le)) {
    const little = ![0xcafebabe, 0xcafebabf].includes(be), u32 = b => little ? b.readUInt32LE(0) : b.readUInt32BE(0);
    const u64 = b => Number(little ? b.readBigUInt64LE(0) : b.readBigUInt64BE(0));
    const wide = (little ? le : be) === 0xcafebabf, count = u32(reader.read(4, 4)), entrySize = wide ? 32 : 20;
    // CAFEBABE also starts Java class files. Their minor/major-version word is
    // not a plausible Mach-O slice count; they contain no native instructions.
    if (be === 0xcafebabe && count > 0xffff) return undefined;
    if (!count || count > 128 || 8 + count * entrySize > reader.size) invalid('fat header');
    const architectures = [], ranges = [];
    for (let index = 0; index < count; index++) {
      const entry = reader.read(8 + index * entrySize, entrySize), cpu = u32(entry.subarray(0, 4));
      const offset = wide ? u64(entry.subarray(8, 16)) : u32(entry.subarray(8, 12));
      const size = wide ? u64(entry.subarray(16, 24)) : u32(entry.subarray(12, 16));
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 8 + count * entrySize || size < 28 || offset + size > reader.size) invalid('fat slice bounds');
      if (ranges.some(([start, end]) => offset < end && offset + size > start)) invalid('overlapping fat slices');
      ranges.push([offset, offset + size]);
      const slice = identifyNative({ size, read: (at, length) => reader.read(offset + at, length) }, label);
      const architecture = cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : `cpu-${cpu.toString(16)}`;
      if (slice?.format !== 'Mach-O' || slice.architectures.length !== 1 || slice.architectures[0] !== architecture) invalid('fat slice CPU');
      architectures.push(architecture);
    }
    return { format: 'Mach-O universal', platform: 'darwin', architectures: [...new Set(architectures)] };
  }
  if (be === 0x7f454c46) return { format: 'ELF', platform: 'linux', architectures: [] };
  if (magic.readUInt16LE(0) !== 0x5a4d) return undefined;
  if (reader.size < 64) invalid('DOS header');
  const pe = reader.read(60, 4).readUInt32LE(0);
  if (pe < 64 || pe + 24 > reader.size) invalid('PE offset');
  const coff = reader.read(pe, 24);
  if (coff.readUInt32LE(0) !== 0x4550) invalid('PE signature');
  const machine = coff.readUInt16LE(4), sectionCount = coff.readUInt16LE(6), optionalSize = coff.readUInt16LE(20);
  if (sectionCount > 96 || optionalSize < 96 || pe + 24 + optionalSize + sectionCount * 40 > reader.size) invalid('PE headers');
  const optional = reader.read(pe + 24, optionalSize), format = optional.readUInt16LE(0);
  if (format !== 0x10b && format !== 0x20b) invalid('PE optional header');
  if ([0xaa64, 0x8664].includes(machine) && format !== 0x20b || machine === 0x14c && format !== 0x10b) invalid('PE CPU/header width');
  const directories = format === 0x10b ? 96 : 112;
  if (optionalSize < directories) invalid('PE directory header');
  const directoryCount = optional.readUInt32LE(directories - 4);
  if (directoryCount > Math.floor((optionalSize - directories) / 8)) invalid('PE directory bounds');
  let anyCpu = false;
  if (directoryCount > 14) {
    const cliRva = optional.readUInt32LE(directories + 14 * 8), cliSize = optional.readUInt32LE(directories + 14 * 8 + 4);
    const sections = reader.read(pe + 24 + optionalSize, sectionCount * 40);
    const rvaOffset = (rva, length) => {
      for (let index = 0; index < sectionCount; index++) {
        const section = sections.subarray(index * 40, (index + 1) * 40);
        const start = section.readUInt32LE(12), rawSize = section.readUInt32LE(16), raw = section.readUInt32LE(20);
        if (rva >= start && rva - start + length <= rawSize && raw + rva - start + length <= reader.size) return raw + rva - start;
      }
      invalid('CLR RVA');
    };
    if (cliRva || cliSize) {
      if (!cliRva || cliSize < 72) invalid('CLR directory');
      const cli = reader.read(rvaOffset(cliRva, 72), 72), flags = cli.readUInt32LE(16);
      if (cli.readUInt32LE(0) < 72 || cli.readUInt32LE(0) > cliSize) invalid('CLR header');
      const metadataRva = cli.readUInt32LE(8), metadataSize = cli.readUInt32LE(12);
      if (metadataSize < 4 || reader.read(rvaOffset(metadataRva, metadataSize), 4).readUInt32LE(0) !== 0x424a5342) invalid('CLR metadata');
      anyCpu = machine === 0x14c && format === 0x10b && !!(flags & 1) && !(flags & (2 | 0x10 | 0x20000))
        && cli.subarray(40, 72).every(byte => byte === 0);
    }
  }
  return { format: 'PE', platform: 'win32', architectures: anyCpu ? ['anycpu'] : [machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : machine === 0x14c ? 'ia32' : `machine-${machine.toString(16)}`], anyCpu };
}
function validateNative(info, target, label) {
  assertTarget(target);
  if (info && (info.platform !== target.platform || !info.architectures.includes(target.arch) && !info.anyCpu)) {
    throw new Error(`Native architecture mismatch for ${target.platform}-${target.arch}: ${label} (${info.format}: ${info.architectures.join(',') || info.platform})`);
  }
  return info;
}
function inspectNativeFile(filename, target) {
  const reader = fileReader(filename);
  try { const info = identifyNative(reader, filename); return target ? validateNative(info, target, filename) : info; }
  finally { reader.close(); }
}
// The architecture scan can only inspect files that exist. Require the runtime's
// complete PTY set as well, including the DLL engine used by Windows node-pty.
function assertNativePtyArtifacts(directory, target) {
  assertTarget(target);
  const required = target.platform === 'win32'
    ? ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']
    : ['pty.node'];
  return required.map(relative => {
    const filename = path.join(directory, relative);
    const native = inspectNativeFile(filename, target);
    if (!native || native.anyCpu) throw new Error(`Expected native PTY artifact for ${target.platform}-${target.arch}: ${filename}`);
    return { path: filename, ...native };
  });
}
function scanNativePackage(root, target, { asar } = {}) {
  assertTarget(target);
  const packageRoot = fs.realpathSync(root), seen = new Set(), report = { target: `${target.platform}-${target.arch}`, physicalFiles: 0, archiveFiles: 0, symbolicLinks: 0, binaries: [], violations: [] };
  const record = (info, label) => {
    if (!info && /\.(?:node|dll|dylib|exe|pyd|so(?:\.\d+)*)$/i.test(label)) throw new Error(`Invalid packaged native binary: ${label}`);
    try { validateNative(info, target, label); }
    catch (error) { report.violations.push(error.message); }
    if (info) report.binaries.push({ path: label, ...info });
  };
  const scanArchive = filename => {
    asar ??= createRequire(require.resolve('electron-builder/package.json'))('@electron/asar');
    const reader = fileReader(filename);
    try {
      // Bound the allocation in @electron/asar's header reader before invoking it.
      if (reader.size < 8 || reader.read(4, 4).readUInt32LE(0) > Math.min(reader.size - 8, 64 * 1024 * 1024)) throw new Error(`Invalid ASAR header: ${filename}`);
      const { header, headerSize } = asar.getRawHeader(filename), files = new Map();
      const flatten = (node, prefix = '') => {
        for (const [name, entry] of Object.entries(node.files || {})) {
          if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error(`Unsafe ASAR entry: ${filename}`);
          const key = prefix + name;
          files.set(key, entry);
          if (entry.files) flatten(entry, `${key}/`);
        }
      };
      flatten(header);
      for (const [name, entry] of files) {
        const label = `${path.relative(packageRoot, filename)}!/${name}`;
        if (entry.link !== undefined) {
          let destination = name;
          const chain = new Set();
          while (files.get(destination)?.link !== undefined) {
            if (chain.has(destination)) throw new Error(`Cyclic ASAR symbolic link: ${label}`);
            chain.add(destination);
            destination = path.posix.normalize(String(files.get(destination).link));
            if (path.posix.isAbsolute(destination) || destination === '..' || destination.startsWith('../') || destination.includes('\\') || !files.has(destination)) throw new Error(`Unsafe ASAR symbolic link: ${label}`);
          }
          // Every destination is scanned independently, including directory links.
          report.symbolicLinks++; continue;
        }
        if (entry.files) continue;
        report.archiveFiles++;
        if (entry.unpacked) {
          const unpacked = path.join(`${filename}.unpacked`, name);
          if (!fs.existsSync(unpacked)) throw new Error(`Missing unpacked ASAR file: ${label}`);
          visit(unpacked); continue;
        }
        if (/\.asar$/i.test(name)) throw new Error(`Nested packed ASAR must be unpacked for native validation: ${label}`);
        const offset = Number(entry.offset), size = entry.size;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || 8 + headerSize + offset + size > reader.size) throw new Error(`Invalid ASAR file bounds: ${label}`);
        record(identifyNative({ size, read: (at, length) => {
          if (at < 0 || length < 0 || at + length > size) throw new Error(`Truncated ASAR native file: ${label}`);
          return reader.read(8 + headerSize + offset + at, length);
        } }, label), label);
      }
    } finally { reader.close(); }
  };
  const visit = filename => {
    const stat = fs.lstatSync(filename), real = fs.realpathSync(filename);
    if (!within(packageRoot, real)) throw new Error(`Packaged symbolic link escapes the bundle: ${path.relative(packageRoot, filename)}`);
    if (stat.isSymbolicLink()) report.symbolicLinks++;
    if (seen.has(real)) return;
    seen.add(real);
    const resolved = stat.isSymbolicLink() ? fs.statSync(filename) : stat;
    if (resolved.isDirectory()) { for (const name of fs.readdirSync(filename)) visit(path.join(filename, name)); }
    else if (resolved.isFile()) {
      report.physicalFiles++;
      if (/\.asar$/i.test(filename)) scanArchive(filename);
      else record(inspectNativeFile(filename), path.relative(packageRoot, filename));
    } else throw new Error(`Unsupported packaged filesystem entry: ${path.relative(packageRoot, filename)}`);
  };
  visit(packageRoot);
  if (report.violations.length) {
    const error = new Error(`${report.violations.length} packaged native architecture violation(s):\n${report.violations.slice(0, 12).join('\n')}`);
    error.report = report;
    throw error;
  }
  return report;
}
module.exports = { assertTarget, identifyNative, inspectNativeFile, scanNativePackage, validateNative, assertNativePtyArtifacts };
