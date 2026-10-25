import { skillDomainDescriptor, type SkillDomainCode } from '../common/nextmux-skill-domain';
import { createHash } from 'crypto';
import { constants } from 'fs';
import { open, realpath, stat } from 'fs/promises';
import { basename, isAbsolute, relative, sep } from 'path';
import { AgentToolError, validatedSkillPolicy } from '@nextmux/agent-runtime';
import type { AgentSkillPolicy } from '@nextmux/agent-runtime';
import type { DesktopAgentSkill } from '../common/nextmux-platform-protocol';
import { decodeSkillBytes, parseNextMuxSkill, SKILL_LIMITS, SkillFormatError } from '../common/nextmux-skill-format';

export interface VerifiedAgentSkill {
    readonly sourcePath: string;
    readonly sourceSha256: string;
    readonly name: string;
    readonly description: string;
    readonly instructions: string;
    readonly allowedTools?: readonly string[];
    readonly policy: AgentSkillPolicy;
}

function snapshotError(code: string, reason: SkillDomainCode, stage?: string): AgentToolError {
    const domainError = skillDomainDescriptor(reason, stage ? { stage } : undefined);
    return Object.assign(new AgentToolError(code, domainError.fallbackEnglish, { params: { reason, ...(stage ? { stage } : {}) } }),
        { domainError, data: { domainError } });
}

function within(root: string, target: string): boolean {
    const child = relative(root, target);
    return child === '' || !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`);
}

/** Body and permission declaration must come from the same bounded host read. */
export async function readVerifiedAgentSkill(
    reference: Pick<DesktopAgentSkill, 'name' | 'sourcePath' | 'sourceSha256'>,
    approvedRoots: readonly string[]
): Promise<VerifiedAgentSkill> {
    if (!reference || typeof reference.sourcePath !== 'string' || !isAbsolute(reference.sourcePath)
        || reference.sourcePath.includes('\0') || basename(reference.sourcePath) !== 'SKILL.md'
        || typeof reference.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sourceSha256)) {
        throw snapshotError('INVALID_SKILL_SOURCE', 'SKILL_REFERENCE_INVALID');
    }
    const sourcePath = await realpath(reference.sourcePath);
    const roots = await Promise.all(approvedRoots.map(root => realpath(root).catch(() => undefined)));
    if (!roots.some(root => root && within(root, sourcePath))) {
        throw snapshotError('SKILL_SOURCE_UNAPPROVED', 'SKILL_SOURCE_UNAPPROVED');
    }
    const handle = await open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let bytes: Buffer;
    try {
        const before = await handle.stat();
        if (!before.isFile()) throw snapshotError('INVALID_SKILL_SOURCE', 'SKILL_SOURCE_NOT_FILE');
        if (before.size > SKILL_LIMITS.fileBytes) throw new SkillFormatError('INVALID_SKILL_SOURCE', 'SKILL_SOURCE_TOO_LARGE');
        const buffer = Buffer.alloc(SKILL_LIMITS.fileBytes + 1);
        let count = 0;
        while (count < buffer.length) {
            const read = await handle.read(buffer, count, buffer.length - count, count);
            if (!read.bytesRead) break;
            count += read.bytesRead;
        }
        const after = await handle.stat();
        const current = await stat(sourcePath);
        if (count > SKILL_LIMITS.fileBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs
            || after.dev !== current.dev || after.ino !== current.ino || await realpath(reference.sourcePath) !== sourcePath) {
            throw snapshotError('SKILL_SOURCE_CHANGED', 'SKILL_SOURCE_CHANGED', 'loading');
        }
        bytes = buffer.subarray(0, count);
    } finally { await handle.close(); }
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    if (sourceSha256 !== reference.sourceSha256) throw snapshotError('SKILL_SOURCE_CHANGED', 'SKILL_SOURCE_CHANGED');
    const parsed = parseNextMuxSkill(decodeSkillBytes(bytes), reference.name);
    const allowedTools = parsed.allowedTools;
    const policy = validatedSkillPolicy({
        id: createHash('sha256').update(sourcePath).digest('hex'), name: parsed.name, sourceHash: sourceSha256,
        ...(allowedTools === undefined ? {} : { allowedToolNames: allowedTools })
    });
    return Object.freeze({ sourcePath, sourceSha256, name: parsed.name, description: parsed.description,
        instructions: parsed.instructions, ...(allowedTools === undefined ? {} : { allowedTools }), policy });
}
