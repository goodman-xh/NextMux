import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Module, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Load the new independent modules without rebuilding files owned by parallel tasks. */
export async function loadCanvasToolsSource(file = 'node/nextmux-canvas-tools.ts') {
    return canvasToolsSourceModule(file);
}
const modules = new Map();
function canvasToolsSourceModule(file) {
    const filename = fileURLToPath(new URL(`../../src/${file}`, import.meta.url));
    if (modules.has(filename)) return modules.get(filename).exports;
    const instance = new Module(filename);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(dirname(filename));
    modules.set(filename, instance);
    const require = createRequire(filename);
    instance.require = id => id.startsWith('.') ? canvasToolsSourceModule(join(dirname(file), `${id.replace(/\.js$/, '')}.ts`)) : require(id);
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    instance._compile(compiled, filename);
    return instance.exports;
}
