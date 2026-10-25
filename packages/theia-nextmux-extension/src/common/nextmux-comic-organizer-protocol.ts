import type { CanvasPoint, CanvasRegistry, ComicProjectCoverCandidate, ComicProjectFolder, ComicProjectMetaPatch } from '@nextmux/comic-core';
import type { DesktopComicCanvasState, DesktopComicProjectState } from './nextmux-platform-protocol';

export interface ComicFolderRequest { readonly name: string }
export interface RenameComicFolderRequest extends ComicFolderRequest { readonly folderId: string }
export interface ComicProjectMetadataRequest { readonly workspaceRoot: string; readonly patch: ComicProjectMetaPatch }
export interface DuplicateComicLibraryProjectRequest { readonly workspaceRoot: string; readonly title?: string; readonly folderId?: string | null }
export interface DuplicateComicLibraryProjectResult {
    readonly path: string;
    readonly state: DesktopComicProjectState;
    readonly assetsCopied: number;
    readonly canvasesCopied: number;
}
export interface ComicCanvasIdentityRequest { readonly workspaceRoot: string; readonly canvasId: string }
export interface CreateComicCanvasRequest { readonly workspaceRoot: string; readonly name: string }
export interface RenameComicCanvasRequest extends ComicCanvasIdentityRequest { readonly name: string }
export interface OpenComicCanvasRequest extends ComicCanvasIdentityRequest { readonly open: boolean }
export interface OrderComicCanvasesRequest { readonly workspaceRoot: string; readonly canvasIds: readonly string[] }
/** Prepare, native Trash, then finalize. Failure can cancel the retirement without losing the document. */
export interface DeleteComicCanvasResult { readonly registry: CanvasRegistry; readonly trashPath: string }
export interface CopyComicCanvasNodeToMainRequest extends ComicCanvasIdentityRequest {
    readonly nodeId: string;
    readonly expectedRevision: number;
    readonly expectedMainRevision: number;
}
export interface CopyComicCanvasNodeToMainResult {
    readonly state: DesktopComicCanvasState;
    readonly nodeId: string;
    readonly placement: 'rightOfContent';
    readonly position: CanvasPoint;
}
export interface ComicOrganizerService {
    listComicFolders(): Promise<readonly ComicProjectFolder[]>;
    createComicFolder(request: ComicFolderRequest): Promise<readonly ComicProjectFolder[]>;
    renameComicFolder(request: RenameComicFolderRequest): Promise<readonly ComicProjectFolder[]>;
    deleteComicFolder(request: { readonly folderId: string }): Promise<readonly ComicProjectFolder[]>;
    patchComicProjectMetadata(request: ComicProjectMetadataRequest): Promise<DesktopComicProjectState>;
    getComicProjectCoverCandidates(workspaceRoot: string): Promise<readonly ComicProjectCoverCandidate[]>;
    duplicateComicLibraryProject(request: DuplicateComicLibraryProjectRequest): Promise<DuplicateComicLibraryProjectResult>;
    listComicCanvases(workspaceRoot: string): Promise<CanvasRegistry>;
    createComicCanvas(request: CreateComicCanvasRequest): Promise<CanvasRegistry>;
    renameComicCanvas(request: RenameComicCanvasRequest): Promise<CanvasRegistry>;
    setComicCanvasOpen(request: OpenComicCanvasRequest): Promise<CanvasRegistry>;
    orderComicCanvases(request: OrderComicCanvasesRequest): Promise<CanvasRegistry>;
    deleteComicCanvas(request: ComicCanvasIdentityRequest): Promise<DeleteComicCanvasResult>;
    finalizeDeleteComicCanvas(request: ComicCanvasIdentityRequest): Promise<CanvasRegistry>;
    cancelDeleteComicCanvas(request: ComicCanvasIdentityRequest): Promise<CanvasRegistry>;
    copyComicCanvasNodeToMain(request: CopyComicCanvasNodeToMainRequest): Promise<CopyComicCanvasNodeToMainResult>;
}
