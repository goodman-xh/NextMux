import { legacyRuntimeFinalMessage, normalizeRuntimeFinalMessage } from '@nextmux/agent-runtime/semantic-messages';
export { canonicalRuntimeFinal, normalizeRuntimeFinalMessage } from '@nextmux/agent-runtime/semantic-messages';
import { classifyModelError, formatModelError } from '@nextmux/model-runtime/errors';
import type { DesktopAgentRunFailure, DesktopAgentRunFailureKind } from '../common/nextmux-platform-protocol';
import { normalizeRelayFeedbackRequestIds } from '../common/nextmux-relay-feedback';
import type { AgentRuntimeFinalMessage } from '@nextmux/agent-runtime';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
import { isMerchantApiDeletedFailure } from '../common/nextmux-merchant-api-deleted';

export { isMerchantApiDeletedFailure };

const stopKeys = ['context_window_exceeded', 'turn_limit_reached', 'tool_call_limit_reached', 'repeated_tool_calls', 'input_token_limit_reached', 'output_token_limit_reached', 'token_usage_unknown', 'user_input_cancelled', 'user_input_expired', 'empty_response'] as const;
const stopMessages: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    en: ['This task exceeds the model’s context capacity. Your task and recovery state are saved. Choose a model with a larger context to continue.',
        'The model-turn limit was reached. Continue from the saved state.', 'The tool-call limit was reached. Continue from the saved state.',
        'Repeated tool calls were detected. The task is paused for review.', 'The input-token budget was reached. No further request was sent.',
        'The output-token budget was reached. No further request was sent.', 'Usage could not be verified. The task is paused to preserve its token budget.',
        'The question was cancelled. The task is paused.', 'The question expired. The task is paused.', 'The model returned no text. Completed work is preserved.'],
    'zh-CN': ['当前任务超过此模型的上下文容量。任务和恢复记录已保留，请选择上下文容量更大的模型继续。',
        '已达到模型轮次上限，可从保存的状态继续。', '已达到工具调用上限，可从保存的状态继续。', '检测到重复工具调用，任务已暂停，请检查后继续。',
        '已达到输入令牌预算，未再发送请求。', '已达到输出令牌预算，未再发送请求。', '用量无法验证，任务已暂停以保留令牌预算。',
        '提问已取消，任务已暂停。', '提问已过期，任务已暂停。', '模型没有返回正文，已完成的工作已保留。'],
    'zh-TW': ['目前任務超過此模型的上下文容量。任務及復原記錄已保留，請選擇上下文容量更大的模型繼續。',
        '已達模型輪次上限，可從儲存的狀態繼續。', '已達工具呼叫上限，可從儲存的狀態繼續。', '偵測到重複工具呼叫，任務已暫停，請檢查後繼續。',
        '已達輸入權杖預算，未再傳送請求。', '已達輸出權杖預算，未再傳送請求。', '用量無法驗證，任務已暫停以保留權杖預算。',
        '提問已取消，任務已暫停。', '提問已過期，任務已暫停。', '模型沒有傳回正文，已完成的工作已保留。'],
    ja: ['タスクがモデルのコンテキスト容量を超えています。タスクと復元状態は保存済みです。容量の大きいモデルを選んで続行してください。',
        'モデルのターン数上限に達しました。保存済みの状態から続行できます。', 'ツール呼び出しの上限に達しました。保存済みの状態から続行できます。', '同じツール呼び出しが繰り返されたため、確認のために一時停止しました。',
        '入力トークンの予算に達しました。追加のリクエストは送信していません。', '出力トークンの予算に達しました。追加のリクエストは送信していません。', '使用量を確認できません。トークン予算を守るため一時停止しました。',
        '質問がキャンセルされました。タスクを一時停止しました。', '質問の期限が切れました。タスクを一時停止しました。', 'モデルから本文が返されませんでした。完了済みの作業は保存されています。'],
    ko: ['작업이 모델의 컨텍스트 용량을 초과했습니다. 작업과 복구 상태가 저장되었습니다. 용량이 더 큰 모델을 선택해 계속하세요.',
        '모델 턴 한도에 도달했습니다. 저장된 상태에서 계속할 수 있습니다.', '도구 호출 한도에 도달했습니다. 저장된 상태에서 계속할 수 있습니다.', '반복되는 도구 호출을 감지해 검토를 위해 작업을 일시 중지했습니다.',
        '입력 토큰 예산에 도달했습니다. 추가 요청을 보내지 않았습니다.', '출력 토큰 예산에 도달했습니다. 추가 요청을 보내지 않았습니다.', '사용량을 확인할 수 없어 토큰 예산을 보호하기 위해 일시 중지했습니다.',
        '질문이 취소되어 작업이 일시 중지되었습니다.', '질문이 만료되어 작업이 일시 중지되었습니다.', '모델이 본문을 반환하지 않았습니다. 완료된 작업은 보존됩니다.'],
    es: ['La tarea supera la capacidad de contexto del modelo. La tarea y su estado de recuperación están guardados. Elige un modelo con más contexto para continuar.',
        'Se alcanzó el límite de turnos del modelo. Continúa desde el estado guardado.', 'Se alcanzó el límite de llamadas a herramientas. Continúa desde el estado guardado.', 'Se detectaron llamadas repetidas a herramientas. La tarea está en pausa para revisarla.',
        'Se alcanzó el presupuesto de tokens de entrada. No se enviaron más solicitudes.', 'Se alcanzó el presupuesto de tokens de salida. No se enviaron más solicitudes.', 'No se pudo verificar el consumo. La tarea está en pausa para proteger su presupuesto de tokens.',
        'Se canceló la pregunta. La tarea está en pausa.', 'La pregunta caducó. La tarea está en pausa.', 'El modelo no devolvió texto. El trabajo completado se conserva.'],
    fr: ['Cette tâche dépasse la capacité de contexte du modèle. La tâche et son état de récupération sont enregistrés. Choisissez un modèle avec plus de contexte pour continuer.',
        'La limite de tours du modèle est atteinte. Reprenez depuis l’état enregistré.', 'La limite d’appels d’outils est atteinte. Reprenez depuis l’état enregistré.', 'Des appels d’outils répétés ont été détectés. La tâche est en pause pour vérification.',
        'Le budget de tokens d’entrée est atteint. Aucune requête supplémentaire n’a été envoyée.', 'Le budget de tokens de sortie est atteint. Aucune requête supplémentaire n’a été envoyée.', 'La consommation n’a pas pu être vérifiée. La tâche est en pause pour protéger son budget de tokens.',
        'La question a été annulée. La tâche est en pause.', 'La question a expiré. La tâche est en pause.', 'Le modèle n’a renvoyé aucun texte. Le travail terminé est conservé.'],
    de: ['Die Aufgabe überschreitet die Kontextkapazität des Modells. Aufgabe und Wiederherstellungszustand sind gespeichert. Wähle ein Modell mit größerem Kontext.',
        'Das Limit für Modellrunden wurde erreicht. Fahre vom gespeicherten Zustand aus fort.', 'Das Limit für Werkzeugaufrufe wurde erreicht. Fahre vom gespeicherten Zustand aus fort.', 'Wiederholte Werkzeugaufrufe wurden erkannt. Die Aufgabe ist zur Prüfung pausiert.',
        'Das Budget für Eingabetokens wurde erreicht. Keine weitere Anfrage wurde gesendet.', 'Das Budget für Ausgabetokens wurde erreicht. Keine weitere Anfrage wurde gesendet.', 'Die Nutzung konnte nicht bestätigt werden. Die Aufgabe ist zum Schutz des Tokenbudgets pausiert.',
        'Die Frage wurde abgebrochen. Die Aufgabe ist pausiert.', 'Die Frage ist abgelaufen. Die Aufgabe ist pausiert.', 'Das Modell hat keinen Text zurückgegeben. Erledigte Arbeit bleibt erhalten.'],
    'pt-BR': ['A tarefa excede a capacidade de contexto do modelo. A tarefa e o estado de recuperação foram salvos. Escolha um modelo com mais contexto para continuar.',
        'O limite de turnos do modelo foi atingido. Continue do estado salvo.', 'O limite de chamadas de ferramentas foi atingido. Continue do estado salvo.', 'Foram detectadas chamadas repetidas de ferramentas. A tarefa está pausada para revisão.',
        'O orçamento de tokens de entrada foi atingido. Nenhuma outra solicitação foi enviada.', 'O orçamento de tokens de saída foi atingido. Nenhuma outra solicitação foi enviada.', 'Não foi possível verificar o uso. A tarefa está pausada para preservar o orçamento de tokens.',
        'A pergunta foi cancelada. A tarefa está pausada.', 'A pergunta expirou. A tarefa está pausada.', 'O modelo não retornou texto. O trabalho concluído foi preservado.'],
    ru: ['Задача превышает вместимость контекста модели. Задача и состояние восстановления сохранены. Выберите модель с большим контекстом.',
        'Достигнут лимит обращений к модели. Продолжите из сохранённого состояния.', 'Достигнут лимит вызовов инструментов. Продолжите из сохранённого состояния.', 'Обнаружены повторные вызовы инструментов. Задача приостановлена для проверки.',
        'Достигнут бюджет входных токенов. Новые запросы не отправлялись.', 'Достигнут бюджет выходных токенов. Новые запросы не отправлялись.', 'Не удалось проверить расход. Задача приостановлена для сохранения бюджета токенов.',
        'Вопрос отменён. Задача приостановлена.', 'Срок ответа на вопрос истёк. Задача приостановлена.', 'Модель не вернула текст. Выполненная работа сохранена.'],
    ar: ['تتجاوز المهمة سعة سياق النموذج. تم حفظ المهمة وحالة الاسترداد. اختر نموذجاً بسياق أكبر للمتابعة.',
        'تم بلوغ حد جولات النموذج. تابع من الحالة المحفوظة.', 'تم بلوغ حد استدعاءات الأدوات. تابع من الحالة المحفوظة.', 'تم اكتشاف استدعاءات أدوات متكررة. أُوقفت المهمة مؤقتاً للمراجعة.',
        'تم بلوغ ميزانية رموز الإدخال. لم تُرسل طلبات إضافية.', 'تم بلوغ ميزانية رموز الإخراج. لم تُرسل طلبات إضافية.', 'تعذر التحقق من الاستخدام. أُوقفت المهمة مؤقتاً لحماية ميزانية الرموز.',
        'أُلغي السؤال. أُوقفت المهمة مؤقتاً.', 'انتهت صلاحية السؤال. أُوقفت المهمة مؤقتاً.', 'لم يُرجع النموذج نصاً. تم الاحتفاظ بالعمل المنجز.'],
    hi: ['कार्य मॉडल की संदर्भ क्षमता से अधिक है। कार्य और पुनर्प्राप्ति स्थिति सहेजी गई है। जारी रखने के लिए अधिक संदर्भ क्षमता वाला मॉडल चुनें।',
        'मॉडल चरणों की सीमा पूरी हुई। सहेजी गई स्थिति से जारी रखें।', 'टूल कॉल की सीमा पूरी हुई। सहेजी गई स्थिति से जारी रखें।', 'दोहराए गए टूल कॉल मिले। समीक्षा के लिए कार्य रोका गया है।',
        'इनपुट टोकन बजट पूरा हुआ। कोई और अनुरोध नहीं भेजा गया।', 'आउटपुट टोकन बजट पूरा हुआ। कोई और अनुरोध नहीं भेजा गया।', 'उपयोग सत्यापित नहीं हो सका। टोकन बजट बचाने के लिए कार्य रोका गया है।',
        'प्रश्न रद्द हुआ। कार्य रोका गया है।', 'प्रश्न की समय सीमा समाप्त हुई। कार्य रोका गया है।', 'मॉडल ने कोई पाठ नहीं लौटाया। पूरा किया गया काम सुरक्षित है।']
};

export type RuntimeFinalMessage = AgentRuntimeFinalMessage;

const truncatedMessages: Readonly<Record<NextMuxDesktopLocale, string>> = {
    en: 'The model repeatedly hit its output limit without making progress. The task is paused; partial output and recovery state are preserved.',
    'zh-CN': '模型连续触及输出上限且没有新进展，任务已暂停；部分输出和恢复记录已保留。',
    'zh-TW': '模型連續觸及輸出上限且沒有新進展，任務已暫停；部分輸出及復原記錄已保留。',
    ja: 'モデルが進展なく出力上限に繰り返し達したため、タスクを一時停止しました。途中の出力と復元状態は保存されています。',
    ko: '모델이 새 진전 없이 출력 한도에 반복해서 도달하여 작업이 일시 중지되었습니다. 부분 출력과 복구 상태가 보존됩니다.',
    es: 'El modelo alcanzó repetidamente su límite de salida sin avanzar. La tarea está en pausa; la salida parcial y el estado de recuperación se conservan.',
    fr: 'Le modèle a atteint plusieurs fois sa limite de sortie sans progresser. La tâche est en pause ; la sortie partielle et l’état de récupération sont conservés.',
    de: 'Das Modell hat wiederholt ohne Fortschritt sein Ausgabelimit erreicht. Die Aufgabe ist pausiert; Teilausgabe und Wiederherstellungszustand sind gespeichert.',
    'pt-BR': 'O modelo atingiu repetidamente seu limite de saída sem avançar. A tarefa está pausada; a saída parcial e o estado de recuperação foram preservados.',
    ru: 'Модель неоднократно достигла лимита вывода без прогресса. Задача приостановлена; частичный вывод и состояние восстановления сохранены.',
    ar: 'بلغ النموذج حد الإخراج مراراً دون تقدم. أُوقفت المهمة مؤقتاً؛ تم حفظ الإخراج الجزئي وحالة الاسترداد.',
    hi: 'मॉडल बिना नई प्रगति के बार-बार आउटपुट सीमा पर पहुँचा। कार्य रोका गया है; आंशिक आउटपुट और पुनर्प्राप्ति स्थिति सुरक्षित हैं।',
};

const checkpointFailureMessages: Readonly<Record<NextMuxDesktopLocale, string>> = {
    "en": "The child task paused because its checkpoint could not be committed. Completed work and usage are retained. Review the result before retrying; avoid automatic retries.",
    "zh-CN": "子任务因检查点未能提交而暂停。已完成的工作和用量已保留，请先核对结果，勿自动重试。",
    "zh-TW": "子任務因檢查點未能提交而暫停。已完成的工作及用量已保留，請先核對結果，勿自動重試。",
    "ja": "チェックポイントを確定できなかったため、子タスクを一時停止しました。完了済みの作業と使用量は保持されています。再試行の前に結果を確認し、自動再試行は避けてください。",
    "ko": "체크포인트를 확정하지 못해 하위 작업이 일시 중지되었습니다. 완료된 작업과 사용량은 보존됩니다. 재시도 전에 결과를 확인하고 자동 재시도는 피하세요.",
    "es": "La subtarea se pausó porque no se pudo confirmar su punto de control. El trabajo completado y el consumo se conservan. Revisa el resultado antes de volver a intentarlo y evita los reintentos automáticos.",
    "fr": "La sous-tâche est en pause, car son point de contrôle n’a pas pu être validé. Le travail effectué et la consommation sont conservés. Vérifiez le résultat avant de réessayer et évitez les tentatives automatiques.",
    "de": "Die Teilaufgabe wurde pausiert, weil ihr Prüfpunkt nicht bestätigt werden konnte. Erledigte Arbeit und Verbrauch bleiben erhalten. Prüfe das Ergebnis vor einem erneuten Versuch und vermeide automatische Wiederholungen.",
    "pt-BR": "A subtarefa foi pausada porque seu checkpoint não pôde ser confirmado. O trabalho concluído e o uso foram preservados. Confira o resultado antes de tentar novamente e evite novas tentativas automáticas.",
    "ru": "Подзадача приостановлена: не удалось зафиксировать контрольную точку. Выполненная работа и данные о расходе сохранены. Проверьте результат перед повторной попыткой и избегайте автоматических повторов.",
    "ar": "أُوقفت المهمة الفرعية مؤقتاً لتعذر تثبيت نقطة التحقق. تم الاحتفاظ بالعمل المنجز وبيانات الاستخدام. راجع النتيجة قبل إعادة المحاولة وتجنب المحاولات التلقائية.",
    "hi": "चेकपॉइंट की पुष्टि न हो पाने के कारण उपकार्य रोक दिया गया है। पूरा किया गया काम और उपयोग का विवरण सुरक्षित हैं। दोबारा कोशिश करने से पहले परिणाम जाँचें और स्वचालित पुनःप्रयास से बचें।"
};

export function runtimeFinalText(locale: NextMuxDesktopLocale, result: {
    readonly finalMessage?: RuntimeFinalMessage;
    readonly stopReason?: string;
    readonly finalText?: string;
}): string | undefined {
    const finalText = result.finalText?.trim() || '';
    const message = normalizeRuntimeFinalMessage(result.finalMessage);
    const legacy = legacyRuntimeFinalMessage(finalText, result.stopReason);
    const reason = message?.stopReason ?? legacy?.stopReason ?? (!finalText ? result.stopReason : undefined);
    if (!reason) return undefined;
    if (reason === 'checkpoint_persistence_failed') return checkpointFailureMessages[locale] ?? checkpointFailureMessages.en;
    if (reason === 'output_truncated') return truncatedMessages[locale] ?? truncatedMessages.en;
    if (reason === 'completed' && (message || legacy)) return agentOutcomeText(locale, 'completed');
    if (reason === 'pause_requested') return agentOutcomeText(locale, 'paused');
    if (reason === 'cancel_requested') return agentOutcomeText(locale, 'cancelledBody');
    if (reason === 'media_context_compaction_required') return agentOutcomeText(locale, 'mediaContextBody');
    const index = stopKeys.indexOf(reason as typeof stopKeys[number]);
    return index >= 0 ? stopMessages[locale][index] : undefined;
}

const en = {
    completed: 'Task completed',
    paused: 'Task paused · ready to continue',
    mediaContextPaused: 'Paused · media context preserved',
    mediaContextBody: 'The newest image or audio attachments alone exceed this model’s input capacity. Reduce the image resolution, split the audio file, or choose a model with a larger context, then continue. The original context is preserved; nothing was resent automatically.',
    contextWindowBody: 'This task exceeds the model’s context capacity. Your task and recovery state are saved. Choose a model with a larger context to continue.',
    cancelled: 'Task stopped',
    model_timeout: 'Model connection timed out',
    rate_limited: 'Model rate limit reached',
    model_unavailable: 'Model service is temporarily unavailable',
    model_auth: 'Model connection needs attention', api_key_rejected: 'API key rejected or missing · check it in Model center',
    tool_failed: 'A tool needs attention',
    waiting_user: 'Waiting for your action',
    insufficient_balance: 'Insufficient balance · add funds to continue',
    switch_policy_invalid: 'Model-switch settings are invalid. Choose the model again and retry.',
    route_unavailable: 'The selected model route is unavailable. Try another route.',
    route_capacity: 'The selected model route is busy. Try again shortly or choose another route.',
    privacy_route_unavailable: 'No available route matches your privacy settings. Choose a compatible route or review privacy settings.',
    model_not_ready: 'This model is not ready for billing yet. Choose a published model.',
    price_changed: 'The model price changed. Refresh the catalog and choose the model again.',
    network_failed: 'The connection failed. Check your network and try again.',
    merchant_api_deleted: 'The merchant API was deleted and the conversation stopped. Switch models to continue.',
    failed: 'Task needs attention',
    continueTask: 'Continue task',
    resumeContextHint: 'Continue from the saved context; the currently selected model applies to this continuation.',
    cancelledBody: 'The task was stopped. Completed work and activity are preserved.',
    fallbackBody: 'The task did not finish. You can try again.'
} as const;

export type AgentOutcomeTextKey = keyof typeof en;
type Catalog = Readonly<Record<AgentOutcomeTextKey, string>>;

const translations: Readonly<Record<NextMuxDesktopLocale, Catalog>> = {
    en,
    'zh-CN': {
        contextWindowBody: '当前任务超过此模型的上下文容量。任务和恢复记录已保留，请选择上下文容量更大的模型继续。',
        privacy_route_unavailable: '当前线路不符合你的隐私设置，请选择支持的线路或检查隐私设置。',
        mediaContextPaused: '已暂停 · 媒体上下文已保留', mediaContextBody: '最新的图片或音频附件本身已超出该模型的输入容量。请降低图片分辨率、拆分音频文件，或换用上下文更大的模型后点击继续。原上下文已保留，未自动重新请求。',
        completed: '任务已完成', paused: '任务已暂停 · 可继续', cancelled: '任务已停止', model_timeout: '模型连接超时', rate_limited: '模型请求受到限流',
        model_unavailable: '模型服务暂时不可用', model_auth: '模型连接需要处理', api_key_rejected: 'API Key 无效或缺失 · 请在模型中心检查', tool_failed: '工具执行需要处理', waiting_user: '等待你的操作', insufficient_balance: '余额不足 · 请充值后继续',
        switch_policy_invalid: '模型切换设置已失效，请重新选择模型后重试。', route_unavailable: '当前模型线路暂时不可用，请选择其他线路后重试。', model_not_ready: '该模型尚未完成计费审核，请选择已发布模型。', price_changed: '模型价格已变化，请刷新目录后重新选择模型。', network_failed: '连接失败，请检查网络后重试。',
        route_capacity: '当前模型线路繁忙，请稍后重试或选择其他线路。',
        merchant_api_deleted: '当前商家 API 已被删除，对话已停止，请切换模型',
        failed: '任务需要处理', continueTask: '继续任务', resumeContextHint: '从已保存的上下文继续；当前选择的模型从本次续跑开始生效。', cancelledBody: '已停止当前任务，已完成的操作和过程记录仍然保留。', fallbackBody: '任务尚未完成，可以重试。'
    },
    'zh-TW': {
        switch_policy_invalid: '模型切換設定已失效，請重新選擇模型後重試。',
        route_unavailable: '目前模型線路暫時無法使用，請選擇其他線路後重試。',
        route_capacity: '目前模型線路繁忙，請稍後重試或選擇其他線路。',
        model_not_ready: '此模型尚未完成計費審核，請選擇已發布的模型。',
        price_changed: '模型價格已變更，請重新整理目錄後再選擇模型。',
        network_failed: '連線失敗，請檢查網路後重試。',
        merchant_api_deleted: '目前商家 API 已被刪除，對話已停止，請切換模型',
        contextWindowBody: '目前任務超過此模型的上下文容量。任務及復原記錄已保留，請選擇上下文容量更大的模型繼續。',
        privacy_route_unavailable: '目前線路不符合你的隱私設定，請選擇支援的線路或檢查隱私設定。',
        mediaContextPaused: '已暫停 · 媒體上下文已保留', mediaContextBody: '最新的圖片或音訊附件本身已超出此模型的輸入容量。請降低圖片解析度、拆分音訊檔，或改用上下文更大的模型後按「繼續」。原上下文已保留，未自動重新請求。',
        completed: '任務已完成', paused: '任務已暫停 · 可繼續', cancelled: '任務已停止', model_timeout: '模型連線逾時', rate_limited: '模型請求受到限流',
        model_unavailable: '模型服務暫時無法使用', model_auth: '模型連線需要處理', api_key_rejected: 'API Key 無效或遺失 · 請在模型中心檢查', tool_failed: '工具執行需要處理', waiting_user: '等待你的操作', insufficient_balance: '餘額不足 · 請儲值後繼續',
        failed: '任務需要處理', continueTask: '繼續任務', resumeContextHint: '從已儲存的上下文繼續；目前選擇的模型會從本次續跑開始生效。', cancelledBody: '目前任務已停止，已完成的操作和過程記錄仍會保留。', fallbackBody: '任務尚未完成，可以重試。'
    },
    ja: {
        contextWindowBody: 'このタスクはモデルのコンテキスト容量を超えています。タスクと復元状態は保存されています。より大きなコンテキストのモデルを選んで続けてください。',
        switch_policy_invalid: 'モデル切り替えの設定が無効です。モデルを選び直して再試行してください。',
        route_unavailable: '選択したモデルの経路は現在利用できません。別の経路をお試しください。',
        route_capacity: '選択したモデルの経路が混み合っています。しばらくしてから再試行するか、別の経路を選んでください。',
        model_not_ready: 'このモデルは課金の準備がまだ完了していません。公開済みのモデルを選んでください。',
        price_changed: 'モデルの価格が変わりました。カタログを更新してモデルを選び直してください。',
        network_failed: '接続に失敗しました。ネットワークを確認して再試行してください。',
        merchant_api_deleted: '現在の事業者 API が削除されたため会話を停止しました。モデルを切り替えてください',
        privacy_route_unavailable: 'プライバシー設定に合う利用可能な経路がありません。対応する経路を選ぶか設定を確認してください。',
        mediaContextPaused: '一時停止 · メディアの文脈を保持', mediaContextBody: '最新の画像・音声添付だけでこのモデルの入力上限を超えています。画像の解像度を下げる、音声ファイルを分割する、またはより大きな文脈のモデルを選んでから続行してください。元の文脈は保持され、自動再送はしていません。',
        completed: 'タスク完了', paused: 'タスクを一時停止 · 続行可能', cancelled: 'タスクを停止しました', model_timeout: 'モデル接続がタイムアウトしました', rate_limited: 'モデルのレート制限に達しました',
        model_unavailable: 'モデルサービスは一時的に利用できません', model_auth: 'モデル接続の確認が必要です', api_key_rejected: 'API キーが無効か見つかりません · モデルセンターで確認してください', tool_failed: 'ツールの確認が必要です', waiting_user: '操作を待っています', insufficient_balance: '残高不足 · チャージして続行してください',
        failed: 'タスクの確認が必要です', continueTask: 'タスクを続行', resumeContextHint: '保存済みのコンテキストから続行します。現在選択中のモデルはこの続行から適用されます。', cancelledBody: 'タスクを停止しました。完了済みの操作と履歴は保持されています。', fallbackBody: 'タスクは完了していません。再試行できます。'
    },
    ko: {
        contextWindowBody: '이 작업이 모델의 컨텍스트 용량을 초과합니다. 작업과 복구 상태는 저장되었습니다. 더 큰 컨텍스트를 지원하는 모델을 선택해 계속하세요.',
        switch_policy_invalid: '모델 전환 설정이 유효하지 않습니다. 모델을 다시 선택한 뒤 재시도하세요.',
        route_unavailable: '선택한 모델 경로를 사용할 수 없습니다. 다른 경로를 시도하세요.',
        route_capacity: '선택한 모델 경로가 혼잡합니다. 잠시 후 다시 시도하거나 다른 경로를 선택하세요.',
        model_not_ready: '이 모델은 아직 과금 준비가 끝나지 않았습니다. 게시된 모델을 선택하세요.',
        price_changed: '모델 가격이 바뀌었습니다. 목록을 새로 고친 뒤 모델을 다시 선택하세요.',
        network_failed: '연결에 실패했습니다. 네트워크를 확인하고 다시 시도하세요.',
        merchant_api_deleted: '현재 판매자 API가 삭제되어 대화가 중지되었습니다. 모델을 전환해 주세요',
        privacy_route_unavailable: '개인정보 보호 설정에 맞는 사용 가능한 경로가 없습니다. 지원 경로를 선택하거나 설정을 확인하세요.',
        mediaContextPaused: '일시 중지 · 미디어 컨텍스트 보존됨', mediaContextBody: '최신 이미지·오디오 첨부만으로 이 모델의 입력 용량을 초과합니다. 이미지 해상도를 낮추거나 오디오 파일을 나누거나 컨텍스트가 더 큰 모델을 선택한 뒤 계속하세요. 원래 컨텍스트는 보존되며 자동으로 다시 보내지 않았습니다.',
        completed: '작업 완료', paused: '작업 일시 중지 · 계속 가능', cancelled: '작업 중지됨', model_timeout: '모델 연결 시간 초과', rate_limited: '모델 요청이 제한됨',
        model_unavailable: '모델 서비스를 일시적으로 사용할 수 없음', model_auth: '모델 연결 확인 필요', api_key_rejected: 'API 키가 거부되었거나 없음 · 모델 센터에서 확인하세요', tool_failed: '도구 확인 필요', waiting_user: '사용자 작업 대기 중', insufficient_balance: '잔액 부족 · 충전 후 계속하세요',
        failed: '작업 확인 필요', continueTask: '작업 계속', resumeContextHint: '저장된 컨텍스트에서 계속합니다. 현재 선택한 모델은 이번 계속 실행부터 적용됩니다.', cancelledBody: '작업이 중지되었습니다. 완료된 작업과 활동 기록은 보존됩니다.', fallbackBody: '작업이 완료되지 않았습니다. 다시 시도할 수 있습니다.'
    },
    es: {
        contextWindowBody: 'Esta tarea supera la capacidad de contexto del modelo. La tarea y su estado de recuperación están guardados. Elige un modelo con más contexto para continuar.',
        switch_policy_invalid: 'La configuración de cambio de modelo no es válida. Vuelve a elegir el modelo e inténtalo de nuevo.',
        route_unavailable: 'La ruta del modelo elegida no está disponible. Prueba otra ruta.',
        route_capacity: 'La ruta del modelo elegida está ocupada. Inténtalo en un momento o elige otra ruta.',
        model_not_ready: 'Este modelo aún no está listo para facturarse. Elige un modelo publicado.',
        price_changed: 'El precio del modelo cambió. Actualiza el catálogo y vuelve a elegir el modelo.',
        network_failed: 'La conexión falló. Comprueba tu red y vuelve a intentarlo.',
        merchant_api_deleted: 'La API del comerciante fue eliminada y la conversación se detuvo. Cambia de modelo.',
        privacy_route_unavailable: 'No hay una ruta disponible que cumpla tu configuración de privacidad. Elige una ruta compatible o revisa la configuración.',
        mediaContextPaused: 'En pausa · contexto multimedia conservado', mediaContextBody: 'Los últimos adjuntos de imagen o audio superan por sí solos la capacidad de entrada de este modelo. Reduce la resolución de la imagen, divide el archivo de audio o elige un modelo con más contexto y continúa. Se conserva el contexto original; no se reenvió nada automáticamente.',
        completed: 'Tarea completada', paused: 'Tarea en pausa · lista para continuar', cancelled: 'Tarea detenida', model_timeout: 'La conexión con el modelo agotó el tiempo', rate_limited: 'Se alcanzó el límite del modelo',
        model_unavailable: 'El servicio del modelo no está disponible temporalmente', model_auth: 'La conexión del modelo requiere atención', api_key_rejected: 'Clave de API rechazada o ausente · revísala en el centro de modelos', tool_failed: 'Una herramienta requiere atención', waiting_user: 'Esperando tu acción', insufficient_balance: 'Saldo insuficiente · añade fondos para continuar',
        failed: 'La tarea requiere atención', continueTask: 'Continuar tarea', resumeContextHint: 'Continúa desde el contexto guardado; el modelo seleccionado se aplica desde esta continuación.', cancelledBody: 'La tarea se detuvo. El trabajo completado y la actividad se conservan.', fallbackBody: 'La tarea no terminó. Puedes volver a intentarlo.'
    },
    fr: {
        contextWindowBody: 'Cette tâche dépasse la capacité de contexte du modèle. La tâche et son état de reprise sont enregistrés. Choisissez un modèle avec un contexte plus grand pour continuer.',
        switch_policy_invalid: 'Les réglages de changement de modèle ne sont pas valides. Choisissez de nouveau le modèle et réessayez.',
        route_unavailable: 'La route du modèle choisie est indisponible. Essayez une autre route.',
        route_capacity: 'La route du modèle choisie est saturée. Réessayez dans un instant ou choisissez une autre route.',
        model_not_ready: 'Ce modèle n’est pas encore prêt pour la facturation. Choisissez un modèle publié.',
        price_changed: 'Le prix du modèle a changé. Actualisez le catalogue et choisissez de nouveau le modèle.',
        network_failed: 'La connexion a échoué. Vérifiez votre réseau et réessayez.',
        merchant_api_deleted: 'L’API du marchand a été supprimée et la conversation s’est arrêtée. Changez de modèle.',
        privacy_route_unavailable: 'Aucune route disponible ne respecte vos réglages de confidentialité. Choisissez une route compatible ou vérifiez ces réglages.',
        mediaContextPaused: 'En pause · contexte multimédia conservé', mediaContextBody: 'Les dernières pièces jointes image ou audio dépassent à elles seules la capacité d’entrée de ce modèle. Réduisez la résolution de l’image, divisez le fichier audio ou choisissez un modèle à plus grand contexte, puis continuez. Le contexte original est conservé ; rien n’a été renvoyé automatiquement.',
        completed: 'Tâche terminée', paused: 'Tâche en pause · prête à reprendre', cancelled: 'Tâche arrêtée', model_timeout: 'La connexion au modèle a expiré', rate_limited: 'Limite de requêtes du modèle atteinte',
        model_unavailable: 'Le service du modèle est temporairement indisponible', model_auth: 'La connexion au modèle nécessite une action', api_key_rejected: 'Clé d’API refusée ou absente · vérifiez-la dans le centre des modèles', tool_failed: 'Un outil nécessite une action', waiting_user: 'En attente de votre action', insufficient_balance: 'Solde insuffisant · ajoutez des fonds pour continuer',
        failed: 'La tâche nécessite une action', continueTask: 'Continuer la tâche', resumeContextHint: 'Reprenez depuis le contexte enregistré ; le modèle sélectionné s’applique à partir de cette reprise.', cancelledBody: 'La tâche a été arrêtée. Le travail terminé et l’activité sont conservés.', fallbackBody: 'La tâche n’est pas terminée. Vous pouvez réessayer.'
    },
    de: {
        contextWindowBody: 'Diese Aufgabe übersteigt die Kontextkapazität des Modells. Aufgabe und Wiederherstellungsstand sind gespeichert. Wähle ein Modell mit größerem Kontext, um fortzufahren.',
        switch_policy_invalid: 'Die Einstellungen zum Modellwechsel sind ungültig. Wähle das Modell erneut und versuche es noch einmal.',
        route_unavailable: 'Die gewählte Modellroute ist nicht verfügbar. Versuche eine andere Route.',
        route_capacity: 'Die gewählte Modellroute ist ausgelastet. Versuche es gleich noch einmal oder wähle eine andere Route.',
        model_not_ready: 'Dieses Modell ist noch nicht für die Abrechnung bereit. Wähle ein veröffentlichtes Modell.',
        price_changed: 'Der Modellpreis hat sich geändert. Aktualisiere den Katalog und wähle das Modell erneut.',
        network_failed: 'Die Verbindung ist fehlgeschlagen. Prüfe dein Netzwerk und versuche es erneut.',
        merchant_api_deleted: 'Die Händler-API wurde gelöscht und das Gespräch gestoppt. Bitte Modell wechseln.',
        privacy_route_unavailable: 'Keine verfügbare Route erfüllt deine Datenschutzeinstellungen. Wähle eine passende Route oder prüfe die Einstellungen.',
        mediaContextPaused: 'Pausiert · Medienkontext erhalten', mediaContextBody: 'Die neuesten Bild- oder Audioanhänge überschreiten allein die Eingabekapazität dieses Modells. Verringern Sie die Bildauflösung, teilen Sie die Audiodatei oder wählen Sie ein Modell mit größerem Kontext und fahren Sie dann fort. Der ursprüngliche Kontext bleibt erhalten; nichts wurde automatisch erneut gesendet.',
        completed: 'Aufgabe abgeschlossen', paused: 'Aufgabe pausiert · kann fortgesetzt werden', cancelled: 'Aufgabe gestoppt', model_timeout: 'Zeitüberschreitung bei der Modellverbindung', rate_limited: 'Modellratenlimit erreicht',
        model_unavailable: 'Modelldienst vorübergehend nicht verfügbar', model_auth: 'Modellverbindung erfordert Aufmerksamkeit', api_key_rejected: 'API-Schlüssel abgelehnt oder fehlt · im Modellcenter prüfen', tool_failed: 'Ein Werkzeug erfordert Aufmerksamkeit', waiting_user: 'Warten auf Ihre Aktion', insufficient_balance: 'Guthaben unzureichend · bitte zum Fortfahren aufladen',
        failed: 'Aufgabe erfordert Aufmerksamkeit', continueTask: 'Aufgabe fortsetzen', resumeContextHint: 'Aus dem gespeicherten Kontext fortsetzen; das ausgewählte Modell gilt ab dieser Fortsetzung.', cancelledBody: 'Die Aufgabe wurde gestoppt. Abgeschlossene Arbeit und Aktivitäten bleiben erhalten.', fallbackBody: 'Die Aufgabe wurde nicht abgeschlossen. Sie können es erneut versuchen.'
    },
    'pt-BR': {
        contextWindowBody: 'Esta tarefa excede a capacidade de contexto do modelo. A tarefa e o estado de recuperação foram salvos. Escolha um modelo com mais contexto para continuar.',
        switch_policy_invalid: 'As configurações de troca de modelo são inválidas. Escolha o modelo novamente e tente de novo.',
        route_unavailable: 'A rota do modelo escolhida está indisponível. Tente outra rota.',
        route_capacity: 'A rota do modelo escolhida está ocupada. Tente novamente em instantes ou escolha outra rota.',
        model_not_ready: 'Este modelo ainda não está pronto para cobrança. Escolha um modelo publicado.',
        price_changed: 'O preço do modelo mudou. Atualize o catálogo e escolha o modelo novamente.',
        network_failed: 'A conexão falhou. Verifique sua rede e tente novamente.',
        merchant_api_deleted: 'A API do comerciante foi excluída e a conversa parou. Troque de modelo.',
        privacy_route_unavailable: 'Não há uma rota disponível que atenda às suas configurações de privacidade. Escolha uma rota compatível ou revise as configurações.',
        mediaContextPaused: 'Em pausa · contexto de mídia preservado', mediaContextBody: 'Os anexos de imagem ou áudio mais recentes excedem sozinhos a capacidade de entrada deste modelo. Reduza a resolução da imagem, divida o arquivo de áudio ou escolha um modelo com mais contexto e continue. O contexto original foi preservado; nada foi reenviado automaticamente.',
        completed: 'Tarefa concluída', paused: 'Tarefa pausada · pronta para continuar', cancelled: 'Tarefa interrompida', model_timeout: 'A conexão com o modelo expirou', rate_limited: 'Limite de solicitações do modelo atingido',
        model_unavailable: 'O serviço do modelo está temporariamente indisponível', model_auth: 'A conexão do modelo precisa de atenção', api_key_rejected: 'Chave de API recusada ou ausente · verifique na central de modelos', tool_failed: 'Uma ferramenta precisa de atenção', waiting_user: 'Aguardando sua ação', insufficient_balance: 'Saldo insuficiente · adicione fundos para continuar',
        failed: 'A tarefa precisa de atenção', continueTask: 'Continuar tarefa', resumeContextHint: 'Continue do contexto salvo; o modelo selecionado passa a valer nesta continuação.', cancelledBody: 'A tarefa foi interrompida. O trabalho concluído e o histórico foram preservados.', fallbackBody: 'A tarefa não terminou. Você pode tentar novamente.'
    },
    ru: {
        contextWindowBody: 'Задача превышает объём контекста модели. Задача и состояние восстановления сохранены. Выберите модель с большим контекстом, чтобы продолжить.',
        switch_policy_invalid: 'Настройки переключения модели недействительны. Выберите модель заново и повторите попытку.',
        route_unavailable: 'Выбранный маршрут модели недоступен. Попробуйте другой маршрут.',
        route_capacity: 'Выбранный маршрут модели перегружен. Повторите попытку чуть позже или выберите другой маршрут.',
        model_not_ready: 'Эта модель ещё не готова к тарификации. Выберите опубликованную модель.',
        price_changed: 'Цена модели изменилась. Обновите каталог и выберите модель заново.',
        network_failed: 'Не удалось подключиться. Проверьте сеть и повторите попытку.',
        merchant_api_deleted: 'API продавца удалён, диалог остановлен. Переключите модель.',
        privacy_route_unavailable: 'Нет доступного маршрута, соответствующего настройкам конфиденциальности. Выберите подходящий маршрут или проверьте настройки.',
        mediaContextPaused: 'Приостановлено · медиаконтекст сохранён', mediaContextBody: 'Последние вложения с изображениями или аудио сами по себе превышают входную ёмкость этой модели. Уменьшите разрешение изображения, разделите аудиофайл или выберите модель с большим контекстом, затем продолжите. Исходный контекст сохранён; ничего не отправлялось повторно автоматически.',
        completed: 'Задача завершена', paused: 'Задача приостановлена · можно продолжить', cancelled: 'Задача остановлена', model_timeout: 'Время подключения к модели истекло', rate_limited: 'Достигнут лимит запросов модели',
        model_unavailable: 'Сервис модели временно недоступен', model_auth: 'Подключение модели требует внимания', api_key_rejected: 'API-ключ отклонён или отсутствует · проверьте его в центре моделей', tool_failed: 'Инструмент требует внимания', waiting_user: 'Ожидание вашего действия', insufficient_balance: 'Недостаточно средств · пополните баланс для продолжения',
        failed: 'Задача требует внимания', continueTask: 'Продолжить задачу', resumeContextHint: 'Продолжить из сохранённого контекста; выбранная модель применяется с этого продолжения.', cancelledBody: 'Задача остановлена. Выполненная работа и журнал сохранены.', fallbackBody: 'Задача не завершена. Можно повторить попытку.'
    },
    ar: {
        contextWindowBody: 'تتجاوز هذه المهمة سعة السياق للنموذج. حُفظت المهمة وحالة الاستعادة. اختر نموذجاً بسياق أكبر للمتابعة.',
        switch_policy_invalid: 'إعدادات تبديل النموذج غير صالحة. اختر النموذج مجدداً ثم أعد المحاولة.',
        route_unavailable: 'مسار النموذج المحدد غير متاح. جرّب مساراً آخر.',
        route_capacity: 'مسار النموذج المحدد مزدحم. أعد المحاولة بعد قليل أو اختر مساراً آخر.',
        model_not_ready: 'هذا النموذج غير جاهز للفوترة بعد. اختر نموذجاً منشوراً.',
        price_changed: 'تغيّر سعر النموذج. حدّث الكتالوج ثم اختر النموذج مجدداً.',
        network_failed: 'فشل الاتصال. تحقق من الشبكة وحاول مرة أخرى.',
        merchant_api_deleted: 'تم حذف واجهة API للتاجر وتوقفت المحادثة. يرجى تبديل النموذج.',
        privacy_route_unavailable: 'لا يوجد مسار متاح يوافق إعدادات الخصوصية. اختر مساراً متوافقاً أو راجع الإعدادات.',
        mediaContextPaused: 'متوقفة مؤقتاً · سياق الوسائط محفوظ', mediaContextBody: 'تتجاوز مرفقات الصور أو الصوت الأحدث وحدها سعة الإدخال لهذا النموذج. خفّض دقة الصورة أو قسّم ملف الصوت أو اختر نموذجاً بسياق أكبر ثم تابع. تم الاحتفاظ بالسياق الأصلي، ولم يُعَد إرسال أي شيء تلقائياً.',
        completed: 'اكتملت المهمة', paused: 'المهمة متوقفة مؤقتاً · جاهزة للمتابعة', cancelled: 'تم إيقاف المهمة', model_timeout: 'انتهت مهلة الاتصال بالنموذج', rate_limited: 'تم بلوغ حد طلبات النموذج',
        model_unavailable: 'خدمة النموذج غير متاحة مؤقتاً', model_auth: 'اتصال النموذج يحتاج إلى إجراء', api_key_rejected: 'مفتاح API مرفوض أو مفقود · تحقّق منه في مركز النماذج', tool_failed: 'إحدى الأدوات تحتاج إلى إجراء', waiting_user: 'بانتظار إجراء منك', insufficient_balance: 'الرصيد غير كافٍ · أضف رصيدًا للمتابعة',
        failed: 'المهمة تحتاج إلى إجراء', continueTask: 'متابعة المهمة', resumeContextHint: 'تابع من السياق المحفوظ؛ يطبّق النموذج المحدد بدءاً من هذه المتابعة.', cancelledBody: 'تم إيقاف المهمة مع الاحتفاظ بالعمل المكتمل وسجل النشاط.', fallbackBody: 'لم تكتمل المهمة. يمكنك المحاولة مجدداً.'
    },
    hi: {
        contextWindowBody: 'यह काम मॉडल की संदर्भ क्षमता से बड़ा है। काम और पुनर्प्राप्ति स्थिति सहेजी गई है। जारी रखने के लिए बड़े संदर्भ वाला मॉडल चुनें।',
        switch_policy_invalid: 'मॉडल बदलने की सेटिंग अमान्य है। मॉडल फिर से चुनें और दोबारा कोशिश करें।',
        route_unavailable: 'चुना गया मॉडल मार्ग उपलब्ध नहीं है। कोई दूसरा मार्ग आज़माएँ।',
        route_capacity: 'चुना गया मॉडल मार्ग व्यस्त है। थोड़ी देर बाद कोशिश करें या दूसरा मार्ग चुनें।',
        model_not_ready: 'यह मॉडल अभी बिलिंग के लिए तैयार नहीं है। कोई प्रकाशित मॉडल चुनें।',
        price_changed: 'मॉडल की कीमत बदल गई है। कैटलॉग रीफ़्रेश करके मॉडल फिर से चुनें।',
        network_failed: 'कनेक्शन विफल हुआ। अपना नेटवर्क जाँचें और फिर प्रयास करें।',
        merchant_api_deleted: 'विक्रेता API हटा दिया गया है और बातचीत रुक गई है। कृपया मॉडल बदलें।',
        privacy_route_unavailable: 'आपकी निजता सेटिंग से मेल खाने वाला कोई उपलब्ध मार्ग नहीं है। संगत मार्ग चुनें या सेटिंग जाँचें।',
        mediaContextPaused: 'रुका हुआ · मीडिया संदर्भ सुरक्षित', mediaContextBody: 'नवीनतम चित्र या ऑडियो अटैचमेंट अकेले ही इस मॉडल की इनपुट क्षमता से अधिक हैं। चित्र का रिज़ॉल्यूशन घटाएँ, ऑडियो फ़ाइल बाँटें या बड़े संदर्भ वाला मॉडल चुनें, फिर जारी रखें। मूल संदर्भ सुरक्षित है; कुछ भी अपने आप दोबारा नहीं भेजा गया।',
        completed: 'कार्य पूरा हुआ', paused: 'कार्य रुका है · जारी रखा जा सकता है', cancelled: 'कार्य रोक दिया गया', model_timeout: 'मॉडल कनेक्शन का समय समाप्त हुआ', rate_limited: 'मॉडल अनुरोध सीमा पूरी हुई',
        model_unavailable: 'मॉडल सेवा अस्थायी रूप से उपलब्ध नहीं है', model_auth: 'मॉडल कनेक्शन पर ध्यान देना आवश्यक है', api_key_rejected: 'API कुंजी अस्वीकृत या अनुपलब्ध · मॉडल केंद्र में जाँचें', tool_failed: 'एक टूल पर ध्यान देना आवश्यक है', waiting_user: 'आपकी कार्रवाई की प्रतीक्षा है', insufficient_balance: 'शेष राशि कम है · जारी रखने के लिए राशि जोड़ें',
        failed: 'कार्य पर ध्यान देना आवश्यक है', continueTask: 'कार्य जारी रखें', resumeContextHint: 'सहेजे गए संदर्भ से जारी रखें; चुना गया मॉडल इस जारी कार्य से लागू होगा।', cancelledBody: 'कार्य रोक दिया गया है। पूरा हुआ काम और गतिविधि सुरक्षित हैं।', fallbackBody: 'कार्य पूरा नहीं हुआ। आप फिर प्रयास कर सकते हैं।'
    }
};

function uncheckedAgentOutcomeText(locale: NextMuxDesktopLocale, key: AgentOutcomeTextKey): string {
    return translations[locale][key] || translations.en[key] || key;
}

/**
 * Gateway failures have existed in three wire shapes over the lifetime of the
 * desktop client: a flat error, an `{ error: ... }` envelope, and a persisted
 * `{ failure: ... }` record.  Keep the renderer tolerant of all three so an
 * HTTP 402 can never be downgraded to the generic route error just because a
 * host serialized the envelope one level deeper.
 */
function failureRecords(value: unknown): readonly Record<string, unknown>[] {
    if (value instanceof Error) return [{ ...value, message: value.message, name: value.name }];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const root = value as Record<string, unknown>;
    const records: Record<string, unknown>[] = [root];
    for (const key of ['error', 'failure', 'details', 'cause']) {
        const nested = root[key];
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) records.push(nested as Record<string, unknown>);
    }
    return records;
}

function failureCode(value: unknown): string {
    for (const record of failureRecords(value)) {
        if (typeof record.code === 'string' && record.code.trim()) return record.code.trim().toUpperCase();
    }
    return '';
}

function failureStatus(value: unknown): number | undefined {
    for (const record of failureRecords(value)) {
        const candidate = record.status ?? record.httpStatus;
        const status = typeof candidate === 'string' && candidate.trim() ? Number(candidate) : candidate;
        if (typeof status === 'number' && Number.isSafeInteger(status) && status >= 100 && status <= 599) return status;
    }
    return undefined;
}

function failureMessage(value: unknown): string {
    for (const record of failureRecords(value)) {
        if (typeof record.message === 'string' && record.message.trim()) return record.message;
    }
    return typeof value === 'string' ? value : value instanceof Error ? value.message : String(value || '');
}

export function agentFailureTitle(locale: NextMuxDesktopLocale, failure: DesktopAgentRunFailure | undefined): string {
    if (isMerchantApiDeletedFailure(failure)) {
        return agentOutcomeText(locale, 'merchant_api_deleted');
    }
    if (isInsufficientBalanceFailure(failure)) {
        return agentOutcomeText(locale, 'insufficient_balance');
    }
    if (failure && isModelSwitchPolicyFailure(failure)) return agentOutcomeText(locale, 'switch_policy_invalid');
    if (failure && desktopFailureMessage(locale, failure) !== failure.message) {
        const known = desktopFailureMessage(locale, failure);
        if (known !== failure.message || failure.kind === 'failed') return known;
    }
    const kind: DesktopAgentRunFailureKind = failure?.kind || 'failed';
    return agentOutcomeText(locale, kind);
}

/**
 * Convert gateway/runtime failures into a stable, user-facing message.  Raw
 * provider strings are retained only for genuinely unknown failures; known
 * protocol/configuration errors must never leak an internal action such as
 * “go to model center” or an implementation code into the conversation.
 */
export function desktopFailureMessage(locale: NextMuxDesktopLocale, value: unknown): string {
    if (isMerchantApiDeletedFailure(value)) {
        return agentOutcomeText(locale, 'merchant_api_deleted');
    }
    const code = failureCode(value);
    // Gateway price authorization has actionable copy even when provider
    // metadata classifies it as unknown. Keep that metadata for full details.
    if (['PRICE_QUOTE_INVALID', 'PRICE_AUTHORIZATION_INVALID', 'PRICE_QUOTE_CHANGED', 'PRICE_CHANGED'].includes(code)) {
        return agentOutcomeText(locale, 'price_changed');
    }
    const metadata = failureRecords(value).some(record => Boolean(record.readableError)
        || Boolean(record.data && typeof record.data === 'object' && (record.data as Record<string, unknown>).readableError));
    if (metadata) {
        const formatted = formatModelError(value, locale);
        if (formatted.kind !== 'unknown' || formatted.messageKey || formatted.domain || formatted.walletAdmission) return formatted.text;
    }
    const status = failureStatus(value);
    const raw = failureMessage(value);
    const normalized = raw.replace(/[\u0000\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (code === 'WALLET_BALANCE_INSUFFICIENT' || code === 'INSUFFICIENT_BALANCE' || status === 402
        || /(?:insufficient\s+balance|余额不足|余额不够|잔액이 부족|saldo insuficiente)/i.test(normalized)) {
        return agentOutcomeText(locale, 'insufficient_balance');
    }
    if (['MODEL_SWITCH_POLICY_INVALID', 'SWITCH_POLICY_INVALID', 'MODEL_SWITCH_OWNER_MISMATCH', 'MODEL_SWITCH_REVISION_CONFLICT'].includes(code)
        || /invalid model[- ]switch policy|model switching is only available/i.test(normalized)) {
        return agentOutcomeText(locale, 'switch_policy_invalid');
    }
    if (['MODEL_NOT_READY', 'MODEL_NOT_PUBLISHED', 'MODEL_NOT_EXECUTABLE', 'MODEL_PRICE_MISSING', 'MODEL_DISCOVERY_FAILED', 'MODEL_REGISTRY_INVALID'].includes(code)
        || /model.*(?:not ready|not published|not executable|price.*missing)|模型.*(?:未发布|未完成计费|不可执行)/i.test(normalized)) {
        return agentOutcomeText(locale, 'model_not_ready');
    }
    if (code === 'UPSTREAM_CAPACITY_EXHAUSTED' || code === 'REQUEST_NOT_DISPATCHED' || /selected route is at capacity|never sent to a model|线路.*(?:容量|繁忙)/i.test(normalized)) {
        return agentOutcomeText(locale, 'route_capacity');
    }
    if (['ROUTE_UNAVAILABLE', 'ROUTE_PRIVACY_UNAVAILABLE', 'NO_AVAILABLE_ROUTE', 'NO_AVAILABLE_MODEL', 'INVALID_MODEL_ROUTE', 'CONNECTION_NOT_FOUND',
        'UPSTREAM_MODEL_UNSUPPORTED', 'UPSTREAM_REJECTED', 'UPSTREAM_UNAVAILABLE'].includes(code)
        || /saved model route.*(?:not available|unavailable)|no available route meets your privacy settings|隐私设置.*(?:线路|路由).*不可用|没有可用.*(?:线路|模型)/i.test(normalized)) {
        return agentOutcomeText(locale, 'route_unavailable');
    }
    if (status === 429 || ['RATE_LIMITED', 'TOO_MANY_REQUESTS', 'UPSTREAM_RATE_LIMITED'].includes(code)) return agentOutcomeText(locale, 'rate_limited');
    // The user's own key (direct API) says what to fix; a relay-side credential stays generic.
    if (['AUTH_FAILED', 'INVALID_API_KEY', 'API_KEY_REQUIRED', 'API_KEY_MISSING'].includes(code)) return agentOutcomeText(locale, 'api_key_rejected');
    if (status === 401 || status === 403 || code === 'UPSTREAM_CREDENTIAL_INVALID') return agentOutcomeText(locale, 'model_auth');
    if (code === 'UPSTREAM_BALANCE_UNAVAILABLE') return agentOutcomeText(locale, 'model_unavailable');
    if (['PLATFORM_OFFLINE', 'PLATFORM_TIMEOUT', 'NETWORK_TEST_FAILED', 'CONNECTION_FAILED', 'UPSTREAM_CONNECTION_FAILED', 'UPSTREAM_TIMEOUT',
        'NETWORK_ERROR', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
        || /(?:network|connection).*(?:failed|timeout)|连接.*(?:失败|超时)|无法连接(?:官方)?模型服务/i.test(normalized)) return agentOutcomeText(locale, 'network_failed');
    if (/^(?:该|該|這個)\s*API\s*(?:无法|無法)使用[，,]\s*(?:请|請)(?:更换|更換)(?:中转商|中轉商)?[。.]?$/i.test(normalized)) {
        return locale === 'zh-TW' ? '該 API 無法使用，請更換' : '该 API 无法使用，请更换';
    }
    if (normalized && !/^(?:AGENT_RUN_FAILED|PLATFORM_REQUEST_FAILED|任务执行失败)$/i.test(normalized)) return normalized.slice(0, 1_000);
    return agentOutcomeText(locale, 'fallbackBody');
}

export function normalizePendingManagedReceipt(value: unknown): DesktopAgentRunFailure['pendingManagedReceipt'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some(key => !['version', 'requestId', 'userId', 'platformOrigin', 'conversationId', 'runId'].includes(key))
        || item.version !== 1 || typeof item.requestId !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.requestId)
        || !['userId', 'conversationId', 'runId'].every(key => typeof item[key] === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(item[key] as string))
        || typeof item.platformOrigin !== 'string' || item.platformOrigin.length > 2048) return undefined;
    try {
        const origin = new URL(item.platformOrigin);
        if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== item.platformOrigin || origin.username || origin.password) return undefined;
    } catch { return undefined; }
    return { version: 1, requestId: item.requestId, userId: item.userId as string, platformOrigin: item.platformOrigin,
        conversationId: item.conversationId as string, runId: item.runId as string };
}

/** Normalize an Error/HTTP payload so persisted and live turns share one shape. */
export function normalizeDesktopFailure(locale: NextMuxDesktopLocale, value: unknown): DesktopAgentRunFailure {
    const records = failureRecords(value);
    const code = failureCode(value).slice(0, 200) || 'AGENT_RUN_FAILED';
    const message = desktopFailureMessage(locale, value);
    const upper = code.toUpperCase();
    const status = failureStatus(value);
    const existingKind = records.map(candidate => candidate.kind).find(kind => typeof kind === 'string'
        && ['model_timeout', 'rate_limited', 'model_unavailable', 'model_auth', 'tool_failed', 'waiting_user', 'failed'].includes(kind)) as DesktopAgentRunFailure['kind'] | undefined;
    let kind: DesktopAgentRunFailure['kind'] = existingKind || 'failed';
    const merchantApiDeleted = isMerchantApiDeletedFailure(value);
    if (merchantApiDeleted) kind = 'waiting_user';
    else if (upper === 'WALLET_REQUEST_BUDGET_UNAVAILABLE') kind = 'waiting_user';
    else if (upper === 'WALLET_BALANCE_INSUFFICIENT' || upper === 'INSUFFICIENT_BALANCE' || status === 402
        || /(?:insufficient\s+balance|余额不足|余额不够|잔액이 부족|saldo insuficiente)/i.test(message)) kind = 'waiting_user';
    else if (upper.includes('SWITCH_POLICY') || upper.includes('SWITCH_OWNER') || upper.includes('SWITCH_REVISION')) kind = 'waiting_user';
    else if (status === 429 || ['RATE_LIMITED', 'TOO_MANY_REQUESTS', 'UPSTREAM_RATE_LIMITED'].includes(upper)) kind = 'rate_limited';
    else if (status === 401 || status === 403 || ['AUTH_FAILED', 'INVALID_API_KEY', 'API_KEY_REQUIRED', 'API_KEY_MISSING', 'UPSTREAM_CREDENTIAL_INVALID'].includes(upper)) kind = 'model_auth';
    else if (upper.includes('TIMEOUT')) kind = 'model_timeout';
    else if (['ROUTE_UNAVAILABLE', 'ROUTE_PRIVACY_UNAVAILABLE', 'NO_AVAILABLE_ROUTE', 'NO_AVAILABLE_MODEL', 'INVALID_MODEL_ROUTE', 'CONNECTION_NOT_FOUND', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_MODEL_UNSUPPORTED', 'UPSTREAM_REJECTED', 'UPSTREAM_BALANCE_UNAVAILABLE', 'UPSTREAM_CONNECTION_FAILED', 'CONNECTION_FAILED', 'PLATFORM_OFFLINE', 'PLATFORM_TIMEOUT'].includes(upper)) kind = 'model_unavailable';
    const bool = (name: string): boolean => records.some(candidate => candidate[name] === true);
    const retryAfterMs = records.map(candidate => candidate.retryAfterMs).find(candidate => typeof candidate === 'number' && Number.isFinite(candidate));
    const resumeCheckpointId = records.map(candidate => candidate.resumeCheckpointId).find(candidate => typeof candidate === 'string' && candidate);
    const billing = records.map(candidate => candidate.billing).find((candidate): candidate is NonNullable<DesktopAgentRunFailure['billing']> => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
        const item = candidate as Record<string, unknown>;
        return item.kind === 'platform' && typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency)
            && Number.isSafeInteger(item.chargedMicros) && Number(item.chargedMicros) >= 0
            && Number.isSafeInteger(item.requestCount) && Number(item.requestCount) > 0;
    });
    const requestIds = normalizeRelayFeedbackRequestIds(records.map(candidate => candidate.requestIds));
    const pendingManagedReceipt = upper.startsWith('BILLING_') || upper === 'RESPONSE_REPLAY_EXPIRED'
        ? records.map(candidate => normalizePendingManagedReceipt(candidate.pendingManagedReceipt)).find(item => item && !requestIds.includes(item.requestId)) : undefined;
    return {
        ...(pendingManagedReceipt ? { pendingManagedReceipt } : {}),
        code,
        message,
        readableError: classifyModelError(value),
        ...(requestIds.length ? { requestIds } : {}),
        ...(billing ? { billing: { kind: 'platform' as const, currency: billing.currency, chargedMicros: billing.chargedMicros, requestCount: billing.requestCount } } : {}),
        kind,
        retryable: merchantApiDeleted ? false : (records.map(candidate => candidate.retryable).find(candidate => typeof candidate === 'boolean') as boolean | undefined
            ?? ['model_timeout', 'rate_limited', 'model_unavailable'].includes(kind)),
        // A deleted merchant API never auto-resumes (scheduleAutomaticResume); a checkpoint still lets the person
        // continue by hand after switching models, as the backend decided.
        resumable: (records.map(candidate => candidate.resumable).find(candidate => typeof candidate === 'boolean') as boolean | undefined) ?? false,
        ...(bool('retrySafe') ? { retrySafe: true } : {}),
        ...(Number.isFinite(status) ? { httpStatus: Math.max(0, Math.floor(status!)) } : {}),
        ...(typeof retryAfterMs === 'number' ? { retryAfterMs: Math.max(0, Math.floor(retryAfterMs)) } : {}),
        ...(typeof resumeCheckpointId === 'string' ? { resumeCheckpointId: resumeCheckpointId.slice(0, 200) } : {})
    };
}

export function isInsufficientBalanceFailure(value: unknown): boolean {
    const mapped = classifyModelError(value);
    if (mapped.kind !== 'unknown') return mapped.kind === 'balance_insufficient';
    const code = failureCode(value).toLocaleLowerCase();
    const kind = failureRecords(value).some(record => String(record.kind || '').trim().toLocaleLowerCase() === 'insufficient_balance');
    const message = failureMessage(value);
    return code === 'wallet_balance_insufficient' || code === 'insufficient_balance' || kind || failureStatus(value) === 402
        || /(?:insufficient\s+balance|余额不足|余额不够|잔액이 부족|saldo insuficiente)/i.test(message);
}

export function isModelSwitchPolicyFailure(value: unknown): boolean {
    const code = failureCode(value);
    // Live runs can surface the legacy plain-text error before persistence has
    // normalized it into a structured failure. Keep that path equivalent to
    // the structured one so the renderer can collapse it to one sentence.
    const message = failureMessage(value);
    return code.includes('SWITCH_POLICY') || code.includes('SWITCH_OWNER') || code.includes('SWITCH_REVISION')
        || /invalid model[- ]switch policy|model switching is only available|模型切换(?:设置|策略)?(?:已失效|无效)/i.test(message);
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function agentOutcomeText(locale: Parameters<typeof uncheckedAgentOutcomeText>[0], key: Parameters<typeof uncheckedAgentOutcomeText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedAgentOutcomeText>>): string {
    return totalCopy(locale, key, language => uncheckedAgentOutcomeText(language, key, ...rest));
}

const originalReceiptLabels: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    "en": [
        "Check original request",
        "Checking original request…",
        "The original request is pending. Check again later.",
        "The original request still needs review. It will not be sent again.",
        "The original result expired. It will not be generated again.",
        "Original result recovered",
        "The original receipt is temporarily unavailable.",
        "Tool calls are shown only; they will not run."
    ],
    "zh-CN": [
        "核对原请求",
        "正在核对原请求…",
        "原请求仍在处理中，请稍后再核对。",
        "原请求仍需核对，不会重新发送。",
        "原结果已过期，不会重新生成。",
        "已找回原结果",
        "原请求回执暂时无法读取。",
        "工具调用仅显示，不会执行。"
    ],
    "zh-TW": [
        "核對原請求",
        "正在核對原請求…",
        "原請求仍在處理中，請稍後再核對。",
        "原請求仍需核對，不會重新傳送。",
        "原結果已過期，不會重新生成。",
        "已找回原結果",
        "原請求回執暫時無法讀取。",
        "工具呼叫僅顯示，不會執行。"
    ],
    "ja": [
        "元のリクエストを確認",
        "元のリクエストを確認中…",
        "元のリクエストは処理中です。後ほど確認してください。",
        "元のリクエストは確認が必要です。再送しません。",
        "元の結果は期限切れです。再生成しません。",
        "元の結果を復元しました",
        "元の応答記録を一時的に読み取れません。",
        "ツール呼び出しは表示のみで実行しません。"
    ],
    "ko": [
        "원래 요청 확인",
        "원래 요청 확인 중…",
        "원래 요청을 처리 중입니다. 나중에 다시 확인하세요.",
        "원래 요청을 검토해야 합니다. 다시 보내지 않습니다.",
        "원래 결과가 만료되었습니다. 다시 생성하지 않습니다.",
        "원래 결과를 복구했습니다",
        "원래 요청 기록을 일시적으로 읽을 수 없습니다.",
        "도구 호출은 표시만 하며 실행하지 않습니다."
    ],
    "es": [
        "Comprobar solicitud original",
        "Comprobando solicitud original…",
        "La solicitud original sigue pendiente. Comprueba más tarde.",
        "La solicitud original requiere revisión. No se enviará de nuevo.",
        "El resultado original caducó. No se generará de nuevo.",
        "Resultado original recuperado",
        "El recibo original no está disponible temporalmente.",
        "Las llamadas a herramientas solo se muestran; no se ejecutan."
    ],
    "fr": [
        "Vérifier la requête initiale",
        "Vérification de la requête initiale…",
        "La requête initiale est en attente. Vérifiez plus tard.",
        "La requête initiale nécessite une vérification. Elle ne sera pas renvoyée.",
        "Le résultat initial a expiré. Il ne sera pas régénéré.",
        "Résultat initial récupéré",
        "Le reçu initial est temporairement indisponible.",
        "Les appels d’outils sont affichés uniquement, sans exécution."
    ],
    "de": [
        "Originalanfrage prüfen",
        "Originalanfrage wird geprüft…",
        "Die Originalanfrage ist ausstehend. Bitte später prüfen.",
        "Die Originalanfrage muss geprüft werden. Sie wird nicht erneut gesendet.",
        "Das Originalergebnis ist abgelaufen. Es wird nicht neu erzeugt.",
        "Originalergebnis wiederhergestellt",
        "Der Originalbeleg ist vorübergehend nicht verfügbar.",
        "Werkzeugaufrufe werden nur angezeigt, nicht ausgeführt."
    ],
    "pt-BR": [
        "Verificar solicitação original",
        "Verificando solicitação original…",
        "A solicitação original está pendente. Verifique mais tarde.",
        "A solicitação original precisa de revisão. Não será enviada de novo.",
        "O resultado original expirou. Não será gerado de novo.",
        "Resultado original recuperado",
        "O recibo original está temporariamente indisponível.",
        "As chamadas de ferramentas são apenas exibidas, sem execução."
    ],
    "ru": [
        "Проверить исходный запрос",
        "Проверка исходного запроса…",
        "Исходный запрос ожидает завершения. Проверьте позже.",
        "Исходный запрос требует проверки. Повторной отправки не будет.",
        "Срок исходного результата истёк. Повторной генерации не будет.",
        "Исходный результат восстановлен",
        "Исходная квитанция временно недоступна.",
        "Вызовы инструментов только показаны и не выполняются."
    ],
    "ar": [
        "تحقق من الطلب الأصلي",
        "جارٍ التحقق من الطلب الأصلي…",
        "الطلب الأصلي قيد الانتظار. تحقق لاحقاً.",
        "الطلب الأصلي يحتاج إلى مراجعة ولن يُرسل مجدداً.",
        "انتهت صلاحية النتيجة الأصلية ولن تُنشأ مجدداً.",
        "تمت استعادة النتيجة الأصلية",
        "إيصال الطلب الأصلي غير متاح مؤقتاً.",
        "تُعرض استدعاءات الأدوات فقط ولا تُنفذ."
    ],
    "hi": [
        "मूल अनुरोध जाँचें",
        "मूल अनुरोध की जाँच हो रही है…",
        "मूल अनुरोध लंबित है। बाद में फिर जाँचें।",
        "मूल अनुरोध की समीक्षा ज़रूरी है। इसे दोबारा नहीं भेजा जाएगा।",
        "मूल परिणाम की अवधि समाप्त है। इसे दोबारा नहीं बनाया जाएगा।",
        "मूल परिणाम प्राप्त हुआ",
        "मूल अनुरोध की रसीद अभी उपलब्ध नहीं है।",
        "टूल कॉल केवल दिखाए जाते हैं, चलाए नहीं जाते।"
    ]
};

export function originalReceiptText(locale: NextMuxDesktopLocale, key: 'check' | 'checking' | 'pending' | 'review' | 'expired' | 'recovered' | 'unavailable' | 'toolsDisplayOnly'): string {
    return (originalReceiptLabels[locale] || originalReceiptLabels.en)[['check', 'checking', 'pending', 'review', 'expired', 'recovered', 'unavailable', 'toolsDisplayOnly'].indexOf(key)] ?? String(key);
}
