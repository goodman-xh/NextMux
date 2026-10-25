import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };

import type { AcpAgentHost, AcpHostContext, AcpTerminalHost } from "./acp-backend.js";
import {
  DEFAULT_PROCESS_TREE_SHUTDOWN_GRACE_MS,
  terminateChildProcessTree,
} from "./child-process-tree.js";
import { AgentToolRegistry } from "./registry.js";

const DEFAULT_TERMINAL_OUTPUT_BYTES = 1024 * 1024;
const MAX_TERMINALS = 16;
const SAFE_PARENT_ENVIRONMENT = [
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE",
] as const;

interface TerminalExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

interface TerminalState {
  readonly id: string;
  readonly sessionId: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly outputLimit: number;
  readonly exited: Promise<TerminalExit>;
  chunks: Buffer[];
  bytes: number;
  truncated: boolean;
  exit?: TerminalExit;
  termination?: Promise<void>;
}

export interface ToolRegistryAcpHostOptions {
  readonly tools: AgentToolRegistry;
  readonly maximumTerminals?: number;
  readonly defaultTerminalOutputBytes?: number;
  readonly terminalShutdownGraceMs?: number;
}

export interface DisposableAcpAgentHost extends AcpAgentHost {
  dispose(): Promise<void>;
}

function boundedInteger(value: number | null | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : fallback;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function resolveRealTarget(target: string): string | undefined {
  let probe = target;
  const suffix: string[] = [];
  for (;;) {
    try {
      const realProbe = realpathSync(probe);
      return suffix.length ? resolve(realProbe, ...suffix.reverse()) : realProbe;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") return undefined;
      const parent = dirname(probe);
      if (parent === probe) return undefined;
      suffix.push(basename(probe));
      probe = parent;
    }
  }
}

/** A whole-file ACP read (no `limit`) holds at most this much text; larger files are read in line ranges. */
const ACP_READ_TEXT_MAX_CHARS = 4 * 1024 * 1024;

function workspaceRelativePath(path: string, context: AcpHostContext): string {
  const root = resolve(context.workspaceRoot);
  const absolute = resolve(root, path);
  const child = relative(root, absolute);
  if (!child || child === "." || child.startsWith("..\\") || child.startsWith("../") || isAbsolute(child)) {
    throw new Error("ACP file path must identify a file inside the current workspace");
  }
  const realRoot = resolveRealTarget(root);
  const realAbsolute = resolveRealTarget(absolute);
  if (realRoot && realAbsolute) {
    const realChild = relative(realRoot, realAbsolute);
    if (!realChild || realChild === "." || realChild.startsWith("..\\") || realChild.startsWith("../") || isAbsolute(realChild)) {
      throw new Error("ACP file path must identify a file inside the current workspace");
    }
  }
  return child.replace(/\\/g, "/");
}

function terminalWorkingDirectory(request: CreateTerminalRequest, context: AcpHostContext): string {
  const root = resolve(context.workspaceRoot);
  const cwd = resolve(root, request.cwd || root);
  const child = relative(root, cwd);
  if (child === ".." || child.startsWith("..\\") || child.startsWith("../") || isAbsolute(child)) {
    throw new Error("ACP terminal working directory must stay inside the current workspace");
  }
  const realRoot = resolveRealTarget(root);
  const realCwd = resolveRealTarget(cwd);
  if (realRoot && realCwd) {
    const realChild = relative(realRoot, realCwd);
    if (realChild === ".." || realChild.startsWith("..\\") || realChild.startsWith("../") || isAbsolute(realChild)) {
      throw new Error("ACP terminal working directory must stay inside the current workspace");
    }
    return realCwd;
  }
  return cwd;
}

function throwToolFailure(result: Awaited<ReturnType<AgentToolRegistry["execute"]>>): never {
  throw new Error(result.error?.message || "ACP host tool failed");
}

function appendOutput(state: TerminalState, value: Buffer | string): void {
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
  state.chunks.push(chunk);
  state.bytes += chunk.byteLength;
  while (state.bytes > state.outputLimit && state.chunks.length > 1) {
    state.bytes -= state.chunks[0].byteLength;
    state.chunks.shift();
    state.truncated = true;
  }
  if (state.bytes > state.outputLimit && state.chunks.length === 1) {
    const current = state.chunks[0];
    state.chunks[0] = current.subarray(current.byteLength - state.outputLimit);
    state.bytes = state.chunks[0].byteLength;
    state.truncated = true;
  }
}

function outputText(state: TerminalState): string {
  let output = Buffer.concat(state.chunks);
  // If truncation starts in the middle of a UTF-8 sequence, discard only the
  // leading continuation bytes so the protocol always receives valid text.
  while (output.length && (output[0] & 0xc0) === 0x80) output = output.subarray(1);
  return output.toString("utf8");
}

class RegistryTerminalHost implements AcpTerminalHost {
  readonly #terminals = new Map<string, TerminalState>();
  readonly #maximumTerminals: number;
  readonly #defaultOutputBytes: number;
  readonly #shutdownGraceMs: number;

  constructor(options: ToolRegistryAcpHostOptions) {
    this.#maximumTerminals = boundedInteger(options.maximumTerminals, MAX_TERMINALS, 1, 64);
    this.#defaultOutputBytes = boundedInteger(
      options.defaultTerminalOutputBytes,
      DEFAULT_TERMINAL_OUTPUT_BYTES,
      4_096,
      16 * 1024 * 1024,
    );
    this.#shutdownGraceMs = boundedInteger(
      options.terminalShutdownGraceMs,
      DEFAULT_PROCESS_TREE_SHUTDOWN_GRACE_MS,
      50,
      30_000,
    );
  }

  async create(request: CreateTerminalRequest, context: AcpHostContext): Promise<CreateTerminalResponse> {
    if (context.permissionMode !== "full_access") throw new Error("ACP terminal requires full access");
    if (context.signal?.aborted) throw new Error("ACP task was cancelled");
    if (this.#terminals.size >= this.#maximumTerminals) {
      for (const [id, existing] of this.#terminals) {
        if (existing.exit !== undefined) {
          this.#terminals.delete(id);
          if (this.#terminals.size < this.#maximumTerminals) break;
        }
      }
    }
    if (this.#terminals.size >= this.#maximumTerminals) throw new Error("ACP terminal limit reached");
    if (!request.command.trim() || /[\0\r\n]/.test(request.command)) throw new Error("ACP terminal command is invalid");
    const args = request.args ?? [];
    if (args.length > 64 || args.some(argument => argument.length > 4_096 || argument.includes("\0"))) {
      throw new Error("ACP terminal arguments are invalid");
    }
    const requestedEnvironment = request.env ?? [];
    if (requestedEnvironment.length > 64 || requestedEnvironment.some(entry =>
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(entry.name) || entry.value.length > 16_384 || entry.value.includes("\0"))) {
      throw new Error("ACP terminal environment is invalid");
    }
    const environment: NodeJS.ProcessEnv = {};
    for (const name of SAFE_PARENT_ENVIRONMENT) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    for (const entry of requestedEnvironment) environment[entry.name] = entry.value;
    const terminalId = `acp-terminal-${randomUUID()}`;
    const child = spawn(request.command, [...args], {
      cwd: terminalWorkingDirectory(request, context),
      env: environment,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let resolveExit!: (value: TerminalExit) => void;
    const exited = new Promise<TerminalExit>(resolvePromise => { resolveExit = resolvePromise; });
    const state: TerminalState = {
      id: terminalId,
      sessionId: request.sessionId,
      child,
      outputLimit: boundedInteger(request.outputByteLimit, this.#defaultOutputBytes, 4_096, 16 * 1024 * 1024),
      exited,
      chunks: [],
      bytes: 0,
      truncated: false,
    };
    let settled = false;
    const settle = (exit: TerminalExit): void => {
      if (settled) return;
      settled = true;
      state.exit = exit;
      resolveExit(exit);
    };
    child.stdout.on("data", value => appendOutput(state, value));
    child.stderr.on("data", value => appendOutput(state, value));
    child.once("error", error => {
      appendOutput(state, `\n${error.message}`);
      settle({ exitCode: null, signal: null });
    });
    child.once("close", (exitCode, signal) => settle({ exitCode, signal }));
    const cancel = () => { void this.#terminate(state); };
    context.signal?.addEventListener("abort", cancel, { once: true });
    exited.finally(() => context.signal?.removeEventListener("abort", cancel)).catch(() => undefined);
    this.#terminals.set(terminalId, state);
    return { terminalId };
  }

  async output(request: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const state = this.#terminal(request.terminalId, request.sessionId);
    return {
      output: outputText(state),
      truncated: state.truncated,
      ...(state.exit ? { exitStatus: state.exit } : {}),
    };
  }

  async waitForExit(request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    return this.#terminal(request.terminalId, request.sessionId).exited;
  }

  async kill(request: KillTerminalRequest): Promise<KillTerminalResponse> {
    await this.#terminate(this.#terminal(request.terminalId, request.sessionId));
    return {};
  }

  async release(request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
    const state = this.#terminal(request.terminalId, request.sessionId);
    await this.#terminate(state);
    this.#terminals.delete(state.id);
    return {};
  }

  async dispose(): Promise<void> {
    const states = [...this.#terminals.values()];
    this.#terminals.clear();
    await Promise.allSettled(states.map(state => this.#terminate(state)));
  }

  async #terminate(state: TerminalState): Promise<void> {
    state.termination ??= terminateChildProcessTree(state.child, this.#shutdownGraceMs);
    await state.termination;
  }

  #terminal(terminalId: string, sessionId: string): TerminalState {
    const state = this.#terminals.get(terminalId);
    if (!state || state.sessionId !== sessionId) throw new Error("Unknown ACP terminal");
    return state;
  }
}

/**
 * Bridges ACP client-owned file, permission, and terminal operations into the
 * same bounded NextMux tool/checkpoint layer used by the built-in runtime.
 */
export function createToolRegistryAcpHost(options: ToolRegistryAcpHostOptions): DisposableAcpAgentHost {
  const terminal = new RegistryTerminalHost(options);
  const observedSha256ByPath = new Map<string, string>();
  const pathKey = (path: string, context: AcpHostContext): string =>
    `${resolve(context.workspaceRoot)}\0${path}`;
  const execute = async (name: string, args: unknown, context: AcpHostContext) => {
    const result = await options.tools.execute({
      id: `acp-host-${randomUUID()}`,
      name,
      arguments: args,
    }, context.permissionMode, {
      runId: context.runId,
      workspaceRoot: context.workspaceRoot,
      signal: context.signal,
      permissionMode: context.permissionMode,
      allowedToolNames: [name],
    });
    if (!result.ok) throwToolFailure(result);
    if (result.summary.checkpointId) await context.onCheckpoint?.(result.summary);
    return record(result.output);
  };

  return {
    async requestPermission(request: RequestPermissionRequest, context: AcpHostContext): Promise<RequestPermissionResponse> {
      const allow = context.permissionMode === "full_access"
        ? request.options.find(option => option.kind === "allow_once")
          ?? request.options.find(option => option.kind === "allow_always")
        : undefined;
      const selection = allow
        ?? request.options.find(option => option.kind === "reject_once")
        ?? request.options.find(option => option.kind === "reject_always");
      return selection
        ? { outcome: { outcome: "selected", optionId: selection.optionId } }
        : { outcome: { outcome: "cancelled" } };
    },
    async readTextFile(request: ReadTextFileRequest, context: AcpHostContext): Promise<ReadTextFileResponse> {
      const path = workspaceRelativePath(request.path, context);
      const startLine = request.line ?? 1;
      const read = (fromLine: number) => execute("workspace.read_file", {
        path,
        startLine: fromLine,
        ...(request.limit ? { endLine: startLine + request.limit - 1 } : {}),
      }, context);
      let output = await read(startLine);
      const sha256 = typeof output.sha256 === "string" ? output.sha256 : undefined;
      if (sha256) observedSha256ByPath.set(pathKey(path, context), sha256);
      let content = typeof output.content === "string" ? output.content : "";
      if (request.limit || output.truncated !== true || typeof output.totalLines !== "number") return { content };
      // Without a limit the agent gets the whole file, and may write it back: page through it by whole lines, from one
      // version of the file, and refuse rather than return a line cut short or a file too large to hold.
      const totalLines = output.totalLines;
      const pages: string[] = [];
      let size = 0;
      let nextLine = startLine;
      for (;;) {
        const lines = content.split("\n");
        const complete = output.truncated === true ? lines.slice(0, -1) : lines;
        if (!complete.length) throw new Error(`ACP cannot read ${request.path} whole: line ${nextLine} is longer than one read page; request it with line and limit`);
        const page = complete.join("\n");
        size += page.length + 1;
        if (size > ACP_READ_TEXT_MAX_CHARS) throw new Error(`ACP cannot read ${request.path} whole: it is larger than ${ACP_READ_TEXT_MAX_CHARS} characters; request it with line and limit`);
        pages.push(page);
        nextLine += complete.length;
        if (output.truncated !== true || nextLine > totalLines) break;
        output = await read(nextLine);
        if (sha256 && output.sha256 !== sha256) throw new Error(`ACP file ${request.path} changed while it was being read; read it again`);
        content = typeof output.content === "string" ? output.content : "";
      }
      return { content: pages.join("\n") };
    },
    async writeTextFile(request: WriteTextFileRequest, context: AcpHostContext): Promise<WriteTextFileResponse> {
      const path = workspaceRelativePath(request.path, context);
      const key = pathKey(path, context);
      let expectedSha256: string | null = observedSha256ByPath.get(key) ?? null;
      if (!observedSha256ByPath.has(key)) {
        const read = await options.tools.execute({
          id: `acp-host-read-${randomUUID()}`,
          name: "workspace.read_file",
          arguments: { path, startLine: 1, endLine: 1 },
        }, context.permissionMode, {
          runId: context.runId,
          workspaceRoot: context.workspaceRoot,
          signal: context.signal,
          permissionMode: context.permissionMode,
          allowedToolNames: ["workspace.read_file"],
        });
        if (read.ok) {
          const output = record(read.output);
          expectedSha256 = typeof output.sha256 === "string" ? output.sha256 : null;
        } else if (read.error?.code !== "PATH_NOT_FOUND") {
          throwToolFailure(read);
        }
      }
      const written = await execute("workspace.write_file", { path, content: request.content, expectedSha256 }, context);
      if (typeof written.sha256 === "string") {
        observedSha256ByPath.set(key, written.sha256);
      }
      return {};
    },
    terminal,
    dispose: () => terminal.dispose(),
  };
}
