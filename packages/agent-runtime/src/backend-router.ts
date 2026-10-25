import { randomUUID } from "node:crypto";

import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentBackendRunRequest,
  AgentRunEvent,
  AgentRunResult,
} from "./types.js";
import { agentRunPauseRequested, AgentRunInterruptedError } from "./runner.js";
import { AgentOutputPartsError, normalizeAgentOutputParts } from './output-parts.js';
import { canonicalRuntimeFinal } from './semantic-messages.js';

export interface AgentBackendSupport {
  readonly supported: boolean;
  readonly reason?: string;
}

export interface AgentBackendCandidate {
  readonly backend: AgentBackend;
  /** Higher values are preferred. Equal priorities retain declaration order. */
  readonly priority?: number;
  /** Optional request/model-specific capability probe. */
  readonly supports?: (
    request: AgentBackendRunRequest,
  ) => AgentBackendSupport | boolean | Promise<AgentBackendSupport | boolean>;
  /** Additional transient-error classifier for this adapter. */
  readonly isRetryableError?: (error: unknown) => boolean;
}

export interface AgentBackendRouterOptions {
  readonly id?: string;
  readonly candidates: readonly AgentBackendCandidate[];
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

interface BackendHealth {
  failures: number;
  cooldownUntil: number;
}

export class AgentBackendUnavailableError extends Error {
  readonly code = "AGENT_BACKEND_UNAVAILABLE";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentBackendUnavailableError";
  }
}

export class AgentBackendCapabilityError extends Error {
  readonly code = "AGENT_BACKEND_UNSUPPORTED";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentBackendCapabilityError";
  }
}

export class AgentBackendSelectionError extends Error {
  readonly code = "AGENT_BACKEND_SELECTION_FAILED";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentBackendSelectionError";
  }
}

/**
 * Raised instead of replaying a request on another backend after output or a
 * tool boundary. The caller can offer checkpoint/resume without risking a
 * duplicated write, command, payment, or other side effect.
 */
export class UnsafeBackendFailoverError extends Error {
  readonly code = "AGENT_BACKEND_FAILOVER_UNSAFE";
  readonly backendId: string;

  constructor(backendId: string, cause: unknown) {
    super(`Backend ${backendId} failed after producing visible output or starting a side effect; automatic failover was blocked.`, {
      cause,
    });
    this.name = "UnsafeBackendFailoverError";
    this.backendId = backendId;
  }
}

function aggregateCapabilities(candidates: readonly AgentBackendCandidate[]): AgentBackendCapabilities {
  const some = (name: keyof AgentBackendCapabilities): boolean =>
    candidates.some(candidate => candidate.backend.capabilities[name]);
  return {
    streaming: some("streaming"),
    cancellation: some("cancellation"),
    sessionResume: some("sessionResume"),
    permissions: some("permissions"),
    filesystem: some("filesystem"),
    terminal: some("terminal"),
    mcp: some("mcp"),
    tokenBudget: some("tokenBudget"),
    toolPolicy: some("toolPolicy"),
    orderedOutput: some("orderedOutput"),
  };
}

function fallbackBarrier(event: AgentRunEvent): boolean {
  return event.type === "assistant_delta" && Boolean(event.delta)
    || event.type === "model_attempt_completed" && event.outcome === "succeeded"
    || event.type === "model_completed" && Boolean(event.outputParts?.length)
    || event.type === "assistant_progress" && Boolean(event.content.trim())
    || event.type === "tool_started"
    || event.type === "tool_completed"
    || event.type === "context_compaction_started"
    || event.type === "context_compaction_completed"
    || event.type === "steering_accepted"
    || event.type === "steering_applied";
}

function boundedReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300) || "backend unavailable";
}

function eventKey(event: AgentRunEvent): string {
  return JSON.stringify(event);
}

/**
 * Capability/health router for independent agent runtimes.
 *
 * This is intentionally not round-robin. It uses declared priority while a
 * backend is healthy, skips incompatible candidates, and cools down transient
 * failures. A fallback is allowed only before visible output or a tool/state
 * boundary, so a second runtime can never silently execute the same action.
 */
export class AgentBackendRouter implements AgentBackend {
  readonly id: string;
  readonly capabilities: AgentBackendCapabilities;
  readonly #candidates: readonly (AgentBackendCandidate & { readonly order: number })[];
  readonly #health = new Map<string, BackendHealth>();
  readonly #cooldownMs: number;
  readonly #now: () => number;

  constructor(options: AgentBackendRouterOptions) {
    if (!options.candidates.length) throw new TypeError("Agent backend router requires at least one candidate");
    const ids = new Set<string>();
    this.#candidates = options.candidates.map((candidate, order) => {
      const id = candidate.backend.id.trim();
      if (!id) throw new TypeError("Agent backend id is required");
      if (ids.has(id)) throw new TypeError(`Duplicate agent backend id: ${id}`);
      ids.add(id);
      return { ...candidate, order };
    });
    this.id = options.id?.trim() || "nextmux-capability-router";
    this.capabilities = aggregateCapabilities(this.#candidates);
    this.#cooldownMs = Math.max(1_000, Math.min(300_000, Math.round(options.cooldownMs ?? 30_000)));
    this.#now = options.now ?? Date.now;
  }

  async run(request: AgentBackendRunRequest): Promise<AgentRunResult> {
    if (request.acceptOrderedOutput !== undefined && request.acceptOrderedOutput !== true) throw new AgentOutputPartsError('OUTPUT_PARTS_UNSUPPORTED');
    if (request.acceptOrderedOutput !== true && (request.checkpoint?.version === 2
      || request.checkpoint?.messages.some(message => message.outputParts !== undefined)
      || request.history?.some(message => message.outputParts !== undefined))) throw new AgentOutputPartsError('OUTPUT_PARTS_UNSUPPORTED');
    const runId = request.runId?.trim() || randomUUID();
    const emitted: AgentRunEvent[] = [];
    const emittedKeys = new Set<string>();
    let visibleOrSideEffecting = false;
    const emit = async (event: AgentRunEvent): Promise<void> => {
      if (event.type === 'model_completed' && event.outputParts !== undefined) {
        visibleOrSideEffecting = true;
        if (request.acceptOrderedOutput !== true) throw new AgentOutputPartsError('OUTPUT_PARTS_UNSUPPORTED');
        event = { ...event, outputParts: normalizeAgentOutputParts(event.outputParts) };
      }
      const key = eventKey(event);
      if (emittedKeys.has(key)) return;
      emittedKeys.add(key);
      emitted.push(event);
      if (fallbackBarrier(event)) visibleOrSideEffecting = true;
      await request.onEvent?.(event);
    };

    const eligible = await this.#eligibleCandidates(request);
    if (!eligible.length) {
      throw new AgentBackendSelectionError("No healthy agent backend satisfies the required capabilities");
    }

    for (let index = 0; index < eligible.length; index += 1) {
      const candidate = eligible[index];
      const backend = candidate.backend;
      await emit({ type: "backend_selected", backendId: backend.id, attempt: index + 1, at: new Date().toISOString() });
      try {
        const result = await backend.run({
          ...request,
          runId,
          onEvent: emit,
        });
        // Returning a result proves this backend finished the request, even
        // if a legacy adapter did not publish any progress events.
        visibleOrSideEffecting = true;
        if (result.outputParts !== undefined && request.acceptOrderedOutput !== true) throw new AgentOutputPartsError('OUTPUT_PARTS_UNSUPPORTED');
        const outputParts = normalizeAgentOutputParts(result.outputParts);
        this.#markHealthy(backend.id);
        for (const event of result.events) await emit(event);
        return { ...result, ...(outputParts === undefined ? {} : { outputParts,
          finalText: outputParts.flatMap(part => part.type === 'text' ? [part.text] : []).join('') }), runId, events: emitted };
      } catch (error) {
        if (request.signal?.aborted) {
          const paused = agentRunPauseRequested(request.signal);
          const finalMessage = { origin: 'runtime', stopReason: paused ? 'pause_requested' : 'cancel_requested' } as const;
          const authoredText = emitted.flatMap(event => event.type === 'assistant_progress' && event.origin !== 'runtime' ? [event.content]
            : event.type === 'assistant_delta' ? [event.delta] : []).join('');
          const final = authoredText ? { finalText: authoredText } : { finalText: canonicalRuntimeFinal(finalMessage), finalMessage };
          if (error instanceof AgentRunInterruptedError) {
            return { runId, status: paused ? 'paused' : 'cancelled', stopReason: paused ? 'pause_requested' : 'cancel_requested',
              ...final, events: emitted, usage: { ...error.checkpoint.usage }, usageKnown: error.checkpoint.usageKnown,
              ...(error.checkpoint.tokenBudget ? { tokenBudget: error.checkpoint.tokenBudget } : {}),
              turns: error.checkpoint.nextTurn - 1, toolCalls: error.checkpoint.toolCalls, checkpoint: error.checkpoint };
          }
          return {
            runId,
            status: paused ? "paused" : "cancelled",
            stopReason: paused ? "pause_requested" : "cancel_requested",
            ...final,
            events: emitted,
            usage: { inputTokens: 0, outputTokens: 0 },
            turns: emitted.filter(event => event.type === "model_started").length,
            toolCalls: emitted.filter(event => event.type === "tool_started").length,
          };
        }
        const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
        if (record.retrySafe === false || record.providerAccepted === true || record.usageKnown === true
          || error instanceof AgentRunInterruptedError && error.failure.retrySafe !== true) throw error;
        const capabilityFailure = error instanceof AgentBackendCapabilityError;
        const retryable = capabilityFailure
          || error instanceof AgentBackendUnavailableError
          || Boolean(candidate.isRetryableError?.(error));
        if (!retryable) throw error;
        if (!capabilityFailure) this.#markUnavailable(backend.id);
        if (visibleOrSideEffecting) throw new UnsafeBackendFailoverError(backend.id, error);
        const next = eligible[index + 1];
        if (!next) throw error;
        await emit({
          type: "backend_fallback",
          fromBackendId: backend.id,
          toBackendId: next.backend.id,
          reason: boundedReason(error),
          at: new Date().toISOString(),
        });
      }
    }

    throw new AgentBackendSelectionError("No agent backend completed the request");
  }

  async #eligibleCandidates(request: AgentBackendRunRequest) {
    const required = new Set(request.requiredBackendCapabilities || []);
    if (request.checkpoint) required.add("sessionResume");
    // A budget is a safety contract, not a best-effort hint. Never route a
    // bounded request to a backend that cannot enforce it.
    if (request.tokenBudget) required.add("tokenBudget");
    if (request.allowedToolNames !== undefined || request.checkpoint?.toolPolicy) required.add("toolPolicy");
    if (request.acceptOrderedOutput !== undefined || request.checkpoint?.version === 2
      || request.checkpoint?.messages.some(message => message.outputParts !== undefined)
      || request.history?.some(message => message.outputParts !== undefined)) required.add('orderedOutput');
    const now = this.#now();
    const supported: (AgentBackendCandidate & { readonly order: number })[] = [];
    for (const candidate of this.#candidates) {
      if ([...required].some(capability => !candidate.backend.capabilities[capability])) continue;
      if ((this.#health.get(candidate.backend.id)?.cooldownUntil || 0) > now) continue;
      const probe = await candidate.supports?.(request);
      const support = typeof probe === "boolean" ? probe : probe?.supported ?? true;
      if (support) supported.push(candidate);
    }
    const preferredId = request.preferredBackendId?.trim();
    if (preferredId) {
      const preferred = supported.find(candidate => candidate.backend.id === preferredId);
      if (!preferred) {
        throw new AgentBackendSelectionError(`Selected agent backend is unavailable or incompatible: ${preferredId}`);
      }
      if (request.allowBackendFallback !== true) return [preferred];
      return [preferred, ...supported
        .filter(candidate => candidate.backend.id !== preferredId)
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.order - right.order)];
    }
    return supported.sort((left, right) =>
      (right.priority ?? 0) - (left.priority ?? 0) || left.order - right.order);
  }

  #markHealthy(backendId: string): void {
    this.#health.delete(backendId);
  }

  #markUnavailable(backendId: string): void {
    const previous = this.#health.get(backendId);
    const failures = (previous?.failures || 0) + 1;
    const cooldown = Math.min(300_000, this.#cooldownMs * (2 ** Math.min(4, failures - 1)));
    this.#health.set(backendId, { failures, cooldownUntil: this.#now() + cooldown });
  }
}
