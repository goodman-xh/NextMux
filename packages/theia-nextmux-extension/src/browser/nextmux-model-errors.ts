import { knownDesktopDomainText, desktopDomainFailure } from './nextmux-domain-error-locale';
import { formatModelError, MODEL_ERROR_KINDS } from '@nextmux/model-runtime/errors';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { runningTaskText } from './nextmux-running-task-locale';

export type ScenarioModelErrorOptions = NonNullable<Parameters<typeof formatModelError>[2]> & {
    readonly hasSelectedRelay?: boolean;
    readonly hasSelectedRoute?: boolean;
    readonly surface?: 'thread' | 'my_api_card';
};

function compactOwnApiNetworkText(
    locale: NextMuxDesktopLocale,
    failure: ReturnType<typeof formatModelError>,
    surface?: 'thread' | 'my_api_card'
): ReturnType<typeof formatModelError> {
    if (surface !== 'thread' && failure.kind === 'network' && failure.source === 'own_api') {
        const text = locale === 'zh-CN' ? '无法连接模型服务。' : locale === 'zh-TW' ? '無法連線模型服務。' : failure.text;
        if (text !== failure.text) return { ...failure, text };
    }
    return failure;
}

function rawErrorMessage(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (value instanceof Error) return value.message.trim();
    if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
        return (value as { message: string }).message.trim();
    }
    return '';
}

function applyRouteSelectionScenario(
    locale: NextMuxDesktopLocale,
    value: unknown,
    failure: ReturnType<typeof formatModelError>,
    context?: ScenarioModelErrorOptions
): ReturnType<typeof formatModelError> | undefined {
    const raw = rawErrorMessage(value);
    const selectRelayFirst = runningTaskText(locale, 'selectRelayFirst');
    const selectModelFirst = runningTaskText(locale, 'selectModelFirst');
    const modelUnavailable = runningTaskText(locale, 'modelUnavailable');
    const routeUnavailable = runningTaskText(locale, 'routeUnavailable');
    const isRouteError = raw === selectRelayFirst || raw === selectModelFirst || raw === modelUnavailable || raw === routeUnavailable;
    if (raw === selectRelayFirst || (context?.hasSelectedRelay === false && (isRouteError || !value || failure.kind === 'network'))) {
        return {
            ...failure,
            kind: 'relay_unavailable',
            text: selectRelayFirst,
            action: 'switch_relay',
            actionLabel: runningTaskText(locale, 'selectRelayAction'),
            retryable: false
        };
    }
    if (raw === selectModelFirst || (context?.hasSelectedRoute === false && (isRouteError || !value || failure.kind === 'network'))) {
        return {
            ...failure,
            kind: 'model_not_found',
            text: selectModelFirst,
            action: 'switch_model',
            actionLabel: runningTaskText(locale, 'selectModelAction'),
            retryable: false
        };
    }
    if (raw === modelUnavailable || raw === routeUnavailable) {
        return {
            ...failure,
            kind: 'model_not_found',
            text: raw === routeUnavailable && context?.surface !== 'thread' ? routeUnavailable : modelUnavailable,
            action: 'switch_model',
            actionLabel: runningTaskText(locale, 'switchModelAction'),
            retryable: false
        };
    }
    return undefined;
}

/** Preserve structured metadata and diagnostic detail; locale is never inferred from Unicode script. */
export function modelFailure(locale: NextMuxDesktopLocale, value: unknown, context?: ScenarioModelErrorOptions): ReturnType<typeof formatModelError> {
    const baseFailure = formatModelError(value, locale, context);
    const scenarioOverride = applyRouteSelectionScenario(locale, value, baseFailure, context);
    if (scenarioOverride) return scenarioOverride;
    const failure = compactOwnApiNetworkText(locale, baseFailure, context?.surface);
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
    const data = record?.data;
    const hasMetadata = record?.readableError || typeof record?.kind === 'string' && MODEL_ERROR_KINDS.includes(record.kind as typeof MODEL_ERROR_KINDS[number])
        || data && typeof data === 'object' && 'readableError' in data && data.readableError;
    // Explicit model/media/comic message identities beat legacy desktop code aliases.
    if (failure.domain && failure.messageKey) return failure;
    const hasDesktopMetadata = record?.domainError || data && typeof data === 'object' && 'domainError' in data && data.domainError;
    if (hasDesktopMetadata || failure.kind === 'unknown' && !failure.messageKey && !failure.domain) {
        const text = knownDesktopDomainText(locale, value);
        if (text !== undefined) {
            const desktop = desktopDomainFailure(locale, value);
            return { ...failure, domain: 'operation', kind: 'unknown', text,
                detail: desktop.detail || failure.detail, code: desktop.code ?? failure.code,
                action: 'none', actionLabel: '', retryable: false };
        }
    }
    if (failure.kind === 'network' || failure.domain || failure.httpStatus !== undefined || failure.source || hasMetadata
        || context && Object.entries(context).some(([key, item]) => key !== 'surface' && key !== 'hasSelectedRelay' && key !== 'hasSelectedRoute' && item !== undefined)) return failure;
    // Untyped mixed-operation errors have no reliable language or model provenance.
    // Keep their redacted original only in detail and present stable localized copy.
    return compactOwnApiNetworkText(locale, formatModelError({ ...failure, domain: 'operation' }, locale, context), context?.surface);
}

export function modelFailureText(locale: NextMuxDesktopLocale, value: unknown, context?: ScenarioModelErrorOptions): string {
    const failure = modelFailure(locale, value, context);
    const scenarioOverride = applyRouteSelectionScenario(locale, value, failure, context);
    if (scenarioOverride) return scenarioOverride.text;
    // Raw supplier parameter names and refusal text remain on the diagnostic
    // object. User cards show the classified reason and the available action.
    return failure.kind !== 'unknown' || !failure.domain || failure.domain === 'model'
        ? compactOwnApiNetworkText(locale, formatModelError({ kind: failure.kind, domain: failure.domain, source: failure.source,
            httpStatus: failure.httpStatus, providerFailure: failure.providerFailure,
            ...(failure.kind === 'billing_review_required' && failure.source === 'relay' && failure.causeKind === 'provider_quota_exhausted'
                ? { causeKind: failure.causeKind } : {}),
            retryAfterSeconds: failure.retryAfterSeconds, retryCount: failure.retryCount, relaySwitchCount: failure.relaySwitchCount,
            ...(/^(?:route_privacy_unavailable|device[_\s-]*link[_\s-]*required|device[_\s-]*auth[_\s-]*required|account[_\s-]*auth[_\s-]*required|sign[_\s-]*in[_\s-]*required)$/i.test(failure.code ?? '')
                ? { code: failure.code }
                : /link this desktop to your nextmux account|device[_\s-]*link[_\s-]*required|device[_\s-]*auth[_\s-]*required|account[_\s-]*auth[_\s-]*required|sign[_\s-]*in[_\s-]*required|desktop device link required|platform sign-in required|请先登录|需要先登录/i.test(failure.detail)
                    ? { code: 'device_link_required' } : {}),
            ...(failure.kind === 'request_budget_unavailable' && failure.walletAdmission
                ? { code: failure.code, walletAdmission: failure.walletAdmission } : {}) }, locale, context), context?.surface).text
        : failure.code && failure.text.includes(failure.code)
            ? formatModelError({ domain: failure.domain }, locale, context).text : failure.text;
}

export function formatScenarioModelError(locale: NextMuxDesktopLocale, value: unknown, options: ScenarioModelErrorOptions = {}): ReturnType<typeof formatModelError> {
    return modelFailure(locale, value, { surface: 'thread', ...options });
}

export function formatScenarioModelErrorText(locale: NextMuxDesktopLocale, value: unknown, options: ScenarioModelErrorOptions = {}): string {
    return modelFailureText(locale, value, { surface: 'thread', ...options });
}

/** Recorded route identity is a fallback; backend metadata remains authoritative. */
export function modelFailureSource(route: string | undefined): 'own_api' | 'relay' | 'local' | undefined {
    if (!route) return undefined;
    if (route === 'ollama' || route === 'local' || route.startsWith('local:')) return 'local';
    return route.startsWith('official:') || route === 'own_api' ? 'own_api' : 'relay';
}
