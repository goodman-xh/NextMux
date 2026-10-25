/**
 * Built-in developer tools that replace two MCP servers users would otherwise install:
 *   docs.search / docs.fetch — up-to-date library documentation from Context7 (the same public
 *     API the official @upstash/context7-mcp server calls; no key needed, rate-limited),
 *   diagram.open — opens a Mermaid, draw.io XML or CSV diagram in the draw.io editor, built the
 *     way the official @drawio/mcp server builds it (the diagram travels only in the URL fragment).
 * They run inside NextMux, so nothing third-party is installed or started, and they are always on.
 */
import { deflateRawSync } from 'node:zlib';
import { AgentToolError, type AgentToolRegistry } from '@nextmux/agent-runtime';
import { pageText } from './nextmux-public-web-reader';

export const CONTEXT7_API = 'https://context7.com/api/v2';
export const DRAWIO_BASE_URL = 'https://app.diagrams.net/';
const DOCS_OUTPUT_LIMIT = 30_000;
const DIAGRAM_CONTENT_LIMIT = 120_000;

export type DiagramKind = 'mermaid' | 'xml' | 'csv';

/** draw.io's #create= link: encodeURIComponent → raw deflate → base64, exactly as @drawio/mcp does it. */
export function drawioUrl(kind: DiagramKind, content: string, options: { dark?: boolean } = {}): string {
    const data = Buffer.from(deflateRawSync(Buffer.from(encodeURIComponent(content), 'utf8'))).toString('base64');
    const params = new URLSearchParams({ grid: '0', pv: '0', border: '10', edit: '_blank', ...(options.dark ? { dark: '1' } : {}) });
    return `${DRAWIO_BASE_URL}?${params.toString()}#create=${encodeURIComponent(JSON.stringify({ type: kind, compressed: true, data }))}`;
}

interface Context7Library {
    readonly id?: unknown; readonly title?: unknown; readonly description?: unknown; readonly trustScore?: unknown;
    readonly stars?: unknown; readonly totalSnippets?: unknown; readonly versions?: unknown; readonly state?: unknown;
}

const text = (value: unknown, limit: number): string => typeof value === 'string' ? value.slice(0, limit) : '';

export interface DeveloperToolDependencies {
    readonly fetch: typeof fetch;
    /** Open a URL in the conversation's in-app browser tab; resolves false when it could not. */
    readonly openInBrowser?: (url: string, signal?: AbortSignal) => Promise<boolean>;
}

async function context7(fetchImpl: typeof fetch, path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    const url = new URL(`${CONTEXT7_API}${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const timeout = AbortSignal.timeout(30_000);
    const response = await fetchImpl(url.toString(), {
        headers: { accept: 'application/json, text/plain', 'X-Context7-Source': 'nextmux' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (response.status === 429) throw new AgentToolError('DOCS_RATE_LIMITED', 'Context7 is rate limiting documentation lookups; try again in a minute.');
    if (response.status === 404) throw new AgentToolError('DOCS_NOT_FOUND', 'No such library on Context7. Use docs.search to find its library ID.');
    if (!response.ok) throw new AgentToolError('DOCS_UNAVAILABLE', `Context7 answered HTTP ${response.status}.`);
    return response;
}

export function registerDeveloperTools(registry: AgentToolRegistry, dependencies: DeveloperToolDependencies): void {
    registry.register({
        name: 'docs.search',
        description: 'Find a library or framework on Context7 to read its current documentation (use before docs.fetch). '
            + 'Prefer this over memory for APIs that change between versions. Send only library names and short topics, never code, secrets or personal data.',
        requiredPermission: 'read_only', source: 'builtin', concurrencySafe: true, executionKind: 'read',
        inputSchema: { type: 'object', additionalProperties: false, required: ['libraryName'], properties: {
            libraryName: { type: 'string', minLength: 1, maxLength: 200, description: 'Package or product name, e.g. "next.js" or "tailwindcss".' },
            query: { type: 'string', maxLength: 500, description: 'What you need from the docs; ranks the matches.' }
        } }
    }, async (input, context) => {
        const record = input as Record<string, unknown>;
        const libraryName = text(record.libraryName, 200).trim();
        if (!libraryName) throw new AgentToolError('INVALID_INPUT', 'libraryName is required');
        const response = await context7(dependencies.fetch, '/libs/search', { libraryName, query: text(record.query, 500).trim() || libraryName }, context.signal);
        const body = await response.json() as { results?: readonly Context7Library[] };
        const results = (Array.isArray(body.results) ? body.results : []).slice(0, 8).map(item => ({
            id: text(item.id, 200), title: text(item.title, 200), description: text(item.description, 400),
            ...(typeof item.trustScore === 'number' ? { trustScore: item.trustScore } : {}),
            ...(typeof item.totalSnippets === 'number' ? { snippets: item.totalSnippets } : {}),
            ...(Array.isArray(item.versions) && item.versions.length ? { versions: (item.versions as unknown[]).filter((version): version is string => typeof version === 'string').slice(0, 8) } : {})
        })).filter(item => item.id.startsWith('/'));
        return {
            modelOutput: { results, hint: results.length ? 'Pick the id whose title names the library itself (prefer higher trustScore and snippets) and pass it to docs.fetch.' : 'No library matched; try another name.' },
            // Titles are locale-neutral objects; the conversation row supplies the verb in the reader's language.
            summary: { title: libraryName, details: results.slice(0, 3).map(item => `${item.title} (${item.id})`) }
        };
    });
    registry.register({
        name: 'docs.fetch',
        description: 'Read current, version-specific documentation and code examples for a library from Context7. '
            + 'libraryId comes from docs.search (for example "/vercel/next.js").',
        requiredPermission: 'read_only', source: 'builtin', concurrencySafe: true, executionKind: 'read',
        inputSchema: { type: 'object', additionalProperties: false, required: ['libraryId', 'query'], properties: {
            libraryId: { type: 'string', minLength: 2, maxLength: 200, pattern: '^/[A-Za-z0-9._~-]+/[A-Za-z0-9._~/-]+$' },
            query: { type: 'string', minLength: 1, maxLength: 500, description: 'The question or topic, e.g. "middleware redirects".' },
            raw: { type: 'boolean', description: 'Return raw response text without converting HTML documentation to Markdown.' }
        } }
    }, async (input, context) => {
        const record = input as Record<string, unknown>;
        const libraryId = text(record.libraryId, 200).trim();
        const query = text(record.query, 500).trim();
        if (!/^\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~/-]+$/.test(libraryId) || !query) throw new AgentToolError('INVALID_INPUT', 'libraryId and query are required');
        const response = await context7(dependencies.fetch, '/context', { libraryId, query }, context.signal);
        const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase();
        const rawBody = (await response.text()).trim();
        const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || /^<(?:!doctype\s+html|html\b)/i.test(rawBody);
        const body = isHtml && record.raw !== true ? pageText(rawBody).content.trim() : rawBody;
        if (!body) throw new AgentToolError('DOCS_NOT_FOUND', 'Context7 has no documentation for this library yet.');
        const truncated = body.length > DOCS_OUTPUT_LIMIT;
        return {
            modelOutput: truncated ? `${body.slice(0, DOCS_OUTPUT_LIMIT)}\n\n[… truncated; ask a narrower query for more]` : body,
            summary: { title: libraryId, details: [query] }
        };
    });
    registry.register({
        name: 'diagram.open',
        description: 'Open a diagram in the draw.io editor for the user to view and edit: Mermaid source, draw.io (mxGraph) XML or draw.io CSV. '
            + 'Use it for flowcharts, architecture, sequence and ER diagrams. The diagram is not uploaded; it travels in the link.',
        requiredPermission: 'read_only', source: 'builtin',
        inputSchema: { type: 'object', additionalProperties: false, required: ['kind', 'content'], properties: {
            kind: { type: 'string', enum: ['mermaid', 'xml', 'csv'] },
            content: { type: 'string', minLength: 1, maxLength: DIAGRAM_CONTENT_LIMIT },
            dark: { type: 'boolean', description: 'Open with the dark editor theme.' }
        } }
    }, async (input, context) => {
        const record = input as Record<string, unknown>;
        const kind = record.kind === 'xml' || record.kind === 'csv' ? record.kind : record.kind === 'mermaid' ? 'mermaid' : undefined;
        const content = text(record.content, DIAGRAM_CONTENT_LIMIT);
        if (!kind || !content.trim()) throw new AgentToolError('INVALID_INPUT', 'kind and content are required');
        const url = drawioUrl(kind, content, { dark: record.dark === true });
        const opened = await dependencies.openInBrowser?.(url, context.signal).catch(() => false) ?? false;
        return {
            modelOutput: { opened, url: url.length <= 4_000 ? url : `${url.slice(0, 200)}…`, note: opened ? 'Opened in the conversation browser tab.' : 'Share the link with the user to open it.' },
            summary: { title: `draw.io · ${kind === 'xml' ? 'XML' : kind === 'csv' ? 'CSV' : 'Mermaid'}`, details: [content.split('\n', 1)[0].slice(0, 120)] }
        };
    });
}
