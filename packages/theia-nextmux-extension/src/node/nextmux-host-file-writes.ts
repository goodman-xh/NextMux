import { beginHostWorkspaceWrite } from '@nextmux/agent-runtime';
import URI from '@theia/core/lib/common/uri';
import { injectable } from '@theia/core/shared/inversify';
import type { FileDeleteOptions, FileOpenOptions, FileOverwriteOptions, FileWriteOptions } from '@theia/filesystem/lib/common/files';
import { DiskFileSystemProvider } from '@theia/filesystem/lib/node/disk-file-system-provider';

/**
 * Editor saves and explorer creates/renames/deletes go through this provider.
 * Recording them lets an agent command that runs meanwhile (a dev server, a
 * long build) leave them out of its checkpoint, so restoring that command can
 * never revert or delete what the user saved.
 */
@injectable()
export class NextMuxDiskFileSystemProvider extends DiskFileSystemProvider {
    protected readonly hostWrites = new Map<number, Promise<(() => Promise<void>) | undefined>>();
    protected readonly openPaths = new Map<number, string>();

    protected async beginHostWrite(paths: string[], tree = false): Promise<(() => Promise<void>) | undefined> {
        try { return await beginHostWorkspaceWrite(paths, { tree }); } catch { return undefined; }
    }

    protected async trackHostWrite<T>(paths: string[], operation: () => Promise<T>, tree = false): Promise<T> {
        const end = await this.beginHostWrite(paths, tree);
        try { return await operation(); } finally { await end?.().catch(() => undefined); }
    }

    override writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
        return this.trackHostWrite([this.toFilePath(resource)], () => super.writeFile(resource, content, opts));
    }

    override async open(resource: URI, opts: FileOpenOptions): Promise<number> {
        const filePath = this.toFilePath(resource);
        const writeOpts = opts as FileOpenOptions & { readonly write?: boolean; readonly unlock?: boolean };
        if (!writeOpts.create && !writeOpts.write && !writeOpts.unlock) {
            const fd = await super.open(resource, opts);
            this.openPaths.set(fd, filePath);
            return fd;
        }
        const pendingEnd = this.beginHostWrite([filePath]);
        try {
            const fd = await super.open(resource, opts);
            this.openPaths.set(fd, filePath);
            this.hostWrites.set(fd, pendingEnd);
            await pendingEnd;
            return fd;
        } catch (error) {
            const end = await pendingEnd;
            await end?.().catch(() => undefined);
            throw error;
        }
    }

    override async write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
        let pendingEnd = this.hostWrites.get(fd);
        if (!pendingEnd) {
            const filePath = this.openPaths.get(fd);
            if (filePath) {
                pendingEnd = this.beginHostWrite([filePath]);
                this.hostWrites.set(fd, pendingEnd);
            }
        }
        await pendingEnd;
        return super.write(fd, pos, data, offset, length);
    }

    override async close(fd: number): Promise<void> {
        this.openPaths.delete(fd);
        const pendingEnd = this.hostWrites.get(fd);
        this.hostWrites.delete(fd);
        try {
            await super.close(fd);
        } finally {
            const end = await pendingEnd;
            await end?.().catch(() => undefined);
        }
    }

    override delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
        return this.trackHostWrite([this.toFilePath(resource)], () => super.delete(resource, opts), true);
    }

    override rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
        return this.trackHostWrite([this.toFilePath(from), this.toFilePath(to)], () => super.rename(from, to, opts), true);
    }

    override copy(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
        return this.trackHostWrite([this.toFilePath(to)], () => super.copy(from, to, opts), true);
    }
}
