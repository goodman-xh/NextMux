import type { OfficialModelFinishReason } from "./types.js";

/** Provider output limits are a continuation signal; transport byte limits remain errors. */
export function nativeFinishReason(value: unknown, hasToolCalls: boolean): OfficialModelFinishReason {
  if (typeof value !== "string") return hasToolCalls ? "tool-calls" : "stop";
  switch (value.toLowerCase()) {
    case "length": case "max_tokens": return "length";
    case "stop": case "end_turn": case "stop_sequence": case "complete": return hasToolCalls ? "tool-calls" : "stop";
    case "tool_calls": case "tool_call": case "tool_use": return "tool-calls";
    case "content_filter": case "safety": case "image_safety": case "recitation": case "blocklist": case "prohibited_content": case "spii": case "refusal": case "error_toxic": return "content-filter";
    case "error": return "error";
    default: return hasToolCalls ? "tool-calls" : "other";
  }
}
