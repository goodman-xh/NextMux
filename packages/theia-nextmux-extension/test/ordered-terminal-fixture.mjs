import { createRequire } from 'node:module';
import { TerminalProcess } from '@theia/process/lib/node/terminal-process.js';
import { ProcessManager } from '@theia/process/lib/node/process-manager.js';
import { MultiRingBuffer } from '@theia/process/lib/node/multi-ring-buffer.js';
import { NextMuxWindowsShellProcess } from '../lib/node/nextmux-windows-shell-process.js';
const require = createRequire(import.meta.url);
const pty = createRequire(require.resolve('@theia/process/lib/node/terminal-process.js'))('node-pty');
const logger = { debug() {}, info() {}, warn() {}, error() {} };
// Exercise the real constructor's successful-spawn capability registration.
// This is an isolated test PTY; it never starts a native process or exports a setter.
export function makeOrderedTerminalFixture(shell) {
    if (process.platform !== 'win32') return Object.create(TerminalProcess.prototype);
    const previous = pty.spawn;
    pty.spawn = (_command, _args, options) => {
        if (options.useConptyDll !== true) throw new Error('fixture requires the bundled ConPTY option');
        return { pid: 41013, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} };
    };
    try {
        return new NextMuxWindowsShellProcess({ shell, args: [], strictEnv: true },
            new ProcessManager(logger), new MultiRingBuffer({ size: 65536 }), logger,
            { mergeProcessEnv: env => ({ ...env }) });
    } finally { pty.spawn = previous; }
}
