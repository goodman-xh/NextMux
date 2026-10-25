import { SkillDomainError } from '../common/nextmux-skill-domain';
import { createHash } from 'crypto';

export interface CommunitySkillFileIdentity {
    readonly path: string;
    readonly sha: string;
    readonly type: string;
    readonly mode?: string;
    readonly size?: number;
}

export function isCommunityGitSha(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

/** Reject names that alias or escape another file on any supported desktop OS. */
export function assertCommunitySkillRelativePath(path: string): void {
    if (!path || path.length > 1_024 || path.split('/').some(segment => !segment || segment === '.' || segment === '..'
        || /[\\<>:"|?*\x00-\x1f\x7f]/.test(segment) || /[. ]$/.test(segment)
        || /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(segment)
        || ['.nextmux-skill.json', '.git', '.hg', '.svn'].includes(segment.toLowerCase()))) {
        throw new SkillDomainError('SKILL_PATH_UNSAFE');
    }
}

export function assertCommunitySkillFiles(files: readonly CommunitySkillFileIdentity[], prefix: string): void {
    const names = new Set<string>();
    const spellings = new Map<string, string>();
    for (const file of files) {
        if (!file.path.startsWith(prefix) || file.type !== 'blob' || !['100644', '100755'].includes(file.mode || '')
            || !isCommunityGitSha(file.sha) || !Number.isSafeInteger(file.size) || file.size! < 0) {
            throw new SkillDomainError('SKILL_FILE_IDENTITY_INVALID');
        }
        const relativePath = file.path.slice(prefix.length);
        assertCommunitySkillRelativePath(relativePath);
        const key = relativePath.normalize('NFC').toLowerCase();
        if (names.has(key)) throw new SkillDomainError('SKILL_FILE_COLLISION');
        names.add(key);
        const segments = relativePath.split('/');
        for (let length = 1; length <= segments.length; length++) {
            const spelling = segments.slice(0, length).join('/');
            const identity = spelling.normalize('NFC').toLowerCase();
            if (spellings.has(identity) && spellings.get(identity) !== spelling) throw new SkillDomainError('SKILL_DIRECTORY_COLLISION');
            spellings.set(identity, spelling);
        }
    }
    for (const name of names) {
        const segments = name.split('/');
        for (let length = 1; length < segments.length; length++) {
            if (names.has(segments.slice(0, length).join('/'))) throw new SkillDomainError('SKILL_FILE_DIRECTORY_COLLISION');
        }
    }
}

/** Git's blob identity includes the object header, not just the file bytes. */
export function verifyCommunitySkillBlob(bytes: Uint8Array, expectedSha: string): string {
    const actual = createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
    if (!isCommunityGitSha(expectedSha) || actual !== expectedSha) throw new SkillDomainError('SKILL_HASH_MISMATCH');
    return createHash('sha256').update(bytes).digest('hex');
}

export async function readBoundedCommunitySkillBody(response: Response, maximum: number): Promise<Uint8Array> {
    if (Number(response.headers.get('content-length') || 0) > maximum) {
        await response.body?.cancel().catch(() => undefined);
        throw new SkillDomainError('SKILL_BODY_TOO_LARGE', { limitBytes: maximum });
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximum) throw new SkillDomainError('SKILL_BODY_TOO_LARGE', { limitBytes: maximum });
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
}
