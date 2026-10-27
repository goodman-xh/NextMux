import type { OfficialModelConnection, PlatformOffering } from '../common/nextmux-platform-protocol';
import { mediaModelTakesText } from '../common/nextmux-media-text-input';
import { plannedClipSeconds, videoModelGuide, videoModelUsesReferences } from '../common/nextmux-video-model-guide';
import { documentedVideoProfile, videoAspectRatioOf } from '../common/nextmux-video-profiles';

/** What the route can transport, rather than what a similarly named model can do. */
export interface ComicRouteEvidence {
    readonly kind: 'managed' | 'official' | 'local';
    readonly model: string;
    readonly offering?: PlatformOffering;
    readonly connection?: OfficialModelConnection;
}

export function comicRouteTakesText(kind: 'image' | 'video' | 'music', route: ComicRouteEvidence): boolean {
    const discovered = route.connection?.discoveredModels.find(model => model.id === route.model);
    return mediaModelTakesText(kind, { id: route.model, displayName: discovered?.label,
        input: route.offering?.input || discovered?.inputModalities, capabilities: route.offering?.capabilities });
}

export function comicRouteImageInput(route: ComicRouteEvidence, mode: 'image' | 'firstFrame' | 'lastFrame' | 'references'): boolean {
    if (route.kind === 'local') return false; // A configured ComfyUI workflow has no declared image-input binding.
    if (route.offering) {
        const offering = route.offering;
        if (offering.input.length && !offering.input.includes('image')) return false;
        const declared = offering.mediaInput?.[mode === 'firstFrame' || mode === 'lastFrame' ? mode : 'referenceImages'];
        if (declared === true && mode !== 'firstFrame' && mode !== 'lastFrame' && offering.mediaInput?.maxReferences === 0) return false;
        if (declared !== undefined) return declared;
        // Older catalogs cannot distinguish an OpenAI image generator from OpenRouter's image transport,
        // or a reference-priced video lane from one that can bill reference pictures. Refresh supplies that evidence.
        return mode === 'image' && offering.input.includes('image') && offering.managedTransport?.protocol === 'gemini_generate_content';
    }
    const connection = route.connection;
    if (!connection) return false;
    const discovered = connection.discoveredModels.find(model => model.id === route.model);
    if (discovered?.inputModalities?.length && !discovered.inputModalities.includes('image')) return false;
    const template = connection.protocol === 'async_media_template' ? connection.providerSettings?.mediaTemplate : undefined;
    if (template) {
        if (template.images === 'none') return false;
        if (mode === 'firstFrame') return /\{\{(?:first_frame|image|images|images_csv)\}\}/.test(template.submit.body);
        if (mode === 'lastFrame') return /\{\{last_frame\}\}/.test(template.submit.body)
            && /\{\{(?:first_frame|image|images|images_csv)\}\}/.test(template.submit.body);
        return template.maxReferences > 0 && /\{\{(?:references|reference|references_csv|images|images_csv)\}\}/.test(template.submit.body);
    }
    if (mode === 'lastFrame') return false;
    const knownImageInput = mode === 'image'
        ? /(?:gpt-image|gemini-[^/]*image|flux[^/]*(?:kontext|klein))/i.test(route.model)
        : Boolean(videoModelGuide(route.model).family);
    if (!discovered?.inputModalities?.includes('image') && !knownImageInput) return false;
    const mediaApiStyle = connection.protocol === 'openai_chat_completions' ? connection.providerSettings?.mediaApiStyle : undefined;
    const openRouter = mediaApiStyle === undefined
        ? /^https?:\/\/(?:[^/]+\.)?openrouter\.ai(?:\/|$)/i.test(connection.baseUrl || '') : mediaApiStyle === 'openrouter';
    if (mode === 'image') return connection.protocol === 'gemini_generate_content' || openRouter;
    if (mode === 'references') return openRouter && videoModelUsesReferences(videoModelGuide(route.model));
    return openRouter || connection.protocol === 'openai_chat_completions' && /(?:^|\/)sora-2(?:-pro)?$/.test(route.model);
}

export function comicRouteVideoSeconds(route: ComicRouteEvidence, references: boolean, highRes: boolean): readonly number[] {
    const guide = videoModelGuide(route.model);
    const template = route.connection?.protocol === 'async_media_template' ? route.connection.providerSettings?.mediaTemplate : undefined;
    const declared = route.offering?.videoLimits?.durations || (template?.kind === 'video' ? template.seconds : undefined);
    if (declared?.length) {
        // A declaration is a limit: a guide may narrow it but must never add lengths the route did not list.
        return declared.filter(seconds => Number.isFinite(seconds) && seconds > 0 && seconds <= 300
            && (!references || !guide.clipSecondsWithReferences?.length || guide.clipSecondsWithReferences.includes(seconds))
            && (!highRes || !guide.clipSecondsHighRes?.length || guide.clipSecondsHighRes.includes(seconds)));
    }
    return plannedClipSeconds(guide, guide.clipSeconds, { withReferences: references, highRes });
}

export function comicRouteVideoShape(route: ComicRouteEvidence, width: number, height: number): boolean {
    const ratios = route.offering?.videoLimits?.aspectRatios || documentedVideoProfile(route.model)?.aspectRatios || [];
    const aspect = videoAspectRatioOf(width, height);
    if (ratios.length && (!aspect || !ratios.includes(aspect))) return false;
    const resolutions = route.offering?.videoLimits?.resolutions || [];
    if (!resolutions.length) return true;
    const short = Math.min(width, height);
    return resolutions.some(value => {
        const size = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(value);
        if (size) return Number(size[1]) === width && Number(size[2]) === height;
        const normalized = value.toLowerCase().trim();
        return normalized === `${short}p` || short === 1080 && normalized === '1k'
            || short === 1440 && normalized === '2k' || short === 2160 && normalized === '4k';
    });
}

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
const GEMINI_VOICES = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus',
    'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima',
    'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'] as const;

/** Listed voices win. Documented defaults apply only to their exact model families. */
export function comicRouteVoices(route: ComicRouteEvidence | undefined): readonly string[] {
    if (!route) return [];
    const discovered = route.connection?.discoveredModels.find(model => model.id === route.model) as { voices?: readonly string[] } | undefined;
    const listed = route.offering?.voices || discovered?.voices;
    if (listed !== undefined) return [...new Set(listed.filter(voice => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(voice)))];
    if (/(?:^|\/)gemini-[^/]*-tts(?:$|[-:@])/i.test(route.model)) return GEMINI_VOICES;
    if (/(?:^|\/)(?:tts-1(?:-hd)?|gpt-4o-mini-tts)(?:$|[-:@])/i.test(route.model)) return /gpt-4o-mini-tts/i.test(route.model)
        ? [...OPENAI_VOICES, 'coral', 'sage', 'ash', 'ballad', 'verse'] : OPENAI_VOICES;
    return [];
}
