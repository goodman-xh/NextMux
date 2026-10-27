import type { NextMuxDesktopLocale } from './nextmux-locale';

const text: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['后台浏览', '手动操作', '接管页面', '交回后台', '正在加载…', '等待页面画面', '页面预览', '页面暂时不可用，请稍后刷新。'],
    'zh-TW': ['背景瀏覽', '手動操作', '接管頁面', '交回背景', '正在載入…', '等待頁面畫面', '頁面預覽', '頁面暫時無法使用，請稍後重新整理。'],
    en: ['Background browsing', 'Manual control', 'Take control', 'Return to background', 'Loading…', 'Waiting for page preview', 'Page preview', 'Page unavailable. Try refreshing shortly.'],
    ja: ['バックグラウンド閲覧', '手動操作', '操作を引き継ぐ', 'バックグラウンドに戻す', '読み込み中…', 'ページの表示を待機中', 'ページのプレビュー', 'ページを表示できません。後でもう一度更新してください。'],
    ko: ['백그라운드 탐색', '수동 제어', '직접 제어', '백그라운드로 반환', '불러오는 중…', '페이지 화면 대기 중', '페이지 미리보기', '페이지를 사용할 수 없습니다. 잠시 후 새로고침하세요.'],
    es: ['Navegación en segundo plano', 'Control manual', 'Tomar el control', 'Volver al segundo plano', 'Cargando…', 'Esperando la vista de la página', 'Vista de la página', 'Página no disponible. Actualízala en unos momentos.'],
    fr: ['Navigation en arrière-plan', 'Contrôle manuel', 'Prendre le contrôle', 'Rendre le contrôle', 'Chargement…', 'En attente de la page', 'Aperçu de la page', 'Page indisponible. Actualisez dans un instant.'],
    de: ['Surfen im Hintergrund', 'Manuelle Steuerung', 'Steuerung übernehmen', 'Zurück in den Hintergrund', 'Wird geladen…', 'Warten auf Seitenvorschau', 'Seitenvorschau', 'Seite nicht verfügbar. Bitte gleich erneut laden.'],
    'pt-BR': ['Navegação em segundo plano', 'Controle manual', 'Assumir controle', 'Voltar ao segundo plano', 'Carregando…', 'Aguardando visualização', 'Visualização da página', 'Página indisponível. Atualize em instantes.'],
    ru: ['Работа в фоне', 'Ручное управление', 'Взять управление', 'Вернуть в фон', 'Загрузка…', 'Ожидание изображения страницы', 'Просмотр страницы', 'Страница недоступна. Попробуйте обновить чуть позже.'],
    ar: ['تصفح في الخلفية', 'تحكم يدوي', 'تولّي التحكم', 'إعادة إلى الخلفية', 'جارٍ التحميل…', 'بانتظار معاينة الصفحة', 'معاينة الصفحة', 'الصفحة غير متاحة. حاول تحديثها بعد قليل.'],
    hi: ['पृष्ठभूमि में ब्राउज़िंग', 'मैन्युअल नियंत्रण', 'नियंत्रण लें', 'पृष्ठभूमि में वापस भेजें', 'लोड हो रहा है…', 'पृष्ठ के दृश्य की प्रतीक्षा', 'पृष्ठ का पूर्वावलोकन', 'पृष्ठ उपलब्ध नहीं है। थोड़ी देर में रीफ़्रेश करें।']
};

export function ownedBrowserText(locale: NextMuxDesktopLocale): {
    background: string; manual: string; takeover: string; release: string;
    loading: string; unavailable: string; preview: string; failed: string;
} {
    const [background, manual, takeover, release, loading, unavailable, preview, failed] = text[locale];
    return { background, manual, takeover, release, loading, unavailable, preview, failed };
}
