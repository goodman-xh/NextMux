import type { AgentOutputPart } from '@nextmux/agent-runtime';
import { normalizeAgentOutputParts } from '@nextmux/agent-runtime/output-parts';

export type AssistantOutputPresentation =
    | { readonly kind: 'ordered'; readonly parts: readonly AgentOutputPart[] }
    | { readonly kind: 'legacy-text'; readonly text: string };

/**
 * A validated ordered response is the whole assistant response. In particular,
 * a media-only response must not acquire a synthetic text summary in the UI.
 * Historical responses without ordered parts retain the ordinary Markdown path.
 */
export function assistantOutputPresentation(
    text: string,
    rawParts: readonly AgentOutputPart[] | undefined
): AssistantOutputPresentation {
    try {
        const parts = normalizeAgentOutputParts(rawParts);
        if (parts?.length) return { kind: 'ordered', parts };
    } catch {
        // A damaged historical descriptor is never rendered as media. The
        // already-sanitized text remains available instead of blanking a turn.
    }
    return { kind: 'legacy-text', text };
}

