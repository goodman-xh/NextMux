import { comicTitleWithDefault } from "./default-titles.js";
import type { ComicDefaultTitle, ComicCameraAngle, ComicLens, ComicShotBeat, ComicTransition } from "./types.js";
/**
 * Provider-neutral contracts for the comic-drama production pipeline.
 *
 * The existing ComicProject schema remains the durable storyboard format. These
 * contracts describe the production layer around it without forcing every
 * provider to look like a chat completion endpoint.
 */

export const COMIC_PIPELINE_SCHEMA_VERSION = 1 as const;

export type ComicProviderCapability =
  | "text_to_image"
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "native_audio"
  | "native_subtitle"
  | "tts"
  | "transcription"
  | "music_generation"
  | "sound_effect_generation"
  | "lip_sync"
  | "video_extend"
  | "first_last_frame"
  | "frame_edit"
  | "segment_edit"
  | "async_poll"
  | "webhook"
  | "cancel";

export const COMIC_PROVIDER_CAPABILITIES: readonly ComicProviderCapability[] = [
  "text_to_image",
  "text_to_video",
  "image_to_video",
  "reference_to_video",
  "native_audio",
  "native_subtitle",
  "tts",
  "transcription",
  "music_generation",
  "sound_effect_generation",
  "lip_sync",
  "video_extend",
  "first_last_frame",
  "frame_edit",
  "segment_edit",
  "async_poll",
  "webhook",
  "cancel",
] as const;

export type ComicCapabilityStatus = "supported" | "unsupported" | "unknown";

export interface ComicProviderCapabilityEvidence {
  readonly capability: ComicProviderCapability;
  readonly status: ComicCapabilityStatus;
  readonly source: "provider_metadata" | "merchant_declaration" | "live_probe" | "manual_override";
  readonly reason?: string;
  readonly observedAt?: string;
}

export interface ComicProviderCapabilityProfile {
  readonly providerId: string;
  readonly modelId: string;
  readonly protocol: string;
  readonly capabilities: readonly ComicProviderCapabilityEvidence[];
  readonly updatedAt: string;
}

export interface ComicProjectEntityBase {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Provenance is optional for hand-authored entities and required for generated assets/jobs. */
  readonly sourceProviderId?: string;
  readonly sourceModelId?: string;
  readonly sourceJobId?: string;
  readonly estimatedCostMicros?: number;
  readonly actualCostMicros?: number;
  readonly supersedesId?: string;
}

export interface ComicEpisode extends ComicProjectEntityBase {
  readonly titleDefault?: ComicDefaultTitle;
  readonly projectId: string;
  readonly number: number;
  readonly title: string;
  readonly summary: string;
  readonly sceneIds: readonly string[];
  readonly timelineId?: string;
  readonly status: "draft" | "planning" | "generating" | "ready" | "failed";
}

export interface ComicSceneEntity extends ComicProjectEntityBase {
  readonly titleDefault?: ComicDefaultTitle;
  readonly episodeId: string;
  readonly order: number;
  readonly title: string;
  readonly summary: string;
  readonly location: string;
  readonly timeOfDay: string;
  readonly setPlateAssetId?: string;
  readonly shotIds: readonly string[];
}

export interface ComicShotEntity extends ComicProjectEntityBase {
  readonly titleDefault?: ComicDefaultTitle;
  readonly episodeId: string;
  readonly sceneId: string;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly durationFrames: number;
  readonly transition?: ComicTransition;
  readonly cameraAngle?: ComicCameraAngle;
  readonly lens?: ComicLens;
  readonly beats?: readonly ComicShotBeat[];
  readonly searchTerms?: readonly string[];
  readonly continuousTakeId?: string;
  readonly transitionIn?: "cut" | "fade" | "dissolve";
  readonly transitionOut?: "cut" | "fade" | "dissolve";
  readonly transitionOutExplicit?: boolean;
  readonly volume?: number;
  readonly fadeInFrames?: number;
  readonly fadeOutFrames?: number;
  readonly visualPrompt: string;
  readonly negativePrompt: string;
  readonly referenceAssetIds: readonly string[];
  readonly videoAssetId?: string;
  readonly videoSourceStartFrame?: number;
  readonly audioTrackId?: string;
  readonly musicTrackIds?: readonly string[];
  readonly effectTrackIds?: readonly string[];
  readonly subtitleTrackId?: string;
  readonly status: "draft" | "queued" | "generating" | "ready" | "failed";
}

export interface ComicCharacterEntity extends ComicProjectEntityBase {
  readonly projectId: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly appearance: string;
  readonly style: string;
  readonly identityVersion?: string;
  readonly voiceId?: string;
  readonly referenceAssetIds: readonly string[];
  readonly authorizationRef?: string;
  readonly sourceBundleId?: string;
  readonly sourceProjectId?: string;
  readonly sourceCharacterId?: string;
}

export interface ComicMediaAssetEntity extends ComicProjectEntityBase {
  readonly projectId: string;
  readonly kind: "image" | "video" | "audio" | "subtitle" | "music" | "effect";
  readonly uri: string;
  readonly mimeType: string;
  readonly sha256: string;
  readonly byteLength?: number;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly renderJobId?: string;
  readonly sourceAssetId?: string;
  readonly status: "pending" | "ready" | "failed" | "superseded";
}

export interface ComicAudioTrack extends ComicProjectEntityBase {
  readonly projectId: string;
  readonly episodeId: string;
  readonly kind: "dialogue" | "music" | "effect" | "mixed";
  readonly assetId?: string;
  readonly language?: string;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly volume: number;
  readonly source: "native_video" | "tts" | "imported" | "generated";
  readonly providerId?: string;
  readonly modelId?: string;
  readonly renderJobId?: string;
  readonly sourceStartFrame?: number;
}

export interface ComicSubtitleCue {
  readonly id: string;
  readonly text: string;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly speakerCharacterId?: string;
}

export interface ComicSubtitleTrack extends ComicProjectEntityBase {
  readonly projectId: string;
  readonly episodeId: string;
  readonly assetId?: string;
  readonly language: string;
  readonly format: "srt" | "vtt" | "ass";
  readonly cues: readonly ComicSubtitleCue[];
  readonly source: "native_video" | "whisperx" | "funasr" | "manual";
  readonly providerId?: string;
  readonly modelId?: string;
  readonly renderJobId?: string;
  readonly sourceStartFrame?: number;
}

export interface ComicTimelineClip {
  readonly id: string;
  readonly trackId: string;
  readonly kind?: "video" | "audio" | "subtitle";
  readonly shotId?: string;
  readonly assetId?: string;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly sourceStartFrame: number;
  readonly sourceDurationFrames: number;
  readonly transitionIn?: "cut" | "fade" | "dissolve";
  readonly transitionOut?: "cut" | "fade" | "dissolve";
  readonly volume?: number;
  readonly fadeInFrames?: number;
  readonly fadeOutFrames?: number;
}

export interface ComicTimeline extends ComicProjectEntityBase {
  readonly projectId: string;
  readonly episodeId: string;
  readonly frameRate: 24 | 25 | 30;
  readonly width: number;
  readonly height: number;
  readonly clips: readonly ComicTimelineClip[];
  readonly audioTrackIds: readonly string[];
  readonly subtitleTrackIds: readonly string[];
  readonly renderer: "ffmpeg" | "remotion" | "mlt";
}

/** Shared by the editor, production timeline and final media export. */
export function resolveComicShotTransitions(
  shot: { readonly transition?: ComicTransition; readonly transitionIn?: ComicTransition; readonly transitionOut?: ComicTransition; readonly transitionOutExplicit?: boolean },
  position: { readonly firstInEpisode: boolean; readonly lastInEpisode: boolean; readonly acrossScenes: boolean },
): { readonly transitionIn: ComicTransition; readonly transitionOut: ComicTransition } {
  return {
    transitionIn: shot.transition ?? shot.transitionIn
      ?? (position.firstInEpisode ? "fade" : position.acrossScenes ? "dissolve" : "cut"),
    transitionOut: shot.transitionOut ?? (position.lastInEpisode ? "fade" : "cut"),
  };
}

/**
 * Frames shared by adjacent shots, keyed by the incoming shot. The two overlaps of a
 * middle shot share one budget, so even a chain of short dissolves retains a sole frame
 * of every shot. Preview, subtitles and export must all use this same schedule.
 */
export function getComicDissolveOverlaps(
  shots: readonly { readonly shotId: string; readonly durationFrames: number;
    readonly transitionIn?: ComicTransition; readonly transitionOut?: ComicTransition }[],
  frameRate: number,
): ReadonlyMap<string, number> {
  const overlaps = new Map<string, number>();
  const desired = Math.max(1, Math.round(frameRate * 0.35));
  for (let index = 1; index < shots.length; index += 1) {
    const previous = shots[index - 1]!;
    const current = shots[index]!;
    if (previous.transitionOut !== "dissolve" && current.transitionIn !== "dissolve") continue;
    const frames = Math.min(desired,
      previous.durationFrames - (overlaps.get(previous.shotId) ?? 0) - 1,
      current.durationFrames - 1);
    if (frames > 0) overlaps.set(current.shotId, frames);
  }
  return overlaps;
}

/** Frame-aligned fade defaults that also fit one-frame and other very short shots. */
export function resolveComicShotFades(
  shot: { readonly durationFrames: number; readonly fadeInFrames?: number; readonly fadeOutFrames?: number;
    readonly transitionIn?: ComicTransition; readonly transitionOut?: ComicTransition },
  frameRate: number,
): { readonly fadeInFrames: number; readonly fadeOutFrames: number } {
  const automatic = Math.max(1, Math.round(frameRate * 0.12));
  const fadeInFrames = Math.min(shot.durationFrames, Math.max(0, shot.fadeInFrames ?? (shot.transitionIn === "fade" ? automatic : 0)));
  const fadeOutFrames = Math.min(shot.durationFrames - fadeInFrames,
    Math.max(0, shot.fadeOutFrames ?? (shot.transitionOut === "fade" ? automatic : 0)));
  return { fadeInFrames, fadeOutFrames };
}

/** Create a deterministic first-pass timeline from ordered storyboard shots. */
export function buildComicTimeline(
  projectId: string,
  episode: ComicEpisode,
  scenes: readonly ComicSceneEntity[],
  shots: readonly ComicShotEntity[],
  options: {
    readonly frameRate: 24 | 25 | 30;
    readonly width: number;
    readonly height: number;
    readonly now: string;
    readonly renderer?: "ffmpeg" | "remotion" | "mlt";
  },
): ComicTimeline {
  const orderedSceneIds = [...scenes]
    .filter(scene => scene.episodeId === episode.id)
    .sort((left, right) => left.order - right.order)
    .map(scene => scene.id);
  const orderedShots = orderedSceneIds.flatMap(sceneId => [...shots]
    .filter(shot => shot.episodeId === episode.id && shot.sceneId === sceneId)
    .sort((left, right) => left.order - right.order));
  const transitions = orderedShots.map((shot, index) => resolveComicShotTransitions(shot, {
    firstInEpisode: index === 0, lastInEpisode: index === orderedShots.length - 1,
    acrossScenes: index > 0 && orderedShots[index - 1]!.sceneId !== shot.sceneId,
  }));
  const overlaps = getComicDissolveOverlaps(orderedShots.map((shot, index) => ({
    shotId: shot.id, durationFrames: shot.durationFrames, ...transitions[index],
  })), options.frameRate);
  let cursor = 0;
  const clips = orderedShots.map((shot, index) => {
    const { transitionIn, transitionOut } = transitions[index]!;
    cursor -= overlaps.get(shot.id) ?? 0;
    const clip: ComicTimelineClip = {
      id: `clip-${shot.id.slice(shot.id.indexOf("-") + 1)}`,
      trackId: "video",
      kind: "video",
      ...(shot.videoAssetId ? { assetId: shot.videoAssetId } : {}),
      shotId: shot.id,
      startFrame: cursor,
      durationFrames: shot.durationFrames,
      sourceStartFrame: shot.videoAssetId ? shot.videoSourceStartFrame || 0 : 0,
      sourceDurationFrames: shot.durationFrames,
      transitionIn,
      transitionOut,
      ...(shot.volume === undefined ? {} : { volume: shot.volume }),
      ...(shot.fadeInFrames === undefined ? {} : { fadeInFrames: shot.fadeInFrames }),
      ...(shot.fadeOutFrames === undefined ? {} : { fadeOutFrames: shot.fadeOutFrames }),
    };
    cursor += shot.durationFrames;
    return clip;
  });
  return {
    id: `timeline-${episode.id.slice(episode.id.indexOf("-") + 1)}`,
    version: 1,
    createdAt: options.now,
    updatedAt: options.now,
    projectId,
    episodeId: episode.id,
    frameRate: options.frameRate,
    width: options.width,
    height: options.height,
    clips,
    audioTrackIds: [],
    subtitleTrackIds: [],
    renderer: options.renderer ?? "ffmpeg",
  };
}

export type ComicRenderJobKind =
  | "script_analysis"
  | "character_generation"
  | "storyboard_generation"
  | "asset_generation"
  | "video_generation"
  | "voice_generation"
  | "music_generation"
  | "sound_effect_generation"
  | "subtitle_generation"
  | "shot_edit"
  | "timeline_render";

export type ComicRenderJobStatus =
  | "awaiting_confirmation"
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ComicRenderJob extends ComicProjectEntityBase {
  readonly projectId: string;
  readonly episodeId?: string;
  readonly shotIds: readonly string[];
  readonly kind: ComicRenderJobKind;
  readonly status: ComicRenderJobStatus;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly checkpoint?: {
    readonly stage: string;
    readonly assetIds: readonly string[];
    readonly updatedAt: string;
  };
  readonly providerId?: string;
  readonly modelId?: string;
  readonly estimatedCostMicros?: number;
  readonly actualCostMicros?: number;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

/** Source script kept in the production sidecar, separate from storyboard JSON. */
export interface ComicScriptDocument {
  readonly text: string;
  readonly language: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly source: "user" | "imported" | "generated";
}

export interface ComicScriptEpisodePlan {
  readonly titleDefault?: ComicDefaultTitle;
  readonly number: number;
  readonly title: string;
  readonly summary: string;
  readonly sourceStartLine: number;
  readonly sourceEndLine: number;
}

/** A scene boundary explicitly present in the source script. */
export interface ComicScriptScenePlan {
  readonly titleDefault?: ComicDefaultTitle;
  readonly episodeNumber: number;
  readonly order: number;
  readonly title: string;
  readonly summary: string;
  readonly location: string;
  readonly timeOfDay: string;
  readonly characterNames: readonly string[];
  readonly sourceStartLine: number;
  readonly sourceEndLine: number;
}

export interface ComicScriptAnalysis {
  readonly version: number;
  readonly status: "pending" | "ready";
  readonly episodes: readonly ComicScriptEpisodePlan[];
  readonly scenePlans: readonly ComicScriptScenePlan[];
  readonly characterNames: readonly string[];
  readonly updatedAt: string;
}

/**
 * Deterministic first-pass analysis used before an LLM-backed analysis job is
 * available. It intentionally extracts structure only; it never invents
 * scenes, dialogue, or characters from an unstructured paragraph.
 */

/**
 * A screenplay speaker label ("闰土：…", "MOM: …"): a short name, not a narrative sentence that
 * happens to end in a colon ("他忽然问道：", "这时候，我的脑里忽然闪出一幅神异的图画来：").
 */
function speakerLabel(name: string): boolean {
  if (!name || [...name].length > 12) return false;
  if (/[，。！？、；,.!?;…—“”"『』「」（）()《》\s]/u.test(name)) return false;
  if (/^(?:我|你|他|她|它|我们|你们|他们|她们|它们|大家|有人|自己)$/u.test(name)) return false;
  return !/(?:说|道|问|答|喊|叫|想|笑)$/u.test(name) || [...name].length <= 3 && !/^(?:他|她|我|你)/u.test(name);
}

export function analyzeComicScript(text: string, now: string, locale = "zh-CN"): ComicScriptAnalysis {
  if (!text.trim()) return { version: 1, status: "pending", episodes: [], scenePlans: [], characterNames: [], updatedAt: now };
  const lines = text.split(/\r?\n/);
  const headings = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => /^(?:第\s*\d+\s*[集章]|EP(?:ISODE)?\s*\d+|Episode\s*\d+)/iu.test(line));
  const starts = headings.length ? headings : [{ line: "", index: 0 }];
  const episodes = starts.map((heading, index) => {
    const match = heading.line.match(/(?:第\s*(\d+)\s*[集章]|EP(?:ISODE)?\s*(\d+))/iu);
    const number = Number(match?.[1] ?? match?.[2] ?? index + 1) || index + 1;
    const title = heading.line.replace(/^(?:第\s*\d+\s*[集章]|EP(?:ISODE)?\s*\d+)[：:\-\s]*/iu, "").trim();
    const end = starts[index + 1]?.index === undefined ? Math.max(heading.index, lines.length - 1) : starts[index + 1].index - 1;
    const body = lines.slice(headings.length ? heading.index + 1 : heading.index, end + 1).join(" ").trim();
    return {
      number,
      ...(title ? { title } : comicTitleWithDefault("episode", locale, number)),
      summary: body.slice(0, 240),
      sourceStartLine: heading.index + 1,
      sourceEndLine: end + 1,
    };
  });
  const characterNames = [...text.matchAll(/(?:^|\n)\s*([^\n：:]{1,40})\s*[：:]/gu)]
    .map(match => match[1].trim())
    .filter(speakerLabel)
    .filter(name => !/^(?:旁白|scene|场景|地点|时间|镜头|第\s*\d+)/iu.test(name))
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 200);

  const sceneHeading = /^(?:(?:场景|场次|SCENE)\s*\d*\s*[:：.\-]?\s*|(?:INT\.|EXT\.|内景|外景)\s+)/iu;
  const scenePlans: ComicScriptScenePlan[] = [];
  for (const episode of episodes) {
    const episodeStart = Math.max(0, episode.sourceStartLine - 1);
    const episodeEnd = Math.min(lines.length - 1, episode.sourceEndLine - 1);
    const headingsInEpisode = lines
      .map((line, index) => ({ line: line.trim(), index }))
      .filter(item => item.index >= episodeStart && item.index <= episodeEnd && sceneHeading.test(item.line));
    headingsInEpisode.forEach((heading, order) => {
      const end = headingsInEpisode[order + 1]?.index === undefined
        ? episodeEnd
        : headingsInEpisode[order + 1].index - 1;
      const bodyStart = Math.min(heading.index + 1, end + 1);
      const body = lines.slice(bodyStart, end + 1).join(" ").trim();
      const rawTitle = heading.line.replace(sceneHeading, "").trim();
      const [locationPart, timePart] = rawTitle.split(/\s*[|｜]\s*/u);
      const location = locationPart.replace(/\s*[（(](?:白天|夜晚|清晨|黄昏|白昼|夜)[）)]\s*$/u, "").trim();
      const timeMatch = rawTitle.match(/(?:时间|时段)\s*[：:]\s*([^|｜]+)/u);
      const timeOfDay = timeMatch?.[1]?.trim()
        || timePart?.match(/^(?:白天|夜晚|清晨|黄昏|白昼|夜)$/u)?.[0]
        || (rawTitle.match(/[（(](白天|夜晚|清晨|黄昏|白昼|夜)[）)]/u)?.[1] || "");
      const localCharacters = [...body.matchAll(/(?:^|\s|\n)([^\s：:]{1,40})\s*[：:]/gu)]
        .map(match => match[1].trim())
        .filter(speakerLabel)
        .filter(name => !/^(?:旁白|scene|场景|地点|时间|镜头|第\s*\d+)/iu.test(name))
        .filter((name, index, all) => all.indexOf(name) === index);
      scenePlans.push({
        episodeNumber: episode.number,
        order,
        ...(rawTitle ? { title: rawTitle } : comicTitleWithDefault("scene", locale, order + 1)),
        summary: body.slice(0, 500),
        location,
        timeOfDay,
        characterNames: localCharacters,
        sourceStartLine: heading.index + 1,
        sourceEndLine: end + 1,
      });
    });
  }
  return { version: 1, status: "ready", episodes, scenePlans, characterNames, updatedAt: now };
}

export interface ComicProductionProject extends ComicProjectEntityBase {
  readonly schemaVersion: typeof COMIC_PIPELINE_SCHEMA_VERSION;
  readonly title: string;
  readonly episodeIds: readonly string[];
  readonly characterIds: readonly string[];
  readonly sceneIds: readonly string[];
  readonly assetIds: readonly string[];
  readonly timelineIds: readonly string[];
  readonly renderJobIds: readonly string[];
}

/**
 * Durable production-layer manifest. The existing nextmux.comic.json remains
 * the storyboard file; this sidecar keeps episode/timeline/provider state
 * without forcing older projects through a destructive schema migration.
 */
export interface ComicProductionDocument {
  readonly schemaVersion: typeof COMIC_PIPELINE_SCHEMA_VERSION;
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  /** Storyboard revision last projected into this independently-versioned sidecar. */
  readonly storyboardRevision?: number;
  readonly title: string;
  readonly episodes: readonly ComicEpisode[];
  readonly scenes: readonly ComicSceneEntity[];
  readonly shots: readonly ComicShotEntity[];
  readonly characters: readonly ComicCharacterEntity[];
  readonly assets: readonly ComicMediaAssetEntity[];
  readonly audioTracks: readonly ComicAudioTrack[];
  readonly subtitleTracks: readonly ComicSubtitleTrack[];
  readonly timelines: readonly ComicTimeline[];
  readonly renderJobs: readonly ComicRenderJob[];
  readonly providerProfiles: readonly ComicProviderCapabilityProfile[];
  readonly script?: ComicScriptDocument;
  readonly scriptAnalysis?: ComicScriptAnalysis;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ComicVoiceCommandContext {
  readonly projectId: string;
  readonly episodeId?: string;
  readonly currentFrame?: number;
  readonly currentShotId?: string;
}

export type ComicVoiceCommand =
  | { readonly type: "play" }
  | { readonly type: "pause" }
  | { readonly type: "seek_episode"; readonly episodeNumber: number }
  | { readonly type: "seek_time"; readonly episodeNumber?: number; readonly seconds: number; readonly hold?: boolean }
  | { readonly type: "locate_shot"; readonly episodeNumber?: number; readonly shotNumber: number }
  | { readonly type: "rewind"; readonly seconds: number }
  | { readonly type: "forward"; readonly seconds: number }
  | { readonly type: "change_speed"; readonly speed: number }
  | { readonly type: "edit_subtitle"; readonly text: string }
  | { readonly type: "edit_frame"; readonly instruction: string }
  | { readonly type: "edit_segment"; readonly instruction: string; readonly startSeconds?: number; readonly endSeconds?: number; readonly durationSeconds?: number }
  | { readonly type: "regenerate_shot"; readonly instruction?: string }
  | { readonly type: "regenerate_audio"; readonly instruction?: string }
  | { readonly type: "rerender_timeline"; readonly episodeNumber?: number };

export type ComicVoiceCommandResult =
  | { readonly kind: "playback"; readonly command: ComicVoiceCommand; readonly applied: true }
  | { readonly kind: "media_job"; readonly command: ComicVoiceCommand; readonly jobId: string; readonly requiresConfirmation: boolean }
  | { readonly kind: "clarification"; readonly question: string };

export function supportedCapabilities(
  profile: ComicProviderCapabilityProfile,
): readonly ComicProviderCapability[] {
  return profile.capabilities.filter(item => item.status === "supported").map(item => item.capability);
}

export function capabilityStatus(
  profile: ComicProviderCapabilityProfile,
  capability: ComicProviderCapability,
): ComicCapabilityStatus {
  return profile.capabilities.find(item => item.capability === capability)?.status ?? "unknown";
}

export function fallbackForCapability(
  profile: ComicProviderCapabilityProfile,
  capability: ComicProviderCapability,
): readonly ComicProviderCapability[] {
  if (capability === "native_audio" && capabilityStatus(profile, "tts") === "supported") return ["tts"];
  if (capability === "native_subtitle" && capabilityStatus(profile, "transcription") === "supported") return ["transcription"];
  // TTS creates audio, not subtitles. Subtitle recognition is a separate
  // local/external transcription adapter and must not be misreported here.
  if (capability === "native_subtitle") return [];
  if ((capability === "frame_edit" || capability === "segment_edit")
      && capabilityStatus(profile, "first_last_frame") === "supported") return ["first_last_frame"];
  return [];
}

/** Only high-level jobs belong in the user-visible queue. */
export function userVisibleRenderKind(kind: ComicRenderJobKind):
  | "解析剧本"
  | "生成角色"
  | "生成分镜"
  | "生成素材"
  | "生成视频"
  | "生成声音"
  | "生成音乐"
  | "生成音效"
  | "生成字幕"
  | "合成成片"
  | "执行编辑" {
  switch (kind) {
    case "script_analysis": return "解析剧本";
    case "character_generation": return "生成角色";
    case "storyboard_generation": return "生成分镜";
    case "asset_generation": return "生成素材";
    case "video_generation": return "生成视频";
    case "voice_generation": return "生成声音";
    case "music_generation": return "生成音乐";
    case "sound_effect_generation": return "生成音效";
    case "subtitle_generation": return "生成字幕";
    case "timeline_render": return "合成成片";
    case "shot_edit": return "执行编辑";
  }
}
