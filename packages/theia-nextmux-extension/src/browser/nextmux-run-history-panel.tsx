import * as React from '@theia/core/shared/react';
import type { AgentRunEvent } from '@nextmux/agent-runtime';
import type { DesktopAgentRunHistoryDetail, DesktopAgentRunHistoryRecord, NextMuxPlatformService } from '../common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from './nextmux-locale';

const copy: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['查看运行记录', '关闭', '刷新', '加载中…', '暂无运行记录', '读取失败，请重试', '加载更多', '显示当前对话已保存的运行记录。'],
    'zh-TW': ['查看執行記錄', '關閉', '重新整理', '載入中…', '尚無執行記錄', '讀取失敗，請重試', '載入更多', '顯示目前對話已保存的執行記錄。'],
    en: ['View run history', 'Close', 'Refresh', 'Loading…', 'No run history yet', 'Could not load; retry', 'Load more', 'Saved run records for this conversation.'],
    ja: ['実行履歴を表示', '閉じる', '更新', '読み込み中…', '実行履歴はありません', '読み込み失敗。再試行', 'さらに読み込む', 'この会話に保存された実行記録。'],
    ko: ['실행 기록 보기', '닫기', '새로 고침', '불러오는 중…', '실행 기록 없음', '불러오기 실패. 다시 시도', '더 보기', '이 대화에 저장된 실행 기록.'],
    es: ['Ver historial', 'Cerrar', 'Actualizar', 'Cargando…', 'Sin ejecuciones', 'Error al cargar; reintentar', 'Cargar más', 'Registros guardados de esta conversación.'],
    fr: ['Historique des exécutions', 'Fermer', 'Actualiser', 'Chargement…', 'Aucune exécution', 'Échec du chargement ; réessayer', 'Charger la suite', 'Exécutions enregistrées pour cette conversation.'],
    de: ['Ausführungsverlauf', 'Schließen', 'Aktualisieren', 'Lädt…', 'Noch keine Ausführungen', 'Laden fehlgeschlagen; erneut versuchen', 'Mehr laden', 'Gespeicherte Ausführungen dieses Gesprächs.'],
    'pt-BR': ['Histórico de execuções', 'Fechar', 'Atualizar', 'Carregando…', 'Nenhuma execução', 'Falha ao carregar; tentar novamente', 'Carregar mais', 'Registros salvos desta conversa.'],
    ru: ['История выполнения', 'Закрыть', 'Обновить', 'Загрузка…', 'История пуста', 'Ошибка загрузки; повторить', 'Загрузить ещё', 'Сохранённые запуски этого разговора.'],
    ar: ['عرض سجل التشغيل', 'إغلاق', 'تحديث', 'جارٍ التحميل…', 'لا يوجد سجل', 'تعذر التحميل؛ أعد المحاولة', 'تحميل المزيد', 'السجلات المحفوظة لهذه المحادثة.'],
    hi: ['रन इतिहास देखें', 'बंद करें', 'ताज़ा करें', 'लोड हो रहा है…', 'कोई इतिहास नहीं', 'लोड नहीं हुआ; पुनः प्रयास करें', 'और लोड करें', 'इस बातचीत के सहेजे गए रन।']
};

export const runHistoryLabel = (locale: NextMuxDesktopLocale): string => copy[locale][0];

/** A lazy, read-only view. Opening history never resumes or executes a run. */
export function RunHistoryPanel({ conversationId, title, locale, service, close, renderEvents, trapFocus }: {
    readonly conversationId: string;
    readonly title: string;
    readonly locale: NextMuxDesktopLocale;
    readonly service: Pick<NextMuxPlatformService, 'listConversationAgentRuns' | 'readConversationAgentRun'>;
    readonly close: () => void;
    readonly renderEvents: (events: readonly AgentRunEvent[], runId: string) => React.ReactNode;
    readonly trapFocus: (event: React.KeyboardEvent<HTMLElement>) => void;
}): React.ReactElement {
    const text = copy[locale];
    const [runs, setRuns] = React.useState<readonly DesktopAgentRunHistoryRecord[]>([]);
    const [cursor, setCursor] = React.useState<string>();
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(false);
    const [selected, setSelected] = React.useState('');
    const [detail, setDetail] = React.useState<DesktopAgentRunHistoryDetail>();
    const [detailError, setDetailError] = React.useState(false);
    const generation = React.useRef(0);
    const detailGeneration = React.useRef(0);
    const closeButton = React.useRef<HTMLButtonElement>(null);
    const id = React.useId();

    const load = async (next?: string): Promise<void> => {
        const current = ++generation.current;
        setLoading(true); setError(false);
        try {
            const page = await service.listConversationAgentRuns(conversationId, next, 20);
            if (current !== generation.current) return;
            setRuns(previous => next ? [...previous, ...page.runs.filter(run => !previous.some(item => item.runId === run.runId))] : page.runs);
            setCursor(page.nextCursor);
        } catch { if (current === generation.current) setError(true); }
        finally { if (current === generation.current) setLoading(false); }
    };
    React.useEffect(() => {
        const previous = document.activeElement;
        closeButton.current?.focus();
        void load();
        return () => {
            generation.current++; detailGeneration.current++;
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        };
    }, [conversationId, service]);
    const open = async (runId: string): Promise<void> => {
        const current = ++detailGeneration.current;
        setSelected(runId); setDetail(undefined); setDetailError(false);
        if (!runId) return;
        try {
            const result = await service.readConversationAgentRun(conversationId, runId);
            if (current !== detailGeneration.current) return;
            setDetail(result); setDetailError(!result);
        } catch { if (current === detailGeneration.current) setDetailError(true); }
    };
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
        <section className='nmx-thread-dialog nmx-run-history-dialog' role='dialog' aria-modal='true' aria-labelledby={id}
            lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
                else trapFocus(event);
            }}>
            <header><h2 id={id}>{text[0]}</h2><button ref={closeButton} aria-label={text[1]} onClick={close}>×</button></header>
            <p className='nmx-run-history-conversation' title={title} data-nmx-literal>{title}</p>
            <div className='nmx-run-history-toolbar'><small>{text[7]}</small><button disabled={loading} onClick={() => { void open(''); void load(); }}>{text[2]}</button></div>
            <div className='nmx-run-history-list' aria-busy={loading}>
                {runs.map(run => <article key={run.runId}>
                    <button className='nmx-run-history-row' aria-expanded={selected === run.runId} onClick={() => void open(selected === run.runId ? '' : run.runId)}>
                        <i className={`codicon codicon-${run.status === 'completed' ? 'pass' : run.status === 'running' ? 'loading' : run.status === 'error' || run.status === 'tool_failed' ? 'error' : 'debug-pause'}`} aria-hidden='true'></i>
                        <time dateTime={new Date(run.startedAt).toISOString()}>{new Date(run.startedAt).toLocaleString(locale)}</time>
                        <code title={run.runId}>{run.runId.slice(0, 8)}</code>
                        <i className={`codicon codicon-chevron-${selected === run.runId ? 'down' : 'right'}`} aria-hidden='true'></i>
                    </button>
                    {selected === run.runId && <div className='nmx-run-history-detail'>
                        {detailError ? <button onClick={() => void open(run.runId)}>{text[5]}</button>
                            : !detail ? <p role='status'>{text[3]}</p>
                                : <>{detail.error && <p role='status'>{detail.error.message}</p>}{detail.events.length ? renderEvents(detail.events, run.runId) : <p>{text[4]}</p>}</>}
                    </div>}
                </article>)}
                {loading && <p role='status'>{text[3]}</p>}
                {!loading && !error && !runs.length && <p>{text[4]}</p>}
                {error && <button onClick={() => void load(cursor)}>{text[5]}</button>}
                {!error && cursor && !loading && <button onClick={() => void load(cursor)}>{text[6]}</button>}
            </div>
        </section>
    </div>;
}
