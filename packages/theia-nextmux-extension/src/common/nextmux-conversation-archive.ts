export const CONVERSATION_ARCHIVE_FORMAT = 'nextmux-conversation-archive' as const;
export const CONVERSATION_ARCHIVE_VERSION = 1 as const;
export const CONVERSATION_ARCHIVE_PROJECT_VERSION = 2 as const;
/** Adds portable, content-addressed assistant image/audio output references. */
export const CONVERSATION_ARCHIVE_OUTPUT_ASSET_VERSION = 3 as const;
export const CONVERSATION_ARCHIVE_MAX_PROJECTS = 128;
export const CONVERSATION_ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
/** Conversation count is bounded by the archive byte/attachment safeguards, not an arbitrary row count. */
export const CONVERSATION_ARCHIVE_MAX_CONVERSATIONS = Number.MAX_SAFE_INTEGER;
export const CONVERSATION_ARCHIVE_ATTACHMENT_MAX_BYTES = 24 * 1024 * 1024;
export const CONVERSATION_ARCHIVE_ATTACHMENTS_MAX_BYTES = 64 * 1024 * 1024;
export const CONVERSATION_ARCHIVE_MAX_ATTACHMENTS = 2_000;

/** Display grouping only; this is not an application-wide project identity or a path. */
export interface ConversationArchiveProject {
    readonly ref: string;
    readonly label: string;
}

export interface ConversationArchiveExportOptions {
    /** Explicit opt-in. Unlisted conversations have no project label. */
    readonly projects?: readonly { readonly label: string; readonly sessionIds: readonly string[] }[];
}

export interface ConversationArchiveProjectBinding {
    readonly projectRef: string;
    /** Local picker result, never a field in the exported archive. Null means owned fallback. */
    readonly directoryUri: string | null;
}

export interface ConversationArchiveProjectPreview extends ConversationArchiveProject {
    readonly conversations: number;
    readonly binding: { readonly kind: 'owned_workspace' } | {
        readonly kind: 'local_directory';
        readonly directoryUri: string;
        readonly directoryPath: string;
    };
}

export interface ArchiveAttachmentSource {
    readonly id: string;
    readonly uri: string;
    readonly name: string;
    readonly kind: 'text' | 'image' | 'file';
    readonly size?: number;
    readonly mimeType?: string;
    readonly inlineReference?: string;
    readonly workspaceRelativePath?: string;
}

export interface ConversationArchivePreview {
    readonly previewId: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly conversations: readonly {
        readonly id: string;
        readonly title: string;
        readonly titleOrigin?: 'default' | 'draft' | 'recoveredDraft';
        readonly turns: number;
        readonly attachments: number;
        readonly conflict: boolean;
        readonly copyId: string;
        readonly copyConflict: boolean;
        readonly projectRef?: string;
    }[];
    readonly projects?: readonly ConversationArchiveProjectPreview[];
    readonly attachments: number;
    readonly attachmentBytes: number;
    readonly warnings: readonly string[];
}

export interface ConversationArchiveExportResult {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly conversations: number;
    readonly attachments: number;
    readonly warnings: readonly string[];
}

export interface ConversationArchiveImportResult {
    readonly imported: number;
    readonly skipped: number;
    readonly idMap: Readonly<Record<string, string>>;
    readonly conversations: number;
    /** Successfully committed new bindings only. The UI may open these roots after import. */
    readonly boundDirectories?: readonly string[];
}
