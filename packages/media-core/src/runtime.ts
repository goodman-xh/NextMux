import { mediaErrorMetadata, mediaMessage, type MediaErrorMessage, type MediaErrorParams } from "./error-metadata.js";
import { classifyModelError, formatPlatformMediaError, type ReadableModelError } from "@nextmux/model-runtime/errors";

const MAX_IMAGE_RESPONSE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_JSON_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_RESPONSE_BYTES * 4 / 3) + 1024 * 1024;
const MAX_AUDIO_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_AUDIO_JSON_RESPONSE_BYTES = MAX_AUDIO_RESPONSE_BYTES * 2 + 1024 * 1024;

export class MediaRuntimeError extends Error {
  readonly domain = "media" as const;
  readonly messageKey: string;
  readonly params: MediaErrorParams;
  readonly readableError: ReadableModelError;
  readonly data: { readonly readableError: ReadableModelError };
  constructor(
    readonly code: string,
    message: string | MediaErrorMessage,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
    providerFailure?: unknown,
  ) {
    const metadata = mediaErrorMetadata(code, message, providerFailure);
    super(metadata.message);
    this.name = "MediaRuntimeError";
    this.messageKey = metadata.messageKey;
    this.params = metadata.params;
    this.readableError = { ...metadata.readableError, ...(retryAfterMs === undefined ? {} : { retryAfterSeconds: Math.ceil(retryAfterMs / 1_000) }) };
    this.data = { readableError: this.readableError };
  }
}

export interface MediaBinaryResult {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly extension: string;
  /** Provider-returned evidence; never inferred from requested duration. */
  readonly providerEvidence?: {
    readonly providerRequestId?: string;
    readonly durationMs?: number;
    readonly characterCost?: number;
  };
}

interface RemoteMediaOptions {
  readonly endpoint: URL;
  readonly apiKey: string;
  readonly model: string;
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface OpenAICompatibleImageOptions extends RemoteMediaOptions {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  /** Frozen new-job contract; absent legacy jobs keep imageSizeForCanvas. */
  readonly nativeImageSizeContract?: "seedream45_v1";
  /** Character pictures as data URLs, transmitted by the selected image adapter. */
  readonly references?: readonly string[];
}

export interface GeminiImageOptions extends RemoteMediaOptions {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  /** Character pictures as data URLs, sent as inline image parts before the prompt. */
  readonly references?: readonly string[];
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/;

/** References must all reach the model; never silently drop or truncate them. */
function imageReferences(references: readonly string[] | undefined): readonly string[] {
  if (references === undefined) return [];
  if (!Array.isArray(references) || references.length > 4 || references.some(value => typeof value !== "string" || !DATA_URL.test(value))) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.invalid_field", { label: "references" }), false);
  }
  return references;
}

export interface OpenAICompatibleSpeechOptions extends RemoteMediaOptions {
  readonly text: string;
  readonly voice: string;
  readonly format: "mp3" | "wav";
}

export interface ElevenLabsMusicOptions extends RemoteMediaOptions {
  readonly modelId?: "music_v1" | "music_v2" | "music_v2_5";
  readonly prompt: string;
  readonly lyrics?: string;
  readonly instrumental?: boolean;
  readonly durationSeconds?: number;
  readonly format: "mp3" | "wav";
}

export interface ElevenLabsSoundEffectOptions extends RemoteMediaOptions {
  readonly text: string;
  readonly durationSeconds?: number;
  readonly format: "mp3" | "wav";
  readonly modelId?: "eleven_text_to_sound_v2";
}

export interface MiniMaxMusicOptions extends RemoteMediaOptions {
  readonly prompt: string;
  readonly lyrics?: string;
  readonly instrumental?: boolean;
}

function timeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value as number) >= 1_000 && (value as number) <= 600_000
    ? value as number
    : 300_000;
}

function boundedHeader(value: string, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\r\n\0]/.test(value)) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.invalid_field", { label: label }), false);
  }
  return value;
}

async function readLimitedBytes(response: Response, maximum: number, signal?: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new MediaRuntimeError("RESPONSE_TOO_LARGE", mediaMessage("media.media_response_exceeds_the_size_limit"), false);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const abort = (): void => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { done, value } = await reader.read();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new MediaRuntimeError("RESPONSE_TOO_LARGE", mediaMessage("media.media_response_exceeds_the_size_limit"), false);
    }
    chunks.push(value);
  }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function responseError(status: number, retryAfterMs?: number): MediaRuntimeError {
  const retry = retryAfterMs === undefined ? [] : [retryAfterMs];
  if (status === 401 || status === 403) return new MediaRuntimeError("AUTH_FAILED", mediaMessage("media.api_key_or_media_model_access_was_denied"), false);
  if (status === 404) return new MediaRuntimeError("MODEL_NOT_FOUND", mediaMessage("media.media_api_endpoint_or_model_id_was_not_found"), false);
  if (status === 408) return new MediaRuntimeError("UPSTREAM_TIMEOUT", mediaMessage("media.media_service_request_timed_out"), true, ...retry);
  if (status === 409) return new MediaRuntimeError("UPSTREAM_CONFLICT", mediaMessage("media.media_service_rejected_a_duplicate_request"), true, ...retry);
  if (status === 429) return new MediaRuntimeError("RATE_LIMITED", mediaMessage("media.media_service_is_rate_limited_or_the_account_balance_is_insufficient"), true, ...retry);
  if (status >= 500) return new MediaRuntimeError("UPSTREAM_UNAVAILABLE", mediaMessage("media.media_service_is_temporarily_unavailable"), true, ...retry);
  return new MediaRuntimeError("REQUEST_REJECTED", mediaMessage("media.media_service_rejected_the_request_check_the_model_dimensions_and_account_permissions"), false);
}

function retryAfterMs(response: Response, now = Date.now()): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Math.min(300_000, Number(value) * 1_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(300_000, Math.max(0, timestamp - now));
}

/** A request body with a few character portraits as data URLs (compressed JPEG, about 0.3–1 MB each) fits easily. */
const MAX_MEDIA_REQUEST_BYTES = 24 * 1024 * 1024;

async function post(
  options: RemoteMediaOptions,
  body: unknown,
  accept: string,
  maximum: number,
  authentication: "bearer" | "gemini" | "eleven" = "bearer",
): Promise<{ readonly response: Response; readonly bytes: Uint8Array }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  // The body is checked before any timer or abort listener exists, so a refused request leaves nothing behind (audit A21-09).
  let serialized: string | FormData;
  try {
    serialized = body instanceof FormData ? body : JSON.stringify(body);
  } catch {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.media_request_cannot_be_serialized"), false);
  }
  // Prompts are bounded where they are built; this caps the whole body, reference pictures (data URLs) included.
  // FormData uses the fetch implementation's boundary. A conservative per-part allowance bounds
  // its headers/boundaries before any paid dispatch, without serializing files as strings.
  const requestBytes = typeof serialized === "string" ? Buffer.byteLength(serialized, "utf8")
    : Array.from(serialized.entries()).reduce((total, [name, value]) => total + Buffer.byteLength(name, "utf8")
      + (typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.size) + 1_024, 1_024);
  if (requestBytes > MAX_MEDIA_REQUEST_BYTES) {
    throw new MediaRuntimeError("REQUEST_TOO_LARGE", mediaMessage("media.media_request_exceeds_the_size_limit"), false);
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout(options.timeoutMs));
  if (options.signal?.aborted) {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    throw new MediaRuntimeError("CANCELLED", mediaMessage("media.media_job_was_cancelled"), false);
  }
  // Once a generation request may have reached the provider, a lost answer is not a failure that can be retried:
  // the task may already be running and billed there (audit B03-01).
  let answered = false;
  try {
    const response = await fetchImpl(options.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        accept,
        ...(typeof serialized === "string" ? { "content-type": "application/json" } : {}),
        "idempotency-key": boundedHeader(options.idempotencyKey, "idempotencyKey", 160),
        ...(authentication === "gemini"
          ? { "x-goog-api-key": boundedHeader(options.apiKey, "API Key", 8_192) }
          : authentication === "eleven"
            ? { "xi-api-key": boundedHeader(options.apiKey, "API Key", 8_192) }
          : { authorization: `Bearer ${boundedHeader(options.apiKey, "API Key", 8_192)}` }),
      },
      body: serialized,
      signal: controller.signal,
    });
    answered = true;
    const bytes = await readLimitedBytes(response, maximum, controller.signal);
    if (!response.ok) {
      const base = responseError(response.status, retryAfterMs(response));
      throw new MediaRuntimeError(base.code, mediaMessage(base.messageKey, base.params), base.retryable, base.retryAfterMs,
        { status: response.status, body: new TextDecoder().decode(bytes), retryAfterMs: retryAfterMs(response) });
    }
    return { response, bytes };
  } catch (error) {
    if (error instanceof MediaRuntimeError) throw error;
    if (error instanceof Error && error.name === "AbortError" && options.signal?.aborted && !timedOut && !answered) {
      throw new MediaRuntimeError("CANCELLED", mediaMessage("media.media_job_was_cancelled"), false);
    }
    if (answered || !requestNeverSent(error)) {
      throw new MediaRuntimeError("MEDIA_SUBMISSION_UNKNOWN", {
        domain: "media", messageKey: "platform_media.submission_unknown", params: {},
        message: formatPlatformMediaError("platform_media.submission_unknown") ?? "The provider did not answer the generation request.",
      }, false);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new MediaRuntimeError("TIMEOUT", mediaMessage("media.media_service_connection_timed_out"), true);
    }
    throw new MediaRuntimeError("CONNECTION_FAILED", mediaMessage("media.cannot_connect_to_the_media_service"), true);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/** A connection that never opened (no name, refused, unreachable, bad certificate): the request was not delivered. */
function requestNeverSent(error: unknown): boolean {
  const codes: string[] = [];
  for (let current = error as { code?: unknown; cause?: unknown } | undefined, depth = 0; current && depth < 5; current = current.cause as typeof current, depth++) {
    if (typeof current.code === "string") codes.push(current.code);
  }
  return codes.some(code => ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL", "UND_ERR_CONNECT_TIMEOUT",
    "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code));
}

function strictBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || !value || value.length > Math.ceil(MAX_IMAGE_RESPONSE_BYTES * 4 / 3) + 8
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new MediaRuntimeError("INVALID_IMAGE_RESPONSE", mediaMessage("media.image_service_did_not_return_valid_base64_data"), false);
  }
  const buffer = Buffer.from(value, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_RESPONSE_BYTES) {
    throw new MediaRuntimeError("INVALID_IMAGE_RESPONSE", mediaMessage("media.image_data_is_empty_or_exceeds_the_size_limit"), false);
  }
  return new Uint8Array(buffer);
}

export function detectImage(bytes: Uint8Array): Omit<MediaBinaryResult, "bytes"> {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  throw new MediaRuntimeError("UNSUPPORTED_IMAGE", mediaMessage("media.image_service_returned_an_unsupported_file_format"), false);
}

export function detectAudio(bytes: Uint8Array): Omit<MediaBinaryResult, "bytes"> {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WAVE") {
    return { mimeType: "audio/wav", extension: "wav" };
  }
  if (bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === "OggS") {
    return { mimeType: "audio/ogg", extension: "ogg" };
  }
  if (bytes.length >= 3 && String.fromCharCode(...bytes.slice(0, 3)) === "ID3") {
    return { mimeType: "audio/mpeg", extension: "mp3" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return { mimeType: "audio/mpeg", extension: "mp3" };
  }
  throw new MediaRuntimeError("UNSUPPORTED_AUDIO", mediaMessage("media.speech_service_returned_an_unsupported_file_format"), false);
}

/** Official Seedream 4.5 2K dimensions intersected with the fixed canvas menu.
 * 4K non-square shapes exceed the relay's documented 4096 side boundary. */
export function openAIImageOutputVariants(modelId: string): readonly {
  readonly id: string; readonly resolution: string; readonly aspectRatios: readonly string[];
  readonly defaultAspectRatio: string; readonly dimensions: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
}[] {
  if (modelId === "doubao-seedream-4-5-251128") return [
    { id: "seedream45-2k", resolution: "2K", aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"], defaultAspectRatio: "1:1",
      dimensions: { "1:1": { width: 2048, height: 2048 }, "4:3": { width: 2304, height: 1728 }, "3:4": { width: 1728, height: 2304 },
        "16:9": { width: 2848, height: 1600 }, "9:16": { width: 1600, height: 2848 } } },
    { id: "seedream45-4k", resolution: "4K", aspectRatios: ["1:1"], defaultAspectRatio: "1:1", dimensions: { "1:1": { width: 4096, height: 4096 } } }
  ];
  // This existing adapter sends exactly these three sizes; it cannot claim arbitrary aspect output.
  return [{ id: "openai-default-1k", resolution: "1K", aspectRatios: ["1:1", "3:2", "2:3"], defaultAspectRatio: "1:1",
    dimensions: { "1:1": { width: 1024, height: 1024 }, "3:2": { width: 1536, height: 1024 }, "2:3": { width: 1024, height: 1536 } } }];
}

function nativeImageRequestSize(contract: "seedream45_v1", modelId: string, width: number, height: number): string {
  if (contract !== "seedream45_v1" || modelId !== "doubao-seedream-4-5-251128"
    || !openAIImageOutputVariants(modelId).some(variant => Object.values(variant.dimensions).some(size => size.width === width && size.height === height))) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.image_prompt_is_invalid"), false);
  }
  return width + "x" + height;
}

export function imageSizeForCanvas(width: number, height: number): "1024x1024" | "1536x1024" | "1024x1536" {
  const ratio = width / height;
  if (ratio > 1.2) return "1536x1024";
  if (ratio < 0.84) return "1024x1536";
  return "1024x1024";
}

export function imageAspectRatio(width: number, height: number): "1:1" | "16:9" | "9:16" {
  const ratio = width / height;
  if (ratio > 1.2) return "16:9";
  if (ratio < 0.84) return "9:16";
  return "1:1";
}

/** Only the GPT Image identities explicitly listed by the Images edit API grant native editing.
 * Relays may reject a listed model for account access; unknown aliases do not inherit support. */
export function openAIImageEditModelSupported(modelId: string): boolean {
  return ["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5", "gpt-image-2", "gpt-image-2-2026-04-21",
    "gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-2026-09-08", "gpt-image-2.5-flare",
    "gpt-image-2.5-flare-2026-09-08", "chatgpt-image-latest"].includes(modelId);
}

export async function requestOpenAICompatibleImage(
  options: OpenAICompatibleImageOptions,
): Promise<MediaBinaryResult> {
  const references = imageReferences(options.references);
  if (references.length && (!openAIImageEditModelSupported(options.model) || !options.endpoint.pathname.endsWith("/images/edits"))) {
    throw new MediaRuntimeError("IMAGE_REFERENCE_UNSUPPORTED", mediaMessage("media.plan_blocked"), false);
  }
  const prompt = options.negativePrompt?.trim()
    ? `${options.prompt.trim()}\n\nAvoid: ${options.negativePrompt.trim()}`
    : options.prompt.trim();
  if (!prompt || prompt.length > 30_000) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.image_prompt_is_invalid"), false);
  }
  const fields = {
    model: boundedHeader(options.model, "model", 200),
    prompt,
    n: 1,
    size: options.nativeImageSizeContract === undefined ? imageSizeForCanvas(options.width, options.height)
      : nativeImageRequestSize(options.nativeImageSizeContract, options.model, options.width, options.height),
  };
  let body: unknown = { ...fields, ...(openAIImageEditModelSupported(options.model) ? {} : { response_format: "b64_json" }) };
  if (references.length) {
    // GPT Image edits use the SDK-compatible multipart image file(s), not generation JSON.
    // Their response is base64 by default; response_format is not a GPT Image edit parameter.
    // Keep the existing bounded inline-reference budget before allocating decoded files.
    if (references.reduce((total, reference) => total + Buffer.byteLength(reference, "utf8"), Buffer.byteLength(prompt, "utf8")) > MAX_MEDIA_REQUEST_BYTES) {
      throw new MediaRuntimeError("REQUEST_TOO_LARGE", mediaMessage("media.media_request_exceeds_the_size_limit"), false);
    }
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, String(value));
    for (const [index, reference] of references.entries()) {
      const match = DATA_URL.exec(reference)!;
      const extension = match[1] === "image/jpeg" ? "jpg" : match[1].slice("image/".length);
      let image: Uint8Array;
      try {
        image = strictBase64(match[2]);
        if (detectImage(image).mimeType !== match[1]) throw new Error("Reference type mismatch");
      } catch {
        throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.invalid_field", { label: "references" }), false);
      }
      form.append(references.length === 1 ? "image" : "image[]", new Blob([Uint8Array.from(image)], { type: match[1] }), `reference-${index + 1}.${extension}`);
    }
    body = form;
  }
  const { bytes } = await post(options, body, "application/json", MAX_IMAGE_JSON_RESPONSE_BYTES);
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MediaRuntimeError("INVALID_IMAGE_RESPONSE", mediaMessage("media.image_service_returned_invalid_data"), false);
  }
  if (payload?.error) throw new MediaRuntimeError("REQUEST_REJECTED", mediaMessage("media.image_service_rejected_the_request"), false, undefined, payload);
  const encoded = payload?.data?.[0]?.b64_json ?? payload?.data?.[0]?.b64;
  if (!encoded && payload?.data?.[0]?.url) {
    throw new MediaRuntimeError(
      "URL_IMAGE_UNSUPPORTED",
      mediaMessage("media.image_service_returned_an_external_url_enable_base64_output_to_avoid_downloading_from_an_unexpected_address"),
      false,
    );
  }
  const image = strictBase64(encoded);
  const detected = detectImage(image);
  return { bytes: image, ...detected };
}

/** The closest ratio a provider accepts for a canvas (e.g. 1080×1920 → "9:16"). */
export function nearestAspectRatio(width: number, height: number, allowed: readonly string[] = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"]): string {
  const target = width > 0 && height > 0 ? width / height : 1;
  const value = (ratio: string): number => { const [w, h] = ratio.split(":").map(Number); return w / h; };
  return [...allowed].sort((left, right) => Math.abs(Math.log(value(left) / target)) - Math.abs(Math.log(value(right) / target)))[0] ?? "1:1";
}

/**
 * OpenRouter's image router (POST {base}/images): it takes an aspect ratio rather than a pixel
 * size and returns base64 bytes with their media type.
 */
export async function requestOpenRouterImage(
  options: OpenAICompatibleImageOptions,
): Promise<MediaBinaryResult> {
  const prompt = options.negativePrompt?.trim()
    ? `${options.prompt.trim()}\n\nAvoid: ${options.negativePrompt.trim()}`
    : options.prompt.trim();
  if (!prompt || prompt.length > 30_000) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.image_prompt_is_invalid"), false);
  }
  const references = imageReferences(options.references);
  const { bytes } = await post(options, {
    model: boundedHeader(options.model, "model", 200),
    prompt: references.length ? `${prompt}\n\nKeep every character exactly as in the reference pictures: same face, hairstyle, body and outfit.` : prompt,
    aspect_ratio: nearestAspectRatio(options.width, options.height),
    ...(references.length ? { input_references: references.map(url => ({ type: "image_url", image_url: { url } })) } : {}),
  }, "application/json", MAX_IMAGE_JSON_RESPONSE_BYTES);
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MediaRuntimeError("INVALID_IMAGE_RESPONSE", mediaMessage("media.image_service_returned_invalid_data"), false);
  }
  if (payload?.error) throw new MediaRuntimeError("REQUEST_REJECTED", mediaMessage("media.image_service_rejected_the_request"), false, undefined, payload);
  const image = strictBase64(payload?.data?.[0]?.b64_json);
  return { bytes: image, ...detectImage(image) };
}

export async function requestGeminiImage(
  options: GeminiImageOptions,
): Promise<MediaBinaryResult> {
  const prompt = options.negativePrompt?.trim()
    ? `${options.prompt.trim()}\n\nAvoid: ${options.negativePrompt.trim()}`
    : options.prompt.trim();
  if (!prompt || prompt.length > 30_000) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.image_prompt_is_invalid"), false);
  }
  const inline = imageReferences(options.references).map(url => url.match(DATA_URL)!)
    .map(match => ({ inlineData: { mimeType: match[1], data: match[2] } }));
  const { bytes } = await post(options, {
    contents: [{ role: "user", parts: [...inline, { text: inline.length ? `${prompt}\n\nKeep every character exactly as in the reference pictures: same face, hairstyle, body and outfit.` : prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: imageAspectRatio(options.width, options.height) },
    },
  }, "application/json", MAX_IMAGE_JSON_RESPONSE_BYTES, "gemini");
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MediaRuntimeError("INVALID_IMAGE_RESPONSE", mediaMessage("media.image_service_returned_invalid_data"), false);
  }
  const refusal = classifyModelError(payload, { source: "own_api" });
  if (payload?.error || refusal.kind === "content_refused" || refusal.kind === "output_too_long") {
    throw new MediaRuntimeError("REQUEST_REJECTED", mediaMessage("media.image_service_rejected_the_request"), false, undefined, refusal);
  }
  const parts = Array.isArray(payload?.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
    : [];
  const output = parts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data);
  const inlineData = output?.inlineData ?? output?.inline_data;
  const image = strictBase64(inlineData?.data);
  const detected = detectImage(image);
  return { bytes: image, ...detected };
}

export async function requestOpenAICompatibleSpeech(
  options: OpenAICompatibleSpeechOptions,
): Promise<MediaBinaryResult> {
  const text = options.text.trim();
  if (!text || text.length > 20_000) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.speech_text_is_invalid"), false);
  }
  // Gemini TTS (also through OpenRouter) answers only with raw PCM and knows only its own voices.
  const pcm = pcmOnlySpeechModel(options.model);
  const voice = pcm ? geminiSpeechVoice(options.voice) : options.voice;
  const request = (format: string) => post(options, {
    model: boundedHeader(options.model, "model", 200),
    input: text,
    voice: boundedHeader(voice, "voice", 100),
    response_format: format,
  }, "audio/*,application/octet-stream", MAX_AUDIO_RESPONSE_BYTES);
  // A provider error does not prove a generation was free. A format change needs a fresh user request.
  const result = await request(pcm ? "pcm" : options.format);
  if (!pcm) return { bytes: result.bytes, ...detectAudio(result.bytes) };
  if (result.bytes.length >= 12 && String.fromCharCode(...result.bytes.slice(0, 4)) === "RIFF") return { bytes: result.bytes, ...detectAudio(result.bytes) };
  if (result.bytes.length < 2 || result.bytes.length % 2) {
    throw new MediaRuntimeError("INVALID_AUDIO_RESPONSE", mediaMessage("media.speech_service_returned_an_unsupported_file_format"), false);
  }
  const rate = Number(/rate=(\d{4,6})/i.exec(result.response.headers.get("content-type") || "")?.[1]) || 24_000;
  return { bytes: pcmToWav(result.bytes, rate), mimeType: "audio/wav", extension: "wav" };
}

/** Gemini's prebuilt voices; an OpenAI voice name is answered with "Provider returned 400". */
const GEMINI_SPEECH_VOICES = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus",
  "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima",
  "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"];
/** The OpenAI voices the app offers, each paired with a Gemini voice of similar character. */
const OPENAI_TO_GEMINI_VOICE: Readonly<Record<string, string>> = { alloy: "Kore", echo: "Charon", fable: "Puck", onyx: "Fenrir", nova: "Aoede",
  shimmer: "Leda", coral: "Callirrhoe", sage: "Orus", ash: "Iapetus", ballad: "Algieba", verse: "Achird" };

export function geminiSpeechVoice(voice: string): string {
  const name = voice.trim().toLowerCase();
  return GEMINI_SPEECH_VOICES.find(candidate => candidate.toLowerCase() === name) ?? OPENAI_TO_GEMINI_VOICE[name] ?? "Kore";
}

/** Gemini's speech models return 16-bit PCM only (OpenRouter ids look like "google/gemini-3.8-flash-tts"). */
function pcmOnlySpeechModel(model: string): boolean {
  return /(?:^|\/)gemini[^/]*-tts\b/i.test(model);
}

/** Raw 16-bit little-endian mono PCM wrapped in a WAV header, so players, the timeline and ffmpeg can read it. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24_000, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const text = (offset: number, value: string): void => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, "RIFF"); view.setUint32(4, 36 + pcm.length, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

function audioFormatParameter(format: "mp3" | "wav"): string {
  // The native adapters persist MP3 files.  PCM responses are raw samples and
  // cannot be labelled as WAV without a container header, so reject WAV at
  // the request boundary instead of silently producing a corrupt asset.
  if (format !== "mp3") {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.native_music_adapters_require_mp3_output"), false);
  }
  return "mp3_44100_128";
}

function boundedAudioDuration(value: number | undefined, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.audio_duration_is_invalid"), false);
  }
  return value;
}

function providerErrorFromJson(payload: any): MediaRuntimeError {
  const status = Number(payload?.base_resp?.status_code);
  return new MediaRuntimeError(status === 429 ? "RATE_LIMITED" : "REQUEST_REJECTED", mediaMessage("media.music_service_rejected_the_request"), status === 429, undefined, payload);
}

export interface ChatAudioMusicOptions extends RemoteMediaOptions {
  readonly prompt: string;
  readonly lyrics?: string;
  readonly instrumental?: boolean;
  readonly format: "mp3" | "wav";
}

function audioBase64(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, "");
  if (!clean || clean.length > Math.ceil(MAX_AUDIO_RESPONSE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new MediaRuntimeError("INVALID_AUDIO_RESPONSE", mediaMessage("media.music_service_did_not_return_valid_audio_data"), false);
  }
  return new Uint8Array(Buffer.from(clean, "base64"));
}

/** The request text a music model reads: the style, then “no vocals” or the exact lyrics. */
export function chatMusicPrompt(input: { readonly prompt: string; readonly lyrics?: string; readonly instrumental?: boolean }): string {
  return [
    input.prompt.trim(),
    input.instrumental ? "Instrumental only, no vocals." : "",
    !input.instrumental && input.lyrics?.trim() ? `Use exactly these lyrics (section tags such as [Verse] and [Chorus] mark the structure):\n${input.lyrics.trim()}` : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * Music from an OpenAI-compatible chat-completions endpoint that answers with audio (OpenRouter's
 * Lyria and relays that pass it through): `modalities: ["text","audio"]`, streamed. The audio arrives
 * as base64 chunks in `choices[].delta.audio.data` (each its own segment) or a whole `message.audio`.
 */
export async function requestChatAudioMusic(options: ChatAudioMusicOptions): Promise<MediaBinaryResult & { readonly lyrics?: string }> {
  const prompt = chatMusicPrompt(options);
  if (!options.prompt.trim() || prompt.length > 8_000) throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.music_prompt_or_lyrics_are_invalid"), false);
  const { response, bytes } = await post(options, {
    model: boundedHeader(options.model, "model", 200),
    messages: [{ role: "user", content: prompt }],
    modalities: ["text", "audio"],
    audio: { format: options.format },
    stream: true,
  }, "text/event-stream,application/json", MAX_AUDIO_JSON_RESPONSE_BYTES);
  const text = new TextDecoder().decode(bytes);
  const pieces: string[] = [];
  const words: string[] = [];
  let streamFailure: unknown;
  let completed = false;
  let done = false;
  let malformed = false;
  const audioChoices = new Set<number>();
  const finishedChoices = new Set<number>();
  const collect = (payload: any): void => {
    if (payload?.error) streamFailure = payload;
    for (const [position, choice] of (Array.isArray(payload?.choices) ? payload.choices : []).entries()) {
      const index = Number.isInteger(choice?.index) ? choice.index : position;
      if (choice?.error) streamFailure = { error: choice.error };
      if (choice?.finish_reason != null) {
        if (choice.finish_reason === "stop") { completed = true; finishedChoices.add(index); }
        else streamFailure = { error: choice.error || { code: choice.finish_reason, message: "Music generation did not complete" } };
      }
      const holder = choice?.delta || choice?.message || {};
      if (typeof holder.audio?.data === "string" && holder.audio.data) { pieces.push(holder.audio.data); audioChoices.add(index); }
      if (typeof holder.audio?.transcript === "string") words.push(holder.audio.transcript);
    }
  };
  if ((response.headers.get("content-type") || "").includes("event-stream") || /^\s*data:/m.test(text)) {
    const events = text.split(/\r?\n\r?\n/);
    const unfinished = events.pop();
    if (unfinished?.trim()) malformed = true; // SSE dispatch requires the blank-line event terminator.
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      if (!data) continue;
      if (data === "[DONE]") { completed = true; done = true; continue; }
      try { collect(JSON.parse(data)); } catch { malformed = true; }
    }
  } else {
    try { collect(JSON.parse(text)); } catch { throw new MediaRuntimeError("INVALID_AUDIO_RESPONSE", mediaMessage("media.music_service_returned_invalid_data"), false); }
  }
  if (streamFailure) throw new MediaRuntimeError("REQUEST_REJECTED", mediaMessage("media.music_service_rejected_the_request"), false, undefined, streamFailure);
  if (!pieces.length) throw new MediaRuntimeError("INVALID_AUDIO_RESPONSE", mediaMessage("media.music_service_returned_no_audio"), false);
  if (!completed || malformed || !done && [...audioChoices].some(index => !finishedChoices.has(index))) {
    throw new MediaRuntimeError("AUDIO_RESULT_INCOMPLETE", mediaMessage("media.music_response_was_incomplete_review_the_original_request_before_generating_again"), false);
  }
  const chunks = pieces.map(piece => audioBase64(piece.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "")));
  const audio = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
  if (audio.byteLength > MAX_AUDIO_RESPONSE_BYTES) throw new MediaRuntimeError("RESPONSE_TOO_LARGE", mediaMessage("media.media_response_exceeds_the_size_limit"), false);
  const detected = detectAudio(audio);
  const lyrics = words.join("").trim();
  return { bytes: audio, ...detected, ...(lyrics ? { lyrics: lyrics.slice(0, 20_000) } : {}) };
}

/**
 * Official contract checked 2026-09-28:
 * https://elevenlabs.io/docs/api-reference/music/compose — prompt and composition_plan are exclusive;
 * force_instrumental and music_length_ms apply only to prompt mode.
 * v1 uses positive_global_styles/negative_global_styles/sections with section_name and lines.
 * https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans — v2/v2.5 use
 * chunks[].text for section labels and lyric lines, 3–120 seconds per chunk (up to 30 chunks).
 */
export async function requestElevenLabsMusic(options: ElevenLabsMusicOptions): Promise<MediaBinaryResult> {
  if (!["music_v1", "music_v2", "music_v2_5"].includes(options.model) || options.modelId && options.modelId !== options.model) {
    throw new MediaRuntimeError("MODEL_NOT_FOUND", mediaMessage("media.selected_music_model_does_not_match_the_native_protocol"), false);
  }
  const prompt = options.prompt.trim();
  const lyrics = options.lyrics?.trim();
  if (!prompt || prompt.length > 4_100 || (lyrics && lyrics.length > 3_500)) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.music_prompt_or_lyrics_are_invalid"), false);
  }
  const durationSeconds = boundedAudioDuration(options.durationSeconds, 3, 600);
  if (lyrics && options.instrumental) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.fixed_lyrics_cannot_be_combined_with_instrumental_mode"), false);
  }
  let compositionPlan: object | undefined;
  if (lyrics) {
    const sections = lyrics.split(/\n(?=\s*\[[^\]\n]+\])/).map(section => section.trim()).filter(Boolean);
    const durationMs = Math.round((durationSeconds ?? 30) * 1_000);
    const sectionMs = Math.floor(durationMs / sections.length);
    if (sections.length > 30 || sectionMs < 3_000 || Math.ceil(durationMs / sections.length) > 120_000) {
      throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.lyrics_support_at_most_30_sections_lasting_3_to_120_seconds_each"), false);
    }
    const chunks = sections.map((text, index) => ({
      text, duration_ms: sectionMs + (index < durationMs % sections.length ? 1 : 0),
      positive_styles: [prompt], negative_styles: [],
    }));
    for (const chunk of chunks) {
      const label = /^\[([^\]\n]+)\]\s*/.exec(chunk.text);
      const lines = chunk.text.slice(label?.[0].length || 0).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if ((label?.[1].length || 0) > 100 || lines.length > 30 || lines.some(line => line.length > 200)) {
        throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.lyric_section_names_line_counts_or_individual_lines_exceed_the_provider_limit"), false);
      }
    }
    compositionPlan = options.model === "music_v1" ? {
      positive_global_styles: [prompt], negative_global_styles: [],
      sections: chunks.map((chunk, index) => {
        const label = /^\[([^\]\n]+)\]\s*/.exec(chunk.text);
        const lines = chunk.text.slice(label?.[0].length || 0).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        return { section_name: label?.[1] || `Section ${index + 1}`, positive_local_styles: [], negative_local_styles: [],
          duration_ms: chunk.duration_ms, lines };
      }),
    } : { chunks };
  }
  const endpoint = new URL(options.endpoint.toString());
  endpoint.searchParams.set("output_format", audioFormatParameter(options.format));
  const { response, bytes } = await post({ ...options, endpoint }, {
    model_id: options.model,
    ...(compositionPlan ? { composition_plan: compositionPlan } : {
      prompt, force_instrumental: options.instrumental === true,
      ...(durationSeconds === undefined ? {} : { music_length_ms: Math.round(durationSeconds * 1_000) }),
    }),
  }, "audio/*,application/octet-stream", MAX_AUDIO_RESPONSE_BYTES, "eleven");
  const detected = detectAudio(bytes);
  const rawCost = response.headers.get("character-cost");
  const cost = rawCost === null ? Number.NaN : Number(rawCost);
  const providerRequestId = response.headers.get("song-id") ?? response.headers.get("request-id");
  return { bytes, ...detected, providerEvidence: {
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(Number.isSafeInteger(cost) && cost >= 0 ? { characterCost: cost } : {}),
  } };
}

/** ElevenLabs Text to Sound Effects API (POST /v1/sound-generation). */
export async function requestElevenLabsSoundEffect(options: ElevenLabsSoundEffectOptions): Promise<MediaBinaryResult> {
  if (options.model !== "eleven_text_to_sound_v2" || options.modelId && options.modelId !== options.model) {
    throw new MediaRuntimeError("MODEL_NOT_FOUND", mediaMessage("media.selected_sound_effect_model_does_not_match_the_native_protocol"), false);
  }
  const text = options.text.trim();
  if (!text || text.length > 450) throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.sound_effect_description_is_invalid"), false);
  const durationSeconds = boundedAudioDuration(options.durationSeconds, 0.5, 30);
  const endpoint = new URL(options.endpoint.toString());
  endpoint.searchParams.set("output_format", audioFormatParameter(options.format));
  const { response, bytes } = await post({ ...options, endpoint }, {
    text,
    ...(durationSeconds === undefined ? {} : { duration_seconds: durationSeconds }),
    model_id: options.model,
  }, "audio/*,application/octet-stream", MAX_AUDIO_RESPONSE_BYTES, "eleven");
  const detected = detectAudio(bytes);
  const rawCost = response.headers.get("character-cost");
  const cost = rawCost === null ? Number.NaN : Number(rawCost);
  const providerRequestId = response.headers.get("request-id");
  return { bytes, ...detected, providerEvidence: {
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(Number.isSafeInteger(cost) && cost >= 0 ? { characterCost: cost } : {}),
  } };
}

function strictHex(value: unknown): Uint8Array {
  if (typeof value !== "string" || !value || value.length % 2 !== 0 || value.length > MAX_AUDIO_RESPONSE_BYTES * 2 || !/^[0-9a-f]+$/i.test(value)) {
    throw new MediaRuntimeError("INVALID_AUDIO_RESPONSE", mediaMessage("media.music_service_did_not_return_valid_audio_data"), false);
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** MiniMax Music Generation API (POST /v1/music_generation), hex output only. */
export async function requestMiniMaxMusic(options: MiniMaxMusicOptions): Promise<MediaBinaryResult> {
  // The official free endpoints were discontinued on 2026-08-20. Cover models
  // require a separate reference-audio workflow and are not text-to-music.
  if (!["music-3.0", "music-2.6"].includes(options.model)) {
    throw new MediaRuntimeError("MODEL_NOT_FOUND", mediaMessage("media.selected_music_model_does_not_support_native_generation"), false);
  }
  const prompt = options.prompt.trim();
  const lyrics = options.lyrics?.trim();
  if (!prompt || prompt.length > 2_000 || (lyrics && lyrics.length > 3_500)) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.music_prompt_or_lyrics_are_invalid"), false);
  }
  const { bytes } = await post(options, {
    model: boundedHeader(options.model, "model", 200),
    prompt,
    ...(lyrics ? { lyrics } : {}),
    ...(options.instrumental === undefined ? {} : { is_instrumental: options.instrumental }),
    output_format: "hex",
    audio_setting: { format: "mp3" },
  }, "application/json", MAX_AUDIO_JSON_RESPONSE_BYTES);
  let payload: any;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new MediaRuntimeError("INVALID_AUDIO_RESPONSE", mediaMessage("media.music_service_returned_invalid_data"), false); }
  if (Number(payload?.base_resp?.status_code || 0) !== 0) throw providerErrorFromJson(payload);
  const audio = strictHex(payload?.data?.audio);
  const durationMs = Number(payload?.extra_info?.music_duration);
  const detected = detectAudio(audio);
  return { bytes: audio, ...detected, providerEvidence: {
    ...(payload?.trace_id ? { providerRequestId: String(payload.trace_id).slice(0, 200) } : {}),
    ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
  } };
}
