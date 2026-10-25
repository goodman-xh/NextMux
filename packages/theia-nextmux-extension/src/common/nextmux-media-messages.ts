import { formatPlatformMediaError, PLATFORM_MEDIA_REASONS, redactModelErrorDetail } from '@nextmux/model-runtime/errors';
import type { ReadableModelError } from '@nextmux/model-runtime/errors';

export interface MediaMessage {
    readonly code: string;
    readonly message: string;
    readonly domain: 'media';
    readonly messageKey: string;
    readonly params: Readonly<Record<string, string | number | boolean | null>>;
    readonly detail?: string;
}

export function mediaMessage(key: string, params: MediaMessage['params'] = {}, detail?: unknown): MediaMessage {
    const raw = detail instanceof Error ? detail.message : typeof detail === 'string' ? detail : undefined;
    const values = { ...PLATFORM_MEDIA_REASONS[key]?.params, ...params };
    return { code: `MEDIA_${key.toUpperCase()}`, domain: 'media', messageKey: `platform_media.${key}`, params: values,
        message: formatPlatformMediaError(`platform_media.${key}`, values, 'en') || 'Media operation failed.',
        ...(raw ? { detail: redactModelErrorDetail(raw) } : {}) };
}

export function mediaMessageText(value: MediaMessage, locale = 'en'): string {
    return formatPlatformMediaError(value.messageKey, value.params, locale)
        || formatPlatformMediaError('platform_media.export_notice', {}, locale)!;
}

/** Compatibility string remains English; semantic fields survive RPC and persistence. */
export function exportMessage(key: string, params: MediaMessage['params'] = {}): { message: string; messageInfo: MediaMessage } {
    const messageInfo = mediaMessage(key, params);
    return { message: mediaMessageText(messageInfo), messageInfo };
}

export function mediaMessageError(value: MediaMessage): ReadableModelError {
    return { ...value, kind: 'unknown', detail: value.detail || mediaMessageText(value) };
}

export function validMediaMessage(value: unknown): value is MediaMessage {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<MediaMessage>;
    return v.domain === 'media' && typeof v.code === 'string' && v.code.length <= 160
        && typeof v.messageKey === 'string' && v.messageKey.startsWith('platform_media.') && v.messageKey.length <= 200
        && Boolean(v.params && typeof v.params === 'object' && !Array.isArray(v.params))
        && Object.entries(v.params!).length <= 20
        && Object.entries(v.params!).every(([key, value]) => key.length <= 100 && (value === null || typeof value === 'boolean'
            || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 4096))
        && (v.detail === undefined || typeof v.detail === 'string' && v.detail.length <= 16384);
}

export function comicExportMessageText(value: { status: string; messageInfo?: MediaMessage; restoredHistoryOnly?: boolean }, locale: string): string {
    if (value.messageInfo && validMediaMessage(value.messageInfo)) return mediaMessageText(value.messageInfo, locale);
    if (value.restoredHistoryOnly) return mediaMessageText(mediaMessage('archive.restored_notice'), locale);
    const key: Record<string, string> = { validating: 'export_checking', rendering: 'export_rendering', muxing: 'export_muxing', completed: 'export_completed', cancelled: 'export_cancelled', failed: 'export_failed' };
    // Legacy prose is retained for diagnostics only. Status is the migration identity.
    return mediaMessageText(mediaMessage(key[value.status] === 'export_rendering' ? 'export_checking' : key[value.status] || 'export_notice'), locale);
}
