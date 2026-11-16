import { decisionPluginCompatibility, isTevDecisionModel } from '@nextmux/model-runtime/decision-adapter';
import { decodeTextBytes } from '@nextmux/model-runtime/text-encoding';
import { appPluginDiagnostics as originalAppPluginDiagnostics, appPluginReplayName } from './nextmux-app-plugin-diagnostics-locale';
import { modelFailure } from './nextmux-model-errors';
import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { SurfaceTooltips } from './nextmux-surface-tooltips';
import { appPluginError, appPluginReason, appPluginText, type AppPluginTextKey } from './nextmux-app-plugins-locale';
import { appPluginPackageError, appPluginRuntimeText } from './nextmux-app-plugin-runtime-locale';
import { appPluginOptionsText } from './nextmux-app-plugin-options-locale';
import type {
    AppPluginTrust,
    AppPluginChatAttachment, AppPluginChatMessage, AppPluginChatRequest,
    AppPluginDiagnostic, AppPluginInfo, AppPluginInspection, AppPluginLocalServer, AppPluginMarketPlugin, AppPluginMine, AppPluginMinePlugin, AppPluginMineVersion,
    AppPluginModel, AppPluginModelChoices, AppPluginOverlayItem, AppPluginParam, AppPluginParamFileValue, AppPluginParamValue, AppPluginPreset, AppPluginRunSnapshot, AppPluginServerProbe, AppPluginSummary, AppPluginUiBundleResult, AppPluginUploadProblem, AppPluginVisionModel
} from '../common/nextmux-app-plugins';
import { APP_PLUGIN_PRICE } from '../common/nextmux-app-plugins';
import { ConversationMarkdown } from './nextmux-conversation-markdown';
import { StreamText } from './nextmux-conversation-stream';
import { normalizeConversationMarkdown } from './nextmux-markdown';
import { AttachmentChip, ComposerDropOverlay, fileTypeInfo, fileTypeExtensions, fileExtension, formatAttachmentSize } from './nextmux-composer-attachments';
import { modelPickerListText, RELAY_DRAWER_WIDTH } from './nextmux-relay-picker';
import { placeAnchoredFloatingPanel } from './nextmux-floating-panel';
import {
    APP_PLUGIN_IFRAME_SANDBOX, APP_PLUGIN_WINDOW_CHANNEL,
    AppPluginWindowInboundMessage, AppPluginWindowRect, AppPluginWindowSubModalSpec, PluginWindowResizeEdge,
    buildPluginWindowSubModalHtml, clampPluginWindowRect, dragPluginWindowRect, initialPluginWindowRect,
    isAppPluginUiDocumentUrl, isValidPluginIframeEventSource, parsePluginWindowPostMessage, preparePluginUiHtml, resizePluginWindowRect
} from './nextmux-app-plugin-window-sdk';

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
        <AppPluginFormats locale={locale} packedOnly />
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
        const trigger = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        panel.current?.focus({ preventScroll: true });
        const onDocumentKeyDown = (event: KeyboardEvent): void => {
            if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('keydown', onDocumentKeyDown);
        }
        return () => {
            if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
                document.removeEventListener('keydown', onDocumentKeyDown);
            }
            if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        };
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

function AppPluginFormats({ locale, packedOnly = false }: { locale: Locale; packedOnly?: boolean }): React.ReactElement {
    return <ul className='nmx-plugin-formats'>
        <li><code>.nmxplugin</code></li><li><code>.zip</code></li><li><code>.jevplugin</code></li><li><code>.tar.gz</code> / <code>.tgz</code></li>
        {!packedOnly && <><li><code>plugin.json</code> / <code>manifest.json</code></li><li>{t(locale, 'loadFolderButton')}</li></>}
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
    const panel = React.useRef<HTMLElement>(null);
    const onCloseRef = React.useRef(props.onClose);
    const busyRef = React.useRef(props.busy);
    onCloseRef.current = props.onClose;
    busyRef.current = props.busy;
    React.useLayoutEffect(() => {
        const trigger = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        if (panel.current && (typeof document === 'undefined' || !panel.current.contains(document.activeElement))) {
            panel.current.focus({ preventScroll: true });
        }
        const onDocumentKeyDown = (event: KeyboardEvent): void => {
            if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return;
            if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
                if (document.querySelectorAll('.nmx-plugin-modal-backdrop, .nmx-model-picker-portal, .nmx-composer-popover').length > 0) return;
                const dialogs = document.querySelectorAll('.nmx-plugin-dialog');
                if (dialogs.length > 0 && dialogs[dialogs.length - 1] !== panel.current) return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!busyRef.current) onCloseRef.current();
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('keydown', onDocumentKeyDown);
        }
        return () => {
            if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
                document.removeEventListener('keydown', onDocumentKeyDown);
            }
            if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        };
    }, []);
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop' onMouseDown={() => { if (!props.busy) props.onClose(); }}>
        <section ref={panel} tabIndex={-1} className={`nmx-thread-dialog nmx-plugin-dialog ${props.className || ''}`} role='dialog' aria-modal='true' aria-labelledby={props.id} aria-busy={props.busy}
            onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
                if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
                if (event.key === 'Escape') {
                    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function'
                        && document.querySelectorAll('.nmx-plugin-modal-backdrop, .nmx-model-picker-portal, .nmx-composer-popover').length > 0) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    if (!props.busy) props.onClose();
                }
            }}>
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

interface DecisionDrawerModelItem {
    readonly key: string;
    readonly label: string;
    readonly model: AppPluginModel;
    readonly priceLabel?: string;
    readonly incompatError?: string;
}

interface DecisionDrawerSourceEntry {
    readonly key: string;
    readonly category: AppPluginModel['source'];
    readonly shortLabel: string;
    readonly label: string;
    readonly meta: string;
    readonly endpoint?: string;
    readonly connectionId?: string;
    readonly merchant?: string;
    readonly isOtherLocal?: boolean;
    readonly models: readonly DecisionDrawerModelItem[];
}

const decisionSourceKeyForModel = (model: AppPluginModel | null | undefined): string => {
    if (!model) return '';
    if (model.source === 'connection') return `connection:${model.connectionId || ''}`;
    if (model.source === 'local') return `local:${model.endpoint || ''}`;
    return `nextmux:${model.merchant || ''}`;
};

const decisionModelKey = (model: AppPluginModel): string =>
    JSON.stringify([model.source, model.connectionId || '', model.endpoint || '', model.protocol || '', model.offeringId || '', model.merchant || '', model.model]);

/** Normalizes relays, own API connections, and local servers into dual-drawer source & model entries. */
function buildDecisionPickerCatalog(
    locale: Locale,
    choices: AppPluginModelChoices | undefined,
    probed: readonly AppPluginLocalServer[],
    options: {
        readonly decisions?: AppPluginSummary['decisions'];
        readonly visionMode?: AppPluginSummary['vision'];
        readonly currentVision?: AppPluginVisionModel | null;
        readonly currentModel?: AppPluginModel | null;
        readonly extraModels?: readonly AppPluginModel[];
        readonly filterInline?: boolean;
        readonly allowOtherLocal?: boolean;
        readonly forceCategory?: AppPluginModel['source'];
    }
): readonly DecisionDrawerSourceEntry[] {
    const decisions = options.decisions || [];
    const inlineOnly = Boolean(options.filterInline && decisions.length > 0);
    const relays = choices?.relays || [];
    const connections = (choices?.connections || []).filter(item => item.decisions.length > 0);
    const servers = [...(choices?.local || []), ...probed.filter(s => !(choices?.local || []).some(k => k.endpoint === s.endpoint))];
    const entries: DecisionDrawerSourceEntry[] = [];

    const checkCompat = (model: AppPluginModel): string | undefined => {
        const compat = decisions.length ? decisionPluginCompatibility(model, decisions) : undefined;
        if (compat) return compat;
        if (options.visionMode === 'required' && !model.images && !options.currentVision) {
            return 'plugin_vision_model_required';
        }
        return undefined;
    };

    const includeCategory = (cat: AppPluginModel['source']): boolean => !options.forceCategory || options.forceCategory === cat;

    if (includeCategory('nextmux')) {
        const autoModels: DecisionDrawerModelItem[] = [];
        const byMerchant = new Map<string, DecisionDrawerModelItem[]>();
        for (const relay of relays) {
            if (inlineOnly && !isJevModel(relay.model)) continue;
            const firstRoute = relay.routes[0];
            if (firstRoute) {
                const autoModel: AppPluginModel = {
                    source: 'nextmux', model: relay.model, label: relay.label,
                    inputPricePerMillion: firstRoute.inputPricePerMillion,
                    ...(relay.images ? { images: true } : {})
                };
                autoModels.push({
                    key: decisionModelKey(autoModel),
                    label: relay.label || relay.model,
                    model: autoModel,
                    priceLabel: firstRoute.inputPricePerMillion > 0 ? `$${formatPrice(firstRoute.inputPricePerMillion)}/M` : t(locale, 'free'),
                    incompatError: checkCompat(autoModel)
                });
            }
            for (const route of relay.routes) {
                const merchantName = route.merchant || route.offeringId;
                if (!merchantName) continue;
                const list = byMerchant.get(merchantName) || [];
                const model: AppPluginModel = {
                    source: 'nextmux', model: relay.model, label: relay.label,
                    inputPricePerMillion: route.inputPricePerMillion,
                    offeringId: route.offeringId, merchant: route.merchant,
                    ...(relay.images ? { images: true } : {})
                };
                list.push({
                    key: decisionModelKey(model),
                    label: relay.label || relay.model,
                    model,
                    priceLabel: route.inputPricePerMillion > 0 ? `$${formatPrice(route.inputPricePerMillion)}/M` : t(locale, 'free'),
                    incompatError: checkCompat(model)
                });
                byMerchant.set(merchantName, list);
            }
        }
        if (autoModels.length > 0) {
            entries.push({
                key: 'nextmux:', category: 'nextmux', merchant: '',
                shortLabel: t(locale, 'anyMerchant'),
                label: `${t(locale, 'relay')} · ${t(locale, 'anyMerchant')}`,
                meta: `${t(locale, 'relay')} · ${autoModels.length}`,
                models: autoModels
            });
        }
        for (const [merchantName, models] of byMerchant.entries()) {
            entries.push({
                key: `nextmux:${merchantName}`, category: 'nextmux', merchant: merchantName,
                shortLabel: merchantName,
                label: `${t(locale, 'relay')} · ${merchantName}`,
                meta: `${t(locale, 'relay')} · ${models.length}`,
                models
            });
        }
    }

    if (includeCategory('connection')) {
        for (const conn of connections) {
            const list: DecisionDrawerModelItem[] = [];
            for (const opt of conn.decisions) {
                if (inlineOnly && !isJevModel(opt.model)) continue;
                const model: AppPluginModel = {
                    ...opt, source: 'connection', model: opt.model, label: opt.label,
                    connectionId: conn.connectionId, connectionLabel: conn.label
                };
                list.push({
                    key: decisionModelKey(model),
                    label: opt.label || opt.model,
                    model,
                    incompatError: checkCompat(model)
                });
            }
            if (list.length > 0) {
                entries.push({
                    key: `connection:${conn.connectionId}`, category: 'connection', connectionId: conn.connectionId,
                    shortLabel: conn.label, label: conn.label,
                    meta: `${t(locale, 'ownApi')} · ${list.length}`,
                    models: list
                });
            }
        }
    }

    if (includeCategory('local')) {
        for (const srv of servers) {
            const list: DecisionDrawerModelItem[] = [];
            for (const opt of srv.models) {
                if (inlineOnly && srv.protocol !== 'systemone' && !isJevModel(opt.model)) continue;
                const model: AppPluginModel = {
                    source: 'local', model: opt.model, label: opt.label || opt.model,
                    endpoint: srv.endpoint, protocol: srv.protocol,
                    ...(opt.images ? { images: true } : {})
                };
                list.push({
                    key: decisionModelKey(model),
                    label: opt.label || opt.model,
                    model,
                    incompatError: checkCompat(model)
                });
            }
            if (list.length > 0 || options.allowOtherLocal) {
                const srvLabel = srv.name === srv.endpoint ? srv.endpoint : `${srv.name} · ${srv.endpoint}`;
                entries.push({
                    key: `local:${srv.endpoint}`, category: 'local', endpoint: srv.endpoint,
                    shortLabel: srv.name || srv.endpoint, label: srvLabel,
                    meta: `${t(locale, 'local')} · ${list.length}`,
                    models: list
                });
            }
        }
        if (options.allowOtherLocal) {
            entries.push({
                key: `local:${OTHER}`, category: 'local', endpoint: OTHER,
                shortLabel: t(locale, 'otherServer'), label: t(locale, 'otherServer'),
                meta: t(locale, 'local'), isOtherLocal: true, models: []
            });
        }
    }

    if (!options.forceCategory && options.extraModels?.length) {
        for (const extra of options.extraModels) {
            const sKey = decisionSourceKeyForModel(extra);
            if (!entries.some(e => e.key === sKey)) {
                const item: DecisionDrawerModelItem = {
                    key: decisionModelKey(extra), label: extra.label || extra.model, model: extra, incompatError: checkCompat(extra)
                };
                entries.push({
                    key: sKey, category: extra.source,
                    shortLabel: extra.connectionLabel || extra.merchant || extra.endpoint || t(locale, 'relay'),
                    label: extra.connectionLabel || extra.merchant || extra.endpoint || t(locale, 'relay'),
                    meta: extra.source === 'connection' ? t(locale, 'ownApi') : extra.source === 'local' ? t(locale, 'local') : t(locale, 'relay'),
                    endpoint: extra.endpoint, connectionId: extra.connectionId, merchant: extra.merchant,
                    models: [item]
                });
            }
        }
    }

    if (options.currentModel && (!options.forceCategory || options.currentModel.source === options.forceCategory)) {
        const sKey = decisionSourceKeyForModel(options.currentModel);
        const existingSource = entries.find(e => e.key === sKey);
        const curItem: DecisionDrawerModelItem = {
            key: decisionModelKey(options.currentModel),
            label: options.currentModel.label || options.currentModel.model,
            model: options.currentModel,
            priceLabel: typeof options.currentModel.inputPricePerMillion === 'number'
                ? (options.currentModel.inputPricePerMillion > 0 ? `$${formatPrice(options.currentModel.inputPricePerMillion)}/M` : t(locale, 'free'))
                : undefined,
            incompatError: checkCompat(options.currentModel)
        };
        if (existingSource) {
            if (!existingSource.models.some(m => m.key === curItem.key)) {
                const idx = entries.indexOf(existingSource);
                entries[idx] = { ...existingSource, models: [curItem, ...existingSource.models] };
            }
        } else {
            const fallbackLabel = options.currentModel.source === 'connection'
                ? (options.currentModel.connectionLabel || options.currentModel.connectionId || t(locale, 'ownApi'))
                : options.currentModel.source === 'local'
                    ? (options.currentModel.endpoint || t(locale, 'local'))
                    : (options.currentModel.merchant || t(locale, 'anyMerchant'));
            entries.unshift({
                key: sKey, category: options.currentModel.source,
                shortLabel: fallbackLabel, label: fallbackLabel,
                meta: options.currentModel.source === 'connection' ? t(locale, 'ownApi') : options.currentModel.source === 'local' ? t(locale, 'local') : t(locale, 'relay'),
                endpoint: options.currentModel.endpoint, connectionId: options.currentModel.connectionId, merchant: options.currentModel.merchant,
                models: [curItem]
            });
        }
    }

    return entries;
}

/**
 * Dual API Source + Decision Model drawers matching the main `正文` composer popovers
 * (searchable floating drawers portaled above dialogs/canvases and clamped inside viewport).
 */
export function AppPluginDualModelPickers(props: {
    readonly locale: Locale;
    readonly sources: readonly DecisionDrawerSourceEntry[];
    readonly selectedSourceKey?: string;
    readonly selectedModel?: AppPluginModel | null;
    readonly disabled?: boolean;
    readonly loading?: boolean;
    readonly compact?: boolean;
    readonly order?: number;
    readonly allowIncompatibleSelect?: boolean;
    readonly onRescan?: () => void;
    readonly onSelectSource?: (entry: DecisionDrawerSourceEntry) => void;
    readonly onSelectModel: (model: AppPluginModel) => void;
}): React.ReactElement {
    const { locale, sources } = props;
    const [open, setOpen] = React.useState<{ kind: 'source' | 'model'; rect: DOMRect }>();
    const [sourceQuery, setSourceQuery] = React.useState('');
    const [modelQuery, setModelQuery] = React.useState('');
    const wrapRef = React.useRef<HTMLDivElement>(null);
    const portalRef = React.useRef<HTMLDivElement>(null);

    const activeSource = (props.selectedSourceKey ? sources.find(s => s.key === props.selectedSourceKey) : undefined)
        || (props.selectedModel ? sources.find(s => s.key === decisionSourceKeyForModel(props.selectedModel)) : undefined)
        || sources[0];
    const activeModels = activeSource?.models || [];
    const currentKey = props.selectedModel ? decisionModelKey(props.selectedModel) : '';
    const activeModelItem = (currentKey ? activeModels.find(m => m.key === currentKey) : undefined)
        || (props.selectedModel && activeSource?.category === props.selectedModel.source
            ? activeModels.find(m => m.model.model === props.selectedModel!.model)
            : undefined);

    const sq = sourceQuery.trim().toLowerCase();
    const visibleSources = sq
        ? sources.filter(s => `${s.label} ${s.shortLabel} ${s.meta}`.toLowerCase().includes(sq))
        : sources;
    const mq = modelQuery.trim().toLowerCase();
    const visibleModels = mq
        ? activeModels.filter(m => `${m.label} ${m.model.model}`.toLowerCase().includes(mq))
        : activeModels;

    React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined;
        const onMouseDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (!target) return;
            if (wrapRef.current?.contains(target) || portalRef.current?.contains(target)) return;
            setOpen(undefined);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(undefined);
        };
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);

    const sourceLabel = activeSource?.shortLabel || t(locale, 'allSources');
    const modelLabelText = activeModelItem?.label || (activeSource?.isOtherLocal ? t(locale, 'otherServer') : t(locale, 'chooseModel'));

    return <div ref={wrapRef} className={`nmx-plugin-dual-pickers${props.compact ? ' is-compact' : ''}`}
        style={props.order !== undefined ? { order: props.order } : undefined}>
        <button type='button' className='nmx-composer-relay-button nmx-plugin-drawer-trigger is-source'
            aria-haspopup='dialog' aria-expanded={open?.kind === 'source'}
            disabled={props.disabled || (!sources.length && !props.onRescan)}
            title={activeSource?.label || t(locale, 'apiSource')}
            onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setSourceQuery('');
                setOpen(prev => prev?.kind === 'source' ? undefined : { kind: 'source', rect });
            }}>
            <span className='nmx-plugin-trigger-caption'>{t(locale, 'apiSource')}</span>
            <span className='nmx-plugin-trigger-value' data-nmx-literal>{sourceLabel}</span>
            <i className='codicon codicon-chevron-down' aria-hidden='true' />
        </button>
        <button type='button' className='nmx-route-button nmx-composer-model-button nmx-plugin-drawer-trigger is-model'
            aria-haspopup='dialog' aria-expanded={open?.kind === 'model'}
            disabled={props.disabled || activeModels.length === 0}
            title={activeModelItem ? `${activeModelItem.label}${activeModelItem.priceLabel ? ` · ${activeModelItem.priceLabel}` : ''}` : t(locale, 'decisionModel')}
            onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setModelQuery('');
                setOpen(prev => prev?.kind === 'model' ? undefined : { kind: 'model', rect });
            }}>
            <span className='nmx-plugin-trigger-caption'>{t(locale, 'decisionModel')}</span>
            <span className='nmx-plugin-trigger-value' data-nmx-literal>{modelLabelText}</span>
            <i className='codicon codicon-chevron-down' aria-hidden='true' />
        </button>
        {open && typeof document !== 'undefined' && (() => {
            const isSource = open.kind === 'source';
            const showSearch = isSource
                ? (sources.length > 5 || Boolean(sourceQuery.trim()))
                : (activeModels.length > 5 || Boolean(modelQuery.trim()));
            const rowCount = isSource ? visibleSources.length : visibleModels.length;
            const desiredHeight = Math.max(168, 86 + (showSearch ? 36 : 0) + Math.max(1, rowCount) * 34);
            const viewport = { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
            const placement = placeAnchoredFloatingPanel(open.rect, viewport, Math.max(RELAY_DRAWER_WIDTH, 280), desiredHeight,
                { edge: 8, gap: 8, minHeight: Math.min(desiredHeight, 150) });
            const floatingStyle = {
                '--nmx-model-picker-max-height': `${placement.maxHeight}px`,
                position: 'fixed',
                top: `${placement.top}px`,
                left: `${placement.left}px`,
                width: `${placement.width}px`,
                height: `${placement.height}px`,
                maxHeight: `${placement.maxHeight}px`,
                zIndex: 12060
            } as React.CSSProperties;
            const dialogLabel = isSource ? t(locale, 'apiSource') : t(locale, 'decisionModel');
            return createPortal(
                <div ref={portalRef} className='nmx-model-picker-portal nmx-desktop-widget' dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
                    <div className={`nmx-model-picker-surface nmx-shell ${document.querySelector('.nmx-shell.nmx-theme-light') ? 'nmx-theme-light' : 'nmx-theme-dark'}`}>
                        <section role='dialog' aria-label={dialogLabel} data-side={placement.side} style={floatingStyle}
                            className='nmx-composer-popover nmx-route-popover nmx-model-picker-popover nmx-model-only-popover nmx-plugin-drawer-popover'>
                            <header>
                                <strong>{dialogLabel}</strong>
                                {isSource && props.onRescan && <button type='button' className='nmx-plugin-drawer-refresh' disabled={props.loading}
                                    aria-label={t(locale, 'rescan')} title={t(locale, 'rescan')} onClick={props.onRescan}>
                                    <i className={`codicon codicon-${props.loading ? 'loading codicon-modifier-spin' : 'refresh'}`} aria-hidden='true' />
                                </button>}
                            </header>
                            {showSearch && <div className='nmx-model-picker-search'>
                                <i className='codicon codicon-search' aria-hidden='true' />
                                <ImeInput value={isSource ? sourceQuery : modelQuery}
                                    placeholder={t(locale, isSource ? 'searchSources' : 'searchModels')}
                                    aria-label={t(locale, isSource ? 'searchSources' : 'searchModels')}
                                    onChange={event => {
                                        const v = event.currentTarget.value;
                                        if (isSource) setSourceQuery(v); else setModelQuery(v);
                                    }} />
                            </div>}
                            {isSource ? (
                                visibleSources.length > 0 ? <div className='nmx-model-picker-list' role='listbox' aria-label={dialogLabel}>
                                    {visibleSources.map(entry => {
                                        const selected = entry.key === activeSource?.key;
                                        return <div key={entry.key} className={`nmx-model-option${selected ? ' is-selected' : ''}`}>
                                            <button type='button' role='option' aria-selected={selected} onClick={() => {
                                                props.onSelectSource?.(entry);
                                                if (!props.onSelectSource) {
                                                    const firstCompatible = entry.models.find(m => !m.incompatError) || entry.models[0];
                                                    if (firstCompatible) props.onSelectModel(firstCompatible.model);
                                                }
                                                setOpen(undefined);
                                            }}>
                                                <span className='nmx-plugin-drawer-option-copy'>
                                                    <strong data-nmx-literal>{entry.shortLabel}</strong>
                                                    <small className='nmx-plugin-drawer-option-meta' data-nmx-literal>{entry.meta}</small>
                                                </span>
                                                {selected && <i className='codicon codicon-check' aria-hidden='true' />}
                                            </button>
                                        </div>;
                                    })}
                                </div> : <div className='nmx-model-picker-list nmx-model-picker-empty-list'>
                                    <div className='nmx-route-empty' role='status'><span>{modelPickerListText(locale, 'noMatch')}</span></div>
                                </div>
                            ) : (
                                visibleModels.length > 0 ? <div className='nmx-model-picker-list' role='listbox' aria-label={dialogLabel}>
                                    {visibleModels.map(item => {
                                        const selected = item.key === activeModelItem?.key;
                                        const blocked = Boolean(item.incompatError && !props.allowIncompatibleSelect);
                                        return <div key={item.key} className={`nmx-model-option${selected ? ' is-selected' : ''}${item.incompatError ? ' is-incompatible' : ''}`}>
                                            <button type='button' role='option' aria-selected={selected} disabled={blocked}
                                                title={item.incompatError ? appPluginError(locale, item.incompatError) : item.label}
                                                onClick={() => { props.onSelectModel(item.model); setOpen(undefined); }}>
                                                <span className='nmx-plugin-drawer-option-copy'>
                                                    <strong data-nmx-literal>{item.label}</strong>
                                                    {(item.priceLabel || item.model.images || item.incompatError) && <small className='nmx-plugin-drawer-option-meta' data-nmx-literal>
                                                        {item.priceLabel ? `${item.priceLabel} ` : ''}
                                                        {item.model.images ? <i className='codicon codicon-eye' aria-hidden='true' /> : null}
                                                        {item.incompatError ? ` · ${appPluginError(locale, item.incompatError)}` : ''}
                                                    </small>}
                                                </span>
                                                {selected && <i className='codicon codicon-check' aria-hidden='true' />}
                                            </button>
                                        </div>;
                                    })}
                                </div> : <div className='nmx-model-picker-list nmx-model-picker-empty-list'>
                                    <div className='nmx-route-empty' role='status'><span>{modelPickerListText(locale, 'noMatch')}</span></div>
                                </div>
                            )}
                        </section>
                    </div>
                </div>,
                document.body
            );
        })()}
    </div>;
}

/**
 * Where a plugin's decision model runs, chosen with matching dual drawers (API Source + Decision Model): a relay
 * merchant on the platform, an own API connection, or a server on this computer (Ollama, a decision server, an
 * OpenAI-compatible chat server). Only what the chosen source really offers is listed.
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
    // Relays refused for want of an account say so, instead of looking empty (audit A14-10).
    const relaysNeedLogin = (choices?.errors || []).some(error => error.startsWith('nextmux: decision_unauthorized'));
    const empty = (key: 'noRelay' | 'noConnection' | 'noLocal') => <p className='nmx-plugin-muted'>{t(locale, key === 'noRelay' && relaysNeedLogin ? 'relayLogin' : key)}</p>;
    const decisionCatalog = buildDecisionPickerCatalog(locale, choices, probed, {
        decisions: plugin.summary?.decisions || [],
        currentModel: decision,
        allowOtherLocal: source === 'local',
        forceCategory: source
    });
    const selectedDecisionSourceKey = source === 'nextmux' ? `nextmux:${merchant}`
        : source === 'connection' ? `connection:${connection?.connectionId || ''}`
            : `local:${server?.endpoint || OTHER}`;
    const visionSources: readonly DecisionDrawerSourceEntry[] = (visionSource === 'connection'
        ? visionConnections.map(item => ({
            key: `connection:${item.connectionId}`,
            category: 'connection' as const,
            connectionId: item.connectionId,
            shortLabel: item.label,
            label: item.label,
            meta: `${t(locale, 'ownApi')} · ${item.vision.length}`,
            models: item.vision.map(m => {
                const modelObj: AppPluginModel = { ...m, source: 'connection', model: m.model, label: m.label || m.model, connectionId: item.connectionId, connectionLabel: item.label, images: true };
                return { key: decisionModelKey(modelObj), label: m.label || m.model, model: modelObj };
            })
        }))
        : visionServers.map(item => {
            const imgs = item.models.filter(m => m.images);
            return {
                key: `local:${item.endpoint}`,
                category: 'local' as const,
                endpoint: item.endpoint,
                shortLabel: item.name || item.endpoint,
                label: `${item.name} · ${item.endpoint}`,
                meta: `${t(locale, 'local')} · ${imgs.length}`,
                models: imgs.map(m => {
                    const modelObj: AppPluginModel = { source: 'local', model: m.model, label: m.label || m.model, endpoint: item.endpoint, protocol: item.protocol, images: true };
                    return { key: decisionModelKey(modelObj), label: m.label || m.model, model: modelObj };
                })
            };
        }));
    const selectedVisionSourceKey = visionSource === 'connection'
        ? `connection:${visionConnection?.connectionId || ''}`
        : `local:${visionServer?.endpoint || ''}`;
    const selectedVisionModelObj: AppPluginModel | null = visionValue
        ? (visionValue.source === 'connection'
            ? { source: 'connection', model: visionValue.model, label: visionValue.model, connectionId: visionValue.connectionId, connectionLabel: visionValue.connectionLabel, images: true }
            : { source: 'local', model: visionValue.model, label: visionValue.model, endpoint: visionValue.endpoint, protocol: visionValue.protocol, images: true })
        : null;
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
                <AppPluginDualModelPickers locale={locale} sources={decisionCatalog} selectedSourceKey={selectedDecisionSourceKey}
                    selectedModel={decision} loading={props.loading} allowIncompatibleSelect onRescan={props.onRescan}
                    onSelectSource={entry => { setMerchant(entry.merchant || ''); setRelayModel(''); }}
                    onSelectModel={picked => { setRelayModel(picked.model); }} />
                {route && <p className='nmx-plugin-price' data-nmx-literal>{route.inputPricePerMillion > 0 ? t(locale, 'price', { price: formatPrice(route.inputPricePerMillion) }) : t(locale, 'free')}</p>}
            </div> : empty('noRelay'))
                : source === 'connection' ? (connections.length ? <div className='nmx-plugin-pickers'>
                    <AppPluginDualModelPickers locale={locale} sources={decisionCatalog} selectedSourceKey={selectedDecisionSourceKey}
                        selectedModel={decision} loading={props.loading} allowIncompatibleSelect onRescan={props.onRescan}
                        onSelectSource={entry => { setConnectionId(entry.connectionId || ''); setConnectionModel(''); }}
                        onSelectModel={picked => { setConnectionModel(picked.model); }} />
                </div> : empty('noConnection'))
                    : <div className='nmx-plugin-pickers'>
                        {!servers.length && endpoint !== OTHER && empty('noLocal')}
                        <AppPluginDualModelPickers locale={locale} sources={decisionCatalog} selectedSourceKey={selectedDecisionSourceKey}
                            selectedModel={decision} loading={props.loading} allowIncompatibleSelect onRescan={props.onRescan}
                            onSelectSource={entry => { setEndpoint(entry.endpoint || OTHER); setLocalModel(''); setProbeFailed(false); }}
                            onSelectModel={picked => { setLocalModel(picked.model); }} />
                        {(endpoint === OTHER || !server) && <label className='nmx-plugin-field'><span>{t(locale, 'endpoint')}</span>
                            <div className='nmx-plugin-inline'><ImeInput value={typed} spellCheck={false} maxLength={200} onChange={event => { setTyped(event.currentTarget.value); setProbeFailed(false); }} />
                                <button type='button' disabled={probing || !typed.trim()} onClick={() => void probe()}>{probing ? t(locale, 'loading') : t(locale, 'probe')}</button></div></label>}
                        {probeFailed && <p className='nmx-plugin-muted is-error'>{t(locale, 'probeFailed')}</p>}
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
                    <AppPluginDualModelPickers locale={locale} sources={visionSources} selectedSourceKey={selectedVisionSourceKey}
                        selectedModel={selectedVisionModelObj} compact
                        onSelectSource={entry => { setVisionPlace(entry.connectionId || ''); setVisionName(''); }}
                        onSelectModel={picked => { setVisionName(picked.model); }} />
                </> : <p className='nmx-plugin-muted'>{t(locale, 'noVisionConnection')}</p>
                : visionServers.length ? <>
                    <AppPluginDualModelPickers locale={locale} sources={visionSources} selectedSourceKey={selectedVisionSourceKey}
                        selectedModel={selectedVisionModelObj} compact
                        onSelectSource={entry => { setVisionPlace(entry.endpoint || ''); setVisionName(''); }}
                        onSelectModel={picked => { setVisionName(picked.model); }} />
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
    readonly extraModels?: readonly AppPluginModel[];
    readonly modelBusy?: boolean;
    readonly error?: string;
    readonly chatOpen?: boolean;
    readonly chatMessages?: readonly AppPluginChatMessage[];
    readonly chatBusy?: boolean;
    readonly chatModel?: AppPluginModel | null;
    readonly chatComposerModelControls?: React.ReactNode;
    readonly chatRenderMarkdown?: (text: string, key: string) => React.ReactNode;
    onSaveModel?(id: string, model: AppPluginModel, vision: AppPluginVisionModel | null, runId?: string): void;
    onChooseModel?(id: string): void;
    onConfigureParams?(id: string, params: Readonly<Record<string, unknown>>): void;
    onPickParamFile?(id: string, paramId: string, label?: string): void;
    onCommand?(command: AppPluginGoalCommand): void;
    onStart?(id: string, goal?: string): void;
    onToggleChat?(): void;
    onChatSend?(request: AppPluginChatRequest): void;
    onChatClear?(): void;
    onChatStopMessage?(messageId: string): void;
    onChatSelectModel?(model: AppPluginModel): void;
    onApplyChatToApp?(text: string): void;
}

type InlineModelSource = 'platform' | 'openrouter' | 'local';
const inlineModelSource = (model: AppPluginModel | null | undefined): InlineModelSource =>
    model?.source === 'connection' ? 'openrouter' : model?.source === 'local' ? 'local' : 'platform';
const inlineModelKey = (model: AppPluginModel): string =>
    JSON.stringify([model.source, model.connectionId || '', model.endpoint || '', model.protocol || '', model.offeringId || '', model.model]);
const isJevModel = (model: string): boolean => /(?:^|[\/~_-])jev(?:[\/_-]|$)|^systemone$/i.test(model);

/** Uses the existing platform / connection / local protocol; never saves invented endpoints or API connections. */
export function appPluginInlineModels(
    choices: AppPluginModelChoices | undefined,
    current?: AppPluginModel | null,
    options?: { readonly allModels?: boolean; readonly extraModels?: readonly AppPluginModel[] }
): AppPluginModel[] {
    const allModels = Boolean(options?.allModels);
    const models: AppPluginModel[] = [];
    const seen = new Set<string>();
    const pushModel = (model: AppPluginModel): void => {
        const key = inlineModelKey(model);
        if (seen.has(key)) return;
        seen.add(key);
        models.push(model);
    };
    for (const model of choices?.relays || []) {
        if ((!allModels && !isJevModel(model.model)) || !model.routes.length) continue;
        pushModel({ source: 'nextmux', model: model.model, label: model.label,
            inputPricePerMillion: model.routes[0].inputPricePerMillion,
            ...(model.images ? { images: true } : {}) });
    }
    for (const connection of choices?.connections || []) {
        for (const model of connection.decisions || []) {
            if (!allModels && !isJevModel(model.model)) continue;
            pushModel({ ...model, source: 'connection',
                connectionId: connection.connectionId, connectionLabel: connection.label });
        }
        if (allModels) {
            for (const model of connection.vision || []) {
                pushModel({ ...model, source: 'connection', images: true,
                    connectionId: connection.connectionId, connectionLabel: connection.label });
            }
        }
    }
    for (const server of choices?.local || []) for (const model of server.models) {
        if (!allModels && server.protocol !== 'systemone' && !isJevModel(model.model)) continue;
        pushModel({ source: 'local', model: model.model, label: model.label, endpoint: server.endpoint, protocol: server.protocol,
            ...(model.images ? { images: true } : {}) });
    }
    if (allModels && options?.extraModels?.length) {
        for (const model of options.extraModels) pushModel(model);
    }
    // Existing merchant selections, probed local endpoints and legacy models remain visible until changed.
    if (current) {
        const index = models.findIndex(model => inlineModelKey(model) === inlineModelKey(current));
        if (index < 0) models.unshift(current);
        else models[index] = current;
    }
    return models;
}

function AppPluginInlineModelBar(props: AppPluginInlineControlsProps & {
    readonly plugin: AppPluginInfo;
    readonly locale: Locale;
    readonly running?: boolean;
    readonly run?: AppPluginRunSnapshot;
}): React.ReactElement {
    const { plugin, locale } = props;
    const text = (key: Parameters<typeof appPluginOptionsText>[1]): string => appPluginOptionsText(locale, key);
    const current = (props.running && props.run ? props.run.model : undefined) || plugin.model;
    const currentVision = props.running && props.run
        ? (props.run.vision ?? (plugin.vision || null))
        : (plugin.vision || null);
    const [source, setSource] = React.useState<InlineModelSource>(inlineModelSource(current));
    React.useEffect(() => setSource(inlineModelSource(current)), [plugin.id, props.run?.runId, current?.source]);
    const models = appPluginInlineModels(props.choices, current).filter(model => inlineModelSource(model) === source);
    const currentKey = current ? inlineModelKey(current) : '';
    const selected = models.some(model => inlineModelKey(model) === currentKey) ? currentKey : '';
    const compatible = (model: AppPluginModel): boolean => !decisionPluginCompatibility(model, plugin.summary?.decisions || [])
        && (plugin.summary?.vision !== 'required' || Boolean(model.images || currentVision));
    const save = (model: AppPluginModel | undefined): void => {
        if (!model || !compatible(model)) return;
        if (props.running && props.run?.runId) {
            props.onSaveModel?.(plugin.id, model, currentVision, props.run.runId);
        } else {
            props.onSaveModel?.(plugin.id, model, currentVision);
        }
    };
    const chooseSource = (value: InlineModelSource): void => {
        setSource(value);
        const candidates = appPluginInlineModels(props.choices, current).filter(model => inlineModelSource(model) === value && compatible(model));
        save(candidates.find(model => inlineModelKey(model) === currentKey) || candidates[0]);
    };
    const catalog = buildDecisionPickerCatalog(locale, props.choices, [], {
        decisions: plugin.summary?.decisions || [],
        visionMode: plugin.summary?.vision,
        currentVision,
        currentModel: current,
        extraModels: props.extraModels,
        filterInline: true
    });
    const selectedSourceKey = current ? decisionSourceKeyForModel(current)
        : catalog.find(item => inlineModelSource({ source: item.category, model: '' }) === source)?.key;
    return <div className='nmx-plugin-inline-model-bar' role='group' aria-label={text('modelBar')}>
        <span className='nmx-plugin-inline-model-title' style={{ order: 1 }}><i className='codicon codicon-hubot' aria-hidden='true'></i>{text('modelBar')}</span>
        {/* First button in DOM order preserves inline details/test indexing; flex order places it on the trailing edge. */}
        <button type='button' className='nmx-plugin-inline-more' style={{ order: 3 }} disabled={props.modelBusy || !props.onChooseModel} onClick={() => props.onChooseModel?.(plugin.id)}>
            <i className='codicon codicon-settings-gear' aria-hidden='true'></i>{text('moreSettings')}</button>
        <AppPluginDualModelPickers locale={locale} sources={catalog} selectedSourceKey={selectedSourceKey} selectedModel={current}
            disabled={props.modelBusy || !props.onSaveModel} compact order={2}
            onSelectSource={entry => {
                setSource(inlineModelSource({ source: entry.category, model: '' }));
                const firstCompat = entry.models.find(item => !item.incompatError)?.model;
                if (firstCompat) save(firstCompat);
            }}
            onSelectModel={picked => {
                setSource(inlineModelSource(picked));
                save(picked);
            }} />
        {props.running && <small className='nmx-plugin-muted' style={{ order: 4 }}>{appPluginRuntimeText(locale, 'modelChangesImmediate')}</small>}
        {!models.some(compatible) && <small className='nmx-plugin-muted' style={{ order: 5 }}>{text('noModelInSource')}</small>}
        <div className='nmx-sr-only' aria-hidden='true' style={{ order: 6 }}>
            <select tabIndex={-1} aria-label={text('modelSource')} value={source} disabled={props.modelBusy || !props.onSaveModel} onChange={event => chooseSource(event.currentTarget.value as InlineModelSource)}>
                <option value='platform'>{text('sourcePlatform')}</option>
                <option value='openrouter'>{text('sourceOpenRouter')}</option>
                <option value='local'>{text('sourceLocal')}</option>
            </select>
            <select tabIndex={-1} aria-label={text('jevModel')} value={selected} disabled={props.modelBusy || !props.onSaveModel || !models.length}
                onChange={event => save(models.find(model => inlineModelKey(model) === event.currentTarget.value))}>
                {!selected && <option value='' disabled>{text('chooseAvailable')}</option>}
                {models.map(model => <option key={inlineModelKey(model)} value={inlineModelKey(model)} disabled={!compatible(model)}>
                    {model.model}{model.source === 'connection' ? ` · ${model.connectionLabel || model.connectionId}`
                        : model.source === 'local' ? ` · ${model.protocol} · ${model.endpoint}` : model.merchant ? ` · ${model.merchant}` : ''}</option>)}
            </select>
        </div>
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
    readonly choices?: AppPluginModelChoices;
    readonly extraModels?: readonly AppPluginModel[];
    readonly modelBusy?: boolean;
    onSaveModel?(id: string, model: AppPluginModel, vision: AppPluginVisionModel | null): void;
    onRescan?(): void;
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
    const [pickedSourceKey, setPickedSourceKey] = React.useState<string>('');
    const minutesValue = Math.max(1, Math.min(summary.maxRunMinutes, Math.round(Number(minutes) || 0)));
    const costValue = Math.max(0.01, Math.min(100, Number(cost) || 0));
    const inputErrors = plugin.inputErrors || [];
    const budgetUnknown = plugin.budgetEnforceable === false;
    const showDualModelPickers = Boolean(props.choices && props.onSaveModel && !inputErrors.length && (summary.decisions?.length ?? 0) > 0);
    const startCatalog = showDualModelPickers
        ? buildDecisionPickerCatalog(locale, props.choices, [], {
            decisions: summary.decisions,
            visionMode: summary.vision,
            currentVision: plugin.vision || null,
            currentModel: plugin.model || null,
            extraModels: props.extraModels
        })
        : [];
    const activeStartSourceKey = (pickedSourceKey && startCatalog.some(s => s.key === pickedSourceKey) ? pickedSourceKey : '')
        || decisionSourceKeyForModel(plugin.model)
        || startCatalog[0]?.key
        || '';
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
        {showDualModelPickers && <div className='nmx-plugin-start-model'>
            <span className='nmx-plugin-start-model-label'>{t(locale, 'model')}</span>
            <AppPluginDualModelPickers locale={locale} sources={startCatalog} selectedSourceKey={activeStartSourceKey}
                selectedModel={plugin.model || null} disabled={props.busy || props.modelBusy} compact
                onRescan={props.onRescan}
                onSelectSource={entry => {
                    setPickedSourceKey(entry.key);
                    const first = entry.models.find(item => !item.incompatError)?.model || entry.models[0]?.model;
                    if (first) props.onSaveModel?.(plugin.id, first, plugin.vision || null);
                }}
                onSelectModel={picked => {
                    setPickedSourceKey(decisionSourceKeyForModel(picked));
                    props.onSaveModel?.(plugin.id, picked, plugin.vision || null);
                }} />
        </div>}
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

export interface AppPluginChatPanelProps {
    readonly locale: Locale;
    readonly appName?: string;
    readonly plugin?: AppPluginInfo;
    readonly plugins?: readonly AppPluginInfo[];
    readonly run?: AppPluginRunSnapshot;
    readonly choices?: AppPluginModelChoices;
    readonly extraModels?: readonly AppPluginModel[];
    readonly selectedModel?: AppPluginModel | null;
    readonly messages?: readonly AppPluginChatMessage[];
    readonly busy?: boolean;
    readonly error?: string;
    readonly composerModelControls?: React.ReactNode;
    readonly renderMarkdown?: (text: string, key: string, className?: string) => React.ReactNode;
    readonly onContentClick?: React.MouseEventHandler<HTMLElement>;
    onSelectModel?(model: AppPluginModel): void;
    onSend?(request: AppPluginChatRequest): void;
    onClear?(): void;
    onStopMessage?(messageId: string): void;
    onApplyToApp?(text: string): void;
    onClose?(): void;
}

/**
 * The conversation's own Markdown renderer for a console without one passed in (tests, other hosts): the AI Console
 * reads exactly like the main conversation, never through a second, simpler parser. One function per locale keeps
 * StreamText's per-block memo effective.
 */
const SAFE_DATA_URL_RE = /^data:(?:image\/(?:png|jpe?g|gif|webp|bmp|avif)|audio\/(?:mpeg|mp3|wav|x-wav|wave|ogg|webm|aac|flac|mp4|x-m4a)|video\/(?:mp4|webm|ogg|quicktime)|application\/pdf)(?:;[a-z0-9=._-]+)*;base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * Validates attachment URLs rendered inside `AppPluginChatPanel` so untrusted model/MCP attachments can never inject
 * `javascript:`, `vbscript:`, `file:`, `data:text/html`, or `data:image/svg+xml` payloads.
 */
export function safePluginChatAttachmentHref(att: AppPluginChatAttachment): string {
    const raw = (att.dataUrl || att.url || '').trim();
    if (raw) {
        if (/[\u0000-\u001f\u007f]/.test(raw)) return '';
        if (/^https?:\/\//i.test(raw)) {
            try {
                const parsed = new URL(raw);
                return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : '';
            } catch {
                return '';
            }
        }
        if (/^blob:/i.test(raw)) {
            try {
                const parsed = new URL(raw);
                return parsed.protocol === 'blob:' ? raw : '';
            } catch {
                return '';
            }
        }
        if (/^data:/i.test(raw)) {
            return SAFE_DATA_URL_RE.test(raw) ? raw : '';
        }
        return '';
    }
    if (typeof att.content === 'string' && att.content.length > 0) {
        const safeTextMime = att.mimeType === 'application/json' ? 'application/json' : 'text/plain';
        return `data:${safeTextMime};charset=utf-8,${encodeURIComponent(att.content)}`;
    }
    return '';
}

/**
 * Files waiting in the console's composer, within what one agent run accepts (agent-runtime's attachment check: a picture
 * the model sees as one at most 10 MB, any other file 24 MB, text 120,000 characters, all together 32 MB with the frame).
 * More, larger or empty ones are refused with a note naming why.
 */
const PLUGIN_CHAT_MAX_ATTACHMENTS = 6;
const PLUGIN_CHAT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const PLUGIN_CHAT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** All files together, leaving room in the run for the live frame. */
const PLUGIN_CHAT_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
/** Pictures the model sees as pictures (any other image type goes as a file). */
const PLUGIN_CHAT_MODEL_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
/** Read as text (the model then reads the words, not an opaque file): source code, markup, plain text and text data. */
const PLUGIN_CHAT_TEXT_DATA = new Set(['json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'geojson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
    'csv', 'tsv', 'sql', 'graphql', 'gql', 'proto', 'diff', 'patch', 'lock']);
/** A text attachment holds at most 120,000 characters (the run refuses more); a longer text keeps this many. */
const PLUGIN_CHAT_TEXT_CHARACTERS = 120_000;
const PLUGIN_CHAT_TEXT_KEPT = 110_000;
/** A longer file is decoded from its first MiB only: at most 4 bytes a character, that is over 260,000 characters. */
const PLUGIN_CHAT_TEXT_HEAD_BYTES = 1024 * 1024;

/**
 * The first MiB of a large text file, ending after a line break, or in a file with none in its second half (minified
 * JSON or JS, a one-line CSV or log) after a space or ASCII punctuation: a byte from 0x01 to 0x2f ends a character in
 * UTF-8, GB18030, Big5 and Shift_JIS (their trail bytes are 0x30 and up), and in UTF-16 the cut keeps both bytes of an
 * ASCII character. Whatever is still cut (UTF-16 text in other scripts, a half MiB with nothing to cut after) is left
 * out by the decoder (see pluginChatFileText).
 */
export function pluginChatTextHead(bytes: Uint8Array): Uint8Array {
    if (bytes.length <= PLUGIN_CHAT_TEXT_HEAD_BYTES) return bytes;
    const floor = PLUGIN_CHAT_TEXT_HEAD_BYTES / 2;
    let end = bytes.lastIndexOf(0x0a, PLUGIN_CHAT_TEXT_HEAD_BYTES - 2) + 1;
    if (end <= floor) {
        end = PLUGIN_CHAT_TEXT_HEAD_BYTES;
        for (let index = PLUGIN_CHAT_TEXT_HEAD_BYTES - 2; index >= floor; index--) {
            if (bytes[index] >= 0x01 && bytes[index] <= 0x2f) { end = index + 1; break; }
        }
    }
    if (end % 2 && bytes[end] === 0) end += 1;
    return bytes.subarray(0, end);
}

/**
 * A text-like file's words by the shared detector (the reader's language breaking ties), decoded from its head only
 * when it is large (decoding megabytes would hold the window still, and the text is cut far below its first MiB anyway).
 * A character the head cut in two is left out rather than making the whole file binary; `head` says the file was cut.
 * Undefined when it is binary after all: NUL characters, or no encoding that fits.
 */
export function pluginChatFileText(bytes: Uint8Array, locale: string): { readonly text: string; readonly head: boolean } | undefined {
    const head = pluginChatTextHead(bytes);
    const decoded = decodeTextBytes(head, locale, head === bytes ? undefined : { truncated: true });
    if (!decoded || decoded.text.includes('\0')) return undefined;
    return { text: decoded.text.replace(/^\ufeff/, ''), head: head !== bytes };
}
/** The + picker offers what a drop takes as text, as well as media and PDF. */
const PLUGIN_CHAT_PICKER_ACCEPT = ['image/*', 'video/*', 'audio/*', 'text/*', 'application/pdf', 'application/json', '.pdf',
    ...fileTypeExtensions(['code', 'markup', 'text']).map(extension => `.${extension}`),
    ...[...PLUGIN_CHAT_TEXT_DATA].map(extension => `.${extension}`)].join(',');
/**
 * A text too long for one attachment keeps its beginning, cut at a line break near PLUGIN_CHAT_TEXT_KEPT characters, and
 * tells the model what it did not get; `kept` is then the characters kept (the person is told as well, on the card).
 */
function pluginChatFitText(name: string, text: string, headOnly = false): { readonly content: string; readonly kept?: number } {
    if (text.length <= PLUGIN_CHAT_TEXT_CHARACTERS && !headOnly) return { content: text };
    let kept = text.slice(0, PLUGIN_CHAT_TEXT_KEPT);
    if (/[\ud800-\udbff]$/.test(kept)) kept = kept.slice(0, -1);
    const lineBreak = kept.lastIndexOf('\n');
    if (lineBreak > kept.length - 2_000 && lineBreak > 0) kept = kept.slice(0, lineBreak);
    const whole = headOnly ? 'is longer than 260,000 characters' : `has ${text.length.toLocaleString('en-US')} characters`;
    return { content: `${kept}\n\n[NextMux: "${name}" ${whole}; only the first ${kept.length.toLocaleString('en-US')} were attached. Tell the user if the rest matters.]`, kept: kept.length };
}
function pluginChatTextFile(file: Pick<File, 'name' | 'type'>): boolean {
    const mime = (file.type || '').toLowerCase();
    const family = fileTypeInfo(file.name, mime).family;
    return family === 'code' || family === 'markup' || family === 'text' || mime.startsWith('text/')
        || /^application\/(?:json|xml|x-yaml|yaml|toml|javascript|x-sh)$/.test(mime)
        // By extension alone: .csv is a spreadsheet to the type table, and Windows with Excel calls it application/vnd.ms-excel.
        || PLUGIN_CHAT_TEXT_DATA.has(fileExtension(file.name));
}

const pluginChatMarkdownRenderers = new Map<string, (text: string, key: string) => React.ReactNode>();
function pluginChatMarkdown(locale: Locale, className = 'nmx-assistant-markdown'): (text: string, key: string) => React.ReactNode {
    const cacheKey = `${locale}\n${className}`;
    let render = pluginChatMarkdownRenderers.get(cacheKey);
    if (!render) {
        render = (text, key) => <ConversationMarkdown key={key} markdown={normalizeConversationMarkdown(text)} className={className} locale={locale} />;
        pluginChatMarkdownRenderers.set(cacheKey, render);
    }
    return render;
}

/**
 * Interactive Multimodal AI Console & MCP Control Panel for an app tab / plugin:
 * - Shares the exact Relay Merchant / Own-API drawer & searchable Model Selector UX as the main conversation ("正文").
 * - Renders turns and composer matching the main conversation ("正文对话").
 * - Dispatches every message immediately and concurrently without queueing or locking the composer while previous replies stream.
 */
export function AppPluginChatPanel(props: AppPluginChatPanelProps): React.ReactElement {
    const { locale, plugin, run } = props;
    const defaultModel = props.selectedModel || plugin?.model || (plugin?.vision ? { ...plugin.vision, images: true } : null);
    const availableModels = appPluginInlineModels(props.choices, defaultModel, { allModels: true, extraModels: props.extraModels });
    const fallbackModel: AppPluginModel = defaultModel || availableModels[0] || { source: 'nextmux', model: '~typesafe/jev-latest', label: t(locale, 'consolePlatformModel'), images: true };
    const models = availableModels.length ? availableModels : [fallbackModel];
    const [activeKey, setActiveKey] = React.useState<string>(() => inlineModelKey(defaultModel || models[0]));
    React.useEffect(() => {
        if (props.selectedModel) setActiveKey(inlineModelKey(props.selectedModel));
        else if (plugin?.model) setActiveKey(inlineModelKey(plugin.model));
    }, [props.selectedModel ? inlineModelKey(props.selectedModel) : '', plugin?.model ? inlineModelKey(plugin.model) : '']);
    const chosenModel = models.find(item => inlineModelKey(item) === activeKey) || models[0];

    const [draft, setDraft] = React.useState<string>('');
    const [attachments, setAttachments] = React.useState<readonly AppPluginChatAttachment[]>([]);
    const [fallbackPicker, setFallbackPicker] = React.useState<{ readonly kind: 'relay' | 'model'; readonly rect: DOMRect } | undefined>();
    const [fallbackSourceKey, setFallbackSourceKey] = React.useState<string>('');
    const [fallbackModelQuery, setFallbackModelQuery] = React.useState<string>('');
    // Files dragged over the console (counted, as dragenter/dragleave also fire for its children) and the note for refused files.
    const [dragOver, setDragOver] = React.useState(false);
    const [attachNotice, setAttachNotice] = React.useState('');
    const messagesEndRef = React.useRef<HTMLDivElement>(null);
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const dragDepth = React.useRef(0);
    // Files still being read count against the limits too, so two quick drops can never overshoot them.
    const pendingReads = React.useRef(0);
    const pendingBytes = React.useRef(0);

    const messages = props.messages || [];
    const lastMsgSignature = messages.map(m => `${m.id}:${m.text.length}:${m.toolCalls?.length || 0}:${Boolean(m.streaming || m.pending)}`).join('|');
    React.useEffect(() => {
        messagesEndRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [lastMsgSignature]);

    React.useEffect(() => {
        if (!fallbackPicker || typeof document === 'undefined') return undefined;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setFallbackPicker(undefined);
        };
        const onPointerDown = (event: MouseEvent): void => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('.nmx-model-picker-portal, .nmx-composer-relay-button, .nmx-route-button')) return;
            setFallbackPicker(undefined);
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousedown', onPointerDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('mousedown', onPointerDown, true);
        };
    }, [Boolean(fallbackPicker)]);

    const activeRun = run && !run.ended ? run : undefined;
    const appTitle = props.appName || activeRun?.name || plugin?.summary?.name || t(locale, 'consoleCurrentApp');

    const submit = (textValue: string): void => {
        const clean = textValue.trim();
        if ((!clean && !attachments.length) || !props.onSend) return;
        const narrowedPluginId = activeRun
            ? activeRun.pluginId
            : (props.plugins && props.plugins.length > 1 ? undefined : plugin?.id);
        props.onSend({
            text: clean || t(locale, 'consoleFilesPrompt'),
            ...(props.composerModelControls ? {} : { model: chosenModel }),
            modality: 'auto',
            includeScreenshot: true,
            includeContext: true,
            attachments,
            pluginId: narrowedPluginId,
            runId: activeRun?.runId
        });
        setDraft('');
        setAttachments([]);
        if (textareaRef.current) textareaRef.current.style.height = '';
    };

    React.useEffect(() => {
        if (!attachNotice) return undefined;
        const timer = setTimeout(() => setAttachNotice(''), 4000);
        return () => clearTimeout(timer);
    }, [attachNotice]);

    /**
     * The + picker, a drop and a paste all end here. Text-like files are decoded to text (the shared detector, the reader's
     * language breaking ties) and a text longer than one attachment keeps its beginning, said on its card; everything else,
     * and "text" that is binary after all, goes as data. Folders are named, not read. Files still being read count against
     * the limits, so two quick drops never overshoot them.
     */
    const addFiles = (files: readonly File[], folders: readonly string[] = []): void => {
        if (!files.length && !folders.length) return;
        let count = attachments.length + pendingReads.current;
        let bytes = attachments.reduce((sum, att) => sum + (att.sizeBytes || 0), 0) + pendingBytes.current;
        // The first reason something is not added is the one the note gives; the other files are added all the same.
        let refusal = folders.length ? t(locale, 'attachFolder', { name: folders[0] }) : '';
        const megabytes = (value: number): string => `${Math.round(value / 1024 / 1024)} MB`;
        const characters = (value: number): string => value.toLocaleString(locale);
        for (const file of files) {
            const family = fileTypeInfo(file.name, file.type).family;
            const kind: AppPluginChatAttachment['kind'] = family === 'image' && file.type.startsWith('image/') ? 'image'
                : family === 'video' ? 'video' : family === 'audio' ? 'audio' : 'file';
            const cap = kind === 'image' && PLUGIN_CHAT_MODEL_IMAGES.has(file.type.toLowerCase()) ? PLUGIN_CHAT_MAX_IMAGE_BYTES : PLUGIN_CHAT_MAX_ATTACHMENT_BYTES;
            const reason = count >= PLUGIN_CHAT_MAX_ATTACHMENTS ? t(locale, 'attachCount', { count: PLUGIN_CHAT_MAX_ATTACHMENTS })
                : file.size > cap ? t(locale, 'attachTooLarge', { name: file.name, size: megabytes(cap) })
                    : bytes + file.size > PLUGIN_CHAT_MAX_TOTAL_BYTES ? t(locale, 'attachTotal', { size: megabytes(PLUGIN_CHAT_MAX_TOTAL_BYTES) }) : '';
            if (reason) { refusal ||= reason; continue; }
            count += 1;
            bytes += file.size;
            pendingReads.current += 1;
            pendingBytes.current += file.size;
            const settle = (): void => {
                pendingReads.current = Math.max(0, pendingReads.current - 1);
                pendingBytes.current = Math.max(0, pendingBytes.current - file.size);
            };
            // A name the run would refuse (line breaks, over 240 characters) is tidied, not a reason to fail the message.
            const name = file.name.replace(/[\r\n\0]+/g, ' ').trim().slice(0, 200) || 'file';
            const textLike = kind === 'file' && pluginChatTextFile({ name: file.name, type: file.type });
            const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${name}`;
            const read = (asText: boolean, binary = false): void => {
                const reader = new FileReader();
                reader.onload = () => {
                    if (asText) {
                        const decoded = reader.result instanceof ArrayBuffer ? pluginChatFileText(new Uint8Array(reader.result), locale) : undefined;
                        // Binary after all: its bytes go, typed as what they are.
                        if (!decoded) { read(false, true); return; }
                        settle();
                        const text = decoded.text;
                        if (!text) { setAttachNotice(t(locale, 'attachEmpty', { name })); return; }
                        const fitted = pluginChatFitText(name, text, decoded.head);
                        const total = decoded.head ? undefined : text.length;
                        if (fitted.kept !== undefined) {
                            const kept = fitted.kept;
                            setAttachNotice(previous => previous || (total === undefined
                                ? t(locale, 'attachCutLarge', { name, size: formatAttachmentSize(file.size), kept: characters(kept) })
                                : t(locale, 'attachCut', { name, total: characters(total), kept: characters(kept) })));
                        }
                        setAttachments(prev => prev.length >= PLUGIN_CHAT_MAX_ATTACHMENTS ? prev : [...prev, {
                            id, kind, name, mimeType: file.type.startsWith('text/') || file.type === 'application/json' ? file.type : 'text/plain', content: fitted.content,
                            sizeBytes: file.size, ...(fitted.kept !== undefined ? { keptCharacters: fitted.kept, ...(total !== undefined ? { totalCharacters: total } : {}) } : {})
                        }]);
                        return;
                    }
                    const result = typeof reader.result === 'string' ? reader.result : '';
                    settle();
                    if (!result) { setAttachNotice(t(locale, 'attachUnreadable', { name })); return; }
                    // Bytes that turned out binary say so (the widget takes the type from the data URL).
                    const dataUrl = binary ? result.replace(/^data:[^;,]*/, 'data:application/octet-stream') : result;
                    setAttachments(prev => prev.length >= PLUGIN_CHAT_MAX_ATTACHMENTS ? prev : [...prev,
                        { id, kind, name, mimeType: binary ? 'application/octet-stream' : file.type || 'application/octet-stream', dataUrl, sizeBytes: file.size }]);
                };
                // A folder that came as a file (a paste, or a drop without folder entries), or a file that went away.
                reader.onerror = () => {
                    settle();
                    setAttachNotice(t(locale, 'attachUnreadable', { name }));
                };
                if (asText) reader.readAsArrayBuffer(file); else reader.readAsDataURL(file);
            };
            // An empty file is read as well: an empty one says so, one that cannot be read at all (a folder) says that.
            read(textLike || !file.size);
        }
        if (refusal) setAttachNotice(refusal);
    };
    const onSelectFiles = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const files = Array.from(event.currentTarget.files || []);
        event.currentTarget.value = '';
        addFiles(files);
    };
    // Files dropped on the console stay here: the tab underneath never takes them. Enter, over and leave still bubble, so
    // the conversation behind (handleCodingStageDragOver) sees the pointer reach the console and puts its own drop card away.
    const carriesFiles = (event: React.DragEvent<HTMLElement>): boolean => Array.from(event.dataTransfer?.types || []).includes('Files');
    const onDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
    };
    const onDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!dragOver) setDragOver(true);
    };
    const onDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
        if (!carriesFiles(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragOver(false);
    };
    const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragOver(false);
        // Entries are read during the drop itself (the DataTransfer empties afterwards). As MDN advises and VS Code does, the
        // entry says what is a folder, whatever its File looks like (on Windows: 0 bytes, no type), so it is named, not read.
        const folders: string[] = [];
        const files: File[] = [];
        const items = Array.from(event.dataTransfer.items || []).filter(item => item.kind === 'file');
        for (const item of items) {
            const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
            const file = item.getAsFile();
            if (entry?.isDirectory) folders.push(entry.name || file?.name || '');
            else if (file) files.push(file);
        }
        addFiles(items.length ? files : Array.from(event.dataTransfer.files || []), folders);
    };
    const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
        const data = event.clipboardData;
        const files = Array.from(data?.files || []);
        if (!files.length) return;
        // A spreadsheet copy also carries a picture of its cells: its text is what was meant (as in the conversation composer).
        const lines = (data.getData?.('text/plain') || '').trim().split(/\r?\n/).filter(Boolean);
        const table = /<table[\s>]/i.test(data.getData?.('text/html') || '') || lines.length >= 2 && lines.every(line => line.includes('\t'));
        if (files.length === 1 && (files[0].type || '').startsWith('image/') && table) return;
        event.preventDefault();
        addFiles(files);
    };

    const sourceKeyForModel = (item: AppPluginModel): string => item.source === 'connection'
        ? `official:${item.connectionId || item.connectionLabel || 'api'}`
        : item.source === 'local'
            ? `local:${item.endpoint || item.protocol || 'local'}`
            : `managed:${item.merchant || 'platform'}`;
    const sourceLabelForModel = (item: AppPluginModel): string => item.source === 'connection'
        ? (item.connectionLabel || item.connectionId || t(locale, 'ownApi'))
        : item.source === 'local'
            ? `${item.protocol || 'local'}${item.endpoint ? ` · ${item.endpoint}` : ''}`
            : (item.merchant || t(locale, 'relay'));
    const activeFallbackSource = fallbackSourceKey || sourceKeyForModel(chosenModel);
    const fallbackSources = Array.from(new Map(models.map(item => [sourceKeyForModel(item), {
        key: sourceKeyForModel(item),
        label: sourceLabelForModel(item),
        source: item.source
    }])).values());
    const fallbackModelsForSource = models.filter(item => {
        if (fallbackSources.length > 1 && sourceKeyForModel(item) !== activeFallbackSource) return false;
        const q = fallbackModelQuery.trim().toLowerCase();
        if (!q) return true;
        return `${item.label || ''} ${item.model} ${sourceLabelForModel(item)}`.toLowerCase().includes(q);
    });

    const renderedModelControls = props.composerModelControls ?? <>
        <button type='button' className='nmx-composer-relay-button nmx-plugin-chat-relay-trigger'
            aria-haspopup='dialog' aria-expanded={fallbackPicker?.kind === 'relay'} title={sourceLabelForModel(chosenModel)}
            onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setFallbackPicker(prev => prev?.kind === 'relay' ? undefined : { kind: 'relay', rect });
            }}>
            <span>{sourceLabelForModel(chosenModel)}</span>
            <i className='codicon codicon-chevron-down' aria-hidden='true' />
        </button>
        <button type='button' className='nmx-route-button nmx-composer-model-button nmx-plugin-chat-model-trigger'
            aria-haspopup='dialog' aria-expanded={fallbackPicker?.kind === 'model'} title={chosenModel.label || chosenModel.model}
            onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setFallbackModelQuery('');
                setFallbackPicker(prev => prev?.kind === 'model' ? undefined : { kind: 'model', rect });
            }}>
            <span>{chosenModel.label || chosenModel.model}</span>
            <i className='codicon codicon-chevron-down' aria-hidden='true' />
        </button>
        {fallbackPicker && typeof document !== 'undefined' && (() => {
            const relay = fallbackPicker.kind === 'relay';
            const sourceModelCount = fallbackSources.length > 1
                ? models.filter(item => sourceKeyForModel(item) === activeFallbackSource).length
                : models.length;
            const searchable = !relay && (sourceModelCount > 5 || Boolean(fallbackModelQuery.trim()));
            // The console drawers' own measures (renderAppPluginChatPickerPortal): 264px wide, a header, the search when
            // there are more than five models, 32px rows; placed by the trigger and kept inside the window.
            const desiredHeight = relay
                ? 52 + Math.max(2, fallbackSources.length) * 32
                : Math.max(220, 96 + (searchable ? 36 : 0) + Math.max(2, fallbackModelsForSource.length) * 32);
            const viewport = { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
            const placement = placeAnchoredFloatingPanel(fallbackPicker.rect, viewport, RELAY_DRAWER_WIDTH, desiredHeight,
                { edge: 8, gap: 10, minHeight: Math.min(desiredHeight, 150) });
            const floatingStyle = {
                '--nmx-model-picker-max-height': `${placement.maxHeight}px`,
                position: 'fixed',
                top: `${placement.top}px`,
                left: `${placement.left}px`,
                width: `${placement.width}px`,
                height: `${placement.height}px`,
                maxHeight: `${placement.maxHeight}px`,
                zIndex: 10040
            } as React.CSSProperties;
            const dialogLabel = relay ? t(locale, 'consoleChooseRelay') : t(locale, 'consoleChooseModel');
            const option = (key: string, label: string, selected: boolean, choose: () => void): React.ReactElement => (
                <div key={key} className={`nmx-model-option${selected ? ' is-selected' : ''}`}>
                    <button type='button' role='option' aria-selected={selected} onClick={choose}>
                        <span><strong data-nmx-literal>{label}</strong></span>
                        {selected && <i className='codicon codicon-check' aria-hidden='true' />}
                    </button>
                </div>
            );
            return createPortal(
                <div className='nmx-model-picker-portal nmx-desktop-widget' dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
                    <div className={`nmx-model-picker-surface nmx-shell ${document.querySelector('.nmx-shell.nmx-theme-light') ? 'nmx-theme-light' : 'nmx-theme-dark'}`}>
                        <section role='dialog' aria-label={dialogLabel} data-side={placement.side} style={floatingStyle}
                            className='nmx-composer-popover nmx-route-popover nmx-model-picker-popover nmx-model-only-popover'>
                            <header><strong>{relay ? t(locale, 'consoleSources') : dialogLabel}</strong></header>
                            {relay ? (
                                <div className='nmx-model-picker-list' role='listbox' aria-label={t(locale, 'consoleSources')}>
                                    {fallbackSources.map(source => option(source.key, source.label, source.key === activeFallbackSource, () => {
                                        setFallbackSourceKey(source.key);
                                        const first = models.find(item => sourceKeyForModel(item) === source.key);
                                        if (first) {
                                            setActiveKey(inlineModelKey(first));
                                            props.onSelectModel?.(first);
                                        }
                                        setFallbackPicker(undefined);
                                    }))}
                                </div>
                            ) : <>
                                {searchable && <div className='nmx-model-picker-search'>
                                    <i className='codicon codicon-search' aria-hidden='true' />
                                    <ImeInput value={fallbackModelQuery} placeholder={t(locale, 'consoleSearchModels')} aria-label={t(locale, 'consoleSearchModels')}
                                        onChange={event => setFallbackModelQuery(event.currentTarget.value)} />
                                </div>}
                                {fallbackModelsForSource.length > 0 ? (
                                    <div className='nmx-model-picker-list' role='listbox' aria-label={dialogLabel}>
                                        {fallbackModelsForSource.map(item => {
                                            const itemKey = inlineModelKey(item);
                                            return option(itemKey, item.label || item.model, itemKey === inlineModelKey(chosenModel), () => {
                                                setActiveKey(itemKey);
                                                props.onSelectModel?.(item);
                                                setFallbackPicker(undefined);
                                            });
                                        })}
                                    </div>
                                ) : (
                                    <div className='nmx-model-picker-list nmx-model-picker-empty-list'>
                                        <div className='nmx-route-empty' role='status'><span>{modelPickerListText(locale, 'noMatch')}</span></div>
                                    </div>
                                )}
                            </>}
                        </section>
                    </div>
                </div>,
                document.body
            );
        })()}
    </>;

    const handleMessagesClick = (event: React.MouseEvent<HTMLDivElement>): void => {
        const targetEl = (event.target as Element | null) ?? null;
        const downloadAnchor = targetEl?.closest?.('a[download]') as HTMLAnchorElement | null;
        if (downloadAnchor && downloadAnchor.closest?.('.nmx-plugin-chat-media-bar')) {
            const dlHref = downloadAnchor.getAttribute('href') || '';
            if (/^(?:data:|blob:)/i.test(dlHref)) return;
        }
        props.onContentClick?.(event);
        if (!event.defaultPrevented) {
            const linkLike = targetEl?.closest?.('a[href], a[data-href], .nmx-file-path-pill[data-href]');
            if (linkLike) event.preventDefault();
        }
    };

    const renderUserMessageContent = (msg: AppPluginChatMessage): React.ReactNode => {
        if (props.renderMarkdown) {
            return <div className='nmx-user-message-text'>{props.renderMarkdown(msg.text, `${msg.id}:0`, 'nmx-user-markdown')}</div>;
        }
        if (typeof document !== 'undefined') {
            return <div className='nmx-user-message-text'>{pluginChatMarkdown(locale, 'nmx-user-markdown')(msg.text, `${msg.id}:0`)}</div>;
        }
        return <div className='nmx-user-message-text nmx-user-markdown nmx-plugin-chat-text' data-nmx-literal>{msg.text}</div>;
    };

    const renderAttachmentsBlock = (msgAttachments: readonly AppPluginChatAttachment[], isUser: boolean): React.ReactElement => (
        <div className={`nmx-plugin-chat-attachments${isUser ? ' is-user' : ''}`}>
            {msgAttachments.map((att, idx) => {
                const href = safePluginChatAttachmentHref(att);
                if (att.kind === 'image') {
                    return <div key={att.id || idx} className='nmx-plugin-chat-media is-image'>
                        {href && <img src={href} alt={att.name} />}
                        <div className='nmx-plugin-chat-media-bar'>
                            <span data-nmx-literal>{att.name}</span>
                            {href && <a href={href} download={att.name}>{t(locale, 'consoleDownloadImage')}</a>}
                        </div>
                    </div>;
                }
                if (att.kind === 'video') {
                    return <div key={att.id || idx} className='nmx-plugin-chat-media is-video'>
                        {href && <video src={href} controls playsInline preload='metadata'></video>}
                        <div className='nmx-plugin-chat-media-bar'>
                            <span data-nmx-literal>{att.name}</span>
                            {href && <a href={href} download={att.name}>{t(locale, 'consoleDownloadVideo')}</a>}
                        </div>
                    </div>;
                }
                if (att.kind === 'audio') {
                    return <div key={att.id || idx} className='nmx-plugin-chat-media is-audio'>
                        {href && <audio src={href} controls preload='metadata'></audio>}
                        <div className='nmx-plugin-chat-media-bar'>
                            <span data-nmx-literal>{att.name}</span>
                            {href && <a href={href} download={att.name}>{t(locale, 'consoleDownloadAudio')}</a>}
                        </div>
                    </div>;
                }
                return <div key={att.id || idx} className='nmx-plugin-chat-media is-file'>
                    <div className='nmx-plugin-chat-media-bar'>
                        <i className='codicon codicon-file-code' aria-hidden='true'></i>
                        <strong data-nmx-literal>{att.name}</strong>
                        {att.mimeType && <small data-nmx-literal>{att.mimeType}</small>}
                        {href && <a href={href} download={att.name}>{t(locale, 'consoleDownloadFile')}</a>}
                    </div>
                    {att.content && <pre data-nmx-literal>{att.content.slice(0, 600)}</pre>}
                </div>;
            })}
        </div>
    );

    // The reply still arriving takes the send button's place as 停止 (as in the conversation composer) until something new is typed.
    const streamingReply = [...messages].reverse().find(message => message.role === 'assistant' && Boolean(message.streaming || message.pending));
    const showStop = Boolean(streamingReply && props.onStopMessage && !draft.trim() && !attachments.length);
    return <div className={`nmx-plugin-chat-panel${dragOver ? ' is-drag-over' : ''}`} role='region' aria-label={t(locale, 'aiConsole')}
        onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div className='nmx-plugin-chat-header'>
            <div className='nmx-plugin-chat-title-row'>
                <span className='nmx-plugin-chat-title'>
                    <i className='codicon codicon-comment-discussion' aria-hidden='true'></i>
                    <strong data-nmx-literal>{t(locale, 'aiConsole')}</strong>
                    <small className='nmx-plugin-chat-subtitle' data-nmx-literal title={appTitle}>{appTitle}</small>
                </span>
                <span className='nmx-plugin-chat-header-actions'>
                    {props.onClear && messages.length > 0 && <button type='button' className='nmx-plugin-chat-clear' onClick={props.onClear} title={t(locale, 'consoleClearTitle')}>
                        <i className='codicon codicon-clear-all' aria-hidden='true'></i>{t(locale, 'consoleClear')}
                    </button>}
                    {props.onClose && <button type='button' className='nmx-plugin-chat-close' aria-label={t(locale, 'close')} title={t(locale, 'close')} onClick={props.onClose}>
                        <i className='codicon codicon-close' aria-hidden='true'></i>
                    </button>}
                </span>
            </div>
        </div>
        <div className='nmx-plugin-chat-messages nmx-conversation-stream' role='log' aria-live='polite' onClick={handleMessagesClick}>
            {messages.length === 0 ? <div className='nmx-plugin-chat-empty'>
                <i className='codicon codicon-sparkle' aria-hidden='true'></i>
                <span data-nmx-literal>
                    {t(locale, 'consoleReady', { app: appTitle })}
                </span>
            </div> : messages.map(msg => msg.role === 'user' ? (
                <div key={msg.id} className='nmx-plugin-chat-turn nmx-plugin-chat-msg is-user'>
                    <div className='nmx-user-message nmx-plugin-chat-user-bubble'>
                        {msg.attachments && msg.attachments.length > 0 && renderAttachmentsBlock(msg.attachments, true)}
                        {msg.text && renderUserMessageContent(msg)}
                    </div>
                </div>
            ) : (() => {
                const isStreaming = Boolean(msg.streaming || msg.pending);
                return (
                <div key={msg.id} data-message-id={msg.id} data-reply-to-id={msg.replyToId} className={`nmx-plugin-chat-turn nmx-plugin-chat-msg is-assistant${isStreaming ? ' is-pending is-streaming' : ''}`}>
                    <div className='nmx-plugin-chat-assistant-meta'>
                        <span className='nmx-plugin-chat-assistant-model' data-nmx-literal>{msg.model || 'AI'}</span>
                        {msg.routeLabel && msg.routeLabel !== (msg.model || 'AI') && <span className='nmx-plugin-chat-assistant-route' data-nmx-literal>{msg.routeLabel}</span>}
                    </div>
                    {msg.thinking && <details className='nmx-plugin-chat-thinking'>
                        <summary>{t(locale, 'consoleThinking')}</summary>
                        <pre data-nmx-literal>{msg.thinking}</pre>
                    </details>}
                    {msg.toolCalls && msg.toolCalls.length > 0 && <div className='nmx-plugin-chat-tools'>
                        {msg.toolCalls.map((call, idx) => <span key={`${call.name}-${idx}`}
                            className={`nmx-plugin-cap-badge is-tool${call.status === 'error' ? ' is-error' : call.status === 'running' ? ' is-running' : ''}`}
                            data-nmx-literal>
                            <i className={`codicon codicon-${call.status === 'running' ? 'loading codicon-modifier-spin' : call.status === 'error' ? 'error' : 'tools'}`} aria-hidden='true'></i>
                            {call.name}{call.output ? `: ${call.output}` : ''}
                        </span>)}
                    </div>}
                    {msg.text ? (
                        <div className='nmx-gateway-content nmx-plugin-chat-markdown' data-nmx-literal>
                            {/* Same streamed blocks as the main conversation: an unfinished fence, code span or bold never flashes raw. */}
                            <StreamText text={msg.text} streaming={isStreaming} markdownKey={msg.id}
                                renderMarkdown={props.renderMarkdown || pluginChatMarkdown(locale)} />
                        </div>
                    ) : isStreaming ? (
                        <div className='nmx-plugin-chat-pending' role='status' aria-label={t(locale, 'consoleGenerating')}>
                            <span className='nmx-plugin-chat-dot' />
                            <span className='nmx-plugin-chat-dot' />
                            <span className='nmx-plugin-chat-dot' />
                        </div>
                    ) : null}
                    {isStreaming && msg.text && <span className='nmx-plugin-chat-stream-caret' aria-hidden='true' />}
                    {msg.error && <div className='nmx-plugin-muted is-error nmx-plugin-chat-error' data-nmx-literal>{msg.error}</div>}
                    {msg.attachments && msg.attachments.length > 0 && renderAttachmentsBlock(msg.attachments, false)}
                </div>
                );
            })())}
            <div ref={messagesEndRef} />
        </div>
        <form className='nmx-composer nmx-plugin-chat-composer-card' onSubmit={event => { event.preventDefault(); submit(draft); }}>
            {/* The conversation composer's file cards, sized down for the console. */}
            {attachments.length > 0 && <div className='nmx-attachment-chips nmx-plugin-chat-pending-files'>
                {attachments.map((att, idx) => <AttachmentChip key={att.id || idx} locale={locale} name={att.name}
                    kind={att.kind === 'image' ? 'image' : att.kind === 'file' && /^text\//.test(att.mimeType || '') ? 'text' : 'file'}
                    mimeType={att.mimeType}
                    meta={[formatAttachmentSize(att.sizeBytes), att.keptCharacters !== undefined ? t(locale, 'attachCutMeta', { kept: att.keptCharacters.toLocaleString(locale) }) : ''].filter(Boolean).join(' · ')}
                    hint={att.keptCharacters === undefined ? undefined : att.totalCharacters === undefined
                        ? t(locale, 'attachCutLarge', { name: att.name, size: formatAttachmentSize(att.sizeBytes), kept: att.keptCharacters.toLocaleString(locale) })
                        : t(locale, 'attachCut', { name: att.name, total: att.totalCharacters.toLocaleString(locale), kept: att.keptCharacters.toLocaleString(locale) })}
                    thumbnail={att.kind === 'image' ? safePluginChatAttachmentHref(att) || undefined : undefined}
                    onRemove={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} />)}
            </div>}
            {attachNotice && <p className='nmx-plugin-chat-attach-note' role='status' data-nmx-literal>{attachNotice}</p>}
            <ImeTextarea ref={textareaRef} className='nmx-composer-input nmx-plugin-chat-textarea' rows={1} value={draft} maxLength={8000}
                placeholder={t(locale, 'consolePlaceholder')}
                onChange={event => {
                    const el = event.currentTarget;
                    setDraft(el.value);
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(88, Math.max(24, el.scrollHeight))}px`;
                }}
                onPaste={onPaste}
                onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        submit(draft);
                    }
                }} />
            <div className='nmx-composer-footer nmx-plugin-chat-composer-bar'>
                <div className='nmx-plugin-chat-composer-tools'>
                    <label className='nmx-composer-tool nmx-plugin-chat-attach' title={t(locale, 'attachHint')}>
                        <input type='file' multiple accept={PLUGIN_CHAT_PICKER_ACCEPT} onChange={onSelectFiles} />
                        <i className='codicon codicon-add' aria-hidden='true'></i>
                    </label>
                    {renderedModelControls}
                </div>
                {showStop && streamingReply ? <button type='button' className='nmx-send-button nmx-plugin-chat-send-btn is-stop'
                    data-stop-message-id={streamingReply.id}
                    aria-label={t(locale, 'consoleStop')}
                    title={t(locale, 'consoleStop')}
                    onClick={() => props.onStopMessage?.(streamingReply.id)}>
                    <span className='nmx-stop-glyph' aria-hidden='true' />
                </button> : <button type='submit' className='nmx-send-button nmx-plugin-chat-send-btn'
                    aria-label={t(locale, 'consoleSend')}
                    title={t(locale, 'consoleSend')}
                    disabled={!draft.trim() && !attachments.length}>
                    <i className='codicon codicon-arrow-up' aria-hidden='true'></i>
                </button>}
            </div>
        </form>
        {dragOver && <ComposerDropOverlay locale={locale} />}
    </div>;
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
            {props.onToggleChat && <button type='button' className={props.chatOpen ? 'is-active' : ''} aria-pressed={Boolean(props.chatOpen)} onClick={props.onToggleChat}>
                <i className='codicon codicon-comment-discussion' aria-hidden='true'></i>{locale.startsWith('zh') ? 'AI 对话' : 'AI Chat'}
            </button>}
            {!run.ended && <button type='button' className={props.overlay ? 'is-active' : ''} aria-pressed={props.overlay} onClick={props.onToggleOverlay}>{t(locale, 'overlay')}</button>}
            {!run.ended && !run.paused && props.onPause && <button type='button' onClick={props.onPause}>{t(locale, 'pause')}</button>}
            {!run.ended && run.paused && <button type='button' onClick={props.onResume}>{t(locale, 'resume')}</button>}
            {!run.ended && <button type='button' className='is-danger' onClick={props.onStop}>{t(locale, 'stop')}</button>}
        </span>
        {props.plugin && <>
            <AppPluginInlineModelBar {...props} plugin={props.plugin} run={run} running={!run.ended} />
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
    // Readings come from plugin code (the run's signals and the window SDK's setTabOverlay): every number is checked
    // before it is drawn, so a NaN, a negative or a 1e21 never reaches the label or a style.
    const finite = (input: unknown): number | undefined => typeof input === 'number' && Number.isFinite(input) ? input : undefined;
    const unit = (input: unknown): number | undefined => {
        const n = finite(input);
        return n === undefined ? undefined : Math.min(1, Math.max(0, n));
    };
    const percent = (input: number): string => `${Math.min(100, Math.max(0, Math.round(input * 100)))}%`;
    const value = (item: AppPluginOverlayItem): string => {
        const reading = item.value as { found?: boolean; count?: number; score?: number; variant?: number; text?: string } | number | boolean | string | null;
        if (reading === null || reading === undefined) return '—';
        if (typeof reading === 'number') {
            if (!Number.isFinite(reading)) return '—';
            return item.type === 'bar' ? percent(reading) : String(Math.round(reading * 100) / 100).slice(0, 12);
        }
        if (typeof reading === 'boolean') return reading ? '✓' : '✗';
        if (typeof reading === 'object') {
            if (typeof reading.text === 'string' && reading.text.trim()) return reading.text.slice(0, 24);
            if (reading.found === false) return '—';
            // A template's best match also shows how close it is (to tune a threshold in a dry run) and which picture.
            const rawCount = finite(reading.count);
            const countValue = rawCount === undefined || rawCount < 0 ? undefined : Math.floor(rawCount);
            const count = countValue === undefined ? '' : `×${countValue > 9999 ? '9999+' : countValue}`;
            const scoreValue = finite(reading.score);
            const score = scoreValue === undefined ? '' : `${count ? ' ' : ''}${percent(scoreValue)}`;
            const variantIndex = finite(reading.variant), variants = finite(item.variants);
            const variant = variants && variantIndex !== undefined && Number.isInteger(variantIndex) && variantIndex >= 0 && variantIndex < variants
                ? ` ${variantIndex + 1}/${Math.round(variants)}` : '';
            const formatted = `${count}${score}${variant}`.trim();
            return formatted || (reading.found === true ? '✓' : '—');
        }
        return String(reading).slice(0, 24);
    };
    const off = (item: AppPluginOverlayItem): string => item.active === false ? ' is-off' : '';
    const pct = (n: number): string => `${n * 100}%`;
    return <div className='nmx-plugin-overlay' aria-hidden='true'>
        {props.items.map((item, itemIndex) => {
            // Every area the signal read this frame; only the first carries the label.
            const sourceAreas: readonly (readonly number[])[] = item.rects?.length ? item.rects : item.rect ? [item.rect] : [];
            const areas: readonly (readonly number[])[] = sourceAreas.flatMap(rect => {
                const box: (number | undefined)[] = Array.isArray(rect) ? rect.slice(0, 4).map(unit) : [];
                return box.length === 4 && box.every(n => n !== undefined) ? [box as readonly number[]] : [];
            });
            const rawHits: unknown = item.value && typeof item.value === 'object' ? (item.value as { items?: unknown }).items : undefined;
            const hits: readonly (readonly [number, number])[] = (item.type === 'template' || item.type === 'text') && Array.isArray(rawHits)
                ? rawHits.slice(0, 64).flatMap((found: unknown) => {
                    const at = (found && typeof found === 'object' ? found : {}) as { x?: unknown; y?: unknown };
                    const x = unit(at.x), y = unit(at.y);
                    return x === undefined || y === undefined ? [] : [[x, y] as const];
                })
                : [];
            const sourcePoints: readonly (readonly [number, number, string])[] = item.points || [];
            const points: readonly (readonly [number, number])[] = sourcePoints.flatMap(point => {
                const x = unit(point[0]), y = unit(point[1]);
                return x === undefined || y === undefined ? [] : [[x, y] as const];
            });
            // Ids come from plugin code and may repeat: the position keeps React's keys unique. A box touching the
            // picture's top edge carries its label inside, where the tab does not clip it.
            return <React.Fragment key={`${itemIndex}:${item.id}`}>
                {areas.map((rect, index) => <div key={`r${index}`}
                    className={`nmx-plugin-overlay-box is-${item.type}${off(item)}${index === 0 && rect[1] < 0.06 ? ' is-label-inside' : ''}`}
                    style={{ left: pct(rect[0]), top: pct(rect[1]), width: pct(Math.min(rect[2], 1 - rect[0])), height: pct(Math.min(rect[3], 1 - rect[1])) }}>
                    {index === 0 && <span data-nmx-literal>{item.id} {value(item)}</span>}</div>)}
                {hits.map(([x, y], index) =>
                    <div key={`h${index}`} className='nmx-plugin-overlay-hit' style={{ left: pct(x), top: pct(y) }}></div>)}
                {points.map(([x, y], index) => <div key={`p${index}`} className={`nmx-plugin-overlay-point${off(item)}`} style={{ left: pct(x), top: pct(y) }}></div>)}
            </React.Fragment>;
        })}
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
            {props.onToggleChat && <button type='button' className={props.chatOpen ? 'is-active' : ''} aria-pressed={Boolean(props.chatOpen)} onClick={() => { props.onToggleChat?.(); props.onClose?.(); }}>
                <i className='codicon codicon-comment-discussion' aria-hidden='true'></i>{locale.startsWith('zh') ? 'AI 控制台' : 'AI Console'}
            </button>}
            <button type='button' onClick={props.onStudio}><i className='codicon codicon-symbol-color' aria-hidden='true'></i>{t(locale, 'studio')}</button>
            <button type='button' onClick={props.onManage}><i className='codicon codicon-settings-gear' aria-hidden='true'></i>{t(locale, 'manage')}</button>
            <span className='nmx-plugin-footer-space'></span>
            <button type='button' onClick={props.onBrowseAll}>{t(locale, 'hubBrowseAll')}</button>
        </>}>
        <section className='nmx-plugin-hub-section'>
            <h3 data-nmx-literal>{t(locale, 'hubInstalled', { app: props.appName })}</h3>
            {props.error && <p className='nmx-plugin-muted is-error' role='alert' data-nmx-literal>{props.error}</p>}
            {props.compatible.length ? <ul className='nmx-plugin-hub-list'>{props.compatible.map(plugin => {
                const livePluginRun = props.activeRun && !props.activeRun.ended && props.activeRun.pluginId === plugin.id ? props.activeRun : undefined;
                return <li key={plugin.id}>
                    <PluginIcon icon={plugin.icon} size={36} />
                    <div className='nmx-plugin-hub-text'><strong data-nmx-literal>{plugin.summary?.name || plugin.id}</strong>
                        <small data-nmx-literal>{plugin.ready ? (plugin.summary?.decisions?.length ? modelLabel((livePluginRun?.model || plugin.model), locale) : t(locale, 'ready')) : t(locale, 'needsModel')}</small>
                        <AppPluginInlineModelBar {...props} plugin={plugin} run={livePluginRun} running={Boolean(livePluginRun)} />
                        <AppPluginParamsBar locale={locale} plugin={plugin}
                            values={(livePluginRun ? livePluginRun.params : undefined) || plugin.params}
                            onConfigureParams={props.onConfigureParams} onPickParamFile={props.onPickParamFile} />
                        <AppPluginGoalControls {...props} plugin={plugin} />
                    </div>
                </li>;
            })}</ul> : <p className='nmx-plugin-muted'>{t(locale, 'noCompatible')}</p>}
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
    return plugins.filter(plugin => plugin.ok && plugin.enabled !== false && plugin.summary?.apps.some(app => {
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

export interface AppPluginTabHeaderControlsProps {
    readonly locale: Locale;
    readonly plugin?: AppPluginInfo;
    readonly run?: AppPluginRunSnapshot;
    readonly now: number;
    readonly windowOpen: boolean;
    readonly overlayVisible: boolean;
    readonly hasOverlayContent: boolean;
    readonly canToggleWindow: boolean;
    readonly onToggleWindow: () => void;
    readonly onToggleOverlay?: () => void;
    readonly onPause?: () => void;
    readonly onResume?: () => void;
    readonly onStop?: () => void;
}

/** Compact tab-header plugin chip & active-run pill replacing the heavy canvas-top run bar. */
export function AppPluginTabHeaderControls(props: AppPluginTabHeaderControlsProps): React.ReactElement | null {
    const { locale, run, plugin } = props;
    if (!props.canToggleWindow && !run) return null;
    const failure = run?.error ? modelFailure(locale, run.readableError || run.error) : undefined;
    const elapsed = run
        ? (run.ended ? run.elapsedMs : run.elapsedMs + Math.max(0, props.now - (run.startedAt + run.elapsedMs)))
        : 0;
    const active = Boolean(run && !run.ended);
    const chipTitle = props.windowOpen ? t(locale, 'pluginWindowClose') : t(locale, 'pluginWindowOpen');
    return <div className='nmx-visual-tab-plugin-controls'>
        {props.canToggleWindow && <button type='button'
            className={`nmx-visual-tab-plugin-chip${props.windowOpen ? ' is-active' : ''}${active ? (run?.paused ? ' is-paused' : ' is-running') : ''}`}
            aria-pressed={props.windowOpen}
            title={plugin?.summary?.ui?.title || plugin?.summary?.name || chipTitle}
            onClick={props.onToggleWindow}>
            {active && <span className={`nmx-visual-tab-plugin-dot${run?.paused ? ' is-paused' : ''}`} aria-hidden='true' />}
            <i className='codicon codicon-window' aria-hidden='true' />
            <span>{t(locale, 'pluginWindow')}</span>
        </button>}
        {run && <div className={`nmx-visual-tab-plugin-status${run.ended ? ' is-ended' : run.paused ? ' is-paused' : ' is-running'}`} role='status' aria-live='polite'>
            <span className='nmx-visual-tab-plugin-dot' aria-hidden='true' />
            <span className='nmx-visual-tab-plugin-name' data-nmx-literal title={run.goal || run.name}>{run.name}</span>
            <span className='nmx-visual-tab-plugin-meta' data-nmx-literal>
                {run.ended ? t(locale, 'ended', { reason: appPluginReason(locale, run.reason) }) : run.paused ? t(locale, 'paused') : formatDuration(elapsed)}
            </span>
            {run.costStatus === 'unknown' ? (
                <span className='nmx-visual-tab-plugin-meta' title={appPluginRuntimeText(locale, 'budgetUnknown')}>
                    <i className='codicon codicon-warning' aria-hidden='true' />
                </span>
            ) : (
                <span className='nmx-visual-tab-plugin-meta' data-nmx-literal>${formatUsd(run.costUsd)}</span>
            )}
            {failure && <span className='nmx-visual-tab-plugin-err' title={failure.detail || appPluginError(locale, run.readableError || run.error)}>
                <i className='codicon codicon-error' aria-hidden='true' />
            </span>}
            {!run.ended && props.onToggleOverlay && (props.hasOverlayContent || run) && (
                <button type='button' className={`nmx-visual-tab-plugin-action${props.overlayVisible ? ' is-active' : ''}`}
                    aria-pressed={props.overlayVisible} aria-label={t(locale, 'overlay')} title={t(locale, 'overlay')}
                    onClick={props.onToggleOverlay}>
                    <i className='codicon codicon-eye' aria-hidden='true' />
                </button>
            )}
            {!run.ended && !run.paused && props.onPause && (
                <button type='button' className='nmx-visual-tab-plugin-action'
                    aria-label={t(locale, 'pause')} title={t(locale, 'pause')} onClick={props.onPause}>
                    <i className='codicon codicon-debug-pause' aria-hidden='true' />
                </button>
            )}
            {!run.ended && run.paused && props.onResume && (
                <button type='button' className='nmx-visual-tab-plugin-action'
                    aria-label={t(locale, 'resume')} title={t(locale, 'resume')} onClick={props.onResume}>
                    <i className='codicon codicon-play' aria-hidden='true' />
                </button>
            )}
            {!run.ended && props.onStop && (
                <button type='button' className='nmx-visual-tab-plugin-action is-danger'
                    aria-label={t(locale, 'stop')} title={t(locale, 'stop')} onClick={props.onStop}>
                    <i className='codicon codicon-debug-stop' aria-hidden='true' />
                </button>
            )}
        </div>}
    </div>;
}

const RESIZE_EDGES: readonly PluginWindowResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
/** Layout effect in the app, plain effect where there is no DOM (server rendering in tests): Radix's useLayoutEffect shim. */
const useClientLayoutEffect: typeof React.useLayoutEffect = typeof document !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/** What a plugin frame shows: its registered page's URL, the page as srcdoc (no desktop app), or why it cannot. */
export type AppPluginFrameSource =
    | { readonly kind: 'none' }
    | { readonly kind: 'pending' }
    | { readonly kind: 'url'; readonly url: string }
    | { readonly kind: 'srcdoc'; readonly html: string }
    | { readonly kind: 'error'; readonly error: string };

function pluginUiDocumentBridge(): Required<Pick<NonNullable<Window['nextmuxDesktop']>, 'registerAppPluginUiDocument' | 'releaseAppPluginUiDocument'>> | undefined {
    const bridge = typeof window !== 'undefined' ? window.nextmuxDesktop : undefined;
    return bridge && typeof bridge.registerAppPluginUiDocument === 'function' && typeof bridge.releaseAppPluginUiDocument === 'function'
        ? { registerAppPluginUiDocument: html => bridge.registerAppPluginUiDocument!(html), releaseAppPluginUiDocument: token => bridge.releaseAppPluginUiDocument!(token) }
        : undefined;
}

/**
 * A plugin page as a frame source. In the desktop app the page is registered with the main process and the frame loads
 * it from its nextmux-plugin-ui: URL (apps/desktop/plugin-ui-scheme.cjs): a srcdoc page would inherit the app page's
 * policy, which refuses every inline script, the plugin bridge's included. Each distinct page is registered once (an
 * equal string re-rendered is the same page); a newer page replaces the shown one only once its URL is ready, so the
 * frame never flashes empty; a page is released once another replaced it in the frame or the frame is gone. Outside the
 * desktop app, or when the main process cannot take the page (no handler), the frame shows it as srcdoc, as before.
 */
export function useAppPluginFrameSource(html: string): AppPluginFrameSource {
    const [shown, setShown] = React.useState<{ readonly html: string; readonly token?: string; readonly url?: string; readonly fallback?: boolean; readonly error?: string }>();
    React.useEffect(() => {
        const bridge = pluginUiDocumentBridge();
        if (!html || !bridge) {
            setShown(undefined);
            return undefined;
        }
        let active = true;
        Promise.resolve().then(() => bridge.registerAppPluginUiDocument(html)).then(result => {
            const token = result?.ok === true && typeof result.token === 'string' ? result.token : undefined;
            const url = token && result.ok && isAppPluginUiDocumentUrl(result.url) ? result.url : undefined;
            if (token && (!active || !url)) void bridge.releaseAppPluginUiDocument(token).catch(() => undefined);
            if (!active) return;
            if (token && url) setShown({ html, token, url });
            else setShown({ html, error: result && result.ok === false && typeof result.error === 'string' && result.error ? result.error : 'plugin_ui_document_failed' });
        }, () => {
            if (active) setShown({ html, fallback: true });
        });
        return () => { active = false; };
    }, [html]);
    const shownToken = shown?.token;
    React.useEffect(() => {
        if (!shownToken) return undefined;
        return () => { void pluginUiDocumentBridge()?.releaseAppPluginUiDocument(shownToken).catch(() => undefined); };
    }, [shownToken]);
    if (!html) return { kind: 'none' };
    if (!pluginUiDocumentBridge()) return { kind: 'srcdoc', html };
    if (shown?.html === html) {
        return shown.url ? { kind: 'url', url: shown.url }
            : shown.fallback ? { kind: 'srcdoc', html }
                : { kind: 'error', error: shown.error || 'plugin_ui_document_failed' };
    }
    return shown?.url ? { kind: 'url', url: shown.url } : { kind: 'pending' };
}

/** The frame's document attributes: never both (srcdoc would win over src). */
function appPluginFrameDocument(source: AppPluginFrameSource): { readonly src?: string; readonly srcDoc?: string } {
    return source.kind === 'url' ? { src: source.url } : source.kind === 'srcdoc' ? { srcDoc: source.html } : {};
}

export interface AppPluginWindowDialogProps {
    readonly locale: Locale;
    readonly theme: 'dark' | 'light';
    readonly plugin: AppPluginInfo;
    readonly tabKey: string;
    readonly tabTitle: string;
    readonly binding: {
        readonly conversationId: string;
        readonly tabId: string;
        readonly pid: number;
        readonly windowId: number;
        readonly pluginId: string;
        readonly runId?: string;
    };
    readonly run?: AppPluginRunSnapshot;
    readonly bundle?: AppPluginUiBundleResult;
    readonly loading: boolean;
    readonly error?: string;
    readonly rect?: AppPluginWindowRect;
    readonly overlayVisible: boolean;
    readonly subModalOpen?: boolean;
    readonly onChangeRect: (rect: AppPluginWindowRect) => void;
    readonly onRefresh: () => void;
    readonly onClose: () => void;
    readonly onPostMessage: (
        message: AppPluginWindowInboundMessage,
        reply: (ok: boolean, result?: unknown, error?: string) => void
    ) => Promise<void> | void;
}

/**
 * Floating draggable & 8-edge resizable plugin window hosting the plugin's UI HTML bundle inside
 * a zero-`allow-same-origin` sandboxed iframe with strict `event.source` and schema validation.
 */
export function AppPluginWindowDialog(props: AppPluginWindowDialogProps): React.ReactElement {
    const { locale, theme, plugin, bundle } = props;
    const uiConfig = bundle?.ui || plugin.summary?.ui || null;
    const minBounds = React.useMemo(() => ({
        minWidth: uiConfig?.minWidth,
        minHeight: uiConfig?.minHeight
    }), [uiConfig?.minWidth, uiConfig?.minHeight]);
    const getViewport = (): { width: number; height: number } => (
        typeof window !== 'undefined'
            ? { width: Math.max(320, window.innerWidth), height: Math.max(240, window.innerHeight) }
            : { width: 1280, height: 800 }
    );
    const [interacting, setInteracting] = React.useState<'drag' | 'resize' | null>(null);
    // The rect drawn during a move/resize, and after one until the saved rect catches up: the owner stores the new
    // rect on its next render, and drawing from the old saved rect in between would flash the window back for a frame.
    const [liveRect, setLiveRect] = React.useState<AppPluginWindowRect | null>(null);
    // A viewport change only redraws: the window is clamped on screen when drawn, while the saved rect (the user's own
    // place and size) is kept, so the window returns to it when the app window grows back.
    const [, setViewportRevision] = React.useState(0);
    const activeInteractionCleanupRef = React.useRef<(() => void) | null>(null);
    const dialogRef = React.useRef<HTMLElement>(null);
    // Where the focus goes back to when the window closes: the 插件窗口 button that opened it, or the element that
    // had the focus before it first entered the window.
    const returnFocusRef = React.useRef<HTMLElement | null>(null);
    const viewport = getViewport();
    const baseRect = clampPluginWindowRect(
        props.rect || initialPluginWindowRect(viewport, uiConfig),
        viewport,
        minBounds
    );
    const rect = liveRect
        ? clampPluginWindowRect(liveRect, viewport, minBounds)
        : baseRect;
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const onChangeRectRef = React.useRef(props.onChangeRect);
    onChangeRectRef.current = props.onChangeRect;
    const onPostMessageRef = React.useRef(props.onPostMessage);
    onPostMessageRef.current = props.onPostMessage;

    const initialThemeRef = React.useRef(theme);
    const initialLocaleRef = React.useRef(locale);
    const bundleHtml = bundle?.ok && bundle.html ? bundle.html : '';
    const srcDoc = React.useMemo(() => {
        if (!bundleHtml) return '';
        return preparePluginUiHtml({ html: bundleHtml, assets: bundle?.assets }, {
            theme: initialThemeRef.current,
            locale: initialLocaleRef.current
        });
    }, [bundleHtml, bundle?.assets, plugin.id]);
    const frameSource = useAppPluginFrameSource(srcDoc);

    const syncPayload = React.useMemo(() => ({
        theme,
        locale,
        pluginId: plugin.id,
        pluginName: plugin.summary?.name || plugin.id,
        tabKey: props.tabKey,
        tabTitle: props.tabTitle,
        binding: props.binding,
        params: runOrPluginParams(props.run, plugin),
        overlayVisible: props.overlayVisible,
        run: props.run ? {
            runId: props.run.runId,
            pluginId: props.run.pluginId,
            paused: props.run.paused,
            ended: props.run.ended,
            dryRun: props.run.dryRun,
            goal: props.run.goal,
            costUsd: props.run.costUsd,
            costStatus: props.run.costStatus,
            elapsedMs: props.run.elapsedMs,
            lastDecision: props.run.lastDecision,
            reason: props.run.reason,
            error: props.run.error
        } : null
    }), [theme, locale, plugin, props.tabKey, props.tabTitle, props.binding, props.overlayVisible, props.run]);
    const syncPayloadRef = React.useRef(syncPayload);
    syncPayloadRef.current = syncPayload;

    const postToFrame = React.useCallback((payload: unknown): void => {
        try {
            iframeRef.current?.contentWindow?.postMessage(payload, '*');
        } catch {
            // Frame may have been torn down mid-async call.
        }
    }, []);

    React.useEffect(() => {
        if (!srcDoc) return;
        postToFrame({ channel: APP_PLUGIN_WINDOW_CHANNEL, type: 'sync', payload: syncPayload });
    }, [srcDoc, syncPayload, postToFrame]);

    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let frame = 0;
        const redraw = (): void => setViewportRevision(revision => revision + 1);
        const onWindowResize = (): void => {
            if (typeof requestAnimationFrame !== 'function') { redraw(); return; }
            if (frame) return;
            frame = requestAnimationFrame(() => { frame = 0; redraw(); });
        };
        window.addEventListener('resize', onWindowResize);
        return () => {
            window.removeEventListener('resize', onWindowResize);
            if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        };
    }, []);

    // The owner saved the finished move/resize (or replaced the rect): draw from the saved rect again.
    React.useEffect(() => {
        if (!activeInteractionCleanupRef.current) setLiveRect(null);
    }, [props.rect?.x, props.rect?.y, props.rect?.width, props.rect?.height]);

    React.useEffect(() => () => {
        activeInteractionCleanupRef.current?.();
    }, []);

    // Opened from the tab's 插件窗口 button, the window takes the focus (WAI-ARIA dialog pattern); a window that only
    // re-appears because its tab is active again leaves the focus where it is. Closing hands the focus back when it
    // was inside the window (or already lost), like Radix FocusScope / VS Code's dialogs.
    useClientLayoutEffect(() => {
        const node = dialogRef.current;
        if (typeof document === 'undefined' || !node) return undefined;
        const active = document.activeElement as HTMLElement | null;
        if (active && typeof active.closest === 'function' && active.closest('.nmx-visual-tab-plugin-chip')) {
            returnFocusRef.current = active;
            node.focus({ preventScroll: true });
        }
        return () => {
            const current = document.activeElement;
            const target = returnFocusRef.current;
            if ((!current || current === document.body || node.contains(current)) && target?.isConnected && !node.contains(target)) {
                target.focus({ preventScroll: true });
            }
        };
    }, []);
    const rememberFocusOrigin = (event: React.FocusEvent<HTMLElement>): void => {
        const from = event.relatedTarget as HTMLElement | null;
        if (!from || typeof from.focus !== 'function' || event.currentTarget.contains(from)) return;
        // Focus coming back from the plugin's own modal (removed as it closes) keeps the earlier origin.
        if (typeof from.closest === 'function' && from.closest('.nmx-plugin-subwindow-backdrop')) return;
        returnFocusRef.current = from;
    };

    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onWindowMessage = (event: MessageEvent): void => {
            if (!isValidPluginIframeEventSource(event, iframeRef.current?.contentWindow)) return;
            const parsed = parsePluginWindowPostMessage(event.data, bundle?.assets);
            if (!parsed.ok) {
                const rawReqId = event.data && typeof event.data === 'object' && typeof (event.data as { id?: unknown }).id === 'string'
                    ? (event.data as { id: string }).id : undefined;
                if (rawReqId) {
                    postToFrame({ channel: APP_PLUGIN_WINDOW_CHANNEL, type: 'response', id: rawReqId, ok: false, error: parsed.error });
                }
                return;
            }
            const msg = parsed.message;
            const reply = (ok: boolean, result?: unknown, error?: string): void => {
                if (!msg.requestId) return;
                postToFrame({
                    channel: APP_PLUGIN_WINDOW_CHANNEL,
                    type: 'response',
                    id: msg.requestId,
                    ok,
                    ...(ok ? { result } : { error: error || 'plugin_ui_error' })
                });
            };
            if (msg.kind === 'ready' || msg.kind === 'requestState') {
                postToFrame({ channel: APP_PLUGIN_WINDOW_CHANNEL, type: 'sync', payload: syncPayloadRef.current });
                reply(true, syncPayloadRef.current);
                return;
            }
            if (msg.kind === 'escape' && activeInteractionCleanupRef.current) {
                // Escape typed in the frame while the window is being moved or resized cancels that, as it does in the host.
                activeInteractionCleanupRef.current();
                reply(true);
                return;
            }
            void onPostMessageRef.current(msg, reply);
        };
        window.addEventListener('message', onWindowMessage);
        return () => window.removeEventListener('message', onWindowMessage);
    }, [bundle?.assets, postToFrame]);

    /**
     * One move or resize: pointer capture on the grip, moves coalesced to one state update per animation frame, and
     * one cleanup reached from every way the gesture can end (pointerup/pointercancel, a lost capture — bubbling to
     * window, so also when the grip itself is removed — window blur, a hidden document, unmount, or Escape, which
     * puts the window back), so the iframe shield can never stay up (react-rnd / @dnd-kit PointerSensor behaviour).
     */
    const startPointerInteraction = (
        mode: 'drag' | 'resize',
        event: React.PointerEvent<HTMLElement>,
        computeNext: (startRect: AppPluginWindowRect, dx: number, dy: number) => AppPluginWindowRect
    ): void => {
        if (event.button !== 0 || (event.pointerType === 'mouse' && event.buttons === 0)) return;
        event.preventDefault();
        activeInteractionCleanupRef.current?.();

        const handleEl = event.currentTarget;
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        const startRect = rect;
        const restoreRect = liveRect;
        let latestRect = startRect;
        let rafId = 0;
        let finished = false;

        try { handleEl.setPointerCapture?.(pointerId); } catch { /* detached or synthetic event */ }
        setInteracting(mode);

        const scheduleVisualUpdate = (nextRect: AppPluginWindowRect): void => {
            latestRect = nextRect;
            if (typeof requestAnimationFrame !== 'function') {
                setLiveRect(nextRect);
                return;
            }
            if (rafId !== 0) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                if (!finished) setLiveRect(latestRect);
            });
        };

        const cleanup = (commit: boolean): void => {
            if (finished) return;
            finished = true;
            if (rafId !== 0 && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(rafId);
                rafId = 0;
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onEnd);
                window.removeEventListener('pointercancel', onEnd);
                window.removeEventListener('lostpointercapture', onEnd, true);
                window.removeEventListener('keydown', onKeyDown, true);
                window.removeEventListener('blur', onWindowBlur);
            }
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
            try {
                if (handleEl.hasPointerCapture?.(pointerId)) handleEl.releasePointerCapture(pointerId);
            } catch { /* element may already be unmounted */ }
            if (activeInteractionCleanupRef.current === unmountAbort) activeInteractionCleanupRef.current = null;
            setInteracting(null);
            const moved = latestRect.x !== startRect.x || latestRect.y !== startRect.y
                || latestRect.width !== startRect.width || latestRect.height !== startRect.height;
            if (commit && moved) {
                // Keep drawing the dropped rect until the owner's saved rect catches up (see the effect above).
                setLiveRect(latestRect);
                onChangeRectRef.current(latestRect);
            } else {
                setLiveRect(restoreRect);
            }
        };

        const onPointerMove = (moveEvent: PointerEvent): void => {
            if (moveEvent.pointerId !== pointerId) return;
            scheduleVisualUpdate(computeNext(startRect, moveEvent.clientX - startX, moveEvent.clientY - startY));
        };
        const onEnd = (endEvent: Event): void => {
            if ('pointerId' in endEvent && (endEvent as PointerEvent).pointerId !== pointerId) return;
            cleanup(true);
        };
        // Escape during a move/resize cancels it (the window goes back) and does nothing else: consumed before the
        // host's layered Escape could close the window.
        const onKeyDown = (keyEvent: KeyboardEvent): void => {
            if (keyEvent.key !== 'Escape' || keyEvent.isComposing || keyEvent.keyCode === 229) return;
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            keyEvent.stopImmediatePropagation?.();
            cleanup(false);
        };
        const onWindowBlur = (): void => cleanup(true);
        const onVisibilityChange = (): void => {
            if (typeof document !== 'undefined' && document.hidden) cleanup(true);
        };
        const unmountAbort = (): void => cleanup(false);

        activeInteractionCleanupRef.current = unmountAbort;
        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onEnd);
            window.addEventListener('pointercancel', onEnd);
            window.addEventListener('lostpointercapture', onEnd, true);
            window.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('blur', onWindowBlur);
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }
    };

    const beginDrag = (event: React.PointerEvent<HTMLElement>): void => {
        if (event.target instanceof Element && event.target.closest('button, a, input, select')) return;
        startPointerInteraction('drag', event, (startRect, dx, dy) =>
            dragPluginWindowRect(startRect, dx, dy, getViewport(), minBounds));
    };

    const beginResize = (edge: PluginWindowResizeEdge, event: React.PointerEvent<HTMLElement>): void => {
        if (uiConfig?.resizable === false) return;
        event.stopPropagation();
        startPointerInteraction('resize', event, (startRect, dx, dy) =>
            resizePluginWindowRect(startRect, edge, dx, dy, getViewport(), minBounds));
    };

    const windowTitle = uiConfig?.title || plugin.summary?.name || plugin.id;
    const errorMsg = props.error || (bundle && !bundle.ok ? bundle.error : '') || (frameSource.kind === 'error' ? frameSource.error : '');
    const titleId = `nmx-plugin-window-title-${plugin.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const loadingState = <div className='nmx-plugin-window-state' role='status'>
        <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />
        <span>{t(locale, 'pluginWindowLoading')}</span>
    </div>;

    return <section
        ref={dialogRef}
        tabIndex={-1}
        className={`nmx-plugin-window-dialog${interacting === 'drag' ? ' is-dragging' : interacting === 'resize' ? ' is-resizing' : ''}`}
        style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
        role='dialog'
        aria-modal='false'
        aria-labelledby={titleId}
        onFocus={rememberFocusOrigin}>
        <header className='nmx-plugin-window-header' onPointerDown={beginDrag}>
            <div className='nmx-plugin-window-title'>
                <PluginIcon icon={plugin.icon} size={18} />
                <strong id={titleId} data-nmx-literal>{windowTitle}</strong>
                {props.tabTitle && <span className='nmx-plugin-window-tab' data-nmx-literal>· {props.tabTitle}</span>}
            </div>
            <div className='nmx-plugin-window-actions'>
                <button type='button' className='nmx-plugin-window-icon-btn' aria-label={t(locale, 'pluginWindowRefresh')}
                    title={t(locale, 'pluginWindowRefresh')} disabled={props.loading} onClick={props.onRefresh}>
                    <i className={`codicon codicon-${props.loading ? 'loading codicon-modifier-spin' : 'refresh'}`} aria-hidden='true' />
                </button>
                <button type='button' className='nmx-plugin-window-icon-btn' aria-label={t(locale, 'close')}
                    title={t(locale, 'close')} onClick={props.onClose}>
                    <i className='codicon codicon-close' aria-hidden='true' />
                </button>
            </div>
        </header>
        <div className='nmx-plugin-window-body'>
            {props.loading && !srcDoc ? loadingState : errorMsg ? (
                <div className='nmx-plugin-window-state is-error' role='alert'>
                    <p data-nmx-literal>{t(locale, 'pluginWindowLoadFailed', { error: errorMsg })}</p>
                    <button type='button' onClick={props.onRefresh}>{t(locale, 'pluginWindowRefresh')}</button>
                </div>
            ) : frameSource.kind === 'pending' ? loadingState : frameSource.kind === 'url' || frameSource.kind === 'srcdoc' ? (
                <iframe
                    ref={iframeRef}
                    className='nmx-plugin-window-frame'
                    title={windowTitle}
                    sandbox={APP_PLUGIN_IFRAME_SANDBOX}
                    {...appPluginFrameDocument(frameSource)}
                />
            ) : (
                <div className='nmx-plugin-window-state'>
                    <p>{t(locale, 'pluginWindowEmpty')}</p>
                </div>
            )}
            {interacting && <div className='nmx-plugin-window-shield' aria-hidden='true' />}
        </div>
        {uiConfig?.resizable !== false && RESIZE_EDGES.map(edge => (
            <div key={edge} className={`nmx-plugin-window-resize is-${edge}`} aria-hidden='true'
                onPointerDown={event => beginResize(edge, event)} />
        ))}
    </section>;
}

function runOrPluginParams(run: AppPluginRunSnapshot | undefined, plugin: AppPluginInfo): Readonly<Record<string, AppPluginParamValue>> {
    return (run?.params || plugin.params || {}) as Readonly<Record<string, AppPluginParamValue>>;
}

export interface AppPluginSubWindowDialogProps {
    readonly locale: Locale;
    readonly theme: 'dark' | 'light';
    readonly modal: AppPluginWindowSubModalSpec;
    readonly assets?: Readonly<Record<string, string>>;
    readonly onClose: () => void;
    readonly onPostMessage?: (
        message: AppPluginWindowInboundMessage,
        reply: (ok: boolean, result?: unknown, error?: string) => void
    ) => Promise<void> | void;
}

/** Focus guards (Radix FocusGuards / focus-trap): invisible, focusable, and never in the way of the pointer. */
const PLUGIN_SUBWINDOW_FOCUS_GUARD_STYLE: React.CSSProperties = {
    position: 'fixed', width: 1, height: 1, overflow: 'hidden', opacity: 0, outline: 'none', pointerEvents: 'none'
};

/**
 * Secondary floating modal requested via `NextMuxPluginUI.openModal`, isolated inside its own
 * sandboxed iframe (never `allow-same-origin` and never raw `dangerouslySetInnerHTML`).
 * Modal: it takes the focus when it opens, keeps Tab inside (guards around it catch the focus leaving the frame,
 * which the host never sees as a key press), and hands the focus back to its opener when it closes.
 */
export function AppPluginSubWindowDialog(props: AppPluginSubWindowDialogProps): React.ReactElement {
    const { locale, theme, modal, assets, onClose } = props;
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const backdropRef = React.useRef<HTMLDivElement>(null);
    const dialogRef = React.useRef<HTMLElement>(null);
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;
    const onPostMessageRef = React.useRef(props.onPostMessage);
    onPostMessageRef.current = props.onPostMessage;
    const themeRef = React.useRef(theme);
    themeRef.current = theme;
    const localeRef = React.useRef(locale);
    localeRef.current = locale;

    const initialThemeRef = React.useRef(theme);
    const initialLocaleRef = React.useRef(locale);
    const srcDoc = React.useMemo(
        () => buildPluginWindowSubModalHtml(modal, assets, { theme: initialThemeRef.current, locale: initialLocaleRef.current }),
        [modal.html, modal.text, assets]
    );
    const frameSource = useAppPluginFrameSource(srcDoc);

    const postToFrame = React.useCallback((payload: unknown): void => {
        try {
            iframeRef.current?.contentWindow?.postMessage(payload, '*');
        } catch {
            // Ignore detached modal frame.
        }
    }, []);

    React.useEffect(() => {
        postToFrame({ channel: APP_PLUGIN_WINDOW_CHANNEL, type: 'sync', payload: { theme, locale } });
    }, [theme, locale, postToFrame]);

    useClientLayoutEffect(() => {
        const node = dialogRef.current;
        if (typeof document === 'undefined' || !node) return undefined;
        const opener = document.activeElement as HTMLElement | null;
        node.focus({ preventScroll: true });
        return () => {
            const current = document.activeElement;
            if ((!current || current === document.body || node.contains(current))
                && opener && opener !== document.body && opener.isConnected && !node.contains(opener) && typeof opener.focus === 'function') {
                opener.focus({ preventScroll: true });
            }
        };
    }, []);

    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onMessage = (event: MessageEvent): void => {
            if (!isValidPluginIframeEventSource(event, iframeRef.current?.contentWindow)) return;
            const parsed = parsePluginWindowPostMessage(event.data, assets);
            if (!parsed.ok) {
                // A refused request is answered at once (as in the main window), not left to the SDK's timeout.
                const rawReqId = event.data && typeof event.data === 'object' && typeof (event.data as { id?: unknown }).id === 'string'
                    ? (event.data as { id: string }).id : undefined;
                if (rawReqId) postToFrame({ channel: APP_PLUGIN_WINDOW_CHANNEL, type: 'response', id: rawReqId, ok: false, error: parsed.error });
                return;
            }
            const msg = parsed.message;
            const reply = (ok: boolean, result?: unknown, error?: string): void => {
                if (!msg.requestId) return;
                postToFrame({
                    channel: APP_PLUGIN_WINDOW_CHANNEL,
                    type: 'response',
                    id: msg.requestId,
                    ok,
                    ...(ok ? { result } : { error: error || 'plugin_ui_error' })
                });
            };
            if (msg.kind === 'escape' || msg.kind === 'closeModal') {
                reply(true);
                onCloseRef.current();
                return;
            }
            if (msg.kind === 'ready' || msg.kind === 'requestState') {
                // The modal's SDK gets the live theme and locale as soon as it is ready (onSync fires as in the window).
                postToFrame({ channel: APP_PLUGIN_WINDOW_CHANNEL, type: 'sync', payload: { theme: themeRef.current, locale: localeRef.current } });
                if (msg.kind === 'ready') return;
            }
            const handler = onPostMessageRef.current;
            if (!handler) {
                if (msg.kind === 'requestState') reply(true, { theme: themeRef.current, locale: localeRef.current });
                else reply(false, undefined, 'plugin_ui_unsupported_type');
                return;
            }
            void handler(msg, reply);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
            // Only an Escape meant for this modal: a host dialog or menu drawn above it keeps its own Escape.
            const target = event.target as Node | null;
            const ownTarget = !target || target === document.body || target === document.documentElement
                || Boolean(backdropRef.current?.contains(target));
            if (!ownTarget) return;
            event.preventDefault();
            event.stopPropagation();
            onCloseRef.current();
        };
        window.addEventListener('message', onMessage);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('message', onMessage);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [assets, postToFrame]);

    const focusEdge = (edge: 'first' | 'last'): void => {
        const node = dialogRef.current;
        if (!node) return;
        const items = Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])'))
            .filter(item => item.getClientRects().length > 0);
        const target = edge === 'first' ? items[0] : items[items.length - 1];
        (target || node).focus({ preventScroll: true });
    };

    const viewportW = typeof window !== 'undefined' ? Math.max(300, window.innerWidth - 32) : modal.width;
    const viewportH = typeof window !== 'undefined' ? Math.max(220, window.innerHeight - 64) : modal.height;
    const width = Math.min(modal.width, viewportW);
    const height = Math.min(modal.height, viewportH);

    return <div ref={backdropRef} className='nmx-plugin-subwindow-backdrop' onMouseDown={props.onClose}>
        <span tabIndex={0} data-nmx-focus-guard='' style={PLUGIN_SUBWINDOW_FOCUS_GUARD_STYLE} onFocus={() => focusEdge('last')} />
        <section ref={dialogRef} tabIndex={-1} className='nmx-plugin-subwindow-dialog' style={{ width: `${width}px`, height: `${height}px` }}
            role='dialog' aria-modal='true' aria-labelledby='nmx-plugin-subwindow-title'
            onMouseDown={event => event.stopPropagation()}>
            <header className='nmx-plugin-subwindow-header'>
                <strong id='nmx-plugin-subwindow-title' data-nmx-literal>{modal.title || t(locale, 'pluginWindow')}</strong>
                <button type='button' className='nmx-plugin-window-icon-btn' aria-label={t(locale, 'close')}
                    title={t(locale, 'close')} onClick={props.onClose}>
                    <i className='codicon codicon-close' aria-hidden='true' />
                </button>
            </header>
            <div className='nmx-plugin-subwindow-body'>
                {frameSource.kind === 'url' || frameSource.kind === 'srcdoc' ? (
                    <iframe
                        ref={iframeRef}
                        className='nmx-plugin-window-frame'
                        title={modal.title || t(locale, 'pluginWindow')}
                        sandbox={APP_PLUGIN_IFRAME_SANDBOX}
                        {...appPluginFrameDocument(frameSource)}
                    />
                ) : frameSource.kind === 'error' ? (
                    <div className='nmx-plugin-window-state is-error' role='alert'>
                        <p data-nmx-literal>{t(locale, 'pluginWindowLoadFailed', { error: frameSource.error })}</p>
                    </div>
                ) : (
                    <div className='nmx-plugin-window-state' role='status'>
                        <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />
                        <span>{t(locale, 'pluginWindowLoading')}</span>
                    </div>
                )}
            </div>
        </section>
        <span tabIndex={0} data-nmx-focus-guard='' style={PLUGIN_SUBWINDOW_FOCUS_GUARD_STYLE} onFocus={() => focusEdge('first')} />
    </div>;
}
