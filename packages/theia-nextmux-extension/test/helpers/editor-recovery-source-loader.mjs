// Exercise current production source without mutating lib/ while a release is being verified.
import { Module, createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url), compiled = new Map();
for (const name of ['node/nextmux-recovered-tool-names', 'node/nextmux-request-stop-journal', 'node/nextmux-incognito-sessions', 'node/nextmux-conversation-store', 'node/nextmux-conversation-archive', 'common/nextmux-editor-draft-recovery', 'common/nextmux-editor-save-as', 'node/nextmux-editor-save-as', 'node/nextmux-editor-draft-recovery-store', 'node/nextmux-platform-service']) {
    const filename = fileURLToPath(new URL(`../../lib/${name}.js`, import.meta.url));
    const source = await readFile(new URL(`../../src/${name}.ts`, import.meta.url), 'utf8');
    const instance = new Module(filename);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = id => compiled.get(resolve(dirname(filename), `${id}.js`))?.exports ?? original(id);
    instance._compile(ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true
    } }).outputText, filename);
    compiled.set(filename, instance); require.cache[filename] = instance;
}
const value = name => compiled.get(fileURLToPath(new URL(`../../lib/${name}.js`, import.meta.url))).exports;
export const recovery = value('node/nextmux-editor-draft-recovery-store');
export const common = value('common/nextmux-editor-draft-recovery');
export const service = value('node/nextmux-platform-service');
export const saveAs = value('node/nextmux-editor-save-as');
export const saveAsCommon = value('common/nextmux-editor-save-as');
