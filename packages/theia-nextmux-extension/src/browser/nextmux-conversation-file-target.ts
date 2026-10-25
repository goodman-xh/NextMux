import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { conversationLinkTargetKind } from './nextmux-link-opening';
import { findLocalFileLinkCandidatesInText, isValidLocalFileLinkCandidate, type ResolvedConversationTarget } from './nextmux-conversation-media';
import type { AgentRunEvent } from '@nextmux/agent-runtime';

/** Normalize Windows separators before URI.file, including when viewing a synced thread on macOS. */
export function conversationFileUri(path: string): URI {
    return URI.fromFilePath(/^[a-z]:[\\/]/i.test(path) || /^(?:\\\\|\/\/)/.test(path) ? path.replace(/\\/g, '/') : path);
}

export interface ConversationTurnFileSource {
    readonly events?: readonly AgentRunEvent[];
    readonly changes?: readonly unknown[];
    readonly attachments?: readonly unknown[];
    readonly artifacts?: readonly unknown[];
    readonly workspaceRoot?: string;
}

export interface ConversationTurnFilePaths {
    readonly relativePaths: ReadonlySet<string>;
    readonly absolutePaths: ReadonlySet<string>;
    readonly basenames: ReadonlySet<string>;
}

export interface ConversationFileTargetOptions {
    readonly evidence?: ConversationTurnFilePaths;
    /** A candidate still requires the widget's disk/containment check before it is opened. Defaults to true. */
    readonly allowBareWorkspaceFallback?: boolean;
}

const absolutePath = (value: string): boolean => /^(?:[a-z]:[\\/]|\/|\\\\)/i.test(value);
const portablePath = (value: string): string => value.replace(/\\/g, '/');
const pathKey = (value: string): string => /^(?:[a-z]:\/|\/\/)/i.test(portablePath(value)) ? portablePath(value).toLowerCase() : portablePath(value);

/** Decode Markdown destinations exactly once; file: URI parsing already handles its own escapes. */
export function resolveConversationFileTarget(target: string, workspaceRoot: string, options: ConversationFileTargetOptions = {}): ResolvedConversationTarget | undefined {
    if (conversationLinkTargetKind(target) !== 'file') return undefined;
    try {
        const destination = target.trim().replace(/[?#].*$/, '');
        let uri: URI;
        if (/^file:/i.test(destination)) uri = new URI(destination);
        else {
            let path = destination;
            try { path = decodeURIComponent(path); } catch { /* A literal percent sign is valid in a file name. */ }
            if (absolutePath(path)) uri = conversationFileUri(path);
            else {
                if (!workspaceRoot) return undefined;
                const relative = portablePath(path).replace(/^\.\//, '');
                if (!relative.includes('/') && options.evidence) {
                    const match = matchFileEvidence(relative, options.evidence, workspaceRoot);
                    if (match.status === 'ambiguous') return undefined;
                    if (match.status === 'matched') {
                        const resolved = conversationFileUri(match.path);
                        return { path: FileUri.fsPath(resolved), url: resolved.toString() };
                    }
                }
                if (!relative.includes('/') && options.allowBareWorkspaceFallback === false
                    && ![...(options.evidence?.relativePaths || []), ...(options.evidence?.basenames || [])]
                        .some(candidate => candidate.toLowerCase() === relative.toLowerCase())) return undefined;
                uri = conversationFileUri(workspaceRoot).resolve(relative);
            }
        }
        if (uri.scheme !== 'file' || !uri.path.isAbsolute || /[\u0000-\u001f\u007f]/.test(uri.path.toString())) return undefined;
        // FileUri preserves the server/share part of a UNC path; uri.path alone loses it.
        return { path: FileUri.fsPath(uri), url: uri.toString() };
    } catch {
        return undefined;
    }
}

export type ConversationFileEvidence = { readonly status: 'matched'; readonly path: string }
    | { readonly status: 'ambiguous' } | { readonly status: 'none' };

const FILE_TOOLS = new Set(['workspace.write_file', 'workspace.apply_patch', 'workspace.read_file', 'workspace.list_files',
    'media.inspect', 'media.understand', 'media.transcribe', 'media.generate_image', 'media.edit_image', 'media.generate_video', 'media.generate_audio']);
const PROCESS_TOOLS = new Set(['process.run', 'terminal.run']);
const FILE_PATH_KEYS = new Set(['path', 'externalTarget', 'relativePath', 'workspaceRelativePath', 'filePath', 'file_path',
    'outputPath', 'output_path', 'localPath', 'local_path', 'savedPath', 'saved_path', 'targetPath', 'target_path', 'uri', 'url']);
const FILE_CONTAINER_KEYS = new Set(['summary', 'resource', 'params', 'arguments', 'args', 'input', 'output', 'result', 'data',
    'attachments', 'artifacts', 'files', 'entries', 'images', 'videos', 'audio', 'assets', 'changedPaths', 'paths']);

/** Collect file references, not file contents or localized tool titles. Process text is restricted to the owning workspace. */
function collectTurnFilePaths(turn: ConversationTurnFileSource, workspaceRoot = turn.workspaceRoot || ''): ConversationTurnFilePaths {
    const relativePaths = new Set<string>();
    const absolutePaths = new Set<string>();
    const basenames = new Set<string>();
    const rootPrefix = workspaceRoot
        ? pathKey(FileUri.fsPath(conversationFileUri(workspaceRoot).normalizePath())).replace(/\/+$/, '') + '/' : '';
    const recordRecentPath = (paths: Set<string>, path: string): void => {
        // Repeated tool reads must update recency instead of retaining the first occurrence's position.
        paths.delete(path);
        paths.add(path);
    };
    const recordPath = (raw: unknown, workspaceOnly = false): void => {
        if (typeof raw !== 'string' || !raw.trim() || /[\u0000-\u001f\u007f]/.test(raw)) return;
        let value = raw.trim();
        if (/^file:/i.test(value)) value = resolveConversationFileTarget(value, '')?.path || '';
        if (!value || conversationLinkTargetKind(value) !== 'file') return;
        const portable = portablePath(value);
        const segments = portable.split('/').filter(segment => segment && segment !== '.');
        if (!segments.length || segments.includes('..')) return;
        const absolute = absolutePath(value);
        if (!absolute && !isValidLocalFileLinkCandidate(value)) return;
        if (absolute) {
            const key = pathKey(value);
            const inside = Boolean(rootPrefix) && key.startsWith(rootPrefix);
            if (workspaceOnly && !inside) return;
            recordRecentPath(absolutePaths, value);
            if (inside) recordRecentPath(relativePaths, portable.slice(rootPrefix.length));
        } else {
            recordRecentPath(relativePaths, segments.join('/'));
        }
        basenames.add(segments[segments.length - 1]);
    };
    const scanText = (value: unknown, workspaceOnly = false): void => {
        if (typeof value !== 'string') return;
        for (const candidate of findLocalFileLinkCandidatesInText(value)) recordPath(candidate.target.replace(/#L\d+(?:-L?\d+)?$/i, ''), workspaceOnly);
    };
    const scanStructured = (value: unknown, workspaceOnly = false, depth = 0): void => {
        if (depth > 8 || value === null || value === undefined) return;
        if (typeof value === 'string') {
            if (workspaceOnly) scanText(value, true);
            else recordPath(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const entry of value) scanStructured(entry, workspaceOnly, depth + 1);
            return;
        }
        if (typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        const hasPath = Object.keys(record).some(key => FILE_PATH_KEYS.has(key) && typeof record[key] === 'string');
        for (const [key, child] of Object.entries(record)) {
            if (FILE_PATH_KEYS.has(key)) recordPath(child, workspaceOnly);
            else if (key === 'name' && !hasPath) recordPath(child, workspaceOnly);
            else if (FILE_CONTAINER_KEYS.has(key)) scanStructured(child, workspaceOnly, depth + 1);
        }
    };
    const scanProcessText = (value: unknown, depth = 0): void => {
        if (depth > 8 || value === null || value === undefined) return;
        if (typeof value === 'string') { scanText(value, true); return; }
        if (Array.isArray(value)) { value.forEach(entry => scanProcessText(entry, depth + 1)); return; }
        if (typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                if (['arguments', 'args', 'command', 'commandLine', 'stdout', 'stderr', 'output', 'result', 'chunk', 'details'].includes(key)) {
                    scanProcessText(child, depth + 1);
                }
            }
        }
    };
    for (const change of turn.changes || []) {
        if (!change || typeof change !== 'object') continue;
        const record = change as Record<string, unknown>;
        // An external target is authoritative; the short display path is not a second workspace file.
        recordPath(record.externalTarget || record.path || record.relativePath);
    }
    scanStructured(turn.attachments);
    scanStructured(turn.artifacts);
    const completedCalls = new Set((turn.events || []).flatMap(event => event.type === 'tool_completed' && event.ok && event.callId ? [event.callId] : []));
    for (const event of turn.events || []) {
        if (!('toolName' in event)) continue;
        const name = event.toolName.toLowerCase();
        const process = PROCESS_TOOLS.has(name);
        if (!process && !FILE_TOOLS.has(name)) continue;
        if (event.type === 'tool_completed' && event.ok) {
            scanStructured(event, process);
            // Tool events normally keep paths in structured resources; older imported histories can retain output bodies.
            const record = event as unknown as Record<string, unknown>;
            for (const key of ['output', 'result']) {
                scanStructured(record[key], process);
                if (process) scanText(record[key], true);
            }
            if (process || name === 'workspace.list_files' || name.startsWith('media.')) {
                for (const detail of event.summary.details || []) {
                    if (name === 'workspace.list_files' && typeof detail === 'string') {
                        const listed = /^file\s*·\s*(.+)$/i.exec(detail.trim());
                        if (listed) recordPath(listed[1].trim(), false);
                    }
                    scanText(detail, process);
                }
            }
            if (process) { scanText(event.summary.commandLine, true); scanProcessText(event); }
        } else if (event.type === 'tool_started' && completedCalls.has(event.callId)) {
            scanStructured(event, process);
            if (process) scanText(event.summary?.commandLine, true);
        } else if (process && event.type === 'tool_output') {
            scanText(event.chunk, true);
        } else if (process && event.type === 'tool_process_started') {
            scanText(event.commandLine, true);
        }
        if (process && completedCalls.has(event.callId)) scanProcessText(event);
    }
    return { relativePaths, absolutePaths, basenames };
}

function matchFileEvidence(path: string, evidence: ConversationTurnFilePaths, workspaceRoot: string): ConversationFileEvidence {
    const absolute = absolutePath(path);
    const segments = portablePath(path).split('/').filter(segment => segment && segment !== '.');
    if (!path || segments.includes('..') || !absolute && segments.length === 1 && !isValidLocalFileLinkCandidate(path)) return { status: 'none' };
    const relative = segments.join('/');
    const root = workspaceRoot ? conversationFileUri(workspaceRoot).normalizePath() : undefined;
    const paths = [...evidence.absolutePaths];
    if (root) for (const candidate of evidence.relativePaths) {
        // Evidence contains native names. Only the incoming Markdown destination is percent-decoded.
        paths.push(FileUri.fsPath(root.resolve(candidate)));
    }
    const candidates = new Map<string, string>();
    for (const candidate of paths) {
        const key = pathKey(candidate);
        const windows = /^(?:[a-z]:\/|\/\/)/i.test(portablePath(candidate));
        const expected = absolute ? portablePath(path) : relative;
        const matches = absolute ? key === (windows ? expected.toLowerCase() : expected)
            : key.endsWith('/' + (windows ? expected.toLowerCase() : expected));
        if (matches) {
            // Keep the native spelling, while the order follows the latest matching evidence.
            const recorded = candidates.get(key) || candidate;
            candidates.delete(key);
            candidates.set(key, recorded);
        }
    }
    if (!absolute && candidates.size > 1 && root) {
        const exact = candidates.get(pathKey(FileUri.fsPath(root.resolve(relative))));
        if (exact) return { status: 'matched', path: exact };
        const rootPrefix = pathKey(FileUri.fsPath(root)).replace(/\/+$/, '') + '/';
        const inside = [...candidates].filter(([key]) => key.startsWith(rootPrefix)).at(-1)?.[1];
        if (inside) return { status: 'matched', path: inside };
    }
    const match = [...candidates.values()].at(-1);
    return match ? { status: 'matched', path: match } : { status: 'none' };
}

export function conversationTurnFileEvidence(turn: ConversationTurnFileSource): ConversationTurnFilePaths;
export function conversationTurnFileEvidence(target: string, source: readonly AgentRunEvent[] | ConversationTurnFileSource, workspaceRoot?: string): ConversationFileEvidence;
export function conversationTurnFileEvidence(targetOrTurn: string | ConversationTurnFileSource,
    source: readonly AgentRunEvent[] | ConversationTurnFileSource = [], workspaceRoot = ''): ConversationFileEvidence | ConversationTurnFilePaths {
    if (typeof targetOrTurn !== 'string') return collectTurnFilePaths(targetOrTurn);
    if (conversationLinkTargetKind(targetOrTurn) !== 'file') return { status: 'none' };
    let path = targetOrTurn.trim().replace(/[?#].*$/, '');
    try { path = /^file:/i.test(path) ? resolveConversationFileTarget(path, '')?.path || '' : decodeURIComponent(path); } catch { return { status: 'none' }; }
    const turn: ConversationTurnFileSource = Array.isArray(source) ? { events: source } : source as ConversationTurnFileSource;
    const root = workspaceRoot || turn.workspaceRoot || '';
    return matchFileEvidence(path, collectTurnFilePaths(turn, root), root);
}
