import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MediaJob } from '@nextmux/media-core';
import type { OwnApiUsageEntry } from '../common/nextmux-platform-protocol';

const lockfile = require('proper-lockfile') as { lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>> };
const writes = new Map<string, Promise<void>>();
const mediaKinds = new Set(['image', 'video', 'speech', 'music', 'sound_effect']);

/** Resolve metadata only. Never resolve credentials or reinterpret a managed/local route as an own API. */
export function ownApiUsageConnectionId(value: unknown, connections: readonly { readonly id: string }[]): string | undefined {
    if (typeof value !== 'string' || !value || /^(?:managed|local|comfyui):/.test(value)) return undefined;
    const exact = connections.find(connection => connection.id === value);
    if (exact) return exact.id;
    const matches = connections.filter(connection => value === `official:${connection.id}`
        || value.startsWith(`official:${connection.id}:`) && value.length > `official:${connection.id}:`.length);
    return matches.length === 1 ? matches[0].id : undefined;
}

/** A completed queue record proves a call/result, never its provider's charge or token count. */
export function ownApiUsageForMediaJob(job: MediaJob, connections: readonly { readonly id: string }[], source: OwnApiUsageEntry['source']): OwnApiUsageEntry | undefined {
    if (job.status !== 'succeeded' || !job.output || job.restoredHistoryOnly || !mediaKinds.has(job.kind)) return undefined;
    const input = job.input as { readonly connectionId?: unknown; readonly model?: unknown };
    const connectionId = ownApiUsageConnectionId(input.connectionId, connections);
    const at = Date.parse(job.completedAt || '');
    if (!connectionId || typeof input.model !== 'string' || !input.model || !Number.isFinite(at)) return undefined;
    return { id: job.id, at, kind: job.kind as OwnApiUsageEntry['kind'], connectionId, model: input.model, source, status: 'completed' };
}

/** Read the established local log, ignoring corrupt lines and duplicate job/run IDs. */
export function readOwnApiUsageLog(text: string): OwnApiUsageEntry[] {
    const entries = new Map<string, OwnApiUsageEntry>();
    const kinds = new Set(['text', ...mediaKinds]);
    const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
    for (const line of text.split('\n')) {
        let value: any;
        try { value = JSON.parse(line); } catch { continue; }
        if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 200 || !Number.isFinite(value.at)
            || !kinds.has(value.kind) || typeof value.connectionId !== 'string' || !value.connectionId || typeof value.model !== 'string') continue;
        if (entries.has(value.id)) continue;
        const source = value.source?.kind === 'comic_chat' ? { kind: 'comic_chat' as const }
            : value.source?.kind === 'coding' ? { kind: 'coding' as const, ...(typeof value.source?.title === 'string' ? { title: value.source.title.slice(0, 200) } : {}) }
            : { kind: 'comic' as const, ...(typeof value.source?.title === 'string' ? { title: value.source.title.slice(0, 200) } : {}) };
        entries.set(value.id, { id: value.id, at: value.at, kind: value.kind, connectionId: value.connectionId.slice(0, 200),
            model: value.model.slice(0, 200), source, status: value.status === 'failed' ? 'failed' : 'completed',
            ...(count(value.inputTokens) ? { inputTokens: value.inputTokens } : {}),
            ...(count(value.outputTokens) ? { outputTokens: value.outputTokens } : {}) });
    }
    return [...entries.values()].sort((a, b) => b.at - a.at);
}

/** Serialize both backend connections and processes; a recovered job's ID is recorded at most once. */
export function appendOwnApiUsage(path: string, additions: readonly OwnApiUsageEntry[]): Promise<void> {
    if (!additions.length) return Promise.resolve();
    const previous = writes.get(path) || Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
        await mkdir(dirname(path), { recursive: true });
        const release = await lockfile.lock(path, { realpath: false, stale: 10_000, retries: { retries: 30, minTimeout: 20, maxTimeout: 100 } });
        try {
            let text = '';
            try { text = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            const current = readOwnApiUsageLog(text), ids = new Set(current.map(entry => entry.id));
            // Restoring an old project must not bring records outside the bounded log's retention back to the top.
            const cutoff = current.length >= 1_000 ? current[999].at : -Infinity;
            const fresh = readOwnApiUsageLog(additions.map(entry => JSON.stringify(entry)).join('\n'))
                .filter(entry => !ids.has(entry.id) && entry.at >= cutoff);
            if (!fresh.length) return;
            await appendFile(path, `${text && !text.endsWith('\n') ? '\n' : ''}${fresh.map(entry => JSON.stringify(entry)).join('\n')}\n`, { mode: 0o600 });
            if ((await stat(path)).size > 1_000_000) {
                const kept = [...current, ...fresh].sort((a, b) => b.at - a.at).slice(0, 1_000).reverse();
                const temporary = `${path}.${randomUUID()}.tmp`;
                try { await writeFile(temporary, `${kept.map(entry => JSON.stringify(entry)).join('\n')}\n`, { mode: 0o600 }); await rename(temporary, path); }
                finally { await unlink(temporary).catch(() => undefined); }
            }
        } finally { await release(); }
    });
    writes.set(path, pending);
    void pending.finally(() => { if (writes.get(path) === pending) writes.delete(path); }).catch(() => undefined);
    return pending;
}
