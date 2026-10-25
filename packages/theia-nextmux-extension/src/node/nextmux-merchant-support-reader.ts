import { createHash } from 'node:crypto';
import { merchantModelCategories } from '@nextmux/model-runtime/merchant-modalities';
import type { PlatformMerchantCatalogPage, PlatformMerchantSupportCatalogPage, PlatformMerchantSupportQuery, PlatformOffering } from '../common/nextmux-platform-protocol';

const categories = ['all', 'language', 'image', 'video', 'audio', 'others'];
const fail = (code: string): Error => Object.assign(new Error(code), { code });
const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24);
const compact = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\s._\-/:]/gu, '');

type Query = { search: string; category: NonNullable<PlatformMerchantSupportQuery['category']>; after?: string };
export function normalizeSupportQuery(merchantId: string, query: PlatformMerchantSupportQuery = {}): Query {
    if (typeof merchantId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(merchantId)
        || !query || typeof query !== 'object' || Array.isArray(query)
        || query.search !== undefined && typeof query.search !== 'string'
        || query.category !== undefined && !categories.includes(query.category)
        || query.after !== undefined && (typeof query.after !== 'string' || !/^[A-Za-z0-9._~:+=-]{1,2048}$/.test(query.after))) throw fail('MERCHANT_SUPPORT_QUERY_INVALID');
    const search = (query.search || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
    if (Array.from(search).length > 120 || /[\u0000-\u001f\u007f-\u009f]/u.test(search)) throw fail('MERCHANT_SUPPORT_QUERY_INVALID');
    return { search, category: query.category || 'all', ...(query.after ? { after: query.after } : {}) };
}

export function matchesSupportOffering(offering: PlatformOffering, query: Query): boolean {
    if (offering.status !== 'active') return false;
    const modelCategories = merchantModelCategories(offering);
    if (query.category !== 'all' && !modelCategories.includes(query.category)) return false;
    const aliases = offering as PlatformOffering & { aliases?: readonly string[]; modelId?: string };
    const fields = [offering.displayName, offering.canonicalModel, offering.registryModelId, offering.providerModelCode, offering.modelFamily,
        aliases.modelId, ...(Array.isArray(aliases.aliases) ? aliases.aliases : [])]
        .filter((value): value is string => typeof value === 'string').map(compact);
    const terms = query.search.split(' ').map(compact).filter(Boolean);
    return (!query.search || terms.length > 0) && terms.every(token => fields.some(field => field.includes(token)));
}

/** Keep display snapshots out of the route/quote caches consulted by paid requests. */
function displayOffering(offering: PlatformOffering): PlatformOffering {
    const { keyPriceQuoteId: _quote, keyPrice: _key, canvasCapabilities: _canvas, videoLimits: _video,
        managedTransport: _transport, credentialCapacity: _capacity, codingAvailability: _coding, ...display } = offering;
    const multiplierBps = offering.price?.mode === 'direct' || offering.multiplierBps === null ? null
        : offering.keyPrice?.selectedMultiplierBps ?? offering.multiplierBps;
    return { ...display, multiplierBps, ...(offering.price ? { price: { ...offering.price, multiplierBps } } : {}) };
}

type Snapshot = { offerings: readonly PlatformOffering[]; version: string; expiresAt: number; retainedUntil: number; measuredAt?: string; discoveryPending?: boolean; bytes: number };
type Dependencies = {
    request: (path: string) => Promise<unknown>;
    legacyPage: (merchantId: string, after?: string) => Promise<PlatformMerchantCatalogPage>;
    normalize: (offerings: readonly PlatformOffering[]) => readonly PlatformOffering[];
    fallbackOfferings?: (merchantId: string) => readonly PlatformOffering[];
    now?: () => number;
};

function isTransientSupportError(error: unknown): boolean {
    const candidate = error as {
        status?: number;
        httpStatus?: number;
        code?: string;
        messageKey?: string;
        message?: string;
        data?: { httpStatus?: number; code?: string; messageKey?: string };
    } | null;
    const status = candidate?.status ?? candidate?.httpStatus ?? candidate?.data?.httpStatus;
    const code = candidate?.code ?? candidate?.data?.code;
    const messageKey = candidate?.messageKey ?? candidate?.data?.messageKey;
    return status === 429 || status === 502 || status === 503 || status === 504
        || code === 'merchant_catalog_busy' || code === 'merchant_catalog_refreshing' || code === 'catalog_refreshing'
        || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'UND_ERR_SOCKET'
        || messageKey === 'PLATFORM_TIMEOUT' || messageKey === 'PLATFORM_OFFLINE' || messageKey === 'PLATFORM_UNAVAILABLE';
}

/** New servers search one shared browse snapshot; old servers build one bounded local snapshot per merchant. */
export class MerchantSupportCatalogReader {
    private readonly pages = new Map<string, { page: PlatformMerchantSupportCatalogPage; expiresAt: number; bytes: number }>();
    private readonly pending = new Map<string, Promise<PlatformMerchantSupportCatalogPage>>();
    private readonly snapshots = new Map<string, Snapshot>();
    private readonly snapshotPending = new Map<string, Promise<Snapshot>>();
    private epoch = 0;
    private unsupportedUntil = 0;
    private catalogVersion = '';
    private readonly now: () => number;

    constructor(private readonly dependencies: Dependencies) { this.now = dependencies.now || Date.now; }

    invalidate(version = ''): void {
        ++this.epoch;
        this.catalogVersion = version;
        this.pages.clear(); this.snapshots.clear();
        // In-flight reads remain counted until they settle; they cannot repopulate a new generation.
    }

    async read(merchantId: string, input: PlatformMerchantSupportQuery = {}, force = false): Promise<PlatformMerchantSupportCatalogPage> {
        const query = normalizeSupportQuery(merchantId, input ?? {});
        const parameters = new URLSearchParams({ q: query.search, category: query.category, limit: '100', ...(query.after ? { after: query.after } : {}) });
        if (this.catalogVersion) parameters.set('catalogVersion', this.catalogVersion);
        const key = `${this.epoch}:${merchantId}?${parameters}`;
        const cached = this.pages.get(key);
        const localSnapshot = this.snapshots.get(merchantId);
        const cachedSnapshotAvailable = !cached?.page.snapshotVersion.startsWith('local-')
            || localSnapshot?.version === cached.page.snapshotVersion && localSnapshot.retainedUntil > this.now();
        if (!force && cached && cached.expiresAt > this.now() && cachedSnapshotAvailable) return cached.page;
        const existing = this.pending.get(key);
        if (existing) return existing;
        if (this.pending.size >= 16) throw fail('MERCHANT_SUPPORT_BUSY');
        const epoch = this.epoch;
        const operation = (async (): Promise<PlatformMerchantSupportCatalogPage> => {
            let page: PlatformMerchantSupportCatalogPage;
            if (this.unsupportedUntil > this.now() || query.after?.startsWith('local_support_')) {
                page = await this.legacySearch(merchantId, query, force && !query.after);
            } else {
                try {
                    const raw = await this.dependencies.request(`/api/merchants/public/${encodeURIComponent(merchantId)}/catalog?${parameters}`);
                    page = this.validate(raw, merchantId, query.after);
                } catch (error) {
                    // Theia's ordinary Error codec retains message but drops custom code/data. Preserve
                    // this one recovery signal without changing the shared platform RPC error contract.
                    if ((error as { code?: string })?.code === 'merchant_catalog_cursor_stale') throw fail('SUPPORT_CURSOR_STALE');
                    // Never mask auth failures, overload, stale cursors or malformed successful responses by scanning everything.
                    const status = (error as { status?: number })?.status;
                    if ((status !== 404 && status !== 405) || (error as { code?: string })?.code === 'merchant_not_found') {
                        if (!force && cached && cachedSnapshotAvailable && isTransientSupportError(error)) return cached.page;
                        if (!query.after && isTransientSupportError(error) && this.dependencies.fallbackOfferings) {
                            const fallback = this.dependencies.fallbackOfferings(merchantId);
                            const rows = Array.isArray(fallback) && fallback.length
                                ? this.dependencies.normalize(fallback.filter(item => item?.merchantId === merchantId).map(displayOffering))
                                    .filter(item => matchesSupportOffering(item, query))
                                : [];
                            if (rows.length > 0) {
                                return {
                                    online: true,
                                    merchantId,
                                    displayOnly: true,
                                    snapshotVersion: `fallback-${digest(JSON.stringify([this.catalogVersion, rows.map(item => item.id)]))}`,
                                    matchedOfferingCount: rows.length,
                                    offerings: rows.slice(0, 100)
                                };
                            }
                        }
                        throw error;
                    }
                    this.unsupportedUntil = this.now() + 30_000;
                    page = await this.legacySearch(merchantId, query, force && !query.after);
                }
            }
            if (epoch !== this.epoch) throw fail('SUPPORT_CURSOR_STALE');
            this.pages.delete(key); this.pages.set(key, { page, expiresAt: this.now() + 60_000, bytes: Buffer.byteLength(JSON.stringify(page)) });
            while (this.pages.size > 32 || [...this.pages.values()].reduce((sum, entry) => sum + entry.bytes, 0) > 8 * 1024 * 1024) {
                this.pages.delete(this.pages.keys().next().value!);
            }
            return page;
        })().finally(() => { if (this.pending.get(key) === operation) this.pending.delete(key); });
        this.pending.set(key, operation);
        return operation;
    }

    private validate(raw: unknown, merchantId: string, after?: string): PlatformMerchantSupportCatalogPage {
        const page = raw as Partial<PlatformMerchantSupportCatalogPage> | null;
        if (!page || page.merchantId !== merchantId || page.displayOnly !== true
            || typeof page.snapshotVersion !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(page.snapshotVersion)
            || !Number.isSafeInteger(page.matchedOfferingCount) || page.matchedOfferingCount! < 0
            || !Array.isArray(page.offerings) || page.offerings.length > 100
            || page.offerings.some(item => !item || item.merchantId !== merchantId || typeof item.id !== 'string')
            || new Set(page.offerings.map(item => item.id)).size !== page.offerings.length
            || page.nextCursor !== undefined && (typeof page.nextCursor !== 'string' || !/^[A-Za-z0-9._~:+=-]{1,2048}$/.test(page.nextCursor) || page.nextCursor === after)) {
            throw fail('MERCHANT_SUPPORT_RESPONSE_INVALID');
        }
        return { online: true, merchantId, displayOnly: true, snapshotVersion: page.snapshotVersion,
            matchedOfferingCount: page.matchedOfferingCount!, offerings: this.dependencies.normalize(page.offerings.map(displayOffering)),
            ...(typeof page.measuredAt === 'string' ? { measuredAt: page.measuredAt } : {}),
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
            ...(typeof page.discoveryPending === 'boolean' ? { discoveryPending: page.discoveryPending } : {}) };
    }

    private async legacySearch(merchantId: string, query: Query, force: boolean): Promise<PlatformMerchantSupportCatalogPage> {
        if (query.after && !query.after.startsWith('local_support_')) throw fail('SUPPORT_CURSOR_STALE');
        if (force) this.snapshots.delete(merchantId);
        const retained = this.snapshots.get(merchantId);
        // Reading a long page must not force a fresh full catalogue after 30 seconds. Existing
        // cursors use the same display snapshot for five minutes; new searches still refresh at 30s.
        if (query.after && (!retained || retained.retainedUntil <= this.now())) throw fail('SUPPORT_CURSOR_STALE');
        const snapshot = query.after ? retained! : await this.legacySnapshot(merchantId);
        const fingerprint = digest(JSON.stringify([merchantId, snapshot.version, query.search, query.category]));
        let offset = 0;
        if (query.after) {
            const match = /^local_support_([a-f0-9]{24})_(\d{1,5})$/.exec(query.after);
            if (!match || match[1] !== fingerprint || Number(match[2]) % 100 !== 0) throw fail('SUPPORT_CURSOR_STALE');
            offset = Number(match[2]);
        }
        const rows = snapshot.offerings.filter(item => matchesSupportOffering(item, query));
        if (offset > 0 && offset >= rows.length) throw fail('SUPPORT_CURSOR_STALE');
        return { online: true, merchantId, offerings: rows.slice(offset, offset + 100), displayOnly: true,
            snapshotVersion: snapshot.version, matchedOfferingCount: rows.length, measuredAt: snapshot.measuredAt,
            discoveryPending: snapshot.discoveryPending,
            ...(offset + 100 < rows.length ? { nextCursor: `local_support_${fingerprint}_${offset + 100}` } : {}) };
    }

    private async legacySnapshot(merchantId: string): Promise<Snapshot> {
        const cached = this.snapshots.get(merchantId);
        if (cached && cached.expiresAt > this.now()) return cached;
        const existing = this.snapshotPending.get(merchantId);
        if (existing) return existing;
        if (this.snapshotPending.size >= 8) throw fail('MERCHANT_SUPPORT_BUSY');
        const epoch = this.epoch;
        const operation = (async () => {
            const rows: PlatformOffering[] = [], seen = new Set<string>();
            let after: string | undefined, bytes = 0, measuredAt: string | undefined, discoveryPending: boolean | undefined;
            const started = this.now();
            for (let index = 0; index < 50; index++) {
                if (epoch !== this.epoch || this.now() - started > 60_000) throw fail('SUPPORT_CURSOR_STALE');
                const page = await this.dependencies.legacyPage(merchantId, after);
                if (!Array.isArray(page.offerings) || page.offerings.length > 100 || page.offerings.some(item => item.merchantId !== merchantId)
                    || page.nextCursor && (page.nextCursor <= (after || '') || index === 49)) throw fail('MERCHANT_SUPPORT_SNAPSHOT_INCOMPLETE');
                measuredAt = measuredAt || page.measuredAt;
                discoveryPending = discoveryPending || page.discoveryPending;
                const displayed = page.offerings.map(displayOffering);
                bytes += Buffer.byteLength(JSON.stringify(displayed));
                if (bytes > 16 * 1024 * 1024) throw fail('MERCHANT_SUPPORT_SNAPSHOT_TOO_LARGE');
                for (const item of displayed) if (!seen.has(item.id)) { rows.push(item); seen.add(item.id); }
                if (!page.nextCursor) {
                    if (epoch !== this.epoch) throw fail('SUPPORT_CURSOR_STALE');
                    const snapshot: Snapshot = { offerings: this.dependencies.normalize(rows), measuredAt, discoveryPending,
                        version: `local-${digest(JSON.stringify([this.catalogVersion, rows]))}`, expiresAt: this.now() + 30_000,
                        retainedUntil: this.now() + 300_000, bytes };
                    this.snapshots.delete(merchantId); this.snapshots.set(merchantId, snapshot);
                    while (this.snapshots.size > 16 || [...this.snapshots.values()].reduce((sum, entry) => sum + entry.bytes, 0) > 24 * 1024 * 1024) {
                        this.snapshots.delete(this.snapshots.keys().next().value!);
                    }
                    return snapshot;
                }
                after = page.nextCursor;
            }
            throw fail('MERCHANT_SUPPORT_SNAPSHOT_INCOMPLETE');
        })().finally(() => { if (this.snapshotPending.get(merchantId) === operation) this.snapshotPending.delete(merchantId); });
        this.snapshotPending.set(merchantId, operation);
        return operation;
    }
}
