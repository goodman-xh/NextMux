import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/** Wording for "the merchant changed the multiplier of the model you are using". */
const text = {
    en: { title: 'Model price multiplier changed', body: 'The merchant changed the multiplier of {model}, which you are using, from {from} to {to}. To avoid unexpected charges, review the model you use.', inline: 'The merchant changed the multiplier of the model you are using from {from} to {to}. To avoid unexpected charges, review the model you use.', close: 'Close' },
    'zh-CN': { title: '模型倍率已调整', body: '你正在使用的 {model}，商家已将倍率从 {from} 调整为 {to}。为避免资金损失，请及时调整模型使用。', inline: '你现使用的模型，商家已将倍率从 {from} 调整为 {to}，为避免资金损失，请及时调整模型使用', close: '关闭' },
    'zh-TW': { title: '模型倍率已調整', body: '你正在使用的 {model}，商家已將倍率從 {from} 調整為 {to}。為避免資金損失，請及時調整模型使用。', inline: '你現在使用的模型，商家已將倍率從 {from} 調整為 {to}，為避免資金損失，請及時調整模型使用', close: '關閉' },
    ja: { title: 'モデルの倍率が変更されました', body: '使用中の {model} の倍率が、販売者によって {from} から {to} に変更されました。予期しない費用を避けるため、使用するモデルを見直してください。', inline: '使用中のモデルの倍率が {from} から {to} に変更されました。予期しない費用を避けるため、使用するモデルを見直してください', close: '閉じる' },
    ko: { title: '모델 배율이 변경됨', body: '사용 중인 {model}의 배율을 판매자가 {from}에서 {to}(으)로 바꿨습니다. 예상치 못한 비용을 막으려면 사용하는 모델을 확인하세요.', inline: '사용 중인 모델의 배율이 {from}에서 {to}(으)로 바뀌었습니다. 예상치 못한 비용을 막으려면 사용하는 모델을 확인하세요', close: '닫기' },
    es: { title: 'Cambió el multiplicador del modelo', body: 'El comerciante cambió el multiplicador de {model}, que estás usando, de {from} a {to}. Para evitar cargos inesperados, revisa el modelo que usas.', inline: 'El comerciante cambió el multiplicador del modelo que usas de {from} a {to}. Para evitar cargos inesperados, revisa el modelo que usas', close: 'Cerrar' },
    fr: { title: 'Multiplicateur du modèle modifié', body: 'Le marchand a changé le multiplicateur de {model}, que vous utilisez, de {from} à {to}. Pour éviter des frais inattendus, vérifiez le modèle utilisé.', inline: 'Le marchand a changé le multiplicateur du modèle que vous utilisez de {from} à {to}. Pour éviter des frais inattendus, vérifiez le modèle utilisé', close: 'Fermer' },
    de: { title: 'Modell-Multiplikator geändert', body: 'Der Händler hat den Multiplikator von {model}, das Sie verwenden, von {from} auf {to} geändert. Prüfen Sie das verwendete Modell, um unerwartete Kosten zu vermeiden.', inline: 'Der Händler hat den Multiplikator Ihres Modells von {from} auf {to} geändert. Prüfen Sie das verwendete Modell, um unerwartete Kosten zu vermeiden', close: 'Schließen' },
    'pt-BR': { title: 'Multiplicador do modelo alterado', body: 'O comerciante mudou o multiplicador de {model}, que você está usando, de {from} para {to}. Para evitar cobranças inesperadas, revise o modelo que usa.', inline: 'O comerciante mudou o multiplicador do modelo que você usa de {from} para {to}. Para evitar cobranças inesperadas, revise o modelo que usa', close: 'Fechar' },
    ru: { title: 'Множитель модели изменён', body: 'Продавец изменил множитель модели {model}, которой вы пользуетесь, с {from} на {to}. Чтобы избежать неожиданных расходов, проверьте используемую модель.', inline: 'Продавец изменил множитель вашей модели с {from} на {to}. Чтобы избежать неожиданных расходов, проверьте используемую модель', close: 'Закрыть' },
    ar: { title: 'تغيّر مُضاعِف سعر النموذج', body: 'غيّر التاجر مُضاعِف {model} الذي تستخدمه من {from} إلى {to}. لتجنّب رسوم غير متوقعة، راجع النموذج الذي تستخدمه.', inline: 'غيّر التاجر مُضاعِف النموذج الذي تستخدمه من {from} إلى {to}. لتجنّب رسوم غير متوقعة، راجع النموذج الذي تستخدمه', close: 'إغلاق' },
    hi: { title: 'मॉडल का गुणक बदला गया', body: 'आप जिस {model} का इस्तेमाल कर रहे हैं, विक्रेता ने उसका गुणक {from} से {to} कर दिया है। अनचाहे खर्च से बचने के लिए इस्तेमाल हो रहे मॉडल की जाँच करें।', inline: 'विक्रेता ने आपके मॉडल का गुणक {from} से {to} कर दिया है। अनचाहे खर्च से बचने के लिए इस्तेमाल हो रहे मॉडल की जाँच करें', close: 'बंद करें' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

type Key = keyof typeof text.en;
function uncheckedRoutePriceText(locale: NextMuxDesktopLocale, key: Key, values: Record<string, string> = {}): string {
    return Object.entries(values).reduce<string>((out, [name, value]) => out.replaceAll(`{${name}}`, value), (text[locale] || text.en)[key]);
}

/**
 * A multiplier for notices and price summaries: at most two decimals (1000 bps → "0.1", 6666 → "0.67", 12500 →
 * "1.25"), and "<0.01" rather than "0" for a paid quote under 0.005×. Display only; billing keeps every basis point.
 * The digits stay ASCII because they sit inside translated sentences.
 */
export function formatRouteMultiplier(bps: number): string {
    if (typeof bps !== 'number' || !Number.isFinite(bps) || bps < 0) return '—';
    const format = (multiplier: number): string => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false }).format(multiplier);
    return bps > 0 && bps < 50 ? `<${format(0.01)}` : format(bps / 10_000);
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function routePriceText(locale: Parameters<typeof uncheckedRoutePriceText>[0], key: Parameters<typeof uncheckedRoutePriceText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedRoutePriceText>>): string {
    return totalCopy(locale, key, language => uncheckedRoutePriceText(language, key, ...rest));
}

const changedText = {
    'zh-CN': { notice: '该模型的倍率已被商家调整，请知悉！', changed: '倍率已从 {from} 调整为 {to}', current: '当前倍率：{to}' },
    'zh-TW': { notice: '該模型的倍率已被商家調整，請知悉！', changed: '倍率已從 {from} 調整為 {to}', current: '目前倍率：{to}' },
    en: { notice: "The merchant adjusted this model's multiplier. Please note!", changed: 'The multiplier changed from {from} to {to}', current: 'Current multiplier: {to}' },
    ja: { notice: '販売者がこのモデルの倍率を変更しました。ご確認ください！', changed: '倍率が {from} から {to} に変更されました', current: '現在の倍率：{to}' },
    ko: { notice: '판매자가 이 모델의 배율을 조정했습니다. 확인해 주세요!', changed: '배율이 {from}에서 {to}(으)로 변경되었습니다', current: '현재 배율: {to}' },
    es: { notice: 'El comerciante ajustó el multiplicador de este modelo. ¡Tenlo en cuenta!', changed: 'El multiplicador cambió de {from} a {to}', current: 'Multiplicador actual: {to}' },
    fr: { notice: 'Le marchand a ajusté le multiplicateur de ce modèle. Veuillez en prendre note !', changed: 'Le multiplicateur est passé de {from} à {to}', current: 'Multiplicateur actuel : {to}' },
    de: { notice: 'Der Händler hat den Multiplikator dieses Modells angepasst. Bitte beachten!', changed: 'Der Multiplikator wurde von {from} auf {to} geändert', current: 'Aktueller Multiplikator: {to}' },
    'pt-BR': { notice: 'O comerciante ajustou o multiplicador deste modelo. Fique atento!', changed: 'O multiplicador mudou de {from} para {to}', current: 'Multiplicador atual: {to}' },
    ru: { notice: 'Продавец изменил множитель этой модели. Обратите внимание!', changed: 'Множитель изменён с {from} на {to}', current: 'Текущий множитель: {to}' },
    ar: { notice: 'عدّل التاجر مُضاعِف هذا النموذج. يُرجى الانتباه!', changed: 'تغيّر المُضاعِف من {from} إلى {to}', current: 'المُضاعِف الحالي: {to}' },
    hi: { notice: 'विक्रेता ने इस मॉडल का गुणक बदल दिया है। कृपया ध्यान दें!', changed: 'गुणक {from} से बदलकर {to} हो गया है', current: 'वर्तमान गुणक: {to}' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

export interface RoutePriceChangedObservation {
    readonly usageMultiplierBps?: number | null;
    readonly previousUsageMultiplierBps?: number | null;
}

/** The compact composer notice deliberately leaves the numeric detail to its tooltip. */
export function formatRoutePriceChangedNotice(locale: NextMuxDesktopLocale): string {
    return totalCopy(locale, 'notice', language => (changedText[language] || changedText.en).notice);
}

export function formatRoutePriceChangedDetail(locale: NextMuxDesktopLocale, observation: RoutePriceChangedObservation): string {
    const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (!valid(observation.usageMultiplierBps)) return '';
    const key = valid(observation.previousUsageMultiplierBps) ? 'changed' : 'current';
    const to = `×${formatRouteMultiplier(observation.usageMultiplierBps)}`;
    const from = valid(observation.previousUsageMultiplierBps) ? `×${formatRouteMultiplier(observation.previousUsageMultiplierBps)}` : '';
    return totalCopy(locale, key, language => (changedText[language] || changedText.en)[key]
        .replace('{from}', from).replace('{to}', to));
}
