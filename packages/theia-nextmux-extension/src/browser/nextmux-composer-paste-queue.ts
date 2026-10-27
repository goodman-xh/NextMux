import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import {
    type PastedTextReference,
    pastedTextReferencesInDocument
} from './nextmux-composer-long-paste';

interface PasteQueueLocaleEntry {
    readonly chipTitle: (ordinal: number, lineCount: number) => string;
    readonly chipSubtitle: (lineCount: number, charCount: number, compactSize: string) => string;
    readonly previewShow: string;
    readonly previewHide: string;
    readonly openFile: string;
    readonly loadingFile: string;
    readonly queueDispatching: string;
    readonly queueWaiting: string;
}

const PASTE_QUEUE_LOCALE_CATALOG: Readonly<Record<NextMuxDesktopLocale, PasteQueueLocaleEntry>> = {
    'zh-CN': {
        chipTitle: (ordinal, lineCount) => `粘贴文本 #${ordinal} · ${lineCount} 行`,
        chipSubtitle: (lineCount, charCount, compactSize) => charCount > 0
            ? `${lineCount} 行 · ${charCount} 字 · ${compactSize}`
            : `${lineCount} 行 · ${compactSize}`,
        previewShow: '展开预览',
        previewHide: '收起预览',
        openFile: '打开文件',
        loadingFile: '正在读取粘贴文件…',
        queueDispatching: '正在自动发送下一条排队提示词…',
        queueWaiting: '排队中 · 等待当前回复完成后自动发送'
    },
    'zh-TW': {
        chipTitle: (ordinal, lineCount) => `貼上文字 #${ordinal} · ${lineCount} 行`,
        chipSubtitle: (lineCount, charCount, compactSize) => charCount > 0
            ? `${lineCount} 行 · ${charCount} 字 · ${compactSize}`
            : `${lineCount} 行 · ${compactSize}`,
        previewShow: '展開預覽',
        previewHide: '收起預覽',
        openFile: '開啟檔案',
        loadingFile: '正在讀取貼上檔案…',
        queueDispatching: '正在自動發送下一條排隊提示詞…',
        queueWaiting: '排隊中 · 等待目前回覆完成後自動發送'
    },
    en: {
        chipTitle: (ordinal, lineCount) => {
            const lineUnit = lineCount === 1 ? 'line' : 'lines';
            return `Pasted text #${ordinal} · ${lineCount} ${lineUnit}`;
        },
        chipSubtitle: (lineCount, charCount, compactSize) => {
            const lineUnit = lineCount === 1 ? 'line' : 'lines';
            return charCount > 0
                ? `${lineCount} ${lineUnit} · ${charCount} chars · ${compactSize}`
                : `${lineCount} ${lineUnit} · ${compactSize}`;
        },
        previewShow: 'Preview',
        previewHide: 'Hide preview',
        openFile: 'Open file',
        loadingFile: 'Loading pasted file…',
        queueDispatching: 'Sending next queued prompt…',
        queueWaiting: 'Queued · Will send automatically after current response finishes'
    },
    ja: {
        chipTitle: (ordinal, lineCount) => `貼り付けテキスト #${ordinal} · ${lineCount} 行`,
        chipSubtitle: (lineCount, charCount, compactSize) => charCount > 0
            ? `${lineCount} 行 · ${charCount} 文字 · ${compactSize}`
            : `${lineCount} 行 · ${compactSize}`,
        previewShow: 'プレビューを表示',
        previewHide: 'プレビューを隠す',
        openFile: 'ファイルを開く',
        loadingFile: '貼り付けファイルを読み込み中…',
        queueDispatching: '待機中の次のプロンプトを自動送信中…',
        queueWaiting: '待機中 · 現在の応答が完了したら自動送信されます'
    },
    ko: {
        chipTitle: (ordinal, lineCount) => `붙여넣은 텍스트 #${ordinal} · ${lineCount}줄`,
        chipSubtitle: (lineCount, charCount, compactSize) => charCount > 0
            ? `${lineCount}줄 · ${charCount}자 · ${compactSize}`
            : `${lineCount}줄 · ${compactSize}`,
        previewShow: '미리보기 펼치기',
        previewHide: '미리보기 접기',
        openFile: '파일 열기',
        loadingFile: '붙여넣은 파일 불러오는 중…',
        queueDispatching: '대기 중인 다음 프롬프트를 자동 전송 중…',
        queueWaiting: '대기 중 · 현재 응답이 끝나면 자동으로 전송됩니다'
    },
    es: {
        chipTitle: (ordinal, lineCount) => {
            const lineUnit = lineCount === 1 ? 'línea' : 'líneas';
            return `Texto pegado #${ordinal} · ${lineCount} ${lineUnit}`;
        },
        chipSubtitle: (lineCount, charCount, compactSize) => {
            const lineUnit = lineCount === 1 ? 'línea' : 'líneas';
            return charCount > 0
                ? `${lineCount} ${lineUnit} · ${charCount} caract. · ${compactSize}`
                : `${lineCount} ${lineUnit} · ${compactSize}`;
        },
        previewShow: 'Vista previa',
        previewHide: 'Ocultar vista previa',
        openFile: 'Abrir archivo',
        loadingFile: 'Cargando archivo pegado…',
        queueDispatching: 'Enviando el siguiente prompt en cola…',
        queueWaiting: 'En cola · Se enviará automáticamente al terminar la respuesta actual'
    },
    fr: {
        chipTitle: (ordinal, lineCount) => {
            const lineUnit = lineCount === 1 ? 'ligne' : 'lignes';
            return `Texte collé #${ordinal} · ${lineCount} ${lineUnit}`;
        },
        chipSubtitle: (lineCount, charCount, compactSize) => {
            const lineUnit = lineCount === 1 ? 'ligne' : 'lignes';
            return charCount > 0
                ? `${lineCount} ${lineUnit} · ${charCount} caract. · ${compactSize}`
                : `${lineCount} ${lineUnit} · ${compactSize}`;
        },
        previewShow: 'Aperçu',
        previewHide: 'Masquer l’aperçu',
        openFile: 'Ouvrir le fichier',
        loadingFile: 'Chargement du fichier collé…',
        queueDispatching: 'Envoi automatique du prochain prompt en file d’attente…',
        queueWaiting: 'En file d’attente · Envoi automatique à la fin de la réponse actuelle'
    },
    de: {
        chipTitle: (ordinal, lineCount) => {
            const lineUnit = lineCount === 1 ? 'Zeile' : 'Zeilen';
            return `Eingefügter Text #${ordinal} · ${lineCount} ${lineUnit}`;
        },
        chipSubtitle: (lineCount, charCount, compactSize) => {
            const lineUnit = lineCount === 1 ? 'Zeile' : 'Zeilen';
            return charCount > 0
                ? `${lineCount} ${lineUnit} · ${charCount} Zeichen · ${compactSize}`
                : `${lineCount} ${lineUnit} · ${compactSize}`;
        },
        previewShow: 'Vorschau',
        previewHide: 'Vorschau ausblenden',
        openFile: 'Datei öffnen',
        loadingFile: 'Eingefügte Datei wird geladen…',
        queueDispatching: 'Nächster eingereihter Prompt wird gesendet…',
        queueWaiting: 'In Warteschlange · Wird nach der aktuellen Antwort automatisch gesendet'
    },
    'pt-BR': {
        chipTitle: (ordinal, lineCount) => {
            const lineUnit = lineCount === 1 ? 'linha' : 'linhas';
            return `Texto colado #${ordinal} · ${lineCount} ${lineUnit}`;
        },
        chipSubtitle: (lineCount, charCount, compactSize) => {
            const lineUnit = lineCount === 1 ? 'linha' : 'linhas';
            return charCount > 0
                ? `${lineCount} ${lineUnit} · ${charCount} caract. · ${compactSize}`
                : `${lineCount} ${lineUnit} · ${compactSize}`;
        },
        previewShow: 'Visualizar',
        previewHide: 'Ocultar prévia',
        openFile: 'Abrir arquivo',
        loadingFile: 'Carregando arquivo colado…',
        queueDispatching: 'Enviando o próximo prompt da fila…',
        queueWaiting: 'Na fila · Será enviado automaticamente após a resposta atual'
    },
    ru: {
        chipTitle: (ordinal, lineCount) => `Вставленный текст #${ordinal} · ${lineCount} стр.`,
        chipSubtitle: (lineCount, charCount, compactSize) => charCount > 0
            ? `${lineCount} стр. · ${charCount} симв. · ${compactSize}`
            : `${lineCount} стр. · ${compactSize}`,
        previewShow: 'Предпросмотр',
        previewHide: 'Скрыть предпросмотр',
        openFile: 'Открыть файл',
        loadingFile: 'Загрузка вставленного файла…',
        queueDispatching: 'Отправка следующего запроса из очереди…',
        queueWaiting: 'В очереди · Отправится автоматически после завершения текущего ответа'
    },
    ar: {
        chipTitle: (ordinal, lineCount) => `نص ملصق #${ordinal} · ${lineCount} سطر`,
        chipSubtitle: (lineCount, charCount, compactSize) => charCount > 0
            ? `${lineCount} سطر · ${charCount} حرف · ${compactSize}`
            : `${lineCount} سطر · ${compactSize}`,
        previewShow: 'معاينة',
        previewHide: 'إخفاء المعاينة',
        openFile: 'فتح الملف',
        loadingFile: 'جارٍ تحميل الملف الملصق…',
        queueDispatching: 'جارٍ إرسال المطالبة التالية في قائمة الانتظار…',
        queueWaiting: 'في قائمة الانتظار · سيُرسل تلقائيًا بعد انتهاء الرد الحالي'
    },
    hi: {
        chipTitle: (ordinal, lineCount) => `पेस्ट किया गया टेक्स्ट #${ordinal} · ${lineCount} पंक्तियाँ`,
        chipSubtitle: (lineCount, charCount, compactSize) => charCount > 0
            ? `${lineCount} पंक्तियाँ · ${charCount} वर्ण · ${compactSize}`
            : `${lineCount} पंक्तियाँ · ${compactSize}`,
        previewShow: 'पूर्वावलोकन',
        previewHide: 'पूर्वावलोकन छिपाएँ',
        openFile: 'फ़ाइल खोलें',
        loadingFile: 'पेस्ट की गई फ़ाइल लोड हो रही है…',
        queueDispatching: 'कतार का अगला प्रॉम्प्ट भेजा जा रहा है…',
        queueWaiting: 'कतार में · वर्तमान उत्तर पूरा होने के बाद अपने आप भेजा जाएगा'
    }
};

function pasteQueueCopy(locale?: NextMuxDesktopLocale): PasteQueueLocaleEntry {
    if (!locale) {
        return PASTE_QUEUE_LOCALE_CATALOG['zh-CN'];
    }
    return PASTE_QUEUE_LOCALE_CATALOG[locale] || PASTE_QUEUE_LOCALE_CATALOG.en;
}

export interface PastedTextChipSummary {
    readonly title: string;
    readonly subtitle: string;
    readonly inlineLabel: string;
    readonly lineCount: number;
    readonly charCount: number;
    readonly sizeBytes: number;
    readonly filePath: string;
}

export interface PastedTextMarkerRange {
    readonly start: number;
    readonly end: number;
    readonly marker: string;
    readonly reference?: PastedTextReference;
}

export interface AtomicPastedTextDeletionResult {
    readonly value: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
    readonly removedIds: readonly string[];
    readonly remainingReferences: readonly PastedTextReference[];
}

export interface MarkdownLinkOverlayRange {
    readonly start: number;
    readonly end: number;
    readonly labelStart: number;
    readonly labelEnd: number;
    readonly urlStart: number;
    readonly urlEnd: number;
}

export type ComposerOverlaySegment =
    | {
        readonly kind: 'text';
        readonly start: number;
        readonly end: number;
        readonly text: string;
    }
    | {
        readonly kind: 'pasted-marker';
        readonly start: number;
        readonly end: number;
        readonly text: string;
        readonly reference?: PastedTextReference;
    }
    | {
        readonly kind: 'markdown-link';
        readonly start: number;
        readonly end: number;
        readonly link: MarkdownLinkOverlayRange;
    };

export interface UserMessageAttachmentHint {
    readonly id?: string;
    readonly name: string;
    readonly uri?: string;
    readonly workspaceRelativePath?: string;
    readonly kind?: string;
    readonly size?: number;
}

export type UserMessagePastedSegment =
    | {
        readonly kind: 'text';
        readonly text: string;
    }
    | {
        readonly kind: 'pasted-chip';
        readonly marker: string;
        readonly ordinal: number;
        readonly name: string;
        readonly uri?: string;
        readonly workspaceRelativePath?: string;
        readonly content?: string;
        readonly lineCount?: number;
        readonly charCount?: number;
        readonly sizeBytes?: number;
        readonly reference?: PastedTextReference;
    };

export interface ComposerBusyRunState {
    readonly agentStage?: string;
    readonly activeAgentRunId?: string;
    readonly submitting?: boolean;
    readonly hasRunningTurn?: boolean;
    readonly scheduledRunActive?: boolean;
}

export function countPastedTextLines(value: string): number {
    if (!value) {
        return 1;
    }
    let lines = 1;
    for (let index = 0; index < value.length; index += 1) {
        if (value.charCodeAt(index) === 10) {
            lines += 1;
        }
    }
    return lines;
}

export function formatByteSizeCompact(bytes: number): string {
    const safeBytes = Number.isFinite(bytes) && bytes > 0 ? Math.trunc(bytes) : 0;
    if (safeBytes < 1024) {
        return `${Math.max(1, safeBytes)} B`;
    }
    if (safeBytes < 1024 * 1024) {
        const kb = safeBytes / 1024;
        return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
    }
    const mb = safeBytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function resolvePastedReferenceFilePath(reference: Pick<PastedTextReference, 'name' | 'attachment'>): string {
    if (reference.attachment?.workspaceRelativePath) {
        return reference.attachment.workspaceRelativePath;
    }
    const uri = reference.attachment?.uri || '';
    if (uri.startsWith('file://')) {
        try {
            return decodeURIComponent(new URL(uri).pathname);
        } catch {
            return uri.replace(/^file:\/\//, '');
        }
    }
    return uri || reference.name;
}

export function formatPastedTextChipSummary(
    reference: PastedTextReference,
    locale: NextMuxDesktopLocale = 'zh-CN'
): PastedTextChipSummary {
    const charCount = typeof reference.charCount === 'number' && reference.charCount > 0
        ? reference.charCount
        : (reference.content ? reference.content.length : 0);
    const sizeBytes = typeof reference.sizeBytes === 'number' && reference.sizeBytes > 0
        ? reference.sizeBytes
        : (reference.attachment?.size
            ?? (reference.content ? new TextEncoder().encode(reference.content).byteLength : 0));
    const lineCount = typeof reference.lineCount === 'number' && reference.lineCount > 0
        ? reference.lineCount
        : (reference.content
            ? countPastedTextLines(reference.content)
            : Math.max(1, Math.round(Math.max(1, sizeBytes) / 48)));
    const filePath = resolvePastedReferenceFilePath(reference);
    const compactSize = formatByteSizeCompact(sizeBytes);
    const copy = pasteQueueCopy(locale);
    const title = copy.chipTitle(reference.ordinal, lineCount);
    const subtitle = copy.chipSubtitle(lineCount, charCount, compactSize);
    return {
        title,
        subtitle,
        inlineLabel: `📄 ${title}`,
        lineCount,
        charCount,
        sizeBytes,
        filePath
    };
}

const GENERIC_INLINE_MARKER_PATTERN = /⟦[^⟦⟧\r\n]{3,260}⟧/g;

export function findPastedTextMarkerRanges(
    value: string,
    references: readonly PastedTextReference[] = []
): readonly PastedTextMarkerRange[] {
    if (!value) {
        return [];
    }
    const ranges: PastedTextMarkerRange[] = [];
    const occupied = new Set<string>();

    for (const reference of references) {
        if (!reference.marker) {
            continue;
        }
        let searchFrom = 0;
        while (searchFrom <= value.length - reference.marker.length) {
            const index = value.indexOf(reference.marker, searchFrom);
            if (index < 0) {
                break;
            }
            const end = index + reference.marker.length;
            const key = `${index}:${end}`;
            if (!occupied.has(key)) {
                occupied.add(key);
                ranges.push({
                    start: index,
                    end,
                    marker: reference.marker,
                    reference
                });
            }
            searchFrom = end;
        }
    }

    GENERIC_INLINE_MARKER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = GENERIC_INLINE_MARKER_PATTERN.exec(value)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const overlapsExisting = ranges.some(range => range.start < end && range.end > start);
        if (!overlapsExisting) {
            ranges.push({
                start,
                end,
                marker: match[0]
            });
        }
    }

    return ranges.sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * Atomic deletion for inline pasted-text placeholder markers on Backspace / Delete.
 * When the caret is adjacent to or inside a marker (or a selection overlaps a marker),
 * the entire marker is removed as a single unit and any orphaned pasted-text reference IDs
 * are returned so the caller can remove their file chips simultaneously.
 */
export function removeAdjacentPastedTextMarker(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    direction: 'backward' | 'forward',
    references: readonly PastedTextReference[] = []
): AtomicPastedTextDeletionResult | undefined {
    const start = Math.max(0, Math.min(value.length, Math.trunc(selectionStart) || 0));
    const end = Math.max(start, Math.min(value.length, Math.trunc(selectionEnd) || start));
    const ranges = findPastedTextMarkerRanges(value, references);
    if (!ranges.length) {
        return undefined;
    }

    let hitRanges: PastedTextMarkerRange[] = [];
    let deleteStart = start;
    let deleteEnd = end;

    if (start === end) {
        if (direction === 'backward') {
            const target = ranges.find(range => start > range.start && start <= range.end);
            if (!target) {
                return undefined;
            }
            hitRanges = [target];
            deleteStart = target.start;
            deleteEnd = target.end;
        } else {
            const target = ranges.find(range => start >= range.start && start < range.end);
            if (!target) {
                return undefined;
            }
            hitRanges = [target];
            deleteStart = target.start;
            deleteEnd = target.end;
        }
    } else {
        hitRanges = ranges.filter(range => range.start < end && range.end > start);
        if (!hitRanges.length) {
            return undefined;
        }
        deleteStart = Math.min(start, hitRanges[0].start);
        deleteEnd = Math.max(end, hitRanges[hitRanges.length - 1].end);
    }

    const nextValue = `${value.slice(0, deleteStart)}${value.slice(deleteEnd)}`;
    const remainingReferences = pastedTextReferencesInDocument(nextValue, references);
    const remainingIds = new Set(remainingReferences.map(item => item.id));
    const removedIds: string[] = [];
    for (const hit of hitRanges) {
        if (hit.reference && !remainingIds.has(hit.reference.id) && !removedIds.includes(hit.reference.id)) {
            removedIds.push(hit.reference.id);
        }
    }
    for (const reference of references) {
        if (!remainingIds.has(reference.id) && value.includes(reference.marker) && !removedIds.includes(reference.id)) {
            removedIds.push(reference.id);
        }
    }

    return {
        value: nextValue,
        selectionStart: deleteStart,
        selectionEnd: deleteStart,
        removedIds,
        remainingReferences
    };
}

export function removePastedTextReferenceById(
    value: string,
    referenceId: string,
    references: readonly PastedTextReference[]
): {
    readonly value: string;
    readonly removed?: PastedTextReference;
    readonly remainingReferences: readonly PastedTextReference[];
} {
    const removed = references.find(item => item.id === referenceId);
    const nextValue = removed ? value.split(removed.marker).join('') : value;
    const filtered = references.filter(item => item.id !== referenceId);
    const remainingReferences = pastedTextReferencesInDocument(nextValue, filtered);
    return {
        value: nextValue,
        removed,
        remainingReferences
    };
}

export function composerOverlaySegments(
    value: string,
    references: readonly PastedTextReference[] = [],
    markdownLinks: readonly MarkdownLinkOverlayRange[] = []
): readonly ComposerOverlaySegment[] {
    if (!value) {
        return [];
    }
    const markerRanges = findPastedTextMarkerRanges(value, references);
    type RawItem =
        | { readonly kind: 'pasted-marker'; readonly start: number; readonly end: number; readonly reference?: PastedTextReference }
        | { readonly kind: 'markdown-link'; readonly start: number; readonly end: number; readonly link: MarkdownLinkOverlayRange };

    const items: RawItem[] = markerRanges.map(range => ({
        kind: 'pasted-marker' as const,
        start: range.start,
        end: range.end,
        reference: range.reference
    }));

    for (const link of markdownLinks) {
        const overlapsMarker = items.some(item => item.start < link.end && item.end > link.start);
        if (!overlapsMarker) {
            items.push({
                kind: 'markdown-link',
                start: link.start,
                end: link.end,
                link
            });
        }
    }

    items.sort((left, right) => left.start - right.start || left.end - right.end);
    if (!items.length) {
        return [{ kind: 'text', start: 0, end: value.length, text: value }];
    }

    const segments: ComposerOverlaySegment[] = [];
    let cursor = 0;
    for (const item of items) {
        if (item.start < cursor) {
            continue;
        }
        if (item.start > cursor) {
            segments.push({
                kind: 'text',
                start: cursor,
                end: item.start,
                text: value.slice(cursor, item.start)
            });
        }
        if (item.kind === 'pasted-marker') {
            segments.push({
                kind: 'pasted-marker',
                start: item.start,
                end: item.end,
                text: value.slice(item.start, item.end),
                reference: item.reference
            });
        } else {
            segments.push({
                kind: 'markdown-link',
                start: item.start,
                end: item.end,
                link: item.link
            });
        }
        cursor = item.end;
    }
    if (cursor < value.length) {
        segments.push({
            kind: 'text',
            start: cursor,
            end: value.length,
            text: value.slice(cursor)
        });
    }
    return segments;
}

/**
 * Formats the model-facing attachment content for a persisted pasted-text file.
 * Includes the persisted file path, line count, and character count so coding tools
 * and agents can either read the content directly or inspect/grep the file on disk.
 */
const MAX_PASTED_MODEL_PAYLOAD_CHARS = 120_000;
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsiEscapeCodes(value: string): string {
    return value.replace(ANSI_ESCAPE_PATTERN, '');
}

export function formatPastedTextModelPayload(
    reference: PastedTextReference,
    rawContent: string,
    maxTotalChars = MAX_PASTED_MODEL_PAYLOAD_CHARS
): string {
    const raw = rawContent || reference.content || '';
    const wrappedMatch = /^<pasted_file\b[^>]*>\r?\n?([\s\S]*?)\r?\n?<\/pasted_file>\s*$/.exec(raw);
    const fullBody = stripAnsiEscapeCodes(wrappedMatch ? wrappedMatch[1] : raw);
    const lineCount = reference.lineCount ?? countPastedTextLines(fullBody);
    const charCount = reference.charCount ?? fullBody.length;
    const filePath = resolvePastedReferenceFilePath(reference);
    const openTag = `<pasted_file path="${filePath}" name="${reference.name}" lines="${lineCount}" chars="${charCount}">\n`;
    const closeTag = `\n</pasted_file>`;
    const budget = Math.min(MAX_PASTED_MODEL_PAYLOAD_CHARS, Math.max(0, Math.trunc(maxTotalChars)));
    if (budget <= openTag.length + closeTag.length) {
        return `${openTag}${closeTag}`.slice(0, budget);
    }
    const maxBodyChars = Math.max(0, budget - openTag.length - closeTag.length);
    if (fullBody.length <= maxBodyChars) {
        return `${openTag}${fullBody}${closeTag}`;
    }
    const suffix = `\n\n[Full pasted text continues in ${filePath}]`;
    if (maxBodyChars <= suffix.length) {
        return `${openTag}${suffix.slice(0, maxBodyChars)}${closeTag}`;
    }
    const excerptLimit = Math.max(0, maxBodyChars - suffix.length);
    return `${openTag}${fullBody.slice(0, excerptLimit)}${suffix}${closeTag}`;
}

const MODEL_REFERENCE_FALLBACK_PATTERN = /⟦([^⟦⟧\r\n]+?)\s+(\d+)\s*·\s*(pasted-text-[^\s⟦⟧]+\.txt)⟧|\[Attached text:\s*(pasted-text-[^\s\]]+\.txt)\]|\[Pasted text file:\s*([^\r\n\]]+?)\]|<pasted_file\s+[^>]*path="([^"\r\n]+)"(?:[^>]*name="([^"\r\n]+)")?[^>]*>[\s\S]*?<\/pasted_file>/g;

export function parseUserPromptPastedSegments(
    value: string,
    references: readonly PastedTextReference[] = [],
    attachments: readonly UserMessageAttachmentHint[] = []
): readonly UserMessagePastedSegment[] {
    if (!value) {
        return [];
    }
    const byMarker = new Map<string, PastedTextReference>();
    const byModelRef = new Map<string, PastedTextReference>();
    const byName = new Map<string, PastedTextReference>();
    const byWorkspaceRelativePath = new Map<string, PastedTextReference>();
    for (const ref of references) {
        if (ref.marker) {
            byMarker.set(ref.marker, ref);
        }
        if (ref.modelReference) {
            byModelRef.set(ref.modelReference, ref);
        }
        if (ref.name) {
            byName.set(ref.name, ref);
        }
        if (ref.attachment?.workspaceRelativePath) {
            byWorkspaceRelativePath.set(ref.attachment.workspaceRelativePath, ref);
        }
    }
    const attachmentByName = new Map<string, UserMessageAttachmentHint>();
    const attachmentById = new Map<string, UserMessageAttachmentHint>();
    const attachmentByWorkspaceRelativePath = new Map<string, UserMessageAttachmentHint>();
    for (const item of attachments) {
        if (item.name) {
            attachmentByName.set(item.name, item);
        }
        if (item.id) {
            attachmentById.set(item.id, item);
        }
        if (item.workspaceRelativePath) {
            attachmentByWorkspaceRelativePath.set(item.workspaceRelativePath, item);
        }
    }

    interface TokenMatch {
        readonly start: number;
        readonly end: number;
        readonly segment: Extract<UserMessagePastedSegment, { readonly kind: 'pasted-chip' }>;
    }
    const matches: TokenMatch[] = [];
    const seenRanges = new Set<string>();

    for (const ref of references) {
        for (const token of [ref.marker, ref.modelReference]) {
            if (!token) {
                continue;
            }
            let from = 0;
            while (from <= value.length - token.length) {
                const idx = value.indexOf(token, from);
                if (idx < 0) {
                    break;
                }
                const end = idx + token.length;
                const key = `${idx}:${end}`;
                if (!seenRanges.has(key)) {
                    seenRanges.add(key);
                    const matchedAtt = attachmentById.get(ref.id) || attachmentByName.get(ref.name);
                    matches.push({
                        start: idx,
                        end,
                        segment: {
                            kind: 'pasted-chip',
                            marker: token,
                            ordinal: ref.ordinal,
                            name: ref.name,
                            uri: ref.attachment?.uri || matchedAtt?.uri,
                            workspaceRelativePath: ref.attachment?.workspaceRelativePath || matchedAtt?.workspaceRelativePath,
                            content: ref.content,
                            lineCount: ref.lineCount,
                            charCount: ref.charCount,
                            sizeBytes: ref.sizeBytes ?? ref.attachment?.size ?? matchedAtt?.size,
                            reference: ref
                        }
                    });
                }
                from = end;
            }
        }
    }

    MODEL_REFERENCE_FALLBACK_PATTERN.lastIndex = 0;
    let regexMatch: RegExpExecArray | null;
    let fallbackOrdinal = 1;
    while ((regexMatch = MODEL_REFERENCE_FALLBACK_PATTERN.exec(value)) !== null) {
        const start = regexMatch.index;
        const end = start + regexMatch[0].length;
        const overlaps = matches.some(item => item.start < end && item.end > start);
        if (overlaps) {
            continue;
        }
        const rawPathRef = (regexMatch[5] || regexMatch[6] || '').trim();
        const pathOnly = rawPathRef.replace(/\s*\([^()]*\)\s*$/, '').trim();
        const explicitName = regexMatch[7]?.trim();
        const pathBaseName = pathOnly ? pathOnly.split('/').pop() || '' : '';
        const defaultName = regexMatch[3] || regexMatch[4] || explicitName || pathBaseName || 'pasted-text.txt';
        const ordinal = regexMatch[2] ? Math.max(1, Number.parseInt(regexMatch[2], 10) || fallbackOrdinal) : fallbackOrdinal;
        fallbackOrdinal += 1;
        const knownRef = byModelRef.get(regexMatch[0])
            || byMarker.get(regexMatch[0])
            || (pathOnly ? byWorkspaceRelativePath.get(pathOnly) : undefined)
            || (explicitName ? byName.get(explicitName) : undefined)
            || (pathBaseName ? byName.get(pathBaseName) : undefined)
            || byName.get(defaultName);
        const matchedAtt = (knownRef && attachmentById.get(knownRef.id))
            || (pathOnly ? attachmentByWorkspaceRelativePath.get(pathOnly) : undefined)
            || (explicitName ? attachmentByName.get(explicitName) : undefined)
            || (pathBaseName ? attachmentByName.get(pathBaseName) : undefined)
            || attachmentByName.get(defaultName);
        const fileName = knownRef?.name || matchedAtt?.name || defaultName;
        const workspaceRelativePath = knownRef?.attachment?.workspaceRelativePath
            || matchedAtt?.workspaceRelativePath
            || (pathOnly.startsWith('.nextmux/') ? pathOnly : undefined);
        matches.push({
            start,
            end,
            segment: {
                kind: 'pasted-chip',
                marker: regexMatch[0],
                ordinal: knownRef?.ordinal ?? ordinal,
                name: fileName,
                uri: knownRef?.attachment?.uri || matchedAtt?.uri,
                workspaceRelativePath,
                content: knownRef?.content,
                lineCount: knownRef?.lineCount,
                charCount: knownRef?.charCount,
                sizeBytes: knownRef?.sizeBytes ?? knownRef?.attachment?.size ?? matchedAtt?.size,
                reference: knownRef
            }
        });
    }

    matches.sort((left, right) => left.start - right.start || left.end - right.end);
    if (!matches.length) {
        return [{ kind: 'text', text: value }];
    }

    const segments: UserMessagePastedSegment[] = [];
    let cursor = 0;
    for (const item of matches) {
        if (item.start < cursor) {
            continue;
        }
        if (item.start > cursor) {
            segments.push({
                kind: 'text',
                text: value.slice(cursor, item.start)
            });
        }
        segments.push(item.segment);
        cursor = item.end;
    }
    if (cursor < value.length) {
        segments.push({
            kind: 'text',
            text: value.slice(cursor)
        });
    }
    return segments;
}

export interface PastedTextMessageChipProps {
    readonly segment: Extract<UserMessagePastedSegment, { readonly kind: 'pasted-chip' }>;
    readonly locale?: NextMuxDesktopLocale;
    readonly onOpenFile?: (uri: string) => void;
    readonly onLoadContent?: (uri: string) => Promise<string | undefined>;
}

export const PastedTextMessageChip: React.FC<PastedTextMessageChipProps> = ({
    segment,
    locale = 'zh-CN',
    onOpenFile,
    onLoadContent
}) => {
    const [expanded, setExpanded] = React.useState(false);
    const [loadedContent, setLoadedContent] = React.useState<string | undefined>(segment.content);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        if (segment.content) {
            setLoadedContent(segment.content);
        }
    }, [segment.content]);

    const syntheticReference: PastedTextReference = segment.reference || {
        id: segment.name,
        ordinal: segment.ordinal,
        name: segment.name,
        marker: segment.marker,
        modelReference: `[Attached text: ${segment.name}]`,
        content: loadedContent,
        lineCount: segment.lineCount,
        charCount: segment.charCount,
        sizeBytes: segment.sizeBytes,
        ...(segment.uri ? {
            attachment: {
                uri: segment.uri,
                size: segment.sizeBytes || 1,
                ...(segment.workspaceRelativePath ? { workspaceRelativePath: segment.workspaceRelativePath } : {})
            }
        } : {})
    };

    const summary = formatPastedTextChipSummary(
        loadedContent && !syntheticReference.content
            ? { ...syntheticReference, content: loadedContent }
            : syntheticReference,
        locale
    );

    const handleTogglePreview = async (event: React.MouseEvent) => {
        event.stopPropagation();
        const nextExpanded = !expanded;
        setExpanded(nextExpanded);
        if (nextExpanded && !loadedContent && segment.uri && onLoadContent) {
            setLoading(true);
            try {
                const text = await onLoadContent(segment.uri);
                if (typeof text === 'string') {
                    setLoadedContent(text);
                }
            } finally {
                setLoading(false);
            }
        }
    };

    const copy = pasteQueueCopy(locale);
    const previewLabel = expanded ? copy.previewHide : copy.previewShow;
    const openLabel = copy.openFile;

    return React.createElement(
        'span',
        {
            className: `nmx-message-pasted-chip${expanded ? ' is-expanded' : ''}`,
            'data-pasted-file': segment.name,
            'data-pasted-path': summary.filePath
        },
        React.createElement(
            'span',
            {
                className: 'nmx-message-pasted-chip__header',
                role: 'button',
                tabIndex: 0,
                onClick: (event: React.MouseEvent) => void handleTogglePreview(event),
                onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void handleTogglePreview(event as unknown as React.MouseEvent);
                    }
                },
                title: `${summary.title} (${summary.filePath})`
            },
            React.createElement('span', { className: 'nmx-message-pasted-chip__icon', 'aria-hidden': 'true' }, '📄'),
            React.createElement('span', { className: 'nmx-message-pasted-chip__title', 'data-nmx-literal': true }, summary.title),
            React.createElement('span', { className: 'nmx-message-pasted-chip__meta' }, summary.subtitle),
            React.createElement('span', { className: 'nmx-message-pasted-chip__toggle' }, previewLabel),
            segment.uri && onOpenFile
                ? React.createElement(
                    'button',
                    {
                        type: 'button',
                        className: 'nmx-message-pasted-chip__open',
                        onClick: (event: React.MouseEvent) => {
                            event.stopPropagation();
                            onOpenFile(segment.uri!);
                        },
                        title: summary.filePath
                    },
                    openLabel
                )
                : null
        ),
        expanded
            ? React.createElement(
                'pre',
                { className: 'nmx-message-pasted-chip__preview', 'data-nmx-literal': true },
                loading
                    ? copy.loadingFile
                    : (loadedContent || `${summary.filePath} (${summary.subtitle})`)
            )
            : null
    );
};

/**
 * Determines whether submitting a new prompt from the composer should be placed
 * into the Pending Follow-up Queue rather than starting an overlapping turn or
 * injecting into the middle of an active streaming response.
 */
export function shouldEnqueueComposerSubmissionWhileBusy(state: ComposerBusyRunState): boolean {
    return Boolean(
        state.agentStage === 'running'
        || state.activeAgentRunId
        || state.submitting
        || state.hasRunningTurn
        || state.scheduledRunActive
    );
}

export function formatFollowUpQueueStatusBadge(
    locale: NextMuxDesktopLocale = 'zh-CN',
    dispatching = false
): string {
    const copy = pasteQueueCopy(locale);
    return dispatching ? copy.queueDispatching : copy.queueWaiting;
}
