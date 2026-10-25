import type { AgentModelMessage, AgentTaskPlanStep } from './types.js';

const MARKER = 'NEXTMUX_CONTINUITY_V1\n';
/** The compaction scope message the runner re-adds after every compaction (runner.ts compactMessages). */
export const TASK_SCOPE_PREFIX = 'CURRENT TASK SCOPE —';
/** Runtime-authored user turns (output-limit and stream-resume notices, nudges): instructions, not goals. */
export const RUNTIME_NOTICE_PREFIX = 'Runtime notice:';
type Category = 'goals' | 'findings' | 'files' | 'checks' | 'failures' | 'pending' | 'reports';
type Memory = Record<Category, string[]>;
const categories: Category[] = ['goals', 'findings', 'files', 'checks', 'failures', 'pending', 'reports'];
const REPORT_PREFIX = 'Assistant report (not independent verification): ';
// Provenance determines retention priority. Narrative progress must not evict a
// file observation or a failing check. Empty categories consume no budget.
const weights: Record<Category, number> = { goals: 4, pending: 4, failures: 4, findings: 5, checks: 3, files: 2, reports: 1 };
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Keep outcome lines and both ends; do not hide the last failure behind a long stdout prefix. */
function evidenceText(value: unknown, limit = 1600, source = 'tool result'): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  if (text.length <= limit) return text;
  const lines = text.split(/\r?\n/);
  const important = lines.filter(line => /error|fail|pass|success|assert|exception|warning|todo|错误|失败|通过|待办/i.test(line)).slice(-10).join('\n');
  const third = Math.floor(limit / 3);
  // Cut on whole UTF-16 characters: a split emoji would leave a lone surrogate in the model's context.
  const head = codeUnitSlice(text, 0, Math.floor(limit / 4));
  const tail = codeUnitSlice(text, text.length - third, text.length);
  return `${head}\n[excerpt of ${source}]\n${codeUnitSlice(important, important.length - third, important.length)}\n${tail}`;
}

function boundedEntry(entry: string, encodedBudget: number, maxCharacters = 1800): string | undefined {
  if (encodedBudget < 80) return undefined;
  const prefix = entry.startsWith(REPORT_PREFIX) ? REPORT_PREFIX : '';
  const source = entry.slice(prefix.length);
  let limit = Math.min(maxCharacters, encodedBudget - JSON.stringify(prefix).length - 4);
  let bounded = prefix + evidenceText(source, limit);
  // JSON escaping also occupies the working context (notably command output).
  // Count it, rather than assuming one source character uses one budget unit.
  while (JSON.stringify(bounded).length + 1 > encodedBudget && limit >= 60) {
    limit = Math.floor(limit * 0.8);
    bounded = prefix + evidenceText(source, limit);
  }
  return JSON.stringify(bounded).length + 1 <= encodedBudget ? bounded : undefined;
}

/** `tool callId (also a, b): paths sha256=…` split into its parts; undefined for any other line. */
function parseFileEntry(entry: string): { tool: string; callId: string; also: string[]; paths: string; sha: string } | undefined {
  const match = /^(\S+)(?: (\S+))?(?: \(also ([^)]*)\))?: (.+?)( sha256=[a-f0-9]{8,128})?$/i.exec(entry);
  return match ? { tool: match[1], callId: match[2] ?? '', also: match[3] ? match[3].split(', ').filter(Boolean) : [], paths: match[4], sha: match[5] ?? '' } : undefined;
}

function retainEvidence(entries: readonly string[], budget: number, anchor: { readonly share: number; readonly maxCharacters: number } = { share: 1 / 3, maxCharacters: 1800 }):
  { entries: string[]; omitted: number; used: number } {
  // Retain the first observation as an anchor and recent observations after it.
  // This is a bounded evidence cache, not a claim to understand or validate the
  // semantics of every fact. Raw observations remain explicitly historical.
  // Every entry is bounded again here, so memory written under a large window
  // shrinks to a smaller model's budget when it is compacted once more.
  const order = entries.length ? [0, ...entries.slice(1).map((_, index) => index + 1).reverse()] : [];
  const selected = new Map<number, string>();
  let used = 0;
  for (const index of order) {
    // An old, long observation must not consume the slot needed by its newest
    // correction. The initial anchor gets its share when both exist.
    const allowance = index === 0 && entries.length > 1 ? Math.floor(budget * anchor.share) : budget - used;
    const bounded = boundedEntry(entries[index], allowance, index === 0 ? anchor.maxCharacters : 1800);
    if (!bounded && index === 0 && entries.length > 1) continue;
    if (!bounded) break;
    selected.set(index, bounded);
    used += JSON.stringify(bounded).length + 1;
  }
  return { entries: [...selected].sort(([a], [b]) => a - b).map(([, value]) => value), omitted: entries.length - selected.size, used };
}

/**
 * Local tiered evidence condenser following OpenHands' requirements, task
 * tracking, code state and test evidence separation. No extra model request,
 * inferred success or transcript mutation. This does not claim LLM semantics.
 * V1 checkpoints remain readable; narrative reports are migrated out of the
 * evidence tier and omissions remain visible across subsequent compactions.
 */
export function summarizeMessageMedia(message: AgentModelMessage): string[] {
  const items: string[] = [];
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === 'text') {
      items.push(`attachment(text): name=${JSON.stringify(attachment.name)} chars=${attachment.content.length}`);
    } else {
      const bytes = Math.floor(attachment.dataBase64.length * 3 / 4)
        - (attachment.dataBase64.endsWith('==') ? 2 : attachment.dataBase64.endsWith('=') ? 1 : 0);
      const dims = attachment.media?.width && attachment.media?.height ? ` ${attachment.media.width}x${attachment.media.height}` : '';
      const duration = attachment.media?.durationSeconds !== undefined ? ` ${attachment.media.durationSeconds}s` : '';
      items.push(`attachment(${attachment.kind}): name=${JSON.stringify(attachment.name)} mimeType=${attachment.mimeType} bytes=${bytes}${dims}${duration}`);
    }
  }
  for (const part of message.outputParts ?? []) {
    if (part.type !== 'text') {
      items.push(`outputAsset(${part.type}): sha256=${part.asset.sha256} mimeType=${part.asset.mimeType} sizeBytes=${part.asset.sizeBytes}`);
    }
  }
  return items;
}

export function buildAgentContinuityMemory(
  messages: readonly AgentModelMessage[],
  plan: readonly AgentTaskPlanStep[] | undefined,
  characterBudget = 16000,
): AgentModelMessage {
  const memory: Memory = { goals: [], findings: [], files: [], checks: [], failures: [], pending: [], reports: [] };
  const omitted: Partial<Record<Category, number>> = {};
  // Tool-call IDs only need to be unique within a run segment. Explicit
  // continuation keeps old messages but starts a fresh ID set, so a later
  // segment may reuse an ID. Resolve each result against the calls already
  // seen in timeline order instead of indexing the entire future transcript.
  const pendingCalls = new Map<string, NonNullable<AgentModelMessage['toolCalls']>[number]>();
  const add = (category: Category, value: string): void => {
    if (!value.trim()) return;
    if (category !== 'files') { memory[category].push(value.trim()); return; }
    // One line per path set: a file read, edited and read again keeps its latest
    // tool and hash, and names the earlier tools instead of repeating the path.
    const entry = parseFileEntry(value.trim());
    const earlier = memory.files.findIndex(item => parseFileEntry(item)?.paths === entry?.paths);
    if (!entry || earlier < 0) { memory.files.push(value.trim()); return; }
    const previous = parseFileEntry(memory.files[earlier])!;
    memory.files.splice(earlier, 1);
    const also = [...new Set([...previous.also, previous.tool, ...entry.also].filter(name => name && name !== entry.tool))].slice(-4);
    memory.files.push(`${entry.tool}${entry.callId ? ` ${entry.callId}` : ''}${also.length ? ` (also ${also.join(', ')})` : ''}: ${entry.paths}${entry.sha}`);
  };
  for (const message of messages) {
    if (message.content.startsWith(MARKER)) {
      try {
        const previous = object(JSON.parse(message.content.slice(MARKER.length)));
        for (const category of categories) if (Array.isArray(previous[category])) {
          for (const value of previous[category] as unknown[]) if (typeof value === 'string') {
            add(category === 'findings' && value.startsWith(REPORT_PREFIX) ? 'reports' : category, value);
          }
        }
        const priorOmissions = object(previous.omitted);
        for (const category of categories) if (Number.isSafeInteger(priorOmissions[category]) && Number(priorOmissions[category]) > 0) {
          omitted[category] = Math.min(1_000_000, (omitted[category] ?? 0) + Number(priorOmissions[category]));
        }
      } catch { add('findings', evidenceText(message.content)); }
      continue;
    }
    const mediaSummary = summarizeMessageMedia(message);
    if (message.role === 'user') {
      // A runtime notice ("continue where you stopped") is not something the user asked for.
      if ((message.content.startsWith(RUNTIME_NOTICE_PREFIX) || message.content.startsWith('<system-continuation>')) && !mediaSummary.length) continue;
      const text = [evidenceText(message.content, 1600, 'user message'), ...mediaSummary].filter(Boolean).join('\n');
      add('goals', text);
      continue;
    }
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) pendingCalls.set(call.id, call);
      const reportText = [evidenceText(message.content), ...mediaSummary].filter(Boolean).join('\n');
      if (reportText.trim()) add('reports', `${REPORT_PREFIX}${reportText}`);
      continue;
    }
    const call = pendingCalls.get(message.toolCallId ?? '');
    if (message.toolCallId) pendingCalls.delete(message.toolCallId);
    let result: Record<string, unknown>;
    try { result = object(JSON.parse(message.content)); } catch { result = { output: message.content }; }
    const output = object(result.output);
    const args = object(call?.arguments);
    const source = `${call?.name ?? 'tool'} ${message.toolCallId ?? ''}`;
    const path = typeof output.path === 'string' ? output.path : typeof args.path === 'string' ? args.path : '';
    const changedPaths = Array.isArray(output.changedPaths) ? output.changedPaths.filter(value => typeof value === 'string') : [];
    if (path || changedPaths.length) add('files', `${source}: ${[path, ...changedPaths].filter(Boolean).join(', ')}${typeof output.sha256 === 'string' ? ` sha256=${output.sha256}` : ''}`);
    const exit = typeof output.exitCode === 'number' ? ` exitCode=${output.exitCode}` : '';
    const running = output.running === true ? ' running=true (not completed)' : '';
    const text = typeof output.stdout === 'string' || typeof output.stderr === 'string'
      ? `${output.stdout ?? ''}\n${output.stderr ?? ''}`
      : output.content ?? output.chunks ?? result.output ?? result.error;
    const mediaLine = mediaSummary.length ? `\nmedia=${mediaSummary.join('; ')}` : '';
    const entry = `${source}: ok=${String(result.ok)}${exit}${running}\narguments=${evidenceText(args, 600)}\nresult=${evidenceText(text)}${mediaLine}`;
    if (result.ok === false || typeof output.exitCode === 'number' && output.exitCode !== 0) add('failures', entry);
    else if (call?.name.startsWith('process.')) add('checks', entry);
    else add('findings', entry);
  }
  if (plan?.length) for (const step of plan) {
    // The host's current plan supersedes its older, serialized task status.
    const prefix = `Plan ${step.id} [`;
    for (const category of ['pending', 'findings'] as const) memory[category] = memory[category].filter(entry => !entry.startsWith(prefix));
    add(step.status === 'completed' ? 'findings' : 'pending', `${prefix}${step.status}]: ${step.title}`);
  }
  const target = Math.max(300, Math.min(100_000, Number.isFinite(characterBudget) ? Math.floor(characterBudget) : 16000));
  const note = target < 600 ? 'Historical excerpts; re-read sources.'
    : 'Historical evidence, not current verification. Excerpts and omitted observations are incomplete; re-read sources before relying on old state or assuming something is absent.';
  const overhead = MARKER.length + JSON.stringify({ ...Object.fromEntries(categories.map(category => [category, []])),
    omitted: Object.fromEntries(categories.map(category => [category, 1000000])), note }).length + 1;
  const available = Math.max(0, target - overhead);
  const unique = Object.fromEntries(categories.map(category => [category, [...new Set(memory[category])]])) as Memory;
  const active = categories.filter(category => unique[category].length);
  let weight = active.reduce((sum, category) => sum + weights[category], 0);
  let remaining = available;
  // Brief categories release their unused allocation to later evidence. Process
  // them first; narrative reports stay last and receive only their own share.
  const ordered = [...active].sort((a, b) => a === 'reports' ? 1 : b === 'reports' ? -1
    : unique[a].join('').length / weights[a] - unique[b].join('').length / weights[b]);
  for (const category of ordered) {
    const budget = Math.floor(remaining * weights[category] / weight);
    // The first request carries the task's goal and constraints: it keeps more
    // room than other anchors, the newest requests after it fill the rest.
    const retained = retainEvidence(unique[category], budget,
      category === 'goals' ? { share: 0.4, maxCharacters: 2400 } : undefined);
    memory[category] = retained.entries;
    if (retained.omitted) omitted[category] = Math.min(1_000_000, (omitted[category] ?? 0) + retained.omitted);
    remaining -= retained.used;
    weight -= weights[category];
  }
  for (const category of categories) {
    if (!unique[category].length) memory[category] = [];
  }
  return { role: 'user', content: `${MARKER}${JSON.stringify({ ...memory,
    ...(Object.keys(omitted).length ? { omitted } : {}),
    note,
  })}\n` };
}

/** Bound very large observations while retaining call/result pairing and
 * machine-readable continuation fields. This changes the model's working
 * context only; it does not assert that every raw result has a durable archive. */
export function compactLargeToolObservations(messages: readonly AgentModelMessage[], limit: number): AgentModelMessage[] {
  return messages.map(message => {
    if (message.role !== 'tool' || message.content.length <= limit) return message;
    let result: Record<string, unknown>;
    try { result = object(JSON.parse(message.content)); } catch { result = { output: message.content }; }
    const source = object(result.output);
    const fields = ['processId', 'running', 'exitCode', 'signal', 'terminationReason', 'nextSequence', 'latestSequence', 'hasMore',
      'path', 'sha256', 'checkpointId', 'checkpointIds', 'changedPaths', 'checkpointCoverage', 'truncated'];
    const retained = Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
    return { ...message, content: JSON.stringify({ ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      output: { ...retained, contextExcerpt: true, evidence: evidenceText(result.output, Math.max(600, limit - 400)) },
    }) };
  });
}

/**
 * Strip binary attachments (image/file) from older messages in the retained
 * window when the working context still exceeds the model or transport budget,
 * keeping the newest user media and `keepNewestCount` recent observations.
 * Index zero may be unrelated conversation history, not the current task.
 */
export function compactRetainedMediaAttachments(
  messages: readonly AgentModelMessage[],
  keepNewestCount = 1,
): AgentModelMessage[] {
  const mediaIndices: number[] = [];
  messages.forEach((message, index) => {
    if (message.attachments?.some(attachment => attachment.kind !== 'text')) {
      mediaIndices.push(index);
    }
  });
  const keepSet = new Set(keepNewestCount > 0 ? mediaIndices.slice(-keepNewestCount) : []);
  const newestUserMedia = [...mediaIndices].reverse().find(index => messages[index].role === 'user');
  if (newestUserMedia !== undefined) keepSet.add(newestUserMedia);
  return messages.map((message, index) => {
    if (keepSet.has(index) || !message.attachments?.some(attachment => attachment.kind !== 'text')) {
      return message;
    }
    const summary = summarizeMessageMedia(message);
    const textAttachments = message.attachments.filter(attachment => attachment.kind === 'text');
    const { attachments: _removed, ...rest } = message;
    const note = `\n[Historical media compacted: ${summary.join('; ')}. Observe the target again if a fresh visual/audio capture is needed.]`;
    return {
      ...rest,
      content: `${message.content}${note}`,
      ...(textAttachments.length ? { attachments: textAttachments } : {}),
    };
  });
}

const CONDENSED_MARKER = '\n… [historical message condensed to fit the active model context window] …\n';
// Lines worth keeping from a condensed middle: headings, list items naming files, failures and conclusions.
const STRUCTURAL_LINE = /^#{1,6}\s|[\w.-]+[\\/][\w./\\-]*\.\w{1,8}\b|\b(?:error|fail(?:ed|ure)?|exception|warning|conclusion|summary|result|todo|fixed|changed)\b|结论|总结|结果|错误|失败|警告|注意|修复|修改/i;

/** A slice that never splits a UTF-16 surrogate pair. */
function codeUnitSlice(text: string, start: number, end: number): string {
  let from = Math.max(0, Math.min(text.length, start)), to = Math.max(from, Math.min(text.length, end));
  if (from > 0 && from < text.length && /[\uDC00-\uDFFF]/.test(text[from])) from += 1;
  if (to > from && to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to -= 1;
  return text.slice(from, to);
}

/** Head, the middle's structural lines and the tail of a long message, within `limit` characters. */
export function condenseHistoricalText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const bound = Math.max(0, Math.floor(limit));
  if (bound <= CONDENSED_MARKER.length * 2 + 32) return codeUnitSlice(text, 0, bound);
  const room = bound - CONDENSED_MARKER.length * 2;
  const headLength = Math.floor(room * 0.45 / 0.95), keyLength = Math.floor(room * 0.15 / 0.95);
  const tailLength = room - headLength - keyLength;
  const keyLines: string[] = [];
  let used = 0;
  for (const line of text.slice(headLength, text.length - tailLength).split('\n')) {
    const trimmed = line.trim();
    // A very long line is body text, not structure (and is never scanned whole).
    if (!trimmed || trimmed.length > 1_000 || !STRUCTURAL_LINE.test(trimmed)) continue;
    const bounded = trimmed.length > 240 ? `${codeUnitSlice(trimmed, 0, 239)}…` : trimmed;
    if (used + bounded.length + 1 > keyLength) break;
    keyLines.push(bounded);
    used += bounded.length + 1;
  }
  if (!keyLines.length) {
    // Nothing structural in the middle: head and tail share the room, joined once.
    const shared = bound - CONDENSED_MARKER.length;
    const head = codeUnitSlice(text, 0, Math.floor(shared * 0.55));
    return `${head}${CONDENSED_MARKER}${codeUnitSlice(text, text.length - (shared - head.length), text.length)}`;
  }
  const head = codeUnitSlice(text, 0, headLength);
  const tail = codeUnitSlice(text, text.length - tailLength, text.length);
  return `${head}${CONDENSED_MARKER}${keyLines.join('\n')}${CONDENSED_MARKER}${tail}`;
}

function condenseArguments(value: unknown, limit: number, depth = 0): unknown {
  if (typeof value === 'string') return value.length > limit ? condenseHistoricalText(value, limit) : value;
  if (depth >= 4 || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => condenseArguments(item, limit, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, condenseArguments(item, limit, depth + 1)]));
}

/**
 * Bound every message to `maxMessageChars` for a smaller context window (for example after switching from a 1M-token
 * model to a 128k one): tool observations keep their continuation fields, a continuity memory is rebuilt into the
 * budget, other text keeps its head, structural lines and tail. The latest user request (not a runtime notice,
 * scope or memory message) is bounded by `taskAnchorChars` instead (Infinity keeps it whole). Call/result pairing
 * and media attachments are unchanged.
 */
export function compactOversizedMessages(
  messages: readonly AgentModelMessage[],
  maxMessageChars: number,
  options: { readonly taskAnchorChars?: number } = {},
): AgentModelMessage[] {
  const limit = Math.max(600, Math.floor(maxMessageChars));
  const rawAnchorIndex = messages.map((message, index) => ({ message, index })).reverse().find(({ message }) => message.role === 'user'
    && !message.content.startsWith(MARKER) && !message.content.startsWith(TASK_SCOPE_PREFIX) && !message.content.startsWith(RUNTIME_NOTICE_PREFIX))?.index;
  const scopeAnchorIndex = rawAnchorIndex === undefined
    ? messages.findIndex(message => message.role === 'user' && message.content.startsWith(TASK_SCOPE_PREFIX))
    : -1;
  const anchorIndex = rawAnchorIndex ?? (scopeAnchorIndex >= 0 ? scopeAnchorIndex : undefined);
  return messages.map((message, index) => {
    const own = index === anchorIndex && options.taskAnchorChars !== undefined ? Math.max(limit, options.taskAnchorChars) : limit;
    if (!Number.isFinite(own)) return message;
    if (message.role === 'tool') return compactLargeToolObservations([message], own)[0];
    let next = message;
    if (message.content.length > own) {
      next = { ...next, content: message.content.startsWith(MARKER)
        ? buildAgentContinuityMemory([message], undefined, own).content : condenseHistoricalText(message.content, own) };
    }
    const textAttachmentCount = message.attachments?.filter(attachment => attachment.kind === 'text').length ?? 0;
    const perAttachmentOwn = textAttachmentCount > 1 ? Math.max(600, Math.floor(own / textAttachmentCount)) : own;
    if (message.attachments?.some(attachment => attachment.kind === 'text' && attachment.content.length > perAttachmentOwn)) {
      next = { ...next, attachments: message.attachments.map(attachment => attachment.kind === 'text' && attachment.content.length > perAttachmentOwn
        ? { ...attachment, content: condenseHistoricalText(attachment.content, perAttachmentOwn) } : attachment) };
    }
    if (message.toolCalls?.some(call => JSON.stringify(call.arguments ?? null).length > own)) {
      next = { ...next, toolCalls: message.toolCalls.map(call => ({ ...call, arguments: condenseArguments(call.arguments, own) as typeof call.arguments })) };
    }
    return next;
  });
}
