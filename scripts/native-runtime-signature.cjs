'use strict';

const assert = require('node:assert/strict');
const { openSync, readSync, closeSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

function isNativeBinary(file, platform) {
  const descriptor = openSync(file, 'r');
  try {
    const header = Buffer.alloc(64);
    if (readSync(descriptor, header, 0, 64, 0) < 8) return false;
    if (platform === 'darwin') return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(header.readUInt32BE(0));
    if (platform !== 'win32' || header.readUInt16LE(0) !== 0x5a4d) return false;
    const offset = header.readUInt32LE(60), signature = Buffer.alloc(4);
    return offset >= 64 && offset <= 16 * 1024 * 1024
      && readSync(descriptor, signature, 0, 4, offset) === 4 && signature.readUInt32LE(0) === 0x4550;
  } finally { closeSync(descriptor); }
}

/** Build/release verifier only. A changed hash never implies a valid signature. */
function verifyNativeRuntimeSignature(file, { platform, environment = process.env, run = spawnSync } = {}) {
  assert.ok(isNativeBinary(file, platform), `Changed runtime is not a native executable: ${file}`);
  if (platform === 'win32') {
    const publishers = String(environment.WINDOWS_PUBLISHER_NAME || '').split(';').map(value => value.trim()).filter(Boolean);
    assert.ok(publishers.length, 'WINDOWS_PUBLISHER_NAME is required to verify changed runtime bytes');
    const script = "$s=Get-AuthenticodeSignature -LiteralPath $env:NEXTMUX_RUNTIME_SIGNATURE_FILE; [pscustomobject]@{status=$s.Status.ToString();publisher=$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)} | ConvertTo-Json -Compress";
    const result = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...environment, NEXTMUX_RUNTIME_SIGNATURE_FILE: file }
    });
    assert.equal(result.status, 0, 'Native runtime Authenticode inspection failed');
    const signature = JSON.parse(result.stdout.trim());
    assert.equal(signature.status, 'Valid', 'Changed native runtime has an invalid Authenticode signature');
    assert.ok(publishers.includes(signature.publisher), 'Changed native runtime has an unexpected publisher');
    return { publisher: signature.publisher };
  }
  assert.equal(platform, 'darwin', 'Unsupported native runtime signing platform');
  const team = String(environment.APPLE_TEAM_ID || '').trim();
  assert.ok(team, 'APPLE_TEAM_ID is required to verify changed runtime bytes');
  const verified = run('/usr/bin/codesign', ['--verify', '--strict', file], { encoding: 'utf8', timeout: 15000 });
  assert.equal(verified.status, 0, 'Changed native runtime has an invalid code signature');
  const info = run('/usr/bin/codesign', ['-d', '--verbose=4', file], { encoding: 'utf8', timeout: 15000 });
  assert.equal(info.status, 0, 'Native runtime signing identity inspection failed');
  const observedTeam = /^TeamIdentifier=(.+)$/m.exec(`${info.stdout || ''}\n${info.stderr || ''}`)?.[1]?.trim();
  assert.equal(observedTeam, team, 'Changed native runtime has an unexpected signing team');
  return { team: observedTeam };
}

module.exports = { isNativeBinary, verifyNativeRuntimeSignature };
