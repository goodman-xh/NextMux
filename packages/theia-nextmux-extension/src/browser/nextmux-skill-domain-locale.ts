import type { DomainMessage } from '../common/nextmux-domain-errors';
import type { SkillDomainCode } from '../common/nextmux-skill-domain';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import translations from './nextmux-skill-domain-translations.json';

const locales: readonly NextMuxDesktopLocale[] = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
/** Only codes select templates. External descriptions, names and technical details are never translated. */
export function skillDomainMessage(locale: NextMuxDesktopLocale, message: DomainMessage): string | undefined {
    if (!Object.prototype.hasOwnProperty.call(translations, message.code)) return undefined;
    const row = translations[message.code as SkillDomainCode];
    return row[locales.indexOf(locale)].replace(/\{(\w+)\}/g, (placeholder, key: string) =>
        message.params?.[key] === undefined ? placeholder : String(message.params[key]));
}
