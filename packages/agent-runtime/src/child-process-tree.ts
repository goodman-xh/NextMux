import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

export const DEFAULT_PROCESS_TREE_SHUTDOWN_GRACE_MS = 1_500;

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function childExited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolveExit => child.once("exit", () => resolveExit()));
}

function posixProcessTreeRunning(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
  }
  if (child.exitCode !== null || child.signalCode !== null) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalPosixProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    try { child.kill(signal); } catch { /* The process already exited. */ }
  }
}

async function waitForPosixProcessTree(child: ChildProcess, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (posixProcessTreeRunning(child)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(25, remaining));
  }
  return true;
}

async function forceKillWindowsProcessTree(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.pid === undefined) return;
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.WINDIR || "C:\\Windows";
  const killer = spawn(join(systemRoot, "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  // Very small protocol grace values must not terminate taskkill before it can
  // enumerate descendants; the helper itself still has a hard upper bound.
  const taskkillTimeoutMs = Math.max(1_000, Math.min(graceMs, 5_000));
  await new Promise<void>(resolveKill => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveKill();
    };
    timer = setTimeout(() => {
      try { killer.kill("SIGKILL"); } catch { /* The helper already exited. */ }
      finish();
    }, taskkillTimeoutMs);
    killer.once("error", finish);
    killer.once("exit", finish);
  });
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch { /* The process already exited. */ }
  }
  await Promise.race([childExited(child), delay(graceMs)]);
}

/**
 * Terminates a child spawned with `detached: true` on POSIX, including every
 * process that remains in its process group. Windows uses taskkill's `/T` tree
 * semantics. Completion is bounded even when a process or taskkill misbehaves.
 */
export async function terminateChildProcessTree(
  child: ChildProcess,
  graceMs = DEFAULT_PROCESS_TREE_SHUTDOWN_GRACE_MS,
): Promise<void> {
  if (child.pid === undefined) return;
  const boundedGraceMs = Number.isSafeInteger(graceMs)
    ? Math.max(50, Math.min(graceMs, 30_000))
    : DEFAULT_PROCESS_TREE_SHUTDOWN_GRACE_MS;
  if (process.platform === "win32") {
    // taskkill cannot safely reconstruct a tree after its root has exited, and
    // targeting an already-reaped PID risks acting on a subsequently reused ID.
    // Start tree termination before closing stdin so a cooperative root cannot
    // disappear before taskkill enumerates its descendants.
    if (child.exitCode !== null || child.signalCode !== null) return;
    await forceKillWindowsProcessTree(child, boundedGraceMs);
    return;
  }
  try { child.stdin?.end(); } catch { /* The protocol stream is already closed. */ }
  // Always address the group: a cooperative leader may exit before one of its
  // descendants, and waiting only for the leader would leak that descendant.
  signalPosixProcessTree(child, "SIGTERM");
  if (!await waitForPosixProcessTree(child, boundedGraceMs)) {
    signalPosixProcessTree(child, "SIGKILL");
    await waitForPosixProcessTree(child, boundedGraceMs);
  }
}
