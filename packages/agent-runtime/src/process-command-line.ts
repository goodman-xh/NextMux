const SIMPLE_COMMAND_ARGUMENT = /^[\p{L}\p{N}_./:@%+\\=-]+$/u;

function printableArgument(value: string): string {
  const normalized = value.replace(/[\0\r\n]/g, character => character === "\0" ? "" : " ");
  return SIMPLE_COMMAND_ARGUMENT.test(normalized)
    ? normalized
    : `"${normalized.replace(/"/g, '\\"')}"`;
}

/**
 * Build a bounded, shell-neutral representation of the exact argv passed to
 * process.run. This is presentation data only; execution continues to use
 * shell:false and the original argv array.
 */
export function formatProcessCommandLine(
  command: string,
  args: readonly string[] = [],
  maximum = 4_096,
): string {
  const limit = Math.max(80, Math.min(16_384, Math.floor(maximum) || 4_096));
  const rendered = [printableArgument(command), ...args.map(printableArgument)].filter(Boolean).join(" ");
  return rendered.length <= limit ? rendered : `${rendered.slice(0, limit - 1)}…`;
}
