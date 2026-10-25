import type { DesktopOllamaPull } from '../common/nextmux-platform-protocol';

/**
 * One Ollama model download (POST /api/pull, streamed): Ollama reports a line per step, and per layer its size and
 * how much has arrived. The download's bytes are the sum over its layers. It ends with status "success", or with an
 * error line; a stream that stops before either is a failure.
 */
export async function runOllamaPull(options: {
    readonly fetch: typeof fetch;
    readonly endpoint: string;
    readonly model: string;
    update(next: Partial<DesktopOllamaPull>): void;
}): Promise<void> {
    const layers = new Map<string, { readonly total: number; readonly completed: number }>();
    try {
        const response = await options.fetch(options.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: options.model, stream: true }) });
        if (!response.ok || !response.body) throw new Error(`Ollama answered HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        for (;;) {
            const { value, done } = await reader.read();
            pending += decoder.decode(value, { stream: !done });
            const lines = pending.split('\n');
            pending = done ? '' : lines.pop() ?? '';
            for (const line of lines) {
                let event: { status?: unknown; digest?: unknown; total?: unknown; completed?: unknown; error?: unknown };
                try { event = JSON.parse(line); } catch { continue; }
                if (typeof event.error === 'string' && event.error) throw new Error(event.error);
                if (typeof event.digest === 'string' && Number.isFinite(Number(event.total)) && Number(event.total) > 0) {
                    layers.set(event.digest, { total: Number(event.total), completed: Math.max(0, Number(event.completed) || 0) });
                }
                const sizes = [...layers.values()];
                const totalBytes = sizes.reduce((sum, layer) => sum + layer.total, 0);
                options.update({
                    ...(typeof event.status === 'string' ? { step: event.status.slice(0, 120) } : {}),
                    totalBytes,
                    completedBytes: sizes.reduce((sum, layer) => sum + Math.min(layer.completed, layer.total), 0)
                });
                if (event.status === 'success') {
                    options.update({ status: 'completed', completedBytes: totalBytes });
                    await reader.cancel().catch(() => undefined);
                    return;
                }
            }
            if (done) break;
        }
        throw new Error('The download ended before Ollama reported success');
    } catch (error) {
        options.update({ status: 'failed', error: (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300) });
    }
}
