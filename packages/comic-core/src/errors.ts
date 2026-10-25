/** Serializable domain metadata shared by local code, RPC and persisted recovery records. */
export type ComicErrorParams = Readonly<Record<string, string | number | boolean>>;
export interface ReadableComicError {
  readonly kind: "unknown";
  readonly domain: "comic";
  readonly code: string;
  readonly messageKey: string;
  readonly params: ComicErrorParams;
  readonly detail: string;
}

export class ComicDomainError extends Error {
  readonly domain = "comic" as const;
  readonly readableError: ReadableComicError;
  readonly params: ComicErrorParams;

  constructor(readonly code: string, message: string, readonly messageKey = "comic.operation_failed", params: ComicErrorParams = {}, detail = message) {
    super(message);
    this.name = "ComicDomainError";
    this.params = Object.freeze({ ...params });
    this.readableError = Object.freeze({ kind: "unknown", domain: this.domain, code, messageKey, params: this.params, detail });
  }
}
