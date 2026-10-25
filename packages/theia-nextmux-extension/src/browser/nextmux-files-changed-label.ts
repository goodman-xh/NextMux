import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * "N files changed" with the CLDR plural category of the reader's language
 * (Intl.PluralRules), so English reads "1 file changed" and Russian picks the
 * one/few/many noun form. Languages without plural nouns use one form.
 */
const FORMS: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<string, string>> & { readonly other: string }>> = {
    en: { one: '{n} file changed', other: '{n} files changed' },
    'zh-CN': { other: '{n} 个文件已修改' },
    'zh-TW': { other: '{n} 個檔案已修改' },
    ja: { other: '{n} 個のファイルを変更' },
    ko: { other: '{n}개 파일 변경' },
    es: { one: '{n} archivo modificado', other: '{n} archivos modificados' },
    fr: { one: '{n} fichier modifié', other: '{n} fichiers modifiés' },
    de: { one: '{n} Datei geändert', other: '{n} Dateien geändert' },
    'pt-BR': { one: '{n} arquivo alterado', other: '{n} arquivos alterados' },
    ru: { one: '{n} файл изменён', few: '{n} файла изменено', many: '{n} файлов изменено', other: '{n} файла изменено' },
    ar: { zero: 'لا ملفات معدّلة', one: 'ملف واحد معدّل', two: 'ملفان معدّلان', few: '{n} ملفات معدّلة', many: '{n} ملفًا معدّلًا', other: '{n} ملف معدّل' },
    hi: { one: '{n} फ़ाइल बदली गई', other: '{n} फ़ाइलें बदली गईं' }
};

export function filesChangedLabel(locale: NextMuxDesktopLocale, count: number): string {
    const forms = FORMS[locale] || FORMS.en;
    let category = 'other';
    try { category = new Intl.PluralRules(locale).select(count); } catch { /* keep "other" */ }
    return (forms[category] || forms.other).replace('{n}', String(count));
}
