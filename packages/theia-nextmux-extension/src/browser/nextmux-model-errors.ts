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

function canvasTimelineErrorText(
    locale: NextMuxDesktopLocale,
    value: unknown,
    failure?: ReturnType<typeof formatModelError>
): string | undefined {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
    const data = record?.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : undefined;
    const rawCode = typeof record?.code === 'string' ? record.code
        : typeof data?.code === 'string' ? data.code
            : typeof failure?.code === 'string' ? failure.code : '';
    const raw = `${rawCode} ${rawErrorMessage(value)} ${failure?.detail || ''}`.trim();
    const upper = raw.toUpperCase();
    if (upper.includes('TIMELINE_VIDEO_NOT_READY') || upper.includes('SEQUENCE_NODE_NOT_READY') || /choose a completed video version for/i.test(raw)) {
        return locale === 'zh-TW'
            ? '所選影片節點尚未生成完成，請先生成影片後再送去剪輯。'
            : locale === 'en'
                ? 'The selected video node is not ready yet. Generate the video before sending it to the editor.'
                : '所选视频节点尚未生成完成，请先生成视频后再送去剪辑。';
    }
    if (upper.includes('SEQUENCE_EMPTY') || upper.includes('TIMELINE_CLIPS_EMPTY') || /the canvas has no video nodes/i.test(raw)) {
        return locale === 'zh-TW'
            ? '目前畫布暫無可剪輯的已就緒影片節點，請先生成至少一段影片。'
            : locale === 'en'
                ? 'There are no ready video nodes on the canvas yet. Generate at least one video first.'
                : '当前画布暂无可剪辑的已就绪视频节点，请先生成至少一段视频。';
    }
    if (upper.includes('SEQUENCE_CYCLE') || /playback sequences cannot contain cycles|a sequence cannot loop to itself/i.test(raw)) {
        return locale === 'zh-TW'
            ? '影片串聯連線存在循環，請斷開循環連線後再送去剪輯。'
            : locale === 'en'
                ? 'The video sequence contains a loop. Disconnect the loop before sending to the editor.'
                : '视频串联连线存在循环，请断开循环连线后再送去剪辑。';
    }
    if (upper.includes('SEQUENCE_MULTIPLE_ROOTS') || upper.includes('SEQUENCE_BRANCH') || upper.includes('SEQUENCE_CHOICE_REQUIRED')
        || /choose a branch or the order of independent video chains/i.test(raw)) {
        return locale === 'zh-TW'
            ? '偵測到多條影片串聯路徑，請在彈窗中選擇要送去剪輯的串聯路徑。'
            : locale === 'en'
                ? 'Multiple video sequence paths were detected. Choose the path to send to the editor.'
                : '检测到多条视频串联路径，请在弹窗中选择要送去剪辑的串联路径。';
    }
    if (upper.includes('CANVAS_REVISION_CONFLICT') || upper.includes('TIMELINE_INTENT_CHANGED')
        || /the source canvas changed\. reload it before creating a timeline|this request id already created another timeline intent/i.test(raw)) {
        return locale === 'zh-TW'
            ? '畫布內容剛剛發生更新，請重新點擊「進入剪輯」同步最新串聯。'
            : locale === 'en'
                ? 'The canvas was just updated. Click "Send to Editor" again to sync the latest sequence.'
                : '画布内容刚刚发生更新，请重新点击“进入剪辑”同步最新串联。';
    }
    if (upper.includes('FFMPEG_UNAVAILABLE') || /ffmpeg is required to measure source video lengths|ffmpeg is required to extract video frames|ffmpeg is unavailable/i.test(raw)) {
        return locale === 'zh-TW'
            ? '未偵測到可用的 FFmpeg 組件，無法合成剪輯預覽。'
            : locale === 'en'
                ? 'FFmpeg is unavailable, so the editor preview cannot be assembled.'
                : '未检测到可用的 FFmpeg 组件，无法合成剪辑预览。';
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
    const canvasText = canvasTimelineErrorText(locale, value, failure);
    if (canvasText !== undefined) {
        return {
            ...failure,
            domain: 'operation',
            kind: 'unknown',
            text: canvasText,
            action: 'none',
            actionLabel: '',
            retryable: false
        };
    }
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
    const canvasText = !failure.messageKey ? canvasTimelineErrorText(locale, value, failure) : undefined;
    if (canvasText !== undefined) return canvasText;
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
