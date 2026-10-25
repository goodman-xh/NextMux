import { knownModelTaskCorrection, modelTaskCategories, type ModelTaskMetadata } from './model-task-capabilities.js';

/** Preserve provider modality declarations; an empty discovery array has no evidence. */
export function effectiveModelModalities(discovered: unknown, registry: unknown): string[] {
    const parse = (value: unknown): string[] => {
        if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
        return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))] : [];
    };
    const declared = parse(discovered);
    return declared.length ? declared : parse(registry);
}

export type MerchantOutputCategory = 'text' | 'image' | 'video' | 'audio';

/** Compact merchant labels group generated speech/music/effects into audio. */
export function merchantOutputCategories(output: readonly string[] | null | undefined): MerchantOutputCategory[] {
    const categories = (output || []).map(value => ['speech', 'music', 'sound_effect'].includes(value) ? 'audio' : value)
        .filter((value): value is MerchantOutputCategory => ['text', 'image', 'video', 'audio'].includes(value));
    return [...new Set(categories)];
}

export type MerchantModelCategory = 'language' | 'image' | 'video' | 'audio' | 'others';

/** Browse categories follow the known model kind; old catalogs retain their output-only fallback. */
export function merchantModelCategory(model: ModelTaskMetadata): MerchantModelCategory {
    switch (knownModelTaskCorrection(model) || model.kind) {
        case 'llm': case '3d': return 'language';
        case 'image': return 'image';
        case 'video': return 'video';
        case 'audio': case 'speech': case 'music': case 'sound_effect': case 'transcription': return 'audio';
        case undefined: case '': break;
        default: return 'others';
    }
    const output = merchantOutputCategories(Array.isArray(model.output) ? model.output : []);
    return output.includes('video') ? 'video' : output.includes('audio') ? 'audio'
        : output.includes('image') ? 'image' : output.includes('text') ? 'language' : 'others';
}

/** All browse categories; a model can be found in every independently supported task. */
export function merchantModelCategories(model: ModelTaskMetadata): readonly MerchantModelCategory[] {
    const result = modelTaskCategories(model).map((task): MerchantModelCategory =>
        task === 'language' || task === '3d' ? 'language'
            : task === 'image' || task === 'video' ? task
            : ['speech', 'music', 'sound_effect', 'transcription'].includes(task) ? 'audio' : 'others');
    // Generic audio is still a useful browse group, without promising independent TTS/music/effect generation.
    if (result.length === 1 && result[0] === 'others' && !knownModelTaskCorrection(model)
        && (!model.kind || model.kind === 'audio') && (model.kind === 'audio' || merchantOutputCategories(Array.isArray(model.output) ? model.output : []).includes('audio'))) return ['audio'];
    return [...new Set(result)];
}
