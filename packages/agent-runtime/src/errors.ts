/**
 * Domain error shared by browser-safe validation helpers and the Node runtime.
 * Keep this module dependency-free so browser consumers never pull the
 * filesystem-backed tool ledger through the registry entrypoint.
 */
export class AgentToolError extends Error {
  readonly code: string;
  readonly usage?: import("./types.js").AgentUsage;
  readonly usageKnown?: boolean;
  readonly params?: import("./types.js").AgentMessageParams;
  readonly childReceipt?: import("./types.js").AgentChildReceipt;

  constructor(
    code: string,
    message: string,
    options: { readonly usage?: import("./types.js").AgentUsage; readonly usageKnown?: boolean; readonly childReceipt?: import("./types.js").AgentChildReceipt; readonly params?: import("./types.js").AgentMessageParams } = {},
  ) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
    this.params = options.params;
    this.childReceipt = options.childReceipt;
    if (options.usage && Number.isSafeInteger(options.usage.inputTokens) && options.usage.inputTokens >= 0
      && Number.isSafeInteger(options.usage.outputTokens) && options.usage.outputTokens >= 0) {
      this.usage = { ...options.usage };
      this.usageKnown = options.usageKnown;
    }
  }
}
