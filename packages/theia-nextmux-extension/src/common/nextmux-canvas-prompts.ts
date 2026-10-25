import { ComicPromptTranslationCache, comicPromptUsesChinese } from './nextmux-comic-prompts';
import type { ComicPromptTranslator } from './nextmux-comic-prompts';
import { videoModelGuide } from './nextmux-video-model-guide';
import type { VideoModelGuide } from './nextmux-video-model-guide';

export class CanvasPromptError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'CanvasPromptError'; }
}

export interface CanvasVideoPromptPreparation {
    readonly prompt: string;
    readonly negativePrompt?: string;
    readonly modelId: string;
    /** Include route identity here so translations are scoped to the selected planning route. */
    readonly cacheKey: string;
    readonly cache?: ComicPromptTranslationCache;
    readonly guide?: Pick<VideoModelGuide, 'promptLanguage' | 'maxPromptChars'>;
    /** Set only when the adapter embeds its avoid list into the provider's prompt field. */
    readonly negativePromptInPrompt?: boolean;
    /** Gemini's non-template adapter uses "Negative prompt: " instead of "Avoid: ". */
    readonly negativePromptLabel?: string;
}

const NON_LATIN_LETTER = /[^\p{Script=Latin}]\p{M}*/u;
function needsEnglish(text: string): boolean {
    return (text.replace(/__NEXTMUX_QUOTE_\d+__+/g, '').match(/\p{L}/gu) || []).some(letter => NON_LATIN_LETTER.test(letter));
}

/**
 * The node owns editable production text, so keep every authored field rather than rebuilding a shot from
 * hidden project metadata. Language preparation reuses the desk's translator and output validation. The
 * returned prompt is frozen in the generation snapshot before a media job can be accepted or paid.
 */
export async function prepareCanvasVideoPrompt(input: CanvasVideoPromptPreparation, translate?: ComicPromptTranslator): Promise<{ readonly prompt: string; readonly negativePrompt?: string }> {
    const guide = input.guide || videoModelGuide(input.modelId);
    const quotes: { readonly token: string; readonly text: string }[] = [];
    const source = `${input.prompt}\n${input.negativePrompt || ''}`;
    const protect = (text: string): string => text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|«[^»]*»|‘[^’]*’|"[^"\r\n]*"/g, match => {
        let token = `__NEXTMUX_QUOTE_${quotes.length}__`;
        while (source.includes(token)) token += '_';
        quotes.push({ token, text: match });
        return token;
    });
    const fields = { prompt: protect(input.prompt), negative: protect(input.negativePrompt || '') };
    let prepared = fields;
    if (guide.promptLanguage === 'en' && Object.values(fields).some(needsEnglish)) {
        if (!translate) throw new CanvasPromptError('CANVAS_PROMPT_TRANSLATION_REQUIRED', 'The selected video model requires English production instructions. Select the project text route to translate this prompt before generating.');
        const translated = await (input.cache || new ComicPromptTranslationCache()).translate(input.cacheKey, fields,
            request => translate({ ...request, system: `${request.system} Preserve every __NEXTMUX_QUOTE token exactly; it holds original-language text and must not be translated.` }));
        prepared = { prompt: translated.prompt, negative: translated.negative };
    }
    const restore = (text: string): string => quotes.reduce((value, quote) => value.split(quote.token).join(quote.text), text);
    let prompt = restore(prepared.prompt);
    const negative = restore(prepared.negative);
    if (input.negativePromptInPrompt && negative.trim()) {
        const label = input.negativePromptLabel ?? (comicPromptUsesChinese(guide, prompt) ? '避免：' : 'Avoid: ');
        prompt = `${prompt}\n\n${label}${negative.trim()}`;
    }
    // Every part of a canvas prompt is editable user input; none can be silently discarded to fit a limit.
    if (guide.maxPromptChars > 0 && prompt.length > guide.maxPromptChars) {
        throw new CanvasPromptError('CANVAS_PROMPT_TOO_LONG', `The prepared prompt needs ${prompt.length} characters; the selected video model accepts ${guide.maxPromptChars}. Shorten the prompt or split the shot before generating.`);
    }
    return { prompt, ...(!input.negativePromptInPrompt && negative ? { negativePrompt: negative } : {}) };
}
