import { skillDomainDescriptor, type SkillDomainCode } from '../common/nextmux-skill-domain';
import type { DomainMessage } from '../common/nextmux-domain-errors';
/**
 * What an AI task can do with the GitHub account linked in Settings → Account:
 *   github.read  — GET requests to the GitHub REST API, in every permission mode,
 *   github.write — POST/PATCH/PUT/DELETE (pull requests, issues, comments, releases…), full access only,
 *   git push / gh — in full access, commands see the account through GH_TOKEN and a
 *                   github.com-only git credential helper (gitHubCommandEnvironment).
 * The token is read from the keychain by the host; the model never sees it.
 */
import { AgentToolError, type AgentToolRegistry } from '@nextmux/agent-runtime';
import type { GitHubAccountState, GitHubTokenKind } from '../common/nextmux-github-account';

export const GITHUB_API = 'https://api.github.com';
const OUTPUT_LIMIT = 60_000;

export class GitHubAccountError extends Error {
    readonly domainError: DomainMessage;
    readonly data: { readonly domainError: DomainMessage };
    constructor(readonly code: string, reason: SkillDomainCode, params?: DomainMessage['params']) {
        const domainError = skillDomainDescriptor(reason, params);
        super(domainError.fallbackEnglish);
        this.domainError = domainError;
        this.data = { domainError };
    }
}

const headers = (token: string): Record<string, string> => ({
    accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28', 'user-agent': 'NextMux'
});

const text = (value: unknown, limit: number): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;

/** Check the token with GitHub and read the account it belongs to. */
export async function verifyGitHubToken(fetchImpl: typeof fetch, token: string, tokenKind: GitHubTokenKind):
    Promise<Omit<GitHubAccountState, 'connected' | 'allowAgent' | 'connectedAt'> & { readonly login: string }> {
    let response: Response;
    try {
        response = await fetchImpl(`${GITHUB_API}/user`, { headers: headers(token), signal: AbortSignal.timeout(20_000) });
    } catch {
        throw new GitHubAccountError('GITHUB_UNREACHABLE', 'GITHUB_UNREACHABLE');
    }
    if (response.status === 401) throw new GitHubAccountError('GITHUB_TOKEN_INVALID', 'GITHUB_TOKEN_INVALID');
    if (response.status === 403 || response.status === 429) throw new GitHubAccountError('GITHUB_RATE_LIMITED', 'GITHUB_RATE_LIMITED');
    if (!response.ok) throw new GitHubAccountError('GITHUB_UNAVAILABLE', 'GITHUB_UNAVAILABLE');
    const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') throw new GitHubAccountError('GITHUB_UNAVAILABLE', 'GITHUB_ACCOUNT_INVALID');
    const login = text(body.login, 100);
    if (!login || !/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new GitHubAccountError('GITHUB_UNAVAILABLE', 'GITHUB_ACCOUNT_INVALID');
    const scopes = (response.headers.get('x-oauth-scopes') || '').split(',').map(scope => scope.trim()).filter(Boolean).slice(0, 40);
    const avatar = text(body.avatar_url, 500);
    return {
        login, tokenKind,
        ...(text(body.name, 200) ? { name: text(body.name, 200) } : {}),
        ...(avatar && /^https:\/\/avatars\.githubusercontent\.com\//.test(avatar) ? { avatarUrl: avatar } : {}),
        profileUrl: `https://github.com/${login}`,
        ...(tokenKind === 'classic' ? { scopes } : {})
    };
}

/**
 * Variables for full-access commands: `gh` reads GH_TOKEN, and git answers credential
 * requests for https://github.com only, without writing the token to any file.
 */
export function gitHubCommandEnvironment(login: string, token: string): Record<string, string> {
    return {
        GH_TOKEN: token,
        NEXTMUX_GITHUB_LOGIN: login,
        GIT_CONFIG_COUNT: '2',
        // An empty helper clears helpers from other config files for github.com, then ours answers.
        GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
        GIT_CONFIG_VALUE_0: '',
        GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
        GIT_CONFIG_VALUE_1: '!f() { if [ "$1" = get ]; then printf \'username=%s\\npassword=%s\\n\' "$NEXTMUX_GITHUB_LOGIN" "$GH_TOKEN"; fi; }; f'
    };
}

const API_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,500}$/;

function apiUrl(path: string, query: unknown): URL {
    if (!API_PATH.test(path) || path.includes('//') || /(^|\/)\.\.?(\/|$)/.test(path)) {
        throw new AgentToolError('INVALID_INPUT', 'path must be a GitHub REST API path such as /repos/{owner}/{repo}/pulls');
    }
    const url = new URL(`${GITHUB_API}${path}`);
    if (url.origin !== GITHUB_API) throw new AgentToolError('INVALID_INPUT', 'Only api.github.com is reachable');
    if (query && typeof query === 'object' && !Array.isArray(query)) {
        for (const [name, value] of Object.entries(query as Record<string, unknown>).slice(0, 30)) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') url.searchParams.set(name.slice(0, 100), String(value).slice(0, 1_000));
        }
    }
    return url;
}

async function callGitHub(fetchImpl: typeof fetch, token: string, method: string, url: URL, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(60_000);
    let response: Response;
    try {
        response = await fetchImpl(url.toString(), {
            method, headers: { ...headers(token), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
    } catch {
        throw new AgentToolError('GITHUB_UNREACHABLE', 'GitHub could not be reached');
    }
    if (response.status === 401) throw new AgentToolError('GITHUB_TOKEN_INVALID', 'The linked GitHub token was rejected; ask the user to link GitHub again in Settings → Account.');
    const raw = await response.text();
    let data: unknown = raw;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* plain text such as a diff */ }
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    const bounded = serialized.length > OUTPUT_LIMIT ? `${serialized.slice(0, OUTPUT_LIMIT)}… [truncated; use per_page/page or a narrower path]` : data;
    const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') || '')?.[1];
    return { status: response.status, ok: response.ok, data: bounded, ...(next ? { nextPage: next.replace(GITHUB_API, '') } : {}),
        ...(response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0' ? { note: 'GitHub rate limit reached; wait before retrying.' } : {}),
        ...(response.status === 404 ? { note: 'Not found, or the linked token cannot see it (check the token repository access).' } : {}) };
}

export function registerGitHubTools(registry: AgentToolRegistry, account: { readonly login: string; readonly token: string; readonly fetch: typeof fetch }): void {
    const common = `Calls the GitHub REST API (api.github.com) as the user's linked account @${account.login}. `
        + 'path is an API path such as /repos/{owner}/{repo}/pulls; query holds URL parameters. ';
    registry.register({
        name: 'github.read',
        description: `${common}Read-only: repositories, files, branches, pull requests, issues, reviews, checks and Actions runs.`,
        requiredPermission: 'read_only', source: 'builtin', concurrencySafe: true, executionKind: 'read',
        inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: {
            path: { type: 'string', minLength: 1, maxLength: 500 },
            query: { type: 'object', description: 'URL parameters, e.g. {"state":"open","per_page":50}.' }
        } }
    }, async (input, context) => {
        const record = input as Record<string, unknown>;
        const path = typeof record.path === 'string' ? record.path.trim() : '';
        const url = apiUrl(path, record.query);
        return {
            modelOutput: await callGitHub(account.fetch, account.token, 'GET', url, undefined, context.signal),
            summary: { title: `GitHub · GET ${url.pathname}`, details: [`@${account.login}`] }
        };
    });
    registry.register({
        name: 'github.write',
        description: `${common}Changes GitHub: open or merge pull requests, comment, create issues or releases, and more. `
            + 'Confirm with the user before merging, deleting or closing anything. Push commits with git, not this tool.',
        requiredPermission: 'full_access', source: 'builtin', executionKind: 'side_effect',
        inputSchema: { type: 'object', additionalProperties: false, required: ['method', 'path'], properties: {
            method: { type: 'string', enum: ['POST', 'PATCH', 'PUT', 'DELETE'] },
            path: { type: 'string', minLength: 1, maxLength: 500 },
            query: { type: 'object', description: 'URL parameters.' },
            body: { type: 'object', description: 'JSON request body as documented for the endpoint.' }
        } }
    }, async (input, context) => {
        const record = input as Record<string, unknown>;
        const method = typeof record.method === 'string' && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(record.method) ? record.method : '';
        if (!method) throw new AgentToolError('INVALID_INPUT', 'method must be POST, PATCH, PUT or DELETE');
        const path = typeof record.path === 'string' ? record.path.trim() : '';
        const url = apiUrl(path, record.query);
        const body = record.body === undefined || record.body === null ? undefined : record.body;
        if (body !== undefined && JSON.stringify(body).length > 1_000_000) throw new AgentToolError('INVALID_INPUT', 'body is larger than 1 MB');
        return {
            modelOutput: await callGitHub(account.fetch, account.token, method, url, body, context.signal),
            summary: { title: `GitHub · ${method} ${url.pathname}`, details: [`@${account.login}`] }
        };
    });
}
