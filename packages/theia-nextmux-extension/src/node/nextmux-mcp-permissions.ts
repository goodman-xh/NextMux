import { createHash } from 'crypto';
import Ajv, { type Options } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import Ajv2019 from 'ajv/dist/2019';
import addFormats from 'ajv-formats';
import { RE2JS } from 're2js';

/** Constructed only by the local gate, never from a remote tool error string. */
export class McpToolPreflightError extends Error {
    constructor(readonly reason: string) {
        super(reason);
        this.name = 'McpToolPreflightError';
    }
}

/** Stable identity, never a storage location for credentials. */
export function mcpFingerprint(value: unknown): string {
    let nodes = 0;
    const visit = (item: unknown, depth: number): unknown => {
        if (++nodes > 4096 || depth > 24) throw new Error('MCP_IDENTITY_TOO_COMPLEX');
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (Array.isArray(item)) return item.map(child => visit(child, depth + 1));
        if (!item || typeof item !== 'object') throw new Error('MCP_IDENTITY_INVALID');
        return Object.fromEntries(Object.keys(item).sort().filter(key => (item as Record<string, unknown>)[key] !== undefined)
            .map(key => [key, visit((item as Record<string, unknown>)[key], depth + 1)]));
    };
    const json = JSON.stringify(visit(value, 0));
    if (Buffer.byteLength(json) > 80_000) throw new Error('MCP_IDENTITY_TOO_LARGE');
    return createHash('sha256').update(json).digest('hex');
}

type CompiledSchema = { schema: Readonly<Record<string, unknown>>; modelSchema: Readonly<Record<string, unknown>>; validate: (input: unknown) => boolean };
const compiledSchemas = new Map<string, CompiledSchema>();
const schemaMaps = new Set(['properties', 'patternProperties', 'definitions', '$defs', 'dependencies', 'dependentSchemas']);
const schemaChildren = new Set(['additionalProperties', 'unevaluatedProperties', 'items', 'prefixItems', 'additionalItems', 'contains', 'unevaluatedItems', 'propertyNames', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else']);

export function compileMcpInputSchema(value: unknown): CompiledSchema {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { type?: unknown }).type !== 'object') throw new Error('MCP_SCHEMA_UNSUPPORTED');
    const fingerprint = mcpFingerprint(value);
    const cached = compiledSchemas.get(fingerprint);
    if (cached) { compiledSchemas.delete(fingerprint); compiledSchemas.set(fingerprint, cached); return cached; }
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > 20_000) throw new Error('MCP_SCHEMA_TOO_LARGE');
    const schema = JSON.parse(json) as Record<string, unknown>;
    let visited = 0;
    let patterns = 0;
    let legacyTuple = false;
    const ancestors = new Set<object>();
    const localRef = (ref: unknown): unknown => {
        // Resolve only document-local JSON Pointers. No network/dynamic schemas.
        if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new Error('MCP_SCHEMA_UNSUPPORTED');
        let target: unknown = schema;
        const pointer = decodeURIComponent(ref.slice(1));
        for (const encoded of pointer.slice(1).split('/')) {
            if (/~(?:[^01]|$)/.test(encoded)) throw new Error('MCP_SCHEMA_UNSUPPORTED');
            const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
            if (!target || typeof target !== 'object' || !Object.prototype.hasOwnProperty.call(target, key)) throw new Error('MCP_SCHEMA_UNSUPPORTED');
            target = (target as Record<string, unknown>)[key];
        }
        if (typeof target !== 'boolean' && (!target || typeof target !== 'object' || Array.isArray(target))) throw new Error('MCP_SCHEMA_UNSUPPORTED');
        return target;
    };
    const inspect = (item: unknown): void => {
        if (++visited > 4096) throw new Error('MCP_SCHEMA_TOO_COMPLEX');
        if (!item || typeof item !== 'object') return;
        if (ancestors.has(item) || ancestors.size >= 64) throw new Error('MCP_SCHEMA_UNSUPPORTED');
        ancestors.add(item);
        if (Array.isArray(item)) item.forEach(inspect);
        else for (const [key, child] of Object.entries(item)) {
            if (['$recursiveRef', '$dynamicRef', '$async'].includes(key)) throw new Error('MCP_SCHEMA_UNSUPPORTED');
            if (key === '$ref') inspect(localRef(child));
            if (['$id', '$schema'].includes(key) && item !== schema) throw new Error('MCP_SCHEMA_UNSUPPORTED');
            if (key === 'pattern' || key === 'patternProperties') {
                const values = key === 'pattern' ? [child] : Object.keys(child as object);
                for (const pattern of values) {
                    if (typeof pattern !== 'string' || pattern.length > 512 || ++patterns > 64) throw new Error('MCP_SCHEMA_UNSUPPORTED');
                    // RE2JS is linear-time and pure JavaScript, with no native runtime dependency.
                    try { RE2JS.compile(RE2JS.translateRegExp(pattern)); } catch { throw new Error('MCP_SCHEMA_UNSUPPORTED'); }
                }
            }
            if (key === 'items' && Array.isArray(child)) legacyTuple = true;
            // enum/default/examples and field names are data, not executable schemas.
            if (schemaMaps.has(key)) {
                if (child && typeof child === 'object') Object.values(child).forEach(inspect);
            } else if (schemaChildren.has(key)) inspect(child);
        }
        ancestors.delete(item);
    };
    inspect(schema);
    const dialect = typeof schema.$schema === 'string' ? schema.$schema.replace(/#$/, '').replace(/^http:/, 'https:') : schema.$schema;
    const Constructor = dialect === 'https://json-schema.org/draft/2020-12/schema' ? Ajv2020
        : dialect === 'https://json-schema.org/draft/2019-09/schema' ? Ajv2019
        : dialect === 'https://json-schema.org/draft-07/schema' ? Ajv
        : dialect === undefined ? (legacyTuple ? Ajv : Ajv2020) : undefined;
    if (!Constructor) throw new Error('MCP_SCHEMA_UNSUPPORTED');
    if (dialect !== undefined) schema.$schema = Constructor === Ajv ? 'http://json-schema.org/draft-07/schema#' : dialect;
    const options: Options = {
        allErrors: false, strictSchema: true, strictTypes: false, strictTuples: false,
        allowUnionTypes: true, useDefaults: false, coerceTypes: false, removeAdditional: false,
        // Do not inline a DAG into exponentially large generated validator code.
        inlineRefs: false,
        code: { regExp: Object.assign((pattern: string) => RE2JS.compile(RE2JS.translateRegExp(pattern)), { code: 'RE2JS.compile' }) }
    };
    const ajv = new Constructor(options);
    addFormats(ajv, { mode: 'full', keywords: false });
    const validator = ajv.compile(schema);
    let sanitizedNodes = 0;
    const sanitizeStack = new Set<object>();
    const sanitizeSchemaNode = (item: unknown): unknown => {
        if (++sanitizedNodes > 4096) throw new Error('MCP_SCHEMA_TOO_COMPLEX');
        if (!item || typeof item !== 'object') return item;
        if (Array.isArray(item)) return item.map(sanitizeSchemaNode);
        if (sanitizeStack.has(item)) throw new Error('MCP_SCHEMA_UNSUPPORTED');
        sanitizeStack.add(item);
        try {
            const record = item as Record<string, unknown>;
            let base: Record<string, unknown> = {};
            if (typeof record.$ref === 'string') {
                const resolved = localRef(record.$ref);
                if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
                    base = { ...(sanitizeSchemaNode(resolved) as Record<string, unknown>) };
                }
            }
            const out: Record<string, unknown> = { ...base };
            for (const [key, child] of Object.entries(record)) {
                if (key === '$ref' || key === '$schema' || key === '$defs' || key === 'definitions') continue;
                if (schemaMaps.has(key)) {
                    if (child && typeof child === 'object' && !Array.isArray(child)) {
                        const mapped: Record<string, unknown> = {};
                        for (const [propKey, propVal] of Object.entries(child as Record<string, unknown>)) {
                            mapped[propKey] = key === 'dependencies' && Array.isArray(propVal)
                                ? [...propVal]
                                : sanitizeSchemaNode(propVal);
                        }
                        out[key] = mapped;
                    } else {
                        out[key] = child;
                    }
                } else if (schemaChildren.has(key)) {
                    out[key] = sanitizeSchemaNode(child);
                } else {
                    out[key] = child;
                }
            }
            if (out.type === 'array' && out.items === undefined && out.prefixItems === undefined) {
                out.items = {};
            }
            return out;
        } finally {
            sanitizeStack.delete(item);
        }
    };
    const modelSchema = sanitizeSchemaNode(schema) as Record<string, unknown>;
    const freeze = (item: unknown): void => {
        if (!item || typeof item !== 'object') return;
        Object.values(item).forEach(freeze); Object.freeze(item);
    };
    freeze(modelSchema);
    const compiled: CompiledSchema = Object.freeze({ schema: modelSchema, modelSchema, validate: (input: unknown) => {
        try { mcpFingerprint(input); return validator(input) === true; } catch { return false; }
    } });
    compiledSchemas.set(fingerprint, compiled);
    if (compiledSchemas.size > 128) compiledSchemas.delete(compiledSchemas.keys().next().value!);
    return compiled;
}
