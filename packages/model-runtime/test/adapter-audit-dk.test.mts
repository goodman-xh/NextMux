import assert from "node:assert/strict";
import test from "node:test";
import { createAiSdkModelClient, createOfficialModelClient, geminiSchema } from "../lib/index.js";

// Audit DK-A4 / DK-B2 / DK-C3: Gemini enum types, DeepSeek reasoning_content, empty text parts.
const tool = {
  name: "workspace.set_level",
  description: "Set a level",
  inputSchema: { type: "object", properties: {
    level: { type: "integer", enum: [1, 2, 3], description: "Level" },
    ratio: { type: "number", enum: [0.5, 1.5] },
    strict: { type: "boolean", enum: [true] },
    mode: { type: "string", enum: ["fast", "safe"] },
    mixed: { enum: ["a", 1] },
  }, required: ["level"] },
};

test("numeric and boolean enums keep their native type on Gemini; string enums stay enums", () => {
  const schema = geminiSchema(tool.inputSchema) as { properties: Record<string, Record<string, unknown>> };
  // Gemini accepts enum only on STRING: a numeric enum would fail the whole request, so the values move to the description.
  assert.deepEqual(schema.properties.level, { type: "integer", description: "Level Allowed values: 1, 2, 3." });
  assert.deepEqual(schema.properties.ratio, { type: "number", description: "Allowed values: 0.5, 1.5." });
  assert.deepEqual(schema.properties.strict, { type: "boolean", description: "Allowed values: true." });
  assert.deepEqual(schema.properties.mode, { type: "string", enum: ["fast", "safe"] });
  assert.deepEqual(schema.properties.mixed, { type: "string", enum: ["a", "1"] });
});

const geminiBodies: any[] = [];
const gemini = createOfficialModelClient({
  providerId: "gemini", protocol: "gemini_generate_content", baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  apiKey: "synthetic-key", model: "gemini-2.5-pro",
  fetchImpl: async (_url, init) => {
    geminiBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ candidates: [{ index: 0, content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } });
  },
});

test("Gemini never receives an empty text part from an empty or attachment-only user message", async () => {
  await gemini.complete({ tools: [], messages: [
    { role: "user", content: "Look at this" },
    { role: "user", content: "", attachments: [{ kind: "image", name: "a.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" }] },
    { role: "user", content: "" },
  ] });
  const parts = geminiBodies.at(-1).contents.flatMap((content: { parts: unknown[] }) => content.parts);
  assert.equal(parts.some((part: { text?: string }) => part.text === ""), false);
  assert.equal(parts.length, 2, "the text and the image");
});

test("the native Anthropic adapter never merges an empty text block into a user turn", async () => {
  const bodies: any[] = [];
  const anthropic = createOfficialModelClient({
    providerId: "anthropic", protocol: "anthropic_messages", baseUrl: "https://api.anthropic.com/v1", apiKey: "synthetic-key", model: "claude-sonnet-4-5",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 1 } });
    },
  });
  await anthropic.complete({ tools: [], messages: [
    { role: "user", content: "First" },
    { role: "user", content: "", attachments: [{ kind: "image", name: "a.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" }] },
    { role: "user", content: "" },
  ] });
  const blocks = bodies.at(-1).messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content : [{ type: "text", text: message.content }]);
  assert.equal(blocks.some((block: { type: string; text?: string }) => block.type === "text" && !block.text), false);
});

test("DeepSeek gets reasoning_content on a tool-call turn only for a thinking model or with reasoning on", async () => {
  const bodies: any[] = [];
  const client = (model: string) => createAiSdkModelClient({
    providerId: "deepseek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1", apiKey: "synthetic-key", model,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const chunk = { id: "c1", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const messages = [
    { role: "user" as const, content: "Read a.ts" },
    // Reasoning recorded by another route (the legacy adapter) travels with the tool-call turn.
    { role: "assistant" as const, content: "", toolCalls: [{ id: "call_1", name: "workspace.read_file", arguments: { path: "a.ts" } }],
      providerState: { kind: "openai-chat-v1", reasoning_content: "Earlier chain of thought", replayScope: "legacy:other-route" } },
    { role: "tool" as const, toolCallId: "call_1", content: "export const a = 1;" },
  ];
  const readTool = { name: "workspace.read_file", description: "Read", inputSchema: { type: "object", properties: { path: { type: "string" } } },
    requiredPermission: "read_only" as const, source: "builtin" as const };
  await client("deepseek-chat").complete({ messages, tools: [readTool] });
  const chatAssistant = bodies.at(-1).messages.find((message: { role: string }) => message.role === "assistant");
  assert.equal("reasoning_content" in chatAssistant, false, "a non-thinking DeepSeek model gets no reasoning_content");
  await client("deepseek-chat").complete({ messages, tools: [readTool], reasoningEnabled: true });
  const thinkingAssistant = bodies.at(-1).messages.find((message: { role: string }) => message.role === "assistant");
  assert.equal(thinkingAssistant.reasoning_content, "Earlier chain of thought", "DeepSeek with reasoning on keeps the required field");
});
