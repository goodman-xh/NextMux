import { mediaErrorMetadata, mediaMessage, type MediaErrorMessage, type MediaErrorParams } from "./error-metadata.js";
import { classifyModelError } from "@nextmux/model-runtime/errors";
import { isAbsolute, posix, win32 } from "node:path";

import type {
  EnqueueMediaJobRequest,
  MediaJobCheckpoint,
  MediaJobCost,
  MediaJobRemoteTask,
  MediaJobFailure,
  MediaJobInput,
  MediaJobKind,
  MediaJobStatus,
  MediaVideoJobInput,
  MediaMusicReference,
  MediaVocalReference,
  MediaReferenceUpload,
} from "./types.js";

export class MediaCoreError extends Error {
  readonly code: string;
  readonly domain = "media" as const;
  readonly messageKey: string;
  readonly params: MediaErrorParams;
  readonly readableError: ReturnType<typeof mediaErrorMetadata>["readableError"];
  readonly data: { readonly readableError: ReturnType<typeof mediaErrorMetadata>["readableError"] };

  constructor(code: string, message: string | MediaErrorMessage) {
    const metadata = mediaErrorMetadata(code, message);
    super(metadata.message);
    this.name = "MediaCoreError";
    this.code = code;
    this.messageKey = metadata.messageKey;
    this.params = metadata.params;
    this.readableError = metadata.readableError;
    this.data = { readableError: this.readableError };
  }
}

export function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.field_must_be_an_iso_timestamp", { label: label }));
  }
  return value;
}

export function boundedText(
  value: unknown,
  label: string,
  maximum: number,
  options: { readonly required?: boolean } = {},
): string {
  if (typeof value !== "string" || value.includes("\0") || /[\r\n]/.test(value) && maximum <= 256) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_must_be_text", { label: label }));
  }
  const text = value.trim();
  if ((options.required && !text) || text.length > maximum) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_has_an_invalid_length", { label, minimum: options.required ? 1 : 0, maximum }));
  }
  return text;
}

export function safeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_must_be_an_integer_from_field_to_field", { label: label, minimum: minimum, maximum: maximum }));
  }
  return value as number;
}

export function mediaJobId(value: unknown): string {
  if (typeof value !== "string" || !/^media-job-[0-9a-f-]{36}$/.test(value)) {
    throw new MediaCoreError("INVALID_JOB_ID", mediaMessage("media.media_job_identifier_is_invalid"));
  }
  return value;
}

export function workerId(value: unknown): string {
  if (typeof value !== "string" || !/^media-worker-[A-Za-z0-9-]{8,96}$/.test(value)) {
    throw new MediaCoreError("INVALID_WORKER_ID", mediaMessage("media.media_worker_identifier_is_invalid"));
  }
  return value;
}

export function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new MediaCoreError("INVALID_IDEMPOTENCY_KEY", mediaMessage("media.media_idempotency_key_is_invalid"));
  }
  return value;
}

function connectionId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:official-[0-9a-f-]{36}|managed:(?:auto|fixed):[0-9a-f-]{36})$/.test(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.media_connection_identifier_is_invalid"));
  }
  return value;
}

function priceQuote(item: Record<string, unknown>): { readonly keyPriceQuoteId?: string } {
  if (item.keyPriceQuoteId === undefined) return {};
  if (typeof item.keyPriceQuoteId !== "string" || !/^kq1_[a-f0-9]{64}$/.test(item.keyPriceQuoteId)
      || typeof item.connectionId !== "string" || !item.connectionId.startsWith("managed:")) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.invalid_managed_media_price_authorization"));
  }
  return { keyPriceQuoteId: item.keyPriceQuoteId };
}

function entityId(value: unknown, prefix: "project" | "scene" | "shot", label: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}-[A-Za-z0-9][A-Za-z0-9-]{7,95}$`).test(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_is_invalid", { label: label }));
  }
  return value;
}

export function relativeMediaUri(value: unknown, label: string): string {
  const uri = boundedText(value, label, 512, { required: true }).replaceAll("\\", "/");
  if (isAbsolute(uri) || win32.isAbsolute(uri) || uri.startsWith("/") || uri.includes(":") || uri.includes("\0")) {
    throw new MediaCoreError("INVALID_MEDIA_PATH", mediaMessage("media.field_must_be_a_relative_media_path", { label: label }));
  }
  const normalized = posix.normalize(uri);
  const managedDirectory = "nextmux.media";
  const managed = normalized.startsWith(`${managedDirectory}/`);
  if (normalized !== uri || normalized === managedDirectory || !managed) {
    throw new MediaCoreError("INVALID_MEDIA_PATH", mediaMessage("media.field_must_stay_inside_nextmux_media", { label: label }));
  }
  return normalized;
}

function cost(value: unknown): MediaJobCost {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.media_cost_declaration_is_invalid"));
  }
  const item = value as Partial<MediaJobCost>;
  if (item.billing !== "free" && item.billing !== "provider_billed" && item.billing !== "platform_billed") {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.media_billing_mode_is_invalid"));
  }
  return {
    billing: item.billing,
    messageKey: `media.cost.${item.billing}`,
    params: {},
    description: boundedText(item.description, "cost.description", 240, { required: true }),
  };
}

function imageInput(value: unknown): MediaJobInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.image_job_input_is_invalid"));
  }
  const item = value as Record<string, unknown>;
  return {
    ...canvasMediaDimensions(item),
    connectionId: item.connectionId === "comfyui:local" ? "comfyui:local" : connectionId(item.connectionId),
    ...priceQuote(item),
    model: boundedText(item.model, "image.model", 200, { required: true }),
    ...(item.comicSetPlate === true ? { comicSetPlate: true } : {}),
    prompt: boundedText(item.prompt, "image.prompt", 20_000, { required: true }),
    ...(item.negativePrompt === undefined ? {} : {
      negativePrompt: boundedText(item.negativePrompt, "image.negativePrompt", 10_000),
    }),
    width: safeInteger(item.width, "image.width", 64, 4096),
    height: safeInteger(item.height, "image.height", 64, 4096),
    ...characterReferences(item.characterReferenceUris, "image"),
  };
}

/** Up to four project-relative pictures of the characters in a shot. */
function characterReferences(value: unknown, label: string): { readonly characterReferenceUris?: readonly string[] } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > 4) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_characterreferenceuris_is_invalid", { label: label }));
  }
  const uris = value.map((entry, index) => relativeMediaUri(entry, `${label}.characterReferenceUris[${index}]`));
  return uris.length ? { characterReferenceUris: [...new Set(uris)] } : {};
}

function speechInput(value: unknown): MediaJobInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.speech_job_input_is_invalid"));
  }
  const item = value as Record<string, unknown>;
  if (item.format !== "mp3" && item.format !== "wav") {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.speech_format_is_not_supported"));
  }
  return {
    connectionId: connectionId(item.connectionId),
    ...priceQuote(item),
    model: boundedText(item.model, "speech.model", 200, { required: true }),
    text: boundedText(item.text, "speech.text", 20_000, { required: true }),
    voice: boundedText(item.voice, "speech.voice", 100, { required: true }),
    format: item.format,
  };
}

function audioGenerationInput(value: unknown, label: "music" | "sound_effect"): MediaJobInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_job_input_is_invalid", { label: label }));
  }
  const item = value as Record<string, unknown>;
  if (item.format !== "mp3" && item.format !== "wav") {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_format_is_not_supported", { label: label }));
  }
  const vocalReference = item.vocalReference === undefined ? undefined : musicReference(item.vocalReference, true) as MediaVocalReference;
  const referenceSong = item.referenceSong === undefined ? undefined : musicReference(item.referenceSong, false);
  if (item.mode !== undefined && item.mode !== "generate" && item.mode !== "cover"
      || label !== "music" && (item.mode !== undefined || vocalReference || referenceSong)
      || item.mode === "cover" && (!referenceSong || vocalReference)
      || referenceSong && item.mode !== "cover"
      || (vocalReference || referenceSong) && item.instrumental === true) {
    throw new MediaCoreError("INVALID_MUSIC_MODE", mediaMessage("media.cover_mode_requires_a_reference_song_a_vocal_reference_cannot_be_combined_with_cover_or_instrumental_mode"));
  }
  return {
    connectionId: connectionId(item.connectionId),
    ...priceQuote(item),
    model: boundedText(item.model, `${label}.model`, 200, { required: true }),
    prompt: boundedText(item.prompt, `${label}.prompt`, 20_000, { required: true }),
    durationSeconds: positiveDurationSeconds(item.durationSeconds, `${label}.durationSeconds`),
    format: item.format,
    ...(item.mode === undefined ? {} : { mode: item.mode as "generate" | "cover" }),
    ...(vocalReference ? { vocalReference } : {}),
    ...(referenceSong ? { referenceSong } : {}),
    ...(label === "music" && item.lyrics !== undefined && String(item.lyrics).trim()
      ? { lyrics: boundedText(item.lyrics, "music.lyrics", 3_500, { required: true }) } : {}),
    ...(label === "music" && item.instrumental !== undefined
      ? { instrumental: (() => { if (typeof item.instrumental !== "boolean") throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.music_instrumental_must_be_true_or_false")); return item.instrumental; })() } : {}),
  };
}

function musicReference(value: unknown, vocal: boolean): MediaMusicReference | MediaVocalReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MediaCoreError("INVALID_MUSIC_REFERENCE", mediaMessage("media.music_reference_asset_is_invalid"));
  const item = value as Record<string, unknown>;
  const assetUri = relativeMediaUri(item.assetUri, "music.reference.assetUri");
  if (!/\.(?:wav|mp3)$/i.test(assetUri)) throw new MediaCoreError("INVALID_MUSIC_REFERENCE", mediaMessage("media.audio_references_require_wav_or_mp3"));
  const durationSeconds = boundedSeconds(item.durationSeconds, "music.reference.durationSeconds");
  if (durationSeconds <= 0 || vocal && durationSeconds < 15) throw new MediaCoreError("MUSIC_REFERENCE_TOO_SHORT", vocal ? mediaMessage("media.voice_sample_too_short", { minimum: 15 }) : mediaMessage("media.reference_song_duration_invalid"));
  if (vocal && item.consent !== true) throw new MediaCoreError("VOICE_CONSENT_REQUIRED", mediaMessage("media.confirm_that_this_is_your_voice_or_that_you_have_permission_to_use_it"));
  return { assetUri, durationSeconds, ...(vocal ? { consent: true } : {}) };
}

export function referenceUpload(value: unknown): MediaReferenceUpload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.reference_upload_is_invalid"));
  const item = value as MediaReferenceUpload;
  if (!/^[a-f0-9]{64}$/.test(item.scope) || typeof item.id !== "string" || !item.id.trim() || item.id.length > 512 || /[\u0000-\u001f]/.test(item.id)
      || item.expiresAt !== undefined && (!Number.isSafeInteger(item.expiresAt) || item.expiresAt <= 0)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.reference_upload_identity_is_invalid"));
  }
  return { scope: item.scope, id: item.id, ...(item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt }) };
}

function videoInput(value: unknown): MediaVideoJobInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.video_job_input_is_invalid"));
  }
  const item = value as Record<string, unknown>;
  if (item.audioControlVersion !== undefined && (item.audioControlVersion !== 1 || typeof item.requestAudio !== "boolean")) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", "A versioned video audio control requires an explicit boolean choice");
  }
  if (item.musicMvSegmentId !== undefined && (typeof item.musicMvSegmentId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.musicMvSegmentId))
      || item.musicMvSnapshot !== undefined && (typeof item.musicMvSnapshot !== "string" || !/^[a-f0-9]{64}$/.test(item.musicMvSnapshot) || item.musicMvSegmentId === undefined)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.video_music_mv_segment_identity_is_invalid"));
  }
  if (item.musicMvSourcePrompt !== undefined && item.musicMvSegmentId === undefined) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.video_musicmvsourceprompt_requires_a_music_mv_segment_identity"));
  }
  const musicMvSourcePrompt = item.musicMvSourcePrompt === undefined ? undefined
    : boundedText(item.musicMvSourcePrompt, "video.musicMvSourcePrompt", 6_000, { required: true });
  const references = item.referenceAssetUris === undefined
    ? undefined
    : (() => {
      if (!Array.isArray(item.referenceAssetUris) || item.referenceAssetUris.length > 12) {
        throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.video_referenceasseturis_is_invalid"));
      }
      return item.referenceAssetUris.map((entry, index) => relativeMediaUri(entry, `video.referenceAssetUris[${index}]`));
    })();
  const firstFrameUri = item.firstFrameUri === undefined ? undefined : relativeMediaUri(item.firstFrameUri, "video.firstFrameUri");
  const lastFrameUri = item.lastFrameUri === undefined ? undefined : relativeMediaUri(item.lastFrameUri, "video.lastFrameUri");
  const sourceVideoUri = item.sourceVideoUri === undefined ? undefined : relativeMediaUri(item.sourceVideoUri, "video.sourceVideoUri");
  const editFrameSeconds = item.editFrameSeconds === undefined ? undefined : boundedSeconds(item.editFrameSeconds, "video.editFrameSeconds");
  const editStartSeconds = item.editStartSeconds === undefined ? undefined : boundedSeconds(item.editStartSeconds, "video.editStartSeconds");
  const editEndSeconds = item.editEndSeconds === undefined ? undefined : boundedSeconds(item.editEndSeconds, "video.editEndSeconds");
  if ((editStartSeconds === undefined) !== (editEndSeconds === undefined)
      || editStartSeconds !== undefined && editEndSeconds !== undefined && editEndSeconds <= editStartSeconds) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.video_edit_time_range_is_invalid"));
  }
  if ((sourceVideoUri || editStartSeconds !== undefined || editEndSeconds !== undefined)
      && !sourceVideoUri) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.video_editing_requires_sourcevideouri"));
  }
  if (editFrameSeconds !== undefined && !sourceVideoUri) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.frame_editing_requires_sourcevideouri"));
  }
  if (editFrameSeconds !== undefined && (editStartSeconds !== undefined || editEndSeconds !== undefined)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.frame_editing_cannot_be_combined_with_a_segment_range"));
  }
  if ((firstFrameUri || lastFrameUri) && !firstFrameUri && !lastFrameUri) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.video_first_and_last_frame_parameters_are_invalid"));
  }
  return {
    ...canvasMediaDimensions(item),
    ...(item.aspectRatioSource === undefined ? {} : { aspectRatioSource: (() => {
      if (item.aspectRatioSource !== 'firstFrame' && item.aspectRatioSource !== 'referenceImage') throw new MediaCoreError('INVALID_MEDIA_REQUEST', 'Invalid canvas video aspect source');
      return item.aspectRatioSource;
    })() }),
    ...(item.generationMode === undefined ? {} : { generationMode: (() => {
      if (!['textToVideo', 'imageToVideo', 'firstLastFrame', 'referenceToVideo', 'videoEdit', 'videoExtend'].includes(String(item.generationMode))) throw new MediaCoreError('INVALID_MEDIA_REQUEST', 'Invalid canvas video generation mode');
      return item.generationMode as MediaVideoJobInput['generationMode'];
    })() }),
    ...(item.referenceVideoUris === undefined ? {} : { referenceVideoUris: canvasMediaReferences(item.referenceVideoUris, 'video.referenceVideoUris') }),
    ...(item.referenceAudioUris === undefined ? {} : { referenceAudioUris: canvasMediaReferences(item.referenceAudioUris, 'video.referenceAudioUris') }),
    ...(item.preserveOriginalAudio === undefined ? {} : { preserveOriginalAudio: booleanValue(item.preserveOriginalAudio, 'video.preserveOriginalAudio') }),
    connectionId: connectionId(item.connectionId),
    ...(item.musicMvSegmentId === undefined ? {} : { musicMvSegmentId: item.musicMvSegmentId as string }),
    ...(musicMvSourcePrompt === undefined ? {} : { musicMvSourcePrompt }),
    ...(item.musicMvSnapshot === undefined ? {} : { musicMvSnapshot: item.musicMvSnapshot as string }),
    ...priceQuote(item),
    model: boundedText(item.model, "video.model", 200, { required: true }),
    prompt: boundedText(item.prompt, "video.prompt", 20_000, { required: true }),
    ...(item.negativePrompt === undefined ? {} : {
      negativePrompt: boundedText(item.negativePrompt, "video.negativePrompt", 10_000),
    }),
    durationSeconds: safeInteger(item.durationSeconds, "video.durationSeconds", 1, 300),
    width: safeInteger(item.width, "video.width", 64, 4096),
    height: safeInteger(item.height, "video.height", 64, 4096),
    ...(references === undefined ? {} : { referenceAssetUris: references }),
    ...characterReferences(item.characterReferenceUris, "video"),
    ...(firstFrameUri === undefined ? {} : { firstFrameUri }),
    ...(lastFrameUri === undefined ? {} : { lastFrameUri }),
    ...(sourceVideoUri === undefined ? {} : { sourceVideoUri }),
    ...(editFrameSeconds === undefined ? {} : { editFrameSeconds }),
    ...(editStartSeconds === undefined ? {} : { editStartSeconds }),
    ...(editEndSeconds === undefined ? {} : { editEndSeconds }),
    ...(item.requestAudio === undefined ? {} : { requestAudio: booleanValue(item.requestAudio, "video.requestAudio") }),
    ...(item.audioControlVersion === 1 ? { audioControlVersion: 1 as const } : {}),
    ...(item.requestSubtitles === undefined ? {} : { requestSubtitles: booleanValue(item.requestSubtitles, "video.requestSubtitles") }),
  };
}

function canvasMediaDimensions(item: Record<string, unknown>): { resolution?: string; aspectRatio?: string } {
  return {
    ...(item.resolution === undefined ? {} : { resolution: boundedText(item.resolution, 'canvas.resolution', 40, { required: true }) }),
    ...(item.aspectRatio === undefined ? {} : { aspectRatio: boundedText(item.aspectRatio, 'canvas.aspectRatio', 40, { required: true }) }),
  };
}

function canvasMediaReferences(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 16) throw new MediaCoreError('INVALID_MEDIA_REQUEST', `${label} is invalid`);
  return value.map((entry, index) => relativeMediaUri(entry, `${label}[${index}]`));
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_must_be_boolean", { label: label }));
  return value;
}

function boundedSeconds(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 86_400) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_must_be_between_0_and_86400_seconds", { label: label }));
  }
  return value;
}

function positiveDurationSeconds(value: unknown, label: string): number {
  const seconds = boundedSeconds(value, label);
  if (seconds <= 0 || seconds > 300) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.field_must_be_greater_than_0_and_at_most_300_seconds", { label: label }));
  }
  return seconds;
}

function subtitleInput(value: unknown): MediaJobInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.subtitle_job_input_is_invalid"));
  }
  const item = value as Record<string, unknown>;
  if (item.frameRate !== 24 && item.frameRate !== 25 && item.frameRate !== 30) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.subtitle_frame_rate_is_not_supported"));
  }
  if (!Array.isArray(item.cues) || item.cues.length < 1 || item.cues.length > 100) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.subtitle_job_needs_1_to_100_cues"));
  }
  return {
    frameRate: item.frameRate,
    ...(item.format === undefined ? {} : {
      format: item.format === "srt" || item.format === "vtt" || item.format === "ass"
        ? item.format
        : (() => { throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.subtitle_format_is_not_supported")); })()
    }),
    cues: item.cues.map((cue, index) => {
      if (!cue || typeof cue !== "object" || Array.isArray(cue)) {
        throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.subtitle_cues_field_is_invalid", { index: index }));
      }
      const entry = cue as Record<string, unknown>;
      return {
        text: boundedText(entry.text, `subtitle.cues[${index}].text`, 5_000, { required: true }),
        startFrame: safeInteger(entry.startFrame, `subtitle.cues[${index}].startFrame`, 0, 540_000),
        durationFrames: safeInteger(entry.durationFrames, `subtitle.cues[${index}].durationFrames`, 1, 540_000),
        ...(entry.speakerName === undefined ? {} : {
          speakerName: boundedText(entry.speakerName, `subtitle.cues[${index}].speakerName`, 120),
        }),
      };
    }),
  };
}

function previewInput(value: unknown): MediaJobInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.preview_job_input_is_invalid"));
  }
  const item = value as Record<string, unknown>;
  if (item.frameRate !== 24 && item.frameRate !== 25 && item.frameRate !== 30) {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.preview_frame_rate_is_not_supported"));
  }
  return {
    frameRate: item.frameRate,
    durationFrames: safeInteger(item.durationFrames, "preview.durationFrames", 1, 540_000),
    width: safeInteger(item.width, "preview.width", 64, 4096),
    height: safeInteger(item.height, "preview.height", 64, 4096),
    visualAssetUri: relativeMediaUri(item.visualAssetUri, "preview.visualAssetUri"),
    ...(item.audioAssetUri === undefined ? {} : {
      audioAssetUri: relativeMediaUri(item.audioAssetUri, "preview.audioAssetUri"),
    }),
  };
}

export function mediaInput(kind: MediaJobKind, value: unknown): MediaJobInput {
  if (kind === "image") return imageInput(value);
  if (kind === "video") return videoInput(value);
  if (kind === "speech") return speechInput(value);
  if (kind === "music") return audioGenerationInput(value, "music");
  if (kind === "sound_effect") return audioGenerationInput(value, "sound_effect");
  if (kind === "subtitle") return subtitleInput(value);
  if (kind === "shot_preview") return previewInput(value);
  throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.media_job_kind_is_not_supported"));
}

export function enqueueRequest(value: EnqueueMediaJobRequest): EnqueueMediaJobRequest {
  if (!value || typeof value !== "object") {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.media_job_request_is_invalid"));
  }
  if (value.kind !== "image" && value.kind !== "video" && value.kind !== "speech" && value.kind !== "music" && value.kind !== "sound_effect" && value.kind !== "subtitle" && value.kind !== "shot_preview") {
    throw new MediaCoreError("INVALID_MEDIA_REQUEST", mediaMessage("media.media_job_kind_is_not_supported"));
  }
  return {
    idempotencyKey: idempotencyKey(value.idempotencyKey),
    kind: value.kind,
    projectId: entityId(value.projectId, "project", "projectId"),
    sceneId: entityId(value.sceneId, "scene", "sceneId"),
    shotId: entityId(value.shotId, "shot", "shotId"),
    input: mediaInput(value.kind, value.input),
    cost: cost(value.cost),
    ...(value.maxAttempts === undefined ? {} : {
      maxAttempts: safeInteger(value.maxAttempts, "maxAttempts", 1, 3),
    }),
  };
}

/** A provider's task for a job (see MediaJobRemoteTask). */
export function remoteTask(value: unknown, label: string | number): MediaJobRemoteTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_remotetask_is_invalid", { label: label }));
  }
  const item = value as MediaJobRemoteTask;
  const link = (url: unknown, name: string): string | undefined => {
    if (url === undefined) return undefined;
    if (typeof url !== "string" || url.length > 2_048 || !/^https:\/\/[^\s]+$/.test(url)) {
      throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_remotetask_field_is_invalid", { label: label, name: name }));
    }
    return url;
  };
  if (typeof item.taskId !== "string" || !item.taskId.trim() || item.taskId.length > 512 || /[\u0000-\u001f]/.test(item.taskId)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_remotetask_taskid_is_invalid", { label: label }));
  }
  const pollUrl = link(item.pollUrl, "pollUrl");
  const resultUrl = link(item.resultUrl, "resultUrl");
  return { taskId: item.taskId, ...(pollUrl ? { pollUrl } : {}), ...(resultUrl ? { resultUrl } : {}), submittedAt: isoTimestamp(item.submittedAt, `jobs[${label}].remoteTask.submittedAt`) };
}

export function checkpoint(value: MediaJobCheckpoint): MediaJobCheckpoint {
  if (!value || typeof value !== "object") {
    throw new MediaCoreError("INVALID_MEDIA_CHECKPOINT", mediaMessage("media.media_checkpoint_is_invalid"));
  }
  if (value.assetKind !== "image" && value.assetKind !== "audio" && value.assetKind !== "music" && value.assetKind !== "effect"
      && value.assetKind !== "subtitle" && value.assetKind !== "video") {
    throw new MediaCoreError("INVALID_MEDIA_CHECKPOINT", mediaMessage("media.media_asset_kind_is_invalid"));
  }
  if (!/^asset-[A-Za-z0-9][A-Za-z0-9-]{7,95}$/.test(value.assetId)) {
    throw new MediaCoreError("INVALID_MEDIA_CHECKPOINT", mediaMessage("media.media_asset_identifier_is_invalid"));
  }
  if (!/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new MediaCoreError("INVALID_MEDIA_CHECKPOINT", mediaMessage("media.media_asset_checksum_is_invalid"));
  }
  return {
    assetId: value.assetId,
    assetKind: value.assetKind,
    relativeUri: relativeMediaUri(value.relativeUri, "checkpoint.relativeUri"),
    mimeType: boundedText(value.mimeType, "checkpoint.mimeType", 100, { required: true }),
    byteLength: safeInteger(value.byteLength, "checkpoint.byteLength", 1, value.assetKind === "video" ? 5 * 1024 * 1024 * 1024 * 1024 : 512 * 1024 * 1024),
    sha256: value.sha256,
    provider: boundedText(value.provider, "checkpoint.provider", 200, { required: true }),
    model: boundedText(value.model, "checkpoint.model", 200, { required: true }),
    ...(value.prompt === undefined ? {} : { prompt: boundedText(value.prompt, "checkpoint.prompt", 20_000) }),
    ...(value.providerEvidence === undefined ? {} : {
      providerEvidence: (() => {
        const evidence = value.providerEvidence;
        if (!evidence || typeof evidence !== "object"
            || (evidence.providerRequestId !== undefined && (typeof evidence.providerRequestId !== "string" || evidence.providerRequestId.length > 200))
            || (evidence.durationMs !== undefined && (!Number.isFinite(evidence.durationMs) || evidence.durationMs < 0))
            || (evidence.characterCost !== undefined && (!Number.isSafeInteger(evidence.characterCost) || evidence.characterCost < 0))) {
          throw new MediaCoreError("INVALID_MEDIA_CHECKPOINT", mediaMessage("media.provider_media_evidence_is_invalid"));
        }
        return {
          ...(evidence.providerRequestId === undefined ? {} : { providerRequestId: evidence.providerRequestId }),
          ...(evidence.durationMs === undefined ? {} : { durationMs: evidence.durationMs }),
          ...(evidence.characterCost === undefined ? {} : { characterCost: evidence.characterCost }),
        };
      })()
    }),
    ...(value.mediaEvidence === undefined ? {} : {
      mediaEvidence: (() => {
        const evidence = value.mediaEvidence;
        if (!evidence || typeof evidence !== "object"
            || typeof evidence.nativeAudio !== "boolean"
            || typeof evidence.nativeSubtitles !== "boolean"
            || (evidence.subtitleCheck !== "embedded" && evidence.subtitleCheck !== "not_embedded")
            || typeof evidence.checkedAt !== "string" || !Number.isFinite(Date.parse(evidence.checkedAt))
            || (evidence.checker !== "ffprobe" && evidence.checker !== "ffmpeg")) {
          throw new MediaCoreError("INVALID_MEDIA_CHECKPOINT", mediaMessage("media.media_track_evidence_is_invalid"));
        }
        return {
          nativeAudio: evidence.nativeAudio,
          nativeSubtitles: evidence.nativeSubtitles,
          subtitleCheck: evidence.subtitleCheck,
          checkedAt: new Date(evidence.checkedAt).toISOString(),
          checker: evidence.checker
        };
      })()
    }),
  };
}

export function failure(value: MediaJobFailure): MediaJobFailure {
  if (!value || typeof value !== "object" || typeof value.retryable !== "boolean") {
    throw new MediaCoreError("INVALID_MEDIA_FAILURE", mediaMessage("media.media_failure_is_invalid"));
  }
  if (value.requestId !== undefined && (typeof value.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId))
      || value.recoveryMode !== undefined && !['billing_only', 'billing_review'].includes(value.recoveryMode)) {
    throw new MediaCoreError('INVALID_MEDIA_FAILURE', mediaMessage("media.media_recovery_identity_is_invalid"));
  }
  const code = boundedText(value.code, "failure.code", 80, { required: true });
  const message = boundedText(value.message, "failure.message", 500, { required: true });
  // Old persisted recovery records have stable codes even when their prose predates localization.
  const recoveryKeys: Readonly<Record<string, string>> = {
    MEDIA_OUTCOME_UNKNOWN: "media.recovery_provider_outcome_unknown",
    BILLING_TRANSPORT_UNKNOWN: "media.recovery_provider_outcome_unknown",
    WORKER_INTERRUPTED: "media.recovery_local_interrupted",
    ARCHIVED_FAILURE: "media.archived_failure",
  };
  const messageKey = value.messageKey ?? value.readableError?.messageKey ?? recoveryKeys[code] ?? (value.readableError ? undefined : "media.unknown");
  const params = value.params ?? value.readableError?.params ?? {};
  if (messageKey !== undefined && (typeof messageKey !== "string" || messageKey.length > 200 || !/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(messageKey))) {
    throw new MediaCoreError("INVALID_MEDIA_FAILURE", mediaMessage("media.media_failure_is_invalid"));
  }
  if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length > 32
      || Object.entries(params).some(([key, entry]) => !/^[A-Za-z_][\w]{0,79}$/.test(key)
        || !(entry === null || typeof entry === "boolean" || typeof entry === "number" && Number.isFinite(entry)
          || typeof entry === "string" && entry.length <= 512))) {
    throw new MediaCoreError("INVALID_MEDIA_FAILURE", mediaMessage("media.media_failure_is_invalid"));
  }
  const classified = classifyModelError(value.readableError ?? { domain: value.domain, code, message });
  const domain = classified.domain ?? "media";
  const readableError = messageKey
    ? { ...classified, domain, code, messageKey, params }
    : value.readableError ? classified : undefined;
  return {
    ...(readableError ? { readableError } : {}),
    ...(messageKey ? { domain, messageKey, params } : {}),
    code,
    message: messageKey?.startsWith("media.") ? mediaMessage(messageKey, params).message : message,
    retryable: value.retryable,
    ...(value.requestId ? { requestId: value.requestId } : {}),
    ...(value.recoveryMode ? { recoveryMode: value.recoveryMode } : {}),
    ...(value.retryAfterMs === undefined ? {} : { retryAfterMs: safeInteger(value.retryAfterMs, "failure.retryAfterMs", 0, 300_000) }),
  };
}

export function jobStatus(value: unknown): MediaJobStatus {
  const statuses: readonly MediaJobStatus[] = [
    "awaiting_confirmation", "queued", "paused", "running", "succeeded", "failed", "cancelled", "interrupted",
  ];
  if (!statuses.includes(value as MediaJobStatus)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.media_job_status_is_invalid"));
  }
  return value as MediaJobStatus;
}
