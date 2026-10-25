import type { AgentMessageAttachment, AgentModelMessage } from './types.js';

// These are live automation observations, never user input or generated media.
const OBSERVATION_TOOLS = new Set(['computer.observe_window', 'tabs.screenshot', 'browser.snapshot']);
const IMAGE_BUDGET = 2 * 1024 * 1024;
const OMITTED = '\n[Historical automation screenshot omitted from this model request. The text and tool result remain. Observe that surface again before acting from an omitted image.]';
const LARGE = '\n[The latest automation screenshot alone exceeds the 2 MiB image budget and is retained so this observation is not blind. The provider request-size limit still applies.]';

/** Project only outbound context; immutable checkpoints/history keep all original observations. */
export function modelObservationImages(messages: readonly AgentModelMessage[]): AgentModelMessage[] {
  const calls = new Map<string, { name: string; surface: string }>();
  const observations = new Map<number, { surface: string; bytes: number }>();
  messages.forEach((message, index) => {
    if (message.role === 'assistant') for (const call of message.toolCalls || []) {
      if (!OBSERVATION_TOOLS.has(call.name)) continue;
      const args = call.arguments as Record<string, unknown>;
      const surface = call.name === 'computer.observe_window' && Number.isSafeInteger(args?.pid) && Number.isSafeInteger(args?.windowId)
        ? `window:${args.pid}:${args.windowId}`
        : call.name === 'tabs.screenshot' && typeof args?.tabId === 'string' ? `tab:${args.tabId}`
          : call.name === 'browser.snapshot' && typeof args?.browserId === 'string' ? `browser:${args.browserId}` : undefined;
      // Incomplete provenance is not an authorization to discard media.
      if (surface) calls.set(call.id, { name: call.name, surface });
    }
    const call = message.role === 'tool' && message.toolCallId ? calls.get(message.toolCallId) : undefined;
    if (!call) return;
    const images = message.attachments?.filter(attachment => attachment.kind === 'image') || [];
    if (images.length) observations.set(index, { surface: call.surface, bytes: images.reduce((n, image) => n + (image as Extract<AgentMessageAttachment, { kind: 'image' }>).dataBase64.length, 0) });
  });
  const seen = new Set<string>(), keep = new Set<number>();
  let bytes = 0, largestLatest: number | undefined;
  for (const [index, observation] of [...observations].reverse()) {
    if (seen.has(observation.surface)) continue;
    seen.add(observation.surface);
    // Always retain the newest observation, even when a single capture is too
    // large. Do not hide it and let the model act without seeing the surface.
    if (!keep.size || bytes + observation.bytes <= IMAGE_BUDGET) {
      keep.add(index); bytes += observation.bytes;
      if (observation.bytes > IMAGE_BUDGET) largestLatest = index;
    }
  }
  return messages.map((message, index) => {
    if (!observations.has(index)) return message;
    if (keep.has(index)) return index === largestLatest ? { ...message, content: message.content + LARGE } : message;
    const attachments = message.attachments?.filter(attachment => attachment.kind !== 'image');
    const { attachments: _original, ...rest } = message;
    return { ...rest, content: message.content + OMITTED, ...(attachments?.length ? { attachments } : {}) };
  });
}
