import { randomUUID } from "node:crypto";
import { access, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { activeCheckpointGroups, activeCheckpointRestores, writeRecoveryRecord, finalizeRecordedVersions } from "./checkpoint-recovery.js";
import { AgentToolError } from "./errors.js";
import type { ToolExecutionSummary } from "./types.js";

/** A prepared restore keeps its original files until the whole group succeeds. */
export interface PreparedCheckpointRestore {
  readonly workspaceRoot: string;
  readonly targetPaths: readonly string[];
  readonly recoveryDirectory: string;
  readonly versionDirectories?: readonly string[];
  joinGroup?(journalPath: string): Promise<void>;
  apply(): Promise<readonly ToolExecutionSummary[]>;
  rollback(): Promise<void>;
  /** Releases originals only after group success or successful compensation. */
  finalize(): Promise<void>;
}

/**
 * Prepare every root before changing any root. Like Cline's worktree restore
 * transaction, compensation preserves unrelated changes and original files;
 * NextMux uses its existing object store instead of touching the user's Git.
 * This is a compensated filesystem transaction, not an OS-wide atomic rename.
 */
export async function runCheckpointRestoreTransactions(
  preparations: readonly (() => Promise<PreparedCheckpointRestore>)[],
): Promise<readonly ToolExecutionSummary[]> {
  const prepared: PreparedCheckpointRestore[] = [];
  const summaries: ToolExecutionSummary[] = [];
  const targets = new Set<string>();
  let journalPath: string | undefined;
  let journal: unknown;
  let versionDirectories: string[] = [];
  try {
    for (const prepare of preparations) {
      const transaction = await prepare();
      prepared.push(transaction);
      for (const path of transaction.targetPaths) {
        if (targets.has(path)) throw new AgentToolError("INVALID_CHECKPOINT", "Restore groups overlap on the same file");
        targets.add(path);
      }
    }
    const durable = prepared.filter(transaction => transaction.targetPaths.length > 0 && transaction.joinGroup);
    versionDirectories = [...new Set(prepared.flatMap(item => item.versionDirectories || []))];
    if (durable.length) {
      journalPath = join(dirname(durable[0].recoveryDirectory), `.restore-group-${randomUUID()}.json`);
      journal = { version: 1, phase: "prepared", ownerPid: process.pid,
        participants: durable.map(item => ({ workspaceRoot: item.workspaceRoot, directory: item.recoveryDirectory })), versionDirectories };
      activeCheckpointGroups.add(journalPath);
      await writeRecoveryRecord(journalPath, journal);
      for (const item of durable) await item.joinGroup!(journalPath);
    }
    for (const transaction of prepared) summaries.push(...await transaction.apply());
    if (journalPath) await writeRecoveryRecord(journalPath, { ...(journal as object), phase: "committed" });
  } catch (error) {
    const failures: string[] = [];
    for (const transaction of [...prepared].reverse()) {
      try {
        await transaction.rollback();
        await transaction.finalize().catch(() => undefined);
      } catch {
        failures.push(transaction.recoveryDirectory);
      }
    }
    for (const item of prepared) activeCheckpointRestores.delete(item.recoveryDirectory);
    if (!failures.length) await finalizeRecordedVersions(versionDirectories, false).catch(() => undefined);
    if (journalPath) { activeCheckpointGroups.delete(journalPath); if (!failures.length) await rm(journalPath, { force: true }).catch(() => undefined); }
    if (failures.length) {
      throw new AgentToolError("ROLLBACK_PARTIAL", `Restore compensation needs review; originals are preserved in: ${failures.join(", ")}`);
    }
    throw error;
  }
  // Cleanup failure cannot undo a successful group after another root has
  // released its originals. Leftover recovery objects are safe to retain.
  const versionsFinalized = await finalizeRecordedVersions(versionDirectories, true).then(() => true, () => false);
  for (const transaction of prepared) {
    if (versionsFinalized) await transaction.finalize().catch(() => undefined);
    activeCheckpointRestores.delete(transaction.recoveryDirectory);
  }
  if (journalPath) {
    activeCheckpointGroups.delete(journalPath);
    const remaining = await Promise.all(prepared.map(item => access(item.recoveryDirectory).then(() => true, () => false)));
    if (!remaining.some(Boolean)) await rm(journalPath, { force: true }).catch(() => undefined);
  }
  return summaries;
}
