import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

export type TaskNotificationKey = 'done' | 'paused' | 'failed' | 'comicDone' | 'comicFailed' | 'scheduledDone' | 'scheduledFailed' | 'setting' | 'settingHint';

const catalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<TaskNotificationKey, string>>>> = {
    'zh-CN': { done: '任务已完成', paused: '任务已暂停，等你继续', failed: '任务未完成：{error}', comicDone: '漫剧改编完成', comicFailed: '漫剧改编未完成', scheduledDone: '计划任务已完成', scheduledFailed: '计划任务需要处理', setting: '任务完成时发送系统通知', settingHint: '仅在 NextMux 不在前台时通知，点击通知回到对应对话。' },
    'zh-TW': { done: '任務已完成', paused: '任務已暫停，等你繼續', failed: '任務未完成：{error}', comicDone: '漫劇改編完成', comicFailed: '漫劇改編未完成', scheduledDone: '排程任務已完成', scheduledFailed: '排程任務需要處理', setting: '任務完成時傳送系統通知', settingHint: '僅在 NextMux 不在前景時通知，點擊通知回到對應對話。' },
    en: { done: 'Task finished', paused: 'Task paused — waiting for you', failed: 'Task didn’t finish: {error}', comicDone: 'Comic adaptation finished', comicFailed: 'Comic adaptation didn’t finish', scheduledDone: 'Scheduled task finished', scheduledFailed: 'Scheduled task needs attention', setting: 'Notify me when a task finishes', settingHint: 'Only when NextMux is in the background. Click the notification to return to the conversation.' },
    ja: { done: 'タスクが完了しました', paused: 'タスクが一時停止しました', failed: 'タスクは完了しませんでした：{error}', comicDone: 'コミックの脚色が完了しました', comicFailed: 'コミックの脚色が完了しませんでした', scheduledDone: 'スケジュールタスクが完了しました', scheduledFailed: 'スケジュールタスクの確認が必要です', setting: 'タスク完了時にシステム通知を送る', settingHint: 'NextMux がバックグラウンドのときだけ通知します。通知をクリックすると会話に戻ります。' },
    ko: { done: '작업이 완료되었습니다', paused: '작업이 일시정지되었습니다', failed: '작업이 완료되지 않았습니다: {error}', comicDone: '만화극 각색 완료', comicFailed: '만화극 각색이 완료되지 않았습니다', scheduledDone: '예약 작업 완료', scheduledFailed: '예약 작업 확인 필요', setting: '작업 완료 시 시스템 알림 보내기', settingHint: 'NextMux가 백그라운드일 때만 알립니다. 알림을 클릭하면 대화로 돌아갑니다.' },
    es: { done: 'Tarea terminada', paused: 'Tarea en pausa, esperándote', failed: 'La tarea no terminó: {error}', comicDone: 'Adaptación del cómic terminada', comicFailed: 'La adaptación del cómic no terminó', scheduledDone: 'Tarea programada terminada', scheduledFailed: 'La tarea programada necesita atención', setting: 'Avisarme cuando termine una tarea', settingHint: 'Solo si NextMux está en segundo plano. Pulsa el aviso para volver a la conversación.' },
    fr: { done: 'Tâche terminée', paused: 'Tâche en pause, en attente', failed: 'La tâche n’a pas abouti : {error}', comicDone: 'Adaptation de la BD terminée', comicFailed: 'L’adaptation de la BD n’a pas abouti', scheduledDone: 'Tâche planifiée terminée', scheduledFailed: 'La tâche planifiée demande votre attention', setting: 'M’avertir à la fin d’une tâche', settingHint: 'Uniquement quand NextMux est en arrière-plan. Cliquez sur la notification pour revenir à la conversation.' },
    de: { done: 'Aufgabe abgeschlossen', paused: 'Aufgabe pausiert, wartet auf Sie', failed: 'Aufgabe nicht abgeschlossen: {error}', comicDone: 'Comic-Adaption abgeschlossen', comicFailed: 'Comic-Adaption nicht abgeschlossen', scheduledDone: 'Geplante Aufgabe abgeschlossen', scheduledFailed: 'Geplante Aufgabe braucht Aufmerksamkeit', setting: 'Benachrichtigen, wenn eine Aufgabe fertig ist', settingHint: 'Nur wenn NextMux im Hintergrund ist. Ein Klick führt zurück zur Unterhaltung.' },
    'pt-BR': { done: 'Tarefa concluída', paused: 'Tarefa pausada, aguardando você', failed: 'A tarefa não terminou: {error}', comicDone: 'Adaptação do quadrinho concluída', comicFailed: 'A adaptação do quadrinho não terminou', scheduledDone: 'Tarefa agendada concluída', scheduledFailed: 'Tarefa agendada precisa de atenção', setting: 'Avisar quando uma tarefa terminar', settingHint: 'Só quando o NextMux está em segundo plano. Clique no aviso para voltar à conversa.' },
    ru: { done: 'Задача выполнена', paused: 'Задача приостановлена и ждёт вас', failed: 'Задача не завершена: {error}', comicDone: 'Адаптация комикса завершена', comicFailed: 'Адаптация комикса не завершена', scheduledDone: 'Запланированная задача выполнена', scheduledFailed: 'Запланированная задача требует внимания', setting: 'Уведомлять о завершении задач', settingHint: 'Только когда NextMux в фоне. Нажмите на уведомление, чтобы вернуться к беседе.' },
    ar: { done: 'اكتملت المهمة', paused: 'المهمة متوقفة بانتظارك', failed: 'لم تكتمل المهمة: {error}', comicDone: 'اكتمل تكييف القصة المصورة', comicFailed: 'لم يكتمل تكييف القصة المصورة', scheduledDone: 'اكتملت المهمة المجدولة', scheduledFailed: 'المهمة المجدولة تحتاج إلى متابعة', setting: 'أعلمني عند انتهاء مهمة', settingHint: 'فقط عندما يكون NextMux في الخلفية. انقر على الإشعار للعودة إلى المحادثة.' },
    hi: { done: 'कार्य पूरा हुआ', paused: 'कार्य रुका है, आपका इंतज़ार है', failed: 'कार्य पूरा नहीं हुआ: {error}', comicDone: 'कॉमिक रूपांतरण पूरा हुआ', comicFailed: 'कॉमिक रूपांतरण पूरा नहीं हुआ', scheduledDone: 'निर्धारित कार्य पूरा हुआ', scheduledFailed: 'निर्धारित कार्य पर ध्यान दें', setting: 'कार्य पूरा होने पर सूचना दें', settingHint: 'केवल जब NextMux पृष्ठभूमि में हो। सूचना पर क्लिक करके बातचीत पर लौटें।' }
};

function uncheckedTaskNotificationText(locale: NextMuxDesktopLocale, key: TaskNotificationKey, values: Readonly<Record<string, string>> = {}): string {
    return (catalog[locale] || catalog.en)[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

export const SYSTEM_NOTIFICATIONS_KEY = 'nextmux.desktop.systemNotifications.v1';

export function systemNotificationsEnabled(storage: Pick<Storage, 'getItem'> | undefined): boolean {
    try { return storage?.getItem(SYSTEM_NOTIFICATIONS_KEY) !== 'off'; } catch { return true; }
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function taskNotificationText(locale: Parameters<typeof uncheckedTaskNotificationText>[0], key: Parameters<typeof uncheckedTaskNotificationText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedTaskNotificationText>>): string {
    return totalCopy(locale, key, language => uncheckedTaskNotificationText(language, key, ...rest));
}
