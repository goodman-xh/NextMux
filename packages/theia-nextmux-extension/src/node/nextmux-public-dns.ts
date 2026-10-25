import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { AgentToolError } from '@nextmux/agent-runtime';

/** Only the benchmark pool commonly used by local fake-IP resolvers qualifies.
 * Other private/reserved, mixed, malformed and IPv6 results never opt in. */
export function allBenchmarkDnsAddresses(addresses: readonly LookupAddress[]): boolean {
    return addresses.length > 0 && addresses.length <= 64 && addresses.every(entry => entry.family === 4
        && isIP(entry.address) === 4 && /^198\.(?:18|19)\./.test(entry.address));
}

function dnsName(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 254) return undefined;
    const name = value.toLowerCase().replace(/\.$/, '');
    if (name.length > 253 || !name.includes('.') || isIP(name)
        || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(name)
        || !name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return undefined;
    return name;
}
const invalid = (): never => { throw new AgentToolError('PUBLIC_DNS_REQUIRED', 'Trusted public DNS returned no usable public address or an invalid answer.'); };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Strictly bind a trusted HTTPS DNS answer to the requested name/type. No
 * address from Authority/Additional or an unrelated owner is ever used. */
export function trustedDohAddresses(value: unknown, hostname: string, type: 1 | 28,
    publicAddress: (address: string) => boolean): readonly LookupAddress[] {
    const name = dnsName(hostname);
    if (!name || !record(value) || value.Status !== 0 || value.TC !== false || value.CD !== false
        || !Array.isArray(value.Question) || value.Question.length !== 1) return invalid();
    const question = value.Question[0];
    if (!record(question) || dnsName(question.name) !== name || question.type !== type) return invalid();
    if (value.Answer === undefined) return [];
    if (!Array.isArray(value.Answer) || value.Answer.length > 64) return invalid();
    const aliases = new Map<string, string>();
    const addressRecords: { owner: string; address: string }[] = [];
    for (const answer of value.Answer) {
        if (!record(answer) || !Number.isSafeInteger(answer.TTL) || (answer.TTL as number) < 0) return invalid();
        const owner = dnsName(answer.name);
        if (!owner || typeof answer.data !== 'string') return invalid();
        if (answer.type === 5) {
            const target = dnsName(answer.data);
            if (!target || aliases.has(owner)) return invalid();
            aliases.set(owner, target);
        } else if (answer.type === type) {
            if (isIP(answer.data) !== (type === 1 ? 4 : 6) || !publicAddress(answer.data)) return invalid();
            addressRecords.push({ owner, address: answer.data });
        } else return invalid();
    }
    const visited = new Set<string>();
    let finalOwner = name;
    while (aliases.has(finalOwner)) {
        if (visited.has(finalOwner) || visited.size >= 16) return invalid();
        visited.add(finalOwner);
        finalOwner = aliases.get(finalOwner)!;
    }
    if (visited.has(finalOwner) || aliases.size !== visited.size || addressRecords.some(entry => entry.owner !== finalOwner)) return invalid();
    return addressRecords.map(entry => ({ address: entry.address, family: type === 1 ? 4 : 6 }));
}
