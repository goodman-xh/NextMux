import { merchantModelCategory, merchantOutputCategories } from '@nextmux/model-runtime/merchant-modalities';
import type { ModelTaskMetadata } from '@nextmux/model-runtime/model-task-capabilities';
import { selectMainPriceDimensions, validSummaryRate, priceDisplayUnitSize } from '@nextmux/model-runtime/price-summary';
import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { NextMuxPlatformService, PlatformMerchantSupportCatalogPage, PlatformOffering } from '../common/nextmux-platform-protocol';
import type { PublicMerchantDirectoryPage, PublicMerchantDirectoryQuery, PublicMerchantIdentity } from '../common/nextmux-public-merchants';
import { desktopText, type NextMuxDesktopLocale } from './nextmux-locale';
import { modelCenterText, modelCenterPriceMetric, modelCenterPriceUnit, modelCenterApiState } from './nextmux-model-center-locale';
import { modelUsageText } from './nextmux-model-usage-locale';
import { relayEvidenceText, relayMarketplaceText } from './nextmux-relay-marketplace-locale';
import { relayDelistedText, relayText } from './nextmux-relay-locale';
import { modelPickerEvidenceText, relayMultiplierTag, relayMultiplierText } from './nextmux-relay-picker';
import { INITIAL_RELAY_QUALITY, measuredModelFidelity } from '../common/nextmux-relay-evidence';
import { offeringMultiplierBps, offeringPriceSignature, offeringPriceText } from './nextmux-offering-price';
import { ImeInput } from './nextmux-ime-field';
import type { ModelPrimaryCategory } from '@nextmux/model-runtime/model-taxonomy';
import { modelCapabilityLabel, modelCategoryLabel } from './nextmux-model-taxonomy-locale';
import { ModelTaxonomyTags } from './nextmux-model-taxonomy-tags';
import { FavoriteHeartIcon } from './nextmux-favorite-icon';

export type ModelCenterCapability = 'all' | 'coding' | 'reasoning' | '3d' | 'image' | 'video' | 'audio';

/**
 * The Model Center's category filters: the directory server's browse buckets (public-merchant-ranking), named with the
 * shared taxonomy. "reasoning" is every text model; "audio" spans voice-over, music and sound effects. Tool support
 * ("coding") is a capability filter, listed apart and never as a category.
 */
export const MODEL_CENTER_CATEGORIES: readonly { readonly filter: Exclude<ModelCenterCapability, 'all' | 'coding'>; readonly categories: readonly ModelPrimaryCategory[] }[] = [
    { filter: 'reasoning', categories: ['language'] }, { filter: '3d', categories: ['3d'] }, { filter: 'image', categories: ['image'] }, { filter: 'video', categories: ['video'] },
    { filter: 'audio', categories: ['speech', 'music', 'sound_effect'] }
];

/** The name of one Model Center filter, in the shared category / capability words. */
export function modelCenterFilterLabel(locale: NextMuxDesktopLocale, filter: ModelCenterCapability): string {
    if (filter === 'all') return modelCenterText(locale, 'allCategories');
    if (filter === 'coding') return modelCapabilityLabel(locale, 'tools');
    return (MODEL_CENTER_CATEGORIES.find(entry => entry.filter === filter)?.categories ?? []).map(category => modelCategoryLabel(locale, category)).join(' / ');
}
type Service = Pick<NextMuxPlatformService, 'getPublicMerchantDirectory' | 'getMerchantSupportCatalog'>;
type Sort = 'quality' | 'authenticity' | 'latency' | 'multiplier';
type Props = {
    service: Service; locale: NextMuxDesktopLocale; view: 'all' | 'favorites' | 'capability';
    capability: ModelCenterCapability; query: string; favorites: readonly (readonly [string, string])[];
    copiedNumber?: string;
    /** Includes public store-profile edits and moderation changes. */
    directoryVersion?: string;
    refreshing?: boolean;
    onRefresh?: (tabKey?: string) => Promise<void> | void;
    onFavorite: (id: string, name: string) => void; onCopy: (id: string) => Promise<void>;
};

export const MODEL_CENTER_REFRESH_COOLDOWN_MS = 30_000;
const modelCenterCooldownUntilByTab: Record<string, number> = {};
type CachedDirectoryEntry = { readonly page: PublicMerchantDirectoryPage; readonly updatedAt: number };
type CachedSupportEntry = { readonly result: PlatformMerchantSupportCatalogPage; readonly updatedAt: number };
let merchantDirectoryCacheByService = new WeakMap<Service, Map<string, CachedDirectoryEntry>>();
let merchantSupportCatalogCacheByService = new WeakMap<Service, Map<string, CachedSupportEntry>>();
let merchantSupportPendingByService = new WeakMap<Service, Map<string, Promise<PlatformMerchantSupportCatalogPage>>>();

function directoryCacheFor(service: Service): Map<string, CachedDirectoryEntry> {
    let map = merchantDirectoryCacheByService.get(service);
    if (!map) {
        map = new Map();
        merchantDirectoryCacheByService.set(service, map);
    }
    return map;
}

function supportCacheFor(service: Service): Map<string, CachedSupportEntry> {
    let map = merchantSupportCatalogCacheByService.get(service);
    if (!map) {
        map = new Map();
        merchantSupportCatalogCacheByService.set(service, map);
    }
    return map;
}

function supportPendingFor(service: Service): Map<string, Promise<PlatformMerchantSupportCatalogPage>> {
    let map = merchantSupportPendingByService.get(service);
    if (!map) {
        map = new Map();
        merchantSupportPendingByService.set(service, map);
    }
    return map;
}

export function getCachedMerchantDirectoryPage(service: Service, requestKey: string): CachedDirectoryEntry | undefined {
    return directoryCacheFor(service).get(requestKey);
}

export function setCachedMerchantDirectoryPage(service: Service, requestKey: string, page: PublicMerchantDirectoryPage): void {
    const cache = directoryCacheFor(service);
    cache.delete(requestKey);
    cache.set(requestKey, { page, updatedAt: Date.now() });
    while (cache.size > 32) cache.delete(cache.keys().next().value!);
}

export function getCachedMerchantSupportCatalog(
    service: Service,
    merchantId: string,
    searchTerm = '',
    category: 'all' | 'language' | 'image' | 'video' | 'audio' | 'others' = 'all'
): CachedSupportEntry | undefined {
    return supportCacheFor(service).get(JSON.stringify([merchantId, searchTerm.trim(), category]));
}

export function setCachedMerchantSupportCatalog(
    service: Service,
    merchantId: string,
    searchTerm: string,
    category: 'all' | 'language' | 'image' | 'video' | 'audio' | 'others',
    result: PlatformMerchantSupportCatalogPage
): void {
    const cache = supportCacheFor(service);
    const key = JSON.stringify([merchantId, searchTerm.trim(), category]);
    cache.delete(key);
    cache.set(key, { result, updatedAt: Date.now() });
    while (cache.size > 64) cache.delete(cache.keys().next().value!);
}

export function prefetchMerchantSupportCatalog(service: Service, merchantId: string): void {
    const key = JSON.stringify([merchantId, '', 'all']);
    const cached = supportCacheFor(service).get(key);
    if (cached && Date.now() - cached.updatedAt < 60_000) return;
    const pending = supportPendingFor(service);
    if (pending.has(key) || pending.size >= 8) return;
    const operation = service.getMerchantSupportCatalog(merchantId, { search: '', category: 'all' }, false)
        .then(result => {
            setCachedMerchantSupportCatalog(service, merchantId, '', 'all', result);
            return result;
        })
        .finally(() => {
            if (pending.get(key) === operation) pending.delete(key);
        });
    pending.set(key, operation);
    void operation.catch(() => undefined);
}

export function resetModelCenterRefreshCooldownsForTest(): void {
    for (const key of Object.keys(modelCenterCooldownUntilByTab)) {
        delete modelCenterCooldownUntilByTab[key];
    }
    merchantDirectoryCacheByService = new WeakMap();
    merchantSupportCatalogCacheByService = new WeakMap();
    merchantSupportPendingByService = new WeakMap();
}

/** Portalled hints cannot be clipped by the scroll area or the price drawer. */
export function ModelCenterHint({ text, locale, children, focusable = false, keepOpenOnClick = false, className }: {
    text: string; locale: NextMuxDesktopLocale; children: React.ReactNode; focusable?: boolean; keepOpenOnClick?: boolean; className?: string;
}): React.ReactElement {
    const id = React.useId();
    const anchor = React.useRef<HTMLSpanElement>(null);
    const tooltip = React.useRef<HTMLSpanElement>(null);
    const [position, setPosition] = React.useState<{ left: number; top: number }>();
    React.useEffect(() => {
        if (!position) return;
        const close = (event: Event): void => { if (!(event.target instanceof Node) || !tooltip.current?.contains(event.target)) setPosition(undefined); };
        window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
        return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
    }, [Boolean(position)]);
    const show = (): void => {
        const rect = anchor.current?.getBoundingClientRect();
        if (rect) setPosition({ left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 292)),
            top: Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 100)) });
    };
    React.useLayoutEffect(() => {
        if (!position || !tooltip.current || !anchor.current) return;
        const rect = anchor.current.getBoundingClientRect();
        const size = tooltip.current.getBoundingClientRect();
        const top = rect.bottom + 8 + size.height <= window.innerHeight - 12 ? rect.bottom + 8 : Math.max(12, rect.top - size.height - 8);
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - size.width - 12));
        if (left !== position.left || top !== position.top) setPosition({ left, top });
    }, [position, text]);
    return <span ref={anchor} className={className ? `nmx-mc-hint ${className}` : 'nmx-mc-hint'} tabIndex={focusable ? 0 : undefined} aria-label={focusable ? text : undefined}
        aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={() => { if (!anchor.current?.contains(document.activeElement)) setPosition(undefined); }}
        onFocus={show} onClick={() => { if (!keepOpenOnClick) setPosition(undefined); }} onBlur={() => { if (!anchor.current?.matches(':hover')) setPosition(undefined); }} onKeyDown={event => { if (event.key === 'Escape' && position) { event.stopPropagation(); setPosition(undefined); } }}>
        {children}{position && createPortal(<span ref={tooltip} id={id} className='nmx-mc-tooltip' role='tooltip' dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}
            style={position}>{text}</span>, document.body)}
    </span>;
}

/**
 * Newly listed stores show the initial 100% rating until someone votes: with zero votes no other number (a routing
 * prior, a stale directory value) may stand in for it.
 */
export function modelCenterRating(merchant: PublicMerchantIdentity): { value: number | undefined; initial: boolean; samples: number } {
    const count = merchant.measurement?.quality?.sampleCount;
    const samples = Number.isSafeInteger(count) && count! > 0 ? count! : 0;
    return samples === 0 ? { value: INITIAL_RELAY_QUALITY, initial: true, samples } : { value: merchant.metrics?.quality, initial: false, samples };
}

/** The support list's browse bucket (server model kind); rows name their category with the shared taxonomy. */
export function modelCenterModelCategory(model: ModelTaskMetadata): 'language' | 'image' | 'video' | 'audio' | 'others' {
    return merchantModelCategory(model);
}

export function mergeModelCenterMerchants(previous: readonly PublicMerchantIdentity[], page: PublicMerchantDirectoryPage): PublicMerchantIdentity[] {
    return [...new Map([...previous, ...page.merchants].map(merchant => [merchant.id, merchant])).values()];
}

/** Favorites are bounded local IDs. Fetch all chunks before sorting, not just the first 100. */
export async function loadModelCenterFavorites(service: Service, query: PublicMerchantDirectoryQuery, ids: readonly string[], force = false): Promise<PublicMerchantDirectoryPage> {
    const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, index * 100 + 100));
    const pages = await Promise.all(chunks.map(merchantIds => service.getPublicMerchantDirectory({ ...query, merchantIds }, force)));
    const merchants = [...new Map(pages.flatMap(page => page.merchants).map(merchant => [merchant.id, merchant])).values()];
    const metric = query.sort === 'latency' ? 'latencyMs' : query.sort === 'multiplier' ? 'multiplierBps' : query.sort || 'quality';
    merchants.sort((left, right) => {
        const a = metric === 'id' ? undefined : left.metrics?.[metric];
        const b = metric === 'id' ? undefined : right.metrics?.[metric];
        return (a === undefined ? 1 : 0) - (b === undefined ? 1 : 0)
            || (a !== undefined && b !== undefined ? (a - b) * (query.direction === 'asc' ? 1 : -1) : 0)
            || left.id.localeCompare(right.id);
    });
    return { merchants, totalCount: merchants.length, measuredAt: pages[0]?.measuredAt || new Date().toISOString() };
}

export function ModelCenterMerchants(props: Props): React.ReactElement {
    const { service, locale, view, capability, query, onFavorite, onCopy } = props;
    const [sort, setSort] = React.useState<Sort>('quality');
    const [direction, setDirection] = React.useState<'asc' | 'desc'>('desc');
    const [layout, setLayout] = React.useState<'list' | 'grid'>(() => {
        try { return window.localStorage.getItem('nextmux.desktop.modelCenterLayout.v2') === 'list' ? 'list' : 'grid'; }
        catch { return 'grid'; }
    });
    const changeLayout = (value: 'list' | 'grid'): void => {
        setLayout(value);
        try { window.localStorage.setItem('nextmux.desktop.modelCenterLayout.v2', value); }
        catch { /* Keep the selected layout usable when local storage is unavailable. */ }
    };
    const favoriteIds = props.favorites.map(([id]) => id).filter(id => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id));
    const favoriteKey = view === 'favorites' ? JSON.stringify(favoriteIds) : '';
    const requestKey = JSON.stringify([view, view === 'capability' ? capability : 'all', query.trim(), sort, direction, favoriteKey, props.directoryVersion]);
    const cachedDirectory = getCachedMerchantDirectoryPage(service, requestKey);
    const [page, setPage] = React.useState<PublicMerchantDirectoryPage | undefined>(() => cachedDirectory?.page);
    const [loading, setLoading] = React.useState(() => !cachedDirectory);
    const [error, setError] = React.useState(false);
    const [retry, setRetry] = React.useState(0);
    const forceNextLoad = React.useRef<string>();
    // The request a press of 刷新 forced: only that load spins the button (a search, sort or tab load does not).
    const [manualRefreshKey, setManualRefreshKey] = React.useState<string>();
    const tabCooldownKey = view === 'capability' ? `capability:${capability}` : view === 'favorites' ? 'favorites' : 'quality-relays';
    const [cooldownUntilByTab, setCooldownUntilByTab] = React.useState<Readonly<Record<string, number>>>(() => ({ ...modelCenterCooldownUntilByTab }));
    const [cooldownNow, setCooldownNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const hasActiveCooldown = Object.values(cooldownUntilByTab).some(until => until > Date.now());
        if (!hasActiveCooldown) return;
        const interval = window.setInterval(() => {
            const now = Date.now();
            setCooldownNow(now);
            if (!Object.values(cooldownUntilByTab).some(until => until > now)) {
                window.clearInterval(interval);
            }
        }, 1000);
        return () => window.clearInterval(interval);
    }, [cooldownUntilByTab]);
    const [detail, setDetail] = React.useState<PublicMerchantIdentity>();
    const [detailClosing, setDetailClosing] = React.useState(false);
    const [drawerLayer, setDrawerLayer] = React.useState<{ host: HTMLElement; top: number }>();
    const directoryRef = React.useRef<HTMLElement>(null);
    const closeTimer = React.useRef<number>();
    const [copyFailed, setCopyFailed] = React.useState(false);
    const generation = React.useRef(0);
    const busy = React.useRef(false);
    const sentinel = React.useRef<HTMLDivElement>(null);
    const activeRequest = React.useRef(requestKey);
    activeRequest.current = requestKey;
    const request = (): PublicMerchantDirectoryQuery => ({ query: query.trim(), sort, direction,
        capability: view === 'capability' ? capability : 'all' });

    React.useEffect(() => {
        const token = ++generation.current;
        const force = forceNextLoad.current === requestKey;
        forceNextLoad.current = undefined;
        const cooldownKey = tabCooldownKey;
        const cachedEntry = !force ? getCachedMerchantDirectoryPage(service, requestKey) : undefined;
        busy.current = true;
        setPage(cachedEntry?.page);
        setLoading(!cachedEntry || force);
        setError(false); setDetail(undefined); setDetailClosing(false);
        const timer = window.setTimeout(() => {
            const operation = view === 'favorites' ? loadModelCenterFavorites(service, request(), favoriteIds, force)
                : service.getPublicMerchantDirectory(request(), force);
            void operation.then(result => {
                setCachedMerchantDirectoryPage(service, requestKey, result);
                if (token === generation.current) setPage(result);
            })
                .catch(() => {
                    if (token === generation.current && !cachedEntry) setError(true);
                    // A refresh that failed was not a refresh: it may be tried again at once.
                    if (force) {
                        delete modelCenterCooldownUntilByTab[cooldownKey];
                        setCooldownUntilByTab(previous => { const next = { ...previous }; delete next[cooldownKey]; return next; });
                    }
                })
                .finally(() => {
                    if (force) setManualRefreshKey(current => current === requestKey ? undefined : current);
                    if (token === generation.current) { busy.current = false; setLoading(false); }
                });
        }, query.trim() && !force ? 180 : 0);
        return () => { window.clearTimeout(timer); ++generation.current; };
    // The serialized key contains every request parameter, including mutable favorite IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, requestKey, retry]);

    const loadMore = React.useCallback(async (): Promise<void> => {
        if (busy.current || !page?.nextCursor || view === 'favorites') return;
        const token = generation.current;
        const key = requestKey;
        busy.current = true; setLoading(true); setError(false);
        try {
            const result = await service.getPublicMerchantDirectory({ ...request(), after: page.nextCursor });
            if (token !== generation.current || key !== activeRequest.current) return;
            if (result.nextCursor && result.nextCursor === page.nextCursor) throw new Error('DIRECTORY_CURSOR_STALLED');
            setPage({ ...result, merchants: mergeModelCenterMerchants(page.merchants, result) });
        } catch { if (token === generation.current) setError(true); }
        finally { if (token === generation.current) { busy.current = false; setLoading(false); } }
    }, [service, page, requestKey, view]);
    React.useEffect(() => {
        if (!page?.nextCursor || loading || error || typeof IntersectionObserver === 'undefined' || !sentinel.current) return;
        const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadMore(); },
            { root: sentinel.current.closest('.nmx-workspace-scroll'), rootMargin: '160px' });
        observer.observe(sentinel.current);
        return () => observer.disconnect();
    }, [page?.nextCursor, loading, error, loadMore]);
    // The supported-model drawer covers only this tab's content area: it is
    // portalled into the workspace below the Model Center header, so it can
    // never cover the titlebar tabs and it stays in view however far the
    // directory is scrolled. The host is chosen before the drawer first
    // mounts, so the drawer is created once (one catalog fetch) and only its
    // offset is re-measured on resize.
    const measureDrawerLayer = (): { host: HTMLElement; top: number } | undefined => {
        const scroll = directoryRef.current?.closest<HTMLElement>('.nmx-workspace-scroll');
        const host = scroll?.parentElement;
        if (!scroll || !host || getComputedStyle(host).position === 'static') return undefined;
        return { host, top: Math.max(0, Math.round(scroll.getBoundingClientRect().top - host.getBoundingClientRect().top)) };
    };
    React.useLayoutEffect(() => {
        if (!detail || !drawerLayer) return;
        const scroll = directoryRef.current?.closest<HTMLElement>('.nmx-workspace-scroll');
        if (!scroll || typeof ResizeObserver === 'undefined') return;
        const measure = (): void => {
            const next = measureDrawerLayer();
            setDrawerLayer(current => !current || !next || next.host !== current.host || next.top === current.top ? current : { host: next.host, top: next.top });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(drawerLayer.host); observer.observe(scroll);
        return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detail, drawerLayer?.host]);
    React.useEffect(() => () => window.clearTimeout(closeTimer.current), []);
    const openDetail = (merchant: PublicMerchantIdentity): void => {
        window.clearTimeout(closeTimer.current); setDetailClosing(false);
        setDrawerLayer(measureDrawerLayer()); setDetail(merchant);
    };
    // Radix/shadcn Sheet behavior: the exit animation plays before unmount.
    const closeDetail = (): void => {
        if (!detail || detailClosing) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setDetail(undefined); setDrawerLayer(undefined); return; }
        setDetailClosing(true);
        closeTimer.current = window.setTimeout(() => { setDetail(undefined); setDetailClosing(false); setDrawerLayer(undefined); }, 160);
    };
    const text = (key: Parameters<typeof modelCenterText>[1], count?: number): string => modelCenterText(locale, key, count);
    const market = (key: Parameters<typeof relayMarketplaceText>[1]): string => relayMarketplaceText(locale, key);
    const hint = (content: React.ReactNode, label: string, focusable = true): React.ReactElement =>
        <ModelCenterHint text={label} locale={locale} focusable={focusable}>{content}</ModelCenterHint>;
    const percent = (value: number | undefined): string => value === undefined ? '—' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
    // “Delisted” is only concluded from the unfiltered favourites list: a search that misses a merchant (renamed,
    // say) does not prove it left (audit A03-09).
    const missing = view === 'favorites' && page && !loading && !error && !query.trim() ? props.favorites.filter(([id]) =>
        !page.merchants.some(item => item.id === id)) : [];
    const drawer = detail && <MerchantModelDrawer service={service} merchant={detail} locale={locale} closing={detailClosing} onClose={closeDetail} />;
    return <section ref={directoryRef} className='nmx-mc-directory' dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} data-nmx-literal>
        <header className='nmx-mc-directory-toolbar'>
            <span className='nmx-mc-directory-count'>
                <span>{page?.totalCount !== undefined ? text('listed', page.totalCount) : loading ? modelUsageText(locale, 'loading') : '—'}</span>
                {(view === 'all' || view === 'capability' || view === 'favorites') && (() => {
                    const cooldownUntil = cooldownUntilByTab[tabCooldownKey] || modelCenterCooldownUntilByTab[tabCooldownKey] || 0;
                    const remainingSeconds = Math.max(0, Math.ceil((cooldownUntil - cooldownNow) / 1000));
                    const isCoolingDown = remainingSeconds > 0;
                    const isSpinning = loading && manualRefreshKey === requestKey || Boolean(props.refreshing);
                    const isDisabled = isSpinning || isCoolingDown;
                    const refreshLabel = isCoolingDown ? text('refreshCooldown', remainingSeconds) : text('refresh');
                    return <ModelCenterHint text={refreshLabel} locale={locale} focusable={false} keepOpenOnClick={true}
                        className={isDisabled ? 'is-disabled' : undefined}>
                        <button type='button' className={`nmx-mc-directory-refresh nmx-mc-refresh${isCoolingDown ? ' is-cooling' : ''}${isSpinning ? ' is-spinning' : ''}`} data-testid='mc-directory-refresh'
                            data-tab-key={tabCooldownKey} data-cooldown-seconds={isCoolingDown ? remainingSeconds : undefined}
                            aria-disabled={isDisabled} aria-label={refreshLabel} title={refreshLabel}
                            onClick={() => {
                                if (isDisabled || modelCenterCooldownUntilByTab[tabCooldownKey] > Date.now()) return;
                                const now = Date.now();
                                const until = now + MODEL_CENTER_REFRESH_COOLDOWN_MS;
                                modelCenterCooldownUntilByTab[tabCooldownKey] = until;
                                setCooldownNow(now);
                                setCooldownUntilByTab(prev => ({ ...prev, [tabCooldownKey]: until }));
                                forceNextLoad.current = requestKey;
                                setLoading(true);
                                setManualRefreshKey(requestKey);
                                setRetry(value => value + 1);
                                void props.onRefresh?.(tabCooldownKey);
                            }}>
                            <i className='codicon codicon-refresh' aria-hidden='true' />
                        </button>
                    </ModelCenterHint>;
                })()}
            </span>
            <div className='nmx-mc-directory-controls'><div className='nmx-mc-sort' role='group' aria-label={market('sort')}>
                {(['quality', 'authenticity', 'latency', 'multiplier'] as const).map(key => {
                    const label = key === 'multiplier' ? offeringPriceText(locale, 'averageMultiplier') : market(key === 'quality' ? 'rating' : key);
                    return <ModelCenterHint key={key} text={label} locale={locale}><button type='button' aria-label={label} aria-pressed={sort === key}
                        onClick={() => { setSort(key); setDirection(key === 'quality' || key === 'authenticity' ? 'desc' : 'asc'); }}>
                        <i className={`codicon codicon-${({ quality: 'star-full', authenticity: 'verified', latency: 'watch', multiplier: 'symbol-number' })[key]}`} aria-hidden='true' />
                    </button></ModelCenterHint>;
                })}
                {hint(<button type='button' aria-label={text('direction')} onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}>
                    <i className={`codicon codicon-arrow-${direction === 'asc' ? 'up' : 'down'}`} aria-hidden='true' /></button>, text('direction'), false)}
            </div><div className='nmx-mc-view-switch' role='group' aria-label={text('viewLayout')}>
                {(['list', 'grid'] as const).map(value => {
                    const label = text(value === 'list' ? 'listView' : 'gridView');
                    return <ModelCenterHint key={value} text={label} locale={locale} focusable={false}><button type='button'
                        data-model-center-layout={value} aria-label={label} aria-pressed={layout === value}
                        onClick={() => changeLayout(value)}><i className={`codicon codicon-${value === 'list' ? 'list-flat' : 'table'}`} aria-hidden='true' /></button></ModelCenterHint>;
                })}
            </div></div>
        </header>
        <div className={`nmx-mc-merchants nmx-mc-merchants--${layout}${layout === 'grid' ? ' nmx-mc-grid' : ''}`} aria-busy={loading}>
            {page?.merchants.map(merchant => {
                const favorite = favoriteIds.includes(merchant.id);
                const publicCode = merchant.publicCode;
                const rating = modelCenterRating(merchant);
                const quality = rating.value === undefined ? relayEvidenceText(locale, 'unmeasured') : rating.initial ? text('initialRating') : text('votedRating', rating.samples);
                const apiState = merchant.apiStatus?.state;
                const statusLabel = `${text('apiStatus')} · ${modelCenterApiState(locale, apiState)}`;
                const outputs = merchantOutputCategories(merchant.outputCategories);
                const storeIntro = (merchant.storeTagline || merchant.storeDescription || '').trim();
                const storeIntroDisplay = storeIntro || text('noStoreIntro');
                return <article className='nmx-mc-merchant' key={merchant.id} data-model-center-merchant={merchant.id}>
                    <div className='nmx-mc-identity'>{hint(<strong>{merchant.name}</strong>, `${merchant.name}\n${storeIntroDisplay}`)}
                        {hint(
                            <p className={`nmx-mc-tagline nmx-mc-merchant-bio${storeIntro ? '' : ' is-empty'}`} data-testid={`mc-store-tagline-${merchant.id}`} data-nmx-literal dir='auto'>
                                {storeIntroDisplay}
                            </p>,
                            `${merchant.name} · ${storeIntroDisplay}`,
                        )}<span>{hint(<code dir='ltr'>{publicCode || '—'}</code>, publicCode || market('copyNumber'))}
                        {hint(<button type='button' disabled={!publicCode} aria-label={market('copyNumber')} onClick={() => { if (!publicCode) return; setCopyFailed(false); void onCopy(publicCode).catch(() => setCopyFailed(true)); }}><i className={`codicon codicon-${publicCode && props.copiedNumber === publicCode ? 'check' : 'copy'}`} aria-hidden='true' /></button>, market('copyHint'), false)}
                        {hint(<i className={`codicon codicon-${apiState === 'ready' ? 'pass' : apiState === 'refreshing' ? 'sync' : apiState === 'degraded' || apiState === 'unavailable' ? 'warning' : 'circle-outline'}`} data-api-state={apiState || 'unknown'} aria-hidden='true' />, statusLabel)}
                    </span>{outputs.length > 0 && <span className='nmx-mc-capabilities'>{outputs.map(value => <small key={value}>{market(value === 'text' ? 'language' : value as 'image' | 'video' | 'audio')}</small>)}</span>}</div>
                    <div className='nmx-mc-metrics'>
                        {hint(<><i className='codicon codicon-star-full' aria-hidden='true' /><strong data-unmeasured={rating.value === undefined || undefined}>{percent(rating.value === undefined ? undefined : rating.value / 100)}</strong></>, `${market('rating')} · ${quality}`)}
                        {/* 真实性: the mean identity score of the relay's models that have one (availability stays in the platform's routing). */}
                        {hint(<><i className='codicon codicon-verified' aria-hidden='true' /><strong data-unmeasured={merchant.metrics?.authenticity === undefined || undefined}>{percent(merchant.metrics?.authenticity === undefined ? undefined : merchant.metrics.authenticity / 100)}</strong></>,
                            `${market('authenticity')} · ${merchant.metrics?.authenticity === undefined ? relayText(locale, 'authenticityPending') : percent(merchant.metrics.authenticity / 100)}`)}
                        {hint(<><i className='codicon codicon-watch' aria-hidden='true' /><strong dir='ltr' data-unmeasured={merchant.metrics?.latencyMs === undefined || undefined}>{merchant.metrics?.latencyMs === undefined ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(merchant.metrics.latencyMs)} ms`}</strong></>, `${market('latency')} · ${merchant.metrics?.latencyMs === undefined ? relayEvidenceText(locale, 'unmeasured') : `${merchant.metrics.latencyMs} ms`}`)}
                        {/* 平均倍率: the mean over the merchant's multiplier-priced models × APIs (its own prices have none). */}
                        {(() => {
                            const average = merchant.averageMultiplierBps === undefined ? merchant.metrics?.multiplierBps : merchant.averageMultiplierBps ?? undefined;
                            const multiplier = relayMultiplierTag(locale, average);
                            return hint(<><i className='codicon codicon-symbol-number' aria-hidden='true' /><strong dir='ltr' data-unmeasured={!multiplier || undefined}>{multiplier || '—'}</strong></>,
                                `${offeringPriceText(locale, 'averageMultiplier')} · ${multiplier || '—'}`);
                        })()}
                    </div>
                    <div className='nmx-mc-actions'>
                        {hint(<button type='button' data-model-center-favorite={merchant.id} aria-pressed={favorite} aria-label={modelUsageText(locale, favorite ? 'removeFavorite' : 'favorites')}
                            onClick={() => onFavorite(merchant.id, merchant.name)}><FavoriteHeartIcon active={favorite} /></button>, modelUsageText(locale, favorite ? 'removeFavorite' : 'favorites'), false)}
                        {hint(<button type='button' data-model-center-list onPointerEnter={() => prefetchMerchantSupportCatalog(service, merchant.id)} onClick={() => openDetail(merchant)}>{text('supported')}</button>, `${merchant.name} · ${text('supported')}`, false)}
                    </div>
                </article>;
            })}
            {missing.map(([id, name]) => <article className='nmx-mc-merchant is-unavailable' key={id} data-model-center-delisted={id} aria-disabled='true'>
                <div className='nmx-mc-identity'><strong>{name}</strong><span><small className='nmx-mc-delisted'>{relayDelistedText(locale)}</small></span></div>
                <div className='nmx-mc-actions'><button type='button' data-model-center-favorite={id} aria-pressed='true' aria-label={`${modelUsageText(locale, 'removeFavorite')} · ${name}`}
                    onClick={() => onFavorite(id, name)}><FavoriteHeartIcon active /><span>{modelUsageText(locale, 'removeFavorite')}</span></button></div></article>)}
        </div>
        <div className={`nmx-mc-directory-status${!page && (loading || error) ? ' is-initial' : ''}`} ref={sentinel} role='status' aria-live='polite'>
            {loading && <><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />{modelUsageText(locale, 'loading')}</>}
            {error && <><span>{text('directoryFailed')}</span><button type='button' onClick={() => page?.nextCursor ? void loadMore() : setRetry(retry + 1)}>{modelUsageText(locale, 'retry')}</button></>}
            {!loading && !error && page && !page.merchants.length && !missing.length && <span>{view === 'favorites' && (!favoriteIds.length || !query.trim()) ? modelUsageText(locale, 'noFavorites') : market('empty')}</span>}
            {!loading && !error && page?.nextCursor && <button type='button' onClick={() => void loadMore()}>{modelUsageText(locale, 'loadMore')}</button>}
            {copyFailed && <span>{modelUsageText(locale, 'retry')}</span>}
        </div>
        {drawer && (drawerLayer ? createPortal(<div className='nmx-mc-directory nmx-mc-drawer-layer' dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} data-nmx-literal
            style={{ top: `${drawerLayer.top}px` }}>{drawer}</div>, drawerLayer.host) : drawer)}
    </section>;
}

/** Official and user sides select independently: an available quote is never inferred from a multiplier. */
export function ModelCenterPricePreview({ model, side, locale }: {
    model: Pick<PlatformOffering, 'category' | 'output' | 'pricingDetails'>;
    side: 'official' | 'user'; locale: NextMuxDesktopLocale;
}): React.ReactElement {
    const summary = selectMainPriceDimensions(model.pricingDetails?.dimensions || [], model, item => validSummaryRate(item[side]));
    // A model without an official price (sold at the merchant's own price) shows "-" on the official side.
    if (summary.state === 'missing' && side === 'official') return <span dir='ltr'>US$-</span>;
    if (summary.state !== 'available') return <>{modelCenterText(locale, summary.state === 'missing' ? 'pricePending' : 'priceNotSummarized')}</>;
    const format = (item: typeof summary.dimensions[number]): string => {
        const rate = item[side]!;
        return new Intl.NumberFormat(locale, { style: 'currency', currency: item.currency, maximumFractionDigits: 6 })
            .format(rate.amountMicros / rate.unitSize * priceDisplayUnitSize(item.metric) / 1_000_000);
    };
    if (summary.dimensions.every(item => ['input_token', 'output_token'].includes(item.metric))) {
        return <><span dir='ltr'>{summary.dimensions.map(item => `${item.metric === 'input_token' ? '↑' : '↓'} ${format(item)}`).join(' · ')}</span><small>/ {modelCenterPriceUnit(locale, 'input_token', 1_000_000)}</small></>;
    }
    const item = summary.dimensions[0];
    return <><span>{modelCenterPriceMetric(locale, item.metric)} <bdi dir='ltr'>{format(item)}</bdi></span><small>/ {modelCenterPriceUnit(locale, item.metric, priceDisplayUnitSize(item.metric))}</small></>;
}

type MerchantModelDrawerProps = {
    service: Service; merchant: PublicMerchantIdentity; locale: NextMuxDesktopLocale; onClose: () => void; closing?: boolean;
};
type SupportCategory = 'all' | 'language' | 'image' | 'video' | 'audio' | 'others';

export function MerchantModelDrawer(props: MerchantModelDrawerProps): React.ReactElement {
    // Switching merchants starts a fresh search and also invalidates every pending page of the old drawer.
    return <MerchantModelDrawerBody key={props.merchant.id} {...props} />;
}

function MerchantModelDrawerBody({ service, merchant, locale, onClose, closing = false }: MerchantModelDrawerProps): React.ReactElement {
    const [search, setSearch] = React.useState('');
    const [composing, setComposing] = React.useState(false);
    const composition = React.useRef(false);
    const [category, setCategory] = React.useState<SupportCategory>('all');
    const [expanded, setExpanded] = React.useState('');
    const generation = React.useRef(0);
    const busy = React.useRef(false);
    const dialog = React.useRef<HTMLElement>(null);
    const list = React.useRef<HTMLDivElement>(null);
    const sentinel = React.useRef<HTMLDivElement>(null);
    const searchTerm = search.trim();
    const requestKey = JSON.stringify([merchant.id, searchTerm, category]);
    const initialCached = getCachedMerchantSupportCatalog(service, merchant.id, searchTerm, category);
    const [page, setPage] = React.useState<{ key: string; offerings: readonly PlatformOffering[]; cursor?: string } | undefined>(() =>
        initialCached ? { key: requestKey, cursor: initialCached.result.nextCursor, offerings: initialCached.result.offerings } : undefined
    );
    const [loading, setLoading] = React.useState(() => !initialCached);
    const [failure, setFailure] = React.useState<{ key: string; after?: string; force?: boolean }>();
    const activeRequest = React.useRef(requestKey);
    const loadedSnapshot = React.useRef<{ key: string; version: string } | undefined>(
        initialCached ? { key: requestKey, version: initialCached.result.snapshotVersion } : undefined
    );
    activeRequest.current = requestKey;
    const currentPage = page?.key === requestKey ? page : undefined;
    const cursor = currentPage?.cursor;
    const error = failure?.key === requestKey;
    const text = (key: Parameters<typeof modelCenterText>[1], count?: number): string => modelCenterText(locale, key, count);
    const load = React.useCallback(async (after?: string, force = false): Promise<void> => {
        if (busy.current || composition.current || activeRequest.current !== requestKey) return;
        const cachedEntry = !after && !force ? getCachedMerchantSupportCatalog(service, merchant.id, searchTerm, category) : undefined;
        if (cachedEntry && Date.now() - cachedEntry.updatedAt < 60_000) {
            loadedSnapshot.current = { key: requestKey, version: cachedEntry.result.snapshotVersion };
            setPage({ key: requestKey, cursor: cachedEntry.result.nextCursor, offerings: cachedEntry.result.offerings });
            setFailure(undefined);
            setLoading(false);
            return;
        }
        const token = generation.current;
        busy.current = true; setLoading(!cachedEntry); setFailure(undefined);
        try {
            // This display snapshot searches the whole merchant, before pagination. Never filter only loaded rows.
            const pendingPrefetch = !after && !force ? supportPendingFor(service).get(requestKey) : undefined;
            const result = await (pendingPrefetch || service.getMerchantSupportCatalog(merchant.id, { search: searchTerm, category, after }, force));
            if (!after) setCachedMerchantSupportCatalog(service, merchant.id, searchTerm, category, result);
            if (token !== generation.current || activeRequest.current !== requestKey) return;
            if (after && result.nextCursor && result.nextCursor === after) throw new Error('CATALOG_CURSOR_STALLED');
            if (after && loadedSnapshot.current?.key === requestKey && loadedSnapshot.current.version !== result.snapshotVersion) {
                throw new Error('SUPPORT_CURSOR_STALE');
            }
            loadedSnapshot.current = { key: requestKey, version: result.snapshotVersion };
            setPage(previous => ({ key: requestKey, cursor: result.nextCursor, offerings: [...new Map([
                ...(after && previous?.key === requestKey ? previous.offerings : []), ...result.offerings
            ].map(offering => [offering.id, offering])).values()] }));
        } catch (reason) {
            if (token === generation.current && activeRequest.current === requestKey) {
                const detail = reason && typeof reason === 'object' ? reason as { code?: unknown; message?: unknown } : undefined;
                const stale = after && /cursor_stale/i.test(`${detail?.code || ''} ${detail?.message || ''}`);
                // A cursor belongs to one display snapshot. Restart explicitly on retry instead of merging versions.
                if (stale) { setPage(undefined); loadedSnapshot.current = undefined; }
                if (!after && !stale && cachedEntry) {
                    loadedSnapshot.current = { key: requestKey, version: cachedEntry.result.snapshotVersion };
                    setPage({ key: requestKey, cursor: cachedEntry.result.nextCursor, offerings: cachedEntry.result.offerings });
                } else {
                    setFailure({ key: requestKey, after: stale ? undefined : after, force: Boolean(stale) });
                }
            }
        } finally {
            if (token === generation.current && activeRequest.current === requestKey) { busy.current = false; setLoading(false); }
        }
    }, [service, merchant.id, searchTerm, category, requestKey]);
    React.useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
        return () => { if (opener?.isConnected) opener.focus(); };
    }, []);
    React.useEffect(() => {
        ++generation.current; busy.current = false;
        const cachedEntry = getCachedMerchantSupportCatalog(service, merchant.id, searchTerm, category);
        loadedSnapshot.current = cachedEntry ? { key: requestKey, version: cachedEntry.result.snapshotVersion } : undefined;
        setPage(cachedEntry ? { key: requestKey, cursor: cachedEntry.result.nextCursor, offerings: cachedEntry.result.offerings } : undefined);
        setFailure(undefined); setLoading(!cachedEntry); setExpanded('');
        if (list.current) list.current.scrollTop = 0;
        // No partial IME syllables reach the server. A committed word follows the same debounce as typing.
        const timer = composing ? undefined : window.setTimeout(() => void load(), searchTerm ? 300 : 0);
        return () => { window.clearTimeout(timer); ++generation.current; };
    }, [service, merchant.id, category, requestKey, load, composing, searchTerm]);
    const loadMore = React.useCallback((): void => {
        if (cursor && !loading && !error && !closing) void load(cursor);
    }, [cursor, loading, error, closing, load]);
    React.useEffect(() => {
        if (!cursor || loading || error || closing || !list.current || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) loadMore();
        }, { root: list.current, rootMargin: '160px' });
        observer.observe(sentinel.current);
        return () => observer.disconnect();
    }, [cursor, loading, error, closing, loadMore]);
    const executable = new Map<string, PlatformOffering>();
    // One row per model and price: the same model on two APIs of this merchant at the same price shows once, at
    // different prices twice (same name; the hover and the expanded table show what each one charges).
    for (const offering of currentPage?.offerings || []) {
        if (offering.status !== 'active') continue;
        const key = `${offering.registryModelId}\n${offeringPriceSignature(offering)}`;
        if (!executable.has(key)) executable.set(key, offering);
    }
    const rows = [...executable.values()];
    const categories: readonly SupportCategory[] = ['all', 'language', 'image', 'video', 'audio', 'others'];
    const formattedAmount = (value: number | null | undefined, currency: string): string => value == null ? text('pricePending')
        : new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 6 }).format(value / 1_000_000);
    // Tabs are the server's browse buckets: three are primary categories and use their shared names; "audio" and
    // "others" span several categories and keep their own.
    const categoryText = (value: SupportCategory): string => value === 'language' || value === 'image' || value === 'video' ? modelCategoryLabel(locale, value)
        : value === 'others' ? text('others') : relayMarketplaceText(locale, value);
    return <div className={`nmx-mc-drawer-backdrop${closing ? ' is-closing' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <section ref={dialog} className='nmx-mc-drawer' role='dialog' aria-modal='true' aria-label={`${merchant.name} · ${text('supported')}`}
            onKeyDown={event => {
                if (event.key === 'Escape' && (composition.current || event.nativeEvent.isComposing || event.keyCode === 229)) {
                    // Search inputs otherwise clear their value without compositionend, leaving IME searches suspended.
                    event.preventDefault(); event.stopPropagation(); return;
                }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
                if (event.key === 'Tab') {
                    const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
                    const next = event.shiftKey && document.activeElement === nodes[0] ? nodes.at(-1) : !event.shiftKey && document.activeElement === nodes.at(-1) ? nodes[0] : undefined;
                    if (next) { event.preventDefault(); next.focus(); }
                }
            }}>
            <header><div><ModelCenterHint locale={locale} text={merchant.name} focusable><h3>{merchant.name}</h3></ModelCenterHint><code dir='ltr'>{merchant.publicCode || '—'}</code></div><button type='button' aria-label={text('close')} onClick={onClose}><i className='codicon codicon-close' aria-hidden='true' /></button></header>
            <MerchantStoreProfile merchant={merchant} locale={locale} />
            <label className='nmx-mc-model-search'><i className='codicon codicon-search' aria-hidden='true' /><ImeInput type='search' data-model-center-model-search
                value={search} aria-label={text('modelSearch')} placeholder={text('modelSearch')} maxLength={120}
                onChange={event => setSearch(event.currentTarget.value)}
                onCompositionStart={() => { composition.current = true; setComposing(true); }}
                onCompositionEnd={event => { composition.current = false; setSearch(event.currentTarget.value); setComposing(false); }} /></label>
            <div className='nmx-mc-model-summary'>{text('loadedModels', rows.length)}{cursor && <><span>·</span>{text('partial')}</>}
                <ModelCenterHint locale={locale} text={text('outputNote')} focusable><i className='codicon codicon-info' aria-hidden='true' /></ModelCenterHint></div>
            <nav className='nmx-mc-model-categories' aria-label={text('allCategories')}>{categories.map(value => <button type='button' key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{categoryText(value)}</button>)}</nav>
            <div className='nmx-mc-model-price-head'><span>{desktopText(locale, 'models')}</span><span>{text('officialPrice')}</span><span>{text('yourPrice')}</span></div>
            <div ref={list} className='nmx-mc-model-list' aria-busy={loading}>
                {rows.map(model => {
                    const pricing = model.pricingDetails;
                    const dimensions = pricing?.dimensions || [];
                    const multiplier = offeringMultiplierBps(model);
                    const priceText = (side: 'official' | 'user', compact: boolean): string => {
                        const values = dimensions.filter(item => !compact || ['input_token', 'output_token'].includes(item.metric));
                        return values.map(item => {
                            const rate = item[side];
                            // No official price (a merchant-set price for a model without one) reads "-", not "pending".
                            return `${modelCenterPriceMetric(locale, item.metric)} ${!rate && side === 'official' ? 'US$-' : formattedAmount(rate?.amountMicros, item.currency)}${rate ? ' / ' + modelCenterPriceUnit(locale, item.metric, rate.unitSize) : ''}`;
                        }).join(' · ') || text('pricePending');
                    };
                    const fullHint = `${model.displayName}\n${text('officialPrice')}: ${priceText('official', false)}\n${offeringPriceText(locale, 'multiplier')}: ${multiplier === null ? offeringPriceText(locale, 'none') : `${relayMultiplierText(locale, multiplier)}`}\n${text('yourPrice')}: ${priceText('user', false)}`;
                    const preview = (side: 'official' | 'user'): React.ReactNode => <ModelCenterPricePreview model={model} side={side} locale={locale} />;
                    return <article className='nmx-mc-model' key={model.id} data-supported-model={model.registryModelId} data-price-mode={multiplier === null ? 'direct' : 'multiplier'}>
                        <ModelCenterHint locale={locale} text={fullHint}>
                            <button type='button' className='nmx-mc-model-row' aria-expanded={expanded === model.id} aria-label={fullHint} onClick={() => setExpanded(expanded === model.id ? '' : model.id)}>
                                <span className='nmx-mc-model-name'><strong>{model.displayName}</strong><ModelTaxonomyTags locale={locale} model={model} showCategory /><small>{multiplier === null ? offeringPriceText(locale, 'ownTag') : <bdi dir='ltr'>{relayMultiplierTag(locale, multiplier) || '—'}</bdi>}{(() => {
                                    // Authenticity appears once it has been measured, label and value kept on one line.
                                    const score = measuredModelFidelity(model.fidelity);
                                    return score === undefined ? undefined : <> · <span className='nmx-mc-model-evidence'>{modelPickerEvidenceText(locale, 'authenticity')} <bdi dir='ltr'>{score}%</bdi></span></>;
                                })()}</small></span>
                                <span className='nmx-mc-price-preview'>{preview('official')}</span><span className='nmx-mc-price-preview'>{preview('user')}</span>
                            </button>
                        </ModelCenterHint>
                        {expanded === model.id && <div className='nmx-mc-model-expanded'><code dir='ltr'>{model.canonicalModel}</code>
                            <p className='nmx-mc-model-multiplier'>{offeringPriceText(locale, 'multiplier')}: <strong dir='ltr'>{multiplier === null ? offeringPriceText(locale, 'none') : relayMultiplierText(locale, multiplier)}</strong>{multiplier === null && <small> · {offeringPriceText(locale, 'own')}</small>}</p>{dimensions.length
                            ? <table><thead><tr><th aria-label={text('output')} /><th>{text('officialPrice')}</th><th>{text('yourPrice')}</th></tr></thead><tbody>{dimensions.map(dimension => <tr key={dimension.metric} data-price-metric={dimension.metric}>
                                <th>{modelCenterPriceMetric(locale, dimension.metric)}</th>
                                <td>{dimension.official ? formattedAmount(dimension.official.amountMicros, dimension.currency) : 'US$-'}{dimension.official && <small>/ {modelCenterPriceUnit(locale, dimension.metric, dimension.official.unitSize)}</small>}</td>
                                <td>{formattedAmount(dimension.user?.amountMicros, dimension.currency)}{dimension.user && <small>/ {modelCenterPriceUnit(locale, dimension.metric, dimension.user.unitSize)}</small>}</td>
                            </tr>)}</tbody></table> : <p>{text('pricePending')}</p>}</div>}
                    </article>;
                })}
                <div className='nmx-mc-directory-status' role='status' aria-live='polite'>{loading && <><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />{modelUsageText(locale, 'loading')}</>}
                    {error && <><span>{text('directoryFailed')}</span><button type='button' data-model-center-model-retry onClick={() => void load(failure?.after, failure?.force)}>{modelUsageText(locale, 'retry')}</button></>}
                    {!loading && !error && rows.length === 0 && text('noMatchingModels')}
                    {!loading && !error && cursor && <button type='button' data-model-center-model-more onClick={loadMore}>{modelUsageText(locale, 'loadMore')}</button>}</div>
                <div ref={sentinel} data-model-center-model-sentinel aria-hidden='true' />
            </div>
            <footer><p>{text('priceNote')}</p></footer>
        </section>
    </div>;
}

/**
 * The merchant's own store tagline and description (plain text, at most 60 / 600 characters, cleaned by the
 * platform): long descriptions are clamped to four lines with a toggle.
 */
export function MerchantStoreProfile({ merchant, locale }: { merchant: PublicMerchantIdentity; locale: NextMuxDesktopLocale }): React.ReactElement | null {
    const [expanded, setExpanded] = React.useState(false);
    const [overflows, setOverflows] = React.useState(false);
    const description = React.useRef<HTMLParagraphElement>(null);
    React.useLayoutEffect(() => {
        setExpanded(false);
        const node = description.current;
        if (!node) { setOverflows(false); return; }
        const measure = (): void => setOverflows(node.scrollHeight > node.clientHeight + 1);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [merchant.id, merchant.storeDescription]);
    if (!merchant.storeTagline && !merchant.storeDescription) return null;
    return <section className='nmx-mc-store' aria-label={modelCenterText(locale, 'storeIntro')}>
        {merchant.storeTagline && <p className='nmx-mc-store-tagline' dir='auto'>{merchant.storeTagline}</p>}
        {merchant.storeDescription && <p ref={description} id={`nmx-mc-store-${merchant.id}`} className={`nmx-mc-store-description${expanded ? ' is-expanded' : ''}`} dir='auto'>{merchant.storeDescription}</p>}
        {merchant.storeDescription && (overflows || expanded) && <button type='button' className='nmx-mc-store-toggle' aria-expanded={expanded}
            aria-controls={`nmx-mc-store-${merchant.id}`} onClick={() => setExpanded(!expanded)}>{modelCenterText(locale, expanded ? 'showLess' : 'showMore')}</button>}
    </section>;
}
