import { createHash } from 'crypto';
import { readBoundedResponseBody } from './nextmux-response-body';

type Asset = { readonly sha256: string; readonly mimeType: string; readonly sizeBytes: number };
type Part = { readonly type: string; readonly asset?: Asset; readonly dataBase64?: string; readonly historyInputId?: string };
type Message = { readonly outputParts?: readonly Part[] };
export interface ManagedHistoryOptions {
    readonly baseUrl: string;
    readonly clientRequestId: string;
    readonly deviceId: () => Promise<string>;
    readonly fetch: typeof fetch;
    readonly signal?: AbortSignal;
    readonly legacyAvailable: (assets: readonly Asset[]) => Promise<boolean>;
}
const SAFE_BODY_BYTES = 47 * 1024 * 1024;
const MAX_BODY_BYTES = 48 * 1024 * 1024;
const assetKey = (asset: Asset): string => `${asset.sha256}:${asset.mimeType}:${asset.sizeBytes}`;
export function managedHistoryInputId(clientRequestId: string, asset: Asset): string {
    const hex = createHash('sha256').update(JSON.stringify([clientRequestId, assetKey(asset)])).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Large historical media travels as authenticated temporary binary uploads, not an oversized JSON body. */
export async function prepareManagedHistoryBody(body: Record<string, unknown>, options: ManagedHistoryOptions): Promise<{
    readonly body: Record<string, unknown>; readonly uploadIds: readonly string[]; readonly legacy: boolean;
}> {
    const messages = body.messages as readonly Message[] | undefined;
    if (body.contentTransfer === 'stream-v2') {
        const inlineMedia: Record<string, string> = {}; let total = 0;
        const transformed = { ...body, messages: messages?.map(message => ({ ...message,
            ...(message.outputParts ? { outputParts: message.outputParts.map(part => {
                if (part.type === 'text' || !part.asset || !part.dataBase64) return part;
                const { sha256, sizeBytes } = part.asset;
                if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('MANAGED_HISTORY_ASSET_INVALID');
                if (!Object.hasOwn(inlineMedia, sha256)) {
                    const bytes = Buffer.from(part.dataBase64, 'base64');
                    if (bytes.length !== sizeBytes || bytes.toString('base64') !== part.dataBase64
                        || createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('MANAGED_HISTORY_ASSET_INVALID');
                    total += bytes.length;
                    if (total > 32 * 1024 * 1024) throw new Error('MANAGED_HISTORY_REQUEST_TOO_LARGE');
                    inlineMedia[sha256] = part.dataBase64;
                }
                const { dataBase64: _bytes, historyInputId: _old, ...reference } = part;
                return { ...reference, inlineMediaRef: sha256 };
            }) } : {}) })), inlineMedia };
        if (Buffer.byteLength(JSON.stringify(transformed)) > MAX_BODY_BYTES) throw new Error('MANAGED_HISTORY_REQUEST_TOO_LARGE');
        return { body: transformed, uploadIds: [], legacy: false };
    }

    if (!messages?.some(message => message.outputParts?.some(part => part.type !== 'text' && part.dataBase64))) {
        return { body, uploadIds: [], legacy: false };
    }
    if (Buffer.byteLength(JSON.stringify(body)) <= SAFE_BODY_BYTES) return { body, uploadIds: [], legacy: false };
    const assets = new Map<string, { asset: Asset; base64: string; count: number }>();
    for (const message of messages) for (const part of message.outputParts || []) {
        if (part.type === 'text' || !part.asset || !part.dataBase64) continue;
        const key = assetKey(part.asset), previous = assets.get(key);
        if (previous) previous.count++;
        else assets.set(key, { asset: part.asset, base64: part.dataBase64, count: 1 });
    }
    const replacements = new Map<string, string>();
    const transformed = (legacy = false): Record<string, unknown> => ({ ...body, messages: messages.map(message => ({ ...message,
        ...(message.outputParts ? { outputParts: message.outputParts.map(part => {
            if (!part.asset || part.type === 'text' || !part.dataBase64) return part;
            const historyInputId = replacements.get(assetKey(part.asset));
            if (!legacy && !historyInputId) return part;
            const { dataBase64: _bytes, historyInputId: _old, ...reference } = part;
            return { ...reference, ...(legacy ? {} : { historyInputId }) };
        }) } : {})
    })) });
    let result = body;
    for (const { asset, base64 } of [...assets.values()].sort((a, b) => b.base64.length * b.count - a.base64.length * a.count)) {
        options.signal?.throwIfAborted();
        const bytes = Buffer.from(base64, 'base64');
        if (bytes.length !== asset.sizeBytes || bytes.toString('base64') !== base64
            || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('MANAGED_HISTORY_ASSET_INVALID');
        const id = managedHistoryInputId(options.clientRequestId, asset), controller = new AbortController();
        const abort = (): void => controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 120_000); timer.unref();
        try {
            const response = await options.fetch(`${options.baseUrl.replace(/\/$/, '')}/api/gateway/history-inputs`, {
                method: 'POST', headers: { 'content-type': asset.mimeType, 'x-nextmux-device-id': await options.deviceId(),
                    'x-nextmux-history-id': id, 'x-nextmux-history-sha256': asset.sha256 },
                body: new Uint8Array(bytes), signal: controller.signal, redirect: 'error'
            });
            if ([404, 405].includes(response.status)) {
                await response.body?.cancel().catch(() => undefined);
                // Old deployments retain the original output object. Never take this fallback after a
                // successful or uncertain deletion acknowledgment for any referenced asset.
                if (await options.legacyAvailable([...assets.values()].map(value => value.asset))) {
                    const legacyBody = transformed(true);
                    if (Buffer.byteLength(JSON.stringify(legacyBody)) <= MAX_BODY_BYTES) return { body: legacyBody, uploadIds: [...replacements.values()], legacy: true };
                }
                throw new Error('MANAGED_HISTORY_TRANSPORT_UNAVAILABLE');
            }
            if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error('MANAGED_HISTORY_UPLOAD_FAILED'); }
            const payload = JSON.parse(Buffer.from(await readBoundedResponseBody(response, 4096)).toString('utf8'));
            if (payload?.ok !== true || payload.id !== id || payload.sha256 !== asset.sha256 || payload.mimeType !== asset.mimeType
                || payload.sizeBytes !== asset.sizeBytes || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now()) {
                throw new Error('MANAGED_HISTORY_UPLOAD_INVALID');
            }
            replacements.set(assetKey(asset), id); result = transformed();
            if (Buffer.byteLength(JSON.stringify(result)) <= SAFE_BODY_BYTES) return { body: result, uploadIds: [...replacements.values()], legacy: false };
        } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
    }
    if (Buffer.byteLength(JSON.stringify(result)) <= MAX_BODY_BYTES) return { body: result, uploadIds: [...replacements.values()], legacy: false };
    throw new Error('MANAGED_HISTORY_REQUEST_TOO_LARGE');
}
