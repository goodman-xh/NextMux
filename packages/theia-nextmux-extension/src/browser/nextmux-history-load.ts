/** Retry the read-only IPC request, never synthesize an empty history on failure. */
export async function loadConversationHistoryWithRetry<T>(
    read: () => Promise<T>,
    isCurrent: () => boolean,
    pause: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
): Promise<T> {
    const delays = [150, 400];
    for (let attempt = 0; ; attempt++) {
        if (!isCurrent()) throw new Error('HISTORY_READ_CANCELLED');
        try {
            return await read();
        } catch (error) {
            // Bad paths, oversized stores and newer formats need a concrete
            // action, not repeated reads or an empty replacement snapshot.
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
            if (!isCurrent() || attempt >= delays.length
                || ['INVALID_STORE_ROOT', 'INVALID_SESSION', 'TOO_LARGE', 'UNSUPPORTED_VERSION', 'STORE_CORRUPT', 'STORE_UNSAFE'].includes(code)) throw error;
            await pause(delays[attempt]);
        }
    }
}
