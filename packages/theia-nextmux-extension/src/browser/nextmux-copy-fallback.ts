/**
 * Text lookups must never break a render. A lookup that threw (语音转文字 had no step_* title, and the helper called
 * `.replace` on undefined) unmounted the whole window and left it blank. Every `(locale, key, …)` text helper runs
 * through `totalCopy`: a key missing in this language falls back to English, and a key missing everywhere shows as
 * itself (reported once in the console) — the page keeps working either way. test/copy-lookups.test.mjs calls every
 * such helper with an unknown key in every language.
 */

const reported = new Set<string>();

/** The parameters after `(locale, key)`, so a wrapper keeps its helper's signature. */
export type AfterLocaleAndKey<T extends readonly unknown[]> = T extends readonly [unknown, unknown, ...infer Rest] ? Rest : [];

export function totalCopy<L>(locale: L, key: unknown, lookup: (locale: L) => unknown): string {
    for (const language of locale === 'en' ? ['en'] : [locale, 'en']) {
        try {
            const text = lookup(language as L);
            if (typeof text === 'string') return text;
        } catch { /* the next language, then the key itself */ }
    }
    const name = String(key);
    if (!reported.has(name)) {
        reported.add(name);
        console.warn(`[nextmux] no text for "${name}" (${String(locale)})`);
    }
    return name;
}
