"use strict";

const unsafeCharacters = /[\u0000-\u0020\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const unsafeTitleCharacters = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/** Only explicit public URL/title fields belong here, never raw provider state or HTML. */
function normalizeModelCitations(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const candidate of value.slice(0, 128)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const { url, title } = candidate;
    if (typeof url !== "string" || url.length > 2048 || unsafeCharacters.test(url)
      || !/^https?:\/\//iu.test(url) || url.includes("\\")) continue;
    try {
      const parsed = new URL(url);
      if (!parsed.hostname || parsed.username || parsed.password || /^https?:\/\/[^/?#]*@/iu.test(url)
        || parsed.href.length > 2048 || seen.has(parsed.href)) continue;
      // Encoded controls must not become active in a later link-opening layer.
      if (unsafeTitleCharacters.test(decodeURIComponent(parsed.href))) continue;
      const boundedTitle = typeof title === "string" && title.length <= 300
        && !unsafeTitleCharacters.test(title) ? title.trim() : "";
      result.push({ url: parsed.href, ...(boundedTitle ? { title: boundedTitle } : {}) });
      seen.add(parsed.href);
      if (result.length === 24) break;
    } catch {
      // Malformed metadata is discarded, not an assistant-response failure.
    }
  }
  return result;
}

exports.normalizeModelCitations = normalizeModelCitations;
