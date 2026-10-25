/** Model purpose for discovery and filtering. This never authorizes a transport or a paid route. */
export const TAXONOMY_RULES_VERSION = '2026-10-04.1';
export type ModelTaskCategory = 'language' | '3d' | 'image' | 'video' | 'speech' | 'music' | 'sound_effect' | 'transcription' | 'decision' | 'embedding' | 'rerank' | 'moderation' | 'other';
export type ModelPrimaryKind = Exclude<ModelTaskCategory, 'language'> | 'llm';
export interface ModelTaskMetadata {
    readonly id?: string; readonly modelId?: string; readonly canonicalModel?: string;
    readonly upstreamModelId?: string; readonly listedModelId?: string; readonly policyModelId?: string; readonly referenceModel?: string;
    readonly displayName?: string; readonly name?: string; readonly modelName?: string; readonly label?: string;
    readonly provider?: string; readonly kind?: string; readonly category?: string;
    readonly input?: unknown; readonly inputModalities?: unknown;
    readonly output?: unknown; readonly outputModalities?: unknown; readonly output_modalities?: unknown;
    readonly outputJson?: unknown; readonly outputModalitiesJson?: unknown; readonly output_modalities_json?: unknown;
    readonly discoveredOutputJson?: unknown; readonly registryOutputJson?: unknown; readonly outputs?: unknown;
    readonly architecture?: { readonly output_modalities?: unknown }; readonly modalities?: { readonly output?: unknown };
    readonly capabilities?: unknown; readonly taskCategories?: unknown;
    readonly task?: unknown; readonly mode?: unknown; readonly pipeline_tag?: unknown; readonly pipelineTag?: unknown;
    readonly supportedGenerationMethods?: unknown; readonly capabilityDeclarations?: Readonly<Record<string, unknown>>;
    readonly decisionEndpointRoles?: unknown; readonly decisionEndpointSupport?: unknown;
}
const tasks: readonly ModelTaskCategory[] = ['language', '3d', 'image', 'video', 'speech', 'music', 'sound_effect', 'transcription', 'decision', 'embedding', 'rerank', 'moderation', 'other'];
export const MODEL_TASK_CATEGORIES: readonly ModelTaskCategory[] = Object.freeze([...tasks]);

// Exact identities only. Evidence: the 2026-10-04 complete-directory audit and its primary-source reports.
// Do not turn provider/company names, display labels or unverified aliases into correction rules.
const corrections: Readonly<Record<string, ModelPrimaryKind>> = Object.freeze({
    "302ai/gemini-2.5-flash-image": "image",
    "302ai/gemini-3-pro-image-preview": "image",
    "@cf/cloudflare/clef": "decision",
    "@cf/cloudflare/clef-flash": "decision",
    "amazon-bedrock/openai.gpt-oss-safeguard-120b": "moderation",
    "amazon-bedrock/openai.gpt-oss-safeguard-20b": "moderation",
    "amazon/openai.gpt-oss-safeguard-20b": "moderation",
    "amazon/openai.gpt-oss-safeguard-20b@us": "moderation",
    "cortecs/gpt-oss-safeguard-120b": "moderation",
    "cortecs/qwen3guard-gen-0.6b": "moderation",
    "cortecs/qwen3guard-gen-8b": "moderation",
    "deepgram/flux-tts": "speech",
    "deepgram/nova": "transcription",
    "deepgram/nova-2": "transcription",
    "deepgram/nova-2-atc": "transcription",
    "deepgram/nova-2-automotive": "transcription",
    "deepgram/nova-2-conversationalai": "transcription",
    "deepgram/nova-2-drivethru": "transcription",
    "deepgram/nova-2-finance": "transcription",
    "deepgram/nova-2-general": "transcription",
    "deepgram/nova-2-meeting": "transcription",
    "deepgram/nova-2-phonecall": "transcription",
    "deepgram/nova-2-video": "transcription",
    "deepgram/nova-2-voicemail": "transcription",
    "deepgram/nova-3": "transcription",
    "deepgram/nova-3-general": "transcription",
    "deepgram/nova-3-medical": "transcription",
    "deepgram/nova-general": "transcription",
    "deepgram/nova-phonecall": "transcription",
    "deepgram/streaming/nova-3": "transcription",
    "deepgram/streaming/nova-3-multilingual": "transcription",
    "digitalocean/all-mini-lm-l6-v2": "embedding",
    "digitalocean/multi-qa-mpnet-base-dot-v1": "embedding",
    "fal-ai/fal-ai/trellis": "3d",
    "fal-ai/fal-ai/trellis-2": "3d",
    "fastino/gliguard-llmguardrails-300m": "moderation",
    "fastino/gliguard-pii-multi": "moderation",
    "fastino/gliner-2.5-decide": "decision",
    "fastino/gliner2-base-v1": "other",
    "fastino/gliner2-large-v1": "other",
    "fastino/gliner2-multi-v1": "other",
    "fastino/gliner2-privacy-filter-pii-multi": "other",
    "fastino/gliner2.5-base-v1": "other",
    "fastino/gliner2.5-multi-v1": "other",
    "google-vertex/deep-research-pro-preview-12-2025": "llm",
    "google/deep-research-pro-preview-12-2025": "llm",
    "greenpt/green-s": "transcription",
    "greenpt/green-s-pro": "transcription",
    "groq/openai/gpt-oss-safeguard-20b": "moderation",
    "helicone/gpt-5.1": "llm",
    "helicone/gpt-5.1-chat-latest": "llm",
    "helicone/gpt-5.1-codex": "llm",
    "helicone/gpt-5.1-codex-mini": "llm",
    "helicone/grok-4-1-fast-non-reasoning": "llm",
    "inception/mercury-decide:free": "decision",
    "infomaniak/bge_multilingual_gemma2": "embedding",
    "infomaniak/mini_lm_l12_v2": "embedding",
    "jaredpalmer/kev-4b": "decision",
    "liquid/d1": "decision",
    "meta/esm2-650m": "embedding",
    "meta/esmfold": "other",
    "nano-gpt/gemini-3-pro-image-preview": "image",
    "nvidia/active-speaker-detection": "other",
    "nvidia/bevformer": "other",
    "nvidia/gliner-pii": "other",
    "nvidia/nemotron-3-content-safety": "moderation",
    "nvidia/nemotron-3.5-content-safety": "moderation",
    "nvidia/nemotron-3.5-content-safety:free": "moderation",
    "nvidia/nemotron-content-safety-reasoning-4b": "moderation",
    "nvidia/sparsedrive": "other",
    "nvidia/streampetr": "other",
    "nvidia/studiovoice": "other",
    "nvidia/synthetic-video-detector": "other",
    "nvidia/usdvalidate": "other",
    "openai/gpt-image-1": "image",
    "openai/gpt-oss-safeguard-120b": "moderation",
    "openai/gpt-oss-safeguard-20b": "moderation",
    "openai/tts-1": "speech",
    "openai/tts-1-hd": "speech",
    "opencode/jev-1.13": "decision",
    "opencode/jev-1.13-free": "decision",
    "openrouter/auto": "llm",
    "openrouter/auto-beta": "llm",
    "ovhcloud/qwen3guard-gen-0.6b": "moderation",
    "ovhcloud/qwen3guard-gen-8b": "moderation",
    "privatemode-ai/voxtral-mini-3b": "transcription",
    "requesty/nemotron-3.5-content-safety": "moderation",
    "respan/span-01": "decision",
    "respan/span-01-lite": "decision",
    "respan/span-01-lite:free": "decision",
    "runway/eleven_multilingual_v2": "speech",
    "runway/gen4_image": "image",
    "runway/gen4_image_turbo": "image",
    "tinfoil/gpt-oss-safeguard-120b": "moderation",
    "togethercomputer/tev1-4b-experimental": "decision",
    "together/tev1-4b-experimental": "decision",
    "typesafe/jev": "decision",
    "typesafe/jev-1.13": "decision",
    "typesafe/jev-latest": "decision",
    "upstage/solar-decide": "decision",
    "vertex-ai-language-models/deep-research-pro-preview-12-2025": "llm",
    "vultr/nemotron-3.5-content-safety": "moderation",
    "~typesafe/jev-latest": "decision",
});
export const DECISION_MODEL_IDENTITIES: readonly string[] = Object.freeze(Object.keys(corrections).filter(id => corrections[id] === 'decision'));
const identities = (model: ModelTaskMetadata): string[] => [model.canonicalModel, model.id, model.modelId, model.upstreamModelId,
    model.listedModelId, model.policyModelId, model.referenceModel].filter((value): value is string => typeof value === 'string').map(value => value.trim().toLowerCase());
const values = (value: unknown): string[] => {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim().toLowerCase().replace(/[\s-]+/g, '_')).filter(Boolean) : [];
};
const outputs = (model: ModelTaskMetadata): string[] => [...new Set([model.output, model.outputModalities, model.output_modalities, model.outputJson,
    model.outputModalitiesJson, model.output_modalities_json, model.discoveredOutputJson, model.registryOutputJson, model.outputs,
    model.architecture?.output_modalities, model.modalities?.output].flatMap(values).map(value => value === 'decision' ? 'decisions' : value))];

const taskDeclarations: Readonly<Record<string, ModelTaskCategory>> = {
    text_generation: 'language', text2text_generation: 'language', image_text_to_text: 'language', chat: 'language', completion: 'language', llm: 'language', language: 'language',
    text_to_image: 'image', image_to_image: 'image', image_generation: 'image', image_editing: 'image', image: 'image',
    text_to_video: 'video', image_to_video: 'video', video_generation: 'video', video: 'video',
    text_to_speech: 'speech', speech_generation: 'speech', speech: 'speech', tts: 'speech',
    text_to_music: 'music', music_generation: 'music', music: 'music',
    sound_effect_generation: 'sound_effect', text_to_sound_effect: 'sound_effect', sound_effect: 'sound_effect',
    automatic_speech_recognition: 'transcription', speech_recognition: 'transcription', speech_to_text: 'transcription', transcription: 'transcription',
    feature_extraction: 'embedding', sentence_embedding: 'embedding', embedding: 'embedding', embeddings: 'embedding',
    reranking: 'rerank', rerank: 'rerank', text_ranking: 'rerank', moderation: 'moderation', decision: 'decision', decisions: 'decision',
    text_classification: 'other', token_classification: 'other', image_classification: 'other', object_detection: 'other', image_to_3d: '3d', text_to_3d: '3d', '3d_generation': '3d', '3d_modeling': '3d', '3d': '3d'
};
const declaredTask = (value: string): ModelTaskCategory | undefined => Object.hasOwn(taskDeclarations, value) ? taskDeclarations[value] : undefined;
const exactCorrection = (model: ModelTaskMetadata): ModelPrimaryKind | undefined => {
    for (const id of identities(model)) if (Object.hasOwn(corrections, id)) return corrections[id];
    return undefined;
};
/** Explicit task fields/methods, not company/name guesses or generic vision/audio flags. */
export function declaredModelTaskCategories(model: ModelTaskMetadata): readonly ModelTaskCategory[] {
    if (!model || typeof model !== 'object') return [];
    const declarations = [model.task, model.mode, model.pipeline_tag, model.pipelineTag].flatMap(value => typeof value === 'string' ? [value] : Array.isArray(value) ? value : [])
        .filter((value): value is string => typeof value === 'string').map(value => value.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    const result = new Set([...values(model.taskCategories).filter((value): value is ModelTaskCategory => tasks.includes(value as ModelTaskCategory)),
        ...declarations.map(declaredTask).filter((value): value is ModelTaskCategory => Boolean(value))]);
    for (const method of values(model.supportedGenerationMethods)) {
        const task = ({ embedcontent: 'embedding', batchembedcontents: 'embedding', generatevideos: 'video', generateimages: 'image', generateimage: 'image', generatespeech: 'speech' } as const)[method as 'embedcontent'];
        if (task) result.add(task);
    }
    return tasks.filter(task => result.has(task));
}
export function knownModelTaskCorrection(model: ModelTaskMetadata): ModelPrimaryKind | undefined {
    if (!model || typeof model !== 'object') return undefined;
    const exact = exactCorrection(model);
    if (exact) return exact;
    const declared = declaredModelTaskCategories(model);
    return declared.length === 1 ? declared[0] === 'language' ? 'llm' : declared[0] : undefined;
}

/** Purpose only: a decision model can still use chat completions, System One or another dedicated protocol. */
export function isDecisionTaskModel(model: ModelTaskMetadata | string): boolean {
    if (typeof model === 'string') model = { id: model };
    if (!model || typeof model !== 'object') return false;
    const correction = exactCorrection(model);
    if (correction === 'decision') return true;
    const decision = model.capabilityDeclarations?.decision as { support?: string; source?: string; scope?: string } | undefined;
    if (decision?.support === 'supported' && decision.source === 'provider_metadata' && ['model', 'route'].includes(decision.scope || '')) return true;
    if (correction) return false;
    if (declaredModelTaskCategories(model).includes('decision')) return true;
    const output = outputs(model);
    if (output.length) return output.includes('decisions');
    const names = [...identities(model), model.name, model.displayName, model.modelName].filter((value): value is string => typeof value === 'string').map(value => value.trim().toLowerCase());
    if (names.some(name => /(?:^|[\s/_.:-])(router|chat|text)(?:$|[\s/_.:-])/.test(name))) return false;
    return model.kind?.toLowerCase() === 'decision' || model.category?.toLowerCase() === 'decision'
        || names.some(name => /^jev(?:$|[ ._-])/.test(name.slice(name.indexOf('/') + 1)));
}

/** Chat/media filters exclude dedicated decision models, not language models with an additional endpoint role. */
export function isDecisionOnlyModel(model: ModelTaskMetadata | string): boolean {
    if (typeof model === 'string') model = { id: model };
    if (!model || typeof model !== 'object' || !isDecisionTaskModel(model)) return false;
    const correction = exactCorrection(model);
    if (correction) return correction === 'decision';
    const declared = declaredModelTaskCategories(model);
    if (declared.includes('language') || ['llm', 'language', 'text', 'coding'].includes(model.kind?.toLowerCase() || '')) return false;
    // Legacy explicit decision-only declarations can have a stale text output.
    if (declared.includes('decision')) return true;
    const output = outputs(model);
    return !output.includes('text') || output.includes('decisions');
}

/** Multiple independent tasks; image input, generic audio and sound embedded in video are not independent generators. */
export function modelTaskCategories(model: ModelTaskMetadata): readonly ModelTaskCategory[] {
    if (!model || typeof model !== 'object') return ['other'];
    const correction = knownModelTaskCorrection(model);
    const kind = correction || model.kind?.toLowerCase() || '';
    const output = outputs(model);
    const capabilities = values(model.capabilities);
    const declared = [...new Set([...values(model.taskCategories).filter((value): value is ModelTaskCategory => tasks.includes(value as ModelTaskCategory)), ...declaredModelTaskCategories(model)])];
    const independentlyDeclared: ModelTaskCategory[] = [];
    for (const [capability, evidence] of Object.entries(model.capabilityDeclarations || {})) {
        if (!evidence || typeof evidence !== 'object') continue;
        const declaration = evidence as { support?: string; source?: string; scope?: string };
        const task = declaredTask(capability.toLowerCase().replace(/[ -]/g, '_'));
        if (task && declaration.support === 'supported' && declaration.source === 'provider_metadata' && ['model', 'route'].includes(declaration.scope || '')) {
            if (!declared.includes(task)) declared.push(task);
            if (!independentlyDeclared.includes(task)) independentlyDeclared.push(task);
        }
    }
    const has = (...names: string[]): boolean => names.some(name => capabilities.includes(name));
    const primary: ModelTaskCategory | undefined = kind === 'llm' ? 'language' : tasks.includes(kind as ModelTaskCategory) ? kind as ModelTaskCategory : undefined;
    const exact = exactCorrection(model);
    if (isDecisionOnlyModel(model)) return ['decision', ...(exact ? independentlyDeclared : declared).filter(task => task !== 'decision')];
    // A known bad upstream row must not reintroduce its erroneous output/capability through the second category.
    const router = identities(model).some(id => id === 'openrouter/auto' || id === 'openrouter/auto-beta');
    if (exact && !router) {
        const corrected = correction === 'llm' ? 'language' : correction!;
        // `mode` and stored taskCategories can originate in the very source this
        // correction disproved. Only an independent, scoped capability claim can
        // add a newly established task; do not rebrand the bad mode as new evidence.
        return [corrected, ...independentlyDeclared.filter(task => task !== corrected)];
    }
    if (primary && ['decision', 'embedding', 'rerank', 'moderation', 'other'].includes(primary)) return [primary, ...declared.filter(task => task !== primary)];
    if (kind && !primary && kind !== 'audio') return declared.length ? [...new Set(declared)] : ['other'];
    const result = new Set<ModelTaskCategory>(primary ? [primary] : []);
    for (const task of declared) result.add(task);
    const category = model.category?.toLowerCase().trim() || '';
    if (output.includes('3d') || has('3d', '3d_generation', 'text_to_3d', 'image_to_3d') || category === '3d') result.add('3d');
    if (result.has('3d') && (kind === '3d' || kind === 'llm' || !kind) && (output.includes('text') || output.length === 0)) result.add('language');
    // Non-generative text output does not mean general conversation.
    if (output.includes('rerank') || has('rerank')) result.add('rerank');
    if (output.some(value => value === 'embeddings' || value === 'embedding') || has('embeddings', 'embedding')) result.add('embedding');
    if (output.includes('moderation') || has('moderation')) result.add('moderation');
    if (output.includes('transcription') || has('speech_to_text', 'transcription')) result.add('transcription');
    if (output.includes('image') || kind !== 'llm' && has('image_generation', 'image_editing', 'text_to_image')) result.add('image');
    if (output.includes('video') || kind !== 'llm' && has('video_generation', 'text_to_video', 'image_to_video', 'reference_to_video')) result.add('video');
    const embeddedAudio = result.has('video') && has('video_native_audio');
    if (output.includes('speech') || !embeddedAudio && has('tts', 'text_to_speech', 'speech_generation')) result.add('speech');
    if (output.includes('music') || !embeddedAudio && has('music_generation', 'text_to_music')) result.add('music');
    if (output.includes('sound_effect') || !embeddedAudio && has('sound_effect_generation', 'text_to_sound_effect')) result.add('sound_effect');
    // Text next to media describes prompts/captions for dedicated models; an explicit llm kind admits language alongside media.
    if (!kind && output.includes('text') && (result.size === 0 || result.size === 1 && result.has('decision'))) result.add('language');
    if (!result.size) return ['other'];
    const ordered = tasks.filter(task => result.has(task));
    if (ordered.includes('3d') && (kind === '3d' || category === '3d' || declared[0] === '3d')) {
        return ['3d', ...ordered.filter(task => task !== '3d')];
    }
    return ordered;
}
