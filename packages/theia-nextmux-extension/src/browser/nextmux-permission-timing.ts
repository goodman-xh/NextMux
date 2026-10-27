import type { NextMuxDesktopLocale } from './nextmux-locale';

const copy: Record<NextMuxDesktopLocale, string> = {
    'zh-CN': '当前任务：{current}。下次新发送的任务使用：{next}。',
    'zh-TW': '目前任務：{current}。下次新傳送的任務使用：{next}。',
    en: 'Current task: {current}. Newly sent tasks will use: {next}.',
    ja: '現在のタスク：{current}。次に新しく送信するタスク：{next}。',
    ko: '현재 작업: {current}. 다음에 새로 전송하는 작업: {next}.',
    es: 'Tarea actual: {current}. Las nuevas tareas enviadas usarán: {next}.',
    fr: 'Tâche en cours : {current}. Les nouvelles tâches envoyées utiliseront : {next}.',
    de: 'Aktuelle Aufgabe: {current}. Neu gesendete Aufgaben verwenden: {next}.',
    'pt-BR': 'Tarefa atual: {current}. Novas tarefas enviadas usarão: {next}.',
    ru: 'Текущая задача: {current}. Новые отправленные задачи: {next}.',
    ar: 'المهمة الحالية: {current}. ستستخدم المهام الجديدة المُرسلة: {next}.',
    hi: 'वर्तमान कार्य: {current}। नए भेजे गए कार्य उपयोग करेंगे: {next}।'
};

/** A running task retains the permission snapshot it was accepted with. */
export function runningPermissionTiming(locale: NextMuxDesktopLocale, current: string, next: string): string {
    return copy[locale].replace('{current}', current).replace('{next}', next);
}
