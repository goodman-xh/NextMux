import { browserSha256 } from "./browser-sha256.js";
import { normalizeCanvasCharacterProfile } from "./canvas-character-profile.js";
import { assertComicShotMediaRanges } from "./media-timing.js";
import { validateComicComposition } from "./composition.js";
import {
  applyComicCommand,
  createComicProject,
  repairComicShotMediaRanges,
} from "./core.js";
import type {
  ComicAsset,
  ComicCharacter,
  ComicDialogueCue,
  ComicIdFactory,
  ComicProject,
  ComicScene,
  ComicShot,
  ParsedComicProject,
  ParseComicProjectOptions,
} from "./types.js";
import {
  COMIC_MEDIA_DIRECTORY,
  COMIC_PROJECT_SCHEMA_VERSION,
} from "./types.js";
import {
  adaptSettings,
  boolean,
  defaultTitle,
  shotGrammar,
  textList,
  musicSettings,
  array,
  assertUnique,
  episodeScripts,
  boundedText,
  cameraMotion,
  canvas,
  ComicCoreError,
  frameRate,
  identifier,
  integer,
  mediaFit,
  numberRange,
  projectKind,
  record,
  shotSize,
  shotStatus,
  timestamp,
  transition,
} from "./validation.js";

const MAX_PROJECT_CHARACTERS = 8_000_000;
const MAX_SCENES = 300;
const MAX_SHOTS = 5_000;
const MAX_CHARACTERS = 500;
const MAX_ASSETS = 10_000;
const MAX_DIALOGUE_PER_SHOT = 100;
const MAX_SHOT_FRAMES = 30 * 60 * 10;

function optionalIdentifier(value: unknown, prefix: string, label: string): string | undefined {
  return value === undefined ? undefined : identifier(value, prefix, label);
}

function character(value: unknown, index: number): ComicCharacter {
  const item = record(value, `characters[${index}]`);
  const referenceAssetIds = item.referenceAssetIds === undefined
    ? undefined
    : array(item.referenceAssetIds, `characters[${index}].referenceAssetIds`, 16)
      .map((entry, position) => identifier(entry, "asset", `characters[${index}].referenceAssetIds[${position}]`));
  if (referenceAssetIds) assertUnique(referenceAssetIds, `characters[${index}].referenceAssetIds`);
  return {
    id: identifier(item.id, "character", `characters[${index}].id`),
    name: boundedText(item.name, `characters[${index}].name`, 120, { required: true }),
    ...(item.aliases === undefined ? {} : { aliases: textList(item.aliases, `characters[${index}].aliases`, 100, 120) }),
    description: boundedText(item.description, `characters[${index}].description`, 4_000),
    appearance: boundedText(item.appearance, `characters[${index}].appearance`, 8_000),
    voice: boundedText(item.voice, `characters[${index}].voice`, 500),
    ...(item.canvasCharacter === undefined ? {} : { canvasCharacter: normalizeCanvasCharacterProfile(item.canvasCharacter) }),
    ...(item.identityVersion === undefined ? {} : { identityVersion: boundedText(item.identityVersion, `characters[${index}].identityVersion`, 120) }),
    ...(referenceAssetIds === undefined ? {} : { referenceAssetIds }),
    ...(item.authorizationRef === undefined ? {} : { authorizationRef: boundedText(item.authorizationRef, `characters[${index}].authorizationRef`, 500) }),
    ...(item.sourceBundleId === undefined ? {} : { sourceBundleId: identifier(item.sourceBundleId, "bundle", `characters[${index}].sourceBundleId`) }),
    ...(item.sourceProjectId === undefined ? {} : { sourceProjectId: identifier(item.sourceProjectId, "project", `characters[${index}].sourceProjectId`) }),
    ...(item.sourceCharacterId === undefined ? {} : { sourceCharacterId: identifier(item.sourceCharacterId, "character", `characters[${index}].sourceCharacterId`) }),
    createdAt: timestamp(item.createdAt, `characters[${index}].createdAt`),
    updatedAt: timestamp(item.updatedAt, `characters[${index}].updatedAt`),
  };
}

function asset(value: unknown, index: number): ComicAsset {
  const item = record(value, `assets[${index}]`);
  const kind = item.kind;
  if (kind !== "image" && kind !== "audio" && kind !== "music" && kind !== "effect" && kind !== "video" && kind !== "subtitle") {
    throw new ComicCoreError("INVALID_PROJECT", `assets[${index}].kind is not supported`, "comic.invalid_project.assets_kind_is_not_supported", { index });
  }
  const source = item.source;
  if (source !== "imported" && source !== "generated") {
    throw new ComicCoreError("INVALID_PROJECT", `assets[${index}].source is not supported`, "comic.invalid_project.assets_source_is_not_supported", { index });
  }
  const status = item.status;
  if (status !== "ready" && status !== "missing" && status !== "generating" && status !== "failed") {
    throw new ComicCoreError("INVALID_PROJECT", `assets[${index}].status is not supported`, "comic.invalid_project.assets_status_is_not_supported", { index });
  }
  const mimeType = item.mimeType === undefined
    ? undefined
    : boundedText(item.mimeType, `assets[${index}].mimeType`, 100, { required: true });
  const byteLength = item.byteLength === undefined
    ? undefined
    : integer(item.byteLength, `assets[${index}].byteLength`, 1, 512 * 1024 * 1024);
  const sha256 = item.sha256;
  if (sha256 !== undefined && (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))) {
    throw new ComicCoreError("INVALID_PROJECT", `assets[${index}].sha256 is invalid`, "comic.invalid_project.assets_sha256_is_invalid", { index });
  }
  const jobId = item.jobId;
  if (jobId !== undefined && (typeof jobId !== "string" || !/^media-job-[0-9a-f-]{36}$/.test(jobId))) {
    throw new ComicCoreError("INVALID_PROJECT", `assets[${index}].jobId is invalid`, "comic.invalid_project.assets_jobid_is_invalid", { index });
  }
  const uri = boundedText(item.uri, `assets[${index}].uri`, 2_048, { required: true });
  const managedMediaPath = uri.startsWith(`${COMIC_MEDIA_DIRECTORY}/`);
  if (source === "generated" && (!managedMediaPath || uri.includes("..")
      || uri.includes("\\") || uri.includes(":"))) {
    throw new ComicCoreError("INVALID_PROJECT", `assets[${index}].uri leaves nextmux.media`, "comic.invalid_project.assets_uri_leaves_nextmux_media", { index });
  }
  return {
    id: identifier(item.id, "asset", `assets[${index}].id`),
    kind,
    source,
    uri,
    status,
    ...(item.prompt === undefined ? {} : { prompt: boundedText(item.prompt, `assets[${index}].prompt`, 20_000) }),
    ...(item.provider === undefined ? {} : { provider: boundedText(item.provider, `assets[${index}].provider`, 200) }),
    ...(item.model === undefined ? {} : { model: boundedText(item.model, `assets[${index}].model`, 200) }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(byteLength === undefined ? {} : { byteLength }),
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(jobId === undefined ? {} : { jobId }),
    ...(item.sourceAssetId === undefined ? {} : { sourceAssetId: identifier(item.sourceAssetId, "asset", `assets[${index}].sourceAssetId`) }),
    ...(item.durationMs === undefined ? {} : { durationMs: integer(item.durationMs, `assets[${index}].durationMs`, 1, 24 * 60 * 60_000) }),
    ...(item.streamStartMs === undefined ? {} : { streamStartMs: integer(item.streamStartMs, `assets[${index}].streamStartMs`, 0, Number.MAX_SAFE_INTEGER) }),
    ...(item.width === undefined ? {} : { width: integer(item.width, `assets[${index}].width`, 1, 16_384) }),
    ...(item.height === undefined ? {} : { height: integer(item.height, `assets[${index}].height`, 1, 16_384) }),
    createdAt: timestamp(item.createdAt, `assets[${index}].createdAt`),
    updatedAt: timestamp(item.updatedAt, `assets[${index}].updatedAt`),
  };
}

function dialogue(
  value: unknown,
  sceneIndex: number,
  shotIndex: number,
  cueIndex: number,
  durationFrames: number,
  characterIds: ReadonlySet<string>,
): ComicDialogueCue {
  const label = `scenes[${sceneIndex}].shots[${shotIndex}].dialogueCues[${cueIndex}]`;
  const item = record(value, label);
  const speakerCharacterId = optionalIdentifier(item.speakerCharacterId, "character", `${label}.speakerCharacterId`);
  if (speakerCharacterId && !characterIds.has(speakerCharacterId)) {
    throw new ComicCoreError("INVALID_REFERENCE", `${label} refers to an unknown character`, "comic.invalid_reference.refers_to_an_unknown_character", { field: label });
  }
  const startFrame = integer(item.startFrame, `${label}.startFrame`, 0, durationFrames - 1);
  return {
    id: identifier(item.id, "dialogue", `${label}.id`),
    ...(item.continuationOfCueId === undefined ? {} : { continuationOfCueId: identifier(item.continuationOfCueId, "dialogue", `${label}.continuationOfCueId`) }),
    ...(speakerCharacterId ? { speakerCharacterId } : {}),
    text: boundedText(item.text, `${label}.text`, 5_000, { required: true }),
    ...(item.tone === undefined ? {} : { tone: boundedText(item.tone, `${label}.tone`, 300) }),
    startFrame,
    durationFrames: integer(item.durationFrames, `${label}.durationFrames`, 1, durationFrames - startFrame),
  };
}

function shot(
  value: unknown,
  scenePosition: number,
  shotPosition: number,
  characterIds: ReadonlySet<string>,
  assetsById: ReadonlyMap<string, ComicAsset>,
  projectFrameRate: number,
): ComicShot {
  const label = `scenes[${scenePosition}].shots[${shotPosition}]`;
  const item = record(value, label);
  const durationFrames = integer(item.durationFrames, `${label}.durationFrames`, 1, MAX_SHOT_FRAMES);
  const fadeInFrames = integer(item.fadeInFrames ?? 0, `${label}.fadeInFrames`, 0, durationFrames);
  const fadeOutFrames = integer(item.fadeOutFrames ?? 0, `${label}.fadeOutFrames`, 0, durationFrames);
  if (fadeInFrames + fadeOutFrames > durationFrames) throw new ComicCoreError("INVALID_PROJECT", `${label} fade ranges cannot exceed its duration`, "comic.invalid_project.fade_ranges_cannot_exceed_its_duration", { field: label });
  const visualAssetId = optionalIdentifier(item.visualAssetId, "asset", `${label}.visualAssetId`);
  const audioAssetId = optionalIdentifier(item.audioAssetId, "asset", `${label}.audioAssetId`);
  const musicAssetIds = array(item.musicAssetIds === undefined ? [] : item.musicAssetIds, `${label}.musicAssetIds`, MAX_ASSETS)
    .map((assetId, index) => optionalIdentifier(assetId, "asset", `${label}.musicAssetIds[${index}]`))
    .filter((assetId): assetId is string => Boolean(assetId));
  const effectAssetIds = array(item.effectAssetIds === undefined ? [] : item.effectAssetIds, `${label}.effectAssetIds`, MAX_ASSETS)
    .map((assetId, index) => optionalIdentifier(assetId, "asset", `${label}.effectAssetIds[${index}]`))
    .filter((assetId): assetId is string => Boolean(assetId));
  const subtitleAssetId = optionalIdentifier(item.subtitleAssetId, "asset", `${label}.subtitleAssetId`);
  const videoAssetId = optionalIdentifier(item.videoAssetId, "asset", `${label}.videoAssetId`);
  const pendingVideoAssetId = optionalIdentifier(item.pendingVideoAssetId, "asset", `${label}.pendingVideoAssetId`);
  const references = [
    [visualAssetId, "image", "visual"],
    [audioAssetId, "audio", "audio"],
    [subtitleAssetId, "subtitle", "subtitle"],
    [videoAssetId, "video", "video"],
    [pendingVideoAssetId, "video", "pendingVideo"],
  ] as const;
  for (const [assetId, expectedKind, slot] of references) {
    if (!assetId) continue;
    const linked = assetsById.get(assetId);
    if (!linked) throw new ComicCoreError("INVALID_REFERENCE", `${label} refers to an unknown ${slot} asset`, "comic.invalid_reference.refers_to_an_unknown_asset", { field: label, slot });
    if (linked.kind !== expectedKind) {
      throw new ComicCoreError("INVALID_REFERENCE", `${label}.${slot} asset has the wrong kind`, "comic.invalid_reference.asset_has_the_wrong_kind", { field: label, slot });
    }
  }
  for (const [assetIds, expectedKind, slot] of [[musicAssetIds, "music", "music"], [effectAssetIds, "effect", "effect"]] as const) {
    assertUnique(assetIds, `${label}.${slot}AssetIds`);
    for (const assetId of assetIds) {
      const linked = assetsById.get(assetId);
      if (!linked) throw new ComicCoreError("INVALID_REFERENCE", `${label} refers to an unknown ${slot} asset`, "comic.invalid_reference.refers_to_an_unknown_asset", { field: label, slot });
      if (linked.kind !== expectedKind) throw new ComicCoreError("INVALID_REFERENCE", `${label}.${slot} asset has the wrong kind`, "comic.invalid_reference.asset_has_the_wrong_kind", { field: label, slot });
    }
  }
  const dialogueCues = array(item.dialogueCues, `${label}.dialogueCues`, MAX_DIALOGUE_PER_SHOT)
    .map((cue, index) => dialogue(cue, scenePosition, shotPosition, index, durationFrames, characterIds));
  assertUnique(dialogueCues.map(cue => cue.id), `${label}.dialogueCues`);
  const timedReferences = new Set([videoAssetId, audioAssetId, subtitleAssetId, ...musicAssetIds, ...effectAssetIds].filter(Boolean));
  const sourceStarts = item.mediaSourceStartFrames === undefined ? undefined
    : Object.fromEntries(Object.entries(record(item.mediaSourceStartFrames, `${label}.mediaSourceStartFrames`)).map(([id, offset]) => {
      if (!timedReferences.has(id)) throw new ComicCoreError("INVALID_REFERENCE", `${label} has a source range for an unlinked asset`, "comic.invalid_reference.has_a_source_range_for_an_unlinked_asset", { field: label });
      return [id, integer(offset, `${label}.mediaSourceStartFrames.${id}`, 0, 1_000_000_000)];
    }));
  const mediaDurations = item.mediaDurationFrames === undefined ? undefined
    : Object.fromEntries(Object.entries(record(item.mediaDurationFrames, `${label}.mediaDurationFrames`)).map(([id, length]) => {
      if (!timedReferences.has(id)) throw new ComicCoreError("INVALID_REFERENCE", `${label} has a duration for an unlinked asset`, "comic.invalid_reference.has_a_source_range_for_an_unlinked_asset", { field: label });
      return [id, integer(length, `${label}.mediaDurationFrames.${id}`, 1, durationFrames)];
    }));
  const result: ComicShot = {
    id: identifier(item.id, "shot", `${label}.id`),
    title: boundedText(item.title, `${label}.title`, 120, { required: true }),
    ...(item.titleDefault === undefined ? {} : { titleDefault: defaultTitle(item.titleDefault, `${label}.titleDefault`) }),
    description: boundedText(item.description, `${label}.description`, 4_000),
    durationFrames,
    shotSize: shotSize(item.shotSize),
    cameraMotion: cameraMotion(item.cameraMotion),
    ...shotGrammar(item, durationFrames / projectFrameRate),
    visualPrompt: boundedText(item.visualPrompt, `${label}.visualPrompt`, 20_000),
    negativePrompt: boundedText(item.negativePrompt, `${label}.negativePrompt`, 10_000),
    transitionIn: transition(item.transitionIn ?? "cut"),
    transitionOut: transition(item.transitionOut ?? "cut"),
    ...(item.transitionOutExplicit === undefined ? {} : { transitionOutExplicit: boolean(item.transitionOutExplicit, `${label}.transitionOutExplicit`) }),
    volume: numberRange(item.volume ?? 1, `${label}.volume`, 0, 2),
    fadeInFrames,
    fadeOutFrames,
    dialogueCues,
    ...(visualAssetId ? { visualAssetId } : {}),
    ...(audioAssetId ? { audioAssetId } : {}),
    ...(musicAssetIds.length ? { musicAssetIds } : {}),
    ...(effectAssetIds.length ? { effectAssetIds } : {}),
    ...(subtitleAssetId ? { subtitleAssetId } : {}),
    ...(videoAssetId ? { videoAssetId } : {}),
    ...(pendingVideoAssetId ? { pendingVideoAssetId } : {}),
    ...(sourceStarts && Object.keys(sourceStarts).length ? { mediaSourceStartFrames: sourceStarts } : {}),
    ...(mediaDurations && Object.keys(mediaDurations).length ? { mediaDurationFrames: mediaDurations } : {}),
    ...(item.mediaFit === undefined ? {} : { mediaFit: mediaFit(item.mediaFit) }),
    status: shotStatus(item.status),
    createdAt: timestamp(item.createdAt, `${label}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${label}.updatedAt`),
  };
  const timing = { assets: [...assetsById.values()], frameRate: projectFrameRate as ComicProject["frameRate"] };
  try {
    assertComicShotMediaRanges(timing, result);
    return result;
  } catch (error) {
    if (!(error instanceof ComicCoreError) || error.code !== "INVALID_PROJECT") throw error;
  }
  // An older file may overrun a source; open it repaired rather than not at all.
  const repaired = repairComicShotMediaRanges(timing, result);
  assertComicShotMediaRanges(timing, repaired);
  return repaired;
}

function scene(
  value: unknown,
  position: number,
  characterIds: ReadonlySet<string>,
  assetsById: ReadonlyMap<string, ComicAsset>,
  projectFrameRate: number,
): ComicScene {
  const label = `scenes[${position}]`;
  const item = record(value, label);
  const shots = array(item.shots, `${label}.shots`, MAX_SHOTS)
    .map((entry, index) => shot(entry, position, index, characterIds, assetsById, projectFrameRate));
  assertUnique(shots.map(entry => entry.id), `${label}.shots`);
  const setPlateAssetId = optionalIdentifier(item.setPlateAssetId, "asset", `${label}.setPlateAssetId`);
  if (setPlateAssetId && assetsById.get(setPlateAssetId)?.kind !== "image") throw new ComicCoreError("INVALID_REFERENCE", `${label}.setPlateAssetId must reference an image`, "comic.invalid_reference.setplateassetid_must_reference_an_image", { field: label });
  return {
    id: identifier(item.id, "scene", `${label}.id`),
    ...(item.episodeNumber === undefined ? {} : { episodeNumber: integer(item.episodeNumber, `${label}.episodeNumber`, 1, 10_000) }),
    title: boundedText(item.title, `${label}.title`, 120, { required: true }),
    ...(item.titleDefault === undefined ? {} : { titleDefault: defaultTitle(item.titleDefault, `${label}.titleDefault`) }),
    summary: boundedText(item.summary, `${label}.summary`, 4_000),
    location: boundedText(item.location, `${label}.location`, 200),
    timeOfDay: boundedText(item.timeOfDay, `${label}.timeOfDay`, 80),
    ...(setPlateAssetId ? { setPlateAssetId } : {}),
    shots,
    createdAt: timestamp(item.createdAt, `${label}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${label}.updatedAt`),
  };
}

export function validateComicProject(value: unknown): ComicProject {
  const item = record(value, "project");
  if (item.schemaVersion !== COMIC_PROJECT_SCHEMA_VERSION) {
    throw new ComicCoreError("UNSUPPORTED_SCHEMA", "Comic project schema is not supported by this version", "comic.unsupported_schema.comic_project_schema_is_not_supported_by_this_version", {});
  }
  const characters = array(item.characters, "characters", MAX_CHARACTERS).map(character);
  const assets = array(item.assets, "assets", MAX_ASSETS).map(asset);
  assertUnique(characters.map(entry => entry.id), "characters");
  assertUnique(assets.map(entry => entry.id), "assets");
  const characterIds = new Set(characters.map(entry => entry.id));
  const assetsById = new Map(assets.map(entry => [entry.id, entry]));
  for (const [index, entry] of characters.entries()) {
    for (const assetId of entry.referenceAssetIds || []) {
      if (assetsById.get(assetId)?.kind !== "image") {
        throw new ComicCoreError("INVALID_REFERENCE", `characters[${index}].referenceAssetIds contains a missing or non-image asset`, "comic.invalid_reference.characters_referenceassetids_contains_a_missing_or_non_image_asset", { index });
      }
    }
  }
  const music = item.music === undefined ? undefined : musicSettings(item.music, "project.music");
  if (music?.mv?.singerPortraitAssetId && assetsById.get(music.mv.singerPortraitAssetId)?.kind !== "image") throw new ComicCoreError("INVALID_REFERENCE", "MV singer portrait must reference an image in this project", "comic.invalid_reference.mv_singer_portrait_must_reference_an_image_in_this_project", {});
  const scenes = array(item.scenes, "scenes", MAX_SCENES)
    .map((entry, index) => scene(entry, index, characterIds, assetsById, frameRate(item.frameRate)));
  assertUnique(scenes.map(entry => entry.id), "scenes");
  const shots = scenes.flatMap(entry => entry.shots);
  if (shots.length > MAX_SHOTS) {
    throw new ComicCoreError("PROJECT_TOO_LARGE", `Comic project can contain at most ${MAX_SHOTS} shots`, "comic.project_too_large.comic_project_can_contain_at_most_shots", { maximum: MAX_SHOTS });
  }
  assertUnique(shots.map(entry => entry.id), "shots");
  assertUnique(shots.flatMap(entry => entry.dialogueCues).map(entry => entry.id), "dialogue cues");
  return {
    schemaVersion: COMIC_PROJECT_SCHEMA_VERSION,
    ...(item.defaultTitleLocale === undefined ? {} : { defaultTitleLocale: boundedText(item.defaultTitleLocale, "project.defaultTitleLocale", 40, { required: true }) }),
    id: identifier(item.id, "project", "project.id"),
    ...(item.projectKind === undefined || item.projectKind === "novel" ? {} : { projectKind: projectKind(item.projectKind) }),
    revision: integer(item.revision, "project.revision", 0, Number.MAX_SAFE_INTEGER),
    title: boundedText(item.title, "project.title", 120, { required: true }),
    ...(item.titleDefault === undefined ? {} : { titleDefault: defaultTitle(item.titleDefault, "project.titleDefault") }),
    ...(item.continuousShotsShareFrames === undefined ? {} : { continuousShotsShareFrames: boolean(item.continuousShotsShareFrames, "project.continuousShotsShareFrames") }),
    frameRate: frameRate(item.frameRate),
    canvas: canvas(item.canvas),
    styleBible: boundedText(item.styleBible, "project.styleBible", 40_000),
    ...(item.episodes === undefined ? {} : { episodes: episodeScripts(item.episodes, "project.episodes") }),
    ...(item.adaptSettings === undefined ? {} : { adaptSettings: adaptSettings(item.adaptSettings, "project.adaptSettings") }),
    ...(music === undefined ? {} : { music }),
    characters,
    assets,
    scenes,
    ...(item.composition === undefined ? {} : { composition: validateComicComposition(item.composition, { assets, frameRate: frameRate(item.frameRate), canvas: canvas(item.canvas) }) }),
    createdAt: timestamp(item.createdAt, "project.createdAt"),
    updatedAt: timestamp(item.updatedAt, "project.updatedAt"),
  };
}

function legacyText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Identities for a schema-0 project derived from its own content: reading the same old file twice gives the same
 * scenes and shots, so a first edit still finds them (audit B15-001).
 */
function legacyIdFactory(options: ParseComicProjectOptions, value: Record<string, unknown>): ComicIdFactory {
  if (options.idFactory) return options.idFactory;
  const seed = browserSha256(JSON.stringify(value));
  let counter = 0;
  return prefix => {
    const hash = browserSha256(`${seed}:${prefix}:${counter++}`);
    return `${prefix}-${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  };
}

function migrateLegacyProject(value: Record<string, unknown>, options: ParseComicProjectOptions): ComicProject {
  const migration = { ...options, idFactory: legacyIdFactory(options, value) };
  const rateValue = Number.isSafeInteger(value.frameRate) ? value.frameRate : 24;
  const rate = rateValue === 25 || rateValue === 30 ? rateValue : 24;
  let project = createComicProject({
    ...(typeof value.title === "string" && value.title.trim() ? { title: value.title } : {}),
    locale: options.locale,
    frameRate: rate,
    starter: "empty",
    now: options.now,
    idFactory: migration.idFactory,
  });
  const legacyScenes = Array.isArray(value.scenes) ? value.scenes.slice(0, MAX_SCENES) : [];
  for (const [scenePosition, sceneValue] of legacyScenes.entries()) {
    const oldScene = sceneValue && typeof sceneValue === "object" && !Array.isArray(sceneValue)
      ? sceneValue as Record<string, unknown>
      : {};
    project = applyComicCommand(project, {
      type: "scene.add",
      expectedRevision: project.revision,
      scene: {
        ...(typeof oldScene.title === "string" && oldScene.title.trim() ? { title: oldScene.title } : {}),
        summary: legacyText(oldScene.summary),
        location: legacyText(oldScene.location),
        timeOfDay: legacyText(oldScene.timeOfDay),
      },
    }, migration);
    const currentScene = project.scenes[project.scenes.length - 1];
    const legacyShots = Array.isArray(oldScene.shots) ? oldScene.shots : [];
    for (const [shotPosition, shotValue] of legacyShots.slice(0, MAX_SHOTS).entries()) {
      const oldShot = shotValue && typeof shotValue === "object" && !Array.isArray(shotValue)
        ? shotValue as Record<string, unknown>
        : {};
      const seconds = typeof oldShot.durationSeconds === "number" && Number.isFinite(oldShot.durationSeconds)
        ? Math.min(600, Math.max(1 / rate, oldShot.durationSeconds))
        : 4;
      project = applyComicCommand(project, {
        type: "shot.add",
        expectedRevision: project.revision,
        sceneId: currentScene.id,
        shot: {
          ...(typeof oldShot.title === "string" && oldShot.title.trim() ? { title: oldShot.title } : {}),
          description: legacyText(oldShot.description),
          durationFrames: Math.max(1, Math.round(seconds * rate)),
          visualPrompt: legacyText(oldShot.visualPrompt),
          negativePrompt: legacyText(oldShot.negativePrompt),
        },
      }, migration);
      const currentShot = project.scenes[project.scenes.length - 1].shots.at(-1)!;
      const dialogueText = legacyText(oldShot.dialogue);
      if (dialogueText.trim()) {
        project = applyComicCommand(project, {
          type: "dialogue.replace",
          expectedRevision: project.revision,
          sceneId: currentScene.id,
          shotId: currentShot.id,
          cues: [{ text: dialogueText }],
        }, migration);
      }
    }
  }
  return project;
}

function migrateSchemaOneProject(value: Record<string, unknown>): ComicProject {
  const assets = Array.isArray(value.assets) ? value.assets.map(candidate => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const item = candidate as Record<string, unknown>;
    return { ...item, updatedAt: item.updatedAt ?? item.createdAt };
  }) : value.assets;
  return validateComicProject({ ...value, schemaVersion: COMIC_PROJECT_SCHEMA_VERSION, assets });
}

export function parseComicProject(
  input: string | unknown,
  options: ParseComicProjectOptions = {},
): ParsedComicProject {
  let value = input;
  if (typeof input === "string") {
    if (input.length > MAX_PROJECT_CHARACTERS) {
      throw new ComicCoreError("PROJECT_TOO_LARGE", "Comic project file exceeds the 8 MB text limit", "comic.project_too_large.comic_project_file_exceeds_the_8_mb_text_limit", { maximum: 8 * 1024 * 1024 });
    }
    try {
      value = JSON.parse(input);
    } catch {
      throw new ComicCoreError("INVALID_JSON", "Comic project file is not valid JSON", "comic.invalid_json.comic_project_file_is_not_valid_json", {});
    }
  }
  const item = record(value, "project");
  if (item.schemaVersion === COMIC_PROJECT_SCHEMA_VERSION) {
    return { project: validateComicProject(item) };
  }
  if (item.schemaVersion === undefined || item.schemaVersion === 0) {
    return { project: migrateLegacyProject(item, options), migratedFrom: 0 };
  }
  if (item.schemaVersion === 1) {
    return { project: migrateSchemaOneProject(item), migratedFrom: 1 };
  }
  throw new ComicCoreError(
    "UNSUPPORTED_SCHEMA",
    `Comic project schema ${String(item.schemaVersion)} is newer than this application`, "comic.unsupported_schema.comic_project_schema_is_newer_than_this_application", { version: String(item.schemaVersion) },
  );
}

export function serializeComicProject(project: ComicProject): string {
  const normalized = validateComicProject(project);
  const serialized = `${JSON.stringify(normalized, undefined, 2)}\n`;
  if (serialized.length > MAX_PROJECT_CHARACTERS) {
    throw new ComicCoreError("PROJECT_TOO_LARGE", "Comic project file exceeds the 8 MB text limit", "comic.project_too_large.comic_project_file_exceeds_the_8_mb_text_limit", { maximum: 8 * 1024 * 1024 });
  }
  return serialized;
}
