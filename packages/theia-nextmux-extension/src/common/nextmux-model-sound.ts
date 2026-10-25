import { modelNameMatches } from './nextmux-model-name';
import { videoModelGuide } from './nextmux-video-model-guide';

/**
 * Whether a video model also makes the sound — dialogue, effects and music — like Veo 3, Sora 2,
 * Kling 2.6+, Wan 2.5+, Seedance 1.5 Pro or LTX-2. The platform's model taxonomy
 * (apps/cloudflare-platform/src/model-taxonomy.js) marks those `video_native_audio`; the name rule
 * here is the same one, for an own API whose model is not in the registry yet.
 */
const VIDEO_WITH_SOUND = /(^|[\s/_.-])(veo[-_]?3|sora[-_]?2|kling[-_ ]?v?(2[._-][6-9]|[3-9])|wan[-_]?v?(2[._][5-9]|[3-9])|seedance[-_]?v?(1[._-]5|[2-9])|ltx[-_]?2)/;

export function videoModelMakesSound(model: string, capabilities: readonly string[] = []): boolean {
    // The video model guide knows the families with their own sound too (Kling O1, Hailuo 3, Grok Imagine, Vidu),
    // so the sound choice the panel offers is the one the request keeps (audit A13-05).
    return capabilities.some(value => ['video_native_audio', 'native_audio'].includes(value.toLowerCase())) || modelNameMatches(model, VIDEO_WITH_SOUND)
        || videoModelGuide(model).nativeAudio;
}
