import type { AgentModelMessage } from "@nextmux/agent-runtime";
import { COHERE_TEXT_FILE_MAX_BYTES, COHERE_TEXT_FILE_MAX_CHARACTERS, isPlainTextAttachmentMime } from "./attachment-formats.js";
import { OfficialModelError } from "./http.js";

/** Cohere documents contain extracted text, not arbitrary base64 file bytes. */
export function cohereAttachmentMessages(messages: readonly AgentModelMessage[]): readonly AgentModelMessage[] {
  return messages.map(message => {
    if (!message.attachments?.some(attachment => attachment.kind === "file")) return message;
    return { ...message, attachments: message.attachments.map(attachment => {
      if (attachment.kind !== "file") return attachment;
      if (!isPlainTextAttachmentMime(attachment.mimeType)) {
        throw new OfficialModelError("UNSUPPORTED_CAPABILITY", "This Cohere chat endpoint does not accept this binary attachment; extract text with a local tool first", {
          stage: "validation", category: "invalid_request", retryable: false, retrySafe: true,
        });
      }
      // Bound the encoded input before allocating; a permissive base64 decoder
      // must not turn malformed bytes or binary replacement characters into a
      // successful-looking text document.
      const encoded = attachment.dataBase64;
      if (encoded.length > Math.ceil(COHERE_TEXT_FILE_MAX_BYTES / 3) * 4) {
        throw new OfficialModelError("REQUEST_TOO_LARGE", "Cohere text attachments must not exceed 512 KiB", { params: { maxBytes: 512 * 1024 }, stage: "validation", retrySafe: true });
      }
      if (!encoded.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
        throw new OfficialModelError("INVALID_REQUEST", "Invalid text attachment encoding", { stage: "validation", retrySafe: true });
      }
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length > COHERE_TEXT_FILE_MAX_BYTES) {
        throw new OfficialModelError("REQUEST_TOO_LARGE", "Cohere text attachments must not exceed 512 KiB", { params: { maxBytes: 512 * 1024 }, stage: "validation", retrySafe: true });
      }
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
      let content: string;
      try {
        content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        if (content.includes("\0")) throw new Error("Binary text");
      } catch {
        throw new OfficialModelError("INVALID_REQUEST", "The attachment is not valid UTF-8 or BOM-prefixed UTF-16 text", { stage: "validation", retrySafe: true });
      }
      if (content.length > COHERE_TEXT_FILE_MAX_CHARACTERS) {
        throw new OfficialModelError("REQUEST_TOO_LARGE", "Cohere text attachments must not exceed 120,000 characters", { params: { maxCharacters: 120_000 }, stage: "validation", retrySafe: true });
      }
      return { kind: "text" as const, name: attachment.name, content };
    }) };
  });
}
