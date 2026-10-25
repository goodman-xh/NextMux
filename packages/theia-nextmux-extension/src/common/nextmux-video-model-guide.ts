import { modelNameMatches } from './nextmux-model-name';
/**
 * How to drive each mainstream video model so a comic comes out at the length, episode count and
 * look the user set, whatever model they pick.
 *
 * Published limits (vendor API docs, September 2026); a live listing (OpenRouter /videos/models) wins
 * for lengths, sizes and frames where it exists. Faces stay the same through the character portraits:
 * models that keep faces from several pictures get them directly (reference-to-video); others get a
 * first frame drawn from the portraits. Anything not listed falls back to the safe default.
 */

export interface VideoModelGuide {
    readonly family: string;
    /** Clip lengths the model makes, in seconds. */
    readonly clipSeconds: readonly number[];
    /** Lengths allowed when character pictures are attached (Veo: 8 s only). */
    readonly clipSecondsWithReferences?: readonly number[];
    /** Lengths allowed at 1080p and above (Veo: 8 s only); otherwise the request drops to 720p. */
    readonly clipSecondsHighRes?: readonly number[];
    /** Character pictures the model keeps faces from (reference-to-video); 0 = first frame only. */
    readonly maxReferences: number;
    /**
     * Reference-to-video was confirmed with real clips through OpenRouter: faces kept, frame size kept.
     * Unconfirmed models get a first frame drawn from the portraits instead, which works everywhere.
     */
    readonly referencesVerified?: boolean;
    readonly firstFrame: boolean;
    readonly lastFrame: boolean;
    /** Makes its own sound: ambience, effects and speech. */
    readonly nativeAudio: boolean;
    /** Lines are spoken with matching mouths. */
    readonly lipSync: boolean;
    /** Photographs of real faces are refused as references (use a stylised portrait instead). */
    readonly refusesRealFaces?: boolean;
    /** Prompt text the model follows best. */
    readonly promptLanguage: 'en' | 'any';
    readonly maxPromptChars: number;
    /** References are named in the prompt as [Image 1], [Image 2] … */
    readonly referenceTags?: boolean;
    /**
     * Films several camera set-ups (cuts) in one clip and keeps the people and the set the same across them,
     * so one clip can cover a stretch of a scene: fewer seams between clips, and the set holds together.
     */
    readonly multiShot?: boolean;
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);

const GUIDES: readonly [RegExp, VideoModelGuide][] = [
    // Also 速创's names for the same model: video_veo3.1_fast.
    [/(?:^|\/)(?:veo-3(?:\.\d)?(?:-fast|-lite)?|video_veo3(?:\.\d)?(?:_fast|_lite)?)$/i, {
        // Verified 2026-09-26: two portraits, no first frame → both faces and costumes kept, 16:9 kept.
        family: 'Veo 3.1', clipSeconds: [4, 6, 8], clipSecondsWithReferences: [8], clipSecondsHighRes: [8], maxReferences: 3, referencesVerified: true,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: true, promptLanguage: 'en', maxPromptChars: 3_500
    }],
    [/(?:^|\/)kling-(?:v)?3(?:\.0)?(?:-pro|-std)?$/i, {
        // Tested 2026-09-26: references are taken as the opening frame and the clip follows the picture's shape
        // (a square portrait gave a square clip that opens on the portrait) — so Kling gets a drawn first frame.
        family: 'Kling 3.0', clipSeconds: range(3, 15), maxReferences: 0,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: true, promptLanguage: 'any', maxPromptChars: 2_500, multiShot: true
    }],
    [/(?:^|\/)kling-video-o1$/i, {
        family: 'Kling O1', clipSeconds: [5, 10], maxReferences: 7,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: true, promptLanguage: 'any', maxPromptChars: 2_500
    }],
    [/(?:^|\/)seedance-2\.5$/i, {
        family: 'Seedance 2.5', clipSeconds: range(4, 30), maxReferences: 9,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: true, refusesRealFaces: true, promptLanguage: 'any', maxPromptChars: 2_000, referenceTags: true, multiShot: true
    }],
    [/(?:^|\/)seedance-2(?:\.0)?(?:-fast|-mini)?$/i, {
        family: 'Seedance 2.0', clipSeconds: range(4, 15), maxReferences: 4,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: true, refusesRealFaces: true, promptLanguage: 'any', maxPromptChars: 2_000, referenceTags: true, multiShot: true
    }],
    [/(?:^|\/)seedance-1-5-pro$/i, {
        family: 'Seedance 1.5', clipSeconds: range(4, 12), maxReferences: 0,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: true, refusesRealFaces: true, promptLanguage: 'any', maxPromptChars: 2_000
    }],
    [/(?:^|\/)sora-2(?:-pro)?$/i, {
        // One picture, used as the opening image; real people are refused.
        family: 'Sora 2', clipSeconds: [4, 8, 12], maxReferences: 1,
        firstFrame: false, lastFrame: false, nativeAudio: true, lipSync: true, refusesRealFaces: true, promptLanguage: 'en', maxPromptChars: 4_000, multiShot: true
    }],
    [/(?:^|\/)wan-3(?:\.0)?(?:-prime)?$/i, {
        family: 'Wan 3.0', clipSeconds: range(2, 30), maxReferences: 4,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: true, promptLanguage: 'any', maxPromptChars: 2_000, multiShot: true
    }],
    [/(?:^|\/)wan-2\.[67]$/i, {
        family: 'Wan 2.7', clipSeconds: range(2, 10), maxReferences: 0,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: false, promptLanguage: 'any', maxPromptChars: 2_000, multiShot: true
    }],
    [/(?:^|\/)(?:hailuo-(?:0?3)|minimax-h-?0?3)(?:-max)?$/i, {
        family: 'Hailuo 3', clipSeconds: range(5, 15), maxReferences: 0,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: false, promptLanguage: 'any', maxPromptChars: 2_000
    }],
    [/(?:^|\/)hailuo-2\.3$/i, {
        family: 'Hailuo 2.3', clipSeconds: [6, 10], maxReferences: 0,
        firstFrame: true, lastFrame: false, nativeAudio: false, lipSync: false, promptLanguage: 'any', maxPromptChars: 2_000
    }],
    [/(?:^|\/)grok-imagine-video(?:-[\d.]+)?$/i, {
        family: 'Grok Imagine', clipSeconds: range(1, 15), maxReferences: 7,
        firstFrame: true, lastFrame: false, nativeAudio: true, lipSync: false, promptLanguage: 'en', maxPromptChars: 4_000
    }],
    [/(?:^|\/)gen-4(?:\.5)?$/i, {
        family: 'Runway Gen-4.5', clipSeconds: range(2, 10), maxReferences: 0,
        firstFrame: true, lastFrame: false, nativeAudio: false, lipSync: false, promptLanguage: 'en', maxPromptChars: 1_000
    }],
    [/(?:^|\/)happyhorse-1\.\d$/i, {
        family: 'HappyHorse', clipSeconds: range(3, 15), maxReferences: 0,
        firstFrame: true, lastFrame: false, nativeAudio: false, lipSync: false, promptLanguage: 'any', maxPromptChars: 2_000
    }],
    [/(?:^|\/)vidu-q[23](?:-pro|-turbo)?$/i, {
        family: 'Vidu', clipSeconds: range(1, 10), maxReferences: 7,
        firstFrame: true, lastFrame: true, nativeAudio: true, lipSync: false, promptLanguage: 'any', maxPromptChars: 2_000
    }],
    [/(?:^|\/)ray-?3$/i, {
        family: 'Luma Ray 3', clipSeconds: [5, 10], maxReferences: 0,
        firstFrame: true, lastFrame: true, nativeAudio: false, lipSync: false, promptLanguage: 'en', maxPromptChars: 2_000
    }]
];

/** The safe default for a model not listed: one opening picture, 5–10 s, no sound. */
export const DEFAULT_VIDEO_MODEL_GUIDE: VideoModelGuide = {
    family: '', clipSeconds: [], maxReferences: 0, firstFrame: true, lastFrame: false,
    nativeAudio: false, lipSync: false, promptLanguage: 'en', maxPromptChars: 2_000
};

export function videoModelGuide(model: string): VideoModelGuide {
    // Relay spellings ("video_wan_3.0", "Wan 3.0") are tried too (nextmux-model-name).
    return GUIDES.find(([pattern]) => modelNameMatches(model, pattern))?.[1] || DEFAULT_VIDEO_MODEL_GUIDE;
}

/** Every family covered, for the settings help and tests. */
export const VIDEO_MODEL_FAMILIES = GUIDES.map(([, guide]) => guide.family);

/** Send character pictures directly (reference-to-video) only where that was confirmed to work. */
export function videoModelUsesReferences(guide: VideoModelGuide): boolean {
    return guide.maxReferences > 0 && guide.referencesVerified === true;
}

/**
 * The clip lengths to plan shots with: the live listing when there is one, else the published list;
 * narrowed to what character pictures or a high resolution require.
 */
export function plannedClipSeconds(guide: VideoModelGuide, listed: readonly number[], options: { readonly withReferences?: boolean; readonly highRes?: boolean } = {}): number[] {
    let lengths = [...(listed.length ? listed : guide.clipSeconds)].filter(value => value > 0).sort((left, right) => left - right);
    const narrow = (allowed: readonly number[] | undefined): void => {
        if (!allowed?.length) return;
        const kept = lengths.filter(value => allowed.includes(value));
        lengths = kept.length ? kept : [...allowed];
    };
    if (options.withReferences) narrow(guide.clipSecondsWithReferences);
    if (options.highRes) narrow(guide.clipSecondsHighRes);
    return lengths;
}
