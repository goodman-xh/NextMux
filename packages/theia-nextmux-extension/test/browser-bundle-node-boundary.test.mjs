import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Theia bundles everything the frontend entry points reach into one browser script. A Node built-in on that path,
// usually pulled in through a package root such as '@nextmux/model-runtime' (which re-exports the agent runtime's
// worker threads and node-pty), fails `theia build --mode production`; browser code imports browser-safe subpaths.
const require = createRequire(import.meta.url);
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const extension = createRequire(new URL('../package.json', import.meta.url));
const manifest = extension('./package.json');

/** Every Node built-in the compiled modules reach from `entries`, through the extension and workspace packages only. */
function nodeBuiltinChains(entries) {
    const parents = new Map(entries.map(entry => [entry, undefined]));
    const queue = [...entries], chains = [];
    for (let index = 0; index < queue.length; index++) {
        const file = queue[index];
        if (!/\.[cm]?js$/.test(file)) continue;
        const resolve = createRequire(file).resolve;
        for (const [, , request] of readFileSync(file, 'utf8').matchAll(/\brequire\((["'])([^"']+)\1\)/g)) {
            if (isBuiltin(request)) {
                const steps = [request];
                for (let at = file; at; at = parents.get(at)) steps.unshift(relative(workspaceRoot, at));
                chains.push(steps.join(' → '));
                continue;
            }
            if (!request.startsWith('.') && !request.startsWith('@nextmux/')) continue;
            let target;
            try { target = resolve(request); } catch { continue; }
            if (parents.has(target)) continue;
            parents.set(target, file);
            queue.push(target);
        }
    }
    return chains;
}

test('the guard sees through a package root: the model runtime root reaches Node built-ins', () => {
    assert.ok(nodeBuiltinChains([require.resolve('@nextmux/model-runtime')]).length > 0);
});

test('the desktop frontend reaches no Node built-in through the extension or a workspace package', () => {
    const entries = manifest.theiaExtensions.flatMap(entry => Object.entries(entry))
        .filter(([kind]) => /^(frontend|secondaryWindow)/.test(kind))
        .map(([, path]) => extension.resolve(`./${path}`));
    assert.ok(entries.length >= 2, 'the frontend and frontend preload modules are listed');
    assert.deepEqual(nodeBuiltinChains(entries), []);
});
