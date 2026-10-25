import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Evaluate current TypeScript and its relative source dependencies in memory.
// Keep lib/ and the process-wide require cache untouched during focused tests.
export function loadCurrentSource(url, dependencies = {}) {
    const cache = new Map();
    function load(sourceUrl) {
        const filename = fileURLToPath(sourceUrl);
        if (cache.has(filename)) return cache.get(filename).exports;
        const module = { exports: {} };
        cache.set(filename, module);
        const require = createRequire(sourceUrl);
        const source = readFileSync(sourceUrl, 'utf8');
        if (filename.endsWith('.json')) {
            module.exports = JSON.parse(source);
            return module.exports;
        }
        const output = ts.transpileModule(source, { compilerOptions: {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
            esModuleInterop: true
        } }).outputText;
        new Function('require', 'module', 'exports', output)(name => {
            if (Object.hasOwn(dependencies, name)) return dependencies[name];
            if (name.startsWith('.')) {
                const relative = new URL(name, sourceUrl);
                const candidates = name.endsWith('.json') ? [relative]
                    : /\.[cm]?js$/.test(name) ? [new URL(name.replace(/\.[cm]?js$/, '.ts'), sourceUrl)]
                        : [new URL(`${name}.ts`, sourceUrl), new URL(`${name}.tsx`, sourceUrl)];
                const current = candidates.find(candidate => existsSync(candidate));
                if (current) return load(current);
            }
            return require(name);
        }, module, module.exports);
        return module.exports;
    }
    return load(url);
}
