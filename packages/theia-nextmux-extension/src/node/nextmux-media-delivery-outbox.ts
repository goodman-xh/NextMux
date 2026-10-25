import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'path';

export type MediaDeliveryBody = ({ readonly kind: 'media'; readonly requestId: string }
    | { readonly kind: 'output'; readonly requestId: string; readonly partIndex: number }
    | { readonly kind: 'video'; readonly jobId: string }
    | { readonly kind: 'reference'; readonly scope: string }
    | { readonly kind: 'history'; readonly ids: readonly string[] }) & { readonly sizeBytes: number; readonly sha256: string };
export type MediaDeliveryRecovery = { readonly type: 'job'; readonly workspaceRoot: string; readonly jobId: string }
    | { readonly type: 'output'; readonly ownerId: string; readonly runId: string; readonly workspaceRoot: string }
    | { readonly type: 'receipt'; readonly ownerId: string; readonly workspaceRoot: string }
    | { readonly type: 'reference'; readonly workspaceRoot: string; readonly scope: string }
    | { readonly type: 'history'; readonly workspaceRoot: string };
export interface MediaDeliveryRecord {
    readonly version: 1;
    readonly body: MediaDeliveryBody;
    readonly path: string;
    readonly recovery: MediaDeliveryRecovery;
    readonly attempts: number;
    readonly nextAttemptAt: number;
    readonly deliveredAt?: number;
    readonly cleanupAttempted?: boolean;
}
export interface MediaDeliveryOptions {
    readonly dataRoot: string;
    readonly baseUrl: string;
    /** Supplied from the existing linked session, never fetched by the outbox. */
    readonly accountId: string;
    readonly deviceId: string;
    readonly fetch: typeof fetch;
    readonly recoverable: (record: MediaDeliveryRecord) => Promise<boolean>;
    readonly now?: () => number;
    readonly random?: () => number;
    readonly automatic?: boolean;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const mutations = new Map<string, Promise<unknown>>();
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const key = (body: MediaDeliveryBody): string => hash(JSON.stringify([body.kind, body.kind === 'history' ? body.ids : body.kind === 'reference' ? body.scope : body.kind === 'video' ? body.jobId : body.requestId,
    body.kind === 'output' ? body.partIndex : null]));
function valid(record: MediaDeliveryRecord): boolean {
    const body = record?.body;
    return record?.version === 1 && typeof record.path === 'string' && isAbsolute(record.path)
        && Number.isSafeInteger(record.attempts) && record.attempts >= 0 && Number.isFinite(record.nextAttemptAt)
        && Boolean(body) && ['media', 'output', 'video', 'reference', 'history'].includes(body.kind)
        && (body.kind === 'history' ? Array.isArray(body.ids) && body.ids.length > 0 && body.ids.length <= 16
            && body.ids.every(id => typeof id === 'string' && uuid.test(id)) && new Set(body.ids).size === body.ids.length
            : body.kind === 'reference' ? /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(body.scope) : uuid.test(body.kind === 'video' ? body.jobId : body.requestId))
        && (body.kind !== 'output' || Number.isSafeInteger(body.partIndex) && body.partIndex >= 0 && body.partIndex < 64)
        && Number.isSafeInteger(body.sizeBytes) && body.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(body.sha256)
        && Boolean(record.recovery) && isAbsolute(record.recovery.workspaceRoot)
        && (record.recovery.type === 'job' ? typeof record.recovery.jobId === 'string'
            : record.recovery.type === 'history' ? body.kind === 'history'
            : record.recovery.type === 'reference' ? body.kind === 'reference' && record.recovery.scope === body.scope
            : typeof record.recovery.ownerId === 'string' && (record.recovery.type === 'receipt'
                || record.recovery.type === 'output' && typeof record.recovery.runId === 'string'));
}

/** Small, private, crash-safe records. Credential material stays in the caller. */
export async function writeMediaDeliveryJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    try {
        await rename(temporary, path);
        await syncMediaDeliveryDirectory(dirname(path));
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
export async function syncMediaDeliveryDirectory(path: string): Promise<void> {
    if (process.platform === 'win32') return;
    const directory = await open(path, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
}

/** Bounded streaming verification runs only in the background, never in generation/display. */
export async function verifyMediaDeliveryFile(record: { readonly path: string; readonly body: { readonly sizeBytes: number; readonly sha256: string } }): Promise<boolean> {
    try {
        const before = await lstat(record.path);
        if (!before.isFile() || before.isSymbolicLink() || before.size !== record.body.sizeBytes
            || await realpath(record.path) !== resolve(record.path)) return false;
        const handle = await open(record.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
            const opened = await handle.stat();
            if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return false;
            const digest = createHash('sha256'), chunk = Buffer.alloc(256 * 1024);
            let position = 0;
            while (position < before.size) {
                const result = await handle.read(chunk, 0, Math.min(chunk.length, before.size - position), position);
                if (!result.bytesRead) return false;
                digest.update(chunk.subarray(0, result.bytesRead)); position += result.bytesRead;
            }
            const after = await handle.stat();
            return after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
                && digest.digest('hex') === record.body.sha256;
        } finally { await handle.close(); }
    } catch { return false; }
}

/** Delivery acknowledgment only: never calls generation or retries a provider request. */
export class MediaDeliveryOutbox {
    readonly directory: string;
    readonly receiptsDirectory: string;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private timerAt = Infinity;
    private wakeRequested = false;
    private running: Promise<void> | undefined;
    private stopped = false;
    private readonly busy = new Set<string>();
    private readonly controllers = new Set<AbortController>();
    private readonly now: () => number;
    private readonly random: () => number;
    constructor(private readonly options: MediaDeliveryOptions) {
        const url = new URL(options.baseUrl);
        if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:'
            && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('MEDIA_DELIVERY_ORIGIN_INVALID');
        if (!options.accountId || !options.deviceId) throw new Error('MEDIA_DELIVERY_OWNER_REQUIRED');
        this.directory = join(resolve(options.dataRoot), 'media-delivery-outbox-v1', hash(JSON.stringify([
            url.toString().replace(/\/$/, ''), options.accountId, options.deviceId])));
        this.receiptsDirectory = join(dirname(this.directory), `${basename(this.directory)}-receipts`);
        this.now = options.now || Date.now; this.random = options.random || Math.random;
    }
    start(): void { this.schedule(1_000); }
    dispose(): void {
        this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined;
        for (const controller of this.controllers) controller.abort();
    }
    private exclusive<T>(action: () => Promise<T>): Promise<T> {
        const result = (mutations.get(this.directory) || Promise.resolve()).then(action, action);
        const settled = result.catch(() => undefined);
        mutations.set(this.directory, settled);
        void settled.finally(() => { if (mutations.get(this.directory) === settled) mutations.delete(this.directory); });
        return result;
    }
    async stage(body: MediaDeliveryBody, path: string, recovery: MediaDeliveryRecovery): Promise<void> {
        const record: MediaDeliveryRecord = { version: 1, body, path: resolve(path), recovery, attempts: 0, nextAttemptAt: this.now() + 1_000 };
        if (!valid(record)) throw new Error('MEDIA_DELIVERY_RECORD_INVALID');
        if ((body.kind === 'reference' || body.kind === 'history') && record.path !== this.cleanupEvidencePath(body)) throw new Error('MEDIA_DELIVERY_EVIDENCE_INVALID');
        await this.exclusive(async () => {
            const target = join(this.directory, `${key(body)}.json`);
            let previous: MediaDeliveryRecord | undefined;
            try { previous = await this.lookup(body); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            if (previous) {
                if (!valid(previous) || previous.body.sha256 !== body.sha256 || previous.body.sizeBytes !== body.sizeBytes
                    || previous.path !== record.path || JSON.stringify(previous.recovery) !== JSON.stringify(recovery)) throw new Error('MEDIA_DELIVERY_CONFLICT');
                if (previous.deliveredAt && ['reference', 'history'].includes(body.kind)) await unlink(record.path).catch(() => undefined);
                return;
            }
            await writeMediaDeliveryJson(target, record);
        });
        if (this.running) this.wakeRequested = true;
        this.schedule(1_000);
    }
    cleanupEvidencePath(body: { readonly kind: 'reference'; readonly scope: string } | { readonly kind: 'history'; readonly ids: readonly string[] }): string {
        return join(this.receiptsDirectory, `${body.kind}-${hash(body.kind === 'reference' ? body.scope : JSON.stringify(body.ids))}.json`);
    }
    /** Account-scoped local lookup remains usable after server cleanup, without a GET. */
    async lookup(identity: { readonly kind: 'media' | 'output'; readonly requestId: string; readonly partIndex?: number }
        | { readonly kind: 'video'; readonly jobId: string } | { readonly kind: 'reference'; readonly scope: string }
        | { readonly kind: 'history'; readonly ids: readonly string[] }): Promise<MediaDeliveryRecord | undefined> {
        const name = `${key(identity as MediaDeliveryBody)}.json`;
        for (const directory of [this.directory, this.receiptsDirectory]) {
            try {
                const path = join(directory, name);
                const info = await lstat(path);
                if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) return undefined;
                const record: MediaDeliveryRecord = JSON.parse(await readFile(path, 'utf8'));
                if (!valid(record) || `${key(record.body)}.json` !== name) throw new Error('MEDIA_DELIVERY_RECORD_INVALID');
                return record;
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        return undefined;
    }
    /** Only used after a legacy endpoint 404: never assume a possibly deleted cloud copy exists. */
    async legacyOutputReferencesAvailable(assets: readonly { readonly sha256: string; readonly sizeBytes: number }[]): Promise<boolean> {
        return this.exclusive(async () => {
        const wanted = new Set(assets.map(asset => `${asset.sha256}:${asset.sizeBytes}`));
        for (const directory of [this.directory, this.receiptsDirectory]) {
            let names: string[];
            try { names = await readdir(directory); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; return false; }
            for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
                try {
                    const path = join(directory, name); if ((await lstat(path)).size > 16_384) return false;
                    const record = JSON.parse(await readFile(path, 'utf8')) as MediaDeliveryRecord;
                    if (!valid(record)) return false;
                    if (record.body.kind === 'output' && (record.cleanupAttempted || record.deliveredAt)
                        && wanted.has(`${record.body.sha256}:${record.body.sizeBytes}`)) return false;
                } catch { return false; }
            }
        }
        // Serialize this reservation with the deletion dispatch marker. During a rolling deployment,
        // an old request worker can coexist with a new cleanup worker; do not delete under that request.
        for (const asset of assets) await writeMediaDeliveryJson(this.legacyLeasePath(asset), { until: this.now() + 6 * 60 * 60_000 });
        return true;
        });
    }
    private legacyLeasePath(asset: { readonly sha256: string; readonly sizeBytes: number }): string {
        return join(this.receiptsDirectory, `legacy-${hash(`${asset.sha256}:${asset.sizeBytes}`)}.json`);
    }
    private schedule(delay: number): void {
        if (this.stopped || this.options.automatic === false) return;
        const boundedDelay = Math.max(1_000, Math.min(delay, 2_147_000_000)), at = this.now() + boundedDelay;
        if (this.timer && this.timerAt <= at) return;
        if (this.timer) clearTimeout(this.timer);
        this.timerAt = at;
        this.timer = setTimeout(() => {
            this.timer = undefined; this.timerAt = Infinity; void this.flush().catch(() => this.schedule(60_000));
        }, boundedDelay);
        this.timer.unref();
    }
    async flush(): Promise<void> {
        if (this.stopped) return;
        if (this.running) return this.running;
        this.running = this.drain().finally(() => {
            this.running = undefined;
            if (this.wakeRequested) { this.wakeRequested = false; this.schedule(1_000); }
        });
        return this.running;
    }
    private async drain(): Promise<void> {
        let names: string[];
        try { names = (await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
        let nearest = Infinity, cursor = 0;
        const lane = async (): Promise<void> => {
            while (cursor < names.length && !this.stopped) {
                const name = names[cursor++]; if (this.busy.has(name)) continue;
                const path = join(this.directory, name);
                let record: MediaDeliveryRecord;
                try { if ((await lstat(path)).size > 16_384) continue; record = JSON.parse(await readFile(path, 'utf8')); }
                catch { continue; }
                if (!valid(record) || name !== `${key(record.body)}.json`) continue;
                if (record.nextAttemptAt > this.now()) { nearest = Math.min(nearest, record.nextAttemptAt); continue; }
                this.busy.add(name);
                try {
                    const retryAt = await this.deliver(record, path);
                    if (retryAt) nearest = Math.min(nearest, retryAt);
                } finally { this.busy.delete(name); }
            }
        };
        await Promise.all([lane(), lane()]);
        if (Number.isFinite(nearest)) this.schedule(nearest - this.now());
    }
    private async deliver(record: MediaDeliveryRecord, path: string): Promise<number | undefined> {
        if ((record.body.kind === 'reference' || record.body.kind === 'history') && record.path !== this.cleanupEvidencePath(record.body)) return;
        let minimumDelay = 30_000;
        let updated = record;
        try {
            if (await this.options.recoverable(record) && await verifyMediaDeliveryFile(record)) {
                if (this.stopped) return;
                const controller = new AbortController(); this.controllers.add(controller);
                const timer = setTimeout(() => controller.abort(), 15_000); timer.unref();
                try {
                    const reference = record.body.kind === 'reference';
                    const history = record.body.kind === 'history';
                    if (record.body.kind === 'output') {
                        let holdUntil = 0;
                        await this.exclusive(async () => {
                            try {
                                const leasePath = this.legacyLeasePath(record.body), info = await lstat(leasePath);
                                if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) throw new Error('MEDIA_DELIVERY_LEASE_INVALID');
                                holdUntil = Number(JSON.parse(await readFile(leasePath, 'utf8')).until);
                                if (!Number.isFinite(holdUntil)) throw new Error('MEDIA_DELIVERY_LEASE_INVALID');
                            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') holdUntil = this.now() + 6 * 60 * 60_000; }
                            if (holdUntil > this.now()) return;
                            updated = { ...record, cleanupAttempted: true };
                            await writeMediaDeliveryJson(path, updated);
                        });
                        if (holdUntil > this.now()) { minimumDelay = holdUntil - this.now(); throw new Error('MEDIA_DELIVERY_LEGACY_ACTIVE'); }
                    }
                    const response = await this.options.fetch(`${this.options.baseUrl.replace(/\/$/, '')}${history ? '/api/gateway/history-inputs' : reference ? '/api/reference-drops/release' : '/api/gateway/media-delivery'}`, {
                        method: history ? 'DELETE' : 'POST', headers: { 'content-type': 'application/json', 'x-nextmux-device-id': this.options.deviceId },
                        body: JSON.stringify(record.body.kind === 'history' ? { ids: record.body.ids } : record.body.kind === 'reference' ? { scope: record.body.scope } : record.body), redirect: 'error', signal: controller.signal
                    });
                    // An old Worker must not cause repeated traffic or affect the delivered result.
                    if ([404, 405].includes(response.status)) {
                        minimumDelay = 24 * 60 * 60_000;
                        if (record.body.kind === 'output' && !record.cleanupAttempted) updated = { ...record, cleanupAttempted: false };
                    }
                    if ([401, 403, 409, 422].includes(response.status)) minimumDelay = 60 * 60_000;
                    const retryAfter = Number(response.headers.get('retry-after'));
                    if (Number.isFinite(retryAfter) && retryAfter > 0) minimumDelay = Math.max(minimumDelay, Math.min(retryAfter * 1_000, 24 * 60 * 60_000));
                    if ((response.status === 200 || response.status === 202) && Number(response.headers.get('content-length') || 0) <= 4096) {
                        const reader = response.body?.getReader();
                        const chunks: Buffer[] = [];
                        let size = 0;
                        if (reader) try {
                            while (true) {
                                const part = await reader.read();
                                if (part.done) break;
                                size += part.value.length;
                                if (size > 4096) throw new Error('MEDIA_DELIVERY_RESPONSE_TOO_LARGE');
                                chunks.push(Buffer.from(part.value));
                            }
                        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
                        const text = Buffer.concat(chunks, size).toString('utf8');
                        const result = JSON.parse(text);
                        if (result?.ok === true && (reference || history ? response.status === 200 && result?.complete === true : result?.delivered === true)) {
                            await this.exclusive(async () => {
                                await writeMediaDeliveryJson(join(this.receiptsDirectory, `${key(record.body)}.json`), { ...updated, deliveredAt: this.now() });
                                await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
                                if (reference || history) await unlink(record.path).catch(() => undefined);
                            });
                            return;
                        }
                    } else await response.body?.cancel().catch(() => undefined);
                } finally { clearTimeout(timer); this.controllers.delete(controller); }
            }
        } catch { /* Keep the durable acknowledgment; never change an already delivered model result. */ }
        if (this.stopped) return;
        const attempts = Math.min(record.attempts + 1, 30);
        const delay = Math.max(minimumDelay, Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 10)))
            * (1 + Math.max(0, Math.min(1, this.random())) * 0.25);
        const nextAttemptAt = this.now() + Math.ceil(delay);
        await this.exclusive(() => writeMediaDeliveryJson(path, { ...updated, attempts, nextAttemptAt }));
        return nextAttemptAt;
    }
}
