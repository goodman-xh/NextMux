/**
 * Shared data model, deterministic content digest, capability-gated delta-sync state machine,
 * and Markdown serialization helpers for NextMux conversation sticky notes ("Note · this conversation").
 */

export const THREAD_NOTE_MAX_LENGTH = 20_000;
export const THREAD_NOTE_MAX_IMAGES = 12;
export const THREAD_NOTE_IMAGE_ID_PREFIX = 'thread-note-img:';

export interface ThreadNoteImageItem {
    readonly id: string;
    readonly name: string;
    readonly mimeType: string;
    readonly dataUrl: string;
    readonly filePath?: string;
    readonly createdAt: number;
}

export interface ThreadNoteState {
    readonly text: string;
    readonly images: readonly ThreadNoteImageItem[];
    readonly modelReadable: boolean;
    readonly digest: string;
    readonly updatedAt: number;
    /** Monotonically increasing counter incremented every time `modelReadable` transitions `false -> true`. */
    readonly readableCycleId?: number;
}

export interface ThreadNoteSyncDecision {
    /**
     * 'disabled' when modelReadable is false;
     * 'inject_initial' when first checked (or re-checked after unchecking);
     * 'inject_updated' when digest changed since lastDeliveredDigest;
     * 'unchanged' when modelReadable is true and digest === lastDeliveredDigest within the same readableCycleId;
     * 'empty' when note has no content and no images.
     */
    readonly action: 'disabled' | 'empty' | 'inject_initial' | 'inject_updated' | 'unchanged';
    readonly nextDeliveredDigest: string | undefined;
    readonly nextDeliveredImageIds: readonly string[];
    readonly nextDeliveredReadableCycleId?: number;
    /** Formatted XML block `<conversation_note status="initial|updated" digest="..." path="...">...</conversation_note>` when action is 'inject_initial' or 'inject_updated', otherwise undefined. */
    readonly promptBlock?: string;
    /** Only newly added images not in previousDeliveredImageIds when action is 'inject_initial' or 'inject_updated'. */
    readonly newImages: readonly ThreadNoteImageItem[];
    /** System/runtime instruction line telling the model whether the sticky note is disabled, already up-to-date in context (do NOT poll/re-read), or newly synced. */
    readonly systemNotice: string;
}

export interface ResolveThreadNotePromptSyncOptions {
    readonly state?: Partial<ThreadNoteState> | null;
    readonly text?: string;
    readonly images?: readonly ThreadNoteImageItem[];
    readonly modelReadable?: boolean;
    readonly digest?: string;
    readonly readableCycleId?: number;
    readonly lastDeliveredDigest?: string | null;
    readonly previousDeliveredDigest?: string | null;
    readonly previousDeliveredImageIds?: readonly string[] | null;
    readonly lastDeliveredImageIds?: readonly string[] | null;
    readonly lastDeliveredReadableCycleId?: number | null;
    readonly previousDeliveredReadableCycleId?: number | null;
    readonly notesFilePath?: string;
    readonly filePath?: string;
    /** Identifies whose note this is (e.g. the conversation id) when the note has no file; scopes the remembered cycle. */
    readonly scope?: string;
}

/**
 * Returns true when the sticky note text contains real user content (not empty and not just untouched "1. " list markers).
 */
export function hasThreadNoteContent(value: string | null | undefined): boolean {
    const trimmed = (value || '').trim();
    if (!trimmed) {
        return false;
    }
    return !/^(?:\d+\.\s*)+$/.test(trimmed);
}

/**
 * Normalizes sticky note text for digest computation and persistence.
 */
export function normalizeThreadNoteText(value: string | null | undefined): string {
    if (!hasThreadNoteContent(value)) {
        return '';
    }
    return String(value || '').replace(/\r\n/g, '\n').slice(0, THREAD_NOTE_MAX_LENGTH).trimEnd();
}

/**
 * Deterministic 128-bit hash (32 hex characters) that runs identically in the browser and in Node: four
 * independently seeded 32-bit FNV-1a lanes with a murmur3 finalizer. Plain 32-bit integer arithmetic keeps a
 * 20 000-character note in the sub-millisecond range; image payloads are sampled (imagePayloadFingerprint).
 */
function hash128Hex(input: string): string {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9, c = 0x85ebca6b, d = 0xc2b2ae35;
    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193);
        b = Math.imul(b ^ code, 0x01000193) ^ (b >>> 15);
        c = Math.imul(c ^ (code + i), 0x0100019d);
        d = Math.imul(d ^ ((code << 7) | (code >>> 9)), 0x01000193);
    }
    const finish = (value: number, salt: number): string => {
        let h = (value ^ salt ^ input.length) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        return ((h ^ (h >>> 16)) >>> 0).toString(16).padStart(8, '0');
    };
    return finish(a, 0x27d4eb2f) + finish(b, 0x165667b1) + finish(c, 0x9e3779b1) + finish(d, 0x85ebca77);
}

/**
 * A pasted image never changes under its id, so its fingerprint hashes the metadata, the length and an evenly
 * spread sample of the payload (head, tail and 64 slices) instead of every base64 character.
 */
function imagePayloadFingerprint(payload: string): string {
    if (payload.length <= 8_192) return hash128Hex(payload);
    const parts = [payload.slice(0, 2_048), payload.slice(-2_048)];
    const stride = Math.floor((payload.length - 4_096) / 64);
    for (let i = 0; i < 64; i++) {
        const start = 2_048 + i * stride;
        parts.push(payload.slice(start, start + 32));
    }
    return hash128Hex(parts.join('|'));
}

/**
 * Computes a deterministic hex digest over the normalized note text and ordered image items.
 * Supports both `computeThreadNoteDigest(text, images)` and `computeThreadNoteDigest(state)`.
 */
export function computeThreadNoteDigest(
    textOrState: string | { readonly text?: string | null; readonly images?: readonly Partial<ThreadNoteImageItem>[] | null } | null | undefined,
    imagesArg?: readonly Partial<ThreadNoteImageItem>[] | null
): string {
    const rawText = typeof textOrState === 'string'
        ? textOrState
        : (textOrState && typeof textOrState === 'object' ? (textOrState.text ?? '') : '');
    const rawImages = typeof textOrState === 'string'
        ? (imagesArg ?? [])
        : (textOrState && typeof textOrState === 'object' ? (textOrState.images ?? imagesArg ?? []) : (imagesArg ?? []));

    const normalizedText = normalizeThreadNoteText(rawText);
    const safeImages = Array.isArray(rawImages) ? rawImages : [];
    if (!normalizedText && safeImages.length === 0) {
        return '';
    }

    const parts: string[] = [`text:${normalizedText.length}:${normalizedText}`];
    for (let i = 0; i < safeImages.length; i++) {
        const img = safeImages[i];
        if (!img) {
            continue;
        }
        const id = String(img.id || '');
        const name = String(img.name || '');
        const mimeType = String(img.mimeType || '');
        const dataUrl = String(img.dataUrl || '');
        const filePath = String(img.filePath || '');
        const dataHash = imagePayloadFingerprint(dataUrl || filePath);
        parts.push(`img[${i}]:${id}|${name}|${mimeType}|${filePath}|${dataUrl.length}:${dataHash}`);
    }
    return hash128Hex(parts.join('\u0000'));
}

export function createThreadNoteState(input?: {
    readonly text?: string | null;
    readonly images?: readonly ThreadNoteImageItem[] | null;
    readonly modelReadable?: boolean | null;
    readonly updatedAt?: number | null;
    readonly readableCycleId?: number | null;
}): ThreadNoteState {
    const text = normalizeThreadNoteText(input?.text);
    const images = Array.isArray(input?.images)
        ? input!.images.filter((item): item is ThreadNoteImageItem => Boolean(item && typeof item.id === 'string' && (item.dataUrl || item.filePath))).slice(0, THREAD_NOTE_MAX_IMAGES)
        : [];
    const modelReadable = Boolean(input?.modelReadable);
    const digest = computeThreadNoteDigest(text, images);
    const updatedAt = typeof input?.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : 0;
    const readableCycleId = typeof input?.readableCycleId === 'number' && Number.isFinite(input.readableCycleId) && input.readableCycleId >= 0
        ? Math.floor(input.readableCycleId)
        : (modelReadable ? 1 : 0);
    return {
        text,
        images,
        modelReadable,
        digest,
        updatedAt,
        readableCycleId
    };
}

const NUMBERED_NOTE_LINE = /^([ \t]*)(\d{1,4})\.[ \t]+(.*)$/;

/**
 * Appends `incomingText` to `existingText` without overwriting existing content.
 * If `existingText` ends with a numbered list line (`1. ...`, `2. ...`), continues numbering (`${lastNumber + 1}. ...`).
 */
export function appendThreadNoteText(existingText: string | null | undefined, incomingText: string | null | undefined): string {
    const base = normalizeThreadNoteText(existingText);
    const incoming = normalizeThreadNoteText(incomingText);
    if (!incoming) {
        return base;
    }
    if (!base) {
        return incoming.slice(0, THREAD_NOTE_MAX_LENGTH);
    }
    const baseLines = base.split('\n');
    let lastMatch: RegExpExecArray | null = null;
    for (let i = baseLines.length - 1; i >= 0; i--) {
        if (baseLines[i].trim()) {
            lastMatch = NUMBERED_NOTE_LINE.exec(baseLines[i]);
            break;
        }
    }
    if (lastMatch) {
        const indent = lastMatch[1] || '';
        let nextNum = Number(lastMatch[2]);
        const incomingLines = incoming.split('\n');
        const formatted = incomingLines.map(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                return '';
            }
            const existingNumMatch = NUMBERED_NOTE_LINE.exec(line);
            const body = existingNumMatch && Number(existingNumMatch[2]) <= nextNum
                ? existingNumMatch[3].trim()
                : (existingNumMatch ? null : trimmed);
            if (body !== null) {
                nextNum += 1;
                return `${indent}${nextNum}. ${body}`;
            }
            nextNum = Number(existingNumMatch![2]);
            return line;
        }).filter((line, idx, arr) => line !== '' || (idx > 0 && idx < arr.length - 1));
        return `${base}\n${formatted.join('\n')}`.slice(0, THREAD_NOTE_MAX_LENGTH);
    }
    return `${base}\n${incoming}`.slice(0, THREAD_NOTE_MAX_LENGTH);
}

export function mergeThreadNoteUpdate(
    current: ThreadNoteState,
    update: {
        readonly text?: string;
        readonly images?: readonly ThreadNoteImageItem[];
        readonly modelReadable?: boolean;
        readonly mode?: 'append' | 'replace';
        readonly updatedAt?: number;
        readonly readableCycleId?: number;
    }
): ThreadNoteState {
    const mode = update.mode === 'replace' ? 'replace' : 'append';
    let nextText = current.text;
    if (update.text !== undefined) {
        if (mode === 'append') {
            nextText = appendThreadNoteText(current.text, update.text);
        } else {
            nextText = normalizeThreadNoteText(update.text);
        }
    }

    let nextImages = [...current.images];
    if (update.images !== undefined) {
        const normalizedIncoming: ThreadNoteImageItem[] = [];
        for (let i = 0; i < update.images.length; i++) {
            const item = update.images[i];
            if (!item || typeof item !== 'object') continue;
            const dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl : '';
            const filePath = typeof item.filePath === 'string' && item.filePath ? item.filePath : undefined;
            if (!dataUrl && !filePath) continue;
            const id = typeof item.id === 'string' && item.id
                ? item.id
                : `note-img-${hash128Hex(dataUrl || filePath || String(i)).slice(0, 12)}`;
            normalizedIncoming.push({
                id,
                name: typeof item.name === 'string' && item.name ? item.name : `image-${i + 1}.png`,
                mimeType: typeof item.mimeType === 'string' && item.mimeType ? item.mimeType : 'image/png',
                dataUrl,
                ...(filePath ? { filePath } : {}),
                createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
            });
        }
        nextImages = mode === 'replace'
            ? normalizedIncoming.slice(0, THREAD_NOTE_MAX_IMAGES)
            : [...current.images, ...normalizedIncoming.filter(img => !current.images.some(existing => existing.id === img.id))].slice(0, THREAD_NOTE_MAX_IMAGES);
    }

    const nextModelReadable = update.modelReadable !== undefined ? Boolean(update.modelReadable) : current.modelReadable;
    const prevCycle = typeof current.readableCycleId === 'number' && Number.isFinite(current.readableCycleId)
        ? current.readableCycleId
        : (current.modelReadable ? 1 : 0);
    let nextReadableCycleId: number;
    if (typeof update.readableCycleId === 'number' && Number.isFinite(update.readableCycleId)) {
        nextReadableCycleId = Math.max(0, Math.floor(update.readableCycleId));
    } else if (!current.modelReadable && nextModelReadable) {
        nextReadableCycleId = prevCycle + 1;
    } else if (nextModelReadable && prevCycle === 0) {
        nextReadableCycleId = 1;
    } else {
        nextReadableCycleId = prevCycle;
    }

    const digest = computeThreadNoteDigest(nextText, nextImages);
    const updatedAt = typeof update.updatedAt === 'number' && Number.isFinite(update.updatedAt) ? update.updatedAt : Date.now();
    return {
        text: nextText,
        images: nextImages,
        modelReadable: nextModelReadable,
        digest,
        updatedAt,
        readableCycleId: nextReadableCycleId
    };
}

function escapeXmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Note text is the user's own words: it may quote the block's tag, but it can never close the block early. */
function escapeNoteBlockBoundary(value: string): string {
    return value.replace(/<(\/?)(conversation_note)/gi, '&lt;$1$2');
}

function formatConversationNoteBlock(
    status: 'initial' | 'updated',
    digest: string,
    notesFilePath: string | undefined,
    text: string,
    images: readonly ThreadNoteImageItem[]
): string {
    // Only a note that really is a file names one; the desktop keeps notes in app storage, not in the project.
    const pathAttr = notesFilePath ? ` path="${escapeXmlAttr(notesFilePath)}"` : '';
    const bodyLines: string[] = [];
    if (text) {
        bodyLines.push(escapeNoteBlockBoundary(text));
    }
    if (images.length > 0) {
        if (bodyLines.length > 0) {
            bodyLines.push('');
        }
        // Pasted images have no file of their own: name them so the model can match them to the attached images.
        bodyLines.push(`Sticky-note images (${images.length}), attached as images named ${THREAD_NOTE_IMAGE_ID_PREFIX}…:`);
        images.forEach((img, index) => {
            const name = escapeNoteBlockBoundary(escapeMarkdownAlt(img.name || `image-${index + 1}.png`));
            bodyLines.push(img.filePath ? `- ${name} (${escapeNoteBlockBoundary(img.filePath)})` : `- ${name}`);
        });
    }
    return `<conversation_note status="${status}" digest="${escapeXmlAttr(digest)}"${pathAttr}>\n${bodyLines.join('\n')}\n</conversation_note>`;
}

/**
 * Tracks the last delivered `readableCycleId` per content digest so that even if a caller only passes
 * `lastDeliveredDigest` (and the user unchecked and re-checked `modelReadable` between turns without
 * an intermediate turn), `resolveThreadNotePromptSync` detects the new `readableCycleId` and triggers `'inject_initial'`.
 */
const lastDeliveredCycleByDigest = new Map<string, number>();
const LAST_DELIVERED_CYCLE_LIMIT = 256;

/** Scoped per note (its scope or file), so two conversations with identical notes never share a cycle. */
function deliveredCycleKey(scope: string | undefined, digest: string): string {
    return `${scope || ''}\u0000${digest}`;
}

function rememberDeliveredCycle(key: string, cycleId: number): void {
    lastDeliveredCycleByDigest.delete(key);
    lastDeliveredCycleByDigest.set(key, cycleId);
    // Every edit makes a new digest: keep only the most recent entries.
    while (lastDeliveredCycleByDigest.size > LAST_DELIVERED_CYCLE_LIMIT) {
        lastDeliveredCycleByDigest.delete(lastDeliveredCycleByDigest.keys().next().value!);
    }
}

/**
 * Capability-gated & delta-hash sync state machine for conversation sticky notes.
 *
 * Rules:
 * 1. If `modelReadable === false`: returns `action: 'disabled'`, `nextDeliveredDigest: undefined`.
 * 2. If `modelReadable === true` and note has no text and no images: returns `action: 'empty'`, `nextDeliveredDigest: undefined`.
 * 3. If `modelReadable === true` and (`lastDeliveredDigest === undefined` OR `readableCycleId` changed because the user unchecked & re-checked): returns `action: 'inject_initial'` with `<conversation_note status="initial" ...>` and `newImages`.
 * 4. If `modelReadable === true` and `lastDeliveredDigest === digest` within the same `readableCycleId`: returns `action: 'unchanged'` with no `promptBlock` and empty `newImages` (zero redundant re-read).
 * 5. If `modelReadable === true` and `lastDeliveredDigest !== digest` within the same `readableCycleId`: returns `action: 'inject_updated'` with `<conversation_note status="updated" ...>` and only newly added images.
 */
export function resolveThreadNotePromptSync(
    stateOrOptions: ThreadNoteState | ResolveThreadNotePromptSyncOptions | null | undefined,
    lastDeliveredDigestOrOptions?: string | null | {
        readonly lastDeliveredDigest?: string | null;
        readonly previousDeliveredDigest?: string | null;
        readonly previousDeliveredImageIds?: readonly string[] | null;
        readonly lastDeliveredImageIds?: readonly string[] | null;
        readonly lastDeliveredReadableCycleId?: number | null;
        readonly previousDeliveredReadableCycleId?: number | null;
        readonly notesFilePath?: string;
        readonly filePath?: string;
    },
    previousDeliveredImageIdsArg?: readonly string[] | null,
    notesFilePathArg?: string
): ThreadNoteSyncDecision {
    let rawState: Partial<ThreadNoteState> | undefined;
    let lastDeliveredDigest: string | undefined;
    let previousDeliveredImageIds: readonly string[] = [];
    let explicitLastCycleId: number | undefined;
    let notesFilePath: string | undefined;
    let scope: string | undefined;

    if (stateOrOptions && typeof stateOrOptions === 'object' && ('state' in stateOrOptions || 'lastDeliveredDigest' in stateOrOptions || 'previousDeliveredDigest' in stateOrOptions || 'previousDeliveredImageIds' in stateOrOptions || 'notesFilePath' in stateOrOptions || 'lastDeliveredReadableCycleId' in stateOrOptions || 'previousDeliveredReadableCycleId' in stateOrOptions)) {
        const opts = stateOrOptions as ResolveThreadNotePromptSyncOptions;
        rawState = opts.state ?? {
            text: opts.text,
            images: opts.images,
            modelReadable: opts.modelReadable,
            digest: opts.digest,
            readableCycleId: opts.readableCycleId
        };
        const rawPrevDigest = opts.lastDeliveredDigest ?? opts.previousDeliveredDigest;
        lastDeliveredDigest = typeof rawPrevDigest === 'string' && rawPrevDigest.length > 0 ? rawPrevDigest : undefined;
        previousDeliveredImageIds = opts.previousDeliveredImageIds ?? opts.lastDeliveredImageIds ?? [];
        const rawPrevCycle = opts.lastDeliveredReadableCycleId ?? opts.previousDeliveredReadableCycleId;
        explicitLastCycleId = typeof rawPrevCycle === 'number' && Number.isFinite(rawPrevCycle) ? rawPrevCycle : undefined;
        notesFilePath = opts.notesFilePath ?? opts.filePath;
        scope = opts.scope;
    } else {
        rawState = (stateOrOptions as Partial<ThreadNoteState> | null | undefined) ?? undefined;
        if (typeof lastDeliveredDigestOrOptions === 'string') {
            lastDeliveredDigest = lastDeliveredDigestOrOptions.length > 0 ? lastDeliveredDigestOrOptions : undefined;
            previousDeliveredImageIds = previousDeliveredImageIdsArg ?? [];
            notesFilePath = notesFilePathArg;
        } else if (lastDeliveredDigestOrOptions && typeof lastDeliveredDigestOrOptions === 'object') {
            const rawPrevDigest = lastDeliveredDigestOrOptions.lastDeliveredDigest ?? lastDeliveredDigestOrOptions.previousDeliveredDigest;
            lastDeliveredDigest = typeof rawPrevDigest === 'string' && rawPrevDigest.length > 0 ? rawPrevDigest : undefined;
            previousDeliveredImageIds = lastDeliveredDigestOrOptions.previousDeliveredImageIds ?? lastDeliveredDigestOrOptions.lastDeliveredImageIds ?? previousDeliveredImageIdsArg ?? [];
            const rawPrevCycle = lastDeliveredDigestOrOptions.lastDeliveredReadableCycleId ?? lastDeliveredDigestOrOptions.previousDeliveredReadableCycleId;
            explicitLastCycleId = typeof rawPrevCycle === 'number' && Number.isFinite(rawPrevCycle) ? rawPrevCycle : undefined;
            notesFilePath = lastDeliveredDigestOrOptions.notesFilePath ?? lastDeliveredDigestOrOptions.filePath ?? notesFilePathArg;
        } else {
            lastDeliveredDigest = undefined;
            previousDeliveredImageIds = previousDeliveredImageIdsArg ?? [];
            notesFilePath = notesFilePathArg;
        }
    }

    const modelReadable = Boolean(rawState?.modelReadable);
    if (!modelReadable) {
        if (lastDeliveredDigest) {
            lastDeliveredCycleByDigest.delete(deliveredCycleKey(scope ?? notesFilePath, lastDeliveredDigest));
        }
        return {
            action: 'disabled',
            nextDeliveredDigest: undefined,
            nextDeliveredImageIds: [],
            nextDeliveredReadableCycleId: undefined,
            promptBlock: undefined,
            newImages: [],
            systemNotice: 'The user has turned off "Model can read" for this conversation\'s sticky note. Do not read or refer to the note; write to it only when the user explicitly asks (nextmux.notes.write).'
        };
    }

    const normalizedText = normalizeThreadNoteText(rawState?.text);
    const images: readonly ThreadNoteImageItem[] = Array.isArray(rawState?.images) ? rawState!.images : [];
    const digest = computeThreadNoteDigest(normalizedText, images);

    if (!digest || (!normalizedText && images.length === 0)) {
        return {
            action: 'empty',
            nextDeliveredDigest: undefined,
            nextDeliveredImageIds: [],
            nextDeliveredReadableCycleId: undefined,
            promptBlock: undefined,
            newImages: [],
            systemNotice: 'This conversation\'s sticky note may be read by the model, but it is empty. Do not call nextmux.notes.read.'
        };
    }

    const currentCycleId = typeof rawState?.readableCycleId === 'number' && Number.isFinite(rawState.readableCycleId) && rawState.readableCycleId > 0
        ? Math.floor(rawState.readableCycleId)
        : 1;
    const cycleKey = deliveredCycleKey(scope ?? notesFilePath, digest);
    const rememberedCycleId = explicitLastCycleId ?? lastDeliveredCycleByDigest.get(cycleKey);
    const cycleReEnabled = Boolean(
        lastDeliveredDigest && (
            (explicitLastCycleId !== undefined && explicitLastCycleId !== currentCycleId) ||
            (explicitLastCycleId === undefined && rememberedCycleId !== undefined && rememberedCycleId !== currentCycleId) ||
            (explicitLastCycleId === undefined && rememberedCycleId === undefined && currentCycleId > 1)
        )
    );

    const nextDeliveredImageIds = images.map(img => img.id);

    if (lastDeliveredDigest && lastDeliveredDigest === digest && !cycleReEnabled) {
        rememberDeliveredCycle(cycleKey, currentCycleId);
        return {
            action: 'unchanged',
            nextDeliveredDigest: digest,
            nextDeliveredImageIds,
            nextDeliveredReadableCycleId: currentCycleId,
            promptBlock: undefined,
            newImages: [],
            systemNotice: `This conversation's sticky note (digest=${digest}) is unchanged and already in your context. Do not call nextmux.notes.read to check it again.`
        };
    }

    const isInitial = !lastDeliveredDigest || cycleReEnabled;
    const action = isInitial ? 'inject_initial' : 'inject_updated';
    const status = isInitial ? 'initial' : 'updated';
    const previousImageIdSet = new Set(previousDeliveredImageIds);
    const newImages = isInitial
        ? [...images]
        : images.filter(img => !previousImageIdSet.has(img.id));

    rememberDeliveredCycle(cycleKey, currentCycleId);

    const promptBlock = formatConversationNoteBlock(status, digest, notesFilePath, normalizedText, images);
    const systemNotice = isInitial
        ? `The user turned on "Model can read" for this conversation's sticky note (digest=${digest}); its content is in <conversation_note status="initial">. Do not call nextmux.notes.read unless the note changes.`
        : `This conversation's sticky note changed (digest=${digest}); its latest content is in <conversation_note status="updated">. Use it; do not call nextmux.notes.read.`;

    return {
        action,
        nextDeliveredDigest: digest,
        nextDeliveredImageIds,
        nextDeliveredReadableCycleId: currentCycleId,
        promptBlock,
        newImages,
        systemNotice
    };
}

const CONVERSATION_NOTE_BLOCK_REGEX = /<conversation_note\b[^>]*>[\s\S]*?<\/conversation_note>[ \t]*\n?/gi;

/**
 * Strips any previously injected `<conversation_note ...>...</conversation_note>` XML blocks from a message text.
 * Used when `modelReadable === false` so historical note snapshots are also hidden from the model.
 */
export function stripConversationNoteBlocksFromText(text: string): string {
    if (!text || !text.includes('<conversation_note')) {
        return text;
    }
    const stripped = text.replace(CONVERSATION_NOTE_BLOCK_REGEX, '');
    return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

export function isThreadNoteImageAttachmentId(id: string | null | undefined): boolean {
    return typeof id === 'string' && id.startsWith(THREAD_NOTE_IMAGE_ID_PREFIX);
}

export function toThreadNoteImageAttachmentId(imageId: string): string {
    return imageId.startsWith(THREAD_NOTE_IMAGE_ID_PREFIX) ? imageId : `${THREAD_NOTE_IMAGE_ID_PREFIX}${imageId}`;
}

function escapeMarkdownAlt(name: string): string {
    return (name || 'image.png').replace(/[\[\]\r\n]/g, ' ').trim() || 'image.png';
}

/**
 * Serializes a `ThreadNoteState` to a clean Markdown string containing the note text and `![name](dataUrl_or_path)` images.
 */
export function serializeNoteToMarkdown(
    state: Pick<ThreadNoteState, 'text' | 'images'> | { readonly text?: string | null; readonly images?: readonly Partial<ThreadNoteImageItem>[] | null },
    _notesFilePath?: string
): string {
    const text = normalizeThreadNoteText(state?.text);
    const images = Array.isArray(state?.images) ? state.images : [];
    const imageLines: string[] = [];
    for (const img of images) {
        if (!img) {
            continue;
        }
        const ref = img.filePath || img.dataUrl;
        if (!ref) {
            continue;
        }
        imageLines.push(`![${escapeMarkdownAlt(img.name || 'image.png')}](${ref})`);
    }
    if (!text && imageLines.length === 0) {
        return '';
    }
    if (text && imageLines.length === 0) {
        return `${text}\n`;
    }
    if (!text) {
        return `${imageLines.join('\n')}\n`;
    }
    return `${text}\n\n${imageLines.join('\n')}\n`;
}

/**
 * Parses a Markdown sticky note file back into its plain note text and image references (`![name](ref)`).
 */
export function parseMarkdownNoteWithImages(markdown: string): {
    readonly text: string;
    readonly imageRefs: string[];
    readonly images: ThreadNoteImageItem[];
} {
    if (!markdown || typeof markdown !== 'string') {
        return { text: '', imageRefs: [], images: [] };
    }
    const normalized = markdown.replace(/\r\n/g, '\n');
    const imageRefs: string[] = [];
    const images: ThreadNoteImageItem[] = [];
    const keptLines: string[] = [];
    const lines = normalized.split('\n');
    const standaloneImageLine = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;
    const inlineImagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const standalone = standaloneImageLine.exec(line);
        if (standalone) {
            const name = standalone[1].trim() || `image-${images.length + 1}.png`;
            const ref = standalone[2].trim();
            if (ref) {
                imageRefs.push(ref);
                const isDataUrl = ref.startsWith('data:');
                const mimeMatch = /^data:([^;,]+)[;,]/.exec(ref);
                images.push({
                    id: `md-img-${images.length + 1}-${hash128Hex(ref).slice(0, 12)}`,
                    name,
                    mimeType: mimeMatch ? mimeMatch[1] : 'image/png',
                    dataUrl: isDataUrl ? ref : '',
                    filePath: isDataUrl ? undefined : ref,
                    createdAt: 0
                });
                continue;
            }
        }
        let match: RegExpExecArray | null;
        inlineImagePattern.lastIndex = 0;
        while ((match = inlineImagePattern.exec(line)) !== null) {
            const name = match[1].trim() || `image-${images.length + 1}.png`;
            const ref = match[2].trim();
            if (ref) {
                imageRefs.push(ref);
                const isDataUrl = ref.startsWith('data:');
                const mimeMatch = /^data:([^;,]+)[;,]/.exec(ref);
                images.push({
                    id: `md-img-${images.length + 1}-${hash128Hex(ref).slice(0, 12)}`,
                    name,
                    mimeType: mimeMatch ? mimeMatch[1] : 'image/png',
                    dataUrl: isDataUrl ? ref : '',
                    filePath: isDataUrl ? undefined : ref,
                    createdAt: 0
                });
            }
        }
        keptLines.push(line);
    }

    const rawText = keptLines.join('\n').trimEnd();
    return {
        text: normalizeThreadNoteText(rawText),
        imageRefs,
        images
    };
}
