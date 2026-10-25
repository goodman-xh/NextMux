/**
 * API root resolution shared by the transports and the settings preview (Cherry Studio #10).
 *
 * Settings -> My API shows where a typed base URL will actually send requests, computed by the very function the
 * transports use. A trailing `#` pins the API root as typed: no version path is appended (a relay that serves its
 * API at the host root); the operation path (`/chat/completions`, `/messages`, …) is still added per request.
 */

export interface ResolvedEndpointUrlPreview {
  readonly baseUrl: string;
  readonly chatUrl: string;
  readonly modelsUrl: string;
}

const OPERATION_SUFFIX = /\/(?:chat\/completions|responses|messages|models)$/i;
const LOCAL_HOST = /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[::1\]$|.*\.local$)/i;

/** A base URL that ends with `#`: its API root is used as typed (validatedBaseUrl drops the empty fragment). */
export function isPinnedBaseUrl(baseUrl: string): boolean {
  return typeof baseUrl === "string" && baseUrl.trim().endsWith("#");
}

/**
 * The API root the transports call. A pasted operation path is dropped, and a bare public host of a custom relay
 * gets its format's version path; built-in providers, local servers and a `#`-pinned address keep their own.
 */
export function versionedBaseUrl(baseUrl: string, protocol: string, providerId?: string): string {
  if (isPinnedBaseUrl(baseUrl)) return baseUrl.trim();
  let url: URL;
  try { url = new URL(baseUrl); } catch { return baseUrl; }
  const currentPath = url.pathname.replace(/\/+$/, "");
  const strippedPath = currentPath.replace(OPERATION_SUFFIX, "");
  if (strippedPath !== currentPath) {
    url.pathname = strippedPath || "/";
    baseUrl = url.toString().replace(/\/+$/, "");
  }
  if (providerId && !["custom_openai", "openrouter", "ollama"].includes(providerId)) return baseUrl;
  if (url.pathname.replace(/\/+$/, "")) return baseUrl;
  // A local server keeps the path it was given; a detected Ollama falls back to /v1 on its own.
  if (LOCAL_HOST.test(url.hostname)) return baseUrl;
  const version = protocol === "gemini_generate_content" ? "/v1beta"
    : ["openai_chat_completions", "openai_responses", "anthropic_messages"].includes(protocol) ? "/v1" : "";
  return version ? `${baseUrl.replace(/\/+$/, "")}${version}` : baseUrl;
}

/** Settings and presets name formats both ways; anything else is an OpenAI-compatible chat API. */
const PROTOCOL_ALIASES: Readonly<Record<string, string>> = {
  openai: "openai_chat_completions", openai_chat_completions: "openai_chat_completions",
  responses: "openai_responses", openai_responses: "openai_responses",
  anthropic: "anthropic_messages", anthropic_messages: "anthropic_messages",
  gemini: "gemini_generate_content", gemini_generate_content: "gemini_generate_content",
  cohere: "cohere_chat", cohere_chat: "cohere_chat",
};

/**
 * The URLs a typed base URL will use, through the transports' own resolution (versionedBaseUrl), without credential
 * or network validation. A typed address has no built-in provider unless one is given.
 */
export function previewResolvedEndpointUrl(baseUrl: string, protocol?: string, providerId = "custom_openai"): ResolvedEndpointUrlPreview {
  const typed = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (!typed) return { baseUrl: "", chatUrl: "", modelsUrl: "" };
  const transportProtocol = PROTOCOL_ALIASES[(protocol ?? "").trim().toLowerCase()] ?? "openai_chat_completions";
  let url: URL;
  try { url = new URL(versionedBaseUrl(typed, transportProtocol, providerId).replace(/#$/, "")); }
  catch { return { baseUrl: typed, chatUrl: typed, modelsUrl: typed }; }
  // As the request builders do: an operation path is never part of the root.
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "").replace(OPERATION_SUFFIX, "") || "/";
  const root = url.toString().replace(/\/+$/, "");
  const chatPath = transportProtocol === "anthropic_messages" ? "messages"
    : transportProtocol === "gemini_generate_content" ? "models/{model}:generateContent"
      : transportProtocol === "cohere_chat" ? "chat"
        : transportProtocol === "openai_responses" ? "responses"
          : "chat/completions";
  return { baseUrl: root, chatUrl: `${root}/${chatPath}`, modelsUrl: `${root}/models` };
}
