import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as osConstants } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import crossSpawn = require("cross-spawn");
import * as nodePty from "node-pty";
import type { ToolProcessTerminationReason } from "./types";

export type ManagedProcessStream = "stdout" | "stderr" | "pty";

export interface ManagedProcessChunk {
  readonly sequence: number;
  readonly stream: ManagedProcessStream;
  readonly text: string;
}

export interface ManagedProcessSnapshot {
  readonly processId: string;
  readonly chunks: readonly ManagedProcessChunk[];
  readonly firstAvailableSequence: number;
  readonly nextSequence: number;
  readonly latestSequence: number;
  readonly hasMore: boolean;
  readonly retainedCharacters: number;
  readonly outputCharacterLimit: number;
  readonly running: boolean;
  readonly tty: boolean;
  /** Canonical explicit decoder label shared by both byte pipes; absent for default UTF-8/PTY. */
  readonly outputEncoding?: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly truncated: boolean;
  readonly truncatedHead?: Readonly<Partial<Record<ManagedProcessStream, string>>>;
  readonly failure?: string;
  readonly terminationReason?: ToolProcessTerminationReason;
}

export interface ManagedProcessCallbacks {
  readonly onStarted?: (processId: string) => void | Promise<void>;
  readonly onOutput?: (processId: string, chunk: ManagedProcessChunk) => void | Promise<void>;
  readonly onExited?: (
    processId: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    failure?: string,
    terminationReason?: ToolProcessTerminationReason,
  ) => void | Promise<void>;
}

export interface ManagedProcessStartOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /**
   * Variables this run adds on top of the shell's own environment (host credentials for full access, a sandbox
   * TMPDIR). A shared interactive terminal cannot take them without echoing them into its history, so an adapter
   * that injects commands into one runs such a command in its own process instead (audit B06-05).
   */
  readonly envOverlay?: Readonly<Record<string, string>>;
  /** Zero means no fixed deadline; cancellation and registry disposal still terminate this session. */
  readonly timeoutMs: number;
  readonly pipeStdin?: boolean;
  readonly tty?: boolean;
  /** Explicit encoding of stdout/stderr bytes for a non-PTY text process; no autodetection. */
  readonly outputEncoding?: string;
  readonly columns?: number;
  readonly rows?: number;
  readonly signal?: AbortSignal;
  readonly outputCharacterLimit: number;
  readonly callbacks?: ManagedProcessCallbacks;
}

/**
 * Structural process-session boundary used by workspace tools.
 *
 * The default implementation below owns a node-pty/cross-spawn child. Desktop
 * hosts may instead adapt an already registered native terminal (for example
 * Theia's TerminalProcess) so the user-facing xterm and the model consume the
 * same PTY without duplicating or scraping terminal output.
 */
export interface ManagedProcessSessionLike {
  readonly processId: string;
  readonly running: boolean;
  readonly tty: boolean;
  ready(): Promise<void>;
  waitForExit(): Promise<ManagedProcessSnapshot>;
  read(
    afterSequence?: number,
    maxCharacters?: number,
    waitMs?: number,
    signal?: AbortSignal,
  ): Promise<ManagedProcessSnapshot>;
  snapshot(afterSequence?: number, maxCharacters?: number): ManagedProcessSnapshot;
  write(text: string): Promise<void>;
  closeStdin(): Promise<void>;
  resize(columns: number, rows: number): void;
  terminate(reason?: ToolProcessTerminationReason): Promise<boolean>;
}

export interface ManagedProcessRegistryLike {
  start(options: ManagedProcessStartOptions): Promise<ManagedProcessSessionLike>;
  get(processId: string): ManagedProcessSessionLike | undefined;
  release(processId: string): boolean;
  dispose(): Promise<void>;
}

const PROCESS_CHUNK_CHARACTERS = 4_096;
const PROCESS_CALLBACK_HIGH_WATER_CHARACTERS = 64 * 1_024;
const PROCESS_CALLBACK_LOW_WATER_CHARACTERS = 16 * 1_024;

/**
 * Foreground-exit protocol token. A wrapper that runs a command through a
 * shell (a host terminal adapter, or a sandbox wrapper) can print
 * `__NEXTMUX_EXIT_<exitCode>` / `__NEXTMUX_EXIT_signal:<NAME>` as the command's
 * own final line. The session recognizes it, strips it from retained output,
 * and settles with the reported status. For commands without a wrapper the
 * direct child's `exit` event carries the same signal.
 */
export const FOREGROUND_EXIT_MARKER = "__NEXTMUX_EXIT_";
/** Trailing stdout/stderr drain budget after the foreground exit was observed. */
const FOREGROUND_EXIT_DRAIN_MS = 150;
const FOREGROUND_EXIT_PATTERN = new RegExp(`${FOREGROUND_EXIT_MARKER}(\\d+|signal:[A-Z0-9]+)`, "g");

/** Finite model pages count JSON overhead and escaped characters as well as terminal text.
 * Whole chunks keep their real sequence, so the next read never skips hidden output.
 * Unbounded internal snapshots still retain the whole ring for secret scrubbing and exit collection.
 */
export function selectProcessSnapshotChunks(
  retained: readonly ManagedProcessChunk[], cursor: number, maxCharacters: number,
): ManagedProcessChunk[] {
  const selected: ManagedProcessChunk[] = [];
  let remaining = Math.max(PROCESS_CHUNK_CHARACTERS, Math.floor(maxCharacters));
  let jsonRemaining = maxCharacters <= 80_000 ? 80_000 : Number.MAX_SAFE_INTEGER;
  for (const chunk of retained) {
    if (chunk.sequence <= cursor) continue;
    const encodedSize = jsonRemaining === Number.MAX_SAFE_INTEGER ? 0 : JSON.stringify(chunk).length + 1;
    if (chunk.text.length > remaining || encodedSize > jsonRemaining) break;
    selected.push(chunk);
    remaining -= chunk.text.length;
    jsonRemaining -= encodedSize;
  }
  return selected;
}

/** Validate an explicit byte contract before starting a process. */
export function normalizeProcessOutputEncoding(value: unknown, tty: boolean): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || value.trim() !== value) {
    throw new Error("outputEncoding must be one explicit supported text encoding label");
  }
  if (tty) throw new Error("outputEncoding is available only for non-PTY pipes (tty=false)");
  try { return new TextDecoder(value, { ignoreBOM: true }).encoding; }
  catch { throw new Error("Unsupported outputEncoding; use a supported explicit text encoding, never auto-detection"); }
}

interface ProcessOutputDecoder {
  write(value: Buffer): string;
  end(): string;
}

function processOutputDecoder(encoding: string | undefined): ProcessOutputDecoder {
  if (!encoding || encoding === "utf-8") return new StringDecoder("utf8");
  const decoder = new TextDecoder(encoding, { ignoreBOM: true });
  return { write: value => decoder.decode(value, { stream: true }), end: () => decoder.decode() };
}

function managedProcessAbortError(): Error {
  const error = new Error("Task was cancelled");
  error.name = "AbortError";
  return error;
}

export function normalizePtyExitSignal(signal: number | undefined): NodeJS.Signals | null {
  if (!Number.isInteger(signal)) return null;
  const match = Object.entries(osConstants.signals)
    .find(([name, value]) => name.startsWith("SIG") && value === signal);
  return match ? match[0] as NodeJS.Signals : null;
}

async function terminatePidTree(pid: number | undefined, fallback: () => void): Promise<void> {
  if (!pid || pid <= 0) {
    fallback();
    return;
  }
  if (process.platform === "win32") {
    const killed = await new Promise<boolean>(resolveKill => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (success: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolveKill(success);
      };
      const taskkill = join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "taskkill.exe");
      const killer = crossSpawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      timer = setTimeout(() => {
        try { killer.kill(); } catch { /* The helper already exited. */ }
        done(false);
      }, 5_000);
      killer.once("error", () => done(false));
      killer.once("close", exitCode => done(exitCode === 0));
    });
    if (!killed) {
      try { fallback(); } catch { /* The target already exited. */ }
    }
    return;
  }
  const isAlive = (target: number): boolean => {
    try {
      process.kill(target, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  };
  const stillRunning = (): boolean => isAlive(-pid) || isAlive(pid);
  const signalTree = (signal: NodeJS.Signals): boolean => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
      try {
        process.kill(pid, signal);
        return true;
      } catch (innerError) {
        return (innerError as NodeJS.ErrnoException).code === "EPERM";
      }
    }
  };
  if (!signalTree("SIGTERM")) {
    try { fallback(); } catch { /* The target already exited. */ }
    return;
  }
  const deadline = Date.now() + 500;
  while (stillRunning() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (stillRunning()) signalTree("SIGKILL");
}

const ANSI_ESCAPE_SEQUENCE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

function normalizeNonTtyOutput(text: string): string {
  if (!text) return text;
  const withoutAnsi = text.includes("\x1b") ? text.replace(ANSI_ESCAPE_SEQUENCE, "") : text;
  if (!withoutAnsi.includes("\r")) return withoutAnsi;
  return withoutAnsi
    .split("\n")
    .map(line => {
      if (!line.includes("\r")) return line;
      const hasTrailingCr = line.endsWith("\r");
      const core = hasTrailingCr ? line.slice(0, -1) : line;
      const lastCr = core.lastIndexOf("\r");
      const visible = lastCr >= 0 ? core.slice(lastCr + 1) : core;
      return hasTrailingCr ? `${visible}\r` : visible;
    })
    .join("\n");
}

function safeCallback(callback: void | Promise<void> | undefined): void {
  void Promise.resolve(callback).catch(() => undefined);
}

export class ManagedProcessSession implements ManagedProcessSessionLike {
  readonly processId: string;
  readonly #child: ChildProcess | undefined;
  readonly #pty: nodePty.IPty | undefined;
  #ptyDataDisposable: nodePty.IDisposable | undefined;
  #ptyExitDisposable: nodePty.IDisposable | undefined;
  readonly #callbacks: ManagedProcessCallbacks;
  readonly #outputCharacterLimit: number;
  readonly #signal?: AbortSignal;
  readonly #pipeStdin: boolean;
  readonly #tty: boolean;
  readonly #outputEncoding?: string;
  readonly #chunks: ManagedProcessChunk[] = [];
  readonly #truncatedHeadByStream = new Map<ManagedProcessStream, string>();
  readonly #stdoutDecoder: ProcessOutputDecoder;
  readonly #stderrDecoder: ProcessOutputDecoder;
  readonly #waiters = new Set<() => void>();
  readonly #ready: Promise<void>;
  readonly #completion: Promise<void>;
  #outputCallbackTail: Promise<void> = Promise.resolve();
  #resolveCompletion!: () => void;
  #timeout: ReturnType<typeof setTimeout> | undefined;
  #termination: Promise<void> | undefined;
  #sequence = 0;
  #outputCharacters = 0;
  #pendingCallbackCharacters = 0;
  #running = true;
  #acceptOutput = true;
  #discardQueuedOutput = false;
  #outputBackpressured = false;
  #ptyExitPending = false;
  #exitCode: number | null = null;
  #exitSignal: NodeJS.Signals | null = null;
  #truncated = false;
  #failure = "";
  #terminationReason: ToolProcessTerminationReason | undefined;
  /** A foreground exit was already observed; the bounded drain is armed or done. */
  #foregroundExitSettled = false;
  #foregroundExitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ManagedProcessStartOptions) {
    // AbortSignal does not replay an abort event to listeners added after the
    // signal was cancelled. Reject before spawning so a request cancelled while
    // workspace validation was in flight can never start a late child process.
    if (options.signal?.aborted) throw managedProcessAbortError();

    const outputEncoding = normalizeProcessOutputEncoding(options.outputEncoding, Boolean(options.tty));
    this.#outputEncoding = outputEncoding;
    this.#stdoutDecoder = processOutputDecoder(outputEncoding);
    this.#stderrDecoder = processOutputDecoder(outputEncoding);

    this.processId = `proc-${randomUUID()}`;
    this.#callbacks = options.callbacks || {};
    this.#outputCharacterLimit = Math.max(PROCESS_CHUNK_CHARACTERS, Math.floor(options.outputCharacterLimit));
    this.#signal = options.signal;
    this.#tty = Boolean(options.tty);
    this.#pipeStdin = this.#tty || Boolean(options.pipeStdin);
    this.#completion = new Promise(resolve => { this.#resolveCompletion = resolve; });

    if (this.#tty) {
      this.#child = undefined;
      this.#pty = nodePty.spawn(options.command, [...options.args], {
        name: "xterm-256color",
        cols: Math.max(20, Math.min(500, Math.floor(options.columns || 120))),
        rows: Math.max(5, Math.min(300, Math.floor(options.rows || 30))),
        cwd: options.cwd,
        env: options.env,
        handleFlowControl: true,
        // The same conpty.dll engine as the user's terminal (packaged per architecture), not the one built into Windows.
        ...(process.platform === "win32" ? { useConptyDll: true } : {}),
      });
      this.#ptyDataDisposable = this.#pty.onData(data => this.#append("pty", data));
      this.#ptyExitDisposable = this.#pty.onExit(({ exitCode, signal }) => {
        this.#ptyExitPending = true;
        this.#setOutputBackpressure(false);
        setImmediate(() => this.#finish(exitCode, normalizePtyExitSignal(signal)));
      });
      this.#ready = Promise.resolve();
      if (!this.#signal?.aborted) safeCallback(this.#callbacks.onStarted?.(this.processId));
    } else {
      this.#pty = undefined;
      this.#child = crossSpawn(options.command, [...options.args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: [this.#pipeStdin ? "pipe" : "ignore", "pipe", "pipe"],
      });
      this.#ready = new Promise((resolve, reject) => {
        this.#child!.once("spawn", () => {
          if (!this.#signal?.aborted && this.#acceptOutput) {
            safeCallback(this.#callbacks.onStarted?.(this.processId));
          }
          resolve();
        });
        this.#child!.once("error", error => {
          this.#failure = error.message;
          this.#finish(null, null, error.message);
          reject(error);
        });
      });
      this.#child.stdout?.on("data", (chunk: Buffer | string) => this.#append("stdout", chunk));
      this.#child.stderr?.on("data", (chunk: Buffer | string) => this.#append("stderr", chunk));
      // `exit` fires when the direct child ends even while a background child
      // still holds the stdout pipe; `close` waits for those pipes and can be
      // delayed indefinitely. Settle from `exit` after one bounded drain window
      // (audit Cline #6); a `close` inside the window still wins immediately.
      this.#child.once("exit", (exitCode, signal) => this.#settleAfterForegroundExit(exitCode, signal));
      this.#child.once("close", (exitCode, signal) => {
        this.#clearForegroundExitTimer();
        this.#finish(exitCode, signal);
      });
    }

    if (options.timeoutMs > 0) {
      this.#timeout = setTimeout(() => {
        this.#failure ||= "Process timed out";
        void this.terminate("timeout");
      }, options.timeoutMs);
    }
    options.signal?.addEventListener("abort", this.#abort, { once: true });
    // Keep this guard even though construction is synchronous: custom signals
    // and future asynchronous spawn adapters must not reopen the same race.
    if (options.signal?.aborted) this.#abort();
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  get running(): boolean {
    return this.#running;
  }

  get tty(): boolean {
    return this.#tty;
  }

  async waitForExit(): Promise<ManagedProcessSnapshot> {
    await this.#completion;
    return this.snapshot();
  }

  async read(
    afterSequence = 0,
    maxCharacters = 65_536,
    waitMs = 0,
    signal?: AbortSignal,
  ): Promise<ManagedProcessSnapshot> {
    if (signal?.aborted) throw managedProcessAbortError();
    // Freeze a future cursor at the stream head before long-polling. Clamping
    // only after a wake-up would advance the cursor over the chunk that woke it.
    const cursor = Math.min(Math.max(0, Math.floor(afterSequence)), this.#sequence);
    if (this.#running && !this.#chunks.some(chunk => chunk.sequence > cursor) && waitMs > 0) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.#waiters.delete(done);
          signal?.removeEventListener("abort", aborted);
          resolve();
        };
        const aborted = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.#waiters.delete(done);
          reject(managedProcessAbortError());
        };
        const timer = setTimeout(done, Math.max(0, Math.floor(waitMs)));
        this.#waiters.add(done);
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) aborted();
      });
    }
    if (signal?.aborted) throw managedProcessAbortError();
    return this.snapshot(cursor, maxCharacters);
  }

  snapshot(afterSequence = 0, maxCharacters = Number.MAX_SAFE_INTEGER): ManagedProcessSnapshot {
    // A caller can recover from a stale or corrupted persisted cursor. Never
    // echo a value beyond the last sequence actually produced, otherwise every
    // later chunk would remain permanently hidden behind that future cursor.
    const cursor = Math.min(Math.max(0, Math.floor(afterSequence)), this.#sequence);
    const chunks = selectProcessSnapshotChunks(this.#chunks, cursor, maxCharacters);
    const firstAvailableSequence = this.#chunks[0]?.sequence ?? this.#sequence + 1;
    const cursorMissedWholeChunk = cursor + 1 < firstAvailableSequence;
    const nextSequence = chunks.at(-1)?.sequence ?? cursor;
    const truncated = this.#truncated && cursorMissedWholeChunk;
    return {
      processId: this.processId,
      chunks,
      firstAvailableSequence,
      nextSequence,
      latestSequence: this.#sequence,
      hasMore: nextSequence < this.#sequence,
      retainedCharacters: this.#outputCharacters,
      outputCharacterLimit: this.#outputCharacterLimit,
      running: this.#running,
      tty: this.#tty,
      ...(this.#outputEncoding ? { outputEncoding: this.#outputEncoding } : {}),
      exitCode: this.#exitCode,
      signal: this.#exitSignal,
      truncated,
      ...(truncated && this.#truncatedHeadByStream.size
        ? { truncatedHead: Object.fromEntries(this.#truncatedHeadByStream) }
        : {}),
      ...(this.#failure ? { failure: this.#failure } : {}),
      ...(this.#terminationReason ? { terminationReason: this.#terminationReason } : {}),
    };
  }

  async write(text: string): Promise<void> {
    if (!this.#running) throw new Error("Process is no longer running");
    if (this.#pty) {
      this.#pty.write(text);
      return;
    }
    if (!this.#pipeStdin || !this.#child?.stdin) throw new Error("Process stdin streaming is not enabled");
    await new Promise<void>((resolve, reject) => {
      this.#child!.stdin!.write(text, error => error ? reject(error) : resolve());
    });
  }

  async closeStdin(): Promise<void> {
    if (this.#pty) {
      if (this.#running) this.#pty.write(process.platform === "win32" ? "\u001a\r" : "\u0004");
      return;
    }
    if (!this.#pipeStdin || !this.#child?.stdin || this.#child.stdin.destroyed) return;
    await new Promise<void>(resolve => this.#child!.stdin!.end(resolve));
  }

  resize(columns: number, rows: number): void {
    if (!this.#running || !this.#pty) return;
    this.#pty.resize(
      Math.max(20, Math.min(500, Math.floor(columns))),
      Math.max(5, Math.min(300, Math.floor(rows))),
    );
  }

  /**
   * The command's own process group (POSIX: pipe commands start detached, a PTY is its own session). It can outlive
   * the command: `server &` keeps running after the shell exits.
   */
  #processGroup(): number | undefined {
    if (process.platform === "win32") return undefined;
    const pid = this.#pty?.pid ?? this.#child?.pid;
    return typeof pid === "number" && pid > 1 ? pid : undefined;
  }

  /** Stop what is left of the command's group after the command itself ended (audit B06-03). */
  async reapProcessGroup(): Promise<boolean> {
    const group = this.#processGroup();
    if (!group) return false;
    const alive = (): boolean => { try { process.kill(-group, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } };
    if (!alive()) return false;
    try { process.kill(-group, "SIGTERM"); } catch { return false; }
    const deadline = Date.now() + 250;
    while (alive() && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (alive()) { try { process.kill(-group, "SIGKILL"); } catch { /* already gone */ } }
    return true;
  }

  async terminate(reason: ToolProcessTerminationReason = "requested"): Promise<boolean> {
    // The command itself is done, but background work it started in its group may still run: an explicit stop ends it.
    if (!this.#running) return this.reapProcessGroup();
    if (this.#termination) {
      await this.#termination;
      return true;
    }
    this.#terminationReason ||= reason;
    this.#acceptOutput = false;
    this.#discardQueuedOutput = true;
    this.#setOutputBackpressure(false);
    this.#notifyWaiters();
    this.#termination = this.#pty
      ? terminatePidTree(this.#pty.pid, () => {
        try { this.#pty?.kill(); } catch { /* The PTY already exited. */ }
      })
      : terminatePidTree(this.#child?.pid, () => {
        try { this.#child?.kill("SIGTERM"); } catch { /* The process already exited. */ }
      });
    await this.#termination;
    return true;
  }

  #append(stream: ManagedProcessStream, value: Buffer | string): void {
    if (!this.#running || !this.#acceptOutput) return;
    const rawDecoded = (typeof value === "string"
      ? value
      : (stream === "stderr" ? this.#stderrDecoder : this.#stdoutDecoder).write(value)).replace(/\0/g, "");
    const decoded = this.#tty ? rawDecoded : normalizeNonTtyOutput(rawDecoded);
    this.#appendDecoded(stream, decoded);
  }

  #appendDecoded(stream: ManagedProcessStream, decoded: string): void {
    // A wrapper-emitted foreground-exit marker is protocol, not command output:
    // observe it for the exit status, then keep it out of the retained ring.
    const text = decoded.includes(FOREGROUND_EXIT_MARKER) ? this.#observeForegroundExitMarker(decoded) : decoded;
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + PROCESS_CHUNK_CHARACTERS, text.length);
      if (end < text.length
        && /[\uD800-\uDBFF]/.test(text[end - 1])
        && /[\uDC00-\uDFFF]/.test(text[end])) end -= 1;
      const chunkText = text.slice(offset, end);
      offset = end;
      if (!chunkText) continue;
      const chunk: ManagedProcessChunk = { sequence: ++this.#sequence, stream, text: chunkText };
      this.#chunks.push(chunk);
      this.#outputCharacters += chunkText.length;
      this.#trimOutputBuffer();
      this.#queueOutputCallback(chunk);
    }
    this.#notifyWaiters();
  }

  /** Parses every `__NEXTMUX_EXIT_` marker in a chunk and strips them from it. */
  #observeForegroundExitMarker(text: string): string {
    FOREGROUND_EXIT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FOREGROUND_EXIT_PATTERN.exec(text)) !== null) {
      const payload = match[1]!;
      if (payload.startsWith("signal:")) {
        this.#settleAfterForegroundExit(null, payload.slice("signal:".length) as NodeJS.Signals);
      } else {
        this.#settleAfterForegroundExit(Number.parseInt(payload, 10), null);
      }
    }
    return text.replace(new RegExp(`${FOREGROUND_EXIT_MARKER}(?:\\d+|signal:[A-Z0-9]+)\\r?\\n?`, "g"), "");
  }

  #clearForegroundExitTimer(): void {
    if (this.#foregroundExitTimer) {
      clearTimeout(this.#foregroundExitTimer);
      this.#foregroundExitTimer = undefined;
    }
  }

  /**
   * The foreground command ended, either through its own `exit` event or an
   * explicit `__NEXTMUX_EXIT_` marker. A background child can still hold the
   * stdout pipe open, which would delay `close` indefinitely: wait one bounded
   * drain window for trailing bytes, then settle with the foreground exit
   * status even though the pipe is still held (audit Cline #6).
   */
  #settleAfterForegroundExit(exitCode: number | null, signal: NodeJS.Signals | null): void {
    if (!this.#running || this.#foregroundExitSettled) return;
    this.#foregroundExitSettled = true;
    this.#clearForegroundExitTimer();
    this.#foregroundExitTimer = setTimeout(() => this.#finish(exitCode, signal), FOREGROUND_EXIT_DRAIN_MS);
  }

  #trimOutputBuffer(): void {
    const headBudget = Math.min(16_384, Math.floor(this.#outputCharacterLimit / 2));
    while (this.#outputCharacters > this.#outputCharacterLimit && this.#chunks.length) {
      const first = this.#chunks[0];
      this.#chunks.shift();
      this.#outputCharacters -= first.text.length;
      const currentHead = this.#truncatedHeadByStream.get(first.stream) ?? "";
      if (currentHead.length < headBudget) {
        this.#truncatedHeadByStream.set(
          first.stream,
          currentHead + first.text.slice(0, headBudget - currentHead.length),
        );
      }
      this.#truncated = true;
    }
  }

  #queueOutputCallback(chunk: ManagedProcessChunk): void {
    const callback = this.#callbacks.onOutput;
    if (!callback) return;
    this.#pendingCallbackCharacters += chunk.text.length;
    this.#updateOutputBackpressure();
    this.#outputCallbackTail = this.#outputCallbackTail
      .then(async () => {
        if (!this.#discardQueuedOutput) await callback(this.processId, chunk);
      })
      .catch(() => undefined)
      .finally(() => {
        this.#pendingCallbackCharacters -= chunk.text.length;
        this.#updateOutputBackpressure();
      });
  }

  #updateOutputBackpressure(): void {
    if (!this.#running || !this.#acceptOutput || this.#ptyExitPending) {
      this.#setOutputBackpressure(false);
      return;
    }
    if (!this.#outputBackpressured
      && this.#pendingCallbackCharacters >= PROCESS_CALLBACK_HIGH_WATER_CHARACTERS) {
      this.#setOutputBackpressure(true);
    } else if (this.#outputBackpressured
      && this.#pendingCallbackCharacters <= PROCESS_CALLBACK_LOW_WATER_CHARACTERS) {
      this.#setOutputBackpressure(false);
    }
  }

  #setOutputBackpressure(paused: boolean): void {
    if (paused === this.#outputBackpressured) return;
    this.#outputBackpressured = paused;
    if (this.#pty) {
      try { this.#pty.write(paused ? "\u0013" : "\u0011"); } catch { /* The PTY already exited. */ }
      return;
    }
    if (paused) {
      this.#child?.stdout?.pause();
      this.#child?.stderr?.pause();
    } else {
      this.#child?.stdout?.resume();
      this.#child?.stderr?.resume();
    }
  }

  #finish(exitCode: number | null, signal: NodeJS.Signals | null, failure = ""): void {
    if (!this.#running) return;
    this.#clearForegroundExitTimer();
    if (!this.#tty) {
      const stdout = normalizeNonTtyOutput(this.#stdoutDecoder.end().replace(/\0/g, ""));
      const stderr = normalizeNonTtyOutput(this.#stderrDecoder.end().replace(/\0/g, ""));
      if (this.#acceptOutput) {
        this.#appendDecoded("stdout", stdout);
        this.#appendDecoded("stderr", stderr);
      }
    }
    this.#acceptOutput = false;
    this.#running = false;
    this.#exitCode = exitCode;
    this.#exitSignal = signal;
    this.#failure ||= failure;
    if (this.#timeout) clearTimeout(this.#timeout);
    this.#ptyDataDisposable?.dispose();
    this.#ptyExitDisposable?.dispose();
    this.#ptyDataDisposable = undefined;
    this.#ptyExitDisposable = undefined;
    // node-pty's Windows wrapper reports process exit before releasing every
    // ConPTY handle. kill() after onExit is idempotent and closes those native
    // pipes; without it the Node process can stay alive after the terminal ends.
    if (this.#pty) {
      try { this.#pty.kill(); } catch { /* Native handles were already released. */ }
    }
    this.#signal?.removeEventListener("abort", this.#abort);
    this.#notifyWaiters();
    void this.#outputCallbackTail.then(() => safeCallback(this.#callbacks.onExited?.(
        this.processId,
        exitCode,
        signal,
        this.#failure || undefined,
        this.#terminationReason,
      )))
      .catch(() => undefined);
    this.#resolveCompletion();
  }

  #notifyWaiters(): void {
    for (const waiter of [...this.#waiters]) waiter();
  }

  readonly #abort = (): void => {
    this.#failure ||= "Task was cancelled";
    void this.terminate(this.#signal?.reason === "runtime_dispose" ? "runtime_dispose" : "cancelled");
  };
}

export class ManagedProcessRegistry implements ManagedProcessRegistryLike {
  readonly #maximumSessions: number;
  readonly #sessions = new Map<string, ManagedProcessSession>();
  readonly #stop = new AbortController();
  #disposePromise?: Promise<void>;

  constructor(maximumSessions = 8) {
    this.#maximumSessions = Math.max(1, Math.floor(maximumSessions));
  }

  async start(options: ManagedProcessStartOptions): Promise<ManagedProcessSession> {
    if (this.#stop.signal.aborted || options.signal?.aborted) throw managedProcessAbortError();
    options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, this.#stop.signal]) : this.#stop.signal };
    this.prune();
    if (this.#sessions.size >= this.#maximumSessions) throw new Error("Too many managed processes are active");
    // PTY startup reports onStarted synchronously from its constructor. Delay
    // that notification until the owner is registered so a reentrant stop can
    // actually wait for and terminate this just-created process.
    let registered = false;
    let pendingStarted: string | undefined;
    const session = new ManagedProcessSession({ ...options, callbacks: { ...options.callbacks,
      onStarted: processId => {
        if (registered) return options.callbacks?.onStarted?.(processId);
        pendingStarted = processId;
      },
    } });
    this.#sessions.set(session.processId, session);
    registered = true;
    try {
      if (pendingStarted && !options.signal?.aborted) safeCallback(options.callbacks?.onStarted?.(pendingStarted));
      await session.ready();
      if (options.signal?.aborted) {
        await session.terminate("cancelled");
        throw managedProcessAbortError();
      }
      return session;
    } catch (error) {
      this.#sessions.delete(session.processId);
      throw error;
    }
  }

  get(processId: string): ManagedProcessSession | undefined {
    return this.#sessions.get(processId);
  }

  release(processId: string): boolean {
    const session = this.#sessions.get(processId);
    if (!session || session.running) return false;
    return this.#sessions.delete(processId);
  }

  prune(): void {
    if (this.#sessions.size < this.#maximumSessions) return;
    for (const [processId, session] of this.#sessions) {
      if (!session.running) this.#sessions.delete(processId);
      if (this.#sessions.size < this.#maximumSessions) break;
    }
  }

  dispose(): Promise<void> {
    this.#stop.abort("runtime_dispose");
    return this.#disposePromise ??= this.#disposeSessions();
  }

  async #disposeSessions(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    // terminate() also reaps the group of a command that already ended, so nothing it left running survives dispose.
    await Promise.allSettled(sessions.map(session => session.terminate("runtime_dispose")));
    await Promise.allSettled(sessions.map(async session => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          session.waitForExit(),
          new Promise<void>(resolve => { timeout = setTimeout(resolve, 5_000); }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }));
    this.#sessions.clear();
  }
}
