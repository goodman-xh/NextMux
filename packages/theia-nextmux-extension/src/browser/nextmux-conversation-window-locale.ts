import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const labels: Record<NextMuxDesktopLocale, readonly [string, string, string]> = {
    'zh-CN': ['收回小窗', '收回所有小窗', '无法收回小窗，请重试'],
    'zh-TW': ['收回小視窗', '收回所有小視窗', '無法收回小視窗，請重試'],
    en: ['Detached windows', 'Return all windows', 'Could not return windows. Please retry.'],
    ja: ['独立ウィンドウ', 'すべてのウィンドウを戻す', 'ウィンドウを戻せませんでした。再試行してください。'],
    ko: ['분리된 창', '모든 창 되돌리기', '창을 되돌리지 못했습니다. 다시 시도하세요.'],
    es: ['Ventanas independientes', 'Reintegrar todas las ventanas', 'No se pudieron reintegrar las ventanas. Reinténtalo.'],
    fr: ['Fenêtres détachées', 'Réintégrer toutes les fenêtres', 'Impossible de réintégrer les fenêtres. Réessayez.'],
    de: ['Separate Fenster', 'Alle Fenster zurückholen', 'Fenster konnten nicht zurückgeholt werden. Bitte erneut versuchen.'],
    'pt-BR': ['Janelas separadas', 'Reintegrar todas as janelas', 'Não foi possível reintegrar as janelas. Tente novamente.'],
    ru: ['Отдельные окна', 'Вернуть все окна', 'Не удалось вернуть окна. Повторите попытку.'],
    ar: ['النوافذ المنفصلة', 'إعادة جميع النوافذ', 'تعذرت إعادة النوافذ. حاول مجددًا.'],
    hi: ['अलग विंडो', 'सभी विंडो वापस लाएँ', 'विंडो वापस नहीं लाई जा सकीं। फिर से कोशिश करें।']
};

function uncheckedConversationWindowText(locale: NextMuxDesktopLocale, key: 'windows' | 'returnAll' | 'failed'): string {
    return labels[locale][key === 'windows' ? 0 : key === 'returnAll' ? 1 : 2];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function conversationWindowText(locale: Parameters<typeof uncheckedConversationWindowText>[0], key: Parameters<typeof uncheckedConversationWindowText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedConversationWindowText>>): string {
    return totalCopy(locale, key, language => uncheckedConversationWindowText(language, key, ...rest));
}
