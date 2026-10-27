import type { DesktopBrowserToolResult } from '../common/nextmux-platform-protocol';
import { safeAgentMessageParams } from '@nextmux/agent-runtime/semantic-messages';

/** A resolved webview script is not evidence that its requested action succeeded. */
export function browserActionToolResult(requestId: string, value: unknown): DesktopBrowserToolResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Object.hasOwn(value, 'ok') || typeof (value as { ok?: unknown }).ok !== 'boolean') {
        return { requestId, ok: false, message: 'The browser did not return a valid action result.' };
    }
    const result = value as { ok: boolean; message?: unknown; code?: unknown; params?: unknown };
    if (!result.ok) {
        const params = safeAgentMessageParams(result.params);
        return {
            requestId,
            ok: false,
            ...(typeof result.code === 'string' && /^[A-Z_0-9]{1,80}$/.test(result.code) ? { code: result.code } : {}),
            ...(params ? { params } : {}),
            message: typeof result.message === 'string' && result.message.trim()
                ? result.message.trim() : 'The browser action did not succeed.'
        };
    }
    return { requestId, ok: true, data: value };
}
