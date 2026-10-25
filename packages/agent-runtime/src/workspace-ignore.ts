import { lstat, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";

export interface WorkspaceIgnoreRule { readonly directory: string; readonly matcher: Ignore; }

export async function withDirectoryIgnore(directory: string, inherited: readonly WorkspaceIgnoreRule[]): Promise<readonly WorkspaceIgnoreRule[]> {
  let rules = inherited;
  const gitExcludePath = join(directory, ".git", "info", "exclude");
  try {
    const metadata = await lstat(gitExcludePath);
    if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 64 * 1024) {
      rules = [...rules, { directory, matcher: ignore().add(await readFile(gitExcludePath, "utf8")) }];
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }
  const path = join(directory, ".gitignore");
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024) return rules;
    return [...rules, { directory, matcher: ignore().add(await readFile(path, "utf8")) }];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return rules;
    throw error;
  }
}

export function workspacePathIgnored(path: string, directory: boolean, rules: readonly WorkspaceIgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    const local = relative(rule.directory, path).split(sep).join("/");
    if (!local || local === ".." || local.startsWith("../")) continue;
    const result = rule.matcher.test(directory ? `${local}/` : local);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}
