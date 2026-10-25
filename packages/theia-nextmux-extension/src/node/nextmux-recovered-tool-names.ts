import { createHash } from 'crypto';
/** Reconstruct the existing gateway wire aliases from the original local
 * request. Recovery never persists the tool schema or prompt on the server. */
export function restoreManagedRecoveredTools<T extends { readonly response: { readonly toolCalls: readonly { readonly name: string }[] } }>(result: T,
    request: { readonly tools: readonly { readonly name: string }[]; readonly messages: readonly { readonly toolCalls?: readonly { readonly name: string }[] }[] }): T {
    if ((result as T & { recovery?: { source?: string } }).recovery?.source !== 'provider_resource') return result;
    const originals = [...new Set([...request.tools.map(tool => tool.name), ...request.messages.flatMap(message => (message.toolCalls || []).map(call => call.name))])];
    const names = new Set(originals), decoded = new Map<string, string>(), valid = /^[A-Za-z0-9_-]{1,64}$/;
    const hex = (value: string) => createHash('sha256').update(value).digest('hex');
    const readableOf = (name: string) => name.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const hashed = (name: string) => `nmx_${hex(name).slice(0, 12)}_${(readableOf(name) || 'tool').slice(0, 47)}`;
    for (const name of originals) {
        let alias = valid.test(name) ? name : valid.test(readableOf(name)) ? readableOf(name) : hashed(name);
        const taken = decoded.get(alias);
        if (taken && taken !== name || alias !== name && names.has(alias)) alias = hashed(name);
        if (decoded.has(alias) && decoded.get(alias) !== name) alias = `nmx_${hex(`collision:${name}`).slice(0, 20)}`;
        decoded.set(alias, name);
    }
    return { ...result, response: { ...result.response, toolCalls: result.response.toolCalls.map(call => ({ ...call, name: decoded.get(call.name) || call.name })) } };
}
