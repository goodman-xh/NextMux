/**
 * A generated picture is kept only when it is a whole file (audit B03-05): the full signature, the container's own
 * length or end marker, and the first block a decoder needs. A truncated download or a two-byte "PNG" is refused
 * instead of being saved and reported as done.
 */
export interface CompleteImageType {
    readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif';
    readonly extension: 'png' | 'jpg' | 'webp' | 'gif' | 'avif';
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function completeImageType(bytes: Uint8Array): CompleteImageType | undefined {
    if (bytes.byteLength < 16) return undefined;
    const ascii = (start: number, end: number): string => String.fromCharCode(...bytes.subarray(start, end));
    if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
        // IHDR first, IEND (with its CRC) last.
        return ascii(12, 16) === 'IHDR' && bytes.byteLength >= 8 + 25 + 12 && ascii(bytes.byteLength - 8, bytes.byteLength - 4) === 'IEND'
            ? { mimeType: 'image/png', extension: 'png' } : undefined;
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        // SOI at the start, EOI at the end (a few trailing padding bytes are tolerated).
        for (let index = bytes.byteLength - 2; index >= Math.max(2, bytes.byteLength - 64); index--) {
            if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return { mimeType: 'image/jpeg', extension: 'jpg' };
        }
        return undefined;
    }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
        const riffSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
        return riffSize + 8 <= bytes.byteLength && riffSize >= 12 && /^VP8[ LX]$/.test(ascii(12, 16))
            ? { mimeType: 'image/webp', extension: 'webp' } : undefined;
    }
    // AVIF (ISO-BMFF): the ftyp box and a declared size that fits the file.
    if (ascii(4, 8) === 'ftyp' && /^(avif|avis)$/.test(ascii(8, 12))) {
        const boxSize = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
        return boxSize >= 16 && boxSize < bytes.byteLength ? { mimeType: 'image/avif', extension: 'avif' } : undefined;
    }
    if ((ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') && bytes[bytes.byteLength - 1] === 0x3b) {
        return { mimeType: 'image/gif', extension: 'gif' };
    }
    return undefined;
}
