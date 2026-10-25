import type {
  ApplyComicCommandOptions,
  ComicAsset,
  ComicAssetSource,
  ComicDefaultTitle,
  ComicShotBeat,
  ComicCharacter,
  ComicCommand,
  ComicDialogueCue,
  ComicDialogueCueDraft,
  ComicIdFactory,
  ComicGeneratedAssetDraft,
  ComicMediaSlot,
  ComicProject,
  ComicProjectSummary,
  ComicScene,
  ComicSceneDraft,
  ComicShot,
  ComicShotDraft,
  CreateComicProjectOptions,
} from "./types.js";
import { comicDefaultLocale, comicDefaultTitle, comicTitleWithDefault } from "./default-titles.js";
import { assertComicShotMediaRanges, getComicAssetDurationFrames, getComicMediaDurationFrames, getComicTimedAssetIds } from "./media-timing.js";
import { COMIC_MEDIA_DIRECTORY, COMIC_PROJECT_SCHEMA_VERSION } from "./types.js";
import {
  adaptSettings,
  boolean,
  defaultTitle,
  shotGrammar,
  textList,
  musicSettings,
  assetKind,
  assertUnique,
  assertCurrentRevision,
  episodeScripts,
  boundedText,
  cameraMotion,
  canvas,
  ComicCoreError,
  expectedRevision,
  frameRate,
  identifier,
  integer,
  record,
  mediaFit,
  mediaSlot,
  projectKind,
  numberRange,
  shotSize,
  shotStatus,
  timestamp,
  transition,
} from "./validation.js";

const DEFAULT_CANVAS = { aspectRatio: "16:9" as const, width: 1920, height: 1080 };
const MAX_SHOT_FRAMES = 30 * 60 * 10;
const MAX_SCENES = 300;
const MAX_SHOTS = 5_000;
const MAX_CHARACTERS = 500;
const MAX_ASSETS = 10_000;

/** Fades that fit `durationFrames`: explicit values win, kept ones shrink to the room left. */
function fittedFades(shot: Pick<ComicShot, "fadeInFrames" | "fadeOutFrames">, durationFrames: number, fadeIn?: number, fadeOut?: number): { fadeInFrames: number; fadeOutFrames: number } {
  const fadeInFrames = fadeIn ?? Math.min(shot.fadeInFrames, Math.max(0, durationFrames - (fadeOut ?? 0)));
  return { fadeInFrames, fadeOutFrames: fadeOut ?? Math.min(shot.fadeOutFrames, Math.max(0, durationFrames - fadeInFrames)) };
}

function defaultIdFactory(prefix: Parameters<ComicIdFactory>[0]): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function context(options: ApplyComicCommandOptions | CreateComicProjectOptions): {
  readonly now: string;
  readonly idFactory: ComicIdFactory;
} {
  const now = options.now ?? new Date().toISOString();
  timestamp(now, "now");
  return { now, idFactory: options.idFactory ?? defaultIdFactory };
}

function insertAfter<T extends { readonly id: string }>(
  items: readonly T[],
  item: T,
  afterId: string | null | undefined,
  label: string,
): readonly T[] {
  if (items.some(candidate => candidate.id === item.id)) {
    throw new ComicCoreError("DUPLICATE_ID", `${label} identifier already exists`, "comic.duplicate_id.identifier_already_exists", { field: label });
  }
  if (afterId === undefined) return [...items, item];
  if (afterId === null) return [item, ...items];
  const index = items.findIndex(candidate => candidate.id === afterId);
  if (index < 0) throw new ComicCoreError("ITEM_NOT_FOUND", `${label} insertion anchor does not exist`, "comic.item_not_found.insertion_anchor_does_not_exist", { field: label });
  return [...items.slice(0, index + 1), item, ...items.slice(index + 1)];
}

function titleFields(value: { readonly title?: string; readonly titleDefault?: ComicDefaultTitle } | undefined,
  kind: ComicDefaultTitle["kind"], locale: string, index?: number): { readonly title: string; readonly titleDefault?: ComicDefaultTitle } {
  if (value?.title === undefined) return comicTitleWithDefault(kind, locale, index);
  const title = boundedText(value.title, `${kind}.title`, 120, { required: true });
  const provenance = value.titleDefault === undefined ? undefined : defaultTitle(value.titleDefault, `${kind}.titleDefault`);
  return { title, ...(provenance && title === comicDefaultTitle(provenance) ? { titleDefault: provenance } : {}) };
}

function sceneDraft(value: ComicSceneDraft | undefined, index: number, locale: string): Pick<ComicScene, "title" | "summary" | "location" | "timeOfDay" | "episodeNumber" | "titleDefault" | "setPlateAssetId"> {
  return {
    ...(value?.episodeNumber === undefined ? {} : { episodeNumber: integer(value.episodeNumber, "scene.episodeNumber", 1, 10_000) }),
    ...titleFields(value, "scene", locale, index),
    ...(value?.setPlateAssetId == null ? {} : { setPlateAssetId: identifier(value.setPlateAssetId, "asset", "scene.setPlateAssetId") }),
    summary: boundedText(value?.summary, "scene.summary", 4_000),
    location: boundedText(value?.location, "scene.location", 200),
    timeOfDay: boundedText(value?.timeOfDay, "scene.timeOfDay", 80),
  };
}

function shotDraft(
  value: ComicShotDraft | undefined,
  index: number,
  projectFrameRate: number,
  locale: string,
): Omit<ComicShot, "id" | "dialogueCues" | "status" | "createdAt" | "updatedAt"> {
  const durationFrames = integer(
    value?.durationFrames ?? projectFrameRate * 4,
    "shot.durationFrames",
    1,
    MAX_SHOT_FRAMES,
  );
  const fadeInFrames = integer(value?.fadeInFrames ?? 0, "shot.fadeInFrames", 0, durationFrames);
  const fadeOutFrames = integer(value?.fadeOutFrames ?? 0, "shot.fadeOutFrames", 0, durationFrames);
  if (fadeInFrames + fadeOutFrames > durationFrames) {
    throw new ComicCoreError("INVALID_PROJECT", "shot fade ranges cannot exceed its duration", "comic.invalid_project.shot_fade_ranges_cannot_exceed_its_duration", {});
  }
  return {
    ...titleFields(value, "shot", locale, index),
    ...shotGrammar(value || {}, durationFrames / projectFrameRate),
    description: boundedText(value?.description, "shot.description", 4_000),
    durationFrames,
    shotSize: shotSize(value?.shotSize ?? "wide"),
    cameraMotion: cameraMotion(value?.cameraMotion ?? "static"),
    transitionIn: transition(value?.transition ?? value?.transitionIn ?? "cut"),
    ...(value?.transitionIn !== undefined && value.transition === undefined ? { transition: transition(value.transitionIn) } : {}),
    transitionOut: transition(value?.transitionOut ?? "cut"),
    ...(value?.transitionOut === undefined ? {} : { transitionOutExplicit: true }),
    volume: numberRange(value?.volume ?? 1, "shot.volume", 0, 2),
    fadeInFrames,
    fadeOutFrames,
    visualPrompt: boundedText(value?.visualPrompt, "shot.visualPrompt", 20_000),
    negativePrompt: boundedText(value?.negativePrompt, "shot.negativePrompt", 10_000),
    ...(value?.mediaFit === undefined ? {} : { mediaFit: mediaFit(value.mediaFit) }),
  };
}

function newShot(
  value: ComicShotDraft | undefined,
  index: number,
  projectFrameRate: number,
  now: string,
  idFactory: ComicIdFactory,
  locale: string,
): ComicShot {
  const draft = shotDraft(value, index, projectFrameRate, locale);
  return {
    id: identifier(idFactory("shot"), "shot", "shot.id"),
    ...draft,
    dialogueCues: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

function newScene(
  value: ComicSceneDraft | undefined,
  index: number,
  projectFrameRate: number,
  now: string,
  idFactory: ComicIdFactory,
  withStarterShot: boolean,
  locale: string,
): ComicScene {
  const draft = sceneDraft(value, index, locale);
  return {
    id: identifier(idFactory("scene"), "scene", "scene.id"),
    ...draft,
    shots: withStarterShot ? [newShot(undefined, 1, projectFrameRate, now, idFactory, locale)] : [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createComicProject(options: CreateComicProjectOptions = {}): ComicProject {
  const { now, idFactory } = context(options);
  const rate = frameRate(options.frameRate ?? 24);
  const locale = comicDefaultLocale(options.locale);
  const projectCanvas = canvas(options.canvas ?? DEFAULT_CANVAS);
  const scenes = options.starter === "empty"
    ? []
    : [newScene(undefined, 1, rate, now, idFactory, true, locale)];
  const kind = options.projectKind === undefined ? undefined : projectKind(options.projectKind);
  return {
    schemaVersion: COMIC_PROJECT_SCHEMA_VERSION,
    defaultTitleLocale: locale,
    id: identifier(idFactory("project"), "project", "project.id"),
    ...(kind && kind !== "novel" ? { projectKind: kind } : {}),
    revision: 0,
    ...titleFields(options, "project", locale),
    frameRate: rate,
    canvas: projectCanvas,
    styleBible: "",
    characters: [],
    assets: [],
    scenes,
    createdAt: now,
    updatedAt: now,
  };
}

function sceneIndex(project: ComicProject, sceneId: string): number {
  identifier(sceneId, "scene", "sceneId");
  const index = project.scenes.findIndex(scene => scene.id === sceneId);
  if (index < 0) throw new ComicCoreError("SCENE_NOT_FOUND", "Scene does not exist", "comic.scene_not_found.scene_does_not_exist", {});
  return index;
}

function shotIndex(scene: ComicScene, shotId: string): number {
  identifier(shotId, "shot", "shotId");
  const index = scene.shots.findIndex(shot => shot.id === shotId);
  if (index < 0) throw new ComicCoreError("SHOT_NOT_FOUND", "Shot does not exist", "comic.shot_not_found.shot_does_not_exist", {});
  return index;
}

function updatedScene(project: ComicProject, sceneId: string, update: (scene: ComicScene) => ComicScene): readonly ComicScene[] {
  const index = sceneIndex(project, sceneId);
  const scenes = [...project.scenes];
  scenes[index] = update(scenes[index]);
  return scenes;
}

function characterReferenceAssetIds(
  value: readonly string[] | undefined,
  project: ComicProject,
  label: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) {
    throw new ComicCoreError("INVALID_REFERENCE", `${label} must contain at most 16 image assets`, "comic.invalid_reference.must_contain_at_most_16_image_assets", { field: label, maximum: 16 });
  }
  const ids = value.map((entry, index) => identifier(entry, "asset", `${label}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new ComicCoreError("INVALID_REFERENCE", `${label} contains duplicates`, "comic.invalid_reference.contains_duplicates", { field: label });
  if (ids.some(id => project.assets.find(asset => asset.id === id)?.kind !== "image")) {
    throw new ComicCoreError("INVALID_REFERENCE", `${label} contains a missing or non-image asset`, "comic.invalid_reference.contains_a_missing_or_non_image_asset", { field: label });
  }
  return ids;
}

function assetSource(value: unknown): ComicAssetSource {
  if (value === undefined || value === "generated") return "generated";
  if (value === "imported") return "imported";
  throw new ComicCoreError("INVALID_ASSET_SOURCE", "Media asset source is invalid", "comic.invalid_asset_source.media_asset_source_is_invalid", {});
}

function generatedAsset(value: ComicGeneratedAssetDraft, now: string): ComicAsset {
  const item = record(value, "media.asset") as unknown as ComicGeneratedAssetDraft;
  const kind = assetKind(item.kind);
  const id = identifier(item.id, "asset", "media.asset.id");
  const uri = boundedText(item.uri, "media.asset.uri", 2_048, { required: true });
  if (!uri.startsWith(`${COMIC_MEDIA_DIRECTORY}/`) || uri.includes("..") || uri.includes("\\") || uri.includes(":")) {
    throw new ComicCoreError("INVALID_ASSET_PATH", "Generated media must stay inside nextmux.media", "comic.invalid_asset_path.generated_media_must_stay_inside_nextmux_media", {});
  }
  const mimeType = boundedText(item.mimeType, "media.asset.mimeType", 100, { required: true });
  const byteLength = integer(item.byteLength, "media.asset.byteLength", 1, 512 * 1024 * 1024);
  if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) {
    throw new ComicCoreError("INVALID_ASSET_HASH", "Generated media checksum is invalid", "comic.invalid_asset_hash.generated_media_checksum_is_invalid", {});
  }
  if (typeof item.jobId !== "string" || !/^media-job-[0-9a-f-]{36}$/.test(item.jobId)) {
    throw new ComicCoreError("INVALID_JOB_ID", "Generated media job identifier is invalid", "comic.invalid_job_id.generated_media_job_identifier_is_invalid", {});
  }
  return {
    id,
    kind,
    source: assetSource(item.source),
    uri,
    status: "ready",
    prompt: boundedText(item.prompt, "media.asset.prompt", 20_000),
    provider: boundedText(item.provider, "media.asset.provider", 200, { required: true }),
    model: boundedText(item.model, "media.asset.model", 200, { required: true }),
    mimeType,
    byteLength,
    sha256: item.sha256,
    jobId: item.jobId,
    ...(item.sourceAssetId === undefined ? {} : { sourceAssetId: identifier(item.sourceAssetId, "asset", "media.asset.sourceAssetId") }),
    ...(item.durationMs === undefined ? {} : { durationMs: integer(item.durationMs, "media.asset.durationMs", 1, 24 * 60 * 60_000) }),
    ...(item.streamStartMs === undefined ? {} : { streamStartMs: integer(item.streamStartMs, "media.asset.streamStartMs", 0, Number.MAX_SAFE_INTEGER) }),
    ...(item.width === undefined ? {} : { width: integer(item.width, "media.asset.width", 1, 16_384) }),
    ...(item.height === undefined ? {} : { height: integer(item.height, "media.asset.height", 1, 16_384) }),
    createdAt: now,
    updatedAt: now,
  };
}

/** Copy of a record without keys whose value is undefined (the project file never stores them). */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** Remove ranges with their links; shorten explicit sound out-points when the picture shrinks. */
function fittedMediaRanges(shot: ComicShot, resetAssetIds: readonly string[] = []): ComicShot {
  const linked = new Set(timedAssetIds(shot));
  const keep = (id: string): boolean => linked.has(id) && !resetAssetIds.includes(id);
  const starts = Object.fromEntries(Object.entries(shot.mediaSourceStartFrames || {}).filter(([id, start]) => keep(id) && start > 0));
  const lengths = Object.fromEntries(Object.entries(shot.mediaDurationFrames || {}).filter(([id]) => keep(id) && id !== shot.videoAssetId)
    .map(([id, length]) => [id, Math.min(length, shot.durationFrames)]));
  return compact({ ...shot, mediaSourceStartFrames: Object.keys(starts).length ? starts : undefined,
    mediaDurationFrames: Object.keys(lengths).length ? lengths : undefined });
}

/** Applying a new video fits the picture to its source instead of creating a held final frame. */
function fittedLinkedVideo(project: Pick<ComicProject, "assets" | "frameRate">, shot: ComicShot): ComicShot {
  const sourceFrames = getComicAssetDurationFrames(project.assets.find(asset => asset.id === shot.videoAssetId), project.frameRate);
  const remaining = sourceFrames === undefined ? shot.durationFrames : sourceFrames - (shot.mediaSourceStartFrames?.[shot.videoAssetId!] ?? 0);
  const durationFrames = Math.min(shot.durationFrames, remaining);
  if (durationFrames < 1) throw new ComicCoreError("INVALID_PROJECT", "Media source range exceeds the available source duration", "comic.invalid_project.media_source_range_exceeds_the_available_source_duration", {});
  return fittedMediaRanges({ ...shot, durationFrames, ...fittedFades(shot, durationFrames),
    dialogueCues: shiftDialogue(shot.dialogueCues, 0, durationFrames),
    ...(shot.beats ? { beats: fitBeats(shot.beats, 0, durationFrames / project.frameRate) } : {}) });
}

/**
 * Files saved before source bounds were enforced can hold a video stretched past its source (the old trim bug, or a
 * generated clip shorter than requested) or a sound whose range has run out. Opening them repairs the shot the way an
 * edit now would (picture fitted to its source, spent sound unlinked) instead of refusing the whole project.
 */
export function repairComicShotMediaRanges(project: Pick<ComicProject, "assets" | "frameRate">, shot: ComicShot): ComicShot {
  const starts: Record<string, number> = { ...shot.mediaSourceStartFrames };
  const lengths: Record<string, number> = { ...shot.mediaDurationFrames };
  const patch: Record<string, unknown> = {};
  for (const id of timedAssetIds(shot)) {
    const sourceFrames = getComicAssetDurationFrames(project.assets.find(asset => asset.id === id), project.frameRate);
    if (sourceFrames === undefined) continue;
    const start = starts[id] ?? 0;
    if (start >= sourceFrames) {
      delete starts[id]; delete lengths[id];
      if (id === shot.videoAssetId) continue;
      if (id === shot.audioAssetId) patch.audioAssetId = undefined;
      if (id === shot.subtitleAssetId) patch.subtitleAssetId = undefined;
      if (shot.musicAssetIds?.includes(id)) patch.musicAssetIds = (patch.musicAssetIds as string[] | undefined ?? [...shot.musicAssetIds]).filter(candidate => candidate !== id);
      if (shot.effectAssetIds?.includes(id)) patch.effectAssetIds = (patch.effectAssetIds as string[] | undefined ?? [...shot.effectAssetIds]).filter(candidate => candidate !== id);
      continue;
    }
    if (id !== shot.videoAssetId && lengths[id] !== undefined) lengths[id] = Math.min(lengths[id]!, sourceFrames - start);
  }
  if (Array.isArray(patch.musicAssetIds) && patch.musicAssetIds.length === 0) patch.musicAssetIds = undefined;
  if (Array.isArray(patch.effectAssetIds) && patch.effectAssetIds.length === 0) patch.effectAssetIds = undefined;
  const next = fittedMediaRanges(compact({ ...shot, ...patch, mediaSourceStartFrames: Object.keys(starts).length ? starts : undefined,
    mediaDurationFrames: Object.keys(lengths).length ? lengths : undefined }) as ComicShot);
  return next.videoAssetId ? fittedLinkedVideo(project, next) : next;
}

/** A split/head trim removes a sound that has already ended and carries its exact remaining out-point. */
function sliceShotMedia(project: ComicProject, source: ComicShot, result: ComicShot, startFrame: number): ComicShot {
  const patch: Record<string, unknown> = {};
  const starts: Record<string, number> = {};
  const lengths: Record<string, number> = {};
  for (const id of timedAssetIds(source)) {
    const length = Math.min(result.durationFrames, getComicMediaDurationFrames(project, source, id) - startFrame);
    if (length < 1) {
      if (id === source.audioAssetId) patch.audioAssetId = undefined;
      if (id === source.subtitleAssetId) patch.subtitleAssetId = undefined;
      if (source.musicAssetIds?.includes(id)) patch.musicAssetIds = (patch.musicAssetIds as string[] | undefined ?? [...source.musicAssetIds]).filter(candidate => candidate !== id);
      if (source.effectAssetIds?.includes(id)) patch.effectAssetIds = (patch.effectAssetIds as string[] | undefined ?? [...source.effectAssetIds]).filter(candidate => candidate !== id);
      continue;
    }
    const start = (source.mediaSourceStartFrames?.[id] ?? 0) + startFrame;
    if (start > 0) starts[id] = start;
    if (id !== source.videoAssetId && (source.mediaDurationFrames?.[id] !== undefined || length < result.durationFrames)) lengths[id] = length;
  }
  if (Array.isArray(patch.musicAssetIds) && patch.musicAssetIds.length === 0) patch.musicAssetIds = undefined;
  if (Array.isArray(patch.effectAssetIds) && patch.effectAssetIds.length === 0) patch.effectAssetIds = undefined;
  return fittedMediaRanges(compact({ ...result, ...patch, mediaSourceStartFrames: Object.keys(starts).length ? starts : undefined,
    mediaDurationFrames: Object.keys(lengths).length ? lengths : undefined }) as ComicShot);
}

/** Shift dialogue by -frames (a trimmed head); cues that end before the new start are dropped. */
function shiftDialogue(cues: readonly ComicDialogueCue[], frames: number, durationFrames: number): readonly ComicDialogueCue[] {
  const shifted: ComicDialogueCue[] = [];
  for (const cue of cues) {
    let startFrame = cue.startFrame - frames;
    let length = cue.durationFrames;
    if (startFrame < 0) { length += startFrame; startFrame = 0; }
    if (length < 1 || startFrame >= durationFrames) continue;
    shifted.push({ ...cue, startFrame, durationFrames: Math.min(length, durationFrames - startFrame) });
  }
  return shifted;
}

function slotField(slot: Exclude<ComicMediaSlot, "music" | "effect">): "visualAssetId" | "audioAssetId" | "subtitleAssetId" | "videoAssetId" {
  if (slot === "visual") return "visualAssetId";
  if (slot === "audio") return "audioAssetId";
  if (slot === "subtitle") return "subtitleAssetId";
  return "videoAssetId";
}

function assertSlotKind(slot: ComicMediaSlot, kind: ComicAsset["kind"]): void {
  const expected: Record<ComicMediaSlot, ComicAsset["kind"]> = {
    visual: "image",
    audio: "audio",
    music: "music",
    effect: "effect",
    subtitle: "subtitle",
    video: "video",
  };
  if (expected[slot] !== kind) {
    throw new ComicCoreError("ASSET_SLOT_MISMATCH", `${kind} cannot be attached to the ${slot} slot`, "comic.asset_slot_mismatch.cannot_be_attached_to_the_slot", { kind, slot });
  }
}

function rescaleFrames(value: number, oldRate: number, newRate: number): number {
  return Math.max(1, Math.round(value * newRate / oldRate));
}

function rescaleProject(project: ComicProject, newRate: number, now: string): readonly ComicScene[] {
  return project.scenes.map(scene => ({
    ...scene,
    shots: scene.shots.map(shot => {
      const requestedDuration = rescaleFrames(shot.durationFrames, project.frameRate, newRate);
      const sourceStarts = shot.mediaSourceStartFrames ? Object.fromEntries(Object.entries(shot.mediaSourceStartFrames)
        .map(([id, offset]) => [id, Math.floor(offset * newRate / project.frameRate)])) : undefined;
      const videoFrames = getComicAssetDurationFrames(project.assets.find(asset => asset.id === shot.videoAssetId), newRate);
      const durationFrames = Math.min(MAX_SHOT_FRAMES, requestedDuration, videoFrames === undefined ? Infinity : videoFrames - (sourceStarts?.[shot.videoAssetId!] ?? 0));
      const fades = fittedFades({ fadeInFrames: Math.round(shot.fadeInFrames * newRate / project.frameRate),
        fadeOutFrames: Math.round(shot.fadeOutFrames * newRate / project.frameRate) }, durationFrames);
      return fittedMediaRanges({
        ...shot,
        durationFrames,
        ...fades,
        ...(shot.beats ? { beats: fitBeats(shot.beats, 0, durationFrames / newRate) } : {}),
        ...(sourceStarts ? { mediaSourceStartFrames: sourceStarts } : {}),
        ...(shot.mediaDurationFrames ? { mediaDurationFrames: Object.fromEntries(Object.entries(shot.mediaDurationFrames)
          .map(([id, length]) => [id, Math.min(durationFrames, rescaleFrames(length, project.frameRate, newRate),
            (getComicAssetDurationFrames(project.assets.find(asset => asset.id === id), newRate) ?? Infinity) - (sourceStarts?.[id] ?? 0))])) } : {}),
        dialogueCues: fitDialogue(shot.dialogueCues.map(cue => ({
          ...cue,
          startFrame: Math.max(0, Math.round(cue.startFrame * newRate / project.frameRate)),
          durationFrames: rescaleFrames(cue.durationFrames, project.frameRate, newRate),
        })), durationFrames),
        updatedAt: now,
      });
    }),
    updatedAt: now,
  }));
}

function fitDialogue(cues: readonly ComicDialogueCue[], durationFrames: number): readonly ComicDialogueCue[] {
  return shiftDialogue(cues, 0, durationFrames);
}

function timedAssetIds(shot: ComicShot): readonly string[] {
  return getComicTimedAssetIds(shot);
}

function splitDialogueCues(
  cues: readonly ComicDialogueCue[],
  splitAtFrame: number,
  rightShotDuration: number,
  idFactory: ComicIdFactory,
): { readonly left: readonly ComicDialogueCue[]; readonly right: readonly ComicDialogueCue[] } {
  const left: ComicDialogueCue[] = [];
  const right: ComicDialogueCue[] = [];
  for (const cue of cues) {
    const endFrame = cue.startFrame + cue.durationFrames;
    if (endFrame <= splitAtFrame) {
      left.push(cue);
      continue;
    }
    if (cue.startFrame >= splitAtFrame) {
      right.push({ ...cue, startFrame: cue.startFrame - splitAtFrame });
      continue;
    }
    const leftDuration = splitAtFrame - cue.startFrame;
    const rightDuration = endFrame - splitAtFrame;
    left.push({ ...cue, durationFrames: leftDuration });
    right.push({
      ...cue,
      id: identifier(idFactory("dialogue"), "dialogue", "dialogue.id"),
      continuationOfCueId: cue.continuationOfCueId || cue.id,
      startFrame: 0,
      durationFrames: Math.min(rightDuration, rightShotDuration),
    });
  }
  return { left, right };
}

function normalizedCues(
  drafts: readonly ComicDialogueCueDraft[],
  shot: ComicShot,
  characters: readonly ComicCharacter[],
  idFactory: ComicIdFactory,
): readonly ComicDialogueCue[] {
  if (!Array.isArray(drafts) || drafts.length > 100) {
    throw new ComicCoreError("INVALID_DIALOGUE", "A shot can contain at most 100 dialogue cues", "comic.invalid_dialogue.a_shot_can_contain_at_most_100_dialogue_cues", { maximum: 100 });
  }
  const characterIds = new Set(characters.map(character => character.id));
  const cues = drafts.map((draft, index) => {
    if (!draft || typeof draft !== "object") {
      throw new ComicCoreError("INVALID_DIALOGUE", "Dialogue cue must be an object", "comic.invalid_dialogue.dialogue_cue_must_be_an_object", {});
    }
    const speakerCharacterId = draft.speakerCharacterId === undefined
      ? undefined
      : identifier(draft.speakerCharacterId, "character", `dialogue[${index}].speakerCharacterId`);
    if (speakerCharacterId && !characterIds.has(speakerCharacterId)) {
      throw new ComicCoreError("CHARACTER_NOT_FOUND", "Dialogue speaker does not exist", "comic.character_not_found.dialogue_speaker_does_not_exist", {});
    }
    const startFrame = integer(draft.startFrame ?? 0, "dialogue.startFrame", 0, shot.durationFrames - 1);
    const durationFrames = integer(
      draft.durationFrames ?? Math.max(1, shot.durationFrames - startFrame),
      "dialogue.durationFrames",
      1,
      shot.durationFrames - startFrame,
    );
    return {
      id: draft.id === undefined
        ? identifier(idFactory("dialogue"), "dialogue", "dialogue.id")
        : identifier(draft.id, "dialogue", "dialogue.id"),
      ...(draft.continuationOfCueId === undefined ? {} : { continuationOfCueId: identifier(draft.continuationOfCueId, "dialogue", "dialogue.continuationOfCueId") }),
      ...(speakerCharacterId ? { speakerCharacterId } : {}),
      text: boundedText(draft.text, "dialogue.text", 5_000, { required: true }),
      ...(draft.tone === undefined ? {} : { tone: boundedText(draft.tone, "dialogue.tone", 300) }),
      startFrame,
      durationFrames,
    };
  });
  if (new Set(cues.map(cue => cue.id)).size !== cues.length) {
    throw new ComicCoreError("DUPLICATE_ID", "Dialogue cue identifiers must be unique within a shot", "comic.duplicate_id.dialogue_cue_identifiers_must_be_unique_within_a_shot", {});
  }
  // Stable: lines that start together keep the order they were written in (never the random id order).
  return cues.sort((left, right) => left.startFrame - right.startFrame);
}

export function applyComicCommand(
  project: ComicProject,
  command: ComicCommand,
  options: ApplyComicCommandOptions = {},
): ComicProject {
  if (!command || typeof command !== "object") {
    throw new ComicCoreError("INVALID_COMMAND", "Comic command must be an object", "comic.invalid_command.comic_command_must_be_an_object", {});
  }
  const expected = expectedRevision(command.expectedRevision);
  assertCurrentRevision(project.revision, expected);
  const { now, idFactory } = context(options);
  const locale = comicDefaultLocale(options.locale ?? project.defaultTitleLocale ?? project.titleDefault?.locale);
  let next: ComicProject;

  switch (command.type) {
    case "project.update": {
      const patch = record(command.patch, "project.patch") as Extract<ComicCommand, { readonly type: "project.update" }>["patch"];
      const nextRate = patch.frameRate === undefined ? project.frameRate : frameRate(patch.frameRate);
      next = {
        ...project,
        title: patch.title === undefined
          ? project.title
          : boundedText(patch.title, "project.title", 120, { required: true }),
        ...(patch.title === undefined ? {} : { titleDefault: titleFields(patch, "project", locale).titleDefault }),
        ...(patch.continuousShotsShareFrames === undefined ? {} : { continuousShotsShareFrames: boolean(patch.continuousShotsShareFrames, "project.continuousShotsShareFrames") }),
        frameRate: nextRate,
        canvas: patch.canvas === undefined ? project.canvas : canvas(patch.canvas),
        styleBible: patch.styleBible === undefined
          ? project.styleBible
          : boundedText(patch.styleBible, "project.styleBible", 40_000),
        ...(patch.episodes === undefined ? {} : { episodes: episodeScripts(patch.episodes, "project.episodes") }),
        ...(patch.adaptSettings === undefined ? {} : { adaptSettings: adaptSettings(patch.adaptSettings, "project.adaptSettings") }),
        ...(patch.music === undefined ? {} : { music: musicSettings(patch.music, "project.music") }),
        scenes: nextRate === project.frameRate ? project.scenes : rescaleProject(project, nextRate, now),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "scene.add": {
      if (project.scenes.length >= MAX_SCENES) {
        throw new ComicCoreError("PROJECT_TOO_LARGE", `Comic project can contain at most ${MAX_SCENES} scenes`, "comic.project_too_large.comic_project_can_contain_at_most_scenes", { maximum: MAX_SCENES });
      }
      if (command.scene !== undefined) record(command.scene, "scene");
      const scene = newScene(command.scene, project.scenes.length + 1, project.frameRate, now, idFactory, false, locale);
      if (scene.setPlateAssetId) validateSetPlate(scene.setPlateAssetId, project);
      next = {
        ...project,
        scenes: insertAfter(project.scenes, scene, command.afterSceneId, "Scene"),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "scene.update": {
      const patch = record(command.patch, "scene.patch") as ComicSceneDraft;
      if (patch.setPlateAssetId != null) validateSetPlate(patch.setPlateAssetId, project);
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => ({
          ...scene,
          ...(patch.episodeNumber === undefined ? {} : { episodeNumber: integer(patch.episodeNumber, "scene.episodeNumber", 1, 10_000) }),
          title: patch.title === undefined ? scene.title : boundedText(patch.title, "scene.title", 120, { required: true }),
          ...(patch.title === undefined ? {} : { titleDefault: titleFields(patch, "scene", locale).titleDefault }),
          ...(patch.setPlateAssetId === undefined ? {} : { setPlateAssetId: patch.setPlateAssetId === null ? undefined : patch.setPlateAssetId }),
          summary: patch.summary === undefined ? scene.summary : boundedText(patch.summary, "scene.summary", 4_000),
          location: patch.location === undefined ? scene.location : boundedText(patch.location, "scene.location", 200),
          timeOfDay: patch.timeOfDay === undefined ? scene.timeOfDay : boundedText(patch.timeOfDay, "scene.timeOfDay", 80),
          updatedAt: now,
        })),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "scene.delete": {
      const index = sceneIndex(project, command.sceneId);
      next = {
        ...project,
        scenes: [...project.scenes.slice(0, index), ...project.scenes.slice(index + 1)],
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.add": {
      if (summarizeComicProject(project).shotCount >= MAX_SHOTS) {
        throw new ComicCoreError("PROJECT_TOO_LARGE", `Comic project can contain at most ${MAX_SHOTS} shots`, "comic.project_too_large.comic_project_can_contain_at_most_shots", { maximum: MAX_SHOTS });
      }
      if (command.shot !== undefined) record(command.shot, "shot");
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const created = newShot(command.shot, scene.shots.length + 1, project.frameRate, now, idFactory, locale);
          const shot = command.cues === undefined ? created : {
            ...created,
            dialogueCues: normalizedCues(command.cues, created, project.characters, idFactory),
          };
          return {
            ...scene,
            shots: insertAfter(scene.shots, shot, command.afterShotId, "Shot"),
            updatedAt: now,
          };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.update": {
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shot = scene.shots[index];
          const patch = record(command.patch, "shot.patch") as ComicShotDraft;
          const durationFrames = patch.durationFrames === undefined
            ? shot.durationFrames
            : integer(patch.durationFrames, "shot.durationFrames", 1, MAX_SHOT_FRAMES);
          const updated: ComicShot = {
            ...shot,
            title: patch.title === undefined ? shot.title : boundedText(patch.title, "shot.title", 120, { required: true }),
            ...(patch.title === undefined ? {} : { titleDefault: titleFields(patch, "shot", locale).titleDefault }),
            ...(shot.beats && patch.beats === undefined ? { beats: fitBeats(shot.beats, 0, durationFrames / project.frameRate) } : {}),
            ...shotGrammar(patch, durationFrames / project.frameRate),
            ...(patch.transition === undefined && patch.transitionIn !== undefined ? { transition: transition(patch.transitionIn) } : {}),
            description: patch.description === undefined ? shot.description : boundedText(patch.description, "shot.description", 4_000),
            durationFrames,
            shotSize: patch.shotSize === undefined ? shot.shotSize : shotSize(patch.shotSize),
            cameraMotion: patch.cameraMotion === undefined ? shot.cameraMotion : cameraMotion(patch.cameraMotion),
            transitionIn: patch.transition === null ? "cut" : patch.transition !== undefined ? transition(patch.transition)
              : patch.transitionIn === undefined ? shot.transitionIn : transition(patch.transitionIn),
            transitionOut: patch.transitionOut === undefined ? shot.transitionOut : transition(patch.transitionOut),
            ...(patch.transitionOut === undefined ? {} : { transitionOutExplicit: true }),
            volume: patch.volume === undefined ? shot.volume : numberRange(patch.volume, "shot.volume", 0, 2),
            // Fades the patch leaves alone shrink with the shot; explicit values are validated below.
            ...fittedFades(shot, durationFrames, patch.fadeInFrames === undefined ? undefined : integer(patch.fadeInFrames, "shot.fadeInFrames", 0, durationFrames),
              patch.fadeOutFrames === undefined ? undefined : integer(patch.fadeOutFrames, "shot.fadeOutFrames", 0, durationFrames)),
            visualPrompt: patch.visualPrompt === undefined ? shot.visualPrompt : boundedText(patch.visualPrompt, "shot.visualPrompt", 20_000),
            negativePrompt: patch.negativePrompt === undefined ? shot.negativePrompt : boundedText(patch.negativePrompt, "shot.negativePrompt", 10_000),
            ...(patch.mediaFit === undefined ? {} : { mediaFit: mediaFit(patch.mediaFit) }),
            dialogueCues: command.cues === undefined
              ? fitDialogue(shot.dialogueCues, durationFrames)
              : normalizedCues(command.cues, { ...shot, durationFrames }, project.characters, idFactory),
            updatedAt: now,
          };
          if (updated.fadeInFrames + updated.fadeOutFrames > durationFrames) {
            throw new ComicCoreError("INVALID_PROJECT", "shot fade ranges cannot exceed its duration", "comic.invalid_project.shot_fade_ranges_cannot_exceed_its_duration", {});
          }
          const shots = [...scene.shots];
          shots[index] = fittedMediaRanges(updated);
          assertComicShotMediaRanges(project, shots[index]);
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.split": {
      if (summarizeComicProject(project).shotCount >= MAX_SHOTS) {
        throw new ComicCoreError("PROJECT_TOO_LARGE", `Comic project can contain at most ${MAX_SHOTS} shots`, "comic.project_too_large.comic_project_can_contain_at_most_shots", { maximum: MAX_SHOTS });
      }
      const splitAtFrame = integer(command.splitAtFrame, "shot.splitAtFrame", 1, MAX_SHOT_FRAMES - 1);
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const source = scene.shots[index];
          if (splitAtFrame >= source.durationFrames) {
            throw new ComicCoreError("INVALID_PROJECT", "A shot can only be split inside its duration", "comic.invalid_project.a_shot_can_only_be_split_inside_its_duration", {});
          }
          const rightDuration = source.durationFrames - splitAtFrame;
          const cues = splitDialogueCues(source.dialogueCues, splitAtFrame, rightDuration, idFactory);
          // The fade-in stays at the start (left part) and the fade-out at the
          // end (right part), each within its part (audit 36-14).
          const leftShot: ComicShot = sliceShotMedia(project, source, {
            ...source,
            durationFrames: splitAtFrame,
            transitionOut: "cut",
            transitionOutExplicit: true,
            fadeInFrames: Math.min(source.fadeInFrames, splitAtFrame),
            fadeOutFrames: 0,
            ...(source.beats ? { beats: fitBeats(source.beats, 0, splitAtFrame / project.frameRate) } : {}),
            dialogueCues: cues.left,
            updatedAt: now,
          }, 0);
          const rightShot: ComicShot = sliceShotMedia(project, source, compact({
            ...source,
            id: identifier(idFactory("shot"), "shot", "shot.id"),
            ...derivedTitle(source, "split", locale),
            ...(source.beats ? { beats: fitBeats(source.beats, splitAtFrame / project.frameRate, source.durationFrames / project.frameRate, rightDuration / project.frameRate) } : {}),
            description: source.description,
            durationFrames: rightDuration,
            transition: "cut",
            transitionIn: "cut",
            fadeInFrames: 0,
            fadeOutFrames: Math.min(source.fadeOutFrames, rightDuration),
            shotSize: source.shotSize,
            cameraMotion: source.cameraMotion,
            visualPrompt: source.visualPrompt,
            negativePrompt: source.negativePrompt,
            dialogueCues: cues.right,
            pendingVideoAssetId: undefined,
            createdAt: now,
            updatedAt: now,
          }), splitAtFrame);
          const shots = [...scene.shots];
          shots.splice(index, 1, leftShot, rightShot);
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.delete": {
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          return {
            ...scene,
            shots: [...scene.shots.slice(0, index), ...scene.shots.slice(index + 1)],
            updatedAt: now,
          };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.move": {
      if (command.afterShotId === command.shotId) {
        throw new ComicCoreError("INVALID_MOVE", "A shot cannot be positioned after itself", "comic.invalid_move.a_shot_cannot_be_positioned_after_itself", {});
      }
      const sourceIndex = sceneIndex(project, command.sceneId);
      const targetIndex = sceneIndex(project, command.targetSceneId);
      const sourceScene = project.scenes[sourceIndex];
      const sourceShotIndex = shotIndex(sourceScene, command.shotId);
      const shot = sourceScene.shots[sourceShotIndex];
      const scenes = project.scenes.map(scene => ({ ...scene, shots: [...scene.shots] })) as ComicScene[];
      scenes[sourceIndex] = {
        ...scenes[sourceIndex],
        shots: scenes[sourceIndex].shots.filter(candidate => candidate.id !== shot.id),
        updatedAt: now,
      };
      const target = scenes[targetIndex];
      const targetShots = target.shots.filter(candidate => candidate.id !== shot.id);
      scenes[targetIndex] = {
        ...target,
        shots: insertAfter(targetShots, shot, command.afterShotId, "Shot"),
        updatedAt: now,
      };
      next = { ...project, scenes, revision: project.revision + 1, updatedAt: now };
      break;
    }
    case "shot.duplicate": {
      if (summarizeComicProject(project).shotCount >= MAX_SHOTS) {
        throw new ComicCoreError("PROJECT_TOO_LARGE", `Comic project can contain at most ${MAX_SHOTS} shots`, "comic.project_too_large.comic_project_can_contain_at_most_shots", { maximum: MAX_SHOTS });
      }
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const source = scene.shots[index];
          const copy: ComicShot = compact({
            ...source,
            id: identifier(idFactory("shot"), "shot", "shot.id"),
            ...derivedTitle(source, "copy", locale),
            // The copy's dialogue is its own; an unapproved video revision stays with the original.
            dialogueCues: source.dialogueCues.map(cue => compact({ ...cue, id: identifier(idFactory("dialogue"), "dialogue", "dialogue.id"), continuationOfCueId: undefined })),
            pendingVideoAssetId: undefined,
            createdAt: now,
            updatedAt: now,
          });
          const shots = [...scene.shots];
          shots.splice(index + 1, 0, copy);
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.trim_start": {
      const requested = integer(command.frames, "shot.trimFrames", -MAX_SHOT_FRAMES, MAX_SHOT_FRAMES);
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shot = scene.shots[index];
          const timed = timedAssetIds(shot);
          const starts = shot.mediaSourceStartFrames || {};
          // Restoring trimmed frames cannot reach before the start of any linked media.
          const earliest = timed.length ? Math.min(...timed.map(id => starts[id] || 0)) : Infinity;
          const frames = requested < 0 ? -Math.min(-requested, earliest) : requested;
          const durationFrames = shot.durationFrames - frames;
          if (durationFrames < 1 || durationFrames > MAX_SHOT_FRAMES) {
            throw new ComicCoreError("INVALID_PROJECT", "A trimmed shot must keep between one frame and the maximum length", "comic.invalid_project.a_trimmed_shot_must_keep_between_one_frame_and_the_maximum_length", {});
          }
          const updated: ComicShot = sliceShotMedia(project, shot, compact({
            ...shot,
            durationFrames,
            dialogueCues: shiftDialogue(shot.dialogueCues, frames, durationFrames),
            ...(shot.beats ? { beats: fitBeats(shot.beats, frames / project.frameRate, shot.durationFrames / project.frameRate, durationFrames / project.frameRate) } : {}),
            fadeInFrames: Math.min(shot.fadeInFrames, durationFrames),
            fadeOutFrames: Math.min(shot.fadeOutFrames, Math.max(0, durationFrames - Math.min(shot.fadeInFrames, durationFrames))),
            updatedAt: now,
          }), frames);
          const shots = [...scene.shots];
          shots[index] = updated;
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "media.link": {
      const slot = mediaSlot(command.slot);
      const asset = project.assets.find(candidate => candidate.id === command.assetId);
      if (!asset) throw new ComicCoreError("INVALID_REFERENCE", "Media is not in this project", "comic.invalid_reference.media_is_not_in_this_project", {});
      assertSlotKind(slot, asset.kind);
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shots = [...scene.shots];
          const currentShot = shots[index];
          const mediaPatch = slot === "music"
            ? { musicAssetIds: [...new Set([...(currentShot.musicAssetIds || []), asset.id])] }
            : slot === "effect"
              ? { effectAssetIds: [...new Set([...(currentShot.effectAssetIds || []), asset.id])] }
              : { [slotField(slot)]: asset.id };
          shots[index] = fittedLinkedVideo(project, fittedMediaRanges(compact({
            ...currentShot,
            ...mediaPatch,
            ...(slot === "visual" || slot === "video" ? { status: "generated" as const } : {}),
            updatedAt: now,
          }), [asset.id]));
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "music.select": {
      const asset = project.assets.find(candidate => candidate.id === command.assetId);
      if (!asset || asset.kind !== "music") throw new ComicCoreError("INVALID_REFERENCE", "The song version is not in this project", "comic.invalid_reference.the_song_version_is_not_in_this_project", {});
      const scene = project.scenes[0];
      const songShot = scene?.shots[0];
      if (!scene || !songShot || !project.music) throw new ComicCoreError("ITEM_NOT_FOUND", "This project has no song", "comic.item_not_found.this_project_has_no_song", {});
      const requestedDuration = command.durationFrames === undefined ? songShot.durationFrames : integer(command.durationFrames, "music.durationFrames", 1, MAX_SHOT_FRAMES);
      const durationFrames = Math.min(requestedDuration, getComicAssetDurationFrames(asset, project.frameRate) ?? Infinity);
      next = {
        ...project,
        music: { ...project.music, selectedAssetId: asset.id },
        scenes: updatedScene(project, scene.id, current => {
          const shots = [...current.shots];
          shots[0] = fittedLinkedVideo(project, fittedMediaRanges(compact({ ...songShot, musicAssetIds: [asset.id], durationFrames,
            ...fittedFades(songShot, durationFrames), dialogueCues: fitDialogue(songShot.dialogueCues, durationFrames),
            ...(songShot.beats ? { beats: fitBeats(songShot.beats, 0, durationFrames / project.frameRate) } : {}), updatedAt: now }), [asset.id]));
          return { ...current, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "media.detach": {
      const slot = mediaSlot(command.slot);
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shots = [...scene.shots];
          const currentShot = shots[index];
          let mediaPatch: Partial<ComicShot>;
          if (slot === "music" || slot === "effect") {
            const field = slot === "music" ? "musicAssetIds" : "effectAssetIds";
            const current = currentShot[field] || [];
            if (command.assetId !== undefined && !current.includes(command.assetId)) {
              throw new ComicCoreError("ITEM_NOT_FOUND", "That media is not linked to this shot", "comic.item_not_found.that_media_is_not_linked_to_this_shot", {});
            }
            const remaining = command.assetId === undefined ? [] : current.filter(id => id !== command.assetId);
            mediaPatch = { [field]: remaining.length ? remaining : undefined };
          } else {
            const field = slotField(slot);
            if (!currentShot[field]) throw new ComicCoreError("ITEM_NOT_FOUND", "Nothing is linked in that slot", "comic.item_not_found.nothing_is_linked_in_that_slot", {});
            mediaPatch = { [field]: undefined };
          }
          const merged = { ...currentShot, ...mediaPatch } as ComicShot;
          shots[index] = fittedMediaRanges(compact({ ...merged, updatedAt: now }));
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "media.set_start": {
      const startFrame = integer(command.startFrame, "media.startFrame", 0, 1_000_000_000);
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shots = [...scene.shots];
          const currentShot = shots[index];
          if (!timedAssetIds(currentShot).includes(command.assetId)) {
            throw new ComicCoreError("INVALID_REFERENCE", "Only linked video or audio has a start point", "comic.invalid_reference.only_linked_video_or_audio_has_a_start_point", {});
          }
          const starts = { ...(currentShot.mediaSourceStartFrames || {}), [command.assetId]: startFrame };
          const kept = Object.fromEntries(Object.entries(starts).filter(([, start]) => start > 0));
          shots[index] = compact({ ...currentShot, mediaSourceStartFrames: Object.keys(kept).length ? kept : undefined, updatedAt: now });
          assertComicShotMediaRanges(project, shots[index]);
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "media.set_duration": {
      next = { ...project, scenes: updatedScene(project, command.sceneId, scene => {
        const index = shotIndex(scene, command.shotId), shot = scene.shots[index];
        if (!timedAssetIds(shot).includes(command.assetId) || command.assetId === shot.videoAssetId) {
          throw new ComicCoreError("INVALID_REFERENCE", "Only linked sound or subtitles have an independent out-point", "comic.invalid_reference.only_linked_sound_or_subtitles_have_an_independent_out_point", {});
        }
        const durationFrames = integer(command.durationFrames, "media.durationFrames", 1, shot.durationFrames);
        const updated = { ...shot, mediaDurationFrames: { ...shot.mediaDurationFrames, [command.assetId]: durationFrames }, updatedAt: now };
        assertComicShotMediaRanges(project, updated);
        const shots = [...scene.shots]; shots[index] = updated;
        return { ...scene, shots, updatedAt: now };
      }), revision: project.revision + 1, updatedAt: now };
      break;
    }
    case "dialogue.replace": {
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shots = [...scene.shots];
          const shot = shots[index];
          shots[index] = {
            ...shot,
            dialogueCues: normalizedCues(command.cues, shot, project.characters, idFactory),
            updatedAt: now,
          };
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.status": {
      const status = shotStatus(command.status);
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shots = [...scene.shots];
          shots[index] = { ...shots[index], status, updatedAt: now };
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "media.attach": {
      const slot = mediaSlot(command.slot);
      if (command.deferToPending && slot !== "video") {
        throw new ComicCoreError("INVALID_COMMAND", "Only video assets can be deferred for approval", "comic.invalid_command.only_video_assets_can_be_deferred_for_approval", {});
      }
      const generated = generatedAsset(command.asset, now);
      assertSlotKind(slot, generated.kind);
      const targetScene = project.scenes.find(candidate => candidate.id === command.sceneId);
      const targetShot = targetScene?.shots.find(candidate => candidate.id === command.shotId);
      const previousAssetId = slot === "music" || slot === "effect" || !targetShot
        ? undefined
        : targetShot[slotField(slot)];
      const asset = previousAssetId && previousAssetId !== generated.id && generated.sourceAssetId === undefined
        ? { ...generated, sourceAssetId: previousAssetId }
        : generated;
      const existing = project.assets.find(candidate => candidate.id === asset.id);
      if (existing && (existing.jobId !== asset.jobId || existing.sha256 !== asset.sha256
          || existing.uri !== asset.uri || existing.kind !== asset.kind)) {
        throw new ComicCoreError("DUPLICATE_ID", "Asset identifier already belongs to different media", "comic.duplicate_id.asset_identifier_already_belongs_to_different_media", {});
      }
      if (!existing && project.assets.length >= MAX_ASSETS) {
        throw new ComicCoreError("PROJECT_TOO_LARGE", `Comic project can contain at most ${MAX_ASSETS} assets`, "comic.project_too_large.comic_project_can_contain_at_most_assets", { maximum: MAX_ASSETS });
      }
      next = {
        ...project,
        assets: existing ? project.assets : [...project.assets, asset],
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shots = [...scene.shots];
          const currentShot = shots[index];
          const mediaPatch = command.deferToPending
            ? { pendingVideoAssetId: asset.id }
            : slot === "music"
            ? { musicAssetIds: [...new Set([...(currentShot.musicAssetIds || []), asset.id])] }
            : slot === "effect"
              ? { effectAssetIds: [...new Set([...(currentShot.effectAssetIds || []), asset.id])] }
              : { [slotField(slot)]: asset.id };
          const linked = fittedMediaRanges(compact({
            ...currentShot,
            ...mediaPatch,
            // A finished picture or video leaves the shot generated (audit 36-12);
            // a video held for approval does not replace anything yet.
            ...(slot === "visual" || slot === "video" && !command.deferToPending ? { status: "generated" as const } : {}),
            updatedAt: now,
          }), command.deferToPending ? [] : [asset.id]);
          shots[index] = command.deferToPending ? linked : fittedLinkedVideo({ ...project, assets: existing ? project.assets : [...project.assets, asset] }, linked);
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "asset.import": {
      const asset = generatedAsset(command.asset, now);
      const existing = project.assets.find(candidate => candidate.id === asset.id);
      if (existing && (existing.jobId !== asset.jobId || existing.sha256 !== asset.sha256
          || existing.uri !== asset.uri || existing.kind !== asset.kind)) {
        throw new ComicCoreError("DUPLICATE_ID", "Asset identifier already belongs to different media", "comic.duplicate_id.asset_identifier_already_belongs_to_different_media", {});
      }
      if (!existing && project.assets.length >= MAX_ASSETS) {
        throw new ComicCoreError("PROJECT_TOO_LARGE", `Comic project can contain at most ${MAX_ASSETS} assets`, "comic.project_too_large.comic_project_can_contain_at_most_assets", { maximum: MAX_ASSETS });
      }
      next = {
        ...project,
        assets: existing ? project.assets : [...project.assets, asset],
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.apply_pending_video": {
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shots = [...scene.shots];
          const currentShot = shots[index];
          const pendingId = currentShot.pendingVideoAssetId;
          if (!pendingId) throw new ComicCoreError("ITEM_NOT_FOUND", "Shot has no pending video revision", "comic.item_not_found.shot_has_no_pending_video_revision", {});
          const pending = project.assets.find(asset => asset.id === pendingId);
          if (!pending || pending.kind !== "video") throw new ComicCoreError("INVALID_REFERENCE", "Pending video revision is unavailable", "comic.invalid_reference.pending_video_revision_is_unavailable", {});
          shots[index] = fittedLinkedVideo(project, fittedMediaRanges(compact({
            ...currentShot,
            videoAssetId: pendingId,
            pendingVideoAssetId: undefined,
            status: "generated",
            updatedAt: now,
          }), [pendingId]));
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "shot.discard_pending_video": {
      next = {
        ...project,
        scenes: updatedScene(project, command.sceneId, scene => {
          const index = shotIndex(scene, command.shotId);
          const shots = [...scene.shots];
          if (!shots[index].pendingVideoAssetId) throw new ComicCoreError("ITEM_NOT_FOUND", "Shot has no pending video revision", "comic.item_not_found.shot_has_no_pending_video_revision", {});
          shots[index] = { ...shots[index], pendingVideoAssetId: undefined, updatedAt: now };
          return { ...scene, shots, updatedAt: now };
        }),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "character.add": {
      if (project.characters.length >= MAX_CHARACTERS) {
        throw new ComicCoreError("PROJECT_TOO_LARGE", `Comic project can contain at most ${MAX_CHARACTERS} characters`, "comic.project_too_large.comic_project_can_contain_at_most_characters", { maximum: MAX_CHARACTERS });
      }
      record(command.character, "character");
      const name = boundedText(command.character.name, "character.name", 120, { required: true });
      if (project.characters.some(character => character.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
        throw new ComicCoreError("DUPLICATE_CHARACTER", "A character with this name already exists", "comic.duplicate_character.a_character_with_this_name_already_exists", {});
      }
      const character: ComicCharacter = {
        id: identifier(idFactory("character"), "character", "character.id"),
        name,
        ...(command.character.aliases === undefined ? {} : { aliases: textList(command.character.aliases, "character.aliases", 100, 120) }),
        description: boundedText(command.character.description, "character.description", 4_000),
        appearance: boundedText(command.character.appearance, "character.appearance", 8_000),
        voice: boundedText(command.character.voice, "character.voice", 500),
        ...(command.character.identityVersion === undefined ? {} : { identityVersion: boundedText(command.character.identityVersion, "character.identityVersion", 120) }),
        ...(command.character.referenceAssetIds === undefined ? {} : { referenceAssetIds: characterReferenceAssetIds(command.character.referenceAssetIds, project, "character.referenceAssetIds")! }),
        ...(command.character.authorizationRef === undefined ? {} : { authorizationRef: boundedText(command.character.authorizationRef, "character.authorizationRef", 500) }),
        ...(command.character.sourceBundleId === undefined ? {} : { sourceBundleId: identifier(command.character.sourceBundleId, "bundle", "character.sourceBundleId") }),
        ...(command.character.sourceProjectId === undefined ? {} : { sourceProjectId: identifier(command.character.sourceProjectId, "project", "character.sourceProjectId") }),
        ...(command.character.sourceCharacterId === undefined ? {} : { sourceCharacterId: identifier(command.character.sourceCharacterId, "character", "character.sourceCharacterId") }),
        createdAt: now,
        updatedAt: now,
      };
      next = {
        ...project,
        characters: [...project.characters, character],
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    case "character.update": {
      record(command.patch, "character.patch");
      const characterId = identifier(command.characterId, "character", "characterId");
      const index = project.characters.findIndex(character => character.id === characterId);
      if (index < 0) throw new ComicCoreError("CHARACTER_NOT_FOUND", "Character does not exist", "comic.character_not_found.character_does_not_exist", {});
      const current = project.characters[index];
      const name = command.patch.name === undefined
        ? current.name
        : boundedText(command.patch.name, "character.name", 120, { required: true });
      if (project.characters.some(character => character.id !== characterId
        && character.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
        throw new ComicCoreError("DUPLICATE_CHARACTER", "A character with this name already exists", "comic.duplicate_character.a_character_with_this_name_already_exists", {});
      }
      const characters = [...project.characters];
      characters[index] = {
        ...current,
        name,
        ...(command.patch.aliases === undefined ? {} : { aliases: textList(command.patch.aliases, "character.aliases", 100, 120) }),
        description: command.patch.description === undefined
          ? current.description
          : boundedText(command.patch.description, "character.description", 4_000),
        appearance: command.patch.appearance === undefined
          ? current.appearance
          : boundedText(command.patch.appearance, "character.appearance", 8_000),
        voice: command.patch.voice === undefined
          ? current.voice
          : boundedText(command.patch.voice, "character.voice", 500),
        ...(command.patch.identityVersion === undefined ? (current.identityVersion === undefined ? {} : { identityVersion: current.identityVersion }) : { identityVersion: boundedText(command.patch.identityVersion, "character.identityVersion", 120) }),
        ...(command.patch.referenceAssetIds === undefined ? (current.referenceAssetIds === undefined ? {} : { referenceAssetIds: current.referenceAssetIds }) : { referenceAssetIds: characterReferenceAssetIds(command.patch.referenceAssetIds, project, "character.referenceAssetIds")! }),
        ...(command.patch.authorizationRef === undefined ? (current.authorizationRef === undefined ? {} : { authorizationRef: current.authorizationRef }) : { authorizationRef: boundedText(command.patch.authorizationRef, "character.authorizationRef", 500) }),
        ...(command.patch.sourceBundleId === undefined ? (current.sourceBundleId === undefined ? {} : { sourceBundleId: current.sourceBundleId }) : { sourceBundleId: identifier(command.patch.sourceBundleId, "bundle", "character.sourceBundleId") }),
        ...(command.patch.sourceProjectId === undefined ? (current.sourceProjectId === undefined ? {} : { sourceProjectId: current.sourceProjectId }) : { sourceProjectId: identifier(command.patch.sourceProjectId, "project", "character.sourceProjectId") }),
        ...(command.patch.sourceCharacterId === undefined ? (current.sourceCharacterId === undefined ? {} : { sourceCharacterId: current.sourceCharacterId }) : { sourceCharacterId: identifier(command.patch.sourceCharacterId, "character", "character.sourceCharacterId") }),
        updatedAt: now,
      };
      next = { ...project, characters, revision: project.revision + 1, updatedAt: now };
      break;
    }
    case "character.delete": {
      const characterId = identifier(command.characterId, "character", "characterId");
      if (!project.characters.some(character => character.id === characterId)) {
        throw new ComicCoreError("CHARACTER_NOT_FOUND", "Character does not exist", "comic.character_not_found.character_does_not_exist", {});
      }
      next = {
        ...project,
        characters: project.characters.filter(character => character.id !== characterId),
        scenes: project.scenes.map(scene => ({
          ...scene,
          shots: scene.shots.map(shot => ({
            ...shot,
            dialogueCues: shot.dialogueCues.map(cue => cue.speakerCharacterId === characterId
              ? { ...cue, speakerCharacterId: undefined }
              : cue),
          })),
        })),
        revision: project.revision + 1,
        updatedAt: now,
      };
      break;
    }
    default:
      throw new ComicCoreError("INVALID_COMMAND", "Unsupported comic command", "comic.invalid_command.unsupported_comic_command", {});
  }
  if (next.scenes !== project.scenes || next.frameRate !== project.frameRate) {
    const shots = next.scenes.flatMap(scene => scene.shots);
    assertUnique(shots.map(shot => shot.id), "shots");
    assertUnique(shots.flatMap(shot => shot.dialogueCues.map(cue => cue.id)), "dialogue cues");
    for (const shot of shots) assertComicShotMediaRanges(next, shot);
  }
  return options.locale === undefined ? next : { ...next, defaultTitleLocale: locale };
}

export function summarizeComicProject(project: ComicProject): ComicProjectSummary {
  const shots = project.scenes.flatMap(scene => scene.shots);
  const durationFrames = project.composition
    ? project.composition.clips.reduce((end, clip) => Math.max(end, clip.from + clip.durationFrames), 0)
    : shots.reduce((total, shot) => total + shot.durationFrames, 0);
  return {
    sceneCount: project.scenes.length,
    shotCount: shots.length,
    durationFrames,
    durationSeconds: durationFrames / project.frameRate,
  };
}

export function formatComicTimecode(frames: number, rate: number): string {
  integer(frames, "frames", 0, Number.MAX_SAFE_INTEGER);
  const validRate = frameRate(rate);
  const frame = frames % validRate;
  const secondsTotal = Math.floor(frames / validRate);
  const seconds = secondsTotal % 60;
  const minutesTotal = Math.floor(secondsTotal / 60);
  const minutes = minutesTotal % 60;
  const hours = Math.floor(minutesTotal / 60);
  return [hours, minutes, seconds, frame].map(value => String(value).padStart(2, "0")).join(":");
}

function validateSetPlate(assetId: string, project: ComicProject): void {
  identifier(assetId, "asset", "scene.setPlateAssetId");
  if (project.assets.find(asset => asset.id === assetId)?.kind !== "image") throw new ComicCoreError("INVALID_REFERENCE", "Scene set plate must reference an image in this project", "comic.invalid_reference.scene_set_plate_must_reference_an_image_in_this_project", {});
}

function derivedTitle(source: ComicShot, kind: "copy" | "split", locale: string): { readonly title: string; readonly titleDefault: ComicDefaultTitle } {
  const titleDefault: ComicDefaultTitle = { kind, locale, baseTitle: source.title,
    ...(source.titleDefault && source.title === comicDefaultTitle(source.titleDefault) ? { baseDefault: source.titleDefault } : {}) };
  return { title: comicDefaultTitle(titleDefault), titleDefault };
}

function fitBeats(beats: readonly ComicShotBeat[], start: number, end: number, maxDuration = end - start): readonly ComicShotBeat[] | undefined {
  const fitted = beats
    .filter(beat => beat.endSeconds > start && beat.startSeconds < end)
    .map(beat => {
      const startSeconds = Math.min(maxDuration, Math.max(0, Math.max(start, beat.startSeconds) - start));
      const endSeconds = Math.min(maxDuration, Math.max(0, Math.min(end, beat.endSeconds) - start));
      return { ...beat, startSeconds, endSeconds };
    })
    .filter(beat => beat.endSeconds >= 0.05 && beat.endSeconds - beat.startSeconds > 1e-6);
  return fitted.length ? fitted : undefined;
}
