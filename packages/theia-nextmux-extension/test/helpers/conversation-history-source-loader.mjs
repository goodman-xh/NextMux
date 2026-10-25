// Optional --import preloader: test current history source without rewriting a release's lib/ files.
import { Module, createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = new Map();
for (const name of ['common/nextmux-agent-child-drafts', 'browser/nextmux-conversation-history']) {
    const filename = fileURLToPath(new URL(`../../lib/${name}.js`, import.meta.url));
    const source = await readFile(new URL(`../../src/${name}.ts`, import.meta.url), 'utf8');
    const instance = new Module(filename);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(dirname(filename));
    const originalRequire = instance.require.bind(instance);
    instance.require = id => compiled.get(resolve(dirname(filename), `${id}.js`))?.exports ?? originalRequire(id);
    instance._compile(ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    } }).outputText, filename);
    compiled.set(filename, instance);
    require.cache[filename] = instance;
}
