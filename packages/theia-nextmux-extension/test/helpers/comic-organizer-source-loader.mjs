import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url), modules = new Map();
let coreRuntime = require('@nextmux/comic-core');
/** Run actual source modules while independent workspace package builds may be emitting stale snapshots. */
export function sourceModule(relativeFile) {
    const filename = fileURLToPath(new URL(`../../src/${relativeFile}`, import.meta.url));
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, experimentalDecorators: true } }).outputText;
    const dependency = id => id === '@nextmux/comic-core' ? coreRuntime
        : id.startsWith('.') ? sourceModule(join(dirname(relativeFile), `${id.replace(/\.js$/, '')}.ts`)) : require(id);
    new Function('require', 'module', 'exports', compiled)(dependency, module, module.exports);
    return module.exports;
}
coreRuntime = { ...coreRuntime, ...sourceModule('../../comic-core/src/canvas.ts'),
    ...sourceModule('../../comic-core/src/project-organizer.ts'), ...sourceModule('../../comic-core/src/canvas-registry.ts') };
export const comicCoreSource = coreRuntime;
