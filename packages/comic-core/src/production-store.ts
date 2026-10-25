import { ComicDomainError, type ComicErrorParams } from "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { lock as acquireFileLock } from "proper-lockfile";

import type { ComicProject } from "./types.js";
import type {
  ComicCharacterEntity,
  ComicAudioTrack,
  ComicEpisode,
  ComicMediaAssetEntity,
  ComicProductionDocument,
  ComicSceneEntity,
  ComicShotEntity,
  ComicSubtitleTrack,
  ComicScriptAnalysis,
  ComicScriptDocument,
} from "./pipeline.js";
import { comicTitleWithDefault } from "./default-titles.js";
import { buildComicTimeline, COMIC_PIPELINE_SCHEMA_VERSION } from "./pipeline.js";
import { getComicMediaDurationFrames } from "./media-timing.js";

export const COMIC_PRODUCTION_FILE = "nextmux.comic.production.json" as const;
const MAX_BYTES = 32 * 1024 * 1024;
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 40_000;
const LOCK_UPDATE_MS = 5_000;

export interface ComicProductionStoreOptions {
  readonly workspaceRoot: string;
}

export interface ComicProductionState {
  readonly exists: boolean;
  readonly fileName: typeof COMIC_PRODUCTION_FILE;
  readonly document?: ComicProductionDocument;
  readonly sha256?: string;
}

type VersionedProductionEntity = {
  readonly id: string;
  readonly version: number;
  readonly createdAt?: string;
  readonly updatedAt: string;
};

function productionEntityFingerprint(value: VersionedProductionEntity): string {
  const { version: _version, createdAt: _createdAt, updatedAt: _updatedAt, ...stable } = value as VersionedProductionEntity & Record<string, unknown>;
  return JSON.stringify(stable);
}

function carryProductionEntityVersion<T extends VersionedProductionEntity>(
  next: T,
  previous: readonly T[],
): T {
  const old = previous.find(candidate => candidate.id === next.id);
  if (!old) return next;
  const preservedCreated = old.createdAt !== undefined && next.createdAt !== undefined ? { createdAt: old.createdAt } : {};
  if (productionEntityFingerprint(old) === productionEntityFingerprint(next)) {
    return { ...next, ...preservedCreated, version: old.version, updatedAt: old.updatedAt };
  }
  return { ...next, ...preservedCreated, version: old.version + 1 };
}

/** Preserve independent production entity versions across storyboard projections. */
export function preserveComicProductionVersions(
  next: ComicProductionDocument,
  previous: ComicProductionDocument | undefined,
): ComicProductionDocument {
  if (!previous || previous.projectId !== next.projectId) return next;
  return {
    ...next,
    episodes: next.episodes.map(entity => carryProductionEntityVersion(entity, previous.episodes)),
    scenes: next.scenes.map(entity => carryProductionEntityVersion(entity, previous.scenes)),
    shots: next.shots.map(entity => carryProductionEntityVersion(entity, previous.shots)),
    characters: next.characters.map(entity => carryProductionEntityVersion(entity, previous.characters)),
    assets: next.assets.map(entity => carryProductionEntityVersion(entity, previous.assets)),
    audioTracks: next.audioTracks.map(entity => carryProductionEntityVersion(entity, previous.audioTracks)),
    subtitleTracks: next.subtitleTracks.map(entity => carryProductionEntityVersion(entity, previous.subtitleTracks)),
    timelines: next.timelines.map(entity => carryProductionEntityVersion(entity, previous.timelines)),
    renderJobs: next.renderJobs.map(entity => carryProductionEntityVersion(entity, previous.renderJobs)),
  };
}

/** Build the production sidecar's stable entities from the existing storyboard. */
export interface ComicProductionProjectionOptions {
  readonly script?: ComicScriptDocument;
  readonly scriptAnalysis?: ComicScriptAnalysis;
}

export function productionDocumentFromComicProject(
  project: ComicProject,
  options: ComicProductionProjectionOptions = {},
): ComicProductionDocument {
  const now = project.updatedAt;
  const analysisEpisodes = options.scriptAnalysis?.episodes || [];
  // Episodes written on the production desk are the project's own; the older text analysis only guessed them
  // (it often saw one episode, which put every scene — and every export — into episode 1).
  const deskEpisodes = [...(project.episodes || [])].sort((left, right) => left.number - right.number)
    .map(item => ({ number: item.number, ...(item.title ? { title: item.title, ...(item.titleDefault ? { titleDefault: item.titleDefault } : {}) } : comicTitleWithDefault("episode", project.defaultTitleLocale, item.number)), summary: "", sourceStartLine: 1, sourceEndLine: 1 }));
  const episodePlans = deskEpisodes.length > 0
    ? deskEpisodes
    : analysisEpisodes.length > 0
      ? analysisEpisodes
      : [{ number: 1, title: project.title, ...(project.titleDefault ? { titleDefault: project.titleDefault } : {}), summary: "", sourceStartLine: 1, sourceEndLine: 1 }];
  const episodeId = `episode-${project.id.slice("project-".length)}`;
  const episodeIdByNumber = new Map(episodePlans.map((plan, index) => [plan.number, index === 0 ? episodeId : `${episodeId}-${String(plan.number).padStart(2, "0")}`]));
  const episode: ComicEpisode = {
    id: episodeId,
    version: 1,
    createdAt: project.createdAt,
    updatedAt: now,
    projectId: project.id,
    number: 1,
    title: episodePlans[0]?.title || project.title,
    ...(episodePlans[0]?.titleDefault ? { titleDefault: episodePlans[0].titleDefault } : {}),
    summary: episodePlans[0]?.summary || "",
    sceneIds: [],
    status: project.scenes.length ? "draft" : "draft",
  };
  const scenes: ComicSceneEntity[] = project.scenes.map(scene => ({
    id: scene.id,
    version: 1,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
    episodeId: episodeIdByNumber.get(scene.episodeNumber || 1) || episodeId,
    order: project.scenes.indexOf(scene),
    title: scene.title,
    ...(scene.titleDefault ? { titleDefault: scene.titleDefault } : {}),
    summary: scene.summary,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    ...(scene.setPlateAssetId ? { setPlateAssetId: scene.setPlateAssetId } : {}),
    shotIds: scene.shots.map(shot => shot.id),
  }));
  const shots: ComicShotEntity[] = project.scenes.flatMap(scene => scene.shots.map((shot, order) => ({
    id: shot.id,
    version: 1,
    createdAt: shot.createdAt,
    updatedAt: shot.updatedAt,
    episodeId: scenes.find(candidate => candidate.id === scene.id)?.episodeId || episodeId,
    sceneId: scene.id,
    order,
    title: shot.title,
    ...(shot.titleDefault ? { titleDefault: shot.titleDefault } : {}),
    description: shot.description,
    durationFrames: shot.durationFrames,
    ...(shot.transition === undefined ? {} : { transition: shot.transition }),
    ...(shot.cameraAngle === undefined ? {} : { cameraAngle: shot.cameraAngle }),
    ...(shot.lens === undefined ? {} : { lens: shot.lens }),
    ...(shot.beats === undefined ? {} : { beats: shot.beats }),
    ...(shot.searchTerms === undefined ? {} : { searchTerms: shot.searchTerms }),
    ...(shot.continuousTakeId === undefined ? {} : { continuousTakeId: shot.continuousTakeId }),
    ...(shot.transitionIn ? { transitionIn: shot.transitionIn } : {}),
    ...(shot.transitionOut ? { transitionOut: shot.transitionOut } : {}),
    ...(shot.transitionOutExplicit === undefined ? {} : { transitionOutExplicit: shot.transitionOutExplicit }),
    ...(shot.volume === undefined ? {} : { volume: shot.volume }),
    ...(shot.fadeInFrames ? { fadeInFrames: shot.fadeInFrames } : {}),
    ...(shot.fadeOutFrames ? { fadeOutFrames: shot.fadeOutFrames } : {}),
    visualPrompt: shot.visualPrompt,
    negativePrompt: shot.negativePrompt,
    referenceAssetIds: [...(shot.visualAssetId ? [shot.visualAssetId] : []), ...(scene.setPlateAssetId ? [scene.setPlateAssetId] : [])],
    ...(shot.videoAssetId ? { videoAssetId: shot.videoAssetId } : {}),
    ...(shot.videoAssetId && shot.mediaSourceStartFrames?.[shot.videoAssetId] ? { videoSourceStartFrame: shot.mediaSourceStartFrames[shot.videoAssetId] } : {}),
    ...(shot.audioAssetId ? { audioTrackId: `audio-track-${shot.id}` } : {}),
    ...(shot.musicAssetIds?.length ? { musicTrackIds: shot.musicAssetIds.map(assetId => `music-track-${shot.id}-${assetId}`) } : {}),
    ...(shot.effectAssetIds?.length ? { effectTrackIds: shot.effectAssetIds.map(assetId => `effect-track-${shot.id}-${assetId}`) } : {}),
    ...((shot.subtitleAssetId || shot.dialogueCues.length > 0) ? { subtitleTrackId: `subtitle-track-${shot.id}` } : {}),
    status: shot.status === "generated" ? "ready" : shot.status,
  })));
  const characters: ComicCharacterEntity[] = project.characters.map(character => ({
    id: character.id,
    version: 1,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
    projectId: project.id,
    name: character.name,
    ...(character.aliases ? { aliases: character.aliases } : {}),
    description: character.description,
    appearance: character.appearance,
    style: project.styleBible,
    ...(character.voice ? { voiceId: character.voice } : {}),
    ...(character.identityVersion ? { identityVersion: character.identityVersion } : {}),
    referenceAssetIds: character.referenceAssetIds || [],
    ...(character.authorizationRef ? { authorizationRef: character.authorizationRef } : {}),
    ...(character.sourceBundleId ? { sourceBundleId: character.sourceBundleId } : {}),
    ...(character.sourceProjectId ? { sourceProjectId: character.sourceProjectId } : {}),
    ...(character.sourceCharacterId ? { sourceCharacterId: character.sourceCharacterId } : {}),
  }));
  const assets: ComicMediaAssetEntity[] = project.assets.map(asset => ({
    id: asset.id,
    version: 1,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    projectId: project.id,
    kind: asset.kind,
    uri: asset.uri,
    mimeType: asset.mimeType || "application/octet-stream",
    sha256: asset.sha256 || "0".repeat(64),
    ...(asset.byteLength === undefined ? {} : { byteLength: asset.byteLength }),
    ...(asset.provider ? { providerId: asset.provider } : {}),
    ...(asset.model ? { modelId: asset.model } : {}),
    ...(asset.jobId ? { renderJobId: asset.jobId } : {}),
    ...(asset.sourceAssetId ? { sourceAssetId: asset.sourceAssetId } : {}),
    status: asset.status === "ready" ? "ready" : asset.status === "generating" ? "pending" : asset.status === "failed" ? "failed" : "superseded",
  }));
  const assetById = new Map(project.assets.map(asset => [asset.id, asset]));
  const audioTracks: ComicAudioTrack[] = [];
  const subtitleTracks: ComicSubtitleTrack[] = [];
  const shotTimelineOffsets = new Map<string, number>();
  const subtitleClipRanges = new Map<string, { startFrame: number; durationFrames: number }>();
  for (const [index, plan] of episodePlans.entries()) {
    const plannedId = index === 0 ? episode.id : `${episode.id}-${String(plan.number).padStart(2, "0")}`;
    const timeline = buildComicTimeline(project.id, { ...episode, id: plannedId }, scenes, shots, {
      frameRate: project.frameRate, width: project.canvas.width, height: project.canvas.height, now,
    });
    for (const clip of timeline.clips) if (clip.shotId) shotTimelineOffsets.set(clip.shotId, clip.startFrame);
  }
  for (const scene of project.scenes) {
    const episodeNumber = scene.episodeNumber || 1;
    const sceneEpisodeId = episodeIdByNumber.get(episodeNumber) || episodeId;
    for (const shot of scene.shots) {
      const timelineOffset = shotTimelineOffsets.get(shot.id) ?? 0;
      if (shot.audioAssetId) {
        audioTracks.push({
          id: `audio-track-${shot.id}`,
          version: 1,
          createdAt: shot.createdAt,
          updatedAt: shot.updatedAt,
          projectId: project.id,
          episodeId: sceneEpisodeId,
          kind: "dialogue",
          assetId: shot.audioAssetId,
          language: "und",
          startFrame: timelineOffset,
          durationFrames: getComicMediaDurationFrames(project, shot, shot.audioAssetId),
          sourceStartFrame: shot.mediaSourceStartFrames?.[shot.audioAssetId] || 0,
          volume: shot.volume ?? 1,
          source: assetById.get(shot.audioAssetId)?.source === "imported" ? "imported" : "generated",
          ...(assetById.get(shot.audioAssetId)?.provider ? { providerId: assetById.get(shot.audioAssetId)?.provider } : {}),
          ...(assetById.get(shot.audioAssetId)?.model ? { modelId: assetById.get(shot.audioAssetId)?.model } : {}),
          ...(assetById.get(shot.audioAssetId)?.jobId ? { renderJobId: assetById.get(shot.audioAssetId)?.jobId } : {}),
        });
      }
      for (const assetId of shot.musicAssetIds || []) {
        const asset = assetById.get(assetId);
        audioTracks.push({
          id: `music-track-${shot.id}-${assetId}`,
          version: 1,
          createdAt: shot.createdAt,
          updatedAt: shot.updatedAt,
          projectId: project.id,
          episodeId: sceneEpisodeId,
          kind: "music",
          assetId,
          startFrame: timelineOffset,
          durationFrames: getComicMediaDurationFrames(project, shot, assetId),
          sourceStartFrame: shot.mediaSourceStartFrames?.[assetId] || 0,
          volume: shot.volume ?? 1,
          source: asset?.source === "imported" ? "imported" : "generated",
          ...(asset?.provider ? { providerId: asset.provider } : {}),
          ...(asset?.model ? { modelId: asset.model } : {}),
          ...(asset?.jobId ? { renderJobId: asset.jobId } : {}),
        });
      }
      for (const assetId of shot.effectAssetIds || []) {
        const asset = assetById.get(assetId);
        audioTracks.push({
          id: `effect-track-${shot.id}-${assetId}`,
          version: 1,
          createdAt: shot.createdAt,
          updatedAt: shot.updatedAt,
          projectId: project.id,
          episodeId: sceneEpisodeId,
          kind: "effect",
          assetId,
          startFrame: timelineOffset,
          durationFrames: getComicMediaDurationFrames(project, shot, assetId),
          sourceStartFrame: shot.mediaSourceStartFrames?.[assetId] || 0,
          volume: shot.volume ?? 1,
          source: asset?.source === "imported" ? "imported" : "generated",
          ...(asset?.provider ? { providerId: asset.provider } : {}),
          ...(asset?.model ? { modelId: asset.model } : {}),
          ...(asset?.jobId ? { renderJobId: asset.jobId } : {}),
        });
      }
      if (shot.subtitleAssetId || shot.dialogueCues.length > 0) {
        subtitleClipRanges.set(`subtitle-track-${shot.id}`, { startFrame: timelineOffset,
          durationFrames: shot.subtitleAssetId ? getComicMediaDurationFrames(project, shot, shot.subtitleAssetId)
            : Math.max(...shot.dialogueCues.map(cue => cue.startFrame + cue.durationFrames)) });
        subtitleTracks.push({
          id: `subtitle-track-${shot.id}`,
          version: 1,
          createdAt: shot.createdAt,
          updatedAt: shot.updatedAt,
          projectId: project.id,
          episodeId: sceneEpisodeId,
          ...(shot.subtitleAssetId ? { assetId: shot.subtitleAssetId } : {}),
          ...(shot.subtitleAssetId && shot.mediaSourceStartFrames?.[shot.subtitleAssetId] ? { sourceStartFrame: shot.mediaSourceStartFrames[shot.subtitleAssetId] } : {}),
          language: "und",
          format: "srt",
          cues: shot.dialogueCues.map(cue => ({
            id: cue.id,
            text: cue.text,
            startFrame: cue.startFrame,
            durationFrames: cue.durationFrames,
            ...(cue.speakerCharacterId ? { speakerCharacterId: cue.speakerCharacterId } : {}),
          })),
          source: "manual",
          ...(assetById.get(shot.subtitleAssetId || "")?.provider ? { providerId: assetById.get(shot.subtitleAssetId || "")?.provider } : {}),
          ...(assetById.get(shot.subtitleAssetId || "")?.model ? { modelId: assetById.get(shot.subtitleAssetId || "")?.model } : {}),
          ...(assetById.get(shot.subtitleAssetId || "")?.jobId ? { renderJobId: assetById.get(shot.subtitleAssetId || "")?.jobId } : {}),
        });
      }
    }
  }
  const plannedEpisodes: ComicEpisode[] = episodePlans.map((plan, index) => ({
      id: index === 0 ? episode.id : `${episode.id}-${String(plan.number).padStart(2, "0")}`,
      version: 1,
      createdAt: project.createdAt,
      updatedAt: now,
      projectId: project.id,
      number: plan.number,
      title: plan.title,
      ...(plan.titleDefault ? { titleDefault: plan.titleDefault } : {}),
      summary: plan.summary,
      sceneIds: scenes.filter(scene => scene.episodeId === (index === 0 ? episode.id : `${episode.id}-${String(plan.number).padStart(2, "0")}`)).map(scene => scene.id),
      status: scenes.some(scene => scene.episodeId === (index === 0 ? episode.id : `${episode.id}-${String(plan.number).padStart(2, "0")}`)) ? "draft" : "planning",
    }));
  const timelines = plannedEpisodes.map(episodeForTimeline => {
    const timeline = buildComicTimeline(project.id, episodeForTimeline, scenes, shots, {
      frameRate: project.frameRate,
      width: project.canvas.width,
      height: project.canvas.height,
      now,
    });
    const episodeAudioTracks = audioTracks.filter(track => track.episodeId === episodeForTimeline.id);
    const episodeSubtitleTracks = subtitleTracks.filter(track => track.episodeId === episodeForTimeline.id);
    return {
      ...timeline,
      clips: [
        ...timeline.clips,
        ...episodeAudioTracks.map(track => ({
          id: `clip-${track.id}`,
          trackId: track.id,
          kind: "audio" as const,
          assetId: track.assetId,
          startFrame: track.startFrame,
          durationFrames: track.durationFrames,
          sourceStartFrame: track.sourceStartFrame || 0,
          sourceDurationFrames: track.durationFrames,
        })),
        ...episodeSubtitleTracks.map(track => ({
          id: `clip-${track.id}`,
          trackId: track.id,
          kind: "subtitle" as const,
          assetId: track.assetId,
          startFrame: subtitleClipRanges.get(track.id)!.startFrame,
          durationFrames: subtitleClipRanges.get(track.id)!.durationFrames,
          sourceStartFrame: track.sourceStartFrame || 0,
          sourceDurationFrames: subtitleClipRanges.get(track.id)!.durationFrames,
        })),
      ],
      audioTrackIds: episodeAudioTracks.map(track => track.id),
      subtitleTrackIds: episodeSubtitleTracks.map(track => track.id),
    };
  });
  const episodes = plannedEpisodes.map((episodeItem, index) => ({
    ...episodeItem,
    ...(timelines[index] ? { timelineId: timelines[index].id } : {}),
  }));
  return {
    schemaVersion: COMIC_PIPELINE_SCHEMA_VERSION,
    id: `production-${project.id.slice("project-".length)}`,
    projectId: project.id,
    revision: project.revision,
    storyboardRevision: project.revision,
    title: project.title,
    episodes,
    scenes,
    shots,
    characters,
    assets,
    audioTracks,
    subtitleTracks,
    timelines,
    renderJobs: [],
    providerProfiles: [],
    ...(options.script ? { script: options.script } : {}),
    ...(options.scriptAnalysis ? { scriptAnalysis: options.scriptAnalysis } : {}),
    createdAt: project.createdAt,
    updatedAt: now,
  };
}

export class ComicProductionStoreError extends ComicDomainError {
  constructor(code: string, message: string, messageKey = "comic.operation_failed", params: ComicErrorParams = {}) {
    super(code, message, messageKey, params);
    this.name = "ComicProductionStoreError";
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateDocument(value: unknown): ComicProductionDocument {
  if (!isRecord(value)
      || value.schemaVersion !== COMIC_PIPELINE_SCHEMA_VERSION
      || typeof value.id !== "string"
      || typeof value.projectId !== "string"
      || typeof value.revision !== "number"
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || (value.storyboardRevision !== undefined && (typeof value.storyboardRevision !== "number"
        || !Number.isSafeInteger(value.storyboardRevision) || value.storyboardRevision < 0))
      || typeof value.title !== "string"
      || !Array.isArray(value.episodes)
      || !Array.isArray(value.scenes)
      || !Array.isArray(value.shots)
      || !Array.isArray(value.characters)
      || !Array.isArray(value.assets)
      || !Array.isArray(value.audioTracks)
      || !Array.isArray(value.subtitleTracks)
      || !Array.isArray(value.timelines)
      || !Array.isArray(value.renderJobs)
      || !Array.isArray(value.providerProfiles)
      || (value.script !== undefined && (!isRecord(value.script)
        || typeof value.script.text !== "string"
        || typeof value.script.language !== "string"
        || typeof value.script.version !== "number"
        || !Number.isSafeInteger(value.script.version) || value.script.version < 1
        || typeof value.script.updatedAt !== "string"
        || !["user", "imported", "generated"].includes(value.script.source as string)))
      || (value.scriptAnalysis !== undefined && (!isRecord(value.scriptAnalysis)
        || typeof value.scriptAnalysis.version !== "number"
        || !Number.isSafeInteger(value.scriptAnalysis.version) || value.scriptAnalysis.version < 1
        || (value.scriptAnalysis.status !== "pending" && value.scriptAnalysis.status !== "ready")
        || !Array.isArray(value.scriptAnalysis.episodes)
        || (value.scriptAnalysis.scenePlans !== undefined && !Array.isArray(value.scriptAnalysis.scenePlans))
        || !Array.isArray(value.scriptAnalysis.characterNames)
        || typeof value.scriptAnalysis.updatedAt !== "string"))
      || typeof value.createdAt !== "string"
      || typeof value.updatedAt !== "string") {
    throw new ComicProductionStoreError("INVALID_PRODUCTION_STATE", "Comic production document has an invalid format", "comic.invalid_production_state.comic_production_document_has_an_invalid_format", {});
  }
  return value as unknown as ComicProductionDocument;
}

async function atomicWrite(pathname: string, content: string, verifyOwnership: () => void): Promise<void> {
  const temporary = join(dirname(pathname), `.${randomUUID()}.comic-production.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    verifyOwnership();
    await rename(temporary, pathname);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Atomic sidecar store for production state and resumable render metadata. */
export class ComicProductionStore {
  readonly #workspaceRoot: string;
  readonly #path: string;
  readonly #lockPath: string;

  private constructor(workspaceRoot: string) {
    this.#workspaceRoot = workspaceRoot;
    this.#path = join(workspaceRoot, COMIC_PRODUCTION_FILE);
    this.#lockPath = `${this.#path}.lock`;
  }

  static async create(options: ComicProductionStoreOptions): Promise<ComicProductionStore> {
    let workspaceRoot: string;
    try {
      workspaceRoot = resolve(options.workspaceRoot);
      if (!(await stat(workspaceRoot)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new ComicProductionStoreError("INVALID_WORKSPACE", "Comic workspace does not exist", "comic.invalid_workspace.comic_workspace_does_not_exist", {});
    }
    return new ComicProductionStore(workspaceRoot);
  }

  get productionPath(): string { return this.#path; }

  async read(): Promise<ComicProductionState> {
    let raw: string;
    try {
      const metadata = await stat(this.#path);
      if (!metadata.isFile() || metadata.size > MAX_BYTES) throw new Error("invalid file");
      raw = await readFile(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false, fileName: COMIC_PRODUCTION_FILE };
      }
      throw new ComicProductionStoreError("PRODUCTION_READ_FAILED", "Unable to read the comic production document", "comic.production_read_failed.unable_to_read_the_comic_production_document", {});
    }
    try {
      const document = validateDocument(JSON.parse(raw));
      return { exists: true, fileName: COMIC_PRODUCTION_FILE, document, sha256: hash(raw) };
    } catch (error) {
      if (error instanceof ComicProductionStoreError) throw error;
      throw new ComicProductionStoreError("INVALID_PRODUCTION_STATE", "Comic production document is not valid JSON", "comic.invalid_production_state.comic_production_document_is_not_valid_json", {});
    }
  }

  async write(document: ComicProductionDocument, expectedRevision?: number): Promise<ComicProductionState> {
    return this.#withLock(async verifyOwnership => {
      const current = await this.read();
      if (expectedRevision !== undefined && (current.document?.revision ?? 0) !== expectedRevision) {
        throw new ComicProductionStoreError("REVISION_CONFLICT", "Comic production document was updated by another operation", "comic.revision_conflict.comic_production_document_was_updated_by_another_operation", { expected: expectedRevision, actual: current.document?.revision ?? 0 });
      }
      const normalized = validateDocument(document);
      const serialized = `${JSON.stringify(normalized, undefined, 2)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > MAX_BYTES) {
        throw new ComicProductionStoreError("PRODUCTION_TOO_LARGE", "Comic production document exceeds the disk size limit", "comic.production_too_large.comic_production_document_exceeds_the_disk_size_limit", { maximum: MAX_BYTES });
      }
      await atomicWrite(this.#path, serialized, verifyOwnership);
      return { exists: true, fileName: COMIC_PRODUCTION_FILE, document: normalized, sha256: hash(serialized) };
    });
  }

  async #withLock<T>(operation: (verifyOwnership: () => void) => Promise<T>): Promise<T> {
    let compromised: Error | undefined;
    let release: () => Promise<void>;
    try {
      release = await acquireFileLock(this.#path, {
        realpath: false,
        lockfilePath: this.#lockPath,
        stale: LOCK_STALE_MS,
        update: LOCK_UPDATE_MS,
        retries: { retries: Math.ceil(LOCK_WAIT_MS / 50), factor: 1, minTimeout: 50, maxTimeout: 50 },
        onCompromised: error => { compromised = error; },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
        throw new ComicProductionStoreError("PRODUCTION_BUSY", "Comic production document is being saved by another operation", "comic.production_busy.comic_production_document_is_being_saved_by_another_operation", {});
      }
      throw new ComicProductionStoreError("LOCK_FAILED", "Unable to lock the comic production document", "comic.lock_failed.unable_to_lock_the_comic_production_document", {});
    }
    const verifyOwnership = () => {
      if (compromised) throw new ComicProductionStoreError("LOCK_FAILED", "Comic production document lock was lost; check the result again", "comic.lock_failed.comic_production_document_lock_was_lost_check_the_result_again", {});
    };
    let failed = false;
    try {
      const result = await operation(verifyOwnership);
      verifyOwnership();
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try { await release(); }
      catch { if (!failed) throw new ComicProductionStoreError("LOCK_FAILED", "Unable to release the comic production document lock", "comic.lock_failed.unable_to_release_the_comic_production_document_lock", {}); }
    }
  }
}
