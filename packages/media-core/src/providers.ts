import { mediaMessage } from "./error-metadata.js";
import {
  requestElevenLabsMusic,
  requestElevenLabsSoundEffect,
  requestMiniMaxMusic,
} from "./runtime.js";
import type {
  MediaBinaryResult,
  OpenAICompatibleImageOptions,
  OpenAICompatibleSpeechOptions,
  ElevenLabsMusicOptions,
  ElevenLabsSoundEffectOptions,
  MiniMaxMusicOptions,
} from "./runtime.js";
import { MediaRuntimeError } from "./runtime.js";
import type {
  MediaJob,
  MediaJobInput,
  MediaJobKind,
  MediaProviderCapability,
  MediaProviderProfile,
  MediaVideoJobInput,
  MediaAudioGenerationJobInput,
} from "./types.js";

export interface MediaProviderJobRequest {
  readonly job: MediaJob;
  readonly signal?: AbortSignal;
}

export interface MediaProviderJobHandle {
  readonly providerJobId: string;
  readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly output?: MediaBinaryResult;
  readonly failure?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

/**
 * Modality-specific provider boundary. An adapter may implement only the
 * operations it actually supports; unknown capabilities are never assumed.
 */
export interface MediaProviderAdapter {
  readonly id: string;
  readonly profile: MediaProviderProfile;
  createImage?(options: OpenAICompatibleImageOptions): Promise<MediaBinaryResult>;
  createSpeech?(options: OpenAICompatibleSpeechOptions): Promise<MediaBinaryResult>;
  createMusic?(options: ElevenLabsMusicOptions | MiniMaxMusicOptions): Promise<MediaBinaryResult>;
  createSoundEffect?(options: ElevenLabsSoundEffectOptions): Promise<MediaBinaryResult>;
  createVideo?(request: MediaProviderJobRequest): Promise<MediaProviderJobHandle>;
  poll?(providerJobId: string, request: MediaProviderJobRequest): Promise<MediaProviderJobHandle>;
  cancel?(providerJobId: string, request: MediaProviderJobRequest): Promise<void>;
}

export interface OfficialMediaAdapterOptions {
  readonly providerId: string;
  readonly modelId: string;
  readonly endpoint: URL;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Explicit provider adapters. They intentionally expose only documented
 * operations; routing code must still gate these by live capability evidence.
 */
export function createElevenLabsAdapter(options: OfficialMediaAdapterOptions): MediaProviderAdapter {
  const supportsMusic = ["music_v1", "music_v2", "music_v2_5"].includes(options.modelId);
  const supportsSoundEffect = options.modelId === "eleven_text_to_sound_v2";
  const profile: MediaProviderProfile = {
    providerId: options.providerId, modelId: options.modelId, protocol: "elevenlabs",
    capabilities: [
      ...(supportsMusic ? [{ capability: "music_generation" as const, status: "supported" as const, source: "provider_metadata" as const, reason: "POST /v1/music" }] : []),
      ...(supportsSoundEffect ? [{ capability: "sound_effect_generation" as const, status: "supported" as const, source: "provider_metadata" as const, reason: "POST /v1/sound-generation" }] : []),
    ], updatedAt: new Date().toISOString(),
  };
  return {
    id: options.providerId, profile,
    ...(supportsMusic ? { createMusic: input => {
      if (input.model !== options.modelId) throw new MediaRuntimeError("MODEL_NOT_FOUND", mediaMessage("media.selected_music_model_does_not_match_the_adapter"), false);
      return requestElevenLabsMusic({ ...input as ElevenLabsMusicOptions, ...options, modelId: options.modelId as ElevenLabsMusicOptions["modelId"], endpoint: options.endpoint });
    } } : {}),
    ...(supportsSoundEffect ? { createSoundEffect: input => {
      if (input.model !== options.modelId) throw new MediaRuntimeError("MODEL_NOT_FOUND", mediaMessage("media.selected_sound_effect_model_does_not_match_the_adapter"), false);
      return requestElevenLabsSoundEffect({ ...input, ...options, endpoint: options.endpoint, modelId: "eleven_text_to_sound_v2" });
    } } : {}),
  };
}

export function createMiniMaxAdapter(options: OfficialMediaAdapterOptions): MediaProviderAdapter {
  const supportsMusic = ["music-3.0", "music-2.6"].includes(options.modelId);
  const profile: MediaProviderProfile = {
    providerId: options.providerId, modelId: options.modelId, protocol: "minimax",
    capabilities: supportsMusic ? [
      { capability: "music_generation", status: "supported", source: "provider_metadata", reason: "POST /v1/music_generation" },
    ] : [], updatedAt: new Date().toISOString(),
  };
  return {
    id: options.providerId, profile,
    ...(supportsMusic ? { createMusic: input => {
      if (input.model !== options.modelId) throw new MediaRuntimeError("MODEL_NOT_FOUND", mediaMessage("media.selected_music_model_does_not_match_the_adapter"), false);
      return requestMiniMaxMusic({ ...input as MiniMaxMusicOptions, ...options, endpoint: options.endpoint });
    } } : {}),
  };
}

export interface MediaProviderRegistry {
  get(providerId: string, modelId: string): MediaProviderAdapter | undefined;
  list(): readonly MediaProviderAdapter[];
}

export function providerSupports(
  profile: MediaProviderProfile,
  capability: MediaProviderCapability,
): boolean {
  return profile.capabilities.some(item => item.capability === capability && item.status === "supported");
}

export function providerCapabilityReason(
  profile: MediaProviderProfile,
  capability: MediaProviderCapability,
): string | undefined {
  return profile.capabilities.find(item => item.capability === capability)?.reason;
}

/** Unknown is intentionally not treated as supported. */
export function selectProviderAdapters(
  adapters: readonly MediaProviderAdapter[],
  capability: MediaProviderCapability,
): readonly MediaProviderAdapter[] {
  return adapters.filter(adapter => providerSupports(adapter.profile, capability));
}

export type MediaExecutionPlanStatus = "direct" | "fallback" | "blocked" | "local";

export interface MediaExecutionPlan {
  readonly kind: MediaJobKind;
  readonly capability?: MediaProviderCapability;
  readonly status: MediaExecutionPlanStatus;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly fallbackCapability?: MediaProviderCapability;
  readonly reason: string;
  readonly domain: "media";
  readonly messageKey: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

function planPresentation(messageKey: string): Pick<MediaExecutionPlan, "reason" | "domain" | "messageKey" | "params"> {
  const message = mediaMessage(messageKey);
  return { reason: message.message, domain: message.domain, messageKey, params: message.params };
}

function videoCapability(input: MediaVideoJobInput): MediaProviderCapability {
  if (input.sourceVideoUri && input.editStartSeconds !== undefined && input.editEndSeconds !== undefined) return "segment_edit";
  if (input.sourceVideoUri && input.editFrameSeconds !== undefined) return "frame_edit";
  if (input.firstFrameUri || input.lastFrameUri) return "first_last_frame";
  if (input.referenceAssetUris?.length) return "reference_to_video";
  return "text_to_video";
}

/**
 * Computes a provider-neutral execution plan before a paid request is made.
 * Unknown capabilities are blocked rather than guessed as supported.
 */
export function planMediaExecution(
  job: Pick<MediaJob, "kind" | "input">,
  adapters: readonly MediaProviderAdapter[],
): MediaExecutionPlan {
  if (job.kind === "subtitle" || job.kind === "shot_preview") {
    return { kind: job.kind, status: "local", ...planPresentation("media.plan_local") };
  }
  if (job.kind === "music") {
    const input = job.input as MediaAudioGenerationJobInput;
    const capability = input.mode === "cover" || input.referenceSong ? "cover" : input.vocalReference ? "vocal_reference" : "music_generation";
    const adapter = adapters.find(item => providerSupports(item.profile, "music_generation") && providerSupports(item.profile, capability));
    return adapter ? { kind: job.kind, capability, status: "direct", providerId: adapter.id, modelId: adapter.profile.modelId, ...planPresentation("media.plan_verified") }
      : { kind: job.kind, capability, status: "blocked", ...planPresentation("media.plan_music_unsupported") };
  }
  const capability: MediaProviderCapability = job.kind === "image"
    ? "text_to_image"
      : job.kind === "video"
        ? videoCapability(job.input as MediaVideoJobInput)
      : job.kind === "speech"
        ? "tts"
          : job.kind === "sound_effect"
            ? "sound_effect_generation"
            : "tts";
  const direct = adapters.find(adapter => providerSupports(adapter.profile, capability));
  if (direct) {
    return {
      kind: job.kind, capability, status: "direct", providerId: direct.id,
      modelId: direct.profile.modelId, ...planPresentation("media.plan_verified")
    };
  }
  if (job.kind === "video" && capability === "segment_edit") {
    const fallback = adapters.find(adapter => providerSupports(adapter.profile, "first_last_frame"));
    if (fallback) {
      return {
        kind: job.kind, capability, status: "fallback", providerId: fallback.id,
        modelId: fallback.profile.modelId, fallbackCapability: "first_last_frame",
        ...planPresentation("media.plan_segment_fallback")
      };
    }
  }
  if (job.kind === "video" && capability === "frame_edit") {
    const fallback = adapters.find(adapter => providerSupports(adapter.profile, "reference_to_video"));
    if (fallback) {
      return {
        kind: job.kind, capability, status: "fallback", providerId: fallback.id,
        modelId: fallback.profile.modelId, fallbackCapability: "reference_to_video",
        ...planPresentation("media.plan_frame_fallback")
      };
    }
  }
  if (job.kind === "video" && capability === "text_to_video") {
    const fallback = adapters.find(adapter => providerSupports(adapter.profile, "image_to_video"));
    if (fallback) {
      return {
        kind: job.kind, capability, status: "fallback", providerId: fallback.id,
        modelId: fallback.profile.modelId, fallbackCapability: "image_to_video",
        ...planPresentation("media.plan_image_required")
      };
    }
  }
  return {
    kind: job.kind, capability, status: "blocked",
    ...planPresentation("media.plan_blocked")
  };
}
