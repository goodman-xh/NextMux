import { createHash } from 'crypto';
import { win32 as windowsPath } from 'path';
import type {
    DesktopTerminalArchitecture,
    DesktopTerminalProfile,
    DesktopTerminalProfileSource,
    DesktopTerminalRuntime,
    DesktopTerminalShellKind,
    DesktopTerminalSupportReason,
    DesktopWslStatus
} from '../common/nextmux-platform-protocol';

export interface TerminalProfileResolverOptions {
    readonly platform: NodeJS.Platform;
    readonly architecture?: string;
    readonly hostArchitecture?: string;
    readonly osRelease?: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly findExecutables: (name: string) => Promise<readonly string[]>;
    readonly existingExecutable: (candidate: string) => Promise<string | undefined>;
    /** Login shell from the operating-system account database (for example os.userInfo().shell). */
    readonly accountShell?: string;
    /** Parsed executable entries from /etc/shells. The caller owns I/O. */
    readonly loginShells?: readonly string[];
    /** Git for Windows installation roots discovered from trusted registry entries. */
    readonly gitInstallRoots?: readonly string[];
    /** Installed, launchable-by-name WSL distributions. */
    readonly wslDistributions?: readonly string[];
    /** True when wsl.exe was found but its distribution probe failed. */
    readonly wslProbeFailed?: boolean;
    /** Optional non-interactive launch probe. Rejected profiles never reach the settings list. */
    readonly validateProfile?: (profile: DesktopTerminalProfile) => Promise<boolean>;
}

export function parseWslDistributionOutput(value: Uint8Array): readonly string[] {
    const bytes = Buffer.from(value);
    const hasUtf16Bom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
    let zeroBytes = 0;
    for (const byte of bytes) if (byte === 0) zeroBytes += 1;
    const text = hasUtf16Bom || zeroBytes > bytes.length / 4
        ? bytes.toString('utf16le') : bytes.toString('utf8');
    const seen = new Set<string>();
    const distributions: string[] = [];
    for (const rawLine of text.replace(/^\ufeff/, '').replace(/\0/g, '').split(/\r?\n/)) {
        const name = rawLine.trim();
        if (!name || name.length > 128 || /[\r\n\0]/.test(name) || seen.has(name)) continue;
        seen.add(name);
        distributions.push(name);
    }
    return distributions;
}

function terminalArchitecture(value: string | undefined): DesktopTerminalArchitecture {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'x64' || normalized === 'amd64') return 'x64';
    if (normalized === 'arm64' || normalized === 'aarch64') return 'arm64';
    if (normalized === 'ia32' || normalized === 'x86') return 'ia32';
    return 'other';
}

function isUserFacingWslDistribution(name: string): boolean {
    const normalized = name.trim().toLocaleLowerCase();
    // Match Windows Terminal's mature profile-discovery behavior: these
    // registrations are implementation details of container products, not
    // Linux shells that a user should select as their coding terminal.
    return !normalized.startsWith('docker-desktop')
        && !normalized.startsWith('rancher-desktop');
}

function terminalSupport(
    platform: DesktopTerminalRuntime['platform'],
    architecture: DesktopTerminalArchitecture,
    hostArchitecture: DesktopTerminalArchitecture,
    osVersion: string
): { readonly status: DesktopTerminalRuntime['supportStatus']; readonly reason?: DesktopTerminalSupportReason } {
    if ((architecture !== 'x64' && architecture !== 'arm64')
        || (hostArchitecture !== 'x64' && hostArchitecture !== 'arm64')
        || (architecture === 'arm64' && hostArchitecture === 'x64')) {
        return { status: 'unsupported', reason: 'unsupported_architecture' };
    }
    if (platform !== 'windows' && platform !== 'macos') {
        return { status: 'unsupported', reason: 'terminal_profile_unavailable' };
    }
    if (platform === 'windows') {
        const build = Number.parseInt(osVersion.split('.')[2] || '', 10);
        // Current node-pty no longer contains WinPTY and documents build 18309+
        // for ConPTY. Electron's Windows-on-ARM support starts at 1903 (18362).
        // Reject older hosts before exposing a profile instead of letting the
        // native PTY fail after installation on a customer's machine.
        const minimumBuild = architecture === 'arm64' || hostArchitecture === 'arm64' ? 18362 : 18309;
        if (Number.isFinite(build) && build > 0 && build < minimumBuild) {
            return { status: 'unsupported', reason: 'windows_conpty_unavailable' };
        }
    }
    if (platform === 'macos') {
        const darwinMajor = Number.parseInt(osVersion.split('.')[0] || '', 10);
        // Electron 42 supports macOS 12 Monterey (Darwin 21) and newer.
        if (Number.isFinite(darwinMajor) && darwinMajor > 0 && darwinMajor < 21) {
            return { status: 'unsupported', reason: 'macos_version_unsupported' };
        }
    }
    return { status: 'supported' };
}

async function firstExisting(
    candidates: readonly (string | undefined)[],
    existingExecutable: TerminalProfileResolverOptions['existingExecutable']
): Promise<string | undefined> {
    return (await allExisting(candidates, existingExecutable, 1))[0];
}

/** Every existing candidate in priority order (distinct resolved paths). */
async function allExisting(
    candidates: readonly (string | undefined)[],
    existingExecutable: TerminalProfileResolverOptions['existingExecutable'],
    limit = 6
): Promise<string[]> {
    const seen = new Set<string>();
    const found: string[] = [];
    for (const candidate of candidates) {
        if (found.length >= limit) break;
        if (!candidate || candidate.includes('\0')) continue;
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const resolved = await existingExecutable(candidate);
        if (resolved && !found.some(path => path.toLowerCase() === resolved.toLowerCase())) found.push(resolved);
    }
    return found;
}

/**
 * Other installations of the same shell, tried in order when the preferred one fails its launch probe: a stale
 * pwsh.exe early on PATH must not hide a working Program Files install (audit A20-05).
 */
const profileAlternates = new WeakMap<DesktopTerminalProfile, readonly DesktopTerminalProfile[]>();
function withAlternates(first: DesktopTerminalProfile, rest: readonly DesktopTerminalProfile[]): DesktopTerminalProfile {
    if (rest.length) profileAlternates.set(first, rest);
    return first;
}

async function located(options: TerminalProfileResolverOptions, executable: string): Promise<readonly string[]> {
    try {
        return await options.findExecutables(executable);
    } catch {
        return [];
    }
}

function profile(
    id: string,
    shellKind: DesktopTerminalShellKind,
    shellPath: string,
    label: string,
    source: DesktopTerminalProfileSource,
    shellArgs: readonly string[] = [],
    env?: Readonly<Record<string, string>>
): DesktopTerminalProfile {
    return { id, shellKind, shellPath, shellArgs, label, source, ...(env ? { env } : {}) };
}

/**
 * Build an edition-specific module path that survives Theia's two environment
 * merge passes. An empty override is intentionally removed by Theia before the
 * second pass, which would re-introduce the contaminated parent value.
 */
function windowsPowerShellEnvironment(
    options: TerminalProfileResolverOptions,
    edition: 'core' | 'windows',
    shellPath: string,
    systemRoot: string
): Readonly<Record<string, string>> {
    const inherited = String(options.env.PSModulePath || options.env.PSMODULEPATH || '')
        .split(';').map(value => value.trim()).filter(Boolean);
    const belongsToOtherEdition = (value: string): boolean => edition === 'core'
        ? /(?:^|[\\/])WindowsPowerShell(?:[\\/]|$)/i.test(value)
        : /(?:^|[\\/])PowerShell[\\/]Modules(?:[\\/]|$)/i.test(value)
            && !/(?:^|[\\/])WindowsPowerShell(?:[\\/]|$)/i.test(value);
    const defaults = edition === 'core' ? [
        options.env.USERPROFILE ? windowsPath.join(options.env.USERPROFILE, 'Documents', 'PowerShell', 'Modules') : undefined,
        options.env.ProgramFiles ? windowsPath.join(options.env.ProgramFiles, 'PowerShell', 'Modules') : undefined,
        windowsPath.join(windowsPath.dirname(shellPath), 'Modules')
    ] : [
        options.env.USERPROFILE ? windowsPath.join(options.env.USERPROFILE, 'Documents', 'WindowsPowerShell', 'Modules') : undefined,
        options.env.ProgramFiles ? windowsPath.join(options.env.ProgramFiles, 'WindowsPowerShell', 'Modules') : undefined,
        windowsPath.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
    ];
    const values: string[] = [];
    const seen = new Set<string>();
    for (const value of [...inherited.filter(candidate => !belongsToOtherEdition(candidate)), ...defaults]) {
        if (!value) continue;
        const key = windowsPath.normalize(value).toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(value);
    }
    return { PSModulePath: values.join(';') };
}

async function runtime(
    options: TerminalProfileResolverOptions,
    platform: DesktopTerminalRuntime['platform'],
    discovered: readonly DesktopTerminalProfile[],
    wslStatus: DesktopWslStatus,
    wslDistributions: readonly string[]
): Promise<DesktopTerminalRuntime> {
    const profiles = [...discovered];
    const architecture = terminalArchitecture(options.architecture || process.arch);
    const hostArchitecture = terminalArchitecture(options.hostArchitecture || options.architecture || process.arch);
    const osVersion = options.osRelease || '';
    const support = terminalSupport(platform, architecture, hostArchitecture, osVersion);

    const unavailableRuntime = (
        reason: DesktopTerminalSupportReason,
        resolvedWslStatus: DesktopWslStatus = wslStatus
    ): DesktopTerminalRuntime => ({
        platform,
        architecture,
        hostArchitecture,
        osRelease: osVersion,
        supportStatus: 'unsupported',
        supportReason: reason,
        wslStatus: resolvedWslStatus,
        wslDistributions,
        detectedAt: Date.now(),
        shellKind: 'unknown',
        shellPath: '',
        label: 'Terminal unavailable',
        defaultProfileId: '',
        profiles: []
    });

    // Native PTY loading is itself unsafe on unsupported hosts (notably
    // pre-18309 Windows builds without the ConPTY contract node-pty needs).
    // Never expose a discovered executable as launchable on an unsupported
    // host. The compatibility projection stays empty and cannot be selected.
    if (support.status === 'unsupported') {
        return unavailableRuntime(support.reason || 'terminal_profile_unavailable');
    }

    const validation = options.validateProfile;
    const validationResults = profiles.map(() => true);
    if (validation) {
        // Shell discovery can return several WSL distributions plus native shells.
        // Starting every PTY probe at once makes application startup unnecessarily
        // expensive on slower customer machines, so keep validation concurrent but
        // deliberately bounded while preserving profile order.
        let nextProfileIndex = 0;
        const passes = async (candidate: DesktopTerminalProfile): Promise<boolean> => {
            try {
                return await validation(candidate);
            } catch {
                return false;
            }
        };
        const probe = async (): Promise<void> => {
            while (nextProfileIndex < profiles.length) {
                const profileIndex = nextProfileIndex++;
                validationResults[profileIndex] = await passes(profiles[profileIndex]);
                if (validationResults[profileIndex]) continue;
                for (const alternate of profileAlternates.get(profiles[profileIndex]) || []) {
                    if (!await passes(alternate)) continue;
                    profiles[profileIndex] = alternate;
                    validationResults[profileIndex] = true;
                    break;
                }
            }
        };
        await Promise.all(Array.from(
            { length: Math.min(2, profiles.length) },
            () => probe()
        ));
    }
    const availableProfiles = profiles.filter((_item, index) => validationResults[index]);
    const validatedWslProfiles = availableProfiles.filter(item => item.shellKind === 'wsl');
    // `wsl.exe --list --quiet` can expose a stale or damaged registration.
    // A distribution is selectable only after its independent launch probe
    // succeeds; otherwise reporting WSL as ready would produce a dead profile
    // on another customer's machine.
    const resolvedWslStatus: DesktopWslStatus = platform === 'windows'
        && wslStatus === 'ready'
        && validatedWslProfiles.length === 0
        ? 'probe_failed'
        : wslStatus;
    const selected = availableProfiles[0];
    if (!selected) return unavailableRuntime('terminal_profile_unavailable', resolvedWslStatus);
    return {
        platform,
        architecture,
        hostArchitecture,
        osRelease: osVersion,
        supportStatus: support.status,
        ...(support.reason ? { supportReason: support.reason } : {}),
        wslStatus: resolvedWslStatus,
        wslDistributions,
        detectedAt: Date.now(),
        shellKind: selected.shellKind,
        shellPath: selected.shellPath,
        label: selected.label,
        defaultProfileId: selected.id,
        profiles: availableProfiles
    };
}

async function resolveWindowsProfiles(options: TerminalProfileResolverOptions): Promise<DesktopTerminalRuntime> {
    const systemRoot = options.env.SystemRoot || options.env.SYSTEMROOT || 'C:\\Windows';
    const profiles: DesktopTerminalProfile[] = [];
    const installationRoots = [
        options.env.ProgramW6432,
        options.env.ProgramFiles,
        options.env['ProgramFiles(Arm)'],
        options.env['ProgramFiles(x86)']
    ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

    const powerShells = await allExisting([
        ...await located(options, 'pwsh.exe'),
        ...installationRoots.map(root => windowsPath.join(root, 'PowerShell', '7', 'pwsh.exe')),
        ...(options.env.LOCALAPPDATA ? [windowsPath.join(options.env.LOCALAPPDATA, 'Microsoft', 'PowerShell', '7', 'pwsh.exe')] : [])
    ], options.existingExecutable);
    const powerShell = powerShells[0];
    const powerShellProfile = (path: string) => profile('powershell', 'powershell', path, 'PowerShell', 'path', ['-NoLogo'],
        windowsPowerShellEnvironment(options, 'core', path, systemRoot));
    if (powerShell) profiles.push(withAlternates(powerShellProfile(powerShell), powerShells.slice(1).map(powerShellProfile)));

    const windowsPowerShell = await firstExisting([
        windowsPath.join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        windowsPath.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    ], options.existingExecutable);
    if (windowsPowerShell && windowsPowerShell.toLowerCase() !== powerShell?.toLowerCase()) {
        profiles.push(profile(
            'windows_powershell', 'powershell', windowsPowerShell, 'Windows PowerShell', 'system', ['-NoLogo'],
            windowsPowerShellEnvironment(options, 'windows', windowsPowerShell, systemRoot)
        ));
    }

    const commandPrompt = await firstExisting([
        options.env.COMSPEC,
        windowsPath.join(systemRoot, 'Sysnative', 'cmd.exe'),
        windowsPath.join(systemRoot, 'System32', 'cmd.exe'),
        ...await located(options, 'cmd.exe')
    ], options.existingExecutable);
    if (commandPrompt) profiles.push(profile('command_prompt', 'cmd', commandPrompt, 'Command Prompt', 'system', ['/V:ON']));

    const gitExecutables = await located(options, 'git.exe');
    const gitBashCandidates: string[] = [];
    for (const root of options.gitInstallRoots || []) gitBashCandidates.push(windowsPath.join(root, 'bin', 'bash.exe'));
    for (const gitExecutable of gitExecutables) {
        const root = windowsPath.dirname(windowsPath.dirname(gitExecutable));
        gitBashCandidates.push(windowsPath.join(root, 'bin', 'bash.exe'));
    }
    gitBashCandidates.push(...installationRoots.map(root => windowsPath.join(root, 'Git', 'bin', 'bash.exe')));
    if (options.env.LOCALAPPDATA) gitBashCandidates.push(windowsPath.join(options.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
    gitBashCandidates.push(...(await located(options, 'bash.exe')).filter(candidate => /[\\/]Git[\\/]/i.test(candidate)));
    const gitBashes = await allExisting(gitBashCandidates, options.existingExecutable);
    const gitBashProfile = (path: string) => {
        const fromRegistry = (options.gitInstallRoots || []).some(root => path.toLowerCase().startsWith(windowsPath.join(root, 'bin').toLowerCase()));
        return profile('git_bash', 'git_bash', path, 'Git Bash', fromRegistry ? 'registry' : 'path', ['--login', '-i'], {
            CHERE_INVOKING: '1'
        });
    };
    if (gitBashes.length) profiles.push(withAlternates(gitBashProfile(gitBashes[0]), gitBashes.slice(1).map(gitBashProfile)));

    const wslDistributions = (options.wslProbeFailed ? [] : [...new Set(options.wslDistributions || [])])
        .filter(name => Boolean(name) && name.length <= 128 && !/[\r\n\0]/.test(name)
            && isUserFacingWslDistribution(name));
    const wsl = await firstExisting([
        windowsPath.join(systemRoot, 'Sysnative', 'wsl.exe'),
        windowsPath.join(systemRoot, 'System32', 'wsl.exe'),
        ...await located(options, 'wsl.exe')
    ], options.existingExecutable);
    const wslStatus: DesktopWslStatus = !wsl ? 'unavailable'
        : options.wslProbeFailed ? 'probe_failed'
            : wslDistributions.length ? 'ready' : 'setup_required';
    if (wsl && wslStatus === 'ready') {
        for (const distribution of wslDistributions) {
            const digest = createHash('sha256').update(distribution).digest('hex').slice(0, 12);
            profiles.push(profile(`wsl:${digest}`, 'wsl', wsl, `WSL · ${distribution}`, 'wsl', ['-d', distribution]));
        }
    }

    return runtime(options, 'windows', profiles, wslStatus, wslDistributions);
}

async function resolvePosixProfiles(options: TerminalProfileResolverOptions): Promise<DesktopTerminalRuntime> {
    const platform: DesktopTerminalRuntime['platform'] = options.platform === 'darwin'
        ? 'macos' : options.platform === 'linux' ? 'linux' : 'other';
    const pathShells = (await Promise.all(['zsh', 'bash', 'fish', 'pwsh', 'nu'].map(name => located(options, name)))).flat();
    const candidates: readonly { readonly path?: string; readonly source: DesktopTerminalProfileSource }[] = [
        { path: options.accountShell, source: 'account' },
        { path: options.env.SHELL, source: 'path' },
        ...(options.loginShells || []).map(path => ({ path, source: 'system' as const })),
        ...pathShells.map(path => ({ path, source: 'path' as const })),
        { path: '/bin/zsh', source: 'fallback' },
        { path: '/bin/bash', source: 'fallback' },
        { path: '/bin/sh', source: 'fallback' }
    ];
    const found: { readonly shellPath: string; readonly shellKind: DesktopTerminalShellKind; readonly fileName?: string; readonly source: DesktopTerminalProfileSource }[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        const shellPath = await firstExisting([candidate.path], options.existingExecutable);
        if (!shellPath || seen.has(shellPath)) continue;
        seen.add(shellPath);
        const fileName = shellPath.split(/[\\/]/).pop()?.toLowerCase();
        // The C shells cannot run the command/exit-status protocol the terminal tool types into a shell, so they
        // are not offered (audit B06-07).
        if (fileName === 'csh' || fileName === 'tcsh') continue;
        const shellKind: DesktopTerminalShellKind = fileName === 'zsh' ? 'zsh'
            : fileName === 'bash' ? 'bash' : fileName === 'fish' ? 'fish'
                : fileName === 'sh' ? 'sh' : fileName === 'pwsh' ? 'powershell' : 'unknown';
        found.push({ shellPath, shellKind, fileName, source: candidate.source });
    }
    // A profile ID follows the installation, not the discovery order (audit B06-09): one install per kind keeps the
    // plain ID saved by earlier versions; the others add a digest of their path.
    const profiles: DesktopTerminalProfile[] = [];
    for (const item of found) {
        const baseId = item.shellKind === 'unknown'
            ? (item.fileName || 'shell').replace(/[^a-z0-9._-]/g, '-') || 'shell'
            : item.shellKind;
        const sameKind = found.filter(other => other.shellKind === item.shellKind && (item.shellKind !== 'unknown' || other.fileName === item.fileName));
        // The plain ID goes to the account's own shell, else the system one, else the first found of its kind.
        const holder = sameKind.find(other => other.source === 'account')
            || sameKind.find(other => other.shellPath === `/bin/${other.fileName}`) || sameKind[0];
        const plain = holder === item;
        let id = plain ? baseId : `${baseId}-${createHash('sha256').update(item.shellPath).digest('hex').slice(0, 8)}`;
        for (let suffix = 2; profiles.some(existing => existing.id === id); suffix += 1) id = `${baseId}-${suffix}`;
        const label = item.shellKind === 'unknown' ? item.fileName || 'Shell'
            : item.shellKind === 'sh' ? 'sh' : item.shellKind === 'powershell' ? 'PowerShell'
                : `${item.shellKind[0].toUpperCase()}${item.shellKind.slice(1)}`;
        const shellArgs = item.shellKind === 'unknown' ? [] : item.shellKind === 'powershell' ? ['-NoLogo'] : ['-l'];
        profiles.push(profile(id, item.shellKind, item.shellPath, label, item.source, shellArgs));
    }
    return runtime(options, platform, profiles, 'not_applicable', []);
}

export async function resolveTerminalProfiles(options: TerminalProfileResolverOptions): Promise<DesktopTerminalRuntime> {
    if (options.platform === 'win32') return resolveWindowsProfiles(options);
    if (options.platform === 'darwin') return resolvePosixProfiles(options);
    return runtime(options, options.platform === 'linux' ? 'linux' : 'other', [], 'not_applicable', []);
}
