#!/usr/bin/env node

/**
 * Small, explicit wrapper used by the production acceptance runners.
 * It deliberately forwards only the Cloudflare commands those runners use;
 * credentials remain in the caller environment and are never logged here.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const allowed = (args[0] === 'd1' && args[1] === 'execute')
  || (args[0] === 'whoami' && args.length === 1)
  || (args[0] === 'deployments' && args[1] === 'list');
if (!allowed) {
  console.error('Unsupported Cloudflare wrapper command');
  process.exitCode = 64;
} else {
  const child = spawn('npx', ['wrangler', ...args], { stdio: 'inherit', env: process.env });
  child.once('error', () => { process.exitCode = 70; });
  child.once('exit', (code, signal) => { process.exitCode = signal ? 70 : (code ?? 70); });
}
