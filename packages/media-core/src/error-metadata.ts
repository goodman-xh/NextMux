import { classifyModelError, formatModelError, mediaErrorMessage, type ReadableModelError } from "@nextmux/model-runtime/errors";

export type MediaErrorParams = Readonly<Record<string, string | number | boolean | null>>;
export interface MediaErrorMessage {
  readonly domain: "media";
  readonly messageKey: string;
  readonly params: MediaErrorParams;
  readonly message?: string;
  readonly detail?: string;
}

/** Explicit message identity: no error prose is parsed to select a translation. */
export function mediaMessage(messageKey: string, params: MediaErrorParams = {}): MediaErrorMessage & { readonly message: string } {
  return { domain: "media", messageKey, params, message: mediaErrorMessage(messageKey, params) };
}

export function mediaErrorMetadata(code: string, value: MediaErrorMessage | string, providerFailure?: unknown): {
  readonly message: string;
  readonly messageKey: string;
  readonly params: MediaErrorParams;
  readonly readableError: ReadableModelError;
} {
  const entry = typeof value === "string" ? mediaMessage("media.unknown") : value;
  const message = entry.message ?? formatModelError({ code, ...entry }, "en").text;
  const readable = classifyModelError(providerFailure ?? { code, message: typeof value === "string" ? value : entry.detail ?? message }, { source: providerFailure ? "own_api" : "local" });
  return {
    message,
    messageKey: entry.messageKey,
    params: entry.params,
    readableError: { ...readable, ...(providerFailure ? { providerFailure: true as const } : {}), domain: "media", code, messageKey: entry.messageKey, params: entry.params },
  };
}
