import type { AgentRunEvent, ToolExecutionSummary } from '@nextmux/agent-runtime';
import { normalizedCapacityReasons, type CapacityWaitReason } from '@nextmux/model-runtime/capacity-reasons';
import type { DesktopAgentRunFailureKind } from '../common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { localizedRuntimeActivity } from './nextmux-runtime-title-locale';
import { isLikelyLegacyToolActivityPrompt, isUserFollowUpRecord, latestSemanticTaskPlanSteps } from './nextmux-agent-task-queue';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { browserActivityPhrase, browserToolIdentity, type BrowserActivityPhrase } from './nextmux-browser-activity-locale';

/** Preserve the insertion point even when the send acknowledgement arrives before the event poll. */
export function activityWithSteeringMessages(
    events: readonly AgentRunEvent[],
    messages: readonly { readonly id: string; readonly content: string; readonly createdAt: string }[] = []
): readonly AgentRunEvent[] {
    const recorded = new Set(events.flatMap(event => event.type === 'steering_accepted' ? [event.message.id] : []));
    const missing = messages.filter(message => !recorded.has(message.id));
    if (!missing.length) return events;
    const result = [...events];
    for (const message of missing) {
        const at = message.createdAt;
        const index = result.findIndex(event => event.at > at);
        result.splice(index < 0 ? result.length : index, 0, { type: 'steering_accepted', message, at });
    }
    return result;
}

/** Steps the user reads between two pieces of prose: text before them is narration, never the final answer. */
const PROSE_BOUNDARY_EVENTS: ReadonlySet<AgentRunEvent['type']> = new Set<AgentRunEvent['type']>([
    'tool_started', 'task_plan_updated', 'user_input_requested', 'steering_applied'
]);

/**
 * Walks prose segments: `onBoundary` runs where the reply before it ended. A new model request ends it, unless that
 * request continues the same reply (output limit, dropped stream); a resumed run decides at its first request.
 */
function forEachProseSegment(events: readonly AgentRunEvent[], onDelta: (index: number, event: Extract<AgentRunEvent, { readonly type: 'assistant_delta' }>) => void,
    onBoundary: (toolsFollow: boolean) => void): void {
    let resumed = false;
    for (const [index, event] of events.entries()) {
        if (event.type === 'backend_selected') resumed = true;
        else if (event.type === 'model_started') {
            if (!event.continuation) onBoundary(false);
            resumed = false;
        } else if (event.type === 'assistant_delta') {
            if (resumed) { onBoundary(false); resumed = false; }
            onDelta(index, event);
        } else if (PROSE_BOUNDARY_EVENTS.has(event.type) || event.type === 'model_completed' && event.toolCallCount > 0) onBoundary(true);
    }
    // A run that resumed but has not asked the model yet already ended the earlier prose.
    if (resumed) onBoundary(false);
}

/**
 * Model turn numbers restart after resume; classify prose by its journal position, not that number. Prose that
 * precedes a tool call, plan, question or applied steering is narration. A reply continued after the output limit
 * or a dropped stream stays one piece of prose with the text before its cut.
 */
export function completedNarrationSourceIndexes(events: readonly AgentRunEvent[]): ReadonlySet<number> {
    const indexes = new Set<number>();
    let current: number[] = [];
    forEachProseSegment(events, index => { current.push(index); }, () => {
        for (const sourceIndex of current) indexes.add(sourceIndex);
        current = [];
    });
    return indexes;
}

/** A pause result can echo the last tool-call preamble; retain that text only at its original position. */
export function finalTextAlreadyInActivity(events: readonly AgentRunEvent[], finalText: string): boolean {
    const visible = completedNarrationSourceIndexes(events);
    let text = '';
    let shown = false;
    forEachProseSegment(events, (index, event) => {
        text += event.delta;
        shown ||= visible.has(index);
    }, toolsFollow => {
        // Only a new request starts new text; a tool call keeps its preamble as the latest text.
        if (toolsFollow) return;
        text = '';
        shown = false;
    });
    return shown && Boolean(text.trim()) && text.trim() === finalText.trim();
}

export interface AgentQueuedPromptLike {
    readonly id: string;
    readonly prompt: string;
    /** Missing means a persisted queue record from before source tagging. */
    readonly source?: 'user' | 'tool';
}

export interface AgentAutoResumeRequest {
    readonly attempt: number;
    readonly maximum: number;
    readonly failureKind?: DesktopAgentRunFailureKind;
    readonly retrySafe?: boolean;
    readonly events?: readonly AgentRunEvent[];
}

export type AgentAutoResumeDecision =
    | { readonly action: 'resume'; readonly nextAttempt: number }
    | { readonly action: 'stop'; readonly reason: 'limit' | 'user' | 'unsafe' };

export type CommandActivityState = 'running' | 'completed' | 'failed' | 'stopped';

export type ToolActivityCompletionState = 'completed' | 'failed' | 'stopped';

/**
 * Resolve an operation state from the durable runtime status. A cancelled
 * process can have `ok: true` at the transport layer and an operation outcome
 * of `failed` because SIGINT is not a successful command exit; it is still an
 * intentional stop, not an error.
 */
export function toolActivityCompletionState(input: {
    readonly ok: boolean;
    readonly status?: 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
    readonly outcome?: 'succeeded' | 'failed';
    readonly terminationReason?: 'requested' | 'cancelled' | 'timeout' | 'runtime_dispose';
}): ToolActivityCompletionState {
    if (input.status === 'cancelled'
        || input.terminationReason === 'requested'
        || input.terminationReason === 'cancelled'
        || input.terminationReason === 'runtime_dispose') return 'stopped';
    if (input.status === 'succeeded' && input.ok && input.outcome !== 'failed') return 'completed';
    if (!input.status && input.ok && input.outcome !== 'failed') return 'completed';
    return 'failed';
}

export interface CommandActivitySource {
    /** Structured command emitted by process tools. Preferred over every legacy field. */
    readonly commandLine?: string;
    /** Structured command emitted by a process lifecycle event. */
    readonly processCommandLine?: string;
    /** Compatibility input for histories written before commandLine was persisted. */
    readonly legacyTitle?: string;
}

export interface CommandActivityPresentation {
    readonly state: CommandActivityState;
    /** Full bounded command for the expanded terminal surface. */
    readonly command: string;
    readonly expandedCommand: string;
    /** Safe single-line collapsed label. */
    readonly title: string;
}

export interface ModelAttemptPresentation {
    readonly title: string;
    readonly detail: string;
    readonly tone: 'success' | 'warning' | 'error';
}

export type AgentModelPhase = 'thinking' | 'responding' | 'tool_calling' | 'settling' | 'waiting_capacity' | 'failed';

export interface ModelPhasePresentation {
    readonly title: string;
    readonly detail: string;
}

const workspaceInspectionTranslations: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '工作区检查完成', 'zh-TW': '工作區檢查完成', en: 'Workspace inspected',
    ja: 'ワークスペースを確認しました', ko: '워크스페이스 확인 완료', es: 'Espacio de trabajo revisado',
    fr: 'Espace de travail vérifié', de: 'Arbeitsbereich geprüft', 'pt-BR': 'Workspace verificado',
    ru: 'Рабочая область проверена', ar: 'تم فحص مساحة العمل', hi: 'वर्कस्पेस की जाँच पूरी हुई'
};

// Use registered tool identifiers, never model prose or a guessed server name.
// Playwright's published verbs share the built-in browser activity language;
// the phrasing itself lives in nextmux-browser-activity-locale.ts.
export function browserToolActivity(
    locale: NextMuxDesktopLocale, toolName: string, state: CommandActivityState = 'completed', target?: string
): { readonly title: string; readonly service?: string; readonly phrase: BrowserActivityPhrase } | undefined {
    const identity = browserToolIdentity(toolName);
    if (!identity) return undefined;
    const phrase = browserActivityPhrase(locale, identity.action, state, target);
    return { title: phrase.text, phrase, ...(identity.service ? { service: identity.service } : {}) };
}

/** Prefer a stable localized operation name over a runtime-authored legacy title. */
export function toolCompletionTitle(
    locale: NextMuxDesktopLocale,
    event: Extract<AgentRunEvent, { readonly type: 'tool_completed' }>
): string {
    if (event.ok && event.toolName === 'workspace.list_files') return workspaceInspectionTranslations[locale];
    const state = toolActivityCompletionState({
        ok: event.ok, status: event.status, outcome: event.summary.outcome, terminationReason: event.summary.terminationReason
    });
    // The native bridge deliberately returns diagnostic codes instead of raw
    // driver exceptions. They belong in details, never the collapsed label.
    // Scope this to the registered computer namespace, not snake_case prose
    // that could legitimately be a file or a provider-authored summary.
    if (event.toolName.startsWith('computer.') && state !== 'completed') {
        if (state !== 'stopped' && event.failure?.code === 'COMPUTER_AX_ACTION_UNCONFIRMED') {
            return localizeDesktopSurface(locale, '操作结果待确认');
        }
        return localizeDesktopSurface(locale, state === 'stopped' ? '电脑操作已取消。' : '电脑操作未完成');
    }
    const browser = browserToolActivity(locale, event.toolName, state, event.summary.target);
    if (browser) return browser.title;
    const semantic = localizedRuntimeActivity(locale, event.summary);
    if (semantic) return semantic.title;
    const title = event.summary.title.trim();
    // Older providers sometimes echoed their internal tool id as the title.
    // Compare with the actual identifier: dotted text may be a legitimate
    // filename, so punctuation alone cannot identify a technical title.
    if (!title || title === event.toolName) return '';
    return title;
}

/**
 * Model lifecycle phases are transient status, not a durable transcript. Show
 * only the newest phase while the request is live; tool rows, model-authored
 * narration and failures remain in the settled activity journal.
 */
export function latestLiveModelPhaseIndex(events: readonly AgentRunEvent[], running: boolean): number {
    if (!running) return -1;
    let textAfter = false;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === 'model_phase') {
            // Streaming text answers any other phase, but a tool call stays pending while its sentence finishes.
            if (textAfter && event.phase !== 'tool_calling') return -1;
            if (event.phase === 'thinking') {
                const hasVisibleReasoningAfter = events.slice(index + 1).some(candidate =>
                    candidate.type === 'provider_reasoning' && candidate.visibility === 'visible' && Boolean(candidate.content.trim()));
                if (hasVisibleReasoningAfter) return -1;
            }
            return index;
        }
        if (event.type === 'tool_started' || event.type === 'model_completed') return -1;
        if (event.type === 'assistant_delta') textAfter = true;
    }
    return -1;
}

const modelPhaseTranslations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<AgentModelPhase, ModelPhasePresentation>>>> = {
    'zh-CN': {
        thinking: { title: '正在思考', detail: '模型正在准备响应' },
        waiting_capacity: { title: "等待 API 空位", detail: "原请求已保留，有空位后继续；等待本身不计推理费" },
        settling: { title: '正在确认结算', detail: '正在取回原请求结果，不会重复调用模型' },
        responding: { title: '正在生成回复', detail: '模型正在输出可见内容' },
        tool_calling: { title: '正在调用工具', detail: '模型正在准备下一项操作' },
        failed: { title: '模型调用未完成', detail: '正在整理可恢复状态' }
    },
    'zh-TW': {
        thinking: { title: '正在思考', detail: '模型正在準備回應' },
        waiting_capacity: { title: "等待 API 空位", detail: "原請求已保留，有空位後繼續；等待本身不計推理費" },
        settling: { title: '正在確認結算', detail: '正在取回原請求結果，不會重複呼叫模型' },
        responding: { title: '正在產生回覆', detail: '模型正在輸出可見內容' },
        tool_calling: { title: '正在呼叫工具', detail: '模型正在準備下一項操作' },
        failed: { title: '模型呼叫未完成', detail: '正在整理可恢復狀態' }
    },
    en: {
        thinking: { title: 'Thinking', detail: 'The model is preparing a response' },
        waiting_capacity: { title: "Waiting for API capacity", detail: "Your original request is retained and will continue when capacity is available. Waiting adds no inference charge." },
        settling: { title: 'Confirming billing', detail: 'Retrieving the original result without calling the model again' },
        responding: { title: 'Writing a response', detail: 'The model is producing visible content' },
        tool_calling: { title: 'Calling a tool', detail: 'The model is preparing the next operation' },
        failed: { title: 'Model call did not complete', detail: 'Preserving a recoverable state' }
    },
    ja: {
        thinking: { title: '思考中', detail: 'モデルが応答を準備しています' },
        waiting_capacity: { title: "API の空きを待機中", detail: "元のリクエストを保持しています。空きができ次第続行し、待機中の推論料金は発生しません。" },
        settling: { title: '決済を確認中', detail: 'モデルを再実行せず、元の結果を取得しています' },
        responding: { title: '回答を生成中', detail: 'モデルが表示可能な内容を出力しています' },
        tool_calling: { title: 'ツールを呼び出し中', detail: '次の操作を準備しています' },
        failed: { title: 'モデル呼び出し未完了', detail: '復元可能な状態を保存しています' }
    },
    ko: {
        thinking: { title: '생각하는 중', detail: '모델이 응답을 준비하고 있습니다' },
        waiting_capacity: { title: "API 용량 대기 중", detail: "원래 요청을 유지하고 여유가 생기면 계속합니다. 대기 자체에는 추론 요금이 부과되지 않습니다." },
        settling: { title: '정산 확인 중', detail: '모델을 다시 호출하지 않고 원래 결과를 가져옵니다' },
        responding: { title: '응답 작성 중', detail: '모델이 표시할 내용을 출력하고 있습니다' },
        tool_calling: { title: '도구 호출 중', detail: '다음 작업을 준비하고 있습니다' },
        failed: { title: '모델 호출이 완료되지 않음', detail: '복구 가능한 상태를 보존하는 중' }
    },
    es: {
        thinking: { title: 'Pensando', detail: 'El modelo está preparando una respuesta' },
        waiting_capacity: { title: "Esperando capacidad de API", detail: "La solicitud original se conserva y continuará cuando haya capacidad. La espera no añade cargos de inferencia." },
        settling: { title: 'Confirmando facturación', detail: 'Recuperando el resultado original sin volver a llamar al modelo' },
        responding: { title: 'Escribiendo una respuesta', detail: 'El modelo está generando contenido visible' },
        tool_calling: { title: 'Llamando a una herramienta', detail: 'El modelo prepara la próxima operación' },
        failed: { title: 'La llamada al modelo no terminó', detail: 'Conservando un estado recuperable' }
    },
    fr: {
        thinking: { title: 'Réflexion en cours', detail: 'Le modèle prépare une réponse' },
        waiting_capacity: { title: "En attente de capacité API", detail: "La demande initiale est conservée et reprendra dès que possible. L’attente ne génère aucun coût d’inférence." },
        settling: { title: 'Vérification de la facturation', detail: 'Récupération du résultat initial sans rappeler le modèle' },
        responding: { title: 'Rédaction de la réponse', detail: 'Le modèle produit du contenu visible' },
        tool_calling: { title: 'Appel d’un outil', detail: 'Le modèle prépare l’opération suivante' },
        failed: { title: 'L’appel du modèle n’est pas terminé', detail: 'Conservation d’un état récupérable' }
    },
    de: {
        thinking: { title: 'Denken', detail: 'Das Modell bereitet eine Antwort vor' },
        waiting_capacity: { title: "Warten auf API-Kapazität", detail: "Die ursprüngliche Anfrage bleibt erhalten und wird bei freier Kapazität fortgesetzt. Das Warten verursacht keine Inferenzkosten." },
        settling: { title: 'Abrechnung wird bestätigt', detail: 'Das ursprüngliche Ergebnis wird ohne erneuten Modellaufruf abgerufen' },
        responding: { title: 'Antwort wird geschrieben', detail: 'Das Modell erzeugt sichtbare Inhalte' },
        tool_calling: { title: 'Tool wird aufgerufen', detail: 'Das Modell bereitet den nächsten Vorgang vor' },
        failed: { title: 'Modellaufruf nicht abgeschlossen', detail: 'Wiederherstellbaren Zustand bewahren' }
    },
    'pt-BR': {
        thinking: { title: 'Pensando', detail: 'O modelo está preparando uma resposta' },
        waiting_capacity: { title: "Aguardando capacidade da API", detail: "A solicitação original foi mantida e continuará quando houver capacidade. A espera não gera cobrança de inferência." },
        settling: { title: 'Confirmando cobrança', detail: 'Recuperando o resultado original sem chamar o modelo novamente' },
        responding: { title: 'Escrevendo uma resposta', detail: 'O modelo está produzindo conteúdo visível' },
        tool_calling: { title: 'Chamando uma ferramenta', detail: 'O modelo está preparando a próxima operação' },
        failed: { title: 'A chamada do modelo não foi concluída', detail: 'Preservando um estado recuperável' }
    },
    ru: {
        thinking: { title: 'Модель размышляет', detail: 'Модель готовит ответ' },
        waiting_capacity: { title: "Ожидание доступности API", detail: "Исходный запрос сохранён и продолжится при освобождении ресурсов. Ожидание не оплачивается как инференс." },
        settling: { title: 'Подтверждение расчёта', detail: 'Получение исходного результата без повторного вызова модели' },
        responding: { title: 'Формирование ответа', detail: 'Модель выводит видимый текст' },
        tool_calling: { title: 'Вызов инструмента', detail: 'Модель готовит следующую операцию' },
        failed: { title: 'Вызов модели не завершён', detail: 'Сохраняется состояние для восстановления' }
    },
    ar: {
        thinking: { title: 'جارٍ التفكير', detail: 'يُعد النموذج استجابة' },
        waiting_capacity: { title: "بانتظار سعة API", detail: "تم الاحتفاظ بالطلب الأصلي وسيُستأنف عند توفر السعة. الانتظار لا يضيف رسوم استدلال." },
        settling: { title: 'جارٍ تأكيد الفوترة', detail: 'استرجاع النتيجة الأصلية دون استدعاء النموذج مجدداً' },
        responding: { title: 'جارٍ إنشاء الرد', detail: 'ينتج النموذج محتوى مرئياً' },
        tool_calling: { title: 'جارٍ استدعاء أداة', detail: 'يُعد النموذج العملية التالية' },
        failed: { title: 'لم تكتمل استدعاء النموذج', detail: 'جارٍ حفظ حالة قابلة للاستئناف' }
    },
    hi: {
        thinking: { title: 'सोच रहा है', detail: 'मॉडल उत्तर तैयार कर रहा है' },
        waiting_capacity: { title: "API क्षमता की प्रतीक्षा", detail: "मूल अनुरोध सुरक्षित है और क्षमता उपलब्ध होने पर जारी रहेगा। प्रतीक्षा का अनुमान शुल्क नहीं लगता।" },
        settling: { title: 'बिल की पुष्टि हो रही है', detail: 'मॉडल को दोबारा बुलाए बिना मूल परिणाम प्राप्त किया जा रहा है' },
        responding: { title: 'उत्तर लिखा जा रहा है', detail: 'मॉडल दिखाई देने वाली सामग्री बना रहा है' },
        tool_calling: { title: 'टूल कॉल हो रहा है', detail: 'मॉडल अगली कार्रवाई तैयार कर रहा है' },
        failed: { title: 'मॉडल कॉल पूरी नहीं हुई', detail: 'पुनर्प्राप्ति योग्य स्थिति सुरक्षित है' }
    }
};

const capacityReasonTranslations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<CapacityWaitReason, ModelPhasePresentation>>>> = {
    'zh-CN': {
        concurrency: { title: '中转模型较忙', detail: '当前中转商的该模型较忙，可切换模型或等待。' },
        rpm: { title: '每分钟请求额度已满', detail: '该模型已达到当前中转商设置的每分钟请求上限，额度恢复后自动继续。' },
        tpm: { title: '每分钟 Token 额度已满', detail: '该模型已达到当前中转商设置的每分钟 Token 上限，额度恢复后自动继续。' },
        daily_tokens: { title: '每日 Token 额度已满', detail: '该模型已达到当前中转商设置的每日 Token 上限，额度恢复后自动继续。' }
    },
    'zh-TW': {
        concurrency: { title: '中轉模型較忙', detail: '目前中轉商的這個模型較忙，可切換模型或等待。' },
        rpm: { title: '每分鐘請求額度已滿', detail: '這個模型已達目前中轉商設定的每分鐘請求上限，額度恢復後自動繼續。' },
        tpm: { title: '每分鐘 Token 額度已滿', detail: '這個模型已達目前中轉商設定的每分鐘 Token 上限，額度恢復後自動繼續。' },
        daily_tokens: { title: '每日 Token 額度已滿', detail: '這個模型已達目前中轉商設定的每日 Token 上限，額度恢復後自動繼續。' }
    },
    en: {
        concurrency: { title: 'Reseller model busy', detail: 'This reseller’s model is busy. You can switch models or wait.' },
        rpm: { title: 'Request-per-minute limit reached', detail: 'This model has reached the reseller’s configured request-per-minute limit and will continue when capacity returns.' },
        tpm: { title: 'Token-per-minute limit reached', detail: 'This model has reached the reseller’s configured token-per-minute limit and will continue when capacity returns.' },
        daily_tokens: { title: 'Daily token limit reached', detail: 'This model has reached the reseller’s configured daily token limit and will continue when capacity returns.' }
    },
    ja: {
        concurrency: { title: '中継モデルが混雑中', detail: '現在の中継事業者のこのモデルは混雑しています。モデルを切り替えるか、お待ちください。' },
        rpm: { title: '分間リクエスト上限に到達', detail: '中継事業者がこのモデルに設定した分間リクエスト上限に達しました。枠が空くと自動的に続行します。' },
        tpm: { title: '分間トークン上限に到達', detail: '中継事業者がこのモデルに設定した分間トークン上限に達しました。枠が空くと自動的に続行します。' },
        daily_tokens: { title: '日次トークン上限に到達', detail: '中継事業者がこのモデルに設定した日次トークン上限に達しました。枠が空くと自動的に続行します。' }
    },
    ko: {
        concurrency: { title: '중계 모델 사용량이 많음', detail: '현재 중계업체의 이 모델이 혼잡합니다. 모델을 바꾸거나 기다릴 수 있습니다.' },
        rpm: { title: '분당 요청 한도 도달', detail: '이 모델이 중계업체가 설정한 분당 요청 한도에 도달했습니다. 여유가 생기면 자동으로 계속합니다.' },
        tpm: { title: '분당 토큰 한도 도달', detail: '이 모델이 중계업체가 설정한 분당 토큰 한도에 도달했습니다. 여유가 생기면 자동으로 계속합니다.' },
        daily_tokens: { title: '일일 토큰 한도 도달', detail: '이 모델이 중계업체가 설정한 일일 토큰 한도에 도달했습니다. 여유가 생기면 자동으로 계속합니다.' }
    },
    es: {
        concurrency: { title: 'Modelo del revendedor ocupado', detail: 'Este modelo del revendedor está ocupado. Puedes cambiar de modelo o esperar.' },
        rpm: { title: 'Límite de solicitudes por minuto alcanzado', detail: 'El modelo alcanzó el límite de solicitudes por minuto configurado por el revendedor. Continuará cuando haya capacidad.' },
        tpm: { title: 'Límite de tokens por minuto alcanzado', detail: 'El modelo alcanzó el límite de tokens por minuto configurado por el revendedor. Continuará cuando haya capacidad.' },
        daily_tokens: { title: 'Límite diario de tokens alcanzado', detail: 'El modelo alcanzó el límite diario de tokens configurado por el revendedor. Continuará cuando haya capacidad.' }
    },
    fr: {
        concurrency: { title: 'Modèle du revendeur occupé', detail: 'Ce modèle du revendeur est très sollicité. Vous pouvez changer de modèle ou patienter.' },
        rpm: { title: 'Limite de requêtes par minute atteinte', detail: 'Ce modèle a atteint la limite de requêtes par minute définie par le revendeur. Il reprendra dès qu’une place sera disponible.' },
        tpm: { title: 'Limite de jetons par minute atteinte', detail: 'Ce modèle a atteint la limite de jetons par minute définie par le revendeur. Il reprendra dès qu’une capacité sera disponible.' },
        daily_tokens: { title: 'Limite quotidienne de jetons atteinte', detail: 'Ce modèle a atteint la limite quotidienne de jetons définie par le revendeur. Il reprendra dès qu’une capacité sera disponible.' }
    },
    de: {
        concurrency: { title: 'Modell des Wiederverkäufers ausgelastet', detail: 'Dieses Modell des Wiederverkäufers ist stark ausgelastet. Sie können das Modell wechseln oder warten.' },
        rpm: { title: 'Anfragelimit pro Minute erreicht', detail: 'Dieses Modell hat das vom Wiederverkäufer festgelegte Anfragelimit pro Minute erreicht. Es läuft weiter, sobald wieder Kapazität verfügbar ist.' },
        tpm: { title: 'Tokenlimit pro Minute erreicht', detail: 'Dieses Modell hat das vom Wiederverkäufer festgelegte Tokenlimit pro Minute erreicht. Es läuft weiter, sobald wieder Kapazität verfügbar ist.' },
        daily_tokens: { title: 'Tägliches Tokenlimit erreicht', detail: 'Dieses Modell hat das vom Wiederverkäufer festgelegte tägliche Tokenlimit erreicht. Es läuft weiter, sobald wieder Kapazität verfügbar ist.' }
    },
    'pt-BR': {
        concurrency: { title: 'Modelo do revendedor ocupado', detail: 'Este modelo do revendedor está ocupado. Você pode trocar de modelo ou aguardar.' },
        rpm: { title: 'Limite de solicitações por minuto atingido', detail: 'O modelo atingiu o limite de solicitações por minuto configurado pelo revendedor. Ele continuará quando houver capacidade.' },
        tpm: { title: 'Limite de tokens por minuto atingido', detail: 'O modelo atingiu o limite de tokens por minuto configurado pelo revendedor. Ele continuará quando houver capacidade.' },
        daily_tokens: { title: 'Limite diário de tokens atingido', detail: 'O modelo atingiu o limite diário de tokens configurado pelo revendedor. Ele continuará quando houver capacidade.' }
    },
    ru: {
        concurrency: { title: 'Модель посредника занята', detail: 'Эта модель у текущего посредника загружена. Можно сменить модель или подождать.' },
        rpm: { title: 'Достигнут лимит запросов в минуту', detail: 'Модель достигла заданного посредником лимита запросов в минуту. Работа продолжится, когда появится доступная ёмкость.' },
        tpm: { title: 'Достигнут лимит токенов в минуту', detail: 'Модель достигла заданного посредником лимита токенов в минуту. Работа продолжится, когда появится доступная ёмкость.' },
        daily_tokens: { title: 'Достигнут суточный лимит токенов', detail: 'Модель достигла заданного посредником суточного лимита токенов. Работа продолжится, когда появится доступная ёмкость.' }
    },
    ar: {
        concurrency: { title: 'نموذج الوسيط مشغول', detail: 'هذا النموذج لدى الوسيط الحالي مشغول. يمكنك تبديل النموذج أو الانتظار.' },
        rpm: { title: 'تم بلوغ حد الطلبات في الدقيقة', detail: 'بلغ هذا النموذج حد الطلبات في الدقيقة الذي حدده الوسيط. سيستمر تلقائيًا عند توفر السعة.' },
        tpm: { title: 'تم بلوغ حد الرموز في الدقيقة', detail: 'بلغ هذا النموذج حد الرموز في الدقيقة الذي حدده الوسيط. سيستمر تلقائيًا عند توفر السعة.' },
        daily_tokens: { title: 'تم بلوغ الحد اليومي للرموز', detail: 'بلغ هذا النموذج الحد اليومي للرموز الذي حدده الوسيط. سيستمر تلقائيًا عند توفر السعة.' }
    },
    hi: {
        concurrency: { title: 'मध्यस्थ का मॉडल व्यस्त है', detail: 'वर्तमान मध्यस्थ का यह मॉडल व्यस्त है। आप मॉडल बदल सकते हैं या प्रतीक्षा कर सकते हैं।' },
        rpm: { title: 'प्रति मिनट अनुरोध सीमा पूरी हुई', detail: 'यह मॉडल मध्यस्थ की निर्धारित प्रति मिनट अनुरोध सीमा तक पहुँच गया है। क्षमता उपलब्ध होने पर अपने आप जारी रहेगा।' },
        tpm: { title: 'प्रति मिनट टोकन सीमा पूरी हुई', detail: 'यह मॉडल मध्यस्थ की निर्धारित प्रति मिनट टोकन सीमा तक पहुँच गया है। क्षमता उपलब्ध होने पर अपने आप जारी रहेगा।' },
        daily_tokens: { title: 'दैनिक टोकन सीमा पूरी हुई', detail: 'यह मॉडल मध्यस्थ की निर्धारित दैनिक टोकन सीमा तक पहुँच गया है। क्षमता उपलब्ध होने पर अपने आप जारी रहेगा।' }
    }
};

export function modelPhasePresentation(
    locale: NextMuxDesktopLocale, phase: AgentModelPhase, capacityReasons?: readonly CapacityWaitReason[]
): ModelPhasePresentation {
    const base = modelPhaseTranslations[locale][phase];
    const reasons = phase === 'waiting_capacity' ? normalizedCapacityReasons(capacityReasons) : [];
    if (!reasons.length) return base;
    const text = reasons.map(reason => capacityReasonTranslations[locale][reason]);
    return { title: text.map(item => item.title).join(' · '), detail: `${text.map(item => item.detail).join(' ')} ${base.detail}` };
}

/** Normalized adapter event for provider reasoning that is explicitly safe to display. */
export interface AgentProviderReasoningEventLike {
    readonly type: 'provider_reasoning';
    readonly visibility: 'visible' | 'hidden';
    readonly content: string;
    readonly status: 'streaming' | 'complete';
    readonly at?: string;
}

export interface AgentThinkingPresentation {
    readonly content: string;
    readonly streaming: boolean;
}

export type AgentStreamTailState = 'running' | 'complete' | 'stopped';

export interface AgentStreamTailInput {
    /** May briefly remain true while a final lifecycle event is being reduced. */
    readonly running: boolean;
    /** An observed terminal event always wins over the transient running flag. */
    readonly terminalState?: Exclude<AgentStreamTailState, 'running'>;
}

export interface AgentStreamTailPresentation {
    readonly state: AgentStreamTailState;
    readonly showCursor: boolean;
}

const modelAttemptTranslations: Readonly<Record<NextMuxDesktopLocale, Readonly<{
    succeeded: string;
    retrying: string;
    failed: string;
    attempt: string;
}>>> = {
    'zh-CN': { succeeded: '模型响应已接收', retrying: '模型连接未完成，正在重试', failed: '模型调用未完成', attempt: '第 {attempt} 次' },
    'zh-TW': { succeeded: '已收到模型回應', retrying: '模型連線未完成，正在重試', failed: '模型呼叫未完成', attempt: '第 {attempt} 次' },
    en: { succeeded: 'Model response received', retrying: 'Model connection interrupted; retrying', failed: 'Model call did not complete', attempt: 'Attempt {attempt}' },
    ja: { succeeded: 'モデルの応答を受信しました', retrying: 'モデル接続が完了しなかったため再試行しています', failed: 'モデル呼び出しが完了しませんでした', attempt: '{attempt} 回目' },
    ko: { succeeded: '모델 응답을 받았습니다', retrying: '모델 연결이 완료되지 않아 다시 시도 중입니다', failed: '모델 호출이 완료되지 않았습니다', attempt: '{attempt}번째 시도' },
    es: { succeeded: 'Respuesta del modelo recibida', retrying: 'La conexión del modelo se interrumpió; reintentando', failed: 'La llamada al modelo no se completó', attempt: 'Intento {attempt}' },
    fr: { succeeded: 'Réponse du modèle reçue', retrying: 'Connexion au modèle interrompue, nouvelle tentative', failed: 'L’appel au modèle n’a pas abouti', attempt: 'Tentative {attempt}' },
    de: { succeeded: 'Modellantwort empfangen', retrying: 'Modellverbindung unterbrochen; erneuter Versuch', failed: 'Modellaufruf wurde nicht abgeschlossen', attempt: 'Versuch {attempt}' },
    'pt-BR': { succeeded: 'Resposta do modelo recebida', retrying: 'Conexão com o modelo interrompida; tentando novamente', failed: 'A chamada do modelo não foi concluída', attempt: 'Tentativa {attempt}' },
    ru: { succeeded: 'Ответ модели получен', retrying: 'Соединение с моделью прервано; повторная попытка', failed: 'Вызов модели не завершён', attempt: 'Попытка {attempt}' },
    ar: { succeeded: 'تم استلام استجابة النموذج', retrying: 'انقطع اتصال النموذج؛ جارٍ إعادة المحاولة', failed: 'لم تكتمل استدعاء النموذج', attempt: 'المحاولة {attempt}' },
    hi: { succeeded: 'मॉडल प्रतिक्रिया प्राप्त हुई', retrying: 'मॉडल कनेक्शन पूरा नहीं हुआ; पुनः प्रयास जारी है', failed: 'मॉडल कॉल पूरी नहीं हुई', attempt: 'प्रयास {attempt}' }
};

export function modelAttemptPresentation(
    locale: NextMuxDesktopLocale,
    event: Extract<AgentRunEvent, { readonly type: 'model_attempt_completed' }>
): ModelAttemptPresentation {
    const text = modelAttemptTranslations[locale];
    const title = event.outcome === 'succeeded' ? text.succeeded
        : event.retryScheduled ? text.retrying : text.failed;
    return {
        title,
        detail: text.attempt.replace('{attempt}', String(event.attempt)),
        tone: event.outcome === 'succeeded' ? 'success' : event.retryScheduled ? 'warning' : 'error'
    };
}

/** Called only for a turn explicitly stopped by the user. Preserve earlier
 * provider failures and diagnostics; the final transport abort is expected. */
export function userCancelledActivityEvents(events: readonly AgentRunEvent[]): readonly AgentRunEvent[] {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event.type !== 'model_attempt_completed') continue;
        const failure = event.failure;
        if (event.outcome !== 'failed' || event.retryScheduled || !failure) return events;
        const cancelled = failure.category === 'cancelled' || failure.stage === 'cancelled'
            || (!failure.category || failure.category === 'unknown') && (!failure.stage || failure.stage === 'unknown')
                && failure.httpStatus === undefined && ['ABORTERROR', 'ABORT_ERR', 'CANCELLED'].includes((failure.code || '').toUpperCase());
        return cancelled ? events.filter((_event, candidate) => candidate !== index) : events;
    }
    return events;
}

/**
 * Never infers thinking from model lifecycle, configured effort, progress text,
 * or tool activity. A provider adapter must deliberately publish visible
 * reasoning content through the normalized event before the UI may render it.
 */
export function agentThinkingPresentation(
    event: AgentRunEvent | AgentProviderReasoningEventLike
): AgentThinkingPresentation | undefined {
    if (event.type !== 'provider_reasoning' || event.visibility !== 'visible') return undefined;
    const content = event.content.trim();
    if (!content) return undefined;
    return {
        content,
        streaming: event.status === 'streaming'
    };
}

/** Controls the streaming tail without leaving a cursor on settled history. */
export function agentStreamTailPresentation(input: AgentStreamTailInput): AgentStreamTailPresentation {
    const state: AgentStreamTailState = input.terminalState || (input.running ? 'running' : 'complete');
    return {
        state,
        showCursor: state === 'running'
    };
}

// Events and journal arrays are immutable snapshots; cache metadata without
// retaining snapshots after their owning conversation has been released.
const eventIdentityCache = new WeakMap<object, string>();
const projectedEventsCache = new WeakMap<readonly AgentRunEvent[], readonly { event: AgentRunEvent; sourceIndex: number }[]>();
const seenEventIdentitiesCache = new WeakMap<readonly AgentRunEvent[], Set<string>>();

function agentEventIdentity(event: AgentRunEvent): string {
    const cached = eventIdentityCache.get(event);
    if (cached !== undefined) return cached;
    const identity = event.type === 'model_price_changed'
        ? JSON.stringify([event.type, event.sessionId, event.runId, event.pricingUpdate.id])
        : JSON.stringify(event);
    eventIdentityCache.set(event, identity);
    return identity;
}

/** A view of the journal: update an operation where it started, without moving later prose. */
/** Suppress retry noise only after a later successful write proves recovery. */
export function supersededEditFailures(events: readonly AgentRunEvent[]): ReadonlySet<string> {
    const successful = new Set<string>(), hidden = new Set<string>();
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event.type === 'backend_selected') { successful.clear(); continue; }
        if (event.type !== 'tool_completed') continue;
        const resource = event.summary.resource;
        const path = resource?.kind === 'file' && resource.action !== 'read' ? resource.path
            : /(?:write_file|edit_file|apply_patch|patch_file)$/.test(event.toolName)
                && typeof event.summary.params?.path === 'string' ? event.summary.params.path : undefined;
        if (!path) continue;
        const key = `${event.summary.params?.workspaceRoot || ''}\u0000${path.replace(/\\/g, '/')}`;
        const completed = toolActivityCompletionState({ ok: event.ok, status: event.status, outcome: event.summary.outcome });
        if (completed === 'completed') successful.add(key);
        else if (completed === 'failed' && successful.has(key)) hidden.add(event.callId);
    }
    return hidden;
}

export function projectAgentActivityEvents(events: readonly AgentRunEvent[]): readonly { event: AgentRunEvent; sourceIndex: number }[] {
    const cached = projectedEventsCache.get(events);
    if (cached) return cached;
    const rows: { event: AgentRunEvent; sourceIndex: number }[] = [];
    const tools = new Map<string, number>();
    const compactions = new Map<string, number>();
    const reasoning = new Map<string, number>();
    for (const [sourceIndex, event] of events.entries()) {
        if (event.type === 'backend_selected' || event.type === 'model_started') {
            reasoning.clear();
            if (event.type === 'backend_selected') compactions.clear();
        }
        if (event.type === 'tool_started') {
            tools.set(event.callId, rows.length);
        } else if (event.type === 'tool_completed' || event.type === 'tool_process_exited') {
            const index = tools.get(event.callId);
            if (index !== undefined) {
                // Starting a background process acknowledges launch, not completion.
                if (event.type === 'tool_completed' && event.toolName === 'process.start' && event.ok) continue;
                if (event.type === 'tool_process_exited' && rows[index].event.type === 'tool_completed') continue;
                rows[index] = { event, sourceIndex: rows[index].sourceIndex };
                continue;
            }
            tools.set(event.callId, rows.length);
        } else if (event.type === 'context_compaction_started' || event.type === 'context_compaction_completed') {
            const id = `${event.turn}:${event.segment}`;
            const index = compactions.get(id);
            if (event.type === 'context_compaction_completed' && index !== undefined) {
                rows[index] = { event, sourceIndex: rows[index].sourceIndex };
                continue;
            }
            compactions.set(id, rows.length);
        } else if (event.type === 'provider_reasoning') {
            const id = event.itemId
                ? `${event.turn}:${event.itemId}`
                : `${event.turn}:${event.visibility}:default-${tools.size}`;
            const index = reasoning.get(id);
            if (index !== undefined) {
                rows[index] = { event, sourceIndex: rows[index].sourceIndex };
                continue;
            }
            reasoning.set(id, rows.length);
        }
        rows.push({ event, sourceIndex });
    }
    projectedEventsCache.set(events, rows);
    return rows;
}

/**
 * React identity for one persisted activity event. Providers are expected to
 * issue unique tool-call ids, but interrupted/resumed streams and imported
 * histories can legitimately contain more than one lifecycle event with the
 * same id. The source position keeps every row unique without using mutable
 * content or renderer-local randomness.
 */
export function agentActivityEventKey(event: AgentRunEvent, sourceIndex: number): string {
    const index = Math.max(0, Math.floor(sourceIndex) || 0);
    if ('callId' in event && typeof event.callId === 'string') {
        return `tool:${event.callId}:${index}`;
    }
    if (event.type === 'context_compaction_started' || event.type === 'context_compaction_completed') return `compaction:${event.turn}:${event.segment}:${index}`;
    if ('turn' in event && typeof event.turn === 'number') {
        return `${event.type}:${event.turn}:${index}`;
    }
    return `${event.type}:${index}`;
}

/** Append incremental snapshots without replacing or trimming visible history. */
export function appendAgentActivityEvents(
    current: readonly AgentRunEvent[],
    incoming: readonly AgentRunEvent[]
): readonly AgentRunEvent[] {
    if (incoming === current || !incoming.length) return current;
    let seen = seenEventIdentitiesCache.get(current);
    if (!seen) {
        seen = new Set(current.map(agentEventIdentity));
        seenEventIdentitiesCache.set(current, seen);
    }
    const candidates = incoming.length > current.length && current.length > 0
        && incoming[0] === current[0] && incoming[current.length - 1] === current[current.length - 1]
        ? incoming.slice(current.length)
        : incoming;
    const additions: AgentRunEvent[] = [];
    for (const event of candidates) {
        const identity = agentEventIdentity(event);
        if (seen.has(identity)) continue;
        if (!additions.length) {
            // Transfer the mutable set to the new snapshot instead of copying
            // the entire history on every append. A branch from an older array
            // rebuilds its own set, so new identities cannot leak into it.
            seenEventIdentitiesCache.delete(current);
        }
        seen.add(identity);
        additions.push(event);
    }
    if (!additions.length) return current;
    const result = [...current, ...additions];
    seenEventIdentitiesCache.set(result, seen);
    return result;
}

/** The follow-up queue is a projection of user-authored prompts, never tools. */
export function userQueuedPrompts<T extends AgentQueuedPromptLike>(items: readonly T[]): readonly T[] {
    return items.filter(item => isUserFollowUpRecord(item));
}

/** Fixed runtime narration templates from agent-runtime `progressContent` / `toolCompletionProgress`. */
const RUNTIME_TOOL_NARRATION: readonly RegExp[] = [
    /^接下来将[\s\S]+。$/u, /^正在整理结果。$/u, /(?:已终止|已超时)，已保留已经产生的输出。$/u,
    /未完成，正在根据错误调整下一步。$/u, /^已(?:读取|创建|编辑) [\s\S]+，正在[\s\S]+继续处理。$/u,
    /^已打开网页 [\s\S]+，正在根据页面结果继续处理。$/u, /已完成，正在根据结果继续处理。$/u,
    // The runner's canonical (model-facing, English) narration; the status rows show the same steps localized.
    /^Next operations: [\s\S]+\.$/u, /^Preparing the results\.$/u, /^The operation (?:was cancelled|timed out|failed)[;,][\s\S]*\.$/u,
    /\. Continuing from the result\.$/u
];

export function isRuntimeToolNarration(content: string): boolean {
    const value = content.trim();
    return RUNTIME_TOOL_NARRATION.some(pattern => pattern.test(value));
}

export interface AssistantProgressVisibilityInput {
    readonly content: string;
    readonly origin?: 'model' | 'runtime';
    /** Structured completion already carries the same target, state and affordance. */
    readonly previousEventType?: AgentRunEvent['type'];
}

/**
 * Runtime-generated progress is shown when it is a human-readable status
 * sentence (for example, a file result or journal-recovery notice). Histories
 * written before `origin` existed need a narrow compatibility check so their
 * exact tool-result labels do not reappear as model narration. Explicit model
 * output always remains visible, even when its wording happens to resemble a
 * command or file operation.
 */
export function isVisibleAssistantProgress(event: AssistantProgressVisibilityInput): boolean {
    if (!event.content.trim()) return false;
    if (event.origin === 'model') return true;
    if (event.origin === 'runtime' && event.previousEventType === 'tool_completed') return false;
    // The runner narrates tool calls the model made without prose ("接下来将修改 a.txt。")
    // in fixed Chinese. The status rows already show those calls in the user's
    // language, so, like Codex and OpenCode, no synthetic narration is shown.
    if (event.origin === 'runtime' && isRuntimeToolNarration(event.content)) return false;
    return !isLikelyLegacyToolActivityPrompt(event.content);
}

/** Prevent a second automatic retry layer after the same native model step used all three waits. */
export function nativeShortRateLimitRetriesExhausted(events: readonly AgentRunEvent[]): boolean {
    let finalIndex = -1;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === 'backend_selected' || event.type === 'model_started') return false;
        if (event.type !== 'model_attempt_completed') continue;
        const failure = event.failure;
        if (event.outcome !== 'failed' || event.retryScheduled || event.attempt !== 4
            || failure?.httpStatus !== 429 || failure.retrySafe !== true
            || !['rate_limit_rpm_exceeded', 'rate_limit_tpm_exceeded'].includes(failure.providerCode || '')
            || !failure.diagnostic?.names?.includes('AI_APICallError')) return false;
        finalIndex = index;
        break;
    }
    if (finalIndex < 0) return false;
    const final = events[finalIndex];
    if (final.type !== 'model_attempt_completed') return false;
    const attempts = new Set<number>();
    for (let index = finalIndex - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === 'backend_selected' || event.type === 'model_started') break;
        if (event.type === 'model_retry_scheduled' && event.turn === final.turn
            && event.reason === 'HTTP 429' && event.attempt >= 1 && event.attempt <= 3
            && event.delayMs >= 15_000 * 2 ** (event.attempt - 1) && event.delayMs <= 300_000) {
            attempts.add(event.attempt);
        }
    }
    return attempts.size === 3;
}

export function autoResumeDecision(request: AgentAutoResumeRequest): AgentAutoResumeDecision {
    if (nativeShortRateLimitRetriesExhausted(request.events || [])) return { action: 'stop', reason: 'limit' };
    if (request.failureKind === 'waiting_user' || request.failureKind === 'model_auth') {
        return { action: 'stop', reason: 'user' };
    }
    // A pause has no failureKind and may continue from its checkpoint. Failed
    // model calls must opt in explicitly so an old history record or an unsafe
    // 429 can never replay a request with an unknown charge/side effect.
    if (request.failureKind !== undefined && request.retrySafe !== true) {
        return { action: 'stop', reason: 'unsafe' };
    }
    const attempt = Math.max(0, Math.floor(request.attempt) || 0);
    const maximum = Math.max(0, Math.floor(request.maximum) || 0);
    return attempt < maximum
        ? { action: 'resume', nextAttempt: attempt + 1 }
        : { action: 'stop', reason: 'limit' };
}

function isRateLimitedFailure(code?: string, httpStatus?: number): boolean {
    const normalizedCode = code?.trim().toUpperCase() || '';
    return httpStatus === 429
        || normalizedCode === 'RATE_LIMITED'
        || normalizedCode === 'TOO_MANY_REQUESTS'
        || normalizedCode.endsWith('_RATE_LIMITED');
}

/** A provider that is rate limited, overloaded or out of capacity: waiting helps, a quick retry does not. */
export function isBusyFailure(code?: string, httpStatus?: number): boolean {
    const normalizedCode = code?.trim().toUpperCase() || '';
    return isRateLimitedFailure(code, httpStatus) || httpStatus === 529
        || /^(?:OVERLOADED|SERVER_BUSY|PROVIDER_BUSY|PROVIDER_OVERLOADED|MODEL_OVERLOADED|CAPACITY_EXHAUSTED|UPSTREAM_BUSY)$/.test(normalizedCode)
        || normalizedCode.endsWith('_OVERLOADED');
}

/**
 * A busy provider is retried after 30, 60, 60 and 120 seconds, then left to the user with the reason on screen
 * (LobeChat #7); `BUSY_RETRY_DELAYS_MS.length` is also how many automatic attempts it gets.
 */
export const BUSY_RETRY_DELAYS_MS = [30_000, 60_000, 60_000, 120_000] as const;

/**
 * Keep automatic checkpoint recovery useful without turning a busy provider into a tight request loop. Normal
 * transport failures retain the short 1/2/4-second backoff; a busy provider waits 30/60/60/120 seconds, and a
 * larger provider Retry-After hint (capped at five minutes) still wins.
 */
export function autoResumeDelayMs(
    attempt: number,
    retryAfterMs?: number,
    failureCode?: string,
    httpStatus?: number
): number {
    const normalized = Math.max(1, Math.min(BUSY_RETRY_DELAYS_MS.length, Math.floor(attempt) || 1));
    const exponential = 1_000 * 2 ** (normalized - 1);
    const busyFloor = isBusyFailure(failureCode, httpStatus) ? BUSY_RETRY_DELAYS_MS[normalized - 1] : 0;
    const retryHint = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
        ? Math.min(300_000, Math.max(0, Math.floor(retryAfterMs)))
        : 0;
    // A gateway hint is advisory. Keep the local backoff floor and cap the
    // server value so a malformed or hostile response cannot freeze recovery.
    return Math.max(exponential, busyFloor, retryHint);
}

export function toolActivitySucceeded(ok: boolean, summary: ToolExecutionSummary): boolean {
    return ok && summary.outcome !== 'failed';
}

/**
 * A successful process.terminate completion is only the control request's
 * acknowledgement. The authoritative process lifecycle row is emitted by the
 * matching tool_process_exited event, so rendering both produces two adjacent
 * "stopped" rows for one action. Failures remain visible because they do not
 * have a successful lifecycle result to represent them.
 */
export function isRedundantProcessControlCompletion(event: AgentRunEvent): boolean {
    return event.type === 'tool_completed'
        && event.toolName === 'process.terminate'
        && toolActivitySucceeded(event.ok, event.summary);
}

export function commandActivityCommand(value: string): string {
    return value.trim()
        .replace(
            /^(?:正在运行|运行|執行中|執行|正在執行|running|run|実行中|실행 중|ejecutando|en cours|wird ausgeführt|em execução|выполняется|قيد التشغيل)\s+/i,
            ''
        )
        .replace(/\s+(?:退出码|exit\s+code)\s+(?:-?\d+|unknown)$/i, '')
        .replace(/\s+/g, ' ')
        .slice(0, 4_096) || 'command';
}

function commandActivityPreview(value: string): string {
    const commandLine = value.trim().replace(/\s+/g, ' ').slice(0, 4_096) || 'command';
    const maximum = 240;
    return commandLine.length <= maximum
        ? commandLine
        : `${commandLine.slice(0, maximum - 1).trimEnd()}…`;
}

const commandActivityTranslations: Readonly<Record<NextMuxDesktopLocale, Readonly<{
    running: string;
    completed: string;
    failed: string;
    stopped: string;
}>>> = {
    'zh-CN': { running: '正在运行 {command}', completed: '执行了 {command}', failed: '执行 {command}失败', stopped: '已终止 {command}' },
    'zh-TW': { running: '正在執行 {command}', completed: '已執行 {command}', failed: '執行 {command}失敗', stopped: '已終止 {command}' },
    en: { running: 'Running {command}', completed: 'Ran {command}', failed: '{command} failed', stopped: 'Stopped {command}' },
    ja: { running: '{command} を実行中', completed: '{command} を実行しました', failed: '{command} の実行に失敗しました', stopped: '{command} を停止しました' },
    ko: { running: '{command} 실행 중', completed: '{command} 실행 완료', failed: '{command} 실행 실패', stopped: '{command} 중지됨' },
    es: { running: 'Ejecutando {command}', completed: 'Se ejecutó {command}', failed: 'Falló {command}', stopped: 'Se detuvo {command}' },
    fr: { running: 'Exécution de {command}', completed: '{command} exécuté', failed: 'Échec de {command}', stopped: '{command} arrêté' },
    de: { running: '{command} wird ausgeführt', completed: '{command} ausgeführt', failed: '{command} fehlgeschlagen', stopped: '{command} beendet' },
    'pt-BR': { running: 'Executando {command}', completed: '{command} executado', failed: 'Falha em {command}', stopped: '{command} interrompido' },
    ru: { running: 'Выполняется {command}', completed: 'Выполнено {command}', failed: 'Ошибка {command}', stopped: 'Остановлено: {command}' },
    ar: { running: 'جارٍ تشغيل {command}', completed: 'تم تشغيل {command}', failed: 'فشل {command}', stopped: 'تم إيقاف {command}' },
    hi: { running: '{command} चलाया जा रहा है', completed: '{command} चलाया गया', failed: '{command} विफल रहा', stopped: '{command} रोका गया' }
};

export function commandActivityTitle(
    locale: NextMuxDesktopLocale,
    state: CommandActivityState,
    command: string
): string {
    return commandActivityTranslations[locale][state].replace('{command}', commandActivityPreview(command));
}

function safeExpandedCommand(value: string): string {
    return value
        .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
        .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\0/g, '')
        .trim()
        .slice(0, 8_000);
}

function legacyCommandFromTitle(value: string | undefined): string | undefined {
    const title = value?.trim();
    if (!title || /[\r\n·✔✖]/u.test(title) || /(?:耗时|另\s*\d+\s*项|tests?\s+(?:passed|failed))/iu.test(title)) {
        return undefined;
    }
    const explicitlyPrefixed = /^(?:正在运行|运行|執行中|執行|正在執行|running|run|実行中|실행 중|ejecutando|en cours|wird ausgeführt|em execução|выполняется|قيد التشغيل)\s+/i.test(title);
    const exactExitSummary = /\s+(?:退出码|exit\s+code)\s+(?:-?\d+|unknown)$/i.test(title);
    if (!explicitlyPrefixed && !exactExitSummary) return undefined;
    const command = safeExpandedCommand(commandActivityCommand(title));
    return command && command !== 'command' ? command : undefined;
}

/**
 * Presents a process command without ever parsing stdout, stderr, test details,
 * or generic tool summaries. Structured command fields are authoritative; the
 * legacy title path accepts only the two historical command-title shapes.
 */
export function commandActivityPresentation(
    locale: NextMuxDesktopLocale,
    state: CommandActivityState,
    source: CommandActivitySource
): CommandActivityPresentation | undefined {
    const structuredCommand = source.commandLine || source.processCommandLine;
    const command = structuredCommand
        ? safeExpandedCommand(structuredCommand)
        : legacyCommandFromTitle(source.legacyTitle);
    if (!command) return undefined;
    return {
        state,
        command,
        expandedCommand: command,
        title: commandActivityTitle(locale, state, command)
    };
}

const commandExitTranslations: Readonly<Record<NextMuxDesktopLocale, Readonly<{ code: string; signal: string }>>> = {
    'zh-CN': { code: '进程退出码 {value}', signal: '进程由信号 {value} 终止' },
    'zh-TW': { code: '程序結束碼 {value}', signal: '程序由訊號 {value} 終止' },
    en: { code: 'Process exited with code {value}', signal: 'Process terminated by signal {value}' },
    ja: { code: 'プロセス終了コード {value}', signal: 'シグナル {value} でプロセスを終了しました' },
    ko: { code: '프로세스 종료 코드 {value}', signal: '신호 {value}(으)로 프로세스 종료' },
    es: { code: 'El proceso terminó con el código {value}', signal: 'El proceso terminó por la señal {value}' },
    fr: { code: 'Processus terminé avec le code {value}', signal: 'Processus arrêté par le signal {value}' },
    de: { code: 'Prozess mit Code {value} beendet', signal: 'Prozess durch Signal {value} beendet' },
    'pt-BR': { code: 'Processo encerrado com código {value}', signal: 'Processo encerrado pelo sinal {value}' },
    ru: { code: 'Процесс завершён с кодом {value}', signal: 'Процесс завершён сигналом {value}' },
    ar: { code: 'انتهت العملية بالرمز {value}', signal: 'أُوقفت العملية بالإشارة {value}' },
    hi: { code: 'प्रोसेस कोड {value} के साथ समाप्त हुआ', signal: 'प्रोसेस सिग्नल {value} से समाप्त हुआ' }
};

export function commandExitStatus(locale: NextMuxDesktopLocale, exitCode: number | null, signal: string | null): string {
    const template = exitCode !== null ? commandExitTranslations[locale].code : commandExitTranslations[locale].signal;
    return template.replace('{value}', exitCode !== null ? String(exitCode) : signal || 'unknown');
}

export type AgentTaskStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentTaskStepPresentation {
    readonly id: string;
    readonly title: string;
    readonly status: AgentTaskStepStatus;
    readonly summary?: ToolExecutionSummary;
}

export interface AgentTaskProgressPresentation {
    readonly source?: 'model';
    readonly currentStep: number;
    readonly totalSteps: number;
    readonly completedSteps: number;
    readonly changedFileCount: number;
    readonly additions: number;
    readonly deletions: number;
    readonly steps: readonly AgentTaskStepPresentation[];
}

/**
 * Keep the task-plan chip reserved for work that has an actual multi-step
 * shape (or has produced a meaningful file change). A one-line request with
 * no plan should remain a normal conversation instead of being dressed up as
 * a queue containing a synthetic "planning" row.
 */
export function shouldShowAgentTaskProgress(progress: AgentTaskProgressPresentation): boolean {
    return progress.totalSteps > 1
        || progress.changedFileCount > 0
        || progress.additions > 0
        || progress.deletions > 0;
}

export interface AgentTaskChangePresentation {
    readonly path: string;
    readonly additions?: number;
    readonly deletions?: number;
}

/**
 * Projects the latest explicit plan only. Tool activity and narration are
 * deliberately ignored rather than heuristically promoted into task rows.
 */
export function agentTaskPlanSteps(events: readonly AgentRunEvent[]): readonly AgentTaskStepPresentation[] {
    return latestSemanticTaskPlanSteps(events).flatMap(step => {
        const title = step.title.slice(0, 180);
        return [{
            id: step.id,
            title,
            status: step.status === 'in_progress' ? 'running' as const : step.status
        }];
    });
}

/**
 * Projects only the latest structured plan event. Narration, streamed text,
 * tools, searches, commands, and user follow-up messages belong to their own
 * surfaces and can never be promoted into plan rows by inference.
 */
export function summarizeAgentTaskProgress(
    events: readonly AgentRunEvent[],
    changes: readonly AgentTaskChangePresentation[] = [],
    running = false
): AgentTaskProgressPresentation {
    void running;
    const steps = agentTaskPlanSteps(events);
    const latestPlan = [...events].reverse().find(
        (event): event is Extract<AgentRunEvent, { readonly type: 'task_plan_updated' }> => event.type === 'task_plan_updated'
    );
    const completedSteps = steps.filter(step => step.status === 'completed').length;

    const totalSteps = steps.length;
    const activeIndex = steps.findIndex(step => step.status === 'running');
    const pendingIndex = steps.findIndex(step => step.status === 'pending');
    const currentStep = activeIndex >= 0 ? activeIndex + 1
        : pendingIndex >= 0 ? pendingIndex + 1
            : totalSteps;

    const changedFiles = new Set(changes.map(change => change.path));
    for (const event of events) {
        if (event.type !== 'tool_completed') continue;
        for (const path of event.summary.changedPaths || []) if (path) changedFiles.add(path);
        const resource = event.summary.resource;
        if (resource?.kind === 'file' && resource.action !== 'read') changedFiles.add(resource.path);
    }
    const validCount = (value: number | undefined): number => Number.isFinite(value) && Number(value) > 0
        ? Math.floor(Number(value))
        : 0;

    return {
        source: latestPlan ? 'model' : undefined,
        currentStep,
        totalSteps,
        completedSteps,
        changedFileCount: changedFiles.size,
        additions: changes.reduce((total, change) => total + validCount(change.additions), 0),
        deletions: changes.reduce((total, change) => total + validCount(change.deletions), 0),
        steps
    };
}
