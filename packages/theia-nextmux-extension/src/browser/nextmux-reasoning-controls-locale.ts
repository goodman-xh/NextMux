import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/** Labels for provider-declared thinking controls (budget, mode, on/off, include thinking); values stay canonical on the wire. */
const en = {
    budget: 'Thinking token budget', mode: 'Thinking mode', enabled: 'Thinking', exclude: 'Include thinking in response',
    required: 'Required by the provider', default: 'Default', defaultValue: 'Default ({value})',
    adaptive: 'Adaptive', on: 'On', off: 'Off', yes: 'Yes', no: 'No',
    depth: 'Thinking', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', verified: 'Confirmed on this API'
} as const;
type Key = keyof typeof en;
const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': { budget: '思考 token 预算', mode: '思考模式', enabled: '深度思考', exclude: '回复中包含思考内容', required: '服务商要求必填', default: '默认', defaultValue: '默认（{value}）', adaptive: '自适应', on: '开启', off: '关闭', yes: '是', no: '否', depth: '思考深度', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', verified: '已在该 API 上验证' },
    'zh-TW': { budget: '思考 token 預算', mode: '思考模式', enabled: '深度思考', exclude: '回覆中包含思考內容', required: '服務商要求必填', default: '預設', defaultValue: '預設（{value}）', adaptive: '自適應', on: '開啟', off: '關閉', yes: '是', no: '否', depth: '思考深度', minimal: '極低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', verified: '已在此 API 上驗證' },
    ja: { budget: '思考トークン予算', mode: '思考モード', enabled: '思考', exclude: '応答に思考内容を含める', required: 'プロバイダーの必須項目', default: '既定', defaultValue: '既定（{value}）', adaptive: '自動調整', on: 'オン', off: 'オフ', yes: 'はい', no: 'いいえ', depth: '思考の深さ', minimal: '最小', low: '低', medium: '中', high: '高', xhigh: '最高', max: '最大', verified: 'この API で確認済み' },
    ko: { budget: '사고 토큰 예산', mode: '사고 모드', enabled: '사고', exclude: '응답에 사고 내용 포함', required: '제공업체 필수', default: '기본값', defaultValue: '기본값({value})', adaptive: '적응형', on: '켜기', off: '끄기', yes: '예', no: '아니요', depth: '사고 깊이', minimal: '최소', low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대', verified: '이 API에서 확인됨' },
    es: { budget: 'Presupuesto de tokens de razonamiento', mode: 'Modo de razonamiento', enabled: 'Razonamiento', exclude: 'Incluir el razonamiento en la respuesta', required: 'Obligatorio para el proveedor', default: 'Predeterminado', defaultValue: 'Predeterminado ({value})', adaptive: 'Adaptativo', on: 'Activado', off: 'Desactivado', yes: 'Sí', no: 'No', depth: 'Profundidad de razonamiento', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', verified: 'Confirmado en esta API' },
    fr: { budget: 'Budget de jetons de réflexion', mode: 'Mode de réflexion', enabled: 'Réflexion', exclude: 'Inclure la réflexion dans la réponse', required: 'Exigé par le fournisseur', default: 'Par défaut', defaultValue: 'Par défaut ({value})', adaptive: 'Adaptatif', on: 'Activé', off: 'Désactivé', yes: 'Oui', no: 'Non', depth: 'Profondeur de réflexion', minimal: 'Minimal', low: 'Faible', medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé', max: 'Maximum', verified: 'Confirmé sur cette API' },
    de: { budget: 'Token-Budget fürs Denken', mode: 'Denkmodus', enabled: 'Denken', exclude: 'Denkinhalt in der Antwort zeigen', required: 'Vom Anbieter verlangt', default: 'Standard', defaultValue: 'Standard ({value})', adaptive: 'Adaptiv', on: 'An', off: 'Aus', yes: 'Ja', no: 'Nein', depth: 'Denktiefe', minimal: 'Minimal', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', xhigh: 'Sehr hoch', max: 'Maximal', verified: 'Auf dieser API bestätigt' },
    'pt-BR': { budget: 'Orçamento de tokens de raciocínio', mode: 'Modo de raciocínio', enabled: 'Raciocínio', exclude: 'Incluir o raciocínio na resposta', required: 'Exigido pelo provedor', default: 'Padrão', defaultValue: 'Padrão ({value})', adaptive: 'Adaptativo', on: 'Ativado', off: 'Desativado', yes: 'Sim', no: 'Não', depth: 'Profundidade de raciocínio', minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo', verified: 'Confirmado nesta API' },
    ru: { budget: 'Бюджет токенов на размышление', mode: 'Режим размышления', enabled: 'Размышление', exclude: 'Показывать размышление в ответе', required: 'Требуется провайдером', default: 'По умолчанию', defaultValue: 'По умолчанию ({value})', adaptive: 'Адаптивный', on: 'Вкл.', off: 'Выкл.', yes: 'Да', no: 'Нет', depth: 'Глубина размышления', minimal: 'Минимум', low: 'Низкая', medium: 'Средняя', high: 'Высокая', xhigh: 'Очень высокая', max: 'Максимум', verified: 'Проверено на этом API' },
    ar: { budget: 'ميزانية رموز التفكير', mode: 'وضع التفكير', enabled: 'التفكير', exclude: 'تضمين التفكير في الرد', required: 'مطلوب من المزوّد', default: 'افتراضي', defaultValue: 'افتراضي ({value})', adaptive: 'تكيّفي', on: 'تشغيل', off: 'إيقاف', yes: 'نعم', no: 'لا', depth: 'عمق التفكير', minimal: 'أدنى', low: 'منخفض', medium: 'متوسط', high: 'مرتفع', xhigh: 'مرتفع جدًا', max: 'الأقصى', verified: 'تم التأكد منه على هذه الواجهة' },
    hi: { budget: 'सोचने का टोकन बजट', mode: 'सोचने का मोड', enabled: 'सोचना', exclude: 'जवाब में सोच शामिल करें', required: 'प्रदाता के लिए ज़रूरी', default: 'डिफ़ॉल्ट', defaultValue: 'डिफ़ॉल्ट ({value})', adaptive: 'अनुकूली', on: 'चालू', off: 'बंद', yes: 'हाँ', no: 'नहीं', depth: 'सोचने की गहराई', minimal: 'न्यूनतम', low: 'कम', medium: 'मध्यम', high: 'उच्च', xhigh: 'बहुत उच्च', max: 'अधिकतम', verified: 'इस API पर पुष्टि हुई' }
};

function uncheckedReasoningControlText(locale: NextMuxDesktopLocale, key: Key, value = ''): string {
    return (translations[locale] || en)[key].replace('{value}', value);
}

/** A declared value as the user reads it; `exclude` is inverted (true means "do not include thinking"). */
export function reasoningValueText(locale: NextMuxDesktopLocale, field: string, value: string | boolean | number): string {
    if (typeof value === 'boolean') return reasoningControlText(locale, field === 'reasoningExclude' ? value ? 'no' : 'yes' : value ? 'on' : 'off');
    if (value === 'adaptive') return reasoningControlText(locale, 'adaptive');
    if (value === 'enabled') return reasoningControlText(locale, 'on');
    if (value === 'disabled') return reasoningControlText(locale, 'off');
    return String(value);
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function reasoningControlText(locale: Parameters<typeof uncheckedReasoningControlText>[0], key: Parameters<typeof uncheckedReasoningControlText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedReasoningControlText>>): string {
    return totalCopy(locale, key, language => uncheckedReasoningControlText(language, key, ...rest));
}
