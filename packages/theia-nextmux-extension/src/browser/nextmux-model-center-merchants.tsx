import { merchantModelCategory, merchantOutputCategories } from '@nextmux/model-runtime/merchant-modalities';
import type { ModelTaskMetadata } from '@nextmux/model-runtime/model-task-capabilities';
import { selectMainPriceDimensions, validSummaryRate, priceDisplayUnitSize } from '@nextmux/model-runtime/price-summary';
import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { NextMuxPlatformService, PlatformMerchantSupportCatalogPage, PlatformOffering } from '../common/nextmux-platform-protocol';
import { publicMerchantApiDisplay, publicMerchantDepositText, type PublicMerchantDirectoryPage, type PublicMerchantDirectoryQuery, type PublicMerchantIdentity } from '../common/nextmux-public-merchants';
import { desktopText, type NextMuxDesktopLocale } from './nextmux-locale';
import { modelCenterText, modelCenterPriceMetric, modelCenterPriceUnit, modelCenterChecksFailing, modelCenterApiState } from './nextmux-model-center-locale';
import { modelUsageText } from './nextmux-model-usage-locale';
import { relayEvidenceText, relayMarketplaceText } from './nextmux-relay-marketplace-locale';
import { relayDelistedText, relayText } from './nextmux-relay-locale';
import { modelPickerEvidenceText, relayLatencyText, relayMeasurementNote, relayMultiplierTag, relayMultiplierText } from './nextmux-relay-picker';
import { INITIAL_RELAY_QUALITY, isDefaultModelFidelity, measuredModelFidelity, measuredRelayLatency } from '../common/nextmux-relay-evidence';
import { offeringMultiplierBps, offeringPriceSignature, offeringPriceText } from './nextmux-offering-price';
import { ImeInput } from './nextmux-ime-field';
import { getCachedNumberFormat } from './nextmux-intl-cache';
import { DEFAULT_VIRTUAL_LIST_THRESHOLD, VirtualGrid, VirtualList, type VirtualScrollerContainerProps } from './nextmux-virtual-list';
import type { ModelPrimaryCategory } from '@nextmux/model-runtime/model-taxonomy';
import { modelCapabilityLabel, modelCategoryLabel } from './nextmux-model-taxonomy-locale';
import { ModelTaxonomyTags } from './nextmux-model-taxonomy-tags';
import { FavoriteHeartIcon } from './nextmux-favorite-icon';
import { DepositVerifiedSeal, depositVerifiedHintText } from './nextmux-deposit-verified';
import { notifyModalChromeChanged } from './nextmux-modal-chrome';
import { RelayCapacityPoller } from './nextmux-relay-capacity';
import { relayMerchantIsFull, type PublicMerchantCapacityScope, type PublicMerchantCapacitySnapshot } from '../common/nextmux-relay-capacity';

export { DepositVerifiedSeal };

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
/**
 * The latency a store's model row shows: the model's TTFT of the past week, else its API's latest under ≈, with notes
 * saying whose value it is and when it was measured. Marks stale (>24h) consistently; nothing measured, nothing shown.
 */
export function merchantModelLatency(locale: NextMuxDesktopLocale, model: Pick<PlatformOffering, 'network' | 'latencyObservedAt'>,
    now = Date.now()): { readonly value: string; readonly note?: string; readonly stale?: boolean } | undefined {
    const own = measuredRelayLatency(model.network?.lastLatencyMs);
    const api = own === undefined ? measuredRelayLatency(model.network?.endpointLatencyMs) : undefined;
    const shown = own ?? api;
    if (shown === undefined) return undefined;
    const rawAt = own !== undefined ? model.latencyObservedAt : model.network?.endpointLatencyObservedAt;
    const observedAt = typeof rawAt === 'number' && Number.isFinite(rawAt) && rawAt > 0 ? rawAt : undefined;
    const stale = (own !== undefined && model.network?.state === 'stale')
        || (observedAt !== undefined && observedAt < now - 86_400_000);
    const notes = [api !== undefined ? relayMeasurementNote(locale, 'latencyFromApi') : ''].filter(Boolean);
    return {
        value: `${api !== undefined ? '≈' : ''}${relayLatencyText(locale, shown)}`,
        ...(notes.length ? { note: notes.join(' · ') } : {}),
        ...(stale ? { stale: true } : {})
    };
}
type Service = Pick<NextMuxPlatformService, 'getPublicMerchantDirectory' | 'getMerchantSupportCatalog'>
    & Partial<Pick<NextMuxPlatformService, 'getPublicMerchantCapacity'>>;
type Sort = 'quality' | 'authenticity' | 'latency' | 'multiplier';
type Props = {
    service: Service; locale: NextMuxDesktopLocale; view: 'all' | 'favorites' | 'capability';
    capability: ModelCenterCapability; query: string; favorites: readonly (readonly [string, string])[];
    copiedNumber?: string;
    /** Includes public store-profile edits and moderation changes. */
    directoryVersion?: string;
    capacityPoller?: RelayCapacityPoller;
    refreshing?: boolean;
    onRefresh?: (tabKey?: string) => Promise<void> | void;
    onFavorite: (id: string, name: string) => void; onCopy: (id: string) => Promise<void>;
    /** The platform's global order of a model (lower first), for a merchant's models that arrive without one. */
    modelRank?: (model: string) => number | undefined;
};

export const MODEL_CENTER_REFRESH_COOLDOWN_MS = 30_000;
const modelCenterCooldownUntilByTab: Record<string, number> = {};
type CachedDirectoryEntry = { readonly page: PublicMerchantDirectoryPage; readonly updatedAt: number };
type CachedSupportEntry = { readonly result: PlatformMerchantSupportCatalogPage; readonly updatedAt: number };
let merchantDirectoryCacheByService = new WeakMap<Service, Map<string, CachedDirectoryEntry>>();
let merchantDirectoryPendingByService = new WeakMap<Service, Map<string, Promise<PublicMerchantDirectoryPage>>>();
let merchantSupportCatalogCacheByService = new WeakMap<Service, Map<string, CachedSupportEntry>>();
let merchantSupportPendingByService = new WeakMap<Service, Map<string, Promise<PlatformMerchantSupportCatalogPage>>>();
let sharedCapacityPollerByService = new WeakMap<Service, RelayCapacityPoller>();

function directoryPendingFor(service: Service): Map<string, Promise<PublicMerchantDirectoryPage>> {
    let map = merchantDirectoryPendingByService.get(service);
    if (!map) {
        map = new Map();
        merchantDirectoryPendingByService.set(service, map);
    }
    return map;
}

function sharedCapacityPollerFor(
    service: Service,
    readCapacity: NonNullable<Service['getPublicMerchantCapacity']>
): RelayCapacityPoller {
    let poller = sharedCapacityPollerByService.get(service);
    if (!poller) {
        poller = new RelayCapacityPoller((batch, scope) => readCapacity.call(service, batch, scope));
        sharedCapacityPollerByService.set(service, poller);
    }
    return poller;
}

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

const BusyScrollerContext = React.createContext<boolean>(false);

const BusyAwareScroller = React.forwardRef<HTMLDivElement, VirtualScrollerContainerProps>(function BusyAwareScroller(props, ref) {
    const busy = React.useContext(BusyScrollerContext);
    return <div {...props} ref={ref} aria-busy={busy} />;
});

const BusyAwareListContainer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function BusyAwareListContainer(props, ref) {
    const busy = React.useContext(BusyScrollerContext);
    return <div {...props} ref={ref} aria-busy={busy} />;
});

const GRID_VIRTUAL_COMPONENTS = { Scroller: BusyAwareScroller, List: BusyAwareListContainer } as const;
const LIST_VIRTUAL_COMPONENTS = { Scroller: BusyAwareScroller, List: BusyAwareListContainer } as const;

/**
 * Portalled hints cannot be clipped by the scroll area or the price drawer. `depositVerified` puts the gold seal before
 * the first line: the hint of a store's name when the store holds the platform's security deposit.
 */
export function ModelCenterHint({ text, ariaLabel, locale, children, focusable = false, keepOpenOnClick = false, className, depositVerified = false }: {
    text: string | (() => string); ariaLabel?: string; locale: NextMuxDesktopLocale; children: React.ReactNode; focusable?: boolean; keepOpenOnClick?: boolean; className?: string; depositVerified?: boolean;
}): React.ReactElement {
    const id = React.useId();
    const anchor = React.useRef<HTMLSpanElement>(null);
    const tooltip = React.useRef<HTMLSpanElement>(null);
    const [position, setPosition] = React.useState<{ left: number; top: number }>();
    const [resolvedText, setResolvedText] = React.useState<string | undefined>(() => typeof text === 'string' ? text : undefined);
    React.useEffect(() => {
        if (!position) return;
        if (typeof text === 'function') setResolvedText(text());
        else setResolvedText(text);
    }, [position, text]);
    React.useEffect(() => {
        if (!position) return;
        const close = (event: Event): void => { if (!(event.target instanceof Node) || !tooltip.current?.contains(event.target)) setPosition(undefined); };
        window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
        return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
    }, [Boolean(position)]);
    const show = (): void => {
        if (typeof text === 'function') setResolvedText(text());
        else setResolvedText(text);
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
    }, [position, resolvedText]);
    const accessibleLabel = ariaLabel ?? (focusable && typeof text === 'string' ? text : undefined);
    const tooltipText = position ? (resolvedText ?? (typeof text === 'function' ? text() : text)) : undefined;
    return <span ref={anchor} className={className ? `nmx-mc-hint ${className}` : 'nmx-mc-hint'} tabIndex={focusable ? 0 : undefined} aria-label={accessibleLabel}
        aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={() => { if (!anchor.current?.contains(document.activeElement)) setPosition(undefined); }}
        onFocus={show} onClick={() => { if (!keepOpenOnClick) setPosition(undefined); }} onBlur={() => { if (!anchor.current?.matches(':hover')) setPosition(undefined); }} onKeyDown={event => { if (event.key === 'Escape' && position) { event.stopPropagation(); setPosition(undefined); } }}>
        {children}{position && tooltipText && createPortal(<span ref={tooltip} id={id} className='nmx-mc-tooltip' role='tooltip' dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}
            style={position}>{depositVerified && <DepositVerifiedSeal size={13} />}{tooltipText}</span>, document.body)}
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

type MerchantCardProps = {
    readonly merchant: PublicMerchantIdentity;
    readonly locale: NextMuxDesktopLocale;
    readonly favorite: boolean;
    readonly isCapacityFull: boolean;
    readonly copiedNumber?: string;
    readonly onCopy: (code: string) => Promise<void>;
    readonly onCopyError: () => void;
    readonly onFavorite: (id: string, name: string) => void;
    readonly onPrefetch: (merchantId: string) => void;
    readonly onOpenDetail: (merchant: PublicMerchantIdentity) => void;
};

function renderMerchantCardElement({
    merchant, locale, favorite, isCapacityFull, copiedNumber, onCopy, onCopyError, onFavorite, onPrefetch, onOpenDetail
}: MerchantCardProps): React.ReactElement {
    const text = (key: Parameters<typeof modelCenterText>[1], count?: number): string => modelCenterText(locale, key, count);
    const market = (key: Parameters<typeof relayMarketplaceText>[1]): string => relayMarketplaceText(locale, key);
    const percent = (value: number | undefined): string => value === undefined ? '—' : getCachedNumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
    const publicCode = merchant.publicCode;
    const rating = modelCenterRating(merchant);
    const finiteNonNegative = (value: unknown): number | undefined =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
    const ratingValue = finiteNonNegative(rating.value);
    const authenticityValue = finiteNonNegative(merchant.metrics?.authenticity);
    const latencyValue = finiteNonNegative(merchant.metrics?.latencyMs);
    const api = publicMerchantApiDisplay(merchant);
    const apiState = api.state;
    const latencyObservedAt = typeof merchant.measurement?.latency?.observedAt === 'number'
        && Number.isFinite(merchant.measurement.latency.observedAt)
        && merchant.measurement.latency.observedAt > 0
        ? merchant.measurement.latency.observedAt
        : undefined;
    const latencyStale = latencyValue !== undefined && (
        merchant.measurement?.latency?.state === 'stale'
        || (latencyObservedAt !== undefined && latencyObservedAt < Date.now() - 86_400_000)
    );
    const authenticityScope = merchant.measurement?.authenticity?.scope;
    const authenticityListed = authenticityValue !== undefined && authenticityScope === 'listed_offerings';
    const authenticityDefault = authenticityValue !== undefined && authenticityScope === 'default_unverifiable';
    const outputs = merchantOutputCategories(merchant.outputCategories);
    const storeIntro = (merchant.storeTagline || merchant.storeDescription || '').trim();
    const storeIntroDisplay = storeIntro || text('noStoreIntro');
    // A store holding the security deposit: its name in the deposit rainbow and the gold seal after it. Its name's
    // hint is the one every surface shows: seal and name, public number, introduction, the deposit line.
    const deposit = merchant.depositVerified === true ? publicMerchantDepositText(locale) : '';
    const statusLabelLazy = (): string => {
        const measuredAvailability = (merchant.measurement?.availability?.sampleCount ?? 0) > 0
            ? finiteNonNegative(merchant.metrics?.availability)
            : undefined;
        const availabilityText = measuredAvailability !== undefined && measuredAvailability <= 1
            ? percent(measuredAvailability)
            : '';
        return `${text('apiStatus')} · ${modelCenterApiState(locale, apiState)}${availabilityText ? ` (${availabilityText})` : ''}${api.checksFailing ? ` · ${modelCenterChecksFailing(locale, 'hint')}` : ''}`;
    };
    const ratingHintLazy = (): string => {
        const quality = rating.value === undefined ? relayEvidenceText(locale, 'unmeasured') : rating.initial ? text('initialRating') : text('votedRating', rating.samples);
        return `${market('rating')} · ${quality}`;
    };
    const authenticityHintLazy = (): string => {
        const authenticityNote = authenticityListed
            ? relayMeasurementNote(locale, 'authenticityListed')
            : authenticityDefault
                ? relayMeasurementNote(locale, 'authenticityDefault')
                : '';
        return `${market('authenticity')} · ${authenticityValue === undefined ? relayText(locale, 'authenticityPending') : percent(authenticityValue / 100)}${authenticityNote ? ` · ${authenticityNote}` : ''}`;
    };
    const latencyHintLazy = (): string => {
        return `${market('latency')} · ${latencyValue === undefined ? relayEvidenceText(locale, 'unmeasured') : `${latencyValue} ms`}`;
    };
    const hint = (content: React.ReactNode, label: string | (() => string), focusable = true, ariaLabel?: string): React.ReactElement =>
        <ModelCenterHint text={label} ariaLabel={ariaLabel} locale={locale} focusable={focusable}>{content}</ModelCenterHint>;
    const nameHint = deposit
        ? <ModelCenterHint text={depositVerifiedHintText(locale, merchant)} locale={locale} focusable depositVerified><strong className='is-deposit-verified'>{merchant.name}</strong></ModelCenterHint>
        : <ModelCenterHint text={() => `${merchant.name}\n${storeIntroDisplay}`} ariaLabel={merchant.name} locale={locale} focusable><strong>{merchant.name}</strong></ModelCenterHint>;
    return <article className={isCapacityFull ? 'nmx-mc-merchant is-capacity-full' : 'nmx-mc-merchant'} key={merchant.id} data-model-center-merchant={merchant.id} data-deposit-verified={deposit ? 'true' : undefined} data-relay-capacity={isCapacityFull ? 'full' : undefined}>
        <div className='nmx-mc-identity'>
            <div className='nmx-mc-identity-head'>
                <div className='nmx-mc-identity-title'>
                    {deposit ? <span className='nmx-mc-name-line'>{nameHint}<ModelCenterHint text={deposit} locale={locale} focusable><DepositVerifiedSeal /></ModelCenterHint></span> : nameHint}
                </div>
                <ModelCenterHint text={() => `${merchant.name} · ${text('supported')}`} locale={locale} focusable={false}>
                    <button type='button' data-model-center-list onPointerEnter={() => onPrefetch(merchant.id)} onClick={() => onOpenDetail(merchant)}>{text('supported')}</button>
                </ModelCenterHint>
            </div>
            {hint(<p className={`nmx-mc-tagline nmx-mc-merchant-bio${storeIntro ? '' : ' is-empty'}`} data-testid={`mc-store-tagline-${merchant.id}`} data-nmx-literal dir='auto'>
                {storeIntroDisplay}
            </p>, () => `${merchant.name} · ${storeIntroDisplay}`, true, storeIntroDisplay)}<span><ModelCenterHint text={publicCode || market('copyNumber')} ariaLabel={publicCode || market('copyNumber')} locale={locale} focusable><code dir='ltr'>{publicCode || '—'}</code></ModelCenterHint>
            <ModelCenterHint text={() => market('copyHint')} locale={locale} focusable={false}><button type='button' disabled={!publicCode} aria-label={market('copyNumber')} onClick={() => { if (!publicCode) return; void onCopy(publicCode).catch(() => onCopyError()); }}><i className={`codicon codicon-${publicCode && copiedNumber === publicCode ? 'check' : 'copy'}`} aria-hidden='true' /></button></ModelCenterHint>
            <ModelCenterHint text={statusLabelLazy} ariaLabel={text('apiStatus')} locale={locale} focusable><i className={`codicon codicon-${apiState === 'ready' ? 'pass' : apiState === 'refreshing' ? 'sync' : apiState === 'degraded' || apiState === 'unavailable' ? 'warning' : 'circle-outline'}`} data-api-state={apiState || 'unknown'} aria-hidden='true' /></ModelCenterHint>
        </span>{(outputs.length > 0 || api.checksFailing || isCapacityFull) && <span className='nmx-mc-capabilities'>{outputs.map(value => <small key={value}>{market(value === 'text' ? 'language' : value as 'image' | 'video' | 'audio')}</small>)}
            {isCapacityFull && <ModelCenterHint text={() => relayText(locale, 'relayFull')} ariaLabel={relayText(locale, 'relayFull')} locale={locale} focusable><small className='nmx-mc-api-alert is-capacity' data-relay-capacity-badge='full'>{relayText(locale, 'relayFullBadge')}</small></ModelCenterHint>}
            {api.checksFailing && <ModelCenterHint text={statusLabelLazy} ariaLabel={modelCenterChecksFailing(locale, 'chip')} locale={locale} focusable><small className='nmx-mc-api-alert' data-api-detail='probe_failures'><i className='codicon codicon-warning' aria-hidden='true' />{modelCenterChecksFailing(locale, 'chip')}</small></ModelCenterHint>}</span>}</div>
        <div className='nmx-mc-metrics'>
            <ModelCenterHint text={ratingHintLazy} ariaLabel={market('rating')} locale={locale} focusable><><i className='codicon codicon-star-full' aria-hidden='true' /><strong data-metric='rating' data-unmeasured={ratingValue === undefined || undefined}>{percent(ratingValue === undefined ? undefined : ratingValue / 100)}</strong></></ModelCenterHint>
            {/* 真实性: the mean identity score of the relay's models that have one (availability stays in the platform's routing). */}
            <ModelCenterHint text={authenticityHintLazy()} locale={locale} focusable><><i className='codicon codicon-verified' aria-hidden='true' /><strong data-metric='authenticity' data-unmeasured={authenticityValue === undefined || undefined} data-fallback={authenticityListed || undefined}>{percent(authenticityValue === undefined ? undefined : authenticityValue / 100)}</strong></></ModelCenterHint>
            <ModelCenterHint text={latencyHintLazy()} locale={locale} focusable><><i className='codicon codicon-watch' aria-hidden='true' /><strong data-metric='latency' dir='ltr' data-unmeasured={latencyValue === undefined || undefined} data-fallback={latencyStale || undefined}>{latencyValue === undefined ? '—' : `${getCachedNumberFormat(locale, { maximumFractionDigits: 0 }).format(latencyValue)} ms`}</strong></></ModelCenterHint>
            {/* 平均倍率: the mean over the merchant's multiplier-priced models × APIs (its own prices have none). */}
            {(() => {
                const average = merchant.averageMultiplierBps === undefined ? merchant.metrics?.multiplierBps : merchant.averageMultiplierBps ?? undefined;
                const mulLabel = offeringPriceText(locale, 'averageMultiplier');
                const mulHint = (): string => `${mulLabel} · ${relayMultiplierTag(locale, average) || '—'}`;
                const multiplier = relayMultiplierTag(locale, average);
                return <ModelCenterHint text={mulHint} ariaLabel={mulLabel} locale={locale} focusable><><i className='codicon codicon-symbol-number' aria-hidden='true' /><strong data-metric='multiplier' dir='ltr' data-unmeasured={!multiplier || undefined}>{multiplier || '—'}</strong></></ModelCenterHint>;
            })()}
        </div>
        <div className='nmx-mc-actions'>
            <ModelCenterHint text={() => modelUsageText(locale, favorite ? 'removeFavorite' : 'favorites')} locale={locale} focusable={false}><button type='button' data-model-center-favorite={merchant.id} aria-pressed={favorite} aria-label={modelUsageText(locale, favorite ? 'removeFavorite' : 'favorites')}
                onClick={() => onFavorite(merchant.id, merchant.name)}><FavoriteHeartIcon active={favorite} /></button></ModelCenterHint>
        </div>
    </article>;
}

const MemoMerchantCard = React.memo(function MemoMerchantCard(props: MerchantCardProps): React.ReactElement {
    return renderMerchantCardElement(props);
});

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
    const filterKey = JSON.stringify([view, view === 'capability' ? capability : 'all', query.trim(), sort, direction, favoriteKey]);
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
    const [scrollParent, setScrollParent] = React.useState<HTMLElement>();
    React.useLayoutEffect(() => {
        const next = directoryRef.current?.closest?.<HTMLElement>('.nmx-workspace-scroll') ?? undefined;
        setScrollParent(prev => prev === next ? prev : next);
    }, []);
    const capacityScope: PublicMerchantCapacityScope = view === 'capability' && (capability === 'image' || capability === 'video' || capability === 'audio') ? 'comic' : 'coding';
    const [capacitySnapshot, setCapacitySnapshot] = React.useState<PublicMerchantCapacitySnapshot>();
    const merchantIdsKey = (page?.merchants || []).map(item => item.id).filter(id => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id)).join('\n');
    React.useEffect(() => {
        const readCapacity = service.getPublicMerchantCapacity;
        const ids = merchantIdsKey ? merchantIdsKey.split('\n') : [];
        if (typeof readCapacity !== 'function' || !ids.length) {
            setCapacitySnapshot(undefined);
            return;
        }
        const poller = props.capacityPoller ?? sharedCapacityPollerFor(service, readCapacity);
        const visibleIds = (): readonly string[] => {
            const root = directoryRef.current;
            const scroll = root?.closest<HTMLElement>('.nmx-workspace-scroll');
            const bounds = scroll?.getBoundingClientRect();
            if (!root || !bounds || (bounds.width === 0 && bounds.height === 0)) return ids.slice(0, 32);
            const visible = [...root.querySelectorAll<HTMLElement>('[data-model-center-merchant]')]
                .filter(node => {
                    const rect = node.getBoundingClientRect();
                    return rect.bottom > bounds.top && rect.top < bounds.bottom;
                })
                .map(node => node.dataset.modelCenterMerchant || '')
                .filter(id => ids.includes(id))
                .slice(0, 32);
            return visible.length ? visible : ids.slice(0, 32);
        };
        const detach = poller.attach(ids, capacityScope, snapshot => setCapacitySnapshot(snapshot), visibleIds);
        return () => {
            detach();
        };
    }, [service, props.capacityPoller, merchantIdsKey, capacityScope]);
    const closeTimer = React.useRef<number>();
    const [copyFailed, setCopyFailed] = React.useState(false);
    const generation = React.useRef(0);
    const busy = React.useRef(false);
    const sentinel = React.useRef<HTMLDivElement>(null);
    const activeRequest = React.useRef(requestKey);
    activeRequest.current = requestKey;
    const pageRef = React.useRef(page);
    pageRef.current = page;
    const previousFilterKey = React.useRef<string | undefined>(undefined);
    const request = (): PublicMerchantDirectoryQuery => ({ query: query.trim(), sort, direction,
        capability: view === 'capability' ? capability : 'all' });

    React.useEffect(() => {
        const token = ++generation.current;
        const sameFilter = previousFilterKey.current === filterKey;
        previousFilterKey.current = filterKey;
        const force = forceNextLoad.current === requestKey;
        forceNextLoad.current = undefined;
        const cooldownKey = tabCooldownKey;
        const cachedEntry = !force ? getCachedMerchantDirectoryPage(service, requestKey) : undefined;
        const freshCached = Boolean(cachedEntry && Date.now() - cachedEntry.updatedAt < MODEL_CENTER_REFRESH_COOLDOWN_MS);
        const retainedPage = cachedEntry?.page ?? (sameFilter ? pageRef.current : undefined);
        if (freshCached && retainedPage) {
            busy.current = false;
            setPage(retainedPage);
            setLoading(false);
            setError(false);
            if (!sameFilter) { setDetail(undefined); setDetailClosing(false); }
            return;
        }
        busy.current = true;
        setPage(retainedPage);
        setLoading(force || !retainedPage);
        setError(false);
        if (!sameFilter) { setDetail(undefined); setDetailClosing(false); }
        const timer = window.setTimeout(() => {
            const pendingMap = directoryPendingFor(service);
            let operation = !force ? pendingMap.get(requestKey) : undefined;
            if (!operation) {
                const rawOperation = view === 'favorites'
                    ? loadModelCenterFavorites(service, request(), favoriteIds, force)
                    : service.getPublicMerchantDirectory(request(), force);
                operation = rawOperation.finally(() => {
                    if (pendingMap.get(requestKey) === operation) pendingMap.delete(requestKey);
                });
                if (!force) pendingMap.set(requestKey, operation);
            }
            void operation.then(result => {
                setCachedMerchantDirectoryPage(service, requestKey, result);
                if (token === generation.current) setPage(result);
            })
                .catch(() => {
                    if (token === generation.current && !retainedPage) setError(true);
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
    React.useEffect(() => {
        notifyModalChromeChanged();
        return () => { notifyModalChromeChanged(); };
    }, [detail, detailClosing]);
    const openDetail = React.useCallback((merchant: PublicMerchantIdentity): void => {
        window.clearTimeout(closeTimer.current); setDetailClosing(false);
        setDrawerLayer(measureDrawerLayer()); setDetail(merchant);
    }, []);
    // Radix/shadcn Sheet behavior: the exit animation plays before unmount.
    const closeDetail = (): void => {
        if (!detail || detailClosing) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setDetail(undefined); setDrawerLayer(undefined); return; }
        setDetailClosing(true);
        closeTimer.current = window.setTimeout(() => { setDetail(undefined); setDetailClosing(false); setDrawerLayer(undefined); }, 160);
    };
    const handleCopy = React.useCallback((publicCode: string): Promise<void> => {
        setCopyFailed(false);
        return onCopy(publicCode);
    }, [onCopy]);
    const handleCopyError = React.useCallback((): void => {
        setCopyFailed(true);
    }, []);
    const handlePrefetch = React.useCallback((merchantId: string): void => {
        prefetchMerchantSupportCatalog(service, merchantId);
    }, [service]);
    const handleEndReached = React.useCallback((): void => {
        void loadMore();
    }, [loadMore]);
    const text = (key: Parameters<typeof modelCenterText>[1], count?: number): string => modelCenterText(locale, key, count);
    const market = (key: Parameters<typeof relayMarketplaceText>[1]): string => relayMarketplaceText(locale, key);
    const hint = (content: React.ReactNode, label: string, focusable = true): React.ReactElement =>
        <ModelCenterHint text={label} locale={locale} focusable={focusable}>{content}</ModelCenterHint>;
    // “Delisted” is only concluded from the unfiltered favourites list: a search that misses a merchant (renamed,
    // say) does not prove it left (audit A03-09).
    const missing = view === 'favorites' && page && !loading && !error && !query.trim() ? props.favorites.filter(([id]) =>
        !page.merchants.some(item => item.id === id)) : [];
    const merchantsList = page?.merchants ?? [];
    const favoriteIdSet = React.useMemo(() => new Set(favoriteIds), [favoriteIds.join('\n')]);
    const shouldVirtualizeMerchants = merchantsList.length > DEFAULT_VIRTUAL_LIST_THRESHOLD && missing.length === 0;
    const merchantKey = React.useCallback((item: PublicMerchantIdentity): string => item.id, []);
    const renderMerchantItem = React.useCallback((merchant: PublicMerchantIdentity): React.ReactElement => (
        <MemoMerchantCard
            merchant={merchant}
            locale={locale}
            favorite={favoriteIdSet.has(merchant.id)}
            isCapacityFull={relayMerchantIsFull(capacitySnapshot, merchant.id, capacityScope)}
            copiedNumber={props.copiedNumber}
            onCopy={handleCopy}
            onCopyError={handleCopyError}
            onFavorite={onFavorite}
            onPrefetch={handlePrefetch}
            onOpenDetail={openDetail}
        />
    ), [locale, favoriteIdSet, capacitySnapshot, capacityScope, props.copiedNumber, handleCopy, handleCopyError, onFavorite, handlePrefetch, openDetail]);
    const drawer = detail && <MerchantModelDrawer service={service} merchant={detail} locale={locale} closing={detailClosing} onClose={closeDetail} modelRank={props.modelRank} />;
    return <section ref={directoryRef} className='nmx-mc-directory' data-loaded-merchant-count={merchantsList.length} aria-busy={loading} dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} data-nmx-literal>
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
        {shouldVirtualizeMerchants ? (
            <BusyScrollerContext.Provider value={loading}>
                {layout === 'grid' ? (
                    <VirtualGrid<PublicMerchantIdentity>
                        items={merchantsList}
                        itemKey={merchantKey}
                        className='nmx-mc-merchants nmx-mc-grid'
                        listClassName='nmx-mc-merchants nmx-mc-merchants--grid'
                        customScrollParent={scrollParent}
                        style={scrollParent ? undefined : { height: 'min(70vh, 640px)' }}
                        initialItemCount={Math.min(merchantsList.length, 15)}
                        components={GRID_VIRTUAL_COMPONENTS}
                        endReached={page?.nextCursor && !loading && !error ? handleEndReached : undefined}
                        renderItem={renderMerchantItem}
                    />
                ) : (
                    <VirtualList<PublicMerchantIdentity>
                        items={merchantsList}
                        itemKey={merchantKey}
                        className='nmx-mc-merchants nmx-mc-merchants--list'
                        customScrollParent={scrollParent}
                        style={scrollParent ? undefined : { height: 'min(70vh, 640px)' }}
                        initialItemCount={Math.min(merchantsList.length, 15)}
                        defaultItemHeight={84}
                        components={LIST_VIRTUAL_COMPONENTS}
                        endReached={page?.nextCursor && !loading && !error ? handleEndReached : undefined}
                        renderItem={renderMerchantItem}
                    />
                )}
            </BusyScrollerContext.Provider>
        ) : (
            <div className={`nmx-mc-merchants nmx-mc-merchants--${layout}${layout === 'grid' ? ' nmx-mc-grid' : ''}`} aria-busy={loading}>
                {merchantsList.map(merchant => renderMerchantCardElement({
                    merchant,
                    locale,
                    favorite: favoriteIdSet.has(merchant.id),
                    isCapacityFull: relayMerchantIsFull(capacitySnapshot, merchant.id, capacityScope),
                    copiedNumber: props.copiedNumber,
                    onCopy: handleCopy,
                    onCopyError: handleCopyError,
                    onFavorite,
                    onPrefetch: handlePrefetch,
                    onOpenDetail: openDetail
                }))}
                {missing.map(([id, name]) => <article className='nmx-mc-merchant is-unavailable' key={id} data-model-center-delisted={id} aria-disabled='true'>
                    <div className='nmx-mc-identity'><strong>{name}</strong><span><small className='nmx-mc-delisted'>{relayDelistedText(locale)}</small></span></div>
                    <div className='nmx-mc-actions'><button type='button' data-model-center-favorite={id} aria-pressed='true' aria-label={`${modelUsageText(locale, 'removeFavorite')} · ${name}`}
                        onClick={() => onFavorite(id, name)}><FavoriteHeartIcon active /><span>{modelUsageText(locale, 'removeFavorite')}</span></button></div></article>)}
            </div>
        )}
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
        return getCachedNumberFormat(locale, { style: 'currency', currency: item.currency, maximumFractionDigits: 6 })
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
    modelRank?: (model: string) => number | undefined;
};
type SupportCategory = 'all' | 'language' | 'image' | 'video' | 'audio' | 'others';

export function MerchantModelDrawer(props: MerchantModelDrawerProps): React.ReactElement {
    // Switching merchants starts a fresh search and also invalidates every pending page of the old drawer.
    return <MerchantModelDrawerBody key={props.merchant.id} {...props} />;
}

/**
 * Newest first: frontier models, then recent releases and the catalog's own ranking, then older releases. A merchant's
 * catalog page arrives in offering-id order without these fields, so such a row takes the platform's global rank of
 * the same model (`modelRank`, the order the rest of Model Center uses); rows with no order at all keep theirs, last.
 */
export function sortMerchantDrawerOfferings(offerings: readonly PlatformOffering[], modelRank?: (model: string) => number | undefined): PlatformOffering[] {
    if (offerings.length < 2) return [...offerings];
    const now = Date.now();
    const recentUnpricedCutoffMs = 45 * 86_400_000;
    const priorityOf = (offering: PlatformOffering): readonly [number, number] => {
        if (Number.isFinite(offering.frontierPosition)) {
            return [0, Number(offering.frontierPosition)];
        }
        const releasedMs = Date.parse(offering.releasedAt || '');
        const hasReleased = Number.isFinite(releasedMs);
        if (Number.isFinite(offering.catalogRank)) {
            return [1, Number(offering.catalogRank)];
        }
        if (hasReleased) {
            const ageMs = Math.max(0, now - releasedMs);
            // Newly released models without priced route rankings yet stay alongside live recent releases rather than dropping to the end.
            if (ageMs <= recentUnpricedCutoffMs) return [1, Math.round(ageMs / 3_600_000)];
            return [2, -releasedMs];
        }
        const globalRank = modelRank?.(offering.canonicalModel || offering.registryModelId);
        if (typeof globalRank === 'number' && Number.isFinite(globalRank)) return [1, globalRank];
        return [3, 0];
    };
    const ranked = offerings.map((offering, index) => ({ offering, index, priority: priorityOf(offering) }));
    if (ranked.every(entry => entry.priority[0] === 3)) return [...offerings];
    return ranked
        .sort((left, right) => left.priority[0] - right.priority[0]
            || left.priority[1] - right.priority[1]
            || left.index - right.index)
        .map(entry => entry.offering);
}

const MerchantModelRow = React.memo(function MerchantModelRow({
    model, locale, expanded, onToggleExpand
}: {
    readonly model: PlatformOffering;
    readonly locale: NextMuxDesktopLocale;
    readonly expanded: boolean;
    readonly onToggleExpand: (modelId: string) => void;
}): React.ReactElement {
    const text = (key: Parameters<typeof modelCenterText>[1], count?: number): string => modelCenterText(locale, key, count);
    const formattedAmount = (value: number | null | undefined, currency: string): string => value == null ? text('pricePending')
        : getCachedNumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 6 }).format(value / 1_000_000);
    const pricing = model.pricingDetails;
    const dimensions = pricing?.dimensions || [];
    const multiplier = offeringMultiplierBps(model);
    const latency = React.useMemo(() => merchantModelLatency(locale, model), [locale, model]);
    const score = measuredModelFidelity(model.fidelity);
    const scoreIsDefault = score !== undefined && isDefaultModelFidelity(model.fidelity);
    const fullHint = React.useMemo(() => {
        const priceText = (side: 'official' | 'user', compact: boolean): string => {
            const values = dimensions.filter(item => !compact || ['input_token', 'output_token'].includes(item.metric));
            return values.map(item => {
                const rate = item[side];
                // No official price (a merchant-set price for a model without one) reads "-", not "pending".
                return `${modelCenterPriceMetric(locale, item.metric)} ${!rate && side === 'official' ? 'US$-' : formattedAmount(rate?.amountMicros, item.currency)}${rate ? ' / ' + modelCenterPriceUnit(locale, item.metric, rate.unitSize) : ''}`;
            }).join(' · ') || text('pricePending');
        };
        return `${model.displayName}\n${text('officialPrice')}: ${priceText('official', false)}\n${offeringPriceText(locale, 'multiplier')}: ${multiplier === null ? offeringPriceText(locale, 'none') : `${relayMultiplierText(locale, multiplier)}`}\n${text('yourPrice')}: ${priceText('user', false)}${score !== undefined ? `\n${modelPickerEvidenceText(locale, 'authenticity')}: ${score}%${scoreIsDefault ? ` · ${modelPickerEvidenceText(locale, 'authenticityDefaultHint')}` : ''}` : `\n${modelPickerEvidenceText(locale, 'authenticity')}: — · ${modelPickerEvidenceText(locale, 'authenticityPendingHint')}`}${latency ? `\n${relayText(locale, 'latency')}: ${latency.value}${latency.note ? ` · ${latency.note}` : ''}` : ''}`;
    }, [model, locale, dimensions, multiplier, latency, score, scoreIsDefault]);
    return <article className='nmx-mc-model' data-supported-model={model.registryModelId} data-price-mode={multiplier === null ? 'direct' : 'multiplier'}>
        <ModelCenterHint locale={locale} text={fullHint}>
            <button type='button' className='nmx-mc-model-row' aria-expanded={expanded} aria-label={fullHint} onClick={() => onToggleExpand(model.id)}>
                <span className='nmx-mc-model-name'><strong>{model.displayName}</strong><ModelTaxonomyTags locale={locale} model={model} showCategory /><small>{multiplier === null ? offeringPriceText(locale, 'ownTag') : <bdi dir='ltr'>{relayMultiplierTag(locale, multiplier) || '—'}</bdi>}{score === undefined ? <> · <span className='nmx-mc-model-evidence' data-fallback>{modelPickerEvidenceText(locale, 'authenticity')} <bdi dir='ltr'>—</bdi></span></> : <> · <span className='nmx-mc-model-evidence'>{modelPickerEvidenceText(locale, 'authenticity')} <bdi dir='ltr'>{score}%</bdi></span></>}{latency && <> · <span className='nmx-mc-model-evidence' data-fallback={latency.stale || undefined}>{relayText(locale, 'latency')} <bdi dir='ltr'>{latency.value}</bdi></span></>}</small></span>
                <span className='nmx-mc-price-preview'><ModelCenterPricePreview model={model} side='official' locale={locale} /></span>
                <span className='nmx-mc-price-preview'><ModelCenterPricePreview model={model} side='user' locale={locale} /></span>
            </button>
        </ModelCenterHint>
        {expanded && <div className='nmx-mc-model-expanded'><code dir='ltr'>{model.canonicalModel}</code>
            <p className='nmx-mc-model-multiplier'>{offeringPriceText(locale, 'multiplier')}: <strong dir='ltr'>{multiplier === null ? offeringPriceText(locale, 'none') : relayMultiplierText(locale, multiplier)}</strong>{multiplier === null && <small> · {offeringPriceText(locale, 'own')}</small>}</p>{dimensions.length
            ? <table><thead><tr><th aria-label={text('output')} /><th>{text('officialPrice')}</th><th>{text('yourPrice')}</th></tr></thead><tbody>{dimensions.map(dimension => <tr key={dimension.metric} data-price-metric={dimension.metric}>
                <th>{modelCenterPriceMetric(locale, dimension.metric)}</th>
                <td>{dimension.official ? formattedAmount(dimension.official.amountMicros, dimension.currency) : 'US$-'}{dimension.official && <small>/ {modelCenterPriceUnit(locale, dimension.metric, dimension.official.unitSize)}</small>}</td>
                <td>{formattedAmount(dimension.user?.amountMicros, dimension.currency)}{dimension.user && <small>/ {modelCenterPriceUnit(locale, dimension.metric, dimension.user.unitSize)}</small>}</td>
            </tr>)}</tbody></table> : <p>{text('pricePending')}</p>}</div>}
    </article>;
});

function MerchantModelDrawerBody({ service, merchant, locale, onClose, closing = false, modelRank }: MerchantModelDrawerProps): React.ReactElement {
    const [search, setSearch] = React.useState('');
    const [composing, setComposing] = React.useState(false);
    const composition = React.useRef(false);
    const [category, setCategory] = React.useState<SupportCategory>('all');
    const [expanded, setExpanded] = React.useState('');
    const generation = React.useRef(0);
    const busy = React.useRef(false);
    const dialog = React.useRef<HTMLElement>(null);
    const list = React.useRef<HTMLDivElement | null>(null);
    const sentinel = React.useRef<HTMLDivElement>(null);
    const searchTerm = search.trim();
    const requestKey = JSON.stringify([merchant.id, searchTerm, category]);
    const initialCached = getCachedMerchantSupportCatalog(service, merchant.id, searchTerm, category);
    const refreshPending = React.useRef(!initialCached || Date.now() - initialCached.updatedAt >= 60_000);
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
        if (busy.current || composition.current || activeRequest.current !== requestKey || (after && refreshPending.current)) return;
        const cachedEntry = !after && !force ? getCachedMerchantSupportCatalog(service, merchant.id, searchTerm, category) : undefined;
        if (cachedEntry && Date.now() - cachedEntry.updatedAt < 60_000) {
            refreshPending.current = false;
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
            if (token === generation.current && activeRequest.current === requestKey) {
                busy.current = false;
                if (!after) refreshPending.current = false;
                setLoading(false);
            }
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
        refreshPending.current = !cachedEntry || Date.now() - cachedEntry.updatedAt >= 60_000;
        loadedSnapshot.current = cachedEntry ? { key: requestKey, version: cachedEntry.result.snapshotVersion } : undefined;
        setPage(cachedEntry ? { key: requestKey, cursor: cachedEntry.result.nextCursor, offerings: cachedEntry.result.offerings } : undefined);
        setFailure(undefined); setLoading(!cachedEntry); setExpanded('');
        if (list.current) list.current.scrollTop = 0;
        // No partial IME syllables reach the server. A committed word follows the same debounce as typing.
        const timer = composing ? undefined : window.setTimeout(() => void load(), searchTerm ? 200 : 0);
        return () => { window.clearTimeout(timer); refreshPending.current = false; ++generation.current; };
    }, [service, merchant.id, category, requestKey, load, composing, searchTerm]);
    const loadMore = React.useCallback((): void => {
        if (cursor && !loading && !error && !closing && !refreshPending.current && !busy.current) void load(cursor);
    }, [cursor, loading, error, closing, load]);
    React.useEffect(() => {
        if (!cursor || loading || error || closing || refreshPending.current || !list.current || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) loadMore();
        }, { root: list.current, rootMargin: '160px' });
        observer.observe(sentinel.current);
        return () => observer.disconnect();
    }, [cursor, currentPage, loading, error, closing, loadMore]);
    const toggleExpand = React.useCallback((modelId: string): void => {
        setExpanded(current => current === modelId ? '' : modelId);
    }, []);
    const bindListRef = React.useCallback((element: HTMLElement | null): void => {
        list.current = element as HTMLDivElement | null;
    }, []);
    const executable = new Map<string, PlatformOffering>();
    // One row per model and price: the same model on two APIs of this merchant at the same price shows once, at
    // different prices twice (same name; the hover and the expanded table show what each one charges).
    for (const offering of currentPage?.offerings || []) {
        if (offering.status !== 'active') continue;
        const key = `${offering.registryModelId}\n${offeringPriceSignature(offering)}`;
        if (!executable.has(key)) executable.set(key, offering);
    }
    const rows = sortMerchantDrawerOfferings([...executable.values()], modelRank);
    const categories: readonly SupportCategory[] = ['all', 'language', 'image', 'video', 'audio', 'others'];
    // Tabs are the server's browse buckets: three are primary categories and use their shared names; "audio" and
    // "others" span several categories and keep their own.
    const categoryText = (value: SupportCategory): string => value === 'language' || value === 'image' || value === 'video' ? modelCategoryLabel(locale, value)
        : value === 'others' ? text('others') : relayMarketplaceText(locale, value);
    const listFooter = <>
        <div className='nmx-mc-directory-status' role='status' aria-live='polite'>{loading && <><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />{modelUsageText(locale, 'loading')}</>}
            {error && <><span>{text('directoryFailed')}</span><button type='button' data-model-center-model-retry onClick={() => void load(failure?.after, failure?.force)}>{modelUsageText(locale, 'retry')}</button></>}
            {!loading && !error && rows.length === 0 && text('noMatchingModels')}
            {!loading && !error && cursor && <button type='button' data-model-center-model-more onClick={loadMore}>{modelUsageText(locale, 'loadMore')}</button>}</div>
        <div ref={sentinel} data-model-center-model-sentinel aria-hidden='true' />
    </>;
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
            <header><div>{merchant.depositVerified === true
                ? <div className='nmx-mc-drawer-title'>
                    <ModelCenterHint locale={locale} text={depositVerifiedHintText(locale, merchant)} focusable depositVerified><h3 className='is-deposit-verified'>{merchant.name}</h3></ModelCenterHint>
                    <ModelCenterHint locale={locale} text={publicMerchantDepositText(locale)} focusable><DepositVerifiedSeal size={16} /></ModelCenterHint>
                </div>
                : <ModelCenterHint locale={locale} text={merchant.name} focusable><h3>{merchant.name}</h3></ModelCenterHint>}
                <code dir='ltr'>{merchant.publicCode || '—'}</code></div><button type='button' aria-label={text('close')} onClick={onClose}><i className='codicon codicon-close' aria-hidden='true' /></button></header>
            <MerchantStoreProfile merchant={merchant} locale={locale} />
            <label className='nmx-mc-model-search'><i className='codicon codicon-search' aria-hidden='true' /><ImeInput type='search' commitDelayMs={100} data-model-center-model-search
                value={search} aria-label={text('modelSearch')} placeholder={text('modelSearch')} maxLength={120}
                onChange={event => setSearch(event.currentTarget.value)}
                onCompositionStart={() => { composition.current = true; setComposing(true); }}
                onCompositionEnd={event => { composition.current = false; setSearch(event.currentTarget.value); setComposing(false); }} /></label>
            <div className='nmx-mc-model-summary'>{text('loadedModels', rows.length)}{cursor && <><span>·</span>{text('partial')}</>}
                <ModelCenterHint locale={locale} text={text('outputNote')} focusable><i className='codicon codicon-info' aria-hidden='true' /></ModelCenterHint></div>
            <nav className='nmx-mc-model-categories' aria-label={text('allCategories')}>{categories.map(value => <button type='button' key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{categoryText(value)}</button>)}</nav>
            <div className='nmx-mc-model-price-head'><span>{desktopText(locale, 'models')}</span><span>{text('officialPrice')}</span><span>{text('yourPrice')}</span></div>
            <BusyScrollerContext.Provider value={loading}>
                <VirtualList<PlatformOffering>
                    items={rows}
                    itemKey={item => item.id}
                    className={`nmx-mc-model-list${rows.length === 0 && loading ? ' is-empty-busy' : ''}`}
                    defaultItemHeight={64}
                    initialItemCount={Math.min(rows.length, 15)}
                    scrollerRef={bindListRef}
                    components={{ Scroller: BusyAwareScroller }}
                    endReached={loadMore}
                    empty={null}
                    footer={listFooter}
                    renderItem={model => <MerchantModelRow model={model} locale={locale} expanded={expanded === model.id} onToggleExpand={toggleExpand} />}
                />
            </BusyScrollerContext.Provider>
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
