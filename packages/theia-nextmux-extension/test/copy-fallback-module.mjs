import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

/**
 * nextmux-copy-fallback for harnesses that evaluate one source file on its own: every text helper imports it
 * (see nextmux-copy-fallback.ts), so their `require` has to answer that one import.
 */
const require = createRequire(import.meta.url);
const exports = {};
new Function('exports', ts.transpile(readFileSync(new URL('../src/browser/nextmux-copy-fallback.ts', import.meta.url), 'utf8'), {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
}))(exports);
export const copyFallback = exports;

export function requireCopyFallback(name) {
    if (name === './nextmux-copy-fallback') return copyFallback;
    if (name === './nextmux-composer-paste-queue') return require('../lib/browser/nextmux-composer-paste-queue.js');
    throw new Error(`unexpected import ${name}`);
}
