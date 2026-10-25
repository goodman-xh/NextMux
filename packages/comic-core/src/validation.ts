import { ComicDomainError, type ComicErrorParams } from "./errors.js";
import { comicDefaultTitle } from "./default-titles.js";
import type {
  ComicAspectRatio,
  ComicCameraAngle,
  ComicLens,
  ComicShotBeat,
  ComicDefaultTitle,
  ComicShotDraft,
  ComicShot,
  ComicMusicMvTreatment,
  ComicCameraMotion,
  ComicCanvas,
  ComicFrameRate,
  ComicMediaSlot,
  ComicMediaFit,
  ComicProjectKind,
  ComicMusicSettings,
  ComicMusicMvSettings,
  ComicMusicLyricAlignment,
  ComicAssetKind,
  ComicShotSize,
  ComicShotStatus,
  ComicTransition,
  ComicAdaptSettings,
  ComicEpisodeScript,
} from "./types.js";

export class ComicCoreError extends ComicDomainError {
  constructor(code: string, message: string, messageKey = "comic.operation_failed", params: ComicErrorParams = {}) {
    super(code, message, messageKey, params);
    this.name = "ComicCoreError";
  }
}

export const FRAME_RATES = [24, 25, 30] as const;
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3"] as const;
export const SHOT_SIZES = ["extreme_wide", "wide", "medium", "close_up", "extreme_close_up"] as const;
export const CAMERA_MOTIONS = [
  "static",
  "push_in",
  "pull_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "tracking",
  "handheld",
  "orbit", "crane_up", "crane_down", "dolly_zoom", "aerial", "follow",
] as const;
export const CAMERA_ANGLES = ["eye_level", "low", "high", "overhead", "over_the_shoulder", "pov", "dutch"] as const;
export const SHOT_STATUSES = ["draft", "ready", "generating", "generated", "failed"] as const;
export const TRANSITIONS = ["cut", "fade", "dissolve"] as const;
export const ASSET_KINDS = ["image", "audio", "music", "effect", "video", "subtitle"] as const;
export const MEDIA_SLOTS = ["visual", "audio", "music", "effect", "subtitle", "video"] as const;

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} must be an object`, "comic.invalid_project.must_be_an_object", { field: label });
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} must be an array with at most ${maximum} items`, "comic.invalid_project.must_be_an_array_with_at_most_items", { field: label, maximum });
  }
  return value;
}

export function boundedText(
  value: unknown,
  label: string,
  maximum: number,
  options: { readonly required?: boolean; readonly fallback?: string } = {},
): string {
  const candidate = value === undefined ? options.fallback ?? "" : value;
  if (typeof candidate !== "string" || candidate.includes("\0")) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} must be text`, "comic.invalid_project.must_be_text", { field: label });
  }
  const text = candidate.trim();
  if ((options.required && !text) || text.length > maximum) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} has an invalid length`, "comic.invalid_project.has_an_invalid_length", { field: label, maximum });
  }
  return text;
}

export function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} must be an integer from ${minimum} to ${maximum}`, "comic.invalid_project.must_be_an_integer_from_to", { field: label, minimum, maximum });
  }
  return value as number;
}

export function numberRange(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} must be a number from ${minimum} to ${maximum}`, "comic.invalid_project.must_be_a_number_from_to", { field: label, minimum, maximum });
  }
  return value;
}

export function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} must be an ISO timestamp`, "comic.invalid_project.must_be_an_iso_timestamp", { field: label });
  }
  return value;
}

export function identifier(value: unknown, prefix: string, label: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}-[A-Za-z0-9][A-Za-z0-9-]{7,95}$`).test(value)) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} has an invalid identifier`, "comic.invalid_project.has_an_invalid_identifier", { field: label });
  }
  return value;
}

function oneOf<T extends string | number>(value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) {
    throw new ComicCoreError("INVALID_PROJECT", `${label} is not supported`, "comic.invalid_project.is_not_supported", { field: label });
  }
  return value as T;
}

export function frameRate(value: unknown): ComicFrameRate {
  return oneOf(value, FRAME_RATES, "frameRate");
}

export function aspectRatio(value: unknown): ComicAspectRatio {
  return oneOf(value, ASPECT_RATIOS, "canvas.aspectRatio");
}

export function shotSize(value: unknown): ComicShotSize {
  return oneOf(value, SHOT_SIZES, "shot.shotSize");
}

export function cameraMotion(value: unknown): ComicCameraMotion {
  return oneOf(value, CAMERA_MOTIONS, "shot.cameraMotion");
}

export function cameraAngle(value: unknown): ComicCameraAngle {
  return oneOf(value, CAMERA_ANGLES, "shot.cameraAngle");
}

export function lens(value: unknown): ComicLens {
  const item = record(value, "shot.lens");
  return { focalLength: oneOf(item.focalLength, ["wide", "normal", "telephoto"], "shot.lens.focalLength"),
    depthOfField: oneOf(item.depthOfField, ["shallow", "deep"], "shot.lens.depthOfField") };
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new ComicCoreError("INVALID_PROJECT", `${label} must be true or false`, "comic.invalid_project.must_be_true_or_false", { field: label });
  return value;
}

export function textList(value: unknown, label: string, maximum = 100, textMaximum = 200): readonly string[] {
  const values = array(value, label, maximum).map((entry, index) => boundedText(entry, `${label}[${index}]`, textMaximum, { required: true }));
  if (new Set(values.map(entry => entry.toLocaleLowerCase())).size !== values.length) throw new ComicCoreError("INVALID_PROJECT", `${label} contains duplicates`, "comic.invalid_project.contains_duplicates", { field: label });
  return values;
}

export function shotBeats(value: unknown, durationSeconds: number): readonly ComicShotBeat[] {
  const beats = array(value, "shot.beats", 100).map((entry, index) => {
    const item = record(entry, `shot.beats[${index}]`);
    const startSeconds = numberRange(item.startSeconds, `shot.beats[${index}].startSeconds`, 0, durationSeconds);
    const endSeconds = numberRange(item.endSeconds, `shot.beats[${index}].endSeconds`, 0, durationSeconds);
    if (endSeconds <= startSeconds) throw new ComicCoreError("INVALID_PROJECT", "Shot beats must have a positive duration", "comic.invalid_project.shot_beats_must_have_a_positive_duration", {});
    return { startSeconds, endSeconds, action: boundedText(item.action, `shot.beats[${index}].action`, 2_000, { required: true }) };
  });
  for (let index = 1; index < beats.length; index++) {
    if (beats[index]!.startSeconds < beats[index - 1]!.endSeconds) throw new ComicCoreError("INVALID_PROJECT", "Shot beats must be ordered and cannot overlap", "comic.invalid_project.shot_beats_must_be_ordered_and_cannot_overlap", {});
  }
  return beats;
}

export function defaultTitle(value: unknown, label: string, depth = 0): ComicDefaultTitle {
  if (depth > 12) throw new ComicCoreError("INVALID_PROJECT", `${label} is nested too deeply`, "comic.invalid_project.is_nested_too_deeply", { field: label });
  const item = record(value, label);
  const kind = oneOf(item.kind, ["project", "episode", "scene", "shot", "copy", "split"], `${label}.kind`);
  const locale = boundedText(item.locale, `${label}.locale`, 40, { required: true });
  if (!/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/iu.test(locale)) throw new ComicCoreError("INVALID_PROJECT", `${label}.locale is invalid`, "comic.invalid_project.locale_is_invalid", { field: label });
  return { kind, locale,
    ...(item.index === undefined ? {} : { index: integer(item.index, `${label}.index`, 1, 100_000) }),
    ...(item.baseTitle === undefined ? {} : { baseTitle: boundedText(item.baseTitle, `${label}.baseTitle`, 120) }),
    ...(item.baseDefault === undefined ? {} : { baseDefault: defaultTitle(item.baseDefault, `${label}.baseDefault`, depth + 1) }) };
}

/** Optional film-grammar fields shared by command and JSON validation. */
export function shotGrammar(item: Record<string, unknown> | ComicShotDraft, durationSeconds: number): Pick<ComicShot, "cameraAngle" | "lens" | "transition" | "beats" | "searchTerms" | "continuousTakeId"> {
  const terms = item.searchTerms === undefined ? undefined : textList(item.searchTerms, "shot.searchTerms", 6, 60);
  if (terms?.length && (terms.length < 3 || terms.some(term => !/^[A-Za-z0-9][A-Za-z0-9 '\-]*$/u.test(term))
      || terms.join(" ").split(/\s+/u).length > 6)) {
    throw new ComicCoreError("INVALID_PROJECT", "shot.searchTerms must contain 3–6 English words", "comic.invalid_project.shot_searchterms_must_contain_3_6_english_words", {});
  }
  return {
    ...(item.cameraAngle === undefined ? {} : { cameraAngle: item.cameraAngle === null ? undefined : cameraAngle(item.cameraAngle) }),
    ...(item.lens === undefined ? {} : { lens: item.lens === null ? undefined : lens(item.lens) }),
    ...(item.transition === undefined ? {} : { transition: item.transition === null ? undefined : transition(item.transition) }),
    ...(item.beats === undefined ? {} : { beats: shotBeats(item.beats, durationSeconds) }),
    ...(terms === undefined ? {} : { searchTerms: terms }),
    ...(item.continuousTakeId === undefined ? {} : { continuousTakeId: boundedText(item.continuousTakeId, "shot.continuousTakeId", 120) }),
  };
}

export function musicMvTreatment(value: unknown, label: string): ComicMusicMvTreatment {
  const item = record(value, label);
  return { protagonist: boundedText(item.protagonist, `${label}.protagonist`, 2_000, { required: true }),
    palette: textList(item.palette, `${label}.palette`, 5, 200),
    recurringImages: textList(item.recurringImages, `${label}.recurringImages`, 12, 500) };
}

export function shotStatus(value: unknown): ComicShotStatus {
  return oneOf(value, SHOT_STATUSES, "shot.status");
}

export function projectKind(value: unknown): ComicProjectKind {
  if (value === "novel" || value === "image" || value === "topic" || value === "music" || value === "chat") return value;
  throw new ComicCoreError("INVALID_PROJECT", "Project kind must be novel, image, topic, music or chat", "comic.invalid_project.project_kind_must_be_novel_image_topic_or_music", {});
}

export const MAX_LYRICS_CHARACTERS = 3_500;

/** Persisted MV data is untrusted project JSON; validate the complete timeline before use. */
export function musicMvSettings(value: unknown, label: string): ComicMusicMvSettings {
  const item = record(value, label);
  const durationMs = integer(item.durationMs, `${label}.durationMs`, 1, 3_600_000);
  const alignment = (input: unknown, name: string): ComicMusicLyricAlignment => oneOf(input, ["estimated", "recognized", "tapped", "manual"], name);
  const localId = (input: unknown, name: string): string => {
    const text = boundedText(input, name, 100, { required: true });
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new ComicCoreError("INVALID_PROJECT", `${name} has an invalid identifier`, "comic.invalid_project.has_an_invalid_identifier", { field: name });
    return text;
  };
  const lines = array(item.lines, `${label}.lines`, MAX_LYRICS_CHARACTERS).map((entry, index) => {
    const name = `${label}.lines[${index}]`, line = record(entry, name);
    const startMs = integer(line.startMs, `${name}.startMs`, 0, durationMs - 1);
    const endMs = integer(line.endMs, `${name}.endMs`, startMs + 1, durationMs);
    return { id: localId(line.id, `${name}.id`), sectionIndex: integer(line.sectionIndex, `${name}.sectionIndex`, 0, MAX_LYRICS_CHARACTERS),
      sectionTitle: boundedText(line.sectionTitle, `${name}.sectionTitle`, 200), text: boundedText(line.text, `${name}.text`, MAX_LYRICS_CHARACTERS, { required: true }), startMs, endMs,
      ...(line.alignment === undefined ? {} : { alignment: alignment(line.alignment, `${name}.alignment`) }) };
  });
  assertUnique(lines.map(line => line.id), `${label}.lines`);
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]!.startMs < lines[index - 1]!.endMs || lines[index]!.sectionIndex < lines[index - 1]!.sectionIndex) {
      throw new ComicCoreError("INVALID_PROJECT", `${label}.lines must be ordered and cannot overlap`, "comic.invalid_project.lines_must_be_ordered_and_cannot_overlap", { field: label });
    }
  }
  if (lines.reduce((sum, line) => sum + line.text.length, 0) > MAX_LYRICS_CHARACTERS) throw new ComicCoreError("INVALID_PROJECT", `${label}.lines exceeds the lyric length limit`, "comic.invalid_project.lines_exceeds_the_lyric_length_limit", { field: label });
  const knownLines = new Set(lines.map(line => line.id));
  const segments = array(item.segments, `${label}.segments`, MAX_LYRICS_CHARACTERS).map((entry, index) => {
    const name = `${label}.segments[${index}]`, segment = record(entry, name);
    const startMs = integer(segment.startMs, `${name}.startMs`, 0, durationMs - 1);
    const endMs = integer(segment.endMs, `${name}.endMs`, startMs + 1, Math.min(durationMs, startMs + 25_000));
    const lineIds = array(segment.lineIds, `${name}.lineIds`, MAX_LYRICS_CHARACTERS).map((id, lineIndex) => localId(id, `${name}.lineIds[${lineIndex}]`));
    assertUnique(lineIds, `${name}.lineIds`);
    if (lineIds.some(id => !knownLines.has(id))) throw new ComicCoreError("INVALID_PROJECT", `${name}.lineIds references an unknown lyric line`, "comic.invalid_project.lineids_references_an_unknown_lyric_line", { field: name });
    const source = oneOf(segment.source, ["ai-video", "upload-image", "upload-video"], `${name}.source`);
    const jobId = segment.jobId === undefined ? undefined : boundedText(segment.jobId, `${name}.jobId`, 150, { required: true });
    if (jobId !== undefined && !/^media-job-[A-Za-z0-9-]{8,130}$/.test(jobId)) throw new ComicCoreError("INVALID_PROJECT", `${name}.jobId has an invalid identifier`, "comic.invalid_project.jobid_has_an_invalid_identifier", { field: name });
    return { id: localId(segment.id, `${name}.id`), sectionIndex: integer(segment.sectionIndex, `${name}.sectionIndex`, 0, MAX_LYRICS_CHARACTERS),
      sectionTitle: boundedText(segment.sectionTitle, `${name}.sectionTitle`, 200), startMs, endMs, lineIds,
      prompt: boundedText(segment.prompt, `${name}.prompt`, 6_000), source,
      ...(segment.performance === undefined ? {} : { performance: boolean(segment.performance, `${name}.performance`) }),
      ...(segment.assetId === undefined ? {} : { assetId: identifier(segment.assetId, "asset", `${name}.assetId`) }),
      ...(segment.shotId === undefined ? {} : { shotId: identifier(segment.shotId, "shot", `${name}.shotId`) }),
      ...(jobId === undefined ? {} : { jobId }) };
  });
  assertUnique(segments.map(segment => segment.id), `${label}.segments`);
  if (segments.length && (segments[0]!.startMs !== 0 || segments[segments.length - 1]!.endMs !== durationMs)) {
    throw new ComicCoreError("INVALID_PROJECT", `${label}.segments must cover the entire song`, "comic.invalid_project.segments_must_cover_the_entire_song", { field: label });
  }
  for (let index = 1; index < segments.length; index++) {
    if (segments[index]!.startMs !== segments[index - 1]!.endMs || segments[index]!.sectionIndex < segments[index - 1]!.sectionIndex) {
      throw new ComicCoreError("INVALID_PROJECT", `${label}.segments must be contiguous and ordered`, "comic.invalid_project.segments_must_be_contiguous_and_ordered", { field: label });
    }
  }
  return { ...(item.treatment === undefined ? {} : { treatment: musicMvTreatment(item.treatment, `${label}.treatment`) }),
    ...(item.singerPortraitAssetId === undefined ? {} : { singerPortraitAssetId: identifier(item.singerPortraitAssetId, "asset", `${label}.singerPortraitAssetId`) }),
    lyrics: boundedText(item.lyrics, `${label}.lyrics`, MAX_LYRICS_CHARACTERS), durationMs, alignment: alignment(item.alignment, `${label}.alignment`), lines, segments,
    ...(item.songAssetId === undefined ? {} : { songAssetId: identifier(item.songAssetId, "asset", `${label}.songAssetId`) }) };
}

export function musicSettings(value: unknown, label: string): ComicMusicSettings {
  const item = record(value, label);
  if (item.vocalReferenceConsent !== undefined && typeof item.vocalReferenceConsent !== "boolean") {
    throw new ComicCoreError("INVALID_PROJECT", `${label}.vocalReferenceConsent must be true or false`, "comic.invalid_project.vocalreferenceconsent_must_be_true_or_false", { field: label });
  }
  const choice = (name: string): string => boundedText(item[name], `${label}.${name}`, 500, { fallback: "" }) || "";
  if (item.instrumental !== undefined && typeof item.instrumental !== "boolean") throw new ComicCoreError("INVALID_PROJECT", `${label}.instrumental must be true or false`, "comic.invalid_project.instrumental_must_be_true_or_false", { field: label });
  const length = item.length === undefined ? "full" : item.length;
  if (length !== "full" && length !== "clip") throw new ComicCoreError("INVALID_PROJECT", `${label}.length must be full or clip`, "comic.invalid_project.length_must_be_full_or_clip", { field: label });
  const format = item.format === undefined ? "mp3" : item.format;
  if (format !== "mp3" && format !== "wav") throw new ComicCoreError("INVALID_PROJECT", `${label}.format must be mp3 or wav`, "comic.invalid_project.format_must_be_mp3_or_wav", { field: label });
  return {
    ...(item.mode === undefined ? {} : { mode: oneOf(item.mode, ["generate", "cover"] as const, `${label}.mode`) }),
    ...(item.vocalSource === undefined ? {} : { vocalSource: oneOf(item.vocalSource, ["default", "my_voice"] as const, `${label}.vocalSource`) }),
    ...(item.vocalReferenceAssetId === undefined || item.vocalReferenceAssetId === "" ? {} : { vocalReferenceAssetId: identifier(item.vocalReferenceAssetId, "asset", `${label}.vocalReferenceAssetId`) }),
    ...(item.referenceSongAssetId === undefined || item.referenceSongAssetId === "" ? {} : { referenceSongAssetId: identifier(item.referenceSongAssetId, "asset", `${label}.referenceSongAssetId`) }),
    ...(item.vocalReferenceConsent === undefined ? {} : { vocalReferenceConsent: item.vocalReferenceConsent as boolean }),
    lyrics: boundedText(item.lyrics, `${label}.lyrics`, MAX_LYRICS_CHARACTERS, { fallback: "" }) || "",
    instrumental: item.instrumental === true,
    genre: choice("genre"),
    mood: choice("mood"),
    tempo: choice("tempo"),
    vocals: choice("vocals"),
    language: choice("language"),
    style: boundedText(item.style, `${label}.style`, 2_000, { fallback: "" }) || "",
    length,
    format,
    ...(item.selectedAssetId === undefined || item.selectedAssetId === "" ? {} : { selectedAssetId: identifier(item.selectedAssetId, "asset", `${label}.selectedAssetId`) }),
    ...(item.exportedAt === undefined || item.exportedAt === "" ? {} : { exportedAt: timestamp(item.exportedAt, `${label}.exportedAt`) }),
    ...(item.mv === undefined ? {} : { mv: musicMvSettings(item.mv, `${label}.mv`) }),
  };
}

export function mediaFit(value: unknown): ComicMediaFit {
  if (value === "contain" || value === "cover") return value;
  throw new ComicCoreError("INVALID_PROJECT", "Media fit must be contain or cover", "comic.invalid_project.media_fit_must_be_contain_or_cover", {});
}

export function transition(value: unknown): ComicTransition {
  return oneOf(value, TRANSITIONS, "shot.transition");
}

export function assetKind(value: unknown): ComicAssetKind {
  return oneOf(value, ASSET_KINDS, "asset.kind");
}

export function mediaSlot(value: unknown): ComicMediaSlot {
  return oneOf(value, MEDIA_SLOTS, "media.slot");
}

export function canvas(value: unknown): ComicCanvas {
  const item = record(value, "canvas");
  const ratio = aspectRatio(item.aspectRatio);
  const width = integer(item.width, "canvas.width", 64, 16_384);
  const height = integer(item.height, "canvas.height", 64, 16_384);
  const expected: Record<ComicAspectRatio, number> = {
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "1:1": 1,
    "4:3": 4 / 3,
  };
  if (Math.abs(width / height - expected[ratio]) / expected[ratio] > 0.02) {
    throw new ComicCoreError("INVALID_CANVAS", "Canvas dimensions do not match the selected aspect ratio", "comic.invalid_canvas.canvas_dimensions_do_not_match_the_selected_aspect_ratio", {});
  }
  return { aspectRatio: ratio, width, height };
}

export function expectedRevision(value: unknown): number {
  return integer(value, "expectedRevision", 0, Number.MAX_SAFE_INTEGER);
}

export function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ComicCoreError("DUPLICATE_ID", `${label} contains duplicate identifiers`, "comic.duplicate_id.contains_duplicate_identifiers", { field: label });
  }
}

export function assertCurrentRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ComicCoreError(
      "REVISION_CONFLICT",
      `Comic project changed from revision ${expected} to ${actual}; reload before applying this edit`, "comic.revision_conflict.comic_project_changed_from_revision_to_reload_before_applying_this_edit", { expected, actual },
    );
  }
}

export const MAX_EPISODE_SCRIPTS = 100;
export const MAX_EPISODE_SCRIPT_CHARACTERS = 30_000;

export function episodeScripts(value: unknown, label: string): readonly ComicEpisodeScript[] {
  const items = array(value, label, MAX_EPISODE_SCRIPTS).map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    const provenance = item.titleDefault === undefined ? undefined : defaultTitle(item.titleDefault, `${label}[${index}].titleDefault`);
    return {
      number: integer(item.number, `${label}[${index}].number`, 1, 1_000),
      title: boundedText(item.title, `${label}[${index}].title`, 120),
      ...(provenance && item.title === comicDefaultTitle(provenance) ? { titleDefault: provenance } : {}),
      ...(item.sourceRange === undefined ? {} : { sourceRange: episodeSourceRange(item.sourceRange, `${label}[${index}].sourceRange`) }),
      ...(item.outline === undefined ? {} : { outline: boundedText(item.outline, `${label}[${index}].outline`, 20_000) }),
      ...(item.ending === undefined ? {} : { ending: boundedText(item.ending, `${label}[${index}].ending`, 4_000) }),
      script: boundedText(item.script, `${label}[${index}].script`, MAX_EPISODE_SCRIPT_CHARACTERS),
    };
  });
  assertUnique(items.map(item => String(item.number)), label);
  return [...items].sort((left, right) => left.number - right.number);
}

export function adaptSettings(value: unknown, label: string): ComicAdaptSettings {
  const item = record(value, label);
  const choice = (name: string): string => boundedText(item[name], `${label}.${name}`, 500, { fallback: "default" }) || "default";
  return {
    episodes: integer(item.episodes, `${label}.episodes`, 1, MAX_EPISODE_SCRIPTS),
    episodeSeconds: integer(item.episodeSeconds, `${label}.episodeSeconds`, 10, 1_800),
    perspective: choice("perspective"),
    style: choice("style"),
    look: choice("look"),
    costume: choice("costume"),
    lighting: choice("lighting"),
    pacing: choice("pacing"),
    sound: choice("sound"),
    ...(item.clipSeconds === undefined ? {} : {
      clipSeconds: array(item.clipSeconds, `${label}.clipSeconds`, 60).map((value, index) => integer(value, `${label}.clipSeconds[${index}]`, 1, 120)),
    }),
  };
}

function episodeSourceRange(value: unknown, label: string): { readonly start: number; readonly end: number } {
  const item = record(value, label);
  const start = integer(item.start, `${label}.start`, 0, Number.MAX_SAFE_INTEGER - 1);
  return { start, end: integer(item.end, `${label}.end`, start + 1, Number.MAX_SAFE_INTEGER) };
}
