/**
 * Fuzzy voice commands for the comic editor ("往回倒一点", "下一个镜头",
 * "go back a bit"). Exact commands are parsed locally with no latency; only
 * what the local parser cannot read is sent to a decision model (TypeSafe
 * Jev through the user's own OpenRouter key), which picks one intent from a
 * fixed list in a single pass instead of generating text.
 */
export const COMIC_VOICE_INTENTS = {
    play: 'Start or resume playback',
    pause: 'Pause or stop playback',
    rewind_small: 'Go back a little (a few seconds)',
    forward_small: 'Skip ahead a little (a few seconds)',
    restart: 'Go back to the beginning of the episode',
    previous_shot: 'Go to the previous shot',
    next_shot: 'Go to the next shot',
    previous_episode: 'Go to the previous episode',
    next_episode: 'Go to the next episode',
    replay_shot: 'Watch the current shot again from its start',
    visual_edit: 'Change how something looks: a character, costume, background, lighting, colour, camera or action',
    none: 'Anything else, or not an editor command'
} as const;

export type ComicVoiceIntent = keyof typeof COMIC_VOICE_INTENTS;

export interface ClassifyComicVoiceIntentRequest {
    readonly transcript: string;
}

export interface ClassifyComicVoiceIntentResult {
    readonly intent: ComicVoiceIntent;
    readonly confidence: number;
    readonly latencyMs: number;
}

/** Minimum confidence before an intent may drive playback or open an edit. */
export const COMIC_VOICE_INTENT_THRESHOLD = 0.6;

export function isComicVoiceIntent(value: unknown): value is ComicVoiceIntent {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COMIC_VOICE_INTENTS, value);
}

/** Finds the choice decision in a Decisions API response, whatever envelope it arrives in. */
export function readVoiceIntentDecision(payload: unknown): { readonly intent: ComicVoiceIntent; readonly confidence: number } | undefined {
    const seen = new Set<unknown>();
    const visit = (value: unknown, depth: number): { readonly intent: ComicVoiceIntent; readonly confidence: number } | undefined => {
        if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return undefined;
        seen.add(value);
        const record = value as Record<string, unknown>;
        if (record.type === 'choice' && isComicVoiceIntent(record.choice)) {
            const confidence = typeof record.confidence === 'number' ? record.confidence
                : typeof (record.probabilities as Record<string, unknown> | undefined)?.[record.choice as string] === 'number'
                    ? (record.probabilities as Record<string, number>)[record.choice as string] : 0;
            return { intent: record.choice, confidence: Math.max(0, Math.min(1, confidence)) };
        }
        for (const child of Object.values(record)) {
            const found = visit(child, depth + 1);
            if (found) return found;
        }
        return undefined;
    };
    return visit(payload, 0);
}
