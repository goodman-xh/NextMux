import type { ComicAsset, ComicProject, ComicShot } from "./types.js";
import { ComicCoreError } from "./validation.js";

/** Stills have no source out-point. Missing duration metadata cannot establish a trim limit. */
export function getComicAssetDurationFrames(asset: ComicAsset | undefined, frameRate: number): number | undefined {
  if (!asset || asset.kind === "image" || asset.durationMs === undefined) return undefined;
  const frames = asset.durationMs * frameRate / 1000;
  // Milliseconds derived from exact frame counts can return 30.999999999999996.
  // Correct floating-point roundoff only; a genuinely partial source frame stays excluded.
  return Math.max(1, Math.floor(frames + Number.EPSILON * Math.max(1, frames) * 4));
}

export function getComicTimedAssetIds(shot: ComicShot): readonly string[] {
  return [...new Set([shot.videoAssetId, shot.audioAssetId, shot.subtitleAssetId,
    ...(shot.musicAssetIds || []), ...(shot.effectAssetIds || [])].filter((id): id is string => Boolean(id)))];
}

/** Actual visible/audible range; a short sound may end before the containing picture shot. */
export function getComicMediaDurationFrames(project: Pick<ComicProject, "assets" | "frameRate">, shot: ComicShot, assetId: string): number {
  const asset = project.assets.find(candidate => candidate.id === assetId);
  const sourceFrames = getComicAssetDurationFrames(asset, project.frameRate);
  const remaining = sourceFrames === undefined ? Infinity : Math.max(0, sourceFrames - (shot.mediaSourceStartFrames?.[assetId] ?? 0));
  return Math.max(0, Math.min(shot.durationFrames, shot.mediaDurationFrames?.[assetId] ?? Infinity, remaining));
}

/** The picture's duration is bounded by its selected video, independently of shorter sound clips. */
export function assertComicShotMediaRanges(project: Pick<ComicProject, "assets" | "frameRate">, shot: ComicShot): void {
  const linked = new Set(getComicTimedAssetIds(shot));
  for (const id of Object.keys(shot.mediaSourceStartFrames || {})) {
    if (!linked.has(id)) throw new ComicCoreError("INVALID_REFERENCE", "Source range belongs to unlinked media", "comic.invalid_reference.has_a_source_range_for_an_unlinked_asset", { field: "shot" });
  }
  for (const id of Object.keys(shot.mediaDurationFrames || {})) {
    if (!linked.has(id)) throw new ComicCoreError("INVALID_REFERENCE", "Playback duration belongs to unlinked media", "comic.invalid_reference.has_a_source_range_for_an_unlinked_asset", { field: "shot" });
  }
  for (const id of linked) {
    const start = shot.mediaSourceStartFrames?.[id] ?? 0;
    const length = shot.mediaDurationFrames?.[id];
    const sourceFrames = getComicAssetDurationFrames(project.assets.find(asset => asset.id === id), project.frameRate);
    if (!Number.isSafeInteger(start) || start < 0 || start > 1_000_000_000 || length !== undefined && (!Number.isSafeInteger(length) || length < 1 || length > shot.durationFrames)) {
      throw new ComicCoreError("INVALID_PROJECT", "Media must have a positive playback duration within its shot", "comic.invalid_project.media_must_have_a_positive_playback_duration_within_its_shot", {});
    }
    if (sourceFrames !== undefined && (start >= sourceFrames || (id === shot.videoAssetId ? shot.durationFrames : length ?? 0) > sourceFrames - start)) {
      throw new ComicCoreError("INVALID_PROJECT", "Media source range exceeds the available source duration", "comic.invalid_project.media_source_range_exceeds_the_available_source_duration", {});
    }
    if (id === shot.videoAssetId && length !== undefined && length !== shot.durationFrames) {
      throw new ComicCoreError("INVALID_PROJECT", "Video playback duration must match the shot", "comic.invalid_project.video_playback_duration_must_match_the_shot", {});
    }
  }
}
