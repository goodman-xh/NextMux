import { ConversationDomainError } from '../common/nextmux-conversation-domain-errors';
/**
 * Import conversations from other coding tools into NextMux history.
 *
 * Sources and where they keep transcripts (all read-only; nothing is ever
 * written back to another tool's files):
 *   - Claude Code:   <CLAUDE_CONFIG_DIR | ~/.claude>/projects/<project>/<session>.jsonl
 *   - Claude Cowork: Claude desktop app data, local-agent-mode-sessions/** (same JSONL format)
 *   - Codex:         <CODEX_HOME | ~/.codex>/sessions/YYYY/MM/DD/rollout-*.jsonl and archived_sessions/
 *   - Cursor:        <Cursor>/User/globalStorage/state.vscdb (composerHeaders, composerData:*, bubbleId:*)
 * Windows uses %USERPROFILE% / %APPDATA%; people who moved a tool's data can
 * add extra folders. Scanning reads only file heads so hundreds of sessions
 * list quickly; importing converts each conversation completely in memory
 * first, and only whole conversations are written, so a failure never leaves
 * a half-imported conversation behind.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdtemp, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import type {
    ConversationImportCandidate, ConversationImportSource, ConversationImportSourceSummary
} from '../common/nextmux-conversation-import-protocol';

export const CONVERSATION_IMPORT_SOURCES: readonly ConversationImportSource[] = ['claude-code', 'claude-cowork', 'codex', 'cursor'];
const SOURCE_LABELS: Readonly<Record<ConversationImportSource, string>> = {
    'claude-code': 'Claude Code', 'claude-cowork': 'Claude Cowork', codex: 'Codex', cursor: 'Cursor'
};
const HEAD_BYTES = 256 * 1024;
const MAX_WALK_DEPTH = 8;
const MAX_FILES_PER_SOURCE = 20_000;
const MAX_PROMPT_CHARS = 200_000;
const MAX_RESPONSE_CHARS = 400_000;
const MAX_TURNS = 20_000;
const MAX_SESSION_BYTES = 48 * 1024 * 1024;
const TITLE_CHARS = 120;
const SKIP_DIRS = new Set(['node_modules', '.git', 'rpm', 'skills-plugin', 'vm_bundles', 'Cache', 'Code Cache', 'GPUCache', 'blob_storage']);

export interface ImportEnvironment {
    readonly platform: NodeJS.Platform;
    readonly home: string;
    readonly env: Readonly<Record<string, string | undefined>>;
}

export function currentImportEnvironment(): ImportEnvironment {
    return { platform: process.platform, home: homedir(), env: process.env };
}

function appData(environment: ImportEnvironment): string {
    const { platform, home, env } = environment;
    if (platform === 'darwin') return join(home, 'Library', 'Application Support');
    if (platform === 'win32') return env.APPDATA || join(env.USERPROFILE || home, 'AppData', 'Roaming');
    return env.XDG_CONFIG_HOME || join(home, '.config');
}

/** Where each tool keeps its conversations on this machine, most specific first. */
export function defaultImportRoots(source: ConversationImportSource, environment: ImportEnvironment = currentImportEnvironment()): readonly string[] {
    const { platform, home, env } = environment;
    const userHome = platform === 'win32' ? env.USERPROFILE || home : home;
    const roots: string[] = [];
    if (source === 'claude-code') {
        if (env.CLAUDE_CONFIG_DIR) roots.push(join(env.CLAUDE_CONFIG_DIR, 'projects'));
        roots.push(join(userHome, '.claude', 'projects'));
    } else if (source === 'claude-cowork') {
        roots.push(join(appData(environment), 'Claude', 'local-agent-mode-sessions'));
        if (platform === 'win32' && env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, 'Claude', 'local-agent-mode-sessions'));
    } else if (source === 'codex') {
        if (env.CODEX_HOME) roots.push(env.CODEX_HOME);
        roots.push(join(userHome, '.codex'));
    } else {
        roots.push(join(appData(environment), 'Cursor', 'User'));
    }
    return [...new Set(roots)];
}

/**
 * A stable id per source conversation, shaped like a UUID (version 8) because conversation ids
 * name folders and goal files elsewhere and are validated as UUIDs there.
 */
export function importSessionId(source: ConversationImportSource, externalId: string, salt = ''): string {
    const hex = createHash('sha256').update(`${source}\0${externalId}${salt ? `\0${salt}` : ''}`).digest('hex');
    const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function clip(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit)}\n\n…` : text;
}

function titleFrom(text: string): string {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}

function time(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) || Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

async function exists(path: string): Promise<boolean> {
    try { await stat(path); return true; } catch { return false; }
}

async function readHead(path: string, bytes = HEAD_BYTES): Promise<string[]> {
    const handle = await open(path, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        const lines = text.split('\n');
        // The last line may be cut in the middle; the parser skips it.
        if (bytesRead === bytes) lines.pop();
        return lines;
    } finally { await handle.close(); }
}

async function* readLines(path: string): AsyncGenerator<string> {
    const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    try { for await (const line of lines) yield line; } finally { lines.close(); }
}

function json(line: string): any {
    if (!line || line.length > 16 * 1024 * 1024) return undefined;
    try { return JSON.parse(line); } catch { return undefined; }
}

async function walk(root: string, accept: (path: string) => boolean, depth = MAX_WALK_DEPTH, found: string[] = []): Promise<string[]> {
    if (depth < 0 || found.length >= MAX_FILES_PER_SOURCE) return found;
    let entries: import('node:fs').Dirent[];
    try { entries = await readdir(root, { withFileTypes: true }); } catch { return found; }
    for (const entry of entries) {
        if (found.length >= MAX_FILES_PER_SOURCE) break;
        const path = join(root, entry.name);
        if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(path, accept, depth - 1, found); }
        else if (entry.isFile() && accept(path)) found.push(path);
    }
    return found;
}

// ---------------------------------------------------------------------------
// Conversion into NextMux turns
// ---------------------------------------------------------------------------

export interface ImportedTurn { prompt: string; response: string; createdAt: number; completedAt: number; tools: number }

class TurnBuilder {
    readonly turns: ImportedTurn[] = [];
    private orphanResponse = '';
    user(text: string, at: number): void {
        const prompt = text.trim();
        if (!prompt || this.turns.length >= MAX_TURNS) return;
        this.turns.push({ prompt: clip(prompt, MAX_PROMPT_CHARS), response: '', createdAt: at, completedAt: at, tools: 0 });
    }
    assistant(text: string, at: number): void {
        const value = text.trim();
        if (!value) return;
        const turn = this.turns.at(-1);
        if (!turn) { this.orphanResponse = this.orphanResponse ? `${this.orphanResponse}\n\n${value}` : value; return; }
        turn.response = clip(turn.response ? `${turn.response}\n\n${value}` : value, MAX_RESPONSE_CHARS);
        turn.completedAt = Math.max(turn.completedAt, at);
    }
    tool(at: number): void {
        const turn = this.turns.at(-1);
        if (turn) { turn.tools += 1; turn.completedAt = Math.max(turn.completedAt, at); }
    }
    finish(): ImportedTurn[] {
        // A transcript that resumes mid-answer keeps that text with the first request.
        if (this.orphanResponse && this.turns[0]) this.turns[0].response = clip(`${this.orphanResponse}\n\n${this.turns[0].response}`.trim(), MAX_RESPONSE_CHARS);
        return this.turns;
    }
}

/**
 * Tools inject context as "user" messages wrapped whole in one tag
 * (<environment_context>…</environment_context>, <recommended_plugins>…, <system-reminder>…).
 * A person's request is not written that way.
 */
export function isInjectedContext(text: string): boolean {
    const value = text.trim();
    if (/^\[Request interrupted by user/.test(value)) return true;
    const open = /^<([a-z][a-z0-9_-]{1,60})(\s[^>]*)?>/i.exec(value);
    return Boolean(open && value.endsWith(`</${open[1]}>`));
}

function claudeText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.filter(block => block && block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
}

/** Claude Code slash commands arrive wrapped in tags; keep the command, drop local command output. */
function claudePrompt(text: string): string {
    if (/^\s*<local-command-(stdout|stderr)>/.test(text) || /^\s*<command-message>/.test(text) && !/<command-name>/.test(text)) return '';
    const command = /<command-name>([^<]{1,200})<\/command-name>/.exec(text)?.[1]?.trim();
    if (command) {
        const args = /<command-args>([\s\S]{0,20000}?)<\/command-args>/.exec(text)?.[1]?.trim();
        return args ? `${command} ${args}` : command;
    }
    if (/^\s*Caveat: The messages below were generated by the user while running local commands/.test(text)) return '';
    return text;
}

export function claudeTranscriptTurns(records: Iterable<any>): { turns: ImportedTurn[]; title?: string; cwd?: string; startedAt?: number } {
    const builder = new TurnBuilder();
    let title: string | undefined; let cwd: string | undefined; let startedAt: number | undefined;
    for (const record of records) {
        if (!record || typeof record !== 'object') continue;
        if (record.type === 'custom-title' && typeof record.customTitle === 'string' && record.customTitle.trim()) title = record.customTitle.trim();
        if (record.type === 'summary' && typeof record.summary === 'string' && !title) title = record.summary.trim();
        if (record.isSidechain || record.isMeta) continue;
        const at = time(record.timestamp, startedAt || Date.now());
        if (typeof record.cwd === 'string' && !cwd) cwd = record.cwd;
        if (record.type === 'user' && record.message) {
            const prompt = claudePrompt(claudeText(record.message.content));
            if (prompt.trim() && !isInjectedContext(prompt)) { startedAt ??= at; builder.user(prompt, at); }
        } else if (record.type === 'assistant' && record.message && Array.isArray(record.message.content)) {
            for (const block of record.message.content) {
                if (block?.type === 'text' && typeof block.text === 'string') builder.assistant(block.text, at);
                else if (block?.type === 'tool_use') builder.tool(at);
            }
        }
    }
    return { turns: builder.finish(), title, cwd, startedAt };
}

const CODEX_CONTEXT = /^\s*(<environment_context>|<user_instructions>|<permissions instructions>|<INSTRUCTIONS>|# AGENTS\.md instructions|<turn_aborted>)/;

export function codexTranscriptTurns(records: Iterable<any>): { turns: ImportedTurn[]; cwd?: string; id?: string; startedAt?: number; firstPrompt?: string } {
    const builder = new TurnBuilder();
    let cwd: string | undefined; let id: string | undefined; let startedAt: number | undefined;
    for (const record of records) {
        if (!record || typeof record !== 'object') continue;
        const payload = record.payload;
        const at = time(record.timestamp, startedAt || Date.now());
        if (record.type === 'session_meta' && payload) {
            cwd ??= typeof payload.cwd === 'string' ? payload.cwd : undefined;
            id ??= typeof payload.id === 'string' ? payload.id : undefined;
            startedAt ??= time(payload.timestamp, at);
            continue;
        }
        if (record.type !== 'response_item' || !payload) continue;
        if (payload.type === 'message') {
            const text = Array.isArray(payload.content) ? payload.content
                .filter((item: any) => item && (item.type === 'input_text' || item.type === 'output_text' || item.type === 'text') && typeof item.text === 'string')
                .map((item: any) => item.text).join('\n') : '';
            if (payload.role === 'user') {
                if (!CODEX_CONTEXT.test(text) && !isInjectedContext(text)) builder.user(text, at);
            } else if (payload.role === 'assistant') builder.assistant(text, at);
        } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'local_shell_call') {
            builder.tool(at);
        }
    }
    const turns = builder.finish();
    return { turns, cwd, id, startedAt, firstPrompt: turns[0]?.prompt };
}

export function cursorBubbleTurns(bubbles: Iterable<any>): ImportedTurn[] {
    const builder = new TurnBuilder();
    for (const bubble of bubbles) {
        if (!bubble || typeof bubble !== 'object') continue;
        const at = time(bubble.createdAt ?? bubble.timingInfo?.clientStartTime, Date.now());
        const text = typeof bubble.text === 'string' ? bubble.text : '';
        if (bubble.type === 1) builder.user(text, at);
        else if (bubble.type === 2) {
            if (text) builder.assistant(text, at);
            if (bubble.toolFormerData) builder.tool(at);
        }
    }
    return builder.finish();
}

/** One NextMux conversation record; `turns` follow CodingTurnRecord. */
export function importedSessionRecord(input: {
    readonly source: ConversationImportSource; readonly externalId: string; readonly sessionId: string; readonly title: string;
    readonly workspacePath: string; readonly turns: readonly ImportedTurn[]; readonly createdAt: number; readonly updatedAt: number; readonly importedAt: number;
}): Record<string, unknown> {
    const label = SOURCE_LABELS[input.source];
    const turns = input.turns.map((turn, index) => ({
        id: `${input.sessionId}-t${index}`,
        prompt: turn.prompt,
        response: turn.response,
        error: '',
        stage: 'complete',
        createdAt: turn.createdAt,
        completedAt: turn.completedAt,
        permissionMode: 'full_access',
        routeLabel: label,
        ...(turn.tools ? { importedToolCalls: turn.tools } : {}),
        changes: [],
        events: []
    }));
    return {
        id: input.sessionId,
        title: input.title || label,
        workspacePath: input.workspacePath,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        turns,
        turnCount: turns.length,
        historyLoaded: true,
        importedFrom: { source: input.source, externalId: input.externalId, importedAt: input.importedAt }
    };
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export interface ScannedConversation extends Omit<ConversationImportCandidate, 'status'> {
    /** File path, or `cursor:<db>#<composerId>`. */
    readonly locator: string;
}

async function claudeDesktopTitles(environment: ImportEnvironment): Promise<Map<string, string>> {
    // The Claude desktop app keeps its own titles for Code-tab sessions (keyed by the CLI session id).
    const titles = new Map<string, string>();
    const root = join(appData(environment), 'Claude', 'claude-code-sessions');
    for (const file of await walk(root, path => /[\\/]local_[^\\/]+\.json$/.test(path), 4)) {
        try {
            const value = JSON.parse(await readFile(file, 'utf8'));
            if (typeof value?.cliSessionId === 'string' && typeof value.title === 'string' && value.title.trim()) titles.set(value.cliSessionId, value.title.trim());
        } catch { /* one unreadable file does not stop the scan */ }
    }
    return titles;
}

async function scanClaudeFiles(source: 'claude-code' | 'claude-cowork', files: readonly string[], titles: ReadonlyMap<string, string>): Promise<ScannedConversation[]> {
    const found: ScannedConversation[] = [];
    for (const file of files) {
        try {
            const info = await stat(file);
            if (!info.size) continue;
            const head = claudeTranscriptTurns((await readHead(file)).map(json));
            if (!head.turns.length) continue;
            const externalId = basename(file, '.jsonl');
            found.push({
                source, externalId, sessionId: importSessionId(source, externalId), locator: file,
                title: titleFrom(titles.get(externalId) || head.title || head.turns[0].prompt),
                workspacePath: head.cwd || '', createdAt: head.startedAt || Math.trunc(info.birthtimeMs || info.mtimeMs),
                updatedAt: Math.trunc(info.mtimeMs), bytes: info.size
            });
        } catch { /* unreadable file: listed as nothing rather than failing the scan */ }
    }
    return found;
}

async function scanClaudeCode(roots: readonly string[], environment: ImportEnvironment): Promise<ScannedConversation[]> {
    const titles = await claudeDesktopTitles(environment);
    const files: string[] = [];
    for (const root of roots) files.push(...await walk(root, path => path.endsWith('.jsonl') && dirname(dirname(path)) === root, 1));
    return scanClaudeFiles('claude-code', [...new Set(files)], titles);
}

async function scanClaudeCowork(roots: readonly string[]): Promise<ScannedConversation[]> {
    const titles = new Map<string, string>();
    const files: string[] = [];
    for (const root of roots) {
        for (const meta of await walk(root, path => /[\\/]local_[^\\/]+\.json$/.test(path), 4)) {
            try {
                const value = JSON.parse(await readFile(meta, 'utf8'));
                const id = typeof value?.cliSessionId === 'string' ? value.cliSessionId : '';
                if (id && typeof value.title === 'string' && value.title.trim()) titles.set(id, value.title.trim());
            } catch { /* ignore */ }
        }
        files.push(...await walk(root, path => path.endsWith('.jsonl') && !path.includes(`${sep}subagents${sep}`)));
    }
    return scanClaudeFiles('claude-cowork', [...new Set(files)], titles);
}

async function codexTitles(root: string): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    try {
        for (const line of (await readFile(join(root, 'session_index.jsonl'), 'utf8')).split('\n')) {
            const value = json(line);
            if (typeof value?.id === 'string' && typeof value.thread_name === 'string' && value.thread_name.trim()) titles.set(value.id, value.thread_name.trim());
        }
    } catch { /* optional */ }
    return titles;
}

async function scanCodex(roots: readonly string[]): Promise<ScannedConversation[]> {
    const found = new Map<string, ScannedConversation>();
    for (const root of roots) {
        const titles = await codexTitles(root);
        const files = [
            ...await walk(join(root, 'sessions'), path => /rollout-[^\\/]+\.jsonl$/.test(path), 4),
            ...await walk(join(root, 'archived_sessions'), path => path.endsWith('.jsonl'), 1)
        ];
        for (const file of files) {
            try {
                const info = await stat(file);
                if (!info.size) continue;
                const head = codexTranscriptTurns((await readHead(file)).map(json));
                const externalId = head.id || basename(file, '.jsonl');
                if (!head.firstPrompt || found.has(externalId)) continue;
                found.set(externalId, {
                    source: 'codex', externalId, sessionId: importSessionId('codex', externalId), locator: file,
                    title: titleFrom(titles.get(externalId) || head.firstPrompt), workspacePath: head.cwd || '',
                    createdAt: head.startedAt || Math.trunc(info.mtimeMs), updatedAt: Math.trunc(info.mtimeMs), bytes: info.size
                });
            } catch { /* ignore one bad file */ }
        }
    }
    return [...found.values()];
}

/** Cursor keeps its database open; read a private copy so Cursor is never locked or changed. */
async function withCursorDatabase<T>(database: string, read: (db: DatabaseSync) => T): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-cursor-import-'));
    try {
        const copy = join(directory, 'state.vscdb');
        await copyFile(database, copy);
        for (const suffix of ['-wal', '-shm']) if (await exists(`${database}${suffix}`)) await copyFile(`${database}${suffix}`, `${copy}${suffix}`).catch(() => undefined);
        const db = new DatabaseSync(copy);
        try { return read(db); } finally { db.close(); }
    } finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
}

function cursorWorkspaceFolders(userRoot: string): Promise<Map<string, string>> {
    return (async () => {
        const folders = new Map<string, string>();
        let entries: string[] = [];
        try { entries = await readdir(join(userRoot, 'workspaceStorage')); } catch { return folders; }
        for (const id of entries.slice(0, 5_000)) {
            try {
                const value = JSON.parse(await readFile(join(userRoot, 'workspaceStorage', id, 'workspace.json'), 'utf8'));
                const uri = typeof value?.folder === 'string' ? value.folder : '';
                if (uri.startsWith('file://')) folders.set(id, decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
            } catch { /* ignore */ }
        }
        return folders;
    })();
}

function cursorComposerPath(data: any, folders: ReadonlyMap<string, string>, workspaceId: string): string {
    const fsPath = data?.workspaceIdentifier?.uri?.fsPath;
    return typeof fsPath === 'string' ? fsPath : folders.get(workspaceId) || '';
}

async function scanCursor(roots: readonly string[]): Promise<ScannedConversation[]> {
    const found: ScannedConversation[] = [];
    for (const root of roots) {
        const database = join(root, 'globalStorage', 'state.vscdb');
        if (!await exists(database)) continue;
        const folders = await cursorWorkspaceFolders(root);
        const info = await stat(database);
        found.push(...await withCursorDatabase(database, db => {
            const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(row => row.name));
            if (!tables.has('cursorDiskKV')) return [];
            const headers = tables.has('composerHeaders')
                ? db.prepare('SELECT composerId, workspaceId FROM composerHeaders WHERE COALESCE(isSubagent,0)=0').all() as any[]
                : (db.prepare("SELECT substr(key,14) AS composerId, '' AS workspaceId FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as any[]);
            const read = db.prepare('SELECT value FROM cursorDiskKV WHERE key=?');
            const conversations: ScannedConversation[] = [];
            for (const header of headers.slice(0, MAX_FILES_PER_SOURCE)) {
                const id = String(header.composerId || '');
                if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) continue;
                const data = json(String((read.get(`composerData:${id}`) as any)?.value || ''));
                if (!data) continue;
                const count = Array.isArray(data.fullConversationHeadersOnly) ? data.fullConversationHeadersOnly.length : Array.isArray(data.conversation) ? data.conversation.length : 0;
                if (!count) continue;
                const firstText = Array.isArray(data.conversation) ? data.conversation.find((bubble: any) => bubble?.type === 1)?.text
                    : data.fullConversationHeadersOnly.find((bubble: any) => bubble?.type === 1)?.grouping?.textPreview;
                conversations.push({
                    source: 'cursor', externalId: id, sessionId: importSessionId('cursor', id), locator: `cursor:${database}#${id}`,
                    title: titleFrom(typeof data.name === 'string' && data.name.trim() ? data.name : String(firstText || 'Cursor')),
                    workspacePath: cursorComposerPath(data, folders, String(header.workspaceId || '')),
                    createdAt: time(data.createdAt, Math.trunc(info.mtimeMs)), updatedAt: time(data.lastUpdatedAt ?? data.createdAt, Math.trunc(info.mtimeMs)), bytes: 0
                });
            }
            return conversations;
        }));
    }
    return found;
}

export async function scanImportSource(source: ConversationImportSource, extraRoots: readonly string[] = [],
    environment: ImportEnvironment = currentImportEnvironment()): Promise<{ roots: ConversationImportSourceSummary['roots']; conversations: ScannedConversation[] }> {
    const candidates = [...new Set([...defaultImportRoots(source, environment), ...extraRoots])];
    const roots = await Promise.all(candidates.map(async path => {
        const found = await exists(path);
        // Found but unreadable (macOS privacy, Windows ACL): say so instead of showing an empty list.
        let readable = found;
        if (found) try { (await stat(path)).isDirectory() ? await readdir(path) : await readFile(path, { flag: 'r' }).then(() => undefined); } catch { readable = false; }
        return { path, found, readable, custom: extraRoots.includes(path) };
    }));
    const present = roots.filter(root => root.readable).map(root => root.path);
    const conversations = source === 'claude-code' ? await scanClaudeCode(present, environment)
        : source === 'claude-cowork' ? await scanClaudeCowork(present)
        : source === 'codex' ? await scanCodex(present)
        : await scanCursor(present);
    return { roots, conversations: conversations.sort((left, right) => right.updatedAt - left.updatedAt) };
}

function slimRecord(record: any): any {
    if (!record || typeof record !== 'object') return undefined;
    const { type, timestamp } = record;
    if (type === 'custom-title' || type === 'summary') return record;
    if (type === 'user' || type === 'assistant') {
        const content = record.message?.content;
        const kept = typeof content === 'string' ? content : Array.isArray(content)
            ? content.filter((block: any) => block?.type === 'text' || block?.type === 'tool_use').map((block: any) => block.type === 'text' ? { type: 'text', text: block.text } : { type: 'tool_use' })
            : undefined;
        return { type, timestamp, cwd: record.cwd, isSidechain: record.isSidechain, isMeta: record.isMeta, message: { content: kept } };
    }
    if (type === 'session_meta') return { type, timestamp, payload: { id: record.payload?.id, cwd: record.payload?.cwd, timestamp: record.payload?.timestamp } };
    if (type === 'response_item') {
        const payload = record.payload || {};
        if (payload.type === 'message') return { type, timestamp, payload: { type: 'message', role: payload.role, content: payload.content } };
        if (payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'local_shell_call') return { type, timestamp, payload: { type: payload.type } };
    }
    return undefined;
}

/** Read one conversation completely and convert it; throws when nothing usable is inside. */
export async function convertImportedConversation(candidate: ScannedConversation, sessionId: string, importedAt = Date.now()): Promise<Record<string, unknown>> {
    let turns: ImportedTurn[] = [];
    let workspacePath = candidate.workspacePath;
    if (candidate.source === 'cursor') {
        const match = /^cursor:(.+)#([A-Za-z0-9-]{8,80})$/.exec(candidate.locator);
        if (!match) throw new ConversationDomainError('CURSOR_LOCATOR_INVALID', 'import_locator_invalid');
        const [, database, id] = match;
        turns = await withCursorDatabase(database, db => {
            const read = db.prepare('SELECT value FROM cursorDiskKV WHERE key=?');
            const data = json(String((read.get(`composerData:${id}`) as any)?.value || ''));
            if (!data) throw new ConversationDomainError('CURSOR_CONVERSATION_MISSING', 'import_missing');
            const bubbles = Array.isArray(data.conversation) && data.conversation.length ? data.conversation
                : (Array.isArray(data.fullConversationHeadersOnly) ? data.fullConversationHeadersOnly : [])
                    .map((header: any) => json(String((read.get(`bubbleId:${id}:${header?.bubbleId}`) as any)?.value || '')));
            return cursorBubbleTurns(bubbles);
        });
    } else {
        // Keep only what the conversion reads; tool outputs and telemetry can be most of a multi-GB log.
        const records: any[] = [];
        for await (const line of readLines(candidate.locator)) {
            const value = slimRecord(json(line));
            if (value) records.push(value);
        }
        const parsed = candidate.source === 'codex' ? codexTranscriptTurns(records) : claudeTranscriptTurns(records);
        turns = parsed.turns;
        workspacePath = workspacePath || parsed.cwd || '';
    }
    if (!turns.length) throw new ConversationDomainError('NO_MESSAGES', 'import_no_messages');
    const record = importedSessionRecord({ source: candidate.source, externalId: candidate.externalId, sessionId, title: candidate.title,
        workspacePath, turns, createdAt: Math.min(candidate.createdAt, turns[0].createdAt), updatedAt: Math.max(candidate.updatedAt, turns.at(-1)!.completedAt), importedAt });
    if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_SESSION_BYTES) throw new ConversationDomainError('CONVERSATION_TOO_LARGE', 'import_too_large');
    return record;
}
