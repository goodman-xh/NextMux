/**
 * Keeps the model lists of the user's own APIs ("自有 API") current. Providers add models all the
 * time, so a list read when the API was added goes stale: a newer model the API already serves
 * would never show up. Every list is read again at least once a day, and all of them soon after
 * the global model catalog shows models it did not have before — one connection after another,
 * oldest list first, never in parallel.
 */

export const MODEL_LIST_MAX_AGE_MS = 24 * 60 * 60_000;
/** A failed read is not retried in a tight loop. */
export const MODEL_LIST_RETRY_MS = 6 * 60 * 60_000;
/**
 * When the list reader last learned something new about models (2026-09-27: each model's reasoning efforts as
 * the API declares them). Lists read before then are read again right away instead of within a day.
 */
export const MODEL_LIST_FORMAT_AT = Date.parse('2026-09-27T01:00:00Z');

export interface ModelListRefreshSubject {
    readonly id: string;
    readonly lastModelDiscoveryAt?: string;
    /** Media APIs have no model directory; their chosen model is kept as is. */
    readonly media?: boolean;
}

export interface ModelListWatermark {
    /** Fingerprint of the global catalog's model IDs when last seen. */
    readonly fingerprint: string;
    /** When the catalog was first seen with models it did not have before (0: never). */
    readonly watermark: number;
}

/** FNV-1a over the sorted, distinct IDs plus their count: cheap to store, changes when the set does. */
export function modelListFingerprint(ids: Iterable<string>): string {
    const sorted = [...new Set([...ids].map(id => id.trim().toLowerCase()).filter(Boolean))].sort();
    let hash = 0x811c9dc5;
    for (const id of sorted) {
        for (let index = 0; index < id.length; index++) {
            hash ^= id.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        hash ^= 0x0a;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${sorted.length}:${hash.toString(16).padStart(8, '0')}`;
}

/**
 * The first catalog seen only records its fingerprint (a fresh install does not re-read every API).
 * A different set that is not smaller must contain a model it did not have before (one replaced by
 * another counts too), so it moves the watermark to `now`; a set that only shrank does not.
 */
export function nextModelListWatermark(previous: ModelListWatermark | undefined, fingerprint: string, now: number): ModelListWatermark {
    if (!previous?.fingerprint) return { fingerprint, watermark: previous?.watermark || 0 };
    if (previous.fingerprint === fingerprint) return previous;
    const count = (value: string): number => Number(value.split(':', 1)[0]) || 0;
    return { fingerprint, watermark: count(fingerprint) >= count(previous.fingerprint) ? now : previous.watermark };
}

export function parseModelListWatermark(value: string | null | undefined): ModelListWatermark | undefined {
    try {
        const parsed = JSON.parse(value || '') as Partial<ModelListWatermark>;
        return typeof parsed.fingerprint === 'string' && Number.isFinite(parsed.watermark) ? { fingerprint: parsed.fingerprint, watermark: Number(parsed.watermark) } : undefined;
    } catch {
        return undefined;
    }
}

/** Connections whose list should be read again now, oldest list first. */
export function staleModelListConnections(
    subjects: readonly ModelListRefreshSubject[],
    options: { readonly now: number; readonly watermark?: number; readonly maxAgeMs?: number; readonly attempts?: ReadonlyMap<string, number> }
): readonly string[] {
    const threshold = Math.max(Math.min(options.watermark || 0, options.now), options.now - (options.maxAgeMs ?? MODEL_LIST_MAX_AGE_MS),
        options.now >= MODEL_LIST_FORMAT_AT ? MODEL_LIST_FORMAT_AT : 0);
    const listedAt = (subject: ModelListRefreshSubject): number => {
        const value = Date.parse(subject.lastModelDiscoveryAt || '');
        return Number.isFinite(value) ? value : 0;
    };
    return subjects
        .filter(subject => !subject.media && listedAt(subject) < threshold
            && !((options.attempts?.get(subject.id) ?? -Infinity) > options.now - MODEL_LIST_RETRY_MS))
        .sort((left, right) => listedAt(left) - listedAt(right) || left.id.localeCompare(right.id))
        .map(subject => subject.id);
}
