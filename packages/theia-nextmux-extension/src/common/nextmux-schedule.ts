import type { ModelReasoningSettings } from './nextmux-model-controls';
import type { AgentPermissionMode, AgentReasoningEffort } from '@nextmux/agent-runtime';
import type { AutomaticRelaySource } from './nextmux-relay-switch';

export type ScheduledTaskCadence = 'once' | 'daily' | 'weekly';
export type ScheduledTaskRunStatus = 'idle' | 'running' | 'complete' | 'error';

export interface ScheduledTaskRecord {
    /** Compare-and-swap version of user/model authored settings (runtime updates do not advance it). */
    readonly definitionRevision?: number;
    readonly originConversationId?: string;
    readonly pauseReason?: string;
    readonly modelRoute?: import('./nextmux-platform-protocol').DesktopAgentModelRoute;
    readonly modelLabel?: string;
    readonly switchPolicy?: import('./nextmux-platform-protocol').ModelSwitchPolicy;
    readonly lastOccurrenceAt?: number;
    readonly lastAttemptAt?: number;
    readonly reasoningEffort?: AgentReasoningEffort;
    readonly reasoningSettings?: ModelReasoningSettings;
    readonly contextWindowTokens?: number;
    readonly automaticRelaySource?: AutomaticRelaySource;
    readonly keyPriceQuoteId?: string;
    readonly id: string;
    readonly workspacePath: string;
    readonly title: string;
    readonly prompt: string;
    readonly cadence: ScheduledTaskCadence;
    readonly runAt: string;
    /** Weekly tasks: the day they run, 0 = Sunday … 6 = Saturday (Date.getDay()); see scheduleWeekday. */
    readonly weekday?: number;
    readonly enabled: boolean;
    readonly createdAt: number;
    readonly routeId?: string;
    readonly relayKey?: string;
    readonly modelId?: string;
    readonly permissionMode?: AgentPermissionMode;
    readonly sessionId?: string;
    readonly lastRunAt?: number;
    readonly lastStatus?: ScheduledTaskRunStatus;
    readonly lastMessage?: string;
    readonly lastMessageDescriptor?: import('./nextmux-domain-errors').DomainMessage;
    readonly backgroundMode?: 'system' | 'app_open';
    readonly backgroundMessage?: string;
}

/** Configuration and billing refusals need a person; a timer must not retry them forever. */
export function scheduledTaskNeedsAttention(error: unknown): boolean {
    const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; status?: unknown } : {};
    return value.status === 401 || value.status === 403
        || /INSUFFICIENT|BALANCE|PAYMENT_REQUIRED|PRICE_|QUOTE_|AUTH|CREDENTIAL|KEY_INVALID|MODEL_NOT_FOUND|ROUTE_(?:UNAVAILABLE|INVALID)|PERMISSION|WORKSPACE|ENOENT|EACCES/i.test(String(value.code || ''))
        || /余额不足|模型线路不可用|报价.*(?:确认|失效)|密钥.*(?:失效|无效)|权限不足|项目文件夹.*(?:不存在|无法访问)/.test(String(value.message || error || ''));
}

export interface DesktopScheduleClock {
    readonly cadence: 'once' | 'daily' | 'weekly';
    readonly runAt: string;
    readonly weekday?: number;
    readonly createdAt: number;
    readonly enabled: boolean;
    readonly lastRunAt?: number;
    readonly lastOccurrenceAt?: number;
    readonly lastStatus?: string;
}

/** A scheduled task's prompt becomes its run's prompt, so it takes what the composer and the runtime take. */
export const SCHEDULE_PROMPT_MAX_CHARACTERS = 200_000;

/**
 * The day a weekly task runs (0 = Sunday … 6 = Saturday, as Date.getDay()). Weekly tasks saved before the day could
 * be chosen ran on Mondays, so a missing or invalid day stays Monday.
 */
export function scheduleWeekday(task: { readonly weekday?: unknown }): number {
    return typeof task.weekday === 'number' && Number.isInteger(task.weekday) && task.weekday >= 0 && task.weekday <= 6 ? task.weekday : 1;
}

export function localScheduleDateTime(now: number): string {
    const date = new Date(now);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function validScheduleTime(cadence: DesktopScheduleClock['cadence'], value: string): boolean {
    if (cadence !== 'once') return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && localScheduleDateTime(date.getTime()) === value;
}

/** Coalesce missed local-calendar occurrences into one catch-up, never a backlog. */
export function scheduledOccurrenceDue(task: DesktopScheduleClock, now: number): number | undefined {
    if (!task.enabled || task.lastStatus === 'running' || !validScheduleTime(task.cadence, task.runAt)) return undefined;
    if (task.cadence === 'once') {
        const at = new Date(task.runAt).getTime();
        return at <= now && !task.lastRunAt && !task.lastOccurrenceAt ? at : undefined;
    }
    const [hours, minutes] = task.runAt.split(':').map(Number);
    // Pick the calendar day first, then put the clock time on that day. Setting the hour on today and moving the
    // date afterwards carried a daylight-saving jump of today onto the previous day and made up an occurrence
    // that had already run (audit B14-01).
    const today = new Date(now);
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (task.cadence === 'weekly') day.setDate(day.getDate() - ((day.getDay() - scheduleWeekday(task) + 7) % 7));
    const onDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0).getTime();
    let at = onDay(day);
    if (at > now) at = onDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() - (task.cadence === 'weekly' ? 7 : 1)));
    const previous = task.lastOccurrenceAt ?? task.lastRunAt ?? 0;
    return at >= task.createdAt && at > previous ? at : undefined;
}
