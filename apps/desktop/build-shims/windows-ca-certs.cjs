'use strict';

const childProcess = require('node:child_process');

function readWindowsRootCertificates() {
  if (process.platform !== 'win32') {
    return [];
  }

  const command = [
    "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()",
    "$paths = @('Cert:\\CurrentUser\\Root', 'Cert:\\LocalMachine\\Root')",
    'foreach ($path in $paths) {',
    '  Get-ChildItem -Path $path -ErrorAction SilentlyContinue | ForEach-Object {',
    '    [Convert]::ToBase64String($_.RawData)',
    '  }',
    '}'
  ].join('; ');

  try {
    const stdout = childProcess.execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024
    });

    return [...new Set(stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
      .map(base64 => Buffer.from(base64, 'base64'))
      .filter(buffer => buffer.length > 0);
  } catch (error) {
    console.warn('[nextmux] Windows root certificate enumeration is unavailable:', error.message);
    return [];
  }
}

class Crypt32 {
  constructor() {
    this.certificates = readWindowsRootCertificates();
    this.index = 0;
  }

  next() {
    return this.certificates[this.index++];
  }

  done() {
    this.certificates = [];
  }
}

module.exports = { Crypt32 };
