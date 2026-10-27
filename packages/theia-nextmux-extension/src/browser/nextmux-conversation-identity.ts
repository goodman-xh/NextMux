export function compactConversationId(value: string, prefixLength = 8, suffixLength = 4): string {
    const id = value.trim();
    if (!id) return '—';
    if (id.length <= prefixLength + suffixLength + 1) return id;
    return `${id.slice(0, prefixLength)}…${id.slice(-suffixLength)}`;
}
