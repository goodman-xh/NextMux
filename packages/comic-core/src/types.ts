import type { CanvasCharacterProfile } from "./canvas-characters.js";
import type { ComicComposition } from "./composition.js";

export const COMIC_PROJECT_SCHEMA_VERSION = 2 as const;
export const COMIC_PROJECT_FILE = "nextmux.comic.json";
export const COMIC_MEDIA_DIRECTORY = "nextmux.media";

export type ComicFrameRate = 24 | 25 | 30;
export type ComicAspectRatio = "16:9" | "9:16" | "1:1" | "4:3";
export type ComicShotSize =
  | "extreme_wide"
  | "wide"
  | "medium"
  | "close_up"
  | "extreme_close_up";
export type ComicCameraMotion =
  | "static"
  | "push_in"
  | "pull_out"
  | "pan_left"
  | "pan_right"
  | "tilt_up"
  | "tilt_down"
  | "tracking"
  | "handheld"
  | "orbit"
  | "crane_up"
  | "crane_down"
  | "dolly_zoom"
  | "aerial"
  | "follow";
export type ComicCameraAngle = "eye_level" | "low" | "high" | "overhead" | "over_the_shoulder" | "pov" | "dutch";
export interface ComicLens {
  readonly focalLength: "wide" | "normal" | "telephoto";
  readonly depthOfField: "shallow" | "deep";
}
export interface ComicShotBeat {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly action: string;
}
/** Only application-created titles carry provenance; authored titles never follow the UI locale. */
export interface ComicDefaultTitle {
  readonly kind: "project" | "episode" | "scene" | "shot" | "copy" | "split";
  readonly locale: string;
  readonly index?: number;
  readonly baseTitle?: string;
  readonly baseDefault?: ComicDefaultTitle;
}
export type ComicShotStatus = "draft" | "ready" | "generating" | "generated" | "failed";
export type ComicTransition = "cut" | "fade" | "dissolve";
export type ComicAssetKind = "image" | "audio" | "music" | "effect" | "video" | "subtitle";
export type ComicAssetSource = "imported" | "generated";
export type ComicMediaSlot = "visual" | "audio" | "music" | "effect" | "subtitle" | "video";
/** How a picture or clip fills the canvas: whole frame letterboxed, or cropped to fill. */
export type ComicMediaFit = "contain" | "cover";

export interface ComicCanvas {
  readonly aspectRatio: ComicAspectRatio;
  readonly width: number;
  readonly height: number;
}

export interface ComicCharacter {
  /** Versioned canvas identity, outfits and verified non-secret bindings. */
  readonly canvasCharacter?: CanvasCharacterProfile;
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly appearance: string;
  readonly voice: string;
  readonly identityVersion?: string;
  readonly referenceAssetIds?: readonly string[];
  readonly authorizationRef?: string;
  /** Stable provenance when this character was imported from a reusable character bundle. */
  readonly sourceBundleId?: string;
  readonly sourceProjectId?: string;
  readonly sourceCharacterId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const COMIC_CHARACTER_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface ComicCharacterBundle {
  readonly schemaVersion: typeof COMIC_CHARACTER_BUNDLE_SCHEMA_VERSION;
  readonly bundleId: string;
  readonly sourceProjectId: string;
  readonly sourceCharacterId: string;
  readonly character: Pick<ComicCharacter, "name" | "aliases" | "description" | "appearance" | "voice" | "identityVersion" | "authorizationRef">;
  /** Metadata for the source images; bytes are copied by the platform layer during import. */
  readonly referenceAssets: readonly ComicAsset[];
  readonly createdAt: string;
}

export interface ComicDialogueCue {
  readonly id: string;
  /** A subtitle continuation after a visual cut; the authored text stays intact. */
  readonly continuationOfCueId?: string;
  readonly speakerCharacterId?: string;
  readonly text: string;
  readonly tone?: string;
  readonly startFrame: number;
  readonly durationFrames: number;
}

export interface ComicAsset {
  readonly id: string;
  readonly kind: ComicAssetKind;
  readonly source: ComicAssetSource;
  readonly uri: string;
  readonly status: "ready" | "missing" | "generating" | "failed";
  readonly prompt?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly sha256?: string;
  readonly jobId?: string;
  /** Previous asset this generated version was derived from, if any. */
  readonly sourceAssetId?: string;
  /** Measured when imported: playable length of audio or video. */
  readonly durationMs?: number;
  /** Selected stream's absolute media-clock start timestamp; source in/out remain stream-relative. Absent means zero. */
  readonly streamStartMs?: number;
  /** Measured pixel size of images and video. */
  readonly width?: number;
  readonly height?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ComicShot {
  readonly id: string;
  readonly title: string;
  readonly titleDefault?: ComicDefaultTitle;
  readonly description: string;
  readonly durationFrames: number;
  readonly shotSize: ComicShotSize;
  readonly cameraMotion: ComicCameraMotion;
  readonly cameraAngle?: ComicCameraAngle;
  readonly lens?: ComicLens;
  readonly transition?: ComicTransition;
  readonly beats?: readonly ComicShotBeat[];
  readonly searchTerms?: readonly string[];
  /** Adjacent shots with this ID form one continuous take. */
  readonly continuousTakeId?: string;
  readonly visualPrompt: string;
  readonly negativePrompt: string;
  readonly transitionIn: ComicTransition;
  readonly transitionOut: ComicTransition;
  /** Distinguishes an authored outgoing cut from the legacy neutral/default cut. */
  readonly transitionOutExplicit?: boolean;
  readonly volume: number;
  readonly fadeInFrames: number;
  readonly fadeOutFrames: number;
  readonly dialogueCues: readonly ComicDialogueCue[];
  readonly visualAssetId?: string;
  readonly audioAssetId?: string;
  /** Background tracks do not replace dialogue; multiple tracks may overlap. */
  readonly musicAssetIds?: readonly string[];
  readonly effectAssetIds?: readonly string[];
  readonly subtitleAssetId?: string;
  readonly videoAssetId?: string;
  /** A generated video revision awaiting explicit user approval. It is not part of the active timeline. */
  readonly pendingVideoAssetId?: string;
  /** Non-destructive in-points, keyed by the referenced time-based asset ID. */
  readonly mediaSourceStartFrames?: Readonly<Record<string, number>>;
  /** Explicit out-points for individual sound/subtitle clips; absent plays to the shot/source end. */
  readonly mediaDurationFrames?: Readonly<Record<string, number>>;
  /** Picture and clip framing; absent means "contain" (letterboxed). */
  readonly mediaFit?: ComicMediaFit;
  readonly status: ComicShotStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ComicScene {
  readonly id: string;
  /** Optional episode ownership; omitted on legacy/manual single-episode scenes. */
  readonly episodeNumber?: number;
  readonly title: string;
  readonly titleDefault?: ComicDefaultTitle;
  readonly summary: string;
  readonly location: string;
  readonly timeOfDay: string;
  readonly setPlateAssetId?: string;
  readonly shots: readonly ComicShot[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * What the project is for; it only changes how the studio presents it. Absent means "novel"
 * (every project made before the three kinds existed).
 *   novel — a novel or script adapted into episodes, scenes and shots
 *   image — pictures the user brings, each animated by a video model from a motion prompt
 *   topic — a topic or keywords; AI writes the narration, then pictures, voice, subtitles, music
 */
/** chat: a folder the user picked for the conversation mode (高级): media made in its chats, and one edit. */
export type ComicProjectKind = "novel" | "image" | "topic" | "music" | "chat";

/** One episode's script, written by the adaptation and edited by the user before its shots are made. */
export interface ComicEpisodeScript {
  /** Source range is zero-based UTF-16, with an exclusive end. */
  readonly sourceRange?: { readonly start: number; readonly end: number };
  readonly outline?: string;
  readonly ending?: string;
  readonly number: number;
  readonly title: string;
  readonly titleDefault?: ComicDefaultTitle;
  readonly script: string;
}

/**
 * A song (the “音乐制作” kind): lyrics with section tags, how it should sound, and which generated
 * version is the song. Versions are the project's music assets; the song's one shot carries the
 * chosen version as its sound track (and a cover picture as its visual) for the video export.
 */
export interface ComicMusicSettings {
  /** Restyling a song is separate from singing with a reference voice. */
  readonly mode?: "generate" | "cover";
  readonly vocalSource?: "default" | "my_voice";
  readonly vocalReferenceAssetId?: string;
  /** Consent is for the selected sample; choosing another sample resets it. */
  readonly vocalReferenceConsent?: boolean;
  readonly referenceSongAssetId?: string;
  readonly lyrics: string;
  /** No vocals: the lyrics are kept but not sung. */
  readonly instrumental: boolean;
  /** Preset ids or the user's own words ("" = let the model decide). */
  readonly genre: string;
  readonly mood: string;
  readonly tempo: string;
  readonly vocals: string;
  readonly language: string;
  /** Anything else about the sound: instruments, era, references. */
  readonly style: string;
  /** A full song or a 30-second clip. */
  readonly length: "full" | "clip";
  readonly format: "mp3" | "wav";
  /** The version chosen as the song. */
  readonly selectedAssetId?: string;
  /** When the song (audio or video) was last exported. */
  readonly exportedAt?: string;
  /** Lyric timing and visuals belong to this exact song version and lyrics snapshot. */
  readonly mv?: ComicMusicMvSettings;
}

export type ComicMusicLyricAlignment = "estimated" | "recognized" | "tapped" | "manual";

export interface ComicMusicLyricLine {
  readonly id: string;
  readonly sectionIndex: number;
  readonly sectionTitle: string;
  /** Authored words, never replaced with speech-recognition output. */
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly alignment?: ComicMusicLyricAlignment;
}

export interface ComicMusicMvSegment {
  readonly id: string;
  readonly sectionIndex: number;
  readonly sectionTitle: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly lineIds: readonly string[];
  readonly prompt: string;
  readonly performance?: boolean;
  readonly source: "ai-video" | "upload-image" | "upload-video";
  readonly assetId?: string;
  /** Reuses the ordinary comic video queue and its job ownership. */
  readonly shotId?: string;
  readonly jobId?: string;
}

export interface ComicMusicMvTreatment {
  readonly protagonist: string;
  readonly palette: readonly string[];
  readonly recurringImages: readonly string[];
}

export interface ComicMusicMvSettings {
  readonly treatment?: ComicMusicMvTreatment;
  readonly singerPortraitAssetId?: string;
  readonly songAssetId?: string;
  readonly lyrics: string;
  readonly durationMs: number;
  readonly alignment: ComicMusicLyricAlignment;
  readonly lines: readonly ComicMusicLyricLine[];
  readonly segments: readonly ComicMusicMvSegment[];
}

/**
 * The creative settings an adaptation follows. Each choice is a preset id from
 * adaptation-settings.ts ("default" follows the text) or the user's own words.
 */
export interface ComicAdaptSettings {
  readonly episodes: number;
  readonly episodeSeconds: number;
  readonly perspective: string;
  readonly style: string;
  readonly look: string;
  readonly costume: string;
  readonly lighting: string;
  readonly pacing: string;
  readonly sound: string;
  /** The video model's clip lengths when the shots were planned (seconds). */
  readonly clipSeconds?: readonly number[];
}

export interface ComicProject {
  /** Last application locale used to create defaults, independent of the project title. */
  readonly defaultTitleLocale?: string;
  readonly schemaVersion: typeof COMIC_PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly projectKind?: ComicProjectKind;
  readonly revision: number;
  readonly title: string;
  readonly titleDefault?: ComicDefaultTitle;
  readonly frameRate: ComicFrameRate;
  readonly canvas: ComicCanvas;
  readonly styleBible: string;
  /** Off by default; first-frame capable models reuse the previous clip ending. */
  readonly continuousShotsShareFrames?: boolean;
  /** Episode scripts from the adaptation; shots are made from them. */
  readonly episodes?: readonly ComicEpisodeScript[];
  readonly adaptSettings?: ComicAdaptSettings;
  /** The song of a music project. */
  readonly music?: ComicMusicSettings;
  readonly characters: readonly ComicCharacter[];
  readonly assets: readonly ComicAsset[];
  readonly scenes: readonly ComicScene[];
  /** Free multitrack editor. Absent until the first edit of a legacy timeline. */
  readonly composition?: ComicComposition;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ComicProjectSummary {
  readonly sceneCount: number;
  readonly shotCount: number;
  readonly durationFrames: number;
  readonly durationSeconds: number;
}

export interface ComicIdFactory {
  (prefix: "project" | "character" | "asset" | "scene" | "shot" | "dialogue"): string;
}

export interface CreateComicProjectOptions {
  readonly locale?: string;
  readonly title?: string;
  readonly projectKind?: ComicProjectKind;
  readonly frameRate?: ComicFrameRate;
  readonly canvas?: ComicCanvas;
  readonly starter?: "storyboard" | "empty";
  readonly now?: string;
  readonly idFactory?: ComicIdFactory;
}

export interface ComicSceneDraft {
  readonly setPlateAssetId?: string | null;
  readonly titleDefault?: ComicDefaultTitle;
  readonly episodeNumber?: number;
  readonly title?: string;
  readonly summary?: string;
  readonly location?: string;
  readonly timeOfDay?: string;
}

export interface ComicShotDraft {
  readonly titleDefault?: ComicDefaultTitle;
  readonly cameraAngle?: ComicCameraAngle | null;
  readonly lens?: ComicLens | null;
  readonly transition?: ComicTransition | null;
  readonly beats?: readonly ComicShotBeat[];
  readonly searchTerms?: readonly string[];
  readonly continuousTakeId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly durationFrames?: number;
  readonly shotSize?: ComicShotSize;
  readonly cameraMotion?: ComicCameraMotion;
  readonly visualPrompt?: string;
  readonly negativePrompt?: string;
  readonly transitionIn?: ComicTransition;
  readonly transitionOut?: ComicTransition;
  readonly volume?: number;
  readonly fadeInFrames?: number;
  readonly fadeOutFrames?: number;
  readonly mediaFit?: ComicMediaFit;
}

export interface ComicDialogueCueDraft {
  readonly tone?: string;
  readonly id?: string;
  readonly continuationOfCueId?: string;
  readonly speakerCharacterId?: string;
  readonly text: string;
  readonly startFrame?: number;
  readonly durationFrames?: number;
}

export interface ComicGeneratedAssetDraft {
  readonly id: string;
  readonly kind: ComicAssetKind;
  readonly uri: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly jobId: string;
  readonly prompt?: string;
  readonly provider: string;
  readonly model: string;
  readonly source?: ComicAssetSource;
  readonly sourceAssetId?: string;
  readonly durationMs?: number;
  readonly streamStartMs?: number;
  readonly width?: number;
  readonly height?: number;
}

interface ComicCommandBase {
  readonly expectedRevision: number;
}

export type ComicCommand =
  | (ComicCommandBase & {
      readonly type: "project.update";
      readonly patch: {
        readonly title?: string;
        readonly titleDefault?: ComicDefaultTitle;
        readonly continuousShotsShareFrames?: boolean;
        readonly frameRate?: ComicFrameRate;
        readonly canvas?: ComicCanvas;
        readonly styleBible?: string;
        /** Replaces every episode script; an empty list removes them. */
        readonly episodes?: readonly ComicEpisodeScript[];
        readonly adaptSettings?: ComicAdaptSettings;
        readonly music?: ComicMusicSettings;
      };
    })
  | (ComicCommandBase & {
      readonly type: "scene.add";
      /** Omit to append; null inserts at the beginning. */
      readonly afterSceneId?: string | null;
      readonly scene?: ComicSceneDraft;
    })
  | (ComicCommandBase & {
      readonly type: "scene.update";
      readonly sceneId: string;
      readonly patch: ComicSceneDraft;
    })
  | (ComicCommandBase & {
      readonly type: "scene.delete";
      readonly sceneId: string;
    })
  | (ComicCommandBase & {
      readonly type: "shot.add";
      readonly sceneId: string;
      /** Omit to append; null inserts at the beginning. */
      readonly afterShotId?: string | null;
      readonly shot?: ComicShotDraft;
      readonly cues?: readonly ComicDialogueCueDraft[];
    })
  | (ComicCommandBase & {
      readonly type: "shot.update";
      readonly sceneId: string;
      readonly shotId: string;
      readonly patch: ComicShotDraft;
      /** When present, updates shot fields and dialogue in one revision. */
      readonly cues?: readonly ComicDialogueCueDraft[];
    })
  | (ComicCommandBase & {
      /** Split one shot at a frame boundary without duplicating its media assets. */
      readonly type: "shot.split";
      readonly sceneId: string;
      readonly shotId: string;
      readonly splitAtFrame: number;
    })
  | (ComicCommandBase & {
      readonly type: "shot.delete";
      readonly sceneId: string;
      readonly shotId: string;
    })
  | (ComicCommandBase & {
      /** Copy a shot right after itself; its media stays shared, dialogue gets new IDs. */
      readonly type: "shot.duplicate";
      readonly sceneId: string;
      readonly shotId: string;
    })
  | (ComicCommandBase & {
      /**
       * Cut `frames` off the head of a shot (negative restores trimmed frames). Linked
       * time-based media keeps its sync: in-points move by the same amount.
       */
      readonly type: "shot.trim_start";
      readonly sceneId: string;
      readonly shotId: string;
      readonly frames: number;
    })
  | (ComicCommandBase & {
      /** Link media already in the project library to a shot slot (kinds must match). */
      readonly type: "media.link";
      readonly sceneId: string;
      readonly shotId: string;
      readonly slot: ComicMediaSlot;
      readonly assetId: string;
    })
  | (ComicCommandBase & {
      /**
       * A music project's chosen song version: it becomes the only music on the song's shot (the first
       * shot), the shot takes the song's length when given, and the choice is remembered in `music`.
       */
      readonly type: "music.select";
      readonly assetId: string;
      readonly durationFrames?: number;
    })
  | (ComicCommandBase & {
      /** Unlink media from a shot; the asset stays in the library. */
      readonly type: "media.detach";
      readonly sceneId: string;
      readonly shotId: string;
      readonly slot: ComicMediaSlot;
      /** Music and effect lists: the asset to remove (all of them when omitted). */
      readonly assetId?: string;
    })
  | (ComicCommandBase & {
      /** Where a linked time-based asset starts playing within its file. */
      readonly type: "media.set_start";
      readonly sceneId: string;
      readonly shotId: string;
      readonly assetId: string;
      readonly startFrame: number;
    })
  | (ComicCommandBase & {
      /** Trim one sound/subtitle out-point without changing the containing picture shot. */
      readonly type: "media.set_duration";
      readonly sceneId: string;
      readonly shotId: string;
      readonly assetId: string;
      readonly durationFrames: number;
    })
  | (ComicCommandBase & {
      readonly type: "shot.move";
      readonly sceneId: string;
      readonly shotId: string;
      readonly targetSceneId: string;
      /** Omit to append; null inserts at the beginning. */
      readonly afterShotId?: string | null;
    })
  | (ComicCommandBase & {
      readonly type: "dialogue.replace";
      readonly sceneId: string;
      readonly shotId: string;
      readonly cues: readonly ComicDialogueCueDraft[];
    })
  | (ComicCommandBase & {
      readonly type: "shot.status";
      readonly sceneId: string;
      readonly shotId: string;
      readonly status: ComicShotStatus;
    })
  | (ComicCommandBase & {
      readonly type: "media.attach";
      readonly sceneId: string;
      readonly shotId: string;
      readonly slot: ComicMediaSlot;
      readonly asset: ComicGeneratedAssetDraft;
      /** Keep a generated video as a preview until the user explicitly applies it. */
      readonly deferToPending?: boolean;
    })
  | (ComicCommandBase & {
      /** Adds an imported/generated asset to the project without linking a shot slot. */
      readonly type: "asset.import";
      readonly asset: ComicGeneratedAssetDraft;
    })
  | (ComicCommandBase & {
      readonly type: "shot.apply_pending_video";
      readonly sceneId: string;
      readonly shotId: string;
    })
  | (ComicCommandBase & {
      readonly type: "shot.discard_pending_video";
      readonly sceneId: string;
      readonly shotId: string;
    })
  | (ComicCommandBase & {
      readonly type: "character.add";
      readonly character: {
        readonly name: string;
        readonly aliases?: readonly string[];
        readonly description?: string;
        readonly appearance?: string;
        readonly voice?: string;
        readonly identityVersion?: string;
        readonly referenceAssetIds?: readonly string[];
        readonly authorizationRef?: string;
        readonly sourceBundleId?: string;
        readonly sourceProjectId?: string;
        readonly sourceCharacterId?: string;
      };
    })
  | (ComicCommandBase & {
      readonly type: "character.update";
      readonly characterId: string;
      readonly patch: {
        readonly name?: string;
        readonly aliases?: readonly string[];
        readonly description?: string;
        readonly appearance?: string;
        readonly voice?: string;
        readonly identityVersion?: string;
        readonly referenceAssetIds?: readonly string[];
        readonly authorizationRef?: string;
        readonly sourceBundleId?: string;
        readonly sourceProjectId?: string;
        readonly sourceCharacterId?: string;
      };
    })
  | (ComicCommandBase & {
      readonly type: "character.delete";
      readonly characterId: string;
    });

export interface ApplyComicCommandOptions {
  readonly locale?: string;
  readonly now?: string;
  readonly idFactory?: ComicIdFactory;
}

export interface ParseComicProjectOptions {
  readonly locale?: string;
  readonly now?: string;
  readonly idFactory?: ComicIdFactory;
}

export interface ParsedComicProject {
  readonly project: ComicProject;
  readonly migratedFrom?: number;
}
