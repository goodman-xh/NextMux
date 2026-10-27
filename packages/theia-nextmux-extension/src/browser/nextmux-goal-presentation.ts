import type { AgentOutputPart, AgentRunEvent } from '@nextmux/agent-runtime';
import { GOAL_REQUEST_ENVELOPES, GOAL_UPDATE_ENVELOPE } from './nextmux-goal-runner';

/** Recognize only the exact application-generated steering envelope. */
export function goalUpdateObjective(content: string): string | undefined {
    const [prefix, suffix] = GOAL_UPDATE_ENVELOPE;
    return content.startsWith(prefix) && content.endsWith(suffix)
        ? content.slice(prefix.length, -suffix.length).trim() || undefined : undefined;
}

/** Native goal updates carry the raw objective; fallback directions carry our exact wrapper. */
export function goalSteeringObjective(message: { readonly kind?: string; readonly content: string }): string | undefined {
    return message.kind === 'goal_update' ? message.content.trim() : goalUpdateObjective(message.content);
}

/** Presentation provenance only: raw prompts, responses and journals remain authoritative. */
export type GoalPresentationOrigin = 'automatic-v1' | 'user';

const envelopes: readonly (readonly [string, string])[] = [
    // Historical requests (before the Codex-style continuation instructions).
    ['执行持续目标：', '\n完成后请验证结果；若尚未完成继续处理，完成时在最后一行输出 [GOAL_COMPLETE]。'],
    ['继续执行持续目标：', '\n检查已有结果并继续未完成部分；完成时在最后一行输出 [GOAL_COMPLETE]。'],
    ...GOAL_REQUEST_ENVELOPES
];

function goalPrompt(prompt: string, origin?: GoalPresentationOrigin): string | undefined {
    // New ordinary messages are explicit, including a user quoting an entire protocol envelope.
    // Legacy turns have no provenance: accept only the complete, exact historical wrapper.
    if (origin !== undefined && origin !== 'automatic-v1') return undefined;
    for (const [prefix, suffix] of envelopes) {
        if (!prompt.startsWith(prefix) || !prompt.endsWith(suffix)) continue;
        const value = prompt.slice(prefix.length, -suffix.length);
        if (value.trim()) return value;
    }
    return undefined;
}

/** The objective inside an exact automatic goal request, for titles and previews. */
export function goalRequestObjective(prompt: string): string | undefined {
    return goalPrompt(prompt, 'automatic-v1')?.trim() || undefined;
}

/** A conversation title that was cut from a goal request envelope instead of its objective. */
export function isGoalEnvelopeTitle(title: string): boolean {
    return envelopes.some(([prefix]) => title.startsWith(prefix.trim().slice(0, 24)));
}

/** Only a standalone terminal line outside Markdown code can be a protocol footer. */
function footerStart(text: string): number | undefined {
    const match = /(?:^|\r?\n)[ ]{0,3}(?:[-*+][ \t]+)?[*_`]{0,3}\[GOAL_(?:COMPLETE|BLOCKED)\][*_`]{0,3}[.。!！]?[ \t]*(?:\r?\n[ \t]*)*$/.exec(text);
    if (!match) return undefined;
    // A bare line may still be a lazy continuation of a quoted paragraph.
    const precedingParagraph = text.slice(0, match.index).split(/\r?\n[ \t]*\r?\n/).at(-1) || '';
    if (/^[ ]{0,3}>/m.test(precedingParagraph)) return undefined;
    let fence: { character: string; length: number } | undefined;
    for (const line of text.slice(0, match.index).split(/\r?\n/)) {
        const marker = /^[ ]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (!marker) continue;
        if (!fence) fence = { character: marker[1][0], length: marker[1].length };
        else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    }
    return fence ? undefined : match.index;
}

function withoutFooter(text: string): string {
    const start = footerStart(text);
    return start === undefined ? text : text.slice(0, start);
}

function publicParts(parts: readonly AgentOutputPart[] | undefined): { readonly parts?: readonly AgentOutputPart[]; readonly permitsFooter: boolean } {
    if (parts === undefined) return { parts, permitsFooter: true };
    // Damaged historical descriptors must retain the existing renderer's safe text fallback.
    if (!Array.isArray(parts) || parts.some(part => !part || typeof part !== 'object'
        || !['text', 'image', 'audio'].includes(part.type)
        || part.type === 'text' && typeof part.text !== 'string')) return { parts, permitsFooter: false };
    if (!parts.length) return { parts, permitsFooter: true };
    const text = parts.filter((part): part is Extract<AgentOutputPart, { type: 'text' }> => part.type === 'text').map(part => part.text).join('');
    const start = footerStart(text);
    if (start === undefined) return { parts, permitsFooter: true };
    let offset = 0;
    // Never mistake text separated by a media part for one terminal control line.
    for (const part of parts) {
        if (part.type === 'text') offset += part.text.length;
        else if (offset > start) return { parts, permitsFooter: false };
    }
    offset = 0;
    return { permitsFooter: true, parts: parts.map(part => {
        if (part.type !== 'text') return part;
        const keep = Math.max(0, start - offset);
        offset += part.text.length;
        return keep >= part.text.length ? part : { ...part, text: part.text.slice(0, keep) };
    }) };
}

function publicEvents(events: readonly AgentRunEvent[] | undefined): readonly AgentRunEvent[] | undefined {
    if (!events?.length) return events;
    // A footer is protocol only where a model reply ends with it: the final text,
    // and any reply that completed without calling a tool (after it the runtime
    // may still run its own change verification in the same turn). A marker the
    // model wrote before calling a tool was not its last word and stays visible.
    const trims = new Map<number, number>();
    let indexes: number[] = [];
    let text = '';
    const settle = (strip: boolean): void => {
        const start = strip ? footerStart(text) : undefined;
        if (start !== undefined) {
            let offset = 0;
            for (const index of indexes) {
                const delta = (events[index] as Extract<AgentRunEvent, { type: 'assistant_delta' }>).delta;
                const keep = Math.max(0, start - offset);
                offset += delta.length;
                if (keep < delta.length) trims.set(index, keep);
            }
        }
        indexes = []; text = '';
    };
    for (const [index, event] of events.entries()) {
        if (event.type === 'assistant_delta') { indexes.push(index); text += event.delta; }
        else if (event.type === 'model_completed') settle(!event.toolCallCount);
        else if (event.type === 'model_started' && !event.continuation || event.type === 'backend_selected'
            || event.type === 'tool_started' || event.type === 'tool_completed'
            || event.type === 'steering_accepted' || event.type === 'assistant_progress'
            || event.type === 'user_input_requested') settle(false);
    }
    settle(true);
    if (!trims.size) return events;
    return events.map((event, index) => {
        const keep = trims.get(index);
        return keep === undefined || event.type !== 'assistant_delta' ? event : { ...event, delta: event.delta.slice(0, keep) };
    });
}

function latestModelParts(events: readonly AgentRunEvent[] | undefined): readonly AgentOutputPart[] | undefined {
    let parts: readonly AgentOutputPart[] | undefined;
    for (const event of events || []) {
        if (event.type === 'model_started' || event.type === 'backend_selected') parts = undefined;
        else if (event.type === 'model_completed') parts = event.outputParts;
    }
    return parts;
}

/**
 * OpenCode renders non-synthetic user text separately from its model message:
 * https://github.com/anomalyco/opencode/blob/dev/packages/session-ui/src/components/message-part.tsx
 * This is our protocol-specific UI projection, not a mutation of execution history.
 */
export function goalTurnPresentation(input: {
    readonly prompt: string;
    readonly goalPresentationOrigin?: GoalPresentationOrigin;
    readonly response: string;
    readonly outputParts?: readonly AgentOutputPart[];
    readonly events?: readonly AgentRunEvent[];
}): { readonly prompt: string; readonly response: string; readonly outputParts?: readonly AgentOutputPart[]; readonly events?: readonly AgentRunEvent[] } {
    const prompt = goalPrompt(input.prompt, input.goalPresentationOrigin);
    // A goal explicitly discussing the marker may require it as genuine task output.
    const strip = prompt !== undefined && !prompt.includes('GOAL_COMPLETE') && !prompt.includes('GOAL_BLOCKED');
    const parts = strip ? publicParts(input.outputParts) : { parts: input.outputParts, permitsFooter: false };
    // Media can prove that a text-only finalText suffix is not the actual response footer.
    const removeFooter = strip && parts.permitsFooter && publicParts(latestModelParts(input.events)).permitsFooter;
    return { prompt: prompt ?? input.prompt,
        response: removeFooter ? withoutFooter(input.response) : input.response,
        outputParts: removeFooter ? parts.parts : input.outputParts,
        events: removeFooter ? publicEvents(input.events) : input.events };
}
