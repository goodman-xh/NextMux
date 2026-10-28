export interface ConversationPersistenceRecord {
    readonly id: string;
}

export interface ConversationPersistenceChanges<TRecord extends ConversationPersistenceRecord> {
    readonly upserts: readonly TRecord[];
    readonly removedSessionIds: readonly string[];
}

export type ConversationPersistenceBaseline<TRecord extends ConversationPersistenceRecord> = Map<string, TRecord>;

/**
 * The desktop state is immutable: editing a conversation replaces its session object while
 * untouched sessions retain their object identity. Keeping the acknowledged objects therefore
 * gives us an O(session count) dirty check without serializing every historical message.
 */
export function createConversationPersistenceBaseline<TRecord extends ConversationPersistenceRecord>(
    records: readonly TRecord[]
): ConversationPersistenceBaseline<TRecord> {
    return new Map(records.map(record => [record.id, record]));
}

export function conversationPersistenceChanges<TRecord extends ConversationPersistenceRecord>(
    current: readonly TRecord[],
    baseline: ReadonlyMap<string, TRecord>
): ConversationPersistenceChanges<TRecord> {
    const currentIds = new Set<string>();
    const upserts: TRecord[] = [];
    for (const record of current) {
        currentIds.add(record.id);
        if (baseline.get(record.id) !== record) upserts.push(record);
    }
    const removedSessionIds = [...baseline.keys()].filter(id => !currentIds.has(id));
    return { upserts, removedSessionIds };
}

/** Apply exactly the snapshot acknowledged by the backend. New renderer changes remain dirty. */
export function applyConversationPersistenceCommit<TRecord extends ConversationPersistenceRecord>(
    baseline: ConversationPersistenceBaseline<TRecord>,
    committed: ConversationPersistenceChanges<TRecord>
): void {
    for (const id of committed.removedSessionIds) baseline.delete(id);
    for (const record of committed.upserts) baseline.set(record.id, record);
}

export function hasConversationPersistenceChanges<TRecord extends ConversationPersistenceRecord>(
    changes: ConversationPersistenceChanges<TRecord>
): boolean {
    return changes.upserts.length > 0 || changes.removedSessionIds.length > 0;
}

/**
 * A renderer mutation can arrive after an async persistence request has taken
 * its snapshot.  The caller must schedule one more flush in that case.  Do
 * not retry an unchanged failed request: a permanently unavailable backend
 * must not create a tight timer loop.
 */
export function conversationPersistenceNeedsFollowUp(
    currentRevision: number,
    flushStartRevision: number,
    dirty: boolean,
    persistenceReady: boolean,
    saveConversationHistory: boolean
): boolean {
    return dirty
        && persistenceReady
        && saveConversationHistory
        && currentRevision !== flushStartRevision;
}

/**
 * Recognizes concurrent conversation store updates across both direct in-memory
 * errors (`ConversationStoreError` / `PlatformRequestError`) and RPC-decoded
 * `PlatformRequestError` envelopes where `error.message` is the generic English
 * model/operation fallback while `domainError.code` carries
 * `CONVERSATION_STORE_CONCURRENT_UPDATE`, as well as `INCOGNITO_MODE_CHANGED`
 * CAS conflicts on origin-owned conversations.
 */
export function isConversationStoreConcurrentUpdateError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as {
        readonly code?: unknown;
        readonly message?: unknown;
        readonly domainError?: { readonly code?: unknown; readonly params?: { readonly reason?: unknown } };
        readonly data?: { readonly domainError?: { readonly code?: unknown; readonly params?: { readonly reason?: unknown } } };
    };
    if (record.code === 'INCOGNITO_MODE_CHANGED') return true;
    if (record.code !== 'IMPORT_CONFLICT') return false;
    const domain = record.domainError && typeof record.domainError === 'object'
        ? record.domainError
        : record.data && typeof record.data === 'object' && record.data.domainError && typeof record.data.domainError === 'object'
            ? record.data.domainError
            : undefined;
    if (domain?.code === 'CONVERSATION_STORE_CONCURRENT_UPDATE' || domain?.params?.reason === 'store_concurrent_update') {
        return true;
    }
    return String(record.message ?? '').includes('store_concurrent_update');
}
