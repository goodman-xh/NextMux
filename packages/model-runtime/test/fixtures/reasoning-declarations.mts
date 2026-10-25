import type { ModelReasoningControl } from "../../lib/index.js";
/** Explicit fake-directory declaration for protocol transport tests. */
export function declaredEffort(protocol: string): readonly ModelReasoningControl[] {
  return [{ type: "effort", parameter: protocol === "anthropic_messages" ? "output_config.effort"
    : protocol === "gemini_generate_content" ? "generationConfig.thinkingConfig.thinkingLevel"
    : protocol === "openai_responses" ? "reasoning.effort" : "reasoning_effort",
    values: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    support: "supported", source: "provider_metadata", scope: "route" }];
}
