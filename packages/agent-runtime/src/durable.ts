import { createHash } from 'node:crypto';
import type { AgentModelMessage, AgentRunCheckpoint, AgentToolCall, AgentTaskContext, ToolExecutionResult } from './types.js';

export interface AgentDurableCallBinding {
  readonly scopeId: string;
  readonly admissionId: string;
  readonly operationId: string;
  readonly originalToolCallId: string;
  readonly logicalParentOperationId: string;
}
export interface AgentPendingToolCall {
  readonly operationId: string;
  readonly call: AgentToolCall;
  readonly policyFingerprint: string;
  readonly state: 'prepared' | 'running' | 'completed';
  readonly result?: { readonly message: AgentModelMessage; readonly usage: { readonly inputTokens: number; readonly outputTokens: number }; readonly usageKnown: boolean };
}
export interface AgentPendingToolBatch {
  readonly schemaVersion: 1;
  readonly admissionId: string;
  readonly scopeId: string;
  readonly logicalParentOperationId: string;
  readonly turn: number;
  readonly originalAssistantMessage: AgentModelMessage;
  readonly calls: readonly AgentPendingToolCall[];
  readonly messageIndex: number;
  readonly usageBefore: { readonly inputTokens: number; readonly outputTokens: number };
  readonly usageKnownBefore: boolean;
  readonly toolCallsBefore: number;
  readonly executableCallCount: number;
  readonly taskContextBefore?: AgentTaskContext;
}
export interface AgentDurableCheckpointAck {
  readonly handle: string;
  readonly scopeId: string;
  readonly admissionId?: string;
  readonly checkpointHash: string;
  readonly revision: number;
}
export type AgentDurableCheckpointWriter = (checkpoint: AgentRunCheckpoint) => Promise<AgentDurableCheckpointAck>;
/** Exact values include undefined versus empty arrays; never infer logical identity from task text. */
export function durableFingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (v === undefined) return ['undefined'];
    if (v === null) return ['null'];
    if (typeof v === 'string' || typeof v === 'boolean') return [typeof v, v];
    if (typeof v === 'number') return ['number', Number.isFinite(v) ? v : String(v)];
    if (Array.isArray(v)) return ['array', v.map(canonical)];
    if (typeof v !== 'object') throw new Error('Unsupported fingerprint field');
    return ['object', Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])];
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export const durableCheckpointHash = (checkpoint: AgentRunCheckpoint): string => createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex');
export function assertDurableAck(checkpoint: AgentRunCheckpoint, ack: AgentDurableCheckpointAck | undefined): void {
  if (!ack || !/^resume-[a-f0-9-]{36}$/i.test(ack.handle) || ack.scopeId !== checkpoint.executionScopeId
    || ack.admissionId !== checkpoint.pendingToolBatch?.admissionId || ack.checkpointHash !== durableCheckpointHash(checkpoint)
    || !Number.isSafeInteger(ack.revision) || ack.revision < 1) throw Object.assign(new Error('Required tool checkpoint was not durably acknowledged'), { code: 'DURABLE_CHECKPOINT_ACK_REQUIRED' });
}
export function validatePendingBatch(value: AgentRunCheckpoint): void {
  if (value.version !== 3) {
    if (value.pendingToolBatch || value.accountedOperationIds || value.userInputStopReason || value.durableStop) throw new Error('Durable fields require checkpoint version3');
    return;
  }
  if (value.userInputStopReason !== undefined && !['user_input_cancelled', 'user_input_expired'].includes(value.userInputStopReason)) throw new Error('Invalid durable user decision');
  if (value.durableStop && (!['tool_call_limit_reached', 'input_token_limit_reached', 'output_token_limit_reached'].includes(value.durableStop.reason) || !Number.isSafeInteger(value.durableStop.turns) || value.durableStop.turns < 1)) throw new Error('Invalid durable stop');
  const ids = value.accountedOperationIds;
  if (!Array.isArray(ids) || ids.length > 20000 || new Set(ids).size !== ids.length || ids.some(id => !/^op-[a-f0-9-]{36}$/.test(id))) throw new Error('Invalid durable accounted operation IDs');
  const b = value.pendingToolBatch;
  if (!b) return;
  if (b.schemaVersion !== 1 || b.scopeId !== value.executionScopeId || !/^admit-[a-f0-9-]{36}$/.test(b.admissionId)
    || typeof b.logicalParentOperationId !== 'string' || !Number.isSafeInteger(b.turn) || b.turn !== value.nextTurn
    || b.messageIndex !== value.messages.length || !b.originalAssistantMessage || b.originalAssistantMessage.role !== 'assistant'
    || !Array.isArray(b.calls) || b.calls.length < 1 || b.calls.length > 320
    || !Number.isSafeInteger(b.executableCallCount) || b.executableCallCount < 0 || b.executableCallCount > b.calls.length
    || value.messages.some(message => message.toolCalls?.some(call => b.calls.some(c => c.call.id === call.id)))
    || !Array.isArray(b.originalAssistantMessage.toolCalls) || b.calls.length !== b.originalAssistantMessage.toolCalls.length
    || new Set(b.calls.map(x => x.operationId)).size !== b.calls.length || new Set(b.calls.map(x => x.call.id)).size !== b.calls.length
    || !b.usageBefore || b.usageBefore.inputTokens !== value.usage.inputTokens || b.usageBefore.outputTokens !== value.usage.outputTokens
    || typeof b.usageKnownBefore !== 'boolean' || b.toolCallsBefore !== value.toolCalls) throw new Error('Invalid durable tool batch');
  for (let i = 0; i < b.calls.length; i++) {
    const c = b.calls[i];
    if (!/^op-[a-f0-9-]{36}$/.test(c.operationId) || !/^[a-f0-9]{64}$/.test(c.policyFingerprint)
      || durableFingerprint(c.call) !== durableFingerprint(b.originalAssistantMessage.toolCalls[i])
      || ids.includes(c.operationId) || !['prepared', 'running', 'completed'].includes(c.state)
      || c.state === 'completed' && (!c.result || c.result.message.role !== 'tool' || c.result.message.toolCallId !== c.call.id
        || typeof c.result.message.content !== 'string' || typeof c.result.usageKnown !== 'boolean'
        || ![c.result.usage.inputTokens, c.result.usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0))
      || c.state !== 'completed' && c.result !== undefined) throw new Error('Invalid pending operation state');
  }
}
export function operationBinding(batch: AgentPendingToolBatch, operation: AgentPendingToolCall): AgentDurableCallBinding {
  return { scopeId: batch.scopeId, admissionId: batch.admissionId, operationId: operation.operationId,
    logicalParentOperationId: batch.logicalParentOperationId, originalToolCallId: operation.call.id };
}
export function durableToolResultMessage(call: AgentToolCall, result: ToolExecutionResult): AgentModelMessage {
  return { role: 'tool', toolCallId: call.id, content: JSON.stringify(result.ok ? { ok: true, output: result.output } : { ok: false, error: result.error }),
    ...(result.ok && result.attachments?.length ? { attachments: result.attachments } : {}) };
}
/** Physical host run IDs change on restart; every other task context field is retained. */
export function durableLogicalContext(context: unknown): unknown {
  if (!context || typeof context !== 'object') return context;
  const { rootRunId: _root, parentRunId: _parent, ...rest } = context as Record<string, unknown>;
  return rest;
}
