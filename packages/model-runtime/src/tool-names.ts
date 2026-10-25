// The provider-safe tool names live in agent-runtime, which also rewrites the prompt with them (runner.ts), so the
// names a model reads and the names it can call are always the same.
export { createToolNameCodec, providerToolAlias, rewriteToolReferences, type ToolNameCodec } from "@nextmux/agent-runtime";
