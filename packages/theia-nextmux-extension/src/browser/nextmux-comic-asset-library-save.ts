import type { CanvasDocument } from '@nextmux/comic-core/canvas';
import type { CanvasAssetLibrarySaveInput, ComicAssetLibraryEntry } from '../common/nextmux-comic-asset-library';
import { comicAssetLibraryText } from './nextmux-comic-asset-library-text';

export interface CanvasAssetSaveItem extends CanvasAssetLibrarySaveInput {
    /** Display-only; the service determines the persisted type from the actual source. */
    readonly mediaKind?: ComicAssetLibraryEntry['assetType'];
    readonly unavailable?: 'emptyText' | 'emptyMedia';
}

/** Capture the selected version now, before saving the canvas or copying media asynchronously. */
export function canvasAssetSaveItems(canvas: CanvasDocument, nodeIds: readonly string[]): readonly CanvasAssetSaveItem[] {
    return [...new Set(nodeIds)].flatMap(id => {
        const node = canvas.nodes.find(item => item.id === id);
        if (!node || node.kind === 'group') return [];
        const payload = node.payload;
        const version = 'versions' in payload ? payload.versions.find(item => item.id === payload.currentVersionId) : undefined;
        const text = node.kind === 'text' ? node.payload.text.slice(0, 1000) : undefined;
        const mediaKind = text !== undefined ? 'text' : version?.kind;
        const assetCategory = node.kind === 'character' || node.origin?.role === 'portrait' ? 'character' as const
            : version?.kind === 'audio' ? 'audio' as const : 'other' as const;
        return [{ nodeId: id, requestId: crypto.randomUUID(), assetName: node.title, assetCategory, remark: '',
            ...(mediaKind ? { mediaKind } : {}),
            ...(text !== undefined ? { textContent: text, ...(!text.trim() ? { unavailable: 'emptyText' as const } : {}) }
                : version?.uri && version.status !== 'missing' && version.status !== 'uploading' ? { versionId: version.id } : { unavailable: 'emptyMedia' as const }) }];
    });
}

interface SaveRecord { input: CanvasAssetLibrarySaveInput; pending?: Promise<ComicAssetLibraryEntry> }
interface SaveBatch { readonly completed: Map<string, ComicAssetLibraryEntry>; pending?: Promise<CanvasAssetSaveResult> }
interface SaveScope { readonly records: Map<string, SaveRecord>; readonly batches: Map<string, SaveBatch> }
const scopes = new Map<string, SaveScope>();
export interface CanvasAssetSaveResult {
    readonly saved: number;
    readonly failed: readonly { readonly nodeId: string; readonly name: string; readonly message: string }[];
}
interface SaveOptions {
    readonly scope: string;
    readonly locale: string;
    readonly items: readonly CanvasAssetSaveItem[];
    readonly onSave: (input: CanvasAssetLibrarySaveInput) => Promise<ComicAssetLibraryEntry>;
    readonly onNotice: (message: string) => void;
}

/** Same owner + source snapshot keeps its request ID, including an acknowledgement lost after persistence. */
export function saveCanvasAssets(options: SaveOptions): Promise<CanvasAssetSaveResult> {
    const t = (key: Parameters<typeof comicAssetLibraryText>[1]): string => comicAssetLibraryText(options.locale, key);
    let scope = scopes.get(options.scope);
    if (!scope) { scope = { records: new Map(), batches: new Map() }; scopes.set(options.scope, scope); }
    const rows = [...new Map(options.items.map(item => {
        const { requestId, mediaKind, unavailable, ...source } = item;
        const input: CanvasAssetLibrarySaveInput = { ...source, requestId,
            assetName: (source.assetName.trim() || (mediaKind ? t(mediaKind === 'audio' ? 'audioMedia' : mediaKind) : source.nodeId)).slice(0, 160),
            remark: source.remark.trim() };
        const { requestId: _requestId, ...identity } = input;
        const key = JSON.stringify(identity);
        return [key, { key, input, unavailable }] as const;
    })).values()];
    if (!rows.length) {
        options.onNotice(t('emptyMedia'));
        return Promise.resolve({ saved: 0, failed: [] });
    }
    const batchKey = JSON.stringify(rows.map(row => [row.key, row.unavailable ?? '']).sort((a, b) => a[0].localeCompare(b[0])));
    let batch = scope.batches.get(batchKey);
    if (batch?.pending) return batch.pending;
    if (!batch) { batch = { completed: new Map() }; scope.batches.set(batchKey, batch); }
    const owner = scope, current = batch;
    // Defer execution until the pending batch is registered, including synchronously throwing callbacks.
    const pending = Promise.resolve().then(async (): Promise<CanvasAssetSaveResult> => {
        const failed: { nodeId: string; name: string; message: string }[] = [];
        for (const row of rows) {
            if (current.completed.has(row.key)) continue;
            try {
                if (row.unavailable) throw new Error(t(row.unavailable));
                let record = owner.records.get(row.key);
                if (!record) { record = { input: row.input }; owner.records.set(row.key, record); }
                if (!record.pending) {
                    const captured = record;
                    captured.pending = Promise.resolve().then(() => options.onSave(captured.input)).catch(error => {
                        // A deliberate save after deletion is a new intent, never a resurrection of the tombstoned entry.
                        if (!(error instanceof Error) || error.message !== 'ASSET_LIBRARY_DELETED') throw error;
                        captured.input = { ...captured.input, requestId: crypto.randomUUID() };
                        return options.onSave(captured.input);
                    }).finally(() => { captured.pending = undefined; });
                }
                current.completed.set(row.key, await record.pending!);
            } catch (error) {
                failed.push({ nodeId: row.input.nodeId, name: row.input.assetName, message: error instanceof Error ? error.message : String(error) });
            }
        }
        const saved = rows.length - failed.length;
        if (!failed.length) {
            owner.batches.delete(batchKey);
            options.onNotice(t('saveSucceeded'));
        } else {
            options.onNotice(`${t('saveIncomplete').replace('{saved}', String(saved)).replace('{total}', String(rows.length))}\n${failed.map(item => `${item.name}: ${item.message}`).join('\n')}`);
        }
        return { saved, failed };
    }).finally(() => { current.pending = undefined; });
    current.pending = pending;
    return pending;
}
