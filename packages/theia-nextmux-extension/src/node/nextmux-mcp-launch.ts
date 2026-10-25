import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Lists one directory's child names; a missing or unreadable directory is simply empty.
 * Injected by tests so PATH discovery never depends on the machine running them.
 */
export type McpDirectoryLister = (directory: string) => readonly string[];

const listDirectory: McpDirectoryLister = directory => {
    try { return readdirSync(directory); } catch { return []; }
};

/** Newest version first: Python313 before Python39, v22.1.0 before v20.11.1, 3.13 before 3.9. */
function newestFirst(names: readonly string[], pattern: RegExp): string[] {
    const version = (name: string): number[] => (name.match(/\d+/g) || []).map(Number);
    return names.filter(name => pattern.test(name)).sort((left, right) => {
        const a = version(left), b = version(right);
        for (let index = 0; index < Math.max(a.length, b.length); index++) {
            const difference = (b[index] ?? -1) - (a[index] ?? -1);
            if (difference) return difference;
        }
        return 0;
    });
}

/**
 * Where user-level runtimes put `uvx`, `npx` and `docker` when the desktop app starts without a login shell
 * (Finder, Dock, the Start menu): uv's own installer and pipx (~/.local/bin), older uv and cargo (~/.cargo/bin),
 * Homebrew, python.org framework builds, `pip install --user` (~/Library/Python/3.x/bin) and the usual Node
 * version managers. Existing PATH entries keep their order and win; these are only appended.
 */
function unixToolDirectories(home: string, list: McpDirectoryLister): string[] {
    const framework = '/Library/Frameworks/Python.framework/Versions';
    return [
        ...(home ? [`${home}/.local/bin`, `${home}/.cargo/bin`] : []),
        '/opt/homebrew/bin', '/usr/local/bin',
        ...newestFirst(list('/opt/homebrew/opt'), /^node@\d+$/).map(name => `/opt/homebrew/opt/${name}/bin`),
        ...newestFirst(list(framework), /^\d+\.\d+$/).map(version => `${framework}/${version}/bin`),
        ...(home ? [
            ...newestFirst(list(`${home}/Library/Python`), /^\d+\.\d+$/).map(version => `${home}/Library/Python/${version}/bin`),
            `${home}/.volta/bin`, `${home}/.asdf/shims`, `${home}/.local/share/mise/shims`, `${home}/Library/pnpm`,
            ...newestFirst(list(`${home}/.nvm/versions/node`), /^v\d+\.\d+\.\d+$/).slice(0, 1).map(version => `${home}/.nvm/versions/node/${version}/bin`)
        ] : []),
        '/usr/bin', '/bin', '/usr/sbin', '/sbin'
    ];
}

/**
 * The Windows counterparts: uv's installer (%USERPROFILE%\.local\bin, older %USERPROFILE%\.cargo\bin), npm's global
 * shims, WinGet and Scoop links, the python.org launcher, and every installed Python's Scripts folder, both the
 * per-machine/per-user install (%LOCALAPPDATA%\Programs\Python\Python3xx) and `pip install --user` (%APPDATA%\Python).
 */
function windowsToolDirectories(userProfile: string, appData: string, localAppData: string, list: McpDirectoryLister): string[] {
    const pythons = (root: string): string[] => newestFirst(list(root), /^Python\d+(?:-(?:32|arm64))?$/i).map(name => `${root}\\${name}\\Scripts`);
    return [
        ...(userProfile ? [`${userProfile}\\.local\\bin`, `${userProfile}\\.cargo\\bin`, `${userProfile}\\scoop\\shims`] : []),
        ...(appData ? [`${appData}\\npm`] : []),
        ...(localAppData ? [`${localAppData}\\Microsoft\\WinGet\\Links`, `${localAppData}\\Programs\\Python\\Launcher`,
            ...pythons(`${localAppData}\\Programs\\Python`)] : []),
        ...(appData ? pythons(`${appData}\\Python`) : [])
    ];
}

/** Keep credentials out of child environments; Windows keys are case-insensitive. */
export function mcpChildEnvironment(configured: Record<string, string> = {}, platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env, list: McpDirectoryLister = listDirectory): Record<string, string> {
    const windows = platform === 'win32';
    const keys = windows
        ? ['APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'PROGRAMFILES', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERNAME', 'USERPROFILE', 'WINDISK']
        : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];
    keys.push('HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'UV_CACHE_DIR', 'NPM_CONFIG_CACHE');
    const inherited: Record<string, string> = {};
    for (const [key, value] of Object.entries(environment)) {
        const normalized = windows ? key.toUpperCase() : key;
        if (keys.includes(normalized) && value && !value.startsWith('()')) inherited[normalized] = value;
    }
    const separator = windows ? ';' : ':';
    const entries = (inherited.PATH || '').split(separator).filter(Boolean);
    // Windows paths compare case-insensitively and may end in a separator.
    const seen = new Set(entries.map(entry => windows ? entry.replace(/\\+$/, '').toLowerCase() : entry));
    const directories = windows
        ? windowsToolDirectories(inherited.USERPROFILE || '', inherited.APPDATA || '', inherited.LOCALAPPDATA || '', list)
        : unixToolDirectories(inherited.HOME || '', list);
    for (const directory of directories) {
        const key = windows ? directory.toLowerCase() : directory;
        if (!seen.has(key)) { seen.add(key); entries.push(directory); }
    }
    if (entries.length) inherited.PATH = entries.join(separator);
    if (windows && !inherited.PATHEXT) inherited.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    inherited[windows ? 'NPM_CONFIG_YES' : 'npm_config_yes'] = 'true';
    // The SDK merges uppercase defaults again. Emitting both PATH and Path
    // lets Node choose the wrong one when launching a Windows process.
    for (const [key, value] of Object.entries(configured)) inherited[windows ? key.toUpperCase() : key] = value;
    return inherited;
}

export function mcpLocalCommand(command: string, platform = process.platform): string {
    const trimmed = command.trim();
    // Command is one executable, args remain an array. cross-spawn already
    // resolves PATHEXT and safely quotes .cmd/.bat shims; do not force .cmd.
    return platform === 'win32' && /^"[^"]+"$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/** The well-known launcher behind a local server, named so a missing one can say what to install. */
export type McpLauncherRuntime = 'uvx' | 'npx' | 'docker';

export function mcpLauncherRuntime(command: string): McpLauncherRuntime | undefined {
    const name = mcpLocalCommand(command, 'win32').split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/, '');
    return name === 'uvx' || name === 'uv' ? 'uvx' : name === 'npx' || name === 'npm' ? 'npx' : name === 'docker' ? 'docker' : undefined;
}

/** Normalizes PyPI `@latest` suffixes in uvx arguments so uvx never fails on npm-style `@latest`. */
export function normalizeMcpUvxArgs(args: readonly string[]): string[] {
    return args.map(arg => /^[A-Za-z0-9][A-Za-z0-9._-]*@latest$/i.test(arg) ? arg.replace(/@latest$/i, '') : arg);
}

function findExecutableInPath(binaryName: string, pathEnv: string, platform = process.platform): string | undefined {
    const windows = platform === 'win32';
    const separator = windows ? ';' : ':';
    const extensions = windows ? ['.cmd', '.exe', '.bat', ''] : [''];
    for (const dir of pathEnv.split(separator).filter(Boolean)) {
        for (const ext of extensions) {
            const candidate = join(dir, `${binaryName}${ext}`);
            try {
                if (existsSync(candidate)) return candidate;
            } catch { /* ignore */ }
        }
    }
    return undefined;
}

export function resolveMcpLauncherSync(
    command: string,
    args: readonly string[],
    env: Record<string, string>,
    platform = process.platform
): { readonly command: string; readonly args: string[] } {
    const cleanCommand = mcpLocalCommand(command, platform);
    const runtime = mcpLauncherRuntime(cleanCommand);
    const normalizedArgs = runtime === 'uvx' ? normalizeMcpUvxArgs(args) : [...args];
    const pathEnv = env.PATH || env.Path || '';
    const isBareCommand = !/[\\/]/.test(cleanCommand);

    if (runtime === 'uvx' && isBareCommand && cleanCommand.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '') === 'uvx') {
        if (findExecutableInPath('uvx', pathEnv, platform)) {
            return { command: cleanCommand, args: normalizedArgs };
        }
        if (findExecutableInPath('uv', pathEnv, platform)) {
            return { command: 'uv', args: ['tool', 'run', ...normalizedArgs] };
        }
        // Nothing is downloaded or installed on the person's behalf: the spawn fails with ENOENT and the panel
        // says to install uv (runtime_missing, runtime 'uvx').
        return { command: cleanCommand, args: normalizedArgs };
    }

    if (runtime === 'npx' && isBareCommand && cleanCommand.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '') === 'npx') {
        const finalArgs = normalizedArgs.includes('-y') || normalizedArgs.includes('--yes') ? normalizedArgs : ['-y', ...normalizedArgs];
        return { command: cleanCommand, args: finalArgs };
    }

    return { command: cleanCommand, args: normalizedArgs };
}
