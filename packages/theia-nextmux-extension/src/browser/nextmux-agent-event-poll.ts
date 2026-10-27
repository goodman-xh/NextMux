import type { AgentRunEvent } from '@nextmux/agent-runtime';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { appendAgentActivityEvents } from './nextmux-agent-activity';

export interface AgentEventPollSnapshot {
    readonly events: readonly AgentRunEvent[];
    readonly firstEventIndex: number;
    readonly nextEventIndex: number;
    readonly updatedAt: number;
}

export interface AgentEventPollMergeResult {
    readonly events: readonly AgentRunEvent[];
    readonly cursor: number;
    readonly gapDetected: boolean;
}

const gapTranslations: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '较早的 {count} 条执行记录已压缩，当前活动已从保留日志恢复。',
    'zh-TW': '較早的 {count} 筆執行記錄已壓縮，目前活動已從保留記錄恢復。',
    en: '{count} earlier execution records were compacted; current activity was recovered from the retained journal.',
    ja: '以前の実行記録 {count} 件は圧縮され、現在のアクティビティは保持されたログから復元されました。',
    ko: '이전 실행 기록 {count}개가 압축되었으며 현재 활동은 보존된 로그에서 복구되었습니다.',
    es: 'Se compactaron {count} registros de ejecución anteriores; la actividad actual se recuperó del registro conservado.',
    fr: '{count} anciens enregistrements d’exécution ont été compactés ; l’activité actuelle a été restaurée depuis le journal conservé.',
    de: '{count} frühere Ausführungseinträge wurden komprimiert; die aktuelle Aktivität wurde aus dem erhaltenen Protokoll wiederhergestellt.',
    'pt-BR': '{count} registros de execução anteriores foram compactados; a atividade atual foi recuperada do histórico preservado.',
    ru: 'Предыдущие записи выполнения ({count}) были сжаты; текущая активность восстановлена из сохранённого журнала.',
    ar: 'تم ضغط {count} من سجلات التنفيذ السابقة؛ واستُعيد النشاط الحالي من السجل المحفوظ.',
    hi: 'पहले के {count} निष्पादन रिकॉर्ड संक्षिप्त किए गए; वर्तमान गतिविधि सुरक्षित लॉग से पुनर्स्थापित की गई।'
};

function eventIndex(value: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function eventTurn(events: readonly AgentRunEvent[]): number {
    return events.reduce((latest, event) => 'turn' in event && Number.isSafeInteger(event.turn)
        ? Math.max(latest, event.turn)
        : latest, 1);
}

function eventTimestamp(snapshot: AgentEventPollSnapshot): string {
    const retainedTimestamp = snapshot.events.find(event => typeof event.at === 'string' && event.at)?.at;
    if (retainedTimestamp) return retainedTimestamp;
    const updatedAt = Number.isFinite(snapshot.updatedAt) && snapshot.updatedAt >= 0
        ? snapshot.updatedAt
        : eventIndex(snapshot.firstEventIndex) * 1_000;
    return new Date(updatedAt).toISOString();
}

function journalGapEvent(
    current: readonly AgentRunEvent[],
    snapshot: AgentEventPollSnapshot,
    locale: NextMuxDesktopLocale,
    missedEventCount: number
): AgentRunEvent {
    return {
        type: 'assistant_progress',
        turn: eventTurn([...current, ...snapshot.events]),
        content: gapTranslations[locale].replace('{count}', String(missedEventCount)),
        origin: 'runtime',
        at: eventTimestamp(snapshot)
    };
}

/**
 * Merges one cursor-addressed backend journal window into durable UI activity.
 * Existing rows are never replaced. A server-side eviction is represented by
 * one deterministic runtime narration before the retained window, and the
 * absolute cursor only moves forward (including an empty retained window).
 */
export function mergeAgentEventPollSnapshot(
    current: readonly AgentRunEvent[],
    cursor: number,
    snapshot: AgentEventPollSnapshot,
    locale: NextMuxDesktopLocale
): AgentEventPollMergeResult {
    const currentCursor = eventIndex(cursor);
    const firstEventIndex = eventIndex(snapshot.firstEventIndex);
    const nextEventIndex = Math.max(firstEventIndex, eventIndex(snapshot.nextEventIndex));
    const gapDetected = firstEventIndex > currentCursor;
    const incoming = gapDetected
        ? [journalGapEvent(current, snapshot, locale, firstEventIndex - currentCursor), ...snapshot.events]
        : snapshot.events;
    return {
        events: appendAgentActivityEvents(current, incoming),
        cursor: Math.max(currentCursor, nextEventIndex),
        gapDetected
    };
}
