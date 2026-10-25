import type { AgentTaskPlanStep } from "./types.js";

/**
 * A task plan is a short list of outcomes, not a transcript of tools.  Some
 * providers mirror their own search/read/command labels into task.update_plan;
 * recognizing those labels centrally keeps the live run and every host-side
 * persistence layer from presenting them as user-visible tasks.
 */
export function isLowLevelTaskPlanTitle(title: string): boolean {
  const value = title.replace(/\s+/g, " ").trim();
  if (!value) return false;
  return /^(?:找到\s+\d+\s*处匹配|列出\s+\d+\s*个工作区条目|工具执行失败|工具调用失败|正在运行\s+.+\s*>|正在读取\s+.+\s*>|正在搜索\s+.+\s*>|正在执行\s+.+\s*>|执行了命令\s*>|执行了\s+.+\s*>|读取\s+(?:文件\s+)?(?:[A-Za-z]:|\.{0,2}|(?:packages|apps|src|test|docs|artifacts|output|scripts)\b|[^\s]+\.(?:c|cc|cpp|cs|css|go|h|hpp|html?|ini|java|js|json|jsx|log|md|mjs|mts|php|py|rb|rs|scss|sh|sql|srt|svg|ts|tsx|txt|toml|vtt|vue|xml|yaml|yml)))/iu.test(value)
    || /^(?:rg|grep|findstr|node|pnpm|npm|yarn|git|powershell|pwsh|cmd)(?:\s+.+)?\s+(?:退出码|exit\s+code)\s*-?\d+(?:\s|$)/iu.test(value)
    || /^(?:found\s+\d+\s+matches|listed\s+\d+\s+workspace\s+(?:entries|items)|tool\s+(?:execution|call)\s+failed|read(?:ing)?\s+(?:file\s+)?\S+|process\s+exited(?:\s+with\s+code)?\s*-?\d+)/iu.test(value)
    || /^(?:找到|发现)\s*\d+\s*(?:处匹配|个匹配|项匹配|matches?)/iu.test(value)
    || /^(?:列出|显示)\s*\d+\s*(?:个工作区条目|个条目|项|workspace\s+(?:entries|items))/iu.test(value)
    || /^(?:工具执行失败|工具调用失败|tool\s+(?:execution|call)\s+failed)$/iu.test(value)
    || /^(?:读取|读入|reading?|read)\s+(?:文件\s+)?(?:[a-z]:[\\/]|\.{0,2}[\\/]|(?:packages|apps|src|test|docs|artifacts|output|scripts)(?:[\\/]|\b)|\S+\.(?:c|cc|cpp|cs|css|go|h|hpp|html?|ini|java|js|json|jsx|log|md|mjs|mts|php|py|rb|rs|scss|sh|sql|srt|svg|ts|tsx|txt|toml|vtt|vue|xml|yaml|yml))/iu.test(value);
}

/** Return only semantic plan rows while preserving their original order. */
export function semanticTaskPlanSteps(steps: readonly AgentTaskPlanStep[]): readonly AgentTaskPlanStep[] {
  return steps.filter(step => !isLowLevelTaskPlanTitle(step.title));
}
