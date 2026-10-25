import type { CanvasInputRole, CanvasMediaMetadata, CanvasPoint } from '@nextmux/comic-core/canvas';

export const COMIC_ASSET_CATEGORIES = ['character', 'scene', 'item', 'style', 'audio', 'other'] as const;
export type ComicAssetCategory = typeof COMIC_ASSET_CATEGORIES[number];
export interface ComicAssetCategoryOption { readonly id: ComicAssetCategory; readonly sortOrder: number }
export const COMIC_ASSET_CATEGORY_OPTIONS: readonly ComicAssetCategoryOption[] = COMIC_ASSET_CATEGORIES.map((id, sortOrder) => ({ id, sortOrder }));
export type ComicAssetLibraryFilter = 'all' | 'character' | 'image' | 'video' | 'audio';
export interface ComicAssetLibraryEntry {
    readonly assetId: string;
    readonly assetName: string;
    readonly assetCategory: ComicAssetCategory;
    readonly assetType: 'image' | 'video' | 'audio' | 'text';
    readonly remark: string;
    readonly textContent?: string;
    readonly durationMs?: number;
    readonly metadata?: CanvasMediaMetadata;
    readonly createdAt: string;
    readonly source: { readonly origin?: 'canvas' | 'local_file' | 'text' | 'character'; readonly projectId?: string; readonly canvasId?: string; readonly nodeId?: string; readonly versionId?: string; readonly workspaceRoot?: string };
    /** An owned local copy; never a supplier identity or a transient provider URL. */
    readonly mediaPath?: string;
    readonly pinnedAt?: string;
    /** Projection of an existing character bundle. Its full semantic data remains in the character library. */
    readonly characterBundleId?: string;
    readonly character?: { readonly appearance?: string; readonly description?: string; readonly identityVersion?: string;
        readonly referenceCount: number; readonly authorizationRef: string; readonly sourceCharacterId: string };
}
/** Explicit local file selection or an already-downloaded chat result; no remote URLs or caller-declared media type. */
export interface SaveComicLocalAssetRequest {
    readonly requestId: string; readonly path?: string; readonly textContent?: string; readonly assetName?: string; readonly remark?: string;
    readonly assetCategory?: ComicAssetCategory;
    readonly sourceProjectId?: string; readonly sourceVersionId?: string; readonly sourceWorkspaceRoot?: string;
    readonly agentOutput?: { readonly ownerId:string; readonly asset:import('@nextmux/agent-runtime').AgentOutputAsset };
}
export interface PinComicAssetLibraryRequest { readonly assetId: string; readonly pinned: boolean }
export interface SetComicAssetLibraryCategoryRequest { readonly assetId: string; readonly assetCategory: ComicAssetCategory }
const CHARACTER_IMAGE_KEYWORD_PATTERN = /(?:立绘|人设|三视图|角色设定|人物设定|角色设计|人物设计|角色形象|人物形象|形象设定|形象设计|定妆照|角色图|人物肖像|角色立绘|人物立绘|主角|男主|女主|反派|配角|\bcharacter\s*(?:sheet|design|portrait|ref|reference|turnaround|concept)\b|\bmodel\s*sheet\b|\bturnaround\s*sheet\b)/i;

export function inferComicCharacterImageCategory(...texts: readonly (string | undefined)[]): boolean {
    return texts.some(text => typeof text === 'string' && CHARACTER_IMAGE_KEYWORD_PATTERN.test(text));
}

export function comicAssetLibraryMatches(entry: ComicAssetLibraryEntry, filter: ComicAssetLibraryFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'character') return entry.assetCategory === 'character' || Boolean(entry.characterBundleId);
    if (filter === 'image') return entry.assetType === 'image' && entry.assetCategory !== 'character' && !entry.characterBundleId;
    return entry.assetType === filter;
}
export function sortComicAssetLibrary(entries: readonly ComicAssetLibraryEntry[], oldest = false): ComicAssetLibraryEntry[] {
    return [...entries].sort((a,b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt))
        || (oldest ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)) || a.assetId.localeCompare(b.assetId));
}
export interface SaveComicCanvasAssetRequest {
    readonly workspaceRoot: string; readonly canvasId?: string; readonly nodeId: string;
    readonly versionId?: string; readonly textContent?: string;
    readonly requestId: string; readonly assetName: string; readonly assetCategory: ComicAssetCategory; readonly remark: string;
}
export interface ImportComicLibraryAssetRequest {
    readonly workspaceRoot: string; readonly canvasId?: string; readonly expectedRevision: number;
    readonly requestId: string; readonly assetId: string; readonly position: CanvasPoint;
    readonly target?: { readonly nodeId: string; readonly role: CanvasInputRole };
}
export type CanvasAssetLibrarySaveInput = Omit<SaveComicCanvasAssetRequest, 'workspaceRoot' | 'canvasId'>;
