import { randomUUID } from "node:crypto";

import { applyComicCommand } from "./core.js";
import type { ApplyComicCommandOptions, ComicAsset, ComicCommand, ComicProject } from "./types.js";
import { ComicCoreError } from "./validation.js";
import { getComicAssetDurationFrames } from "./media-timing.js";
import { getComicDissolveOverlaps, resolveComicShotTransitions } from "./pipeline.js";
import { applyComicCompositionOperation, resolveComicComposition, type ComicCompositionOperation } from "./composition.js";
import { timestamp } from "./validation.js";

/**
 * Timeline edits of the comic editor (剪辑). Each edit is one user action that may take several
 * storyboard commands — "put these three imported clips after the selected one", "lay this
 * music under every shot from here to the end" — applied in memory so the project file is
 * written once and the action undoes as one step.
 */

type WithoutRevision<T> = T extends unknown ? Omit<T, "expectedRevision"> : never;

export type ComicEditorAudioRole = "audio" | "music" | "effect";

export type ComicEditorEdit =
  | { readonly type: "composition"; readonly operation: ComicCompositionOperation }
  | { readonly type: "command"; readonly command: WithoutRevision<ComicCommand> }
  | {
      /** Images and videos from the library become new shots, in order, after the anchor. */
      readonly type: "insert_clips";
      readonly assetIds: readonly string[];
      /** Anchor scene; omitted: the end of the episode's last scene (a scene is created if it has none). */
      readonly sceneId?: string;
      /** Omitted: append to the scene; null: insert at its beginning. */
      readonly afterShotId?: string | null;
      readonly episodeNumber?: number;
      /** Length of a still image on the timeline (default 3 s). */
      readonly imageSeconds?: number;
      /** Picture prompt (a motion description for image-to-video) per asset, same order. */
      readonly prompts?: readonly string[];
    }
  | {
      /**
       * Lay an audio file under shots in order: one shot for a voice line or effect, a run of
       * shots for music, which keeps playing across them (each later shot starts further in).
       */
      readonly type: "place_audio";
      readonly assetId: string;
      readonly role: ComicEditorAudioRole;
      readonly shots: readonly { readonly sceneId: string; readonly shotId: string }[];
      /** Frames into the file for the first shot (continuing music that already plays before it). */
      readonly startFrame?: number;
    }
  | {
      /**
       * “发送到剪辑” for a sound: it goes on its own track right after the last sound already there — the
       * first shot without one after it (music keeps playing on under the shots that follow). When no shot is
       * left, an empty shot as long as the sound is added at the end, so the track still ends with it.
       */
      readonly type: "append_audio";
      readonly assetId: string;
      readonly role: ComicEditorAudioRole;
      readonly episodeNumber?: number;
    };

export interface ComicEditorResult {
  readonly project: ComicProject;
  /** Shots created by insert_clips (and the empty shot append_audio may add), in timeline order. */
  readonly createdShotIds: readonly string[];
}

const MAX_SHOT_FRAMES = 30 * 60 * 10;
const MAX_EDITS = 200;

function clipTitle(asset: ComicAsset): string | undefined {
  const name = asset.source === "imported" ? (asset.model || "").replace(/\.[a-z0-9]{1,5}$/i, "").trim() : "";
  return name ? name.slice(0, 120) : undefined;
}

export function applyComicEditorEdits(
  project: ComicProject,
  edits: readonly ComicEditorEdit[],
  options: ApplyComicCommandOptions = {},
): ComicEditorResult {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_EDITS) {
    throw new ComicCoreError("INVALID_COMMAND", `An editor action has between 1 and ${MAX_EDITS} edits`, "comic.invalid_command.an_editor_action_has_between_1_and_edits", { maximum: MAX_EDITS });
  }
  let current = project;
  const apply = (command: WithoutRevision<ComicCommand>): void => {
    current = applyComicCommand(current, { ...command, expectedRevision: current.revision } as ComicCommand, options);
  };
  const createdShotIds: string[] = [];
  const audioRole = (role: unknown): ComicEditorAudioRole => {
    if (role !== "audio" && role !== "music" && role !== "effect") {
      throw new ComicCoreError("INVALID_COMMAND", "Audio goes to the voice, music or effect track", "comic.invalid_command.audio_goes_to_the_voice_music_or_effect_track", {});
    }
    return role;
  };
  const audioSource = (assetId: string): ComicAsset => {
    const source = current.assets.find(candidate => candidate.id === assetId);
    if (!source || source.kind !== "audio" && source.kind !== "music" && source.kind !== "effect") {
      throw new ComicCoreError("INVALID_REFERENCE", "Only audio from this project goes on an audio track", "comic.invalid_reference.only_audio_from_this_project_goes_on_an_audio_track", {});
    }
    return source;
  };
  /** Lay an audio file under shots in order (see place_audio). */
  const placeAudio = (assetId: string, requestedRole: unknown, references: readonly { readonly sceneId: string; readonly shotId: string }[], startFrame?: number): void => {
    const role = audioRole(requestedRole);
    const source = audioSource(assetId);
    let target = source;
    if (source.kind !== role) {
      // The same file on another track: a library entry of that kind for the same bytes.
      const sibling = current.assets.find(candidate => candidate.kind === role && candidate.uri === source.uri && candidate.sha256 === source.sha256);
      if (sibling) target = sibling;
      else {
        if (!source.sha256 || !source.mimeType || !source.byteLength) {
          throw new ComicCoreError("INVALID_REFERENCE", "This audio cannot be reused on another track", "comic.invalid_reference.this_audio_cannot_be_reused_on_another_track", {});
        }
        const id = `asset-${randomUUID()}`;
        apply({
          type: "asset.import",
          asset: {
            id, kind: role, uri: source.uri, mimeType: source.mimeType, byteLength: source.byteLength, sha256: source.sha256,
            jobId: `media-job-${randomUUID()}`, provider: source.provider || "本机导入", model: source.model || "audio",
            source: source.source, ...(source.durationMs ? { durationMs: source.durationMs } : {}),
            ...(source.streamStartMs === undefined ? {} : { streamStartMs: source.streamStartMs }),
          },
        });
        target = current.assets.find(candidate => candidate.id === id)!;
      }
    }
    const shots = role === "music" ? references : references.slice(0, 1);
    const lengthFrames = getComicAssetDurationFrames(target, current.frameRate) ?? Infinity;
    if (startFrame !== undefined && (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame > 1_000_000_000 || startFrame >= lengthFrames)) {
      throw new ComicCoreError("INVALID_COMMAND", "Audio start point must be inside its source", "comic.invalid_command.audio_start_point_must_be_inside_its_source", {});
    }
    let offset = startFrame ?? 0;
    const positions = new Map<string, { episode: number; start: number }>();
    for (const episode of new Set(current.scenes.map(scene => scene.episodeNumber ?? 1))) {
      const ordered = current.scenes.filter(scene => (scene.episodeNumber ?? 1) === episode)
        .flatMap(scene => scene.shots.map(shot => ({ sceneId: scene.id, shot })));
      const resolved = ordered.map((item, index) => ({ shotId: item.shot.id, durationFrames: item.shot.durationFrames,
        ...resolveComicShotTransitions(item.shot, { firstInEpisode: index === 0, lastInEpisode: index === ordered.length - 1,
          acrossScenes: index > 0 && ordered[index - 1]!.sceneId !== item.sceneId }) }));
      const overlaps = getComicDissolveOverlaps(resolved, current.frameRate);
      let cursor = 0;
      for (const item of ordered) {
        cursor -= overlaps.get(item.shot.id) ?? 0;
        positions.set(item.shot.id, { episode, start: cursor });
        cursor += item.shot.durationFrames;
      }
    }
    const initialOffset = offset;
    let firstPosition: { episode: number; start: number } | undefined;
    let previousStart = -1;
    for (const reference of shots) {
      const shot = current.scenes.find(scene => scene.id === reference.sceneId)?.shots.find(candidate => candidate.id === reference.shotId);
      if (!shot) throw new ComicCoreError("SHOT_NOT_FOUND", "Shot does not exist", "comic.shot_not_found.shot_does_not_exist", {});
      const position = positions.get(shot.id)!;
      firstPosition ??= position;
      if (position.episode !== firstPosition.episode || position.start <= previousStart) {
        throw new ComicCoreError("INVALID_COMMAND", "Choose audio shots in timeline order within one episode", "comic.invalid_command.choose_the_shots_for_this_audio", {});
      }
      previousStart = position.start;
      offset = initialOffset + position.start - firstPosition.start;
      if (offset >= lengthFrames) break;
      apply({ type: "media.link", sceneId: reference.sceneId, shotId: reference.shotId, slot: role, assetId: target.id });
      if (offset > 0) apply({ type: "media.set_start", sceneId: reference.sceneId, shotId: reference.shotId, assetId: target.id, startFrame: offset });
    }
  };
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") throw new ComicCoreError("INVALID_COMMAND", "Editor edit must be an object", "comic.invalid_command.editor_edit_must_be_an_object", {});
    if (edit.type === "composition") {
      const composition = applyComicCompositionOperation(resolveComicComposition(current), edit.operation, current);
      current = { ...current, composition, revision: current.revision + 1, updatedAt: timestamp(options.now ?? new Date().toISOString(), "updatedAt") };
      continue;
    }
    if (current.composition && !(edit.type === "command" && (edit.command?.type === "asset.import" || edit.command?.type === "project.update"))) {
      throw new ComicCoreError("COMPOSITION_EDIT_REQUIRED", "This timeline uses independent tracks; use a composition edit instead of changing its legacy shots", "comic.composition.edit_required", {});
    }
    if (edit.type === "command") {
      if (!edit.command || typeof edit.command !== "object") throw new ComicCoreError("INVALID_COMMAND", "Editor command must be an object", "comic.invalid_command.editor_command_must_be_an_object", {});
      apply(edit.command);
      continue;
    }
    if (edit.type === "insert_clips") {
      if (!Array.isArray(edit.assetIds) || edit.assetIds.length === 0 || edit.assetIds.length > 100) {
        throw new ComicCoreError("INVALID_COMMAND", "Insert between 1 and 100 clips at a time", "comic.invalid_command.insert_between_1_and_100_clips_at_a_time", { maximum: 100 });
      }
      let sceneId = edit.sceneId;
      let after: string | null | undefined = edit.afterShotId;
      if (!sceneId) {
        const episode = edit.episodeNumber || 1;
        const last = current.scenes.filter(scene => (scene.episodeNumber || 1) === episode).at(-1);
        if (last) {
          sceneId = last.id;
          after = undefined;
        } else {
          const before = new Set(current.scenes.map(scene => scene.id));
          apply({ type: "scene.add", scene: { ...(edit.episodeNumber ? { episodeNumber: edit.episodeNumber } : {}) } });
          sceneId = current.scenes.find(scene => !before.has(scene.id))!.id;
          after = undefined;
        }
      }
      if (edit.imageSeconds !== undefined && (!Number.isFinite(edit.imageSeconds) || edit.imageSeconds <= 0)) {
        throw new ComicCoreError("INVALID_COMMAND", "Image duration must be a positive finite number", "comic.invalid_command.image_duration_must_be_a_positive_finite_number", {});
      }
      const imageFrames = Math.max(1, Math.min(MAX_SHOT_FRAMES, Math.round((edit.imageSeconds ?? 3) * current.frameRate)));
      for (const [position, assetId] of edit.assetIds.entries()) {
        const asset = current.assets.find(candidate => candidate.id === assetId);
        if (!asset || asset.kind !== "image" && asset.kind !== "video") {
          throw new ComicCoreError("INVALID_REFERENCE", "Only images and videos from this project become clips", "comic.invalid_reference.only_images_and_videos_from_this_project_become_clips", {});
        }
        const durationFrames = asset.kind === "video" && asset.durationMs
          ? Math.min(MAX_SHOT_FRAMES, getComicAssetDurationFrames(asset, current.frameRate)!)
          : asset.kind === "video" ? 4 * current.frameRate : imageFrames;
        const scene = current.scenes.find(candidate => candidate.id === sceneId);
        if (!scene) throw new ComicCoreError("SCENE_NOT_FOUND", "Scene does not exist", "comic.scene_not_found.scene_does_not_exist", {});
        const before = new Set(scene.shots.map(shot => shot.id));
        apply({
          type: "shot.add", sceneId: scene.id, ...(after === undefined ? {} : { afterShotId: after }),
          shot: { title: clipTitle(asset), durationFrames,
            ...(typeof edit.prompts?.[position] === "string" && edit.prompts[position].trim() ? { visualPrompt: edit.prompts[position].trim().slice(0, 20_000) } : {}) },
        });
        const created = current.scenes.find(candidate => candidate.id === scene.id)!.shots.find(shot => !before.has(shot.id))!;
        apply({ type: "media.link", sceneId: scene.id, shotId: created.id, slot: asset.kind === "image" ? "visual" : "video", assetId: asset.id });
        createdShotIds.push(created.id);
        after = created.id;
      }
      continue;
    }
    if (edit.type === "place_audio") {
      if (!Array.isArray(edit.shots) || edit.shots.length === 0 || edit.shots.length > 1_000) {
        throw new ComicCoreError("INVALID_COMMAND", "Choose the shots for this audio", "comic.invalid_command.choose_the_shots_for_this_audio", {});
      }
      placeAudio(edit.assetId, edit.role, edit.shots, edit.startFrame);
      continue;
    }
    if (edit.type === "append_audio") {
      const role = audioRole(edit.role);
      const source = audioSource(edit.assetId);
      const episode = edit.episodeNumber || 1;
      const timeline = () => current.scenes.filter(scene => (scene.episodeNumber || 1) === episode)
        .flatMap(scene => scene.shots.map(shot => ({ sceneId: scene.id, shotId: shot.id, shot })));
      const holds = (shot: ComicProject["scenes"][number]["shots"][number]): boolean =>
        role === "audio" ? Boolean(shot.audioAssetId) : role === "music" ? Boolean(shot.musicAssetIds?.length) : Boolean(shot.effectAssetIds?.length);
      let shots = timeline();
      let last = -1;
      shots.forEach((item, index) => { if (holds(item.shot)) last = index; });
      if (last + 1 >= shots.length) {
        // Nothing left to lay it under: an empty shot as long as the sound (3 s when its length is unknown).
        const frames = Math.min(MAX_SHOT_FRAMES, getComicAssetDurationFrames(source, current.frameRate) ?? 3 * current.frameRate);
        let scene = current.scenes.filter(candidate => (candidate.episodeNumber || 1) === episode).at(-1);
        if (!scene) {
          const before = new Set(current.scenes.map(candidate => candidate.id));
          apply({ type: "scene.add", scene: { ...(edit.episodeNumber ? { episodeNumber: edit.episodeNumber } : {}) } });
          scene = current.scenes.find(candidate => !before.has(candidate.id))!;
        }
        const before = new Set(scene.shots.map(shot => shot.id));
        apply({ type: "shot.add", sceneId: scene.id, shot: { durationFrames: frames } });
        const created = current.scenes.find(candidate => candidate.id === scene!.id)!.shots.find(shot => !before.has(shot.id))!;
        createdShotIds.push(created.id);
        shots = timeline();
      }
      placeAudio(source.id, role, shots.slice(last + 1).map(({ sceneId, shotId }) => ({ sceneId, shotId })));
      continue;
    }
    throw new ComicCoreError("INVALID_COMMAND", "Unsupported editor edit", "comic.invalid_command.unsupported_editor_edit", {});
  }
  return { project: current, createdShotIds };
}
