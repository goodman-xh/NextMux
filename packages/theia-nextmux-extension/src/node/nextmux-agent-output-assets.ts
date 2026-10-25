import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { lstat, mkdir, open, realpath, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { normalizeAgentOutputParts } from '@nextmux/agent-runtime/output-parts';
import type { AgentOutputAsset, AgentOutputPart } from '@nextmux/agent-runtime';
import type { OfficialModelOutputPart } from '@nextmux/model-runtime';
import { hasSafeImageDimensions } from '@nextmux/model-runtime';
import { publishConversationArchiveFile } from './nextmux-conversation-archive';

const MiB = 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * MiB;
const formats = {
    'image/png': { type: 'image', extension: 'png', maximum: 10 * MiB },
    'image/jpeg': { type: 'image', extension: 'jpg', maximum: 10 * MiB },
    'image/webp': { type: 'image', extension: 'webp', maximum: 10 * MiB },
    'image/gif': { type: 'image', extension: 'gif', maximum: 10 * MiB },
    'audio/wav': { type: 'audio', extension: 'wav', maximum: 24 * MiB },
    'audio/mpeg': { type: 'audio', extension: 'mp3', maximum: 24 * MiB },
    'audio/ogg': { type: 'audio', extension: 'ogg', maximum: 24 * MiB },
    'audio/flac': { type: 'audio', extension: 'flac', maximum: 24 * MiB }
} as const;

type SupportedMimeType = keyof typeof formats;

export interface AgentOutputAssetReadResult extends AgentOutputAsset {
    readonly dataBase64: string;
}

function digest(bytes: Uint8Array | string): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function owner(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 300 || /[\0\r\n]/.test(normalized)) throw new Error('AGENT_OUTPUT_OWNER_INVALID');
    return normalized;
}

function supportedAsset(asset: AgentOutputAsset): { readonly type: 'image' | 'audio'; readonly extension: string; readonly maximum: number } {
    const format = formats[asset.mimeType as SupportedMimeType];
    if (!format || !/^[a-f0-9]{64}$/.test(asset.sha256)
        || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 || asset.sizeBytes > format.maximum) {
        throw new Error('AGENT_OUTPUT_ASSET_INVALID');
    }
    return format;
}

async function safeDirectory(path: string, recursive = false): Promise<string> {
    await mkdir(path, { recursive, mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    const info = await lstat(path);
    const canonical = await realpath(path);
    if (!info.isDirectory() || info.isSymbolicLink() || canonical !== resolve(path)) throw new Error('AGENT_OUTPUT_STORAGE_UNSAFE');
    return canonical;
}

async function existingDirectory(path: string): Promise<string> {
    const info = await lstat(path);
    const canonical = await realpath(path);
    if (!info.isDirectory() || info.isSymbolicLink() || canonical !== resolve(path)) throw new Error('AGENT_OUTPUT_STORAGE_UNSAFE');
    return canonical;
}

async function ownerDirectory(dataRoot: string, ownerId: string, create = true): Promise<string> {
    const ownerDigest = digest(owner(ownerId));
    if (!create) {
        const root = await existingDirectory(resolve(dataRoot));
        const assets = await existingDirectory(join(root, 'agent-output-assets-v1'));
        return existingDirectory(join(assets, ownerDigest));
    }
    const root = await safeDirectory(resolve(dataRoot), true);
    const assets = await safeDirectory(join(root, 'agent-output-assets-v1'));
    return safeDirectory(join(assets, ownerDigest));
}

async function readVerified(path: string, expected: AgentOutputAsset): Promise<Buffer> {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== expected.sizeBytes) throw new Error('AGENT_OUTPUT_ASSET_MISMATCH');
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== expected.sizeBytes) {
            throw new Error('AGENT_OUTPUT_ASSET_MISMATCH');
        }
        const bytes = Buffer.alloc(expected.sizeBytes);
        let offset = 0;
        while (offset < bytes.length) {
            const next = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (!next.bytesRead) throw new Error('AGENT_OUTPUT_ASSET_MISMATCH');
            offset += next.bytesRead;
        }
        if ((await handle.read(Buffer.alloc(1), 0, 1, bytes.length)).bytesRead
            || (await handle.stat()).size !== bytes.length || digest(bytes) !== expected.sha256) {
            throw new Error('AGENT_OUTPUT_ASSET_MISMATCH');
        }
        return bytes;
    } finally {
        await handle.close();
    }
}

async function persistAsset(directory: string, part: Exclude<OfficialModelOutputPart, { readonly type: 'text' }>): Promise<AgentOutputPart> {
    const format = formats[part.mimeType as SupportedMimeType];
    if (!format || format.type !== part.type || typeof part.dataBase64 !== 'string' || part.dataBase64.length % 4 !== 0) {
        throw new Error('AGENT_OUTPUT_ASSET_INVALID');
    }
    const bytes = Buffer.from(part.dataBase64, 'base64');
    if (!bytes.length || bytes.length !== part.sizeBytes || bytes.length > format.maximum
        || bytes.toString('base64') !== part.dataBase64
        || part.type === 'image' && !hasSafeImageDimensions(bytes, part.mimeType)
        || part.mimeType === 'audio/wav' && !(bytes.length >= 44 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WAVE')
        || part.mimeType === 'audio/mpeg' && !(bytes.length >= 4 && (bytes.toString('latin1', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
        || part.mimeType === 'audio/ogg' && !(bytes.length >= 27 && bytes.toString('latin1', 0, 4) === 'OggS')
        || part.mimeType === 'audio/flac' && !(bytes.length >= 8 && bytes.toString('latin1', 0, 4) === 'fLaC')) throw new Error('AGENT_OUTPUT_ASSET_INVALID');
    const asset = Object.freeze({ sha256: digest(bytes), mimeType: part.mimeType, sizeBytes: bytes.length });
    const target = join(directory, `${asset.sha256}.${format.extension}`);
    try {
        await readVerified(target, asset);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const temporary = join(directory, `.write-${randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        try {
            await publishConversationArchiveFile(temporary, target, bytes);
        } catch (publishError) {
            if ((publishError as { code?: string }).code !== 'ARCHIVE_DESTINATION_EXISTS') throw publishError;
        } finally {
            await unlink(temporary).catch(() => undefined);
        }
        await readVerified(target, asset);
    }
    return Object.freeze({ type: format.type, asset });
}

/** Convert Node-memory-only provider bytes into durable, owner-scoped references. */
export async function persistAgentOutputParts(
    dataRoot: string,
    ownerId: string,
    parts: readonly OfficialModelOutputPart[]
): Promise<readonly AgentOutputPart[]> {
    if (!Array.isArray(parts) || parts.length > 64) throw new Error('AGENT_OUTPUT_PARTS_INVALID');
    const directory = await ownerDirectory(dataRoot, ownerId);
    let total = 0;
    const result: AgentOutputPart[] = [];
    for (const part of parts) {
        if (part.type === 'text') {
            result.push(Object.freeze({ type: 'text', text: part.text }));
            continue;
        }
        total += part.sizeBytes;
        if (total > MAX_TOTAL_BYTES) throw new Error('AGENT_OUTPUT_PARTS_INVALID');
        result.push(await persistAsset(directory, part));
    }
    return normalizeAgentOutputParts(result) || [];
}

/** Dedicated binary RPC boundary. Raw bytes never enter run events or conversation JSON. */
export async function verifiedAgentOutputAssetPath(dataRoot:string,ownerId:string,asset:AgentOutputAsset):Promise<string>{
    const format=supportedAsset(asset),directory=await ownerDirectory(dataRoot,ownerId,false);
    const pathname=join(directory,`${asset.sha256}.${format.extension}`);
    await readVerified(pathname,asset);
    return pathname;
}

export async function readAgentOutputAsset(
    dataRoot: string,
    ownerId: string,
    asset: AgentOutputAsset
): Promise<AgentOutputAssetReadResult> {
    const format = supportedAsset(asset);
    const normalized = normalizeAgentOutputParts([{ type: format.type, asset }])?.[0];
    if (!normalized || normalized.type === 'text') throw new Error('AGENT_OUTPUT_ASSET_INVALID');
    const directory = await ownerDirectory(dataRoot, ownerId, false);
    const bytes = await readVerified(join(directory, `${asset.sha256}.${format.extension}`), normalized.asset);
    return { ...normalized.asset, dataBase64: bytes.toString('base64') };
}
