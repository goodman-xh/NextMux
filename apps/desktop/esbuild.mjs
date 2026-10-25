/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const shim = name => path.join(dirname, 'build-shims', name);

/**
 * Theia's native dependency plugin assumes every optional Windows addon can be
 * compiled locally. Keep core prebuilt dependencies (PTY, file watcher and
 * ripgrep), but provide auditable JavaScript fallbacks for optional keyboard
 * layout and Windows certificate enumeration modules.
 */
const nextmuxNativePortabilityPlugin = {
    name: 'nextmux-native-portability',
    setup(build) {
        build.onResolve({ filter: /^native-keymap$/ }, () => ({
            path: shim('native-keymap.cjs')
        }));
        build.onResolve({ filter: /^@vscode\/windows-ca-certs$/ }, () => ({
            path: shim('windows-ca-certs.cjs')
        }));
    }
};

nodeOptions.plugins = [nextmuxNativePortabilityPlugin, ...nodeOptions.plugins];
// These services resolve their shipped assets on disk. Keeping the packages
// external preserves compiler standard libraries and Tree-sitter's WASM paths.
nodeOptions.external = [...nodeOptions.external, 'typescript', '@vscode/tree-sitter-wasm', '@anthropic-ai/sandbox-runtime', '@anthropic-ai/sandbox-runtime/*',
    'onnxruntime-node', 'onnxruntime-node/*'];
// Native inference runs in a child process so cancel can stop an active CPU
// kernel. Emit a sibling of the backend bundle to preserve the service's worker path.
nodeOptions.entryPoints['nextmux-canvas-on-device-worker'] = '@nextmux/theia-extension/lib/node/nextmux-canvas-on-device-worker.js';
electronOptions.entryPoints.preload = './nextmux-electron-preload.cjs';

/**
 * three is ESM-only; its CommonJS entry is a shim that calls Node's process.emitWarning before loading the ES module,
 * which has no `process` in the renderer and stopped the whole frontend from starting. The director stage's compiled
 * CommonJS `require('three')` and the addons' `import 'three'` both go straight to the one ES module build.
 */
const threeEsmPlugin = {
    name: 'nextmux-three-esm',
    setup(build) {
        build.onResolve({ filter: /^three$/ }, args => {
            // Node's resolver finds the installed three for this importer (its CommonJS entry sits next to the ES module).
            const cjs = createRequire(path.join(args.resolveDir || dirname, 'noop.js')).resolve('three');
            return { path: path.join(path.dirname(cjs), 'three.module.js') };
        });
    }
};

// The comic banner uses real frames (WebP), inlined like the PNG and JPEG assets.
const browserContext = await esbuild.context({ ...browserOptions, plugins: [threeEsmPlugin, ...browserOptions.plugins],
    loader: { ...browserOptions.loader, '.webp': 'dataurl' } });
const nodeContext = await esbuild.context(nodeOptions);
const electronContext = await esbuild.context(electronOptions);

if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
        electronContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
        await electronContext.rebuild();
        await electronContext.dispose();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
