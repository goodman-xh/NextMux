/**
 * Tool-call arguments a model returned that are not a clean JSON object.
 *
 * Models sometimes wrap arguments in a code fence, encode the JSON twice, leave a trailing comma,
 * or stop mid-way because they hit their output limit. The first three are repaired here. What
 * cannot be repaired is handed back to the model as a tool error (INVALID_TOOL_ARGUMENTS) so it can
 * call again, instead of failing the whole task — a half-finished call is never executed.
 */

export const INVALID_TOOL_ARGUMENTS = "__nextmux_invalid_tool_arguments";

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parse(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

/**
 * Drop a comma right before `}` or `]` — outside strings only, so `",}"` inside a value is kept (audit B01-03) — and
 * escape raw line breaks and tabs a model wrote inside a string, which strict JSON rejects.
 */
export function withoutTrailingCommas(text: string): string {
  let out = "", inString = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        out += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        out += char;
        escaped = true;
        continue;
      }
      if (char === "\"") {
        out += char;
        inString = false;
        continue;
      }
      if (char === "\n") {
        out += "\\n";
        continue;
      }
      if (char === "\r") {
        out += "\\r";
        continue;
      }
      if (char === "\t") {
        out += "\\t";
        continue;
      }
      out += char;
      continue;
    }
    if (char === "\"") { inString = true; out += char; continue; }
    if (char === ",") {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    out += char;
  }
  return out;
}

/** A JSON object from what the model sent, or undefined when it cannot be recovered safely. */
export function repairToolArguments(raw: unknown, depth = 0): Record<string, unknown> | undefined {
  if (isObject(raw)) return raw;
  if (typeof raw !== "string" || depth > 2) return undefined;
  let text = raw.trim();
  if (!text) return {};
  const fenced = /^```(?:json5?|[\w-]+(?=\s))?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  const candidates = [text];
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start >= 0 && end > start && (start > 0 || end < text.length - 1)) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    for (const version of [candidate, withoutTrailingCommas(candidate)]) {
      let value = parse(version);
      // Encoded twice: a JSON string that holds the JSON object.
      if (typeof value === "string" && value.trim()) value = repairToolArguments(value, depth + 1);
      if (isObject(value)) return value;
    }
  }
  return undefined;
}

/** Arguments that ended before their JSON did: brackets or a string still open. */
export function toolArgumentsLookTruncated(raw: string): boolean {
  let depth = 0, inString = false, escaped = false;
  for (const char of raw) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
  }
  return inString || depth > 0;
}

/** The arguments to pass on: repaired, or a marker the runner turns into a tool error for the model. */
export function toolCallArguments(raw: unknown): Record<string, unknown> {
  const repaired = repairToolArguments(raw);
  if (repaired) return repaired;
  const text = typeof raw === "string" ? raw : "";
  return { [INVALID_TOOL_ARGUMENTS]: { truncated: toolArgumentsLookTruncated(text), length: text.length } };
}

export function invalidToolArguments(value: unknown): { readonly truncated: boolean } | undefined {
  if (!isObject(value) || !isObject(value[INVALID_TOOL_ARGUMENTS])) return undefined;
  return { truncated: (value[INVALID_TOOL_ARGUMENTS] as Record<string, unknown>).truncated === true };
}

/**
 * Models sometimes stringify a whole structured value: `"replacements"` arrives
 * as the text of a JSON array, `"limit"` as `"50"`, `"replaceAll"` as `"true"`.
 * Handlers then reject well-intended arguments. This walks a tool's declared
 * inputSchema and coerces only string values whose declared type says they
 * should be something else (audit OpenCode #9). Strings stay strings wherever
 * the schema asks for a string, so a literal `"true"` content value is never
 * silently turned into a boolean.
 */

const COERCION_MAX_DEPTH = 8;
const COERCION_MAX_STRING = 1_000_000;

function schemaType(schema: unknown): string | undefined {
  if (!isObject(schema)) return undefined;
  const type = schema.type;
  return typeof type === "string" ? type : undefined;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > COERCION_MAX_STRING) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

function coerceScalar(value: string, type: string): unknown {
  if (type === "integer" || type === "number") {
    const trimmed = value.trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return value;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return value;
    return type === "integer" && !Number.isSafeInteger(parsed) ? value : parsed;
  }
  if (type === "boolean") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return value;
}

function coerceToSchema(value: unknown, schema: unknown, depth: number): unknown {
  if (depth > COERCION_MAX_DEPTH || !isObject(schema)) return value;
  const type = schemaType(schema);
  if (typeof value === "string" && type && type !== "string") {
    const coerced = coerceScalar(value, type);
    if (coerced !== value) return coerced;
    if (type === "array" || type === "object") {
      const parsed = parseJsonText(value);
      if (Array.isArray(parsed) && type === "array") return coerceToSchema(parsed, schema, depth + 1);
      if (isObject(parsed) && type === "object") return coerceToSchema(parsed, schema, depth + 1);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items = isObject(schema) ? schema.items : undefined;
    if (!isObject(items)) return value;
    return value.map(entry => coerceToSchema(entry, items, depth + 1));
  }
  if (isObject(value)) {
    const properties = isObject(schema) && isObject(schema.properties) ? schema.properties as Record<string, unknown> : undefined;
    if (!properties) return value;
    let changed = false;
    const coerced: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const child = properties[key];
      const next = child === undefined ? entry : coerceToSchema(entry, child, depth + 1);
      if (next !== entry) changed = true;
      coerced[key] = next;
    }
    return changed ? coerced : value;
  }
  return value;
}

/** Applies schema-directed coercion to already-repaired tool arguments. */
export function coerceToolArgumentsToSchema(toolArguments: unknown, schema: unknown): unknown {
  if (!isObject(toolArguments) || !isObject(schema)) return toolArguments;
  const properties = isObject(schema.properties) ? schema.properties as Record<string, unknown> : undefined;
  if (!properties) return toolArguments;
  return coerceToSchema(toolArguments, schema, 0);
}
