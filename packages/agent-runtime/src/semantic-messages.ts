import type { AgentMessageParams, AgentRuntimeFinalMessage, ToolExecutionSummary } from "./types.js";

const extensionSummaries: Readonly<Record<string, string>> = {
  "project_memory.search": "Searched project memory", "project_memory.read": "Read project memory", "project_memory.propose": "Proposed a project memory update",
  "project_design.read": "Read project design", "nextmux.skills.list": "Listed skills", "nextmux.skills.install": "Installed skill",
  "nextmux.skills.create": "Created skill", "nextmux.mcp.add": "Added MCP connection", "nextmux.mcp.list": "Listed MCP connections",
  "nextmux.list_schedules": "Listed schedules", "nextmux.schedule.create": "Created schedule", "nextmux.schedule.update": "Updated schedule",
  "nextmux.schedule.remove": "Removed schedule", "nextmux.schedule.exists": "Schedule already exists",
  "agent.review_changes": "Reviewed child changes", "agent.merge_changes": "Merged child changes", "agent.recover_merge": "Recovered child merge",
  "conversation.search": "Searched conversations", "conversation.read": "Read conversation", "conversation.create": "Created conversation", "conversation.exists": "Conversation already exists",
  "comic.get_project": "Read comic project", "comic.get_scene": "Read scene", "comic.create_project": "Created comic project", "comic.update_project": "Updated comic project",
  "comic.add_scene": "Added scene", "comic.update_scene": "Updated scene", "comic.delete_scene": "Deleted scene",
  "comic.add_shot": "Added shot", "comic.update_shot": "Updated shot", "comic.delete_shot": "Deleted shot", "comic.move_shot": "Moved shot",
  "comic.replace_dialogue": "Replaced dialogue", "comic.add_character": "Added character", "comic.update_character": "Updated character", "comic.delete_character": "Deleted character",
  "comic.apply_adaptation": "Applied adaptation", "comic.write_lyrics": "Wrote lyrics", "comic.write_scripts": "Wrote scripts", "skill.load": "Loaded skill",
  "computer.list_apps": "Listed applications", "computer.list_windows": "Listed application windows", "computer.open_app": "Opened application",
  "computer.observe_window": "Observed application window", "computer.verify_state": "Verified application state", "computer.click": "Clicked application target",
  "computer.double_click": "Double-clicked application target", "computer.right_click": "Right-clicked application target", "computer.scroll": "Scrolled application window",
  "computer.drag": "Dragged application target", "computer.set_value": "Set application value", "computer.type_text": "Typed into application", "computer.press_key": "Pressed application key", "computer.hotkey": "Pressed application shortcut",
  "tabs.open_app": "Opened tab application", "tabs.list": "Listed tabs", "tabs.set": "Updated tab", "tabs.show": "Showed tab", "tabs.screenshot": "Captured tab screenshot",
  "tabs.click": "Clicked tab target", "tabs.drag": "Dragged tab target", "tabs.scroll": "Scrolled tab", "tabs.key": "Pressed tab key", "tabs.type": "Typed into tab", "tabs.close": "Closed tab",
  "plugins.list": "Listed plugins", "plugins.start": "Started plugin", "plugins.command": "Sent plugin command", "plugins.status": "Read plugin status", "plugins.stop": "Stopped plugin",
};

/** Bounded semantic metadata, independently validated from display titles and diagnostics. */
export function safeAgentMessageParams(value: unknown): AgentMessageParams | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([key, entry]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)
    && (typeof entry === "string" || typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry))))
    .slice(0, 32).map(([key, entry]) => [key, typeof entry === "string" ? entry.replace(/\0/g, "").slice(0, 4096) : entry]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Never use the display title/details as model memory, including legacy/custom tool summaries. */
export function canonicalToolSummary(summary: ToolExecutionSummary, toolName = "tool"): string {
  const p = summary.params ?? {};
  const path = p.path ?? (summary.resource?.kind === "file" ? summary.resource.path : "file");
  switch (summary.kind) {
    case "workspace.list_files": return `Listed ${p.count ?? 0} workspace entries`;
    case "workspace.read_file": return `Read ${path}`;
    case "workspace.search_text": return `Found ${p.count ?? 0} matches${p.incomplete ? "; search coverage is incomplete" : ""}`;
    case "workspace.project_map": return `Project map: ${p.count ?? 0} files`;
    case "workspace.write_file": return `${p.action === "created" ? "Created" : "Updated"} ${path}`;
    case "workspace.apply_patch": return p.unchanged ? `No changes needed for ${path}` : `Edited ${path}`;
    case "workspace.restore": return `Restored ${path}`;
    case "workspace.list_bindings": return `Listed ${p.count ?? 0} workspace bindings`;
    case "tool.search": return `Searched available tools: ${p.count ?? 0} matches`;
    case "tool.error": return `Tool failed (${p.code ?? "TOOL_EXECUTION_FAILED"})`;
    case "tool.execution_unknown": return "The operation's side-effect status is unknown; it will not be replayed automatically";
    case "process.run": return `Process exited: ${p.exitCode ?? "unknown"}`;
    case "process.start": return "Started process";
    case "process.read": return p.running ? "Read latest process output" : "Process exited";
    case "process.write": return "Wrote process input";
    case "process.terminate": return p.alreadyExited ? "Process already exited" : "Terminated process";
    case "agent.delegate": return p.status === "completed" ? "Child task completed" : p.status === "cancelled" ? "Child task cancelled"
      : p.status === "paused" ? "Child task paused" : "Child task reached its limit";
    case "tool.started": return `Started ${p.toolName ?? toolName}`;
    case "browser.action": return `Browser action completed: ${p.action ?? "interaction"}`;
    case "mcp.call": return `Called MCP tool: ${p.serverName ?? "server"}/${p.toolName ?? toolName}`;
  }
  const extension = summary.kind ? extensionSummaries[summary.kind] : undefined;
  if (extension) return `${extension}${p.name ? `: ${p.name}` : ""}${typeof p.count === "number" ? ` (${p.count})` : ""}`;
  if (summary.resource?.kind === "file") return `${summary.resource.action === "read" ? "Read" : summary.resource.action === "created" ? "Created" : "Updated"} ${summary.resource.path}`;
  if (summary.resource?.kind === "browser") return `Browser operation: ${summary.resource.url}`;
  return `Tool completed: ${toolName}`;
}

export function canonicalRuntimeFinal(message: AgentRuntimeFinalMessage): string {
  switch (message.stopReason) {
    case "checkpoint_persistence_failed": return "Child task paused because its checkpoint could not be committed. Completed work and usage are retained. Do not retry automatically; the earlier execution may already have taken effect.";
    case "pause_requested": return "Task paused; resume from its checkpoint.";
    case "cancel_requested": return "Task cancelled.";
    case "context_window_exceeded": return "The task exceeds this model's context capacity; state is preserved. Select a model with a larger context window to continue.";
    case "media_context_compaction_required": return "The newest user media alone exceeds this model's input capacity. State is preserved. Reduce image resolution, shorten or split the audio/file attachments, or select a model with a larger context window, then resume.";
    case "token_usage_unknown": return "Usage could not be verified; paused to preserve the token budget.";
    case "input_token_limit_reached": return "Input-token budget reached; no further model request was sent.";
    case "output_token_limit_reached": return "Output-token budget reached; no further model request was sent.";
    case "output_truncated": return "The model repeatedly hit its output limit without making progress. The task is paused; partial output and recovery state are preserved.";
    case "user_input_expired": return "The question expired; the task is paused until you continue.";
    case "user_input_cancelled": return "The question was cancelled; the task is paused.";
    case "repeated_tool_calls": return "Repeated tool calls detected; the task is paused.";
    case "tool_call_limit_reached": return "Tool-call limit reached.";
    case "turn_limit_reached": return "Model-turn limit reached.";
    case "empty_response": return "The model returned no text.";
    case "completed": return "Task completed.";
  }
}

const runtimeStopReasons = new Set<string>([
  "completed", "pause_requested", "checkpoint_persistence_failed", "cancel_requested", "context_window_exceeded", "media_context_compaction_required",
  "token_usage_unknown", "input_token_limit_reached", "output_token_limit_reached", "output_truncated", "user_input_expired",
  "user_input_cancelled", "repeated_tool_calls", "tool_call_limit_reached", "turn_limit_reached", "empty_response",
]);

/** Validate persisted provenance before either channel uses it. */
export function normalizeRuntimeFinalMessage(value: unknown): AgentRuntimeFinalMessage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  if (message.origin !== "runtime" || typeof message.stopReason !== "string" || !runtimeStopReasons.has(message.stopReason)) return undefined;
  const params = safeAgentMessageParams(message.params);
  return { origin: "runtime", stopReason: message.stopReason as AgentRuntimeFinalMessage["stopReason"], ...(params ? { params } : {}) };
}

const legacyRuntimeFinalTexts = new Set([
  '任务已暂停，可从检查点继续。', '任务已暂停。', '任务已取消', '任务已取消。',
  '模型没有返回正文。', '模型没有返回正文', '检测到重复工具调用',
  '当前任务内容超过此模型的上下文容量，已保留任务和恢复记录，请选择上下文容量更大的模型继续。',
  '无法验证此前模型请求的用量，已暂停任务以避免超出令牌预算。', '无法验证模型用量，已暂停任务以避免超出令牌预算。',
  '已达到令牌预算上限，未继续发送模型请求。', '当前模型请求预计超过输入令牌预算，未发送请求。',
  '已达到输出令牌预算上限，未发送模型请求。', '已达到令牌预算上限，未执行模型请求中的工具。',
  '工具已完成，但已达到令牌预算上限，未继续发送下一轮模型请求。',
  '问题已过期，任务已暂停，等待你继续。', '已取消本次提问，任务已暂停。',
  '已达到本次任务的工具调用上限。', '已达到本次任务的总模型轮次安全上限。',
  '已达到本次任务的输入令牌预算，未发送新的请求。', '已达到本次任务的输出令牌预算，未发送新的请求。',
  '已达到输入令牌预算，未再发送请求。', '已达到输出令牌预算，未再发送请求。',
  'Task paused.', 'Task cancelled.', 'The model returned no text.',
]);

/** Only exact known product fallbacks with a valid recorded reason qualify; never infer from a prose prefix. */
export function legacyRuntimeFinalMessage(finalText: unknown, stopReason: unknown): AgentRuntimeFinalMessage | undefined {
  const message = normalizeRuntimeFinalMessage({ origin: "runtime", stopReason });
  if (!message || typeof finalText !== "string" || !finalText.trim()) return undefined;
  const text = finalText.trim();
  if (message.stopReason === "completed" && ['模型没有返回正文。', '模型没有返回正文', 'The model returned no text.'].includes(text)) {
    return { origin: "runtime", stopReason: "empty_response" };
  }
  return text === canonicalRuntimeFinal(message) || message.stopReason !== "completed" && legacyRuntimeFinalTexts.has(text) ? message : undefined;
}
