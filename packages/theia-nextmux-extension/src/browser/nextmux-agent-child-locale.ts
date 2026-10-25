import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * Compact labels for the unified work-context drawer.  These are deliberately
 * kept separate from model output: changing the interface locale must never
 * translate a user's prompt or an agent's response.
 */
export type AgentChildTextKey =
    | 'browser'
    | 'files'
    | 'agents'
    | 'noChildren'
    | 'running'
    | 'completed'
    | 'cancelled'
    | 'paused'
    | 'interrupted'
    | 'limitReached'
    | 'failed'
    | 'openAgent'
    | 'contextMemory'
    | 'parentRun'
    | 'events'
    | 'mainTask'
    | 'childAgent'
    | 'continue'
    | 'continuePlaceholder'
    | 'send'
    | 'stop'
    | 'noCheckpoint'
    | 'continuationFailed'
    | 'receipt'
    | 'partial'
    | 'unknown'
    | 'retrySafe'
    | 'manualReview';

const translations: Record<NextMuxDesktopLocale, Record<AgentChildTextKey, string>> = {
    'zh-CN': {
        browser: '浏览器', files: '文件', agents: '智能体', noChildren: '当前对话还没有子智能体',
        running: '运行中', completed: '已完成', cancelled: '已取消', paused: '已暂停', interrupted: '已中断', limitReached: '达到限制', failed: '失败',
        openAgent: '打开智能体', contextMemory: '上下文记忆', parentRun: '父任务', events: '事件', mainTask: '主任务', childAgent: '子智能体',
        continue: '继续对话', continuePlaceholder: '向这个智能体补充方向…', send: '发送', stop: '停止', noCheckpoint: '该智能体没有可继续的检查点', continuationFailed: '智能体续接失败',
        receipt: '执行回执', partial: '部分完成', unknown: '副作用状态未知', retrySafe: '可以从检查点安全继续', manualReview: "建议先核对结果，勿自动重试"
    },
    'zh-TW': {
        browser: '瀏覽器', files: '檔案', agents: '智慧體', noChildren: '目前對話沒有子智慧體',
        running: '執行中', completed: '已完成', cancelled: '已取消', paused: '已暫停', interrupted: '已中斷', limitReached: '達到限制', failed: '失敗',
        openAgent: '開啟智慧體', contextMemory: '上下文記憶', parentRun: '父任務', events: '事件', mainTask: '主要任務', childAgent: '子智慧體',
        continue: '繼續對話', continuePlaceholder: '向這個智慧體補充方向…', send: '傳送', stop: '停止', noCheckpoint: '此智慧體沒有可繼續的檢查點', continuationFailed: '智慧體續接失敗',
        receipt: '執行回執', partial: '部分完成', unknown: '副作用狀態未知', retrySafe: '可以從檢查點安全繼續', manualReview: "建議先核對結果，勿自動重試"
    },
    en: {
        browser: 'Browser', files: 'Files', agents: 'Agents', noChildren: 'No child agents in this task',
        running: 'Running', completed: 'Completed', cancelled: 'Cancelled', paused: 'Paused', interrupted: 'Interrupted', limitReached: 'Limit reached', failed: 'Failed',
        openAgent: 'Open agent', contextMemory: 'Context memory', parentRun: 'Parent run', events: 'Events', mainTask: 'Main task', childAgent: 'Child agent',
        continue: 'Continue', continuePlaceholder: 'Send direction to this agent…', send: 'Send', stop: 'Stop', noCheckpoint: 'This agent has no resumable checkpoint', continuationFailed: 'Agent continuation failed',
        receipt: 'Execution receipt', partial: 'Partially completed', unknown: 'Side-effect state unknown', retrySafe: 'Safe to continue from the checkpoint', manualReview: "Review the result before retrying; avoid automatic retries"
    },
    ja: {
        browser: 'ブラウザー', files: 'ファイル', agents: 'エージェント', noChildren: 'このタスクに子エージェントはありません',
        running: '実行中', completed: '完了', cancelled: 'キャンセル済み', paused: '一時停止', interrupted: '中断', limitReached: '上限に到達', failed: '失敗',
        openAgent: 'エージェントを開く', contextMemory: 'コンテキストメモリ', parentRun: '親タスク', events: 'イベント', mainTask: 'メインタスク', childAgent: '子エージェント',
        continue: '会話を続ける', continuePlaceholder: 'このエージェントに指示を追加…', send: '送信', stop: '停止', noCheckpoint: '再開可能なチェックポイントがありません', continuationFailed: 'エージェントの続行に失敗しました',
        receipt: '実行レシート', partial: '一部完了', unknown: '副作用の状態が不明', retrySafe: 'チェックポイントから安全に続行できます', manualReview: "再試行の前に結果を確認し、自動再試行は避けてください"
    },
    ko: {
        browser: '브라우저', files: '파일', agents: '에이전트', noChildren: '이 작업에 하위 에이전트가 없습니다',
        running: '실행 중', completed: '완료', cancelled: '취소됨', paused: '일시 중지', interrupted: '중단됨', limitReached: '한도 도달', failed: '실패',
        openAgent: '에이전트 열기', contextMemory: '컨텍스트 메모리', parentRun: '상위 작업', events: '이벤트', mainTask: '주 작업', childAgent: '하위 에이전트',
        continue: '대화 계속', continuePlaceholder: '이 에이전트에 지시 추가…', send: '보내기', stop: '중지', noCheckpoint: '재개 가능한 체크포인트가 없습니다', continuationFailed: '에이전트 계속 실행 실패',
        receipt: '실행 결과', partial: '부분 완료', unknown: '부작용 상태 알 수 없음', retrySafe: '체크포인트에서 안전하게 계속할 수 있음', manualReview: "재시도 전에 결과를 확인하고 자동 재시도는 피하세요"
    },
    es: {
        browser: 'Navegador', files: 'Archivos', agents: 'Agentes', noChildren: 'No hay agentes secundarios en esta tarea',
        running: 'En ejecución', completed: 'Completado', cancelled: 'Cancelado', paused: 'Pausado', interrupted: 'Interrumpido', limitReached: 'Límite alcanzado', failed: 'Error',
        openAgent: 'Abrir agente', contextMemory: 'Memoria de contexto', parentRun: 'Tarea principal', events: 'Eventos', mainTask: 'Tarea principal', childAgent: 'Agente secundario',
        continue: 'Continuar conversación', continuePlaceholder: 'Añadir instrucciones a este agente…', send: 'Enviar', stop: 'Detener', noCheckpoint: 'Este agente no tiene un punto de reanudación', continuationFailed: 'No se pudo continuar el agente',
        receipt: 'Recibo de ejecución', partial: 'Completado parcialmente', unknown: 'Estado del efecto secundario desconocido', retrySafe: 'Se puede continuar de forma segura desde el punto de control', manualReview: "Revisa el resultado antes de reintentar y evita los reintentos automáticos"
    },
    fr: {
        browser: 'Navigateur', files: 'Fichiers', agents: 'Agents', noChildren: 'Aucun agent enfant dans cette tâche',
        running: 'En cours', completed: 'Terminé', cancelled: 'Annulé', paused: 'En pause', interrupted: 'Interrompu', limitReached: 'Limite atteinte', failed: 'Échec',
        openAgent: 'Ouvrir l’agent', contextMemory: 'Mémoire de contexte', parentRun: 'Tâche parente', events: 'Événements', mainTask: 'Tâche principale', childAgent: 'Agent enfant',
        continue: 'Continuer la conversation', continuePlaceholder: 'Ajouter une instruction à cet agent…', send: 'Envoyer', stop: 'Arrêter', noCheckpoint: 'Aucun point de reprise pour cet agent', continuationFailed: 'Échec de la reprise de l’agent',
        receipt: 'Reçu d’exécution', partial: 'Partiellement terminé', unknown: 'État des effets secondaires inconnu', retrySafe: 'Reprise sûre depuis le point de contrôle', manualReview: "Vérifiez le résultat avant de réessayer et évitez les tentatives automatiques"
    },
    de: {
        browser: 'Browser', files: 'Dateien', agents: 'Agenten', noChildren: 'Keine untergeordneten Agenten in dieser Aufgabe',
        running: 'Wird ausgeführt', completed: 'Abgeschlossen', cancelled: 'Abgebrochen', paused: 'Pausiert', interrupted: 'Unterbrochen', limitReached: 'Limit erreicht', failed: 'Fehler',
        openAgent: 'Agent öffnen', contextMemory: 'Kontextspeicher', parentRun: 'Übergeordnete Aufgabe', events: 'Ereignisse', mainTask: 'Hauptaufgabe', childAgent: 'Untergeordneter Agent',
        continue: 'Unterhaltung fortsetzen', continuePlaceholder: 'Anweisung für diesen Agenten…', send: 'Senden', stop: 'Stopp', noCheckpoint: 'Für diesen Agenten gibt es keinen Fortsetzungspunkt', continuationFailed: 'Agent konnte nicht fortgesetzt werden',
        receipt: 'Ausführungsbeleg', partial: 'Teilweise abgeschlossen', unknown: 'Status der Nebenwirkungen unbekannt', retrySafe: 'Sicher vom Prüfpunkt fortsetzbar', manualReview: "Prüfe das Ergebnis vor einem erneuten Versuch und vermeide automatische Wiederholungen"
    },
    'pt-BR': {
        browser: 'Navegador', files: 'Arquivos', agents: 'Agentes', noChildren: 'Não há agentes filhos nesta tarefa',
        running: 'Em execução', completed: 'Concluído', cancelled: 'Cancelado', paused: 'Pausado', interrupted: 'Interrompido', limitReached: 'Limite atingido', failed: 'Falha',
        openAgent: 'Abrir agente', contextMemory: 'Memória de contexto', parentRun: 'Tarefa pai', events: 'Eventos', mainTask: 'Tarefa principal', childAgent: 'Agente filho',
        continue: 'Continuar conversa', continuePlaceholder: 'Adicionar orientação a este agente…', send: 'Enviar', stop: 'Parar', noCheckpoint: 'Este agente não tem um ponto de retomada', continuationFailed: 'Falha ao continuar o agente',
        receipt: 'Recibo de execução', partial: 'Concluído parcialmente', unknown: 'Estado do efeito colateral desconhecido', retrySafe: 'É seguro continuar a partir do checkpoint', manualReview: "Confira o resultado antes de tentar novamente e evite novas tentativas automáticas"
    },
    ru: {
        browser: 'Браузер', files: 'Файлы', agents: 'Агенты', noChildren: 'В этой задаче нет дочерних агентов',
        running: 'Выполняется', completed: 'Завершено', cancelled: 'Отменено', paused: 'Приостановлено', interrupted: 'Прервано', limitReached: 'Достигнут лимит', failed: 'Ошибка',
        openAgent: 'Открыть агента', contextMemory: 'Контекстная память', parentRun: 'Родительская задача', events: 'События', mainTask: 'Основная задача', childAgent: 'Дочерний агент',
        continue: 'Продолжить диалог', continuePlaceholder: 'Добавить указание этому агенту…', send: 'Отправить', stop: 'Остановить', noCheckpoint: 'У агента нет доступной точки продолжения', continuationFailed: 'Не удалось продолжить агента',
        receipt: 'Отчёт выполнения', partial: 'Выполнено частично', unknown: 'Состояние побочных эффектов неизвестно', retrySafe: 'Можно безопасно продолжить с контрольной точки', manualReview: "Проверьте результат перед повторной попыткой и избегайте автоматических повторов"
    },
    ar: {
        browser: 'المتصفح', files: 'الملفات', agents: 'الوكلاء', noChildren: 'لا يوجد وكلاء فرعيون في هذه المهمة',
        running: 'قيد التشغيل', completed: 'مكتمل', cancelled: 'ملغى', paused: 'متوقف مؤقتًا', interrupted: 'متوقف', limitReached: 'تم بلوغ الحد', failed: 'فشل',
        openAgent: 'فتح الوكيل', contextMemory: 'ذاكرة السياق', parentRun: 'المهمة الأصلية', events: 'الأحداث', mainTask: 'المهمة الرئيسية', childAgent: 'الوكيل الفرعي',
        continue: 'متابعة المحادثة', continuePlaceholder: 'أضف توجيهًا لهذا الوكيل…', send: 'إرسال', stop: 'إيقاف', noCheckpoint: 'لا توجد نقطة استئناف لهذا الوكيل', continuationFailed: 'تعذر متابعة الوكيل',
        receipt: 'إيصال التنفيذ', partial: 'اكتمل جزئيًا', unknown: 'حالة الآثار الجانبية غير معروفة', retrySafe: 'يمكن المتابعة بأمان من نقطة التحقق', manualReview: "راجع النتيجة قبل إعادة المحاولة وتجنب المحاولات التلقائية"
    },
    hi: {
        browser: 'ब्राउज़र', files: 'फ़ाइलें', agents: 'एजेंट', noChildren: 'इस कार्य में कोई चाइल्ड एजेंट नहीं है',
        running: 'चल रहा है', completed: 'पूरा हुआ', cancelled: 'रद्द', paused: 'रुका हुआ', interrupted: 'रुका हुआ', limitReached: 'सीमा पूरी', failed: 'विफल',
        openAgent: 'एजेंट खोलें', contextMemory: 'संदर्भ मेमोरी', parentRun: 'मूल कार्य', events: 'इवेंट', mainTask: 'मुख्य कार्य', childAgent: 'चाइल्ड एजेंट',
        continue: 'बातचीत जारी रखें', continuePlaceholder: 'इस एजेंट को निर्देश दें…', send: 'भेजें', stop: 'रोकें', noCheckpoint: 'इस एजेंट के लिए कोई पुनःआरंभ बिंदु नहीं है', continuationFailed: 'एजेंट जारी नहीं रह सका',
        receipt: 'निष्पादन रसीद', partial: 'आंशिक रूप से पूरा', unknown: 'साइड-इफेक्ट की स्थिति अज्ञात', retrySafe: 'चेकपॉइंट से सुरक्षित रूप से जारी रख सकते हैं', manualReview: "दोबारा कोशिश करने से पहले परिणाम जाँचें और स्वचालित पुनःप्रयास से बचें"
    }
};

function uncheckedAgentChildText(locale: NextMuxDesktopLocale, key: AgentChildTextKey): string {
    return translations[locale][key];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function agentChildText(locale: Parameters<typeof uncheckedAgentChildText>[0], key: Parameters<typeof uncheckedAgentChildText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedAgentChildText>>): string {
    return totalCopy(locale, key, language => uncheckedAgentChildText(language, key, ...rest));
}
