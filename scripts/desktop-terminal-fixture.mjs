#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

const action = process.argv[2];

if (action === '--fixture-write') {
  await writeFile(process.argv[3], process.argv[4] || 'ready');
  process.exit(Number(process.argv[5] || 0));
}

if (action === '--fixture-delayed-write') {
  await writeFile(process.argv[4], String(process.pid));
  await new Promise(resolve => setTimeout(resolve, 60_000));
  await writeFile(process.argv[3], 'unexpected');
  process.exit(0);
}

if (action === '--fixture-echo') {
  console.log(process.argv[3] || 'nextmux-terminal-copy');
  process.exit(0);
}

throw new Error(`Unknown terminal fixture action: ${action || '<missing>'}`);
