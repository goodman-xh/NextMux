import { access, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Apache-2.0 upstream policy generator; no daemon, container, or log monitor. */
export async function wrapWorkspaceProcess(options: {
  command: string; args: readonly string[]; workspaceRoot: string; temporaryRoot: string;
  checkpointRoot: string; tty: boolean;
}): Promise<{ command: string; args: string[] } | undefined> {
  // Native Windows needs upstream's privileged sandbox-user/WFP provisioning.
  // Never silently turn a cwd check into an operating-system sandbox.
  if (process.platform !== "darwin") return undefined;
  // Upstream treats glob characters as patterns. Do not widen a literal root.
  if ([options.workspaceRoot, options.temporaryRoot, options.checkpointRoot].some(path => /[*?\[\]{}\n\r]/.test(path))) return undefined;
  try { await access("/usr/bin/sandbox-exec"); } catch { return undefined; }
  const { wrapCommandWithSandboxMacOS } = await import("@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js");
  const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
  const executable = await realpath(process.execPath);
  const appBoundary = executable.indexOf(".app/Contents/");
  const trustedRuntime = appBoundary >= 0 ? executable.slice(0, appBoundary + 4) : executable;
  if (/[*?\[\]{}\n\r]/.test(trustedRuntime)) return undefined;
  const command = wrapCommandWithSandboxMacOS({
    command: `exec ${[options.command, ...options.args].map(quote).join(" ")}`,
    needsNetworkRestriction: false,
    readConfig: {
      // Preserve OS libraries while keeping another project/user document out
      // of shell reads. Only the host runtime, this project and its private temp
      // are opened back up; model-supplied executable paths grant no read scope.
      denyOnly: ["/", options.checkpointRoot, join(options.workspaceRoot, ".nextmux")],
      allowWithinDeny: [options.workspaceRoot, options.temporaryRoot, trustedRuntime,
        "/System", "/usr", "/bin", "/sbin", "/dev", "/opt/homebrew", "/Library/Apple", "/Library/Developer",
        "/Applications/Xcode.app", "/private/etc/ssl", "/private/etc/passwd", "/private/etc/group", "/private/etc/hosts", "/private/etc/resolv.conf", "/private/etc/localtime",
        ...(appBoundary >= 0 ? [] : [join(dirname(executable), "..", "lib")])],
    },
    writeConfig: {
      allowOnly: [options.workspaceRoot, options.temporaryRoot],
      denyWithinAllow: [options.checkpointRoot, join(options.workspaceRoot, ".nextmux")],
    },
    allowPty: options.tty,
    allowAllUnixSockets: false,
    allowAppleEvents: false,
    binShell: "/bin/sh",
  });
  return { command: "/bin/sh", args: ["-c", command] };
}
