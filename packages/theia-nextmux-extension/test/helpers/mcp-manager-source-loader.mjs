// Optional --import preloader: exercise the current production source without writing lib/ during a release build.
import { Module, createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const filename = fileURLToPath(new URL('../../lib/node/nextmux-mcp-server-manager.js', import.meta.url));
const compiled = new Map();
for (const name of ['nextmux-mcp-public-description', 'nextmux-mcp-server-manager']) {
    const source = await readFile(new URL(`../../src/node/${name}.ts`, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true } }).outputText;
    const location = filename.replace('nextmux-mcp-server-manager.js', `${name}.js`);
    const instance = new Module(location);
    instance.filename = location;
    instance.paths = Module._nodeModulePaths(dirname(location));
    const originalRequire = instance.require.bind(instance);
    instance.require = id => compiled.get(id)?.exports ?? originalRequire(id);
    instance._compile(output, location);
    compiled.set(`./${name}`, instance);
    require.cache[location] = instance;
}
