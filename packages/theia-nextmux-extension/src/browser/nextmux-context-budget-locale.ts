import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const labels: Readonly<Record<NextMuxDesktopLocale, readonly [string, string, string, string, string, string, string]>> = {
    en: ['Context', 'Auto', 'Not provided', 'The context window this API provides for this model.', 'Custom', 'Reference', 'Longer requests failed on this API, so NextMux stays within {cap}.'],
    'zh-CN': ['上下文', '自动', '未提供', '该 API 为这个模型提供的上下文窗口。', '自定义', '参考', '此 API 处理超过 {cap} 的请求时曾失败，已自动限制在 {cap} 以内。'],
    'zh-TW': ['上下文', '自動', '未提供', '此 API 為這個模型提供的上下文視窗。', '自訂', '參考', '此 API 處理超過 {cap} 的請求時曾失敗，已自動限制在 {cap} 以內。'],
    ja: ['コンテキスト', '自動', '未提供', 'この API がこのモデルに提供するコンテキストウィンドウ。', 'カスタム', '参考', 'この API では {cap} を超える要求が失敗したため、{cap} 以内に抑えています。'],
    ko: ['컨텍스트', '자동', '제공되지 않음', '이 API가 이 모델에 제공하는 컨텍스트 창입니다.', '사용자 지정', '참고', '이 API에서 {cap}을 넘는 요청이 실패해 {cap} 이내로 제한합니다.'],
    es: ['Contexto', 'Automático', 'No disponible', 'La ventana de contexto que esta API ofrece para este modelo.', 'Personalizado', 'Referencia', 'Las solicitudes de más de {cap} fallaron en esta API; NextMux se mantiene dentro de {cap}.'],
    fr: ['Contexte', 'Automatique', 'Non renseigné', 'La fenêtre de contexte que cette API offre pour ce modèle.', 'Personnalisé', 'Référence', 'Les requêtes au-delà de {cap} ont échoué sur cette API ; NextMux reste dans la limite de {cap}.'],
    de: ['Kontext', 'Automatisch', 'Nicht angegeben', 'Das Kontextfenster, das diese API für dieses Modell bietet.', 'Benutzerdefiniert', 'Referenz', 'Anfragen über {cap} sind bei dieser API fehlgeschlagen; NextMux bleibt innerhalb von {cap}.'],
    'pt-BR': ['Contexto', 'Automático', 'Não informado', 'A janela de contexto que esta API oferece para este modelo.', 'Personalizado', 'Referência', 'Solicitações acima de {cap} falharam nesta API; o NextMux fica dentro de {cap}.'],
    ru: ['Контекст', 'Авто', 'Не указано', 'Окно контекста, которое этот API даёт этой модели.', 'Свой бюджет', 'Справочно', 'Запросы больше {cap} в этом API завершались ошибкой, поэтому NextMux не выходит за {cap}.'],
    ar: ['السياق', 'تلقائي', 'غير متوفر', 'نافذة السياق التي توفرها هذه الواجهة لهذا النموذج.', 'مخصص', 'مرجع', 'فشلت الطلبات التي تتجاوز {cap} في هذه الواجهة، لذا يبقى NextMux ضمن {cap}.'],
    hi: ['संदर्भ', 'स्वचालित', 'प्रदान नहीं किया गया', 'इस मॉडल के लिए यह API जो संदर्भ विंडो देता है।', 'कस्टम', 'संदर्भ', 'इस API पर {cap} से बड़े अनुरोध विफल हुए, इसलिए NextMux {cap} के भीतर रहता है।']
};

/** `learned` contains {cap}: the limit this API actually accepted, below what it advertises. */
function uncheckedContextBudgetText(locale: NextMuxDesktopLocale, key: 'window' | 'auto' | 'unknown' | 'hint' | 'custom' | 'reference' | 'learned'): string {
    return labels[locale][key === 'window' ? 0 : key === 'auto' ? 1 : key === 'unknown' ? 2 : key === 'hint' ? 3 : key === 'custom' ? 4 : key === 'reference' ? 5 : 6];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function contextBudgetText(locale: Parameters<typeof uncheckedContextBudgetText>[0], key: Parameters<typeof uncheckedContextBudgetText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedContextBudgetText>>): string {
    return totalCopy(locale, key, language => uncheckedContextBudgetText(language, key, ...rest));
}
