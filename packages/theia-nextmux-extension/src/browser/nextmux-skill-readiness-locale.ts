import type { NextMuxDesktopLocale } from './nextmux-locale';

const messages: Record<NextMuxDesktopLocale, readonly [string, string]> = {
    en: ['Skills could not be loaded. Your draft is saved. Retry before sending.', 'Retry loading Skills'],
    'zh-CN': ['Skills 加载失败，草稿已保留。请重试后发送。', '重新加载 Skills'],
    'zh-TW': ['Skills 載入失敗，草稿已保留。請重試後傳送。', '重新載入 Skills'],
    ja: ['Skills を読み込めませんでした。下書きは保存されています。再試行してから送信してください。', 'Skills の読み込みを再試行'],
    ko: ['Skills를 불러오지 못했습니다. 초안은 보존됩니다. 다시 시도한 후 전송하세요.', 'Skills 다시 불러오기'],
    es: ['No se pudieron cargar Skills. Se conserva el borrador. Reintenta antes de enviar.', 'Reintentar cargar Skills'],
    fr: ['Impossible de charger Skills. Le brouillon est conservé. Réessayez avant l’envoi.', 'Réessayer le chargement de Skills'],
    de: ['Skills konnten nicht geladen werden. Der Entwurf bleibt erhalten. Vor dem Senden erneut versuchen.', 'Skills erneut laden'],
    'pt-BR': ['Não foi possível carregar Skills. O rascunho foi preservado. Tente novamente antes de enviar.', 'Carregar Skills novamente'],
    ru: ['Не удалось загрузить Skills. Черновик сохранён. Повторите попытку перед отправкой.', 'Загрузить Skills повторно'],
    ar: ['تعذّر تحميل Skills. تم الاحتفاظ بالمسودة. أعد المحاولة قبل الإرسال.', 'إعادة تحميل Skills'],
    hi: ['Skills लोड नहीं हो सके। ड्राफ़्ट सुरक्षित है। भेजने से पहले फिर कोशिश करें।', 'Skills फिर से लोड करें']
};

export function skillReadinessText(locale: NextMuxDesktopLocale, key: 'failed' | 'retry'): string {
    return (messages[locale] || messages.en)[key === 'failed' ? 0 : 1];
}
