import { injectable } from '@theia/core/shared/inversify';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import {
    Message,
    MessageClient,
    ProgressMessage,
    ProgressUpdate
} from '@theia/core/lib/common/message-service-protocol';
import { FileSystemWatcherErrorHandler } from '@theia/filesystem/lib/browser/filesystem-watcher-error-handler';

const WATCHER_EXHAUSTED_RE = /Unable to watch for file changes in this large workspace/i;

/**
 * Replaces Theia's stock FileSystemWatcherErrorHandler, which otherwise shows a
 * raw English VSCode Linux ENOSPC popup ("Unable to watch for file changes in
 * this large workspace... [Instructions]") whenever @parcel/watcher errors on a
 * deleted or unmounted project folder. Instead, we emit a DOM event so
 * NextMuxDesktopWidget can immediately check whether the project directory was
 * removed and show NextMux's own localized notice.
 */
@injectable()
export class NextMuxFileSystemWatcherErrorHandler extends FileSystemWatcherErrorHandler {
    protected override get instructionsLink(): string {
        return '';
    }

    override async handleError(): Promise<void> {
        this.watchHandlesExhausted = true;
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('nextmux:filesystem-watcher-error'));
        }
    }
}

/**
 * Replaces Theia's NotificationsMessageClient so stock `.theia-Notification`
 * popups never appear in the NextMux shell.
 */
@injectable()
export class NextMuxMessageClient extends MessageClient {
    override showMessage(message: Message): Promise<string | undefined> {
        const text = typeof message?.text === 'string' ? message.text.trim() : '';
        if (!text) {
            return Promise.resolve(undefined);
        }
        if (WATCHER_EXHAUSTED_RE.test(text)) {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('nextmux:filesystem-watcher-error'));
            }
            return Promise.resolve(undefined);
        }
        if (Array.isArray(message.actions) && message.actions.length > 0) {
            return super.showMessage(message);
        }
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('nextmux:theia-message', { detail: message }));
        }
        return Promise.resolve(undefined);
    }

    override showProgress(
        _progressId: string,
        _message: ProgressMessage,
        _cancellationToken: CancellationToken
    ): Promise<string | undefined> {
        return Promise.resolve(undefined);
    }

    override reportProgress(
        _progressId: string,
        _update: ProgressUpdate,
        _message: ProgressMessage,
        _cancellationToken: CancellationToken
    ): Promise<void> {
        return Promise.resolve();
    }
}
