import { DesktopDomainError } from '../common/nextmux-domain-errors';
import { posixDescendantProcessIds, terminatePosixProcesses, terminatePosixProcessTree } from './nextmux-process-tree';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { win32 as windowsPath } from 'path';
import type { Readable } from 'stream';
import { ManagedProcessRegistry, selectProcessSnapshotChunks } from '@nextmux/agent-runtime';
import type {
    ManagedProcessCallbacks,
    ManagedProcessChunk,
    ManagedProcessRegistryLike,
    ManagedProcessSessionLike,
    ManagedProcessSnapshot,
    ManagedProcessStartOptions,
    ToolProcessTerminationReason
} from '@nextmux/agent-runtime';
import { ShellCommandBuilder } from '@theia/process/lib/common/shell-command-builder';
import { ProcessManager, TerminalProcess } from '@theia/process/lib/node';
import type { DesktopTerminalProfile, DesktopTerminalShellKind } from '../common/nextmux-platform-protocol';
import { NextMuxTerminalOutputNormalizer } from './nextmux-terminal-output-normalizer';
import { hasOrderedWindowsTerminalOutput } from './nextmux-windows-shell-process';

const MIN_CHUNK_CHARACTERS = 4_096;
const TERMINAL_MARKER_PREFIX = '\u001b]777;NextMux;';
const TERMINAL_START_MARKER_PREFIX = '\u001b]777;NextMuxStart;';
const TERMINAL_MARKER_SUFFIX = '(?:\u0007|\u001b\\\\)';
const INTERRUPT_COMPLETION_GRACE_MS = 250;
const INTERRUPT_PROBE_GRACE_MS = 1_500;
const FORCED_TERMINATION_GRACE_MS = 1_000;
const CWD_CONVERSION_TIMEOUT_MS = 5_000;
const CWD_CONVERSION_MAX_BYTES = 128 * 1024;
const MAX_COMPLETED_TERMINAL_SESSIONS = 48;

// A platform request creates a fresh registry for every agent run, but all of
// those registries can point at the same backend-owned PTY. The lease therefore
// has to live at module scope rather than inside one request-scoped registry.
const ACTIVE_TERMINAL_LEASES = new WeakMap<TerminalProcess, symbol>();

export type TerminalProfileCwdConversionRunner = (
    executable: string,
    args: readonly string[]
) => Promise<string>;

export type TerminalProfileCwdResolver = (
    profile: DesktopTerminalProfile,
    cwd: string
) => Promise<string>;

function runTerminalProfileCwdConverter(executable: string, args: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(executable, [...args], {
            encoding: 'utf8',
            maxBuffer: CWD_CONVERSION_MAX_BYTES,
            timeout: CWD_CONVERSION_TIMEOUT_MS,
            windowsHide: true
        }, (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
        });
    });
}

function wslDistribution(profile: DesktopTerminalProfile): string {
    for (let index = 0; index < profile.shellArgs.length; index += 1) {
        const argument = profile.shellArgs[index];
        if (argument === '-d' || argument === '--distribution') {
            const distribution = profile.shellArgs[index + 1] || '';
            if (distribution && distribution.length <= 128 && !/[\r\n\0]/.test(distribution)) return distribution;
            break;
        }
        if (argument.startsWith('--distribution=')) {
            const distribution = argument.slice('--distribution='.length);
            if (distribution && distribution.length <= 128 && !/[\r\n\0]/.test(distribution)) return distribution;
            break;
        }
    }
    throw new DesktopDomainError('TERMINAL_WSL_DISTRIBUTION_INVALID', 'The WSL terminal profile has no valid target distribution');
}

function gitBashCygpath(profile: DesktopTerminalProfile): string {
    const shellDirectory = windowsPath.dirname(profile.shellPath);
    if (windowsPath.basename(shellDirectory).toLocaleLowerCase() !== 'bin') {
        throw new DesktopDomainError('TERMINAL_CYGPATH_UNTRUSTED', 'The Git Bash terminal profile has no trusted cygpath location');
    }
    const parentDirectory = windowsPath.dirname(shellDirectory);
    const parentName = windowsPath.basename(parentDirectory).toLocaleLowerCase();
    const gitRoot = ['usr', 'mingw32', 'mingw64'].includes(parentName)
        ? windowsPath.dirname(parentDirectory) : parentDirectory;
    return windowsPath.join(gitRoot, 'usr', 'bin', 'cygpath.exe');
}

function translatedPosixCwd(value: string): string {
    const withoutBom = value.startsWith('\ufeff') ? value.slice(1) : value;
    const normalized = withoutBom.replace(/\r?\n$/, '');
    if (!normalized.startsWith('/') || /[\r\n\0]/.test(normalized)) {
        throw new DesktopDomainError('TERMINAL_CWD_INVALID', 'The terminal cwd converter returned an invalid POSIX path');
    }
    return normalized;
}

/**
 * Converts a host Windows cwd for a POSIX shell using that profile's own path
 * utility. No drive-letter or /mnt convention is guessed: custom WSL mounts,
 * Git installations and UNC mappings remain authoritative on the target host.
 */
export async function resolveTerminalProfileCwd(
    profile: DesktopTerminalProfile,
    cwd: string,
    run: TerminalProfileCwdConversionRunner = runTerminalProfileCwdConverter
): Promise<string> {
    if (profile.shellKind !== 'wsl' && profile.shellKind !== 'git_bash') return cwd;
    if (!cwd || cwd.includes('\0') || !windowsPath.isAbsolute(cwd)) {
        throw new DesktopDomainError('TERMINAL_CWD_NOT_ABSOLUTE', 'The Windows terminal working directory is not absolute');
    }
    try {
        const output = profile.shellKind === 'wsl'
            ? await run(profile.shellPath, [
                '--distribution', wslDistribution(profile), '--exec',
                'wslpath', '-a', '-u', cwd
            ])
            : await run(gitBashCygpath(profile), ['-a', '-u', cwd]);
        return translatedPosixCwd(output);
    } catch (error) {
        throw new DesktopDomainError('TERMINAL_CWD_TRANSLATION_FAILED', `Unable to translate the working directory for ${profile.label}`, { profile: profile.label }, error instanceof Error ? error.message : String(error));
    }
}

function abortError(): Error {
    const error = new DesktopDomainError('TERMINAL_CANCELLED', 'Task was cancelled');
    error.name = 'AbortError';
    return error;
}

function safeCallback(callback: () => void | Promise<void> | undefined, onFailure: () => void): void {
    try { void Promise.resolve(callback()).catch(onFailure); }
    catch { onFailure(); }
}

function normalizedExitSignal(value: string | undefined): NodeJS.Signals | null {
    return value && /^SIG[A-Z0-9]+$/.test(value) ? value as NodeJS.Signals : null;
}

function fishQuote(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function fishCommand(options: ManagedProcessStartOptions): string {
    const executable = [options.command, ...options.args].map(fishQuote).join(' ');
    return `cd ${fishQuote(options.cwd)}; and ${executable}`;
}

function completionSuffix(kind: DesktopTerminalShellKind, markerId: string): string {
    if (kind === 'powershell') {
        return `; $__nextmuxSucceeded=$?; $__nextmuxExitCode=if ($__nextmuxSucceeded) { 0 } elseif ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 1 }; [Console]::Write([char]27 + ']777;NextMux;${markerId};' + $__nextmuxExitCode + [char]7)`;
    }
    if (kind === 'cmd') {
        // Command Prompt profiles are launched with /V:ON by the profile
        // resolver. Delayed expansion captures the command's actual exit code;
        // Windows PowerShell is used only to emit an invisible OSC marker.
        return ` & set "__nextmux_exit=!errorlevel!" & powershell.exe -NoLogo -NoProfile -NonInteractive -Command "[Console]::Write([char]27 + ']777;NextMux;${markerId};' + $env:__nextmux_exit + [char]7)"`;
    }
    if (kind === 'fish') {
        return `; set -l __nextmux_exit $status; printf '\\e]777;NextMux;${markerId};%s\\a' $__nextmux_exit`;
    }
    return `; __nextmux_exit=$?; printf '\\033]777;NextMux;${markerId};%s\\007' "$__nextmux_exit"`;
}

function commandStartPrefix(kind: DesktopTerminalShellKind, markerId: string): string {
    if (kind === 'powershell') {
        return `[Console]::Write([char]27 + ']777;NextMuxStart;${markerId}' + [char]7); `;
    }
    if (kind === 'cmd') {
        return `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "[Console]::Write([char]27 + ']777;NextMuxStart;${markerId}' + [char]7)" & `;
    }
    if (kind === 'fish') {
        return `printf '\\e]777;NextMuxStart;${markerId}\\a'; `;
    }
    return `printf '\\033]777;NextMuxStart;${markerId}\\007'; `;
}

function interruptCompletionProbe(kind: DesktopTerminalShellKind, markerId: string): string {
    if (kind === 'powershell') {
        return `[Console]::Write([char]27 + ']777;NextMux;${markerId};130' + [char]7)\r`;
    }
    if (kind === 'cmd') {
        return `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "[Console]::Write([char]27 + ']777;NextMux;${markerId};130' + [char]7)"\r`;
    }
    if (kind === 'fish') {
        return `printf '\\e]777;NextMux;${markerId};130\\a'\r`;
    }
    return `printf '\\033]777;NextMux;${markerId};130\\007'\r`;
}

function retainedMarkerPrefix(value: string, marker: string): string {
    const maximum = Math.min(value.length, marker.length - 1);
    for (let length = maximum; length > 0; length -= 1) {
        const suffix = value.slice(-length);
        if (marker.startsWith(suffix)) return suffix;
    }
    return '';
}

class AttachedTerminalSession implements ManagedProcessSessionLike {
    readonly processId = `proc-${randomUUID()}`;
    readonly #terminal: TerminalProcess;
    readonly #shellKind: DesktopTerminalShellKind;
    readonly #options: ManagedProcessStartOptions;
    readonly #callbacks: ManagedProcessCallbacks;
    readonly #outputCharacterLimit: number;
    readonly #chunks: ManagedProcessChunk[] = [];
    readonly #waiters = new Set<() => void>();
    readonly #completion: Promise<void>;
    readonly #markerId = randomUUID();
    readonly #startMarker: string;
    readonly #markerStart: string;
    readonly #markerExpression: RegExp;
    readonly #stream: Readable;
    readonly #terminalExitDisposable: { dispose(): void };
    readonly #onFinished: () => void;
    readonly #outputNormalizer: NextMuxTerminalOutputNormalizer | undefined;
    readonly #injectedCommand: string;
    #resolveCompletion!: () => void;
    #timeout: ReturnType<typeof setTimeout> | undefined;
    #sequence = 0;
    #outputCharacters = 0;
    #running = true;
    #exitCode: number | null = null;
    #exitSignal: NodeJS.Signals | null = null;
    #truncated = false;
    #failure = '';
    #terminationReason: ToolProcessTerminationReason | undefined;
    #parserTail = '';
    #commandArmed: boolean;
    #termination: Promise<boolean> | undefined;

    private constructor(
        terminal: TerminalProcess,
        profile: DesktopTerminalProfile,
        builder: ShellCommandBuilder,
        options: ManagedProcessStartOptions,
        command = '',
        onFinished: () => void = () => undefined
    ) {
        this.#terminal = terminal;
        this.#shellKind = profile.shellKind;
        this.#options = options;
        this.#callbacks = options.callbacks || {};
        this.#onFinished = onFinished;
        this.#outputCharacterLimit = Math.max(MIN_CHUNK_CHARACTERS, Math.floor(options.outputCharacterLimit));
        this.#completion = new Promise(resolve => { this.#resolveCompletion = resolve; });
        this.#startMarker = command ? `${TERMINAL_START_MARKER_PREFIX}${this.#markerId}\u0007` : '';
        this.#markerStart = `${TERMINAL_MARKER_PREFIX}${this.#markerId};`;
        this.#markerExpression = new RegExp(`${this.#markerStart}(-?\\d+)${TERMINAL_MARKER_SUFFIX}`);
        this.#injectedCommand = command
            ? `${commandStartPrefix(profile.shellKind, this.#markerId)}${command}${completionSuffix(profile.shellKind, this.#markerId)}`
            : '';
        this.#outputNormalizer = this.#injectedCommand
            ? new NextMuxTerminalOutputNormalizer('', this.#markerId)
            : undefined;
        this.#commandArmed = !this.#injectedCommand;
        this.#stream = terminal.createOutputStream();
        // MultiRingBuffer readers begin at the retained tail. Drain historical
        // bytes before arming this command so the model never re-consumes a
        // user's previous terminal output.
        while (this.#stream.read() !== null) { /* drain retained history */ }
        this.#stream.setEncoding('utf8');
        this.#stream.on('data', this.#onData);
        this.#stream.on('error', this.#onStreamError);
        this.#terminalExitDisposable = terminal.onExit(event => {
            this.#finish(event.code ?? null, normalizedExitSignal(event.signal), event.code === undefined && !event.signal
                ? 'Terminal exited before the command completed' : '');
        });
    }

    static async start(
        terminal: TerminalProcess,
        profile: DesktopTerminalProfile,
        builder: ShellCommandBuilder,
        options: ManagedProcessStartOptions,
        attachOnly = false,
        onFinished: () => void = () => undefined
    ): Promise<AttachedTerminalSession> {
        if (options.signal?.aborted) throw abortError();
        // A hidden or very narrow drawer can leave ConPTY at only a handful of
        // columns. Commands started in that stale geometry then arrive as
        // cursor-addressed screen diffs, splitting identifiers and log lines
        // before either the model or the activity terminal can consume them.
        // Establish the tool-requested PTY geometry before attaching the
        // output reader; the visible xterm remains free to resize it again.
        terminal.resize(
            Math.max(20, Math.min(500, Math.floor(options.columns ?? 120))),
            Math.max(5, Math.min(300, Math.floor(options.rows ?? 30)))
        );
        const host = { executable: terminal.executable, arguments: [...terminal.arguments] };
        const command = attachOnly ? '' : profile.shellKind === 'fish'
            ? fishCommand(options)
            : builder.buildCommand(host, {
                cwd: options.cwd,
                args: [options.command, ...options.args]
            });
        const session = new AttachedTerminalSession(terminal, profile, builder, options, command, onFinished);
        options.signal?.addEventListener('abort', session.#abort, { once: true });
        if (options.timeoutMs > 0) {
            session.#timeout = setTimeout(() => {
                session.#failure ||= 'Process timed out';
                void session.terminate('timeout');
            }, options.timeoutMs);
        }
        safeCallback(() => session.#callbacks.onStarted?.(session.processId), session.#onCallbackFailure);
        // onStarted can synchronously stop the run. Do not inject a command
        // into the shared terminal after its owning session was cancelled.
        if (options.signal?.aborted) {
            await session.terminate('cancelled');
            throw abortError();
        }
        if (attachOnly) return session;
        try {
            terminal.write(`${session.#injectedCommand}\r`);
            return session;
        } catch (error) {
            session.#finish(null, null, error instanceof Error ? error.message : 'Unable to write to terminal');
            throw error;
        }
    }

    get running(): boolean { return this.#running; }
    get tty(): boolean { return true; }

    async ready(): Promise<void> { return undefined; }

    async waitForExit(): Promise<ManagedProcessSnapshot> {
        await this.#completion;
        return this.snapshot();
    }

    async read(afterSequence = 0, maxCharacters = 65_536, waitMs = 0, signal?: AbortSignal): Promise<ManagedProcessSnapshot> {
        if (signal?.aborted) throw abortError();
        const cursor = Math.min(Math.max(0, Math.floor(afterSequence)), this.#sequence);
        if (this.#running && !this.#chunks.some(chunk => chunk.sequence > cursor) && waitMs > 0) {
            await new Promise<void>((resolve, reject) => {
                let settled = false;
                const done = (): void => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    this.#waiters.delete(done);
                    signal?.removeEventListener('abort', aborted);
                    resolve();
                };
                const aborted = (): void => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    this.#waiters.delete(done);
                    reject(abortError());
                };
                const timer = setTimeout(done, Math.max(0, Math.floor(waitMs)));
                this.#waiters.add(done);
                signal?.addEventListener('abort', aborted, { once: true });
                if (signal?.aborted) aborted();
            });
        }
        if (signal?.aborted) throw abortError();
        return this.snapshot(cursor, maxCharacters);
    }

    snapshot(afterSequence = 0, maxCharacters = Number.MAX_SAFE_INTEGER): ManagedProcessSnapshot {
        const cursor = Math.min(Math.max(0, Math.floor(afterSequence)), this.#sequence);
        const chunks = selectProcessSnapshotChunks(this.#chunks, cursor, maxCharacters);
        const firstAvailableSequence = this.#chunks[0]?.sequence ?? this.#sequence + 1;
        const nextSequence = chunks.at(-1)?.sequence ?? cursor;
        return {
            processId: this.processId,
            chunks,
            firstAvailableSequence,
            nextSequence,
            latestSequence: this.#sequence,
            hasMore: nextSequence < this.#sequence,
            retainedCharacters: this.#outputCharacters,
            outputCharacterLimit: this.#outputCharacterLimit,
            running: this.#running,
            tty: true,
            exitCode: this.#exitCode,
            signal: this.#exitSignal,
            truncated: this.#truncated && cursor + 1 < firstAvailableSequence,
            ...(this.#failure ? { failure: this.#failure } : {}),
            ...(this.#terminationReason ? { terminationReason: this.#terminationReason } : {})
        };
    }

    async write(text: string): Promise<void> {
        if (!this.#running) throw new DesktopDomainError('TERMINAL_EXITED', 'Process is no longer running');
        this.#terminal.write(text);
    }

    async closeStdin(): Promise<void> {
        if (this.#running) this.#terminal.write(process.platform === 'win32' ? '\u001a\r' : '\u0004');
    }

    resize(columns: number, rows: number): void {
        if (!this.#running) return;
        this.#terminal.resize(
            Math.max(20, Math.min(500, Math.floor(columns))),
            Math.max(5, Math.min(300, Math.floor(rows)))
        );
    }

    async terminate(reason: ToolProcessTerminationReason = 'requested'): Promise<boolean> {
        if (!this.#running) return false;
        this.#terminationReason ||= reason;
        this.#termination ||= this.#interruptAndConfirm();
        return this.#termination;
    }

    async #interruptAndConfirm(): Promise<boolean> {
        // Interrupt the foreground command, not the reusable shell itself. Do
        // not release the PTY lease until the command's OSC marker, a follow-up
        // probe, or the terminal exit proves that the foreground process ended.
        try {
            this.#terminal.write('\u0003');
        } catch (error) {
            this.#failure ||= error instanceof Error ? error.message : 'Unable to interrupt the terminal command';
        }
        if (this.#injectedCommand && await this.#waitForCompletion(INTERRUPT_COMPLETION_GRACE_MS)) return true;

        if (this.#running) {
            // If cancellation raced the injected start marker, arm parsing now:
            // the probe is a fresh shell command and has its own exact marker.
            this.#commandArmed = true;
            this.#parserTail = '';
            try {
                this.#terminal.write(interruptCompletionProbe(this.#shellKind, this.#markerId));
            } catch (error) {
                this.#failure ||= error instanceof Error ? error.message : 'Unable to confirm terminal interruption';
            }
        }
        if (await this.#waitForCompletion(INTERRUPT_PROBE_GRACE_MS)) return true;

        let pid: number | undefined;
        let descendantsBeforeKill: number[] = [];
        if (this.#running) {
            if (process.platform !== 'win32') {
                const candidatePid = (this.#terminal as unknown as { pid?: number }).pid;
                if (typeof candidatePid === 'number' && candidatePid > 1) {
                    pid = candidatePid;
                    descendantsBeforeKill = await posixDescendantProcessIds(pid).catch(() => []);
                }
            }
            this.#failure ||= 'Foreground command did not acknowledge interruption';
            try {
                // A command that ignores Ctrl+C must not keep consuming CPU or
                // accept the next agent command. Killing the PTY is the final
                // bounded fallback; the workbench recreates it on the next run.
                this.#terminal.kill();
            } catch {
                // The exit event or bounded fallback below remains authoritative.
            }
        }
        if (await this.#waitForCompletion(FORCED_TERMINATION_GRACE_MS)) {
            if (descendantsBeforeKill.length) {
                await terminatePosixProcesses(descendantsBeforeKill).catch(() => undefined);
            }
            return true;
        }
        // node-pty's kill() sends SIGHUP, which a stubborn command can ignore: end the whole process group with
        // TERM then KILL, and only report a kill that actually happened (audit B06-04).
        let killed = false;
        if (this.#running && process.platform !== 'win32') {
            if (descendantsBeforeKill.length) {
                await terminatePosixProcesses(descendantsBeforeKill).catch(() => undefined);
            }
            if (typeof pid === 'number' && pid > 1) killed = await terminatePosixProcessTree(pid).catch(() => false);
            if (await this.#waitForCompletion(FORCED_TERMINATION_GRACE_MS)) return true;
        }
        if (this.#running) this.#finish(null, killed ? 'SIGKILL' : null, killed ? this.#failure : `${this.#failure || 'Terminal command'}; its exit could not be confirmed`);
        return killed;
    }

    async #waitForCompletion(milliseconds: number): Promise<boolean> {
        if (!this.#running) return true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            this.#completion,
            new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds); })
        ]);
        if (timer) clearTimeout(timer);
        return !this.#running;
    }

    #append(text: string, bypassNormalizer = false): void {
        if (!text || !this.#running) return;
        const normalized = bypassNormalizer ? text : (this.#outputNormalizer?.push(text) ?? text);
        if (!normalized) return;
        for (let offset = 0; offset < normalized.length;) {
            let end = Math.min(offset + MIN_CHUNK_CHARACTERS, normalized.length);
            if (end < normalized.length && /[\uD800-\uDBFF]/.test(normalized[end - 1]) && /[\uDC00-\uDFFF]/.test(normalized[end])) end -= 1;
            const value = normalized.slice(offset, end).replace(/\0/g, '');
            offset = end;
            if (!value) continue;
            const chunk: ManagedProcessChunk = { sequence: ++this.#sequence, stream: 'pty', text: value };
            this.#chunks.push(chunk);
            this.#outputCharacters += value.length;
            while (this.#outputCharacters > this.#outputCharacterLimit && this.#chunks.length) {
                const first = this.#chunks.shift()!;
                this.#outputCharacters -= first.text.length;
                this.#truncated = true;
            }
            safeCallback(() => this.#callbacks.onOutput?.(this.processId, chunk), this.#onCallbackFailure);
        }
        this.#notifyWaiters();
    }

    readonly #onData = (value: Buffer | string): void => {
        if (!this.#running) return;
        let combined = this.#parserTail + String(value);
        if (!this.#commandArmed) {
            const startIndex = combined.indexOf(this.#startMarker);
            if (startIndex < 0) {
                // Resize-triggered ConPTY repaints and the injected shell line
                // belong to the shared terminal, not to this command result.
                // Retain only a suffix that may be a split start marker.
                this.#parserTail = retainedMarkerPrefix(combined, this.#startMarker);
                return;
            }
            combined = combined.slice(startIndex + this.#startMarker.length);
            this.#parserTail = '';
            this.#commandArmed = true;
            if (!combined) return;
        }
        const match = this.#markerExpression.exec(combined);
        if (match) {
            this.#append(combined.slice(0, match.index));
            const exitCode = Number.parseInt(match[1], 10);
            const remainder = combined.slice(match.index + match[0].length);
            // The command is complete at the OSC marker. Prompt bytes that
            // follow belong to the reusable shell, not this tool result.
            this.#parserTail = '';
            this.#finish(
                this.#terminationReason ? null : Number.isSafeInteger(exitCode) ? exitCode : null,
                this.#terminationReason ? 'SIGINT' : null
            );
            if (remainder) {
                // The UI already receives the remainder from its own reader.
            }
            return;
        }
        // Retain only bytes that can still become this session's marker. This
        // preserves split-marker detection without delaying ordinary log lines.
        const markerIndex = combined.indexOf(this.#markerStart);
        if (markerIndex >= 0) {
            if (markerIndex > 0) this.#append(combined.slice(0, markerIndex));
            this.#parserTail = combined.slice(markerIndex);
            return;
        }
        const lastEscape = combined.lastIndexOf('\u001b');
        const partialMarker = lastEscape >= 0 && this.#markerStart.startsWith(combined.slice(lastEscape));
        const flushLength = partialMarker ? lastEscape : combined.length;
        if (flushLength > 0) this.#append(combined.slice(0, flushLength));
        this.#parserTail = combined.slice(flushLength);
    };

    readonly #onStreamError = (error: Error): void => {
        this.#finish(null, null, error.message);
    };

    readonly #abort = (): void => {
        this.#failure ||= 'Task was cancelled';
        void this.terminate(this.#options.signal?.reason === 'runtime_dispose' ? 'runtime_dispose' : 'cancelled');
    };

    readonly #onCallbackFailure = (): void => {
        this.#failure ||= 'Terminal event callback failed';
    };

    #finish(exitCode: number | null, signal: NodeJS.Signals | null, failure = ''): void {
        if (!this.#running) return;
        if (this.#commandArmed && this.#parserTail) this.#append(this.#parserTail);
        if (this.#commandArmed && this.#outputNormalizer) {
            const flushed = this.#outputNormalizer.flush();
            if (flushed) this.#append(flushed, true);
        }
        this.#parserTail = '';
        this.#running = false;
        this.#exitCode = exitCode;
        this.#exitSignal = signal;
        this.#failure ||= failure;
        try {
            if (this.#timeout) clearTimeout(this.#timeout);
            this.#options.signal?.removeEventListener('abort', this.#abort);
            this.#stream.off('data', this.#onData);
            this.#stream.off('error', this.#onStreamError);
            this.#stream.destroy();
            this.#terminalExitDisposable.dispose();
            safeCallback(() => this.#onFinished(), this.#onCallbackFailure);
            safeCallback(() => this.#callbacks.onExited?.(
                this.processId,
                this.#exitCode,
                this.#exitSignal,
                this.#failure || undefined,
                this.#terminationReason
            ), this.#onCallbackFailure);
        } finally {
            try { this.#notifyWaiters(); }
            finally { this.#resolveCompletion(); }
        }
    }

    #notifyWaiters(): void {
        for (const waiter of [...this.#waiters]) waiter();
    }
}

/**
 * Binds agent process tools to one backend-owned Theia terminal capability.
 * Exactly one foreground command may run at a time; completed sessions remain
 * readable until released, while the shell itself remains available to xterm.
 */
export class TheiaTerminalProcessRegistry implements ManagedProcessRegistryLike {
    readonly #terminal: TerminalProcess;
    readonly #profile: DesktopTerminalProfile;
    readonly #builder: ShellCommandBuilder;
    readonly #resolveCwd: TerminalProfileCwdResolver;
    readonly #sessions = new Map<string, AttachedTerminalSession>();
    readonly #pipeProcesses = new ManagedProcessRegistry();
    readonly #stop = new AbortController();
    #disposePromise?: Promise<void>;

    constructor(
        processManager: ProcessManager,
        builder: ShellCommandBuilder,
        terminalId: number,
        profile: DesktopTerminalProfile,
        resolveCwd: TerminalProfileCwdResolver = resolveTerminalProfileCwd
    ) {
        const process = processManager.get(terminalId);
        if (!(process instanceof TerminalProcess) || process.killed) {
            throw new DesktopDomainError('TERMINAL_UNAVAILABLE', 'The selected integrated terminal is unavailable');
        }
        const expected = profile.shellPath.replace(/\\/g, '/').toLocaleLowerCase();
        const actual = process.executable.replace(/\\/g, '/').toLocaleLowerCase();
        if (expected !== actual) throw new DesktopDomainError('TERMINAL_PROFILE_MISMATCH', 'The selected integrated terminal does not match the requested profile');
        this.#terminal = process;
        this.#profile = profile;
        this.#builder = builder;
        this.#resolveCwd = resolveCwd;
    }

    async start(options: ManagedProcessStartOptions): Promise<ManagedProcessSessionLike> {
        if (this.#stop.signal.aborted || options.signal?.aborted) throw abortError();
        options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, this.#stop.signal]) : this.#stop.signal };
        // A bounded process.run explicitly requests pipes and closed stdin.
        // Injecting it into a PTY instead changes argv/newline semantics and
        // lets commands accidentally consume the interactive shell's input.
        if (options.tty === false) return this.#pipeProcesses.start(options);
        // Typing a command into the shared shell cannot carry this run's own variables (credentials) without
        // echoing them into the visible terminal and its history: such a command gets its own terminal process.
        if (options.envOverlay && Object.keys(options.envOverlay).length) return this.#pipeProcesses.start(options);
        if (process.platform === 'win32' && !hasOrderedWindowsTerminalOutput(this.#terminal)) {
            throw new DesktopDomainError('TERMINAL_OUTPUT_ORDER_UNSUPPORTED',
                'This Windows terminal uses an older output engine. Reopen the integrated terminal before running an agent command. No command was sent.');
        }
        if ([...this.#sessions.values()].some(session => session.running)) {
            throw new DesktopDomainError('TERMINAL_BUSY', 'The integrated terminal is busy');
        }
        if (ACTIVE_TERMINAL_LEASES.has(this.#terminal)) {
            throw new DesktopDomainError('TERMINAL_BUSY', 'The integrated terminal is busy');
        }
        const lease = Symbol('nextmux-terminal-command');
        ACTIVE_TERMINAL_LEASES.set(this.#terminal, lease);
        const releaseLease = (): void => {
            if (ACTIVE_TERMINAL_LEASES.get(this.#terminal) === lease) {
                ACTIVE_TERMINAL_LEASES.delete(this.#terminal);
            }
        };
        const normalizedCommand = options.command.replace(/\\/g, '/').toLocaleLowerCase();
        const normalizedProfile = this.#profile.shellPath.replace(/\\/g, '/').toLocaleLowerCase();
        const attachOnly = Boolean(options.tty) && normalizedCommand === normalizedProfile;
        try {
            const resolvedOptions = attachOnly ? options : {
                ...options,
                cwd: await this.#resolveCwd(this.#profile, options.cwd)
            };
            if (options.signal?.aborted) throw abortError();
            const session = await AttachedTerminalSession.start(
                this.#terminal,
                this.#profile,
                this.#builder,
                resolvedOptions,
                attachOnly,
                () => {
                    releaseLease();
                    this.#prune();
                }
            );
            this.#sessions.set(session.processId, session);
            if (!session.running) this.#prune();
            if (options.signal?.aborted) {
                await session.terminate('runtime_dispose');
                this.#sessions.delete(session.processId);
                throw abortError();
            }
            return session;
        } catch (error) {
            releaseLease();
            throw error;
        }
    }

    get(processId: string): ManagedProcessSessionLike | undefined {
        return this.#sessions.get(processId) || this.#pipeProcesses.get(processId);
    }

    release(processId: string): boolean {
        if (this.#pipeProcesses.get(processId)) return this.#pipeProcesses.release(processId);
        const session = this.#sessions.get(processId);
        if (!session || session.running) return false;
        return this.#sessions.delete(processId);
    }

    #prune(): void {
        const completed = [...this.#sessions.values()].filter(session => !session.running);
        while (completed.length > MAX_COMPLETED_TERMINAL_SESSIONS) {
            const oldest = completed.shift();
            if (oldest) this.release(oldest.processId);
        }
    }

    dispose(): Promise<void> {
        this.#stop.abort('runtime_dispose');
        return this.#disposePromise ??= this.#disposeSessions();
    }

    async #disposeSessions(): Promise<void> {
        await this.#pipeProcesses.dispose();
        await Promise.allSettled([...this.#sessions.values()].filter(session => session.running)
            .map(session => session.terminate('runtime_dispose')));
        this.#sessions.clear();
    }
}
