import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Reviewed exact-match labels for the Model Center, Settings, scheduled tasks
 * and the comic workspace. Only labels that must never take part in the
 * surface catalogue's substring fallback live here — single-character badges
 * such as the comic shot's “music” / “sound effect” markers would otherwise be
 * spliced into unrelated words (e.g. “生效”). Keys are the Simplified Chinese
 * source strings; longer sentences belong in the generated catalogue.
 */
type Row = readonly [zhTW: string, en: string, ja: string, ko: string, es: string, fr: string, de: string, ptBR: string, ru: string, ar: string, hi: string];

const rows: Readonly<Record<string, Row>> = {
    // Comic shot asset badges (visual / voice / music / effects / clip).
    '乐': ['樂', 'Music', '音楽', '음악', 'Música', 'Musique', 'Musik', 'Música', 'Музыка', 'موسيقى', 'संगीत'],
    '效': ['效', 'SFX', '効果音', '효과음', 'Efectos', 'Bruitages', 'Effekte', 'Efeitos', 'Эффекты', 'مؤثرات', 'इफ़ेक्ट']
};

const order: readonly NextMuxDesktopLocale[] = ['zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

export const modelsSettingsSurfaceCatalog: Readonly<Partial<Record<NextMuxDesktopLocale, Readonly<Record<string, string>>>>> = Object.fromEntries(
    order.map((locale, index) => [locale, Object.fromEntries(Object.entries(rows).map(([source, row]) => [source, row[index]]))])
);

/** Reviewed exact label, or undefined when the shared catalogue owns the string. */
export function modelsSettingsSurfaceText(locale: NextMuxDesktopLocale, value: string): string | undefined {
    return modelsSettingsSurfaceCatalog[locale]?.[value];
}
