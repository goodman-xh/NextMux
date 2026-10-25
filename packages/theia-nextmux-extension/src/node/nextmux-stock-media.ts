import { skillDomainDescriptor, type SkillDomainCode } from '../common/nextmux-skill-domain';
import type { DomainMessage } from '../common/nextmux-domain-errors';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { dirname } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { StockMediaProvider } from '../common/nextmux-stock-media';
export { stockQueryFromPrompt } from '../common/nextmux-stock-media';

/**
 * Free stock pictures and clips for “topic to video” shots (the MoneyPrinterTurbo idea): Pexels
 * and Pixabay, searched with the user's own free API key. The key stays in the system keychain;
 * it is sent only to its provider and never appears in errors or logs (Pixabay takes it in the
 * query string, so request URLs are never reported). Both licenses allow free commercial use;
 * the author and source page travel with the file name.
 */

export interface StockSearchRequest {
    readonly provider: StockMediaProvider;
    readonly key: string;
    readonly query: string;
    readonly kind: 'image' | 'video';
    readonly orientation: 'landscape' | 'portrait' | 'square';
    /** Clips at least this long are preferred (the shot's length). */
    readonly minSeconds?: number;
    /** UI locale such as zh-CN; the providers translate the query. */
    readonly locale?: string;
    /** Provider IDs already used in this project, so shots do not repeat a clip. */
    readonly exclude?: ReadonlySet<string>;
    readonly signal?: AbortSignal;
}

export interface StockPick {
    readonly provider: StockMediaProvider;
    readonly id: string;
    readonly kind: 'image' | 'video';
    readonly downloadUrl: string;
    readonly extension: 'jpg' | 'png' | 'mp4';
    readonly width: number;
    readonly height: number;
    readonly seconds?: number;
    readonly author: string;
    readonly pageUrl: string;
}

export class StockMediaError extends Error {
    readonly domainError: DomainMessage;
    readonly data: { readonly domainError: DomainMessage };
    constructor(readonly code: 'STOCK_KEY_REJECTED' | 'STOCK_RATE_LIMITED' | 'STOCK_UNAVAILABLE', reason: SkillDomainCode, params?: DomainMessage['params']) {
        const domainError = skillDomainDescriptor(reason, params);
        super(domainError.fallbackEnglish);
        this.domainError = domainError;
        this.data = { domainError };
    }
}

const PEXELS_LOCALES: Readonly<Record<string, string>> = {
    'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', 'pt-BR': 'pt-BR', ru: 'ru-RU', en: 'en-US'
};
const PIXABAY_LANGUAGES = new Set(['cs', 'da', 'de', 'en', 'es', 'fr', 'id', 'it', 'hu', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'fi', 'sv', 'tr', 'vi', 'th', 'bg', 'ru', 'el', 'ja', 'ko', 'zh']);

function isLatin(text: string): boolean {
    return /^[\x20-\x7e]+$/.test(text);
}

function wanted(orientation: StockSearchRequest['orientation'], width: number, height: number): number {
    if (!width || !height) return 0;
    const ratio = width / height;
    if (orientation === 'landscape') return ratio >= 1.2 ? 2 : ratio >= 1 ? 1 : 0;
    if (orientation === 'portrait') return ratio <= 0.8 ? 2 : ratio <= 1 ? 1 : 0;
    return ratio > 0.8 && ratio < 1.25 ? 2 : 1;
}

/** Provider URLs may contain credentials; never retain a fetch exception as display detail. */
async function stockFetch(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
    try { return await fetchImpl(url, init); }
    catch {
        init.signal?.throwIfAborted();
        throw new StockMediaError('STOCK_UNAVAILABLE', 'STOCK_NETWORK_FAILED');
    }
}

async function readJson(response: Response, provider: StockMediaProvider): Promise<Record<string, unknown>> {
    const params = { provider: provider === 'pexels' ? 'Pexels' : 'Pixabay', status: response.status };
    if (response.status === 401 || response.status === 403) throw new StockMediaError('STOCK_KEY_REJECTED', 'STOCK_KEY_REJECTED', params);
    if (response.status === 429) throw new StockMediaError('STOCK_RATE_LIMITED', 'STOCK_RATE_LIMITED', params);
    if (!response.ok) throw new StockMediaError('STOCK_UNAVAILABLE', 'STOCK_HTTP_UNAVAILABLE', params);
    const value = await response.json().catch(() => undefined);
    if (!value || typeof value !== 'object') throw new StockMediaError('STOCK_UNAVAILABLE', 'STOCK_RESPONSE_INVALID', params);
    return value as Record<string, unknown>;
}

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** One best-fitting picture or clip for a shot, or undefined when nothing matches. */
export async function searchStockMedia(request: StockSearchRequest, fetchImpl: typeof fetch): Promise<StockPick | undefined> {
    const query = request.query.trim().slice(0, 100);
    if (!query || !request.key) return undefined;
    const exclude = request.exclude ?? new Set<string>();
    const base = (request.locale || 'en').split('-')[0];
    const english = isLatin(query);
    if (request.provider === 'pexels') {
        const params = new URLSearchParams({ query, per_page: '20', orientation: request.orientation });
        const locale = english ? 'en-US' : PEXELS_LOCALES[request.locale || ''] || PEXELS_LOCALES[base];
        if (locale) params.set('locale', locale);
        const url = `https://api.pexels.com/${request.kind === 'video' ? 'videos/search' : 'v1/search'}?${params}`;
        const body = await readJson(await stockFetch(fetchImpl, url, { headers: { authorization: request.key, accept: 'application/json' }, signal: request.signal }), 'pexels');
        if (request.kind === 'image') {
            const photos = Array.isArray(body.photos) ? body.photos as Record<string, unknown>[] : [];
            const ranked = photos.filter(photo => !exclude.has(`pexels:${photo.id}`))
                .map(photo => ({ photo, score: wanted(request.orientation, num(photo.width), num(photo.height)) }))
                .sort((left, right) => right.score - left.score);
            const photo = ranked[0]?.photo;
            const src = photo?.src as Record<string, unknown> | undefined;
            const link = text(src?.large2x) || text(src?.large) || text(src?.original);
            if (!photo || !link) return undefined;
            return { provider: 'pexels', id: String(photo.id), kind: 'image', downloadUrl: link, extension: 'jpg', width: num(photo.width), height: num(photo.height),
                author: text(photo.photographer) || 'Pexels', pageUrl: text(photo.url) };
        }
        const videos = Array.isArray(body.videos) ? body.videos as Record<string, unknown>[] : [];
        const candidates = videos.filter(video => !exclude.has(`pexels:${video.id}`)).flatMap(video => {
            const files = (Array.isArray(video.video_files) ? video.video_files as Record<string, unknown>[] : [])
                .filter(file => text(file.file_type) === 'video/mp4' && text(file.link) && num(file.width) > 0 && Math.max(num(file.width), num(file.height)) <= 1920)
                .sort((left, right) => num(right.width) * num(right.height) - num(left.width) * num(left.height));
            const file = files[0];
            return file ? [{ video, file, score: wanted(request.orientation, num(file.width), num(file.height)) * 2 + (num(video.duration) >= (request.minSeconds ?? 0) ? 1 : 0) }] : [];
        }).sort((left, right) => right.score - left.score);
        const best = candidates[0];
        if (!best) return undefined;
        return { provider: 'pexels', id: String(best.video.id), kind: 'video', downloadUrl: text(best.file.link), extension: 'mp4',
            width: num(best.file.width), height: num(best.file.height), seconds: num(best.video.duration),
            author: text((best.video.user as Record<string, unknown> | undefined)?.name) || 'Pexels', pageUrl: text(best.video.url) };
    }
    const params = new URLSearchParams({ key: request.key, q: query, per_page: '20', safesearch: 'true' });
    const language = english ? 'en' : base === 'zh' ? 'zh' : base;
    if (PIXABAY_LANGUAGES.has(language)) params.set('lang', language);
    if (request.kind === 'image') {
        params.set('image_type', 'photo');
        params.set('orientation', request.orientation === 'landscape' ? 'horizontal' : request.orientation === 'portrait' ? 'vertical' : 'all');
    }
    const url = `https://pixabay.com/api/${request.kind === 'video' ? 'videos/' : ''}?${params}`;
    const body = await readJson(await stockFetch(fetchImpl, url, { headers: { accept: 'application/json' }, signal: request.signal }), 'pixabay');
    const hits = (Array.isArray(body.hits) ? body.hits as Record<string, unknown>[] : []).filter(hit => !exclude.has(`pixabay:${hit.id}`));
    if (request.kind === 'image') {
        const ranked = hits.map(hit => ({ hit, score: wanted(request.orientation, num(hit.imageWidth), num(hit.imageHeight)) })).sort((left, right) => right.score - left.score);
        const hit = ranked[0]?.hit;
        const link = text(hit?.largeImageURL) || text(hit?.webformatURL);
        if (!hit || !link) return undefined;
        return { provider: 'pixabay', id: String(hit.id), kind: 'image', downloadUrl: link, extension: /\.png(?:$|\?)/i.test(link) ? 'png' : 'jpg',
            width: num(hit.imageWidth), height: num(hit.imageHeight), author: text(hit.user) || 'Pixabay', pageUrl: text(hit.pageURL) };
    }
    const candidates = hits.flatMap(hit => {
        const sizes = hit.videos as Record<string, Record<string, unknown>> | undefined;
        const file = ['large', 'medium', 'small'].map(size => sizes?.[size]).find(entry => entry && text(entry.url) && num(entry.width) > 0 && Math.max(num(entry.width), num(entry.height)) <= 1920);
        return file ? [{ hit, file, score: wanted(request.orientation, num(file.width), num(file.height)) * 2 + (num(hit.duration) >= (request.minSeconds ?? 0) ? 1 : 0) }] : [];
    }).sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best) return undefined;
    return { provider: 'pixabay', id: String(best.hit.id), kind: 'video', downloadUrl: text(best.file.url), extension: 'mp4',
        width: num(best.file.width), height: num(best.file.height), seconds: num(best.hit.duration), author: text(best.hit.user) || 'Pixabay', pageUrl: text(best.hit.pageURL) };
}

/** A file name that keeps the credit: “Pexels 12345 · Jane Doe.mp4”. */
export function stockFileName(pick: StockPick): string {
    const author = pick.author.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60) || 'unknown';
    return `${pick.provider === 'pexels' ? 'Pexels' : 'Pixabay'} ${pick.id} · ${author}.${pick.extension}`;
}

/** Downloads a pick (at most 300 MB) to `target`; only the provider's own CDN hosts are fetched. */
export async function downloadStockMedia(pick: StockPick, target: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<void> {
    let host: string;
    try { host = new URL(pick.downloadUrl).hostname; }
    catch { throw new StockMediaError('STOCK_UNAVAILABLE', 'STOCK_DOWNLOAD_URL_INVALID'); }
    // Older Pexels clips are served from Vimeo's external player CDN.
    const allowed = pick.provider === 'pexels' ? /(^|\.)pexels\.com$|^player\.vimeo\.com$/ : /(^|\.)pixabay\.com$/;
    if (!allowed.test(host)) throw new StockMediaError('STOCK_UNAVAILABLE', 'STOCK_DOWNLOAD_URL_INVALID');
    const response = await stockFetch(fetchImpl, pick.downloadUrl, { signal });
    if (!response.ok || !response.body) throw new StockMediaError('STOCK_UNAVAILABLE', 'STOCK_DOWNLOAD_FAILED', { status: response.status });
    if (Number(response.headers.get('content-length') || 0) > 300 * 1024 * 1024) throw new StockMediaError('STOCK_UNAVAILABLE', 'STOCK_FILE_TOO_LARGE', { limitBytes: 300 * 1024 * 1024 });
    await mkdir(dirname(target), { recursive: true });
    let bytes = 0;
    const limited = Readable.fromWeb(response.body as import('stream/web').ReadableStream).on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 300 * 1024 * 1024) limited.destroy(new StockMediaError('STOCK_UNAVAILABLE', 'STOCK_FILE_TOO_LARGE', { limitBytes: 300 * 1024 * 1024 }));
    });
    try { await pipeline(limited, createWriteStream(target, { flags: 'wx' })); }
    catch (error) { await rm(target, { force: true }); throw error; }
}
