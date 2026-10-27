import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { PublicMerchantMeasurement } from '../common/nextmux-public-merchants';

export type RelaySourceTab = 'merchant' | 'favorite' | 'my-api';
export type RelayMetricKind = 'quality' | 'authenticity' | 'availability' | 'latency' | 'price';

export function relayMeasurementExplanation(locale: NextMuxDesktopLocale, measurement?: PublicMerchantMeasurement): string {
    // Missing metrics mean that the platform has not published a probe yet;
    // they are not a failed request. Keep the actionable network message for
    // stale data only, so every empty latency/availability value is not shown
    // as an error.
    if (measurement?.state === 'stale') {
        if (locale === 'zh-CN') return '测速数据已过期，请点击重试';
        if (locale === 'zh-TW') return '測速資料已過期，請點擊重試';
        if (locale === 'ja') return '測定データが古くなっています。クリックして再試行';
        if (locale === 'ko') return '측정 데이터가 오래되었습니다. 클릭하여 다시 시도하세요';
        return 'Measurement is out of date; click to retry';
    }
    if (measurement?.state === 'pending') {
        if (locale === 'zh-CN') return '等待平台测速';
        if (locale === 'zh-TW') return '等待平台測速';
        if (locale === 'ja') return 'プラットフォームの測定を待っています';
        if (locale === 'ko') return '플랫폼 측정을 기다리는 중';
        return 'Waiting for platform measurement';
    }
    if (locale === 'zh-CN') return '暂无测速数据';
    if (locale === 'zh-TW') return '尚無測速資料';
    if (locale === 'ja') return '測定データなし';
    if (locale === 'ko') return '측정 데이터 없음';
    return 'No measurement data yet';
}

/** UI bands, not a statistical confidence estimate. Raw measurements remain in the tooltip. */
export function relayMetricSignal(kind: RelayMetricKind, value: number | undefined): {
    readonly level: number; readonly tone: 'unknown' | 'good' | 'medium' | 'poor';
} {
    const maximum = kind === 'quality' || kind === 'authenticity' ? 100 : kind === 'availability' ? 1 : Number.MAX_SAFE_INTEGER;
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > maximum
        || kind === 'price' && !Number.isSafeInteger(value)) return { level: 0, tone: 'unknown' };
    const thresholds = { quality: [40, 60, 75, 90], authenticity: [60, 75, 85, 95], availability: [.75, .9, .97, .99],
        latency: [4000, 2000, 1000, 500], price: [20000, 15000, 10000, 5000] }[kind];
    const lowerIsBetter = kind === 'latency' || kind === 'price';
    const level = 1 + thresholds.filter(threshold => lowerIsBetter ? value <= threshold : value >= threshold).length;
    return { level, tone: level >= 4 ? 'good' : level === 3 ? 'medium' : 'poor' };
}

/** A 0–100 measurement as a percentage with at most one decimal: two likes in three votes read 66.7%, not 66.66666666666667%. */
export function relayPercentText(locale: NextMuxDesktopLocale, value: number | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
        ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100) : '—';
}

/** A multiplier with its "×", or nothing when there is none, so a missing value never reads "—×". */
export function relayMultiplierTag(locale: NextMuxDesktopLocale, value: number | undefined | null): string {
    const text = relayMultiplierText(locale, value);
    return text === '—' ? '' : `${text}×`;
}

/**
 * A multiplier for display: at most two decimals (0.6666× reads 0.67×). Display only; billing keeps every basis point.
 * A paid quote under 0.005× reads "<0.01", never "0", so it cannot pass for free.
 */
export function relayMultiplierText(locale: NextMuxDesktopLocale, value: number | undefined | null): string {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return '—';
    const format = (multiplier: number): string => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(multiplier);
    return value > 0 && value < 50 ? `<${format(0.01)}` : format(value / 10_000);
}

const MAX_FAVORITE_MERCHANTS = 256;
const MAX_MERCHANT_ID_LENGTH = 300;
const MAX_MERCHANT_LABEL_LENGTH = 160;

/** Local-only preference data. Invalid or oversized records are ignored. */
export function parseRelayFavoriteMerchants(raw: string | null): Map<string, string> {
    const favorites = new Map<string, string>();
    if (!raw) return favorites;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return favorites;
        for (const value of parsed.slice(0, MAX_FAVORITE_MERCHANTS)) {
            const id = typeof value === 'string' ? value.trim()
                : value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
                    ? (value as { id: string }).id.trim() : '';
            if (!id || id.length > MAX_MERCHANT_ID_LENGTH) continue;
            const candidateLabel = value && typeof value === 'object' && typeof (value as { label?: unknown }).label === 'string'
                ? (value as { label: string }).label.trim() : '';
            favorites.set(id, (candidateLabel || id).slice(0, MAX_MERCHANT_LABEL_LENGTH));
        }
    } catch {
        // A corrupt local preference must never prevent the source picker opening.
    }
    return favorites;
}

export function serializeRelayFavoriteMerchants(favorites: ReadonlyMap<string, string>): string {
    return JSON.stringify([...favorites].slice(0, MAX_FAVORITE_MERCHANTS).map(([id, label]) => ({ id, label })));
}

interface RelayPickerSource {
    readonly publicCode?: string;
    readonly key: string;
    readonly kind: 'automatic' | 'managed' | 'official';
    readonly label: string;
    readonly detail?: string;
    readonly merchantId?: string;
}

/** A view of the existing user-visible routes, never an additional routing source. */
export function filterRelayPickerSources<T extends RelayPickerSource>(
    options: readonly T[], tab: RelaySourceTab, query: string, favoriteMerchantIds: ReadonlySet<string> = new Set()
): readonly T[] {
    const normalized = query.trim().normalize('NFKC').toLocaleLowerCase();
    return options.filter(option => (tab === 'my-api' ? option.kind === 'official'
        : tab === 'favorite' ? option.kind === 'managed' && favoriteMerchantIds.has(option.merchantId || '')
            : option.kind !== 'official')
        && (!normalized || [option.label, option.detail || '', option.key, option.merchantId || '',
            option.publicCode || '']
            .some(value => value.normalize('NFKC').toLocaleLowerCase().includes(normalized))));
}

const modelEvidenceLabels: Record<NextMuxDesktopLocale, readonly [string, string]> = {
    en: ['Model authenticity', 'Not yet published for use'],
    'zh-CN': ['模型真实度', '尚未上架使用'],
    'zh-TW': ['模型真實度', '尚未上架使用'],
    ja: ['モデルの真正性', 'まだ利用公開されていません'],
    ko: ['모델 진위', '아직 사용 가능하게 게시되지 않음'],
    es: ['Autenticidad del modelo', 'Aún no publicado para su uso'],
    fr: ['Authenticité du modèle', 'Pas encore disponible à l’utilisation'],
    de: ['Modellauthentizität', 'Noch nicht zur Nutzung veröffentlicht'],
    'pt-BR': ['Autenticidade do modelo', 'Ainda não publicado para uso'],
    ru: ['Подлинность модели', 'Ещё не опубликовано для использования'],
    ar: ['أصالة النموذج', 'لم يُنشر للاستخدام بعد'],
    hi: ['मॉडल की प्रामाणिकता', 'अभी उपयोग के लिए प्रकाशित नहीं']
};

export function modelPickerEvidenceText(locale: NextMuxDesktopLocale, key: 'authenticity' | 'listingPending'): string {
    return (modelEvidenceLabels[locale] || modelEvidenceLabels.en)[key === 'authenticity' ? 0 : 1];
}

/** The picker lists ticked models first, then everything else this API can run. */
const modelPickerListLabels: Readonly<Record<NextMuxDesktopLocale, readonly [string, string, string]>> = {
    en: ['More models', 'Search models', 'No matching models'],
    'zh-CN': ['更多模型', '搜索模型', '没有匹配的模型'],
    'zh-TW': ['更多模型', '搜尋模型', '沒有符合的模型'],
    ja: ['その他のモデル', 'モデルを検索', '一致するモデルはありません'],
    ko: ['더 많은 모델', '모델 검색', '일치하는 모델이 없습니다'],
    es: ['Más modelos', 'Buscar modelos', 'Ningún modelo coincide'],
    fr: ['Autres modèles', 'Rechercher des modèles', 'Aucun modèle correspondant'],
    de: ['Weitere Modelle', 'Modelle suchen', 'Keine passenden Modelle'],
    'pt-BR': ['Mais modelos', 'Pesquisar modelos', 'Nenhum modelo corresponde'],
    ru: ['Другие модели', 'Поиск моделей', 'Подходящих моделей нет'],
    ar: ['نماذج أخرى', 'ابحث عن نموذج', 'لا توجد نماذج مطابقة'],
    hi: ['और मॉडल', 'मॉडल खोजें', 'कोई मेल खाता मॉडल नहीं']
};

export function modelPickerListText(locale: NextMuxDesktopLocale, key: 'more' | 'search' | 'noMatch' | 'enableMoreModels' | 'hiddenModels' | 'hiddenModelsHint', count?: number): string {
    if (key === 'enableMoreModels') return enableMoreModelsLabels[locale] || enableMoreModelsLabels.en;
    if (key === 'hiddenModels') return (hiddenModelsLabels[locale] || hiddenModelsLabels.en).replaceAll('{count}', String(count ?? 0));
    if (key === 'hiddenModelsHint') return (hiddenModelsHintLabels[locale] || hiddenModelsHintLabels.en).replaceAll('{count}', String(count ?? 0));
    return (modelPickerListLabels[locale] || modelPickerListLabels.en)[key === 'more' ? 0 : key === 'search' ? 1 : 2];
}

const enableMoreModelsLabels: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '开启更多模型', 'zh-TW': '啟用更多模型', en: 'Enable more models', ja: 'モデルを追加で有効にする', ko: '더 많은 모델 활성화',
    es: 'Activar más modelos', fr: 'Activer plus de modèles', de: 'Weitere Modelle aktivieren', 'pt-BR': 'Ativar mais modelos',
    ru: 'Включить больше моделей', ar: 'تفعيل المزيد من النماذج', hi: 'और मॉडल चालू करें'
};

const hiddenModelsLabels: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '还有 {count} 个模型未显示',
    'zh-TW': '還有 {count} 個模型未顯示',
    en: '{count} more models hidden',
    ja: '他 {count} 件のモデルが非表示',
    ko: '모델 {count}개 더 숨겨짐',
    es: '{count} modelos más ocultos',
    fr: '{count} autres modèles masqués',
    de: 'Noch {count} Modelle ausgeblendet',
    'pt-BR': 'Mais {count} modelos ocultos',
    ru: 'Ещё скрыто моделей: {count}',
    ar: 'هناك {count} نماذج أخرى مخفية',
    hi: '{count} और मॉडल छिपे हैं'
};

const hiddenModelsHintLabels: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '勾选即可直接显示在“选择模型”列表中',
    'zh-TW': '勾選即可直接顯示在「選擇模型」列表中',
    en: 'Check to show directly in the model list',
    ja: 'チェックするとモデル一覧に表示されます',
    ko: '체크하면 모델 목록에 바로 표시됩니다',
    es: 'Marca para mostrar en la lista de modelos',
    fr: 'Cochez pour afficher dans la liste des modèles',
    de: 'Anhaken, um in der Modellliste anzuzeigen',
    'pt-BR': 'Marque para exibir na lista de modelos',
    ru: 'Отметьте, чтобы показать в списке моделей',
    ar: 'حدّد لإظهاره في قائمة النماذج',
    hi: 'मॉडल सूची में दिखाने के लिए चेक करें'
};
