/**
 * Local classification for own-API models (a user's own keys, kept on this computer).
 *
 * Own APIs never go through the cloud relay catalogue: what a model is comes from what this API
 * itself reported when its model list was read on this computer (output modalities), with
 * narrowly verified identity corrections for known bad declarations. Missing data can use the public catalog.
 */

import { knownModelTaskCorrection, modelTaskCategories, type ModelTaskMetadata } from '@nextmux/model-runtime/model-task-capabilities';
import { modelNameForms } from '../common/nextmux-model-name';

export type OwnModelKind = 'llm' | '3d' | 'image' | 'video' | 'speech' | 'music' | 'transcription' | 'sound_effect' | 'decision' | 'embedding' | 'rerank' | 'moderation' | 'other';
export const OWN_MODEL_KINDS: readonly OwnModelKind[] = ['llm', '3d', 'image', 'video', 'speech', 'music', 'transcription', 'sound_effect', 'decision', 'embedding', 'rerank', 'moderation', 'other'];

export interface OwnModelFacts extends ModelTaskMetadata {
    readonly id: string;
    readonly label?: string;
    readonly inputModalities?: readonly string[];
    readonly outputModalities?: readonly string[];
}

/** Music model names (“udio” only as a name of its own: “gpt-audio” is a voice model, not Udio). */
const MUSIC_NAME = /lyria|music|suno|(?:^|[\s/_.-])udio(?:$|[\s/_.-])|(?:^|[\s/_.-])song(?:$|[\s/_.-])/;

// The same name evidence and order as model-runtime's model-taxonomy.ts NAME_RULES (plus moderation, and Wan picture
// models ahead of the Wan video rule because this list also tests dashed spellings of each id): Alibaba's
// "wan2.1-t2v-turbo" is a video model and "wanx2.1-t2i-turbo" a picture model; ElevenLabs' "eleven_text_to_sound_v2"
// is a sound effect, matched before the "eleven_" voice rule that catches "eleven_multilingual_v2".
const NAME_RULES: readonly [OwnModelKind, RegExp][] = [
    ['rerank', /rerank/],
    ['moderation', /moderation|guard/],
    ['embedding', /embed|(^|[/_-])(bge|gte|e5)([/_-]|$)/],
    ['transcription', /whisper|transcri|(^|[/_-])(asr|stt)([/_-]|$)|chirp|paraformer|sensevoice/],
    ['music', MUSIC_NAME],
    ['sound_effect', /sound[\s_-]?effect|text[\s_-]?to[\s_-]?sound|(^|[/_-])sfx([/_-]|$)/],
    // Before the "wan-<n>" video rule: the dashed spelling of "wan2.2-t2i-flash" ("wan-2.2-t2i-flash") is a picture model.
    ['image', /(^|[/_-])wanx?-?\d+(\.\d+)?-(t2i|i2i|image)/],
    ['speech', /(^|[/_-])(tts|speech|voice)([/_-]|$)|^tts|aura-|orpheus|fish-audio|elevenlabs|(^|\/)eleven_|cosyvoice|minimax-speech|audio-tts/],
    ['video', /veo-|sora|kling|(^|[/_-])wan-\d|(^|[/_-])wanx?\d+(\.\d+)?-(t2v|i2v|kf2v|s2v|r2v|vace|animate)|(^|[/_-])[ti]2v([/_.-]|$)|hailuo|seedance|runway[-/]gen[34]|pixverse|vidu|video|ltx-|mochi|happyhorse/],
    ['image', /dall-e|gpt-image|imagen|flux|sdxl|stable-diffusion|seedream|recraft|midjourney|ideogram|qwen-image|(^|[/_-])wanx?\d+(\.\d+)?-(t2i|i2i|image)|-image(-|$)|image-\d/],
    ['3d', /trellis|hunyuan[-_]?3d|tripo[-_]?3d|triposr|meshy|rodin[-_]?3d|point-e|shap-e|zero123|(^|[/_-])3d([/_-]|$)/],
];

/** `catalog`: the public-directory entry this id names (nextmux-own-model-match); used only when the API reported nothing. */
export function ownModelKind(model: OwnModelFacts, catalog?: ModelTaskMetadata): OwnModelKind {
    const correction = knownModelTaskCorrection(model);
    if (correction) return correction;
    const reported = model.outputModalities || [];
    if (!reported.length && catalog?.kind && OWN_MODEL_KINDS.includes(catalog.kind as OwnModelKind)) return (knownModelTaskCorrection(catalog) || catalog.kind) as OwnModelKind;
    const output = (reported.length ? reported : (Array.isArray(catalog?.output) ? catalog.output : [])).map(value => value.toLowerCase());
    const name = `${model.id} ${model.label || ''}`.toLowerCase();
    if (output.length) {
        if (catalog?.kind === 'llm' && output.includes('text') && !output.some(value => ['decisions', 'decision', 'rerank', 'embedding', 'embeddings', 'moderation', 'transcription'].includes(value))) return 'llm';
        if (output.includes('decisions') || output.includes('decision')) return 'decision';
        if (output.includes('rerank')) return 'rerank';
        if (output.includes('moderation')) return 'moderation';
        if (output.includes('sound_effect')) return 'sound_effect';
        if (output.includes('video')) return 'video';
        if (output.includes('transcription')) return 'transcription';
        if (output.some(value => value === 'embeddings' || value === 'embedding')) return 'embedding';
        if (output.includes('speech')) return 'speech';
        if (output.includes('image')) return 'image';
        if (output.includes('3d')) return '3d';
        if (output.includes('audio')) return MUSIC_NAME.test(name) ? 'music' : output.includes('text') ? 'llm' : 'speech';
        if (output.includes('text')) return /rerank/.test(name) ? 'rerank' : /moderation|guard/.test(name) ? 'moderation' : /trellis|hunyuan[-_]?3d|tripo[-_]?3d|triposr|meshy|rodin[-_]?3d|point-e|shap-e|zero123|(^|[/_-])3d([/_-]|$)/.test(name) ? '3d' : 'llm';
    }
    if (/^deepgram\/nova(?:[-/]|$)/i.test(model.id)) return 'transcription';
    // Every spelling of the id (relays write "video_wan_3.0", "Wan 3.0" …), then the label.
    const names = [...modelNameForms(model.id), (model.label || '').toLowerCase()].filter(Boolean);
    for (const [kind, rule] of NAME_RULES) if (rule.test(name) || names.some(form => rule.test(form))) return kind;
    return 'llm';
}

/** What the comic studio needs to know about a media model, derived locally. */
export function ownModelMediaFacts(model: OwnModelFacts, catalog?: ModelTaskMetadata): { readonly output: readonly string[]; readonly capabilities: readonly string[] } | undefined {
    const kind = ownModelKind(model, catalog);
    const input = (model.inputModalities || []).map(value => value.toLowerCase());
    if (kind === 'image') return { output: ['image'], capabilities: ['image_generation', 'text_to_image'] };
    if (kind === 'video') return { output: ['video'], capabilities: ['video_generation', 'text_to_video', ...(input.includes('image') || !input.length ? ['image_to_video'] : [])] };
    if (kind === 'speech') return { output: ['speech'], capabilities: ['text_to_speech'] };
    if (kind === 'music') return { output: ['audio'], capabilities: ['music_generation'] };
    return undefined;
}

/** Independent display groups; route adapters and validation remain responsible for execution. */
export function ownModelCategories(model: OwnModelFacts, catalog?: ModelTaskMetadata): readonly OwnModelKind[] {
    const kind = ownModelKind(model, catalog);
    return modelTaskCategories({ ...model, kind,
        output: model.outputModalities?.length ? model.outputModalities : catalog?.output,
        capabilities: model.capabilities ?? (model.outputModalities?.length ? undefined : catalog?.capabilities)
    }).map(task => task === 'language' ? 'llm' : task);
}
