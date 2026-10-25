/** A UUID-shaped identifier that is always the same for the same text (four FNV-1a rounds; not random). */
export function stableUuid(text: string): string {
    const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map(seed => {
        let hash = seed >>> 0;
        for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
        return hash.toString(16).padStart(8, '0');
    }).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A short, stable digest of a media request's input (FNV-1a), part of a filming job's idempotency key. */
export function deskInputDigest(input: unknown): string {
    const text = JSON.stringify(input) || '';
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
}
