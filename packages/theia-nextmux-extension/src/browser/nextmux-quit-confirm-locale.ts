import type { NextMuxDesktopLocale } from './nextmux-locale';

/** Native “quit while a task runs” dialog, shown by the main process in the interface language. */
export interface QuitConfirmTexts {
    readonly title: string;
    readonly body: string;
    readonly quit: string;
    readonly stay: string;
}

const texts: Readonly<Record<NextMuxDesktopLocale, QuitConfirmTexts>> = {
    en: { title: 'A task is still running', body: 'Quitting NextMux stops the running task. What it has finished so far is kept.', quit: 'Quit and stop the task', stay: 'Keep running' },
    'zh-CN': { title: '有任务正在运行', body: '退出 NextMux 会停止正在运行的任务，已经完成的内容会保留。', quit: '退出并停止任务', stay: '继续运行' },
    'zh-TW': { title: '有任務正在執行', body: '結束 NextMux 會停止正在執行的任務，已完成的內容會保留。', quit: '結束並停止任務', stay: '繼續執行' },
    ja: { title: '実行中のタスクがあります', body: 'NextMux を終了すると実行中のタスクは停止します。ここまでの結果は保持されます。', quit: '終了してタスクを停止', stay: '実行を続ける' },
    ko: { title: '실행 중인 작업이 있습니다', body: 'NextMux를 종료하면 실행 중인 작업이 중지됩니다. 지금까지 완료된 내용은 유지됩니다.', quit: '종료하고 작업 중지', stay: '계속 실행' },
    es: { title: 'Hay una tarea en curso', body: 'Salir de NextMux detendrá la tarea en curso. Lo que ya terminó se conserva.', quit: 'Salir y detener la tarea', stay: 'Seguir ejecutando' },
    fr: { title: 'Une tâche est en cours', body: 'Quitter NextMux arrête la tâche en cours. Ce qui est déjà terminé est conservé.', quit: 'Quitter et arrêter la tâche', stay: 'Continuer' },
    de: { title: 'Eine Aufgabe läuft noch', body: 'Beim Beenden von NextMux wird die laufende Aufgabe gestoppt. Bereits Erledigtes bleibt erhalten.', quit: 'Beenden und Aufgabe stoppen', stay: 'Weiterlaufen lassen' },
    'pt-BR': { title: 'Uma tarefa ainda está em execução', body: 'Sair do NextMux interrompe a tarefa em execução. O que já foi concluído é mantido.', quit: 'Sair e parar a tarefa', stay: 'Continuar executando' },
    ru: { title: 'Задача ещё выполняется', body: 'При выходе из NextMux выполняемая задача будет остановлена. Уже сделанное сохранится.', quit: 'Выйти и остановить задачу', stay: 'Продолжить' },
    ar: { title: 'لا تزال هناك مهمة قيد التشغيل', body: 'سيؤدي إنهاء NextMux إلى إيقاف المهمة الجارية، مع الاحتفاظ بما اكتمل حتى الآن.', quit: 'إنهاء وإيقاف المهمة', stay: 'متابعة التشغيل' },
    hi: { title: 'एक काम अभी चल रहा है', body: 'NextMux बंद करने पर चल रहा काम रुक जाएगा। अब तक पूरा हुआ हिस्सा सुरक्षित रहेगा।', quit: 'बंद करें और काम रोकें', stay: 'चलने दें' }
};

export function quitConfirmTexts(locale: NextMuxDesktopLocale): QuitConfirmTexts {
    return texts[locale] || texts.en;
}
