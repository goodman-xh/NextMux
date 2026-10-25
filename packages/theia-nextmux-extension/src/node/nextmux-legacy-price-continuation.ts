import { randomUUID } from 'crypto';
import { mkdir, open, readFile, rename, unlink, lstat } from 'fs/promises';
import { dirname, join } from 'path';
import { authorityBodyHash, normalizedAuthorityOrigin, syncAuthorityDirectory } from './nextmux-managed-task-authority';
const lockfile = require('proper-lockfile') as { lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>> };
const locks = new Map<string, Promise<unknown>>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export interface LegacyPriceReplacement { version: 1; authority: 'legacy'; originalRequestId: string; clientNonce: string; requestHash: string; }
export interface LegacyPriceContinuation { version: 1; originHash: string; ownerHash: string; bodyHash: string; parentKeyHash: string; requestKey: string;
    replacement: LegacyPriceReplacement; submissionCount?: number; delivery: 'ready' | 'submitted' | 'cancelled'; }
export interface LegacyPriceScope { root: string; platformOrigin: string; userId: string; requestKey: string; body: unknown; }
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
function pathFor(options: Pick<LegacyPriceScope, 'root' | 'platformOrigin' | 'requestKey'>): string {
    return join(options.root, 'managed-price-continuation', authorityBodyHash(normalizedAuthorityOrigin(options.platformOrigin)), authorityBodyHash(options.requestKey) + '.json');
}
function validProof(value: LegacyPriceReplacement): boolean {
    return value?.version === 1 && value.authority === 'legacy' && uuid.test(value.originalRequestId) && uuid.test(value.clientNonce) && /^[a-f0-9]{64}$/.test(value.requestHash);
}
export function legacyPriceReplacementKey(proof: LegacyPriceReplacement): string {
    if (!validProof(proof)) fail('LEGACY_PRICE_REPLACEMENT_INVALID');
    return `price-revision:${proof.originalRequestId}:${proof.clientNonce}`;
}
async function read(path: string): Promise<LegacyPriceContinuation | undefined> {
    try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) fail('LEGACY_PRICE_JOURNAL_INVALID'); const value = JSON.parse(await readFile(path, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('LEGACY_PRICE_JOURNAL_INVALID'); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function hasLegacyPriceContinuation(options: Pick<LegacyPriceScope, 'root' | 'platformOrigin' | 'requestKey'>): Promise<boolean> { return Boolean(await read(pathFor(options))); }
function validate(options: LegacyPriceScope, value: LegacyPriceContinuation): void {
    if (!options.userId || !options.requestKey || options.requestKey.length > 200 || value.version !== 1
        || value.originHash !== authorityBodyHash(normalizedAuthorityOrigin(options.platformOrigin)) || value.ownerHash !== authorityBodyHash(options.userId)
        || value.bodyHash !== authorityBodyHash(options.body) || value.parentKeyHash !== authorityBodyHash(options.requestKey)
        || !validProof(value.replacement) || value.requestKey !== legacyPriceReplacementKey(value.replacement)
        || value.submissionCount !== undefined && (!Number.isSafeInteger(value.submissionCount) || value.submissionCount < 0)
        || !['ready', 'submitted', 'cancelled'].includes(value.delivery)) fail('LEGACY_PRICE_JOURNAL_CONFLICT');
}
export async function loadLegacyPriceContinuation(options: LegacyPriceScope): Promise<LegacyPriceContinuation | undefined> {
    const saved = await read(pathFor(options)); if (saved) validate(options, saved); return saved;
}
async function directory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) fail('LEGACY_PRICE_JOURNAL_INVALID');
    await syncAuthorityDirectory(dirname(path));
}
async function atomic(path: string, value: LegacyPriceContinuation): Promise<void> {
    const temporary = path + '.' + randomUUID() + '.tmp', file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    try { await rename(temporary, path); await syncAuthorityDirectory(dirname(path)); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
async function serialized<T>(path: string, work: () => Promise<T>): Promise<T> {
    const prior = locks.get(path) || Promise.resolve(), result = prior.catch(() => undefined).then(async () => {
        let compromised: Error | undefined;
        const release = await lockfile.lock(path, { realpath: false, stale: 60000, update: 10000,
            retries: { retries: 50, minTimeout: 100, maxTimeout: 1000 }, onCompromised: (error: Error) => { compromised = error; } });
        try { const value = await work(); if (compromised) throw compromised; return value; } finally { await release(); }
    });
    locks.set(path, result); try { return await result; } finally { if (locks.get(path) === result) locks.delete(path); }
}
/** Only an authenticated, settled zero-charge receipt may authorize a child.
 * The immutable parent link and full local body hash reach disk before POST. */
export async function prepareLegacyPriceContinuation(options: LegacyPriceScope & { replacement: LegacyPriceReplacement;
    expectedRequestId?: string; expectedServerHash?: string }): Promise<LegacyPriceContinuation> {
    if (!options.userId || !options.requestKey || (options.body as Record<string, unknown>)?.pricePolicy !== 'current'
        || !validProof(options.replacement) || options.expectedRequestId && options.expectedRequestId !== options.replacement.originalRequestId
        || options.expectedServerHash && options.expectedServerHash !== options.replacement.requestHash) fail('LEGACY_PRICE_REPLACEMENT_INVALID');
    const path = pathFor(options), parent = dirname(path);
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    await directory(dirname(parent)); await directory(parent);
    return serialized(parent, async () => {
        const prior = await loadLegacyPriceContinuation(options);
        if (prior) {
            if (authorityBodyHash(prior.replacement) !== authorityBodyHash(options.replacement)) fail('LEGACY_PRICE_REPLACEMENT_CONFLICT');
            return prior;
        }
        const saved: LegacyPriceContinuation = { version: 1, originHash: authorityBodyHash(normalizedAuthorityOrigin(options.platformOrigin)),
            ownerHash: authorityBodyHash(options.userId), parentKeyHash: authorityBodyHash(options.requestKey), bodyHash: authorityBodyHash(options.body),
            requestKey: legacyPriceReplacementKey(options.replacement), replacement: options.replacement, delivery: 'ready' };
        if (saved.requestKey === options.requestKey) fail('LEGACY_PRICE_REPLACEMENT_CONFLICT');
        await atomic(path, saved); return saved;
    });
}
/** A crashed or second observer can recover by key but cannot submit again. */
export async function claimLegacyPriceContinuation(options: LegacyPriceScope & { expectedSubmittedCount?: number }): Promise<boolean> {
    const path = pathFor(options);
    return serialized(dirname(path), async () => {
        const saved = await loadLegacyPriceContinuation(options); if (!saved) fail('LEGACY_PRICE_JOURNAL_INVALID');
        const count = saved.submissionCount ?? (saved.delivery === 'submitted' ? 1 : 0);
        if (options.expectedSubmittedCount === undefined ? saved.delivery !== 'ready'
            : saved.delivery !== 'submitted' || options.expectedSubmittedCount !== count) return false;
        await atomic(path, { ...saved, delivery: 'submitted', submissionCount: count + 1 }); return true;
    });
}
export async function cancelLegacyPriceContinuation(options: LegacyPriceScope & { confirmedServerCancellation?: boolean }): Promise<boolean> {
    const path = pathFor(options);
    return serialized(dirname(path), async () => {
        const saved = await loadLegacyPriceContinuation(options); if (!saved) fail('LEGACY_PRICE_JOURNAL_INVALID');
        if (saved.delivery === 'cancelled') return true;
        // A stale ready observation cannot overwrite a concurrent submitted child.
        if (saved.delivery !== 'ready' && options.confirmedServerCancellation !== true) return false;
        await atomic(path, { ...saved, delivery: 'cancelled' }); return true;
    });
}
