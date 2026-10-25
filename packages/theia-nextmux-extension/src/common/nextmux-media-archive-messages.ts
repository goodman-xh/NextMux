import { mediaMessage, type MediaMessage } from './nextmux-media-messages';

/** Archive identities share the media-domain RPC and browser presentation contract. */
export function archiveMediaMessage(key: string, params: MediaMessage['params'] = {}, detail?: unknown): MediaMessage {
    return mediaMessage(`archive.${key}`, params, detail);
}
