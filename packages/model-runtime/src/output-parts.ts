import { OfficialModelError } from "./http.js";
import { hasSafeImageDimensions } from "./image-dimensions.js";
import type { OfficialModelClientOptions, OfficialModelOutputPart, OfficialModelUsage } from "./types.js";

export const MODEL_OUTPUT_MAX_PARTS = 64;
export const MODEL_OUTPUT_MAX_MEDIA = 16;
export const MODEL_OUTPUT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MODEL_OUTPUT_MAX_AUDIO_BYTES = 24 * 1024 * 1024;
export const MODEL_OUTPUT_MAX_MEDIA_BYTES = 32 * 1024 * 1024;
export const MODEL_OUTPUT_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MODEL_OUTPUT_MAX_WIRE_BYTES = 48 * 1024 * 1024;
export const MODEL_OUTPUT_MAX_LINE_BYTES = 16 * 1024 * 1024;

export function assertOrderedOutputSupport(options: OfficialModelClientOptions): void {
  if (options.acceptOrderedOutput !== undefined && options.acceptOrderedOutput !== true) {
    throw new OfficialModelError("INVALID_REQUEST", "Invalid ordered output options");
  }
  if (options.acceptOrderedOutput && (options.protocol !== "gemini_generate_content"
    || (options.providerId !== undefined && options.providerId !== "gemini"))) {
    throw new OfficialModelError("UNSUPPORTED_CAPABILITY", "The provider has not verified ordered media output; use a supported text mode", { retrySafe: true });
  }
}

function outputError(code: "UNSUPPORTED_OUTPUT" | "INVALID_OUTPUT" | "OUTPUT_TOO_LARGE"): OfficialModelError {
  const messages = {
    UNSUPPORTED_OUTPUT: "The model returned unsupported media output; no automatic retry was made",
    INVALID_OUTPUT: "The model returned media output that cannot be read safely; no automatic retry was made",
    OUTPUT_TOO_LARGE: "Model output exceeds the safe size limit; it was not presented as complete or automatically retried"
  };
  return new OfficialModelError(code, messages[code], { usageKnown: false });
}

export function outputErrorWithUsage(error: OfficialModelError, usage: OfficialModelUsage, known: boolean): OfficialModelError {
  return new OfficialModelError(error.code, error.publicMessage, { ...error.toJSON(), usage, usageKnown: known });
}

export function terminalDeliveryError(usage: OfficialModelUsage, known: boolean): OfficialModelError {
  return new OfficialModelError("EVENT_DELIVERY_FAILED", "The model result was generated but the completion event could not be delivered; no automatic retry was made", {
    stage: "response", category: "unknown", retryable: false, retrySafe: false, usage, usageKnown: known,
  });
}

function hasSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType.startsWith("image/")) return hasSafeImageDimensions(bytes, mimeType);
  if (mimeType === "audio/wav") return bytes.length >= 44 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WAVE";
  if (mimeType === "audio/mpeg") return bytes.length >= 4 && (bytes.toString("latin1", 0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0));
  if (mimeType === "audio/ogg") return bytes.length >= 27 && bytes.toString("latin1", 0, 4) === "OggS";
  return mimeType === "audio/flac" && bytes.length >= 8 && bytes.toString("latin1", 0, 4) === "fLaC";
}

type MediaPart = Exclude<OfficialModelOutputPart, { readonly type: "text" }>;
function mediaPart(mime: unknown, data: unknown, remaining: number): MediaPart {
  if (typeof mime !== "string" || !["image/png", "image/jpeg", "image/webp", "image/gif", "audio/wav", "audio/mpeg", "audio/ogg", "audio/flac"].includes(mime)) {
    throw outputError("UNSUPPORTED_OUTPUT");
  }
  const type = mime.startsWith("image/") ? "image" : "audio";
  const maximum = Math.min(remaining, type === "image" ? MODEL_OUTPUT_MAX_IMAGE_BYTES : MODEL_OUTPUT_MAX_AUDIO_BYTES);
  if (typeof data !== "string" || !data.length || data.length % 4 !== 0) throw outputError("INVALID_OUTPUT");
  if (data.length > 4 * Math.ceil(maximum / 3)) throw outputError("OUTPUT_TOO_LARGE");
  if (/[^A-Za-z0-9+/=]/.test(data)) throw outputError("INVALID_OUTPUT");
  const padding = data.indexOf("=");
  if (padding >= 0 && (padding < data.length - 2 || !/^={1,2}$/.test(data.slice(padding)))) throw outputError("INVALID_OUTPUT");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > maximum) throw outputError("OUTPUT_TOO_LARGE");
  if (!bytes.length || bytes.toString("base64") !== data || !hasSignature(bytes, mime)) throw outputError("INVALID_OUTPUT");
  return { type, mimeType: mime, dataBase64: data, sizeBytes: bytes.length } as MediaPart;
}

/** Ordered visible content only. Failures are deferred to finish to retain final observed usage within the wire bound. */
export class OrderedModelOutput {
  readonly #parts: OfficialModelOutputPart[] = [];
  #lastTextId: string | undefined;
  #mediaBytes = 0;
  #mediaCount = 0;
  #textBytes = 0;
  #failure: OfficialModelError | undefined;
  constructor(readonly accepted: boolean) {}
  text(id: string, delta: string): void {
    if (!this.accepted || this.#failure || !delta) return;
    this.#textBytes += Buffer.byteLength(delta, "utf8");
    if (this.#textBytes > MODEL_OUTPUT_MAX_TEXT_BYTES) { this.#failure = outputError("OUTPUT_TOO_LARGE"); return; }
    const last = this.#parts.at(-1);
    if (this.#lastTextId === id && last?.type === "text") this.#parts[this.#parts.length - 1] = { type: "text", text: last.text + delta };
    else if (this.#parts.length >= MODEL_OUTPUT_MAX_PARTS) this.#failure = outputError("OUTPUT_TOO_LARGE");
    else { this.#parts.push({ type: "text", text: delta }); this.#lastTextId = id; }
  }
  media(mimeType: unknown, base64: () => unknown): void {
    this.#lastTextId = undefined;
    if (this.#failure) return;
    if (!this.accepted) { this.#failure = outputError("UNSUPPORTED_OUTPUT"); return; }
    try {
      if (this.#parts.length >= MODEL_OUTPUT_MAX_PARTS || ++this.#mediaCount > MODEL_OUTPUT_MAX_MEDIA) throw outputError("OUTPUT_TOO_LARGE");
      const part = mediaPart(mimeType, base64(), MODEL_OUTPUT_MAX_MEDIA_BYTES - this.#mediaBytes);
      this.#mediaBytes += part.sizeBytes;
      this.#parts.push(part);
    } catch (error) { this.#failure = error instanceof OfficialModelError ? error : outputError("INVALID_OUTPUT"); }
  }
  finish(usage: OfficialModelUsage, known: boolean): readonly OfficialModelOutputPart[] | undefined {
    if (this.#failure) throw outputErrorWithUsage(this.#failure, usage, known);
    return this.accepted ? this.#parts : undefined;
  }
}

/** The bound is enforced before the SDK's SSE/JSON parser receives bytes; no buffering or second fetch. */
export function boundedModelOutputFetch(fetchImpl: typeof fetch): { fetch: typeof fetch; failure: () => OfficialModelError | undefined } {
  let failure: OfficialModelError | undefined;
  return {
    failure: () => failure,
    fetch: async (input, init) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const response = await fetchImpl(input, init);
      if (!response.body) return response;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MODEL_OUTPUT_MAX_WIRE_BYTES) {
        failure = outputError("OUTPUT_TOO_LARGE");
        void response.body.cancel().catch(() => undefined);
        throw failure;
      }
      const reader = response.body.getReader();
      const abortError = (): unknown => signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
      const onAbort = (): void => { void reader.cancel(abortError()).catch(() => undefined); };
      if (signal?.aborted) {
        onAbort();
        throw abortError();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      // An event stream's unfinished line is what its parser buffers: cap it too (audit B02-08). A single line may
      // legitimately carry a whole picture as base64, hence the generous limit.
      const eventStream = /text\/event-stream/i.test(response.headers.get("content-type") || "");
      let total = 0, sinceNewline = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              signal?.removeEventListener("abort", onAbort);
              if (signal?.aborted) { controller.error(abortError()); return; }
              controller.close();
              return;
            }
            total += next.value.byteLength;
            let maxLineBytes = 0;
            if (eventStream) {
              let start = 0;
              for (let i = 0; i < next.value.byteLength; i++) {
                if (next.value[i] === 10) {
                  const lineBytes = (start === 0 ? sinceNewline : 0) + (i - start);
                  if (lineBytes > maxLineBytes) maxLineBytes = lineBytes;
                  sinceNewline = 0;
                  start = i + 1;
                }
              }
              sinceNewline = (start === 0 ? sinceNewline : 0) + (next.value.byteLength - start);
              if (sinceNewline > maxLineBytes) maxLineBytes = sinceNewline;
            }
            if (total > MODEL_OUTPUT_MAX_WIRE_BYTES || maxLineBytes > MODEL_OUTPUT_MAX_LINE_BYTES) {
              signal?.removeEventListener("abort", onAbort);
              failure = outputError("OUTPUT_TOO_LARGE");
              void reader.cancel().catch(() => undefined);
              controller.error(failure);
              return;
            }
            controller.enqueue(next.value);
          } catch (error) {
            signal?.removeEventListener("abort", onAbort);
            controller.error(error);
          }
        },
        cancel(reason) {
          signal?.removeEventListener("abort", onAbort);
          return reader.cancel(reason);
        }
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
  };
}
