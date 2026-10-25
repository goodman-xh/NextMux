import { normalizeModelCitations } from "@nextmux/agent-runtime";
export { normalizeModelCitations, type ModelCitation } from "@nextmux/agent-runtime";

/** Cohere source IDs are not URLs. Only explicitly supplied document/tool URLs survive. */
export function cohereModelCitations(value: unknown): ReturnType<typeof normalizeModelCitations> {
  const entries = Array.isArray(value) ? value.slice(0, 128) : [value];
  const sources: unknown[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !Array.isArray((entry as any).sources)) continue;
    for (const source of (entry as any).sources.slice(0, 128)) {
      sources.push(source?.type === "document" ? source.document : source?.type === "tool" ? source.tool_output : undefined);
      if (sources.length === 128) return normalizeModelCitations(sources);
    }
  }
  return normalizeModelCitations(sources);
}
