import type { ComicEditorEdit, ComicProject } from '@nextmux/comic-core';
import type { CanvasTimelineDocument, CanvasTimelineSummary } from '@nextmux/comic-core/canvas-timeline';
export type { CanvasTimelineDocument, CanvasTimelineSummary };
export interface CreateComicCanvasTimelineRequest {
    readonly workspaceRoot: string; readonly canvasId: string; readonly expectedCanvasRevision: number;
    /** Stable across RPC retries. A new intent requires a new request id. */
    readonly requestId: string; readonly paths?: readonly (readonly string[])[]; readonly title?: string;
    /** Explicit one-time copy of the pre-canvas editor, preserving its cuts; never deletes the source. */
    readonly importLegacyEdit?: boolean;
}
export interface ApplyComicCanvasTimelineEditsRequest {
    readonly workspaceRoot: string; readonly timelineId: string; readonly expectedRevision: number;
    readonly edits: readonly ComicEditorEdit[]; readonly locale?: string;
}
export interface RestoreComicCanvasTimelineRequest {
    readonly workspaceRoot: string; readonly timelineId: string; readonly expectedRevision: number; readonly project: ComicProject;
}
export interface ComicCanvasTimelineEditResult { readonly timeline: CanvasTimelineDocument; readonly createdShotIds: readonly string[] }
