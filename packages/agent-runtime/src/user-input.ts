import { randomUUID } from "node:crypto";
import { AgentToolError } from "./errors.js";
import type { AgentPermissionApprovalRequest, AgentRunEvent, AgentUserAnswer, AgentUserInputResult, AgentUserQuestion, AgentUserQuestionRequest } from "./types.js";

export const AGENT_USER_INPUT_TOOL_NAME = "task.request_user_input";

export function validateUserQuestion(value: unknown): AgentUserQuestionRequest {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > 2_000 || prompt.includes("\0")) {
    throw new AgentToolError("INVALID_USER_QUESTION", "A question must contain 1 to 2000 characters");
  }
  const candidates = input.options ?? [];
  if (!Array.isArray(candidates) || candidates.length > 6) throw new AgentToolError("INVALID_USER_QUESTION", "A question accepts up to 6 options");
  const ids = new Set<string>();
  const options = candidates.map(candidate => {
    const option = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
    const id = typeof option.id === "string" ? option.id : "";
    const label = typeof option.label === "string" ? option.label.trim() : "";
    const description = typeof option.description === "string" ? option.description.trim() : "";
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id) || ids.has(id) || !label || label.length > 160 || description.length > 500 || /\0/.test(label + description)) {
      throw new AgentToolError("INVALID_USER_QUESTION", "Question options must have unique IDs and bounded labels");
    }
    ids.add(id);
    return { id, label, ...(description ? { description } : {}) };
  });
  return { prompt, options };
}

/** One host-owned question channel per run; ordinary messages never enter it. */
export class AgentUserInputBroker {
  readonly #runId: string;
  readonly #taskId: string;
  readonly #timeoutMs: number;
  readonly #onEvent?: (event: AgentRunEvent) => void | Promise<void>;
  readonly #receipts = new Map<string, string>();
  #pending?: { question: AgentUserQuestion; settle: (result: AgentUserInputResult) => void };

  constructor(options: { runId: string; taskId: string; timeoutMs?: number; onEvent?: (event: AgentRunEvent) => void | Promise<void> }) {
    if (!/^[A-Za-z0-9._:-]{8,180}$/.test(options.runId) || !options.taskId || options.taskId.length > 300 || /[\0\r\n]/.test(options.taskId)) {
      throw new AgentToolError("INVALID_USER_QUESTION_OWNER", "Question owner is invalid");
    }
    this.#runId = options.runId;
    this.#taskId = options.taskId;
    this.#timeoutMs = options.timeoutMs ?? 24 * 60 * 60 * 1_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 86_400_000) throw new AgentToolError("INVALID_USER_QUESTION_TIMEOUT", "Question timeout is invalid");
    this.#onEvent = options.onEvent;
  }

  get pendingQuestion(): AgentUserQuestion | undefined {
    return this.#pending ? structuredClone(this.#pending.question) : undefined;
  }

  #emit(event: AgentRunEvent): void {
    // Event observers are advisory. A failed renderer/journal notification
    // must never strand the waiter or make an accepted answer fail to resolve.
    try { void Promise.resolve(this.#onEvent?.(event)).catch(() => undefined); }
    catch { /* The authoritative snapshot remains available. */ }
  }

  request(value: unknown, signal?: AbortSignal): Promise<AgentUserInputResult> {
    return this.#requestValidated(validateUserQuestion(value), signal);
  }

  async requestApproval(approval: AgentPermissionApprovalRequest, signal?: AbortSignal): Promise<boolean> {
    if (!approval || !["external_file", "unsandboxed_command", "process_input"].includes(approval.scope)
      || typeof approval.target !== "string" || approval.target.length > 24_000 || approval.target.includes("\0")
      || typeof approval.toolName !== "string" || approval.toolName.length > 180
      || approval.detail !== undefined && (typeof approval.detail !== "string" || approval.detail.length > 8_192)) {
      throw new AgentToolError("INVALID_PERMISSION_REQUEST", "Invalid permission request");
    }
    const result = await this.#requestValidated({ prompt: approval.toolName, options: [
      { id: "allow_once", label: "Allow once" }, { id: "deny", label: "Deny" }
    ] }, signal, structuredClone(approval));
    return result.status === "answered" && result.answer?.optionId === "allow_once";
  }

  #requestValidated(request: AgentUserQuestionRequest, signal?: AbortSignal, approval?: AgentPermissionApprovalRequest): Promise<AgentUserInputResult> {
    if (this.#pending) throw new AgentToolError("USER_QUESTION_PENDING", "Answer the current question before asking another");
    if (signal?.aborted) return Promise.resolve({ status: "cancelled" });
    const now = Date.now();
    const effectiveTimeoutMs = approval?.autoIgnoreAfterMs && Number.isSafeInteger(approval.autoIgnoreAfterMs) && approval.autoIgnoreAfterMs > 0
      ? Math.min(this.#timeoutMs, approval.autoIgnoreAfterMs)
      : this.#timeoutMs;
    const question: AgentUserQuestion = {
      ...request, options: request.options ?? [], questionId: `question-${randomUUID()}`,
      runId: this.#runId, taskId: this.#taskId, allowFreeText: !approval,
      ...(approval ? { kind: "permission" as const, approval } : {}),
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + effectiveTimeoutMs).toISOString(),
    };
    return new Promise(resolve => {
      const abort = (): void => settle({ status: "cancelled" });
      const timer = setTimeout(() => settle({ status: "expired" }), effectiveTimeoutMs);
      const settle = (result: AgentUserInputResult): void => {
        if (this.#pending?.question.questionId !== question.questionId) return;
        this.#pending = undefined;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.#emit({ type: "user_input_resolved", questionId: question.questionId, runId: this.#runId, taskId: this.#taskId, status: result.status, ...(result.answer ? { answer: structuredClone(result.answer) } : {}), at: new Date().toISOString() });
        resolve(result);
      };
      this.#pending = { question, settle };
      signal?.addEventListener("abort", abort, { once: true });
      this.#emit({ type: "user_input_requested", question: structuredClone(question), at: question.createdAt });
    });
  }

  answer(value: AgentUserAnswer): { accepted: true; replayed?: boolean } {
    if (!value || value.runId !== this.#runId || value.taskId !== this.#taskId) throw new AgentToolError("USER_QUESTION_OWNER_MISMATCH", "This answer belongs to another task or run");
    if (typeof value.questionId !== "string" || !/^question-[a-f0-9-]{36}$/.test(value.questionId)) throw new AgentToolError("INVALID_USER_ANSWER", "Question identifier is invalid");
    if (value.cancelled !== undefined && value.cancelled !== true
      || value.optionId !== undefined && (typeof value.optionId !== "string" || !/^[A-Za-z0-9._:-]{1,80}$/.test(value.optionId))
      || value.text !== undefined && (typeof value.text !== "string" || value.text.length > 10_000)) {
      throw new AgentToolError("INVALID_USER_ANSWER", "Answer fields are invalid");
    }
    const optionId = value.optionId || undefined;
    const text = value.text?.trim() || undefined;
    if (text && (text.length > 10_000 || text.includes("\0")) || value.cancelled && (optionId || text) || !value.cancelled && !optionId && !text) {
      throw new AgentToolError("INVALID_USER_ANSWER", "Choose an option or provide a bounded free-text answer");
    }
    const fingerprint = JSON.stringify({ optionId, text, cancelled: value.cancelled });
    const receipt = this.#receipts.get(value.questionId);
    if (receipt !== undefined) {
      if (receipt !== fingerprint) throw new AgentToolError("USER_ANSWER_CONFLICT", "This question already has a different answer");
      return { accepted: true, replayed: true };
    }
    const pending = this.#pending;
    if (!pending || pending.question.questionId !== value.questionId) throw new AgentToolError("USER_QUESTION_STALE", "This question is no longer awaiting an answer");
    if (Date.now() >= Date.parse(pending.question.expiresAt)) {
      pending.settle({ status: "expired" });
      throw new AgentToolError("USER_QUESTION_STALE", "This question has expired");
    }
    if (pending.question.kind === "permission" && !value.cancelled && (text || !optionId)) {
      throw new AgentToolError("INVALID_USER_ANSWER", "Permission requires an explicit scoped option");
    }
    const option = pending.question.options.find(candidate => candidate.id === optionId);
    if (optionId && !option) throw new AgentToolError("INVALID_USER_ANSWER", "The selected option does not belong to this question");
    this.#receipts.set(value.questionId, fingerprint);
    if (this.#receipts.size > 32) this.#receipts.delete(this.#receipts.keys().next().value!);
    pending.settle(value.cancelled ? { status: "cancelled" } : {
      status: "answered", answer: { ...(option ? { optionId: option.id, optionLabel: option.label } : {}), ...(text ? { text } : {}) },
    });
    return { accepted: true };
  }
}
