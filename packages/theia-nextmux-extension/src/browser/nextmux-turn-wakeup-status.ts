import type { NextMuxDesktopLocale } from './nextmux-locale';

export type TurnWakeupKind =
    | 'background_task'
    | 'timer'
    | 'scheduled_plan'
    | 'goal'
    | 'auto_resume'
    | 'queued_followup';

export interface SessionWakeupTimerRecord {
    readonly timerId?: number;
    readonly wakeAt: number;
    readonly prompt: string;
    readonly reason?: string;
    readonly turnId?: string;
}

export interface TurnWakeupScheduleSummary {
    readonly id?: string;
    readonly enabled?: boolean;
    readonly sessionId?: string;
    readonly originConversationId?: string;
    readonly cadence?: string;
    readonly runAt?: string;
    /** Weekly tasks: 0 = Sunday … 6 = Saturday; tasks saved without a day run on Mondays. */
    readonly weekday?: number;
    readonly title?: string;
    readonly lastRunAt?: number;
    readonly lastOccurrenceAt?: number;
    readonly lastStatus?: string;
}

export interface TurnWakeupChildSummary {
    readonly childRunId?: string;
    readonly status?: string;
    readonly title?: string;
}

export interface TurnWakeupEventSummary {
    readonly type?: string;
    readonly toolName?: string;
    readonly callId?: string;
    readonly ok?: boolean;
    readonly summary?: {
        readonly title?: string;
        readonly detail?: string;
        readonly details?: readonly string[];
        readonly status?: string;
        readonly params?: Readonly<Record<string, string | number | boolean | undefined>>;
    };
}

export interface ExtractedScheduledWakeup {
    readonly delaySeconds: number;
    readonly wakeAt: number;
    readonly prompt: string;
    readonly reason?: string;
}

export function extractScheduledWakeupFromEvents(
    events: readonly TurnWakeupEventSummary[] | undefined,
    now = Date.now()
): ExtractedScheduledWakeup | undefined {
    if (!Array.isArray(events) || !events.length) return undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event || event.type !== 'tool_completed' || event.toolName !== 'task.schedule_wakeup' || event.ok === false) {
            continue;
        }
        const params = event.summary?.params;
        const delaySeconds = Number(params?.delaySeconds);
        const rawWakeAt = Number(params?.wakeAt);
        const prompt = typeof params?.prompt === 'string' && params.prompt.trim()
            ? params.prompt.trim()
            : typeof event.summary?.details?.[0] === 'string'
                ? event.summary.details[0].trim()
                : '';
        const reason = typeof params?.reason === 'string' && params.reason.trim()
            ? params.reason.trim()
            : undefined;
        if (!prompt || !Number.isFinite(delaySeconds) || delaySeconds < 1) continue;
        const wakeAt = Number.isFinite(rawWakeAt) && rawWakeAt > 0 ? rawWakeAt : now + delaySeconds * 1_000;
        return {
            delaySeconds: Math.round(delaySeconds),
            wakeAt,
            prompt,
            ...(reason ? { reason } : {})
        };
    }
    return undefined;
}

export interface TurnWakeupStatusInput {
    readonly locale: NextMuxDesktopLocale;
    readonly sessionId?: string;
    readonly turnId?: string;
    readonly stage?: string;
    readonly stopReason?: string;
    readonly isLatestTurn: boolean;
    readonly sessionWakeupTimer?: SessionWakeupTimerRecord;
    readonly autoResuming?: boolean;
    readonly goalContinuing?: boolean;
    readonly goalActive?: boolean;
    readonly queuedFollowUpCount?: number;
    readonly queuedAutomaticGoal?: boolean;
    readonly scheduledTasks?: readonly TurnWakeupScheduleSummary[];
    readonly childAgents?: readonly TurnWakeupChildSummary[];
    readonly activeChildContinuation?: boolean;
    readonly events?: readonly TurnWakeupEventSummary[];
    readonly now?: number;
}

export interface TurnWakeupStatus {
    readonly kind: TurnWakeupKind;
    readonly label: string;
    readonly detail?: string;
    readonly tooltip: string;
    readonly wakeAt?: number;
}

export type TurnWakeupTextKey =
    | 'label'
    | 'timerTooltip'
    | 'timerWithReasonTooltip'
    | 'backgroundTaskTooltip'
    | 'scheduledPlanTooltip'
    | 'goalTooltip'
    | 'autoResumeTooltip'
    | 'queuedFollowUpTooltip';

const WAKEUP_TEXT: Record<NextMuxDesktopLocale, Record<TurnWakeupTextKey, string>> = {
    'zh-CN': {
        label: '后台任务完成会自动继续该对话',
        timerTooltip: '后台任务完成会自动继续该对话 · 预计 {time} 自动唤醒继续',
        timerWithReasonTooltip: '后台任务完成会自动继续该对话 · 预计 {time} 唤醒（{reason}）',
        backgroundTaskTooltip: '后台任务仍在运行，后台任务完成会自动继续该对话',
        scheduledPlanTooltip: '已关联定时唤醒计划 · 下次将于 {time} 自动继续该对话',
        goalTooltip: '持久目标进行中，后台任务完成会自动继续该对话',
        autoResumeTooltip: '正在等待自动恢复定时到达，后台任务完成会自动继续该对话',
        queuedFollowUpTooltip: '后续任务已就绪，后台任务完成会自动继续该对话'
    },
    'zh-TW': {
        label: '背景任務完成會自動繼續此對話',
        timerTooltip: '背景任務完成會自動繼續此對話 · 預計 {time} 自動喚醒繼續',
        timerWithReasonTooltip: '背景任務完成會自動繼續此對話 · 預計 {time} 喚醒（{reason}）',
        backgroundTaskTooltip: '背景任務仍在執行，完成後會自動繼續此對話',
        scheduledPlanTooltip: '已關聯排程喚醒計畫 · 下次將於 {time} 自動繼續此對話',
        goalTooltip: '持久目標進行中，背景任務完成會自動繼續此對話',
        autoResumeTooltip: '正在等待自動恢復計時到達，完成後會自動繼續此對話',
        queuedFollowUpTooltip: '後續任務已就緒，背景任務完成會自動繼續此對話'
    },
    en: {
        label: 'Will automatically continue when background task finishes',
        timerTooltip: 'Timer active · Will automatically wake up and continue at {time}',
        timerWithReasonTooltip: 'Timer active · Will automatically wake up at {time} ({reason})',
        backgroundTaskTooltip: 'Background task is running and will automatically continue this conversation when finished',
        scheduledPlanTooltip: 'Scheduled wakeup active · Next automatic continuation at {time}',
        goalTooltip: 'Active goal in progress · Will automatically continue this conversation',
        autoResumeTooltip: 'Waiting for automatic retry timer · Will automatically continue this conversation',
        queuedFollowUpTooltip: 'Queued follow-up ready · Will automatically continue this conversation'
    },
    ja: {
        label: 'バックグラウンド処理の完了後にこの会話を自動再開します',
        timerTooltip: 'タイマー待機中 · {time} に自動で会話を再開します',
        timerWithReasonTooltip: 'タイマー待機中 · {time} に自動再開（{reason}）',
        backgroundTaskTooltip: 'バックグラウンド処理が進行中です。完了後に自動でこの会話を続行します',
        scheduledPlanTooltip: 'スケジュール済み · 次回 {time} に自動でこの会話を続行します',
        goalTooltip: '目標タスク進行中 · バックグラウンド完了後に自動で会話を続行します',
        autoResumeTooltip: '自動再開タイマー待機中 · まもなくこの会話を自動再開します',
        queuedFollowUpTooltip: '待機中のタスクがあります · 完了後に自動でこの会話を続行します'
    },
    ko: {
        label: '백그라운드 작업 완료 시 이 대화를 자동으로 이어갑니다',
        timerTooltip: '타이머 대기 중 · {time}에 자동으로 대화를 깨워 이어갑니다',
        timerWithReasonTooltip: '타이머 대기 중 · {time}에 자동 재개 ({reason})',
        backgroundTaskTooltip: '백그라운드 작업이 실행 중이며 완료되면 자동으로 이 대화를 이어갑니다',
        scheduledPlanTooltip: '예약 작업 연결됨 · 다음 {time}에 자동으로 이 대화를 이어갑니다',
        goalTooltip: '지속 목표 진행 중 · 백그라운드 작업 완료 시 자동으로 대화를 이어갑니다',
        autoResumeTooltip: '자동 재시도 타이머 대기 중 · 잠시 후 이 대화를 자동으로 이어갑니다',
        queuedFollowUpTooltip: '대기 중인 후속 작업이 준비되어 자동으로 이 대화를 이어갑니다'
    },
    es: {
        label: 'Continuará automáticamente al terminar la tarea en segundo plano',
        timerTooltip: 'Temporizador activo · Se reactivará automáticamente a las {time}',
        timerWithReasonTooltip: 'Temporizador activo · Se reactivará a las {time} ({reason})',
        backgroundTaskTooltip: 'Hay una tarea en segundo plano en curso; la conversación continuará automáticamente al finalizar',
        scheduledPlanTooltip: 'Plan programado activo · Próxima continuación automática a las {time}',
        goalTooltip: 'Objetivo activo en curso · La conversación continuará automáticamente',
        autoResumeTooltip: 'Esperando temporizador de reintento · Continuará automáticamente',
        queuedFollowUpTooltip: 'Tarea en cola lista · La conversación continuará automáticamente'
    },
    fr: {
        label: 'Reprendra automatiquement une fois la tâche en arrière-plan terminée',
        timerTooltip: 'Minuteur actif · Réveil et reprise automatiques à {time}',
        timerWithReasonTooltip: 'Minuteur actif · Réveil automatique à {time} ({reason})',
        backgroundTaskTooltip: 'Une tâche en arrière-plan est en cours et reprendra automatiquement cette conversation',
        scheduledPlanTooltip: 'Planification active · Prochaine reprise automatique à {time}',
        goalTooltip: 'Objectif actif en cours · Cette conversation reprendra automatiquement',
        autoResumeTooltip: 'En attente du minuteur de reprise · Reprendra automatiquement',
        queuedFollowUpTooltip: 'Tâche suivante prête · Cette conversation reprendra automatiquement'
    },
    de: {
        label: 'Wird nach Abschluss der Hintergrundaufgabe automatisch fortgesetzt',
        timerTooltip: 'Timer aktiv · Automatische Fortsetzung um {time}',
        timerWithReasonTooltip: 'Timer aktiv · Automatische Fortsetzung um {time} ({reason})',
        backgroundTaskTooltip: 'Hintergrundaufgabe läuft und setzt dieses Gespräch nach Abschluss automatisch fort',
        scheduledPlanTooltip: 'Geplanter Durchlauf aktiv · Nächste automatische Fortsetzung um {time}',
        goalTooltip: 'Aktives Ziel läuft · Gespräch wird automatisch fortgesetzt',
        autoResumeTooltip: 'Wartet auf automatischen Wiederholungs-Timer · Wird automatisch fortgesetzt',
        queuedFollowUpTooltip: 'Folgeaufgabe bereit · Gespräch wird automatisch fortgesetzt'
    },
    'pt-BR': {
        label: 'Continuará automaticamente quando a tarefa em segundo plano terminar',
        timerTooltip: 'Temporizador ativo · Retomará automaticamente às {time}',
        timerWithReasonTooltip: 'Temporizador ativo · Retomará às {time} ({reason})',
        backgroundTaskTooltip: 'Tarefa em segundo plano em execução; a conversa continuará automaticamente ao concluir',
        scheduledPlanTooltip: 'Agendamento ativo · Próxima retomada automática às {time}',
        goalTooltip: 'Meta ativa em andamento · A conversa continuará automaticamente',
        autoResumeTooltip: 'Aguardando temporizador de retomada automática · Continuará automaticamente',
        queuedFollowUpTooltip: 'Tarefa na fila pronta · A conversa continuará automaticamente'
    },
    ru: {
        label: 'Диалог автоматически продолжится после завершения фоновой задачи',
        timerTooltip: 'Таймер активен · Автоматическое пробуждение и продолжение в {time}',
        timerWithReasonTooltip: 'Таймер активен · Автоматическое продолжение в {time} ({reason})',
        backgroundTaskTooltip: 'Фоновая задача выполняется; после её завершения диалог автоматически продолжится',
        scheduledPlanTooltip: 'Расписание активно · Следующее автоматическое продолжение в {time}',
        goalTooltip: 'Активная цель выполняется · Диалог автоматически продолжится',
        autoResumeTooltip: 'Ожидание таймера автоповтора · Диалог автоматически продолжится',
        queuedFollowUpTooltip: 'Следующая задача в очереди · Диалог автоматически продолжится'
    },
    ar: {
        label: 'ستستأنف هذه المحادثة تلقائيًا عند اكتمال المهمة في الخلفية',
        timerTooltip: 'المؤقّت نشط · سيتم الإيقاظ والاستئناف تلقائيًا عند {time}',
        timerWithReasonTooltip: 'المؤقّت نشط · سيتم الاستئناف عند {time} ({reason})',
        backgroundTaskTooltip: 'تعمل مهمة في الخلفية وستستأنف هذه المحادثة تلقائيًا فور انتهائها',
        scheduledPlanTooltip: 'جدولة نشطة · الاستئناف التلقائي القادم عند {time}',
        goalTooltip: 'الهدف النشط قيد التنفيذ · ستستأنف المحادثة تلقائيًا',
        autoResumeTooltip: 'بانتظار مؤقّت الاستئناف التلقائي · ستستأنف المحادثة تلقائيًا',
        queuedFollowUpTooltip: 'المهمة التالية جاهزة · ستستأنف المحادثة تلقائيًا'
    },
    hi: {
        label: 'बैकग्राउंड कार्य पूरा होने पर यह बातचीत अपने-आप आगे बढ़ेगी',
        timerTooltip: 'टाइमर सक्रिय · {time} पर अपने-आप जागकर बातचीत आगे बढ़ेगी',
        timerWithReasonTooltip: 'टाइमर सक्रिय · {time} पर अपने-आप आगे बढ़ेगी ({reason})',
        backgroundTaskTooltip: 'बैकग्राउंड कार्य चल रहा है और पूरा होते ही यह बातचीत अपने-आप आगे बढ़ेगी',
        scheduledPlanTooltip: 'शेड्यूल सक्रिय · अगली स्वचालित निरंतरता {time} पर',
        goalTooltip: 'सक्रिय लक्ष्य जारी है · यह बातचीत अपने-आप आगे बढ़ेगी',
        autoResumeTooltip: 'स्वचालित पुनः प्रयास टाइमर की प्रतीक्षा · बातचीत अपने-आप आगे बढ़ेगी',
        queuedFollowUpTooltip: 'कतार में अगला कार्य तैयार है · बातचीत अपने-आप आगे बढ़ेगी'
    }
};

export function turnWakeupText(
    locale: NextMuxDesktopLocale,
    key: TurnWakeupTextKey,
    params?: Record<string, string | number | undefined>
): string {
    const table = WAKEUP_TEXT[locale] || WAKEUP_TEXT.en;
    let template = table[key] || WAKEUP_TEXT.en[key] || '';
    if (params) {
        for (const [name, value] of Object.entries(params)) {
            template = template.split(`{${name}}`).join(value === undefined ? '' : String(value));
        }
    }
    return template;
}

export function formatWakeupClockTime(locale: NextMuxDesktopLocale, wakeAt: number, now = Date.now()): string {
    if (!Number.isFinite(wakeAt) || wakeAt <= 0) return '';
    const date = new Date(wakeAt);
    const today = new Date(now);
    const sameDay = date.getFullYear() === today.getFullYear()
        && date.getMonth() === today.getMonth()
        && date.getDate() === today.getDate();
    try {
        return sameDay
            ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: wakeAt - now < 60_000 ? '2-digit' : undefined })
            : date.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}

export function nextScheduledWakeAt(task: TurnWakeupScheduleSummary, now = Date.now()): number | undefined {
    if (!task || task.enabled === false || !task.runAt) return undefined;
    if (task.cadence === 'once') {
        const timestamp = new Date(task.runAt).getTime();
        if (!Number.isFinite(timestamp)) return undefined;
        if (task.lastRunAt || task.lastOccurrenceAt) return undefined;
        return timestamp;
    }
    if (task.cadence === 'daily' || task.cadence === 'weekly') {
        const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(task.runAt);
        if (!match) return undefined;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const base = new Date(now);
        const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0);
        if (task.cadence === 'weekly') {
            const weekday = typeof task.weekday === 'number' && Number.isInteger(task.weekday) && task.weekday >= 0 && task.weekday <= 6 ? task.weekday : 1;
            candidate.setDate(candidate.getDate() + (weekday - candidate.getDay() + 7) % 7);
            if (candidate.getTime() <= now) candidate.setDate(candidate.getDate() + 7);
        } else if (candidate.getTime() <= now) {
            candidate.setDate(candidate.getDate() + 1);
        }
        return candidate.getTime();
    }
    return undefined;
}

export function hasActiveBackgroundProcess(events: readonly TurnWakeupEventSummary[] | undefined): boolean {
    if (!Array.isArray(events) || !events.length) return false;
    const exitedCallIds = new Set<string>();
    const startedProcessCallIds = new Set<string>();
    for (const event of events) {
        if (!event) continue;
        if (event.type === 'tool_process_exited' && event.callId) {
            exitedCallIds.add(event.callId);
        } else if (
            (event.type === 'tool_started' || event.type === 'tool_completed')
            && event.toolName === 'process.start'
            && event.callId
            && event.ok !== false
        ) {
            startedProcessCallIds.add(event.callId);
        }
    }
    for (const callId of startedProcessCallIds) {
        if (!exitedCallIds.has(callId)) return true;
    }
    return false;
}

/**
 * Inspects whether a settled conversation turn has an armed timer, background task,
 * scheduled plan, persistent goal continuation, or auto-resume that will automatically
 * wake up and continue the conversation.
 */
export function resolveTurnWakeupStatus(input: TurnWakeupStatusInput): TurnWakeupStatus | undefined {
    if (!input.isLatestTurn || input.stage === 'running') return undefined;
    const now = input.now ?? Date.now();
    const label = turnWakeupText(input.locale, 'label');

    // 1. The conversation's armed wakeup timer for this very turn (task.schedule_wakeup). A wakeup that is only recorded
    // in the turn's events is not shown: after a restart, a stop or a history edit nothing is armed and nothing would
    // fire, so the footer must not promise an automatic continuation.
    const timer = input.sessionWakeupTimer;
    const activeTimer = timer && (!timer.turnId || timer.turnId === input.turnId) ? timer : undefined;
    if (activeTimer && Number.isFinite(activeTimer.wakeAt) && activeTimer.wakeAt > 0) {
        const time = formatWakeupClockTime(input.locale, activeTimer.wakeAt, now);
        const reason = activeTimer.reason?.trim();
        const tooltip = reason
            ? turnWakeupText(input.locale, 'timerWithReasonTooltip', { time, reason })
            : turnWakeupText(input.locale, 'timerTooltip', { time });
        return {
            kind: 'timer',
            label,
            detail: time || undefined,
            tooltip,
            wakeAt: activeTimer.wakeAt
        };
    }

    // 2. Active background child agent continuation or unexited background process
    const hasRunningChild = Boolean(
        input.activeChildContinuation
        || (input.childAgents || []).some(child => child && (child.status === 'running' || child.status === 'pending'))
    );
    const hasRunningProcess = input.stage !== 'cancelled' && hasActiveBackgroundProcess(input.events);
    if (hasRunningChild || hasRunningProcess) {
        return {
            kind: 'background_task',
            label,
            tooltip: turnWakeupText(input.locale, 'backgroundTaskTooltip')
        };
    }

    // 3. Automatic pause/error resume timer armed on this turn
    if (input.autoResuming) {
        return {
            kind: 'auto_resume',
            label,
            tooltip: turnWakeupText(input.locale, 'autoResumeTooltip')
        };
    }

    // 4. Persistent goal continuation timer or queued goal continuation
    if (input.goalContinuing || input.queuedAutomaticGoal || (input.goalActive && input.stage === 'complete')) {
        return {
            kind: 'goal',
            label,
            tooltip: turnWakeupText(input.locale, 'goalTooltip')
        };
    }

    // 5. Queued follow-up tasks about to drain after a completed turn
    if ((input.queuedFollowUpCount ?? 0) > 0 && input.stage === 'complete') {
        return {
            kind: 'queued_followup',
            label,
            tooltip: turnWakeupText(input.locale, 'queuedFollowUpTooltip')
        };
    }

    // 6. Enabled scheduled task linked to this conversation
    if (input.sessionId && Array.isArray(input.scheduledTasks)) {
        const linked = input.scheduledTasks
            .filter(task => task && task.enabled !== false && (task.sessionId === input.sessionId || task.originConversationId === input.sessionId))
            .map(task => ({ task, wakeAt: nextScheduledWakeAt(task, now) }))
            .filter((entry): entry is { task: TurnWakeupScheduleSummary; wakeAt: number } => typeof entry.wakeAt === 'number' && Number.isFinite(entry.wakeAt))
            .sort((a, b) => a.wakeAt - b.wakeAt)[0];
        if (linked) {
            const time = formatWakeupClockTime(input.locale, linked.wakeAt, now);
            return {
                kind: 'scheduled_plan',
                label,
                detail: time || undefined,
                tooltip: turnWakeupText(input.locale, 'scheduledPlanTooltip', { time }),
                wakeAt: linked.wakeAt
            };
        }
    }

    return undefined;
}
