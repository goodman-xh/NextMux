#!/usr/bin/env node
// The launch animation (apps/desktop/splash) is served next to the frontend bundle: the preload template in
// apps/desktop/package.json loads ./nextmux-splash/nextmux-splash.js, which the strict CSP allows ('self' only).
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'apps', 'desktop');
const target = join(desktop, 'lib', 'frontend', 'nextmux-splash');
await mkdir(target, { recursive: true });
await cp(join(desktop, 'splash'), target, { recursive: true });
console.log(`launch animation copied to ${target}`);
