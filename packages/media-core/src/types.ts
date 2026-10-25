import type { ReadableModelError } from "@nextmux/model-runtime/errors";
import type { CapacityWaitReason } from '@nextmux/model-runtime/capacity-reasons';

export const MEDIA_QUEUE_SCHEMA_VERSION = 1 as const;
export const MEDIA_QUEUE_FILE = "media-jobs-v1.json";

export type MediaJobKind =
  | "image"
  | "video"
  | "speech"
  | "music"
  | "sound_effect"
  | "subtitle"
  | "shot_preview";

export type MediaProviderCapability =
  | "text_to_image"
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "native_audio"
  | "native_subtitle"
  | "tts"
  | "music_generation"
  | "vocal_reference"
  | "cover"
  | "sound_effect_generation"
  | "lip_sync"
  | "video_extend"
  | "first_last_frame"
  | "frame_edit"
  | "segment_edit"
  | "transcription"
  | "render"
  | "async_poll"
  | "webhook"
  | "cancel";

export type MediaCapabilityStatus = "supported" | "unsupported" | "unknown";

export interface MediaProviderCapabilityEvidence {
  readonly capability: MediaProviderCapability;
  readonly status: MediaCapabilityStatus;
  readonly source: "provider_metadata" | "merchant_declaration" | "live_probe" | "manual_override";
  readonly reason?: string;
  readonly observedAt?: string;
}

export interface MediaProviderProfile {
  readonly providerId: string;
  readonly modelId: string;
  readonly protocol: string;
  readonly capabilities: readonly MediaProviderCapabilityEvidence[];
  readonly updatedAt: string;
}
export type MediaJobStatus =
  | "awaiting_confirmation"
  | "queued"
  | "paused"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface MediaJobCost {
  readonly billing: "free" | "provider_billed" | "platform_billed";
  /** Display identity follows billing; legacy description is retained only as detail. */
  readonly messageKey?: "media.cost.free" | "media.cost.provider_billed" | "media.cost.platform_billed";
  readonly params?: Readonly<Record<string, string | number | boolean | null>>;
  readonly description: string;
}

export interface MediaImageJobInput {
  /** Exact canvas choices; adapters must not derive a different ratio from approximate pixels. */
  readonly resolution?: string;
  readonly aspectRatio?: string;
  readonly keyPriceQuoteId?: string;
  readonly connectionId: string;
  readonly model: string;
  readonly prompt: string;
  /** Generate the scene setting; attach to the scene rather than the shot. */
  readonly comicSetPlate?: boolean;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  /** Output quality for models priced per quality tier (GPT Image low/medium/high); picks the billed tier. */
  readonly quality?: string;
  /** Pictures of the characters in the shot (project-relative), sent as references so faces stay the same. */
  readonly characterReferenceUris?: readonly string[];
}

export interface MediaSpeechJobInput {
  readonly keyPriceQuoteId?: string;
  readonly connectionId: string;
  readonly model: string;
  readonly text: string;
  readonly voice: string;
  readonly format: "mp3" | "wav";
}

export interface MediaMusicReference {
  /** Project-owned WAV/MP3 asset. The backend verifies its bytes and duration. */
  readonly assetUri: string;
  readonly durationSeconds: number;
}

export interface MediaVocalReference extends MediaMusicReference {
  readonly consent: boolean;
}

export interface MediaReferenceUpload {
  /** Hash of provider, model, template, reference role and file contents. */
  readonly scope: string;
  readonly id: string;
  readonly expiresAt?: number;
}

export interface MediaAudioGenerationJobInput {
  readonly keyPriceQuoteId?: string;
  readonly connectionId: string;
  readonly model: string;
  readonly prompt: string;
  readonly durationSeconds: number;
  readonly format: "mp3" | "wav";
  /** Music only: the full lyrics with [Verse]/[Chorus] section tags, sent to models that sing them. */
  readonly lyrics?: string;
  /** Music only: no vocals. */
  readonly instrumental?: boolean;
  readonly mode?: "generate" | "cover";
  readonly vocalReference?: MediaVocalReference;
  readonly referenceSong?: MediaMusicReference;
}

export interface MediaVideoJobInput {
  readonly generationMode?: 'textToVideo' | 'imageToVideo' | 'firstLastFrame' | 'referenceToVideo' | 'videoEdit' | 'videoExtend';
  readonly resolution?: string;
  readonly aspectRatio?: string;
  /** Frozen provenance for an input-derived canvas aspect, including intentional provider omission. */
  readonly aspectRatioSource?: 'firstFrame' | 'referenceImage';
  readonly referenceVideoUris?: readonly string[];
  readonly referenceAudioUris?: readonly string[];
  readonly preserveOriginalAudio?: boolean;
  /** A visual segment of a music project's one-song timeline. */
  readonly musicMvSegmentId?: string;
  /** Authored segment prompt before model-language translation; binds the translated request to its source. */
  readonly musicMvSourcePrompt?: string;
  /** Set by the desktop enqueue service; binds queued work to the exact song and segment. */
  readonly musicMvSnapshot?: string;
  readonly keyPriceQuoteId?: string;
  readonly connectionId: string;
  readonly model: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly referenceAssetUris?: readonly string[];
  /** Pictures of the characters in the shot (project-relative), sent as identity references. */
  readonly characterReferenceUris?: readonly string[];
  readonly firstFrameUri?: string;
  readonly lastFrameUri?: string;
  readonly sourceVideoUri?: string;
  readonly editFrameSeconds?: number;
  readonly editStartSeconds?: number;
  readonly editEndSeconds?: number;
  readonly requestAudio?: boolean;
  /** Explicit standard video audio control for a newly compiled request. Legacy jobs keep their original wire shape. */
  readonly audioControlVersion?: 1;
  readonly requestSubtitles?: boolean;
}

export interface MediaSubtitleCueInput {
  readonly text: string;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly speakerName?: string;
}

export interface MediaSubtitleJobInput {
  readonly frameRate: 24 | 25 | 30;
  readonly cues: readonly MediaSubtitleCueInput[];
  readonly format?: "srt" | "vtt" | "ass";
}

export interface MediaShotPreviewJobInput {
  readonly frameRate: 24 | 25 | 30;
  readonly durationFrames: number;
  readonly width: number;
  readonly height: number;
  readonly visualAssetUri: string;
  readonly audioAssetUri?: string;
}

export type MediaJobInput =
  | MediaImageJobInput
  | MediaVideoJobInput
  | MediaSpeechJobInput
  | MediaAudioGenerationJobInput
  | MediaSubtitleJobInput
  | MediaShotPreviewJobInput;

export interface EnqueueMediaJobRequest {
  readonly idempotencyKey: string;
  readonly kind: MediaJobKind;
  readonly projectId: string;
  readonly sceneId: string;
  readonly shotId: string;
  readonly input: MediaJobInput;
  readonly cost: MediaJobCost;
  readonly maxAttempts?: number;
}

/**
 * A generation the provider has accepted: its task id and where to ask for it. A job interrupted while it
 * waits (the app closed) asks for this task again after a restart instead of submitting — and paying — again.
 */
export interface MediaJobRemoteTask {
  readonly taskId: string;
  readonly pollUrl?: string;
  readonly resultUrl?: string;
  readonly submittedAt: string;
}

export interface MediaJobCheckpoint {
  readonly assetId: string;
  readonly assetKind: "image" | "audio" | "music" | "effect" | "subtitle" | "video";
  readonly relativeUri: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly provider: string;
  readonly model: string;
  readonly prompt?: string;
  /** Opaque provider evidence; values are never converted into prices. */
  readonly providerEvidence?: {
    readonly providerRequestId?: string;
    readonly durationMs?: number;
    readonly characterCost?: number;
  };
  /** Evidence read from the actual media bytes, never inferred from request flags. */
  readonly mediaEvidence?: {
    readonly nativeAudio: boolean;
    readonly nativeSubtitles: boolean;
    /** `false` means no embedded subtitle stream was detected; burned-in
     * subtitles cannot be determined from a media probe. */
    readonly subtitleCheck: "embedded" | "not_embedded";
    readonly checkedAt: string;
    readonly checker: "ffprobe" | "ffmpeg";
  };
}

export interface MediaJobFailure {
  readonly domain?: ReadableModelError["domain"];
  readonly messageKey?: string;
  readonly params?: Readonly<Record<string, string | number | boolean | null>>;
  readonly readableError?: ReadableModelError;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly recoveryMode?: 'billing_only' | 'billing_review';
  readonly retryAfterMs?: number;
}

export interface MediaJobEvent {
  readonly at: string;
  readonly type:
    | "created"
    | "confirmed"
    | "paused"
    | "resumed"
    | "claimed"
    | "checkpointed"
    | "submitted"
    | "completed"
    | "failed"
    | "cancel_requested"
    | "cancelled"
    | "retried"
    | "recovered";
  readonly note?: string;
}

/** Persisted ownership across backend connections. A stale heartbeat alone never proves a live process died. */
export interface MediaWorkerLease {
  readonly processId: number;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
  readonly releasedAt?: string;
}

export interface MediaJob {
  readonly id: string;
  readonly idempotencyKey: string;
  /** Imported task history is display-only and may never be retried or regenerated. */
  readonly restoredHistoryOnly?: true;
  /** Hash of the original key, retained only to prevent an old paid request being resubmitted. */
  readonly archivedIdempotencyDigest?: string;
  readonly payloadHash: string;
  readonly kind: MediaJobKind;
  readonly projectId: string;
  readonly sceneId: string;
  readonly shotId: string;
  readonly input: MediaJobInput;
  /** Trusted execution metadata frozen for new compatible BYOK image/video jobs; excluded from user payload identity. */
  readonly mediaApiStyle?: "openai" | "openrouter";
  /** New native image size contract; absent jobs retain their original size fitter. */
  readonly nativeImageSizeContract?: "seedream45_v1";
  readonly cost: MediaJobCost;
  readonly status: MediaJobStatus;
  /** No provider call owns this waiting period; original input remains local. */
  readonly waitingCapacity?: true;
  readonly capacityReasons?: readonly CapacityWaitReason[];
  /** A local metadata journal owns the original platform request; recovery must use that journal. */
  readonly capacityWaitRecorded?: true;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly confirmedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly workerId?: string;
  readonly ownerLease?: MediaWorkerLease;
  readonly cancelRequestedAt?: string;
  readonly checkpoint?: MediaJobCheckpoint;
  readonly remoteTask?: MediaJobRemoteTask;
  /** Provider upload IDs survive retries and restarts; never include audio bytes or credentials. */
  readonly referenceUploads?: readonly MediaReferenceUpload[];
  readonly output?: MediaJobCheckpoint;
  readonly failure?: MediaJobFailure;
  readonly events: readonly MediaJobEvent[];
}

export interface MediaQueueState {
  readonly schemaVersion: typeof MEDIA_QUEUE_SCHEMA_VERSION;
  readonly revision: number;
  readonly jobs: readonly MediaJob[];
  readonly updatedAt: string;
}

export interface MediaJobStoreOptions {
  readonly root: string;
}

export interface MediaJobMutationOptions {
  readonly now?: string;
  readonly idFactory?: () => string;
}
