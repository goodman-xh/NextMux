import type { AgentMessageAttachment } from '@nextmux/agent-runtime';
import { hasSafeImageDimensions } from '@nextmux/model-runtime';

/** Stay below the existing 4 MiB request / 8 MiB checkpoint budgets. Oversized
 * observations are described explicitly, never silently sent as broken base64. */
export const MCP_IMAGE_TOTAL_BYTES = 2 * 1024 * 1024;
export const MCP_IMAGE_MAX_COUNT = 8;
export const MCP_TEXT_MAX_CHARS = 60_000;
const SUPPORTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
type Image = Extract<AgentMessageAttachment, { kind: 'image' }>;

export function truncateMcpToolTextHeadTail(text: string, maxChars = MCP_TEXT_MAX_CHARS): {
    readonly type: 'text';
    readonly text: string;
    readonly truncated?: true;
    readonly originalLength?: number;
} {
    if (text.length <= maxChars) {
        return { type: 'text', text };
    }
    const roughOmitted = Math.max(1, text.length - maxChars);
    const provisionalMarker = `\n…[truncated: ${roughOmitted} of ${text.length} characters not shown]…\n`;
    const available = Math.max(0, maxChars - provisionalMarker.length);
    const headChars = Math.floor((available * 2) / 3);
    const tailChars = Math.max(0, available - headChars);
    const omitted = text.length - (headChars + tailChars);
    const marker = `\n…[truncated: ${omitted} of ${text.length} characters not shown]…\n`;
    const finalTailChars = Math.max(0, Math.min(tailChars, maxChars - headChars - marker.length));
    const finalOmitted = text.length - (headChars + finalTailChars);
    const finalMarker = `\n…[truncated: ${finalOmitted} of ${text.length} characters not shown]…\n`;
    return {
        type: 'text',
        text: `${text.slice(0, headChars)}${finalMarker}${finalTailChars > 0 ? text.slice(text.length - finalTailChars) : ''}`,
        truncated: true,
        originalLength: text.length
    };
}

export function mcpImageAttachments(content: readonly unknown[]): {
    attachments: readonly Image[]; descriptions: ReadonlyMap<number, Readonly<Record<string, unknown>>>;
} {
    const attachments: Image[] = [], descriptions = new Map<number, Readonly<Record<string, unknown>>>();
    let total = 0;
    content.slice(0, 32).forEach((raw, index) => {
        if (!raw || typeof raw !== 'object') return;
        const kind = (raw as { type?: unknown }).type;
        let dataValue: unknown;
        let mimeValue: unknown;
        let resourceUri: string | undefined;
        let descType: 'image' | 'resource' = 'image';
        if (kind === 'image') {
            const item = raw as { data?: unknown; mimeType?: unknown };
            dataValue = item.data;
            mimeValue = item.mimeType;
        } else if (kind === 'resource') {
            const res = (raw as { resource?: unknown }).resource;
            if (!res || typeof res !== 'object' || Array.isArray(res)) return;
            const resObj = res as { blob?: unknown; mimeType?: unknown; uri?: unknown };
            if (resObj.blob === undefined) return;
            const mimeStr = String(resObj.mimeType || '').toLowerCase();
            if (!SUPPORTED_IMAGE_MIMES.has(mimeStr) && !mimeStr.startsWith('image/')) return;
            dataValue = resObj.blob;
            mimeValue = resObj.mimeType;
            resourceUri = typeof resObj.uri === 'string' ? resObj.uri.slice(0, 512) : undefined;
            descType = 'resource';
        } else {
            return;
        }
        let reason: string | undefined;
        if (!SUPPORTED_IMAGE_MIMES.has(String(mimeValue))) reason = 'Unsupported image format';
        else if (attachments.length >= MCP_IMAGE_MAX_COUNT) reason = 'Tool returned more than 8 images';
        else if (typeof dataValue !== 'string' || !dataValue || dataValue.length > Math.ceil(MCP_IMAGE_TOTAL_BYTES / 3) * 4
            || dataValue.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataValue)) reason = 'Image is invalid or exceeds the 2 MiB tool image budget';
        let bytes: Buffer | undefined;
        if (!reason) {
            bytes = Buffer.from(dataValue as string, 'base64');
            if (bytes.toString('base64') !== dataValue || !hasSafeImageDimensions(bytes, mimeValue as string)) reason = 'Image header, dimensions or encoding are invalid';
            else if (total + bytes.length > MCP_IMAGE_TOTAL_BYTES) reason = 'Images exceed the 2 MiB tool image budget';
        }
        if (reason) {
            descriptions.set(index, { type: descType, ...(resourceUri ? { uri: resourceUri } : {}), omitted: true, reason });
            return;
        }
        const name = `tool-image-${index + 1}`;
        attachments.push({ kind: 'image', name, mimeType: mimeValue as Image['mimeType'], dataBase64: dataValue as string });
        total += bytes!.length;
        descriptions.set(index, { type: descType, name, mimeType: mimeValue, ...(resourceUri ? { uri: resourceUri } : {}), attached: true });
    });
    return { attachments, descriptions };
}
