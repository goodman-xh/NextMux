import { realpath, stat } from "node:fs/promises";
import { AgentToolError } from "./registry.js";

/** Directory identity is independent of edits to its children or timestamps. */
export async function workspaceDirectoryIdentity(root: string): Promise<string> {
  const metadata = await stat(root, { bigint: true });
  if (!metadata.isDirectory()) throw new AgentToolError("INVALID_WORKSPACE", `Workspace root is not a directory: ${root}`);
  return `${metadata.dev}:${metadata.ino}`;
}

export async function assertWorkspaceDirectoryIdentity(root: string, expected: string): Promise<void> {
  try {
    if (await realpath(root) === root && await workspaceDirectoryIdentity(root) === expected) return;
  } catch (error) {
    // Preserve permission/I/O errors instead of disguising them as replacement.
    if (!["ENOENT", "ENOTDIR", "INVALID_WORKSPACE"].includes(String((error as { code?: string }).code))) throw error;
  }
  throw new AgentToolError("STALE_WORKSPACE_BINDING", `Workspace directory was moved or replaced: ${root}`);
}
