/** Text formats that can be decoded without a document parser. No filename guessing. */
export function isPlainTextAttachmentMime(mimeType: string): boolean {
  const mime = mimeType.trim().toLowerCase().split(";", 1)[0];
  return mime.startsWith("text/") || [
    "application/json", "application/ld+json", "application/x-ndjson", "application/geo+json",
    "application/yaml", "application/x-yaml", "application/toml", "application/xml",
    "application/sql", "application/graphql", "application/javascript",
  ].includes(mime);
}

export const COHERE_TEXT_FILE_MAX_BYTES = 512 * 1024;
export const COHERE_TEXT_FILE_MAX_CHARACTERS = 120_000;
