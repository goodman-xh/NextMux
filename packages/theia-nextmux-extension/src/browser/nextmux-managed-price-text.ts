import type { ManagedPriceUpdate } from '@nextmux/agent-runtime';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';
import { offeringPriceText, type OfferingPriceTextKey } from './nextmux-offering-price';
import { formatRouteMultiplier } from './nextmux-route-price-text';

const copy = {
    'zh-CN': { title: '本次调用价格', body: '本次调用采用 {model} 的当前价格：{price}。', close: '关闭', tokens: 'Token', characters: '字符', units: '单位', unavailable: '暂无价格明细', more: '另有 {count} 项价格' },
    'zh-TW': { title: '本次呼叫價格', body: '本次呼叫採用 {model} 的目前價格：{price}。', close: '關閉', tokens: 'Token', characters: '字元', units: '單位', unavailable: '暫無價格明細', more: '另有 {count} 項價格' },
    en: { title: 'Price for this call', body: 'This call uses the current price for {model}: {price}.', close: 'Close', tokens: 'tokens', characters: 'characters', units: 'units', unavailable: 'Price details unavailable', more: '{count} additional rates' },
    ja: { title: '今回の呼び出しの料金', body: '今回の呼び出しには {model} の現在の料金が適用されます：{price}。', close: '閉じる', tokens: 'トークン', characters: '文字', units: '単位', unavailable: '料金の詳細はありません', more: 'ほか {count} 件の料金' },
    ko: { title: '이번 호출 요금', body: '이번 호출에는 {model}의 현재 요금이 적용됩니다: {price}.', close: '닫기', tokens: '토큰', characters: '문자', units: '단위', unavailable: '요금 상세 정보 없음', more: '요금 항목 {count}개 더 있음' },
    es: { title: 'Precio de esta llamada', body: 'Esta llamada usa el precio actual de {model}: {price}.', close: 'Cerrar', tokens: 'tokens', characters: 'caracteres', units: 'unidades', unavailable: 'Detalles de precio no disponibles', more: '{count} tarifas adicionales' },
    fr: { title: 'Prix de cet appel', body: 'Cet appel utilise le prix actuel de {model} : {price}.', close: 'Fermer', tokens: 'tokens', characters: 'caractères', units: 'unités', unavailable: 'Détails du prix indisponibles', more: '{count} tarifs supplémentaires' },
    de: { title: 'Preis für diesen Aufruf', body: 'Für diesen Aufruf gilt der aktuelle Preis von {model}: {price}.', close: 'Schließen', tokens: 'Token', characters: 'Zeichen', units: 'Einheiten', unavailable: 'Preisdetails nicht verfügbar', more: '{count} weitere Preise' },
    'pt-BR': { title: 'Preço desta chamada', body: 'Esta chamada usa o preço atual de {model}: {price}.', close: 'Fechar', tokens: 'tokens', characters: 'caracteres', units: 'unidades', unavailable: 'Detalhes do preço indisponíveis', more: '{count} tarifas adicionais' },
    ru: { title: 'Цена этого вызова', body: 'Для этого вызова применяется текущая цена {model}: {price}.', close: 'Закрыть', tokens: 'токенов', characters: 'символов', units: 'единиц', unavailable: 'Сведения о цене недоступны', more: 'Ещё {count} тарифов' },
    ar: { title: 'سعر هذا الاستدعاء', body: 'يستخدم هذا الاستدعاء السعر الحالي للنموذج {model}: {price}.', close: 'إغلاق', tokens: 'رمز', characters: 'حرف', units: 'وحدة', unavailable: 'تفاصيل السعر غير متاحة', more: '{count} أسعار إضافية' },
    hi: { title: 'इस कॉल की कीमत', body: 'इस कॉल में {model} की मौजूदा कीमत लागू है: {price}।', close: 'बंद करें', tokens: 'टोकन', characters: 'अक्षर', units: 'इकाइयाँ', unavailable: 'कीमत का विवरण उपलब्ध नहीं है', more: '{count} अतिरिक्त दरें' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

export type ManagedPriceTextKey = 'title' | 'body' | 'close';

/** Shared wording for a banner, a durable notification and a run event. */
export function managedPriceText(locale: NextMuxDesktopLocale, key: ManagedPriceTextKey,
    values: Readonly<{ model?: string; price?: string }> = {}): string {
    return totalCopy(locale, key, language => (copy[language] || copy.en)[key]
        .replace(/\{(model|price)\}/g, (_match, name: 'model' | 'price') =>
            (values[name] ?? '—').slice(0, name === 'model' ? 256 : 20_000)));
}

type RateUnit = 'tokens' | 'characters' | 'imageUnit' | 'second' | 'requestUnit';
const metrics: Readonly<Record<string, readonly [OfferingPriceTextKey, RateUnit]>> = {
    input_token: ['input', 'tokens'], output_token: ['output', 'tokens'],
    cached_input_token: ['cacheRead', 'tokens'], cache_write_token: ['cacheWrite', 'tokens'],
    image_output_token: ['imageOutput', 'tokens'], image: ['image', 'imageUnit'],
    video_second: ['video', 'second'], video_input_image: ['videoInputImage', 'imageUnit'],
    audio_character: ['speech', 'characters'], audio_second: ['audio', 'second'], request: ['request', 'requestUnit']
};

const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Shift the decimal representation, preserving fractional micros and bps.
 * Number division/toFixed can invent rounding or turn a real tiny rate into 0. */
function decimalScale(value: number, places: number): string {
    if (value === 0) return '0';
    const [coefficient, rawExponent] = String(value).split('e');
    const exponent = Number(rawExponent || 0) - places;
    const [integer, fraction = ''] = coefficient.split('.');
    const digits = integer + fraction, point = integer.length + exponent;
    if (point < -24 || point > 24) return `${coefficient}e${exponent}`;
    const result = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
        : point >= digits.length ? digits + '0'.repeat(point - digits.length)
            : `${digits.slice(0, point)}.${digits.slice(point)}`;
    return result.includes('.') ? result.replace(/0+$/, '').replace(/\.$/, '') : result;
}

/** Describe authoritative customer rates exactly as quoted. The multiplier is contextual metadata, never a second
 * multiplication of customerAmountMicros, and reads like every other multiplier (at most two decimals). */
export function managedPriceSummary(locale: NextMuxDesktopLocale, update: ManagedPriceUpdate): string {
    const language = Object.hasOwn(copy, locale) ? locale : 'en';
    const words = copy[language];
    const count = new Intl.NumberFormat(language, { maximumSignificantDigits: 21 });
    const currency = typeof update.currency === 'string' ? update.currency.trim().slice(0, 16) || '—' : '—';
    const rates = Array.isArray(update.rates) ? update.rates : [];
    const summary = rates.slice(0, 64).map(rate => {
        const metric = typeof rate.metric === 'string' ? rate.metric.slice(0, 96) : '—';
        const known = Object.hasOwn(metrics, metric) ? metrics[metric] : undefined;
        const label = known ? offeringPriceText(language, known[0]) : metric;
        const unit = known ? known[1] === 'tokens' || known[1] === 'characters'
            ? words[known[1]] : offeringPriceText(language, known[1]) : words.units;
        const amount = nonnegative(rate.customerAmountMicros) ? decimalScale(rate.customerAmountMicros, 6) : '—';
        const formattedSize = nonnegative(rate.unitSize) && rate.unitSize > 0 ? count.format(rate.unitSize) : '—';
        const size = formattedSize.length > 48 ? String(rate.unitSize) : formattedSize;
        return `${label}: ${currency} ${amount} / ${size} ${unit}`;
    });
    if (rates.length > 64) summary.push(words.more.replace('{count}', count.format(rates.length - 64)));
    if (!summary.length) summary.push(words.unavailable);
    if (nonnegative(update.usageMultiplierBps)) {
        summary.push(`${offeringPriceText(language, 'multiplier')}: ×${formatRouteMultiplier(update.usageMultiplierBps)}`);
    }
    return summary.join('; ');
}
