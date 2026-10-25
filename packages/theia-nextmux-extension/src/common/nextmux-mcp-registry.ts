import type { DomainMessage } from './nextmux-domain-errors';
/**
 * GitHub's MCP registry (https://github.com/mcp), mirrored into Settings → MCP like the skills list.
 * Entries come from https://api.mcp.github.com/2025-09-15/v0/servers. Only install shapes NextMux
 * can express exactly (an HTTPS endpoint, or one npx / uvx / docker command) become one-click
 * options; everything else links to the repository for manual setup. Adding still goes through
 * the normal review, approval and per-tool permission gates.
 */
import type { McpInputFieldSpec, McpServerConfiguration } from './nextmux-mcp-access';

export const MCP_REGISTRY_ORIGIN = 'https://github.com/mcp';
export const MCP_REGISTRY_API = 'https://api.mcp.github.com/2025-09-15/v0/servers';

export type McpRegistryInstallKind = 'remote' | 'npx' | 'uvx' | 'docker';

export interface McpRegistryInstallOption {
    readonly kind: McpRegistryInstallKind;
    readonly configuration: McpServerConfiguration;
    /** Secret values the server needs (API keys); remote ones go in Authentication, local ones in the environment. */
    readonly secrets: readonly string[];
    /** Structured required/optional input fields extracted from registry metadata. */
    readonly fields?: readonly McpInputFieldSpec[];
    /** Inferred authentication header kind for remote servers. */
    readonly defaultAuthKind?: 'bearer' | 'x-api-key' | 'api-key';
}

export interface McpRegistryEntry {
    readonly id: string;
    readonly title: string;
    readonly owner: string;
    readonly description: string;
    readonly repositoryUrl: string;
    readonly stars: number;
    readonly license?: string;
    readonly language?: string;
    readonly updatedAt?: string;
    readonly options: readonly McpRegistryInstallOption[];
}

export interface McpRegistryState {
    readonly entries: readonly McpRegistryEntry[];
    readonly refreshedAt: number;
    readonly stale?: boolean;
    readonly message?: string;
    readonly statusMessage?: DomainMessage;
}

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
const list = (value: unknown): readonly unknown[] => Array.isArray(value) ? value.slice(0, 64) : [];

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IMAGE = /^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9._/-]+(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/;
const SAFE_ARG = /^[^\0\r\n]{1,2048}$/;

/** Registry arguments → argv. Anything with an unfilled `{placeholder}` makes the option manual. */
function registryArguments(value: unknown): string[] | undefined {
    const out: string[] = [];
    for (const item of list(value)) {
        if (!isRecord(item)) return undefined;
        const name = text(item.name, 200);
        const argument = typeof item.value === 'string' ? item.value : undefined;
        if (argument !== undefined && /\{[^}]+\}/.test(argument)) return undefined;
        if (item.type === 'named') {
            if (!name || !name.startsWith('-')) return undefined;
            out.push(name);
            if (argument !== undefined) out.push(argument);
        } else if (argument !== undefined) out.push(argument);
        else if (item.is_required) return undefined;
    }
    return out.every(argument => SAFE_ARG.test(argument)) ? out : undefined;
}

function packageArgumentsWithFields(value: unknown): { readonly args: string[]; readonly fields: McpInputFieldSpec[] } | undefined {
    const args: string[] = [];
    const fields: McpInputFieldSpec[] = [];
    const items = list(value);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!isRecord(item)) return undefined;
        const name = text(item.name, 200);
        const argument = typeof item.value === 'string' ? item.value : undefined;
        const placeholderMatch = argument !== undefined ? argument.match(/\{([^}]+)\}/) : null;
        if (placeholderMatch) {
            const key = text(placeholderMatch[1] || name || `arg_${fields.length + 1}`, 100);
            fields.push({
                key,
                label: text(item.description, 120) || name || key,
                description: text(item.description, 200) || undefined,
                required: item.is_required !== false,
                secret: Boolean(item.is_secret),
                defaultValue: typeof item.default === 'string' ? text(item.default, 200) : undefined,
                target: 'arg',
                ...(item.type === 'named' && name.startsWith('-') ? { argFlag: name } : {})
            });
            continue;
        }
        if (item.type === 'named') {
            if (!name || !name.startsWith('-')) return undefined;
            if (argument !== undefined) {
                args.push(name, argument);
            } else if (item.is_required || item.is_secret || typeof item.default === 'string') {
                const key = name.replace(/^-+/, '') || `arg_${fields.length + 1}`;
                fields.push({
                    key,
                    label: text(item.description, 120) || name,
                    description: text(item.description, 200) || undefined,
                    required: Boolean(item.is_required),
                    secret: Boolean(item.is_secret),
                    defaultValue: typeof item.default === 'string' ? text(item.default, 200) : undefined,
                    target: 'arg',
                    argFlag: name
                });
            } else {
                args.push(name);
            }
        } else if (argument !== undefined) {
            args.push(argument);
        } else {
            const key = name || `arg_${fields.length + 1}`;
            fields.push({
                key,
                label: text(item.description, 120) || name || key,
                description: text(item.description, 200) || undefined,
                required: Boolean(item.is_required),
                secret: Boolean(item.is_secret),
                defaultValue: typeof item.default === 'string' ? text(item.default, 200) : undefined,
                target: 'arg'
            });
        }
    }
    return args.every(argument => SAFE_ARG.test(argument)) ? { args, fields } : undefined;
}

function envFieldsOf(values: unknown): McpInputFieldSpec[] {
    const out: McpInputFieldSpec[] = [];
    for (const item of list(values)) {
        if (!isRecord(item) || typeof item.name !== 'string') continue;
        const key = text(item.name, 100);
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) continue;
        const secret = Boolean(item.is_secret) || /(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL)/i.test(key);
        out.push({
            key,
            label: key,
            description: text(item.description, 200) || undefined,
            required: item.is_required !== false && (Boolean(item.is_required) || Boolean(item.is_secret)),
            secret,
            defaultValue: typeof item.default === 'string' ? text(item.default, 200) : undefined,
            placeholder: typeof item.placeholder === 'string' ? text(item.placeholder, 200) : undefined,
            target: 'env'
        });
    }
    return out;
}

function secretsOf(values: unknown, requiredOnly: boolean): string[] {
    return list(values).flatMap(item => isRecord(item) && item.is_secret && (!requiredOnly || item.is_required !== false) && typeof item.name === 'string'
        ? [text(item.name, 100)] : []).filter(Boolean);
}

function packageOption(value: unknown): McpRegistryInstallOption | undefined {
    if (!isRecord(value)) return undefined;
    const identifier = text(value.identifier, 300);
    const version = text(value.version, 80);
    if (!identifier || /^https?:/i.test(identifier)) return undefined; // .mcpb bundles and other downloads
    const hint = text(value.runtime_hint, 20).toLowerCase();
    const base = text(value.registry_base_url, 200);
    const runtime = registryArguments(value.runtime_arguments);
    const packagedResult = packageArgumentsWithFields(value.package_arguments);
    if (!runtime || !packagedResult) return undefined;
    const packaged = packagedResult.args;
    const envSecrets = secretsOf(value.environment_variables, true);
    const fields = [...envFieldsOf(value.environment_variables), ...packagedResult.fields];
    const kind: McpRegistryInstallKind | undefined = hint === 'npx' || /npmjs\.org/.test(base) ? 'npx'
        : hint === 'uvx' || /pypi\.org/.test(base) ? 'uvx'
            : hint === 'docker' ? 'docker'
                : !hint && !base && NPM_NAME.test(identifier) && !identifier.includes(':') ? 'npx'
                    : !hint && !base && IMAGE.test(identifier) && /[:/]/.test(identifier) && /\./.test(identifier.split('/')[0]) ? 'docker'
                        : undefined;
    if (!kind) return undefined;
    let args: string[];
    if (kind === 'npx') {
        if (!NPM_NAME.test(identifier)) return undefined;
        const spec = version && version !== 'latest' && /^[0-9A-Za-z.+-]{1,60}$/.test(version) ? `${identifier}@${version}` : identifier;
        const cleanRuntime = runtime.filter(arg => arg !== '-y' && arg !== '--yes');
        const hasSpec = cleanRuntime.includes(spec) || cleanRuntime.includes(identifier) || cleanRuntime.includes('--package') || cleanRuntime.includes('-p');
        args = ['-y', ...cleanRuntime, ...(hasSpec ? [] : [spec]), ...packaged];
    } else if (kind === 'uvx') {
        const hasFrom = runtime.includes('--from') || runtime.includes(identifier);
        if (!hasFrom && !PYPI_NAME.test(identifier)) return undefined;
        const spec = version && version !== 'latest' && /^[0-9A-Za-z.+!-]{1,60}$/.test(version) ? `${identifier}@${version}` : identifier;
        const hasSpec = runtime.includes(spec) || runtime.includes(identifier) || runtime.includes('--from');
        args = [...runtime, ...(hasSpec ? [] : [spec]), ...packaged];
    } else {
        if (!IMAGE.test(identifier)) return undefined;
        args = ['run', '-i', '--rm', ...runtime, identifier, ...packaged];
    }
    return {
        kind,
        configuration: { command: kind, args },
        secrets: envSecrets,
        ...(fields.length ? { fields } : {})
    };
}

function inferRemoteAuthKind(headers: readonly string[]): 'bearer' | 'x-api-key' | 'api-key' | undefined {
    for (const h of headers) {
        const lower = h.toLowerCase();
        if (lower === 'authorization' || lower.includes('bearer')) return 'bearer';
        if (lower === 'x-api-key') return 'x-api-key';
        if (lower === 'api-key' || lower === 'apikey') return 'api-key';
    }
    return headers.length > 0 ? 'bearer' : undefined;
}

function remoteOption(value: unknown): McpRegistryInstallOption | undefined {
    if (!isRecord(value)) return undefined;
    const url = text(value.url, 500);
    if ((value.transport_type ?? value.type) !== 'streamable-http' && (value.transport_type ?? value.type) !== 'sse') return undefined;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || /\{[^}]+\}/.test(url)) return undefined;
    } catch { return undefined; }
    const secrets = secretsOf(value.headers, false);
    const defaultAuthKind = inferRemoteAuthKind(secrets);
    return {
        kind: 'remote',
        configuration: { serverUrl: url },
        secrets,
        ...(defaultAuthKind ? { defaultAuthKind } : {})
    };
}

export function parseMcpRegistryServer(raw: unknown): McpRegistryEntry | undefined {
    if (!isRecord(raw) || (raw.status !== undefined && raw.status !== 'active')) return undefined;
    const id = text(raw.name, 200);
    if (!id) return undefined;
    const meta = isRecord(raw._meta) ? raw._meta['io.modelcontextprotocol.registry/publisher-provided'] : undefined;
    const github = isRecord(meta) && isRecord(meta.github) ? meta.github : {};
    const repository = isRecord(raw.repository) ? text(raw.repository.url, 300) : '';
    const repositoryUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(repository) ? repository : '';
    const owner = text(github.name_with_owner, 200).split('/')[0] || id.replace(/^io\.github\./, '').split(/[/.]/)[0];
    // Prefer streamable HTTP over legacy SSE; one option per kind keeps the choice simple.
    const transportRank = (value: unknown): number => isRecord(value) && (value.transport_type ?? value.type) === 'streamable-http' ? 0 : 1;
    const remotes = [...list(raw.remotes)].sort((left, right) => transportRank(left) - transportRank(right))
        .map(remoteOption).filter((option): option is McpRegistryInstallOption => Boolean(option));
    const packages = list(raw.packages).map(packageOption).filter((option): option is McpRegistryInstallOption => Boolean(option));
    const seen = new Set<McpRegistryInstallKind>();
    const options = [...remotes, ...packages].filter(option => !seen.has(option.kind) && seen.add(option.kind));
    const stars = typeof github.stargazer_count === 'number' && Number.isFinite(github.stargazer_count) ? Math.max(0, Math.round(github.stargazer_count)) : 0;
    return {
        id,
        title: text(github.display_name, 80) || id.split('/').pop() || id,
        owner,
        description: text(raw.description, 400),
        repositoryUrl,
        stars,
        ...(text(github.license, 80) ? { license: text(github.license, 80) } : {}),
        ...(text(github.primary_language, 40) ? { language: text(github.primary_language, 40) } : {}),
        ...(text(raw.updated_at, 40) ? { updatedAt: text(raw.updated_at, 40) } : {}),
        options
    };
}

/** A previously parsed entry read back from the on-disk cache; anything malformed is dropped. */
export function parseMcpRegistryStored(value: unknown): McpRegistryEntry | undefined {
    if (!isRecord(value)) return undefined;
    const id = text(value.id, 200), title = text(value.title, 80);
    if (!id || !title) return undefined;
    const repositoryUrl = text(value.repositoryUrl, 300);
    const options = list(value.options).flatMap(option => {
        if (!isRecord(option) || !['remote', 'npx', 'uvx', 'docker'].includes(String(option.kind)) || !isRecord(option.configuration)) return [];
        const configuration = option.configuration;
        const remote = option.kind === 'remote';
        const serverUrl = text(configuration.serverUrl, 500);
        const command = text(configuration.command, 20);
        const args = list(configuration.args).filter((arg): arg is string => typeof arg === 'string' && SAFE_ARG.test(arg));
        if (remote ? !/^https:\/\//.test(serverUrl) : command !== option.kind) return [];
        const fields = list(option.fields).flatMap(field => {
            if (!isRecord(field) || typeof field.key !== 'string' || !['env', 'arg', 'header', 'url'].includes(String(field.target))) return [];
            const key = text(field.key, 100);
            if (!key) return [];
            return [{
                key,
                label: text(field.label, 120) || key,
                ...(text(field.description, 200) ? { description: text(field.description, 200) } : {}),
                required: Boolean(field.required),
                ...(field.secret ? { secret: true } : {}),
                ...(typeof field.defaultValue === 'string' && text(field.defaultValue, 200) ? { defaultValue: text(field.defaultValue, 200) } : {}),
                ...(typeof field.placeholder === 'string' && text(field.placeholder, 200) ? { placeholder: text(field.placeholder, 200) } : {}),
                target: field.target as McpInputFieldSpec['target'],
                ...(typeof field.argFlag === 'string' && text(field.argFlag, 80) ? { argFlag: text(field.argFlag, 80) } : {})
            }];
        });
        const defaultAuthKind = typeof option.defaultAuthKind === 'string' && ['bearer', 'x-api-key', 'api-key'].includes(option.defaultAuthKind)
            ? option.defaultAuthKind as 'bearer' | 'x-api-key' | 'api-key' : undefined;
        return [{
            kind: option.kind as McpRegistryInstallKind,
            configuration: remote ? { serverUrl } : { command, args },
            secrets: list(option.secrets).filter((secret): secret is string => typeof secret === 'string').map(secret => text(secret, 100)).filter(Boolean),
            ...(fields.length ? { fields } : {}),
            ...(defaultAuthKind ? { defaultAuthKind } : {})
        }];
    });
    return {
        id, title, owner: text(value.owner, 200), description: text(value.description, 400),
        repositoryUrl: /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(repositoryUrl) ? repositoryUrl : '',
        stars: typeof value.stars === 'number' && Number.isFinite(value.stars) ? Math.max(0, Math.round(value.stars)) : 0,
        ...(text(value.license, 80) ? { license: text(value.license, 80) } : {}),
        ...(text(value.language, 40) ? { language: text(value.language, 40) } : {}),
        ...(text(value.updatedAt, 40) ? { updatedAt: text(value.updatedAt, 40) } : {}),
        options
    };
}

/** A server name that passes the MCP name rule, derived from the registry title. */
export function suggestedMcpServerName(entry: Pick<McpRegistryEntry, 'title' | 'id'>): string {
    const base = (entry.title || entry.id.split('/').pop() || 'mcp').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return (base || 'mcp').slice(0, 64);
}

export type McpBuiltInCapability = 'docs' | 'diagram' | 'github';

/** Servers whose capability NextMux ships natively (docs.*, diagram.open, github.*), so they need no install. */
export function builtInMcpCapability(entry: Pick<McpRegistryEntry, 'id' | 'repositoryUrl'>): McpBuiltInCapability | undefined {
    const id = entry.id.toLowerCase();
    const repository = entry.repositoryUrl.toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
    if (id === 'io.github.upstash/context7' || repository === 'https://github.com/upstash/context7') return 'docs';
    if (id === 'io.draw/mcp' || repository === 'https://github.com/jgraph/drawio-mcp') return 'diagram';
    if (id === 'io.github.github/github-mcp-server' || repository === 'https://github.com/github/github-mcp-server') return 'github';
    return undefined;
}

/** Case-insensitive search over name, owner and description. */
export function filterMcpRegistry(entries: readonly McpRegistryEntry[], query: string): readonly McpRegistryEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return entries;
    return entries.filter(entry => {
        const haystack = `${entry.title} ${entry.id} ${entry.owner} ${entry.description}`.toLowerCase();
        return terms.every(term => haystack.includes(term));
    });
}
