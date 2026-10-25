/**
 * Which media models make their output from a text prompt alone. The conversation mode (漫剧对话) sends text and
 * optional pictures; a model that cannot start without a picture, a clip or a song (image-to-video, an image editor,
 * a lip-sync or cover model) is left out of its model list. The platform classifies relay models the same way
 * (apps/cloudflare-platform/src/model-taxonomy.js); for the user's own APIs and older catalog rows the model name and
 * declared input decide here.
 */

export type TextMediaKind = 'image' | 'video' | 'music';

/** Names of models that need a picture, a clip or a voice to start from. */
const NEEDS_INPUT: Readonly<Record<TextMediaKind, RegExp>> = {
    video: /(^|[-_/.\s])(i2v|img2vid|image-?to-?video|flf2v|first-?last(-?frame)?|r2v|reference-?to-?video|s2v|lip-?sync|avatar|digital-?human|talking-?head|v2v|video-?to-?video|video-?extend|extend|upscale|restyle|motion-?transfer|animate-?anyone)([-_/.\s]|$)/i,
    image: /(edit|kontext|inpaint|outpaint|img2img|(^|[-_/.\s])i2i([-_/.\s]|$)|image-?to-?image|upscal|remove-?bg|background-?remov|face-?swap|try-?on|relight|restor)/i,
    music: /(cover|remix|(^|[-_/.\s])extend([-_/.\s]|$)|stems?([-_/.\s]|$)|separat|vocal-?ref|voice-?clon|audio-?to-?audio|(^|[-_/.\s])a2a([-_/.\s]|$))/i
};

const TEXT_CAPABILITY: Readonly<Record<TextMediaKind, string>> = { video: 'text_to_video', image: 'text_to_image', music: 'text_to_music' };

export interface MediaModelDescription {
    /** The model ID (canonical or provider code). */
    readonly id: string;
    readonly displayName?: string;
    readonly capabilities?: readonly string[];
    /** Declared input modalities; absent is unknown. */
    readonly input?: readonly string[];
}

/** Whether a prompt alone is enough for this model (no required picture, clip or voice). */
export function mediaModelTakesText(kind: TextMediaKind, model: MediaModelDescription): boolean {
    const identity = `${model.id} ${model.displayName || ''}`;
    if (NEEDS_INPUT[kind].test(identity)) return false;
    const input = (model.input || []).map(value => value.toLowerCase());
    if (input.length && !input.includes('text')) return false;
    const capabilities = (model.capabilities || []).map(value => value.toLowerCase());
    // A model classified as needing input only (e.g. image_to_video without text_to_video) is left out.
    if (kind === 'video' && capabilities.includes('image_to_video') && !capabilities.includes('text_to_video') && capabilities.includes('video_generation')) return false;
    if (kind === 'music' && (capabilities.includes('cover') || capabilities.includes('vocal_reference')) && !capabilities.includes('music_generation')) return false;
    return true;
}

export function mediaModelTextCapability(kind: TextMediaKind): string {
    return TEXT_CAPABILITY[kind];
}
