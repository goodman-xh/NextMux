import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const en = {
    spend: 'Spend', requests: 'Requests', successRate: 'Success rate', tokens: 'Tokens', input: 'Input', output: 'Output',
    cacheHitRate: 'Cache hit rate', cacheRead: 'Cache read', cacheWrite: 'Cache write', avgLatency: 'Avg latency', p50: 'P50 latency',
    p95: 'P95 {value}', successHint: '{rate} successful', spendHint: '{count} requests', tokensHint: '{input} in · {output} out',
    cacheHint: 'Read {read} · write {write}', notReported: 'Not reported', trend: 'Daily trend', byModel: 'By model', byRelay: 'By relay',
    cache: 'Cache', model: 'Model', relay: 'Relay', failovers: 'Failovers', evidence: 'Model evidence', empty: 'No usage in this period',
    truncated: 'Charts use the latest {count} requests in this period.', topModels: 'Spend by model', dayTip: '{day}: {value}'
} as const;

type Key = keyof typeof en;

const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': {
        spend: '消费', requests: '请求', successRate: '成功率', tokens: 'Token', input: '输入', output: '输出',
        cacheHitRate: '缓存命中率', cacheRead: '缓存读取', cacheWrite: '缓存写入', avgLatency: '平均延迟', p50: '延迟 P50',
        p95: 'P95 {value}', successHint: '成功率 {rate}', spendHint: '{count} 次请求', tokensHint: '输入 {input} · 输出 {output}',
        cacheHint: '读取 {read} · 写入 {write}', notReported: '未上报', trend: '每日趋势', byModel: '按模型', byRelay: '按中转商',
        cache: '缓存', model: '模型', relay: '中转商', failovers: '切换', evidence: '模型证据', empty: '此时间段暂无使用记录',
        truncated: '图表基于此时间段最近 {count} 次请求。', topModels: '各模型消费', dayTip: '{day}：{value}'
    },
    'zh-TW': {
        spend: '消費', requests: '請求', successRate: '成功率', tokens: 'Token', input: '輸入', output: '輸出',
        cacheHitRate: '快取命中率', cacheRead: '快取讀取', cacheWrite: '快取寫入', avgLatency: '平均延遲', p50: '延遲 P50',
        p95: 'P95 {value}', successHint: '成功率 {rate}', spendHint: '{count} 次請求', tokensHint: '輸入 {input} · 輸出 {output}',
        cacheHint: '讀取 {read} · 寫入 {write}', notReported: '未回報', trend: '每日趨勢', byModel: '依模型', byRelay: '依中轉商',
        cache: '快取', model: '模型', relay: '中轉商', failovers: '切換', evidence: '模型證據', empty: '此期間尚無使用記錄',
        truncated: '圖表依據此期間最近 {count} 次請求。', topModels: '各模型消費', dayTip: '{day}：{value}'
    },
    ja: {
        spend: '利用額', requests: 'リクエスト', successRate: '成功率', tokens: 'トークン', input: '入力', output: '出力',
        cacheHitRate: 'キャッシュヒット率', cacheRead: 'キャッシュ読取', cacheWrite: 'キャッシュ書込', avgLatency: '平均レイテンシ', p50: 'P50 レイテンシ',
        p95: 'P95 {value}', successHint: '成功率 {rate}', spendHint: '{count} リクエスト', tokensHint: '入力 {input} · 出力 {output}',
        cacheHint: '読取 {read} · 書込 {write}', notReported: '未報告', trend: '日別推移', byModel: 'モデル別', byRelay: 'リレー別',
        cache: 'キャッシュ', model: 'モデル', relay: 'リレー', failovers: '切り替え', evidence: 'モデル証跡', empty: 'この期間の利用はありません',
        truncated: 'グラフはこの期間の直近 {count} 件のリクエストに基づきます。', topModels: 'モデル別利用額', dayTip: '{day}: {value}'
    },
    ko: {
        spend: '지출', requests: '요청', successRate: '성공률', tokens: '토큰', input: '입력', output: '출력',
        cacheHitRate: '캐시 적중률', cacheRead: '캐시 읽기', cacheWrite: '캐시 쓰기', avgLatency: '평균 지연', p50: 'P50 지연',
        p95: 'P95 {value}', successHint: '성공률 {rate}', spendHint: '요청 {count}건', tokensHint: '입력 {input} · 출력 {output}',
        cacheHint: '읽기 {read} · 쓰기 {write}', notReported: '보고되지 않음', trend: '일별 추이', byModel: '모델별', byRelay: '중계별',
        cache: '캐시', model: '모델', relay: '중계', failovers: '전환', evidence: '모델 증거', empty: '이 기간에는 사용 기록이 없습니다',
        truncated: '차트는 이 기간의 최근 요청 {count}건을 기준으로 합니다.', topModels: '모델별 지출', dayTip: '{day}: {value}'
    },
    es: {
        spend: 'Gasto', requests: 'Solicitudes', successRate: 'Tasa de éxito', tokens: 'Tokens', input: 'Entrada', output: 'Salida',
        cacheHitRate: 'Aciertos de caché', cacheRead: 'Lectura de caché', cacheWrite: 'Escritura de caché', avgLatency: 'Latencia media', p50: 'Latencia P50',
        p95: 'P95 {value}', successHint: '{rate} con éxito', spendHint: '{count} solicitudes', tokensHint: '{input} entrada · {output} salida',
        cacheHint: 'Lectura {read} · escritura {write}', notReported: 'No informado', trend: 'Tendencia diaria', byModel: 'Por modelo', byRelay: 'Por intermediario',
        cache: 'Caché', model: 'Modelo', relay: 'Intermediario', failovers: 'Conmutaciones', evidence: 'Evidencia del modelo', empty: 'Sin uso en este periodo',
        truncated: 'Los gráficos usan las últimas {count} solicitudes del periodo.', topModels: 'Gasto por modelo', dayTip: '{day}: {value}'
    },
    fr: {
        spend: 'Dépenses', requests: 'Requêtes', successRate: 'Taux de réussite', tokens: 'Tokens', input: 'Entrée', output: 'Sortie',
        cacheHitRate: 'Taux de cache', cacheRead: 'Lecture du cache', cacheWrite: 'Écriture du cache', avgLatency: 'Latence moyenne', p50: 'Latence P50',
        p95: 'P95 {value}', successHint: '{rate} réussies', spendHint: '{count} requêtes', tokensHint: '{input} entrée · {output} sortie',
        cacheHint: 'Lecture {read} · écriture {write}', notReported: 'Non signalé', trend: 'Tendance quotidienne', byModel: 'Par modèle', byRelay: 'Par relais',
        cache: 'Cache', model: 'Modèle', relay: 'Relais', failovers: 'Basculements', evidence: 'Preuve du modèle', empty: 'Aucune utilisation sur cette période',
        truncated: 'Les graphiques utilisent les {count} dernières requêtes de la période.', topModels: 'Dépenses par modèle', dayTip: '{day} : {value}'
    },
    de: {
        spend: 'Ausgaben', requests: 'Anfragen', successRate: 'Erfolgsquote', tokens: 'Token', input: 'Eingabe', output: 'Ausgabe',
        cacheHitRate: 'Cache-Trefferquote', cacheRead: 'Cache-Lesen', cacheWrite: 'Cache-Schreiben', avgLatency: 'Ø Latenz', p50: 'P50-Latenz',
        p95: 'P95 {value}', successHint: '{rate} erfolgreich', spendHint: '{count} Anfragen', tokensHint: '{input} Eingabe · {output} Ausgabe',
        cacheHint: 'Lesen {read} · Schreiben {write}', notReported: 'Nicht gemeldet', trend: 'Tagesverlauf', byModel: 'Nach Modell', byRelay: 'Nach Relay',
        cache: 'Cache', model: 'Modell', relay: 'Relay', failovers: 'Umschaltungen', evidence: 'Modellnachweis', empty: 'Keine Nutzung in diesem Zeitraum',
        truncated: 'Diagramme nutzen die letzten {count} Anfragen des Zeitraums.', topModels: 'Ausgaben nach Modell', dayTip: '{day}: {value}'
    },
    'pt-BR': {
        spend: 'Gasto', requests: 'Solicitações', successRate: 'Taxa de sucesso', tokens: 'Tokens', input: 'Entrada', output: 'Saída',
        cacheHitRate: 'Acertos de cache', cacheRead: 'Leitura de cache', cacheWrite: 'Gravação de cache', avgLatency: 'Latência média', p50: 'Latência P50',
        p95: 'P95 {value}', successHint: '{rate} com sucesso', spendHint: '{count} solicitações', tokensHint: '{input} entrada · {output} saída',
        cacheHint: 'Leitura {read} · gravação {write}', notReported: 'Não informado', trend: 'Tendência diária', byModel: 'Por modelo', byRelay: 'Por relay',
        cache: 'Cache', model: 'Modelo', relay: 'Relay', failovers: 'Trocas', evidence: 'Evidência do modelo', empty: 'Sem uso neste período',
        truncated: 'Os gráficos usam as últimas {count} solicitações do período.', topModels: 'Gasto por modelo', dayTip: '{day}: {value}'
    },
    ru: {
        spend: 'Расходы', requests: 'Запросы', successRate: 'Успешность', tokens: 'Токены', input: 'Вход', output: 'Выход',
        cacheHitRate: 'Попадания в кэш', cacheRead: 'Чтение кэша', cacheWrite: 'Запись кэша', avgLatency: 'Средняя задержка', p50: 'Задержка P50',
        p95: 'P95 {value}', successHint: 'Успешно {rate}', spendHint: 'Запросов: {count}', tokensHint: 'Вход {input} · выход {output}',
        cacheHint: 'Чтение {read} · запись {write}', notReported: 'Не сообщено', trend: 'По дням', byModel: 'По моделям', byRelay: 'По посредникам',
        cache: 'Кэш', model: 'Модель', relay: 'Посредник', failovers: 'Переключения', evidence: 'Подтверждение модели', empty: 'За этот период использования нет',
        truncated: 'Графики построены по последним {count} запросам периода.', topModels: 'Расходы по моделям', dayTip: '{day}: {value}'
    },
    ar: {
        spend: 'الإنفاق', requests: 'الطلبات', successRate: 'معدل النجاح', tokens: 'الرموز', input: 'الإدخال', output: 'الإخراج',
        cacheHitRate: 'معدل إصابة الذاكرة المؤقتة', cacheRead: 'قراءة الذاكرة المؤقتة', cacheWrite: 'كتابة الذاكرة المؤقتة', avgLatency: 'متوسط زمن الاستجابة', p50: 'زمن الاستجابة P50',
        p95: 'P95 {value}', successHint: 'ناجحة {rate}', spendHint: '{count} طلب', tokensHint: 'إدخال {input} · إخراج {output}',
        cacheHint: 'قراءة {read} · كتابة {write}', notReported: 'غير مُبلَّغ', trend: 'الاتجاه اليومي', byModel: 'حسب النموذج', byRelay: 'حسب الوسيط',
        cache: 'الذاكرة المؤقتة', model: 'النموذج', relay: 'الوسيط', failovers: 'التحويلات', evidence: 'دليل النموذج', empty: 'لا يوجد استخدام في هذه الفترة',
        truncated: 'تعتمد الرسوم على آخر {count} طلب في هذه الفترة.', topModels: 'الإنفاق حسب النموذج', dayTip: '{day}: {value}'
    },
    hi: {
        spend: 'खर्च', requests: 'अनुरोध', successRate: 'सफलता दर', tokens: 'टोकन', input: 'इनपुट', output: 'आउटपुट',
        cacheHitRate: 'कैश हिट दर', cacheRead: 'कैश रीड', cacheWrite: 'कैश राइट', avgLatency: 'औसत विलंब', p50: 'P50 विलंब',
        p95: 'P95 {value}', successHint: '{rate} सफल', spendHint: '{count} अनुरोध', tokensHint: 'इनपुट {input} · आउटपुट {output}',
        cacheHint: 'रीड {read} · राइट {write}', notReported: 'रिपोर्ट नहीं', trend: 'दैनिक रुझान', byModel: 'मॉडल के अनुसार', byRelay: 'रिले के अनुसार',
        cache: 'कैश', model: 'मॉडल', relay: 'रिले', failovers: 'स्विच', evidence: 'मॉडल साक्ष्य', empty: 'इस अवधि में कोई उपयोग नहीं',
        truncated: 'चार्ट इस अवधि के नवीनतम {count} अनुरोधों पर आधारित हैं।', topModels: 'मॉडल के अनुसार खर्च', dayTip: '{day}: {value}'
    }
};

export type UsageAnalyticsTextKey = Key;

function uncheckedUsageAnalyticsText(locale: NextMuxDesktopLocale, key: Key, values: Readonly<Record<string, string | number>> = {}): string {
    return (translations[locale]?.[key] ?? en[key]).replace(/\{([a-z]+)\}/gi, (_match, name: string) => String(values[name] ?? ''));
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function usageAnalyticsText(locale: Parameters<typeof uncheckedUsageAnalyticsText>[0], key: Parameters<typeof uncheckedUsageAnalyticsText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedUsageAnalyticsText>>): string {
    return totalCopy(locale, key, language => uncheckedUsageAnalyticsText(language, key, ...rest));
}
