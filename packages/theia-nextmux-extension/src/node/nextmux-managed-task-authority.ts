import { createHash, randomUUID } from 'crypto';
import { mkdir, open, readFile, rename, unlink, lstat, readdir } from 'fs/promises';
import { join, dirname } from 'path';
const lockfile = require('proper-lockfile') as { lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>> };
const locks = new Map<string, Promise<unknown>>();
const initializedDirectories = new Map<string, Promise<void>>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
export const authorityBodyHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
export type ManagedTaskDelivery = 'ready' | 'submitted' | 'waiting_capacity' | 'cancel_requested' | 'cancelled';
export type ManagedTaskAuthority = { readonly mode: 'legacy' } | { readonly mode: 'task'; readonly authorityRef: string; readonly requestId: string; readonly submissionState?: ManagedTaskDelivery };
export interface ManagedPriceReplacement { version: 1; authority: 'task'; originalRequestId: string; clientNonce: string; bodyHash: string; }
interface Journal { priceReplacement?: ManagedPriceReplacement; replacesRequestId?: string; version: 1; originHash: string; ownerHash: string; keyHash: string; bodyHash: string; mode: 'legacy' | 'task'; clientNonce?: string; createdAt: number; authorityRef?: string; requestId?: string; delivery?: ManagedTaskDelivery; }
export function normalizedAuthorityOrigin(baseUrl: string): string {
    let url: URL; try { url = new URL(baseUrl); } catch { return fail('TASK_AUTHORITY_ORIGIN_INVALID'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) fail('TASK_AUTHORITY_ORIGIN_INVALID');
    return url.origin;
}
function requestDirectory(root: string, baseUrl: string, requestKey: string): string {
    return join(root, 'managed-request-authority', authorityBodyHash(normalizedAuthorityOrigin(baseUrl)), authorityBodyHash(requestKey));
}
export async function hasManagedRequestAuthority(root: string, baseUrl: string, requestKey: string): Promise<boolean> {
    try { const info = await lstat(requestDirectory(root, baseUrl, requestKey)); if (!info.isDirectory() || info.isSymbolicLink()) fail('TASK_AUTHORITY_JOURNAL_INVALID'); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
/** Negotiate current prices only for a new call. Recovery must reproduce the
 * exact original body, including whether it predates this protocol field. */
export async function resolveManagedRequestPricePolicy(options: {
    root: string; platformOrigin: string; userId: string; requestKey: string;
    body: Record<string, unknown>; firstSubmit?: boolean;
}): Promise<Record<string, unknown>> {
    const { root, platformOrigin, userId, requestKey, body } = options;
    if (!root || !userId || userId.length > 200 || !requestKey || requestKey.length > 200) fail('TASK_AUTHORITY_ARGUMENT_INVALID');
    const originHash = authorityBodyHash(normalizedAuthorityOrigin(platformOrigin)), ownerHash = authorityBodyHash(userId);
    const { pricePolicy: _policy, ...withoutPolicy } = body;
    const candidates = body.pricePolicy === undefined ? [body, { ...body, pricePolicy: 'current' }]
        : body.pricePolicy === 'current' ? [body, withoutPolicy] : [body];
    const proofs: { hash: string; code: string }[] = [];
    if (await hasManagedRequestAuthority(root, platformOrigin, requestKey)) {
        const directory = requestDirectory(root, platformOrigin, requestKey), names = (await readdir(directory)).filter(name => name.endsWith('.json'));
        if (names.some(name => name !== ownerHash + '.json')) fail('TASK_AUTHORITY_ACCOUNT_CHANGED');
        const saved = await readJournal(join(directory, ownerHash + '.json'));
        if (saved) {
            if (saved.version !== 1 || saved.originHash !== originHash || saved.ownerHash !== ownerHash
                || saved.keyHash !== authorityBodyHash([originHash, userId, requestKey])
                || !/^[a-f0-9]{64}$/.test(saved.bodyHash) || !['legacy', 'task'].includes(saved.mode)) fail('TASK_AUTHORITY_JOURNAL_CONFLICT');
            proofs.push({ hash: saved.bodyHash, code: 'TASK_AUTHORITY_JOURNAL_CONFLICT' });
        }
    }
    if (await hasLegacyCapacityJournal(options)) {
        const saved = await readJournal(legacyCapacityPath(options)) as unknown as LegacyCapacityJournal;
        if (!saved || saved.version !== 1 || saved.originHash !== originHash || saved.ownerHash !== ownerHash
            || saved.keyHash !== authorityBodyHash(requestKey) || !uuid.test(saved.requestId)
            || !/^[a-f0-9]{64}$/.test(saved.bodyHash) || !/^[a-f0-9]{64}$/.test(saved.serverBodyHash)
            || !['waiting_capacity', 'submitted', 'cancel_requested', 'cancelled'].includes(saved.delivery)) fail('CAPACITY_JOURNAL_CONFLICT');
        proofs.push({ hash: saved.bodyHash, code: 'CAPACITY_JOURNAL_CONFLICT' });
    }
    if (proofs.length) {
        // A desktop upgrade or a settings change must not rewrite an accepted
        // request. Reconstruct only the finite privacy representations we
        // have emitted, and use one only if every durable owner-scoped hash
        // matches exactly. Prompt, route, tools, quote and budget stay intact.
        // Transcription hashes its multipart identity with the route nested.
        const nestedPrivacy = !body.privacyPreference && typeof body.audioBase64 === 'string'
            && body.route && typeof body.route === 'object' && !Array.isArray(body.route);
        const privacyFields = (nestedPrivacy ? body.route : body) as Record<string, unknown>;
        const preference = privacyFields.privacyPreference as Record<string, unknown> | undefined;
        if (preference?.mode === 'advisory-v1' && typeof preference.zeroDataRetention === 'boolean'
            && ['allow', 'deny'].includes(String(preference.dataCollection))
            && Object.keys(preference).every(key => ['mode', 'zeroDataRetention', 'dataCollection'].includes(key))) {
            for (const candidate of [...candidates]) {
                const fields = (nestedPrivacy ? candidate.route : candidate) as Record<string, unknown>;
                const { privacyPreference: _preference, ...legacy } = fields;
                for (const zeroDataRetention of [false, true]) {
                    for (const dataCollection of ['allow', 'deny']) {
                        const currentFields = { ...fields, privacyPreference: { mode: 'advisory-v1', zeroDataRetention, dataCollection } };
                        const legacyFields = { ...legacy, zeroDataRetention, dataCollection };
                        candidates.push(nestedPrivacy ? { ...candidate, route: currentFields } : currentFields);
                        candidates.push(nestedPrivacy ? { ...candidate, route: legacyFields } : legacyFields);
                    }
                }
            }
        }
        const matched = candidates.find(candidate => proofs.every(proof => proof.hash === authorityBodyHash(candidate)));
        if (!matched) fail(proofs.at(-1)!.code);
        return matched;
    }
    return options.firstSubmit === true && body.pricePolicy === undefined ? { ...body, pricePolicy: 'current' } : body;
}
/** File fsync + same-directory rename are always required. Windows can reject
 * directory handles/fsync; only documented unsupported handle errors are
 * ignored there, never file writes or arbitrary I/O failures. */
export async function syncAuthorityDirectory(path: string, platform: string = process.platform,
    opener: typeof open = open): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try { handle = await opener(path, 'r'); await handle.sync(); }
    catch (error) { if (platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EBADF'].includes((error as NodeJS.ErrnoException).code || '')) throw error; }
    finally { await handle?.close(); }
}
async function durableSharedDirectory(path: string): Promise<void> {
    let pending = initializedDirectories.get(path);
    if (!pending) {
        pending = (async () => {
            await mkdir(path, { recursive: true, mode: 0o700 });
            const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) fail('TASK_AUTHORITY_JOURNAL_INVALID');
            // Do not treat EEXIST as proof of durability: another process may
            // have created the directory but not synced its parent yet.
            await syncAuthorityDirectory(dirname(path));
        })();
        initializedDirectories.set(path, pending);
        void pending.catch(() => { if (initializedDirectories.get(path) === pending) initializedDirectories.delete(path); });
    }
    await pending;
}
function validateReference(token: string, userId: string, nonce: string, bodyHash: string, requestId: string): void {
    // The server owns signature verification. Check the authenticated reply's
    // public claims locally so a device relink cannot bind a new account's
    // token into the prior account's durable journal.
    try {
        const parts = token.split('.'); if (parts.length !== 3 || parts[0] !== 'nmx-ta1' || !parts[2] || token.length > 3000) fail('TASK_AUTHORITY_ADMISSION_INVALID');
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (claims.version !== 1 || claims.origin !== 'protocol_first_submit' || claims.userId !== userId || claims.clientNonce !== nonce || claims.bodyHash !== bodyHash || claims.requestId !== requestId) fail('TASK_AUTHORITY_ADMISSION_INVALID');
    } catch { fail('TASK_AUTHORITY_ADMISSION_INVALID'); }
}
function receiptIndexPath(root: string, platformOrigin: string, requestId: string): string {
    if (!uuid.test(requestId)) fail('TASK_AUTHORITY_ARGUMENT_INVALID');
    return join(root, 'managed-request-authority', authorityBodyHash(normalizedAuthorityOrigin(platformOrigin)), 'by-request', requestId + '.json');
}
async function publishReceiptIndex(root: string, platformOrigin: string, requestKey: string, saved: Journal): Promise<void> {
    const path = receiptIndexPath(root, platformOrigin, saved.requestId!);
    await durableSharedDirectory(dirname(path));
    const info = await lstat(dirname(path)); if (!info.isDirectory() || info.isSymbolicLink()) fail('TASK_AUTHORITY_JOURNAL_INVALID');
    const index = { version: 1, originHash: saved.originHash, ownerHash: saved.ownerHash, requestId: saved.requestId,
        requestKeyHash: authorityBodyHash(requestKey) };
    const previous = await readJournal(path) as unknown;
    if (previous && authorityBodyHash(previous) !== authorityBodyHash(index)) fail('TASK_AUTHORITY_JOURNAL_CONFLICT');
    if (!previous) await atomic(path, index);
    else await syncAuthorityDirectory(dirname(path)); // Retry a prior rename whose directory sync failed.
}
export async function hasManagedReceiptAuthority(root: string, platformOrigin: string, requestId: string): Promise<boolean> {
    if (!uuid.test(requestId)) return false; // Older receipt formats keep their existing route.
    return Boolean(await readJournal(receiptIndexPath(root, platformOrigin, requestId)));
}
async function receiptJournal(options: { root: string; platformOrigin: string; userId: string; requestId: string }): Promise<{ path: string; saved: Journal } | undefined> {
    const indexPath = receiptIndexPath(options.root, options.platformOrigin, options.requestId), index = await readJournal(indexPath) as unknown as Record<string, unknown> | undefined;
    if (!index) return undefined;
    if (index.version !== 1 || index.ownerHash !== authorityBodyHash(options.userId) || index.originHash !== authorityBodyHash(normalizedAuthorityOrigin(options.platformOrigin))
        || index.requestId !== options.requestId || typeof index.requestKeyHash !== 'string' || !/^[a-f0-9]{64}$/.test(index.requestKeyHash)) fail('TASK_AUTHORITY_JOURNAL_CONFLICT');
    const path = join(dirname(dirname(indexPath)), index.requestKeyHash, String(index.ownerHash) + '.json'), saved = await readJournal(path);
    if (!saved || saved.mode !== 'task' || saved.requestId !== options.requestId || saved.originHash !== index.originHash || saved.ownerHash !== index.ownerHash || !saved.authorityRef || !saved.clientNonce) fail('TASK_AUTHORITY_JOURNAL_INVALID');
    validateReference(saved.authorityRef, options.userId, saved.clientNonce, saved.bodyHash, options.requestId);
    return { path, saved };
}
export async function loadManagedReceiptAuthority(options: { root: string; platformOrigin: string; userId: string; requestId: string }): Promise<ManagedTaskAuthority | undefined> {
    const record = await receiptJournal(options); return record ? { mode: 'task', authorityRef: record.saved.authorityRef!, requestId: options.requestId, submissionState: record.saved.delivery || 'submitted' } : undefined;
}
type DeliveryOptions = { root: string; platformOrigin: string; userId: string; requestId: string };
/** Persist intent before transport. Existing journals without a phase are
 * conservatively unknown and may only query their original server task. */
export async function claimManagedTaskSubmission(options: DeliveryOptions & { body: unknown; waiting?: { requestId?: string; bodyHash?: string; canResume?: boolean } }): Promise<boolean> {
    const record = await receiptJournal(options); if (!record) fail('TASK_AUTHORITY_JOURNAL_INVALID');
    return serialized(dirname(record.path), async () => {
        const current = await receiptJournal(options); if (!current) fail('TASK_AUTHORITY_JOURNAL_INVALID');
        const saved = current.saved;
        if (authorityBodyHash(options.body) !== saved.bodyHash) fail('TASK_AUTHORITY_JOURNAL_CONFLICT');
        if (saved.delivery === 'cancel_requested' || saved.delivery === 'cancelled') return false;
        if (options.waiting) {
            if (options.waiting.requestId !== saved.requestId || options.waiting.bodyHash !== saved.bodyHash || options.waiting.canResume !== true) fail('TASK_AUTHORITY_RESUME_INVALID');
        } else if (saved.delivery !== 'ready') return false;
        await atomic(record.path, { ...saved, delivery: 'submitted' });
        return true;
    });
}
export async function recordManagedTaskDelivery(options: DeliveryOptions & { delivery: ManagedTaskDelivery }): Promise<void> {
    const record = await receiptJournal(options); if (!record) fail('TASK_AUTHORITY_JOURNAL_INVALID');
    await serialized(dirname(record.path), async () => {
        const current = await receiptJournal(options); if (!current) fail('TASK_AUTHORITY_JOURNAL_INVALID');
        if (current.saved.delivery === 'cancelled' && options.delivery !== 'cancelled') fail('TASK_AUTHORITY_CANCELLED');
        if (current.saved.delivery === 'cancel_requested' && options.delivery !== 'cancelled' && options.delivery !== 'cancel_requested') return;
        await atomic(record.path, { ...current.saved, delivery: options.delivery });
    });
}
export async function refreshManagedReceiptAuthority(options: { root: string; platformOrigin: string; userId: string; requestId: string;
    admit: (input: { existingOnly: true; clientNonce: string; bodyHash: string; requestId: string }) => Promise<unknown> }): Promise<ManagedTaskAuthority> {
    const record = await receiptJournal(options); if (!record) fail('TASK_AUTHORITY_JOURNAL_INVALID');
    return serialized(dirname(record.path), async () => {
        const current = await receiptJournal(options); if (!current) fail('TASK_AUTHORITY_JOURNAL_INVALID');
        const saved = current.saved, value = await options.admit({ existingOnly: true, clientNonce: saved.clientNonce!, bodyHash: saved.bodyHash, requestId: options.requestId }) as Record<string, unknown>;
        if (value?.ok !== true || value.requestId !== saved.requestId || value.clientNonce !== saved.clientNonce || value.bodyHash !== saved.bodyHash || typeof value.authorityRef !== 'string') fail('TASK_AUTHORITY_ADMISSION_INVALID');
        validateReference(value.authorityRef, options.userId, saved.clientNonce!, saved.bodyHash, options.requestId);
        const claims = (token: string): unknown => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        if (authorityBodyHash(claims(value.authorityRef)) !== authorityBodyHash(claims(saved.authorityRef!))) fail('TASK_AUTHORITY_JOURNAL_CONFLICT');
        await atomic(record.path, { ...saved, authorityRef: value.authorityRef });
        return { mode: 'task', authorityRef: value.authorityRef, requestId: options.requestId };
    });
}
async function atomic(path: string, value: unknown): Promise<void> {
    const temporary = path + '.' + randomUUID() + '.tmp', file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    try { await rename(temporary, path); await syncAuthorityDirectory(dirname(path)); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
async function readJournal(path: string): Promise<Journal | undefined> {
    try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) fail('TASK_AUTHORITY_JOURNAL_INVALID'); return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
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
export async function managedRequestAuthority(options: {
    readonly root: string; readonly platformOrigin: string; readonly userId: string; readonly requestKey: string; readonly body: unknown;
    readonly firstSubmit?: boolean; readonly enrolled?: boolean; readonly replacement?: ManagedPriceReplacement; readonly admit?: (input: { clientNonce: string; bodyHash: string; body: unknown }) => Promise<unknown>;
}): Promise<ManagedTaskAuthority> {
    const { root, platformOrigin, userId, requestKey, body, firstSubmit, enrolled, admit, replacement } = options;
    if (!root || !userId || userId.length > 200 || !requestKey || requestKey.length > 200) fail('TASK_AUTHORITY_ARGUMENT_INVALID');
    const originHash = authorityBodyHash(normalizedAuthorityOrigin(platformOrigin)), ownerHash = authorityBodyHash(userId), keyHash = authorityBodyHash([originHash, userId, requestKey]), bodyHash = authorityBodyHash(body);
    if (replacement && (replacement.version !== 1 || replacement.authority !== 'task' || !uuid.test(replacement.originalRequestId) || !uuid.test(replacement.clientNonce)
        || replacement.bodyHash !== bodyHash || firstSubmit !== true || enrolled !== true)) fail('TASK_PRICE_REPLACEMENT_INVALID');
    const directory = requestDirectory(root, platformOrigin, requestKey);
    // Sync each new directory's parent so a durable nonce cannot disappear
    // merely because its newly-created directory entry was not committed.
    await mkdir(root, { recursive: true, mode: 0o700 });
    await durableSharedDirectory(join(root, 'managed-request-authority'));
    await durableSharedDirectory(dirname(directory));
    // Every request directory is synced conservatively, even on EEXIST.
    // Shared parent initialization is single-flight within this process; each
    // other process performs its own parent sync before using those parents.
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const directoryInfo = await lstat(directory); if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) fail('TASK_AUTHORITY_JOURNAL_INVALID');
    await syncAuthorityDirectory(dirname(directory));
    const path = join(directory, ownerHash + '.json');
    return serialized(directory, async () => {
        const owners = (await readdir(directory)).filter(name => name.endsWith('.json'));
        if (owners.some(name => name !== ownerHash + '.json')) fail('TASK_AUTHORITY_ACCOUNT_CHANGED');
        let saved = await readJournal(path), wroteDecision = false;
        if (saved && (saved.version !== 1 || saved.originHash !== originHash || saved.ownerHash !== ownerHash || saved.keyHash !== keyHash || saved.bodyHash !== bodyHash)) fail('TASK_AUTHORITY_JOURNAL_CONFLICT');
        if (saved && replacement && (saved.replacesRequestId !== replacement.originalRequestId || saved.clientNonce !== replacement.clientNonce)) fail('TASK_PRICE_REPLACEMENT_CONFLICT');
        const parentRequestId = replacement?.originalRequestId || saved?.replacesRequestId;
        if (parentRequestId) {
            const parent = await receiptJournal({ root, platformOrigin, userId, requestId: parentRequestId });
            if (!parent || parent.saved.bodyHash !== bodyHash) fail('TASK_PRICE_REPLACEMENT_INVALID');
            if (parent.saved.delivery === 'cancelled' || parent.saved.delivery === 'cancel_requested') fail('TASK_AUTHORITY_CANCELLED');
        }
        if (saved?.delivery === 'cancelled' && !saved.authorityRef) fail('TASK_AUTHORITY_CANCELLED');
        if (!saved) { const mode = firstSubmit === true && enrolled === true ? 'task' : 'legacy'; saved = { version: 1, originHash, ownerHash, keyHash, bodyHash, mode, ...(mode === 'task' ? { clientNonce: replacement?.clientNonce || randomUUID() } : {}), ...(replacement ? { replacesRequestId: replacement.originalRequestId } : {}), createdAt: Date.now() }; await atomic(path, saved); wroteDecision = true; }
        if (saved.mode === 'legacy') { if (!wroteDecision) await syncAuthorityDirectory(directory); return { mode: 'legacy' }; }
        if (saved.mode !== 'task' || !uuid.test(saved.clientNonce || '')) fail('TASK_AUTHORITY_JOURNAL_INVALID');
        if (saved.authorityRef) { if (!saved.authorityRef.startsWith('nmx-ta1.') || saved.authorityRef.length > 3000 || !uuid.test(saved.requestId || '')) fail('TASK_AUTHORITY_JOURNAL_INVALID'); validateReference(saved.authorityRef, userId, saved.clientNonce!, bodyHash, saved.requestId!); await syncAuthorityDirectory(directory); await publishReceiptIndex(root, platformOrigin, requestKey, saved); return { mode: 'task', authorityRef: saved.authorityRef, requestId: saved.requestId!, submissionState: saved.delivery || 'submitted' }; }
        if (!admit) fail('TASK_AUTHORITY_ADMISSION_UNAVAILABLE');
        const result = await admit({ clientNonce: saved.clientNonce!, bodyHash, body }) as Record<string, unknown> | undefined;
        if (replacement && result?.mode === 'legacy') fail('TASK_PRICE_REPLACEMENT_INVALID');
        if (result?.ok === true && result.mode === 'legacy' && result.clientNonce === saved.clientNonce && result.bodyHash === bodyHash) {
            saved = { version: 1, originHash, ownerHash, keyHash, bodyHash, mode: 'legacy', createdAt: saved.createdAt }; await atomic(path, saved); return { mode: 'legacy' };
        }
        if (result?.ok !== true || result.clientNonce !== saved.clientNonce || result.bodyHash !== bodyHash || typeof result.authorityRef !== 'string' || !result.authorityRef.startsWith('nmx-ta1.') || result.authorityRef.length > 3000 || typeof result.requestId !== 'string' || !uuid.test(result.requestId)) fail('TASK_AUTHORITY_ADMISSION_INVALID');
        validateReference(result.authorityRef, userId, saved.clientNonce!, bodyHash, result.requestId);
        saved = { ...saved, requestId: result.requestId, authorityRef: result.authorityRef, delivery: 'ready' }; await atomic(path, saved);
        await publishReceiptIndex(root, platformOrigin, requestKey, saved);
        return { mode: 'task', authorityRef: saved.authorityRef!, requestId: saved.requestId!, submissionState: 'ready' };
    });
}

/** Close proof comes from the authenticated original receipt. Preserve both
 * journals: a crash can only revisit the same deterministic child nonce. */
export async function continueManagedTaskAtCurrentPrice(options: {
    root: string; platformOrigin: string; userId: string; requestId: string; body: Record<string, unknown>;
    replacement: ManagedPriceReplacement;
    admit: (input: { clientNonce: string; body: unknown; replacementAuthorityRef: string }) => Promise<unknown>;
}): Promise<ManagedTaskAuthority> {
    const { replacement, body } = options;
    if (!replacement || replacement.version !== 1 || replacement.authority !== 'task' || replacement.originalRequestId !== options.requestId
        || !uuid.test(replacement.clientNonce) || !/^[a-f0-9]{64}$/.test(replacement.bodyHash)
        || replacement.bodyHash !== authorityBodyHash(body) || body.pricePolicy !== 'current') fail('TASK_PRICE_REPLACEMENT_INVALID');
    const record = await receiptJournal(options); if (!record) fail('TASK_AUTHORITY_JOURNAL_INVALID');
    const predecessor = await serialized(dirname(record.path), async () => {
        const current = await receiptJournal(options); if (!current) fail('TASK_AUTHORITY_JOURNAL_INVALID');
        if (current.saved.bodyHash !== replacement.bodyHash || current.saved.delivery === 'cancelled'
            || current.saved.delivery === 'cancel_requested') fail('TASK_PRICE_REPLACEMENT_INVALID');
        if (current.saved.priceReplacement && authorityBodyHash(current.saved.priceReplacement) !== authorityBodyHash(replacement)) fail('TASK_PRICE_REPLACEMENT_CONFLICT');
        if (!current.saved.priceReplacement) await atomic(current.path, { ...current.saved, priceReplacement: replacement });
        return current.saved.authorityRef!;
    });
    return managedRequestAuthority({ ...options, requestKey: `price-revision:${options.requestId}:${replacement.clientNonce}`,
        body, firstSubmit: true, enrolled: true, replacement,
        admit: input => options.admit({ clientNonce: input.clientNonce, body: input.body, replacementAuthorityRef: predecessor }) });
}

/** Admission alone has no wallet hold or provider dispatch. Stop a pending
 * linked admission locally before it can become a submission, preserving the
 * nonce even when its HTTP acknowledgement was lost. A submitted child must
 * use its existing receipt/cancellation path instead of claiming zero usage. */
export async function cancelPendingManagedTaskPriceReplacement(options: {
    root: string; platformOrigin: string; userId: string; requestId: string; body: Record<string, unknown>;
    replacement: ManagedPriceReplacement;
}): Promise<{ cancelled: true; requestId: string } | { cancelled: false; authority: Extract<ManagedTaskAuthority, { mode: 'task' }> }> {
    const { replacement, body } = options;
    if (!replacement || replacement.version !== 1 || replacement.authority !== 'task' || replacement.originalRequestId !== options.requestId
        || !uuid.test(replacement.clientNonce) || replacement.bodyHash !== authorityBodyHash(body) || body.pricePolicy !== 'current') fail('TASK_PRICE_REPLACEMENT_INVALID');
    const parent = await receiptJournal(options); if (!parent) fail('TASK_AUTHORITY_JOURNAL_INVALID');
    return serialized(dirname(parent.path), async () => {
        const current = await receiptJournal(options); if (!current || current.saved.bodyHash !== replacement.bodyHash) fail('TASK_PRICE_REPLACEMENT_INVALID');
        if (current.saved.priceReplacement && authorityBodyHash(current.saved.priceReplacement) !== authorityBodyHash(replacement)) fail('TASK_PRICE_REPLACEMENT_CONFLICT');
        const requestKey = `price-revision:${options.requestId}:${replacement.clientNonce}`;
        const directory = requestDirectory(options.root, options.platformOrigin, requestKey);
        let submitted: Extract<ManagedTaskAuthority, { mode: 'task' }> | undefined;
        // Create a cancelled nonce journal even if admission has not started.
        // This fences a concurrent continuation that already passed the parent
        // check and would otherwise create the child after cancellation.
        try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const directoryInfo = await lstat(directory); if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) fail('TASK_AUTHORITY_JOURNAL_INVALID');
        await syncAuthorityDirectory(dirname(directory));
        await serialized(directory, async () => {
                const ownerHash = authorityBodyHash(options.userId), originHash = authorityBodyHash(normalizedAuthorityOrigin(options.platformOrigin));
                if ((await readdir(directory)).filter(name => name.endsWith('.json')).some(name => name !== ownerHash + '.json')) fail('TASK_AUTHORITY_ACCOUNT_CHANGED');
                const path = join(directory, ownerHash + '.json'), saved = await readJournal(path);
                if (!saved) {
                    await atomic(path, { version: 1, originHash, ownerHash, keyHash: authorityBodyHash([originHash, options.userId, requestKey]),
                        bodyHash: replacement.bodyHash, mode: 'task', clientNonce: replacement.clientNonce, replacesRequestId: options.requestId, delivery: 'cancelled', createdAt: Date.now() });
                    return;
                }
                if (saved.version !== 1 || saved.originHash !== originHash || saved.ownerHash !== ownerHash
                    || saved.keyHash !== authorityBodyHash([originHash, options.userId, requestKey]) || saved.mode !== 'task'
                    || saved.bodyHash !== replacement.bodyHash || saved.clientNonce !== replacement.clientNonce
                    || saved.replacesRequestId !== options.requestId) fail('TASK_PRICE_REPLACEMENT_CONFLICT');
                if (saved.authorityRef) {
                    if (!uuid.test(saved.requestId || '')) fail('TASK_AUTHORITY_JOURNAL_INVALID');
                    validateReference(saved.authorityRef, options.userId, saved.clientNonce, saved.bodyHash, saved.requestId!);
                    if (saved.delivery !== 'ready' && saved.delivery !== 'cancelled') {
                        submitted = { mode: 'task', authorityRef: saved.authorityRef, requestId: saved.requestId!, submissionState: saved.delivery || 'submitted' };
                        return;
                    }
                } else if (saved.requestId || saved.delivery && saved.delivery !== 'cancelled') fail('TASK_AUTHORITY_JOURNAL_INVALID');
                if (saved.delivery !== 'cancelled') await atomic(path, { ...saved, delivery: 'cancelled' });
        });
        if (submitted) return { cancelled: false, authority: submitted };
        await atomic(current.path, { ...current.saved, priceReplacement: replacement, delivery: 'cancelled' });
        return { cancelled: true, requestId: options.requestId };
    });
}

export interface LegacyCapacityJournal {
    version: 1; originHash: string; ownerHash: string; keyHash: string; bodyHash: string;
    requestId: string; serverBodyHash: string; delivery: 'waiting_capacity' | 'submitted' | 'cancel_requested' | 'cancelled';
}
interface LegacyCapacityScope { root: string; platformOrigin: string; requestKey: string; userId: string; body: unknown; }
function legacyCapacityPath(options: Pick<LegacyCapacityScope, 'root' | 'platformOrigin' | 'requestKey'>): string {
    return join(options.root, 'managed-capacity-wait', authorityBodyHash(normalizedAuthorityOrigin(options.platformOrigin)), authorityBodyHash(options.requestKey) + '.json');
}
export async function hasLegacyCapacityJournal(options: Pick<LegacyCapacityScope, 'root' | 'platformOrigin' | 'requestKey'>): Promise<boolean> {
    try { const info = await lstat(legacyCapacityPath(options)); if (!info.isFile() || info.isSymbolicLink()) fail('CAPACITY_JOURNAL_INVALID'); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export async function legacyCapacityJournal(options: LegacyCapacityScope, update?: Pick<LegacyCapacityJournal, 'requestId' | 'serverBodyHash' | 'delivery'>): Promise<LegacyCapacityJournal | undefined> {
    if (!options.userId || !options.requestKey) fail('CAPACITY_JOURNAL_SCOPE_INVALID');
    const path = legacyCapacityPath(options), directory = dirname(path);
    if (!update && !await hasLegacyCapacityJournal(options)) return undefined;
    await durableSharedDirectory(join(options.root, 'managed-capacity-wait')); await durableSharedDirectory(directory);
    const identity = { version: 1 as const, originHash: authorityBodyHash(normalizedAuthorityOrigin(options.platformOrigin)), ownerHash: authorityBodyHash(options.userId), keyHash: authorityBodyHash(options.requestKey), bodyHash: authorityBodyHash(options.body) };
    return serialized(directory, async () => {
        let saved = await readJournal(path) as unknown as LegacyCapacityJournal | undefined;
        if (saved && (Object.entries(identity).some(([key, value]) => saved![key as keyof LegacyCapacityJournal] !== value)
            || !uuid.test(saved.requestId) || !/^[a-f0-9]{64}$/.test(saved.serverBodyHash)
            || !['waiting_capacity', 'submitted', 'cancel_requested', 'cancelled'].includes(saved.delivery))) fail('CAPACITY_JOURNAL_CONFLICT');
        if (!update) return saved;
        if (!uuid.test(update.requestId) || !/^[a-f0-9]{64}$/.test(update.serverBodyHash)) fail('CAPACITY_JOURNAL_INVALID');
        if (saved && (saved.requestId !== update.requestId || saved.serverBodyHash !== update.serverBodyHash)) fail('CAPACITY_JOURNAL_CONFLICT');
        if (saved?.delivery === 'cancelled' || saved?.delivery === 'cancel_requested' && !['cancel_requested', 'cancelled'].includes(update.delivery)) return saved;
        saved = { ...identity, ...update }; await atomic(path, saved); return saved;
    });
}

/** Cancellation from a reopened media queue needs identity metadata, never the original media bytes. */
export async function cancelLegacyCapacityJournal(options: Omit<LegacyCapacityScope, 'body'>,
    cancel: (requestId: string) => Promise<{ok: boolean; requestId: string}>): Promise<boolean> {
    if (!await hasLegacyCapacityJournal(options)) return false;
    const path = legacyCapacityPath(options), directory = dirname(path);
    const saved = await serialized(directory, async () => {
        const value = await readJournal(path) as unknown as LegacyCapacityJournal;
        if (!value || value.originHash !== authorityBodyHash(normalizedAuthorityOrigin(options.platformOrigin))
            || value.ownerHash !== authorityBodyHash(options.userId) || value.keyHash !== authorityBodyHash(options.requestKey)
            || !uuid.test(value.requestId) || !/^[a-f0-9]{64}$/.test(value.serverBodyHash)) fail('CAPACITY_JOURNAL_CONFLICT');
        if (value.delivery === 'submitted') return undefined;
        if (value.delivery !== 'cancelled') await atomic(path, {...value, delivery: 'cancel_requested'});
        return value;
    });
    if (!saved) return false;
    if (saved.delivery === 'cancelled') return true;
    const reply = await cancel(saved.requestId);
    if (!reply.ok || reply.requestId !== saved.requestId) fail('CAPACITY_CANCEL_PENDING');
    await serialized(directory, () => atomic(path, {...saved, delivery: 'cancelled'}));
    return true;
}
