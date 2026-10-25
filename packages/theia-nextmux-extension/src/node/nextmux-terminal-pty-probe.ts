import { DesktopDomainError } from '../common/nextmux-domain-errors';
import { createHash, randomUUID } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ManagedProcessSession } from '@nextmux/agent-runtime';
import type { ManagedProcessSnapshot, ManagedProcessStartOptions } from '@nextmux/agent-runtime';
import type { DesktopTerminalProfile } from '../common/nextmux-platform-protocol';

type ProbeProfile = Pick<DesktopTerminalProfile, 'shellKind' | 'shellArgs'>;

export interface TerminalProfileProbeLaunch {
    readonly args: readonly string[];
    /** Exact output token that proves the input command executed. */
    readonly expectedOutput: string;
    /** Input is used only for an unknown interactive shell with no reliable -c contract. */
    readonly input?: string;
}

interface TerminalProfileProbeSession {
    readonly running: boolean;
    ready(): Promise<void>;
    resize(columns: number, rows: number): void;
    write(text: string): Promise<void>;
    waitForExit(): Promise<Pick<ManagedProcessSnapshot, 'chunks' | 'exitCode' | 'failure'>>;
    terminate(): Promise<boolean>;
}

export interface TerminalProfilePtyProbeOptions {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly marker?: string;
    /** Outer deadline covering PTY readiness, interactive input and exit. */
    readonly timeoutMs?: number;
    readonly createSession?: (options: ManagedProcessStartOptions) => TerminalProfileProbeSession;
}

function safeMarker(value: string): string {
    return /^[A-Z0-9_]{8,120}$/.test(value) ? value : `NEXTMUX_PTY_${randomUUID().replace(/-/g, '').toUpperCase()}`;
}

function markerFragments(marker: string): readonly [string, string] {
    const midpoint = Math.ceil(marker.length / 2);
    return [marker.slice(0, midpoint), marker.slice(midpoint)];
}

function wslDistribution(profile: ProbeProfile): string {
    const optionIndex = profile.shellArgs.findIndex(value => value === '-d' || value === '--distribution');
    const distribution = optionIndex >= 0 ? profile.shellArgs[optionIndex + 1] : undefined;
    if (!distribution || distribution.length > 128 || /[\r\n\0]/.test(distribution)) {
        throw new DesktopDomainError('TERMINAL_WSL_DISTRIBUTION_INVALID', 'WSL profile has no valid distribution');
    }
    return distribution;
}

function wslMarker(marker: string, distribution: string): string {
    const suffix = `_WSL_${createHash('sha256').update(distribution).digest('hex').slice(0, 12).toUpperCase()}`;
    return `${marker.slice(0, 120 - suffix.length)}${suffix}`;
}

function posixMarkerCommand(marker: string, distribution?: string): string {
    const [left, right] = markerFragments(marker);
    return distribution
        ? `printf '%s%s:%s\\n' '${left}' '${right}' "$WSL_DISTRO_NAME"; exit 0`
        : `printf '%s%s\\n' '${left}' '${right}'; exit 0`;
}

export function terminalProfileProbeLaunch(profile: ProbeProfile, requestedMarker: string): TerminalProfileProbeLaunch {
    const marker = safeMarker(requestedMarker);
    switch (profile.shellKind) {
        case 'powershell': {
            const [left, right] = markerFragments(marker);
            return { args: [...profile.shellArgs], expectedOutput: marker, input: `Write-Output ('${left}' + '${right}'); exit 0\r\n` };
        }
        case 'cmd': {
            const [left, right] = markerFragments(marker);
            return {
                args: [...profile.shellArgs],
                expectedOutput: marker,
                input: `set "NEXTMUX_PTY_A=${left}"\r\nset "NEXTMUX_PTY_B=${right}"\r\necho(%NEXTMUX_PTY_A%%NEXTMUX_PTY_B%\r\nexit /b 0\r\n`
            };
        }
        case 'wsl': {
            const distribution = wslDistribution(profile);
            const expectedMarker = wslMarker(marker, distribution);
            return {
                args: [...profile.shellArgs],
                expectedOutput: `${expectedMarker}:${distribution}`,
                input: `${posixMarkerCommand(expectedMarker, distribution)}\n`
            };
        }
        case 'git_bash':
        case 'zsh':
        case 'bash':
        case 'fish':
        case 'sh':
            return { args: [...profile.shellArgs], expectedOutput: marker, input: `${posixMarkerCommand(marker)}\n` };
        default:
            return { args: [...profile.shellArgs], expectedOutput: marker, input: `${posixMarkerCommand(marker)}\n` };
    }
}

function cleanEnvironment(...sources: readonly (NodeJS.ProcessEnv | Readonly<Record<string, string>> | undefined)[]): NodeJS.ProcessEnv {
    const result: NodeJS.ProcessEnv = {};
    for (const source of sources) {
        for (const [key, value] of Object.entries(source || {})) {
            if (typeof value === 'string') result[key] = value;
        }
    }
    result.TERM ||= 'xterm-256color';
    return result;
}

function addWslEnvironmentEntry(value: string | undefined, name: string): string {
    const entries = String(value || '').split(':').filter(Boolean);
    if (!entries.some(entry => entry.split('/')[0] === name)) entries.push(name);
    return entries.join(':');
}

function probeEnvironment(
    profile: DesktopTerminalProfile,
    marker: string,
    ...sources: readonly (NodeJS.ProcessEnv | Readonly<Record<string, string>> | undefined)[]
): { readonly env: NodeJS.ProcessEnv; readonly disposableStateDirectory?: string } {
    const env = cleanEnvironment(...sources);
    env.NEXTMUX_TERMINAL_PROBE = '1';
    env.HISTFILE = '/dev/null';
    // fish documents an empty history session name as disabling persistence.
    env.fish_history = '';
    if (profile.shellKind === 'wsl') {
        env.WSLENV = addWslEnvironmentEntry(env.WSLENV, 'NEXTMUX_TERMINAL_PROBE');
        env.WSLENV = addWslEnvironmentEntry(env.WSLENV, 'HISTFILE');
        env.WSLENV = addWslEnvironmentEntry(env.WSLENV, 'fish_history');
    }
    if (profile.shellKind !== 'powershell') return { env };

    // PSReadLine persists history below APPDATA. Isolate that state without
    // disabling the user's real PowerShell profile, which is part of the
    // production startup path this probe must validate.
    const disposableStateDirectory = join(tmpdir(), `nextmux-terminal-probe-${marker}`);
    env.APPDATA = disposableStateDirectory;
    env.XDG_DATA_HOME = disposableStateDirectory;
    return { env, disposableStateDirectory };
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => reject(new DesktopDomainError('TERMINAL_PROBE_TIMEOUT', 'Terminal profile probe timed out')), timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Proves that the exact discovered shell can start, resize, emit and exit through node-pty. */
export async function probeTerminalProfilePty(
    profile: DesktopTerminalProfile,
    options: TerminalProfilePtyProbeOptions
): Promise<boolean> {
    const marker = safeMarker(options.marker || `NEXTMUX_PTY_${randomUUID().replace(/-/g, '').toUpperCase()}`);
    let launch: TerminalProfileProbeLaunch;
    try {
        launch = terminalProfileProbeLaunch(profile, marker);
    } catch {
        return false;
    }
    const createSession = options.createSession || (startOptions => new ManagedProcessSession(startOptions));
    const timeoutMs = Math.max(1, options.timeoutMs ?? (profile.shellKind === 'wsl' ? 10_000 : 6_000));
    const probeState = probeEnvironment(profile, marker, options.env, profile.env);
    let session: TerminalProfileProbeSession | undefined;
    try {
        if (probeState.disposableStateDirectory) {
            await mkdir(probeState.disposableStateDirectory, { recursive: true });
        }
        session = createSession({
            command: profile.shellPath,
            args: launch.args,
            cwd: options.cwd,
            env: probeState.env,
            timeoutMs,
            tty: true,
            columns: 100,
            rows: 24,
            outputCharacterLimit: 32_768
        });
        const snapshot = await withDeadline((async () => {
            await session?.ready();
            session?.resize(100, 24);
            if (launch.input) await session?.write(launch.input);
            if (!session) throw new DesktopDomainError('TERMINAL_PROBE_NOT_CREATED', 'Terminal profile probe session was not created');
            return session.waitForExit();
        })(), timeoutMs);
        const output = snapshot.chunks.map(chunk => chunk.text).join('');
        // The complete token is deliberately absent from `launch.input`, so a
        // terminal echo cannot satisfy this check. Use a token search instead
        // of line parsing because ConPTY may represent a newline as cursor
        // movement immediately after cmd.exe emits the marker.
        return snapshot.exitCode === 0 && !snapshot.failure && output.includes(launch.expectedOutput);
    } catch {
        return false;
    } finally {
        try { await session?.terminate(); } catch { /* Probe cleanup is best effort. */ }
        if (probeState.disposableStateDirectory) {
            try { await rm(probeState.disposableStateDirectory, { recursive: true, force: true }); } catch { /* State cleanup is best effort. */ }
        }
    }
}
