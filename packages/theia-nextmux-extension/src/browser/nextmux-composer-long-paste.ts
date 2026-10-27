import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

export const LONG_PASTE_CHARACTER_THRESHOLD = 1_000;
export const LONG_PASTE_LINE_THRESHOLD = 20;
export const LONG_PASTE_BYTE_THRESHOLD = 4 * 1024;

export type ComposerAttachmentTextKey = 'maxAttachments' | 'pastedText' | 'persistFailed' | 'prepareFailed';

const composerAttachmentCatalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<ComposerAttachmentTextKey, string>>>> = {
    'zh-CN': {
        maxAttachments: '每次任务最多添加 20 个附件。',
        pastedText: '粘贴文本',
        persistFailed: '无法保存粘贴的长文本，本次仍保留在内存中。',
        prepareFailed: '无法准备附件，请重试。'
    },
    'zh-TW': {
        maxAttachments: '每次工作最多新增 20 個附件。',
        pastedText: '貼上文字',
        persistFailed: '無法儲存貼上的長文字；本次內容仍保留在記憶體中。',
        prepareFailed: '無法準備附件，請再試一次。'
    },
    en: {
        maxAttachments: 'Up to 20 attachments can be added to each task.',
        pastedText: 'Pasted text',
        persistFailed: 'The pasted text could not be saved; it remains available for this message.',
        prepareFailed: 'The attachments could not be prepared. Try again.'
    },
    ja: {
        maxAttachments: '1 件のタスクに追加できる添付ファイルは 20 個までです。',
        pastedText: '貼り付けたテキスト',
        persistFailed: '貼り付けた長文を保存できませんでした。このメッセージ内には保持されています。',
        prepareFailed: '添付ファイルを準備できませんでした。もう一度お試しください。'
    },
    ko: {
        maxAttachments: '작업마다 첨부 파일을 최대 20개까지 추가할 수 있습니다.',
        pastedText: '붙여넣은 텍스트',
        persistFailed: '붙여넣은 긴 텍스트를 저장하지 못했지만 이 메시지에는 유지됩니다.',
        prepareFailed: '첨부 파일을 준비하지 못했습니다. 다시 시도하세요.'
    },
    es: {
        maxAttachments: 'Se pueden añadir hasta 20 archivos adjuntos por tarea.',
        pastedText: 'Texto pegado',
        persistFailed: 'No se pudo guardar el texto pegado; permanece disponible en este mensaje.',
        prepareFailed: 'No se pudieron preparar los archivos adjuntos. Inténtalo de nuevo.'
    },
    fr: {
        maxAttachments: 'Chaque tâche peut contenir jusqu’à 20 pièces jointes.',
        pastedText: 'Texte collé',
        persistFailed: 'Le texte collé n’a pas pu être enregistré ; il reste disponible dans ce message.',
        prepareFailed: 'Impossible de préparer les pièces jointes. Réessayez.'
    },
    de: {
        maxAttachments: 'Pro Aufgabe können bis zu 20 Anhänge hinzugefügt werden.',
        pastedText: 'Eingefügter Text',
        persistFailed: 'Der eingefügte Text konnte nicht gespeichert werden und bleibt für diese Nachricht verfügbar.',
        prepareFailed: 'Die Anhänge konnten nicht vorbereitet werden. Versuche es erneut.'
    },
    'pt-BR': {
        maxAttachments: 'Cada tarefa pode ter até 20 anexos.',
        pastedText: 'Texto colado',
        persistFailed: 'Não foi possível salvar o texto colado; ele continua disponível nesta mensagem.',
        prepareFailed: 'Não foi possível preparar os anexos. Tente novamente.'
    },
    ru: {
        maxAttachments: 'К каждой задаче можно добавить до 20 вложений.',
        pastedText: 'Вставленный текст',
        persistFailed: 'Не удалось сохранить вставленный текст; он остаётся доступен в этом сообщении.',
        prepareFailed: 'Не удалось подготовить вложения. Повторите попытку.'
    },
    ar: {
        maxAttachments: 'يمكن إضافة ما يصل إلى 20 مرفقًا لكل مهمة.',
        pastedText: 'نص ملصق',
        persistFailed: 'تعذّر حفظ النص الملصق، لكنه ما زال متاحًا في هذه الرسالة.',
        prepareFailed: 'تعذّر تجهيز المرفقات. حاول مرة أخرى.'
    },
    hi: {
        maxAttachments: 'हर कार्य में अधिकतम 20 अटैचमेंट जोड़े जा सकते हैं।',
        pastedText: 'चिपकाया गया टेक्स्ट',
        persistFailed: 'चिपकाया गया लंबा टेक्स्ट सहेजा नहीं जा सका; यह इस संदेश में उपलब्ध है।',
        prepareFailed: 'अटैचमेंट तैयार नहीं किए जा सके। फिर से कोशिश करें।'
    }
};

function uncheckedComposerAttachmentText(locale: NextMuxDesktopLocale, key: ComposerAttachmentTextKey): string {
    return composerAttachmentCatalog[locale]?.[key] || composerAttachmentCatalog.en[key];
}

export interface PastedTextReference {
    readonly id: string;
    readonly ordinal: number;
    readonly name: string;
    readonly marker: string;
    readonly modelReference: string;
    readonly content?: string;
    readonly lineCount?: number;
    readonly charCount?: number;
    readonly sizeBytes?: number;
    readonly attachment?: {
        readonly uri: string;
        readonly size: number;
        readonly workspaceRelativePath?: string;
    };
}

export interface CreatePastedTextReferenceOptions {
    readonly id: string;
    readonly ordinal: number;
    readonly createdAt: Date;
    readonly content: string;
    readonly label?: string;
    readonly attachment?: PastedTextReference['attachment'];
}

export interface ComposerSelectionResult {
    readonly value: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
}

export interface ComposerAttachmentOrdinal {
    readonly id: string;
    readonly ordinal?: number;
}

/** Identity of the editable composer content; ignores async metadata enrichment. */
export function composerContentToken(
    ownerId: string,
    value: string,
    attachments: readonly ComposerAttachmentOrdinal[],
    pastedTextReferences: readonly ComposerAttachmentOrdinal[],
    editedAttachmentOrder: readonly string[]
): string {
    return JSON.stringify([
        ownerId,
        value,
        attachments.map(item => item.id),
        pastedTextReferences.map(item => item.id),
        editedAttachmentOrder
    ]);
}

/**
 * Merge ordinary files and inline long-text files into one deterministic
 * insertion order. `knownPastedTextIds` lets history editing remove a deleted
 * anchor instead of accidentally restoring its old attachment payload.
 */
export function mergeComposerAttachmentsByOrdinal<T extends ComposerAttachmentOrdinal>(
    ordinary: readonly T[],
    activePastedText: readonly T[],
    knownPastedTextIds: readonly string[] = []
): readonly T[] {
    const pastedIds = new Set(knownPastedTextIds);
    const byId = new Map<string, { readonly item: T; readonly sequence: number }>();
    let sequence = 0;
    for (const item of ordinary) {
        if (!item.id || pastedIds.has(item.id) || byId.has(item.id)) continue;
        byId.set(item.id, { item, sequence: sequence++ });
    }
    for (const item of activePastedText) {
        if (!item.id) continue;
        byId.set(item.id, { item, sequence: sequence++ });
    }
    return [...byId.values()]
        .sort((left, right) => {
            const leftOrdinal = Number.isSafeInteger(left.item.ordinal) ? Number(left.item.ordinal) : Number.MAX_SAFE_INTEGER;
            const rightOrdinal = Number.isSafeInteger(right.item.ordinal) ? Number(right.item.ordinal) : Number.MAX_SAFE_INTEGER;
            return leftOrdinal - rightOrdinal || left.sequence - right.sequence;
        })
        .map(entry => entry.item);
}

export function shouldExternalizePastedText(value: string): boolean {
    if (value.length >= LONG_PASTE_CHARACTER_THRESHOLD) return true;
    let lines = 1;
    for (let index = 0; index < value.length && lines < LONG_PASTE_LINE_THRESHOLD; index += 1) {
        if (value.charCodeAt(index) === 10) lines += 1;
    }
    if (lines >= LONG_PASTE_LINE_THRESHOLD) return true;
    return new TextEncoder().encode(value).byteLength >= LONG_PASTE_BYTE_THRESHOLD;
}

function compactTimestamp(value: Date): string {
    const valid = Number.isFinite(value.getTime()) ? value : new Date(0);
    return valid.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function safeReferencePart(value: string): string {
    const safe = value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (safe || 'text').slice(0, 12);
}

export function createPastedTextReference(options: CreatePastedTextReferenceOptions): PastedTextReference {
    const ordinal = Math.max(1, Math.trunc(options.ordinal) || 1);
    const referencePart = safeReferencePart(options.id);
    const name = `pasted-text-${compactTimestamp(options.createdAt)}-${String(ordinal).padStart(3, '0')}-${referencePart}.txt`;
    const label = options.label?.trim() || 'Pasted text';
    const marker = `⟦${label} ${ordinal} · ${name}⟧`;
    let lineCount = 1;
    for (let index = 0; index < options.content.length; index += 1) {
        if (options.content.charCodeAt(index) === 10) {
            lineCount += 1;
        }
    }
    const charCount = options.content.length;
    const sizeBytes = options.attachment?.size ?? new TextEncoder().encode(options.content).byteLength;
    return {
        id: options.id,
        ordinal,
        name,
        marker,
        modelReference: `[Attached text: ${name}]`,
        content: options.content,
        lineCount,
        charCount,
        sizeBytes,
        ...(options.attachment ? { attachment: options.attachment } : {})
    };
}

export function insertPastedTextReference(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    reference: PastedTextReference
): ComposerSelectionResult {
    const start = Math.max(0, Math.min(value.length, Math.trunc(selectionStart) || 0));
    const end = Math.max(start, Math.min(value.length, Math.trunc(selectionEnd) || start));
    const nextValue = `${value.slice(0, start)}${reference.marker}${value.slice(end)}`;
    const caret = start + reference.marker.length;
    return { value: nextValue, selectionStart: caret, selectionEnd: caret };
}

export function pastedTextReferencesInDocument(
    value: string,
    references: readonly PastedTextReference[]
): readonly PastedTextReference[] {
    return references
        .map(reference => ({ reference, index: value.indexOf(reference.marker) }))
        .filter((entry): entry is { readonly reference: PastedTextReference; readonly index: number } => entry.index >= 0)
        .sort((left, right) => left.index - right.index)
        .map(entry => entry.reference);
}

export function requireDurablePastedTextReferences(
    value: string,
    references: readonly PastedTextReference[]
): readonly PastedTextReference[] {
    const active = pastedTextReferencesInDocument(value, references);
    const pending = active.find(reference => !reference.attachment?.uri || reference.attachment.size < 1);
    if (pending) {
        throw new Error(`Pasted text ${pending.name} has not been saved as a durable attachment.`);
    }
    return active;
}

export function materializePastedTextPrompt(
    value: string,
    references: readonly PastedTextReference[]
): string {
    let materialized = value;
    for (const reference of pastedTextReferencesInDocument(value, references)) {
        materialized = materialized.split(reference.marker).join(reference.modelReference);
    }
    return materialized;
}

interface SerializedPastedTextReference {
    readonly id: string;
    readonly ordinal: number;
    readonly name: string;
    readonly marker: string;
    readonly modelReference: string;
    readonly lineCount?: number;
    readonly charCount?: number;
    readonly sizeBytes?: number;
    readonly attachment: NonNullable<PastedTextReference['attachment']>;
}

export function serializePastedTextReferences(references: readonly PastedTextReference[]): string {
    const durable: SerializedPastedTextReference[] = references.flatMap(reference => reference.attachment ? [{
        id: reference.id,
        ordinal: reference.ordinal,
        name: reference.name,
        marker: reference.marker,
        modelReference: reference.modelReference,
        ...(typeof reference.lineCount === 'number' ? { lineCount: reference.lineCount } : {}),
        ...(typeof reference.charCount === 'number' ? { charCount: reference.charCount } : {}),
        ...(typeof reference.sizeBytes === 'number' ? { sizeBytes: reference.sizeBytes } : {}),
        attachment: reference.attachment
    }] : []);
    return JSON.stringify(durable);
}

export function deserializePastedTextReferences(value: string): readonly PastedTextReference[] {
    if (!value.trim()) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).flatMap(candidate => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const record = candidate as Partial<SerializedPastedTextReference>;
        if (typeof record.id !== 'string' || !record.id || record.id.length > 200
            || typeof record.ordinal !== 'number' || !Number.isSafeInteger(record.ordinal) || record.ordinal < 1
            || typeof record.name !== 'string' || !record.name.endsWith('.txt') || record.name.length > 240
            || typeof record.marker !== 'string' || !record.marker || record.marker.length > 500
            || typeof record.modelReference !== 'string' || !record.modelReference || record.modelReference.length > 500
            || !record.attachment || typeof record.attachment.uri !== 'string' || !record.attachment.uri
            || typeof record.attachment.size !== 'number' || !Number.isSafeInteger(record.attachment.size)
            || record.attachment.size < 1 || record.attachment.size > 24 * 1024 * 1024
            || record.attachment.workspaceRelativePath !== undefined
                && (typeof record.attachment.workspaceRelativePath !== 'string'
                    || !/^\.nextmux\/conversation-attachments\/[a-f0-9]{64}(?:-[0-9a-f-]{36})?\.[a-z0-9]{1,12}$/i.test(record.attachment.workspaceRelativePath))) return [];
        return [{
            id: record.id,
            ordinal: record.ordinal,
            name: record.name,
            marker: record.marker,
            modelReference: record.modelReference,
            ...(typeof record.lineCount === 'number' && Number.isSafeInteger(record.lineCount) && record.lineCount >= 1
                ? { lineCount: record.lineCount } : {}),
            ...(typeof record.charCount === 'number' && Number.isSafeInteger(record.charCount) && record.charCount >= 0
                ? { charCount: record.charCount } : {}),
            ...(typeof record.sizeBytes === 'number' && Number.isSafeInteger(record.sizeBytes) && record.sizeBytes >= 1
                ? { sizeBytes: record.sizeBytes } : {}),
            attachment: {
                uri: record.attachment.uri,
                size: record.attachment.size,
                ...(record.attachment.workspaceRelativePath
                    ? { workspaceRelativePath: record.attachment.workspaceRelativePath } : {})
            }
        }];
    });
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function composerAttachmentText(locale: Parameters<typeof uncheckedComposerAttachmentText>[0], key: Parameters<typeof uncheckedComposerAttachmentText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedComposerAttachmentText>>): string {
    return totalCopy(locale, key, language => uncheckedComposerAttachmentText(language, key, ...rest));
}

export {
    type AtomicPastedTextDeletionResult,
    type ComposerBusyRunState,
    type ComposerOverlaySegment,
    type MarkdownLinkOverlayRange,
    type PastedTextChipSummary,
    type PastedTextMarkerRange,
    type PastedTextMessageChipProps,
    type UserMessageAttachmentHint,
    type UserMessagePastedSegment,
    PastedTextMessageChip,
    composerOverlaySegments,
    countPastedTextLines,
    findPastedTextMarkerRanges,
    formatByteSizeCompact,
    formatFollowUpQueueStatusBadge,
    formatPastedTextChipSummary,
    formatPastedTextModelPayload,
    parseUserPromptPastedSegments,
    removeAdjacentPastedTextMarker,
    removePastedTextReferenceById,
    resolvePastedReferenceFilePath,
    shouldEnqueueComposerSubmissionWhileBusy,
    stripAnsiEscapeCodes
} from './nextmux-composer-paste-queue';

