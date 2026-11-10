import type { PublicMerchantIdentity } from '../common/nextmux-public-merchants';
import type { ComicStepCapability } from './nextmux-comic-step-models';

// Since 2026-11-10 a relay drawer lists only the relays and own APIs that have models for what it was opened for: the
// coding workbench, or one function of the 漫剧 workbench (剧本 and the agent are 'text'). A relay with none is not
// listed at all, neither as a row nor as a disabled one (scapi, pictures and video only, was a row in coding).

/** What a relay drawer is opened for. */
export type RelayDrawerCategory = 'coding' | ComicStepCapability;

// The platform tags models by what they make. A directory row folds speech, music and sound effects into 'audio',
// so these tell the three apart.
const IMAGE = /^(?:image_generation|text_to_image|image_editing|image_to_image)$/;
const VIDEO = /^(?:video_generation|text_to_video|image_to_video|reference_to_video)$/;
const SPEECH = /^(?:speech|speech_generation|speech_synthesis|text_to_speech|tts|voice_cloning)$/;
const MUSIC = /^(?:music|music_generation|text_to_music)$/;
const SOUND_EFFECT = /^(?:sound_effect|sound_effect_generation)$/;
const TRANSCRIPTION = /^(?:transcription|speech_to_text)$/;

/**
 * What a public directory row says about one category, by the platform's own directory filters
 * (public-merchant-ranking.js): coding needs an executable model with tools; pictures and video, a model that outputs
 * them; sound is told apart by the models' tags. Undefined when the row lists no output and no capability: a store
 * with no executable model, or a platform from before these fields.
 */
export function directoryRowServes(merchant: Pick<PublicMerchantIdentity, 'outputCategories' | 'capabilities'>, category: RelayDrawerCategory): boolean | undefined {
    const outputs = merchant.outputCategories ?? [];
    const capabilities = (merchant.capabilities ?? []).map(value => value.toLowerCase());
    if (!outputs.length && !capabilities.length) return undefined;
    const tagged = (pattern: RegExp): boolean => capabilities.some(value => pattern.test(value));
    // A row answers by the outputs it lists; one that lists none, by its models' tags.
    const makes = (output: string, pattern: RegExp): boolean => outputs.length ? outputs.includes(output) : tagged(pattern);
    const sounds = !outputs.length || outputs.some(output => ['audio', 'speech', 'music', 'sound_effect'].includes(output));
    switch (category) {
        // Text among the outputs proves nothing here: a Gemini picture model answers in text too (scapi).
        case 'coding': case 'text': return capabilities.length ? capabilities.includes('tools') : outputs.includes('text');
        case 'image': return makes('image', IMAGE);
        case 'video': return makes('video', VIDEO);
        case 'music': return sounds && (tagged(MUSIC) || outputs.includes('music'));
        case 'sound_effect': return sounds && (tagged(SOUND_EFFECT) || outputs.includes('sound_effect'));
        // Speech is the sound a row makes when nothing tags it as music or a sound effect.
        case 'speech': return outputs.includes('speech') || tagged(SPEECH) || outputs.includes('audio') && !tagged(MUSIC) && !tagged(SOUND_EFFECT);
        case 'transcription': return tagged(TRANSCRIPTION) || outputs.includes('transcription');
    }
}

/** What a window knows about one relay and one category. */
export interface RelayCategoryEvidence {
    /** It offers models of this category here: in the catalog, its loaded pages, or (own APIs) its routes. */
    readonly models: boolean;
    /** Its own model list is loaded in full, so a model it lacks is not there. */
    readonly catalogComplete?: boolean;
    /** A directory read filtered to this category lists it. */
    readonly listedForCategory?: boolean;
    /** Its public directory row, when one is held. */
    readonly row?: Pick<PublicMerchantIdentity, 'outputCategories' | 'capabilities'>;
}

/**
 * Whether a relay has models for a category: models here say yes; its full list without one says no; then a directory
 * read for the category, then its row. Undefined when nothing tells: a drawer keeps such a relay (a favorite whose
 * directory is not back yet, or one delisted, whose row says why it cannot be chosen); only a verdict moves a selection.
 */
export function relayCategoryVerdict(evidence: RelayCategoryEvidence, category: RelayDrawerCategory): boolean | undefined {
    if (evidence.models) return true;
    if (evidence.catalogComplete) return false;
    if (evidence.listedForCategory) return true;
    return evidence.row ? directoryRowServes(evidence.row, category) : undefined;
}
