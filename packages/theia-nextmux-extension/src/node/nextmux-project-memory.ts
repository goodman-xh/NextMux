import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { AgentToolError } from '@nextmux/agent-runtime';
import type { ProjectMemoryDocument, ProjectMemoryDraft, ProjectMemoryEntry, ProjectMemorySource, ProjectKnowledgeSnapshot } from '../common/nextmux-project-memory';
import { projectMemoryReviewText } from '../common/nextmux-project-memory';

export const PROJECT_MEMORY_PATH = '.nextmux/project-memory.json';
export const PROJECT_MEMORY_MAX_ENTRIES = 100;
export const PROJECT_MEMORY_READ_BUDGET = 12_000;
const MAX_BYTES = 1024 * 1024;
const locks = new Map<string, Promise<unknown>>();
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const fail = (code: string, message: string): never => { throw new AgentToolError(code, message); };
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

function text(value: unknown, name: string, maximum: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\0\u202a-\u202e\u2066-\u2069]/u.test(value)) {
        return fail('PROJECT_MEMORY_INVALID', `${name} must be nonempty bounded text`);
    }
    return value.trim();
}

function source(value: unknown): ProjectMemorySource {
    const item = value as ProjectMemorySource;
    if (!item || !['user', 'conversation', 'file', 'tool'].includes(item.kind)) return fail('PROJECT_MEMORY_INVALID', 'Invalid source kind');
    return { kind: item.kind, reference: text(item.reference, 'source reference', 500) };
}

function draft(value: ProjectMemoryDraft): ProjectMemoryDraft {
    if (!value || !['fact', 'experience'].includes(value.kind) || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 12) {
        return fail('PROJECT_MEMORY_INVALID', 'Memory needs a kind and 1–12 source references');
    }
    if (value.id !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id)) return fail('PROJECT_MEMORY_INVALID', 'Invalid memory ID');
    return { ...(value.id ? { id: value.id } : {}), kind: value.kind, title: text(value.title, 'title', 160),
        content: text(value.content, 'content', 6000), sources: value.sources.map(source) };
}

function document(value: unknown): ProjectMemoryDocument {
    const item = value as ProjectMemoryDocument;
    if (!item || item.schemaVersion !== 1 || !Number.isSafeInteger(item.revision) || item.revision < 0
        || !Array.isArray(item.entries) || item.entries.length > PROJECT_MEMORY_MAX_ENTRIES) return fail('PROJECT_MEMORY_INVALID', 'Invalid memory document');
    const ids = new Set<string>();
    const entries = item.entries.map(entry => {
        const checked = draft(entry);
        if (!checked.id || ids.has(checked.id) || !Number.isSafeInteger(entry.revision) || entry.revision < 1
            || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) return fail('PROJECT_MEMORY_INVALID', 'Invalid memory version');
        ids.add(checked.id);
        let adoption: ProjectMemoryEntry['adoption'];
        if (entry.adoption) {
            const value = entry.adoption;
            if (!/^\.agents\/skills\/learned-[a-z0-9-]+\/SKILL\.md$/.test(value.skillPath)
                || !/^[a-f0-9]{64}$/.test(value.sourceSha256) || !Number.isFinite(Date.parse(value.adoptedAt))) return fail('PROJECT_MEMORY_INVALID', 'Invalid adoption receipt');
            adoption = { ...value, verifiedByUser: text(value.verifiedByUser, 'verification', 2000) };
        }
        return { ...checked, id: checked.id, revision: entry.revision, updatedAt: entry.updatedAt, ...(adoption ? { adoption } : {}) };
    });
    return { schemaVersion: 1, revision: item.revision, entries };
}

/** Bounded project file storage; no history scan, network call or model summarization. */
export class ProjectMemoryStore {
    constructor(readonly workspaceRoot: string) {
        if (!isAbsolute(workspaceRoot) || workspaceRoot.includes('\0')) fail('PROJECT_MEMORY_SCOPE', 'An absolute project workspace is required');
    }

    private async path(relativePath: string, createParents = false): Promise<string> {
        const root = await realpath(this.workspaceRoot);
        const target = resolve(root, relativePath);
        const child = relative(root, target);
        if (!child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) return fail('PROJECT_MEMORY_SCOPE', 'Path leaves the current project');
        const parts = child.split(sep);
        let current = root;
        for (let index = 0; index < parts.length; index++) {
            current = join(current, parts[index]);
            let info;
            try { info = await lstat(current); }
            catch (error) {
                if (!missing(error)) throw error;
                if (index < parts.length - 1 && createParents) {
                    await mkdir(current, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
                    info = await lstat(current);
                } else continue;
            }
            if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory()) return fail('PROJECT_MEMORY_SCOPE', 'Project knowledge cannot traverse symbolic links');
        }
        return target;
    }

    private async readFile(relativePath: string, maximum = MAX_BYTES): Promise<string | undefined> {
        const target = await this.path(relativePath);
        let handle;
        try { handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
        catch (error) { if (missing(error)) return undefined; throw error; }
        try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > maximum) return fail('PROJECT_MEMORY_TOO_LARGE', 'Project knowledge file exceeds its byte limit');
            const buffer = Buffer.alloc(maximum + 1);
            let count = 0;
            while (count < buffer.length) {
                const read = await handle.read(buffer, count, buffer.length - count, count);
                if (!read.bytesRead) break;
                count += read.bytesRead;
            }
            if (count > maximum) return fail('PROJECT_MEMORY_TOO_LARGE', 'Project knowledge file exceeds its byte limit');
            try {
                return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count));
            } catch {
                return fail('PROJECT_MEMORY_INVALID', 'Project knowledge file must contain valid UTF-8 text');
            }
        } finally { await handle.close(); }
    }

    private async writeFile(relativePath: string, body: string, exclusive = false): Promise<void> {
        if (Buffer.byteLength(body) > MAX_BYTES) return fail('PROJECT_MEMORY_TOO_LARGE', 'Project knowledge exceeds its byte limit');
        const target = await this.path(relativePath, true);
        if (exclusive) {
            const handle = await open(target, 'wx', 0o600);
            try { await handle.writeFile(body, 'utf8'); await handle.sync(); } finally { await handle.close(); }
            return;
        }
        const temporary = join(dirname(target), `.knowledge-${randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(body, 'utf8'); await handle.sync(); await handle.close();
            await this.path(relativePath);
            await rename(temporary, target);
        } finally { await handle.close().catch(() => undefined); await rm(temporary, { force: true }).catch(() => undefined); }
    }

    private async mutate<T>(action: () => Promise<T>): Promise<T> {
        const root = await realpath(this.workspaceRoot);
        const previous = locks.get(root) || Promise.resolve();
        const operation = previous.catch(() => undefined).then(action);
        locks.set(root, operation);
        try { return await operation; } finally { if (locks.get(root) === operation) locks.delete(root); }
    }

    async read(): Promise<ProjectMemoryDocument> {
        const body = await this.readFile(PROJECT_MEMORY_PATH);
        if (body === undefined) return { schemaVersion: 1, revision: 0, entries: [] };
        try { return document(JSON.parse(body)); }
        catch (error) { if (error instanceof AgentToolError) throw error; return fail('PROJECT_MEMORY_INVALID', 'Project memory must contain valid JSON'); }
    }

    async snapshot(): Promise<ProjectKnowledgeSnapshot> {
        const memory = await this.read();
        const body = await this.readFile('DESIGN.md', 24_000);
        return { memory, memoryPath: PROJECT_MEMORY_PATH,
            ...(body === undefined ? {} : { design: { path: 'DESIGN.md', content: body, sha256: hash(body) } }) };
    }

    async readDesign(): Promise<{ readonly path: string; readonly sha256: string; readonly content: string } | undefined> {
        const body = await this.readFile('DESIGN.md', 24_000);
        return body === undefined ? undefined : { path: 'DESIGN.md', sha256: hash(body), content: body };
    }

    async ensureDesign(): Promise<string> {
        return this.mutate(async () => {
            if (await this.readFile('DESIGN.md', 24_000) === undefined) {
                await this.writeFile('DESIGN.md', '# Project design\n\n## Goals and audience\n\n## Colors\n\n## Typography\n\n## Layout and spacing\n\n## Components and interaction\n\n## Accessibility\n\n## References and acceptance criteria\n', true);
            }
            return 'DESIGN.md';
        });
    }

    async save(value: ProjectMemoryDraft, expectedRevision: number): Promise<ProjectMemoryDocument> {
        const checked = draft(value);
        return this.mutate(async () => {
            const current = await this.read();
            if (current.revision !== expectedRevision) return fail('PROJECT_MEMORY_CONFLICT', 'Memory changed; reload before saving');
            const previous = checked.id ? current.entries.find(entry => entry.id === checked.id) : undefined;
            if (checked.id && !previous) return fail('PROJECT_MEMORY_NOT_FOUND', 'Memory no longer exists');
            const entry: ProjectMemoryEntry = { ...checked, id: previous?.id || randomUUID(), revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString() };
            // Editing does not silently update an adopted skill or carry its verification forward.
            const entries = previous ? current.entries.map(item => item.id === entry.id ? entry : item) : [...current.entries, entry];
            if (entries.length > PROJECT_MEMORY_MAX_ENTRIES) return fail('PROJECT_MEMORY_FULL', 'Remove obsolete entries before adding memory');
            const next: ProjectMemoryDocument = { schemaVersion: 1, revision: current.revision + 1, entries };
            await this.writeFile(PROJECT_MEMORY_PATH, JSON.stringify(next, null, 2) + '\n');
            return next;
        });
    }

    async remove(id: string, expectedRevision: number): Promise<ProjectMemoryDocument> {
        return this.mutate(async () => {
            const current = await this.read();
            if (current.revision !== expectedRevision) return fail('PROJECT_MEMORY_CONFLICT', 'Memory changed; reload before deleting');
            if (!current.entries.some(entry => entry.id === id)) return fail('PROJECT_MEMORY_NOT_FOUND', 'Memory no longer exists');
            const next: ProjectMemoryDocument = { schemaVersion: 1, revision: current.revision + 1, entries: current.entries.filter(entry => entry.id !== id) };
            await this.writeFile(PROJECT_MEMORY_PATH, JSON.stringify(next, null, 2) + '\n');
            return next;
        });
    }

    /** Host/UI only. Never expose adoption as an agent tool or infer it from tool output. */
    async adopt(id: string, expectedRevision: number, verification: string, expectedSourceSha256: string): Promise<ProjectMemoryDocument> {
        const verifiedByUser = text(verification, 'User verification', 2000);
        return this.mutate(async () => {
            const current = await this.read();
            if (current.revision !== expectedRevision) return fail('PROJECT_MEMORY_CONFLICT', 'Review the current memory revision before adopting');
            const entry = current.entries.find(entry => entry.id === id);
            if (!entry || entry.kind !== 'experience') return fail('PROJECT_MEMORY_NOT_FOUND', 'Only an experience can be adopted as a skill');
            const sourceSha256 = hash(projectMemoryReviewText(entry));
            if (sourceSha256 !== expectedSourceSha256) return fail('PROJECT_MEMORY_CONFLICT', 'Experience content changed; reload and review it before adopting');
            if (entry.adoption) return current;
            const name = `learned-${entry.id}`;
            const skillPath = `.agents/skills/${name}/SKILL.md`;
            const body = `---\nname: ${name}\ndescription: ${JSON.stringify(entry.title)}\n---\n# ${entry.title}\n\n${entry.content}\n\n## Reviewed provenance\n\nProject memory: ${PROJECT_MEMORY_PATH}#${entry.id}\nRevision: ${entry.revision}\nSHA-256: ${sourceSha256}\n\nVerification supplied by the user:\n${verifiedByUser}\n\nSources (references, not independent verification):\n${entry.sources.map(item => `- ${item.kind}: ${item.reference}`).join('\n')}\n`;
            const next: ProjectMemoryDocument = { schemaVersion: 1, revision: current.revision + 1,
                entries: current.entries.map(item => item.id === id ? { ...item, adoption: { skillPath, sourceSha256, verifiedByUser, adoptedAt: new Date().toISOString() } } : item) };
            // Never overwrite a skill that the user has edited, even after deleting its memory.
            await this.writeFile(skillPath, body, true);
            try {
                await this.writeFile(PROJECT_MEMORY_PATH, JSON.stringify(next, null, 2) + '\n');
            } catch (error) {
                const target = await this.path(skillPath).catch(() => undefined);
                if (target) await rm(target, { force: true }).catch(() => undefined);
                throw error;
            }
            return next;
        });
    }

    async search(query: string, budget = PROJECT_MEMORY_READ_BUDGET): Promise<{ readonly revision: number; readonly entries: readonly ProjectMemoryEntry[]; readonly truncated: boolean }> {
        if (typeof query !== 'string' || query.length > 240 || !Number.isSafeInteger(budget) || budget < 100 || budget > PROJECT_MEMORY_READ_BUDGET) return fail('PROJECT_MEMORY_INVALID', 'Invalid memory search budget');
        const current = await this.read();
        const needle = query.trim().toLocaleLowerCase();
        const candidates = current.entries.filter(entry => !needle || `${entry.title}\n${entry.content}`.toLocaleLowerCase().includes(needle));
        const entries: ProjectMemoryEntry[] = [];
        let used = 0;
        for (const entry of candidates) {
            const size = JSON.stringify(entry).length;
            if (used + size > budget) continue;
            entries.push(entry); used += size;
        }
        return { revision: current.revision, entries, truncated: entries.length < candidates.length };
    }
}
