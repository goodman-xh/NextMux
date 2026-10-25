import { ConversationDomainError } from '../common/nextmux-conversation-domain-errors';
import { lstat, realpath } from 'fs/promises';
import { isAbsolute } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export interface ArchiveDirectoryBinding {
    readonly selectedUri: string;
    readonly directoryUri: string;
    readonly directoryPath: string;
    readonly device: string;
    readonly inode: string;
    readonly birthtime: string;
}

export class ArchiveProjectBindingError extends ConversationDomainError {
    constructor(readonly code: 'ARCHIVE_BINDING_INVALID' | 'ARCHIVE_BINDING_CHANGED') {
        super(code, code === 'ARCHIVE_BINDING_CHANGED' ? 'binding_changed' : 'binding_invalid');
        this.name = 'ArchiveProjectBindingError';
    }
}

/** Inspect only the explicitly selected directory; no search, mkdir, files or permissions changes. */
export async function captureArchiveDirectoryBinding(uri: unknown): Promise<ArchiveDirectoryBinding> {
    try {
        if (typeof uri !== 'string' || uri.length > 32_768 || /[\x00-\x1f\x7f-\x9f]/.test(uri)) throw new Error();
        const url = new URL(uri);
        if (url.protocol !== 'file:' || url.hostname || url.search || url.hash || url.username || url.password) throw new Error();
        const selected = fileURLToPath(url);
        if (!isAbsolute(selected) || selected.startsWith('//') || selected.startsWith('\\\\')
            || /[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(selected)) throw new Error();
        const before = await lstat(selected, { bigint: true });
        if (!before.isDirectory() || before.isSymbolicLink()) throw new Error();
        const path = await realpath(selected);
        const after = await lstat(selected, { bigint: true });
        const canonical = await lstat(path, { bigint: true });
        if (!after.isDirectory() || after.isSymbolicLink() || after.ino <= 0n || !canonical.isDirectory() || canonical.isSymbolicLink()
            || before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs
            || canonical.dev !== after.dev || canonical.ino !== after.ino || canonical.birthtimeNs !== after.birthtimeNs) throw new Error();
        return { selectedUri: url.href, directoryUri: pathToFileURL(path).href, directoryPath: path,
            device: after.dev.toString(), inode: after.ino.toString(), birthtime: after.birthtimeNs.toString() };
    } catch { throw new ArchiveProjectBindingError('ARCHIVE_BINDING_INVALID'); }
}

export async function verifyArchiveDirectoryBinding(binding: ArchiveDirectoryBinding): Promise<void> {
    try {
        const current = await captureArchiveDirectoryBinding(binding.selectedUri);
        if (current.directoryUri !== binding.directoryUri || current.device !== binding.device
            || current.inode !== binding.inode || current.birthtime !== binding.birthtime) throw new Error();
    } catch { throw new ArchiveProjectBindingError('ARCHIVE_BINDING_CHANGED'); }
}
