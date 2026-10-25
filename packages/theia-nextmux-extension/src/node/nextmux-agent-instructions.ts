import { DesktopDomainError } from '../common/nextmux-domain-errors';
// User instruction files (AGENTS.md).
//
// AGENTS.md is the open, tool-neutral convention for standing instructions to
// coding agents (used by Codex, Cursor, Jules, Aider and others), so a project
// that already has one works unchanged and a file written here works in those
// tools too. Two files apply to every run:
//   personal  <NextMux data>/AGENTS.md   habits that apply to every project
//   project   <project root>/AGENTS.md   conventions of this project
// More specific AGENTS.md files in sub-directories are left for the agent to
// read when it works there, exactly as the convention describes.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentInstructionFile } from '../common/nextmux-agent-instructions';
import { AGENT_INSTRUCTIONS_FILE_NAME, AGENT_INSTRUCTIONS_MAX_CHARACTERS } from '../common/nextmux-agent-instructions';
import { AGENT_INSTRUCTIONS_LIMIT } from '@nextmux/agent-runtime';

/** The runner's instruction limit: built-in guidance first, then the user's files share what is left. */
const RUNNER_INSTRUCTION_LIMIT = AGENT_INSTRUCTIONS_LIMIT;
const READ_LIMIT_BYTES = 256 * 1024;

export class AgentInstructionConflictError extends DesktopDomainError {
    constructor() { super('AGENT_INSTRUCTIONS_CHANGED', 'AGENTS.md changed on disk. Reload it before saving.'); }
}

export class AgentInstructionInvalidError extends DesktopDomainError {
    constructor(message: string, reason: string = 'AGENT_INSTRUCTIONS_INVALID', params?: Readonly<Record<string, string | number | boolean>>) {
        super(reason, message, params);
        Object.assign(this, { code: 'AGENT_INSTRUCTIONS_INVALID' });
    }
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export function agentInstructionPath(directory: string): string {
    return join(directory, AGENT_INSTRUCTIONS_FILE_NAME);
}

export async function readAgentInstructionFile(path: string, scope: AgentInstructionFile['scope']): Promise<AgentInstructionFile> {
    try {
        const info = await stat(path);
        if (!info.isFile()) return { scope, path, exists: false, content: '', sha256: sha256(''), updatedAt: null };
        if (info.size > READ_LIMIT_BYTES) throw new AgentInstructionInvalidError('AGENTS.md is larger than 256 KB', 'AGENT_INSTRUCTIONS_TOO_LARGE', { maxKB: 256 });
        const raw = await readFile(path, 'utf8');
        // An over-long file stays readable here but is saved only from a full editor.
        const truncated = raw.length > AGENT_INSTRUCTIONS_MAX_CHARACTERS;
        return { scope, path, exists: true, content: truncated ? raw.slice(0, AGENT_INSTRUCTIONS_MAX_CHARACTERS) : raw, sha256: sha256(raw),
            updatedAt: info.mtimeMs, ...(truncated ? { truncated: true } : {}) };
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { scope, path, exists: false, content: '', sha256: sha256(''), updatedAt: null };
        throw error;
    }
}

/**
 * Replace the file atomically when its current digest still matches what the
 * editor loaded. An empty document removes the file so the project does not
 * gain an empty AGENTS.md.
 */
export async function writeAgentInstructionFile(path: string, scope: AgentInstructionFile['scope'], content: string, expectedSha256: string): Promise<AgentInstructionFile> {
    if (typeof content !== 'string' || content.includes('\0')) throw new AgentInstructionInvalidError('Instructions must be plain text', 'AGENT_INSTRUCTIONS_TEXT_REQUIRED');
    if (content.length > AGENT_INSTRUCTIONS_MAX_CHARACTERS) throw new AgentInstructionInvalidError(`Instructions are limited to ${AGENT_INSTRUCTIONS_MAX_CHARACTERS} characters`, 'AGENT_INSTRUCTIONS_CHARACTER_LIMIT', { maxCharacters: AGENT_INSTRUCTIONS_MAX_CHARACTERS });
    const current = await readAgentInstructionFile(path, scope);
    if (current.sha256 !== expectedSha256) throw new AgentInstructionConflictError();
    const normalized = content.replace(/\r\n/g, '\n');
    if (!normalized.trim()) {
        if (current.exists) await rm(path, { force: true });
        return readAgentInstructionFile(path, scope);
    }
    const text = normalized.endsWith('\n') ? normalized : `${normalized}\n`;
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, text, { encoding: 'utf8', mode: 0o644 });
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
    }
    return readAgentInstructionFile(path, scope);
}

/** Instruction files other coding tools keep at the project root, most common first. */
export const OTHER_INSTRUCTION_FILES = ['CLAUDE.md', '.cursorrules', 'GEMINI.md', '.github/copilot-instructions.md', '.windsurfrules'] as const;

/**
 * Other tools' instruction files in a project without AGENTS.md. The settings page offers
 * them for import and runs fall back to the first one, so the project's rules are not lost.
 */
export async function readOtherInstructionFiles(directory: string): Promise<{ name: string; path: string; content: string }[]> {
    const found: { name: string; path: string; content: string }[] = [];
    for (const name of OTHER_INSTRUCTION_FILES) {
        const path = join(directory, name);
        try {
            const info = await stat(path);
            if (!info.isFile() || info.size === 0 || info.size > READ_LIMIT_BYTES) continue;
            const content = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
            if (content.trim() && !content.includes('\0')) found.push({ name, path, content: content.slice(0, AGENT_INSTRUCTIONS_MAX_CHARACTERS) });
        } catch { /* absent or unreadable: skip */ }
    }
    return found;
}

function clip(text: string, limit: number): string {
    const trimmed = text.trim();
    if (trimmed.length <= limit) return trimmed;
    const notice = '\n\n[… truncated: the file is longer; read it directly for the rest.]';
    const bodyBudget = limit > notice.length ? limit - notice.length : Math.max(0, limit);
    return limit > notice.length
        ? `${trimmed.slice(0, bodyBudget).trimEnd()}${notice}`
        : trimmed.slice(0, bodyBudget).trimEnd();
}

export const READ_ONLY_PLAN_MODE_INSTRUCTIONS = [
    '## Read-only Plan & Research Mode',
    'This conversation is currently in read-only mode. Explore the codebase or resources thoroughly with read/search tools, trace the root cause and affected files, and present a clear, actionable plan or answer without attempting any file-modifying or state-mutating tool calls.'
].join('\n');

export interface ComposeAgentInstructionsOptions {
    readonly permissionMode?: string;
}

/**
 * Append the instruction files to the built-in instructions, within the
 * runner's size limit. Project instructions get the larger share because
 * they are usually the more specific of the two.
 */
export function composeAgentInstructions(base: string, personal: string, project: string, options?: ComposeAgentInstructionsOptions): string {
    const personalText = personal.trim(), projectText = project.trim();
    const readOnlyBlock = options?.permissionMode === 'read_only' ? `\n\n${READ_ONLY_PLAN_MODE_INSTRUCTIONS}` : '';
    const effectiveBase = `${base}${readOnlyBlock}`;
    if (!personalText && !projectText) return effectiveBase.slice(0, RUNNER_INSTRUCTION_LIMIT);
    const header = [
        '',
        '## User instructions (AGENTS.md)',
        'The user maintains the standing instructions below. Follow them in every reply and change, unless they conflict with safety rules, the permission mode or an explicit request in the current conversation (the current request wins). More specific AGENTS.md files in sub-directories apply to files beneath them; read them when you work there.'
    ].join('\n');
    const available = Math.max(0, RUNNER_INSTRUCTION_LIMIT - effectiveBase.length - header.length - 200);
    const personalBudget = projectText ? Math.min(personalText.length, Math.floor(available * .4)) : available;
    const projectBudget = available - Math.min(personalText.length, personalBudget);
    const sections = [header];
    if (personalText) sections.push(`\n### Personal (every project)\n${clip(personalText, personalBudget)}`);
    if (projectText) sections.push(`\n### This project (AGENTS.md at the project root)\n${clip(projectText, projectBudget)}`);
    return `${effectiveBase}\n${sections.join('\n')}`.slice(0, RUNNER_INSTRUCTION_LIMIT);
}
