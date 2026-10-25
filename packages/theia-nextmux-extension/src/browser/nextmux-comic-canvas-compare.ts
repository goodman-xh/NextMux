/** Local image/video comparison list. Entries refer to existing media and cannot run a model. */
import { createCanvasDocument, validateCanvasDocument } from '@nextmux/comic-core/canvas';
import type { CanvasAssetVersion, CanvasMediaMetadata } from '@nextmux/comic-core/canvas';

export const CANVAS_COMPARE_LIMIT = 16;
export type CanvasCompareVersion = Pick<CanvasAssetVersion, 'id' | 'assetId' | 'uri' | 'createdAt' | 'metadata'> & { readonly kind: 'image' | 'video' };
export type CanvasCompareLibrary = readonly CanvasCompareVersion[];
export type CanvasCompareRefusalCode = 'MISSING_MEDIA' | 'DUPLICATE_URI' | 'LIBRARY_FULL';
export type CanvasCompareAddResult =
    | { readonly ok: true; readonly library: CanvasCompareLibrary; readonly version: CanvasCompareVersion }
    | { readonly ok: false; readonly library: CanvasCompareLibrary; readonly code: CanvasCompareRefusalCode; readonly count: number; readonly limit: number };

const METADATA_KEYS: readonly (keyof CanvasMediaMetadata)[] = [
    'durationMs', 'width', 'height', 'mimeType', 'byteLength', 'sha256', 'frameRate', 'hasAudio', 'streamStartMs'
];

function mediaReference(value: unknown): CanvasCompareVersion | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    if ((source.kind !== 'image' && source.kind !== 'video') ||
        [source.id, source.assetId, source.uri, source.createdAt].some(item => typeof item !== 'string' || !item.trim()) ||
        (source.status !== undefined && source.status !== 'ready')) return undefined;
    if (!Number.isFinite(Date.parse(source.createdAt as string))) return undefined;
    let metadata: CanvasMediaMetadata | undefined;
    if (source.metadata !== undefined) {
        if (!source.metadata || typeof source.metadata !== 'object' || Array.isArray(source.metadata)) return undefined;
        const raw = source.metadata as Record<string, unknown>;
        metadata = Object.fromEntries(METADATA_KEYS.filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]]));
    }
    const version: CanvasCompareVersion = { id: source.id as string, assetId: source.assetId as string, uri: (source.uri as string).trim(),
        kind: source.kind, createdAt: source.createdAt as string, ...(metadata ? { metadata } : {}) };
    // Reuse the persistent media contract to reject transient URIs and malformed metadata.
    const probe = { ...createCanvasDocument({ id: 'compare', projectId: 'local', now: version.createdAt }),
        nodes: [{ id: 'media', kind: version.kind, title: 'Media', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
            payload: { versions: [version], currentVersionId: version.id } }] };
    return validateCanvasDocument(probe).length === 0 ? version : undefined;
}

/** Restore local JSON: discard invalid entries and duplicate URIs, retain the first sixteen valid references. */
export function normalizeCanvasCompareLibrary(value: unknown): CanvasCompareLibrary {
    if (!Array.isArray(value)) return [];
    const library: CanvasCompareVersion[] = [];
    const seen = new Set<string>();
    for (const candidate of value) {
        const version = mediaReference(candidate);
        if (!version || seen.has(version.uri)) continue;
        library.push(version);
        seen.add(version.uri);
        if (library.length === CANVAS_COMPARE_LIMIT) break;
    }
    return library;
}

/** Add one existing image/video version; refusals distinguish unavailable media, repeated URI, and a full list. */
export function addCanvasCompareVersion(library: CanvasCompareLibrary, value: unknown): CanvasCompareAddResult {
    const version = mediaReference(value);
    const code = !version ? 'MISSING_MEDIA' : library.some(item => item.uri === version.uri) ? 'DUPLICATE_URI'
        : library.length >= CANVAS_COMPARE_LIMIT ? 'LIBRARY_FULL' : undefined;
    if (code || !version) return { ok: false, library, code: code ?? 'MISSING_MEDIA', count: library.length, limit: CANVAS_COMPARE_LIMIT };
    return { ok: true, library: [...library, version], version };
}

/** Remove by URI, since IDs may repeat across projects. */
export function removeCanvasCompareVersion(library: CanvasCompareLibrary, uri: string): CanvasCompareLibrary {
    return library.filter(version => version.uri !== uri.trim());
}

export function clearCanvasCompareLibrary(_library: CanvasCompareLibrary): CanvasCompareLibrary { return []; }
