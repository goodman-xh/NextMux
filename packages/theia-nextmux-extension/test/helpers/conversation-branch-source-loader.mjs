// Test the current TypeScript projection without rewriting lib/ or building the desktop.
import { Module, createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const filename = fileURLToPath(new URL('../../lib/browser/nextmux-conversation-branch.js', import.meta.url));
const source = await readFile(new URL('../../src/browser/nextmux-conversation-branch.ts', import.meta.url), 'utf8');
const instance = new Module(filename);
instance.filename = filename;
instance.paths = Module._nodeModulePaths(dirname(filename));
instance._compile(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
} }).outputText, filename);
require.cache[filename] = instance;
