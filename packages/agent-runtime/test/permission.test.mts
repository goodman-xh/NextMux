import assert from "node:assert/strict";
import test from "node:test";

import { narrowAgentPermission, type AgentPermissionMode } from "../lib/index.js";

test("narrowAgentPermission returns the least privilege at every boundary", () => {
  const modes: readonly AgentPermissionMode[] = ["read_only", "workspace_write", "full_access"];
  const expected: readonly (readonly AgentPermissionMode[])[] = [
    ["read_only", "read_only", "read_only"],
    ["read_only", "workspace_write", "workspace_write"],
    ["read_only", "workspace_write", "full_access"],
  ];

  for (const [leftIndex, left] of modes.entries()) {
    for (const [rightIndex, right] of modes.entries()) {
      assert.equal(narrowAgentPermission(left, right), expected[leftIndex][rightIndex]);
      assert.equal(narrowAgentPermission(left, right), narrowAgentPermission(right, left));
    }
  }

  assert.equal(
    narrowAgentPermission("full_access", "workspace_write", "read_only", "full_access"),
    "read_only",
  );
});
