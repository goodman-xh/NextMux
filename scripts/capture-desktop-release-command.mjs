#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
    throw new Error(`${name} requires a path`);
  }
  return resolve(process.argv[index + 1]);
}

const separator = process.argv.indexOf('--');
if (separator < 0 || !process.argv[separator + 1]) {
  throw new Error('Usage: capture-desktop-release-command.mjs --stdout <file> --stderr <file> -- <command> [args...]');
}

const stdoutPath = argument('--stdout');
const stderrPath = argument('--stderr');
const [command, ...args] = process.argv.slice(separator + 1);
await Promise.all([
  mkdir(dirname(stdoutPath), { recursive: true }),
  mkdir(dirname(stderrPath), { recursive: true }),
]);

const stdoutFile = createWriteStream(stdoutPath, { flags: 'w' });
const stderrFile = createWriteStream(stderrPath, { flags: 'w' });
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  windowsHide: true,
  stdio: ['inherit', 'pipe', 'pipe'],
});

child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  stdoutFile.write(chunk);
});
child.stderr.on('data', chunk => {
  process.stderr.write(chunk);
  stderrFile.write(chunk);
});

const result = await new Promise(resolveResult => {
  child.once('error', error => {
    const message = `Unable to start release command ${command}: ${error.stack || error}\n`;
    process.stderr.write(message);
    stderrFile.write(message);
  });
  child.once('close', (code, signal) => resolveResult({ code, signal }));
});
await Promise.all([
  new Promise(resolveStream => stdoutFile.end(resolveStream)),
  new Promise(resolveStream => stderrFile.end(resolveStream)),
]);

if (result.signal) {
  console.error(`Release command terminated by signal ${result.signal}: ${command}`);
  process.exitCode = 1;
} else {
  process.exitCode = Number.isInteger(result.code) && result.code >= 0 ? result.code : 1;
}
