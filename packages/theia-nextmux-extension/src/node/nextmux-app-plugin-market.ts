/**
 * Skill plugin marketplace (技能插件市场) on the NextMux platform: the public list, one plugin's page, and the
 * download of a reviewed version. A download is checked here before the page ever sees it: its SHA-256 must be the
 * one the platform lists for that version. Signature presence and verification with the public key built into
 * NextMux are reported independently of the platform's review status (the private key only exists as a platform secret).
 */
import { createHash, createPublicKey, verify } from 'crypto';
import type {
    AppPluginDiagnostic, AppPluginFingerprintMatch, AppPluginLicense, AppPluginLicenseCheck, AppPluginMarketDetail, AppPluginMarketDownload, AppPluginMarketList, AppPluginMarketPlugin,
    AppPluginMarketUpload, AppPluginMine, AppPluginMinePlugin, AppPluginMineVersion, AppPluginPurchase, AppPluginUploadProblem, AppPluginUploadRejection
} from '../common/nextmux-app-plugins';
import { APP_PLUGIN_PRICE } from '../common/nextmux-app-plugins';

export interface AppPluginMarketHost {
    readonly baseUrl: string;
    fetch: typeof fetch;
    /** The desktop's device ID: a linked device acts as its account (uploads, 我的插件, purchases, licenses). */
    deviceId?: () => Promise<string>;
}

/** Ed25519 public key of the platform's plugin review signatures (raw 32 bytes, base64). */
export const APP_PLUGIN_SIGNING_PUBLIC_KEY = 'vGC9odCEhI6f5eJWD/jsmNKN7Z9EF5Yi+HuIgdGy50I=';
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const pluginId = (value: string): boolean => /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9-]+$/.test(value) && value.length <= 100;
const version = (value: string): boolean => /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A price in US cents as the platform sends it (0 = free); anything else reads as free-but-unknown (0). */
function priceCents(value: unknown): number {
    const cents = Number(value);
    return Number.isSafeInteger(cents) && cents >= APP_PLUGIN_PRICE.minCents && cents <= APP_PLUGIN_PRICE.maxCents ? cents : 0;
}

/** The license text the platform signs for one buyer of one plugin (app-plugin-signing.js on the platform). */
export function appPluginLicensePayload(license: Pick<AppPluginLicense, 'pluginId' | 'userId' | 'issuedAt' | 'expiresAt'>): string {
    return `nextmux-app-plugin-license/1\n${license.pluginId}\n${license.userId}\n${license.issuedAt}\n${license.expiresAt}`;
}

/** Whether a license is the platform's, for this plugin, and not expired. */
export function verifyAppPluginLicense(license: AppPluginLicense | undefined, pluginIdValue: string, now = Date.now(), publicKey = APP_PLUGIN_SIGNING_PUBLIC_KEY): boolean {
    try {
        if (!license || license.pluginId !== pluginIdValue || !license.signature || !(license.expiresAt > now) || !(license.issuedAt <= now + 300_000)) return false;
        const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' });
        return verify(null, Buffer.from(appPluginLicensePayload(license), 'utf8'), key, Buffer.from(license.signature, 'base64'));
    } catch { return false; }
}

/** Whether the signature is the platform's for this plugin, version and package digest. */
export function verifyAppPluginSignature(id: string, pluginVersion: string, sha256: string, signature: string, publicKey = APP_PLUGIN_SIGNING_PUBLIC_KEY): boolean {
    try {
        if (!signature) return false;
        const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' });
        return verify(null, Buffer.from(`nextmux-app-plugin/1\n${id}\n${pluginVersion}\n${sha256}`, 'utf8'), key, Buffer.from(signature, 'base64'));
    } catch { return false; }
}

function marketPlugin(value: unknown): AppPluginMarketPlugin | undefined {
    if (!isObject(value) || typeof value.id !== 'string' || !pluginId(value.id)) return undefined;
    const text = (item: unknown) => isObject(item) ? Object.fromEntries(Object.entries(item).filter(([, entry]) => typeof entry === 'string').map(([key, entry]) => [key, String(entry).slice(0, 400)])) : {};
    return {
        source: 'marketplace', reviewStatus: 'approved', signaturePresent: value.signaturePresent === true, signatureVerified: false,
        id: value.id, name: text(value.name), description: text(value.description),
        author: { name: isObject(value.author) && typeof value.author.name === 'string' ? value.author.name.slice(0, 60) : '' },
        homepage: typeof value.homepage === 'string' ? value.homepage.slice(0, 300) : '',
        risk: Array.isArray(value.risk) ? value.risk.filter((item): item is string => typeof item === 'string').slice(0, 4) : [],
        apps: Array.isArray(value.apps) ? value.apps.filter(isObject).slice(0, 8).map(app => ({ platform: app.platform === 'windows' ? 'windows' as const : 'macos' as const,
            ...(typeof app.bundleId === 'string' ? { bundleId: app.bundleId.slice(0, 160) } : {}), ...(typeof app.program === 'string' ? { program: app.program.slice(0, 120) } : {}) })) : [],
        latestVersion: typeof value.latestApprovedVersion === 'string' && version(value.latestApprovedVersion) ? value.latestApprovedVersion : '',
        downloads: Number.isFinite(value.downloads) ? Number(value.downloads) : 0,
        ...(typeof value.readme === 'string' ? { readme: value.readme.slice(0, 20_000) } : {}),
        ...(Number.isFinite(value.testCount) ? { tests: Number(value.testCount) } : {}),
        priceCents: priceCents(value.priceCents), ...(typeof value.owned === 'boolean' ? { owned: value.owned } : {})
    };
}

/** Marketplace reads carry the device so the platform can say which paid plugins this account owns. */
async function getJson(host: AppPluginMarketHost, path: string): Promise<{ ok: boolean; status: number; payload: unknown }> {
    const response = await host.fetch(`${host.baseUrl}${path}`, { headers: { accept: 'application/json', ...await deviceHeaders(host) }, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text.slice(0, 2_000_000)); } catch { payload = undefined; }
    return { ok: response.ok, status: response.status, payload };
}

export async function listAppPluginMarket(host: AppPluginMarketHost, query: { q?: string; cursor?: string; app?: string } = {}): Promise<AppPluginMarketList> {
    const params = new URLSearchParams({ limit: '30' });
    if (query.q?.trim()) params.set('q', query.q.trim().slice(0, 200));
    // Plugins made for one app (a tab's bundle id or program name).
    if (query.app && /^[\w .-]{1,160}$/.test(query.app)) params.set('app', query.app);
    if (query.cursor && /^[A-Za-z0-9_-]{1,2048}$/.test(query.cursor)) params.set('cursor', query.cursor);
    try {
        const { ok, status, payload } = await getJson(host, `/api/plugins?${params}`);
        if (!ok || !isObject(payload) || !Array.isArray(payload.plugins)) return { ok: false, plugins: [], error: `market_http_${status}` };
        return { ok: true, plugins: payload.plugins.map(marketPlugin).filter((item): item is AppPluginMarketPlugin => Boolean(item)),
            nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : undefined };
    } catch { return { ok: false, plugins: [], error: 'market_network' }; }
}

export async function appPluginMarketDetail(host: AppPluginMarketHost, id: string): Promise<AppPluginMarketDetail> {
    if (!pluginId(id)) return { ok: false, error: 'plugin_id_invalid' };
    try {
        const { ok, status, payload } = await getJson(host, `/api/plugins/${encodeURIComponent(id)}`);
        if (!ok || !isObject(payload)) return { ok: false, error: `market_http_${status}` };
        const plugin = marketPlugin(payload.plugin);
        const versions = Array.isArray(payload.versions) ? payload.versions.filter(isObject).filter(item => typeof item.version === 'string' && version(item.version))
            .map(item => ({ source: 'marketplace' as const, reviewStatus: 'approved' as const,
                signaturePresent: typeof item.signature === 'string' && item.signature.length > 0, signatureVerified: false,
                version: String(item.version), sha256: typeof item.sha256 === 'string' ? item.sha256 : '', signed: typeof item.signature === 'string' && item.signature.length > 0,
                reviewedAt: Number(item.reviewedAt) || 0 })) : [];
        return plugin ? { ok: true, plugin, versions } : { ok: false, error: 'market_invalid' };
    } catch { return { ok: false, error: 'market_network' }; }
}

const texts = (item: unknown): Record<string, string> => isObject(item)
    ? Object.fromEntries(Object.entries(item).filter(([key, entry]) => typeof entry === 'string' && key.length <= 20).slice(0, 12).map(([key, entry]) => [key, String(entry).slice(0, 200)])) : {};
const scalarParams = (value: unknown): Record<string, string | number | boolean | null> => isObject(value)
    ? Object.fromEntries(Object.entries(value).slice(0, 12).filter(([, entry]) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry))
        .map(([key, entry]) => [key.slice(0, 40), typeof entry === 'string' ? entry.slice(0, 200) : entry as number | boolean | null])) : {};
const diagnostics = (value: unknown): AppPluginDiagnostic[] => Array.isArray(value) ? value.filter(isObject).slice(0, 12)
    .map(item => ({ code: String(item.code || '').slice(0, 80), path: String(item.path || '').slice(0, 160), params: scalarParams(item.params) })).filter(item => item.code) : [];

/** The platform's refusal of a package (codes as in the app's own install check). */
function uploadProblem(payload: unknown, status: number): AppPluginUploadProblem {
    const body = isObject(payload) ? payload : {};
    const details = isObject(body.details) ? body.details : isObject(body.error) ? body.error : {};
    return { code: typeof body.code === 'string' ? body.code.slice(0, 100) : `market_http_${status}`,
        ...(typeof details.reason === 'string' ? { reason: details.reason.slice(0, 160) } : {}),
        params: scalarParams(details.params), diagnostics: diagnostics(details.diagnostics) };
}

/** The failing review check of an automatically rejected version (translated in the app); a person's note is shown as written. */
function failedCheck(value: Record<string, unknown>): string | undefined {
    const review = isObject(value.autoReview) ? value.autoReview : undefined;
    const checks = review && Array.isArray(review.checks) ? review.checks.filter(isObject) : [];
    const failed = checks.find(check => check.ok === false && check.id !== 'signing');
    return typeof failed?.id === 'string' && /^[a-z_]{1,40}$/.test(failed.id) ? failed.id : undefined;
}

async function deviceHeaders(host: AppPluginMarketHost): Promise<Record<string, string>> {
    const id = await host.deviceId?.().catch(() => '');
    return id ? { 'x-nextmux-device-id': id } : {};
}

/** 我的插件: every plugin this account uploaded, each version's review, and refused uploads. */
export async function myAppPlugins(host: AppPluginMarketHost): Promise<AppPluginMine> {
    try {
        // Every page, not only the first 50 (audit A14-08).
        const pages: Record<string, unknown>[] = [];
        let cursor = '';
        for (let page = 0; page < 8; page++) {
            const response = await host.fetch(`${host.baseUrl}/api/plugins/mine?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {
                headers: { accept: 'application/json', ...await deviceHeaders(host) }, signal: AbortSignal.timeout(15_000)
            });
            let body: unknown;
            try { body = JSON.parse((await response.text()).slice(0, 4_000_000)); } catch { body = undefined; }
            if (!response.ok || !isObject(body) || !Array.isArray(body.plugins)) {
                if (!pages.length) return { ok: false, plugins: [], rejections: [], error: `market_http_${response.status}` };
                break;
            }
            pages.push(body);
            const next = typeof body.nextCursor === 'string' && body.nextCursor.length <= 512 ? body.nextCursor : '';
            if (!next || next === cursor) break;
            cursor = next;
        }
        const payload = { plugins: pages.flatMap(page => page.plugins as unknown[]), rejections: pages[0].rejections };
        const plugins = payload.plugins.filter(isObject).filter(item => typeof item.id === 'string' && pluginId(item.id)).slice(0, 400).map((item): AppPluginMinePlugin => ({
            id: String(item.id), name: texts(item.name), authorName: typeof item.authorName === 'string' ? item.authorName.slice(0, 80) : '',
            status: item.status === 'listed' || item.status === 'removed' ? item.status : 'draft',
            latestApprovedVersion: typeof item.latestApprovedVersion === 'string' && version(item.latestApprovedVersion) ? item.latestApprovedVersion : '',
            downloads: Number.isFinite(item.downloads) ? Number(item.downloads) : 0, priceCents: priceCents(item.priceCents),
            versions: (Array.isArray(item.versions) ? item.versions : []).filter(isObject).filter(entry => typeof entry.version === 'string').slice(0, 50).map((entry): AppPluginMineVersion => {
                const check = entry.status === 'rejected' && entry.reviewedBy === 'auto' ? failedCheck(entry) : undefined;
                return { version: String(entry.version).slice(0, 60),
                    status: entry.status === 'approved' || entry.status === 'rejected' ? entry.status : 'pending',
                    ...(check ? { failedCheck: check } : {}), reviewNote: typeof entry.reviewNote === 'string' ? entry.reviewNote.slice(0, 1000) : '',
                    reviewedBy: entry.reviewedBy === 'admin' || entry.reviewedBy === 'auto' ? entry.reviewedBy : null,
                    authorName: typeof entry.authorName === 'string' ? entry.authorName.slice(0, 80) : '', submittedAt: Number(entry.submittedAt) || 0 };
            })
        }));
        const rejections = (Array.isArray(payload.rejections) ? payload.rejections : []).filter(isObject).slice(0, 50).map((item): AppPluginUploadRejection => {
            const problem = uploadProblem({ code: isObject(item.error) ? item.error.code : undefined, details: item.error }, 400);
            return { ...problem, id: String(item.id || '').slice(0, 80),
                ...(typeof item.pluginId === 'string' && pluginId(item.pluginId) ? { pluginId: item.pluginId } : {}),
                ...(typeof item.version === 'string' ? { version: item.version.slice(0, 60) } : {}),
                fileName: typeof item.fileName === 'string' ? item.fileName.slice(0, 160) : '', name: texts(item.name), createdAt: Number(item.createdAt) || 0 };
        });
        return { ok: true, plugins, rejections };
    } catch { return { ok: false, plugins: [], rejections: [], error: 'market_network' }; }
}

/** Uploads a package as the signed-in account (free or a USD price). The platform validates, reviews and answers at once. */
export async function uploadAppPluginToMarket(host: AppPluginMarketHost, bytes: Buffer, fileName: string, author: string, price?: number): Promise<AppPluginMarketUpload> {
    if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES) return { ok: false, problem: { code: 'package_size' } };
    // No price: the platform keeps the plugin's current price (a new plugin is free), so an update never drops a price by accident.
    if (price !== undefined && (!Number.isSafeInteger(price) || price !== 0 && (price < APP_PLUGIN_PRICE.minCents || price > APP_PLUGIN_PRICE.maxCents))) return { ok: false, problem: { code: 'plugin_price_invalid' } };
    const clean = (value: string, limit: number): string => [...value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, limit).join('');
    try {
        const response = await host.fetch(`${host.baseUrl}/api/plugins/upload`, {
            method: 'POST', body: new Uint8Array(bytes), signal: AbortSignal.timeout(120_000),
            headers: { accept: 'application/json', 'content-type': 'application/octet-stream', ...await deviceHeaders(host),
                'x-nextmux-plugin-file': encodeURIComponent(clean(fileName, 160)), ...(price !== undefined ? { 'x-nextmux-plugin-price': String(price) } : {}),
                ...(clean(author, 80) ? { 'x-nextmux-plugin-author': encodeURIComponent(clean(author, 80)) } : {}) }
        });
        let payload: unknown;
        try { payload = JSON.parse((await response.text()).slice(0, 1_000_000)); } catch { payload = undefined; }
        if (!response.ok || !isObject(payload) || payload.ok === false) return { ok: false, problem: uploadProblem(payload, response.status) };
        const status = payload.status === 'approved' || payload.status === 'rejected' ? payload.status : 'pending';
        const check = status === 'rejected' ? failedCheck(payload) : undefined;
        return { ok: true, status, ...(typeof payload.pluginId === 'string' ? { pluginId: payload.pluginId } : {}),
            ...(typeof payload.version === 'string' ? { version: payload.version } : {}), ...(check ? { failedCheck: check } : {}) };
    } catch { return { ok: false, problem: { code: 'market_network' } }; }
}

/** Buys a paid plugin from the account's USD balance, only at the price the buyer saw (idempotent per key). */
export async function purchaseAppPlugin(host: AppPluginMarketHost, id: string, expectedPriceCents: number, idempotencyKey: string): Promise<AppPluginPurchase> {
    if (!pluginId(id) || !/^[A-Za-z0-9_-]{12,160}$/.test(idempotencyKey) || !Number.isSafeInteger(expectedPriceCents)) return { ok: false, error: 'request_invalid' };
    try {
        const response = await host.fetch(`${host.baseUrl}/api/plugins/${encodeURIComponent(id)}/purchase`, {
            method: 'POST', signal: AbortSignal.timeout(30_000),
            headers: { accept: 'application/json', 'content-type': 'application/json', 'idempotency-key': idempotencyKey, ...await deviceHeaders(host) },
            body: JSON.stringify({ idempotencyKey, expectedPriceCents })
        });
        let payload: unknown;
        try { payload = JSON.parse((await response.text()).slice(0, 200_000)); } catch { payload = undefined; }
        const body = isObject(payload) ? payload : {};
        if (response.ok && body.ok !== false) return { ok: true, owned: body.owned !== false };
        const details = isObject(body.details) ? body.details : {};
        const params = isObject(details.params) ? details.params : {};
        const number = (value: unknown): number | undefined => Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
        const price = number(details.priceCents ?? params.priceCents ?? body.priceCents);
        const available = number(details.availableMicros ?? params.availableMicros);
        return { ok: false, error: typeof body.code === 'string' ? body.code.slice(0, 80) : response.status === 401 ? 'plugin_login_required' : `market_http_${response.status}`,
            ...(price !== undefined ? { priceCents: price } : {}), ...(available !== undefined ? { availableMicros: available } : {}) };
    } catch { return { ok: false, error: 'market_network' }; }
}

/**
 * Whether the marketplace sells this plugin id and, for a signed-in buyer (or its author), a license the platform
 * signed. Without an account the public page still tells whether the id is paid, so an unpaid copy is recognised.
 */
export async function appPluginLicense(host: AppPluginMarketHost, id: string): Promise<AppPluginLicenseCheck> {
    if (!pluginId(id)) return { ok: false, error: 'plugin_id_invalid' };
    try {
        const { ok, status, payload } = await getJson(host, `/api/plugins/${encodeURIComponent(id)}/license`);
        if (ok && isObject(payload)) {
            const cents = priceCents(payload.priceCents);
            const paid = payload.paid === true || cents > 0;
            const raw = isObject(payload.license) ? payload.license : undefined;
            const license: AppPluginLicense | undefined = raw && typeof raw.userId === 'string' && typeof raw.signature === 'string' ? {
                userId: raw.userId.slice(0, 120), pluginId: String(raw.pluginId || ''), issuedAt: Number(raw.issuedAt) || 0,
                expiresAt: Number(raw.expiresAt) || 0, signature: raw.signature.slice(0, 200) } : undefined;
            const valid = verifyAppPluginLicense(license, id);
            return { ok: true, paid, priceCents: cents, owned: !paid || payload.owned === true && (valid || !license), ...(valid ? { license } : {}),
                ...(paid && payload.owned === true && !valid ? { error: 'license_invalid' } : {}) };
        }
        if (status === 401 || status === 403) {
            // Not signed in: the public listing still says whether it is sold.
            const detail = await getJson(host, `/api/plugins/${encodeURIComponent(id)}`);
            if (detail.status === 404) return { ok: true, paid: false, owned: true };
            const plugin = detail.ok && isObject(detail.payload) ? marketPlugin(detail.payload.plugin) : undefined;
            return plugin ? { ok: true, paid: plugin.priceCents > 0, priceCents: plugin.priceCents, owned: plugin.priceCents === 0 } : { ok: false, error: `market_http_${detail.status}` };
        }
        // Not a marketplace plugin (never listed): nothing to buy.
        if (status === 404) return { ok: true, paid: false, owned: true };
        return { ok: false, error: `market_http_${status}` };
    } catch { return { ok: false, error: 'market_network' }; }
}

/** Is this content (a plugin loaded from disk) a paid marketplace plugin under another id or name? */
export async function appPluginFingerprintMatch(host: AppPluginMarketHost, fingerprint: { readonly behavior: string; readonly images: string }): Promise<AppPluginFingerprintMatch> {
    const hex = (value: unknown): string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : '';
    const behavior = hex(fingerprint?.behavior), images = hex(fingerprint?.images);
    if (!behavior && !images) return { ok: false, error: 'plugin_fingerprint_invalid' };
    try {
        const { ok, status, payload } = await getJson(host, `/api/plugins/fingerprint?${new URLSearchParams({ behavior, images })}`);
        // A platform without the lookup (not updated yet) knows no paid content: nothing matches.
        if (status === 404) return { ok: true };
        if (!ok || !isObject(payload)) return { ok: false, error: `market_http_${status}` };
        const match = isObject(payload.match) && typeof payload.match.pluginId === 'string' && pluginId(payload.match.pluginId) ? payload.match : undefined;
        return { ok: true, ...(match ? { match: { pluginId: String(match.pluginId), priceCents: priceCents(match.priceCents), name: texts(match.name) } } : {}) };
    } catch { return { ok: false, error: 'market_network' }; }
}

/** Downloads a reviewed version and checks its digest and signature; the bytes go on to the normal install check. */
export async function downloadAppPluginFromMarket(host: AppPluginMarketHost, id: string, pluginVersion: string): Promise<AppPluginMarketDownload> {
    if (!pluginId(id) || !version(pluginVersion)) return { ok: false, error: 'plugin_id_invalid' };
    const detail = await appPluginMarketDetail(host, id);
    const listed = detail.ok ? detail.versions?.find(item => item.version === pluginVersion) : undefined;
    if (!listed?.sha256) return { ok: false, error: detail.error || 'market_version_missing' };
    try {
        const response = await host.fetch(`${host.baseUrl}/api/plugins/${encodeURIComponent(id)}/download?version=${encodeURIComponent(pluginVersion)}`,
            { headers: { accept: 'application/octet-stream', ...await deviceHeaders(host) }, signal: AbortSignal.timeout(60_000) });
        // A paid plugin downloads only for its buyers: 401 needs a sign-in, 402 a purchase.
        if (response.status === 401) return { ok: false, error: 'plugin_login_required' };
        if (response.status === 402) return { ok: false, error: 'plugin_purchase_required' };
        if (!response.ok) return { ok: false, error: `market_http_${response.status}` };
        if (Number(response.headers.get('content-length') || 0) > MAX_PACKAGE_BYTES) return { ok: false, error: 'package_size' };
        let bytes: Buffer;
        if (response.body && typeof response.body.getReader === 'function') {
            const reader = response.body.getReader();
            const chunks: Buffer[] = [];
            let total = 0;
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done) break;
                    total += part.value.byteLength;
                    if (total > MAX_PACKAGE_BYTES) return { ok: false, error: 'package_size' };
                    chunks.push(Buffer.from(part.value));
                }
            } finally {
                await reader.cancel().catch(() => undefined);
                reader.releaseLock();
            }
            bytes = Buffer.concat(chunks, total);
        } else {
            bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > MAX_PACKAGE_BYTES) return { ok: false, error: 'package_size' };
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (sha256 !== listed.sha256 || (response.headers.get('x-nextmux-plugin-sha256') || sha256) !== sha256) return { ok: false, error: 'package_digest_mismatch' };
        const signature = response.headers.get('x-nextmux-plugin-signature') || '';
        const signatureVerified = verifyAppPluginSignature(id, pluginVersion, sha256, signature);
        return { ok: true, dataBase64: bytes.toString('base64'), sha256, source: 'marketplace', reviewStatus: 'approved',
            signaturePresent: signature.length > 0, signatureVerified, verified: signatureVerified };
    } catch { return { ok: false, error: 'market_network' }; }
}
