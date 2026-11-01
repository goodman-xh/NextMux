import type { NextMuxDesktopLocale } from './nextmux-locale';

// loading, unavailable (no frame yet), preview (viewport name), failed (detail fallback), agent (an AI step runs on
// the page), retry, loadFailed (error card title), stop (toolbar while loading).
const text: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['正在加载…', '等待页面画面', '页面预览', '页面暂时不可用，请稍后刷新。', 'AI 正在操作页面…', '重新加载', '无法打开此页面', '停止加载'],
    'zh-TW': ['正在載入…', '等待頁面畫面', '頁面預覽', '頁面暫時無法使用，請稍後重新整理。', 'AI 正在操作頁面…', '重新載入', '無法開啟此頁面', '停止載入'],
    en: ['Loading…', 'Waiting for page preview', 'Page preview', 'Page unavailable. Try refreshing shortly.', 'AI is working on this page…', 'Reload', 'This page couldn’t be opened', 'Stop loading'],
    ja: ['読み込み中…', 'ページの表示を待機中', 'ページのプレビュー', 'ページを表示できません。後でもう一度更新してください。', 'AI がページを操作中…', '再読み込み', 'このページを開けませんでした', '読み込みを中止'],
    ko: ['불러오는 중…', '페이지 화면 대기 중', '페이지 미리보기', '페이지를 사용할 수 없습니다. 잠시 후 새로고침하세요.', 'AI가 페이지를 조작하는 중…', '새로고침', '이 페이지를 열 수 없습니다', '로드 중지'],
    es: ['Cargando…', 'Esperando la vista de la página', 'Vista de la página', 'Página no disponible. Actualízala en unos momentos.', 'La IA está usando la página…', 'Volver a cargar', 'No se pudo abrir esta página', 'Detener la carga'],
    fr: ['Chargement…', 'En attente de la page', 'Aperçu de la page', 'Page indisponible. Actualisez dans un instant.', 'L’IA utilise la page…', 'Actualiser', 'Impossible d’ouvrir cette page', 'Arrêter le chargement'],
    de: ['Wird geladen…', 'Warten auf Seitenvorschau', 'Seitenvorschau', 'Seite nicht verfügbar. Bitte gleich erneut laden.', 'KI bedient die Seite …', 'Neu laden', 'Diese Seite konnte nicht geöffnet werden', 'Laden stoppen'],
    'pt-BR': ['Carregando…', 'Aguardando visualização', 'Visualização da página', 'Página indisponível. Atualize em instantes.', 'A IA está usando a página…', 'Recarregar', 'Não foi possível abrir esta página', 'Parar o carregamento'],
    ru: ['Загрузка…', 'Ожидание изображения страницы', 'Просмотр страницы', 'Страница недоступна. Попробуйте обновить чуть позже.', 'ИИ работает со страницей…', 'Перезагрузить', 'Не удалось открыть эту страницу', 'Остановить загрузку'],
    ar: ['جارٍ التحميل…', 'بانتظار معاينة الصفحة', 'معاينة الصفحة', 'الصفحة غير متاحة. حاول تحديثها بعد قليل.', 'الذكاء الاصطناعي يعمل على الصفحة…', 'إعادة التحميل', 'تعذّر فتح هذه الصفحة', 'إيقاف التحميل'],
    hi: ['लोड हो रहा है…', 'पृष्ठ के दृश्य की प्रतीक्षा', 'पृष्ठ का पूर्वावलोकन', 'पृष्ठ उपलब्ध नहीं है। थोड़ी देर में रीफ़्रेश करें।', 'AI इस पेज पर काम कर रहा है…', 'फिर से लोड करें', 'यह पेज नहीं खुल सका', 'लोड करना रोकें']
};

export function ownedBrowserText(locale: NextMuxDesktopLocale): {
    loading: string; unavailable: string; preview: string; failed: string; agent: string; retry: string; loadFailed: string; stop: string;
} {
    const [loading, unavailable, preview, failed, agent, retry, loadFailed, stop] = text[locale] || text.en;
    return { loading, unavailable, preview, failed, agent, retry, loadFailed, stop };
}
