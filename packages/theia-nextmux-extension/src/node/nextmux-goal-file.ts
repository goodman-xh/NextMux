import { constants } from 'fs';
import { link, lstat, mkdir, open, realpath, rename, rm } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { join, resolve } from 'path';
import type { AgentFileState, AgentFileStateRequest, AgentFileVersionSaveRequest } from '../common/nextmux-platform-protocol';
// Pure parsing shared with the goal editor, so the runtime receives exactly the objective the user sees.
import { goalFileObjective } from '../browser/nextmux-goal-file-format';

const lockfile = require('proper-lockfile') as { lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>> };
const MAX_BYTES = 256 * 1024;
const goalPath = /^\.nextmux\/goals\/([0-9a-f-]{36})\.md$/i;
const failure = (code: string, message: string): Error => Object.assign(new Error(message), { code });

export function isCodingGoalPath(path: string | undefined): boolean {
    return typeof path === 'string' && goalPath.test(path.replace(/\\/g, '/'));
}

/** The objective (without metadata or heading) and status of a goal file; undefined when it is not a goal record. */
export function codingGoalFileObjective(content: unknown): { readonly objective: string; readonly status: string } | undefined {
    if (typeof content !== 'string') return undefined;
    const normalized = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const header = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
    if (!header) return undefined;
    const status = header[1].split('\n').find(line => line.startsWith('status:'))?.slice('status:'.length).trim() ?? '';
    const objective = goalFileObjective(normalized.slice(header[0].length)).slice(0, 20_000).trim();
    return objective ? { objective, status } : undefined;
}

/** Only this explicit editor path may touch goal metadata; model tools still reject .nextmux. */
async function targetFor(request: AgentFileStateRequest, create: boolean): Promise<string> {
    if (request.checkpointId || !isCodingGoalPath(request.path) || !/^[0-9a-f-]{36}$/i.test(request.conversationId)) {
        throw failure('INVALID_GOAL_FILE', '目标文件路径无效。');
    }
    const root = await realpath(request.workspaceRoot);
    let directory = root;
    for (const name of ['.nextmux', 'goals']) {
        directory = join(directory, name);
        if (create) await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        try {
            const info = await lstat(directory);
            if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
                throw failure('INVALID_GOAL_FILE', '目标文件目录已改变，请重新打开。');
            }
        } catch (error) {
            if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') break;
            throw error;
        }
    }
    return resolve(root, request.path!.replace(/\\/g, '/'));
}

async function readTarget(path: string): Promise<AgentFileState & { content: string }> {
    let file;
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw failure('INVALID_GOAL_FILE', '目标文件不是普通文件。');
        file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return { path, exists: false, sha256: null, mode: null, size: 0, content: '' };
    }
    try {
        const before = await file.stat();
        if (!before.isFile() || before.size > MAX_BYTES) throw failure('INVALID_GOAL_FILE', '目标文件过大或不是普通文件。');
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
        }
        const bytes = buffer.subarray(0, length);
        const after = await file.stat();
        const current = await lstat(path);
        if (current.isSymbolicLink() || current.dev !== after.dev || current.ino !== after.ino
            || bytes.length > MAX_BYTES || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
            throw failure('ROLLBACK_CONFLICT', '目标文件已在其他位置修改，请重新打开后再保存。');
        }
        return { path, exists: true, sha256: createHash('sha256').update(bytes).digest('hex'), mode: after.mode, size: bytes.length,
            content: bytes.toString('utf8') };
    } finally { await file.close(); }
}

/** The objective stored in a goal file now; undefined when the file is absent or not a goal record. */
export async function readCodingGoalFileObjective(request: AgentFileStateRequest): Promise<string | undefined> {
    const current = await readTarget(await targetFor(request, false));
    return current.exists ? codingGoalFileObjective(current.content)?.objective : undefined;
}

export async function readCodingGoalFile(request: AgentFileStateRequest): Promise<AgentFileState> {
    const { content: _content, ...state } = await readTarget(await targetFor(request, false));
    return state;
}

/** Same optimistic SHA comparison as the file editor, with an atomic replacement and a per-file writer lock. */
export async function writeCodingGoalFile(request: AgentFileVersionSaveRequest): Promise<AgentFileState> {
    const goalId = request.path?.replace(/\\/g, '/').match(goalPath)?.[1];
    if (typeof request.content !== 'string' || Buffer.byteLength(request.content, 'utf8') > MAX_BYTES
        || request.expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(request.expectedSha256)) {
        throw failure('INVALID_GOAL_FILE', '目标文件内容无效。');
    }
    const header = request.content.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const value = (key: string): string | undefined => header?.split(/\r?\n/).find(line => line.startsWith(`${key}:`))?.slice(key.length + 1).trim();
    if (value('conversationId') !== request.conversationId || value('goalId') !== goalId) {
        throw failure('INVALID_GOAL_FILE', '请保留目标文件的所属对话和目标编号。');
    }
    const target = await targetFor(request, true);
    const release = await lockfile.lock(target, { realpath: false, stale: 30_000,
        retries: { retries: 50, minTimeout: 10, maxTimeout: 100 } });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
        const current = await readTarget(target);
        if (current.sha256 !== request.expectedSha256) throw failure('ROLLBACK_CONFLICT', '目标文件已在其他位置修改，请重新打开后再保存。');
        const file = await open(temporary, 'wx', current.mode === null ? 0o600 : current.mode & 0o777);
        try { await file.writeFile(request.content, 'utf8'); await file.sync(); } finally { await file.close(); }
        if (await targetFor(request, false) !== target || (await readTarget(target)).sha256 !== current.sha256) {
            throw failure('ROLLBACK_CONFLICT', '目标文件已在其他位置修改，请重新打开后再保存。');
        }
        // An absent file must never overwrite one created by another editor.
        if (!current.exists) {
            try { await link(temporary, target); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw failure('ROLLBACK_CONFLICT', '目标文件已创建，请重新打开。'); throw error; }
        } else await rename(temporary, target);
        return { path: target, exists: true, sha256: createHash('sha256').update(request.content).digest('hex'),
            mode: current.mode ?? 0o600, size: Buffer.byteLength(request.content, 'utf8') };
    } finally { await rm(temporary, { force: true }); await release(); }
}
