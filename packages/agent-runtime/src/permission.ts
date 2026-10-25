import type { AgentPermissionMode } from "./types.js";

const agentPermissionOrder: readonly AgentPermissionMode[] = [
  "read_only",
  "workspace_write",
  "full_access",
];

/** Returns the least-privileged mode without ever widening any input. */
export function narrowAgentPermission(
  first: AgentPermissionMode,
  ...rest: readonly AgentPermissionMode[]
): AgentPermissionMode {
  return rest.reduce((narrowest, candidate) =>
    agentPermissionOrder.indexOf(candidate) < agentPermissionOrder.indexOf(narrowest)
      ? candidate
      : narrowest, first);
}
