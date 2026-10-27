/*
 * Usage & spend analytics (Model Center → usage, Settings → balance summary).
 *
 * Layout and metrics follow LiteLLM's usage/spend dashboard and OpenRouter's Activity page
 * (behavior only): KPI row → daily trend → spend by model + cache → by-model table → by-relay
 * table. It is the desktop port of the NextMux web dashboard usage page
 * (apps/cloudflare-platform/web/src/features/account/pages/usage.tsx) and uses the same
 * platform endpoints: exact window totals from `/api/wallet/merchant-usage`, per-day and
 * per-model views from `/api/wallet/history?kind=usage`. Unknown values render “—”, never 0.
 */
import * as React from '@theia/core/shared/react';
import type { NextMuxPlatformService, PlatformMerchantUsageSummary, PlatformUsageHistoryRecord } from '../common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { modelUsageText } from './nextmux-model-usage-locale';
import { relayMerchantNumber } from './nextmux-relay-marketplace';
import { usageAnalyticsText } from './nextmux-usage-analytics-locale';
import { USAGE_DAY_MS, usageByDay, usageByModel, usagePercentile, usagePrimaryCurrency, usageProviderCacheRate, usageProviderTotals, usageRatio, usageRowTokens } from './nextmux-usage-stats';

export type UsageAnalyticsService = Pick<NextMuxPlatformService, 'getMerchantUsageOverview' | 'getUsageHistory'>;
type Metric = 'spend' | 'requests' | 'tokens';

export interface UsageAnalyticsProps {
    readonly service: UsageAnalyticsService;
    readonly locale: NextMuxDesktopLocale;
    readonly rangeDays: number;
    /** Empty selects the primary currency (USD first). */
    readonly currency?: string;
    readonly revision?: number;
    readonly variant?: 'full' | 'summary';
    /** Summary heading, e.g. the range label. */
    readonly title?: string;
    readonly searchQuery?: string;
    readonly onCurrencies?: (currencies: readonly string[]) => void;
    readonly onLoading?: (loading: boolean) => void;
}

/** Chart sample bound, as on the web dashboard: 12 pages × 100 requests. */
const RECORD_PAGES = 12;
const PROVIDER_PAGES = 10;

interface Loaded {
    readonly providers: readonly PlatformMerchantUsageSummary[];
    readonly records: readonly PlatformUsageHistoryRecord[];
    readonly truncated: boolean;
    readonly since: number;
    readonly until: number;
}

/** Rounds "now" to the minute so a window stays stable across paginated requests. */
export function usageWindow(days: number, now = Date.now()): { since: number; until: number } {
    const until = Math.floor(now / 60_000) * 60_000 + 60_000;
    return { since: until - days * USAGE_DAY_MS, until };
}

/** `history: false` (Settings summary) reads only the exact aggregates, never the per-request pages. */
export async function loadUsageAnalytics(service: UsageAnalyticsService, days: number, now = Date.now(), { history = true }: { history?: boolean } = {}): Promise<Loaded> {
    const { since, until } = usageWindow(days, now);
    const providers = (async () => {
        const rows: PlatformMerchantUsageSummary[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < PROVIDER_PAGES; page++) {
            const result = await service.getMerchantUsageOverview({ since, until, limit: 50, ...(cursor ? { cursor } : {}) });
            rows.push(...result.items);
            if (!result.nextCursor || result.nextCursor === cursor) break;
            cursor = result.nextCursor;
        }
        return rows;
    })();
    const records = (async () => {
        const rows: PlatformUsageHistoryRecord[] = [];
        if (!history) return { rows, truncated: false };
        let cursor: string | undefined;
        for (let page = 0; page < RECORD_PAGES; page++) {
            const result = await service.getUsageHistory({ since, until, limit: 100, ...(cursor ? { cursor } : {}) });
            rows.push(...result.items);
            if (!result.nextCursor || result.nextCursor === cursor) return { rows, truncated: false };
            cursor = result.nextCursor;
        }
        return { rows, truncated: true };
    })();
    const [providerRows, recordSet] = await Promise.all([providers, records]);
    return { providers: providerRows, records: recordSet.rows, truncated: recordSet.truncated, since, until };
}

function formatter(locale: NextMuxDesktopLocale) {
    const safe = (make: () => string, fallback: string): string => { try { return make(); } catch { return fallback; } };
    return {
        /** Exact fees: charged amounts keep up to six decimals (micro-units). */
        money: (micros: number, currency: string) => safe(() => new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000), `${currency} ${(micros / 1_000_000).toFixed(6)}`),
        compactMoney: (micros: number, currency: string) => safe(() => new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 2 }).format(micros / 1_000_000), String(micros / 1_000_000)),
        integer: (value: number) => safe(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value), String(value)),
        compact: (value: number) => safe(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value), String(value)),
        percent: (value: number | null) => value === null ? '—' : safe(() => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value), `${(value * 100).toFixed(1)}%`),
        duration: (ms: number | null | undefined) => {
            if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
            if (ms < 1_000) return `${safe(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ms), String(Math.round(ms)))} ms`;
            return `${safe(() => new Intl.NumberFormat(locale, { maximumFractionDigits: ms < 10_000 ? 2 : 1 }).format(ms / 1_000), (ms / 1_000).toFixed(1))} s`;
        },
        shortDate: (time: number) => safe(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(time), new Date(time).toLocaleDateString()),
        longDate: (time: number) => safe(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(time), new Date(time).toLocaleDateString())
    };
}

function evidenceText(locale: NextMuxDesktopLocale, row: PlatformMerchantUsageSummary): string {
    return modelUsageText(locale, row.modelEvidence === 'self_reported_conflict' ? 'evidenceConflict'
        : row.modelEvidence === 'self_reported_consistent' ? 'evidenceConsistent' : 'evidenceInsufficient');
}

/** Bars per day with a hover/focus tooltip (dataviz: one hue, rounded data end, 2px gap). */
function DailyBars({ days, value, format, label, locale, dateText, shortDate }: {
    days: readonly { time: number }[]; value: (index: number) => number | null; format: (value: number) => string;
    label: string; locale: NextMuxDesktopLocale; dateText: (time: number) => string; shortDate: (time: number) => string;
}): React.ReactElement {
    const [active, setActive] = React.useState<number>();
    const values = days.map((_, index) => value(index));
    const max = Math.max(0, ...values.map(item => item ?? 0));
    const tip = active === undefined ? undefined : values[active];
    const position = active === undefined ? 0 : (active + .5) / Math.max(1, days.length) * 100;
    const ticks = days.length > 2 ? [0, Math.floor((days.length - 1) / 2), days.length - 1] : days.map((_, index) => index);
    return <figure className='nmx-usage-chart' aria-label={label} onMouseLeave={() => setActive(undefined)}>
        <div className='nmx-usage-chart-scale' aria-hidden='true'><span>{max > 0 ? format(max) : ''}</span><span>{format(0)}</span></div>
        <div className='nmx-usage-chart-plot' role='list'>
            {days.map((day, index) => {
                const item = values[index];
                const height = item === null || max <= 0 ? 0 : Math.max(item > 0 ? 2 : 0, item / max * 100);
                return <button type='button' role='listitem' key={day.time} className={`nmx-usage-chart-bar${active === index ? ' is-active' : ''}`}
                    aria-label={usageAnalyticsText(locale, 'dayTip', { day: dateText(day.time), value: item === null ? '—' : format(item) })}
                    onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(undefined)}>
                    <i style={{ height: `${height}%` }} />
                </button>;
            })}
        </div>
        <div className='nmx-usage-chart-axis' aria-hidden='true'>{ticks.map(index => <span key={index} style={{ insetInlineStart: `${(index + .5) / Math.max(1, days.length) * 100}%` }}>{shortDate(days[index].time)}</span>)}</div>
        {active !== undefined && <div className={`nmx-usage-chart-tip${position < 18 ? ' is-start' : position > 82 ? ' is-end' : ''}`} role='status'
            style={{ insetInlineStart: `${position}%` }}><strong>{dateText(days[active].time)}</strong><span>{tip === null ? '—' : format(tip!)}</span></div>}
    </figure>;
}

export function UsageAnalytics(props: UsageAnalyticsProps): React.ReactElement {
    const { service, locale, rangeDays, revision = 0, variant = 'full', searchQuery = '' } = props;
    const [data, setData] = React.useState<Loaded>();
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [metric, setMetric] = React.useState<Metric>('spend');
    const generation = React.useRef(0);
    const onCurrencies = React.useRef(props.onCurrencies); onCurrencies.current = props.onCurrencies;
    const onLoading = React.useRef(props.onLoading); onLoading.current = props.onLoading;
    React.useEffect(() => {
        const token = ++generation.current;
        setLoading(true); setError(''); onLoading.current?.(true);
        void loadUsageAnalytics(service, rangeDays, Date.now(), { history: variant !== 'summary' }).then(result => {
            if (token !== generation.current) return;
            setData(result);
            onCurrencies.current?.([...new Set([...result.providers.map(row => row.currency), ...result.records.map(row => row.currency)])].sort());
        }).catch(cause => {
            if (token === generation.current) setError(cause instanceof Error && cause.message ? cause.message : modelUsageText(locale, 'loadFailed'));
        }).finally(() => {
            if (token === generation.current) { setLoading(false); onLoading.current?.(false); }
        });
        return () => { ++generation.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, rangeDays, revision, variant]);
    const f = formatter(locale);
    const text = (key: Parameters<typeof usageAnalyticsText>[1], values?: Readonly<Record<string, string | number>>) => usageAnalyticsText(locale, key, values);
    const currency = props.currency || usagePrimaryCurrency([...(data?.providers || []).map(row => row.currency), ...(data?.records || []).map(row => row.currency)]);
    const totals = usageProviderTotals(data?.providers || [], currency);
    const daily = data ? usageByDay(data.records, data.since, data.until, currency) : [];
    const models = data ? usageByModel(data.records, currency) : [];
    const sampleRecords = (data?.records || []).filter(record => record.currency === currency);
    const metered = sampleRecords.filter(record => record.inputTokens !== null || record.outputTokens !== null).length;
    const cacheHit = daily.reduce((sum, day) => sum + day.cacheHit, 0);
    const cacheTotal = daily.reduce((sum, day) => sum + day.cacheTotal, 0);
    const cacheRate = !data ? null : variant === 'summary' ? usageProviderCacheRate(data.providers, currency) : usageRatio(cacheHit, cacheTotal);
    const p95 = usagePercentile(sampleRecords.flatMap(record => record.durationMs === null ? [] : [record.durationMs]), 95);
    const hasTokens = data ? metered > 0 || totals.inputTokens + totals.outputTokens > 0 : false;
    const ready = Boolean(data) && !error;
    const kpis: readonly { key: string; label: string; value: string; hint: string; icon: string }[] = [
        { key: 'spend', label: text('spend'), value: ready ? f.money(totals.chargedMicros, currency) : '—', hint: ready ? text('spendHint', { count: f.integer(totals.requests) }) : '', icon: 'credit-card' },
        { key: 'requests', label: text('requests'), value: ready ? f.integer(totals.requests) : '—', hint: ready ? text('successHint', { rate: f.percent(usageRatio(totals.completed, totals.requests)) }) : '', icon: 'pulse' },
        { key: 'tokens', label: text('tokens'), value: ready && hasTokens ? `${totals.tokensLowerBound ? '≥ ' : ''}${f.compact(totals.totalTokens)}` : '—',
            hint: !ready ? '' : hasTokens ? text('tokensHint', { input: f.compact(totals.inputTokens), output: f.compact(totals.outputTokens) }) : text('notReported'), icon: 'symbol-numeric' },
        { key: 'cache', label: text('cacheHitRate'), value: ready ? f.percent(cacheRate) : '—',
            hint: !ready ? '' : hasTokens ? text('cacheHint', { read: f.compact(totals.cachedTokens), write: f.compact(totals.cacheWriteTokens) }) : text('notReported'), icon: 'database' },
        { key: 'latency', label: text('avgLatency'), value: ready ? f.duration(totals.averageDurationMs) : '—', hint: ready && variant !== 'summary' ? text('p95', { value: f.duration(p95) }) : '', icon: 'watch' }
    ];
    const kpiRow = <div className='nmx-usage-kpis' aria-busy={loading}>{kpis.map(kpi => <article key={kpi.key} data-usage-kpi={kpi.key}>
        <span><i className={`codicon codicon-${kpi.icon}`} aria-hidden='true' />{kpi.label}</span>
        <strong dir='ltr'>{loading && !data ? <em className='nmx-usage-skeleton' aria-hidden='true' /> : kpi.value}</strong>
        <small>{loading && !data ? ' ' : kpi.hint}</small>
    </article>)}</div>;
    const errorView = error && <div className='nmx-usage-error' role='alert'><span>{modelUsageText(locale, 'usageUnavailable')}</span><small>{error}</small></div>;
    if (variant === 'summary') return <section className='nmx-usage-analytics is-summary' data-usage-analytics='summary' lang={locale}>
        {props.title && <header className='nmx-usage-summary-title'><strong>{props.title}</strong></header>}{errorView}{kpiRow}
    </section>;

    const query = searchQuery.trim().toLocaleLowerCase();
    const visibleModels = query ? models.filter(model => `${model.label} ${model.model}`.toLocaleLowerCase().includes(query)) : models;
    const providers = (data?.providers || []).filter(row => row.currency === currency && (!query || [row.providerName, row.merchantId ? relayMerchantNumber(row.merchantId) : '']
        .join(' ').toLocaleLowerCase().includes(query)));
    const empty = ready && totals.requests === 0 && sampleRecords.length === 0;
    const chartValue = (index: number): number | null => {
        const day = daily[index];
        if (metric === 'spend') return day.chargedMicros;
        if (metric === 'requests') return day.requests;
        return day.metered ? day.totalTokens : day.requests ? null : 0;
    };
    const chartFormat = (value: number): string => metric === 'spend' ? f.compactMoney(value, currency) : f.compact(value);
    const exactFormat = (value: number): string => metric === 'spend' ? f.money(value, currency) : f.integer(value);
    const topModels = models.slice(0, 8);
    const topSpend = Math.max(0, ...topModels.map(model => model.chargedMicros));
    const dash = (known: boolean, value: string) => known ? value : '—';
    return <section className='nmx-usage-analytics' data-usage-analytics='full' lang={locale}>
        {errorView}
        {kpiRow}
        {loading && !data ? <div className='nmx-usage-loading' role='status'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' /><span>{modelUsageText(locale, 'loadingUsage')}</span></div>
            : empty ? <div className='nmx-usage-empty' role='status'><i className='codicon codicon-graph' aria-hidden='true' /><strong>{text('empty')}</strong></div>
                : data && <>
                    <section className='nmx-usage-card nmx-usage-trend'>
                        <header><h3>{text('trend')}</h3><div className='nmx-usage-segmented' role='group' aria-label={text('trend')}>
                            {(['spend', 'requests', 'tokens'] as const).map(key => <button type='button' key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{text(key)}</button>)}
                        </div></header>
                        <DailyBars key={metric} days={daily} value={chartValue} format={metric === 'spend' ? exactFormat : chartFormat} label={`${text('trend')} · ${text(metric)}`}
                            locale={locale} dateText={f.longDate} shortDate={f.shortDate} />
                        {data.truncated && <p className='nmx-usage-note'>{text('truncated', { count: f.integer(data.records.length) })}</p>}
                    </section>
                    <div className='nmx-usage-split'>
                        <section className='nmx-usage-card'>
                            <header><h3>{text('topModels')}</h3></header>
                            {topModels.length ? <ol className='nmx-usage-hbars'>{topModels.map(model => <li key={model.model} title={model.label}>
                                <span data-nmx-literal>{model.label || '—'}</span>
                                <span className='nmx-usage-hbar' aria-hidden='true'><i style={{ width: `${topSpend > 0 ? Math.max(model.chargedMicros > 0 ? 2 : 0, model.chargedMicros / topSpend * 100) : 0}%` }} /></span>
                                <strong dir='ltr'>{f.money(model.chargedMicros, currency)}</strong>
                            </li>)}</ol> : <p className='nmx-usage-note'>{text('empty')}</p>}
                        </section>
                        <section className='nmx-usage-card nmx-usage-cache'>
                            <header><h3>{text('cache')}</h3></header>
                            <dl>
                                <div><dt>{text('cacheHitRate')}</dt><dd dir='ltr'>{f.percent(cacheRate)}</dd></div>
                                <div><dt>{text('cacheRead')}</dt><dd dir='ltr'>{dash(hasTokens, f.compact(totals.cachedTokens))}</dd></div>
                                <div><dt>{text('cacheWrite')}</dt><dd dir='ltr'>{dash(hasTokens, f.compact(totals.cacheWriteTokens))}</dd></div>
                            </dl>
                            <DailyBars days={daily} value={index => usageRatio(daily[index].cacheHit, daily[index].cacheTotal)} format={value => f.percent(value)}
                                label={text('cacheHitRate')} locale={locale} dateText={f.longDate} shortDate={f.shortDate} />
                        </section>
                    </div>
                    <section className='nmx-usage-card nmx-usage-table-card'>
                        <header><h3>{text('byModel')}</h3></header>
                        <div className='nmx-usage-table-scroll'><table className='nmx-usage-table'>
                            <thead><tr><th>{text('model')}</th><th>{text('requests')}</th><th>{text('successRate')}</th><th>{text('input')}</th><th>{text('output')}</th><th>{text('cacheHitRate')}</th><th>{text('p50')}</th><th>{text('spend')}</th></tr></thead>
                            <tbody>{visibleModels.map(model => <tr key={model.model} data-usage-model={model.model}>
                                <th scope='row' data-nmx-literal title={model.model}>{model.label || '—'}</th>
                                <td>{f.integer(model.requests)}</td>
                                <td>{f.percent(usageRatio(model.completed, model.requests))}</td>
                                <td>{dash(model.metered > 0, f.integer(model.inputTokens))}</td>
                                <td>{dash(model.metered > 0, f.integer(model.outputTokens))}</td>
                                <td>{f.percent(usageRatio(model.cacheHit, model.cacheTotal))}</td>
                                <td>{f.duration(usagePercentile(model.durations, 50))}</td>
                                <td><strong>{f.money(model.chargedMicros, currency)}</strong></td>
                            </tr>)}</tbody>
                        </table></div>
                        {!visibleModels.length && <p className='nmx-usage-note'>{query ? modelUsageText(locale, 'noMatch') : text('empty')}</p>}
                    </section>
                    <section className='nmx-usage-card nmx-usage-table-card'>
                        <header><h3>{text('byRelay')}</h3></header>
                        <div className='nmx-usage-table-scroll'><table className='nmx-usage-table'>
                            <thead><tr><th>{text('relay')}</th><th>{text('requests')}</th><th>{text('successRate')}</th><th>{text('failovers')}</th><th>{text('avgLatency')}</th><th>{text('tokens')}</th><th>{text('evidence')}</th><th>{text('spend')}</th></tr></thead>
                            <tbody>{providers.map(row => <tr key={`${row.merchantId}:${row.currency}`} data-usage-relay={row.merchantId || 'platform'}>
                                <th scope='row' data-nmx-literal>{row.merchantId ? row.providerName : modelUsageText(locale, 'platformRoute')}<small dir='ltr'>{row.merchantId ? relayMerchantNumber(row.merchantId) : ''}</small></th>
                                <td>{f.integer(row.requestCount)}</td>
                                <td>{f.percent(usageRatio(row.completedCount, row.requestCount))}</td>
                                <td>{f.integer(row.failoverCount)}</td>
                                <td>{f.duration(row.averageDurationMs)}</td>
                                <td>{(() => { const tokens = usageRowTokens(row); return tokens.tokens > 0 ? `${tokens.lowerBound ? '≥ ' : ''}${f.compact(tokens.tokens)}` : '—'; })()}</td>
                                <td className={`is-${row.modelEvidence}`}>{evidenceText(locale, row)}</td>
                                <td><strong>{f.money(row.chargedMicros, row.currency)}</strong></td>
                            </tr>)}</tbody>
                        </table></div>
                        {!providers.length && <p className='nmx-usage-note'>{query ? modelUsageText(locale, 'noMatch') : text('empty')}</p>}
                    </section>
                </>}
    </section>;
}
