export const TEXT_ATTACHMENT_MAX_BYTES = 512 * 1024;
export const TEXT_ATTACHMENT_MAX_CHARACTERS = 120_000;

export class TextAttachmentDecodeError extends Error {
    constructor(readonly reason: 'invalid' | 'too_large') { super(`TEXT_ATTACHMENT_${reason.toUpperCase()}`); }
}

/** UTF-8 by default. A UTF-16 BOM is explicit evidence, never an encoding guess. */
export function decodeTextAttachment(bytes: Uint8Array): string {
    if (bytes.byteLength > TEXT_ATTACHMENT_MAX_BYTES) throw new TextAttachmentDecodeError('too_large');
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    let content: string;
    try { content = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new TextAttachmentDecodeError('invalid'); }
    if (content.includes('\0')) throw new TextAttachmentDecodeError('invalid');
    if (content.length > TEXT_ATTACHMENT_MAX_CHARACTERS) throw new TextAttachmentDecodeError('too_large');
    return content;
}
