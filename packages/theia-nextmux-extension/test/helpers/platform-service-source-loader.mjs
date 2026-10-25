// Run targeted service behavior tests against current source during a desktop build.
import { Module, createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const filename = fileURLToPath(new URL('../../lib/node/nextmux-platform-service.js', import.meta.url));
const source = await readFile(new URL('../../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true } }).outputText;
const instance = new Module(filename);
instance.filename = filename;
instance.paths = Module._nodeModulePaths(dirname(filename));
instance._compile(output, filename);
require.cache[filename] = instance;
