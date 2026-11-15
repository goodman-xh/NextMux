import { injectable } from '@theia/core/shared/inversify';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import {
    Message,
    MessageClient,
    MessageType,
    ProgressMessage,
    ProgressUpdate
} from '@theia/core/lib/common/message-service-protocol';
import { FileSystemWatcherErrorHandler } from '@theia/filesystem/lib/browser/filesystem-watcher-error-handler';

const WATCHER_EXHAUSTED_RE = /Unable to watch for file changes in this large workspace/i;

export const THEIA_MESSAGE_EVENT = 'nextmux:theia-message';
export const THEIA_CONFIRMATION_EVENT = 'nextmux:theia-confirmation';

export interface TheiaConfirmationEventDetail {
    readonly message: Message;
    readonly actions: readonly string[];
    handled: boolean;
    promise?: Promise<string | undefined>;
}

export function theiaMessageNotificationKind(type: MessageType | undefined): 'info' | 'warning' | 'error' | undefined {
    if (type === MessageType.Error) {
        return 'error';
    }
    if (type === MessageType.Warning) {
        return 'warning';
    }
    if (type === MessageType.Log) {
        return undefined;
    }
    return 'info';
}

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
        const actions = Array.isArray(message.actions)
            ? message.actions.map(action => typeof action === 'string' ? action.trim() : '').filter(Boolean)
            : [];
        if (actions.length > 0) {
            if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined' && typeof window.dispatchEvent === 'function') {
                const detail: TheiaConfirmationEventDetail = {
                    message,
                    actions,
                    handled: false
                };
                window.dispatchEvent(new CustomEvent(THEIA_CONFIRMATION_EVENT, { detail, cancelable: true }));
                if (detail.handled && detail.promise) {
                    return detail.promise;
                }
            }
            return super.showMessage(message);
        }
        if (theiaMessageNotificationKind(message.type) === undefined) {
            return Promise.resolve(undefined);
        }
        if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent(THEIA_MESSAGE_EVENT, { detail: message }));
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
