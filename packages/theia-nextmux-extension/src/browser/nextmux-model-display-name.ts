const compactProviderIdentity = (value: string): string => value
    .replace(/^~/, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const providerBaseIdentity = (value: string): string => compactProviderIdentity(value)
    .replace(/(?:artificialintelligence|ai|labs?|cloud|research)$/u, '');

const sameProviderIdentity = (left: string, right: string): boolean => {
    const compactLeft = compactProviderIdentity(left);
    const compactRight = compactProviderIdentity(right);
    if (!compactLeft || !compactRight) return false;
    if (compactLeft === compactRight) return true;
    const baseLeft = providerBaseIdentity(left);
    const baseRight = providerBaseIdentity(right);
    return baseLeft.length >= 3 && baseLeft === baseRight;
};

export function modelDisplayNameOnly(
    displayName: string,
    providerName = '',
    canonicalModel = '',
    fallback = ''
): string {
    const canonicalFallback = canonicalModel.replace(/^~/, '').split('/').pop()?.trim() || '';
    const source = displayName.trim() || fallback.trim() || canonicalFallback;
    if (!source) return '未命名模型';
    const providerCandidates = [...new Set([
        providerName,
        canonicalModel.replace(/^~/, '').split('/')[0] || ''
    ].map(value => value.trim()).filter(Boolean))];
    const isProviderIdentity = (value: string): boolean => providerCandidates.some(candidate => sameProviderIdentity(value, candidate));
    let label = source;

    const namespacedLabel = label.match(/^(?:[^/\s]{1,80}\/)+([^/]+)$/u);
    if (namespacedLabel) label = namespacedLabel[1].trim();

    const colonPrefix = label.match(/^([^:：]{1,80})\s*[:：]\s*(.+)$/u);
    if (colonPrefix && isProviderIdentity(colonPrefix[1])) label = colonPrefix[2].trim();

    const tokenPrefix = label.match(/^(\S{1,80})\s+(.+)$/u);
    if (tokenPrefix && isProviderIdentity(tokenPrefix[1])) {
        const family = providerBaseIdentity(tokenPrefix[1]);
        // A vendor can also name the model family (Qwen 3, MiniMax 01, Aion 3).
        // Keep that identity unless it is merely a wrapper or repeated in the name.
        const namesModelFamily = !canonicalFallback || compactProviderIdentity(canonicalFallback).startsWith(family);
        if (!namesModelFamily || compactProviderIdentity(tokenPrefix[2]).startsWith(family)) label = tokenPrefix[2].trim();
    }

    const separatorSuffix = label.match(/^(.+?)\s*[·|]\s*([^·|]+)$/u);
    if (separatorSuffix && isProviderIdentity(separatorSuffix[2])) label = separatorSuffix[1].trim();

    const parentheticalSuffix = label.match(/^(.+?)\s+\(([^()]{1,80})\)$/u);
    if (parentheticalSuffix && isProviderIdentity(parentheticalSuffix[2])) label = parentheticalSuffix[1].trim();

    return label || fallback.trim() || canonicalFallback || source;
}
