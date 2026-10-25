import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, resolve as resolvePath } from 'path';

/** Metadata used by curated presets to select an immutable packaged payload. */
export const NEXTMUX_MCP_RUNTIME_PRESET = 'nextmuxRuntimePreset';

export interface PackagedMcpRuntimeOptions {
    readonly packaged: boolean;
    /** A desktop development host with an explicitly prepared resource tree. */
    readonly prepared?: boolean;
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
    readonly resourcesPath?: string;
    readonly execPath: string;
    readonly exists?: (path: string) => boolean;
    readonly readFile?: (path: string) => string;
}

export interface PackagedMcpRuntimeEntry {
    readonly entry: string;
    readonly platforms: readonly NodeJS.Platform[];
    readonly architectures: readonly string[];
    readonly args?: readonly string[];
    readonly source?: { readonly package?: string; readonly args?: readonly string[] };
}

export interface PackagedMcpRuntimeManifest {
    readonly version: number;
    readonly runtimes: Readonly<Record<string, PackagedMcpRuntimeEntry>>;
}

export type LocalMcpRuntimeDescription = {
    readonly name?: string;
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly [key: string]: unknown;
};

export type PackagedMcpRuntimeResolution =
    | { readonly description: LocalMcpRuntimeDescription }
    | { readonly error: 'MCP_RUNTIME_MANIFEST_INVALID' | 'MCP_RUNTIME_UNAVAILABLE' | 'MCP_PACKAGED_LOCAL_COMMAND_UNSUPPORTED'; readonly detail: string };

function loadManifest(root: string, readFile: (path: string) => string): PackagedMcpRuntimeManifest | undefined {
    try {
        const value: unknown = JSON.parse(readFile(join(root, 'manifest.json')));
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const record = value as Record<string, unknown>;
        if (record.version !== 1 || !record.runtimes || typeof record.runtimes !== 'object' || Array.isArray(record.runtimes)) return undefined;
        const runtimes: Record<string, PackagedMcpRuntimeEntry> = {};
        for (const [id, raw] of Object.entries(record.runtimes as Record<string, unknown>)) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
            const entry = raw as Record<string, unknown>;
            if (typeof entry.entry !== 'string' || !entry.entry || !Array.isArray(entry.platforms) || !entry.platforms.every(item => typeof item === 'string')
                || !Array.isArray(entry.architectures) || !entry.architectures.every(item => typeof item === 'string')
                || (entry.args !== undefined && (!Array.isArray(entry.args) || !entry.args.every(item => typeof item === 'string')))) return undefined;
            const source = entry.source && typeof entry.source === 'object' && !Array.isArray(entry.source)
                ? entry.source as Record<string, unknown> : undefined;
            runtimes[id] = { entry: entry.entry, platforms: entry.platforms as NodeJS.Platform[], architectures: entry.architectures,
                ...(entry.args ? { args: entry.args } : {}),
                ...(source ? { source: { ...(typeof source.package === 'string' ? { package: source.package } : {}),
                    ...(Array.isArray(source.args) && source.args.every(item => typeof item === 'string') ? { args: source.args as string[] } : {}) } } : {}) };
        }
        return { version: 1, runtimes };
    } catch {
        return undefined;
    }
}

/** Retain upstream CLI options while replacing only the registry locator. */
function payloadArguments(description: LocalMcpRuntimeDescription, entry: PackagedMcpRuntimeEntry, launcher: string, preset: string): readonly string[] {
    const args = description.args || [];
    // Approval and restart resolve an already rewritten descriptor again.
    if (args[0] === launcher && args[1] === '--preset' && args[2] === preset) return args.slice(3);
    const packageName = entry.source?.package;
    const packageIndex = packageName ? args.findIndex(arg => arg === packageName || arg.startsWith(`${packageName}@`)) : -1;
    let configured: readonly string[] = [];
    if (packageIndex >= 0) {
        let start = packageIndex + 1;
        // npx --package <locator> <binary> --options (macOS Automator preset).
        if (args[packageIndex - 1] === '--package' || args[packageIndex - 1] === '-p') start++;
        configured = args.slice(start).filter((arg, index) => !(index === 0 && arg === '--'));
    }
    return configured.length ? [...(entry.args || []), ...configured] : entry.args || entry.source?.args || [];
}

/**
 * Resolve a curated local MCP server to a packaged, immutable payload.
 *
 * User-authored commands and CLI development hosts keep their command unchanged.
 * Packaged or prepared desktop presets use Electron's embedded Node runtime and a
 * payload declared by the checked-in manifest; they never invoke mutable
 * global npx/uvx/node/python downloads.
 */
export function resolvePackagedMcpRuntime(
    description: LocalMcpRuntimeDescription,
    options: PackagedMcpRuntimeOptions,
): PackagedMcpRuntimeResolution {
    if (!options.packaged && !options.prepared) return { description };
    const preset = typeof description[NEXTMUX_MCP_RUNTIME_PRESET] === 'string'
        ? description[NEXTMUX_MCP_RUNTIME_PRESET] : undefined;
    const runtimeRoot = options.resourcesPath && isAbsolute(options.resourcesPath)
        ? join(options.resourcesPath, 'mcp-runtime') : undefined;
    const exists = options.exists || existsSync;
    const readFile = options.readFile || (path => readFileSync(path, 'utf8'));

    if (!preset) {
        // User-authored MCP commands remain untouched for backwards compatibility.
        // Only curated preset metadata is rewritten in packaged builds.
        return { description };
    }
    if (!runtimeRoot) return { error: 'MCP_RUNTIME_UNAVAILABLE', detail: `Missing resources path for MCP preset "${preset}".` };
    const manifest = loadManifest(runtimeRoot, readFile);
    if (!manifest) return { error: 'MCP_RUNTIME_MANIFEST_INVALID', detail: 'The packaged MCP runtime manifest is missing or invalid.' };
    const entry = manifest.runtimes[preset];
    if (!entry || !entry.platforms.includes(options.platform) || !entry.architectures.includes(options.architecture)) {
        return { error: 'MCP_RUNTIME_UNAVAILABLE', detail: `No MCP payload is shipped for ${preset} on ${options.platform}-${options.architecture}.` };
    }
    const launcher = join(runtimeRoot, 'nextmux-mcp-runtime-launcher.cjs');
    const payload = resolvePath(runtimeRoot, entry.entry);
    // Reject manifest traversal and make absent payloads explicit at startup.
    if (!payload.startsWith(`${runtimeRoot}/`) && !payload.startsWith(`${runtimeRoot}\\`)
        || !exists(launcher) || !exists(payload)) {
        return { error: 'MCP_RUNTIME_UNAVAILABLE', detail: `MCP payload "${preset}" is not included in this build.` };
    }
    return {
        description: {
            ...description,
            command: options.execPath,
            args: [launcher, '--preset', preset, ...payloadArguments(description, entry, launcher, preset)],
            env: {
                ...(description.env || {}),
                ELECTRON_RUN_AS_NODE: '1',
                NEXTMUX_MCP_RUNTIME_ROOT: runtimeRoot,
                NEXTMUX_MCP_PRESET: preset,
            },
        }
    };
}

export function defaultPackagedMcpRuntimeOptions(): PackagedMcpRuntimeOptions {
    const current = process as NodeJS.Process & { readonly resourcesPath?: string; readonly defaultApp?: boolean };
    const packaged = process.env.NEXTMUX_PACKAGED_RUNTIME === '1';
    return {
        packaged,
        prepared: !packaged && process.env.NEXTMUX_PACKAGED_RUNTIME === '0' && Boolean(process.env.NEXTMUX_RESOURCES_PATH),
        platform: process.platform,
        architecture: process.arch,
        // In development process.resourcesPath points to Electron itself, not
        // NextMux's build-resources. Only the host bootstrap selects this tree.
        resourcesPath: packaged ? current.resourcesPath || process.env.NEXTMUX_RESOURCES_PATH : process.env.NEXTMUX_RESOURCES_PATH,
        execPath: process.execPath,
    };
}
