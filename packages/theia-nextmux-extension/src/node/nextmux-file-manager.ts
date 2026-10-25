import { execFile } from 'child_process';
import { access, cp, lstat, readdir, realpath, rename, stat } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep, posix, win32 } from 'path';

interface FileManagerError extends Error {
    readonly code?: string | number;
    readonly killed?: boolean;
    readonly signal?: string | null;
}

export interface FileManagerOptions {
    readonly platform?: NodeJS.Platform;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly inspect?: (path: string) => Promise<{ isDirectory(): boolean }>;
    readonly execute?: (command: string, args: string[], options: { timeout: number; windowsHide: boolean },
        callback: (error: FileManagerError | null) => void) => unknown;
}

/** Fixed programs and argument arrays; user paths never become shell commands. */
export async function openFileManager(path: string, mode: 'folder' | 'reveal', options: FileManagerOptions = {}): Promise<boolean> {
    const platform = options.platform || process.platform;
    const paths = platform === 'win32' ? win32 : posix;
    if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0') || !paths.isAbsolute(path)) return false;
    try {
        const target = await (options.inspect || stat)(path);
        if (mode === 'folder' && !target.isDirectory()) return false;
    } catch { return false; }
    const env = options.env || process.env;
    const command = platform === 'darwin' ? '/usr/bin/open'
        : platform === 'win32' ? win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'explorer.exe') : 'xdg-open';
    const args = platform === 'darwin' ? mode === 'reveal' ? ['-R', path] : [path]
        : platform === 'win32' ? [mode === 'reveal' ? `/select,${path}` : path]
            : [mode === 'reveal' ? paths.dirname(path) : path];
    return new Promise(resolve => {
        try {
            (options.execute || execFile)(command, args, { timeout: 10_000, windowsHide: platform !== 'win32' }, error => {
                // Explorer sometimes exits with 1 after handing the request to its existing instance.
                // Missing executables, access failures, signals and timeouts must still report failure.
                resolve(!error || platform === 'win32' && error.code === 1 && !error.killed && !error.signal);
            });
        } catch { resolve(false); }
    });
}

export class WorkspaceFileOperationError extends Error {
    constructor(readonly code: 'outside' | 'exists' | 'unsafe' | 'changed' | 'limit' | 'cross_device' | 'failed') {
        super(code);
    }
}

/** Complete lstat/readdir preflight; never follows links or falls back from rename to copying/deleting. */
export async function copyOrMoveWorkspaceFile(workspaceRoot: string, sourcePath: string, destinationPath: string, operation: 'copy' | 'move'): Promise<void> {
    const fail = (code: ConstructorParameters<typeof WorkspaceFileOperationError>[0]): never => { throw new WorkspaceFileOperationError(code); };
    if (!['copy', 'move'].includes(operation) || [workspaceRoot, sourcePath, destinationPath].some(value =>
        typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || /[\0\r\n]/u.test(value))) fail('outside');
    const inside = (root: string, candidate: string): boolean => {
        const part = relative(root, candidate);
        return !part || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
    };
    const samePath = (left: string, right: string): boolean => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
    const inputRoot = resolve(workspaceRoot), root = await realpath(inputRoot);
    const canonical = (value: string): string => {
        const input = resolve(value);
        if (!inside(inputRoot, input)) fail('outside');
        return join(root, relative(inputRoot, input));
    };
    const source = canonical(sourcePath), destination = canonical(destinationPath);
    if (samePath(source, root) || samePath(destination, root) || inside(source, destination)) fail('outside');
    const inspect = async (path: string): Promise<Awaited<ReturnType<typeof lstat>>> => {
        if (!inside(root, path)) fail('outside');
        const parts = relative(root, path).split(sep).filter(Boolean);
        let current = root, metadata = await lstat(root);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail('unsafe');
        for (let index = 0; index < parts.length; index += 1) {
            current = join(current, parts[index]); metadata = await lstat(current);
            if (metadata.isSymbolicLink() || !metadata.isFile() && !metadata.isDirectory()
                || index < parts.length - 1 && !metadata.isDirectory()) fail('unsafe');
        }
        if (!samePath(await realpath(path), path)) fail('unsafe');
        return metadata;
    };
    const absent = async (path: string): Promise<void> => {
        try { await lstat(path); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
        fail('exists');
    };
    const equal = (left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean =>
        left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.size === right.size
            && left.mtimeMs === right.mtimeMs && left.isDirectory() === right.isDirectory();
    const snapshot = async (start: string): Promise<Map<string, Awaited<ReturnType<typeof lstat>>>> => {
        const entries = new Map<string, Awaited<ReturnType<typeof lstat>>>(), seen = new Set<string>();
        const queue = [{ path: start, depth: 0 }];
        for (let index = 0; index < queue.length; index += 1) {
            const item = queue[index];
            if (item.depth > 64 || entries.size >= 100_000) fail('limit');
            const metadata = await inspect(item.path);
            entries.set(item.path, metadata);
            if (metadata.isDirectory()) {
                const identity = `${metadata.dev}:${metadata.ino}`;
                if (seen.has(identity)) fail('unsafe');
                seen.add(identity);
                // No omitted entries or empty-on-error fallback: any readdir/lstat error rejects the operation.
                const names = await readdir(item.path);
                if (names.length + queue.length > 100_000) fail('limit');
                for (const name of names) queue.push({ path: join(item.path, name), depth: item.depth + 1 });
            } else await access(item.path, fsConstants.R_OK);
        }
        return entries;
    };
    const parent = dirname(destination), parentBefore = await inspect(parent);
    if (!parentBefore.isDirectory()) fail('unsafe');
    const dirAccessMode = process.platform === 'win32' ? fsConstants.F_OK : fsConstants.W_OK;
    await access(parent, dirAccessMode);
    await absent(destination);
    const approved = await snapshot(source);
    const sourceBefore = approved.get(source)!;
    if (operation === 'move') {
        await inspect(dirname(source)); await access(dirname(source), dirAccessMode);
        await access(source, sourceBefore.isDirectory() ? dirAccessMode : fsConstants.W_OK);
        if (!equal(sourceBefore, await inspect(source)) || !equal(parentBefore, await inspect(parent))) fail('changed');
        await absent(destination);
        try { await rename(source, destination); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EXDEV') fail('cross_device');
            throw error;
        }
        return;
    }
    await cp(source, destination, {
        recursive: true, dereference: false, force: false, errorOnExist: true, mode: fsConstants.COPYFILE_EXCL,
        filter: async (from, to) => {
            const expected = approved.get(from);
            if (!expected || !samePath(to, join(destination, relative(source, from))) || !equal(expected, await inspect(from))) fail('changed');
            const targetParent = await inspect(dirname(to));
            if (!targetParent.isDirectory()) fail('unsafe');
            await absent(to);
            return true; // Rejecting an entry throws; it is never skipped and reported as a complete copy.
        }
    });
    const after = await snapshot(source), copied = await snapshot(destination);
    if (after.size !== approved.size || copied.size !== approved.size) fail('changed');
    for (const [from, expected] of approved) {
        const actual = after.get(from), target = copied.get(join(destination, relative(source, from)));
        if (!actual || !equal(expected, actual) || !target || target.isDirectory() !== expected.isDirectory()
            || !target.isDirectory() && target.size !== expected.size) fail('changed');
    }
    // Node's path-based APIs cannot provide atomic NOREPLACE rename or eliminate hostile cross-process TOCTOU.
    // Failures preserve source data and any partial new destination; no automatic cleanup, retry or deletion occurs.
}
