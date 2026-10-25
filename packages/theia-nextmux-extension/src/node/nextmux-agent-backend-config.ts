import { BUILTIN_AGENT_BACKEND_ID } from '@nextmux/agent-runtime';
import type { AcpAgentBackendOptions } from '@nextmux/agent-runtime';

/**
 * No clock on a model response (0 = none): a model may think for hours or days and is never cut off while it is
 * online. A lost connection still ends the call, through TCP keepalive (every socket, see nextmux-system-proxy.ts),
 * the gateway's 15 s heartbeats and provider errors; the user's stop ends it at any time.
 */
export const DESKTOP_AGENT_MODEL_TIMEOUT_MS = 0;

const MAX_COMMAND_LENGTH = 2_048;
const MAX_ARGUMENT_LENGTH = 4_096;
const MAX_ARGUMENTS = 64;
const MAX_INHERITED_ENVIRONMENT = 32;
const MAX_ACP_BACKENDS = 8;
const MAX_ACP_BACKENDS_JSON_BYTES = 64 * 1024;
const ACP_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const LEGACY_ACP_ENVIRONMENT_KEYS = [
    'NEXTMUX_AGENT_ACP_COMMAND',
    'NEXTMUX_AGENT_ACP_ARGS_JSON',
    'NEXTMUX_AGENT_ACP_ID',
    'NEXTMUX_AGENT_ACP_CWD',
    'NEXTMUX_AGENT_ACP_INHERIT_ENV',
    'NEXTMUX_AGENT_ACP_OWNS_MODEL',
    'NEXTMUX_AGENT_ACP_PRIORITY'
] as const;

export interface DesktopAcpBackendConfiguration {
    readonly options: AcpAgentBackendOptions;
    /** Higher values win; equal values retain declaration order. */
    readonly priority: number;
    /** External ACP engines must explicitly own their model selection. */
    readonly ownsModelSelection: true;
}

export interface DesktopAgentBackendConfiguration {
    readonly preferredBackendId: string;
    readonly selectedBackendOwnsModelSelection: boolean;
    readonly allowFallback: boolean;
    readonly acpBackends: readonly DesktopAcpBackendConfiguration[];
}

interface AcpBackendRegistryEntry {
    readonly id: string;
    readonly command: string;
    readonly args?: readonly string[];
    readonly cwd?: string;
    readonly inheritEnvironment?: readonly string[];
    readonly priority?: number;
    readonly ownsModelSelection?: unknown;
}

function cleanValue(value: string | undefined, maximum: number, label: string): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    if (normalized.length > maximum || /[\0\r\n]/.test(normalized)) throw new Error(`${label} is invalid`);
    return normalized;
}

function parseArgumentArray(parsed: unknown, label: string): readonly string[] {
    if (!Array.isArray(parsed) || parsed.length > MAX_ARGUMENTS || parsed.some(argument =>
        typeof argument !== 'string' || argument.length > MAX_ARGUMENT_LENGTH || /[\0\r\n]/.test(argument))) {
        throw new Error(`${label} accepts at most ${MAX_ARGUMENTS} bounded string arguments`);
    }
    return parsed;
}

function parseArguments(value: string | undefined): readonly string[] {
    if (!value?.trim()) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error('NEXTMUX_AGENT_ACP_ARGS_JSON must be a JSON string array');
    }
    return parseArgumentArray(parsed, 'NEXTMUX_AGENT_ACP_ARGS_JSON');
}

function validateInheritedEnvironment(parsed: unknown, label: string): readonly string[] | undefined {
    if (parsed === undefined) return undefined;
    if (!Array.isArray(parsed) || parsed.some(name => typeof name !== 'string')) {
        throw new Error(`${label} must be a string array`);
    }
    const names = [...new Set(parsed.map(name => name.trim()).filter(Boolean))];
    if (names.length > MAX_INHERITED_ENVIRONMENT || names.some(name => !ENVIRONMENT_NAME_PATTERN.test(name))) {
        throw new Error(`${label} contains an invalid environment variable name`);
    }
    return names.length ? names : undefined;
}

function parseInheritedEnvironment(value: string | undefined): readonly string[] | undefined {
    if (!value?.trim()) return undefined;
    return validateInheritedEnvironment(value.split(','), 'NEXTMUX_AGENT_ACP_INHERIT_ENV');
}

function boundedPriority(value: unknown, label: string): number {
    if (value === undefined || value === null || value === '') return 50;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < -1_000 || parsed > 1_000) {
        throw new Error(`${label} must be an integer from -1000 to 1000`);
    }
    return parsed;
}

function normalizeAcpId(value: unknown, label: string): string {
    if (typeof value !== 'string') throw new Error(`${label} is required`);
    const slug = cleanValue(value, 80, label);
    if (!slug || !ACP_ID_PATTERN.test(slug)) throw new Error(`${label} is invalid`);
    return `acp:${slug}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRegistryEntry(value: unknown, index: number): DesktopAcpBackendConfiguration {
    const label = `NEXTMUX_AGENT_ACP_BACKENDS_JSON[${index}]`;
    if (!isRecord(value)) throw new Error(`${label} must be an object`);
    const allowedKeys = new Set([
        'id', 'command', 'args', 'cwd', 'inheritEnvironment', 'priority', 'ownsModelSelection'
    ]);
    const unknownKey = Object.keys(value).find(key => !allowedKeys.has(key));
    if (unknownKey) throw new Error(`${label}.${unknownKey} is not supported`);

    const entry = value as unknown as AcpBackendRegistryEntry;
    if (entry.ownsModelSelection !== true) throw new Error(`${label}.ownsModelSelection must be true`);
    const id = normalizeAcpId(entry.id, `${label}.id`);
    const command = typeof entry.command === 'string'
        ? cleanValue(entry.command, MAX_COMMAND_LENGTH, `${label}.command`)
        : undefined;
    if (!command) throw new Error(`${label}.command is required`);
    const args = entry.args === undefined ? [] : parseArgumentArray(entry.args, `${label}.args`);
    const cwd = entry.cwd === undefined ? undefined
        : typeof entry.cwd === 'string' ? cleanValue(entry.cwd, MAX_COMMAND_LENGTH, `${label}.cwd`) : undefined;
    if (entry.cwd !== undefined && !cwd) throw new Error(`${label}.cwd is invalid`);
    const inheritEnvironment = validateInheritedEnvironment(entry.inheritEnvironment, `${label}.inheritEnvironment`);
    return {
        options: {
            id,
            command,
            args,
            ...(cwd ? { cwd } : {}),
            ...(inheritEnvironment ? { inheritEnvironment } : {})
        },
        priority: boundedPriority(entry.priority, `${label}.priority`),
        ownsModelSelection: true
    };
}

function parseAcpBackendRegistry(value: string | undefined): readonly DesktopAcpBackendConfiguration[] {
    if (!value?.trim()) return [];
    if (Buffer.byteLength(value, 'utf8') > MAX_ACP_BACKENDS_JSON_BYTES) {
        throw new Error(`NEXTMUX_AGENT_ACP_BACKENDS_JSON exceeds ${MAX_ACP_BACKENDS_JSON_BYTES} bytes`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error('NEXTMUX_AGENT_ACP_BACKENDS_JSON must be a JSON array');
    }
    if (!Array.isArray(parsed) || parsed.length > MAX_ACP_BACKENDS) {
        throw new Error(`NEXTMUX_AGENT_ACP_BACKENDS_JSON accepts at most ${MAX_ACP_BACKENDS} engines`);
    }
    const entries = parsed.map(parseRegistryEntry);
    const ids = new Set<string>();
    for (const entry of entries) {
        if (ids.has(entry.options.id)) throw new Error(`Duplicate ACP backend id: ${entry.options.id}`);
        ids.add(entry.options.id);
    }
    return entries;
}

function parseLegacyAcpBackend(
    environment: Readonly<Record<string, string | undefined>>
): DesktopAcpBackendConfiguration | undefined {
    const command = cleanValue(environment.NEXTMUX_AGENT_ACP_COMMAND, MAX_COMMAND_LENGTH, 'NEXTMUX_AGENT_ACP_COMMAND');
    if (!command) return undefined;
    const slug = cleanValue(environment.NEXTMUX_AGENT_ACP_ID, 80, 'NEXTMUX_AGENT_ACP_ID') || 'external';
    if (!ACP_ID_PATTERN.test(slug)) throw new Error('NEXTMUX_AGENT_ACP_ID is invalid');
    const cwd = cleanValue(environment.NEXTMUX_AGENT_ACP_CWD, MAX_COMMAND_LENGTH, 'NEXTMUX_AGENT_ACP_CWD');
    const inheritEnvironment = parseInheritedEnvironment(environment.NEXTMUX_AGENT_ACP_INHERIT_ENV);
    return {
        options: {
            id: `acp:${slug}`,
            command,
            args: parseArguments(environment.NEXTMUX_AGENT_ACP_ARGS_JSON),
            ...(cwd ? { cwd } : {}),
            ...(inheritEnvironment ? { inheritEnvironment } : {})
        },
        priority: boundedPriority(environment.NEXTMUX_AGENT_ACP_PRIORITY, 'NEXTMUX_AGENT_ACP_PRIORITY'),
        ownsModelSelection: true
    };
}

/**
 * Reads deployment-only agent engine configuration. Multiple ACP engines are
 * registered as deterministic candidates; this module never randomizes or
 * round-robins them, invokes a shell, or inherits provider secrets implicitly.
 */
export function readDesktopAgentBackendConfiguration(
    environment: Readonly<Record<string, string | undefined>> = process.env
): DesktopAgentBackendConfiguration {
    const registryValue = environment.NEXTMUX_AGENT_ACP_BACKENDS_JSON;
    const hasRegistry = Boolean(registryValue?.trim());
    const hasLegacyConfiguration = LEGACY_ACP_ENVIRONMENT_KEYS.some(key => Boolean(environment[key]?.trim()));
    if (hasRegistry && hasLegacyConfiguration) {
        throw new Error('NEXTMUX_AGENT_ACP_BACKENDS_JSON cannot be combined with legacy single-ACP configuration');
    }

    const acpBackends = hasRegistry
        ? parseAcpBackendRegistry(registryValue)
        : [parseLegacyAcpBackend(environment)].filter((entry): entry is DesktopAcpBackendConfiguration => Boolean(entry));
    const selected = cleanValue(environment.NEXTMUX_AGENT_BACKEND, 100, 'NEXTMUX_AGENT_BACKEND') || BUILTIN_AGENT_BACKEND_ID;
    const preferredBackendId = selected === 'acp' ? acpBackends[0]?.options.id : selected;
    if (!preferredBackendId) throw new Error('An ACP engine must be configured when ACP is selected');
    if (preferredBackendId !== BUILTIN_AGENT_BACKEND_ID
        && !acpBackends.some(entry => entry.options.id === preferredBackendId)) {
        throw new Error(`Unknown agent backend: ${preferredBackendId}`);
    }

    const selectedAcpBackend = acpBackends.find(entry => entry.options.id === preferredBackendId);
    if (selectedAcpBackend && !hasRegistry && environment.NEXTMUX_AGENT_ACP_OWNS_MODEL !== '1') {
        throw new Error('ACP selection requires NEXTMUX_AGENT_ACP_OWNS_MODEL=1 so the model ownership change is explicit');
    }
    return {
        preferredBackendId,
        selectedBackendOwnsModelSelection: Boolean(selectedAcpBackend),
        allowFallback: environment.NEXTMUX_AGENT_BACKEND_ALLOW_FALLBACK === '1',
        acpBackends
    };
}
