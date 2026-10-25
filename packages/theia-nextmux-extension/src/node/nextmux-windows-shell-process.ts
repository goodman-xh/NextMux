// *****************************************************************************
// Copyright (C) 2017 Ericsson and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Constructor behavior follows @theia/terminal 1.74.1 ShellProcess. Keep its
// shell/env/cwd/size defaults and DI contract when updating Theia.
import { injectable, inject, named } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { EnvironmentUtils } from '@theia/core/lib/node/environment-utils';
import { TerminalProcess, TerminalProcessOptions, ProcessManager, MultiRingBuffer } from '@theia/process/lib/node';
import { ShellProcess, ShellProcessOptions, getRootPath } from '@theia/terminal/lib/node/shell-process';

const orderedWindowsTerminals = new WeakSet<TerminalProcess>();

/** Only successfully created backend-owned bundled-ConPTY instances are trusted. */
export function hasOrderedWindowsTerminalOutput(terminal: TerminalProcess): boolean {
    return orderedWindowsTerminals.has(terminal);
}

@injectable()
export class NextMuxWindowsShellProcess extends TerminalProcess {
    constructor(
        @inject(ShellProcessOptions) options: ShellProcessOptions,
        @inject(ProcessManager) processManager: ProcessManager,
        @inject(MultiRingBuffer) ringBuffer: MultiRingBuffer,
        @inject(ILogger) @named('terminal') logger: ILogger,
        @inject(EnvironmentUtils) environmentUtils: EnvironmentUtils,
    ) {
        const env = { COLORTERM: 'truecolor' };
        super(<TerminalProcessOptions>{
            command: options.shell || ShellProcess.getShellExecutablePath(),
            args: options.args || ShellProcess.getShellExecutableArgs(),
            options: {
                name: 'xterm-256color',
                cols: options.cols || 80,
                rows: options.rows || 24,
                cwd: getRootPath(options.rootURI),
                env: options.strictEnv !== true ? Object.assign(env, environmentUtils.mergeProcessEnv(options.env)) : Object.assign(env, options.env),
                ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
            },
            isPseudo: options.isPseudo,
        }, processManager, ringBuffer, logger);
        // node-pty throws if its target-specific bundled DLL is unavailable.
        // TerminalProcess reports that error and leaves terminal undefined;
        // never mark that instance or silently retry with the system engine.
        if (process.platform === 'win32' && !options.isPseudo && this.terminal) {
            orderedWindowsTerminals.add(this);
        }
    }
}
