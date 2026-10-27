import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

type HistoryReadinessKey = 'loading' | 'failed' | 'retry' | 'recoveredDraft';
const messages: Record<NextMuxDesktopLocale, Readonly<Record<Exclude<HistoryReadinessKey, 'recoveredDraft'>, string>>> = {
    'zh-CN': { loading: '正在读取完整对话；你可以继续输入，读取完成后再发送、编辑或分支。', failed: '完整对话读取失败，原记录未修改；输入已保留，请重试。', retry: '重新读取' },
    'zh-TW': { loading: '正在讀取完整對話；可以繼續輸入，完成後再傳送、編輯或分支。', failed: '完整對話讀取失敗，原記錄未修改；輸入已保留，請重試。', retry: '重新讀取' },
    en: { loading: 'Loading full history. You can keep typing; sending, editing and branching will be available when ready.', failed: 'Full history could not be loaded; existing records were not changed and your draft is kept. Retry.', retry: 'Retry loading' },
    ja: { loading: '会話全体を読み込み中です。入力は続けられます。完了後に送信・編集・分岐できます。', failed: '会話全体を読み込めませんでした。既存の記録は変更せず、下書きも保持しています。再試行してください。', retry: '再読み込み' },
    ko: { loading: '전체 대화를 불러오는 중입니다. 계속 입력할 수 있으며 완료 후 전송·편집·분기가 가능합니다.', failed: '전체 대화를 불러오지 못했습니다. 기존 기록은 변경되지 않았고 초안도 유지됩니다. 다시 시도하세요.', retry: '다시 불러오기' },
    es: { loading: 'Cargando el historial completo. Puedes seguir escribiendo; después podrás enviar, editar o crear una rama.', failed: 'No se pudo cargar el historial completo; los registros existentes no cambiaron y tu borrador se conserva. Reintenta.', retry: 'Reintentar carga' },
    fr: { loading: 'Chargement de l’historique complet. Vous pouvez continuer à écrire ; l’envoi, la modification et la bifurcation attendront.', failed: 'Impossible de charger l’historique complet ; les enregistrements existants restent inchangés et le brouillon est conservé. Réessayez.', retry: 'Recharger' },
    de: { loading: 'Der vollständige Verlauf wird geladen. Du kannst weiterschreiben; Senden, Bearbeiten und Verzweigen sind danach verfügbar.', failed: 'Der vollständige Verlauf konnte nicht geladen werden; vorhandene Einträge bleiben unverändert und dein Entwurf bleibt erhalten. Erneut versuchen.', retry: 'Erneut laden' },
    'pt-BR': { loading: 'Carregando o histórico completo. Você pode continuar escrevendo; depois poderá enviar, editar ou criar uma ramificação.', failed: 'Não foi possível carregar o histórico completo; os registros existentes não foram alterados e seu rascunho foi mantido. Tente novamente.', retry: 'Recarregar' },
    ru: { loading: 'Загружается полная история. Можно продолжать ввод; отправка, правка и ветвление будут доступны после загрузки.', failed: 'Не удалось загрузить полную историю; существующие записи не изменены, черновик сохранён. Повторите попытку.', retry: 'Повторить загрузку' },
    ar: { loading: 'جارٍ تحميل السجل الكامل. يمكنك متابعة الكتابة؛ يتاح الإرسال والتعديل والتفرع بعد التحميل.', failed: 'تعذّر تحميل السجل الكامل؛ لم تتغير السجلات الحالية وما زالت المسودة محفوظة. أعد المحاولة.', retry: 'إعادة التحميل' },
    hi: { loading: 'पूरा इतिहास लोड हो रहा है। लिखना जारी रख सकते हैं; उसके बाद भेजना, संपादन और शाखा बनाना उपलब्ध होगा।', failed: 'पूरा इतिहास लोड नहीं हुआ; मौजूदा रिकॉर्ड नहीं बदले और आपका ड्राफ़्ट सुरक्षित है। फिर कोशिश करें।', retry: 'फिर लोड करें' }
};
const recoveredDraft: Record<NextMuxDesktopLocale, string> = {
    'zh-CN': '恢复的未发送草稿', 'zh-TW': '還原的未傳送草稿', en: 'Recovered unsent draft',
    ja: '復元された未送信の下書き', ko: '복구된 미전송 초안', es: 'Borrador sin enviar recuperado',
    fr: 'Brouillon non envoyé récupéré', de: 'Wiederhergestellter ungesendeter Entwurf',
    'pt-BR': 'Rascunho não enviado recuperado', ru: 'Восстановленный неотправленный черновик',
    ar: 'مسودة مستعادة لم تُرسل', hi: 'पुनर्प्राप्त न भेजा गया ड्राफ़्ट'
};
function uncheckedHistoryReadinessText(locale: NextMuxDesktopLocale, key: HistoryReadinessKey): string {
    if (key === 'recoveredDraft') return recoveredDraft[locale];
    return messages[locale][key];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function historyReadinessText(locale: Parameters<typeof uncheckedHistoryReadinessText>[0], key: Parameters<typeof uncheckedHistoryReadinessText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedHistoryReadinessText>>): string {
    return totalCopy(locale, key, language => uncheckedHistoryReadinessText(language, key, ...rest));
}
