import { skillDomainDescriptor, type SkillDomainCode } from './nextmux-skill-domain';
import type { DomainMessage } from './nextmux-domain-errors';
import { parseSkillFile, type SkillDescription } from '@theia/ai-core/lib/common/skill';
import { serializeFrontmatter } from '@theia/ai-core/lib/common/frontmatter';
import { AgentToolError } from '@nextmux/agent-runtime/errors';

/** One contract for creation, discovery, renderer snapshots and host execution. */
export const SKILL_LIMITS = Object.freeze({
    // Public skills run to tens of thousands of characters (Anthropic's skill-creator is about 33 KB).
    fileBytes: 196_608, name: 64, description: 1_024, instructions: 60_000, tools: 64,
    perTask: 24, totalInstructions: 120_000
});
const skillNamePattern = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
export const SKILL_CREATE_PROPERTIES = Object.freeze({
    name: { type: 'string', minLength: 1, maxLength: SKILL_LIMITS.name, pattern: skillNamePattern },
    description: { type: 'string', minLength: 1, maxLength: SKILL_LIMITS.description },
    instructions: { type: 'string', minLength: 1, maxLength: SKILL_LIMITS.instructions }
});

export class SkillFormatError extends AgentToolError {
    readonly domainError: DomainMessage;
    readonly data: { readonly domainError: DomainMessage };
    constructor(code: 'INVALID_SKILLS' | 'INVALID_SKILL_SOURCE' | 'INVALID_TOOL_POLICY', reason: SkillDomainCode) {
        const domainError = skillDomainDescriptor(reason);
        super(code, domainError.fallbackEnglish, { params: { reason } });
        this.domainError = domainError;
        this.data = { domainError };
    }
}

export interface ParsedNextMuxSkill {
    readonly metadata: SkillDescription;
    readonly name: string;
    readonly description: string;
    readonly instructions: string;
    readonly allowedTools?: readonly string[];
}

function validateFields(name: unknown, description: unknown, instructions: unknown): void {
    if (typeof name !== 'string' || name.length > SKILL_LIMITS.name || !new RegExp(skillNamePattern).test(name)) {
        throw new SkillFormatError('INVALID_SKILLS', 'SKILL_NAME_INVALID');
    }
    if (typeof description !== 'string' || !description.trim() || description.length > SKILL_LIMITS.description || description.includes('\0')) {
        throw new SkillFormatError('INVALID_SKILLS', 'SKILL_DESCRIPTION_INVALID');
    }
    if (typeof instructions !== 'string' || !instructions.trim() || instructions.length > SKILL_LIMITS.instructions || instructions.includes('\0')) {
        throw new SkillFormatError('INVALID_SKILLS', 'SKILL_INSTRUCTIONS_INVALID');
    }
}

export function decodeSkillBytes(bytes: Uint8Array): string {
    if (bytes.byteLength > SKILL_LIMITS.fileBytes) throw new SkillFormatError('INVALID_SKILL_SOURCE', 'SKILL_SOURCE_TOO_LARGE');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new SkillFormatError('INVALID_SKILL_SOURCE', 'SKILL_UTF8_INVALID'); }
}

export function parseNextMuxSkill(body: string, expectedName?: string): ParsedNextMuxSkill {
    if (new TextEncoder().encode(body).byteLength > SKILL_LIMITS.fileBytes) {
        throw new SkillFormatError('INVALID_SKILL_SOURCE', 'SKILL_SOURCE_TOO_LARGE');
    }
    if (body.includes('\0')) throw new SkillFormatError('INVALID_SKILLS', 'SKILL_NUL_INVALID');
    const { metadata, content } = parseSkillFile(body);
    if (!metadata) throw new SkillFormatError('INVALID_SKILLS', 'SKILL_YAML_INVALID');
    validateFields(metadata.name, metadata.description, content);
    if (expectedName !== undefined && metadata.name !== expectedName) {
        throw new SkillFormatError('INVALID_SKILLS', 'SKILL_NAME_MISMATCH');
    }
    const alias = (metadata as unknown as Record<string, unknown>)['allowed-tools'];
    if (alias !== undefined && metadata.allowedTools !== undefined && (!Array.isArray(alias) || !Array.isArray(metadata.allowedTools)
        || alias.length !== metadata.allowedTools.length || alias.some((name, index) => name !== metadata.allowedTools![index]))) {
        throw new SkillFormatError('INVALID_TOOL_POLICY', 'SKILL_TOOL_DECLARATIONS_CONFLICT');
    }
    const declaration = metadata.allowedTools !== undefined ? metadata.allowedTools : alias;
    if (declaration !== undefined && (!Array.isArray(declaration) || declaration.length > SKILL_LIMITS.tools
        || declaration.some(name => typeof name !== 'string' || name.length > 160 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(name)))) {
        throw new SkillFormatError('INVALID_TOOL_POLICY', 'SKILL_TOOLS_INVALID');
    }
    const allowedTools = declaration === undefined ? undefined : Object.freeze([...new Set(declaration as string[])]);
    return { metadata, name: metadata.name, description: metadata.description.trim(), instructions: content,
        ...(allowedTools === undefined ? {} : { allowedTools }) };
}

/** Use the parser's YAML serializer so booleans, colons, quotes and newlines remain strings. */
export function serializeNextMuxSkill(value: { readonly name: string; readonly description: string; readonly instructions: string }): string {
    validateFields(value.name, value.description, value.instructions);
    const body = serializeFrontmatter({ name: value.name, description: value.description.trim() }, `${value.instructions.replace(/\r\n/g, '\n').trim()}\n`);
    parseNextMuxSkill(body, value.name);
    return body;
}
