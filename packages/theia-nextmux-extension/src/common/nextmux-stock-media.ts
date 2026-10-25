/** Free stock libraries used by “topic to video” (see node/nextmux-stock-media.ts). */
export type StockMediaProvider = 'pexels' | 'pixabay';
export const STOCK_MEDIA_PROVIDERS: readonly StockMediaProvider[] = ['pexels', 'pixabay'];

export const STOCK_MEDIA_SITES: Readonly<Record<StockMediaProvider, { readonly name: string; readonly keyPage: string; readonly license: string }>> = {
    pexels: { name: 'Pexels', keyPage: 'https://www.pexels.com/api/new/', license: 'https://www.pexels.com/license/' },
    pixabay: { name: 'Pixabay', keyPage: 'https://pixabay.com/api/docs/', license: 'https://pixabay.com/service/license-summary/' },
};

export interface StockMediaState {
    readonly providers: Readonly<Record<StockMediaProvider, { readonly configured: boolean }>>;
}

export interface FillComicShotsWithStockRequest {
    readonly workspaceRoot: string;
    readonly provider: StockMediaProvider;
    /** Pictures or clips; clips fall back to pictures when a shot finds none. */
    readonly kind: 'image' | 'video';
    readonly locale?: string;
    readonly shots: readonly {
        readonly sceneId: string;
        readonly shotId: string;
        readonly query: string;
        readonly fallbackQuery?: string;
        readonly seconds: number;
    }[];
}

export interface FillComicShotsWithStockResult {
    readonly domainError?: import('./nextmux-domain-errors').DomainMessage;
    readonly state: import('./nextmux-platform-protocol').DesktopComicProjectState;
    readonly filled: number;
    readonly missing: number;
    /** Why the rest stopped (bad key, rate limit, network); the filled shots are kept. */
    readonly error?: string;
}

/** The first clause of an English picture prompt makes a good stock query (“Rainy city street at night”). */
export function stockQueryFromPrompt(prompt: string, fallback = ''): string {
    let clause = prompt.replace(/\s+/g, ' ').trim().split(/[.,;:!?(\n]/)[0].trim();
    // “Close-up of a …”, “A wide shot of the …”: drop framing words and articles, however they stack.
    for (let pass = 0; pass < 4; pass++) clause = clause.replace(/^(an?|the|close-?up of|extreme close-?up of|wide shot of|medium shot of|photo of|picture of|image of)\s+/i, '');
    const words = clause.split(' ').filter(Boolean).slice(0, 8).join(' ');
    return (words.length >= 3 ? words : fallback).slice(0, 100);
}


/** Planner-supplied English terms avoid treating an entire unspaced Chinese sentence as a stock query. */
export function stockQueryFromShot(shot: { readonly searchTerms?: readonly string[]; readonly visualPrompt: string; readonly title?: string }): string {
    const terms = (shot.searchTerms || []).flatMap(term => term.trim().split(/\s+/)).filter(term => /^[a-z][a-z0-9'-]*$/i.test(term));
    const unique = [...new Set(terms.map(term => term.toLowerCase()))].slice(0, 6);
    return unique.length >= 3 ? unique.join(' ') : stockQueryFromPrompt(shot.visualPrompt, shot.title || '');
}
