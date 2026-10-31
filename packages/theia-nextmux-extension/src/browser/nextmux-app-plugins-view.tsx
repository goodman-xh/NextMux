import { decisionPluginCompatibility, isTevDecisionModel } from '@nextmux/model-runtime/decision-adapter';
import { appPluginDiagnostics as originalAppPluginDiagnostics, appPluginReplayName } from './nextmux-app-plugin-diagnostics-locale';
import { modelFailure } from './nextmux-model-errors';
import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { ImeInput } from './nextmux-ime-field';
import { SurfaceTooltips } from './nextmux-surface-tooltips';
import { appPluginError, appPluginReason, appPluginText, type AppPluginTextKey } from './nextmux-app-plugins-locale';
import { appPluginPackageError, appPluginRuntimeText } from './nextmux-app-plugin-runtime-locale';
import { appPluginOptionsText } from './nextmux-app-plugin-options-locale';
import type {
    AppPluginTrust,
    AppPluginDiagnostic, AppPluginInfo, AppPluginInspection, AppPluginLocalServer, AppPluginMarketPlugin, AppPluginMine, AppPluginMinePlugin, AppPluginMineVersion,
    AppPluginModel, AppPluginModelChoices, AppPluginOverlayItem, AppPluginParam, AppPluginParamFileValue, AppPluginParamValue, AppPluginPreset, AppPluginRunSnapshot, AppPluginServerProbe, AppPluginSummary, AppPluginUploadProblem, AppPluginVisionModel
} from '../common/nextmux-app-plugins';
import { APP_PLUGIN_PRICE } from '../common/nextmux-app-plugins';

function appPluginDiagnostics(locale: NextMuxDesktopLocale, value: Parameters<typeof originalAppPluginDiagnostics>[1]): readonly string[] {
    if (value.diagnostics?.length) return value.diagnostics.map(item => appPluginPackageError(locale, item.code)
        || originalAppPluginDiagnostics(locale, { diagnostics: [item] })[0]);
    return (value.errors || value.failures || []).map(error => appPluginPackageError(locale, error)
        || originalAppPluginDiagnostics(locale, { errors: [error] })[0]);
}

/**
 * Skill plugins (技能插件): Settings → 技能插件, the install / model / uninstall / start dialogs, and a tab's plugin
 * bar and reading overlay. The widget owns the state and the bridge calls; these components only draw it.
 */

type Locale = NextMuxDesktopLocale;
const t = appPluginText;

const formatDuration = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60, rest = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
};
const formatUsd = (value: number): string => value >= 1 ? value.toFixed(2) : value >= 0.01 ? value.toFixed(3) : value.toFixed(4);

function appLabel(app: AppPluginSummary['apps'][number]): string {
    return `${app.platform === 'macos' ? app.bundleId : app.program}${app.title ? ` · ${app.title}` : ''} (${app.platform === 'macos' ? 'macOS' : 'Windows'})`;
}

/**
 * A plugin's trust, from the four separate facts (source, review, signature present, signature verified here): a
 * reviewed marketplace version is "reviewed" before this device has checked its signature, never "local file".
 */
export function appPluginTrustBadge(trust: Partial<AppPluginTrust> & { readonly verified?: boolean; readonly dev?: boolean }): {
    readonly label: AppPluginTextKey; readonly hint: AppPluginTextKey; readonly tone: 'is-ok' | 'is-warning' | 'is-danger' | 'is-muted'; readonly icon: string;
} {
    if (trust.source === 'development' || trust.dev) return { label: 'dev', hint: 'unverifiedHint', tone: 'is-muted', icon: 'folder' };
    if (trust.reviewStatus === 'rejected') return { label: 'trustRejected', hint: 'rejectedHint', tone: 'is-danger', icon: 'error' };
    if (trust.reviewStatus === 'pending') return { label: 'trustPending', hint: 'pendingHint', tone: 'is-warning', icon: 'clock' };
    const reviewed = trust.reviewStatus === 'approved' || (trust.reviewStatus === undefined && trust.verified === true);
    if (reviewed && (trust.signatureVerified || (trust.signatureVerified === undefined && trust.verified))) return { label: 'verified', hint: 'verifiedHint', tone: 'is-ok', icon: 'verified' };
    if (reviewed) return { label: 'verified', hint: trust.signaturePresent ? 'reviewedSignedHint' : 'reviewedUnsignedHint', tone: 'is-ok', icon: 'pass' };
    return { label: 'trustLocal', hint: 'unverifiedHint', tone: 'is-muted', icon: 'info' };
}

export function modelLabel(model: AppPluginModel | null | undefined, locale: Locale): string {
    if (!model) return t(locale, 'noModel');
    const where = model.source === 'nextmux' ? model.merchant || t(locale, 'relay')
        : model.source === 'connection' ? model.connectionLabel || t(locale, 'ownApi') : t(locale, 'local');
    return `${model.label || model.model} · ${where}`;
}

function PluginIcon(props: { readonly icon?: string; readonly size?: number }): React.ReactElement {
    const size = props.size || 40;
    return props.icon
        ? <img className='nmx-plugin-icon' src={props.icon} alt='' width={size} height={size} draggable={false} />
        : <span className='nmx-plugin-icon is-placeholder' style={{ width: size, height: size }} aria-hidden='true'><i className='codicon codicon-extensions'></i></span>;
}

/**
 * A plugin's one- or two-line description. Only when the clamp actually cuts the text does it carry `data-help`, so the
 * view's SurfaceTooltips shows the whole description in the app's one tooltip bubble (no native title beside it).
 */
function PluginDescription(props: { readonly text: string; readonly className?: string; readonly as?: 'p' | 'em' }): React.ReactElement {
    const ref = React.useRef<HTMLElement>(null);
    React.useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const sync = (): void => {
            if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) element.setAttribute('data-help', props.text);
            else element.removeAttribute('data-help');
        };
        sync();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(sync);
        observer.observe(element);
        return () => observer.disconnect();
    }, [props.text]);
    return React.createElement(props.as || 'p', { ref, className: props.className || 'nmx-plugin-description', 'data-nmx-literal': true }, props.text);
}

function Facts(props: { readonly summary: AppPluginSummary; readonly locale: Locale }): React.ReactElement {
    const { summary, locale } = props;
    const sight = summary.vision === 'none' ? 'sightNone' : summary.vision === 'optional' ? 'sightOptional' : 'sightRequired';
    return <dl className='nmx-plugin-facts'>
        <div><dt>{t(locale, 'apps')}</dt><dd data-nmx-literal>{summary.apps.map(appLabel).join('、')}</dd></div>
        <div><dt>{t(locale, 'keys')}</dt><dd data-nmx-literal>{summary.keys.length ? summary.keys.map(key => <kbd key={key}>{key}</kbd>) : '—'}</dd></div>
        <div><dt>{t(locale, 'mouse')}</dt><dd>{summary.pointer ? t(locale, 'mouse') : t(locale, 'noMouse')}</dd></div>
        <div><dt>{t(locale, 'sight')}</dt><dd>{t(locale, sight)}</dd></div>
    </dl>;
}

function statusOf(plugin: AppPluginInfo): { readonly key: 'running' | 'broken' | 'needsModel' | 'ready'; readonly tone: string } {
    if (!plugin.ok || plugin.modelCompatibilityError === 'plugin_runtime_unavailable') return { key: 'broken', tone: 'is-danger' };
    if (plugin.running?.length) return { key: 'running', tone: 'is-running' };
    if (!plugin.ready) return { key: 'needsModel', tone: 'is-warning' };
    return { key: 'ready', tone: 'is-ok' };
}

export type AppPluginsTab = 'installed' | 'market' | 'mine';

/** A price in US cents as money in the reader's language ($4.99). */
export function usd(locale: Locale, cents: number): string {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100); } catch { return `$${(cents / 100).toFixed(2)}`; }
}

/** Why the platform refused a package, in the reader's language (the same codes as the app's own install check). */
export function appPluginUploadProblemText(locale: Locale, problem: AppPluginUploadProblem | undefined): string {
    if (!problem) return '';
    if (problem.code === 'package_format_unsupported') return appPluginOptionsText(locale, 'unsupportedFormat');
    const listed = appPluginDiagnostics(locale, { diagnostics: problem.diagnostics || [] }).slice(0, 3);
    if (listed.length) return listed.join('；');
    if (problem.code === 'market_network' || /^market_http_5/.test(problem.code)) return t(locale, 'marketFailed');
    return appPluginError(locale, problem.code);
}

/** A version's review result in words: a failed automatic check translated, a person's note as written. */
export function appPluginVersionReason(locale: Locale, version: Pick<AppPluginMineVersion, 'failedCheck' | 'reviewNote'>): string {
    if (version.failedCheck === 'plugin_listing') return t(locale, 'mineCheckListing');
    if (version.failedCheck === 'package') return t(locale, 'mineCheckPackage');
    return version.reviewNote;
}

export interface AppPluginsSettingsProps {
    readonly locale: Locale;
    readonly plugins: readonly AppPluginInfo[];
    readonly loading: boolean;
    readonly error: string;
    readonly busy: string;
    readonly expandedId: string;
    readonly testResults: Readonly<Record<string, { readonly ok: boolean; readonly results?: readonly { readonly name: string; readonly ok: boolean; readonly failures: readonly string[]; readonly diagnostics?: readonly AppPluginDiagnostic[]; readonly defaultName?: boolean }[]; readonly errors?: readonly string[]; readonly diagnostics?: readonly AppPluginDiagnostic[] }>>;
    /** 加载本地插件: the dialog that explains the format and picks a .nmxplugin file or a plugin folder. */
    onLoadLocal(): void;
    onOpenDocs(): void;
    onChooseModel(id: string): void;
    onConfigureParams?(id: string, params: Readonly<Record<string, unknown>>): void;
    onPickParamFile?(id: string, paramId: string, label?: string): void;
    onUninstall(id: string): void;
    onReload(id: string): void;
    onTest(id: string): void;
    onExpand(id: string): void;
    readonly tab: AppPluginsTab;
    onTab(tab: AppPluginsTab): void;
    /** 我的插件: what this account / device uploaded (undefined until first read). */
    readonly mine: { readonly data?: AppPluginMine; readonly loading: boolean; readonly error: string };
    onMineRefresh(): void;
    onMineUpload(): void;
    /** 收益与提现: sales, the 10% fee, held and available earnings and Whop withdrawals, on the website's 我的插件. */
    onMineEarnings(): void;
    readonly market: { readonly plugins: readonly AppPluginMarketPlugin[]; readonly loading: boolean; readonly error: string; readonly query: string; readonly nextCursor?: string; readonly busy: string };
    onMarketSearch(query: string): void;
    onMarketMore(): void;
    onMarketGet(plugin: AppPluginMarketPlugin): void;
}

/** Semantic version order, the same as the desktop's plugin core: a release is newer than its pre-releases (audit A14-07). */
const compareVersions = (a: string, b: string): number => {
    const parse = (value: string) => {
        const [core, ...rest] = String(value).split('+')[0].split('-');
        return { numbers: core.split('.').map(Number), pre: rest.join('-') };
    };
    const [x, y] = [parse(a), parse(b)];
    for (let index = 0; index < 3; index++) if ((x.numbers[index] || 0) !== (y.numbers[index] || 0)) return (x.numbers[index] || 0) - (y.numbers[index] || 0);
    if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
    const left = x.pre.split('.'), right = y.pre.split('.');
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        if (left[index] === undefined) return -1;
        if (right[index] === undefined) return 1;
        const numeric = /^\d+$/.test(left[index]) && /^\d+$/.test(right[index]);
        const order = numeric ? Number(left[index]) - Number(right[index])
            : /^\d+$/.test(left[index]) ? -1 : /^\d+$/.test(right[index]) ? 1 : left[index].localeCompare(right[index]);
        if (order) return order;
    }
    return 0;
};
const pick = (text: Readonly<Record<string, string>>, locale: Locale): string =>
    text[locale] || (locale.startsWith('zh') && (text['zh-CN'] || text['zh-TW'])) || text.en || text['zh-CN'] || Object.values(text)[0] || '';

/** The marketplace: reviewed plugins from the NextMux platform, searched and installed from here. */
function AppPluginMarket(props: AppPluginsSettingsProps): React.ReactElement {
    const { locale, market } = props;
    const [query, setQuery] = React.useState(market.query);
    const installed = new Map(props.plugins.filter(plugin => plugin.summary).map(plugin => [plugin.id, plugin.summary!.version]));
    return <div className='nmx-plugin-market'>
        <form className='nmx-plugin-market-search' onSubmit={event => { event.preventDefault(); props.onMarketSearch(query); }}>
            <i className='codicon codicon-search' aria-hidden='true'></i>
            <ImeInput value={query} maxLength={200} placeholder={t(locale, 'marketSearch')} aria-label={t(locale, 'marketSearch')} onChange={event => setQuery(event.currentTarget.value)} />
            {market.loading && <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}
        </form>
        {market.error && <div className='nmx-settings-inline-error' role='alert'>{t(locale, 'marketFailed')}</div>}
        {!market.error && !market.loading && !market.plugins.length && <div className='nmx-plugins-empty'><i className='codicon codicon-search' aria-hidden='true'></i><strong>{t(locale, 'marketEmpty')}</strong></div>}
        <ul className='nmx-plugin-list'>{market.plugins.map(plugin => {
            const have = installed.get(plugin.id);
            const update = have && plugin.latestVersion && compareVersions(plugin.latestVersion, have) > 0;
            const busy = market.busy === plugin.id;
            return <li key={plugin.id} className='nmx-plugin-card is-market'>
                <div className='nmx-plugin-card-main'>
                    <PluginIcon size={40} />
                    <div className='nmx-plugin-card-text'>
                        <div className='nmx-plugin-card-title'>
                            <strong data-nmx-literal>{pick(plugin.name, locale) || plugin.id}</strong>
                            {plugin.latestVersion && <span className='nmx-plugin-version' data-nmx-literal>v{plugin.latestVersion}</span>}
                            {(() => { const trust = appPluginTrustBadge(plugin); return <span className={`nmx-plugin-status ${trust.tone}`} title={t(locale, trust.hint)}><i className={`codicon codicon-${trust.icon}`} aria-hidden='true'></i>{t(locale, trust.label)}</span>; })()}
                            <span className={`nmx-plugin-price ${plugin.priceCents ? 'is-paid' : ''}`} data-nmx-literal>{plugin.priceCents ? usd(locale, plugin.priceCents) : t(locale, 'priceFree')}</span>
                            {plugin.priceCents > 0 && plugin.owned && <span className='nmx-plugin-status is-ok'><i className='codicon codicon-check' aria-hidden='true'></i>{t(locale, 'purchased')}</span>}
                        </div>
                        <p className='nmx-plugin-meta' data-nmx-literal>{t(locale, 'by', { name: plugin.author.name })} · {plugin.apps.map(app => app.platform === 'macos' ? app.bundleId : app.program).join(', ')} · {t(locale, 'downloads', { count: plugin.downloads })}</p>
                        <PluginDescription text={pick(plugin.description, locale)} />
                        {plugin.risk.includes('account-ban') && <p className='nmx-plugin-risk'><i className='codicon codicon-warning' aria-hidden='true'></i>{t(locale, 'risk')}</p>}
                    </div>
                    <button type='button' className={`nmx-plugin-get ${have && !update ? 'is-installed' : 'is-primary'}`} disabled={busy || Boolean(have && !update) || !plugin.latestVersion}
                        onClick={() => props.onMarketGet(plugin)}>
                        {busy ? <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i> : null}
                        {have && !update ? t(locale, 'installed') : update ? t(locale, 'updateTo', { version: plugin.latestVersion })
                            : plugin.priceCents > 0 && !plugin.owned ? t(locale, 'buy', { price: usd(locale, plugin.priceCents) }) : t(locale, 'getPlugin')}
                    </button>
                </div>
            </li>;
        })}</ul>
        {market.nextCursor && <button type='button' className='nmx-plugin-more' disabled={market.loading} onClick={props.onMarketMore}>{t(locale, 'loadMore')}</button>}
    </div>;
}

/** One uploaded plugin's state: listed in the market, taken down, or (never listed) its newest version's review. */
function mineState(plugin: AppPluginMinePlugin): { readonly key: AppPluginTextKey; readonly tone: string } {
    if (plugin.status === 'listed') return { key: 'mineListed', tone: 'is-ok' };
    if (plugin.status === 'removed') return { key: 'mineRemoved', tone: 'is-danger' };
    const latest = plugin.versions[0];
    return latest?.status === 'rejected' ? { key: 'mineRejected', tone: 'is-danger' } : { key: 'minePending', tone: 'is-warning' };
}

/** 我的插件: uploads of this account and this device — listed ones, rejected ones with the reason, failed uploads. */
function AppPluginMinePanel(props: AppPluginsSettingsProps): React.ReactElement {
    const { locale, mine } = props;
    const data = mine.data;
    const date = (value: number): string => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value) : '';
    const versionState = (plugin: AppPluginMinePlugin, version: AppPluginMineVersion): { readonly key: AppPluginTextKey; readonly tone: string } =>
        version.status === 'rejected' ? { key: 'mineRejected', tone: 'is-danger' } : version.status === 'pending' ? { key: 'minePending', tone: 'is-warning' }
            : version.version === plugin.latestApprovedVersion ? plugin.status === 'removed' ? { key: 'mineRemoved', tone: 'is-danger' } : { key: 'mineListed', tone: 'is-ok' }
                : { key: 'mineApproved', tone: 'is-muted' };
    return <div className='nmx-plugin-mine'>
        {mine.error && <div className='nmx-settings-inline-error' role='alert'>{t(locale, 'mineFailed')}<button type='button' className='is-link' onClick={props.onMineRefresh}>{t(locale, 'mineRefresh')}</button></div>}
        {!data ? mine.loading && <div className='nmx-plugins-empty'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{t(locale, 'loading')}</div>
            : !data.plugins.length && !data.rejections.length ? <div className='nmx-plugins-empty'>
                <i className='codicon codicon-cloud-upload' aria-hidden='true'></i><strong>{t(locale, 'mineEmpty')}</strong><span>{t(locale, 'mineEmptyHint')}</span>
                <button type='button' className='nmx-plugin-mine-empty-action' onClick={props.onMineUpload}><i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{t(locale, 'mineUpload')}</button>
            </div>
                : <>
                    {data.plugins.length > 0 && <ul className='nmx-plugin-list'>{data.plugins.map(plugin => {
                        const state = mineState(plugin);
                        const shown = plugin.latestApprovedVersion || plugin.versions[0]?.version || '';
                        return <li key={plugin.id} className='nmx-plugin-card is-mine'>
                            <div className='nmx-plugin-card-main'>
                                <PluginIcon size={40} />
                                <div className='nmx-plugin-card-text'>
                                    <div className='nmx-plugin-card-title'>
                                        <strong data-nmx-literal>{pick(plugin.name, locale) || plugin.id}</strong>
                                        {shown && <span className='nmx-plugin-version' data-nmx-literal>v{shown}</span>}
                                        <span className={`nmx-plugin-status ${state.tone}`}>{t(locale, state.key)}</span>
                                    </div>
                                    <p className='nmx-plugin-meta' data-nmx-literal>{[plugin.id, plugin.authorName ? t(locale, 'by', { name: plugin.authorName }) : '',
                                        plugin.priceCents ? usd(locale, plugin.priceCents) : t(locale, 'priceFree'),
                                        plugin.status === 'listed' ? t(locale, 'downloads', { count: plugin.downloads }) : ''].filter(Boolean).join(' · ')}</p>
                                </div>
                            </div>
                            <ul className='nmx-plugin-mine-versions'>{plugin.versions.map(version => {
                                const vs = versionState(plugin, version);
                                const reason = version.status === 'rejected' ? appPluginVersionReason(locale, version) : '';
                                return <li key={version.version}>
                                    <span className='nmx-plugin-version' data-nmx-literal>v{version.version}</span>
                                    <span className={`nmx-plugin-status ${vs.tone}`}>{t(locale, vs.key)}</span>
                                    {version.submittedAt > 0 && <time data-nmx-literal>{date(version.submittedAt)}</time>}
                                    {reason && <p className='nmx-plugin-mine-reason' data-nmx-literal>{t(locale, 'mineReason', { reason })}</p>}
                                </li>;
                            })}</ul>
                        </li>;
                    })}</ul>}
                    {data.rejections.length > 0 && <section className='nmx-plugin-mine-rejections'>
                        <h4>{t(locale, 'mineRejectedUploads')}</h4>
                        <ul>{data.rejections.map(rejection => <li key={rejection.id}>
                            <div><strong data-nmx-literal>{pick(rejection.name, locale) || rejection.pluginId || rejection.fileName || t(locale, 'mineUnnamed')}</strong>
                                {rejection.version && <span className='nmx-plugin-version' data-nmx-literal>v{rejection.version}</span>}
                                <span className='nmx-plugin-status is-danger'>{t(locale, 'mineRejected')}</span>
                                <time data-nmx-literal>{date(rejection.createdAt)}</time></div>
                            {rejection.fileName && <small data-nmx-literal>{rejection.fileName}</small>}
                            <p className='nmx-plugin-mine-reason' data-nmx-literal>{t(locale, 'mineReason', { reason: appPluginUploadProblemText(locale, rejection) })}</p>
                        </li>)}</ul>
                    </section>}
                </>}
    </div>;
}

/** 上传插件到市场: the file and the author shown in the market (no account needed; the device owns the plugin). */
export function AppPluginMarketUploadDialog(props: {
    readonly locale: Locale; readonly fileName: string; readonly author: string; readonly signedIn: boolean; readonly busy: boolean; readonly error: string;
    /** Free, or a USD price typed as dollars ("4.99"); untouched: the platform keeps the plugin's price (new: free). */
    readonly paid: boolean; readonly price: string; readonly priceTouched: boolean;
    onChooseFile(): void; onAuthor(value: string): void; onPaid(paid: boolean): void; onPrice(value: string): void; onSignIn(): void; onCancel(): void; onUpload(): void;
}): React.ReactElement {
    const { locale } = props;
    const cents = appPluginPriceCents(props.price);
    const priceOk = !props.priceTouched || !props.paid || cents !== undefined;
    return <Dialog id='nmx-plugin-upload-title' title={t(locale, 'uploadTitle')} onClose={props.onCancel} busy={props.busy} closeLabel={t(locale, 'close')}
        className='nmx-plugin-upload-dialog'
        footer={<>
            <button type='button' onClick={props.onCancel} disabled={props.busy}>{t(locale, 'cancel')}</button>
            {props.signedIn ? <button type='button' className='is-primary' disabled={props.busy || !props.fileName || !priceOk} onClick={props.onUpload}>
                {props.busy && <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}{props.busy ? t(locale, 'uploadingMarket') : t(locale, 'uploadSubmit')}</button>
                : <button type='button' className='is-primary' onClick={props.onSignIn}>{t(locale, 'signIn')}</button>}
        </>}>
        {!props.signedIn && <p className='nmx-plugin-upload-login'><i className='codicon codicon-account' aria-hidden='true'></i>{t(locale, 'loginToUpload')}</p>}
        <AppPluginFormats locale={locale} />
        <div className='nmx-plugin-upload-field'>
            <span>{t(locale, 'uploadFile')}</span>
            <button type='button' className={`nmx-plugin-upload-file ${props.fileName ? 'has-file' : ''}`} disabled={props.busy} onClick={props.onChooseFile} autoFocus={!props.fileName}>
                <i className={`codicon codicon-${props.fileName ? 'package' : 'cloud-upload'}`} aria-hidden='true'></i>
                <b data-nmx-literal={props.fileName ? true : undefined}>{props.fileName || t(locale, 'upload')}</b>
            </button>
        </div>
        <label className='nmx-plugin-upload-field'>
            <span>{t(locale, 'uploadAuthor')}</span>
            <ImeInput value={props.author} maxLength={80} disabled={props.busy} onChange={event => props.onAuthor(event.currentTarget.value)} />
            <small>{t(locale, 'uploadAuthorHint')}</small>
        </label>
        <div className='nmx-plugin-upload-field'>
            <span>{t(locale, 'priceLabel')}</span>
            <div className='nmx-plugin-upload-price'>
                <div className='nmx-plugin-upload-segment' role='radiogroup' aria-label={t(locale, 'priceLabel')}>
                    {([false, true] as const).map(paid => <button key={String(paid)} type='button' role='radio' aria-checked={props.priceTouched && props.paid === paid} className={props.priceTouched && props.paid === paid ? 'is-selected' : ''}
                        disabled={props.busy} onClick={() => props.onPaid(paid)}>{t(locale, paid ? 'pricePaid' : 'priceFree')}</button>)}
                </div>
                {props.priceTouched && props.paid && <label className={`nmx-plugin-upload-amount ${priceOk ? '' : 'is-invalid'}`}><span aria-hidden='true'>$</span>
                    <ImeInput inputMode='decimal' value={props.price} maxLength={7} placeholder='4.99' disabled={props.busy} aria-label={t(locale, 'priceLabel')}
                        onChange={event => props.onPrice(event.currentTarget.value.replace(/[^\d.]/g, ''))} /></label>}
            </div>
            {!props.priceTouched ? <small>{t(locale, 'priceKeep')}</small>
                : props.paid && <small className={priceOk ? '' : 'is-error'}>{priceOk && cents !== undefined
                ? t(locale, 'priceHint', { net: usd(locale, cents - Math.round(cents * APP_PLUGIN_PRICE.feeBps / 10_000)) }) : t(locale, 'priceInvalid')}</small>}
            {props.priceTouched && props.paid && <p className='nmx-plugin-upload-piracy' role='note'>
                <i className='codicon codicon-warning' aria-hidden='true'></i><span>{t(locale, 'piracyNotice')}</span></p>}
        </div>
        {props.error && <p className='nmx-project-delete-error' role='alert' data-nmx-literal>{props.error}</p>}
    </Dialog>;
}

/** "4.99" → 499 cents when it is a valid plugin price ($0.99–$999.99, at most two decimals). */
export function appPluginPriceCents(value: string): number | undefined {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(value.trim())) return undefined;
    const cents = Math.round(Number(value) * 100);
    return cents >= APP_PLUGIN_PRICE.minCents && cents <= APP_PLUGIN_PRICE.maxCents ? cents : undefined;
}

/** 购买: the price, the balance it comes from, and pay / top up (a paid plugin is only downloaded after payment). */
export function AppPluginBuyDialog(props: {
    readonly locale: Locale; readonly plugin: AppPluginMarketPlugin; readonly balanceMicros?: number; readonly signedIn: boolean; readonly busy: boolean; readonly error: string;
    onPay(): void; onTopUp(): void; onSignIn(): void; onCancel(): void;
}): React.ReactElement {
    const { locale, plugin } = props;
    const price = usd(locale, plugin.priceCents);
    const short = props.balanceMicros !== undefined && props.balanceMicros < plugin.priceCents * 10_000;
    return <Dialog id='nmx-plugin-buy-title' title={t(locale, 'buyTitle', { name: pick(plugin.name, locale) || plugin.id })} onClose={props.onCancel} busy={props.busy}
        closeLabel={t(locale, 'close')} className='nmx-plugin-buy-dialog'
        footer={<>
            <button type='button' onClick={props.onCancel} disabled={props.busy}>{t(locale, 'cancel')}</button>
            {!props.signedIn ? <button type='button' className='is-primary' onClick={props.onSignIn}>{t(locale, 'signIn')}</button>
                : short ? <button type='button' className='is-primary' onClick={props.onTopUp}>{t(locale, 'topUp')}</button>
                    : <button type='button' className='is-primary' disabled={props.busy} autoFocus onClick={props.onPay}>
                        {props.busy && <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}{props.busy ? t(locale, 'paying') : t(locale, 'pay', { price })}</button>}
        </>}>
        <div className='nmx-plugin-install-head'>
            <PluginIcon size={48} />
            <div><strong data-nmx-literal>{pick(plugin.name, locale) || plugin.id}</strong>
                <span data-nmx-literal>{plugin.latestVersion ? `v${plugin.latestVersion} · ` : ''}{t(locale, 'by', { name: plugin.author.name })}</span></div>
            <b className='nmx-plugin-buy-price' data-nmx-literal>{price}</b>
        </div>
        <p className='nmx-plugin-description'>{props.signedIn ? t(locale, 'buyLead', { price }) : t(locale, 'loginToBuy')}</p>
        {props.signedIn && props.balanceMicros !== undefined && <p className={`nmx-plugin-buy-balance ${short ? 'is-short' : ''}`} data-nmx-literal>
            {t(locale, 'buyBalance', { balance: usd(locale, Math.floor(props.balanceMicros / 10_000)) })}{short ? ` · ${t(locale, 'buyInsufficient')}` : ''}</p>}
        {props.error && <p className='nmx-project-delete-error' role='alert' data-nmx-literal>{props.error}</p>}
    </Dialog>;
}

/** Settings → 技能插件. */
export function AppPluginsSettings(props: AppPluginsSettingsProps): React.ReactElement {
    const { locale } = props;
    const [filter, setFilter] = React.useState('');
    const [modal, setModal] = React.useState<{ id: string; kind: 'options' | 'details'; host?: HTMLElement }>();
    const modalPlugin = props.plugins.find(plugin => plugin.id === modal?.id);
    const words = filter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const shown = !words.length ? props.plugins : props.plugins.filter(plugin => {
        const summary = plugin.summary;
        const text = [plugin.id, summary?.name, summary?.description, summary?.author.name, ...(summary?.apps || []).map(app => `${app.bundleId || ''} ${app.program || ''} ${app.title || ''}`)]
            .filter(Boolean).join('\n').toLocaleLowerCase();
        return words.every(word => text.includes(word));
    });
    return <section className='nmx-settings-panel nmx-plugins-settings'>
        <div className='nmx-plugins-tabs' role='tablist'>
            {(['installed', 'market', 'mine'] as const).map(tab => <button key={tab} type='button' role='tab' aria-selected={props.tab === tab} className={props.tab === tab ? 'is-selected' : ''}
                onClick={() => props.onTab(tab)}>{t(locale, tab === 'installed' ? 'tabInstalled' : tab === 'market' ? 'tabMarket' : 'tabMine')}{tab === 'installed' && props.plugins.length > 0 && <small>{props.plugins.length}</small>}</button>)}
        </div>
        {props.tab === 'market' ? <><div className='nmx-plugins-lead'><p>{t(locale, 'lead')}</p><div className='nmx-plugins-toolbar'>
            <button type='button' className='is-link' onClick={props.onMineUpload}><i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{t(locale, 'publish')}</button>
            <button type='button' className='is-link' onClick={props.onOpenDocs}><i className='codicon codicon-book' aria-hidden='true'></i>{t(locale, 'docs')}</button></div></div>
            <AppPluginMarket {...props} /></> : props.tab === 'mine' ? <><div className='nmx-plugins-lead'><p>{t(locale, 'mineLead')}</p><div className='nmx-plugins-toolbar'>
            <button type='button' className='is-primary' onClick={props.onMineUpload}><i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{t(locale, 'mineUpload')}</button>
            <button type='button' disabled={props.mine.loading} onClick={props.onMineRefresh}><i className={`codicon codicon-${props.mine.loading ? 'loading codicon-modifier-spin' : 'refresh'}`} aria-hidden='true'></i>{t(locale, 'mineRefresh')}</button>
            <button type='button' onClick={props.onMineEarnings}><i className='codicon codicon-credit-card' aria-hidden='true'></i>{t(locale, 'mineEarnings')}</button>
            <button type='button' className='is-link' onClick={props.onOpenDocs}><i className='codicon codicon-book' aria-hidden='true'></i>{t(locale, 'docs')}</button></div></div>
            <AppPluginMinePanel {...props} /></> : <>
        <div className='nmx-plugins-lead'>
            <p>{t(locale, 'lead')}</p>
            <div className='nmx-plugins-toolbar'>
                <button type='button' className='is-primary' disabled={props.busy === 'upload' || props.busy === 'folder'} onClick={props.onLoadLocal}>
                    <i className={`codicon codicon-${props.busy === 'upload' || props.busy === 'folder' ? 'loading codicon-modifier-spin' : 'folder-opened'}`} aria-hidden='true'></i>{t(locale, 'loadLocal')}</button>
                <button type='button' className='is-link' onClick={props.onOpenDocs}><i className='codicon codicon-book' aria-hidden='true'></i>{t(locale, 'docs')}</button>
            </div>
        </div>
        {props.plugins.length > 0 && <div className='nmx-plugin-market-search is-local' role='search'>
            <i className='codicon codicon-search' aria-hidden='true'></i>
            <ImeInput type='search' value={filter} maxLength={200} placeholder={t(locale, 'installedSearch')} aria-label={t(locale, 'installedSearch')}
                onChange={event => setFilter(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Escape' && filter) { event.stopPropagation(); setFilter(''); } }} />
        </div>}
        {props.error && <div className='nmx-settings-inline-error' role='alert' data-nmx-literal>{props.error}</div>}
        {props.loading && !props.plugins.length ? <div className='nmx-plugins-empty'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{t(locale, 'loading')}</div>
            : !props.plugins.length ? <div className='nmx-plugins-empty'>
                <i className='codicon codicon-extensions' aria-hidden='true'></i>
                <strong>{t(locale, 'empty')}</strong><span>{t(locale, 'loadModelNote')}</span>
            </div>
                : !shown.length ? <div className='nmx-plugins-empty'><i className='codicon codicon-search' aria-hidden='true'></i><strong>{t(locale, 'installedNoMatch')}</strong></div>
                : <ul className='nmx-plugin-list'>{shown.map(plugin => {
                    const status = statusOf(plugin);
                    const summary = plugin.summary;
                    const busy = props.busy === plugin.id;
                    return <li key={plugin.id} className='nmx-plugin-card'>
                        <div className='nmx-plugin-card-main'>
                            <PluginIcon icon={plugin.icon} />
                            <div className='nmx-plugin-card-text'>
                                <div className='nmx-plugin-card-title'>
                                    <strong data-nmx-literal>{summary?.name || plugin.id}</strong>
                                    {summary && <span className='nmx-plugin-version' data-nmx-literal>v{summary.version}</span>}
                                    <span className={`nmx-plugin-status ${status.tone}`}>{t(locale, status.key)}</span>
                                    {plugin.dev ? <span className='nmx-plugin-status is-dev'>{t(locale, 'dev')}</span>
                                        : (() => { const trust = appPluginTrustBadge(plugin); return <span className={`nmx-plugin-status ${trust.tone}`} title={t(locale, trust.hint)}><i className={`codicon codicon-${trust.icon}`} aria-hidden='true'></i>{t(locale, trust.label)}</span>; })()}
                                </div>
                                {summary && <p className='nmx-plugin-meta' data-nmx-literal>{t(locale, 'by', { name: summary.author.name })} · {summary.apps.map(app => app.platform === 'macos' ? app.bundleId : app.program).join(', ')}</p>}
                                {summary ? <PluginDescription text={summary.description} />
                                    : <PluginDescription className='nmx-plugin-description is-error' text={appPluginDiagnostics(locale, plugin).slice(0, 3).join(' · ')} />}
                            </div>
                        </div>
                        <div className='nmx-plugin-card-actions'>
                            <button type='button' className='nmx-plugin-card-options' aria-haspopup='dialog' onClick={event => setModal({ id: plugin.id, kind: 'options', host: pluginDialogHost(event.currentTarget) })}>
                                <i className='codicon codicon-settings' aria-hidden='true' />{appPluginOptionsText(locale, 'options')}</button>
                            <button type='button' className='nmx-plugin-card-details' aria-haspopup='dialog' onClick={event => setModal({ id: plugin.id, kind: 'details', host: pluginDialogHost(event.currentTarget) })}>
                                <i className='codicon codicon-info' aria-hidden='true' />{t(locale, 'details')}</button>
                            {plugin.dev && <button type='button' disabled={busy} onClick={() => props.onReload(plugin.id)}><i className='codicon codicon-refresh' aria-hidden='true'></i>{t(locale, 'reload')}</button>}
                            <button type='button' className='is-danger-text' disabled={busy || Boolean(plugin.running?.length)} onClick={() => props.onUninstall(plugin.id)}><i className='codicon codicon-trash' aria-hidden='true'></i>{t(locale, 'uninstall')}</button>
                        </div>
                    </li>;
                })}</ul>}
        </>}
        {modal && modalPlugin && <AppPluginOptionsModal {...props} plugin={modalPlugin} kind={modal.kind} portalHost={modal.host}
            onClose={() => setModal(undefined)} onChooseModel={id => { setModal(undefined); props.onChooseModel(id); }} />}
        <SurfaceTooltips scope='.nmx-plugins-settings .nmx-plugin-description[data-help]' />
    </section>;
}

/**
 * Where an installed card's dialog draws: the app shell around it, so the theme and design tokens still apply while the
 * settings page's own section, label and control rules (meant for its cards) never reach into the dialog. A page without
 * the shell (server rendering, a bare test page) draws the dialog in place.
 */
function pluginDialogHost(from: Element | null | undefined): HTMLElement | undefined {
    return from?.closest<HTMLElement>('.nmx-shell') || undefined;
}

/** Installed-card dialogs never dispatch a start/stop command. Tab controls retain those actions. */
export function AppPluginOptionsModal(props: AppPluginsSettingsProps & {
    plugin: AppPluginInfo; kind: 'options' | 'details'; onClose(): void;
    /** The app shell to draw into (see pluginDialogHost); without it the dialog draws in place. */
    readonly portalHost?: HTMLElement;
}): React.ReactElement {
    const { plugin, locale, kind } = props;
    const summary = plugin.summary;
    const panel = React.useRef<HTMLElement>(null);
    const titleId = React.useId();
    React.useLayoutEffect(() => {
        const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        panel.current?.focus({ preventScroll: true });
        return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
    }, []);
    const tests = props.testResults[plugin.id];
    // A press on the backdrop closes the dialog; its default focus change is cancelled so the focus handed back to the
    // button that opened the dialog stays there.
    const dialog = <div className='nmx-plugin-modal-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); props.onClose(); } }}>
        <section ref={panel} tabIndex={-1} className={`nmx-plugin-modal is-${kind}`} role='dialog' aria-modal='true' aria-labelledby={titleId}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onClose(); }
                if (event.key !== 'Tab') return;
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(item => item.getClientRects().length);
                const first = items[0], last = items[items.length - 1];
                if (!first) { event.preventDefault(); return; }
                if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
            }}>
            <header className='nmx-plugin-modal-header'>
                <span className='nmx-plugin-modal-icon'><PluginIcon icon={plugin.icon} /></span>
                <div className='nmx-plugin-modal-titles'><h2 id={titleId} data-nmx-literal>{summary?.name || plugin.id}</h2>
                    <p data-nmx-literal>{[summary?.version ? `v${summary.version}` : '', summary?.author.name].filter(Boolean).join(' · ')}</p></div>
                <button type='button' className='nmx-plugin-modal-close' aria-label={t(locale, 'close')} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true' /></button>
            </header>
            <div className='nmx-plugin-modal-body'>
                {kind === 'options' ? <>
                    {/* Three cards in the order a run uses them: who decides, how it is set up, what it can be asked to do. */}
                    {summary?.decisions.length ? <section className='nmx-plugin-options-section is-model' aria-labelledby={`${titleId}-model`}>
                        <h4 id={`${titleId}-model`}><i className='codicon codicon-sparkle' aria-hidden='true' />{t(locale, 'model')}</h4>
                        <div className='nmx-plugin-model'>
                            <b data-nmx-literal title={modelLabel(plugin.model, locale)} className={plugin.model ? undefined : 'is-empty'}>{modelLabel(plugin.model, locale)}</b>
                            <button type='button' onClick={() => props.onChooseModel(plugin.id)}>{t(locale, 'chooseModel')}</button>
                        </div>
                    </section> : null}
                    <section className='nmx-plugin-options-section is-params' aria-labelledby={`${titleId}-params`}>
                        <h4 id={`${titleId}-params`}><i className='codicon codicon-settings' aria-hidden='true' />{appPluginOptionsText(locale, 'parameters')}</h4>
                        {summary?.params?.length ? <AppPluginParamsBar locale={locale} plugin={plugin} layout='form' onConfigureParams={props.onConfigureParams} onPickParamFile={props.onPickParamFile} /> : <p className='nmx-plugin-muted'>{appPluginOptionsText(locale, 'noOptions')}</p>}
                    </section>
                    <section className='nmx-plugin-options-section is-presets nmx-plugin-presets' aria-labelledby={`${titleId}-presets`}>
                        <h4 id={`${titleId}-presets`}><i className='codicon codicon-target' aria-hidden='true' />{appPluginOptionsText(locale, 'presets')}</h4>
                        <AppPluginPresetChoices locale={locale} plugin={plugin} appName={summary?.name || plugin.id} />
                    </section>
                </> : <div className='nmx-plugin-details'>
                    {summary && <><p data-nmx-literal>{summary.description}</p>
                        <dl className='nmx-plugin-facts'>
                            <div><dt>ID</dt><dd data-nmx-literal>{plugin.id}</dd></div>
                            <div><dt>{appPluginOptionsText(locale, 'license')}</dt><dd data-nmx-literal>{summary.license || '—'}</dd></div>
                            <div><dt>{appPluginOptionsText(locale, 'homepage')}</dt><dd data-nmx-literal>{summary.homepage || '—'}</dd></div>
                        </dl>
                        <details className='nmx-plugin-manifest'><summary>{appPluginOptionsText(locale, 'manifest')}</summary><pre className='nmx-plugin-readme' data-nmx-literal>{JSON.stringify(summary, null, 2)}</pre></details>
                        <h3>{appPluginOptionsText(locale, 'permissions')}</h3><Facts summary={summary} locale={locale} />
                        <p>{t(locale, 'safety')}</p>
                        {summary.risk.includes('account-ban') && <p className='nmx-plugin-risk'><i className='codicon codicon-warning' aria-hidden='true'></i>{t(locale, 'risk')}</p>}
                        <div className='nmx-plugin-rules' data-nmx-literal>
                            {summary.reflexes.length > 0 && <section><h4>{t(locale, 'reflexesTitle')}</h4><ul>{summary.reflexes.map((reflex, index) => <li key={index}><code>{reflex.when}</code> → <b>{reflex.do}</b></li>)}</ul></section>}
                            {summary.decisions.length > 0 && <section><h4>{t(locale, 'decisionsTitle')}</h4><ul>{summary.decisions.map(decision => <li key={decision.id}><b>{decision.id}</b> <small>{decision.type}</small> {decision.question}</li>)}</ul></section>}
                            {summary.events.length > 0 && <section><h4>{t(locale, 'eventsTitle')}</h4><ul>{summary.events.map(event => <li key={event.id}><b>{event.id}</b> {event.message}</li>)}</ul></section>}
                        </div></>}
                    {!plugin.ok && <p role='status' data-nmx-literal>{appPluginDiagnostics(locale, plugin).join(' · ')}</p>}
                    <h3>{t(locale, 'loadDocs')}</h3>
                    {plugin.readme && <pre className='nmx-plugin-readme' data-nmx-literal>{plugin.readme}</pre>}
                    <button type='button' onClick={props.onOpenDocs}>{t(locale, 'docs')}</button>
                    {plugin.dev && <p className='nmx-plugin-folder' data-nmx-literal>{plugin.folder}</p>}
                    {plugin.ok && Boolean(plugin.tests) && <button type='button' disabled={props.busy === plugin.id} onClick={() => props.onTest(plugin.id)}>{t(locale, 'runTests')}</button>}
                    {tests && <div className={`nmx-plugin-tests ${tests.ok && tests.results?.every(item => item.ok) ? 'is-ok' : 'is-failed'}`} role='status'>{tests.results ? <>
                        <strong>{t(locale, 'testsResult', { passed: tests.results.filter(item => item.ok).length, total: tests.results.length })}</strong>
                        <ul>{tests.results.filter(item => !item.ok).map(item => <li key={item.name} data-nmx-literal>{item.defaultName ? appPluginReplayName(locale) : item.name}: {appPluginDiagnostics(locale, item).join('；')}</li>)}</ul>
                    </> : appPluginDiagnostics(locale, tests).join(' · ')}</div>}
                </div>}
            </div>
            <footer className='nmx-plugin-modal-footer'><button type='button' onClick={props.onClose}>{t(locale, 'close')}</button></footer>
        </section>
    </div>;
    return props.portalHost ? createPortal(dialog, props.portalHost) : dialog;
}

function AppPluginFormats({ locale }: { locale: Locale }): React.ReactElement {
    return <ul className='nmx-plugin-formats'>
        <li><code>.nmxplugin</code></li><li><code>.zip</code></li><li><code>.tar.gz</code> / <code>.tgz</code></li><li><code>.jevplugin</code></li>
        <li><code>plugin.json</code> / <code>manifest.json</code></li><li>{t(locale, 'loadFolderButton')}</li>
    </ul>;
}

/**
 * 加载本地插件: what a plugin is (plugin.json + PNG pictures, no code) and the two ways to load one — a .nmxplugin file
 * (a zip of the plugin folder) or the folder itself (reloadable while writing it).
 */
export function AppPluginLoadDialog(props: {
    readonly locale: Locale; readonly busy: string; onPickFile(): void; onPickFolder(): void; onOpenDocs(): void; onClose(): void;
}): React.ReactElement {
    const { locale } = props;
    const busy = props.busy === 'upload' || props.busy === 'folder';
    return <Dialog id='nmx-plugin-load-title' title={t(locale, 'loadLocal')} onClose={props.onClose} busy={busy} closeLabel={t(locale, 'close')} className='nmx-plugin-load-dialog'
        footer={<>
            <button type='button' className='is-link' onClick={props.onOpenDocs}><i className='codicon codicon-book' aria-hidden='true'></i>{t(locale, 'loadDocs')}</button>
            <button type='button' onClick={props.onClose} disabled={busy}>{t(locale, 'cancel')}</button>
        </>}>
        <p className='nmx-plugin-load-lead'>{t(locale, 'loadLead')}</p>
        <div className='nmx-plugin-load-options'>
            <section>
                <span className='nmx-plugin-load-icon' aria-hidden='true'><i className='codicon codicon-package'></i></span>
                <div><strong>{t(locale, 'uploadFile')}</strong><AppPluginFormats locale={locale} /></div>
                <button type='button' className='is-primary' disabled={busy} autoFocus onClick={props.onPickFile}>
                    {props.busy === 'upload' && <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}{t(locale, 'loadFileButton')}</button>
            </section>
            <section>
                <span className='nmx-plugin-load-icon' aria-hidden='true'><i className='codicon codicon-folder'></i></span>
                <div><strong>{t(locale, 'loadFolderTitle')}</strong><p>{t(locale, 'loadFolderText')}</p>
                    <pre data-nmx-literal>{'my-plugin/\n├─ plugin.json\n├─ README.md\n├─ icon.png\n├─ templates/*.png\n├─ examples/*.png\n└─ tests/*.json'}</pre></div>
                <button type='button' disabled={busy} onClick={props.onPickFolder}>
                    {props.busy === 'folder' && <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}{t(locale, 'loadFolderButton')}</button>
            </section>
        </div>
        <p className='nmx-plugin-load-note'><i className='codicon codicon-info' aria-hidden='true'></i>{t(locale, 'loadModelNote')}</p>
    </Dialog>;
}

/** Dialog frame shared by the plugin dialogs (the app's sheet style). */
function Dialog(props: { readonly id: string; readonly title: string; readonly onClose: () => void; readonly busy?: boolean; readonly className?: string;
    readonly children: React.ReactNode; readonly footer: React.ReactNode; readonly closeLabel: string }): React.ReactElement {
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop' onMouseDown={() => { if (!props.busy) props.onClose(); }}>
        <section className={`nmx-thread-dialog nmx-plugin-dialog ${props.className || ''}`} role='dialog' aria-modal='true' aria-labelledby={props.id} aria-busy={props.busy}
            onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape' && !props.busy) { event.stopPropagation(); props.onClose(); } }}>
            <header><h2 id={props.id} data-nmx-literal>{props.title}</h2><button type='button' aria-label={props.closeLabel} disabled={props.busy} onClick={props.onClose}>×</button></header>
            <div className='nmx-plugin-dialog-body'>{props.children}</div>
            <footer>{props.footer}</footer>
        </section>
    </div>;
}

/** What will be installed: who made it, what it controls, and the risks, before anything is written. */
export function AppPluginInstallDialog(props: { readonly locale: Locale; readonly inspection: AppPluginInspection; readonly busy: boolean; readonly error: string;
    onCancel(): void; onInstall(): void }): React.ReactElement {
    const { locale, inspection } = props;
    const summary = inspection.summary;
    const update = Boolean(inspection.installedVersion);
    return <Dialog id='nmx-plugin-install-title' title={inspection.ok ? t(locale, update ? 'updateTitle' : 'installTitle') : t(locale, 'invalid')} onClose={props.onCancel} busy={props.busy}
        closeLabel={t(locale, 'close')} className='nmx-plugin-install-dialog'
        footer={<>
            <button type='button' autoFocus onClick={props.onCancel} disabled={props.busy}>{t(locale, 'cancel')}</button>
            {inspection.ok && <button type='button' className='is-primary' disabled={props.busy} onClick={props.onInstall}>{props.busy ? t(locale, 'installing') : t(locale, 'install')}</button>}
        </>}>
        {inspection.ok && summary ? <>
            <div className='nmx-plugin-install-head'>
                <PluginIcon icon={inspection.icon} size={48} />
                <div>
                    <strong data-nmx-literal>{summary.name}</strong>
                    <span data-nmx-literal>v{summary.version} · {t(locale, 'by', { name: summary.author.name })}</span>
                    {inspection.file && <small data-nmx-literal>{t(locale, 'fromFile', { file: inspection.file })}</small>}
                </div>
            </div>
            <p className='nmx-plugin-description' data-nmx-literal>{summary.description}</p>
            {update && <p className={`nmx-plugin-update ${inspection.downgrade ? 'is-warning' : ''}`}>{inspection.downgrade
                ? t(locale, 'downgrade', { from: inspection.installedVersion || '' }) : t(locale, 'updateFrom', { from: inspection.installedVersion || '', to: summary.version })}</p>}
            <Facts summary={summary} locale={locale} />
            {summary.risk.includes('account-ban') && <p className='nmx-plugin-risk'><i className='codicon codicon-warning' aria-hidden='true'></i>{t(locale, 'risk')}</p>}
            <p className='nmx-plugin-safety'><i className='codicon codicon-shield' aria-hidden='true'></i>{t(locale, 'safety')}</p>
            {(() => { const trust = appPluginTrustBadge(inspection); return <p className={`nmx-plugin-origin ${trust.tone === 'is-ok' ? 'is-verified' : ''}`}>
                <i className={`codicon codicon-${trust.icon}`} aria-hidden='true'></i>{t(locale, trust.hint)}</p>; })()}
        </> : <ul className='nmx-plugin-errors' data-nmx-literal>{appPluginDiagnostics(locale, inspection).slice(0, 20).map((error, index) => <li key={index}>{error}</li>)}</ul>}
        {props.error && <p className='nmx-project-delete-error' role='alert' data-nmx-literal>{props.error}</p>}
    </Dialog>;
}

export function AppPluginUninstallDialog(props: { readonly locale: Locale; readonly plugin: AppPluginInfo; readonly busy: boolean; readonly bin: string; onCancel(): void; onConfirm(): void }): React.ReactElement {
    const { locale, plugin } = props;
    return <Dialog id='nmx-plugin-uninstall-title' title={t(locale, 'uninstallTitle', { name: plugin.summary?.name || plugin.id })} onClose={props.onCancel} busy={props.busy} closeLabel={t(locale, 'close')}
        footer={<><button type='button' autoFocus disabled={props.busy} onClick={props.onCancel}>{t(locale, 'cancel')}</button>
            <button type='button' className='is-danger' disabled={props.busy} onClick={props.onConfirm}>{t(locale, 'uninstall')}</button></>}>
        <p>{plugin.dev ? t(locale, 'uninstallDev') : t(locale, 'uninstallHint', { bin: props.bin })}</p>
    </Dialog>;
}

/** The decision model (and, for plugins that must see, a vision model) for one plugin. */
const formatPrice = (value: number): string => value >= 1 ? value.toFixed(2) : value >= 0.01 ? value.toFixed(3) : String(Number(value.toPrecision(2)));
const OTHER = '__other__';

/**
 * Where a plugin's decision model runs, chosen with dropdowns: a relay merchant on the platform (and which one),
 * an own API connection that has decision models, or a server on this computer (Ollama, a decision server, an
 * OpenAI-compatible chat server) found by scanning the usual ports or typed in. Only what the chosen source really
 * offers is listed; nothing names a provider by default.
 */
export function AppPluginModelDialog(props: {
    readonly locale: Locale; readonly plugin: AppPluginInfo; readonly choices?: AppPluginModelChoices; readonly loading: boolean; readonly busy: boolean; readonly error: string;
    onProbe(endpoint: string): Promise<AppPluginServerProbe>; onRescan(): void; onSave(model: AppPluginModel, vision: AppPluginVisionModel | null): void; onCancel(): void;
}): React.ReactElement {
    const { locale, plugin, choices } = props;
    const current = plugin.model;
    const relays = choices?.relays || [];
    const connections = (choices?.connections || []).filter(item => item.decisions.length);
    const [probed, setProbed] = React.useState<AppPluginLocalServer[]>([]);
    const servers = [...(choices?.local || []), ...probed.filter(server => !(choices?.local || []).some(item => item.endpoint === server.endpoint))];
    const [source, setSource] = React.useState<AppPluginModel['source']>(current?.source || 'nextmux');
    // Nothing chosen yet and no relay offers a decision model (signed out, or none sells one): start on the person's
    // own API or a server on this computer instead of an empty relay list.
    const sourceTouched = React.useRef(Boolean(current));
    React.useEffect(() => {
        if (sourceTouched.current || !choices || source !== 'nextmux' || relays.length) return;
        if (connections.length) setSource('connection');
        else if ((choices.local || []).length) setSource('local');
    }, [choices, relays.length, connections.length, source]);
    // 中转商
    const merchants = [...new Map(relays.flatMap(model => model.routes.map(route => [route.merchant || route.offeringId, route.merchant || route.offeringId] as const))).values()];
    const [merchant, setMerchant] = React.useState(current?.source === 'nextmux' ? current.merchant || '' : '');
    const relayModels = relays.filter(model => !merchant || model.routes.some(route => (route.merchant || route.offeringId) === merchant));
    const [relayModel, setRelayModel] = React.useState(current?.source === 'nextmux' ? current.model : '');
    const relay = relayModels.find(model => model.model === relayModel) || relayModels[0];
    const route = relay && (merchant ? relay.routes.find(item => (item.merchant || item.offeringId) === merchant) : relay.routes[0]);
    // 自有 API
    const [connectionId, setConnectionId] = React.useState(current?.source === 'connection' ? current.connectionId || '' : '');
    const connection = connections.find(item => item.connectionId === connectionId) || connections[0];
    const [connectionModel, setConnectionModel] = React.useState(current?.source === 'connection' ? current.model : '');
    const ownModel = connection && (connection.decisions.find(model => model.model === connectionModel) || connection.decisions[0]);
    // 本机
    const [endpoint, setEndpoint] = React.useState(current?.source === 'local' ? current.endpoint || '' : '');
    const [typed, setTyped] = React.useState(current?.source === 'local' ? current.endpoint || '' : 'http://127.0.0.1:');
    const [localModel, setLocalModel] = React.useState(current?.source === 'local' ? current.model : '');
    const [probing, setProbing] = React.useState(false);
    const [probeFailed, setProbeFailed] = React.useState(false);
    const server = servers.find(item => item.endpoint === endpoint) || (endpoint === OTHER ? undefined : servers[0]);
    const localPick = server && (server.models.find(model => model.model === localModel) || server.models[0]);
    const [images, setImages] = React.useState(current?.source === 'local' ? Boolean(current.images) : false);
    const localImages = !isTevDecisionModel(localPick?.model || '') && (server?.protocol === 'systemone' ? images : Boolean(localPick?.images));
    const decision: AppPluginModel | undefined = source === 'nextmux'
        ? relay && route ? { source: 'nextmux', model: relay.model, label: relay.label, inputPricePerMillion: route.inputPricePerMillion,
            ...(merchant ? { offeringId: route.offeringId, merchant: route.merchant } : {}), ...(relay.images ? { images: true } : {}) } : undefined
        : source === 'connection'
            ? connection && ownModel ? { source: 'connection', ...ownModel, model: ownModel.model, label: ownModel.label, connectionId: connection.connectionId, connectionLabel: connection.label } : undefined
            : server && localPick ? { source: 'local', model: localPick.model, endpoint: server.endpoint, protocol: server.protocol, images: localImages } : undefined;
    // 视觉模型 (only when the plugin must see and the decision model can't)
    const vision = plugin.summary?.vision || 'none';
    const seesItself = Boolean(decision?.images);
    const visionConnections = (choices?.connections || []).filter(item => item.vision.length);
    const visionServers = servers.filter(item => item.protocol !== 'systemone' && item.models.some(model => model.images));
    const [visionSource, setVisionSource] = React.useState<AppPluginVisionModel['source']>(plugin.vision?.source || (visionConnections.length || !visionServers.length ? 'connection' : 'local'));
    const [visionPlace, setVisionPlace] = React.useState(plugin.vision?.source === 'connection' ? plugin.vision.connectionId || '' : plugin.vision?.endpoint || '');
    const [visionName, setVisionName] = React.useState(plugin.vision?.model || '');
    const visionConnection = visionConnections.find(item => item.connectionId === visionPlace) || visionConnections[0];
    const visionServer = visionServers.find(item => item.endpoint === visionPlace) || visionServers[0];
    const visionList = visionSource === 'connection' ? visionConnection?.vision || [] : (visionServer?.models || []).filter(model => model.images);
    // Never a default: a vision model runs every few seconds, and the first one listed may be an expensive one.
    const visionPick = visionList.find(model => model.model === visionName);
    const visionNone = { value: '', label: t(locale, vision === 'required' ? 'chooseModel' : 'sightNone') };
    const visionValue: AppPluginVisionModel | null = vision === 'none' || seesItself || !visionPick ? null
        : visionSource === 'connection' && visionConnection ? { ...visionPick, source: 'connection', model: visionPick.model, connectionId: visionConnection.connectionId, connectionLabel: visionConnection.label }
            : visionSource === 'local' && visionServer ? { source: 'local', model: visionPick.model, endpoint: visionServer.endpoint, protocol: visionServer.protocol === 'ollama' ? 'ollama' : 'openai' } : null;
    const needsVision = vision === 'required' && !seesItself;
    const compatibilityError = decision && decisionPluginCompatibility(decision, plugin.summary?.decisions || []);
    const canSave = Boolean(decision) && !compatibilityError && (!needsVision || Boolean(visionValue)) && !props.busy;
    const probe = async (): Promise<void> => {
        setProbing(true);
        setProbeFailed(false);
        try {
            const result = await props.onProbe(typed.trim());
            if (result.ok && result.server) {
                const found = result.server;
                setProbed(list => [...list.filter(item => item.endpoint !== found.endpoint), found]);
                setEndpoint(found.endpoint);
                setLocalModel(found.models[0]?.model || '');
            } else setProbeFailed(true);
        } finally { setProbing(false); }
    };
    const sourceButton = (value: AppPluginModel['source'], label: string, hint: string) => <button type='button' role='radio' aria-checked={source === value}
        className={`nmx-plugin-source ${source === value ? 'is-selected' : ''}`} onClick={() => { sourceTouched.current = true; setSource(value); }}>
        <strong>{label}</strong><small>{hint}</small></button>;
    const select = (label: string, value: string, options: readonly { readonly value: string; readonly label: string }[], onChange: (value: string) => void) =>
        <label className='nmx-plugin-field'><span>{label}</span>
            <select value={value} onChange={event => onChange(event.currentTarget.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
    // Relays refused for want of an account say so, instead of looking empty (audit A14-10).
    const relaysNeedLogin = (choices?.errors || []).some(error => error.startsWith('nextmux: decision_unauthorized'));
    const empty = (key: 'noRelay' | 'noConnection' | 'noLocal') => <p className='nmx-plugin-muted'>{t(locale, key === 'noRelay' && relaysNeedLogin ? 'relayLogin' : key)}</p>;
    const loading = props.loading && !choices;
    return <Dialog id='nmx-plugin-model-title' title={t(locale, 'modelTitle', { name: plugin.summary?.name || plugin.id })} onClose={props.onCancel} busy={props.busy} closeLabel={t(locale, 'close')}
        className='nmx-plugin-model-dialog'
        footer={<><button type='button' className='nmx-plugin-rescan' disabled={props.loading} onClick={props.onRescan}>
            <i className={`codicon codicon-${props.loading ? 'loading codicon-modifier-spin' : 'refresh'}`} aria-hidden='true'></i>{t(locale, 'rescan')}</button>
            <span className='nmx-plugin-footer-space'></span>
            <button type='button' disabled={props.busy} onClick={props.onCancel}>{t(locale, 'cancel')}</button>
            <button type='button' className='is-primary' disabled={!canSave} onClick={() => decision && props.onSave(decision, visionValue)}>{t(locale, 'save')}</button></>}>
        <p className='nmx-plugin-dialog-lead'>{t(locale, 'modelLead')}</p>
        <div className='nmx-plugin-sources' role='radiogroup' aria-label={t(locale, 'model')}>
            {sourceButton('nextmux', t(locale, 'relay'), t(locale, 'relayHint'))}
            {sourceButton('connection', t(locale, 'ownApi'), t(locale, 'ownApiHint'))}
            {sourceButton('local', t(locale, 'local'), t(locale, 'localHint'))}
        </div>
        {loading ? <p className='nmx-plugin-muted'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{t(locale, 'loading')}</p>
            : source === 'nextmux' ? (relays.length ? <div className='nmx-plugin-pickers'>
                {select(t(locale, 'merchant'), merchant, [{ value: '', label: t(locale, 'anyMerchant') }, ...merchants.map(name => ({ value: name, label: name }))], value => { setMerchant(value); setRelayModel(''); })}
                {select(t(locale, 'modelName'), relay?.model || '', relayModels.map(model => ({ value: model.model, label: model.label })), setRelayModel)}
                {route && <p className='nmx-plugin-price' data-nmx-literal>{route.inputPricePerMillion > 0 ? t(locale, 'price', { price: formatPrice(route.inputPricePerMillion) }) : t(locale, 'free')}</p>}
            </div> : empty('noRelay'))
                : source === 'connection' ? (connections.length ? <div className='nmx-plugin-pickers'>
                    {select(t(locale, 'connection'), connection?.connectionId || '', connections.map(item => ({ value: item.connectionId, label: item.label })), value => { setConnectionId(value); setConnectionModel(''); })}
                    {select(t(locale, 'modelName'), ownModel?.model || '', (connection?.decisions || []).map(model => ({ value: model.model, label: model.label })), setConnectionModel)}
                </div> : empty('noConnection'))
                    : <div className='nmx-plugin-pickers'>
                        {!servers.length && endpoint !== OTHER && empty('noLocal')}
                        {select(t(locale, 'server'), server?.endpoint || OTHER, [...servers.map(item => ({ value: item.endpoint, label: item.name === item.endpoint ? item.endpoint : `${item.name} · ${item.endpoint}` })),
                            { value: OTHER, label: t(locale, 'otherServer') }], value => { setEndpoint(value); setLocalModel(''); setProbeFailed(false); })}
                        {(endpoint === OTHER || !server) && <label className='nmx-plugin-field'><span>{t(locale, 'endpoint')}</span>
                            <div className='nmx-plugin-inline'><ImeInput value={typed} spellCheck={false} maxLength={200} onChange={event => { setTyped(event.currentTarget.value); setProbeFailed(false); }} />
                                <button type='button' disabled={probing || !typed.trim()} onClick={() => void probe()}>{probing ? t(locale, 'loading') : t(locale, 'probe')}</button></div></label>}
                        {probeFailed && <p className='nmx-plugin-muted is-error'>{t(locale, 'probeFailed')}</p>}
                        {server && select(t(locale, 'modelName'), localPick?.model || '', server.models.map(model => ({ value: model.model, label: model.label || model.model })), setLocalModel)}
                        {server && server.protocol !== 'systemone' && <p className='nmx-plugin-muted'>{t(locale, 'chatNote')}</p>}
                        {server?.protocol === 'systemone' ? <label className='nmx-plugin-check'><input type='checkbox' checked={images} onChange={event => setImages(event.currentTarget.checked)} /><span>{t(locale, 'seesImages')}</span></label>
                            : localPick?.images ? <p className='nmx-plugin-muted'>{t(locale, 'seesImagesAuto')}</p> : null}
                    </div>}
        {compatibilityError && <p className='nmx-plugin-muted is-error'>{appPluginError(locale, compatibilityError)}</p>}
        {vision !== 'none' && !seesItself && <div className='nmx-plugin-vision'>
            <h3>{t(locale, 'visionModel')}</h3>
            <p className='nmx-plugin-muted'>{t(locale, 'visionHint')}</p>
            <div className='nmx-segmented' role='radiogroup'>
                {(['connection', 'local'] as const).map(value => <button key={value} type='button' role='radio' aria-checked={visionSource === value} className={visionSource === value ? 'is-selected' : ''}
                    onClick={() => { setVisionSource(value); setVisionPlace(''); setVisionName(''); }}>{value === 'connection' ? t(locale, 'ownApi') : t(locale, 'local')}</button>)}
            </div>
            {visionSource === 'connection'
                ? visionConnections.length ? <>
                    {select(t(locale, 'connection'), visionConnection?.connectionId || '', visionConnections.map(item => ({ value: item.connectionId, label: item.label })), value => { setVisionPlace(value); setVisionName(''); })}
                    {select(t(locale, 'visionModel'), visionPick?.model || '', [visionNone, ...visionList.map(model => ({ value: model.model, label: model.label || model.model }))], setVisionName)}
                </> : <p className='nmx-plugin-muted'>{t(locale, 'noVisionConnection')}</p>
                : visionServers.length ? <>
                    {select(t(locale, 'server'), visionServer?.endpoint || '', visionServers.map(item => ({ value: item.endpoint, label: `${item.name} · ${item.endpoint}` })), value => { setVisionPlace(value); setVisionName(''); })}
                    {select(t(locale, 'visionLocal'), visionPick?.model || '', [visionNone, ...visionList.map(model => ({ value: model.model, label: model.model }))], setVisionName)}
                </> : <p className='nmx-plugin-muted'>{t(locale, 'noVisionLocal')}</p>}
        </div>}
        {choices?.excluded?.map(item => <p className='nmx-plugin-muted' key={`${item.connectionId}:${item.kind}`}>
            <bdi>{item.label}</bdi> · {t(locale, item.kind === 'vision' ? 'kindVision' : 'kindDecision')} · {t(locale, 'protocolExcluded')} (<bdi>{item.protocol}</bdi>)
        </p>)}
        {props.error && <p className='nmx-project-delete-error' role='alert' data-nmx-literal>{props.error}</p>}
    </Dialog>;
}

export interface AppPluginGoalCommand { readonly runId: string; readonly command: 'goal'; readonly goal: string }

export interface AppPluginInlineControlsProps {
    readonly choices?: AppPluginModelChoices;
    readonly modelBusy?: boolean;
    readonly error?: string;
    onSaveModel?(id: string, model: AppPluginModel, vision: AppPluginVisionModel | null): void;
    onChooseModel?(id: string): void;
    onConfigureParams?(id: string, params: Readonly<Record<string, unknown>>): void;
    onPickParamFile?(id: string, paramId: string, label?: string): void;
    onCommand?(command: AppPluginGoalCommand): void;
    onStart?(id: string, goal?: string): void;
}

type InlineModelSource = 'platform' | 'openrouter' | 'local';
const inlineModelSource = (model: AppPluginModel | null | undefined): InlineModelSource =>
    model?.source === 'connection' ? 'openrouter' : model?.source === 'local' ? 'local' : 'platform';
const inlineModelKey = (model: AppPluginModel): string =>
    JSON.stringify([model.source, model.connectionId || '', model.endpoint || '', model.protocol || '', model.offeringId || '', model.model]);
const isJevModel = (model: string): boolean => /(?:^|[\/~_-])jev(?:[\/_-]|$)|^systemone$/i.test(model);

/** Uses the existing platform / connection / local protocol; never saves invented endpoints or API connections. */
export function appPluginInlineModels(choices: AppPluginModelChoices | undefined, current?: AppPluginModel | null): AppPluginModel[] {
    const models: AppPluginModel[] = [];
    for (const model of choices?.relays || []) {
        if (!isJevModel(model.model) || !model.routes.length) continue;
        models.push({ source: 'nextmux', model: model.model, label: model.label,
            inputPricePerMillion: model.routes[0].inputPricePerMillion,
            ...(model.images ? { images: true } : {}) });
    }
    for (const connection of choices?.connections || []) {
        if (!/openrouter/i.test(connection.provider)) continue;
        for (const model of connection.decisions) if (isJevModel(model.model)) models.push({ ...model, source: 'connection',
            connectionId: connection.connectionId, connectionLabel: connection.label });
    }
    for (const server of choices?.local || []) for (const model of server.models) {
        if (server.protocol !== 'systemone' && !isJevModel(model.model)) continue;
        models.push({ source: 'local', model: model.model, label: model.label, endpoint: server.endpoint, protocol: server.protocol,
            ...(model.images ? { images: true } : {}) });
    }
    // Existing merchant selections, probed local endpoints and legacy models remain visible until changed.
    if (current) {
        const index = models.findIndex(model => inlineModelKey(model) === inlineModelKey(current));
        if (index < 0) models.unshift(current);
        else models[index] = current;
    }
    return models;
}

function AppPluginInlineModelBar(props: AppPluginInlineControlsProps & { readonly plugin: AppPluginInfo; readonly locale: Locale; readonly running?: boolean }): React.ReactElement {
    const { plugin, locale } = props;
    const text = (key: Parameters<typeof appPluginOptionsText>[1]): string => appPluginOptionsText(locale, key);
    const current = plugin.model;
    const [source, setSource] = React.useState<InlineModelSource>(inlineModelSource(current));
    React.useEffect(() => setSource(inlineModelSource(current)), [plugin.id, current?.source]);
    const models = appPluginInlineModels(props.choices, current).filter(model => inlineModelSource(model) === source);
    const currentKey = current ? inlineModelKey(current) : '';
    const selected = models.some(model => inlineModelKey(model) === currentKey) ? currentKey : '';
    const compatible = (model: AppPluginModel): boolean => !decisionPluginCompatibility(model, plugin.summary?.decisions || [])
        && (plugin.summary?.vision !== 'required' || Boolean(model.images || plugin.vision));
    const save = (model: AppPluginModel | undefined): void => {
        if (model && compatible(model)) props.onSaveModel?.(plugin.id, model, plugin.vision || null);
    };
    const chooseSource = (value: InlineModelSource): void => {
        setSource(value);
        const candidates = appPluginInlineModels(props.choices, current).filter(model => inlineModelSource(model) === value && compatible(model));
        save(candidates.find(model => inlineModelKey(model) === currentKey) || candidates[0]);
    };
    return <div className='nmx-plugin-inline-model-bar' role='group' aria-label={text('modelBar')}>
        <span className='nmx-plugin-inline-model-title'><i className='codicon codicon-hubot' aria-hidden='true'></i>{text('modelBar')}</span>
        <label className='nmx-plugin-field'><span>{text('modelSource')}</span>
            <select value={source} disabled={props.modelBusy || !props.onSaveModel} onChange={event => chooseSource(event.currentTarget.value as InlineModelSource)}>
                <option value='platform'>{text('sourcePlatform')}</option>
                <option value='openrouter'>{text('sourceOpenRouter')}</option>
                <option value='local'>{text('sourceLocal')}</option>
            </select></label>
        <label className='nmx-plugin-field'><span>{text('jevModel')}</span>
            <select value={selected} disabled={props.modelBusy || !props.onSaveModel || !models.length}
                onChange={event => save(models.find(model => inlineModelKey(model) === event.currentTarget.value))}>
                {!selected && <option value='' disabled>{text('chooseAvailable')}</option>}
                {models.map(model => <option key={inlineModelKey(model)} value={inlineModelKey(model)} disabled={!compatible(model)}>
                    {model.model}{model.source === 'connection' ? ` · ${model.connectionLabel || model.connectionId}`
                        : model.source === 'local' ? ` · ${model.protocol} · ${model.endpoint}` : model.merchant ? ` · ${model.merchant}` : ''}</option>)}
            </select></label>
        <button type='button' disabled={props.modelBusy || !props.onChooseModel} onClick={() => props.onChooseModel?.(plugin.id)}>
            <i className='codicon codicon-settings-gear' aria-hidden='true'></i>{text('moreSettings')}</button>
        {props.running && <small className='nmx-plugin-muted'>{appPluginRuntimeText(locale, 'modelChangesImmediate')}</small>}
        {!models.some(compatible) && <small className='nmx-plugin-muted'>{text('noModelInSource')}</small>}
    </div>;
}

/** Old plugins get three useful goals; explicit manifest presets always take precedence. */
export function appPluginGoalPresets(plugin: AppPluginInfo, appName: string, locale: Locale): readonly AppPluginPreset[] {
    const declared = plugin.presets?.length ? plugin.presets : plugin.summary?.presets;
    if (declared?.length) return declared;
    const zh = locale.startsWith('zh');
    const label = (key: Parameters<typeof appPluginOptionsText>[1]): string => appPluginOptionsText(locale, key);
    const app = appName || plugin.summary?.name || plugin.id;
    const game = /league|wegame|英雄联盟|游戏|game/i.test(app);
    const document = /notepad|textedit|记事本|文本编辑|文档/i.test(app);
    // The goal itself goes to the plugin's decision model and stays editable: Chinese for Chinese, otherwise English.
    const defaults: readonly (readonly [string, string])[] = game ? [
        [label('presetSurvive'), zh ? `在 ${app} 中优先生存，危险时撤退，避免不必要的交战。` : `Prioritize survival in ${app}; retreat from danger and avoid unnecessary fights.`],
        [label('presetGrow'), zh ? `在 ${app} 中安全获取经验和资源，保持稳定发育。` : `Safely gain experience and resources in ${app}.`],
        [label('presetTeam'), zh ? `在 ${app} 中围绕当前团队目标行动，配合队友并关注局势。` : `Work toward the current team objective in ${app} and support teammates.`]
    ] : document ? [
        [label('presetOrganize'), zh ? `整理 ${app} 中当前文档的结构与排版，保留原意。` : `Organize the current document in ${app}, preserving its meaning.`],
        [label('presetReview'), zh ? `检查 ${app} 中当前文本的错字和明显问题，保留原始信息。` : `Review the current text in ${app} for typos and obvious issues, preserving its information.`],
        [label('presetContinueEditing'), zh ? `在 ${app} 中继续当前编辑任务，不确定目标时暂停。` : `Continue the current editing task in ${app}; pause if the objective is unclear.`]
    ] : [
        [label('presetContinue'), zh ? `在 ${app} 中继续当前任务，不确定目标时暂停。` : `Continue the current task in ${app}; pause if the objective is unclear.`],
        [label('presetCarefully'), zh ? `在 ${app} 中稳妥推进当前目标，遇到异常时暂停。` : `Work carefully toward the current objective in ${app}; pause on unexpected conditions.`],
        [label('presetFinish'), zh ? `完成 ${app} 中当前明确的目标，完成后停止。` : `Complete the current explicit objective in ${app}, then stop.`]
    ];
    const examples = (plugin.summary?.goals?.examples || []).filter(value => value.trim()).slice(0, 3)
        .map((goal, index) => ({ id: `example-${index + 1}`, label: goal, goal }));
    return [...examples, ...defaults.map(([label, goal], index) => ({ id: `quick-${index + 1}`, label, goal }))].slice(0, 3);
}

function AppPluginGoalControls(props: AppPluginInlineControlsProps & {
    readonly locale: Locale; readonly plugin: AppPluginInfo; readonly appName: string; readonly activeRun?: AppPluginRunSnapshot; readonly running?: boolean;
    /** Stops this plugin's run from the goal button (插件市场 has no run bar; the run bar passes none, it has its own 停止). */
    onStop?(): void;
}): React.ReactElement {
    const { plugin, activeRun, locale } = props;
    const run = activeRun && !activeRun.ended && activeRun.pluginId === plugin.id ? activeRun : undefined;
    const [goal, setGoal] = React.useState(run?.goal || plugin.summary?.goals?.default || '');
    React.useEffect(() => setGoal(run?.goal || plugin.summary?.goals?.default || ''), [plugin.id, run?.runId, run?.goal]);
    // Starting another plugin is coordinated by the widget: stop the current run before starting this one.
    const canSend = !props.modelBusy && (run ? Boolean(props.onCommand) : Boolean(plugin.ready && props.onStart));
    // While this plugin runs, a goal left as it is (or emptied) has nothing to send, so the button stops the run instead.
    const draft = goal.trim();
    const stops = Boolean(run && props.onStop) && (!draft || draft === (run?.goal || '').trim());
    const submit = (next: string): void => {
        const value = next.trim();
        if (!value || !canSend) return;
        setGoal(value);
        if (run) props.onCommand?.({ runId: run.runId, command: 'goal', goal: value });
        else props.onStart?.(plugin.id, value);
    };
    // The button turns into 停止 and back into 开始 in place: the second click of a double click must not stop the run it
    // just started or updated, nor start the one it just stopped.
    const repeated = (event: React.MouseEvent): boolean => {
        if (event.detail < 2) return false;
        event.preventDefault();
        return true;
    };
    // 停止 and 发送目标 share one grid cell, so the goal field keeps its width while an edit swaps them.
    const label = (text: string): React.ReactNode => run && props.onStop
        ? <span className='nmx-plugin-goal-label'>{[t(locale, 'stop'), appPluginOptionsText(locale, 'sendGoal')].map(option =>
            <span key={option} aria-hidden={option === text ? undefined : true}>{option}</span>)}</span>
        : text;
    return <div className='nmx-plugin-goal-controls'>
        <AppPluginPresetChoices locale={locale} plugin={plugin} appName={props.appName} disabled={!canSend} onChoose={submit} />
        {/* Enter never stops a run: with the goal unchanged the form has nothing to submit. */}
        <form className='nmx-plugin-goal-form' onSubmit={event => { event.preventDefault(); if (!stops) submit(goal); }}>
            <label className='nmx-plugin-field'><span>{t(locale, 'goal')}</span><ImeInput value={goal} maxLength={400}
                placeholder={t(locale, 'goalPlaceholder')} onChange={event => setGoal(event.currentTarget.value)} /></label>
            {stops
                ? <button type='button' className='is-danger' onClick={event => { if (!repeated(event)) props.onStop?.(); }}>{label(t(locale, 'stop'))}</button>
                : <button type='submit' className='is-primary' disabled={!canSend || !draft} onClick={repeated}>
                    {label(run ? appPluginOptionsText(locale, 'sendGoal') : t(locale, 'start'))}</button>}
        </form>
    </div>;
}

/** What a preset asks for, unless that is just its label again (presets made from goal examples are named by their goal). */
function presetDetail(preset: AppPluginPreset): string {
    const detail = (preset.description || preset.goal || '').trim();
    return detail && detail !== preset.label.trim() ? detail : '';
}

function AppPluginPresetChoices(props: { locale: Locale; plugin: AppPluginInfo; appName: string; disabled?: boolean; onChoose?(goal: string): void }): React.ReactElement {
    return <div className='nmx-plugin-chips nmx-plugin-preset-goals' aria-label={appPluginOptionsText(props.locale, 'presets')}>
        {appPluginGoalPresets(props.plugin, props.appName, props.locale).map(preset => props.onChoose
            ? <button type='button' key={preset.id} data-nmx-literal disabled={props.disabled} title={preset.description || preset.goal} onClick={() => props.onChoose?.(preset.goal)}>{preset.label}</button>
            : <p key={preset.id} data-nmx-literal><strong>{preset.label}</strong>{presetDetail(preset) && <span>{presetDetail(preset)}</span>}</p>)}
    </div>;
}

/**
 * A typed parameter keeps its draft while it is edited and is saved once, on Enter or when the field loses focus; a
 * save per keystroke would send half-typed values to the plugin and could land out of order. Esc puts the saved value back.
 */
function ParamDraftInput(props: {
    readonly value: string; readonly type: 'text' | 'number'; readonly min?: number; readonly max?: number; readonly step?: number;
    readonly disabled: boolean; commit(value: string): boolean;
    readonly id?: string; readonly describedBy?: string;
    /** A number field is as wide as its longest declared value (form rows), not the whole row. */
    readonly chars?: number;
}): React.ReactElement {
    const [draft, setDraft] = React.useState(props.value);
    const editing = React.useRef(false);
    React.useEffect(() => { if (!editing.current) setDraft(props.value); }, [props.value]);
    const commit = (): void => {
        if (draft === props.value) return;
        if (!props.commit(draft)) setDraft(props.value);
    };
    const shared = {
        id: props.id,
        'aria-describedby': props.describedBy,
        disabled: props.disabled,
        onFocus: () => { editing.current = true; },
        onBlur: () => { editing.current = false; commit(); },
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') { event.preventDefault(); commit(); }
            else if (event.key === 'Escape' && draft !== props.value) { event.preventDefault(); event.stopPropagation(); setDraft(props.value); }
        }
    };
    return props.type === 'number'
        ? <input type='number' inputMode='decimal' min={props.min} max={props.max} step={props.step} value={draft} onChange={event => setDraft(event.currentTarget.value)}
            style={props.chars ? { '--nmx-param-chars': props.chars } as React.CSSProperties : undefined} {...shared} />
        : <ImeInput value={draft} maxLength={500} onChange={event => setDraft(event.currentTarget.value)} {...shared} />;
}

const pathBaseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() || path;

/**
 * The file a file parameter holds. The host reports an unchosen file as `{ path: '', name: '', count: 0 }`: only a name
 * or a path makes it chosen, so an empty but real file (`{ name: 'empty.txt', count: 0 }`) is still chosen and clearable.
 */
function chosenParamFile(raw: AppPluginParamValue | undefined): { readonly name: string; readonly path: string; readonly count?: number } | undefined {
    if (raw && typeof raw === 'object' && 'count' in raw) {
        const value = raw as AppPluginParamFileValue;
        const path = value.path || '';
        const name = value.name || (path ? pathBaseName(path) : '');
        return name ? { name, path, count: value.count } : undefined;
    }
    return typeof raw === 'string' && raw ? { name: pathBaseName(raw), path: raw } : undefined;
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function AppPluginParamsBar(props: {
    readonly locale: Locale; readonly plugin: AppPluginInfo; readonly values?: Readonly<Record<string, AppPluginParamValue>>;
    readonly disabled?: boolean;
    /**
     * 'compact' (a tab's plugin bar, the plugin market, the start dialog): a grid of small labelled fields that reflows
     * with the width. 'form' (the Options dialog): one settings row per parameter with the plugin's description under
     * its label, switches for on/off, fields sized to their values, files and folders with their current choice.
     */
    readonly layout?: 'compact' | 'form';
    onConfigureParams?(id: string, params: Readonly<Record<string, unknown>>): void;
    onPickParamFile?(id: string, paramId: string, label?: string): void;
}): React.ReactElement | null {
    const [busy, setBusy] = React.useState<string>('');
    const idBase = React.useId();
    const { locale, plugin } = props;
    const params: readonly AppPluginParam[] = plugin.summary?.params || [];
    if (!params.length) return null;
    const form = props.layout === 'form';
    const current = props.values || plugin.params || {};
    const editable = !props.disabled && Boolean(props.onConfigureParams);
    const updateParam = (paramId: string, value: unknown): void => {
        props.onConfigureParams?.(plugin.id, { [paramId]: value });
    };
    const text = (key: Parameters<typeof appPluginOptionsText>[1], values?: Parameters<typeof appPluginOptionsText>[2]): string => appPluginOptionsText(locale, key, values);
    return <div className={`nmx-plugin-params-bar${form ? ' is-form' : ''}`} role='group' aria-label={text('parameters')}>
        {params.map((param, index) => {
            const rawVal = current[param.id] !== undefined ? current[param.id] : param.default;
            // Form rows: the label names the control, the plugin's description (when it says more than the label) describes it.
            const id = `${idBase}-${index}`, labelId = `${id}-label`, controlId = `${id}-control`;
            const description = (param.description || '').trim();
            const help = description && description !== param.label.trim() ? description : '';
            const helpId = help ? `${id}-help` : undefined;
            const copy = (labelFor?: string): React.ReactElement => <span className='nmx-plugin-param-copy'>
                {labelFor ? <label id={labelId} htmlFor={labelFor} className='nmx-plugin-param-label' data-nmx-literal>{param.label}</label>
                    : <span id={labelId} className='nmx-plugin-param-label' data-nmx-literal>{param.label}</span>}
                {help && <span id={helpId} className='nmx-plugin-param-help' data-nmx-literal>{help}</span>}
            </span>;
            if (param.type === 'boolean') {
                if (form) {
                    // The whole row is the switch's label: a click anywhere on it toggles, Space toggles the focused switch.
                    return <label key={param.id} className={`nmx-plugin-param-row is-boolean${editable ? '' : ' is-disabled'}`} data-param-id={param.id}>
                        {copy()}
                        <span className='nmx-plugin-param-control'>
                            <span className='nmx-switch nmx-plugin-switch'>
                                <input type='checkbox' role='switch' checked={Boolean(rawVal)} disabled={!editable} aria-labelledby={labelId} aria-describedby={helpId}
                                    onChange={event => updateParam(param.id, event.currentTarget.checked)} />
                                <i aria-hidden='true'></i>
                            </span>
                        </span>
                    </label>;
                }
                return <label key={param.id} className='nmx-plugin-check nmx-plugin-param-item' title={param.description || param.label}>
                    <input type='checkbox' checked={Boolean(rawVal)} disabled={props.disabled || !props.onConfigureParams}
                        onChange={event => updateParam(param.id, event.currentTarget.checked)} />
                    <span data-nmx-literal>{param.label}</span>
                </label>;
            }
            if (param.type === 'number') {
                const numVal = typeof rawVal === 'number' ? rawVal : Number(param.default ?? param.min ?? 1);
                const commit = (draft: string): boolean => {
                    const next = Number(draft);
                    if (!draft.trim() || !Number.isFinite(next)) return false;
                    updateParam(param.id, Math.min(param.max ?? Number.POSITIVE_INFINITY, Math.max(param.min ?? Number.NEGATIVE_INFINITY, next)));
                    return true;
                };
                if (form) {
                    const range = finiteNumber(param.min) && finiteNumber(param.max) ? `${param.min}–${param.max}`
                        : finiteNumber(param.min) ? `≥ ${param.min}` : finiteNumber(param.max) ? `≤ ${param.max}` : '';
                    const rangeId = range ? `${id}-range` : undefined;
                    const chars = Math.max(2, ...[param.min, param.max, numVal].filter(finiteNumber).map(value => String(value).length));
                    return <div key={param.id} className='nmx-plugin-param-row is-number' data-param-id={param.id}>
                        {copy(controlId)}
                        <span className='nmx-plugin-param-control'>
                            {range && <span id={rangeId} className='nmx-plugin-param-range' dir='ltr'>{range}</span>}
                            <ParamDraftInput id={controlId} describedBy={[helpId, rangeId].filter(Boolean).join(' ') || undefined} chars={chars}
                                type='number' value={String(numVal)} min={param.min} max={param.max} step={param.step ?? 1} disabled={!editable} commit={commit} />
                        </span>
                    </div>;
                }
                return <label key={param.id} className='nmx-plugin-field nmx-plugin-param-item is-number' title={param.description || param.label}>
                    <span data-nmx-literal>{param.label}</span>
                    <ParamDraftInput type='number' value={String(numVal)} min={param.min} max={param.max} step={param.step ?? 1}
                        disabled={Boolean(props.disabled || !props.onConfigureParams)} commit={commit} />
                </label>;
            }
            if (param.type === 'select' && param.options?.length) {
                const strVal = typeof rawVal === 'string' ? rawVal : String(param.default ?? param.options[0].value);
                const select = (selectId?: string): React.ReactElement => <select id={selectId} aria-describedby={selectId ? helpId : undefined} value={strVal}
                    disabled={props.disabled || !props.onConfigureParams} onChange={event => updateParam(param.id, event.currentTarget.value)}>
                    {param.options!.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>;
                if (form) return <div key={param.id} className='nmx-plugin-param-row is-select' data-param-id={param.id}>
                    {copy(controlId)}
                    <span className='nmx-plugin-param-control'>{select(controlId)}</span>
                </div>;
                return <label key={param.id} className='nmx-plugin-field nmx-plugin-param-item is-select' title={param.description || param.label}>
                    <span data-nmx-literal>{param.label}</span>
                    {select()}
                </label>;
            }
            if (param.type === 'file') {
                const chosen = chosenParamFile(rawVal);
                const chosenText = chosen ? chosen.count !== undefined
                    ? text('fileLines', { name: chosen.name, count: chosen.count.toLocaleString(locale) }) : chosen.path || chosen.name : '';
                const pick = (): void => props.onPickParamFile?.(plugin.id, param.id, param.label);
                if (form) {
                    return <div key={param.id} className='nmx-plugin-param-row is-file' role='group' aria-labelledby={labelId} aria-describedby={helpId} data-param-id={param.id}>
                        {copy()}
                        <span className='nmx-plugin-param-control'>
                            <span className='nmx-plugin-param-value'>
                                {chosen ? <span className='nmx-plugin-file-value' title={chosen.path || chosenText} data-nmx-literal>
                                    <i className='codicon codicon-file-text' aria-hidden='true'></i><span>{chosenText}</span>
                                </span> : <span className='nmx-plugin-param-empty'>{text('noFile')}</span>}
                            </span>
                            <button type='button' className='nmx-plugin-param-pick' disabled={props.disabled || !props.onPickParamFile} onClick={pick}>
                                <i className='codicon codicon-file-text' aria-hidden='true'></i><span>{text(chosen ? 'changeFile' : 'chooseFile')}</span>
                            </button>
                            {chosen && <button type='button' className='is-link nmx-plugin-param-clear' disabled={!editable} onClick={() => updateParam(param.id, null)}>{text('clear')}</button>}
                        </span>
                    </div>;
                }
                const buttonText = chosenText || text('chooseFile');
                return <div key={param.id} className='nmx-plugin-field nmx-plugin-param-item is-file' title={param.description || param.label}>
                    <span data-nmx-literal>{param.label}</span>
                    <div className='nmx-plugin-inline'>
                        <button type='button' className={chosen ? 'has-file' : ''} title={buttonText} disabled={props.disabled || !props.onPickParamFile} onClick={pick}>
                            <i className='codicon codicon-file-text' aria-hidden='true'></i>
                            <b data-nmx-literal>{buttonText}</b>
                        </button>
                        {chosen ? <button type='button' className='is-link' disabled={props.disabled || !props.onConfigureParams}
                            onClick={() => updateParam(param.id, null)}>{text('clear')}</button> : null}
                    </div>
                </div>;
            }
            if (param.type === 'path' || param.type === 'directory') {
                // A folder is chosen only through the native folder dialog and written through the
                // scoped updateParam (a tab's run, or the saved defaults); it is never typed in.
                const pathVal = typeof rawVal === 'string' ? rawVal : '';
                const bridge = typeof window !== 'undefined' ? window.nextmuxDesktop : undefined;
                const canPick = Boolean(props.onConfigureParams && (bridge?.pickAppPluginFolder || props.onPickParamFile));
                const pick = async (): Promise<void> => {
                    if (bridge?.pickAppPluginFolder) {
                        setBusy(param.id);
                        try {
                            const picked = await bridge.pickAppPluginFolder(pathVal || undefined);
                            if (picked && !picked.canceled && picked.path) updateParam(param.id, picked.path);
                        } finally {
                            setBusy('');
                        }
                        return;
                    }
                    props.onPickParamFile?.(plugin.id, param.id, param.label);
                };
                const separator = Math.max(pathVal.lastIndexOf('/'), pathVal.lastIndexOf('\\'));
                const value = pathVal
                    ? <span className='nmx-file-path-pill nmx-plugin-path-value' title={pathVal} data-path={pathVal}>
                        {separator > 0 && <span className='nmx-file-path-dir'><span>{pathVal.slice(0, separator + 1)}</span></span>}
                        <span className='nmx-file-path-name'><span>{pathVal.slice(separator + 1) || pathVal}</span></span>
                    </span>
                    : <span className={form ? 'nmx-plugin-param-empty nmx-plugin-path-empty' : 'nmx-plugin-path-empty'}>{text('noFolder')}</span>;
                const buttons = <>
                    <button type='button' className={form ? 'nmx-plugin-param-pick nmx-plugin-path-pick' : 'nmx-plugin-path-pick'} disabled={props.disabled || !canPick || busy === param.id} onClick={() => void pick()}>
                        <i className='codicon codicon-folder-opened' aria-hidden='true'></i>
                        <span>{text(pathVal ? 'changeFolder' : 'chooseFolder')}</span>
                    </button>
                    {pathVal ? <button type='button' className={form ? 'is-link nmx-plugin-param-clear nmx-plugin-path-clear' : 'is-link nmx-plugin-path-clear'} disabled={props.disabled || !props.onConfigureParams || busy === param.id}
                        onClick={() => updateParam(param.id, null)}>{text('clear')}</button> : null}
                </>;
                if (form) return <div key={param.id} className='nmx-plugin-param-row is-path' role='group' aria-labelledby={labelId} aria-describedby={helpId} data-param-id={param.id}>
                    {copy()}
                    <span className='nmx-plugin-param-control nmx-plugin-path-control'><span className='nmx-plugin-param-value'>{value}</span>{buttons}</span>
                </div>;
                return <div key={param.id} className='nmx-plugin-field nmx-plugin-param-item is-path' title={param.description || param.label}>
                    <span data-nmx-literal>{param.label}</span>
                    <div className='nmx-plugin-path-control'>{value}{buttons}</div>
                </div>;
            }
            const textVal = typeof rawVal === 'string' ? rawVal : String(param.default ?? '');
            const commitText = (draft: string): boolean => { updateParam(param.id, draft); return true; };
            if (form) return <div key={param.id} className='nmx-plugin-param-row is-string' data-param-id={param.id}>
                {copy(controlId)}
                <span className='nmx-plugin-param-control'>
                    <ParamDraftInput id={controlId} describedBy={helpId} type='text' value={textVal} disabled={!editable} commit={commitText} />
                </span>
            </div>;
            return <label key={param.id} className='nmx-plugin-field nmx-plugin-param-item is-string' title={param.description || param.label}>
                <span data-nmx-literal>{param.label}</span>
                <ParamDraftInput type='text' value={textVal} disabled={Boolean(props.disabled || !props.onConfigureParams)} commit={commitText} />
            </label>;
        })}
    </div>;
}

export interface AppPluginStartOptions { readonly goal: string; readonly maxMinutes: number; readonly maxCostUsd: number; readonly dryRun: boolean; readonly handOff: boolean }

/** Before a plugin takes over a tab: goal, time and money limits, a dry run, and what happens to the keyboard. */
export function AppPluginStartDialog(props: {
    readonly locale: Locale; readonly plugin: AppPluginInfo; readonly tabTitle: string; readonly byAi: boolean; readonly initialGoal: string;
    readonly initialMinutes?: number; readonly initialCost?: number; readonly busy: boolean; readonly error: string; readonly shortcut: string;
    onConfigureParams?(id: string, params: Readonly<Record<string, unknown>>): void;
    onPickParamFile?(id: string, paramId: string, label?: string): void;
    onStart(options: AppPluginStartOptions): void; onCancel(): void;
}): React.ReactElement {
    const { locale, plugin } = props;
    const summary = plugin.summary!;
    const [goal, setGoal] = React.useState(props.initialGoal || summary.goals.default);
    const [minutes, setMinutes] = React.useState(String(Math.min(summary.maxRunMinutes, props.initialMinutes || Math.min(60, summary.maxRunMinutes))));
    const [cost, setCost] = React.useState(String(props.initialCost || 1));
    const [dryRun, setDryRun] = React.useState(false);
    const [handOff, setHandOff] = React.useState(true);
    const minutesValue = Math.max(1, Math.min(summary.maxRunMinutes, Math.round(Number(minutes) || 0)));
    const costValue = Math.max(0.01, Math.min(100, Number(cost) || 0));
    const inputErrors = plugin.inputErrors || [];
    const budgetUnknown = plugin.budgetEnforceable === false;
    return <Dialog id='nmx-plugin-start-title' title={t(locale, 'startTitle', { name: summary.name })} onClose={props.onCancel} busy={props.busy} closeLabel={t(locale, 'close')} className='nmx-plugin-start-dialog'
        footer={<><button type='button' disabled={props.busy} onClick={props.onCancel}>{t(locale, 'cancel')}</button>
            <button type='button' className='is-primary' autoFocus disabled={props.busy || !plugin.ready || inputErrors.length > 0} onClick={() => props.onStart({ goal: goal.trim(), maxMinutes: minutesValue, maxCostUsd: costValue, dryRun, handOff })}>
                {props.busy ? t(locale, 'loading') : t(locale, 'start')}</button></>}>
        <div className='nmx-plugin-install-head'>
            <PluginIcon icon={plugin.icon} size={40} />
            <div><strong data-nmx-literal>{summary.name}</strong><span data-nmx-literal>{t(locale, props.byAi ? 'startByAi' : 'startByUser', { tab: props.tabTitle })}</span></div>
        </div>
        <label className='nmx-plugin-field'><span>{t(locale, 'goal')}</span>
            <ImeInput value={goal} maxLength={400} placeholder={summary.goals.examples[0] || t(locale, 'goalPlaceholder')} onChange={event => setGoal(event.currentTarget.value)} /></label>
        {summary.goals.examples.length > 0 && <div className='nmx-plugin-chips'>{summary.goals.examples.map(example => <button type='button' key={example} data-nmx-literal onClick={() => setGoal(example)}>{example}</button>)}</div>}
        <AppPluginParamsBar locale={locale} plugin={plugin} disabled={props.busy}
            onConfigureParams={props.onConfigureParams} onPickParamFile={props.onPickParamFile} />
        <div className='nmx-plugin-limits'>
            <label className='nmx-plugin-field'><span>{t(locale, 'minutes')}</span><input type='number' min={1} max={summary.maxRunMinutes} value={minutes} onChange={event => setMinutes(event.currentTarget.value)} /></label>
            <label className='nmx-plugin-field'><span>{t(locale, 'budget')}</span><input type='number' min={0.01} max={100} step={0.1} value={cost} disabled={budgetUnknown} aria-describedby={budgetUnknown ? 'nmx-plugin-budget-warning' : undefined} onChange={event => setCost(event.currentTarget.value)} /></label>
        </div>
        {budgetUnknown && <p id='nmx-plugin-budget-warning' className='nmx-plugin-risk' role='status'><i className='codicon codicon-warning' aria-hidden='true'></i>{appPluginRuntimeText(locale, 'budgetUnknown')}</p>}
        <label className='nmx-plugin-check'><input type='checkbox' checked={dryRun} onChange={event => setDryRun(event.currentTarget.checked)} /><span>{t(locale, 'dryRun')}</span></label>
        <label className='nmx-plugin-check'><input type='checkbox' checked={handOff} onChange={event => setHandOff(event.currentTarget.checked)} /><span>{t(locale, 'handOff')}</span></label>
        {!dryRun && summary.modes.includes('foreground') && !summary.modes.includes('background') && <p className='nmx-plugin-safety'><i className='codicon codicon-keyboard' aria-hidden='true'></i>{t(locale, 'foreground', { shortcut: props.shortcut })}</p>}
        {summary.risk.includes('account-ban') && <p className='nmx-plugin-risk'><i className='codicon codicon-warning' aria-hidden='true'></i>{t(locale, 'risk')}</p>}
        {inputErrors.length > 0 && <div className='nmx-settings-inline-error' role='alert'>{inputErrors.map(error => <p key={error} data-nmx-literal>{appPluginError(locale, error)}</p>)}</div>}
        {!plugin.ready && !inputErrors.length && <p className='nmx-plugin-muted is-error'>{appPluginError(locale, plugin.modelCompatibilityError || 'plugin_model_required')}</p>}
        {props.error && <p className='nmx-project-delete-error' role='alert' data-nmx-literal>{props.error}</p>}
    </Dialog>;
}

/** The plugin running on a tab: time, spend, last decision, and the controls. */
export function AppPluginRunBar(props: AppPluginInlineControlsProps & { readonly locale: Locale; readonly run: AppPluginRunSnapshot; readonly now: number;
    readonly plugin?: AppPluginInfo; readonly appName?: string;
    onStop(): void; onPause?(): void; onResume(): void; onToggleOverlay(): void; readonly overlay: boolean }): React.ReactElement {
    const { locale, run } = props;
    const failure = run.error ? modelFailure(locale, run.readableError || run.error) : undefined;
    const elapsed = run.ended ? run.elapsedMs : run.elapsedMs + Math.max(0, props.now - (run.startedAt + run.elapsedMs));
    return <div className={`nmx-plugin-runbar ${run.ended ? 'is-ended' : run.paused ? 'is-paused' : 'is-running'}`} role='status' aria-live='polite'>
        <span className='nmx-plugin-runbar-dot' aria-hidden='true'></span>
        <strong data-nmx-literal>{t(locale, 'nav')} · {run.name}</strong>
        {run.dryRun && <span className='nmx-plugin-status is-dev'>{t(locale, 'dryRunBadge')}</span>}
        <span className='nmx-plugin-runbar-meta' data-nmx-literal>{run.ended ? t(locale, 'ended', { reason: appPluginReason(locale, run.reason) }) : run.paused ? t(locale, 'paused') : formatDuration(elapsed)}</span>
        <span className='nmx-plugin-runbar-meta' data-nmx-literal title={run.costStatus === 'unknown' ? appPluginRuntimeText(locale, 'budgetUnknown') : undefined}>
            {run.costStatus === 'unknown' ? appPluginRuntimeText(locale, 'costUnknown') : t(locale, 'cost', { cost: formatUsd(run.costUsd) })}</span>
        {run.lastDecision && !run.ended && <span className='nmx-plugin-runbar-meta' data-nmx-literal>{t(locale, 'decision', { choice: run.lastDecision.choice || '—', confidence: Math.round(run.lastDecision.confidence * 100) })}</span>}
        {failure && <span className='nmx-plugin-muted is-error' title={failure.detail} data-nmx-literal>{appPluginError(locale, run.readableError || run.error)}</span>}
        {run.goal && <span className='nmx-plugin-runbar-goal' data-nmx-literal title={run.goal}>{run.goal}</span>}
        <span className='nmx-plugin-runbar-actions'>
            {!run.ended && <button type='button' className={props.overlay ? 'is-active' : ''} aria-pressed={props.overlay} onClick={props.onToggleOverlay}>{t(locale, 'overlay')}</button>}
            {!run.ended && !run.paused && props.onPause && <button type='button' onClick={props.onPause}>{t(locale, 'pause')}</button>}
            {!run.ended && run.paused && <button type='button' onClick={props.onResume}>{t(locale, 'resume')}</button>}
            {!run.ended && <button type='button' className='is-danger' onClick={props.onStop}>{t(locale, 'stop')}</button>}
        </span>
        {props.plugin && <>
            <AppPluginInlineModelBar {...props} plugin={props.plugin} running={!run.ended} />
            <AppPluginParamsBar locale={locale} plugin={props.plugin} values={run.params || props.plugin.params}
                onConfigureParams={props.onConfigureParams} onPickParamFile={props.onPickParamFile} />
            {/* The run bar has its own 停止 above, so its goal button always sends. */}
            <AppPluginGoalControls {...props} plugin={props.plugin} appName={props.appName || run.name} activeRun={run} onStop={undefined} />
        </>}
        {props.error && <span className='nmx-plugin-muted is-error' role='alert' data-nmx-literal>{props.error}</span>}
    </div>;
}

/** The plugin's readings drawn over the tab's live picture (dry runs, or with 显示读数 on). */
export function AppPluginOverlay(props: { readonly items: readonly AppPluginOverlayItem[] }): React.ReactElement {
    const value = (item: AppPluginOverlayItem): string => {
        const reading = item.value as { found?: boolean; count?: number } | number | boolean | string | null;
        if (reading === null || reading === undefined) return '—';
        if (typeof reading === 'number') return item.type === 'bar' ? `${Math.round(reading * 100)}%` : String(Math.round(reading * 100) / 100);
        if (typeof reading === 'boolean') return reading ? '✓' : '✗';
        if (typeof reading === 'object') return reading.found ? `×${reading.count}` : '—';
        return String(reading).slice(0, 24);
    };
    return <div className='nmx-plugin-overlay' aria-hidden='true'>
        {props.items.map(item => <React.Fragment key={item.id}>
            {item.rect && <div className={`nmx-plugin-overlay-box is-${item.type}`} style={{ left: `${item.rect[0] * 100}%`, top: `${item.rect[1] * 100}%`, width: `${item.rect[2] * 100}%`, height: `${item.rect[3] * 100}%` }}>
                <span data-nmx-literal>{item.id} {value(item)}</span></div>}
            {(item.type === 'template' || item.type === 'text') && ((item.value as { items?: { x: number; y: number }[] } | null)?.items || []).map((found, index) =>
                <div key={index} className='nmx-plugin-overlay-hit' style={{ left: `${found.x * 100}%`, top: `${found.y * 100}%` }}></div>)}
            {item.points && item.points.map(([x, y], index) => <div key={`p${index}`} className='nmx-plugin-overlay-point' style={{ left: `${x * 100}%`, top: `${y * 100}%` }}></div>)}
        </React.Fragment>)}
    </div>;
}

/**
 * 插件市场 for one tab (the button at the top right of an app tab): the installed plugins made for this app, ready to
 * start, and the marketplace's plugins for it, ready to get; the point-and-colour studio and plugin settings at the foot.
 */
export function AppPluginHubDialog(props: AppPluginInlineControlsProps & {
    readonly locale: Locale; readonly appName: string; readonly plugins: readonly AppPluginInfo[]; readonly compatible: readonly AppPluginInfo[];
    readonly market: { readonly plugins: readonly AppPluginMarketPlugin[]; readonly loading: boolean; readonly error: string };
    readonly marketBusy: string; readonly running: boolean; readonly activeRun?: AppPluginRunSnapshot;
    onStart(id: string, goal?: string): void; onChooseModel(id: string): void; onGet(plugin: AppPluginMarketPlugin): void; onStudio(): void; onManage(): void; onBrowseAll(): void; onClose(): void;
    /** Stops this tab's running plugin: its goal button reads 停止 while the goal is unedited. */
    onStop?(): void;
}): React.ReactElement {
    const { locale, market } = props;
    const installed = new Map(props.plugins.filter(plugin => plugin.summary).map(plugin => [plugin.id, plugin.summary!.version]));
    const offers = market.plugins.filter(plugin => { const have = installed.get(plugin.id); return !have || (plugin.latestVersion && compareVersions(plugin.latestVersion, have) > 0); });
    // With this app's plugins installed and nothing new or newer in the marketplace, "no plugins for this app" would be
    // false, so the marketplace section is left out; the footer still browses every plugin.
    const showMarket = market.loading || Boolean(market.error) || offers.length > 0 || !props.compatible.length;
    return <Dialog id='nmx-plugin-hub-title' title={`${t(locale, 'tabMarket')} · ${props.appName}`} onClose={props.onClose} closeLabel={t(locale, 'close')} className='nmx-plugin-hub'
        footer={<>
            <button type='button' onClick={props.onStudio}><i className='codicon codicon-symbol-color' aria-hidden='true'></i>{t(locale, 'studio')}</button>
            <button type='button' onClick={props.onManage}><i className='codicon codicon-settings-gear' aria-hidden='true'></i>{t(locale, 'manage')}</button>
            <span className='nmx-plugin-footer-space'></span>
            <button type='button' onClick={props.onBrowseAll}>{t(locale, 'hubBrowseAll')}</button>
        </>}>
        <section className='nmx-plugin-hub-section'>
            <h3 data-nmx-literal>{t(locale, 'hubInstalled', { app: props.appName })}</h3>
            {props.error && <p className='nmx-plugin-muted is-error' role='alert' data-nmx-literal>{props.error}</p>}
            {props.compatible.length ? <ul className='nmx-plugin-hub-list'>{props.compatible.map(plugin => <li key={plugin.id}>
                <PluginIcon icon={plugin.icon} size={36} />
                <div className='nmx-plugin-hub-text'><strong data-nmx-literal>{plugin.summary?.name || plugin.id}</strong>
                    <small data-nmx-literal>{plugin.ready ? (plugin.summary?.decisions?.length ? modelLabel(plugin.model, locale) : t(locale, 'ready')) : t(locale, 'needsModel')}</small>
                    <AppPluginInlineModelBar {...props} plugin={plugin} />
                    <AppPluginParamsBar locale={locale} plugin={plugin}
                        values={(props.activeRun && !props.activeRun.ended && props.activeRun.pluginId === plugin.id ? props.activeRun.params : undefined) || plugin.params}
                        onConfigureParams={props.onConfigureParams} onPickParamFile={props.onPickParamFile} />
                    <AppPluginGoalControls {...props} plugin={plugin} />
                </div>
            </li>)}</ul> : <p className='nmx-plugin-muted'>{t(locale, 'noCompatible')}</p>}
        </section>
        {showMarket && <section className='nmx-plugin-hub-section'>
            <h3 data-nmx-literal>{t(locale, 'hubMarket', { app: props.appName })}</h3>
            {market.loading && !offers.length ? <p className='nmx-plugin-muted'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{t(locale, 'loading')}</p>
                : market.error ? <p className='nmx-plugin-muted is-error'>{t(locale, 'marketFailed')}</p>
                    : !offers.length ? <p className='nmx-plugin-muted'>{t(locale, 'hubMarketEmpty')}</p>
                        : <ul className='nmx-plugin-hub-list'>{offers.map(plugin => {
                            const update = installed.has(plugin.id);
                            return <li key={plugin.id}>
                                <PluginIcon size={36} />
                                <span className='nmx-plugin-hub-text'><strong data-nmx-literal>{pick(plugin.name, locale) || plugin.id}</strong>
                                    <small data-nmx-literal>{t(locale, 'by', { name: plugin.author.name })} · {t(locale, 'downloads', { count: plugin.downloads })}</small>
                                    {pick(plugin.description, locale) && <PluginDescription as='em' className='nmx-plugin-description' text={pick(plugin.description, locale)} />}
                                    {plugin.risk.includes('account-ban') && <em className='is-risk'><i className='codicon codicon-warning' aria-hidden='true'></i>{t(locale, 'risk')}</em>}</span>
                                <button type='button' className='nmx-plugin-get is-primary' disabled={Boolean(props.marketBusy) || !plugin.latestVersion} onClick={() => props.onGet(plugin)}>
                                    {props.marketBusy === plugin.id && <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}
                                    {update ? t(locale, 'updateTo', { version: plugin.latestVersion }) : t(locale, 'getPlugin')}</button>
                            </li>;
                        })}</ul>}
        </section>}
        <SurfaceTooltips scope='.nmx-plugin-hub .nmx-plugin-description[data-help]' />
    </Dialog>;
}

/**
 * Plugins whose apps include this tab's app: bundle id on macOS, program name on Windows. `identity` is every name the
 * tab's app goes by (appTabIdentity: Start-menu id, the window's program, the launched program).
 */
export function pluginsForApp(plugins: readonly AppPluginInfo[], identity: string | readonly string[] | undefined, platform: string, title?: string, windowTitle?: string): AppPluginInfo[] {
    const current = /mac|darwin/i.test(platform) ? 'macos' : /win/i.test(platform) ? 'windows' : '';
    const normalize = (text: string | undefined): string => (text || '').trim().toLowerCase();
    const executable = (text: string): string => text.replace(/\\/g, '/').split('/').pop()!.replace(/\.(?:exe|app)$/i, '');
    const names = (typeof identity === 'string' ? [identity] : identity || []).map(normalize).filter(Boolean);
    const titles = [title, windowTitle].map(normalize).filter(Boolean);
    return plugins.filter(plugin => plugin.ok && plugin.summary?.apps.some(app => {
        if (app.platform !== current) return false;
        const targets = [app.bundleId, app.program].map(normalize).filter(Boolean);
        if (names.some(name => targets.some(target => name === target || executable(name) === executable(target)))) return true;
        const program = executable(normalize(app.program));
        if (current === 'windows' && program.length >= 2 && names.some(name => /[!_]/.test(name) && !/[\\/]/.test(name)
            && name.split(/[!_]/, 1)[0].includes(program))) return true;
        const labels = [normalize(app.titleIncludes), normalize(app.name), program.length >= 2 ? program : ''].filter(Boolean);
        // `app.title` remains the runtime's RE2 title restriction; never run untrusted regexes in the UI.
        return labels.some(label => titles.some(value => value.includes(label)));
    }));
}
