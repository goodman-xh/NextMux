import { createHash } from 'crypto';
import { constants } from 'fs';
import { open } from 'fs/promises';
import { join } from 'path';
import { parseSkillFile } from '@theia/ai-core/lib/common/skill';
import { validatedAllowedToolNames } from '@nextmux/agent-runtime';
import type { DesktopCommunitySkillMetadata as Metadata, DesktopCommunitySkillPermissionChange as Change } from '../common/nextmux-platform-protocol';
import { SKILL_LIMITS } from '../common/nextmux-skill-format';
import { isCommunityGitSha, verifyCommunitySkillBlob } from './nextmux-community-skill-integrity';

type Source = Omit<Metadata['source'], 'status' | 'sha256'>;
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown, maximum: number): string | undefined => typeof value === 'string' && value.trim().length > 0
    && value.length <= maximum && !/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value) ? value.trim() : undefined;

function strings(value: unknown, maximum: number, length: number, allowed?: readonly string[]): string[] | undefined {
    if (!Array.isArray(value) || value.length > maximum || value.some(item => !text(item, length) || allowed && !allowed.includes(item))) return undefined;
    return [...new Set(value as string[])].sort();
}

export function unknownCommunitySkillMetadata(source: Partial<Source> = {}, status: Metadata['source']['status'] = 'unknown'): Metadata {
    return {
        schemaVersion: 1, license: { status: 'unknown' },
        compatibility: { operatingSystems: { status: 'unknown', values: [] }, architectures: { status: 'unknown', values: [] } },
        dependencies: { status: 'unknown', items: [] }, tools: { mode: 'unknown', allowedToolNames: [] },
        source: { status, repository: text(source.repository, 200) || '', path: text(source.path, 1024) || '',
            ...(isCommunityGitSha(source.revision) ? { revision: source.revision } : {}),
            ...(isCommunityGitSha(source.treeSha) ? { treeSha: source.treeSha } : {}),
            ...(isCommunityGitSha(source.blobSha) ? { blobSha: source.blobSha } : {}) },
        issues: []
    };
}

/** Project only bounded declarations from verified bytes. Never executes scripts or installs dependencies. */
export function communitySkillMetadata(bytes: Uint8Array, source: Source): Metadata {
    const empty = unknownCommunitySkillMetadata(source);
    const verified = isCommunityGitSha(source.revision) && isCommunityGitSha(source.treeSha) && isCommunityGitSha(source.blobSha);
    if (verified) verifyCommunitySkillBlob(bytes, source.blobSha!);
    const evidence: Metadata['source'] = { ...empty.source, status: verified ? 'verified' : 'unknown', sha256: sha256(bytes) };
    let body: string;
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return { ...empty, source: evidence, issues: ['invalid_utf8'] }; }
    // Runtime accepts at most SKILL_LIMITS.fileBytes (192 KiB). Never feed an unbounded YAML tree to the existing parser.
    if (bytes.byteLength > SKILL_LIMITS.fileBytes || body.includes('\0')) return { ...empty, source: evidence, issues: ['metadata_too_large_or_invalid'] };
    const parsed = parseSkillFile(body).metadata;
    if (!parsed) return { ...empty, source: evidence, issues: ['metadata_unreadable'] };
    const raw = parsed as unknown as Record<string, unknown>;
    const issues: string[] = [];
    const license = text(raw.license, 256);
    if (raw.license !== undefined && !license) issues.push('license_invalid');
    const notes = text(raw.compatibility, 500);
    if (raw.compatibility !== undefined && !notes) issues.push('compatibility_invalid');
    const declaration = record(record(raw.metadata)?.nextmux);
    const unsupported = declaration && declaration.schemaVersion !== 1;
    if (unsupported) issues.push('declaration_version_unsupported');
    if (record(raw.metadata)?.nextmux !== undefined && !declaration) issues.push('declaration_invalid');
    const extra = unsupported ? undefined : declaration;
    const operatingSystems = strings(extra?.operatingSystems, 3, 16, ['darwin', 'win32', 'linux']);
    const architectures = strings(extra?.architectures, 4, 16, ['x64', 'arm64', 'ia32', 'arm']);
    const dependencies = strings(extra?.dependencies, 32, 160);
    for (const [key, value] of [['operatingSystems', operatingSystems], ['architectures', architectures], ['dependencies', dependencies]] as const) {
        if (extra?.[key] !== undefined && value === undefined) issues.push(`${key}_invalid`);
    }
    let tools: Metadata['tools'];
    try {
        const alias = raw['allowed-tools'];
        const names = raw.allowedTools === undefined ? alias : raw.allowedTools;
        if (names !== undefined && (!Array.isArray(names) || names.length > 64)) throw new Error('invalid');
        const validated = validatedAllowedToolNames(names as readonly string[] | undefined);
        // Match the runtime's exact dual-declaration conflict rule, including order.
        if (alias !== undefined && raw.allowedTools !== undefined && JSON.stringify(alias) !== JSON.stringify(raw.allowedTools)) throw new Error('conflict');
        tools = validated === undefined ? { mode: 'inherit', allowedToolNames: [] }
            : { mode: 'restricted', allowedToolNames: [...validated].sort() };
    } catch { tools = { mode: 'invalid', allowedToolNames: [] }; issues.push('tool_declaration_invalid'); }
    return {
        schemaVersion: 1, license: license ? { status: 'declared', value: license } : empty.license,
        compatibility: {
            operatingSystems: operatingSystems?.length ? { status: 'declared', values: operatingSystems } : empty.compatibility.operatingSystems,
            architectures: architectures?.length ? { status: 'declared', values: architectures } : empty.compatibility.architectures,
            ...(notes ? { notes } : {})
        },
        dependencies: dependencies ? { status: 'declared', items: dependencies } : empty.dependencies,
        tools, source: evidence, issues
    };
}

/** Persistent catalog data is not authority: whitelist shape, then require re-download before mutation. */
export function storedCommunitySkillMetadata(value: unknown, source: Source): Metadata {
    const empty = unknownCommunitySkillMetadata(source), raw = record(value), evidence = record(raw?.source);
    if (raw?.schemaVersion !== 1 || !evidence || evidence.status !== 'verified'
        || evidence.repository !== source.repository || evidence.path !== source.path || evidence.revision !== source.revision
        || evidence.treeSha !== source.treeSha || !isCommunityGitSha(evidence.blobSha)
        || typeof evidence.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sha256)) return empty;
    const license = record(raw.license), compatibility = record(raw.compatibility), dependencies = record(raw.dependencies), tools = record(raw.tools);
    const os = record(compatibility?.operatingSystems), arch = record(compatibility?.architectures);
    const osValues = strings(os?.values, 3, 16, ['darwin', 'win32', 'linux']);
    const archValues = strings(arch?.values, 4, 16, ['x64', 'arm64', 'ia32', 'arm']);
    const items = strings(dependencies?.items, 32, 160), names = strings(tools?.allowedToolNames, 64, 160);
    if (!names || !['inherit', 'restricted', 'unknown', 'invalid'].includes(String(tools?.mode))) return empty;
    try { validatedAllowedToolNames(names); } catch { return empty; }
    return {
        schemaVersion: 1,
        license: license?.status === 'declared' && text(license.value, 256) ? { status: 'declared', value: text(license.value, 256) } : empty.license,
        compatibility: {
            operatingSystems: os?.status === 'declared' && osValues?.length ? { status: 'declared', values: osValues } : empty.compatibility.operatingSystems,
            architectures: arch?.status === 'declared' && archValues?.length ? { status: 'declared', values: archValues } : empty.compatibility.architectures,
            ...(text(compatibility?.notes, 500) ? { notes: text(compatibility?.notes, 500) } : {})
        },
        dependencies: dependencies?.status === 'declared' && items ? { status: 'declared', items } : empty.dependencies,
        tools: { mode: tools!.mode as Metadata['tools']['mode'], allowedToolNames: tools!.mode === 'restricted' ? names : [] },
        source: { ...empty.source, status: 'verified', blobSha: evidence.blobSha, sha256: evidence.sha256 },
        issues: strings(raw.issues, 16, 80) || []
    };
}

/** Read the installed bytes, not a possibly stale metadata manifest. Changed/unverifiable files require review. */
export async function installedCommunitySkillMetadata(location: string, source: Source, expectedSha256?: string): Promise<Metadata> {
    let handle;
    try {
        handle = await open(join(location, 'SKILL.md'), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        const info = await handle.stat();
        if (!info.isFile() || info.size > SKILL_LIMITS.fileBytes) return unknownCommunitySkillMetadata(source, 'modified');
        const buffer = Buffer.alloc(SKILL_LIMITS.fileBytes + 1);
        let length = 0;
        while (length < buffer.length) {
            const read = await handle.read(buffer, length, buffer.length - length, length);
            if (!read.bytesRead) break;
            length += read.bytesRead;
        }
        const after = await handle.stat();
        const bytes = buffer.subarray(0, length);
        if (length > SKILL_LIMITS.fileBytes || info.size !== after.size || info.mtimeMs !== after.mtimeMs) return unknownCommunitySkillMetadata(source, 'modified');
        if (!expectedSha256 || sha256(bytes) !== expectedSha256) {
            const unknown = unknownCommunitySkillMetadata(source, 'modified');
            return { ...unknown, source: { ...unknown.source, sha256: sha256(bytes) } };
        }
        return communitySkillMetadata(bytes, source);
    } catch { return unknownCommunitySkillMetadata(source, 'modified'); }
    finally { await handle?.close(); }
}

export function communitySkillPermissionChange(previous: Metadata | undefined, next: Metadata): Change {
    if (!previous) return { state: 'not_installed', added: [], removed: [], mayExpand: null, requiresReview: false };
    const unknown = previous.source.status !== 'verified' || next.source.status !== 'verified'
        || [previous.tools.mode, next.tools.mode].some(mode => mode === 'unknown' || mode === 'invalid');
    const oldNames = previous.tools.allowedToolNames, nextNames = next.tools.allowedToolNames;
    const listsComparable = !unknown && previous.tools.mode === 'restricted' && next.tools.mode === 'restricted';
    const added = listsComparable ? nextNames.filter(name => !oldNames.includes(name)) : [];
    const removed = listsComparable ? oldNames.filter(name => !nextNames.includes(name)) : [];
    const mayExpand = unknown ? null : previous.tools.mode === 'restricted'
        && (next.tools.mode === 'inherit' || added.length > 0);
    const changed = previous.tools.mode !== next.tools.mode || added.length > 0 || removed.length > 0;
    const base: Change = { state: unknown ? 'unknown' : changed ? 'changed' : 'unchanged', added, removed, mayExpand, requiresReview: unknown || mayExpand === true,
        previousMode: previous.tools.mode, nextMode: next.tools.mode };
    // Include both immutable source snapshots and the complete declared scope, not a mutable branch/name.
    const reviewToken = sha256(JSON.stringify({ version: 1, previous: { source: previous.source, tools: previous.tools }, next: { source: next.source, tools: next.tools }, change: base }));
    return { ...base, reviewToken };
}
