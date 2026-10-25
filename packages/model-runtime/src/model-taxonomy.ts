/**
 * The model taxonomy every desktop surface shows: ten primary categories (what a model is for, exactly one per model)
 * and eleven capability badges (what else it can do), never mixed. Categories follow the shared classifier
 * (model-task-capabilities: a primary category is always one of its tasks); this module adds the field spellings relays
 * use and name evidence for rows that carry none. The web portals resolve the same way
 * (apps/cloudflare-platform/web/src/features/merchant/taxonomy.ts); labels live with each UI.
 */

export const MODEL_PRIMARY_CATEGORIES = ['language', '3d', 'image', 'video', 'speech', 'music', 'sound_effect', 'transcription', 'decision', 'embedding', 'rerank'] as const;
export type ModelPrimaryCategory = typeof MODEL_PRIMARY_CATEGORIES[number];

export const MODEL_CAPABILITY_KEYS = ['tools', 'reasoning', 'vision', 'web_search', 'structured_output', 'image_editing', 'text_to_video', 'image_to_video',
    'reference_to_video', 'video_native_audio', 'vocal_reference'] as const;
export type ModelCapabilityKey = typeof MODEL_CAPABILITY_KEYS[number];

type ModelRow = Readonly<Record<string, unknown>>;

/** "Text-to-Video", "text to video", "text_to_video" → "text_to_video". */
const token = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';

/** A list field as relays send it: an array, a JSON array string, or one comma-separated string. */
function list(value: unknown): string[] {
    if (typeof value === 'string') {
        const text = value.trim();
        if (text.startsWith('[')) {
            try { return list(JSON.parse(text)); } catch { return []; }
        }
        return text ? text.split(',').map(token).filter(Boolean) : [];
    }
    return Array.isArray(value) ? value.map(token).filter(Boolean) : [];
}

// Every spelling a category arrives in (server kinds and publication categories, relay `model_type` / `modality`
// values, task names). "audio" alone names no task: it is resolved from the rest of the row.
const CATEGORY_ALIASES: Readonly<Record<string, ModelPrimaryCategory>> = {
    language: 'language', llm: 'language', text: 'language', chat: 'language', coding: 'language', reasoning: 'language', completion: 'language',
    text_generation: 'language', text2text_generation: 'language', image_text_to_text: 'language',
    '3d': '3d', '3d_generation': '3d', text_to_3d: '3d', image_to_3d: '3d', '3d_model': '3d', '3d_modeling': '3d', mesh: '3d',
    image: 'image', image_generation: 'image', text_to_image: 'image', image_to_image: 'image',
    video: 'video', video_generation: 'video', text_to_video: 'video', image_to_video: 'video', reference_to_video: 'video',
    speech: 'speech', tts: 'speech', voice: 'speech', audio_speech: 'speech', text_to_speech: 'speech', speech_generation: 'speech',
    music: 'music', music_generation: 'music', audio_music: 'music', text_to_music: 'music',
    sound_effect: 'sound_effect', sfx: 'sound_effect', audio_sfx: 'sound_effect', sound: 'sound_effect', sound_effect_generation: 'sound_effect', text_to_sound_effect: 'sound_effect',
    transcription: 'transcription', asr: 'transcription', stt: 'transcription', audio_transcription: 'transcription', speech_to_text: 'transcription',
    automatic_speech_recognition: 'transcription', speech_recognition: 'transcription',
    decision: 'decision', decisions: 'decision',
    embedding: 'embedding', embeddings: 'embedding', feature_extraction: 'embedding', sentence_embedding: 'embedding',
    rerank: 'rerank', reranking: 'rerank', text_ranking: 'rerank'
};

/** The category one spelling names, or undefined ("audio", "other", "moderation" and unknown words name none). */
export function normalizeModelPrimaryCategory(value: unknown): ModelPrimaryCategory | undefined {
    const key = token(value);
    return Object.hasOwn(CATEGORY_ALIASES, key) ? CATEGORY_ALIASES[key] : undefined;
}

export const isModelPrimaryCategory = (value: unknown): value is ModelPrimaryCategory =>
    typeof value === 'string' && (MODEL_PRIMARY_CATEGORIES as readonly string[]).includes(value);

export const isModelCapabilityKey = (value: unknown): value is ModelCapabilityKey =>
    typeof value === 'string' && (MODEL_CAPABILITY_KEYS as readonly string[]).includes(value);

// Name evidence, in the own-model classifier's order: "bge-reranker" is a reranker, "gpt-image-1-all" a picture model,
// "wan-2.2" and Alibaba's "wan2.1-t2v-turbo" video models ("wanx2.1-t2i-turbo" a picture model), ElevenLabs'
// "eleven_multilingual_v2" a voice ("eleven_text_to_sound_v2" a sound effect, matched before the "eleven_" voice
// rule). Only used when the row declares nothing.
const NAME_RULES: readonly (readonly [ModelPrimaryCategory, RegExp])[] = [
    ['rerank', /rerank/],
    ['embedding', /embed|(^|[/_-])(bge|gte|e5)([/_-]|$)/],
    ['transcription', /whisper|transcri|(^|[/_-])(asr|stt)([/_-]|$)|chirp|paraformer|sensevoice/],
    ['music', /lyria|music|suno|(^|[\s/_.-])udio($|[\s/_.-])|(^|[\s/_.-])song($|[\s/_.-])/],
    ['sound_effect', /sound[\s_-]?effect|text[\s_-]?to[\s_-]?sound|(^|[/_-])sfx([/_-]|$)/],
    ['speech', /(^|[/_-])(tts|speech|voice)([/_-]|$)|^tts|aura-|orpheus|fish-audio|elevenlabs|(^|\/)eleven_|cosyvoice|minimax-speech|audio-tts/],
    ['video', /veo-|sora|kling|(^|[/_-])wan-\d|(^|[/_-])wanx?\d+(\.\d+)?-(t2v|i2v|kf2v|s2v|r2v|vace|animate)|(^|[/_-])[ti]2v([/_.-]|$)|hailuo|seedance|runway[-/]gen[34]|pixverse|vidu|video|ltx-|mochi|happyhorse/],
    ['image', /dall-e|gpt-image|imagen|flux|sdxl|stable-diffusion|seedream|recraft|midjourney|ideogram|qwen-image|(^|[/_-])wanx?\d+(\.\d+)?-(t2i|i2i|image)|-image(-|$)|image-\d/],
    ['3d', /trellis|hunyuan[-_]?3d|tripo[-_]?3d|triposr|meshy|rodin[-_]?3d|point-e|shap-e|zero123|(^|[/_-])3d([/_-]|$)/]
];

const record = (value: unknown): ModelRow => value && typeof value === 'object' && !Array.isArray(value) ? value as ModelRow : {};

function outputs(model: ModelRow): string[] {
    return [...new Set([model.output, model.outputs, model.outputModalities, model.output_modalities, model.outputModalitiesJson,
        record(model.architecture).output_modalities, record(model.modalities).output].flatMap(list))];
}

function inputs(model: ModelRow): string[] {
    return [...new Set([model.input, model.inputs, model.inputModalities, model.input_modalities, model.inputModalitiesJson,
        record(model.architecture).input_modalities, record(model.modalities).input].flatMap(list))];
}

function capabilities(model: ModelRow): Set<string> {
    const values = new Set([model.capabilities, model.capability, model.features, model.supportedFeatures].flatMap(list));
    // Draft and form rows carry the common ones as flags.
    for (const flag of ['tools', 'vision', 'reasoning']) if (model[flag] === true) values.add(flag);
    return values;
}

function names(model: ModelRow): string[] {
    return [model.id, model.modelId, model.canonicalModel, model.upstreamModelId, model.primaryUpstreamModelId, model.registryModelId, model.name, model.displayName, model.label]
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '').map(value => value.trim().toLowerCase());
}

const byName = (model: ModelRow): ModelPrimaryCategory | undefined => {
    const all = names(model);
    return NAME_RULES.find(([, rule]) => all.some(name => rule.test(name)))?.[0];
};

/** "audio" with nothing more specific: what the outputs, capabilities or name say, else voice-over. */
function audioCategory(model: ModelRow, output: readonly string[], caps: ReadonlySet<string>): ModelPrimaryCategory {
    if (output.includes('music') || caps.has('music_generation') || caps.has('text_to_music')) return 'music';
    if (output.includes('sound_effect') || caps.has('sound_effect_generation')) return 'sound_effect';
    if (output.includes('transcription') || caps.has('speech_to_text')) return 'transcription';
    const named = byName(model);
    return named === 'music' || named === 'sound_effect' || named === 'transcription' ? named : 'speech';
}

// Outputs in the own-model classifier's order: a dedicated output beats a caption or prompt text beside it.
const OUTPUT_ORDER: readonly (readonly [string, ModelPrimaryCategory | 'audio'])[] = [
    ['decisions', 'decision'], ['decision', 'decision'], ['rerank', 'rerank'], ['sound_effect', 'sound_effect'], ['video', 'video'],
    ['transcription', 'transcription'], ['embeddings', 'embedding'], ['embedding', 'embedding'], ['speech', 'speech'], ['music', 'music'],
    ['image', 'image'], ['audio', 'audio'], ['3d', '3d'], ['text', 'language']
];

const CAPABILITY_CATEGORIES: readonly (readonly [readonly string[], ModelPrimaryCategory])[] = [
    [['decision'], 'decision'], [['rerank'], 'rerank'], [['embeddings', 'embedding'], 'embedding'], [['speech_to_text'], 'transcription'],
    [['video_generation', 'text_to_video', 'image_to_video', 'reference_to_video'], 'video'],
    [['image_generation', 'text_to_image'], 'image'], [['music_generation', 'text_to_music'], 'music'],
    [['sound_effect_generation'], 'sound_effect'], [['tts', 'text_to_speech', 'speech_generation'], 'speech'],
    [['3d', '3d_generation', 'text_to_3d', 'image_to_3d'], '3d']
];

/** The one primary category of a model row (or of a bare kind or id), from the most authoritative evidence it carries. */
export function modelPrimaryCategory(model: unknown): ModelPrimaryCategory {
    // A bare "audio" (the server's publication category) is voice-over, as generic audio is filed.
    if (typeof model === 'string') return normalizeModelPrimaryCategory(model) ?? (token(model) === 'audio' ? 'speech' : byName({ id: model })) ?? 'language';
    const row = record(model);
    const output = outputs(row);
    const caps = capabilities(row);
    // Publication categories are coarser: "audio" holds voice-over, music, transcription and sound effects, "embedding"
    // holds rerankers too. The rest of the row decides within them.
    const fromWord = (value: unknown): ModelPrimaryCategory | undefined => {
        if (token(value) === 'audio') return audioCategory(row, output, caps);
        const category = normalizeModelPrimaryCategory(value);
        return category === 'embedding' && (output.includes('rerank') || caps.has('rerank') || byName(row) === 'rerank') ? 'rerank' : category;
    };
    // 1. The primary kind (server classifier or the own-model classifier), then a decision lane however it is spelled.
    const kind = fromWord(row.kind) ?? fromWord(row.modelKind);
    if (kind) return kind;
    if ([row.category, row.taskCategories].flatMap(list).includes('decision')) return 'decision';
    // 2. The shared classifier's task list (first real task; moderation and "other" are not primary categories).
    for (const task of list(row.taskCategories)) {
        const category = normalizeModelPrimaryCategory(task);
        if (category) return category;
    }
    // 3. Declared categories, as the server or a relay spells them.
    for (const value of [row.category, row.model_type, row.modelType, row.type, row.modality, row.task, row.pipeline_tag]) {
        const category = fromWord(value);
        if (category && !(category === 'language' && ['text', 'coding'].includes(token(value)) && output.some(item => item !== 'text'))) return category;
    }
    // 4. What it outputs, 5. what it declares it can make, 6. its name.
    for (const [modality, category] of OUTPUT_ORDER) if (output.includes(modality)) return category === 'audio' ? audioCategory(row, output, caps) : category;
    for (const [declared, category] of CAPABILITY_CATEGORIES) if (declared.some(name => caps.has(name))) return category;
    return byName(row) ?? 'language';
}

// Every spelling of each badge. "coding" is tool use as the desktop shows it.
const CAPABILITY_ALIASES: Readonly<Record<ModelCapabilityKey, readonly string[]>> = {
    tools: ['tools', 'tool_use', 'tool_calling', 'function_calling', 'functions', 'coding', 'parallel_tool_calls'],
    reasoning: ['reasoning', 'thinking', 'extended_thinking', 'reasoning_effort'],
    vision: ['vision', 'multimodal_vision', 'image_input', 'input:image', 'image_understanding'],
    web_search: ['web_search', 'search', 'web_research', 'online', 'browsing'],
    structured_output: ['structured_output', 'structured_outputs', 'json_schema', 'json_mode', 'response_format'],
    image_editing: ['image_editing', 'inpainting', 'img2img', 'image_to_image', 'image_edit', 'edits'],
    text_to_video: ['text_to_video', 't2v'],
    image_to_video: ['image_to_video', 'i2v'],
    reference_to_video: ['reference_to_video', 'r2v'],
    video_native_audio: ['video_native_audio', 'with_audio', 'native_audio'],
    vocal_reference: ['vocal_reference', 'voice_clone', 'voice_cloning', 'reference_audio']
};

/**
 * The capability badges of a model row, in display order. A picture model that takes a picture in edits it (image
 * editing), it does not "see" (vision); a video model that takes one animates it (image to video). Text-to-video
 * follows the inputs only when the row names no video mode; sound in a video's output is native audio.
 */
export function modelCapabilityBadges(model: unknown, category: ModelPrimaryCategory = modelPrimaryCategory(model)): readonly ModelCapabilityKey[] {
    const row = record(model);
    const caps = capabilities(row);
    const input = inputs(row);
    const output = outputs(row);
    const has = (key: ModelCapabilityKey): boolean => CAPABILITY_ALIASES[key].some(name => caps.has(name));
    const keys = new Set<ModelCapabilityKey>(MODEL_CAPABILITY_KEYS.filter(key => key !== 'vision' && has(key)));
    if (input.includes('image') || has('vision')) keys.add(category === 'image' ? 'image_editing' : category === 'video' ? 'image_to_video' : 'vision');
    if (category === 'video') {
        if (!has('text_to_video') && !has('image_to_video') && !has('reference_to_video') && (input.includes('text') || !input.length)) keys.add('text_to_video');
        if (output.includes('audio')) keys.add('video_native_audio');
    }
    return MODEL_CAPABILITY_KEYS.filter(key => keys.has(key));
}
