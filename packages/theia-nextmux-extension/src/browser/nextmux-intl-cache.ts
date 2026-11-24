/**
 * Bounded LRU cache for Intl.NumberFormat and Intl.DateTimeFormat instances.
 *
 * Creating Intl formatters inside per-row or per-frame render helpers allocates ICU instances
 * repeatedly; caching by locale + deterministically serialized options keeps formatting O(1).
 */

const MAX_INTL_CACHE_ENTRIES = 256;
const DEFAULT_LOCALE_KEY = '\0__default__';

const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

function serializeIntlOptions(options?: object): string {
    if (!options) return '';
    const record = options as Record<string, unknown>;
    const entries: [string, unknown][] = [];
    for (const key of Object.keys(record).sort()) {
        const value = record[key];
        if (value !== undefined) entries.push([key, value]);
    }
    return entries.length === 0 ? '' : JSON.stringify(entries);
}

function buildIntlCacheKey(locale: string | undefined, options?: object): string {
    const localeKey = locale === undefined ? DEFAULT_LOCALE_KEY : locale;
    return `${localeKey}\0${serializeIntlOptions(options)}`;
}

function getOrCreateFormatter<T>(
    cache: Map<string, T>,
    key: string,
    create: () => T
): T {
    const existing = cache.get(key);
    if (existing !== undefined) {
        cache.delete(key);
        cache.set(key, existing);
        return existing;
    }
    const created = create();
    if (cache.size >= MAX_INTL_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, created);
    return created;
}

/** Returns a cached Intl.NumberFormat for `locale` and `options` using a 256-entry LRU cache. */
export function getCachedNumberFormat(
    locale: string | undefined,
    options?: Intl.NumberFormatOptions
): Intl.NumberFormat {
    const key = buildIntlCacheKey(locale, options);
    return getOrCreateFormatter(numberFormatCache, key, () => new Intl.NumberFormat(locale, options));
}

/** Returns a cached Intl.DateTimeFormat for `locale` and `options` using a 256-entry LRU cache. */
export function getCachedDateTimeFormat(
    locale: string | undefined,
    options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
    const key = buildIntlCacheKey(locale, options);
    return getOrCreateFormatter(dateTimeFormatCache, key, () => new Intl.DateTimeFormat(locale, options));
}

/** Clears cached Intl formatter instances (intended for unit tests). */
export function clearIntlFormatCacheForTests(): void {
    numberFormatCache.clear();
    dateTimeFormatCache.clear();
}
