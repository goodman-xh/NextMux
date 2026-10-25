import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createAiSdkModelClient,
  createOfficialModelClient,
  createPreferredOfficialModelClient,
  geminiSchema,
  healOrphanToolCalls,
  mergeConsecutiveUserMessages,
  portableAssistantOutputMessages,
  sanitizeToolCallIds,
} from "../lib/index.js";
import { smallImages } from "./fixtures/output-images.mts";

const pngBytes = Buffer.from(smallImages.png!, "base64");
const pngAsset = {
  sha256: createHash("sha256").update(pngBytes).digest("hex"),
  mimeType: "image/png" as const,
  sizeBytes: pngBytes.length,
};

const sampleTool = {
  name: "workspace.read_file",
  description: "Read a file",
  requiredPermission: "read_only" as const,
  source: "builtin" as const,
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    $defs: {
      Encoding: { type: "string", const: "utf8" },
    },
    properties: {
      path: { type: "string", format: "uri-reference" },
      encoding: { $ref: "#/$defs/Encoding" },
      maxLines: { type: ["integer", "null"], minimum: 1, maximum: 500 },
    },
    required: ["path", "missingProp"],
  },
};

test("Item 1: switching from a Gemini media-generating model to OpenAI, Anthropic, or text Gemini degrades foreign outputParts and v2 replay state", async () => {
  for (const [label, make] of [
    ["SDK", createPreferredOfficialModelClient],
    ["legacy", createOfficialModelClient],
  ] as const) {
    const geminiBodies: any[] = [];
    const geminiImageClient = make({
      providerId: "gemini",
      protocol: "gemini_generate_content",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "synthetic-gemini-key",
      model: "gemini-3-pro-image-preview",
      acceptOrderedOutput: true,
      resolveAssistantOutputAsset: async () => pngBytes,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        geminiBodies.push(body);
        const payload = {
          candidates: [{
            index: 0,
            content: {
              role: "model",
              parts: [
                { text: "Image layout analysis", thought: true, thoughtSignature: "gemini-private-sig" },
                { text: "Here is the architecture diagram" },
                { inlineData: { mimeType: "image/png", data: pngBytes.toString("base64") } },
              ],
            },
            finishReason: "STOP",
          }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, totalTokenCount: 10 },
        };
        return String(_url).includes(":streamGenerateContent")
          ? new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } })
          : Response.json(payload);
      },
    });

    const firstTurn = await geminiImageClient.complete({
      messages: [{ role: "user", content: "Draw the architecture diagram" }],
      tools: [],
    });
    assert.ok(firstTurn.outputParts?.some(part => part.type === "image"));
    assert.ok(firstTurn.providerState);

    const historyWithMedia = [
      { role: "user" as const, content: "Draw the architecture diagram" },
      {
        role: "assistant" as const,
        content: firstTurn.content || "",
        outputParts: [
          { type: "text" as const, text: "Here is the architecture diagram" },
          { type: "image" as const, asset: pngAsset },
        ],
        providerState: firstTurn.providerState,
      },
      { role: "user" as const, content: "Now explain the diagram using GPT-5.4" },
    ];

    const openaiBodies: any[] = [];
    const openaiClient = make({
      providerId: "openai",
      protocol: "openai_chat_completions",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "synthetic-openai-key",
      model: "gpt-5.4",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        openaiBodies.push(body);
        const sse = `data: ${JSON.stringify({
          id: "chat-1",
          model: "gpt-5.4",
          choices: [{ index: 0, delta: { role: "assistant", content: "Explanation complete" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        })}\n\ndata: [DONE]\n\n`;
        return label === "SDK"
          ? new Response(sse, { headers: { "content-type": "text/event-stream" } })
          : Response.json({
              id: "chat-1",
              model: "gpt-5.4",
              choices: [{ index: 0, message: { role: "assistant", content: "Explanation complete" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            });
      },
    });

    const secondTurn = await openaiClient.complete({ messages: historyWithMedia, tools: [] });
    assert.equal(secondTurn.content, "Explanation complete");
    assert.equal(openaiBodies.length, 1);
    const wireText = JSON.stringify(openaiBodies[0]);
    assert.match(wireText, /\[Generated image \(image\/png\) omitted on model switch\]/);
    assert.doesNotMatch(wireText, /gemini-private-sig/);
    if (label === "SDK") {
      assert.match(wireText, /Image layout analysis/, "downgraded v1 state preserves readable reasoning for cross-model folding");
    }

    // Also verify switching between two Gemini models when degradeForeignOutputReplay: true is enabled.
    const flashBodies: any[] = [];
    const flashClient = make({
      providerId: "gemini",
      protocol: "gemini_generate_content",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "synthetic-gemini-key",
      model: "gemini-2.5-flash",
      acceptOrderedOutput: true,
      degradeForeignOutputReplay: true,
      fetchImpl: async (_url, init) => {
        flashBodies.push(JSON.parse(String(init?.body)));
        const payload = {
          candidates: [{ index: 0, content: { role: "model", parts: [{ text: "Flash summary" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
        };
        return String(_url).includes(":streamGenerateContent")
          ? new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } })
          : Response.json(payload);
      },
    });
    const flashTurn = await flashClient.complete({ messages: historyWithMedia, tools: [] });
    assert.equal(flashTurn.content, "Flash summary");
    assert.match(JSON.stringify(flashBodies[0]), /\[Generated image \(image\/png\) omitted on model switch\]/);
    assert.equal(portableAssistantOutputMessages(historyWithMedia, {
      providerId: "gemini",
      protocol: "gemini_generate_content",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-3-pro-image-preview",
      acceptOrderedOutput: true,
    }, label === "SDK" ? "ai_sdk" : "legacy"), historyWithMedia, "same route + model keeps binary outputParts intact");
  }
});

test("Item 2: toolCallId sanitization, orphan tool_call healing, and consecutive user message merging across model switches", async () => {
  const rawHistory = [
    { role: "user" as const, content: "First user part" },
    { role: "user" as const, content: "Second user part after abort" },
    {
      role: "assistant" as const,
      content: "Running tools",
      toolCalls: [
        { id: "functions.read_file:0", name: "workspace.read_file", arguments: { path: "a.ts" } },
        { id: `call_${"x".repeat(80)}`, name: "workspace.read_file", arguments: { path: "b.ts" } },
      ],
    },
    // Only the first tool call has a result; the second was interrupted before completion.
    { role: "tool" as const, toolCallId: "functions.read_file:0", content: "export const a = 1;" },
    { role: "user" as const, content: "Continue with Mistral" },
  ];

  const mistralSanitized = sanitizeToolCallIds(rawHistory, { providerId: "mistral", model: "codestral-latest" });
  const mistralCalls = mistralSanitized[2]!.toolCalls!;
  assert.match(mistralCalls[0]!.id, /^[A-Za-z0-9]{9}$/);
  assert.match(mistralCalls[1]!.id, /^[A-Za-z0-9]{9}$/);
  assert.equal(mistralSanitized[3]!.toolCallId, mistralCalls[0]!.id);

  const kimiSanitized = sanitizeToolCallIds(rawHistory, { providerId: "moonshot", model: "kimi-k2-0905-preview" });
  const kimiCalls = kimiSanitized[2]!.toolCalls!;
  assert.equal(kimiCalls[0]!.id, "functions.read_file:0", "Kimi K2 native functions.<name>:<index> ID must be preserved");
  assert.equal(kimiCalls[1]!.id, "functions.workspace_read_file:1", "foreign IDs are rewritten to Kimi K2 functions.<name>:<index> format");
  assert.equal(kimiSanitized[3]!.toolCallId, "functions.read_file:0");

  const healed = healOrphanToolCalls(mistralSanitized);
  assert.equal(healed.length, 6);
  assert.equal(healed[4]!.role, "tool");
  assert.equal(healed[4]!.toolCallId, mistralCalls[1]!.id);
  assert.match(healed[4]!.content, /INTERRUPTED/);

  const merged = mergeConsecutiveUserMessages(healed);
  assert.equal(merged.length, 5);
  assert.equal(merged[0]!.content, "First user part\n\nSecond user part after abort");

  // Verify end-to-end through Anthropic SDK client
  let anthropicBody: any;
  const anthropicClient = createAiSdkModelClient({
    providerId: "anthropic",
    protocol: "anthropic_messages",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "synthetic-anthropic-key",
    model: "claude-sonnet-4-5",
    fetchImpl: async (_url, init) => {
      anthropicBody = JSON.parse(String(init?.body));
      const events = [
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [], usage: { input_tokens: 12, output_tokens: 1 } } })}\n\n`,
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Switched cleanly" } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
      ].join("");
      return new Response(events, { headers: { "content-type": "text/event-stream" } });
    },
  });

  const turn = await anthropicClient.complete({ messages: rawHistory, tools: [sampleTool] });
  assert.equal(turn.content, "Switched cleanly");
  assert.equal(anthropicBody.messages[0].role, "user");
  const firstUserText = typeof anthropicBody.messages[0].content === "string"
    ? anthropicBody.messages[0].content
    : anthropicBody.messages[0].content.map((part: any) => part.text).join("");
  assert.match(firstUserText, /First user part\n\nSecond user part after abort/);
  const toolUseBlocks = anthropicBody.messages[1].content.filter((block: any) => block.type === "tool_use");
  const toolResultBlocks = anthropicBody.messages[2].content.filter((block: any) => block.type === "tool_result");
  assert.equal(toolUseBlocks.length, 2);
  assert.equal(toolResultBlocks.length, 2);
  for (const block of toolUseBlocks) {
    assert.match(block.id, /^[A-Za-z0-9_-]{1,64}$/);
  }
  assert.deepEqual(
    toolResultBlocks.map((block: any) => block.tool_use_id),
    toolUseBlocks.map((block: any) => block.id),
  );
});

test("Item 3: foreign reasoning folding is bounded (8k/message, 24k/history) and omitted when reasoningExclude is true, while legacy OpenAI replays reasoning_content on same scope", async () => {
  const makeForeignState = (char: string, length: number) => ({
    version: 1 as const,
    kind: "ai_sdk_provider_state" as const,
    providerScope: "foreign-scope-hash",
    toolCallProviderOptions: {},
    reasoning: [{ text: `${char.repeat(length)}_TAIL_${char}` }],
  });

  const messages = [
    { role: "user" as const, content: "Turn 1" },
    { role: "assistant" as const, content: "Ans 1", providerState: makeForeignState("A", 10_000) },
    { role: "user" as const, content: "Turn 2" },
    { role: "assistant" as const, content: "Ans 2", providerState: makeForeignState("B", 10_000) },
    { role: "user" as const, content: "Turn 3" },
    { role: "assistant" as const, content: "Ans 3", providerState: makeForeignState("C", 10_000) },
    { role: "user" as const, content: "Turn 4" },
    { role: "assistant" as const, content: "Ans 4", providerState: makeForeignState("D", 10_000) },
    { role: "user" as const, content: "Final question" },
  ];

  const bodies: any[] = [];
  const client = createAiSdkModelClient({
    providerId: "openai",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "synthetic-key",
    model: "gpt-5.4",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        `data: ${JSON.stringify({
          id: "1",
          model: "gpt-5.4",
          choices: [{ index: 0, delta: { role: "assistant", content: "Done" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  await client.complete({ messages, tools: [] });
  const foldedBody = JSON.stringify(bodies[0]);
  // Newest 3 messages (D, C, B) each consume 8,000 chars = 24,000 chars total, so oldest (A) is dropped and tails are kept.
  assert.match(foldedBody, /_TAIL_D/);
  assert.match(foldedBody, /_TAIL_C/);
  assert.match(foldedBody, /_TAIL_B/);
  assert.doesNotMatch(foldedBody, /_TAIL_A/);

  // With reasoningExclude: true, no foreign reasoning is folded into text.
  await client.complete({ messages, tools: [], reasoningExclude: true });
  const excludedBody = JSON.stringify(bodies[1]);
  assert.doesNotMatch(excludedBody, /_TAIL_D|_TAIL_C|_TAIL_B|_TAIL_A/);

  // Verify legacy OpenAI adapter preserves and replays reasoning_content on same-scope tool-call turns.
  const legacyBodies: any[] = [];
  const deepseekLegacy = createOfficialModelClient({
    providerId: "deepseek",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "synthetic-deepseek-key",
    model: "deepseek-reasoner",
    fetchImpl: async (_url, init) => {
      legacyBodies.push(JSON.parse(String(init?.body)));
      if (legacyBodies.length === 1) {
        return Response.json({
          id: "ds-1",
          model: "deepseek-reasoner",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: "",
              reasoning_content: "Step-by-step DeepSeek R1 chain of thought",
              tool_calls: [{ id: "call_ds_1", type: "function", function: { name: "workspace__read_file", arguments: '{"path":"index.ts"}' } }],
            },
            finish_reason: "tool_calls",
          }],
          usage: { prompt_tokens: 8, completion_tokens: 12 },
        });
      }
      return Response.json({
        id: "ds-2",
        model: "deepseek-reasoner",
        choices: [{ index: 0, message: { role: "assistant", content: "Final answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      });
    },
  });

  const dsFirst = await deepseekLegacy.complete({
    messages: [{ role: "user", content: "Inspect index.ts" }],
    tools: [sampleTool],
  });
  assert.ok(dsFirst.providerState);
  await deepseekLegacy.complete({
    messages: [
      { role: "user", content: "Inspect index.ts" },
      { role: "assistant", content: dsFirst.content || "", toolCalls: dsFirst.toolCalls, providerState: dsFirst.providerState },
      { role: "tool", toolCallId: dsFirst.toolCalls![0]!.id, content: "console.log(1);" },
    ],
    tools: [sampleTool],
  });
  assert.equal(legacyBodies[1].messages[1].reasoning_content, "Step-by-step DeepSeek R1 chain of thought");
});

test("Item 4: Gemini tool schema sanitization and pre-acceptance HTTP 400/422 wire self-healing", async () => {
  const cleaned = geminiSchema(sampleTool.inputSchema);
  assert.equal(cleaned.$schema, undefined);
  assert.equal(cleaned.additionalProperties, undefined);
  assert.deepEqual(cleaned.properties, {
    path: { type: "string" },
    encoding: { type: "string", enum: ["utf8"] },
    maxLines: { type: "integer", nullable: true, minimum: 1, maximum: 500 },
  });
  assert.deepEqual(cleaned.required, ["path"]);

  // Verify Gemini adapter applies geminiSchema on the wire
  let geminiWire: any;
  const geminiClient = createOfficialModelClient({
    providerId: "gemini",
    protocol: "gemini_generate_content",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "synthetic-key",
    model: "gemini-2.5-pro",
    fetchImpl: async (_url, init) => {
      geminiWire = JSON.parse(String(init?.body));
      return Response.json({
        candidates: [{ index: 0, content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
      });
    },
  });
  await geminiClient.complete({ messages: [{ role: "user", content: "hi" }], tools: [sampleTool] });
  const sentParams = geminiWire.tools[0].functionDeclarations[0].parameters;
  assert.equal(sentParams.additionalProperties, undefined);
  assert.deepEqual(sentParams.required, ["path"]);

  // Verify pre-acceptance HTTP 400 self-healing on a compatible relay that rejects max_tokens for gpt-5.4
  const relayAttempts: any[] = [];
  const relayClient = createOfficialModelClient({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    baseUrl: "https://relay.example.test/v1",
    apiKey: "synthetic-relay-key",
    model: "gpt-5.4",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      relayAttempts.push(body);
      if (relayAttempts.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return Response.json({
        id: "healed-1",
        model: "gpt-5.4",
        choices: [{ index: 0, message: { role: "assistant", content: "Self-healed response" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      });
    },
  });

  const healedTurn = await relayClient.complete({
    messages: [{ role: "user", content: "Test self-heal" }],
    tools: [],
    maxOutputTokens: 2048,
  });
  assert.equal(healedTurn.content, "Self-healed response");
  assert.equal(relayAttempts.length, 2);
  assert.equal(relayAttempts[0].max_tokens, 2048);
  assert.equal(relayAttempts[1].max_tokens, undefined);
  assert.equal(relayAttempts[1].max_completion_tokens, 2048);
});
