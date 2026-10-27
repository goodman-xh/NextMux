import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/** Code-block chrome in rendered replies (Codex/ChatGPT: a short “Copy” that flips to “Copied”; “Preview” opens a page or diagram in the browser panel). */
const en = { copy: 'Copy', copied: 'Copied', copyCode: 'Copy code', previewInBrowser: 'Preview in browser' } as const;

export type MarkdownTextKey = keyof typeof en;

const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<MarkdownTextKey, string>>>> = {
    en,
    'zh-CN': { copy: '复制', copied: '已复制', copyCode: '复制代码', previewInBrowser: '在浏览器预览' },
    'zh-TW': { copy: '複製', copied: '已複製', copyCode: '複製程式碼', previewInBrowser: '在瀏覽器預覽' },
    ja: { copy: 'コピー', copied: 'コピーしました', copyCode: 'コードをコピー', previewInBrowser: 'ブラウザでプレビュー' },
    ko: { copy: '복사', copied: '복사됨', copyCode: '코드 복사', previewInBrowser: '브라우저에서 미리보기' },
    es: { copy: 'Copiar', copied: 'Copiado', copyCode: 'Copiar código', previewInBrowser: 'Ver en el navegador' },
    fr: { copy: 'Copier', copied: 'Copié', copyCode: 'Copier le code', previewInBrowser: 'Aperçu dans le navigateur' },
    de: { copy: 'Kopieren', copied: 'Kopiert', copyCode: 'Code kopieren', previewInBrowser: 'Im Browser anzeigen' },
    'pt-BR': { copy: 'Copiar', copied: 'Copiado', copyCode: 'Copiar código', previewInBrowser: 'Ver no navegador' },
    ru: { copy: 'Копировать', copied: 'Скопировано', copyCode: 'Копировать код', previewInBrowser: 'Открыть в браузере' },
    ar: { copy: 'نسخ', copied: 'تم النسخ', copyCode: 'نسخ الرمز', previewInBrowser: 'معاينة في المتصفح' },
    hi: { copy: 'कॉपी करें', copied: 'कॉपी हो गया', copyCode: 'कोड कॉपी करें', previewInBrowser: 'ब्राउज़र में देखें' }
};

function uncheckedMarkdownText(locale: NextMuxDesktopLocale, key: MarkdownTextKey): string {
    return (translations[locale] || en)[key] || en[key];
}

export const markdownLocales = Object.keys(translations) as readonly NextMuxDesktopLocale[];

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function markdownText(locale: Parameters<typeof uncheckedMarkdownText>[0], key: Parameters<typeof uncheckedMarkdownText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedMarkdownText>>): string {
    return totalCopy(locale, key, language => uncheckedMarkdownText(language, key, ...rest));
}
