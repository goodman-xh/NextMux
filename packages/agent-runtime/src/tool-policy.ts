import { AgentToolError } from "./errors.js";
import type { AgentSkillPolicy, AgentToolPolicySnapshot } from "./types.js";

export const AGENT_SKILL_LOAD_TOOL_NAME = "skill.load";
/** These controls cannot access resources or approve a higher permission mode. */
export const AGENT_POLICY_CONTROL_TOOLS = Object.freeze(["skill.load", "tool.search", "task.update_plan", "task.request_user_input"]);

export function validatedAllowedToolNames(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8192 || value.some(name => typeof name !== "string" || name.length > 160 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(name))) {
    throw new AgentToolError("INVALID_TOOL_POLICY", "Tool policy requires up to 8192 exact NextMux tool identifiers");
  }
  return Object.freeze([...new Set(value)]);
}

export function intersectAllowedToolNames(left: readonly string[], right: readonly string[] | undefined): readonly string[] {
  return right === undefined ? [...left] : left.filter(name => right.includes(name));
}

export function validatedSkillPolicy(value: AgentSkillPolicy): AgentSkillPolicy {
  if (!value || typeof value.id !== "string" || typeof value.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(value.id) || !/^[a-f0-9]{64}$/.test(value.sourceHash)
    || typeof value.name !== "string" || value.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name)) {
    throw new AgentToolError("INVALID_SKILL_POLICY", "Skill policy requires a verified source identity and snapshot");
  }
  const names = validatedAllowedToolNames(value.allowedToolNames);
  return Object.freeze({ id: value.id, name: value.name, sourceHash: value.sourceHash, ...(names === undefined ? {} : { allowedToolNames: names }) });
}

export function narrowSkillToolNames(current: readonly string[], policy: AgentSkillPolicy): readonly string[] {
  if (policy.allowedToolNames === undefined) return [...current];
  return current.filter(name => AGENT_POLICY_CONTROL_TOOLS.includes(name) || policy.allowedToolNames!.includes(name));
}

export function validatedToolPolicy(value: AgentToolPolicySnapshot | undefined): AgentToolPolicySnapshot | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new AgentToolError("INVALID_TOOL_POLICY", "Invalid skill policy checkpoint");
  const names = validatedAllowedToolNames(value.allowedToolNames);
  if (!names || !Array.isArray(value.skills) || value.skills.length > 24) throw new AgentToolError("INVALID_TOOL_POLICY", "Invalid skill policy checkpoint");
  const skills = value.skills.map(validatedSkillPolicy);
  if (new Set(skills.map(skill => skill.id)).size !== skills.length || skills.some(skill => narrowSkillToolNames(names, skill).length !== names.length)) {
    throw new AgentToolError("INVALID_TOOL_POLICY", "Skill policy checkpoint widens its declared tool scope");
  }
  return { allowedToolNames: names, skills };
}
