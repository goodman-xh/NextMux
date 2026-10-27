import type { NextMuxDesktopLocale } from './nextmux-locale';

/** The countdown a failed reply shows while it waits to retry by itself (LobeChat #7), and its two actions. */
export type AutoRetryTextKey = 'busyCountdown' | 'retryCountdown' | 'retryNow' | 'cancel';

const en: Readonly<Record<AutoRetryTextKey, string>> = {
    busyCountdown: 'The service is busy. Retrying in {seconds} s (attempt {attempt} of {total})',
    retryCountdown: 'Retrying in {seconds} s (attempt {attempt} of {total})',
    retryNow: 'Retry now', cancel: 'Don’t retry'
};

const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<AutoRetryTextKey, string>>>> = {
    en,
    'zh-CN': { busyCountdown: '服务繁忙，{seconds} 秒后自动重试（第 {attempt}/{total} 次）', retryCountdown: '{seconds} 秒后自动重试（第 {attempt}/{total} 次）', retryNow: '立即重试', cancel: '取消自动重试' },
    'zh-TW': { busyCountdown: '服務繁忙，{seconds} 秒後自動重試（第 {attempt}/{total} 次）', retryCountdown: '{seconds} 秒後自動重試（第 {attempt}/{total} 次）', retryNow: '立即重試', cancel: '取消自動重試' },
    ja: { busyCountdown: 'サービスが混雑しています。{seconds} 秒後に自動で再試行します（{attempt}/{total} 回目）', retryCountdown: '{seconds} 秒後に自動で再試行します（{attempt}/{total} 回目）', retryNow: '今すぐ再試行', cancel: '自動再試行をやめる' },
    ko: { busyCountdown: '서비스가 혼잡합니다. {seconds}초 후 자동으로 다시 시도합니다({attempt}/{total}회)', retryCountdown: '{seconds}초 후 자동으로 다시 시도합니다({attempt}/{total}회)', retryNow: '지금 다시 시도', cancel: '자동 재시도 취소' },
    es: { busyCountdown: 'El servicio está ocupado. Reintento en {seconds} s (intento {attempt} de {total})', retryCountdown: 'Reintento en {seconds} s (intento {attempt} de {total})', retryNow: 'Reintentar ahora', cancel: 'No reintentar' },
    fr: { busyCountdown: 'Le service est saturé. Nouvel essai dans {seconds} s (tentative {attempt} sur {total})', retryCountdown: 'Nouvel essai dans {seconds} s (tentative {attempt} sur {total})', retryNow: 'Réessayer maintenant', cancel: 'Ne pas réessayer' },
    de: { busyCountdown: 'Der Dienst ist ausgelastet. Neuer Versuch in {seconds} s (Versuch {attempt} von {total})', retryCountdown: 'Neuer Versuch in {seconds} s (Versuch {attempt} von {total})', retryNow: 'Jetzt erneut versuchen', cancel: 'Nicht erneut versuchen' },
    'pt-BR': { busyCountdown: 'O serviço está ocupado. Nova tentativa em {seconds} s (tentativa {attempt} de {total})', retryCountdown: 'Nova tentativa em {seconds} s (tentativa {attempt} de {total})', retryNow: 'Tentar agora', cancel: 'Não tentar de novo' },
    ru: { busyCountdown: 'Сервис перегружен. Повтор через {seconds} с (попытка {attempt} из {total})', retryCountdown: 'Повтор через {seconds} с (попытка {attempt} из {total})', retryNow: 'Повторить сейчас', cancel: 'Не повторять' },
    ar: { busyCountdown: 'الخدمة مشغولة. إعادة المحاولة بعد {seconds} ث (المحاولة {attempt} من {total})', retryCountdown: 'إعادة المحاولة بعد {seconds} ث (المحاولة {attempt} من {total})', retryNow: 'أعد المحاولة الآن', cancel: 'لا تُعِد المحاولة' },
    hi: { busyCountdown: 'सेवा व्यस्त है। {seconds} सेकंड में फिर कोशिश होगी (कोशिश {attempt}/{total})', retryCountdown: '{seconds} सेकंड में फिर कोशिश होगी (कोशिश {attempt}/{total})', retryNow: 'अभी फिर कोशिश करें', cancel: 'फिर कोशिश न करें' }
};

export function autoRetryText(locale: NextMuxDesktopLocale, key: AutoRetryTextKey, values: Readonly<Record<string, string | number>> = {}): string {
    const template = (translations[locale] || en)[key] || en[key];
    return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

export const autoRetryLocales = Object.keys(translations) as readonly NextMuxDesktopLocale[];
