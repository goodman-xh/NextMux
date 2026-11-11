/**
 * Local classification for own-API models (a user's own keys, kept on this computer).
 *
 * Own APIs never go through the cloud relay catalogue: what a model is comes from what this API
 * itself reported when its model list was read on this computer (output modalities), with
 * narrowly verified identity corrections for known bad declarations. Missing data can use the public catalog.
 */

import { knownModelTaskCorrection, modelTaskCategories, type ModelTaskMetadata } from '@nextmux/model-runtime/model-task-capabilities';
import { MODEL_NAME_PATTERNS } from '@nextmux/model-runtime/model-taxonomy';
import { modelNameForms } from '../common/nextmux-model-name';

export type OwnModelKind = 'llm' | '3d' | 'image' | 'video' | 'speech' | 'music' | 'transcription' | 'sound_effect' | 'decision' | 'embedding' | 'rerank' | 'moderation' | 'other';
export const OWN_MODEL_KINDS: readonly OwnModelKind[] = ['llm', '3d', 'image', 'video', 'speech', 'music', 'transcription', 'sound_effect', 'decision', 'embedding', 'rerank', 'moderation', 'other'];

export interface OwnModelFacts extends ModelTaskMetadata {
    readonly id: string;
    readonly label?: string;
    readonly inputModalities?: readonly string[];
    readonly outputModalities?: readonly string[];
}

/** Music model names (“udio” only as a name of its own: “gpt-audio” is a voice model, not Udio); Stable Audio is music. */
const MUSIC_NAME = MODEL_NAME_PATTERNS.music;

// The shared name evidence (model-runtime's model-taxonomy.ts MODEL_NAME_PATTERNS, the server classifier's identity
// patterns) in the order this classifier tests it, plus moderation, and Wan picture models ahead of the Wan video rule
// because this list also tests dashed spellings of each id: Alibaba's "wan2.1-t2v-turbo" is a video model and
// "wanx2.1-t2i-turbo" a picture model; ElevenLabs' "eleven_text_to_sound_v2" is a sound effect, matched before the
// "eleven_" voice rule that catches "eleven_multilingual_v2". A bare id the API reported nothing for lands where the
// cloud classifier puts it: Nano Banana, Jimeng and "wanx-v1" draw, Stable Audio is music (before sound effects), MMAudio
// a sound effect, Sambert and Kling's voice/TTS ids speak (before the Kling video rule), "4sdance_2.5" and
// "video-subtitle-pro" make video.
const NAME_RULES: readonly [OwnModelKind, RegExp][] = [
    ['decision', MODEL_NAME_PATTERNS.decision],
    ['rerank', MODEL_NAME_PATTERNS.rerank],
    ['moderation', /moderation|guard/],
    ['embedding', MODEL_NAME_PATTERNS.embedding],
    ['transcription', MODEL_NAME_PATTERNS.transcription],
    ['music', MUSIC_NAME],
    ['sound_effect', MODEL_NAME_PATTERNS.sound_effect],
    // Before the "wan-<n>" video rule: the dashed spelling of "wan2.2-t2i-flash" ("wan-2.2-t2i-flash") is a picture model.
    ['image', /(^|[/_-])wanx?-?\d[\d.]*[-_](?:t2i|i2i|imageedit|image)|(^|[/_-])wanx-v\d/],
    ['speech', MODEL_NAME_PATTERNS.speech],
    ['video', MODEL_NAME_PATTERNS.video],
    ['image', MODEL_NAME_PATTERNS.image],
    ['3d', MODEL_NAME_PATTERNS['3d']],
];

/** `catalog`: the public-directory entry this id names (nextmux-own-model-match); used only when the API reported nothing. */
export function ownModelKind(model: OwnModelFacts, catalog?: ModelTaskMetadata): OwnModelKind {
    const correction = knownModelTaskCorrection(model);
    if (correction) return correction;
    const reported = model.outputModalities || [];
    const capabilities = (Array.isArray(model.capabilities) ? model.capabilities : (!reported.length && Array.isArray(catalog?.capabilities) ? catalog.capabilities : []))
        .map(value => String(value).toLowerCase().replace(/[\s-]+/g, '_'));
    if (!reported.length && !(Array.isArray(model.capabilities) && model.capabilities.length) && catalog?.kind && OWN_MODEL_KINDS.includes(catalog.kind as OwnModelKind)) {
        return (knownModelTaskCorrection(catalog) || catalog.kind) as OwnModelKind;
    }
    const output = (reported.length ? reported : (Array.isArray(catalog?.output) ? catalog.output : [])).map(value => value.toLowerCase());
    const name = `${model.id} ${model.label || ''}`.toLowerCase();
    if (output.length) {
        if (catalog?.kind === 'llm' && output.includes('text')
            && !output.some(value => ['decisions', 'decision', 'rerank', 'embedding', 'embeddings', 'moderation', 'transcription', 'music', 'sound_effect'].includes(value))
            && !capabilities.some(cap => cap === 'music_generation' || cap === 'sound_effect_generation')) return 'llm';
        if (output.includes('decisions') || output.includes('decision')) return 'decision';
        if (output.includes('rerank')) return 'rerank';
        if (output.includes('moderation')) return 'moderation';
        if (output.includes('sound_effect')) return 'sound_effect';
        if (output.includes('music')) return 'music';
        if (output.includes('video')) return 'video';
        if (output.includes('transcription')) return 'transcription';
        if (output.some(value => value === 'embeddings' || value === 'embedding')) return 'embedding';
        if (output.includes('speech')) return 'speech';
        if (output.includes('image')) return 'image';
        if (output.includes('3d')) return '3d';
        if (output.includes('audio')) {
            if (MUSIC_NAME.test(name) || capabilities.includes('music_generation')) return 'music';
            if (MODEL_NAME_PATTERNS.sound_effect.test(name) || capabilities.includes('sound_effect_generation') || capabilities.includes('text_to_sound_effect')) return 'sound_effect';
            return output.includes('text') ? 'llm' : 'speech';
        }
        if (output.includes('text')) return /rerank/.test(name) ? 'rerank' : /moderation|guard/.test(name) ? 'moderation' : MODEL_NAME_PATTERNS['3d'].test(name) ? '3d' : 'llm';
    }
    if (capabilities.includes('music_generation')) return 'music';
    if (capabilities.includes('sound_effect_generation') || capabilities.includes('text_to_sound_effect')) return 'sound_effect';
    if (capabilities.includes('video_generation') || capabilities.includes('text_to_video')) return 'video';
    if (capabilities.includes('image_generation') || capabilities.includes('text_to_image')) return 'image';
    if (capabilities.includes('speech_generation') || capabilities.includes('text_to_speech')) return 'speech';
    if (capabilities.includes('decision')) return 'decision';
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
    if (kind === 'sound_effect') return { output: ['audio'], capabilities: ['sound_effect_generation', 'text_to_sound_effect'] };
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
