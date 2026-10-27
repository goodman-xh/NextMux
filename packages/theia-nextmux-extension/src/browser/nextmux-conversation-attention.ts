import { conversationAttention, validConversationReceipt, type AttentionTurn, type ConversationAttention, type ConversationReadReceipt } from '../common/nextmux-conversation-attention';
export { conversationAttention, monotonicConversationCompletionAt } from '../common/nextmux-conversation-attention';
import type { NextMuxDesktopLocale } from './nextmux-locale';

export function conversationNoticeUnread(notice: ConversationAttention | undefined, receipt: ConversationReadReceipt | undefined): boolean {
    if (!notice || !receipt) return Boolean(notice);
    // A receipt acknowledges one event. Wall clocks, UUID ordering and a
    // newer event's receipt cannot establish whether another event was read.
    return notice.sessionId !== receipt.sessionId || notice.noticeId !== receipt.noticeId;
}

const labels: Record<NextMuxDesktopLocale, readonly string[]> = {
    en: ['New result', 'Task ended with an error', 'Task paused', 'Your answer is needed', 'Permission needed', 'Task cancelled'],
    'zh-CN': ['有新结果', '任务异常结束', '任务已暂停', '等待你的回答', '等待授权', '任务已取消'],
    'zh-TW': ['有新結果', '任務異常結束', '任務已暫停', '等待你的回答', '等待授權', '任務已取消'],
    ja: ['新しい結果', 'タスクがエラーで終了', 'タスク一時停止', '回答が必要です', '許可が必要です', 'タスクキャンセル'],
    ko: ['새 결과', '작업 오류 종료', '작업 일시 중지', '답변 필요', '권한 필요', '작업 취소됨'],
    es: ['Nuevo resultado', 'La tarea terminó con un error', 'Tarea en pausa', 'Se necesita tu respuesta', 'Se necesita permiso', 'Tarea cancelada'],
    fr: ['Nouveau résultat', 'Tâche terminée avec une erreur', 'Tâche en pause', 'Votre réponse est requise', 'Autorisation requise', 'Tâche annulée'],
    de: ['Neues Ergebnis', 'Aufgabe mit Fehler beendet', 'Aufgabe pausiert', 'Antwort erforderlich', 'Berechtigung erforderlich', 'Aufgabe abgebrochen'],
    'pt-BR': ['Novo resultado', 'Tarefa encerrada com erro', 'Tarefa pausada', 'Sua resposta é necessária', 'Permissão necessária', 'Tarefa cancelada'],
    ru: ['Новый результат', 'Задача завершилась с ошибкой', 'Задача приостановлена', 'Нужен ваш ответ', 'Нужно разрешение', 'Задача отменена'],
    ar: ['نتيجة جديدة', 'انتهت المهمة بخطأ', 'المهمة متوقفة مؤقتاً', 'إجابتك مطلوبة', 'الإذن مطلوب', 'أُلغيت المهمة'],
    hi: ['नया परिणाम', 'कार्य त्रुटि के साथ समाप्त', 'कार्य रुका हुआ', 'आपका उत्तर आवश्यक है', 'अनुमति आवश्यक है', 'कार्य रद्द']
};

export function conversationAttentionLabel(locale: NextMuxDesktopLocale, kind: ConversationAttention['kind']): string {
    return labels[locale][['complete', 'error', 'paused', 'question', 'permission', 'cancelled'].indexOf(kind)];
}

/** Lazy, batched receipt cache. It never serializes or rewrites conversation bodies. */
export class ConversationReadTracker {
    private readonly cache = new Map<string, ConversationReadReceipt>();
    private readonly loaded = new Set<string>();
    private readonly queued = new Map<string, ConversationReadReceipt>();
    private readonly unsaved = new Map<string, ConversationReadReceipt>();
    private retryTimer: ReturnType<typeof setTimeout> | undefined;
    private retryAttempt = 0;
    private loading = false;
    private disposed = false;
    private readonly notices = new WeakMap<AttentionTurn, { sessionId: string; value: ConversationAttention | undefined; expiresAt: number }>();

    constructor(private readonly io: {
        read: (ids: readonly string[], noticeIds?: readonly string[]) => Promise<readonly ConversationReadReceipt[]>;
        mark: (value: ConversationReadReceipt) => Promise<ConversationReadReceipt>;
        changed: () => void;
        broadcast?: (value: ConversationReadReceipt) => void;
    }) {}

    notice(sessionId: string, turn: AttentionTurn | undefined): ConversationAttention | undefined {
        if (!turn) return undefined;
        const previous = this.notices.get(turn);
        if (previous && previous.sessionId === sessionId && previous.expiresAt > Date.now()) return previous.value;
        const value = conversationAttention(sessionId, turn);
        const expiresAt = turn.stage === 'running' && value ? Date.now() + 1_000 : Infinity;
        this.notices.set(turn, { sessionId, value, expiresAt });
        return value;
    }

    private key(notice: ConversationReadReceipt): string {
        return `${notice.sessionId}\0${notice.noticeId}`;
    }

    unread(notice: ConversationAttention | undefined): boolean {
        if (!notice) return false;
        const key = this.key(notice);
        if (this.cache.has(key)) return false;
        if (!this.loaded.has(key)) {
            this.queued.set(key, notice);
            if (!this.loading) { this.loading = true; queueMicrotask(() => void this.load()); }
            // Avoid a false flash before local receipts have been loaded.
            return false;
        }
        return true;
    }

    private async load(): Promise<void> {
        while (!this.disposed && this.queued.size) {
            const batch = [...this.queued.entries()].slice(0, 500);
            const keys = new Set(batch.map(([key]) => key));
            try {
                const rows = await this.io.read(batch.map(([, receipt]) => receipt.sessionId), batch.map(([, receipt]) => receipt.noticeId));
                if (this.disposed) return;
                for (const row of rows) {
                    if (validConversationReceipt(row) && keys.has(this.key(row))) this.merge(row);
                }
            } catch {
                // In-memory receipts still work when persistence is unavailable; never retry in a render loop.
            }
            for (const key of keys) {
                this.queued.delete(key);
                this.loaded.add(key);
            }
        }
        this.loading = false;
        if (!this.disposed) this.io.changed();
    }

    private merge(receipt: ConversationReadReceipt): boolean {
        const key = this.key(receipt);
        const previous = this.cache.get(key);
        if (previous && (previous.readAt ?? 0) >= (receipt.readAt ?? 0)) return false;
        this.cache.set(key, receipt);
        this.loaded.add(key);
        return true;
    }

    accept(receipt: ConversationReadReceipt): void {
        if (!this.disposed && validConversationReceipt(receipt) && this.merge(receipt)) this.io.changed();
    }

    async seen(notice: ConversationAttention | undefined): Promise<void> {
        if (this.disposed || !notice || !validConversationReceipt(notice)) return;
        const key = this.key(notice);
        const unsaved = this.unsaved.get(key);
        if (unsaved) return this.persist(unsaved);
        if (this.cache.has(key)) return;
        const acknowledged: ConversationReadReceipt = { ...notice, readAt: Date.now() };
        this.merge(acknowledged);
        this.io.changed();
        this.io.broadcast?.(acknowledged);
        return this.persist(acknowledged);
    }

    /**
     * The dot goes away at once; a receipt the backend could not save is kept and saved again on the next open or a
     * bounded backoff, so a restart never brings back a dot that was read (audit A06-03).
     */
    private async persist(receipt: ConversationReadReceipt): Promise<void> {
        const key = this.key(receipt);
        try {
            const persisted = await this.io.mark(receipt);
            this.unsaved.delete(key);
            this.retryAttempt = 0;
            this.accept(persisted);
        } catch {
            if (this.disposed) return;
            this.unsaved.set(key, receipt);
            if (this.retryTimer || this.retryAttempt >= 8) return;
            this.retryTimer = setTimeout(() => {
                this.retryTimer = undefined;
                this.retryAttempt++;
                for (const pending of [...this.unsaved.values()]) void this.persist(pending);
            }, Math.min(5_000 * 2 ** this.retryAttempt, 300_000));
        }
    }

    dispose(): void {
        this.disposed = true;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        this.queued.clear(); this.cache.clear(); this.loaded.clear(); this.unsaved.clear();
    }
}
