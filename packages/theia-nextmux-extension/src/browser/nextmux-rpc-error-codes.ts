import { MsgPackExtensionManager } from '@theia/core/lib/common/message-rpc/msg-pack-extension-manager';
// Registers Theia's own error extension (tag 1) before it is wrapped below.
import '@theia/core/lib/common/message-rpc';

/**
 * Backend errors reach the frontend with their `code` (REVISION_CONFLICT, AGENT_CANCELLED …).
 *
 * Theia's RPC writes an error's `code` and `data`, but rebuilds an ordinary Error with only its message,
 * name and stack, so every `error.code === '…'` check in the frontend silently never matched (a second
 * re-film hit a revision conflict that should have been retried; a cancelled adaptation showed as failed).
 * The existing extension is kept and its reader wrapped, so the wire format does not change.
 */
export function keepRpcErrorCodes(): void {
    const extension = MsgPackExtensionManager.getInstance().getExtension(1) as
        { deserialize: (data: Record<string, unknown>) => unknown; nextmuxCodes?: boolean } | undefined;
    if (!extension || extension.nextmuxCodes) return;
    const read = extension.deserialize.bind(extension);
    extension.deserialize = data => {
        const error = read(data) as Error & { code?: unknown; data?: unknown };
        if (error instanceof Error) {
            if (error.code === undefined && (typeof data.code === 'string' || typeof data.code === 'number')) error.code = data.code;
            if (error.data === undefined && data.data !== undefined) error.data = data.data;
        }
        return error;
    };
    extension.nextmuxCodes = true;
}
