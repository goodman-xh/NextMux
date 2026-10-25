import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { PackagedMcpRuntimeOptions } from './nextmux-mcp-runtime';
import { mcpFingerprint } from './nextmux-mcp-permissions';
import { desktopMcpPolicyPins as pins } from './nextmux-mcp-desktop-policy-pins';

const managedDesktopPresets = new Set(['qwen-computer-use', 'windows-computer-use', 'macos-automator']);
export const DESKTOP_MCP_BACKGROUND_MESSAGE = 'Managed desktop MCP input and unreviewed observations are unavailable in background mode. Use the built-in browser or an explicitly bound app/window tool. Custom MCP servers are outside this guarantee.';

export function managedDesktopMcpPreset(description: unknown): string | undefined {
    if (!description || typeof description !== 'object') return undefined;
    const preset = (description as Record<string, unknown>).nextmuxRuntimePreset;
    return typeof preset === 'string' && managedDesktopPresets.has(preset) ? preset : undefined;
}

export interface DesktopMcpBackgroundPolicy {
    readonly preset: string;
    readonly revision: string;
    /** One synchronous tools/list batch; dispatch always creates a fresh check. */
    catalogFilter(description: unknown): (tool: { readonly name: string; readonly inputSchema: unknown }) => boolean;
    /** Checks the live tool contract and the same local runtime captured before startup. */
    permits(description: unknown, tool: { readonly name: string; readonly inputSchema: unknown }): boolean;
}

function executionIdentity(description: Record<string, unknown>): string {
    return mcpFingerprint({ command: description.command, args: description.args || [], env: description.env || {},
        cwd: description.cwd || null, preset: description.nextmuxRuntimePreset });
}

function regularFile(root: string, path: string): Buffer {
    const rel = relative(root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('MCP_DESKTOP_PAYLOAD_UNVERIFIED');
    let current = root;
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('MCP_DESKTOP_PAYLOAD_UNVERIFIED');
    const parts = rel.split(/[\\/]/);
    for (const [index, component] of parts.entries()) {
        current = join(current, component);
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error('MCP_DESKTOP_PAYLOAD_UNVERIFIED');
    }
    return readFileSync(path);
}

/** The marker alone never grants an observation: only a known, host-resolved runtime does. */
export function captureDesktopMcpBackgroundPolicy(description: unknown, options: PackagedMcpRuntimeOptions): DesktopMcpBackgroundPolicy | undefined {
    const preset = managedDesktopMcpPreset(description);
    if (!preset) return undefined;
    const blocked: DesktopMcpBackgroundPolicy = Object.freeze({ preset, revision: pins.revision, catalogFilter: () => () => false, permits: () => false });
    if (!description || typeof description !== 'object' || (!options.packaged && !options.prepared)
        || options.platform !== 'win32' || !['x64', 'arm64'].includes(options.architecture)
        || !options.resourcesPath || !isAbsolute(options.resourcesPath)) return blocked;
    // Qwen 0.2.3 starts PowerShell without a no-window flag even for list_apps.
    // macOS Automator exposes general execution. Neither has an audited no-focus observation here.
    if (preset !== 'windows-computer-use') return blocked;
    const record = description as Record<string, unknown>;
    const root = join(options.resourcesPath, 'mcp-runtime');
    const launcher = join(root, 'nextmux-mcp-runtime-launcher.cjs');
    const runtime = join(root, 'runtimes', preset);
    const env = record.env as Record<string, unknown> | undefined;
    const args = [launcher, '--preset', preset, 'serve'];
    let identity: string;
    try {
        if (record.command !== options.execPath || mcpFingerprint(record.args) !== mcpFingerprint(args)
            || record.cwd !== undefined || !env || Object.keys(env).some(key => !['ELECTRON_RUN_AS_NODE', 'NEXTMUX_MCP_RUNTIME_ROOT', 'NEXTMUX_MCP_PRESET'].includes(key))
            || env.ELECTRON_RUN_AS_NODE !== '1' || env.NEXTMUX_MCP_RUNTIME_ROOT !== root || env.NEXTMUX_MCP_PRESET !== preset) return blocked;
        identity = executionIdentity(record);
    } catch { return blocked; }
    const verifyPayload = (): boolean => {
        try {
            const manifest = JSON.parse(regularFile(root, join(root, 'manifest.json')).toString('utf8'));
            const entry = manifest?.runtimes?.[preset];
            if (manifest.version !== 1 || entry?.entry !== `runtimes/${preset}/server.cjs`
                || !entry.platforms?.includes(options.platform) || !entry.architectures?.includes(options.architecture)
                || mcpFingerprint(entry.source) !== mcpFingerprint(pins.windowsSource)
                || createHash('sha256').update(regularFile(root, launcher)).digest('hex') !== pins.launcherSha256) return false;
            for (const [file, digest] of Object.entries(pins.windowsFiles)) {
                if (createHash('sha256').update(regularFile(root, resolve(runtime, file))).digest('hex') !== digest) return false;
            }
            return true;
        } catch { return false; }
    };
    if (!verifyPayload()) return blocked;
    const catalogFilter: DesktopMcpBackgroundPolicy['catalogFilter'] = current => {
        try {
            if (!current || typeof current !== 'object' || executionIdentity(current as Record<string, unknown>) !== identity || !verifyPayload()) return () => false;
        } catch { return () => false; }
        // No await or lasting filesystem cache: a catalog is one synchronous snapshot.
        return tool => {
            try {
                const schema = pins.windowsReadSchemas[tool.name as keyof typeof pins.windowsReadSchemas];
                return Boolean(schema && mcpFingerprint(tool.inputSchema) === mcpFingerprint(schema));
            } catch { return false; }
        };
    };
    return Object.freeze({ preset, revision: pins.revision, catalogFilter,
        permits: (current: unknown, tool: { readonly name: string; readonly inputSchema: unknown }) => catalogFilter(current)(tool) });
}
