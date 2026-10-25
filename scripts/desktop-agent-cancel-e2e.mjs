#!/usr/bin/env node

process.argv.push('--cancel');
await import('./desktop-agent-lifecycle-e2e.mjs');
