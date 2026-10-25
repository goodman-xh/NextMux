import type { EditorDraftRecoveryAck, EditorDraftRecoveryRecord, EditorDraftRecoverySaveRequest,
    EditorDraftRecoverySnapshot, EditorDraftRecoveryState } from '../common/nextmux-editor-draft-recovery';
import { EDITOR_RECOVERY_MAX_BYTES, EDITOR_RECOVERY_MAX_COUNT } from '../common/nextmux-editor-draft-recovery';
import type { NextMuxPlatformService } from '../common/nextmux-platform-protocol';

type RecoveryService = Pick<NextMuxPlatformService, 'listEditorDraftRecoveries' | 'openEditorDraftRecovery'
    | 'saveEditorDraftRecovery' | 'discardEditorDraftRecovery'>;
export interface EditorRecoveryEntry {
    readonly key: string;
    snapshot: EditorDraftRecoverySnapshot;
    version: number;
    acknowledgedVersion: number;
    ack?: EditorDraftRecoveryAck;
    allocatedId?: string;
    error?: string;
    refreshSourceBaseline?: true;
    pending?: { version: number; request: EditorDraftRecoverySaveRequest };
}

const normalizeLineEndings = (text: string): string => text.includes('\r') ? text.replace(/\r\n/g, '\n') : text;

export function editorRecoveryDirty(snapshot: EditorDraftRecoverySnapshot): boolean {
    return (['before', 'current'] as const).some(side => snapshot.drafts[side] !== undefined
        && (snapshot.baseline[side] === undefined || normalizeLineEndings(snapshot.drafts[side]!) !== normalizeLineEndings(snapshot.baseline[side]!)));
}
export function editorRecoveryError(error: unknown): string {
    const code = (error as { code?: unknown })?.code;
    const text = typeof code === 'string' ? code : error instanceof Error ? error.message : '';
    return /EDITOR_RECOVERY_(?:DISABLED|CONFLICT|NOT_FOUND|TOO_LARGE|QUOTA_EXCEEDED|CORRUPT|UNSAFE_PATH|UNAVAILABLE|UNSUPPORTED_VERSION)/.exec(text)?.[0]
        || 'EDITOR_RECOVERY_UNAVAILABLE';
}
function checkedAck(request: EditorDraftRecoverySaveRequest, ack: EditorDraftRecoveryAck): EditorDraftRecoveryAck {
    if (!ack || ack.id !== request.id || ack.mutationId !== request.mutationId || ack.revision !== request.expectedRevision + 1
        || !/^[a-f0-9]{64}$/.test(ack.snapshotSha256)) throw new Error('EDITOR_RECOVERY_UNAVAILABLE');
    return ack;
}

/** One owner-bound memory snapshot and the existing backend RPC, never localStorage or model input. */
export class EditorDraftRecoveryController {
    readonly entries = new Map<string, EditorRecoveryEntry>();
    state?: EditorDraftRecoveryState;
    error?: string;
    private timer?: ReturnType<typeof setTimeout>;
    private flushing?: Promise<void>;
    private disposed = false;
    private stateRead?: Promise<EditorDraftRecoveryState>;
    private readonly opening = new Map<string, object>();
    constructor(private readonly service: RecoveryService, private readonly changed: () => void = () => undefined) { }

    async refresh(): Promise<EditorDraftRecoveryState> {
        if (this.stateRead) return this.stateRead;
        this.stateRead = this.service.listEditorDraftRecoveries().then(state => {
            this.state = this.state && this.state.settingsRevision > state.settingsRevision
                ? { ...state, enabled: this.state.enabled, settingsRevision: this.state.settingsRevision } : state;
            this.error = undefined; this.notify(); return this.state;
        }).catch(error => { this.error = editorRecoveryError(error); this.notify(); throw error; })
            .finally(() => { this.stateRead = undefined; });
        return this.stateRead;
    }

    find(sessionId: string | undefined, sourceUri: string): EditorRecoveryEntry | undefined {
        return [...this.entries.values()].find(entry => entry.snapshot.sessionId === sessionId
            && entry.snapshot.sourceUri === sourceUri && editorRecoveryDirty(entry.snapshot));
    }

    /** Synchronous admission: rejection leaves the caller's current editor/model intact. */
    capture(key: string, snapshot: EditorDraftRecoverySnapshot, refreshSourceBaseline = false): boolean {
        const previous = this.entries.get(key), dirty = editorRecoveryDirty(snapshot);
        if (!previous && !dirty) return true;
        if (!dirty && previous) {
            if (!editorRecoveryDirty(previous.snapshot)) return true;
            // A successful explicit save/undo needs only deletion, not another copy
            // of a potentially oversized clean file. No clean text is written to disk.
            previous.snapshot = { ...previous.snapshot, drafts: {} };
            previous.version++; previous.error = undefined; previous.refreshSourceBaseline = undefined;
            this.error = undefined; this.schedule(); this.notify(); return true;
        }
        if (previous && JSON.stringify(previous.snapshot) === JSON.stringify(snapshot) && !refreshSourceBaseline) return true;
        if (this.state?.enabled === false && dirty) { this.error = 'EDITOR_RECOVERY_DISABLED'; return false; }
        if (new TextEncoder().encode(JSON.stringify(snapshot)).length > EDITOR_RECOVERY_MAX_BYTES) {
            this.error = 'EDITOR_RECOVERY_TOO_LARGE'; return false;
        }
        if (!previous && this.entries.size >= EDITOR_RECOVERY_MAX_COUNT) {
            this.error = 'EDITOR_RECOVERY_QUOTA_EXCEEDED'; return false;
        }
        const entry = previous || { key, snapshot, version: 0, acknowledgedVersion: 0 };
        entry.snapshot = { ...snapshot, baseline: { ...snapshot.baseline }, drafts: { ...snapshot.drafts } };
        entry.version++; entry.error = undefined;
        if (refreshSourceBaseline) entry.refreshSourceBaseline = true;
        this.entries.set(key, entry); this.error = undefined;
        this.schedule(); this.notify(); return true;
    }

    async open(id: string): Promise<{ entry: EditorRecoveryEntry; record: EditorDraftRecoveryRecord }> {
        const before = [...this.entries.values()].find(entry => entry.ack?.id === id || entry.allocatedId === id);
        const version = before?.version, ticket = {};
        this.opening.set(id, ticket);
        try {
            const result = await this.service.openEditorDraftRecovery({ id });
            if (result.kind !== 'record' || this.opening.get(id) !== ticket) throw new Error('EDITOR_RECOVERY_NOT_FOUND');
            const existing = [...this.entries.values()].find(entry => entry.ack?.id === id || entry.allocatedId === id);
            if (before && !existing) throw new Error('EDITOR_RECOVERY_NOT_FOUND');
            if (existing && !editorRecoveryDirty(existing.snapshot)) throw new Error('EDITOR_RECOVERY_NOT_FOUND');
            // A completed flush is still newer input; "confirmed" does not mean safe to replace.
            if (existing && (existing !== before || existing.version !== version
                || existing.version !== existing.acknowledgedVersion || (existing.ack?.revision || 0) > result.record.revision)) {
                const record: EditorDraftRecoveryRecord = existing.ack && this.isConfirmed(existing.key)
                    ? { ...existing.ack, version: 1, snapshot: existing.snapshot }
                    : { ...result.record, source: { status: 'unverified', canWriteSource: false } };
                return { entry: existing, record };
            }
            if (!existing && this.entries.size >= EDITOR_RECOVERY_MAX_COUNT) throw new Error('EDITOR_RECOVERY_QUOTA_EXCEEDED');
            const entry: EditorRecoveryEntry = { key: existing?.key || id, snapshot: result.record.snapshot,
                version: 1, acknowledgedVersion: 1, ack: result.record };
            this.entries.set(entry.key, entry); this.notify(); return { entry, record: result.record };
        } finally { if (this.opening.get(id) === ticket) this.opening.delete(id); }
    }

    isConfirmed(key: string): boolean {
        const entry = this.entries.get(key);
        return Boolean(entry && entry.version === entry.acknowledgedVersion && !entry.error && !entry.pending);
    }
    get hasUnconfirmed(): boolean {
        return [...this.entries.values()].some(entry => entry.version !== entry.acknowledgedVersion || entry.pending || entry.error);
    }

    /** A single writer joins in-flight commits and follows up if more input arrived. */
    flushAll(): Promise<void> {
        if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
        if (this.flushing) return this.flushing.then(() => this.hasUnconfirmed ? this.flushAll() : undefined);
        const run = async (): Promise<void> => {
            let failure: unknown;
            for (const entry of [...this.entries.values()]) {
                try {
                    while (this.entries.get(entry.key) === entry
                        && (entry.version !== entry.acknowledgedVersion || entry.pending)) await this.commit(entry);
                } catch (error) {
                    entry.error = editorRecoveryError(error);
                    if (entry.error !== 'EDITOR_RECOVERY_UNAVAILABLE') entry.pending = undefined;
                    failure ||= error;
                }
            }
            this.notify();
            if (failure) throw new Error(editorRecoveryError(failure));
        };
        const flushing = run().finally(() => { if (this.flushing === flushing) this.flushing = undefined; this.notify(); });
        this.flushing = flushing;
        return flushing;
    }

    private async commit(entry: EditorRecoveryEntry): Promise<void> {
        const version = entry.version, snapshot = entry.snapshot;
        // Resolve a lost response using its exact mutation, never a new id/revision.
        if (entry.pending) {
            const pending = entry.pending;
            const ack = checkedAck(pending.request, await this.service.saveEditorDraftRecovery(pending.request));
            entry.ack = ack; entry.allocatedId = undefined; entry.acknowledgedVersion = pending.version;
            entry.pending = undefined; entry.error = undefined;
            return;
        }
        if (!editorRecoveryDirty(snapshot)) {
            if (entry.ack || entry.allocatedId) this.opening.delete(entry.ack?.id || entry.allocatedId!);
            if (entry.ack) await this.service.discardEditorDraftRecovery({ id: entry.ack.id, expectedRevision: entry.ack.revision });
            else if (entry.allocatedId) await this.service.discardEditorDraftRecovery({ id: entry.allocatedId, expectedRevision: 0 });
            entry.ack = undefined; entry.allocatedId = undefined; entry.acknowledgedVersion = version; entry.error = undefined;
            // New input during deletion stays in memory and receives a new Node-issued id.
            if (entry.version === version) this.entries.delete(entry.key);
            return;
        }
        if (!entry.ack && !entry.allocatedId) {
            const result = await this.service.openEditorDraftRecovery({ sessionId: snapshot.sessionId });
            if (result.kind !== 'allocated') throw new Error('EDITOR_RECOVERY_UNAVAILABLE');
            entry.allocatedId = result.id;
        }
        const request: EditorDraftRecoverySaveRequest = {
            id: entry.ack?.id || entry.allocatedId!, expectedRevision: entry.ack?.revision || 0,
            mutationId: crypto.randomUUID(), snapshot,
            ...(entry.refreshSourceBaseline ? { refreshSourceBaseline: true } : {})
        };
        entry.refreshSourceBaseline = undefined;
        entry.pending = { version, request };
        const ack = checkedAck(request, await this.service.saveEditorDraftRecovery(request));
        entry.ack = ack; entry.allocatedId = undefined; entry.acknowledgedVersion = version;
        entry.pending = undefined; entry.error = undefined;
    }

    /** Explicitly discard only the exact local revision the UI offered for deletion. */
    async discard(key: string, version: number): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry || entry.version !== version) throw new Error('EDITOR_RECOVERY_CONFLICT');
        if (entry.ack || entry.allocatedId) this.opening.delete(entry.ack?.id || entry.allocatedId!);
        if (this.flushing) await this.flushing.catch(() => undefined);
        if (this.entries.get(key) !== entry || entry.version !== version) throw new Error('EDITOR_RECOVERY_CONFLICT');
        if (entry.pending) {
            // Confirm the old accepted write before discarding; unknown means preserve, not guess.
            await this.commit(entry);
            if (entry.version !== version) throw new Error('EDITOR_RECOVERY_CONFLICT');
        }
        if (entry.ack) await this.service.discardEditorDraftRecovery({ id: entry.ack.id, expectedRevision: entry.ack.revision });
        else if (entry.allocatedId) await this.service.discardEditorDraftRecovery({ id: entry.allocatedId, expectedRevision: 0 });
        if (entry.version !== version) { entry.ack = undefined; entry.allocatedId = undefined; this.schedule(); throw new Error('EDITOR_RECOVERY_CONFLICT'); }
        this.entries.delete(key); this.notify();
    }

    private schedule(): void {
        if (this.disposed || this.timer) return;
        this.timer = setTimeout(() => { this.timer = undefined; void this.flushAll().catch(() => undefined); }, 250);
    }
    private notify(): void { if (!this.disposed) this.changed(); }
    dispose(): void { this.disposed = true; if (this.timer) clearTimeout(this.timer); }
}
