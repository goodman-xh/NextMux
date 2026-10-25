import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const messages: Record<NextMuxDesktopLocale, readonly [string, string]> = {
    'zh-CN': ['子任务草稿已达到容量限制：每条 120,000 字符，每个会话最多 32 条、共 512,000 字符。原草稿未改变。', '未发送的子任务草稿仅保存在原设备；档案不包含可执行子任务，未导出这些草稿。'],
    'zh-TW': ['子任務草稿已達容量限制：每條 120,000 字元，每個對話最多 32 條、共 512,000 字元。原草稿未變更。', '未傳送的子任務草稿僅儲存在原裝置；封存檔不含可執行子任務，因此未匯出這些草稿。'],
    en: ['Child draft limit: 120,000 characters each, 32 drafts and 512,000 characters per conversation. The previous draft was kept.', 'Unsent child drafts stay on the original device. They are omitted because archives contain no executable child tasks.'],
    ja: ['子タスクの下書きは各120,000文字、会話ごとに32件・合計512,000文字までです。元の下書きは保持されました。', '未送信の子タスク下書きは元の端末に残ります。アーカイブには実行可能な子タスクがないため含まれません。'],
    ko: ['하위 작업 초안은 각각 120,000자, 대화당 32개와 총 512,000자까지입니다. 이전 초안은 유지됩니다.', '미전송 하위 작업 초안은 원래 기기에 남습니다. 아카이브에는 실행 가능한 하위 작업이 없어 초안을 포함하지 않습니다.'],
    es: ['Límite: 120.000 caracteres por borrador, 32 borradores y 512.000 caracteres por conversación. Se conservó el borrador anterior.', 'Los borradores secundarios no enviados quedan en el dispositivo original. Se omiten porque el archivo no contiene tareas secundarias ejecutables.'],
    fr: ['Limite : 120 000 caractères par brouillon, 32 brouillons et 512 000 caractères par conversation. Le brouillon précédent est conservé.', 'Les brouillons secondaires non envoyés restent sur l’appareil d’origine. Ils sont exclus car les archives ne contiennent pas de tâches secondaires exécutables.'],
    de: ['Limit: 120.000 Zeichen je Entwurf, 32 Entwürfe und 512.000 Zeichen je Unterhaltung. Der bisherige Entwurf bleibt erhalten.', 'Nicht gesendete Unteraufgaben-Entwürfe bleiben auf dem ursprünglichen Gerät. Archive enthalten keine ausführbaren Unteraufgaben und lassen diese Entwürfe aus.'],
    'pt-BR': ['Limite: 120.000 caracteres por rascunho, 32 rascunhos e 512.000 caracteres por conversa. O rascunho anterior foi mantido.', 'Rascunhos de subtarefas não enviados ficam no dispositivo original. São omitidos porque arquivos não contêm subtarefas executáveis.'],
    ru: ['Лимит: 120 000 символов на черновик, 32 черновика и 512 000 символов на беседу. Предыдущий черновик сохранён.', 'Неотправленные черновики подзадач остаются на исходном устройстве. Архивы не содержат исполняемых подзадач, поэтому эти черновики исключены.'],
    ar: ['الحد: 120,000 حرف لكل مسودة، و32 مسودة و512,000 حرف لكل محادثة. حُفظت المسودة السابقة.', 'تبقى مسودات المهام الفرعية غير المرسلة على الجهاز الأصلي. لا تُصدَّر لأن الأرشيف لا يحتوي مهام فرعية قابلة للتنفيذ.'],
    hi: ['सीमा: हर ड्राफ़्ट में 120,000 अक्षर, हर बातचीत में 32 ड्राफ़्ट और कुल 512,000 अक्षर। पिछला ड्राफ़्ट सुरक्षित है।', 'न भेजे गए उपकार्य ड्राफ़्ट मूल डिवाइस पर रहते हैं। संग्रह में चलने योग्य उपकार्य नहीं होते, इसलिए ये ड्राफ़्ट निर्यात नहीं होते।']
};

const privateMessages: Record<NextMuxDesktopLocale, string> = {
    'zh-CN': '历史保存已关闭：此草稿仅在本次运行中保留。', 'zh-TW': '歷史儲存已關閉：此草稿僅在本次執行中保留。',
    en: 'History saving is off: this draft lasts only for this app run.', ja: '履歴保存はオフです。この下書きはアプリ終了まで保持されます。',
    ko: '기록 저장이 꺼져 있습니다. 이 초안은 앱이 종료될 때까지만 유지됩니다.', es: 'El historial está desactivado: este borrador se conserva solo hasta cerrar la aplicación.',
    fr: 'Historique désactivé : ce brouillon est conservé seulement jusqu’à la fermeture de l’application.', de: 'Verlaufsspeicherung aus: Dieser Entwurf bleibt nur bis zum Beenden der App erhalten.',
    'pt-BR': 'O histórico está desativado: este rascunho dura apenas até fechar o aplicativo.', ru: 'История отключена: этот черновик хранится только до закрытия приложения.',
    ar: 'حفظ السجل متوقف: تبقى هذه المسودة حتى إغلاق التطبيق فقط.', hi: 'इतिहास सहेजना बंद है: यह ड्राफ़्ट केवल ऐप बंद होने तक रहेगा।'
};

function uncheckedAgentChildDraftText(locale: NextMuxDesktopLocale, key: 'limit' | 'archiveOmitted' | 'private'): string {
    if (key === 'private') return privateMessages[locale];
    return messages[locale][key === 'limit' ? 0 : 1];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function agentChildDraftText(locale: Parameters<typeof uncheckedAgentChildDraftText>[0], key: Parameters<typeof uncheckedAgentChildDraftText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedAgentChildDraftText>>): string {
    return totalCopy(locale, key, language => uncheckedAgentChildDraftText(language, key, ...rest));
}
