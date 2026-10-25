import * as React from 'react';

import type { PlatformMerchantUsageSummary } from '../common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { modelUsageText } from './nextmux-model-usage-locale';
import { UsageAnalytics, type UsageAnalyticsService } from './nextmux-usage-analytics';
import { usagePrimaryCurrency } from './nextmux-usage-stats';

export interface PersonalApiUsageRecord {
    readonly id: string;
    readonly conversationTitle: string;
    readonly routeLabel: string;
    readonly usageLabel?: string;
    readonly billingLabel?: string;
    /** Token counts shown in the app language (older records only have usageLabel). */
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    /** Local model (Ollama): no provider charge. */
    readonly local?: boolean;
    /** Estimated USD from this API's own price, else the public directory's reference price; billed by the provider. */
    readonly estimateUsd?: number;
    readonly estimateSource?: 'api' | 'reference';
    readonly startedAt: number;
    readonly completedAt?: number;
    readonly status: 'complete' | 'paused' | 'cancelled' | 'error' | 'running';
    /** A picture, voice or clip shows what was made instead of token counts. */
    readonly amountLabel?: string;
    /** Where the record comes from when not a coding conversation (for example the comic studio). */
    readonly note?: string;
}

/** A small USD estimate that stays readable: "$0.0042", "$1.26". */
function usdEstimate(locale: string, value: number): string {
    const digits = value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value); }
    catch { return `$${value.toFixed(digits)}`; }
}

export interface ModelUsagePanelProps {
    readonly service: UsageAnalyticsService;
    readonly linked: boolean;
    readonly ownerId?: string;
    readonly locale: NextMuxDesktopLocale;
    readonly personalUsage: readonly PersonalApiUsageRecord[];
    readonly searchQuery?: string;
    readonly onLogin: () => void;
}

type UsageRangeDays = 7 | 30 | 90 | 366;

function dateTime(locale: string, value: number): string {
    if (!value) return '—';
    try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value); }
    catch { return new Date(value).toLocaleString(); }
}

export function usageEvidenceLabel(row: PlatformMerchantUsageSummary, locale: NextMuxDesktopLocale = 'zh-CN'): {
    readonly tone: 'consistent' | 'conflict' | 'insufficient'; readonly label: string; readonly detail: string;
} {
    if (row.modelEvidence === 'self_reported_conflict') return {
        tone: 'conflict', label: modelUsageText(locale, 'evidenceConflict'),
        detail: modelUsageText(locale, 'evidenceConflictDetail', { mismatched: row.modelMismatchedCount, matched: row.modelMatchedCount })
    };
    if (row.modelEvidence === 'self_reported_consistent') return {
        tone: 'consistent', label: modelUsageText(locale, 'evidenceConsistent'),
        detail: modelUsageText(locale, 'evidenceConsistentDetail', { matched: row.modelMatchedCount })
    };
    return {
        tone: 'insufficient', label: modelUsageText(locale, 'evidenceInsufficient'),
        detail: modelUsageText(locale, 'evidenceInsufficientDetail', { matched: row.modelMatchedCount, unreported: row.modelUnreportedCount })
    };
}

export function filterPersonalApiUsage(records: readonly PersonalApiUsageRecord[], query: string): readonly PersonalApiUsageRecord[] {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? records.filter(record => [record.routeLabel, record.conversationTitle]
        .join(' ').toLocaleLowerCase().includes(normalized)) : records;
}

export const ModelUsagePanel: React.FC<ModelUsagePanelProps> = ({ service, linked, ownerId, locale, personalUsage, searchQuery = '', onLogin }) => {
    const [source, setSource] = React.useState<'managed' | 'personal'>('managed');
    const [rangeDays, setRangeDays] = React.useState<UsageRangeDays>(30);
    const [currency, setCurrency] = React.useState('');
    const [currencies, setCurrencies] = React.useState<readonly string[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [refreshRevision, setRefreshRevision] = React.useState(0);
    const visiblePersonalUsage = filterPersonalApiUsage(personalUsage, searchQuery);
    const sourceTabs = ['managed', 'personal'] as const;
    const sourceTabsView = <div className='nmx-model-usage-source-tabs' role='tablist' aria-label={modelUsageText(locale, 'sourceTabs')}>
        {sourceTabs.map(tab => <button key={tab} role='tab' id={`nmx-usage-tab-${tab}`} aria-selected={source === tab}
            aria-controls={`nmx-usage-panel-${tab}`} tabIndex={source === tab ? 0 : -1} onClick={() => setSource(tab)}
            onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? sourceTabs[0] : event.key === 'End' ? sourceTabs[1]
                    : sourceTabs[source === 'managed' ? 1 : 0];
                setSource(next);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#nmx-usage-tab-${next}`)?.focus();
            }}>{modelUsageText(locale, tab)}</button>)}
    </div>;

    if (source === 'personal') return <section className='nmx-model-usage-panel'>
        {sourceTabsView}
        <div id='nmx-usage-panel-personal' role='tabpanel' aria-labelledby='nmx-usage-tab-personal'>
            {personalUsage.length === 0 ? <div className='nmx-model-usage-state'>
                <i className='codicon codicon-key' aria-hidden='true'></i><strong>{modelUsageText(locale, 'noPersonal')}</strong>
            </div> : visiblePersonalUsage.length === 0 ? <div className='nmx-model-usage-state'>
                <strong>{modelUsageText(locale, 'noMatchingUsage')}</strong>
            </div> : <div className='nmx-personal-api-usage-list' role='list' aria-label={modelUsageText(locale, 'personal')}>
                {visiblePersonalUsage.map(record => <article key={record.id} role='listitem'>
                    <span className='nmx-model-usage-avatar' aria-hidden='true'><i className='codicon codicon-key'></i></span>
                    <span><strong data-nmx-literal>{record.routeLabel}</strong><small data-nmx-literal>{record.conversationTitle}</small></span>
                    <span><strong data-nmx-literal>{record.inputTokens !== undefined && record.outputTokens !== undefined
                        ? modelUsageText(locale, 'tokenBreakdown', { input: record.inputTokens.toLocaleString(locale), output: record.outputTokens.toLocaleString(locale) }) : record.amountLabel || '—'}</strong>
                        <small data-nmx-literal>{record.note || modelUsageText(locale, 'localHistory')}</small></span>
                    <span><strong>{modelUsageText(locale, record.local ? 'localFree' : 'directBilling')}</strong>{!record.local && record.estimateUsd !== undefined
                        && <small data-nmx-literal>{modelUsageText(locale, record.estimateSource === 'api' ? 'estimateApi' : 'estimateReference', { amount: usdEstimate(locale, record.estimateUsd) })}</small>}</span>
                    <time dateTime={new Date(record.completedAt || record.startedAt).toISOString()}>{dateTime(locale, record.completedAt || record.startedAt)}</time>
                </article>)}
            </div>}
        </div>
    </section>;

    return <section className='nmx-model-usage-panel'>
        {sourceTabsView}
        <div id='nmx-usage-panel-managed' role='tabpanel' aria-labelledby='nmx-usage-tab-managed'>
        {!linked || !ownerId ? <div className='nmx-model-usage-state'>
            <i className='codicon codicon-account' aria-hidden='true'></i>
            <strong>{modelUsageText(locale, 'managedLoginTitle')}</strong>
            <button className='nmx-primary-button' onClick={onLogin}>{modelUsageText(locale, 'login')}</button>
        </div> : <>
        <div className='nmx-model-usage-toolbar'>
            <label><span>{modelUsageText(locale, 'time')}</span><select value={rangeDays} onChange={event => setRangeDays(Number(event.currentTarget.value) as UsageRangeDays)}>
                <option value={7}>{modelUsageText(locale, 'range7')}</option><option value={30}>{modelUsageText(locale, 'range30')}</option><option value={90}>{modelUsageText(locale, 'range90')}</option><option value={366}>{modelUsageText(locale, 'range366')}</option>
            </select></label>
            {currencies.length > 1 && <label><span>{modelUsageText(locale, 'currency')}</span><select value={currency || usagePrimaryCurrency(currencies)} onChange={event => setCurrency(event.currentTarget.value)}>
                {currencies.map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>}
            <button type='button' disabled={loading} aria-label={modelUsageText(locale, 'refresh')} title={modelUsageText(locale, 'refresh')} onClick={() => setRefreshRevision(value => value + 1)}>
                <i className={`codicon codicon-${loading ? 'sync codicon-modifier-spin' : 'refresh'}`} aria-hidden='true'></i></button>
        </div>
        <UsageAnalytics key={ownerId} service={service} locale={locale} rangeDays={rangeDays} currency={currency} revision={refreshRevision}
            searchQuery={searchQuery} onCurrencies={setCurrencies} onLoading={setLoading} />
        </>}
        </div>
    </section>;
};
