import { canonicalRuntimeFinal } from "./semantic-messages.js";
import { summarizeMessageMedia } from "./context-memory.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { Readable, Writable } from "node:stream";

import type {
  AgentCapabilities as AcpAgentCapabilities,
  ContentBlock,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  McpServer,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };

import type {
  AgentBackend,
  AgentBackendRunRequest,
  AgentMessageAttachment,
  AgentModelMessage,
  AgentRunEvent,
  AgentRunResult,
  AgentTaskPlanStep,
  AgentToolCompletionStatus,
  ToolExecutionSummary,
} from "./types.js";
import { AgentBackendCapabilityError } from "./backend-router.js";
import {
  DEFAULT_PROCESS_TREE_SHUTDOWN_GRACE_MS,
  terminateChildProcessTree,
} from "./child-process-tree.js";
import { agentRunPauseRequested } from "./runner.js";
import { agentTaskContextInstruction } from "./task-context.js";
import { semanticTaskPlanSteps } from "./task-plan.js";

const DEFAULT_STDERR_LIMIT = 64 * 1024;
const DEFAULT_INHERITED_ENVIRONMENT = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "LANG",
  "LC_ALL",
  "TERM",
  "COLORTERM",
] as const;

export interface AcpHostContext {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly permissionMode: AgentBackendRunRequest["permissionMode"];
  readonly signal?: AbortSignal;
  /** Associates host-side checkpoint writes with the active ACP tool event. */
  readonly onCheckpoint?: (summary: ToolExecutionSummary) => void | Promise<void>;
}

export interface AcpTerminalHost {
  create(request: CreateTerminalRequest, context: AcpHostContext): Promise<CreateTerminalResponse>;
  output(request: TerminalOutputRequest, context: AcpHostContext): Promise<TerminalOutputResponse>;
  release(request: ReleaseTerminalRequest, context: AcpHostContext): Promise<ReleaseTerminalResponse>;
  waitForExit(request: WaitForTerminalExitRequest, context: AcpHostContext): Promise<WaitForTerminalExitResponse>;
  kill(request: KillTerminalRequest, context: AcpHostContext): Promise<KillTerminalResponse>;
}

/** Host operations exposed to an external ACP agent. Omitted operations are not advertised. */
export interface AcpAgentHost {
  requestPermission?(
    request: RequestPermissionRequest,
    context: AcpHostContext,
  ): Promise<RequestPermissionResponse>;
  readTextFile?(request: ReadTextFileRequest, context: AcpHostContext): Promise<ReadTextFileResponse>;
  writeTextFile?(request: WriteTextFileRequest, context: AcpHostContext): Promise<WriteTextFileResponse>;
  readonly terminal?: AcpTerminalHost;
  /** Releases host-owned terminal/process resources after this backend run. */
  dispose?(): Promise<void>;
}

export interface AcpAgentBackendOptions {
  readonly id: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Explicit environment entries passed to the agent process. */
  readonly env?: Readonly<Record<string, string>>;
  /** Names copied from the parent environment. Secrets are not inherited implicitly. */
  readonly inheritEnvironment?: readonly string[];
  readonly host?: AcpAgentHost;
  readonly mcpServers?: readonly McpServer[];
  readonly shutdownGraceMs?: number;
  readonly maxStderrBytes?: number;
}

export class AcpCapabilityError extends AgentBackendCapabilityError {
  constructor(message: string) {
    super(message);
    this.name = "AcpCapabilityError";
  }
}

interface ToolState {
  readonly id: string;
  name: string;
  title: string;
  startedAt: number;
  completed: boolean;
  details: string[];
  checkpointId?: string;
}

class ForcedCancellationError extends Error {
  constructor() {
    super("ACP agent did not stop within the cancellation grace period");
    this.name = "ForcedCancellationError";
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : fallback;
}

function validUsage(value: number | null | undefined): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function inheritedEnvironment(names: readonly string[], explicit: Readonly<Record<string, string>> | undefined) {
  const environment: NodeJS.ProcessEnv = {};
  const parentEntries = Object.entries(process.env);
  for (const requestedName of names) {
    const entry = parentEntries.find(([name]) => name.toLowerCase() === requestedName.toLowerCase());
    if (entry?.[1] !== undefined) environment[entry[0]] = entry[1];
  }
  for (const [name, value] of Object.entries(explicit ?? {})) environment[name] = value;
  return environment;
}

function boundedStderr(child: ChildProcessWithoutNullStreams, limit: number): () => string {
  let chunks: Buffer[] = [];
  let size = 0;
  child.stderr.on("data", (value: Buffer | string) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    chunks.push(chunk);
    size += chunk.byteLength;
    while (size > limit && chunks.length > 1) {
      size -= chunks[0].byteLength;
      chunks = chunks.slice(1);
    }
    if (size > limit && chunks.length === 1) {
      chunks[0] = chunks[0].subarray(chunks[0].byteLength - limit);
      size = chunks[0].byteLength;
    }
  });
  return () => {
    let output = Buffer.concat(chunks);
    while (output.length && (output[0]! & 0xc0) === 0x80) output = output.subarray(1);
    return redactSecrets(output.toString("utf8").trim());
  };
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <REDACTED>")
    .replace(/\b(?:sk|nmxm)_[A-Za-z0-9_-]{12,}\b/g, "<REDACTED>")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "<REDACTED>");
}

function attachmentUri(name: string): string {
  return `nextmux://attachment/${encodeURIComponent(name)}`;
}

function historyBlock(history: readonly AgentModelMessage[] | undefined): ContentBlock | undefined {
  if (!history?.length) return undefined;
  const transcript = history.map(message => {
    const media = summarizeMessageMedia(message);
    const suffix = media.length ? `\n[Historical media: ${media.join('; ')}]` : "";
    return `${message.role.toUpperCase()}${message.toolCallId ? ` (${message.toolCallId})` : ""}:\n${message.content}${suffix}`;
  }).join("\n\n");
  return {
    type: "text",
    text: `[Conversation context supplied by NextMux]\n${transcript}\n[Current user message follows]`,
  };
}

function promptBlocks(
  request: AgentBackendRunRequest,
  agentCapabilities: AcpAgentCapabilities | null | undefined,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (request.taskContext) {
    blocks.push({ type: "text", text: agentTaskContextInstruction(request.taskContext) });
  }
  const history = historyBlock(request.history);
  if (history) blocks.push(history);
  blocks.push({ type: "text", text: request.prompt });

  const promptCapabilities = agentCapabilities?.promptCapabilities;
  for (const attachment of request.attachments ?? []) {
    blocks.push(attachmentBlock(attachment, promptCapabilities));
  }
  return blocks;
}

function attachmentBlock(
  attachment: AgentMessageAttachment,
  capabilities: AcpAgentCapabilities["promptCapabilities"] | null | undefined,
): ContentBlock {
  if (attachment.kind === "image") {
    if (!capabilities?.image) {
      throw new AcpCapabilityError(`The selected ACP agent does not support image prompt content (${attachment.name})`);
    }
    return {
      type: "image",
      data: attachment.dataBase64,
      mimeType: attachment.mimeType,
      uri: attachmentUri(attachment.name),
    };
  }
  if (attachment.kind === "text") {
    if (!capabilities?.embeddedContext) {
      return { type: "text", text: `[Attachment: ${attachment.name}]\n${attachment.content}` };
    }
    return {
      type: "resource",
      resource: {
        uri: attachmentUri(attachment.name),
        mimeType: "text/plain",
        text: attachment.content,
      },
    };
  }
  if (attachment.mimeType.startsWith("audio/")) {
    if (!capabilities?.audio) {
      throw new AcpCapabilityError(`The selected ACP agent does not support audio prompt content (${attachment.name})`);
    }
    return { type: "audio", data: attachment.dataBase64, mimeType: attachment.mimeType };
  }
  if (!capabilities?.embeddedContext) {
    throw new AcpCapabilityError(`The selected ACP agent does not support embedded file content (${attachment.name})`);
  }
  return {
    type: "resource",
    resource: {
      uri: attachmentUri(attachment.name),
      mimeType: attachment.mimeType,
      blob: attachment.dataBase64,
    },
  };
}

function toolSummary(state: ToolState): ToolExecutionSummary {
  return {
    title: state.title,
    ...(state.details.length ? { details: state.details } : {}),
    ...(state.checkpointId ? { checkpointId: state.checkpointId } : {}),
  };
}

function resultStateFromStopReason(stopReason: string): Pick<AgentRunResult, "status" | "stopReason"> {
  if (stopReason === "cancelled") return { status: "cancelled", stopReason: "cancel_requested" };
  if (stopReason === "max_tokens" || stopReason === "max_turn_requests") {
    return { status: "limit_reached", stopReason: "turn_limit_reached" };
  }
  return { status: "completed", stopReason: "completed" };
}

/**
 * ACP v1 adapter. It deliberately owns process supervision and protocol
 * translation so the desktop host only depends on the small AgentBackend seam.
 */
export class AcpAgentBackend implements AgentBackend {
  readonly id: string;
  readonly capabilities;
  readonly #options: AcpAgentBackendOptions;
  #lastNegotiatedCapabilities?: AcpAgentCapabilities;

  constructor(options: AcpAgentBackendOptions) {
    if (!options.id.trim()) throw new TypeError("ACP backend id is required");
    if (!options.command.trim()) throw new TypeError("ACP agent command is required");
    this.id = options.id;
    this.#options = options;
    const terminal = options.host?.terminal;
    this.capabilities = {
      streaming: true,
      cancellation: true,
      sessionResume: false,
      permissions: Boolean(options.host?.requestPermission),
      filesystem: Boolean(options.host?.readTextFile || options.host?.writeTextFile),
      terminal: Boolean(terminal),
      mcp: Boolean(options.mcpServers?.length),
      // ACP v1 has no portable cumulative token-budget contract. Selecting an
      // ACP backend for a bounded run must therefore fail closed in the router
      // instead of pretending that a prompt hint is enforcement.
      tokenBudget: false,
      toolPolicy: false,
      orderedOutput: false,
    } as const;
  }

  get negotiatedCapabilities(): AcpAgentCapabilities | undefined {
    return this.#lastNegotiatedCapabilities;
  }

  async run(request: AgentBackendRunRequest): Promise<AgentRunResult> {
    if (request.acceptOrderedOutput !== undefined || request.checkpoint?.version === 2
      || request.checkpoint?.messages.some(message => message.outputParts !== undefined)
      || request.history?.some(message => message.outputParts !== undefined)) {
      throw new AgentBackendCapabilityError('ACP backend cannot preserve ordered output references; use an opted-in builtin host');
    }
    // ACP v1 has no portable way to report cumulative input/output usage or
    // enforce a remaining output ceiling.  Do not silently ignore a caller's
    // safety contract when this adapter is used directly instead of through
    // AgentBackendRouter.
    if (request.tokenBudget !== undefined) {
      throw new AgentBackendCapabilityError("ACP backend does not support cumulative token budgets");
    }
    if (request.allowedToolNames !== undefined || request.checkpoint?.toolPolicy) {
      throw new AgentBackendCapabilityError("ACP backend cannot enforce a run-scoped tool or Skill policy; use the builtin backend");
    }
    const runId = request.runId?.trim() || randomUUID();
    const events: AgentRunEvent[] = [];
    const toolStates = new Map<string, ToolState>();
    let finalText = "";
    let toolCalls = 0;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let usageKnown = true;
    const shutdownGraceMs = boundedInteger(
      this.#options.shutdownGraceMs,
      DEFAULT_PROCESS_TREE_SHUTDOWN_GRACE_MS,
      50,
      30_000,
    );

    const emit = async (event: AgentRunEvent): Promise<void> => {
      events.push(event);
      await request.onEvent?.(event);
    };
    const cancelledResult = (): AgentRunResult => {
      const paused = agentRunPauseRequested(request.signal);
      return {
        runId,
        status: paused ? "paused" : "cancelled",
        stopReason: paused ? "pause_requested" : "cancel_requested",
        finalText: finalText.trim() || canonicalRuntimeFinal({ origin: "runtime", stopReason: paused ? "pause_requested" : "cancel_requested" }),
        ...(!finalText.trim() ? { finalMessage: { origin: "runtime" as const, stopReason: paused ? "pause_requested" as const : "cancel_requested" as const } } : {}),
        events,
        usage,
        usageKnown,
        turns: events.some(event => event.type === "model_started") ? 1 : 0,
        toolCalls,
      };
    };

    if (request.signal?.aborted) return cancelledResult();
    const workspaceRoot = resolve(request.workspaceRoot);
    if (!isAbsolute(workspaceRoot)) throw new TypeError("ACP workspace root must be absolute");

    const child = spawn(this.#options.command, [...(this.#options.args ?? [])], {
      cwd: this.#options.cwd ? resolve(this.#options.cwd) : workspaceRoot,
      env: inheritedEnvironment(
        this.#options.inheritEnvironment ?? DEFAULT_INHERITED_ENVIRONMENT,
        this.#options.env,
      ),
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stderr = boundedStderr(
      child,
      boundedInteger(this.#options.maxStderrBytes, DEFAULT_STDERR_LIMIT, 1_024, 1024 * 1024),
    );
    const processError = new Promise<never>((_, reject) => child.once("error", reject));
    let activeSessionId: string | undefined;
    let forceCancellationTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectForcedCancellation: ((reason: Error) => void) | undefined;
    const forcedCancellation = new Promise<never>((_, reject) => {
      rejectForcedCancellation = reject;
    });

    const onAbort = () => {
      forceCancellationTimer = setTimeout(
        () => rejectForcedCancellation?.(new ForcedCancellationError()),
        shutdownGraceMs,
      );
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });

    const hostContext: AcpHostContext = {
      runId,
      workspaceRoot,
      permissionMode: request.permissionMode,
      signal: request.signal,
      onCheckpoint: async summary => {
        const active = [...toolStates.values()].reverse().find(state => !state.completed);
        if (active) {
          active.checkpointId = summary.checkpointId;
          return;
        }
        const callId = `acp-host-checkpoint-${randomUUID()}`;
        await emit({
          type: "tool_started",
          callId,
          toolName: "workspace.write_file",
          source: "acp",
          summary,
          at: new Date().toISOString(),
        });
        await emit({
          type: "tool_completed",
          callId,
          toolName: "workspace.write_file",
          ok: true,
          status: "succeeded",
          durationMs: 0,
          summary,
          at: new Date().toISOString(),
        });
      },
    };
    try {
      await emit({ type: "model_started", turn: 1, at: new Date().toISOString() });
      const acp = await import("@agentclientprotocol/sdk");
      const terminal = this.#options.host?.terminal;
      const app = acp
        .client({ name: "nextmux" })
        .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
          const handler = this.#options.host?.requestPermission;
          if (handler) return handler(params, hostContext);
          const reject = params.options.find(option => option.kind === "reject_once")
            ?? params.options.find(option => option.kind === "reject_always");
          return reject
            ? { outcome: { outcome: "selected" as const, optionId: reject.optionId } }
            : { outcome: { outcome: "cancelled" as const } };
        });

      if (this.#options.host?.readTextFile) {
        app.onRequest(acp.methods.client.fs.readTextFile, ({ params }) =>
          this.#options.host!.readTextFile!(params, hostContext));
      }
      if (this.#options.host?.writeTextFile) {
        app.onRequest(acp.methods.client.fs.writeTextFile, ({ params }) =>
          this.#options.host!.writeTextFile!(params, hostContext));
      }
      if (terminal) {
        app
          .onRequest(acp.methods.client.terminal.create, ({ params }) => terminal.create(params, hostContext))
          .onRequest(acp.methods.client.terminal.output, ({ params }) => terminal.output(params, hostContext))
          .onRequest(acp.methods.client.terminal.release, ({ params }) => terminal.release(params, hostContext))
          .onRequest(acp.methods.client.terminal.waitForExit, ({ params }) => terminal.waitForExit(params, hostContext))
          .onRequest(acp.methods.client.terminal.kill, ({ params }) => terminal.kill(params, hostContext));
      }

      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const protocolOperation = app.connectWith(stream, async context => {
        const initialized = await context.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientInfo: { name: "NextMux", version: "0.1.0" },
          clientCapabilities: {
            fs: {
              readTextFile: Boolean(this.#options.host?.readTextFile),
              writeTextFile: Boolean(this.#options.host?.writeTextFile),
            },
            terminal: this.capabilities.terminal,
            plan: {},
          },
        }, { cancellationSignal: request.signal });
        if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
          throw new Error(`ACP protocol version mismatch: agent=${initialized.protocolVersion}, client=${acp.PROTOCOL_VERSION}`);
        }
        this.#lastNegotiatedCapabilities = initialized.agentCapabilities;

        return context.buildSession({
          cwd: workspaceRoot,
          mcpServers: [...(this.#options.mcpServers ?? [])],
          _meta: {
            "nextmux.dev/runId": runId,
            ...(request.reasoningEffort ? { "nextmux.dev/reasoningEffort": request.reasoningEffort } : {}),
          },
        }).withSession(async session => {
          activeSessionId = session.sessionId;
          const sendCancel = () => {
            void context.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
          };
          request.signal?.addEventListener("abort", sendCancel, { once: true });
          if (request.signal?.aborted) sendCancel();
          try {
            const promptError = new Promise<never>((_resolve, reject) => {
              session.prompt(
                promptBlocks(request, initialized.agentCapabilities),
                { cancellationSignal: request.signal },
              ).catch(reject);
            });
            promptError.catch(() => undefined);
            for (;;) {
              const message = await Promise.race([session.nextUpdate(), promptError]);
              if (message.kind === "stop") return message.response;
              await this.#handleUpdate(message.update, toolStates, emit, value => {
                finalText += value;
              });
              toolCalls = toolStates.size;
            }
          } finally {
            request.signal?.removeEventListener("abort", sendCancel);
          }
        });
      });

      const response = await Promise.race([protocolOperation, processError, forcedCancellation]);
      if (forceCancellationTimer) clearTimeout(forceCancellationTimer);
      usageKnown = response.usage !== undefined && response.usage !== null
        && validUsage(response.usage.inputTokens) === response.usage.inputTokens
        && validUsage(response.usage.outputTokens) === response.usage.outputTokens;
      usage = {
        inputTokens: validUsage(response.usage?.inputTokens),
        outputTokens: validUsage(response.usage?.outputTokens),
      };
      await emit({ type: "model_completed", turn: 1, toolCallCount: toolCalls, at: new Date().toISOString() });
      const unfinishedStatus: AgentToolCompletionStatus = response.stopReason === "cancelled" ? "cancelled" : "failed";
      for (const state of toolStates.values()) {
        if (!state.completed) await this.#completeTool(state, unfinishedStatus, emit);
      }
      if (request.signal?.aborted) return cancelledResult();
      const resultState = resultStateFromStopReason(response.stopReason);
      const finalMessage = { origin: "runtime" as const, stopReason: resultState.stopReason === "completed" ? "empty_response" as const : resultState.stopReason };
      return {
        runId,
        ...resultState,
        finalText: finalText.trim() || canonicalRuntimeFinal(finalMessage),
        ...(!finalText.trim() ? { finalMessage } : {}),
        events,
        usage,
        usageKnown,
        turns: 1,
        toolCalls,
      };
    } catch (error) {
      if (request.signal?.aborted || error instanceof ForcedCancellationError) {
        for (const state of toolStates.values()) {
          if (!state.completed) await this.#completeTool(state, "cancelled", emit);
        }
        return cancelledResult();
      }
      for (const state of toolStates.values()) {
        if (!state.completed) await this.#completeTool(state, "failed", emit);
      }
      if (error instanceof AcpCapabilityError) throw error;
      const detail = stderr();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ACP backend ${this.id} failed: ${message}${detail ? `\nAgent stderr:\n${detail}` : ""}`, {
        cause: error,
      });
    } finally {
      if (forceCancellationTimer) clearTimeout(forceCancellationTimer);
      request.signal?.removeEventListener("abort", onAbort);
      if (request.signal?.aborted && activeSessionId) {
        // The cooperative notification is sent inside the active-session scope.
        // Process supervision below is the final guarantee that no child survives.
      }
      await terminateChildProcessTree(child, shutdownGraceMs);
      await this.#options.host?.dispose?.();
    }
  }

  async #handleUpdate(
    update: SessionUpdate,
    tools: Map<string, ToolState>,
    emit: (event: AgentRunEvent) => Promise<void>,
    appendText: (value: string) => void,
  ): Promise<void> {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text" && update.content.text) {
          appendText(update.content.text);
          await emit({
            type: "assistant_progress",
            turn: 1,
            content: update.content.text,
            origin: "model",
            at: new Date().toISOString(),
          });
        }
        return;
      case "tool_call": {
        const state: ToolState = {
          id: update.toolCallId,
          name: update.name?.trim() || update.title,
          title: update.title,
          startedAt: Date.now(),
          completed: false,
          details: (update.locations ?? []).map(location =>
            location.line ? `${location.path}:${location.line}` : location.path),
        };
        tools.set(update.toolCallId, state);
        await emit({
          type: "tool_started",
          callId: state.id,
          toolName: state.name,
          source: "acp",
          summary: toolSummary(state),
          at: new Date().toISOString(),
        });
        if (update.status === "completed" || update.status === "failed") {
          await this.#completeTool(state, update.status === "completed" ? "succeeded" : "failed", emit);
        }
        return;
      }
      case "tool_call_update": {
        const existing = tools.get(update.toolCallId);
        const state = existing ?? {
          id: update.toolCallId,
          name: update.name?.trim() || update.title?.trim() || "ACP tool",
          title: update.title?.trim() || update.name?.trim() || "ACP tool",
          startedAt: Date.now(),
          completed: false,
          details: [],
        };
        if (!existing) {
          tools.set(update.toolCallId, state);
          await emit({
            type: "tool_started",
            callId: state.id,
            toolName: state.name,
            source: "acp",
            summary: toolSummary(state),
            at: new Date().toISOString(),
          });
        }
        if (update.name?.trim()) state.name = update.name.trim();
        if (update.title?.trim()) state.title = update.title.trim();
        if (update.locations) {
          state.details = update.locations.map(location =>
            location.line ? `${location.path}:${location.line}` : location.path);
        }
        if (update.status === "completed" || update.status === "failed") {
          await this.#completeTool(state, update.status === "completed" ? "succeeded" : "failed", emit);
        }
        return;
      }
      case "plan": {
        const steps: AgentTaskPlanStep[] = [];
        for (const [index, entry] of update.entries.slice(0, 12).entries()) {
          const title = entry.content.replace(/\s+/g, " ").trim().slice(0, 180);
          const status = entry.status === "completed" ? "completed"
            : entry.status === "in_progress" ? "in_progress"
              : entry.status === "pending" ? "pending" : undefined;
          if (title && status) steps.push({ id: `acp-plan-${index + 1}`, title, status });
        }
        // ACP agents are allowed to publish a plan, but some adapters mirror
        // their read/search/command transcript into the same update.  Apply
        // the same semantic boundary used by the native runner before the
        // event becomes durable or reaches a host UI.
        const semanticSteps = semanticTaskPlanSteps(steps);
        if (semanticSteps.length) {
          await emit({
            type: "task_plan_updated",
            steps: semanticSteps,
            source: "model",
            at: new Date().toISOString(),
          });
        }
        return;
      }
      case "compaction_update":
        if (update.status === "in_progress") {
          await emit({
            type: "context_compaction_started",
            turn: 1,
            segment: 1,
            at: new Date().toISOString(),
          });
        } else if (update.status === "completed") {
          await emit({
            type: "context_compaction_completed",
            turn: 1,
            segment: 1,
            messagesBefore: 0,
            messagesAfter: 0,
            at: new Date().toISOString(),
          });
        }
        return;
      case "agent_thought_chunk":
        // Hidden reasoning is intentionally never surfaced to the desktop UI.
        return;
      default:
        return;
    }
  }

  async #completeTool(
    state: ToolState,
    status: AgentToolCompletionStatus,
    emit: (event: AgentRunEvent) => Promise<void>,
  ): Promise<void> {
    if (state.completed) return;
    state.completed = true;
    await emit({
      type: "tool_completed",
      callId: state.id,
      toolName: state.name,
      ok: status === "succeeded",
      status,
      summary: toolSummary(state),
      durationMs: Math.max(0, Date.now() - state.startedAt),
      at: new Date().toISOString(),
    });
  }
}
